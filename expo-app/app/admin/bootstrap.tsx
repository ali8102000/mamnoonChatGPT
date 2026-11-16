import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import ProtectedAdminTool from "@/components/protected-admin-tool";
import { useAuth } from "@/lib/auth-context";
import { getAdminStaffRoles } from "@/lib/admin-access";
import { palette } from "@/styles/theme";

export default function BootstrapScreen() {
  const { loading, user } = useAuth();
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);

  // Resolve the effective server-backed staff roles just like the rest of the
  // Native admin navigation. The local auth role snapshot may not include a
  // role granted through an active staff assignment.
  useEffect(() => {
    if (loading) return;
    if (!user?.id) {
      setIsSuperAdmin(false);
      return;
    }

    let active = true;
    setIsSuperAdmin(null);
    void getAdminStaffRoles(user.id)
      .then((roles) => {
        if (active) {
          setIsSuperAdmin(roles.includes("super_admin") || roles.includes("rank:owner"));
        }
      })
      .catch(() => {
        if (active) setIsSuperAdmin(false);
      });

    return () => {
      active = false;
    };
  }, [loading, user?.id]);

  useEffect(() => {
    if (!loading && isSuperAdmin === true) {
      router.replace("/admin");
    }
  }, [loading, isSuperAdmin]);

  if (loading || isSuperAdmin === null || isSuperAdmin === true) {
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
