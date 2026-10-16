#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Log report failed on line $LINENO." >&2' ERR

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  echo "Usage: scripts/ops/report.sh [logfile]"
  echo "Default log: /var/log/nginx/africair.access.json"
  echo "Prints top IPs, status classes, and top paths across the file."
  echo "Requests per minute cover only the preceding 3600 seconds, grouped in UTC."
  exit 0
fi
if [[ $# -gt 1 ]]; then
  echo "Usage: scripts/ops/report.sh [logfile]" >&2
  exit 2
fi

LOG=${1:-/var/log/nginx/africair.access.json}
if [[ ! -f $LOG || ! -r $LOG ]]; then
  printf 'Log file is missing or unreadable: %s\n' "$LOG" >&2
  exit 1
fi
for tool in jq awk sort uniq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$tool" >&2
    exit 2
  fi
done

export LC_ALL=C
END=$(jq -n 'now')

printf 'Top 10 client IPs (entire file)\n'
jq -r '.remote_addr' "$LOG" | sort | uniq -c | sort -rn | awk 'NR <= 10'

printf '\nRequest counts by status class (entire file)\n'
jq -r '.status' "$LOG" | awk '{print int($1 / 100) "xx"}' | sort | uniq -c

printf '\nTop 10 requested paths (entire file)\n'
jq -r '.uri' "$LOG" | sort | uniq -c | sort -rn | awk 'NR <= 10'

printf '\nRequests per minute (last hour, UTC; minutes without requests omitted)\n'
jq -r --argjson end "$END" '
  def epoch:
    if test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})$") then
      . as $time
      | (($time[0:19] + "Z") | fromdateiso8601) as $local
      | if $time[19:] == "Z" then $local
        else
          (($time[20:22] | tonumber) * 3600 + ($time[23:25] | tonumber) * 60) as $offset
          | $local - (if $time[19:20] == "+" then $offset else -$offset end)
        end
    else error("Invalid nginx timestamp: \(.)")
    end;
  .time | epoch
  | select(. >= ($end - 3600) and . <= $end)
  | strftime("%Y-%m-%dT%H:%MZ")
' "$LOG" | sort | uniq -c
