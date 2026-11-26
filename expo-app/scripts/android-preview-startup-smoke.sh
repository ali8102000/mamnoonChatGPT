#!/usr/bin/env bash
set -euo pipefail

APK="${1:-artifacts/app-release.apk}"
PACKAGE="com.mamnoon.app"
LOG="${2:-artifacts/emulator-startup-log.txt}"
SCREEN="${3:-artifacts/emulator-startup-screen.png}"

mkdir -p "$(dirname "$LOG")" "$(dirname "$SCREEN")"
test -s "$APK"

adb install -r "$APK"
adb shell am force-stop "$PACKAGE" || true
adb logcat -c
adb shell am start -W -a android.intent.action.VIEW -d "mamnoon://home" -p "$PACKAGE"

sleep 8
if ! adb shell pidof "$PACKAGE" >/dev/null 2>&1; then
  adb logcat -d -v threadtime -s AndroidRuntime ReactNativeJS Expo > "$LOG" || true
  adb shell dumpsys activity activities | tail -n 100 || true
  echo "Mamnoon did not remain running after the Android activity launch."
  exit 1
fi

sleep 10
adb logcat -d -t 5000 > "$LOG"
if grep -E -i "app-boundary.*Unhandled render error|Unhandled render error.*app-boundary|FATAL EXCEPTION|Fatal signal" "$LOG"; then
  echo "A React error boundary or native crash signature appeared during startup."
  exit 1
fi

adb exec-out screencap -p > "$SCREEN"
test -s "$SCREEN"

echo "PASS: Mamnoon installed, launched, remained running, and produced a startup screenshot without a detected fatal crash."
