#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "ERROR on line $LINENO" >&2' ERR

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y nginx git ufw jq curl ca-certificates gnupg

if ! command -v node >/dev/null || [[ "$(node -v)" != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash
  apt-get install -y nodejs
fi
corepack enable

if ! id africair &>/dev/null; then
  useradd --system --user-group --shell /usr/sbin/nologin --home-dir /opt/africair africair
fi
install -d -o africair -g africair /opt/africair/releases /opt/africair/shared

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
