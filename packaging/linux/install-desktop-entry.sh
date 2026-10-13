#!/bin/sh
# Adds Repackshot to this user's applications menu: the icon and a copy of
# repackshot.desktop that points at the repackshot next to this script.
set -eu
dir=$(cd "$(dirname "$0")" && pwd)
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
icons="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps"
mkdir -p "$apps" "$icons"
cp "$dir/icon.png" "$icons/repackshot.png"
escaped=$(printf '%s' "$dir/repackshot" | sed 's/[\\"`$]/\\\\&/g')
sed "s|^Exec=.*|Exec=\"$escaped\"|" "$dir/repackshot.desktop" > "$apps/repackshot.desktop"
echo "Added $apps/repackshot.desktop"
