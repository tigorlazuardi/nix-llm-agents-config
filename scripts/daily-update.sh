#!/usr/bin/env bash
# Checked updater. Runs only from GitHub Actions with built-in GITHUB_TOKEN.
set -u -o pipefail

mode=${1:?usage: daily-update.sh inputs|plugins}
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
failures=0

say() { printf '%s\n' "$*" >>"$summary"; }
error() { say "- failure: ${1//$'\n'/ }"; }
changed() { ! git diff --quiet -- "$@"; }

# Never put command output in summary: Nix/npm/git errors can include credentials in URLs.
run_check() {
  local check=$1 output status
  output=$(mktemp)
  if nix build ".#checks.x86_64-linux.$check" >"$output" 2>&1; then
    say "- check: \`$check\` passed"
    return 0
  fi
  status=$?
  error "check $check failed (exit $status)"
  return "$status"
}

push_checked() {
  local check=$1 attempt=0
  while :; do
    git fetch origin main --quiet
    if ! git rebase origin/main; then
      git rebase --abort || true
      error "rebase onto origin/main failed"
      return 1
    fi
    # Rebase can change target context; rerun target check before every push.
    run_check "$check" || return 1
    if git push origin HEAD:main; then return 0; fi
    attempt=$((attempt + 1))
    if [ "$attempt" -gt 1 ]; then
      error "concurrent update retry exhausted"
      return 1
    fi
    say "- concurrent update: retrying once"
  done
}

push_inputs_checked() {
  local attempt=0
  while :; do
    git fetch origin main --quiet
    if ! git rebase origin/main; then
      git rebase --abort || true
      error "rebase onto origin/main failed"
      return 1
    fi
    if ! run_check formatting || ! nix flake check; then
      error "input checks failed after rebase"
      return 1
    fi
    if git push origin HEAD:main; then return 0; fi
    attempt=$((attempt + 1))
    if [ "$attempt" -gt 1 ]; then
      error "concurrent update retry exhausted"
      return 1
    fi
    say "- concurrent update: retrying once"
  done
}

replace_literal() {
  local file=$1 old=$2 new=$3 content
  content=$(<"$file")
  case "$content" in *"$old"*) printf '%s' "${content/"$old"/$new}" >"$file" ;; *) return 1 ;; esac
}

update_inputs() {
  local old_nix old_home
  old_nix=$(jq -r '.nodes["nixpkgs-unstable"].locked.rev' flake.lock)
  old_home=$(jq -r '.nodes["home-manager"].locked.rev' flake.lock)
  if ! nix flake update nixpkgs-unstable home-manager; then
    error "input update command failed"
    return 1
  fi
  if ! changed flake.lock; then
    say "- inputs: unchanged ($old_nix, $old_home)"
    return 0
  fi
  if ! run_check formatting || ! nix flake check; then
    error "input pair reset after failed full checks"
    git checkout -- flake.lock
    return 1
  fi
  git add flake.lock
  git commit -m 'chore(deps): update nixpkgs and home-manager' || return 1
  push_inputs_checked || return 1
  say "- inputs: $old_nix → $(jq -r '.nodes["nixpkgs-unstable"].locked.rev' flake.lock); $old_home → $(jq -r '.nodes["home-manager"].locked.rev' flake.lock)"
}

