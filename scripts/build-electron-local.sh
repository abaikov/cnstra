#!/bin/bash
set -euo pipefail

# Usage: put secrets into .env at repo root, then run:
#   ./scripts/build-electron-local.sh mac|win|linux|all

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  echo "==> Loading .env"
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# Bridge aliases for notarization
if [[ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -z "${APPLE_PASSWORD:-}" ]]; then
  export APPLE_PASSWORD="$APPLE_APP_SPECIFIC_PASSWORD"
fi
if [[ -n "${APPLE_TEAM_ID:-}" && -z "${TEAM_ID:-}" ]]; then
  export TEAM_ID="$APPLE_TEAM_ID"
fi

# Avoid sharp trying to compile against global libvips
export SHARP_IGNORE_GLOBAL_LIBVIPS=1

TARGET=${1:-mac}

echo "==> Install deps (skip postinstall scripts)"
npm ci --ignore-scripts

echo "==> Build core and panel UI"
npm run build:core
npm run build --workspace=@cnstra/devtools-panel-ui

echo "==> Prepare Electron resources"
mkdir -p packages/devtools-electron/resources/img packages/devtools-electron/resources/fonts
rm -rf packages/devtools-electron/resources/devtools-panel-ui-dist || true
cp -r packages/devtools-panel-ui/dist packages/devtools-electron/resources/devtools-panel-ui-dist
cp docs/static/img/logo.svg packages/devtools-electron/resources/img/
cp docs/static/fonts/Px437_IBM_Conv.ttf packages/devtools-electron/resources/fonts/

echo "==> Generate icons"
npm run gen:icons --workspace=@cnstra/devtools-electron || true

echo "==> Ensure Electron dev dep installed"
(cd packages/devtools-electron && npm install electron@30.0.0 --save-dev)

case "$TARGET" in
  mac)
    echo "==> Build mac (dmg, zip)"
    (cd packages/devtools-electron && npx electron-builder --config ./electron-builder.config.js --mac dmg zip)
    ;;
  win)
    echo "==> Build windows (nsis)"
    (cd packages/devtools-electron && npx electron-builder --config ./electron-builder.config.js --win nsis)
    ;;
  linux)
    echo "==> Build linux (AppImage)"
    (cd packages/devtools-electron && npx electron-builder --config ./electron-builder.config.js --linux AppImage)
    ;;
  all)
    echo "==> Build all (mac, win, linux)"
    (cd packages/devtools-electron && npx electron-builder --config ./electron-builder.config.js -mwl)
    ;;
  *)
    echo "Unknown target: $TARGET" >&2
    exit 1
    ;;
esac

echo "==> Done"


