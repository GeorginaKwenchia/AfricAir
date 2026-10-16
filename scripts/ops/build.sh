#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/ops/build.sh <git-ref>

Builds and packages the web app and API from a branch, tag, or commit SHA.
Artifacts are written to the current directory:
  africair-<shortsha>.tar.gz
  africair-<shortsha>.tar.gz.sha256
  africair-api-<shortsha>.tar.gz
  africair-api-<shortsha>.tar.gz.sha256

Exit codes:
  0   success
  2   invalid arguments or missing required tools
  10  clone, fetch, or checkout failure
  20  dependency installation failure
  30  pnpm check or pnpm test failure
  40  web or API build failure
  50  metadata generation or artifact packaging failure
EOF
}

if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  usage
  exit 0
fi

if [[ $# -ne 1 || -z $1 || $1 == -* ]]; then
  usage >&2
  exit 2
fi

REF=$1
for tool in git pnpm jq tar sha256sum node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$tool" >&2
    exit 2
  fi
done

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
if ! REPO_ROOT=$(git -C "$SCRIPT_DIR/../.." rev-parse --show-toplevel); then
  echo "Cannot locate the repository containing this script." >&2
  exit 10
fi
if ! REPO_URL=$(git -C "$REPO_ROOT" remote get-url origin); then
  echo "Cannot determine the repository URL from the origin remote." >&2
  exit 10
fi

OUTPUT_DIR=$(pwd -P)
WORKDIR=$(mktemp -d)
trap 'rm -rf -- "$WORKDIR"' EXIT

SOURCE_DIR=$WORKDIR/source
if ! git clone --quiet --no-checkout "$REPO_URL" "$SOURCE_DIR" ||
  ! git -C "$SOURCE_DIR" fetch --quiet --force origin "$REF" ||
  ! git -C "$SOURCE_DIR" checkout --quiet --detach FETCH_HEAD; then
  printf 'Failed to check out git ref: %s\n' "$REF" >&2
  exit 10
fi

if ! (cd -- "$SOURCE_DIR" && pnpm install --frozen-lockfile); then
  echo "Dependency installation failed." >&2
  exit 20
fi

if ! (cd -- "$SOURCE_DIR" && pnpm check); then
  echo "pnpm check failed." >&2
  exit 30
fi
if ! (cd -- "$SOURCE_DIR" && pnpm test); then
  echo "pnpm test failed." >&2
  exit 30
fi

if ! (cd -- "$SOURCE_DIR" && pnpm build && pnpm build:api); then
  echo "Web or API build failed." >&2
  exit 40
fi

COMMIT=$(git -C "$SOURCE_DIR" rev-parse HEAD)
SHORT=$(git -C "$SOURCE_DIR" rev-parse --short HEAD)
BUILT_AT=$(date -u +%FT%TZ)
BUILT_BY=$(whoami)
NODE_VERSION=$(node -v)

if ! jq -n \
  --arg commit "$COMMIT" \
  --arg ref "$REF" \
  --arg builtAt "$BUILT_AT" \
  --arg builtBy "$BUILT_BY" \
  --arg nodeVersion "$NODE_VERSION" \
  '{commit:$commit, ref:$ref, builtAt:$builtAt, builtBy:$builtBy, nodeVersion:$nodeVersion}' \
  > "$SOURCE_DIR/dist/version.json"; then
  echo "Failed to write dist/version.json." >&2
  exit 50
fi

API_STAGE=$WORKDIR/api
mkdir -p "$API_STAGE"
if ! (
  cd -- "$SOURCE_DIR" &&
    pnpm --filter @africair/api deploy --prod --frozen-lockfile --legacy "$API_STAGE/server"
); then
  echo "Failed to prepare production-only API dependencies." >&2
  exit 50
fi
if ! cp -a "$SOURCE_DIR/server/dist" "$API_STAGE/server/dist" ||
  ! cp -a "$SOURCE_DIR/server/migrations" "$API_STAGE/server/migrations"; then
  echo "Failed to stage API build output or migrations." >&2
  exit 50
fi

WEB_ARTIFACT=$OUTPUT_DIR/africair-$SHORT.tar.gz
API_ARTIFACT=$OUTPUT_DIR/africair-api-$SHORT.tar.gz
if ! tar czf "$WEB_ARTIFACT" -C "$SOURCE_DIR/dist" . ||
  ! (cd -- "$OUTPUT_DIR" && sha256sum "$(basename -- "$WEB_ARTIFACT")" > "$(basename -- "$WEB_ARTIFACT").sha256") ||
  ! tar czf "$API_ARTIFACT" -C "$API_STAGE" . ||
  ! (cd -- "$OUTPUT_DIR" && sha256sum "$(basename -- "$API_ARTIFACT")" > "$(basename -- "$API_ARTIFACT").sha256"); then
  echo "Failed to package build artifacts or write checksums." >&2
  exit 50
fi

printf 'Created %s\nCreated %s\n' "$WEB_ARTIFACT" "$API_ARTIFACT"
