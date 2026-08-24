#!/usr/bin/env bash
set -euo pipefail

workflow=${WORKFLOW:-.github/workflows/daily-update.yml}
updater=${UPDATER:-scripts/daily-update.sh}
registry=${REGISTRY:-pi-plugins.json}
checks=${CHECKS:-checks.nix}

test -x "$updater"
trigger_block=$(awk '/^on:$/ { active=1; next } active && /^[^[:space:]]/ { exit } active && NF { print }' "$workflow")
[ "$trigger_block" = '  workflow_dispatch:' ]
[ "$(grep -Fc 'workflow_dispatch:' "$workflow")" -eq 1 ]
grep -F 'contents: write' "$workflow"
test "$(grep -Fc 'git config user.name "github-actions[bot]"' "$workflow")" -eq 2
grep -F 'if: always()' "$workflow"
grep -F 'ref: main' "$workflow"
grep -F "chore(deps): update nixpkgs and home-manager" "$updater"
grep -F 'chore(pi-plugins): update $alias to $version' "$updater"
grep -F 'git rebase origin/main' "$updater"
grep -F 'git push origin HEAD:main' "$updater"
grep -F 'nix flake check' "$updater"
! grep -F 'builtins.length (builtins.attrNames default.config.programs.pi-coding-agent.skills)' "$checks"
grep -F 'git commit -m '\''chore(deps): update nixpkgs and home-manager'\'' || return 1' "$updater"
grep -F 'push_inputs_checked || return 1' "$updater"
grep -F 'tar -xzf "$source_store" --strip-components=1 -C "$source_dir"' "$updater"
grep -F 'rm -rf "$source_dir/node_modules"' "$updater"
grep -F 'npm install --package-lock-only --ignore-scripts --omit=dev --omit=peer --legacy-peer-deps --prefix "$source_dir"' "$updater"
grep -F 'apply_manifest_transform "$entry" "$source_dir/package.json"' "$updater"
grep -F 'apply_lock_integrity_patches "$entry" "$source_dir/package-lock.json"' "$updater"
grep -F 'nix run nixpkgs#prefetch-npm-deps -- "$source_dir/package-lock.json"' "$updater"
grep -F 'npm_shared_update "$alias" "$entry"' "$updater"
! grep -F '"$package@$version" >/dev/null' "$updater"
grep -F 'git ls-remote --tags' "$updater"
grep -F 'nix store prefetch-file --json --unpack "$source_url"' "$updater"
grep -F 'hash=$(nix hash path "$tmp/hash-source")' "$updater"
grep -F 'nix run nixpkgs#prefetch-npm-deps -- "$source_dir/package-lock.json"' "$updater"
! grep -F 'replace_literal' "$updater"
jq -e 'all(.[]; .strategy == "npm" or .strategy == "github")' "$registry" >/dev/null
jq -e 'all(.[]; has("reason") | not)' "$registry" >/dev/null
jq -e 'all(.[]; (.notes? // []) | all(.[]; (.issue | type == "string") and (.resolveStrategy | type == "string")))' "$registry" >/dev/null
jq -e 'all(to_entries[]; .value | has("version") and has("check") and (if .strategy == "npm" then has("package") and (has("sharedPackage") or (has("src") and has("hash"))) else has("owner") and has("repo") and has("rev") and has("hash") end))' "$registry" >/dev/null
jq -e 'all(.[]; .manifestTransform? // {} | ((keys - ["delete", "dependencyOverrides", "overrides"]) | length == 0) and ((.delete? // []) | all(. == "devDependencies" or . == "peerDependencies" or . == "peerDependenciesMeta")) and ((.dependencyOverrides? // {}) | type == "object" and all(.[]; type == "string")) and ((.overrides? // {}) | type == "object" and all(.[]; type == "string")))' "$registry" >/dev/null
jq -e 'all(.[]; (.lockIntegrityPatches? // []) | type == "array" and all(.[]; (keys | sort) == ["integrity", "resolved"] and (.resolved | type == "string") and (.integrity | type == "string")))' "$registry" >/dev/null
jq -e '([.[] | select(.sharedPackage? == "pix-tools") | .npmDepsHash] | unique | length) == 1' "$registry" >/dev/null
jq -e '."pi-vcc".tagPrefix == "v" and ."pi-vcc".removePaths == ["demo.gif"]' "$registry" >/dev/null
! grep -F 'git push --force' "$updater"
! grep -F 'git reset --hard origin/main' "$updater"
grep -F 'alias_base=$(git rev-parse HEAD)' "$updater"
grep -F 'git reset --hard "$alias_base" && git checkout --detach "$alias_base"' "$updater"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/packages" "$tmp/fixture/package" "$tmp/vcc-source" "$tmp/github-prompt-source" "$tmp/github-mcp-source"
printf 'large demo\n' >"$tmp/vcc-source/demo.gif"
printf 'runtime\n' >"$tmp/vcc-source/index.ts"
cat >"$tmp/github-prompt-source/package.json" <<'EOF'
{"name":"github-prompt","version":"2.0.0","dependencies":{"github-dependency":"2.0.0"},"devDependencies":{"must-not-lock":"9.9.9"},"overrides":{"unrelated":"1.0.0"}}
EOF
cat >"$tmp/github-mcp-source/package.json" <<'EOF'
{"name":"github-mcp","version":"2.0.0","dependencies":{"upstream-dependency":"3.0.0"}}
EOF
cat >"$tmp/github-mcp-source/package-lock.json" <<'EOF'
{"name":"github-mcp","version":"2.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"github-mcp","version":"2.0.0","dependencies":{"upstream-dependency":"3.0.0"}},"node_modules/upstream-dependency":{"version":"3.0.0","resolved":"https://registry.invalid/upstream-dependency-3.0.0.tgz","integrity":"sha512-fixture"},"node_modules/pi-agent-core":{"version":"0.79.10","resolved":"https://registry.npmjs.org/@earendil-works/pi-agent-core/-/pi-agent-core-0.79.10.tgz"},"node_modules/pi-ai":{"version":"0.79.10","resolved":"https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-0.79.10.tgz"},"node_modules/pi-tui":{"version":"0.79.10","resolved":"https://registry.npmjs.org/@earendil-works/pi-tui/-/pi-tui-0.79.10.tgz"}}}
EOF
jq -e 'all(.packages["node_modules/pi-agent-core", "node_modules/pi-ai", "node_modules/pi-tui"]; has("integrity") | not)' "$tmp/github-mcp-source/package-lock.json" >/dev/null
cp "$updater" "$tmp/daily-update.sh"
cat >"$tmp/fixture/package/package.json" <<'EOF'
{
  "name": "@fixture/pi-rules",
  "version": "0.5.5",
  "dependencies": { "fixture-dependency": "1.2.3", "typebox": "^1.0.0" },
  "devDependencies": { "must-not-lock": "9.9.9" },
  "peerDependencies": { "pi": "*" },
  "peerDependenciesMeta": { "pi": { "optional": true } }
}
EOF
mkdir -p "$tmp/fixture/package/node_modules/bundled-fixture"
printf '%s\n' stale >"$tmp/fixture/package/node_modules/bundled-fixture/index.js"
tar -czf "$tmp/fixture.tgz" -C "$tmp/fixture" package
cat >"$tmp/pi-plugins.json" <<'EOF'
{
  "pi-rules":{"strategy":"npm","package":"@fixture/pi-rules","version":"0.5.4","src":"https://old.invalid/pi-rules-0.5.4.tgz","hash":"sha256-old-source","npmDepsHash":"sha256-old-deps","manifestTransform":{"delete":["devDependencies","peerDependencies"]},"lockFile":"packages/pi-rules-package-lock.json","check":"rules"},
  "pi-herdr-subagents":{"strategy":"npm","package":"@fixture/pi-rules","version":"0.5.4","src":"https://old.invalid/pi-rules-0.5.4.tgz","hash":"sha256-old-source","check":"herdr"},
  "remote-pi":{"strategy":"npm","package":"@fixture/pi-rules","version":"0.5.4","src":"https://old.invalid/pi-rules-0.5.4.tgz","hash":"sha256-old-source","npmDepsHash":"sha256-old-deps","lockFile":"packages/remote-pi-package-lock.json","check":"rules"},
  "rpiv-todo":{"strategy":"npm","package":"@fixture/pi-rules","version":"0.5.4","src":"https://old.invalid/pi-rules-0.5.4.tgz","hash":"sha256-old-source","npmDepsHash":"sha256-old-deps","manifestTransform":{"delete":["peerDependencies","peerDependenciesMeta"]},"lockFile":"packages/rpiv-todo-package-lock.json","check":"rules"},
  "pi-vcc":{"strategy":"github","owner":"fixture","repo":"pi-vcc","tagPrefix":"v","version":"0.4.0","rev":"old-vcc-rev","hash":"sha256-old-vcc","removePaths":["demo.gif"],"check":"pi-vcc"},
  "github-prompt":{"strategy":"github","owner":"fixture","repo":"github-prompt","track":"main","version":"unstable-old","rev":"old-prompt-rev","hash":"sha256-old-prompt","npmDepsHash":"sha256-old-prompt-deps","manifestTransform":{"delete":["devDependencies"],"overrides":{"brace-expansion":"5.0.8"}},"lockFile":"packages/github-prompt-package-lock.json","check":"github-prompt"},
  "github-mcp":{"strategy":"github","owner":"fixture","repo":"github-mcp","track":"main","version":"1.0.0","rev":"old-mcp-rev","hash":"sha256-old-mcp","npmDepsHash":"sha256-old-mcp-deps","lockIntegrityPatches":[{"resolved":"https://registry.npmjs.org/@earendil-works/pi-agent-core/-/pi-agent-core-0.79.10.tgz","integrity":"sha512-XKxgdjhcPuyjrthCOFSgfzT3xZ1uBrJ1IMVDxci1to6hIN6BIg9J5iY8q0pGXK1DLgATLP23da+1UyZLwA360Q=="},{"resolved":"https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-0.79.10.tgz","integrity":"sha512-9jR23tOl0BIUdQMn70Gr72xYBpM7Xgl9Lyv7gAnU1USfkNRuYG/f/edLl+n/Dp/RafDW3JI4DF7y/GhgkORuew=="},{"resolved":"https://registry.npmjs.org/@earendil-works/pi-tui/-/pi-tui-0.79.10.tgz","integrity":"sha512-FUVOjDn1DVwM1uHD5MNYboXQrXjIDbSt+BQ3py7nQWCY62tKfxgiM1OBMxTcwRWLfSdZHUPpV0hm1loIdUJnPw=="}],"check":"github-mcp"},
  "pix-data":{"strategy":"npm","package":"@fixture/pix-data","version":"0.4.1","sharedPackage":"pix-tools","npmDepsHash":"sha256-old-pix-deps","lockFile":"packages/pix-tools-package-lock.json","check":"pix-tools"},
  "pix-footer":{"strategy":"npm","package":"@fixture/pix-footer","version":"0.1.20","sharedPackage":"pix-tools","npmDepsHash":"sha256-old-pix-deps","lockFile":"packages/pix-tools-package-lock.json","check":"pix-tools"}
}
EOF
cat >"$tmp/packages/pi-rules.nix" <<'EOF'
version = "0.5.4";
url = "https://old.invalid/pi-rules-0.5.4.tgz";
hash = "sha256-old-source";
npmDepsHash = "sha256-old-deps";
EOF
cat >"$tmp/packages/pi-vcc.nix" <<'EOF'
version = "0.4.0";
rev = "old-vcc-rev";
hash = "sha256-old-vcc";
EOF
printf '%s\n' 'locks = import ./pi-plugin-lock.nix;' >"$tmp/packages/pix-tools.nix"
printf '#!%s\n' "$BASH" >"$tmp/bin/npm"
cat >>"$tmp/bin/npm" <<'EOF'
if [ "$1" = view ] && [ "$3" = version ]; then
  case "$2" in
    @fixture/pi-rules) printf '%s\n' '"0.5.5"' ;;
    @fixture/pix-data) printf '%s\n' '"0.4.2"' ;;
    @fixture/pix-footer) printf '%s\n' '"0.1.20"' ;;
  esac
  exit 0
