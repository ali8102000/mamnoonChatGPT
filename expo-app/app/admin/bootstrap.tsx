import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import ProtectedAdminTool from "@/components/protected-admin-tool";
import { useAuth } from "@/lib/auth-context";
import { palette } from "@/styles/theme";

export default function BootstrapScreen() {
  const { loading, roles } = useAuth();
  const isSuperAdmin = roles.includes("super_admin");

  // First-admin bootstrap is a one-time, server-protected operation.
  // Once a super admin already exists, an owner opening this legacy route
  // should be sent to the real native admin dashboard, not shown a dead end.
  useEffect(() => {
    if (!loading && isSuperAdmin) {
      router.replace("/admin");
    }
  }, [loading, isSuperAdmin]);

  if (loading || isSuperAdmin) {
    return (
      <View style={styles.loading}>
        <Stack.Screen options={{ title: "الإعداد الأولي" }} />
        <ActivityIndicator size="large" color={palette.brand} />
        <Text style={styles.message}>جارٍ التحقق من صلاحيات المدير الأعلى...</Text>
      </View>
    );
  }

  return (
    <ProtectedAdminTool
      title="الإعداد الأولي"
      description="تهيئة المدير الأعلى إجراء أحادي عالي الحساسية، ولا تُنفّذ من تطبيق الهاتف. استخدم لوحة الإدارة الآمنة على الويب فقط إذا لم يسبق إنشاء المدير الأعلى."
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: palette.canvas,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 12,
  },
  message: {
    color: palette.muted,
    fontSize: 13,
    textAlign: "center",
  },
});
