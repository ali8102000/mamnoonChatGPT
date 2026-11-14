import { useState, useEffect } from "react";
import { router } from "expo-router";
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

type DriverWallet = { balance: number; total_earned: number; total_commission: number };
type WalletTransaction = { id: string; type: string; created_at: string; amount: number };

export default function ProfileScreen() {
  const { user, profile, roles, signOut, refresh } = useAuth();
  const isProvider = roles.includes("worker") || roles.includes("driver") || roles.includes("large_driver");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [wallet, setWallet] = useState<DriverWallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);

  useEffect(() => {
    async function load() {
      if (roles.includes("driver") || roles.includes("large_driver")) {
        const { data } = await supabase
          .from("driver_wallets")
          .select("*")
          .eq("user_id", user?.id)
          .maybeSingle();
        setWallet(data);
        const { data: txns } = await supabase
          .from("transactions")
          .select("*")
          .eq("user_id", user?.id)
          .order("created_at", { ascending: false })
          .limit(10);
        setTransactions(txns || []);
      }
    }
    load();
  }, [user?.id, roles]);

  async function chooseAndUploadAvatar() {
    if (!user?.id || uploadingAvatar) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("إذن الصور", "اسمح لممنون بالوصول إلى الصور حتى تختار صورتك الشخصية.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.82,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setUploadingAvatar(true);
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const body = await response.arrayBuffer();
      const mime = asset.mimeType || "image/jpeg";
      const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      const path = `${user.id}/avatar-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, body, { contentType: mime, cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: data.publicUrl })
        .eq("id", user.id);
      if (updateError) throw updateError;
      await refresh();
      Alert.alert("تم", "تم حفظ صورتك الشخصية بنجاح.");
    } catch (error: any) {
      Alert.alert("تعذر رفع الصورة", error?.message || "تأكد من اتصال الإنترنت ثم حاول مرة ثانية.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSignOut() {
    Alert.alert("تسجيل الخروج", "هل أنت متأكد؟", [
      { text: "تراجع", style: "cancel" },
      {
        text: "خروج",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.replace("/auth");
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{(profile?.full_name || "؟")[0]}</Text>
          )}
        </View>
        {!isProvider && <TouchableOpacity style={styles.avatarButton} onPress={chooseAndUploadAvatar} disabled={uploadingAvatar}>
          {uploadingAvatar ? <ActivityIndicator color="#fff" /> : <Text style={styles.avatarButtonText}>📷 تغيير الصورة الشخصية</Text>}
        </TouchableOpacity>}
        <View style={styles.nameRow}>
          <Text style={styles.name}>{profile?.full_name || "مستخدم"}</Text>
          {roles.some((r) => r === "admin" || r === "super_admin") && (
            <View style={styles.adminVerifiedBadge}>
              <Text style={styles.adminVerifiedBadgeText}>✓ مسؤول ممنون موثق</Text>
            </View>
          )}
        </View>
        <Text style={styles.phone}>{profile?.phone}</Text>
      </View>
      <View style={styles.rolesRow}>
        {roles.filter((r) => ["customer", "driver", "large_driver", "worker"].includes(r)).map((r) => (
          <View key={r} style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>
              {r === "customer" ? "زبون" : r === "driver" ? "كابتن تكسي" : r === "large_driver" ? "سائق سيارات كبيرة" : "فني"}
            </Text>
          </View>
        ))}
      </View>
      {wallet && (
        <View style={styles.walletCard}>
          <Text style={styles.walletTitle}>محفظة السائق</Text>
          <Text style={styles.walletBalance}>{(wallet.balance || 0).toLocaleString("en")} د.ع</Text>
          <View style={styles.walletStats}>
            <View style={{ flex: 1 }}>
              <Text style={styles.walletStatLabel}>إجمالي الأرباح</Text>
              <Text style={styles.walletStatValue}>
                {(wallet.total_earned || 0).toLocaleString("en")} د.ع
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.walletStatLabel}>العمولة</Text>
              <Text style={styles.walletStatValue}>
                {(wallet.total_commission || 0).toLocaleString("en")} د.ع
              </Text>
            </View>
          </View>
        </View>
      )}
      {transactions.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>آخر العمليات</Text>
          {transactions.map((txn) => (
            <View key={txn.id} style={styles.txnCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.txnType}>
                  {txn.type === "earning" ? "أرباح" :
                    txn.type === "commission" ? "عمولة" :
                    txn.type === "withdrawal" ? "سحب" :
                    txn.type === "refund" ? "استرجاع" : "تسوية"}
                </Text>
                <Text style={styles.txnDate}>
                  {new Date(txn.created_at).toLocaleDateString("ar")}
                </Text>
              </View>
              <Text
                style={[styles.txnAmount, { color: txn.amount >= 0 ? "#16a34a" : "#dc2626" }]}
              >
                {txn.amount >= 0 ? "+" : "-"}
                {Math.abs(txn.amount || 0).toLocaleString("en")} د.ع
              </Text>
            </View>
          ))}
        </>
      )}
      <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/account-settings")}>
        <Text style={styles.menuItemText}>تبديل الدور وإعدادات الحساب</Text>
        <Text style={styles.menuArrow}>←</Text>
      </TouchableOpacity>
      {roles.includes("super_admin") && (
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/admin")}>
          <Text style={styles.menuItemText}>لوحة التحكم</Text>
          <Text style={styles.menuArrow}>←</Text>
        </TouchableOpacity>
      )}
      {!roles.includes("driver") && !roles.includes("large_driver") && (
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/onboarding/driver")}>
          <Text style={styles.menuItemText}>التسجيل ككابتن تكسي</Text>
          <Text style={styles.menuArrow}>←</Text>
        </TouchableOpacity>
      )}
      {!roles.includes("large_driver") && (
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push({ pathname: "/onboarding/driver", params: { providerType: "large_driver" } })}>
          <Text style={styles.menuItemText}>التسجيل كسائق سيارات كبيرة</Text>
          <Text style={styles.menuArrow}>←</Text>
        </TouchableOpacity>
      )}
      {!roles.includes("worker") && (
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/onboarding/worker")}>
          <Text style={styles.menuItemText}>التسجيل كفني</Text>
          <Text style={styles.menuArrow}>←</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={handleSignOut}>
        <Text style={[styles.menuItemText, { color: "#dc2626" }]}>تسجيل الخروج</Text>
        <Text style={[styles.menuArrow, { color: "#dc2626" }]}>←</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f8f5", paddingHorizontal: 20, paddingTop: 50 },
  header: { alignItems: "center", marginBottom: 24 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#0f766e",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  avatarText: { fontSize: 32, fontWeight: "900", color: "#fff" },
  avatarImage: { width: "100%", height: "100%", borderRadius: 40 },
  avatarButton: { backgroundColor: "#0f766e", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 12, minWidth: 190, alignItems: "center" },
  avatarButtonText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  name: { fontSize: 22, fontWeight: "800", color: "#1e293b" },
  nameRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 8 },
  adminVerifiedBadge: { backgroundColor: "#FDE68A", borderColor: "#D97706", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  adminVerifiedBadgeText: { color: "#78350F", fontSize: 11, fontWeight: "900" },
  phone: { fontSize: 14, color: "#64748b", marginTop: 4 },
  rolesRow: { flexDirection: "row", gap: 8, justifyContent: "center", marginBottom: 24 },
  roleBadge: {
    backgroundColor: "#0f766e10",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  roleBadgeText: { fontSize: 13, fontWeight: "700", color: "#0f766e" },
  walletCard: { backgroundColor: "#0f766e", borderRadius: 20, padding: 20, marginBottom: 24 },
  walletTitle: { fontSize: 14, color: "rgba(255,255,255,0.8)", fontWeight: "600" },
  walletBalance: { fontSize: 32, fontWeight: "900", color: "#fff", marginTop: 4 },
  walletStats: { flexDirection: "row", gap: 16, marginTop: 16 },
  walletStatLabel: { fontSize: 12, color: "rgba(255,255,255,0.7)" },
  walletStatValue: { fontSize: 16, fontWeight: "700", color: "#fff", marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#1e293b", marginBottom: 12 },
  txnCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  txnType: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  txnDate: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  txnAmount: { fontSize: 15, fontWeight: "800" },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
  },
  menuItemText: { fontSize: 16, fontWeight: "700", color: "#1e293b" },
  menuArrow: { fontSize: 20, color: "#94a3b8" },
});