fi
if [ "$1" = view ]; then printf '%s\n' '"https://new.invalid/pi-rules-0.5.5.tgz"'; exit 0; fi
prefix=
while [ "$#" -gt 0 ]; do
  if [ "$1" = --prefix ]; then prefix=$2; shift 2; continue; fi
  case "$1" in @fixture/pi-rules@*) exit 1 ;; esac
  shift
done
[ ! -e "$prefix/node_modules" ] || exit 3
node - "$prefix/package.json" "$prefix/package-lock.json" <<'EOF_NODE'
const fs = require("fs");
const [manifestPath, lockPath] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(manifestPath));
if (p.name === "github-prompt" && (p.devDependencies || p.overrides?.["brace-expansion"] !== "5.0.8" || p.overrides.unrelated !== "1.0.0")) process.exit(1);
const deps = p.dependencies;
const root = { name: p.name, version: p.version, dependencies: deps };
for (const key of ["devDependencies", "peerDependencies", "peerDependenciesMeta"]) if (p[key]) root[key] = p[key];
const packages = { "": root };
for (const [name, version] of Object.entries(deps)) packages[`node_modules/${name}`] = { version, resolved: `https://registry.invalid/${name}-${version}.tgz`, integrity: "sha512-fixture" };
if (p.overrides?.["brace-expansion"]) packages["node_modules/brace-expansion"] = { version: p.overrides["brace-expansion"], resolved: `https://registry.invalid/brace-expansion-${p.overrides["brace-expansion"]}.tgz`, integrity: "sha512-fixture" };
fs.writeFileSync(lockPath, JSON.stringify({ name: p.name, version: p.version, lockfileVersion: 3, requires: true, packages }, null, 2) + "\n");
EOF_NODE
EOF
printf '#!%s\n' "$BASH" >"$tmp/bin/nix"
cat >>"$tmp/bin/nix" <<'EOF'
[ -z "${NIX_EVENTS:-}" ] || printf '%s\n' "$*" >>"$NIX_EVENTS"
if [ -n "${FAILED_FETCH_MARKER:-}" ] && [ -e "$FAILED_FETCH_MARKER" ]; then
  printf '%s\n' CHECK_AFTER_FAILED_FETCH >>"$NIX_EVENTS"
  exit 97
