import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, usePathname } from "expo-router";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { palette } from "@/styles/theme";

type Tab = { path: string; label: string; icon: "home" | "clipboard" | "message" | "user" };

const tabs: Tab[] = [
  { path: "/home", label: "الرئيسية", icon: "home" },
  { path: "/history", label: "الطلبات", icon: "clipboard" },
  { path: "/messages", label: "الرسائل", icon: "message" },
  { path: "/profile", label: "حسابي", icon: "user" },
];

function NavigationIcon({ name, color }: { name: Tab["icon"]; color: string }) {
  const common = { stroke: color, strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" as const };
  if (name === "home") return <Svg width={20} height={20} viewBox="0 0 24 24"><Path {...common} d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-6h6v6" /></Svg>;
  if (name === "clipboard") return <Svg width={20} height={20} viewBox="0 0 24 24"><Rect {...common} x="5" y="4" width="14" height="18" rx="2" /><Path {...common} d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h4" /></Svg>;
  if (name === "message") return <Svg width={20} height={20} viewBox="0 0 24 24"><Path {...common} d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></Svg>;
  return <Svg width={20} height={20} viewBox="0 0 24 24"><Circle {...common} cx="12" cy="8" r="4" /><Path {...common} d="M4 21a8 8 0 0 1 16 0" /></Svg>;
}

export function NativeBottomNavigation() {
  const pathname = usePathname();
  const visible = tabs.some((tab) => pathname === tab.path || pathname.startsWith(tab.path + "/"));
  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={styles.positioner}>
      <View style={styles.bar}>
        {tabs.map((tab) => {
          const active = pathname === tab.path || pathname.startsWith(tab.path + "/");
          const color = active ? palette.brand : palette.muted;
          return (
            <Pressable
              key={tab.path}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
              onPress={() => { if (!active) router.push(tab.path as never); }}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              <NavigationIcon name={tab.icon} color={color} />
              <Text style={[styles.label, { color }, active && styles.activeLabel]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  positioner: { position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 50, elevation: 50 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#08101A",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 7,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10 },
  pressed: { opacity: 0.72 },
  label: { fontSize: 11, lineHeight: 14, fontFamily: "Tajawal_700Bold", fontWeight: "700" },
  activeLabel: { fontFamily: "Tajawal_800ExtraBold", fontWeight: "800" },
});
