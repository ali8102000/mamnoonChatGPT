import { useState, useEffect } from "react";
import { router } from "expo-router";
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type DriverWallet = { balance: number; total_earned: number; total_commission: number };
type WalletTransaction = { id: string; type: string; created_at: string; amount: number };

export default function ProfileScreen() {
  const { user, profile, roles, signOut, refresh } = useAuth();
  const isProvider = roles.includes("worker") || roles.includes("driver") || roles.includes("large_driver");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [wallet, setWallet] = useState<DriverWallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [showWalletDetails, setShowWalletDetails] = useState(false);
  const [showRecentTransactions, setShowRecentTransactions] = useState(false);

  useEffect(() => {
    async function load() {
      if (roles.includes("driver") || roles.includes("large_driver")) {
        const { data } = await supabase
          .from("driver_wallets")
          .select("*")
          .eq("user_id", user?.id)
          .maybeSingle();
        setWallet(data);
        const since24Hours = new Date(Date.now() - 86400000).toISOString();
        const { data: txns } = await supabase
          .from("transactions")
          .select("*")
          .eq("user_id", user?.id)
          .gte("created_at", since24Hours)
          .order("created_at", { ascending: false });
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
          {uploadingAvatar ? <ActivityIndicator color="#fff" /> : <Text style={styles.avatarButtonText}>تغيير الصورة الشخصية</Text>}
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
          <Text style={styles.walletTitle}>أرباحي</Text>
          <Text style={styles.walletBalance}>{(wallet.balance || 0).toLocaleString("en")} د.ع</Text>
          <TouchableOpacity style={styles.walletDetailsButton} onPress={() => setShowWalletDetails((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showWalletDetails }}>
            <Text style={styles.walletDetailsButtonText}>{showWalletDetails ? "إخفاء التفاصيل" : "تفاصيل المحفظة"}</Text>
            <Text style={styles.walletDetailsArrow}>{showWalletDetails ? "⌄" : "←"}</Text>
          </TouchableOpacity>
          {showWalletDetails && (
            <View style={styles.walletDetails}>
              <View style={styles.walletStats}>
                <View style={{ flex: 1 }}><Text style={styles.walletStatLabel}>إجمالي الأرباح</Text><Text style={styles.walletStatValue}>{(wallet.total_earned || 0).toLocaleString("en")} د.ع</Text></View>
                <View style={{ flex: 1 }}><Text style={styles.walletStatLabel}>العمولة</Text><Text style={styles.walletStatValue}>{(wallet.total_commission || 0).toLocaleString("en")} د.ع</Text></View>
              </View>
              <TouchableOpacity style={styles.recentTransactionsButton} onPress={() => setShowRecentTransactions((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showRecentTransactions }}>
                <Text style={styles.recentTransactionsText}>آخر الحركات · آخر ٢٤ ساعة</Text>
                <Text style={styles.walletDetailsArrow}>{showRecentTransactions ? "⌄" : "←"}</Text>
              </TouchableOpacity>
              {showRecentTransactions && (
                <View style={styles.recentTransactionsList}>
                  {transactions.length === 0 ? <Text style={styles.emptyTransactions}>ماكو حركات مالية خلال آخر ٢٤ ساعة</Text> : transactions.map((txn) => (
                    <View key={txn.id} style={styles.txnCard}>
                      <View style={{ flex: 1 }}><Text style={styles.txnType}>{txn.type === "earning" ? "أرباح" : txn.type === "commission" ? "عمولة" : txn.type === "withdrawal" ? "سحب" : txn.type === "refund" ? "استرجاع" : "تسوية"}</Text><Text style={styles.txnDate}>{new Date(txn.created_at).toLocaleString("ar-IQ")}</Text></View>
                      <Text style={[styles.txnAmount, { color: txn.amount >= 0 ? "#16a34a" : "#dc2626" }]}>{txn.amount >= 0 ? "+" : "-"}{Math.abs(txn.amount || 0).toLocaleString("en")} د.ع</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      )}
      {isProvider && <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/subscriptions" as any)}>
        <Text style={styles.menuItemText}>اشتراكات ممنون وامتيازات الباقة</Text>
        <Text style={styles.menuArrow}>←</Text>
      </TouchableOpacity>}
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
  container: { flex: 1, backgroundColor: palette.canvas, paddingHorizontal: space.xl, paddingTop: 54 },
  header: { alignItems: "center", marginBottom: 20, backgroundColor: palette.surface, borderRadius: radius.xl, padding: space.xl, borderWidth: 1, borderColor: palette.line },
  avatar: { width: 84, height: 84, borderRadius: 28, backgroundColor: palette.brand, borderWidth: 1, borderColor: palette.gold, alignItems: "center", justifyContent: "center", marginBottom: 12, overflow: "hidden" },
  avatarText: { fontSize: 32, fontWeight: "900", color: palette.white },
  avatarImage: { width: "100%", height: "100%", borderRadius: 27 },
  avatarButton: { backgroundColor: palette.brandSoft, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 12, minWidth: 190, alignItems: "center" },
  avatarButtonText: { color: palette.brand, fontSize: 12, fontWeight: "900" },
  name: { fontSize: 22, fontWeight: "900", color: palette.ink },
  nameRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 8 },
  adminVerifiedBadge: { backgroundColor: palette.goldSoft, borderColor: palette.gold, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  adminVerifiedBadgeText: { color: palette.brandDeep, fontSize: 10, fontWeight: "900" },
  phone: { fontSize: 13, color: palette.muted, marginTop: 5 },
  rolesRow: { flexDirection: "row", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 },
  roleBadge: { backgroundColor: palette.brandSoft, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  roleBadgeText: { fontSize: 11, fontWeight: "900", color: palette.brand },
  walletCard: { backgroundColor: palette.brand, borderRadius: radius.xl, padding: 22, marginBottom: 22, borderWidth: 1, borderColor: palette.gold },
  walletTitle: { fontSize: 13, color: "rgba(255,255,255,0.78)", fontWeight: "800" },
  walletBalance: { fontSize: 32, fontWeight: "900", color: palette.white, marginTop: 6 },
  walletStats: { flexDirection: "row", gap: 16, marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.18)" },
  walletDetailsButton: { marginTop: 18, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.14)", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  walletDetailsButtonText: { color: palette.white, fontSize: 13, fontWeight: "900" },
  walletDetailsArrow: { color: palette.white, fontSize: 18, fontWeight: "900" },
  walletDetails: { marginTop: 10 },
  recentTransactionsButton: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.14)", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recentTransactionsText: { color: palette.white, fontSize: 12, fontWeight: "900" },
  recentTransactionsList: { marginTop: 10, gap: 8 },
  emptyTransactions: { color: "rgba(255,255,255,0.8)", fontSize: 12, textAlign: "center", paddingVertical: 14 },
  walletStatLabel: { fontSize: 11, color: "rgba(255,255,255,0.72)" },
  walletStatValue: { fontSize: 15, fontWeight: "900", color: palette.white, marginTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: "900", color: palette.ink, marginBottom: 12 },
  txnCard: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.md, padding: 15, marginBottom: 9, borderWidth: 1, borderColor: palette.line },
  txnType: { fontSize: 13, fontWeight: "900", color: palette.ink },
  txnDate: { fontSize: 11, color: palette.muted, marginTop: 4 },
  txnAmount: { fontSize: 14, fontWeight: "900" },
  menuItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 17, marginBottom: 9 },
  menuItemText: { fontSize: 14, fontWeight: "800", color: palette.ink },
  menuArrow: { fontSize: 20, color: palette.gold },
});