fi
case "$*" in
  'store prefetch-file --json --unpack https://github.com/fixture/pi-vcc/archive/new-vcc-rev.tar.gz') printf '{"hash":"sha256-raw-vcc","storePath":"%s"}\n' "$FIXTURE_VCC_SOURCE" ;;
  'store prefetch-file --json --unpack https://github.com/fixture/github-prompt/archive/new-prompt-rev.tar.gz') printf '{"hash":"sha256-new-prompt","storePath":"%s"}\n' "$FIXTURE_GITHUB_PROMPT_SOURCE" ;;
  'store prefetch-file --json --unpack https://github.com/fixture/github-mcp/archive/new-mcp-rev.tar.gz') printf '{"hash":"sha256-new-mcp","storePath":"%s"}\n' "$FIXTURE_GITHUB_MCP_SOURCE" ;;
  'store prefetch-file --json '*) [ "${PREFETCH_FAIL:-}" != 1 ] || exit 1; printf '{"hash":"sha256-new-source","storePath":"%s"}\n' "$FIXTURE_TARBALL" ;;
  'run nixpkgs#prefetch-npm-deps -- '*)
    [ "${PREFETCH_FAIL:-}" != 1 ] || exit 1
    lock=${!#}
    jq -e 'if .packages[""].name == "pix-tools" then .packages[""].dependencies == {"@fixture/pix-data":"0.4.2","@fixture/pix-footer":"0.1.20"} elif .packages[""].name == "@fixture/pi-rules" then .packages[""].dependencies["fixture-dependency"] == "1.2.3" and .packages["node_modules/fixture-dependency"].version == "1.2.3" elif .packages[""].name == "github-prompt" then .packages[""].dependencies == {"github-dependency":"2.0.0"} and (.packages[""] | has("devDependencies") | not) and .packages["node_modules/brace-expansion"].version == "5.0.8" else .packages[""].name == "github-mcp" and .packages[""].dependencies == {"upstream-dependency":"3.0.0"} and .packages["node_modules/pi-agent-core"].integrity == "sha512-XKxgdjhcPuyjrthCOFSgfzT3xZ1uBrJ1IMVDxci1to6hIN6BIg9J5iY8q0pGXK1DLgATLP23da+1UyZLwA360Q==" and .packages["node_modules/pi-ai"].integrity == "sha512-9jR23tOl0BIUdQMn70Gr72xYBpM7Xgl9Lyv7gAnU1USfkNRuYG/f/edLl+n/Dp/RafDW3JI4DF7y/GhgkORuew==" and .packages["node_modules/pi-tui"].integrity == "sha512-FUVOjDn1DVwM1uHD5MNYboXQrXjIDbSt+BQ3py7nQWCY62tKfxgiM1OBMxTcwRWLfSdZHUPpV0hm1loIdUJnPw==" end' "$lock" >/dev/null
    if jq -e '.packages[""].name == "github-mcp"' "$lock" >/dev/null; then cp "$lock" "$MCP_PATCHED_LOCK"; fi
    printf 'sha256-%s\n' "$(sha256sum "$lock" | cut -d' ' -f1)"
    ;;
  'hash path '*)
    source_path=${!#}
    [ ! -e "$source_path/demo.gif" ] && [ -f "$source_path/index.ts" ]
    printf '%s\n' 'sha256-new-vcc'
    ;;
  'build .#checks.x86_64-linux.rules'|'build .#checks.x86_64-linux.herdr'|'build .#checks.x86_64-linux.pi-vcc'|'build .#checks.x86_64-linux.pix-tools'|'build .#checks.x86_64-linux.github-prompt'|'build .#checks.x86_64-linux.github-mcp')
    check=${2##*.}
    [ "${CHECK_FAIL:-}" != "$check" ] || exit 1
    if [ "${POST_COMMIT_FAIL:-}" = "$check" ]; then
      count=$(cat "$NIX_CHECK_STATE" 2>/dev/null || printf 0)
      count=$((count + 1))
      printf '%s\n' "$count" >"$NIX_CHECK_STATE"
      [ "$count" -ne 2 ] || exit 1
    fi
    ;;
  'build .#checks.x86_64-linux.formatting'|'flake check') ;;
  'flake update nixpkgs-unstable home-manager')
    jq '.nodes["nixpkgs-unstable"].locked.rev = "new-nix" | .nodes["home-manager"].locked.rev = "new-home"' flake.lock >flake.lock.new
    mv flake.lock.new flake.lock
    ;;
  *) exit 1 ;;
