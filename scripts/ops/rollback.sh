#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: scripts/ops/rollback.sh"
}

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  usage
  exit 0
fi
if [[ $# -ne 0 ]]; then
  usage >&2
  exit 2
fi

for tool in readlink find sort ln mv nginx systemctl rm basename; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$tool" >&2
    exit 2
  fi
done

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 2
fi

APP_ROOT=/opt/africair
RELEASES_DIR=$APP_ROOT/releases
CURRENT_LINK=$APP_ROOT/current
if [[ ! -L $CURRENT_LINK ]]; then
  echo "Current release symlink does not exist." >&2
  exit 1
fi
CURRENT_RELEASE=$(readlink -f -- "$CURRENT_LINK" || true)
case "$CURRENT_RELEASE" in
  "$RELEASES_DIR"/*)
    if [[ ! -d $CURRENT_RELEASE ]]; then
      echo "Current symlink does not resolve to a release directory." >&2
      exit 1
    fi
    ;;
  *)
    echo "Current symlink points outside the releases directory." >&2
    exit 1
    ;;
esac

mapfile -t RELEASE_IDS < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f\n' | sort -r)
PREVIOUS_RELEASE=
for RELEASE_ID in "${RELEASE_IDS[@]}"; do
  CANDIDATE=$RELEASES_DIR/$RELEASE_ID
  if [[ -d $CANDIDATE && $CANDIDATE != "$CURRENT_RELEASE" ]]; then
    PREVIOUS_RELEASE=$CANDIDATE
    break
  fi
done
if [[ -z $PREVIOUS_RELEASE ]]; then
  echo "No previous release is available to restore." >&2
  exit 1
fi

TEMP_LINK=$APP_ROOT/current.tmp.$$
cleanup() {
  if [[ -L ${TEMP_LINK:-} ]]; then
    rm -f -- "$TEMP_LINK"
  fi
}
trap cleanup EXIT

atomic_switch() {
  local target=$1
  ln -sfn -- "$target" "$TEMP_LINK"
  mv -Tf -- "$TEMP_LINK" "$CURRENT_LINK"
}

atomic_switch "releases/$(basename -- "$PREVIOUS_RELEASE")"
if ! nginx -t || ! systemctl reload nginx; then
  echo "nginx validation or reload failed; restoring the release active before rollback." >&2
  atomic_switch "releases/$(basename -- "$CURRENT_RELEASE")"
  if ! nginx -t || ! systemctl reload nginx; then
    echo "WARNING: nginx reload also failed after restoring the original release." >&2
  fi
  exit 1
fi

printf 'Rolled back to %s\n' "$PREVIOUS_RELEASE"
