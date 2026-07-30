#!/usr/bin/env bash
set -euo pipefail

workflow=${WORKFLOW:-.github/workflows/daily-update.yml}
updater=${UPDATER:-scripts/daily-update.sh}
registry=${REGISTRY:-pi-plugins.json}

grep -F 'cron: "0 3 * * *"' "$workflow"
grep -Fx '  workflow_dispatch:' "$workflow"
grep -F 'contents: write' "$workflow"
grep -F 'if: always()' "$workflow"
grep -F 'ref: main' "$workflow"
grep -F "chore(deps): update nixpkgs and home-manager" "$updater"
grep -F 'chore(pi-plugins): update $alias to $version' "$updater"
grep -F 'git rebase origin/main' "$updater"
grep -F 'git push origin HEAD:main' "$updater"
grep -F 'nix flake check' "$updater"
grep -F 'npm install --package-lock-only --ignore-scripts' "$updater"
grep -F 'nix run nixpkgs#prefetch-npm-deps -- "$lock"' "$updater"
grep -F 'replace_literal "$file" "$old_npm_deps_hash" "$npm_deps_hash"' "$updater"
grep -F 'git ls-remote --tags' "$updater"
grep -F '"strategy":"npm"' "$registry"
grep -F '"strategy":"github"' "$registry"
grep -F '"strategy":"unsupported"' "$registry"
! grep -F 'git push --force' "$updater"
! grep -F 'git reset --hard origin/main' "$updater"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/packages"
cp "$updater" "$tmp/daily-update.sh"
cat >"$tmp/pi-plugins.json" <<'EOF'
{"pi-rules":{"strategy":"npm","package":"pi-rules","version":"0.5.4","src":"https://old.invalid/pi-rules-0.5.4.tgz","hash":"sha256-old-source","npmDepsHash":"sha256-old-deps","packageFile":"packages/pi-rules.nix","lockFile":"packages/pi-rules-package-lock.json","check":"rules"}}
EOF
cat >"$tmp/packages/pi-rules.nix" <<'EOF'
version = "0.5.4";
url = "https://old.invalid/pi-rules-0.5.4.tgz";
hash = "sha256-old-source";
npmDepsHash = "sha256-old-deps";
EOF
printf '#!%s\n' "$BASH" >"$tmp/bin/npm"
cat >>"$tmp/bin/npm" <<'EOF'
if [ "$1" = view ] && [ "$3" = version ]; then printf '%s\n' '"0.5.5"'; exit 0; fi
if [ "$1" = view ]; then printf '%s\n' '"https://new.invalid/pi-rules-0.5.5.tgz"'; exit 0; fi
while [ "$1" != --prefix ]; do shift; done
printf '%s\n' '{"lockfileVersion":3,"packages":{}}' >"$2/package-lock.json"
EOF
printf '#!%s\n' "$BASH" >"$tmp/bin/nix"
cat >>"$tmp/bin/nix" <<'EOF'
case "$*" in
  'store prefetch-file --json '*) printf '%s\n' '{"hash":"sha256-new-source"}' ;;
  'run nixpkgs#prefetch-npm-deps -- '*) printf '%s\n' 'sha256-new-deps' ;;
  'build .#checks.x86_64-linux.rules') ;;
  *) exit 1 ;;
esac
EOF
printf '#!%s\n' "$BASH" >"$tmp/bin/git"
cat >>"$tmp/bin/git" <<'EOF'
exit 0
EOF
chmod +x "$tmp/bin"/*
(
  cd "$tmp"
  PATH="$tmp/bin:$PATH" GITHUB_STEP_SUMMARY="$tmp/summary" bash ./daily-update.sh plugins
)
grep -F 'npmDepsHash = "sha256-new-deps";' "$tmp/packages/pi-rules.nix"
jq -e '."pi-rules".npmDepsHash == "sha256-new-deps"' "$tmp/pi-plugins.json" >/dev/null