esac
EOF
printf '#!%s\n' "$BASH" >"$tmp/bin/git"
cat >>"$tmp/bin/git" <<'EOF'
[ -z "${GIT_EVENTS:-}" ] || printf '%s\n' "$*" >>"$GIT_EVENTS"
if [ "$1" = fetch ]; then
  [ "${FAIL_FETCH:-}" != 1 ] || exit 1
  if [ -n "${FAIL_FETCH_AFTER:-}" ]; then
    fetch_count_file=${FETCH_COUNT_FILE:-"$GIT_EVENTS.fetch-count"}
    fetch_count=$(cat "$fetch_count_file" 2>/dev/null || printf 0)
    fetch_count=$((fetch_count + 1))
    printf '%s\n' "$fetch_count" >"$fetch_count_file"
    if [ "$fetch_count" -gt "$FAIL_FETCH_AFTER" ]; then
      [ -z "${FAILED_FETCH_MARKER:-}" ] || : >"$FAILED_FETCH_MARKER"
      exit 1
    fi
  fi
  exit 0
fi
restore_commit() {
  commit=$1
  cp "$GIT_STATE/commits/$commit/pi-plugins.json" pi-plugins.json
  find packages -name '*-package-lock.json' -type f -delete
  cp "$GIT_STATE/commits/$commit/packages/"* packages/ 2>/dev/null || true
  printf '%s\n' "$commit" >"$GIT_STATE/HEAD"
}
save_commit() {
  commit=$1
  mkdir -p "$GIT_STATE/commits/$commit/packages"
  cp pi-plugins.json "$GIT_STATE/commits/$commit/pi-plugins.json"
  find packages -name '*-package-lock.json' -type f -exec cp {} "$GIT_STATE/commits/$commit/packages/" \;
}
if [ "$1" = checkout ] && [ "$2" = --detach ]; then
  mkdir -p "$GIT_STATE/commits"
  if [ "$3" = origin/main ]; then
    if [ ! -e "$GIT_STATE/HEAD" ]; then
      cp "$GIT_BASELINE/pi-plugins.json" pi-plugins.json
      find packages -name '*-package-lock.json' -type f -delete
      cp "$GIT_BASELINE/packages/"* packages/ 2>/dev/null || true
      save_commit base
      : >"$GIT_STATE/commits/base/history"
    fi
    restore_commit base
  else
    restore_commit "$3"
  fi
  exit 0
