#!/usr/bin/env bash
set -euo pipefail

runner=${RUNNER:-scripts/local-update.sh}
prompt=${PROMPT:-scripts/local-update-recovery.md}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
remote=$tmp/remote.git
seed=$tmp/seed
mkdir -p "$seed/scripts" "$tmp/bin"
git init -q --bare "$remote"
git init -q -b main "$seed"
git -C "$seed" config user.name fixture
git -C "$seed" config user.email fixture@example.invalid
printf '#!%s\n' "$BASH" >"$seed/scripts/daily-update.sh"
cat >>"$seed/scripts/daily-update.sh" <<'FIXTURE'
set -u
printf '%s\n' "$1" >>"$TEST_EVENTS"
printf '%s\n' 'RAW_OUTPUT_MUST_STAY_PRIVATE'
printf -- '- %s: fixture\n' "$1" >>"${GITHUB_STEP_SUMMARY:?}"
if [ "$1" = inputs ] && [ -e fail-input ]; then exit 1; fi
FIXTURE
chmod +x "$seed/scripts/daily-update.sh"
git -C "$seed" add scripts/daily-update.sh
git -C "$seed" commit -qm fixture
git -C "$seed" remote add origin "$remote"
git -C "$seed" push -q -u origin main
git --git-dir="$remote" symbolic-ref HEAD refs/heads/main
sed "s|git@github.com:tigorlazuardi/nix-llm-agents-config.git|$remote|" "$runner" >"$tmp/local-update.sh"
chmod +x "$tmp/local-update.sh"

printf '#!%s\n' "$BASH" >"$tmp/bin/nix"
cat >>"$tmp/bin/nix" <<'FIXTURE'
set -eu
case "$*" in
  'fmt -- --check .') printf '%s\n' nix-fmt >>"$TEST_EVENTS" ;;
  'flake check') printf '%s\n' nix-flake >>"$TEST_EVENTS" ;;
  *) exit 2 ;;
esac
FIXTURE
chmod +x "$tmp/bin/nix"

write_repairing_pi() {
  printf '#!%s\n' "$BASH" >"$tmp/bin/pi"
  cat >>"$tmp/bin/pi" <<'FIXTURE'
set -euo pipefail
printf '%s\n' pi >>"$TEST_EVENTS"
printf '%s\n' pi >>"$PI_COUNT"
printf '%s\n' "$*" >>"$PI_CALLS"
args=" $* "
for required in ' --print ' ' --no-session ' ' --approve ' ' --model openai-codex/gpt-5.6-sol ' ' --thinking high ' ' --no-extensions ' ' --no-skills ' ' --no-prompt-templates ' ' --no-context-files ' ' --tools read,bash,edit,write,grep,find,ls '; do
  case "$args" in *"$required"*) ;; *) exit 2 ;; esac
done
case "$args" in
  *'Never modify Git remotes'*'Never invoke scripts/local-update.sh'*) ;;
  *) exit 2 ;;
esac
git rm -q fail-input
git -c user.name=fixture -c user.email=fixture@example.invalid commit -qm repair
git push -q origin HEAD:main
printf '%s\n' 'PI_RAW_OUTPUT_MUST_STAY_PRIVATE'
FIXTURE
  chmod +x "$tmp/bin/pi"
}

push_failure() {
  git -C "$seed" fetch -q origin main
  git -C "$seed" reset -q --hard origin/main
  : >"$seed/fail-input"
  git -C "$seed" add fail-input
  git -C "$seed" commit -qm failure
  git -C "$seed" push -q origin main
}

write_repairing_pi
export PATH="$tmp/bin:$PATH"
LOCAL_UPDATE_RECOVERY_PROMPT=$(realpath "$prompt")
export LOCAL_UPDATE_RECOVERY_PROMPT
export PI_CALLS="$tmp/pi-calls"
export PI_COUNT="$tmp/pi-count"

# Successful deterministic execution never invokes Pi.
export LOCAL_UPDATE_STATE_DIR="$tmp/success-state" TEST_EVENTS="$tmp/success-events"
success_output=$(bash "$tmp/local-update.sh")
[ "$(cat "$TEST_EVENTS")" = $'inputs\nplugins' ]
[ ! -e "$PI_CALLS" ]
case "$success_output" in *RAW_OUTPUT_MUST_STAY_PRIVATE*) exit 1 ;; esac
case "$success_output" in *'final status: 0'*) ;; *) exit 1 ;; esac
[ "$(stat -c %a "$LOCAL_UPDATE_STATE_DIR/summary.md")" = 600 ]

