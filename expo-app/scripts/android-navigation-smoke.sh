#!/usr/bin/env bash
set -euo pipefail

PKG="com.mamnoon.app"
LOG="/tmp/mamnoon-navigation-log.txt"
UI="/tmp/mamnoon-window.xml"
REMOTE_UI="/data/local/tmp/mamnoon-window.xml"

dump_ui() {
  adb shell uiautomator dump "$REMOTE_UI" >/dev/null
  adb pull "$REMOTE_UI" "$UI" >/dev/null
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

tap_text() {
  local target="$1"
  local coords
  coords="$(python3 - "$UI" "$target" <<'PY'
import re, sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
target = sys.argv[2]
for node in root.iter("node"):
    value = " ".join(filter(None, (node.attrib.get("text", ""), node.attrib.get("content-desc", ""))))
    if target in value:
        m = re.fullmatch(r"\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]", node.attrib.get("bounds", ""))
        if m:
            x1,y1,x2,y2 = map(int,m.groups())
            print((x1+x2)//2, (y1+y2)//2)
            raise SystemExit(0)
raise SystemExit("Could not find visible text: " + target)
PY
)"
  read -r x y <<< "$coords"
  adb shell input tap "$x" "$y"
}

visible_labels() {
  python3 - "$UI" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
labels = []
for node in root.iter("node"):
    value = " ".join(filter(None, (node.attrib.get("text", ""), node.attrib.get("content-desc", ""))))
    if value.strip():
        labels.append(value.strip())
print("Visible UI labels:", " | ".join(labels[:50]))
PY
}

has_text() {
  python3 - "$UI" "$1" <<'PY'
import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
needle = sys.argv[2]
for node in root.iter("node"):
    value = " ".join(filter(None, (node.attrib.get("text", ""), node.attrib.get("content-desc", "")))).lower()
    if needle.lower() in value:
        raise SystemExit(0)
raise SystemExit(1)
PY
}

recover_system_ui_dialog() {
  if grep -qi "System UI isn't responding" "$UI"; then
    echo "System UI ANR dialog detected; choosing Wait and retrying UI capture."
    if grep -q 'text="Wait"' "$UI"; then
      tap_text "Wait"
      sleep 15
      assert_alive
      dump_ui
      if grep -qi "System UI isn't responding" "$UI"; then
        echo "System UI remained unresponsive after Wait."
        exit 1
      fi
    else
      echo "System UI dialog has no accessible Wait action."
      exit 1
    fi
  fi
}

tap_accessibility_label() {
  local label="$1"
  tap_text "$label"
  sleep 2
  assert_alive
  dump_ui
}

: > "$LOG"
adb logcat -c
echo "Launching Mamnoon normally to preserve the real first-run flow."
adb shell am force-stop "$PKG" || true
adb shell monkey -p "$PKG" 1
sleep 15
assert_alive
dump_ui
recover_system_ui_dialog
visible_labels

if has_text "بأي محافظة أنت" || has_text "اختَر محافظتك" || has_text "المحافظة"; then
  echo "Governorate selection gate detected."
  if ! has_text "النجف"; then
    echo "FAIL: governorate gate is visible but Najaf is not selectable."
    exit 1
  fi
  tap_text "النجف"
  sleep 8
  assert_alive
  dump_ui
  recover_system_ui_dialog
  visible_labels
fi

if has_text "تسجيل الدخول" || has_text "رقم الهاتف" || has_text "دخول" || has_text "sign in" || has_text "log in"; then
  adb logcat -d -t 5000 > "$LOG"
  if grep -E -i "app-boundary.*Unhandled render error|Unhandled render error.*app-boundary|FATAL EXCEPTION|Fatal signal" "$LOG"; then
    echo "A render boundary or native crash signature appeared during first-run flow."
    exit 1
  fi
  echo "PASS: app launched, first-run governorate flow was handled, and the expected authentication gate is visible."
  exit 0
fi

if ! has_text "الطلبات"; then
  echo "FAIL: no known first-run gate or bottom navigation was detected."
  exit 1
fi

tap_accessibility_label "الطلبات"
tap_accessibility_label "الرسائل"
tap_accessibility_label "حسابي"
tap_accessibility_label "الرئيسية"

adb logcat -d -t 5000 > "$LOG"
if grep -E -i "app-boundary.*Unhandled render error|Unhandled render error.*app-boundary|FATAL EXCEPTION|Fatal signal" "$LOG"; then
  echo "A render boundary or native crash signature appeared during navigation."
  exit 1
fi

echo "PASS: bottom navigation controls responded and no detected process crash."