fi
if [ "$1" = rev-parse ] && [ "$2" = HEAD ]; then cat "$GIT_STATE/HEAD"; exit 0; fi
if [ "$1" = restore ]; then
  commit=$(cat "$GIT_STATE/HEAD")
  shift
  while [ "$1" != -- ]; do shift; done
  shift
  for file; do
    if [ -e "$GIT_STATE/commits/$commit/$file" ]; then cp "$GIT_STATE/commits/$commit/$file" "$file"; else rm -f "$file"; fi
  done
  exit 0
fi
if [ "$1" = reset ] && [ "$2" = --hard ]; then
  [ -z "${FAILED_FETCH_MARKER:-}" ] || rm -f "$FAILED_FETCH_MARKER"
  restore_commit "$3"
  exit 0
fi
if [ "$1" = commit ] && [ -e pi-plugins.json ]; then
  parent=$(cat "$GIT_STATE/HEAD")
  count=$(cat "$GIT_STATE/count" 2>/dev/null || printf 0)
  commit="commit-$((count + 1))"
  printf '%s\n' "$((count + 1))" >"$GIT_STATE/count"
  save_commit "$commit"
  cp "$GIT_STATE/commits/$parent/history" "$GIT_STATE/commits/$commit/history"
  printf '%s\n' "$*" >>"$GIT_STATE/commits/$commit/history"
  printf '%s\n' "$commit" >"$GIT_STATE/HEAD"
  exit 0
fi
if [ "$1" = ls-remote ] && [ "$2" != --tags ]; then
  case "$2" in
    https://github.com/fixture/github-prompt.git) printf '%s\t%s\n' new-prompt-rev refs/heads/main ;;
    https://github.com/fixture/github-mcp.git) printf '%s\t%s\n' new-mcp-rev refs/heads/main ;;
    *) exit 1 ;;
  esac
  exit 0
