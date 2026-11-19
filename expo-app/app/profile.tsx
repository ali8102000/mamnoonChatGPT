import { useState, useEffect } from "react";
import { router } from "expo-router";
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type CustomerWallet = { balance: number; currency?: string };
type DriverWallet = { balance: number; total_earned: number; total_commission: number };
type WalletTransaction = { id: string; type: string; created_at: string; amount: number };
type EarningsSummary = { last24h: number; week: number; month: number; year: number };

function summarizeProviderEarnings(rows: WalletTransaction[]): EarningsSummary {
  const now = new Date();
  const last24hStart = now.getTime() - 86400000;
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const sumSince = (start: number) => rows.reduce((sum, row) => {
    const createdAt = Date.parse(row.created_at);
    return row.type === "earning" && Number.isFinite(createdAt) && createdAt >= start
      ? sum + Number(row.amount || 0)
      : sum;
  }, 0);
  return {
    last24h: sumSince(last24hStart),
    week: sumSince(weekStart.getTime()),
    month: sumSince(monthStart.getTime()),
    year: sumSince(yearStart.getTime()),
  };
}

export default function ProfileScreen() {
  const { user, profile, roles, activeRole, signOut, refresh } = useAuth();
  const isProvider = activeRole !== "customer" && (roles.includes("worker") || roles.includes("driver") || roles.includes("large_driver"));
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [wallet, setWallet] = useState<CustomerWallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [showWalletDetails, setShowWalletDetails] = useState(false);
  const [showRecentTransactions, setShowRecentTransactions] = useState(false);
  const [walletOffline, setWalletOffline] = useState(false);
  const [providerWallet, setProviderWallet] = useState<DriverWallet | null>(null);
  const [providerTransactions, setProviderTransactions] = useState<WalletTransaction[]>([]);
  const [providerEarnings, setProviderEarnings] = useState<EarningsSummary>({ last24h: 0, week: 0, month: 0, year: 0 });
  const [showProviderEarningsDetails, setShowProviderEarningsDetails] = useState(false);
  const [showProviderWalletDetails, setShowProviderWalletDetails] = useState(false);
  const [showProviderRecentTransactions, setShowProviderRecentTransactions] = useState(false);
  const [providerWalletOffline, setProviderWalletOffline] = useState(false);
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
        const { data, error } = await (supabase as any).rpc("get_my_customer_wallet");
        if (error) throw error;
        const nextWallet = (data?.wallet ?? null) as CustomerWallet | null;
        const nextTransactions = (Array.isArray(data?.transactions) ? data.transactions : []) as WalletTransaction[];
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

  useEffect(() => {
    let active = true;
    async function loadProviderWallet() {
      if (!user?.id || !isProvider) {
        setProviderWallet(null);
        setProviderTransactions([]);
        setProviderEarnings({ last24h: 0, week: 0, month: 0, year: 0 });
        setProviderWalletOffline(false);
        return;
      }
      const cacheKey = `mamnoon-wallet-v1:${user.id}`;
      try {
        const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
        const since24Hours = new Date(Date.now() - 86400000).toISOString();
        const [walletResult, recentResult] = await Promise.all([
          supabase.from("driver_wallets").select("balance,total_earned,total_commission").eq("user_id", user.id).maybeSingle(),
          supabase.from("transactions").select("id,type,created_at,amount").eq("user_id", user.id)
            .gte("created_at", since24Hours).order("created_at", { ascending: false }).limit(30),
        ]);
        if (walletResult.error) throw walletResult.error;
        if (recentResult.error) throw recentResult.error;

        const earningsRows: WalletTransaction[] = [];
        let offset = 0;
        while (true) {
          const { data, error } = await supabase.from("transactions")
            .select("id,type,created_at,amount").eq("user_id", user.id).eq("type", "earning")
            .gte("created_at", yearStart).order("created_at", { ascending: true })
            .range(offset, offset + 999);
          if (error) throw error;
          const page = (data || []) as WalletTransaction[];
          earningsRows.push(...page);
          if (page.length < 1000) break;
          offset += 1000;
        }
        const nextWallet = walletResult.data as DriverWallet | null;
        const nextTransactions = (recentResult.data || []) as WalletTransaction[];
        const nextEarnings = summarizeProviderEarnings(earningsRows);
        if (!active) return;
        setProviderWallet(nextWallet);
        setProviderTransactions(nextTransactions);
        setProviderEarnings(nextEarnings);
        setProviderWalletOffline(false);
        try {
          await SecureStore.setItemAsync(cacheKey, JSON.stringify({
            wallet: nextWallet, transactions: nextTransactions, earnings: nextEarnings, cachedAt: Date.now(),
          }));
        } catch (cacheError) {
          console.warn("[offline] Could not save provider wallet snapshot:", cacheError);
        }
      } catch (error) {
        console.warn("[offline] Provider wallet unavailable; restoring saved wallet snapshot.", error);
        try {
          const raw = await SecureStore.getItemAsync(cacheKey);
          const saved = raw ? JSON.parse(raw) : null;
          if (!active) return;
          setProviderWallet(saved?.wallet ?? null);
          setProviderTransactions(Array.isArray(saved?.transactions) ? saved.transactions : []);
          setProviderEarnings(saved?.earnings ?? { last24h: 0, week: 0, month: 0, year: 0 });
        } catch {
          if (!active) return;
          setProviderWallet(null);
          setProviderTransactions([]);
          setProviderEarnings({ last24h: 0, week: 0, month: 0, year: 0 });
        }
        if (active) setProviderWalletOffline(true);
      }
    }
    void loadProviderWallet();
    return () => { active = false; };
  }, [user?.id, isProvider]);

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
      {isProvider && (
        <View style={styles.walletEarningsRow}>
          <View style={[styles.walletCard, styles.compactWalletCard]}>
            {providerWalletOffline && <View style={styles.walletOfflineNotice}><Text style={styles.walletOfflineText}>بيانات محفوظة وقد لا تكون محدثة.</Text></View>}
            <Text style={styles.walletTitle}>💳 محفظتي</Text>
            <Text style={styles.compactWalletBalance}>{(providerWallet?.balance || 0).toLocaleString("en")} د.ع</Text>
            <TouchableOpacity style={styles.compactDetailsButton} onPress={() => setShowProviderWalletDetails((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showProviderWalletDetails }}>
              <Text style={styles.walletDetailsButtonText}>{showProviderWalletDetails ? "إخفاء" : "تفاصيل المحفظة"}</Text>
              <Text style={styles.walletDetailsArrow}>{showProviderWalletDetails ? "⌄" : "←"}</Text>
            </TouchableOpacity>
            {showProviderWalletDetails && (
              <View style={styles.walletDetails}>
                <View style={styles.walletStats}>
                  <View style={{ flex: 1 }}><Text style={styles.walletStatLabel}>إجمالي الأرباح</Text><Text style={styles.walletStatValue}>{(providerWallet?.total_earned || 0).toLocaleString("en")} د.ع</Text></View>
                  <View style={{ flex: 1 }}><Text style={styles.walletStatLabel}>العمولة</Text><Text style={styles.walletStatValue}>{(providerWallet?.total_commission || 0).toLocaleString("en")} د.ع</Text></View>
                </View>
                <TouchableOpacity style={styles.recentTransactionsButton} onPress={() => setShowProviderRecentTransactions((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showProviderRecentTransactions }}>
                  <Text style={styles.recentTransactionsText}>حركات آخر ٢٤ ساعة</Text>
                  <Text style={styles.walletDetailsArrow}>{showProviderRecentTransactions ? "⌄" : "←"}</Text>
                </TouchableOpacity>
                {showProviderRecentTransactions && (
                  <View style={styles.recentTransactionsList}>
                    {providerTransactions.length === 0 ? <Text style={styles.emptyTransactions}>ماكو حركات مالية خلال آخر ٢٤ ساعة</Text> : providerTransactions.map((txn) => (
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
          <View style={[styles.walletCard, styles.compactEarningsCard]}>
            <Text style={styles.walletTitle}>أرباحي · آخر ٢٤ ساعة</Text>
            <Text style={styles.compactWalletBalance}>{providerEarnings.last24h.toLocaleString("en")} د.ع</Text>
            <TouchableOpacity style={styles.compactDetailsButton} onPress={() => setShowProviderEarningsDetails((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showProviderEarningsDetails }}>
              <Text style={styles.walletDetailsButtonText}>{showProviderEarningsDetails ? "إخفاء" : "تفاصيل الأرباح"}</Text>
              <Text style={styles.walletDetailsArrow}>{showProviderEarningsDetails ? "⌄" : "←"}</Text>
            </TouchableOpacity>
            {showProviderEarningsDetails && (
              <View style={styles.earningsDetails}>
                <View style={styles.earningsPeriod}><Text style={styles.earningsPeriodLabel}>هذا الأسبوع</Text><Text style={styles.earningsPeriodValue}>{providerEarnings.week.toLocaleString("en")} د.ع</Text></View>
                <View style={styles.earningsPeriod}><Text style={styles.earningsPeriodLabel}>هذا الشهر</Text><Text style={styles.earningsPeriodValue}>{providerEarnings.month.toLocaleString("en")} د.ع</Text></View>
                <View style={styles.earningsPeriod}><Text style={styles.earningsPeriodLabel}>هذه السنة</Text><Text style={styles.earningsPeriodValue}>{providerEarnings.year.toLocaleString("en")} د.ع</Text></View>
              </View>
            )}
          </View>
        </View>
      )}
      {activeRole === "customer" && (
        <View style={[styles.walletCard, styles.customerWalletCard]}>
          {walletOffline && <View style={styles.walletOfflineNotice}><Text style={styles.walletOfflineText}>بيانات محفوظة من آخر اتصال وقد لا تكون محدثة.</Text></View>}
          <Text style={styles.walletTitle}>💳 محفظتي</Text>
          <Text style={styles.compactWalletBalance}>{(wallet?.balance || 0).toLocaleString("en")} د.ع</Text>
          <Text style={styles.walletPendingNotice}>شحن الرصيد والسحب عبر زين كاش يتفعّلان بعد ربط مفاتيح التاجر الرسمية.</Text>
          <TouchableOpacity style={styles.compactDetailsButton} onPress={() => setShowWalletDetails((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showWalletDetails }}>
            <Text style={styles.walletDetailsButtonText}>{showWalletDetails ? "إخفاء التفاصيل" : "سجل حركات المحفظة"}</Text>
            <Text style={styles.walletDetailsArrow}>{showWalletDetails ? "⌄" : "←"}</Text>
          </TouchableOpacity>
          {showWalletDetails && (
            <View style={styles.walletDetails}>
              {transactions.length === 0 ? <Text style={styles.emptyTransactions}>لا توجد حركات مسجلة في المحفظة حالياً</Text> : transactions.map((txn) => (
                <View key={txn.id} style={styles.txnCard}>
                  <View style={{ flex: 1 }}><Text style={styles.txnType}>{txn.type === "deposit" ? "إيداع رصيد" : txn.type === "withdrawal" ? "سحب" : txn.type === "payment" ? "دفع من المحفظة" : txn.type === "refund" ? "استرجاع مبلغ" : txn.type === "adjustment" ? "تسوية رصيد" : txn.type}</Text><Text style={styles.txnDate}>{new Date(txn.created_at).toLocaleString("ar-IQ")}</Text></View>
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
      {activeRole === "customer" && <TouchableOpacity style={styles.menuItem} onPress={() => router.push("/coupons")}><Text style={styles.menuItemText}>كوبوناتي والعروض</Text><Text style={styles.menuArrow}>←</Text></TouchableOpacity>}
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
  walletEarningsRow: { flexDirection: "row-reverse", gap: 10, marginBottom: 18, alignItems: "flex-start" },
  walletCard: { backgroundColor: palette.brand, borderRadius: radius.xl, padding: 22, marginBottom: 22, borderWidth: 1, borderColor: palette.gold },
  compactWalletCard: { flex: 1, minWidth: 0, padding: 13, marginBottom: 0 },
  compactEarningsCard: { flex: 1, minWidth: 0, padding: 13, marginBottom: 0, backgroundColor: "#176B57" },
  customerWalletCard: { padding: 16, marginBottom: 18 },
  walletTitle: { fontSize: 11, color: "rgba(255,255,255,0.78)", fontWeight: "800" },
  walletBalance: { fontSize: 32, fontWeight: "900", color: palette.white, marginTop: 6 },
  compactWalletBalance: { fontSize: 20, lineHeight: 27, fontWeight: "900", color: palette.white, marginTop: 6, textAlign: "right" },
  compactDetailsButton: { marginTop: 10, paddingVertical: 9, paddingHorizontal: 8, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.14)", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  earningsDetails: { marginTop: 10, gap: 8 },
  earningsPeriod: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 10, padding: 8 },
  earningsPeriodLabel: { color: "rgba(255,255,255,0.75)", fontSize: 10, fontWeight: "700", textAlign: "right" },
  earningsPeriodValue: { color: palette.white, fontSize: 13, fontWeight: "900", textAlign: "right", marginTop: 3 },
  walletPendingNotice: { color: "rgba(255,255,255,0.75)", fontSize: 10, lineHeight: 16, textAlign: "right", marginTop: 8 },
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
