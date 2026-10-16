#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "Report test failed on line $LINENO." >&2' ERR

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
WORKDIR=$(mktemp -d)
trap 'rm -rf -- "$WORKDIR"' EXIT

jq -n -c '
  (now | floor) as $now
  | [
      {time: (($now - 300) | strftime("%Y-%m-%dT%H:%M:%SZ")), remote_addr: "192.0.2.1", uri: "/", status: 200},
      {time: (($now - 300 + 3600) | strftime("%Y-%m-%dT%H:%M:%S+01:00")), remote_addr: "192.0.2.1", uri: "/", status: 200},
      {time: (($now - 300 - 3600) | strftime("%Y-%m-%dT%H:%M:%S-01:00")), remote_addr: "192.0.2.2", uri: "/missing", status: 404},
      {time: (($now - 7200) | strftime("%Y-%m-%dT%H:%M:%SZ")), remote_addr: "192.0.2.3", uri: "/old", status: 200},
      {time: (($now + 7200) | strftime("%Y-%m-%dT%H:%M:%SZ")), remote_addr: "192.0.2.4", uri: "/future", status: 200}
    ] | .[]
' > "$WORKDIR/access.json"

bash "$SCRIPT_DIR/report.sh" "$WORKDIR/access.json" > "$WORKDIR/output"
awk '$1 == 2 && $2 == "192.0.2.1" {found=1} END {exit !found}' "$WORKDIR/output"
awk '$1 == 4 && $2 == "2xx" {found=1} END {exit !found}' "$WORKDIR/output"
awk '$1 == 1 && $2 == "4xx" {found=1} END {exit !found}' "$WORKDIR/output"
awk '$1 == 2 && $2 == "/" {found=1} END {exit !found}' "$WORKDIR/output"
awk '
  /^Requests per minute/ {minutes=1; next}
  minutes && NF {rows++; count += $1}
  END {exit !(rows == 1 && count == 3)}
' "$WORKDIR/output"

: > "$WORKDIR/empty.json"
bash "$SCRIPT_DIR/report.sh" "$WORKDIR/empty.json" > /dev/null

printf '{"time":"invalid"}\n' > "$WORKDIR/invalid.json"
if bash "$SCRIPT_DIR/report.sh" "$WORKDIR/invalid.json" > /dev/null 2>&1; then
  echo "Invalid timestamps must fail." >&2
  exit 1
fi
printf 'not JSON\n' > "$WORKDIR/invalid.json"
if bash "$SCRIPT_DIR/report.sh" "$WORKDIR/invalid.json" > /dev/null 2>&1; then
  echo "Malformed JSON must fail." >&2
  exit 1
fi
if bash "$SCRIPT_DIR/report.sh" "$WORKDIR/missing.json" > /dev/null 2>&1; then
  echo "Missing logs must fail." >&2
  exit 1
fi

printf 'Report tests passed.\n'