fi
if [ "$1" = ls-remote ] && [ "$2" = --tags ]; then
  [ "${PREFETCH_FAIL:-}" != 1 ] || exit 1
  printf '%s\n' \
    $'old-vcc-rev\trefs/tags/v0.4.0' \
    $'tag-object\trefs/tags/v0.5.0' \
    $'new-vcc-rev\trefs/tags/v0.5.0^{}'
  exit 0
fi
[ "$1" = diff ] && [ "${INPUT_CHANGED:-}" = 1 ] && exit 1
if [ "$1" = push ] && [ -e pi-plugins.json ]; then
  [ "${FAIL_PUSH:-}" != 1 ] || exit 1
  commit=$(cat "$GIT_STATE/HEAD")
  cp "$GIT_STATE/commits/$commit/history" "$GIT_STATE/push-history"
  cp pi-plugins.json "$GIT_STATE/pushed-pi-plugins.json"
  exit 0
fi
[ "$1" = push ] && [ "${FAIL_PUSH:-}" = 1 ] && exit 1
exit 0
EOF
chmod +x "$tmp/bin"/*
export FIXTURE_GITHUB_PROMPT_SOURCE="$tmp/github-prompt-source" FIXTURE_GITHUB_MCP_SOURCE="$tmp/github-mcp-source" MCP_PATCHED_LOCK="$tmp/github-mcp-patched-lock.json"

before=$(cat "$tmp/pi-plugins.json" "$tmp/packages/pi-rules.nix" "$tmp/packages/pi-vcc.nix")
packages_before=$(cat "$tmp/packages/pi-rules.nix" "$tmp/packages/pi-vcc.nix")
mkdir -p "$tmp/baseline/packages"
cp "$tmp/pi-plugins.json" "$tmp/baseline/pi-plugins.json"
cp "$tmp/packages/"* "$tmp/baseline/packages/"
if (
  cd "$tmp"
  PATH="$tmp/bin:$PATH" GIT_BASELINE="$tmp/baseline" GIT_STATE="$tmp/git-prefetch-fail" FIXTURE_TARBALL="$tmp/fixture.tgz" FIXTURE_VCC_SOURCE="$tmp/vcc-source" PREFETCH_FAIL=1 GITHUB_STEP_SUMMARY="$tmp/summary" bash ./daily-update.sh plugins
); then
  exit 1
fi
[ "$before" = "$(cat "$tmp/pi-plugins.json" "$tmp/packages/pi-rules.nix" "$tmp/packages/pi-vcc.nix")" ]
[ ! -e "$tmp/packages/pi-rules-package-lock.json" ]

if (
  cd "$tmp"
  PATH="$tmp/bin:$PATH" GIT_BASELINE="$tmp/baseline" GIT_STATE="$tmp/git-github-check-fail" FIXTURE_TARBALL="$tmp/fixture.tgz" FIXTURE_VCC_SOURCE="$tmp/vcc-source" CHECK_FAIL=github-prompt GITHUB_STEP_SUMMARY="$tmp/summary" bash ./daily-update.sh plugins
); then
  exit 1
fi
jq -e '."github-prompt".rev == "old-prompt-rev" and ."github-prompt".npmDepsHash == "sha256-old-prompt-deps" and ."github-mcp".rev == "new-mcp-rev"' "$tmp/pi-plugins.json" >/dev/null
[ ! -e "$tmp/packages/github-prompt-package-lock.json" ]

if (
  cd "$tmp"
  PATH="$tmp/bin:$PATH" GIT_BASELINE="$tmp/baseline" GIT_STATE="$tmp/git-check-fail" FIXTURE_TARBALL="$tmp/fixture.tgz" FIXTURE_VCC_SOURCE="$tmp/vcc-source" CHECK_FAIL=rules GITHUB_STEP_SUMMARY="$tmp/summary" bash ./daily-update.sh plugins
); then
  exit 1
fi
jq -e '."pi-rules".version == "0.5.4" and ."pi-rules".src == "https://old.invalid/pi-rules-0.5.4.tgz" and ."pi-rules".hash == "sha256-old-source" and ."pi-rules".npmDepsHash == "sha256-old-deps"' "$tmp/pi-plugins.json" >/dev/null
[ ! -e "$tmp/packages/pi-rules-package-lock.json" ]
after_failed_checks=$(cat "$tmp/packages/pi-rules.nix" "$tmp/packages/pi-vcc.nix")
[ "$packages_before" = "$after_failed_checks" ]
cp "$tmp/baseline/pi-plugins.json" "$tmp/pi-plugins.json"
rm -f "$tmp/packages/"*-package-lock.json
if (
  cd "$tmp"
  PATH="$tmp/bin:$PATH" GIT_BASELINE="$tmp/baseline" GIT_STATE="$tmp/git-post-commit" NIX_CHECK_STATE="$tmp/post-commit-check-count" FIXTURE_TARBALL="$tmp/fixture.tgz" FIXTURE_VCC_SOURCE="$tmp/vcc-source" POST_COMMIT_FAIL=rules GITHUB_STEP_SUMMARY="$tmp/post-commit-summary" bash ./daily-update.sh plugins
); then
  exit 1
fi
grep -F 'update pi-rules to 0.5.5' "$tmp/git-post-commit/commits/"*/history
! grep -F 'update pi-rules to 0.5.5' "$tmp/git-post-commit/push-history"
grep -F 'update pi-herdr-subagents to 0.5.5' "$tmp/git-post-commit/push-history"
jq -e '."pi-rules".version == "0.5.4" and ."pi-herdr-subagents".version == "0.5.5"' "$tmp/git-post-commit/pushed-pi-plugins.json" >/dev/null
head=$(cat "$tmp/git-post-commit/HEAD")
[ ! -e "$tmp/git-post-commit/commits/$head/packages/pi-rules-package-lock.json" ]
[ ! -e "$tmp/git-post-commit/commits/$head/packages/pi-herdr-subagents-package-lock.json" ]

