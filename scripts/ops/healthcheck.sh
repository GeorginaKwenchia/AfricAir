#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Health check failed on line $LINENO." >&2' ERR

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  echo "Usage: healthcheck.sh"
  echo "Checks localhost/healthz, persists consecutive failures, and reloads nginx at 3 or more failures."
  echo "Exit codes: 0 healthy; 1 unhealthy or operational failure; 2 invalid arguments."
  exit 0
fi
if [[ $# -ne 0 ]]; then
  echo "Usage: healthcheck.sh" >&2
  exit 2
fi

STATE_DIR=/var/lib/africair
STATE_FILE=$STATE_DIR/failcount
umask 027
mkdir -p -- "$STATE_DIR"

FAILURES=0
if [[ -f $STATE_FILE ]]; then
  FAILURES=$(cat -- "$STATE_FILE")
  if [[ ! $FAILURES =~ ^(0|[1-9][0-9]{0,8})$ ]]; then
    logger -p user.err -t africair-health "ERROR: invalid failure count in $STATE_FILE"
    exit 1
  fi
fi

if curl -fsS -m 5 http://localhost/healthz >/dev/null; then
  printf '0\n' > "$STATE_FILE"
  logger -t africair-health "OK"
  exit 0
fi

FAILURES=$((FAILURES + 1))
printf '%s\n' "$FAILURES" > "$STATE_FILE"
logger -p user.warning -t africair-health "Health check failed: $FAILURES consecutive failures"

if ((FAILURES >= 3)); then
  logger -p user.warning -t africair-health "WARNING: $FAILURES consecutive failures; reloading nginx"
  if ! systemctl reload nginx; then
    logger -p user.err -t africair-health "ERROR: nginx reload failed; check systemctl status nginx"
    exit 1
  fi
fi

exit 1
