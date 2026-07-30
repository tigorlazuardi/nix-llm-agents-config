#!/usr/bin/env bash
set -euo pipefail

workflow=${WORKFLOW:-.github/workflows/daily-update.yml}
updater=${UPDATER:-scripts/daily-update.sh}
registry=${REGISTRY:-pi-plugins.json}

test -x "$updater"
grep -F 'cron: "0 3 * * *"' "$workflow"
grep -Fx '  workflow_dispatch:' "$workflow"
grep -F 'contents: write' "$workflow"
test "$(grep -Fc 'git config user.name "github-actions[bot]"' "$workflow")" -eq 2
grep -F 'if: always()' "$workflow"
grep -F 'ref: main' "$workflow"
grep -F "chore(deps): update nixpkgs and home-manager" "$updater"
grep -F 'chore(pi-plugins): update $alias to $version' "$updater"
grep -F 'git rebase origin/main' "$updater"
grep -F 'git push origin HEAD:main' "$updater"
grep -F 'nix flake check' "$updater"
grep -F 'git commit -m '\''chore(deps): update nixpkgs and home-manager'\'' || return 1' "$updater"
grep -F 'push_inputs_checked || return 1' "$updater"
grep -F 'tar -xzf "$source_store" --strip-components=1 -C "$source_dir"' "$updater"
grep -F 'npm install --package-lock-only --ignore-scripts --omit=dev --omit=peer --prefix "$source_dir"' "$updater"
grep -F 'nix run nixpkgs#prefetch-npm-deps -- "$source_dir/package-lock.json"' "$updater"
! grep -F '"$package@$version" >/dev/null' "$updater"
grep -F 'git ls-remote --tags' "$updater"
grep -F '"strategy":"npm"' "$registry"
grep -F '"strategy":"github"' "$registry"
grep -F '"tagPrefix":"v"' "$registry"
grep -F '"strategy":"unsupported"' "$registry"
! grep -F 'git push --force' "$updater"
! grep -F 'git reset --hard origin/main' "$updater"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/packages" "$tmp/fixture/package"
cp "$updater" "$tmp/daily-update.sh"
cat >"$tmp/fixture/package/package.json" <<'EOF'
{
  "name": "@fixture/pi-rules",
  "version": "0.5.5",
  "dependencies": { "fixture-dependency": "1.2.3" },
  "devDependencies": { "must-not-lock": "9.9.9" },
  "peerDependencies": { "pi": "*" }
}
EOF
tar -czf "$tmp/fixture.tgz" -C "$tmp/fixture" package
cat >"$tmp/pi-plugins.json" <<'EOF'
{"pi-rules":{"strategy":"npm","package":"@fixture/pi-rules","version":"0.5.4","src":"https://old.invalid/pi-rules-0.5.4.tgz","hash":"sha256-old-source","npmDepsHash":"sha256-old-deps","packageFile":"packages/pi-rules.nix","lockFile":"packages/pi-rules-package-lock.json","check":"rules"},"pi-vcc":{"strategy":"github","owner":"fixture","repo":"pi-vcc","tagPrefix":"v","version":"0.4.0","rev":"old-vcc-rev","hash":"sha256-old-vcc","packageFile":"packages/pi-vcc.nix","check":"pi-vcc"}}
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
printf '#!%s\n' "$BASH" >"$tmp/bin/npm"
cat >>"$tmp/bin/npm" <<'EOF'
if [ "$1" = view ] && [ "$3" = version ]; then printf '%s\n' '"0.5.5"'; exit 0; fi
if [ "$1" = view ]; then printf '%s\n' '"https://new.invalid/pi-rules-0.5.5.tgz"'; exit 0; fi
prefix=
while [ "$#" -gt 0 ]; do
  if [ "$1" = --prefix ]; then prefix=$2; shift 2; continue; fi
  case "$1" in @fixture/pi-rules@*) exit 1 ;; esac
  shift
done
node - "$prefix/package.json" "$prefix/package-lock.json" <<'EOF_NODE'
const fs = require("fs");
const [manifestPath, lockPath] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(manifestPath));
if (p.devDependencies || p.peerDependencies) process.exit(1);
const deps = p.dependencies;
fs.writeFileSync(lockPath, JSON.stringify({ name: p.name, version: p.version, lockfileVersion: 3, requires: true, packages: { "": { name: p.name, version: p.version, dependencies: deps }, "node_modules/fixture-dependency": { version: deps["fixture-dependency"], resolved: "https://registry.invalid/fixture-dependency-1.2.3.tgz", integrity: "sha512-fixture" } } }, null, 2) + "\n");
EOF_NODE
EOF
printf '#!%s\n' "$BASH" >"$tmp/bin/nix"
cat >>"$tmp/bin/nix" <<'EOF'
case "$*" in
  'store prefetch-file --json '*) printf '{"hash":"sha256-new-source","storePath":"%s"}\n' "$FIXTURE_TARBALL" ;;
  'run nixpkgs#prefetch-npm-deps -- '*)
    [ "${PREFETCH_FAIL:-}" != 1 ] || exit 1
    lock=${!#}
    jq -e '.packages[""].name == "@fixture/pi-rules" and .packages[""].dependencies == {"fixture-dependency":"1.2.3"} and .packages["node_modules/fixture-dependency"].version == "1.2.3"' "$lock" >/dev/null
    printf 'sha256-%s\n' "$(sha256sum "$lock" | cut -d' ' -f1)"
    ;;
  'flake prefetch --json github:fixture/pi-vcc/new-vcc-rev') printf '%s\n' '{"hash":"sha256-new-vcc"}' ;;
  'build .#checks.x86_64-linux.rules'|'build .#checks.x86_64-linux.pi-vcc'|'build .#checks.x86_64-linux.formatting'|'flake check') ;;
  'flake update nixpkgs-unstable home-manager')
    jq '.nodes["nixpkgs-unstable"].locked.rev = "new-nix" | .nodes["home-manager"].locked.rev = "new-home"' flake.lock >flake.lock.new
    mv flake.lock.new flake.lock
    ;;
  *) exit 1 ;;
