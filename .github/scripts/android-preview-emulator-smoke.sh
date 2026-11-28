#!/usr/bin/env bash
set -euo pipefail

adb install -r artifacts/app-release.apk
adb shell am force-stop com.mamnoon.app || true
adb logcat -c

# Launch through the registered deep link; Android 15 emulator images can make
# monkey abort while dumping system meminfo before injecting any input event.
adb shell am start -W -a android.intent.action.VIEW -d "mamnoon://home" -p com.mamnoon.app

for attempt in $(seq 1 30); do
  if adb shell pidof com.mamnoon.app >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

adb shell pidof com.mamnoon.app >/dev/null || {
  adb logcat -d -v threadtime -s AndroidRuntime ReactNativeJS Expo
  adb shell dumpsys activity activities | tail -n 100
  echo "Mamnoon did not remain running after the Android activity launch."
  exit 1
}

sleep 10
adb logcat -d -t 5000 > /tmp/mamnoon-startup-log.txt
if grep -E -i "app-boundary.*Unhandled render error|Unhandled render error.*app-boundary" /tmp/mamnoon-startup-log.txt; then
  echo "Mamnoon displayed its root React error boundary during startup."
  exit 1
fi

if ! bash expo-app/scripts/android-navigation-smoke.sh; then
  echo "::group::Mamnoon Android navigation failure diagnostics"
  echo "App process:"
  adb shell pidof com.mamnoon.app || true
  echo "Focused activity and window:"
  adb shell dumpsys activity activities | tail -n 80 || true
  adb shell dumpsys window | grep -E -i "mCurrentFocus|mFocusedApp|not responding|ANR" | tail -n 40 || true
  echo "Relevant Android and Mamnoon logcat:"
  adb logcat -d -v threadtime -t 4000 | grep -E -i "ANR in|am_anr|not responding|FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|Expo|com\\.mamnoon\\.app" | tail -n 300 || true
  if [ -s /tmp/mamnoon-window.xml ]; then
    echo "Captured UI hierarchy:"
    sed -n '1,160p' /tmp/mamnoon-window.xml
  fi
  echo "::endgroup::"
  exit 1
fi