# A tracked failure invokes Pi once; Pi must commit and push its repair before verification.
push_failure
: >"$PI_CALLS"
: >"$PI_COUNT"
export LOCAL_UPDATE_STATE_DIR="$tmp/recovery-state" TEST_EVENTS="$tmp/recovery-events"
recovery_output=$(bash "$tmp/local-update.sh")
[ "$(cat "$TEST_EVENTS")" = $'inputs\nplugins\npi\nnix-fmt\nnix-flake\ninputs\nplugins' ]
[ "$(wc -l <"$PI_COUNT")" -eq 1 ]
[ ! -e "$LOCAL_UPDATE_STATE_DIR/repository/fail-input" ]
[ "$(git --git-dir="$remote" log -1 --format=%s main)" = repair ]
case "$recovery_output" in *RAW_OUTPUT_MUST_STAY_PRIVATE*) exit 1 ;; esac

# A Pi failure or unpushed local state is discarded; deterministic verification remains failed.
push_failure
: >"$PI_CALLS"
: >"$PI_COUNT"
export LOCAL_UPDATE_STATE_DIR="$tmp/verify-fail-state" TEST_EVENTS="$tmp/verify-fail-events"
printf '#!%s\n' "$BASH" >"$tmp/bin/pi"
cat >>"$tmp/bin/pi" <<'FIXTURE'
printf '%s\n' pi >>"$TEST_EVENTS"
printf '%s\n' pi >>"$PI_COUNT"
printf '%s\n' "$*" >>"$PI_CALLS"
rm -f fail-input
exit 9
FIXTURE
chmod +x "$tmp/bin/pi"
if bash "$tmp/local-update.sh" >/dev/null; then exit 1; fi
[ "$(cat "$TEST_EVENTS")" = $'inputs\nplugins\npi\nnix-fmt\nnix-flake\ninputs\nplugins' ]
[ "$(wc -l <"$PI_COUNT")" -eq 1 ]
[ -e "$LOCAL_UPDATE_STATE_DIR/repository/fail-input" ]

# An active lock skips without touching a checkout.
export LOCAL_UPDATE_STATE_DIR="$tmp/locked-state" TEST_EVENTS="$tmp/locked-events"
mkdir -p "$LOCAL_UPDATE_STATE_DIR"
printf '%s\n' nix-llm-agents-config-local-updater-v1 >"$LOCAL_UPDATE_STATE_DIR/owner"
exec 8>"$LOCAL_UPDATE_STATE_DIR/update.lock"
flock -n 8
bash "$tmp/local-update.sh" | grep -F 'lock skipped'
[ ! -e "$LOCAL_UPDATE_STATE_DIR/repository" ]
flock -u 8

# Existing unmarked state and changed managed-clone remotes fail closed without Pi.
export LOCAL_UPDATE_STATE_DIR="$tmp/unmarked-state"
mkdir -p "$LOCAL_UPDATE_STATE_DIR/repository"
if bash "$tmp/local-update.sh" >/dev/null; then exit 1; fi
export LOCAL_UPDATE_STATE_DIR="$tmp/recovery-state"
git -C "$LOCAL_UPDATE_STATE_DIR/repository" remote set-url origin "$tmp/other.git"
if bash "$tmp/local-update.sh" >/dev/null; then exit 1; fi

# Alternate core.worktree is rejected before reset/clean can touch the external directory.
export LOCAL_UPDATE_STATE_DIR="$tmp/worktree-state"
mkdir -p "$LOCAL_UPDATE_STATE_DIR"
printf '%s\n' nix-llm-agents-config-local-updater-v1 >"$LOCAL_UPDATE_STATE_DIR/owner"
git clone -q "$remote" "$LOCAL_UPDATE_STATE_DIR/repository"
mkdir -p "$tmp/external-worktree"
printf '%s\n' preserve >"$tmp/external-worktree/sentinel"
git --git-dir="$LOCAL_UPDATE_STATE_DIR/repository/.git" config core.worktree "$tmp/external-worktree"
if bash "$tmp/local-update.sh" >/dev/null; then exit 1; fi
[ "$(cat "$tmp/external-worktree/sentinel")" = preserve ]
