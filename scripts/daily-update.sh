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
  else
    status=$?
    error "check $check failed (exit $status)"
    return "$status"
  fi
}

push_checked() {
  local check=$1 attempt=0
  while :; do
    if ! git fetch origin main --quiet; then
      error "fetch origin/main failed"
      return 1
    fi
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
    if ! git fetch origin main --quiet; then
      error "fetch origin/main failed"
      return 1
    fi
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

apply_manifest_transform() {
  local entry=$1 manifest=$2 transform
  transform=$(jq -c '.manifestTransform // {}' <<<"$entry") || return 1
  node -e 'const fs = require("fs"); const [file, raw] = process.argv.slice(1); const p = require(file); const transform = JSON.parse(raw); for (const key of transform.delete || []) delete p[key]; for (const [key, value] of Object.entries(transform.dependencyOverrides || {})) p.dependencies[key] = value; if (transform.overrides) p.overrides = {...(p.overrides || {}), ...transform.overrides}; fs.writeFileSync(file, JSON.stringify(p, null, 2) + "\n")' "$manifest" "$transform"
}

apply_lock_integrity_patches() {
  local entry=$1 lock=$2 patches
  patches=$(jq -c '.lockIntegrityPatches // []' <<<"$entry") || return 1
  node -e 'const fs = require("fs"); const [file, raw] = process.argv.slice(1); const lock = require(file); for (const patch of JSON.parse(raw)) { const matches = Object.values(lock.packages || {}).filter(pkg => pkg.resolved === patch.resolved); if (!matches.length || matches.some(pkg => Object.hasOwn(pkg, "integrity"))) process.exit(1); for (const pkg of matches) pkg.integrity = patch.integrity; } fs.writeFileSync(file, JSON.stringify(lock, null, 2) + "\n")' "$lock" "$patches"
}

npm_update() {
  local alias=$1 entry=$2 package version src hash source_store source_metadata lock check old_version old_npm_deps_hash npm_deps_hash tmp source_dir registry
  npm_deps_hash=
  package=$(jq -r '.package' <<<"$entry")
  version=$(npm view "$package" version --json | jq -r .)
  old_version=$(jq -r '.version' <<<"$entry")
  [ "$version" = "$old_version" ] && { say "- $alias: unchanged ($version)"; return 0; }
  src=$(npm view "$package@$version" dist.tarball --json | jq -r .)
  source_metadata=$(nix store prefetch-file --json "$src" | jq -r '[.hash, .storePath] | @tsv') || return 1
  read -r hash source_store <<<"$source_metadata" || return 1
  lock=$(jq -r '.lockFile // empty' <<<"$entry")
  tmp=$(mktemp -d)
  if [ -n "$lock" ]; then
    source_dir="$tmp/source"
    mkdir "$source_dir" || { rm -rf "$tmp"; return 1; }
    tar -xzf "$source_store" --strip-components=1 -C "$source_dir" || { rm -rf "$tmp"; return 1; }
    # Match package-specific build postPatch before generating adjacent lock metadata.
    apply_manifest_transform "$entry" "$source_dir/package.json" || { rm -rf "$tmp"; return 1; }
    jq -e --arg package "$package" --arg version "$version" '.name == $package and .version == $version' "$source_dir/package.json" >/dev/null || { rm -rf "$tmp"; return 1; }
    npm install --package-lock-only --ignore-scripts --omit=dev --omit=peer --prefix "$source_dir" >/dev/null || { rm -rf "$tmp"; return 1; }
    jq -e --arg package "$package" --arg version "$version" '.packages[""].name == $package and .packages[""].version == $version' "$source_dir/package-lock.json" >/dev/null || { rm -rf "$tmp"; return 1; }
    old_npm_deps_hash=$(jq -r '.npmDepsHash // empty' <<<"$entry")
    [ -n "$old_npm_deps_hash" ] || { rm -rf "$tmp"; return 1; }
    npm_deps_hash=$(nix run nixpkgs#prefetch-npm-deps -- "$source_dir/package-lock.json") || { rm -rf "$tmp"; return 1; }
    cp "$source_dir/package-lock.json" "$tmp/lock" || { rm -rf "$tmp"; return 1; }
  fi
  registry=$(jq --arg a "$alias" --arg v "$version" --arg s "$src" --arg h "$hash" --arg n "$npm_deps_hash" '.[$a].version=$v | .[$a].src=$s | .[$a].hash=$h | if .[$a].npmDepsHash? then .[$a].npmDepsHash=$n else . end' pi-plugins.json) || { rm -rf "$tmp"; return 1; }
  printf '%s\n' "$registry" >"$tmp/pi-plugins.json"
  mv "$tmp/pi-plugins.json" pi-plugins.json && { [ -z "$lock" ] || mv "$tmp/lock" "$lock"; } || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  check=$(jq -r '.check' <<<"$entry")
  plugin_commit "$alias" "$version" "$check" pi-plugins.json ${lock:+"$lock"} && say "- $alias: $old_version → $version"
}

npm_shared_update() {
  local alias=$1 entry=$2 package version old_version shared lock check tmp npm_deps_hash registry
  package=$(jq -r '.package' <<<"$entry")
  version=$(npm view "$package" version --json | jq -r .) || return 1
  old_version=$(jq -r '.version' <<<"$entry")
  [ "$version" = "$old_version" ] && { say "- $alias: unchanged ($version)"; return 0; }
  shared=$(jq -r '.sharedPackage' <<<"$entry")
  lock=$(jq -r '.lockFile' <<<"$entry")
  check=$(jq -r '.check' <<<"$entry")
  tmp=$(mktemp -d)
  registry=$(jq --arg a "$alias" --arg v "$version" '.[$a].version=$v' pi-plugins.json) || { rm -rf "$tmp"; return 1; }
  jq --arg shared "$shared" '{name:$shared,version:"1.0.0",private:true,dependencies:(to_entries | map(select(.value.sharedPackage? == $shared)) | map({key:.value.package,value:.value.version}) | from_entries)}' <<<"$registry" >"$tmp/package.json" || { rm -rf "$tmp"; return 1; }
  npm install --package-lock-only --ignore-scripts --omit=dev --omit=peer --legacy-peer-deps --prefix "$tmp" >/dev/null || { rm -rf "$tmp"; return 1; }
  npm_deps_hash=$(nix run nixpkgs#prefetch-npm-deps -- "$tmp/package-lock.json") || { rm -rf "$tmp"; return 1; }
  registry=$(jq --arg shared "$shared" --arg hash "$npm_deps_hash" 'with_entries(if .value.sharedPackage? == $shared then .value.npmDepsHash=$hash else . end)' <<<"$registry") || { rm -rf "$tmp"; return 1; }
  printf '%s\n' "$registry" >"$tmp/pi-plugins.json"
  mv "$tmp/pi-plugins.json" pi-plugins.json && mv "$tmp/package-lock.json" "$lock" || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  plugin_commit "$alias" "$version" "$check" pi-plugins.json "$lock" && say "- $alias: $old_version → $version"
}

github_update() {
  local alias=$1 entry=$2 owner repo track tag_prefix old_rev old_version rev version hash check release source_url source_metadata source_store tmp source_dir remove_path lock npm_deps_hash registry
  owner=$(jq -r '.owner' <<<"$entry"); repo=$(jq -r '.repo' <<<"$entry"); track=$(jq -r '.track // empty' <<<"$entry"); tag_prefix=$(jq -r '.tagPrefix // empty' <<<"$entry")
  old_rev=$(jq -r '.rev' <<<"$entry")
  old_version=$(jq -r '.version' <<<"$entry")
  if [ -n "$tag_prefix" ]; then
    release=$(git ls-remote --tags "https://github.com/$owner/$repo.git" | jq -Rs --arg prefix "$tag_prefix" '
      split("\n")
      | map(select(length > 0) | capture("^(?<rev>[^\\t]+)\\trefs/tags/(?<tag>.+)$"))
      | map(.peeled = (.tag | endswith("^{}")) | .tag |= sub("\\^\\{\\}$"; ""))
      | group_by(.tag)
      | map({tag: .[0].tag, rev: ((map(select(.peeled)) | first) // .[0]).rev})
      | map(select(.tag | startswith($prefix)) | .version = (.tag | ltrimstr($prefix)) | select(.version | test("^[0-9]+(\\.[0-9]+)*$")))
      | sort_by(.version | split(".") | map(tonumber))
      | last
    ') || return 1
    rev=$(jq -r '.rev // empty' <<<"$release")
    version=$(jq -r '.version // empty' <<<"$release")
  else
    [ -n "$track" ] || return 1
    rev=$(git ls-remote "https://github.com/$owner/$repo.git" "refs/heads/$track" | jq -R 'split("\t")[0]' -r)
    version="unstable-$(date -u +%F)"
  fi
  [ -n "$rev" ] && [ -n "$version" ] && [ "$rev" != "null" ] || return 1
  [ "$rev" = "$old_rev" ] && { say "- $alias: unchanged ($old_version)"; return 0; }
  source_url="https://github.com/$owner/$repo/archive/$rev.tar.gz"
  source_metadata=$(nix store prefetch-file --json --unpack "$source_url") || return 1
  hash=$(jq -r .hash <<<"$source_metadata")
  source_store=$(jq -r .storePath <<<"$source_metadata")
  tmp=$(mktemp -d)
  if jq -e '.removePaths | length > 0' <<<"$entry" >/dev/null; then
    mkdir "$tmp/hash-source" || { rm -rf "$tmp"; return 1; }
    cp -a "$source_store/." "$tmp/hash-source/" || { rm -rf "$tmp"; return 1; }
    chmod -R u+w "$tmp/hash-source" || { rm -rf "$tmp"; return 1; }
    while IFS= read -r remove_path; do
      case "$remove_path" in ""|..|/*|*../*|../*|*/..) rm -rf "$tmp"; return 1 ;; esac
      rm -rf -- "$tmp/hash-source/$remove_path"
    done < <(jq -r '.removePaths[]' <<<"$entry")
    hash=$(nix hash path "$tmp/hash-source") || { rm -rf "$tmp"; return 1; }
  fi
  lock=$(jq -r '.lockFile // empty' <<<"$entry")
  npm_deps_hash=$(jq -r '.npmDepsHash // empty' <<<"$entry")
  if [ -n "$lock" ] || [ -n "$npm_deps_hash" ]; then
    source_dir="$tmp/source"
    mkdir "$source_dir" || { rm -rf "$tmp"; return 1; }
    cp -a "$source_store/." "$source_dir/" || { rm -rf "$tmp"; return 1; }
    chmod -R u+w "$source_dir" || { rm -rf "$tmp"; return 1; }
    apply_manifest_transform "$entry" "$source_dir/package.json" || { rm -rf "$tmp"; return 1; }
    if [ -n "$lock" ]; then
      npm install --package-lock-only --ignore-scripts --omit=dev --omit=peer --prefix "$source_dir" >/dev/null || { rm -rf "$tmp"; return 1; }
    else
      [ -f "$source_dir/package-lock.json" ] || { rm -rf "$tmp"; return 1; }
    fi
    apply_lock_integrity_patches "$entry" "$source_dir/package-lock.json" || { rm -rf "$tmp"; return 1; }
    npm_deps_hash=$(nix run nixpkgs#prefetch-npm-deps -- "$source_dir/package-lock.json") || { rm -rf "$tmp"; return 1; }
    if [ -n "$lock" ]; then cp "$source_dir/package-lock.json" "$tmp/lock" || { rm -rf "$tmp"; return 1; }; fi
  fi
  registry=$(jq --arg a "$alias" --arg v "$version" --arg r "$rev" --arg h "$hash" --arg s "$source_url" --arg n "$npm_deps_hash" '.[$a].version=$v | .[$a].rev=$r | .[$a].hash=$h | if .[$a].src? then .[$a].src=$s else . end | if .[$a].npmDepsHash? then .[$a].npmDepsHash=$n else . end' pi-plugins.json) || { rm -rf "$tmp"; return 1; }
  printf '%s\n' "$registry" >"$tmp/pi-plugins.json"
  mv "$tmp/pi-plugins.json" pi-plugins.json || { rm -rf "$tmp"; return 1; }
  if [ -n "$lock" ]; then mv "$tmp/lock" "$lock" || { rm -rf "$tmp"; return 1; }; fi
  rm -rf "$tmp"
  check=$(jq -r '.check' <<<"$entry")
  plugin_commit "$alias" "$version" "$check" pi-plugins.json ${lock:+"$lock"} && say "- $alias: $old_version → $version ($old_rev → $rev)"
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
  local alias alias_base entry strategy
  git fetch origin main --quiet || return 1
  git checkout --detach origin/main || return 1
  while IFS= read -r alias; do
    alias_base=$(git rev-parse HEAD) || return 1
    entry=$(jq -c --arg a "$alias" '.[$a]' pi-plugins.json)
    strategy=$(jq -r '.strategy' <<<"$entry")
    case "$strategy" in
      npm)
        if jq -e '.sharedPackage?' <<<"$entry" >/dev/null; then
          npm_shared_update "$alias" "$entry" || { failures=1; git reset --hard "$alias_base" && git checkout --detach "$alias_base" || return 1; error "$alias failed"; }
        else
          npm_update "$alias" "$entry" || { failures=1; git reset --hard "$alias_base" && git checkout --detach "$alias_base" || return 1; error "$alias failed"; }
        fi
        ;;
      github) github_update "$alias" "$entry" || { failures=1; git reset --hard "$alias_base" && git checkout --detach "$alias_base" || return 1; error "$alias failed"; } ;;
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
