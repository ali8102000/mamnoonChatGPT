import { useState, useEffect } from "react";
import { router } from "expo-router";
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Linking } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type AccountWallet = { balance_iqd: number; currency?: string };
type DriverWallet = { balance: number; total_earned: number; total_commission: number };
type WalletTransaction = { id: string; type: string; created_at: string; amount: number };
type EarningsSummary = { last24h: number; week: number; month: number; year: number };

function getProviderEarningsQueryStart(): string {
  const now = new Date();
  const last24h = now.getTime() - 86400000;
  const week = new Date(now);
  week.setHours(0, 0, 0, 0);
  week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const year = new Date(now.getFullYear(), 0, 1);
  return new Date(Math.min(last24h, week.getTime(), month.getTime(), year.getTime())).toISOString();
}

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
  const [accountWallet, setAccountWallet] = useState<AccountWallet | null>(null);
  const [accountWalletTransactions, setAccountWalletTransactions] = useState<any[]>([]);
  const [accountWalletOffline, setAccountWalletOffline] = useState(false);
  const [walletTopupLoading, setWalletTopupLoading] = useState(false);
  const [showRecentTransactions, setShowRecentTransactions] = useState(false);
  const [providerEarnings, setProviderEarnings] = useState<EarningsSummary>({ last24h: 0, week: 0, month: 0, year: 0 });
  const [providerWallet, setProviderWallet] = useState<DriverWallet | null>(null);
  const [providerTransactions, setProviderTransactions] = useState<WalletTransaction[]>([]);
  const [providerWalletOffline, setProviderWalletOffline] = useState(false);
  const [showProviderEarningsDetails, setShowProviderEarningsDetails] = useState(false);
  const [staffRank, setStaffRank] = useState<string | null>(null);
  const isGeneralManager = staffRank === "general_manager";
  void providerWallet;
  void providerTransactions;
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
    const loadAccountWallet = async () => {
      if (!user?.id) {
        setAccountWallet(null);
        setAccountWalletTransactions([]);
        return;
      }
      try {
        const { data, error } = await (supabase as any).rpc("get_my_account_wallet");
        if (error) throw error;
        if (!active) return;
        setAccountWallet(data?.wallet ?? null);
        setAccountWalletTransactions(Array.isArray(data?.transactions) ? data.transactions : []);
        setAccountWalletOffline(false);
      } catch (error) {
        console.warn("[wallet] Universal account wallet unavailable:", error);
        if (!active) return;
        setAccountWallet(null);
        setAccountWalletTransactions([]);
        setAccountWalletOffline(true);
      }
    };
    void loadAccountWallet();
    if (!user?.id) return () => { active = false; };
    const channel = supabase.channel(`account-wallet-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "account_wallets", filter: `user_id=eq.${user.id}` }, () => { void loadAccountWallet(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "account_wallet_transactions", filter: `user_id=eq.${user.id}` }, () => { void loadAccountWallet(); })
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [user?.id]);

  async function handleWalletTopup(amountIQD: number) {
    if (walletTopupLoading) return;
    setWalletTopupLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("zaincash-create-payment", {
        body: { purpose: "wallet_topup", amountIQD },
      });
      if (error) throw error;
      if (!data?.redirectUrl) throw new Error(data?.error || "تعذر إنشاء رابط الدفع");
      await Linking.openURL(data.redirectUrl);
    } catch (error: any) {
      Alert.alert("تعذر بدء الشحن", error?.message || "تأكد من تفعيل بوابة زين كاش ثم حاول مرة ثانية.");
    } finally {
      setWalletTopupLoading(false);
    }
  }

  function chooseWalletTopup() {
    Alert.alert("شحن محفظة ممنون", "اختار مبلغ الشحن بالدينار العراقي", [
      { text: "٥٬٠٠٠ د.ع", onPress: () => { void handleWalletTopup(5000); } },
      { text: "١٠٬٠٠٠ د.ع", onPress: () => { void handleWalletTopup(10000); } },
      { text: "٢٥٬٠٠٠ د.ع", onPress: () => { void handleWalletTopup(25000); } },
    ]);
  }

  useEffect(() => {
    let active = true;
    async function loadProviderEarnings() {
      if (!user?.id || !isProvider) {
        setProviderEarnings({ last24h: 0, week: 0, month: 0, year: 0 });
        setProviderWallet(null);
        setProviderTransactions([]);
        setProviderWalletOffline(false);
        return;
      }
      const cacheKey = `mamnoon-wallet-v1:${user.id}`;
      try {
        const earningsStart = getProviderEarningsQueryStart();
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
            .gte("created_at", earningsStart).order("created_at", { ascending: true })
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
    void loadProviderEarnings();
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
      {isProvider ? (
        <View style={styles.walletEarningsRow}>
          <View style={[styles.walletCard, styles.compactWalletCard]}>
            {accountWalletOffline && <View style={styles.walletOfflineNotice}><Text style={styles.walletOfflineText}>تعذر تحديث الرصيد من الخادم حالياً.</Text></View>}
            <Text style={styles.walletTitle}>💳 محفظتي</Text>
            <Text style={styles.compactWalletBalance}>{(accountWallet?.balance_iqd || 0).toLocaleString("en")} د.ع</Text>
            <TouchableOpacity style={styles.compactDetailsButton} onPress={chooseWalletTopup} disabled={walletTopupLoading}>
              <Text style={styles.walletDetailsButtonText}>{walletTopupLoading ? "جارٍ التجهيز..." : "شحن عبر زين كاش"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.compactDetailsButton} onPress={() => setShowRecentTransactions((v) => !v)}>
              <Text style={styles.walletDetailsButtonText}>{showRecentTransactions ? "إخفاء الحركات" : "سجل الحركات"}</Text>
            </TouchableOpacity>
            {showRecentTransactions && (
              <View style={styles.walletDetails}>
                {accountWalletTransactions.length === 0 ? <Text style={styles.emptyTransactions}>لا توجد حركات مالية حالياً</Text> : accountWalletTransactions.map((txn) => (
                  <View key={txn.id} style={styles.txnCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txnType}>{txn.type === "zaincash_topup" || txn.type === "topup" ? "شحن رصيد" : txn.type === "payment" ? "دفع" : txn.type === "deduction" ? "استقطاع" : txn.type === "refund" ? "استرجاع" : txn.type}</Text>
                      <Text style={styles.txnDate}>{new Date(txn.created_at).toLocaleString("ar-IQ")}</Text>
                    </View>
                    <Text style={[styles.txnAmount, { color: Number(txn.amount_iqd) >= 0 ? "#16a34a" : "#dc2626" }]}>{Number(txn.amount_iqd) >= 0 ? "+" : "-"}{Math.abs(Number(txn.amount_iqd) || 0).toLocaleString("en")} د.ع</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          <View style={[styles.walletCard, styles.compactEarningsCard]}>
            {providerWalletOffline && <View style={styles.walletOfflineNotice}><Text style={styles.walletOfflineText}>بيانات الأرباح المحفوظة معروضة مؤقتاً وقد لا تكون محدثة.</Text></View>}
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
      ) : (
        <View style={[styles.walletCard, styles.customerWalletCard]}>
          {accountWalletOffline && <View style={styles.walletOfflineNotice}><Text style={styles.walletOfflineText}>تعذر تحديث الرصيد من الخادم حالياً.</Text></View>}
          <Text style={styles.walletTitle}>💳 محفظتي</Text>
          <Text style={styles.compactWalletBalance}>{(accountWallet?.balance_iqd || 0).toLocaleString("en")} د.ع</Text>
          <TouchableOpacity style={styles.compactDetailsButton} onPress={chooseWalletTopup} disabled={walletTopupLoading}>
            <Text style={styles.walletDetailsButtonText}>{walletTopupLoading ? "جارٍ التجهيز..." : "شحن المحفظة عبر زين كاش"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.compactDetailsButton} onPress={() => setShowRecentTransactions((v) => !v)}>
            <Text style={styles.walletDetailsButtonText}>{showRecentTransactions ? "إخفاء سجل الحركات" : "سجل حركات المحفظة"}</Text>
          </TouchableOpacity>
          {showRecentTransactions && (
            <View style={styles.walletDetails}>
              {accountWalletTransactions.length === 0 ? <Text style={styles.emptyTransactions}>لا توجد حركات مالية حالياً</Text> : accountWalletTransactions.map((txn) => (
                <View key={txn.id} style={styles.txnCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txnType}>{txn.type === "zaincash_topup" || txn.type === "topup" ? "شحن رصيد" : txn.type === "payment" ? "دفع من المحفظة" : txn.type === "deduction" ? "استقطاع" : txn.type === "refund" ? "استرجاع مبلغ" : txn.type}</Text>
                    <Text style={styles.txnDate}>{new Date(txn.created_at).toLocaleString("ar-IQ")}</Text>
                  </View>
                  <Text style={[styles.txnAmount, { color: Number(txn.amount_iqd) >= 0 ? "#16a34a" : "#dc2626" }]}>{Number(txn.amount_iqd) >= 0 ? "+" : "-"}{Math.abs(Number(txn.amount_iqd) || 0).toLocaleString("en")} د.ع</Text>
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