npm_update() {
  local alias=$1 entry=$2 package version src hash source_store source_metadata file lock check old_version old_src old_hash old_npm_deps_hash npm_deps_hash tmp source_dir registry
  npm_deps_hash=
  package=$(jq -r '.package' <<<"$entry")
  version=$(npm view "$package" version --json | jq -r .)
  old_version=$(jq -r '.version' <<<"$entry")
  [ "$version" = "$old_version" ] && { say "- $alias: unchanged ($version)"; return 0; }
  src=$(npm view "$package@$version" dist.tarball --json | jq -r .)
  source_metadata=$(nix store prefetch-file --json "$src" | jq -r '[.hash, .storePath] | @tsv') || return 1
  read -r hash source_store <<<"$source_metadata" || return 1
  file=$(jq -r '.packageFile' <<<"$entry")
  old_src=$(jq -r '.src' <<<"$entry")
  old_hash=$(jq -r '.hash' <<<"$entry")
  lock=$(jq -r '.lockFile // empty' <<<"$entry")
  tmp=$(mktemp -d)
  if [ -n "$lock" ]; then
    source_dir="$tmp/source"
    mkdir "$source_dir" || { rm -rf "$tmp"; return 1; }
    tar -xzf "$source_store" --strip-components=1 -C "$source_dir" || { rm -rf "$tmp"; return 1; }
    # Match build postPatch: lock roots omit build-only and host Pi dependencies.
    node -e 'const fs = require("fs"); const p = require(process.argv[1]); delete p.devDependencies; delete p.peerDependencies; fs.writeFileSync(process.argv[1], JSON.stringify(p, null, 2) + "\n")' "$source_dir/package.json" || { rm -rf "$tmp"; return 1; }
    jq -e --arg package "$package" --arg version "$version" '.name == $package and .version == $version' "$source_dir/package.json" >/dev/null || { rm -rf "$tmp"; return 1; }
    npm install --package-lock-only --ignore-scripts --omit=dev --omit=peer --prefix "$source_dir" >/dev/null || { rm -rf "$tmp"; return 1; }
    jq -e --arg package "$package" --arg version "$version" '.packages[""].name == $package and .packages[""].version == $version' "$source_dir/package-lock.json" >/dev/null || { rm -rf "$tmp"; return 1; }
    old_npm_deps_hash=$(jq -r '.npmDepsHash // empty' <<<"$entry")
    [ -n "$old_npm_deps_hash" ] || { rm -rf "$tmp"; return 1; }
    npm_deps_hash=$(nix run nixpkgs#prefetch-npm-deps -- "$source_dir/package-lock.json") || { rm -rf "$tmp"; return 1; }
    cp "$source_dir/package-lock.json" "$tmp/lock" || { rm -rf "$tmp"; return 1; }
  fi
  cp "$file" "$tmp/package.nix" && replace_literal "$tmp/package.nix" "$old_version" "$version" && replace_literal "$tmp/package.nix" "$old_src" "$src" && replace_literal "$tmp/package.nix" "$old_hash" "$hash" || { rm -rf "$tmp"; return 1; }
  if [ -n "$lock" ]; then
    replace_literal "$tmp/package.nix" "$old_npm_deps_hash" "$npm_deps_hash" || { rm -rf "$tmp"; return 1; }
  fi
  registry=$(jq --arg a "$alias" --arg v "$version" --arg s "$src" --arg h "$hash" --arg n "$npm_deps_hash" '.[$a].version=$v | .[$a].src=$s | .[$a].hash=$h | if .[$a].npmDepsHash? then .[$a].npmDepsHash=$n else . end' pi-plugins.json) || { rm -rf "$tmp"; return 1; }
  printf '%s\n' "$registry" >"$tmp/pi-plugins.json"
  mv "$tmp/package.nix" "$file" && mv "$tmp/pi-plugins.json" pi-plugins.json && { [ -z "$lock" ] || mv "$tmp/lock" "$lock"; } || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  check=$(jq -r '.check' <<<"$entry")
  plugin_commit "$alias" "$version" "$check" "$file" pi-plugins.json ${lock:+"$lock"} && say "- $alias: $old_version → $version"
}

github_update() {
  local alias=$1 entry=$2 owner repo track old_rev old_version rev version hash file check
  owner=$(jq -r '.owner' <<<"$entry"); repo=$(jq -r '.repo' <<<"$entry"); track=$(jq -r '.track' <<<"$entry")
  # Tag listing discovers GitHub releases; branch head remains explicit reviewed update target.
  git ls-remote --tags "https://github.com/$owner/$repo.git" >/dev/null
  old_rev=$(jq -r '.rev' <<<"$entry")
  old_version=$(jq -r '.version' <<<"$entry")
  rev=$(git ls-remote "https://github.com/$owner/$repo.git" "refs/heads/$track" | jq -R 'split("\t")[0]' -r)
  [ -n "$rev" ] && [ "$rev" != "null" ] || return 1
  [ "$rev" = "$old_rev" ] && { say "- $alias: unchanged ($old_rev)"; return 0; }
  version="unstable-$(date -u +%F)"
  hash=$(nix flake prefetch --json "github:$owner/$repo/$rev" | jq -r .hash)
  file=$(jq -r '.packageFile' <<<"$entry")
  replace_literal "$file" "$old_rev" "$rev" && replace_literal "$file" "$old_version" "$version" && replace_literal "$file" "$(jq -r '.hash' <<<"$entry")" "$hash" || return 1
  local registry
  registry=$(jq --arg a "$alias" --arg v "$version" --arg r "$rev" --arg h "$hash" '.[$a].version=$v | .[$a].rev=$r | .[$a].hash=$h' pi-plugins.json) || return 1
  printf '%s\n' "$registry" >pi-plugins.json
  check=$(jq -r '.check' <<<"$entry")
  plugin_commit "$alias" "$version" "$check" "$file" pi-plugins.json && say "- $alias: $old_version → $version ($old_rev → $rev)"
}

plugin_commit() {
  local alias=$1 version=$2 check=$3; shift 3
  if ! run_check "$check"; then git restore --staged --worktree -- "$@"; error "$alias reset after failed check"; return 1; fi
  git add -- "$@"
  git commit -m "chore(pi-plugins): update $alias to $version"
  if ! push_checked "$check"; then return 1; fi
  say "- $alias: updated to $version"
}

update_plugins() {
  local alias entry strategy
  git fetch origin main --quiet
  git checkout --detach origin/main
  while IFS= read -r alias; do
    entry=$(jq -c --arg a "$alias" '.[$a]' pi-plugins.json)
    strategy=$(jq -r '.strategy' <<<"$entry")
    case "$strategy" in
      npm) npm_update "$alias" "$entry" || { failures=1; git reset --hard HEAD; error "$alias failed"; } ;;
      github) github_update "$alias" "$entry" || { failures=1; git reset --hard HEAD; error "$alias failed"; } ;;
      unsupported) say "- $alias: skipped ($(jq -r '.reason' <<<"$entry"))" ;;
      *) failures=1; error "$alias has unknown strategy" ;;
    esac
  done < <(jq -r 'keys[]' pi-plugins.json)
  return "$failures"
}

say "## Daily update"
case "$mode" in
  inputs) update_inputs ;;
  plugins) update_plugins ;;
  *) exit 2 ;;
esac
