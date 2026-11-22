#!/usr/bin/env bash
set -euo pipefail

PKG="com.mamnoon.app"
LOG="/tmp/mamnoon-navigation-log.txt"
UI="/tmp/mamnoon-window.xml"

dump_ui() {
  adb shell uiautomator dump /sdcard/mamnoon-window.xml >/dev/null
  adb pull /sdcard/mamnoon-window.xml "$UI" >/dev/null
  test -s "$UI"
  python3 - "$UI" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
nodes = list(root.iter("node"))
if len(nodes) < 3:
    raise SystemExit("UI hierarchy is unexpectedly empty")
print("UI hierarchy nodes:", len(nodes))
PY
}

assert_alive() {
  adb shell pidof "$PKG" >/dev/null || {
    adb logcat -d -t 2500
    echo "Mamnoon process exited during navigation test."
    exit 1
  }
}

open_route() {
  local route="$1"
  echo "Opening route: $route"
  adb shell am start -W -a android.intent.action.VIEW -d "mamnoon://$route" -p "$PKG" >/dev/null
  sleep 3
  assert_alive
  dump_ui
}

tap_accessibility_label() {
  local label="$1"
  local coords
  coords="$(python3 - "$UI" "$label" <<'PY'
import re, sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
label = sys.argv[2]
for node in root.iter("node"):
    if node.attrib.get("content-desc") == label:
        bounds = node.attrib.get("bounds", "")
        m = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
        if m:
            x1,y1,x2,y2 = map(int,m.groups())
            print((x1+x2)//2, (y1+y2)//2)
            raise SystemExit(0)
raise SystemExit("Could not find accessible bottom tab: " + label)
PY
)"
  read -r x y <<< "$coords"
  adb shell input tap "$x" "$y"
  sleep 2
  assert_alive
  dump_ui
}

: > "$LOG"
adb logcat -c
open_route "home"

# A fresh emulator has no SecureStore governorate or authenticated session.
# Detect those intentional startup gates explicitly instead of misreporting a
# missing bottom tab as a navigation regression.
if ! python3 - "$UI" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
labels = []
for node in root.iter("node"):
    value = " ".join(filter(None, (
        node.attrib.get("text", ""),
        node.attrib.get("content-desc", ""),
    )))
    if value.strip():
        labels.append(value.strip())
all_text = " ".join(labels).lower()
print("Visible UI labels:", " | ".join(labels[:30]))
gate_terms = ("المحافظة", "اختر المحافظة", "تسجيل الدخول", "رقم الهاتف", "دخول", "governorate", "sign in", "log in")
if any(term in all_text for term in gate_terms):
    raise SystemExit(2)
if "الطلبات" not in labels and not any("الطلبات" in item for item in labels):
    raise SystemExit(1)
PY
then
  gate_status=$?
  if [ "$gate_status" -eq 2 ]; then
    echo "BLOCKED: emulator is at governorate/login gate; provide a test session before navigation can be verified."
    exit 2
  fi
  echo "FAIL: bottom navigation is absent and no known startup gate was detected."
  exit 1
fi

# Exercise the real bottom-tab controls repeatedly, not just route deep links.
for cycle in 1 2 3; do
  echo "Navigation cycle $cycle"
  tap_accessibility_label "الطلبات"
  tap_accessibility_label "الرسائل"
  tap_accessibility_label "حسابي"
  tap_accessibility_label "الرئيسية"
done

# Exercise additional native route mounts and their cleanup paths.
open_route "account-settings"
adb shell input keyevent 4
sleep 2
assert_alive
open_route "onboarding/driver"
adb shell input keyevent 4
sleep 2
assert_alive
open_route "onboarding/worker"
adb shell input keyevent 4
sleep 2
assert_alive
open_route "home"

adb logcat -d -t 5000 > "$LOG"
if grep -E -i "app-boundary.*Unhandled render error|Unhandled render error.*app-boundary|FATAL EXCEPTION|Fatal signal" "$LOG"; then
  echo "A render boundary or native crash signature appeared during navigation."
  exit 1
fi

echo "PASS: 3 full bottom-tab cycles, account settings + driver/worker onboarding route mounts, back navigation, and no detected process crash."
