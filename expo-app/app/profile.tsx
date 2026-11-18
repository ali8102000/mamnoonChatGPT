import { useState, useEffect } from "react";
import { router } from "expo-router";
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type DriverWallet = { balance: number; currency?: string };
type WalletTransaction = { id: string; type: string; created_at: string; amount: number };

export default function ProfileScreen() {
  const { user, profile, roles, activeRole, signOut, refresh } = useAuth();
  const isProvider = activeRole !== "customer" && (roles.includes("worker") || roles.includes("driver") || roles.includes("large_driver"));
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [wallet, setWallet] = useState<DriverWallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [showWalletDetails, setShowWalletDetails] = useState(false);
  const [showRecentTransactions, setShowRecentTransactions] = useState(false);
  const [walletOffline, setWalletOffline] = useState(false);
  const [staffRank, setStaffRank] = useState<string | null>(null);
  const isGeneralManager = staffRank === "general_manager";
  const hasStaffRank = ["general_manager", "department_manager", "supervisor"].includes(staffRank ?? "");

  useEffect(() => {
    let active = true;
    async function loadStaffRank() {
      if (!user?.id) {
        setStaffRank(null);
        return;
      }
      const { data, error } = await (supabase as any)
        .from("staff_assignments")
        .select("rank")
        .eq("user_id", user.id)
        .eq("active", true)
        .maybeSingle();
      if (active) setStaffRank(!error && data?.rank ? String(data.rank) : null);
    }
    void loadStaffRank();
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user?.id || activeRole !== "customer") {
        setWallet(null);
        setTransactions([]);
        setWalletOffline(false);
        return;
      }
      const cacheKey = `mamnoon-customer-wallet-v2:${user.id}`;
      try {
        const [walletResult, transactionResult] = await Promise.all([
          supabase
            .from("driver_wallets")
            .select("balance,currency")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("transactions")
            .select("id,type,created_at,amount")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(30),
        ]);
        if (walletResult.error) throw walletResult.error;
        if (transactionResult.error) throw transactionResult.error;
        const nextWallet = walletResult.data as DriverWallet | null;
        const nextTransactions = (transactionResult.data || []) as WalletTransaction[];
        if (!active) return;
        setWallet(nextWallet);
        setTransactions(nextTransactions);
        setWalletOffline(false);
        try {
          await SecureStore.setItemAsync(cacheKey, JSON.stringify({
            wallet: nextWallet,
            transactions: nextTransactions,
            cachedAt: Date.now(),
          }));
        } catch (cacheError) {
          console.warn("[offline] Could not save wallet snapshot:", cacheError);
        }
      } catch (error) {
        console.warn("[offline] Wallet unavailable; restoring saved wallet snapshot.", error);
        try {
          const raw = await SecureStore.getItemAsync(cacheKey);
          const saved = raw ? JSON.parse(raw) : null;
          if (!active) return;
          setWallet(saved?.wallet ?? null);
          setTransactions(Array.isArray(saved?.transactions) ? saved.transactions : []);
        } catch {
          if (!active) return;
          setWallet(null);
          setTransactions([]);
        }
        if (active) setWalletOffline(true);
      }
    }
    void load();
    return () => { active = false; };
  }, [user?.id, activeRole]);

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
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 104 }}>
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
      {activeRole === "customer" && (
        <View style={styles.walletCard}>
          {walletOffline && (
            <View style={styles.walletOfflineNotice}>
              <Text style={styles.walletOfflineText}>بيانات محفوظة من آخر اتصال وقد لا تكون محدثة.</Text>
            </View>
          )}
          <Text style={styles.walletTitle}>محفظتي</Text>
          <Text style={styles.walletBalance}>{(wallet?.balance || 0).toLocaleString("en")} د.ع</Text>
          <Text style={{ color: palette.muted, fontSize: 11, lineHeight: 18, textAlign: "center", marginTop: 8 }}>شحن الرصيد والسحب عبر زين كاش سيتفعّلان بعد ربط مفاتيح التاجر الرسمية.</Text>
          <TouchableOpacity style={styles.walletDetailsButton} onPress={() => setShowWalletDetails((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showWalletDetails }}>
            <Text style={styles.walletDetailsButtonText}>{showWalletDetails ? "إخفاء التفاصيل" : "سجل حركات المحفظة"}</Text>
            <Text style={styles.walletDetailsArrow}>{showWalletDetails ? "⌄" : "←"}</Text>
          </TouchableOpacity>
          {showWalletDetails && (
            <View style={styles.walletDetails}>
              {transactions.length === 0 ? <Text style={styles.emptyTransactions}>لا توجد حركات مسجلة في المحفظة حالياً</Text> : transactions.map((txn) => (
                <View key={txn.id} style={styles.txnCard}>
                  <View style={{ flex: 1 }}><Text style={styles.txnType}>{txn.type === "earning" ? "إضافة رصيد" : txn.type === "withdrawal" ? "سحب" : txn.type === "refund" ? "استرجاع" : txn.type === "adjustment" ? "تسوية رصيد" : txn.type}</Text><Text style={styles.txnDate}>{new Date(txn.created_at).toLocaleString("ar-IQ")}</Text></View>
                  <Text style={[styles.txnAmount, { color: txn.amount >= 0 ? "#16a34a" : "#dc2626" }]}>{txn.amount >= 0 ? "+" : "-"}{Math.abs(txn.amount || 0).toLocaleString("en")} د.ع</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
      {isProvider && <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/subscriptions" as any)}>
        <Text style={styles.menuItemText}>اشتراكات ممنون وامتيازات الباقة</Text>
        <Text style={styles.menuArrow}>←</Text>
      </TouchableOpacity>}
      <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/coupons")}><Text style={styles.menuItemText}>كوبوناتي والعروض</Text><Text style={styles.menuArrow}>←</Text></TouchableOpacity>
      <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/support")}><Text style={styles.menuItemText}>الدعم الفني والتذاكر</Text><Text style={styles.menuArrow}>←</Text></TouchableOpacity>
      <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/privacy")}><Text style={styles.menuItemText}>سياسة الخصوصية</Text><Text style={styles.menuArrow}>←</Text></TouchableOpacity>
      <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/terms")}><Text style={styles.menuItemText}>الشروط والأحكام</Text><Text style={styles.menuArrow}>←</Text></TouchableOpacity>
      <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/account-settings")}>
        <Text style={styles.menuItemText}>الإعدادات وسجّل معنا</Text>
        <Text style={styles.menuArrow}>←</Text>
      </TouchableOpacity>
      {(roles.some((role) => ["super_admin", "admin", "support", "finance", "moderator"].includes(role)) || hasStaffRank) && (
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/admin/staff" as any)}>
          <Text style={styles.menuItemText}>مركز إدارة ممنون</Text>
          <Text style={styles.menuArrow}>←</Text>
        </TouchableOpacity>
      )}
      {isGeneralManager && (
        <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/support-chat" as any)}>
          <Text style={styles.menuItemText}>متابعة الشكاوى ومراسلات ممنون</Text>
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
  container: { flex: 1, backgroundColor: palette.pageCanvas, paddingHorizontal: space.xl, paddingTop: 54 },
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
  walletOfflineNotice: { padding: 9, borderRadius: 10, backgroundColor: palette.goldSoft, marginBottom: 10 },
  walletOfflineText: { color: palette.ink, fontSize: 10, fontWeight: "700", textAlign: "right" },
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
