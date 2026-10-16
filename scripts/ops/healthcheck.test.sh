#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
WORKDIR=$(mktemp -d)
trap 'rm -rf -- "$WORKDIR"' EXIT
export TEST_LOG=$WORKDIR/log
export TEST_STATE=$WORKDIR/state
export CURL_STATUS=0
export RELOAD_STATUS=0

# Redirect only the state path; exercise the real script with mocked external services.
sed "s|^STATE_DIR=/var/lib/africair$|STATE_DIR=$TEST_STATE|" \
  "$SCRIPT_DIR/healthcheck.sh" > "$WORKDIR/healthcheck.sh"

curl() {
  [[ $* == '-fsS -m 5 http://localhost/healthz' ]]
  return "$CURL_STATUS"
}
logger() {
  printf '%s\n' "$*" >> "$TEST_LOG"
}
systemctl() {
  printf 'systemctl %s\n' "$*" >> "$TEST_LOG"
  return "$RELOAD_STATUS"
}
export -f curl logger systemctl

run_check() {
  local expected=$1 status=0
  bash "$WORKDIR/healthcheck.sh" || status=$?
  if [[ $status -ne $expected ]]; then
    printf 'Expected exit %s, got %s\n' "$expected" "$status" >&2
    exit 1
  fi
}

run_check 0
[[ $(cat "$TEST_STATE/failcount") == 0 ]]
grep -q -- '-t africair-health OK' "$TEST_LOG"

CURL_STATUS=22
run_check 1
[[ $(cat "$TEST_STATE/failcount") == 1 ]]
run_check 1
[[ $(cat "$TEST_STATE/failcount") == 2 ]]
if grep -q 'systemctl reload nginx' "$TEST_LOG"; then
  echo "nginx reloaded before the third failure." >&2
  exit 1
fi
run_check 1
[[ $(cat "$TEST_STATE/failcount") == 3 ]]
grep -q 'systemctl reload nginx' "$TEST_LOG"
grep -q -- '-p user.warning -t africair-health WARNING:' "$TEST_LOG"

RELOAD_STATUS=1
run_check 1
[[ $(cat "$TEST_STATE/failcount") == 4 ]]
grep -q 'ERROR: nginx reload failed' "$TEST_LOG"

CURL_STATUS=0
run_check 0
[[ $(cat "$TEST_STATE/failcount") == 0 ]]

printf 'invalid\n' > "$TEST_STATE/failcount"
run_check 1
grep -q 'ERROR: invalid failure count' "$TEST_LOG"
printf 'Health-check tests passed.\n'
