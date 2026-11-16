import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type UserRow = { id: string; full_name: string | null; phone: string | null; email: string | null };
type Coupon = { id: string; code: string; type: string; value: number; max_uses: number; used_count?: number; active: boolean; expires_at?: string | null; min_amount?: number };
type Tx = { id: string; user_id: string; amount: number; type: string; status: string; created_at: string; profiles?: { full_name?: string; phone?: string } };
type Tab = "wallet" | "coupons" | "transactions";

export default function AdminFinanceScreen() {
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [tab, setTab] = useState<Tab>("wallet");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"credit" | "debit">("credit");
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [code, setCode] = useState("");
  const [couponType, setCouponType] = useState<"percentage" | "fixed">("percentage");
  const [value, setValue] = useState("");
  const [maxUses, setMaxUses] = useState("100");
  const [minAmount, setMinAmount] = useState("0");
  const [target, setTarget] = useState("customers");
  const [busy, setBusy] = useState(false);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("admin-finance", { body });
    if (error) throw new Error(error.message || "تعذر الاتصال بخدمة الإدارة المالية");
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError("");
    try {
      const [financeAccess, admin] = await Promise.all([
        supabase.rpc("has_subscription_admin_access", { p_user_id: user.id }),
        supabase.rpc("has_admin_access", { p_user_id: user.id }),
      ]);
      if (financeAccess.error || financeAccess.data !== true) { setAllowed(false); return; }
      setAllowed(true);
      setCanManage(admin.data === true);
      const data = await invoke({ action: "list" });
      setCoupons(data.coupons ?? []);
      setTransactions(data.transactions ?? []);
    } catch (e: any) {
      setError(String(e?.message || "تعذر تحميل البيانات"));
    } finally { setLoading(false); }
  }, [user?.id, invoke]);

  useEffect(() => {
    if (!authLoading) {
      if (!user) { setAllowed(false); setLoading(false); }
      else void load();
    }
  }, [authLoading, user, load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const searchUsers = async () => {
    if (query.trim().length < 2) { Alert.alert("البحث", "اكتب حرفين أو أكثر."); return; }
    setBusy(true);
    try { const r = await invoke({ action: "search_users", query: query.trim() }); setUsers(r.users ?? []); }
    catch (e: any) { Alert.alert("تعذر البحث", String(e?.message || "حاول مرة ثانية")); }
    finally { setBusy(false); }
  };
  const adjustWallet = async () => {
    if (!selected || !/^\\d+(\\.\\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      Alert.alert("تحقق من البيانات", "اختار المستخدم واكتب مبلغاً صحيحاً أكبر من صفر."); return;
    }
    Alert.alert("تأكيد تعديل المحفظة", `${kind === "credit" ? "إضافة" : "خصم"} ${Number(amount).toLocaleString("ar-IQ")} د.ع للمستخدم ${selected.full_name || selected.phone || ""}؟`, [
      { text: "رجوع", style: "cancel" },
      { text: "تأكيد", onPress: () => void run({ action: "adjust_wallet", user_id: selected.id, amount: Number(amount), type: kind, note }, "تم تسجيل حركة المحفظة.") },
    ]);
  };
  const run = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    try { await invoke(body); Alert.alert("تم", success); await load(); }
    catch (e: any) { Alert.alert("تعذر التنفيذ", String(e?.message || "حدث خطأ")); }
    finally { setBusy(false); }
  };
  const saveCoupon = async () => {
    if (!/^[A-Za-z0-9_-]{2,50}$/.test(code.trim()) || !Number.isFinite(Number(value)) || Number(value) < 0 ||
        !/^\\d+$/.test(maxUses) || Number(maxUses) < 1 || !Number.isFinite(Number(minAmount)) || Number(minAmount) < 0) {
      Alert.alert("تحقق من البيانات", "تأكد من رمز الكوبون والقيمة وعدد الاستخدامات."); return;
    }
    await run({ action: "save_coupon", code: code.trim().toUpperCase(), type: couponType, value: Number(value),
      max_uses: Number(maxUses), min_amount: Number(minAmount), active: true, expires_at: null }, "تم حفظ الكوبون.");
    setCode(""); setValue("");
  };
  const distribute = (coupon: Coupon) => Alert.alert("توزيع الكوبون", "هذا الكوبون مخصص للزبائن فقط ويُستخدم لطلبات التكسي الاعتيادي.", [
    { text: "إلغاء", style: "cancel" },
    { text: "توزيع على الزبائن", onPress: () => void run({ action: "distribute_coupon", coupon_id: coupon.id, target: "customers" }, "تم إرسال الكوبون للزبائن.") },
  ]);

  if (authLoading || loading) return <View style={s.center}><ActivityIndicator color={palette.brand} /><Text style={s.muted}>جاري تحميل الإدارة المالية...</Text></View>;
  if (allowed === false) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>هذه الصفحة للمدير والمالية فقط.</Text></View>;

  return <View style={s.page}>
    <Stack.Screen options={{ title: "المحفظة والكوبونات" }} />
    <View style={s.tabs}>
      {([["wallet","المحفظة"],["coupons","الكوبونات"],["transactions","المعاملات"]] as [Tab,string][]).map(([key,label]) =>
        <TouchableOpacity key={key} onPress={() => setTab(key)} style={[s.tab, tab===key && s.active]}><Text style={[s.tabText,tab===key&&s.activeText]}>{label}</Text></TouchableOpacity>)}
    </View>
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
      {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text><Text style={s.muted}>تأكد من نشر خدمة الإدارة المالية على Supabase بعد مراجعتها والموافقة عليها.</Text></View>}
      {tab === "wallet" && <>
        <Text style={s.title}>إدارة محفظة المستخدم</Text>
        <Text style={s.muted}>ابحث عن الحساب أولاً، ثم راجع المبلغ قبل تأكيد الإضافة أو الخصم.</Text>
        <TextInput value={query} onChangeText={setQuery} placeholder="الاسم أو رقم الهاتف" placeholderTextColor={palette.muted} style={s.input} textAlign="right"/>
        <Action label="بحث عن مستخدم" disabled={busy || !canManage} onPress={() => void searchUsers()}/>
        {users.map(u => <TouchableOpacity key={u.id} onPress={() => setSelected(u)} style={[s.card,selected?.id===u.id&&s.selected]}>
          <Text style={s.cardTitle}>{u.full_name || "مستخدم ممنون"}</Text><Text style={s.muted}>{u.phone || u.email || u.id}</Text>
        </TouchableOpacity>)}
        {!!selected && <>
          <View style={s.card}><Text style={s.cardTitle}>الحساب المحدد</Text><Text style={s.muted}>{selected.full_name} · {selected.phone || selected.email}</Text></View>
          <View style={s.row}>{(["credit","debit"] as const).map(k=><TouchableOpacity key={k} onPress={()=>setKind(k)} style={[s.choice,kind===k&&s.active]}><Text style={[s.tabText,kind===k&&s.activeText]}>{k==="credit"?"إضافة رصيد":"خصم رصيد"}</Text></TouchableOpacity>)}</View>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="المبلغ بالدينار العراقي" placeholderTextColor={palette.muted} style={s.input}/>
          <TextInput value={note} onChangeText={setNote} maxLength={500} placeholder="سبب الحركة (اختياري)" placeholderTextColor={palette.muted} style={s.input} textAlign="right"/>
          <Action label={busy?"جاري التنفيذ...":"تأكيد حركة المحفظة"} disabled={busy||!canManage} onPress={() => void adjustWallet()}/>
        </>}
        {!canManage && <Text style={s.muted}>حسابك يملك صلاحية العرض فقط، ولا يملك صلاحية تعديل الأرصدة.</Text>}
      </>}
      {tab === "coupons" && <>
        <Text style={s.title}>إدارة الكوبونات</Text>
        {canManage && <View style={s.card}>
          <Text style={s.cardTitle}>إنشاء كوبون</Text>
          <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="رمز الكوبون" placeholderTextColor={palette.muted} style={s.input}/>
          <View style={s.row}>{(["percentage","fixed"] as const).map(k=><TouchableOpacity key={k} onPress={()=>setCouponType(k)} style={[s.choice,couponType===k&&s.active]}><Text style={[s.tabText,couponType===k&&s.activeText]}>{k==="percentage"?"نسبة مئوية":"مبلغ ثابت"}</Text></TouchableOpacity>)}</View>
          <TextInput value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder={couponType==="percentage"?"النسبة":"قيمة الخصم بالدينار"} placeholderTextColor={palette.muted} style={s.input}/>
          <TextInput value={maxUses} onChangeText={setMaxUses} keyboardType="number-pad" placeholder="الحد الأقصى للاستخدام" placeholderTextColor={palette.muted} style={s.input}/>
          <TextInput value={minAmount} onChangeText={setMinAmount} keyboardType="decimal-pad" placeholder="الحد الأدنى للطلب" placeholderTextColor={palette.muted} style={s.input}/>
          <Action label="حفظ الكوبون" disabled={busy} onPress={() => void saveCoupon()}/>
        </View>}
        {coupons.map(c=><View key={c.id} style={s.card}>
          <Text style={s.cardTitle}>{c.code}</Text><Text style={s.muted}>{c.type==="percentage"?c.value+"%":Number(c.value).toLocaleString("ar-IQ")+" د.ع"} · المستخدم {c.used_count ?? 0} من {c.max_uses}</Text>
          <Text style={s.muted}>{c.active?"فعال":"متوقف"}{c.expires_at?" · ينتهي "+new Date(c.expires_at).toLocaleDateString("ar-IQ"):""}</Text>
          {canManage && <View style={s.row}>
            <TouchableOpacity style={s.small} onPress={()=>distribute(c)}><Text style={s.smallText}>توزيع</Text></TouchableOpacity>
            <TouchableOpacity style={s.smallDanger} onPress={()=>Alert.alert("حذف الكوبون","متأكد من حذف هذا الكوبون؟",[{text:"رجوع",style:"cancel"},{text:"حذف",style:"destructive",onPress:()=>void run({action:"delete_coupon",coupon_id:c.id},"تم حذف الكوبون.")}])}><Text style={s.smallText}>حذف</Text></TouchableOpacity>
          </View>}
        </View>)}
        {!coupons.length && <Text style={s.muted}>ماكو كوبونات مسجلة حالياً.</Text>}
      </>}
      {tab === "transactions" && <>
        <Text style={s.title}>آخر المعاملات</Text><Text style={s.muted}>آخر {transactions.length} معاملة. القيم معروضة كما رجعت من سجل المعاملات.</Text>
        {transactions.map(t=><View key={t.id} style={s.card}>
          <Text style={s.cardTitle}>{t.profiles?.full_name || t.profiles?.phone || t.user_id}</Text>
          <Text style={s.muted}>{Number(t.amount||0).toLocaleString("ar-IQ")} د.ع · {t.type} · {t.status}</Text>
          <Text style={s.muted}>{new Date(t.created_at).toLocaleString("ar-IQ")}</Text>
        </View>)}
        {!transactions.length && <Text style={s.muted}>ماكو معاملات لعرضها.</Text>}
      </>}
    </ScrollView>
  </View>;
}

function Action({label,onPress,disabled}:{label:string;onPress:()=>void;disabled?:boolean}) {
  return <TouchableOpacity disabled={disabled} onPress={onPress} style={[s.action,disabled&&{opacity:0.45}]}><Text style={s.actionText}>{label}</Text></TouchableOpacity>;
}
const s=StyleSheet.create({
  page:{flex:1,backgroundColor: palette.pageCanvas},content:{padding:space.lg,paddingBottom:48,gap:10},
  center:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor: palette.pageCanvas,padding:24,gap:10},
  title:{color:palette.ink,fontSize:21,fontWeight:"900",textAlign:"right"},cardTitle:{color:palette.ink,fontSize:14,fontWeight:"900",textAlign:"right"},
  muted:{color:palette.muted,fontSize:11,textAlign:"right",lineHeight:19},tabs:{flexDirection:"row",padding:10,gap:7,backgroundColor:palette.surface,borderBottomWidth:1,borderBottomColor:palette.line},
  tab:{flex:1,alignItems:"center",padding:10,borderRadius:radius.md},active:{backgroundColor:palette.brand,borderColor:palette.brand},tabText:{color:palette.ink,fontSize:11,fontWeight:"800"},activeText:{color:palette.white},
  input:{backgroundColor:palette.surface,color:palette.ink,borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:12,textAlign:"right"},
  card:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:14,gap:8},selected:{borderColor:palette.brand,borderWidth:2},
  row:{flexDirection:"row",gap:8,flexWrap:"wrap"},choice:{flex:1,alignItems:"center",padding:11,borderRadius:radius.md,borderWidth:1,borderColor:palette.line},
  action:{minHeight:40,backgroundColor:palette.brand,borderRadius:16,paddingHorizontal:16,paddingVertical:8,alignItems:"center",justifyContent:"center"},actionText:{color:palette.white,fontWeight:"900",fontSize:12},
  small:{minHeight:36,backgroundColor:palette.brandSoft,paddingHorizontal:12,paddingVertical:6,borderRadius:16,alignItems:"center",justifyContent:"center"},smallDanger:{minHeight:36,backgroundColor:palette.dangerSoft,paddingHorizontal:12,paddingVertical:6,borderRadius:16,alignItems:"center",justifyContent:"center"},smallText:{color:palette.ink,fontWeight:"900",fontSize:11},
  error:{backgroundColor:palette.dangerSoft,padding:12,borderRadius:radius.md},errorText:{color:palette.danger,fontWeight:"900",textAlign:"right"},
});
