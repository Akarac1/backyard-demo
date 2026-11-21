#!/usr/bin/env bash
# Installs the bridge as a systemd service on Ubuntu Server.
# Run from inside the extracted bridge/ folder: sudo ./install-ubuntu.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "run with sudo: sudo ./install-ubuntu.sh" >&2; exit 1; fi
if ! command -v node >/dev/null; then
  echo "Node.js not found. Install Node 20+ first, e.g.:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -" >&2
  echo "  sudo apt-get install -y nodejs" >&2
  exit 1
fi
ver=$(node -v | sed 's/^v//;s/\..*//')
if (( ver < 20 )); then echo "Node $ver found; need 20+." >&2; exit 1; fi

DEST=/opt/backyard-bridge
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
id -u backyard-bridge &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin backyard-bridge

mkdir -p "$DEST"
cp "$here/bridge.mjs" "$DEST/"
if [[ -f "$here/.env" ]]; then
  cp "$here/.env" "$DEST/"
else
  echo ".env not found next to this script — copy .env.example to $DEST/.env and fill it in, then run:"
  echo "  systemctl start backyard-bridge"
  cp "$here/.env.example" "$DEST/.env.example" 2>/dev/null || true
fi
chown -R backyard-bridge:backyard-bridge "$DEST"
chmod 600 "$DEST/.env" 2>/dev/null || true

cp "$here/backyard-bridge.service" /etc/systemd/system/backyard-bridge.service
systemctl daemon-reload
systemctl enable backyard-bridge

if [[ -f "$DEST/.env" ]]; then
  systemctl restart backyard-bridge
  sleep 2
  systemctl status backyard-bridge --no-pager || true
  echo
  echo "Follow logs with:  journalctl -u backyard-bridge -f"
else
  echo "Service installed but not started (no .env yet). Create $DEST/.env, then: systemctl start backyard-bridge"
fi