cp "$tmp/baseline/pi-plugins.json" "$tmp/pi-plugins.json"
rm -f "$tmp/packages/"*-package-lock.json
(
  cd "$tmp"
  PATH="$tmp/bin:$PATH" GIT_BASELINE="$tmp/baseline" GIT_STATE="$tmp/git-success" FIXTURE_TARBALL="$tmp/fixture.tgz" FIXTURE_VCC_SOURCE="$tmp/vcc-source" GITHUB_STEP_SUMMARY="$tmp/summary" bash ./daily-update.sh plugins
)
fixture_hash="sha256-$(sha256sum "$tmp/packages/pi-rules-package-lock.json" | cut -d' ' -f1)"
jq -e '.packages[""].dependencies.typebox == "^1.0.0" and (.packages[""] | has("devDependencies") or has("peerDependencies") | not) and .packages[""].peerDependenciesMeta.pi.optional' "$tmp/packages/pi-rules-package-lock.json" >/dev/null
jq -e '.packages[""].dependencies.typebox == "^1.0.0" and .packages[""].devDependencies["must-not-lock"] == "9.9.9" and .packages[""].peerDependencies.pi == "*" and .packages[""].peerDependenciesMeta.pi.optional' "$tmp/packages/remote-pi-package-lock.json" >/dev/null
jq -e '.packages[""].dependencies.typebox == "^1.0.0" and .packages[""].devDependencies["must-not-lock"] == "9.9.9" and (.packages[""] | has("peerDependencies") or has("peerDependenciesMeta") | not)' "$tmp/packages/rpiv-todo-package-lock.json" >/dev/null
[ "$packages_before" = "$(cat "$tmp/packages/pi-rules.nix" "$tmp/packages/pi-vcc.nix")" ]
jq -e --arg hash "$fixture_hash" '."pi-rules".npmDepsHash == $hash and ."pi-rules".version == "0.5.5" and ."pi-rules".src == "https://new.invalid/pi-rules-0.5.5.tgz" and ."pi-rules".hash == "sha256-new-source"' "$tmp/pi-plugins.json" >/dev/null
jq -e '."pi-vcc".version == "0.5.0" and ."pi-vcc".rev == "new-vcc-rev" and ."pi-vcc".hash == "sha256-new-vcc"' "$tmp/pi-plugins.json" >/dev/null
github_prompt_hash="sha256-$(sha256sum "$tmp/packages/github-prompt-package-lock.json" | cut -d' ' -f1)"
github_mcp_hash="sha256-$(sha256sum "$tmp/github-mcp-patched-lock.json" | cut -d' ' -f1)"
jq -e '.packages[""].dependencies == {"github-dependency":"2.0.0"} and (.packages[""] | has("devDependencies") | not) and .packages["node_modules/brace-expansion"].version == "5.0.8"' "$tmp/packages/github-prompt-package-lock.json" >/dev/null
jq -e '.packages["node_modules/pi-agent-core"].integrity == "sha512-XKxgdjhcPuyjrthCOFSgfzT3xZ1uBrJ1IMVDxci1to6hIN6BIg9J5iY8q0pGXK1DLgATLP23da+1UyZLwA360Q==" and .packages["node_modules/pi-ai"].integrity == "sha512-9jR23tOl0BIUdQMn70Gr72xYBpM7Xgl9Lyv7gAnU1USfkNRuYG/f/edLl+n/Dp/RafDW3JI4DF7y/GhgkORuew==" and .packages["node_modules/pi-tui"].integrity == "sha512-FUVOjDn1DVwM1uHD5MNYboXQrXjIDbSt+BQ3py7nQWCY62tKfxgiM1OBMxTcwRWLfSdZHUPpV0hm1loIdUJnPw=="' "$tmp/github-mcp-patched-lock.json" >/dev/null
jq -e --arg prompt_hash "$github_prompt_hash" --arg mcp_hash "$github_mcp_hash" '."github-prompt".rev == "new-prompt-rev" and ."github-prompt".npmDepsHash == $prompt_hash and ."github-mcp".rev == "new-mcp-rev" and ."github-mcp".npmDepsHash == $mcp_hash' "$tmp/pi-plugins.json" >/dev/null
pix_hash="sha256-$(sha256sum "$tmp/packages/pix-tools-package-lock.json" | cut -d' ' -f1)"
jq -e --arg hash "$pix_hash" '."pix-data".version == "0.4.2" and ."pix-data".npmDepsHash == $hash and ."pix-footer".npmDepsHash == $hash' "$tmp/pi-plugins.json" >/dev/null

