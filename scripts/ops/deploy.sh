#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: scripts/ops/deploy.sh <artifact.tar.gz>"
}

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  usage
  exit 0
fi
if [[ $# -ne 1 || -z $1 ]]; then
  usage >&2
  exit 2
fi

for tool in sha256sum tar jq date id chown readlink ln mv nginx systemctl curl find sort rm realpath dirname basename mktemp; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$tool" >&2
    exit 2
  fi
done

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 2
fi

ARTIFACT=$(realpath -- "$1") || {
  echo "Cannot resolve artifact path." >&2
  exit 2
}
if [[ ! -f $ARTIFACT || $ARTIFACT != *.tar.gz ]]; then
  echo "Artifact must be an existing .tar.gz file." >&2
  exit 2
fi

ARTIFACT_DIR=$(dirname -- "$ARTIFACT")
ARTIFACT_NAME=$(basename -- "$ARTIFACT")
CHECKSUM_NAME=$ARTIFACT_NAME.sha256
if [[ ! -f $ARTIFACT_DIR/$CHECKSUM_NAME ]] ||
  ! (cd -- "$ARTIFACT_DIR" && sha256sum -c -- "$CHECKSUM_NAME"); then
  echo "Artifact checksum verification failed; no releases were changed." >&2
  exit 1
fi

if ! COMMIT=$(tar -xOzf "$ARTIFACT" ./version.json | jq -er '.commit | strings | select(test("^[0-9a-f]{40}([0-9a-f]{24})?$"))'); then
  echo "Artifact has no valid full commit in version.json." >&2
  exit 1
fi
if ! id africair >/dev/null 2>&1; then
  echo "Required deployment user 'africair' does not exist." >&2
  exit 1
fi

APP_ROOT=/opt/africair
RELEASES_DIR=$APP_ROOT/releases
CURRENT_LINK=$APP_ROOT/current
mkdir -p -- "$RELEASES_DIR"

SHORT_SHA=${COMMIT:0:12}
RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$SHORT_SHA"
NEW_RELEASE=$RELEASES_DIR/$RELEASE_ID
if [[ -e $NEW_RELEASE || -L $NEW_RELEASE ]]; then
  printf 'Release already exists: %s\n' "$NEW_RELEASE" >&2
  exit 1
fi

PREVIOUS_RELEASE=
if [[ -L $CURRENT_LINK ]]; then
  PREVIOUS_RELEASE=$(readlink -f -- "$CURRENT_LINK" || true)
  case "$PREVIOUS_RELEASE" in
    "$RELEASES_DIR"/*)
      if [[ ! -d $PREVIOUS_RELEASE ]]; then
        echo "Current symlink does not resolve to a release directory." >&2
        exit 1
      fi
      ;;
    *)
      echo "Current symlink points outside the releases directory." >&2
      exit 1
      ;;
  esac
elif [[ -e $CURRENT_LINK ]]; then
  echo "Current path exists but is not a symlink." >&2
  exit 1
fi

STAGING_DIR=$(mktemp -d "$RELEASES_DIR/.deploy.XXXXXX")
TEMP_LINK=$APP_ROOT/current.tmp.$$
cleanup() {
  if [[ -n ${STAGING_DIR:-} && -d $STAGING_DIR ]]; then
    rm -rf -- "$STAGING_DIR"
  fi
  if [[ -L ${TEMP_LINK:-} ]]; then
    rm -f -- "$TEMP_LINK"
  fi
}
trap cleanup EXIT

if ! tar -xzf "$ARTIFACT" -C "$STAGING_DIR"; then
  echo "Failed to extract artifact." >&2
  exit 1
fi
if [[ ! -f $STAGING_DIR/version.json ]] ||
  ! jq -e --arg commit "$COMMIT" '.commit == $commit' "$STAGING_DIR/version.json" >/dev/null; then
  echo "Extracted artifact version.json is missing or inconsistent." >&2
  exit 1
fi
chown -R africair:africair "$STAGING_DIR"
mv -T -- "$STAGING_DIR" "$NEW_RELEASE"
STAGING_DIR=

atomic_switch() {
  local target=$1
  ln -sfn -- "$target" "$TEMP_LINK"
  mv -Tf -- "$TEMP_LINK" "$CURRENT_LINK"
}

restore_previous() {
  if [[ -n $PREVIOUS_RELEASE ]]; then
    atomic_switch "releases/$(basename -- "$PREVIOUS_RELEASE")"
  else
    rm -f -- "$CURRENT_LINK"
  fi
  if ! nginx -t || ! systemctl reload nginx; then
    echo "WARNING: failed to reload nginx after restoring the previous release." >&2
  fi
}

atomic_switch "releases/$RELEASE_ID"
if ! nginx -t || ! systemctl reload nginx; then
  echo "nginx validation or reload failed; restoring the previous release." >&2
  restore_previous
  exit 1
fi

LIVE_COMMIT=
if ! curl -fsS http://localhost/healthz >/dev/null ||
  ! LIVE_COMMIT=$(curl -fsS http://localhost/version.json | jq -er '.commit'); then
  echo "Health or version endpoint verification failed; restoring the previous release." >&2
  restore_previous
  exit 1
fi
if [[ $LIVE_COMMIT != "$COMMIT" ]]; then
  printf 'Deployed commit mismatch: expected %s, received %s; restoring previous release.\n' "$COMMIT" "$LIVE_COMMIT" >&2
  restore_previous
  exit 1
fi

mapfile -t RELEASE_IDS < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f\n' | sort -r)
for ((index = 5; index < ${#RELEASE_IDS[@]}; index++)); do
  OLD_RELEASE_ID=${RELEASE_IDS[index]}
  if [[ -n $OLD_RELEASE_ID && $OLD_RELEASE_ID != "$RELEASE_ID" && $OLD_RELEASE_ID != */* ]]; then
    rm -rf -- "$RELEASES_DIR/$OLD_RELEASE_ID"
  fi
done

printf 'Deployed %s to %s\n' "$COMMIT" "$NEW_RELEASE"