esac
EOF
printf '#!%s\n' "$BASH" >"$tmp/bin/git"
cat >>"$tmp/bin/git" <<'EOF'
if [ "$1" = ls-remote ] && [ "$2" = --tags ]; then
  [ "${PREFETCH_FAIL:-}" != 1 ] || exit 1
  printf '%s\n' \
    $'old-vcc-rev\trefs/tags/v0.4.0' \
    $'tag-object\trefs/tags/v0.5.0' \
    $'new-vcc-rev\trefs/tags/v0.5.0^{}'
  exit 0
fi
[ "$1" = diff ] && [ "${INPUT_CHANGED:-}" = 1 ] && exit 1
[ "$1" = push ] && [ "${FAIL_PUSH:-}" = 1 ] && exit 1
exit 0
EOF
chmod +x "$tmp/bin"/*

before=$(cat "$tmp/pi-plugins.json" "$tmp/packages/pi-rules.nix" "$tmp/packages/pi-vcc.nix")
if (
  cd "$tmp"
  PATH="$tmp/bin:$PATH" FIXTURE_TARBALL="$tmp/fixture.tgz" PREFETCH_FAIL=1 GITHUB_STEP_SUMMARY="$tmp/summary" bash ./daily-update.sh plugins
); then
  exit 1
fi
[ "$before" = "$(cat "$tmp/pi-plugins.json" "$tmp/packages/pi-rules.nix" "$tmp/packages/pi-vcc.nix")" ]
[ ! -e "$tmp/packages/pi-rules-package-lock.json" ]

(
  cd "$tmp"
  PATH="$tmp/bin:$PATH" FIXTURE_TARBALL="$tmp/fixture.tgz" GITHUB_STEP_SUMMARY="$tmp/summary" bash ./daily-update.sh plugins
)
fixture_hash="sha256-$(sha256sum "$tmp/packages/pi-rules-package-lock.json" | cut -d' ' -f1)"
jq -e '.packages[""].name == "@fixture/pi-rules" and .packages[""].dependencies == {"fixture-dependency":"1.2.3"} and has("node_modules/must-not-lock") | not' "$tmp/packages/pi-rules-package-lock.json" >/dev/null
grep -F 'npmDepsHash = "'"$fixture_hash"'";' "$tmp/packages/pi-rules.nix"
jq -e --arg hash "$fixture_hash" '."pi-rules".npmDepsHash == $hash and ."pi-rules".src == "https://new.invalid/pi-rules-0.5.5.tgz" and ."pi-rules".hash == "sha256-new-source"' "$tmp/pi-plugins.json" >/dev/null
grep -F 'version = "0.5.0";' "$tmp/packages/pi-vcc.nix"
grep -F 'rev = "new-vcc-rev";' "$tmp/packages/pi-vcc.nix"
grep -F 'hash = "sha256-new-vcc";' "$tmp/packages/pi-vcc.nix"
jq -e '."pi-vcc".version == "0.5.0" and ."pi-vcc".rev == "new-vcc-rev" and ."pi-vcc".hash == "sha256-new-vcc"' "$tmp/pi-plugins.json" >/dev/null

mkdir "$tmp/inputs"
cp "$updater" "$tmp/inputs/daily-update.sh"
cat >"$tmp/inputs/flake.lock" <<'EOF'
{"nodes":{"nixpkgs-unstable":{"locked":{"rev":"old-nix"}},"home-manager":{"locked":{"rev":"old-home"}}}}
EOF
if (
  cd "$tmp/inputs"
  PATH="$tmp/bin:$PATH" INPUT_CHANGED=1 FAIL_PUSH=1 GITHUB_STEP_SUMMARY="$tmp/input-summary" bash ./daily-update.sh inputs
); then
  exit 1
fi
grep -F -- '- failure: concurrent update retry exhausted' "$tmp/input-summary"
! grep -F -- '- inputs: old-nix → new-nix; old-home → new-home' "$tmp/input-summary"