cp "$tmp/baseline/pi-plugins.json" "$tmp/pi-plugins.json"
rm -f "$tmp/packages/"*-package-lock.json
if (
  cd "$tmp"
  PATH="$tmp/bin:$PATH" GIT_BASELINE="$tmp/baseline" GIT_STATE="$tmp/git-plugin-fetch-fail" FIXTURE_TARBALL="$tmp/fixture.tgz" FIXTURE_VCC_SOURCE="$tmp/vcc-source" FAIL_FETCH_AFTER=1 FAILED_FETCH_MARKER="$tmp/plugin-fetch-failed" GIT_EVENTS="$tmp/plugin-fetch-git-events" NIX_EVENTS="$tmp/plugin-fetch-nix-events" GITHUB_STEP_SUMMARY="$tmp/plugin-fetch-summary" bash ./daily-update.sh plugins
); then
  exit 1
fi
[ "$(grep -Fc 'fetch origin main --quiet' "$tmp/plugin-fetch-git-events")" -gt 1 ]
! grep -Eq '^(rebase|push) ' "$tmp/plugin-fetch-git-events"
! grep -F CHECK_AFTER_FAILED_FETCH "$tmp/plugin-fetch-nix-events"
grep -F -- '- failure: fetch origin/main failed' "$tmp/plugin-fetch-summary"

mkdir "$tmp/inputs"
cp "$updater" "$tmp/inputs/daily-update.sh"
cat >"$tmp/inputs/flake.lock" <<'EOF'
{"nodes":{"nixpkgs-unstable":{"locked":{"rev":"old-nix"}},"home-manager":{"locked":{"rev":"old-home"}}}}
EOF
if (
  cd "$tmp/inputs"
  PATH="$tmp/bin:$PATH" GIT_BASELINE="$tmp/baseline" INPUT_CHANGED=1 FAIL_PUSH=1 GITHUB_STEP_SUMMARY="$tmp/input-summary" bash ./daily-update.sh inputs
); then
  exit 1
fi
grep -F -- '- failure: concurrent update retry exhausted' "$tmp/input-summary"
! grep -F -- '- inputs: old-nix → new-nix; old-home → new-home' "$tmp/input-summary"

mkdir "$tmp/inputs-fetch"
cp "$updater" "$tmp/inputs-fetch/daily-update.sh"
cat >"$tmp/inputs-fetch/flake.lock" <<'EOF'
{"nodes":{"nixpkgs-unstable":{"locked":{"rev":"old-nix"}},"home-manager":{"locked":{"rev":"old-home"}}}}
EOF
if (
  cd "$tmp/inputs-fetch"
  PATH="$tmp/bin:$PATH" GIT_BASELINE="$tmp/baseline" INPUT_CHANGED=1 FAIL_FETCH=1 GIT_EVENTS="$tmp/input-fetch-git-events" NIX_EVENTS="$tmp/input-fetch-nix-events" GITHUB_STEP_SUMMARY="$tmp/input-fetch-summary" bash ./daily-update.sh inputs
); then
  exit 1
fi
grep -Fx 'fetch origin main --quiet' "$tmp/input-fetch-git-events"
! grep -Eq '^(rebase|push) ' "$tmp/input-fetch-git-events"
[ "$(grep -Fc 'build .#checks.x86_64-linux.formatting' "$tmp/input-fetch-nix-events")" -eq 1 ]
[ "$(grep -Fc 'flake check' "$tmp/input-fetch-nix-events")" -eq 1 ]
grep -F -- '- failure: fetch origin/main failed' "$tmp/input-fetch-summary"
