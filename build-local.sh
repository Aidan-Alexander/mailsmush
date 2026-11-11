#!/bin/bash
# Builds MailSmush by copying source to /tmp (avoiding Google Drive node_modules overhead),
# running electron-packager there, then installing the result to /Applications.
# Add --default-mail-app to also make it the app that opens email links (mailto:) from other apps.

set -e

DRIVE_SRC="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/tmp/mailsmush_build"

echo "==> Syncing source to $BUILD_DIR (excluding node_modules)..."
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='dist' \
  "$DRIVE_SRC/" "$BUILD_DIR/"

# Their own app icon, if they chose one: images/custom-icon.png (a square PNG, kept out of git).
# Swapped in here in the build copy only, so the hedgehog files in the source stay as they are.
if [ -f "$BUILD_DIR/images/custom-icon.png" ]; then
  echo "==> Using your own app icon..."
  ICONSET="$BUILD_DIR/icon.iconset"
  rm -rf "$ICONSET"; mkdir "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$BUILD_DIR/images/custom-icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$BUILD_DIR/images/custom-icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$BUILD_DIR/images/icon.icns"
  sips -z 1024 1024 "$BUILD_DIR/images/custom-icon.png" --out "$BUILD_DIR/images/icon.png" >/dev/null
  rm -rf "$ICONSET"
fi

echo "==> Installing dependencies..."
cd "$BUILD_DIR"
npm install --prefer-offline 2>&1 | tail -5

echo "==> Building..."
npm run build 2>&1 | tail -10

echo "==> Installing to /Applications..."
APP=$(ls -d "$BUILD_DIR"/dist/MailSmush-darwin-*/MailSmush.app | head -1)
rm -rf /Applications/MailSmush.app
cp -R "$APP" /Applications/MailSmush.app

echo "==> Patching Info.plist for mailto scheme..."
/usr/libexec/PlistBuddy -c "Delete :CFBundleURLTypes" /Applications/MailSmush.app/Contents/Info.plist 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" /Applications/MailSmush.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" /Applications/MailSmush.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string Email" /Applications/MailSmush.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" /Applications/MailSmush.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string mailto" /Applications/MailSmush.app/Contents/Info.plist

echo "==> Registering with LaunchServices..."
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f /Applications/MailSmush.app

if [ "${1:-}" = "--default-mail-app" ]; then
  echo "==> Setting as default mailto handler..."
  swift -e '
import AppKit
LSSetDefaultHandlerForURLScheme("mailto" as CFString, "com.electron.mailsmush" as CFString)
print("Done")
' 2>/dev/null
fi

echo ""
echo "✓ MailSmush built and installed successfully"
