import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type Plan = { id: string; code: string; name_ar: string; name_en?: string; monthly_price: number; yearly_price: number; currency: string; is_active: boolean; tier: number; max_requests_per_month?: number | null; priority_weight?: number; offer_priority?: number; badge_label?: string | null; badge_color?: string | null; show_stats?: boolean; priority_support?: boolean; sort_order?: number; governorate_limit?: number | null; features?: unknown };
type UserRow = { id: string; full_name: string | null; phone: string | null; email: string | null };
type SubscriptionRow = {
  id: string; user_id: string; status: string; current_period_end: string | null;
  created_at: string; is_trial: boolean; grant_type: string; request_count: number;
  profile?: { full_name?: string | null; phone?: string | null; email?: string | null } | null;
  plan?: { name_ar?: string | null; code?: string | null; tier?: number } | null;
};
type PaymentRow = { id: string; amount: number; status: string; created_at: string; profile?: { full_name?: string | null; phone?: string | null } | null; plan?: { name_ar?: string | null } | null };
type Payload = { plans: Plan[]; subscriptions: SubscriptionRow[]; payments: { rows: PaymentRow[]; totals: any }; settings: any; stats: any; canManage: boolean };

const TABS = [
  ["overview", "نظرة عامة"], ["subs", "المشتركون"], ["plans", "الباقات"],
  ["grant", "منح اشتراك"], ["bulk", "منح جماعي"], ["broadcast", "إعلان إداري"], ["payments", "المدفوعات"], ["settings", "الإعدادات"],
] as const;
type Tab = typeof TABS[number][0];

export default function AdminSubscriptionsScreen() {
  const { session, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedBulkUsers, setSelectedBulkUsers] = useState<string[]>([]);
  const [broadcastTarget, setBroadcastTarget] = useState<"all" | "worker" | "driver" | "large_driver">("all");
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [planCode, setPlanCode] = useState("bronze");
  const [duration, setDuration] = useState("month");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [settingsEnabled, setSettingsEnabled] = useState(false);
  const [minimumDownloads, setMinimumDownloads] = useState("100000");
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [planCodeInput, setPlanCodeInput] = useState("");
  const [planNameInput, setPlanNameInput] = useState("");
  const [planMonthlyInput, setPlanMonthlyInput] = useState("0");
  const [planYearlyInput, setPlanYearlyInput] = useState("0");
  const [planTierInput, setPlanTierInput] = useState("1");
  const [planSortInput, setPlanSortInput] = useState("0");
  const [planExtraFields, setPlanExtraFields] = useState<Partial<Plan>>({});

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data: result, error: invokeError } = await supabase.functions.invoke("admin-subscriptions", { body });
    if (invokeError) throw new Error(invokeError.message || "تعذر الاتصال بخدمة إدارة الاشتراكات");
    if (result?.error) throw new Error(result.detail || result.error);
    return result;
  }, []);

  const load = useCallback(async () => {
    if (!session?.user?.id) return;
    setError("");
    try {
      const result = await invoke({ action: "list" }) as Payload;
      setData(result);
      setAllowed(true);
      setCanManage(result.canManage === true);
      setSettingsEnabled(result.settings?.subscription_enabled === true);
      setMinimumDownloads(String(result.settings?.minimum_downloads_before_activation ?? 100000));
    } catch (e: any) {
      const message = String(e?.message || "تعذر تحميل البيانات");
      if (message.includes("forbidden") || message.includes("غير مصرّح")) setAllowed(false);
      else setError(message);
    } finally {
      setLoading(false);
    }
  }, [invoke, session?.user?.id]);

  useEffect(() => {
    if (authLoading) return;
    if (!session) { setAllowed(false); setLoading(false); return; }
    void load();
  }, [authLoading, session, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const runAction = async (body: Record<string, unknown>, success: string): Promise<boolean> => {
    setBusy(true);
    try {
      await invoke(body);
      Alert.alert("تم بنجاح", success);
      await load();
      return true;
    } catch (e: any) {
      Alert.alert("تعذر التنفيذ", String(e?.message || "حدث خطأ غير متوقع"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const searchUsers = async () => {
    if (query.trim().length < 2) {
      Alert.alert("البحث", "اكتب حرفين أو أكثر للبحث.");
      return;
    }
    setBusy(true);
    try {
      const result = await invoke({ action: "search_users", query: query.trim() });
      setUsers(result.users ?? []);
      if (!result.users?.length) Alert.alert("نتيجة البحث", "ما لقينا حساب مقدم خدمة مطابق.");
    } catch (e: any) {
      Alert.alert("تعذر البحث", String(e?.message || "حاول مرة ثانية"));
    } finally {
      setBusy(false);
    }
  };

  const grant = async () => {
    if (!selectedUser) return;
    const ok = await runAction({ action: "grant_subscription", user_id: selectedUser.id, plan_code: planCode, duration },
      "تم منح الاشتراك وتحديث حساب المستخدم.");
    if (ok) { setSelectedUser(null); setUsers([]); setQuery(""); }
  };

  const toggleBulkUser = (id: string) => setSelectedBulkUsers((current) =>
    current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  const grantBulk = async () => {
    if (!selectedBulkUsers.length) { Alert.alert("المنح الجماعي", "حدد حساباً واحداً على الأقل."); return; }
    const ok = await runAction({ action: "grant_bulk", user_ids: selectedBulkUsers, plan_code: planCode, duration },
      `تم منح الاشتراك إلى ${selectedBulkUsers.length} حساباً.`);
    if (ok) { setSelectedBulkUsers([]); setUsers([]); setQuery(""); }
  };

  const sendBroadcast = async () => {
    if (broadcastTitle.trim().length < 2 || broadcastBody.trim().length < 2) {
      Alert.alert("بيانات الإعلان", "اكتب عنواناً ونصاً واضحين قبل الإرسال."); return;
    }
    const ok = await runAction({ action: "broadcast", target: broadcastTarget, title: broadcastTitle.trim(), body: broadcastBody.trim() },
      "تم إرسال الإعلان الإداري إلى الفئة المحددة.");
    if (ok) { setBroadcastTitle(""); setBroadcastBody(""); }
  };

  const openPlanEditor = (plan?: Plan) => {
    setPlanEditorOpen(true);
    setEditingPlanId(plan?.id ?? null);
    setPlanExtraFields(plan ? { name_en: plan.name_en, max_requests_per_month: plan.max_requests_per_month, priority_weight: plan.priority_weight, offer_priority: plan.offer_priority, badge_label: plan.badge_label, badge_color: plan.badge_color, show_stats: plan.show_stats, priority_support: plan.priority_support, governorate_limit: plan.governorate_limit, features: plan.features } : {});
    setPlanCodeInput(plan?.code ?? "");
    setPlanNameInput(plan?.name_ar ?? "");
    setPlanMonthlyInput(String(plan?.monthly_price ?? 0));
    setPlanYearlyInput(String(plan?.yearly_price ?? 0));
    setPlanTierInput(String(plan?.tier ?? 1));
    setPlanSortInput(String((plan as any)?.sort_order ?? 0));
  };

  const savePlan = async () => {
    const code = planCodeInput.trim().toLowerCase();
    const name = planNameInput.trim();
    const monthly = Number(planMonthlyInput);
    const yearly = Number(planYearlyInput);
    const tier = Number(planTierInput);
    const sort = Number(planSortInput);
    if (!/^[a-z0-9_-]{2,30}$/.test(code) || !name || name.length > 100 ||
        ![monthly, yearly, tier, sort].every(Number.isInteger) ||
        monthly < 0 || yearly < 0 || tier < 0 || tier > 100 || sort < 0 || sort > 1000) {
      Alert.alert("بيانات غير صحيحة", "راجع رمز الباقة والاسم والأسعار وترتيب الباقة.");
      return;
    }
    const saved = await runAction({
      action: "save_plan",
      ...(editingPlanId ? { id: editingPlanId } : {}),
      plan: {
        ...planExtraFields,
        code, name_ar: name, name_en: planExtraFields.name_en || code, description_ar: null,
        tier, max_requests_per_month: planExtraFields.max_requests_per_month ?? null, priority_weight: planExtraFields.priority_weight ?? tier * 10,
        offer_priority: planExtraFields.offer_priority ?? tier * 10, badge_label: planExtraFields.badge_label ?? null, badge_color: planExtraFields.badge_color ?? null,
        show_stats: planExtraFields.show_stats ?? tier > 0, priority_support: planExtraFields.priority_support ?? tier >= 3,
        monthly_price: monthly, yearly_price: yearly, currency: "IQD",
        is_active: true, sort_order: sort,
      },
    }, editingPlanId ? "تم تحديث الباقة." : "تم إنشاء الباقة.");
    if (saved) { setPlanEditorOpen(false); setEditingPlanId(null); }
  };

  const subscriptions = data?.subscriptions ?? [];
  const activeCount = subscriptions.filter((s) => s.status === "active").length;
  const payments = data?.payments?.rows ?? [];
  const money = (value: number) => Number(value || 0).toLocaleString("ar-IQ") + " د.ع";

  if (authLoading || loading) return <View style={s.center}><ActivityIndicator size="large" color={palette.brand}/><Text style={s.muted}>جاري تحميل إدارة الاشتراكات...</Text></View>;
  if (allowed === false) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>هذه الصفحة متاحة للمدير والمالية فقط.</Text></View>;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "إدارة الاشتراكات" }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
        {TABS.map(([key, label]) => <TouchableOpacity key={key} onPress={() => setTab(key)} style={[s.tab, tab === key && s.tabActive]}><Text style={[s.tabText, tab === key && s.tabTextActive]}>{label}</Text></TouchableOpacity>)}
      </ScrollView>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text><Text style={s.muted}>قد تحتاج خدمة الإدارة الآمنة إلى نشرها على Supabase قبل عمل هذه الشاشة.</Text></View>}
        {tab === "overview" && <>
          <Text style={s.title}>نظرة عامة على الاشتراكات</Text>
          <View style={s.grid}>
            <Stat label="إجمالي المشتركين" value={data?.stats?.total_subscribers ?? 0}/>
            <Stat label="اشتراكات فعالة" value={data?.stats?.active_subscriptions ?? activeCount}/>
            <Stat label="اشتراكات منتهية" value={data?.stats?.expired_subscriptions ?? 0}/>
            <Stat label="تجريبية" value={data?.stats?.trial_count ?? 0}/>
            <Stat label="إيراد شهري" value={money(data?.stats?.monthly_revenue ?? 0)}/>
            <Stat label="إيراد سنوي" value={money(data?.stats?.yearly_revenue ?? 0)}/>
          </View>
          <Text style={s.section}>توزيع الباقات</Text>
          {["free", "bronze", "silver", "gold"].map((key) => <View key={key} style={s.row}><Text style={s.label}>{key === "free" ? "مجانية" : key === "bronze" ? "برونزية" : key === "silver" ? "فضية" : "ذهبية"}</Text><Text style={s.value}>{data?.stats?.[key + "_count"] ?? 0}</Text></View>)}
        </>}
        {tab === "subs" && <>
          <Text style={s.title}>المشتركون</Text>
          <Text style={s.muted}>آخر {subscriptions.length} اشتراك مسجل</Text>
          {subscriptions.map((sub) => <View key={sub.id} style={s.card}>
            <Text style={s.cardTitle}>{sub.profile?.full_name || "مستخدم ممنون"}</Text>
            <Text style={s.muted}>{sub.profile?.phone || sub.profile?.email || sub.user_id}</Text>
            <Text style={s.label}>{sub.plan?.name_ar || sub.plan?.code || "باقة"} · {sub.status} · {sub.is_trial ? "تجريبي" : sub.grant_type === "admin" ? "منح إداري" : "مدفوع"}</Text>
            <Text style={s.muted}>الطلبات المستخدمة: {sub.request_count} · الانتهاء: {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString("ar-IQ") : "دائم"}</Text>
            {canManage && <View style={s.actions}>
              <TouchableOpacity disabled={busy} style={s.smallButton} onPress={() => void runAction({action:"set_status",user_id:sub.user_id,status:"active"},"تم تفعيل الاشتراك.")}><Text style={s.buttonText}>تفعيل</Text></TouchableOpacity>
              <TouchableOpacity disabled={busy} style={s.smallButton} onPress={() => void runAction({action:"set_status",user_id:sub.user_id,status:"paused"},"تم إيقاف الاشتراك مؤقتاً.")}><Text style={s.buttonText}>إيقاف</Text></TouchableOpacity>
              <TouchableOpacity disabled={busy} style={s.smallButtonDanger} onPress={() => Alert.alert("تأكيد الإلغاء","تريد تلغي اشتراك هذا المستخدم؟",[{text:"رجوع",style:"cancel"},{text:"إلغاء الاشتراك",style:"destructive",onPress:()=>void runAction({action:"set_status",user_id:sub.user_id,status:"cancelled"},"تم إلغاء الاشتراك.")}])}><Text style={s.buttonText}>إلغاء</Text></TouchableOpacity>
            </View>}
            {canManage && <View style={s.actions}>
              <TextInput value={days} onChangeText={setDays} keyboardType="number-pad" placeholder="أيام التمديد" placeholderTextColor={palette.muted} style={[s.input,{flex:1}]}/>
              <TouchableOpacity style={s.smallButton} disabled={busy || !/^\d+$/.test(days) || Number(days)<1 || Number(days)>3650} onPress={() => void runAction({action:"extend",user_id:sub.user_id,days:Number(days)},"تم تمديد الاشتراك.")}><Text style={s.buttonText}>تمديد</Text></TouchableOpacity>
            </View>}
          </View>)}
          {canManage && <TouchableOpacity style={s.dangerButton} disabled={busy} onPress={() => Alert.alert("تنبيه مهم","هذا الإجراء يوقف كل الاشتراكات النشطة ويمنع استقبال طلبات جديدة. متأكد؟",[{text:"إلغاء",style:"cancel"},{text:"إيقاف الكل",style:"destructive",onPress:()=>void runAction({action:"pause_all"},"تم إيقاف جميع الاشتراكات النشطة.")}])}><Text style={s.buttonText}>إيقاف جميع الاشتراكات النشطة</Text></TouchableOpacity>}
        </>}
        {tab === "plans" && <>
          <Text style={s.title}>الباقات</Text>
          {canManage && <>
            <TouchableOpacity style={s.primaryButton} onPress={() => openPlanEditor()}><Text style={s.buttonText}>إضافة باقة جديدة</Text></TouchableOpacity>
            {planEditorOpen && <View style={s.card}>
              <Text style={s.cardTitle}>{editingPlanId ? "تعديل الباقة" : "باقة جديدة"}</Text>
              <TextInput value={planCodeInput} onChangeText={setPlanCodeInput} editable={!editingPlanId} placeholder="رمز الباقة مثل platinum" placeholderTextColor={palette.muted} style={s.input} autoCapitalize="none"/>
              <TextInput value={planNameInput} onChangeText={setPlanNameInput} placeholder="اسم الباقة بالعربي" placeholderTextColor={palette.muted} style={s.input}/>
              <TextInput value={planMonthlyInput} onChangeText={setPlanMonthlyInput} keyboardType="number-pad" placeholder="السعر الشهري بالدينار" placeholderTextColor={palette.muted} style={s.input}/>
              <TextInput value={planYearlyInput} onChangeText={setPlanYearlyInput} keyboardType="number-pad" placeholder="السعر السنوي بالدينار" placeholderTextColor={palette.muted} style={s.input}/>
              <TextInput value={planTierInput} onChangeText={setPlanTierInput} keyboardType="number-pad" placeholder="مستوى الباقة" placeholderTextColor={palette.muted} style={s.input}/>
              <TextInput value={planSortInput} onChangeText={setPlanSortInput} keyboardType="number-pad" placeholder="ترتيب العرض" placeholderTextColor={palette.muted} style={s.input}/>
              <View style={s.actions}>
                <TouchableOpacity style={s.smallButton} disabled={busy} onPress={() => void savePlan()}><Text style={s.buttonText}>حفظ الباقة</Text></TouchableOpacity>
                <TouchableOpacity style={s.smallButtonDanger} onPress={() => { setPlanEditorOpen(false); setEditingPlanId(null); }}><Text style={s.buttonText}>إغلاق</Text></TouchableOpacity>
              </View>
            </View>}
          </>}
          {(data?.plans ?? []).map((plan) => <View key={plan.id} style={s.card}>
            <Text style={s.cardTitle}>{plan.name_ar}</Text>
            <Text style={s.muted}>{plan.code} · {money(plan.monthly_price)} شهرياً · {money(plan.yearly_price)} سنوياً</Text>
            <View style={s.actions}><Text style={s.label}>{plan.is_active ? "فعالة" : "متوقفة"}</Text>
              {canManage && <>
                <TouchableOpacity style={s.smallButton} onPress={() => openPlanEditor(plan)}><Text style={s.buttonText}>تعديل</Text></TouchableOpacity>
                <TouchableOpacity style={s.smallButton} onPress={() => void runAction({action:"toggle_plan",id:plan.id,is_active:!plan.is_active},plan.is_active?"تم إيقاف الباقة":"تم تفعيل الباقة")}><Text style={s.buttonText}>{plan.is_active?"إيقاف":"تفعيل"}</Text></TouchableOpacity>
              </>}
            </View>
          </View>)}
        </>}
        {tab === "grant" && <>
          <Text style={s.title}>منح اشتراك لمقدم خدمة</Text>
          <Text style={s.muted}>المنح متاح للفنيين وسائقي التكسي والكيات فقط، ويُسجّل كمنح إداري.</Text>
          <TextInput value={query} onChangeText={setQuery} placeholder="ابحث بالاسم أو رقم الهاتف" placeholderTextColor={palette.muted} style={s.input} textAlign="right"/>
          <TouchableOpacity disabled={busy || !canManage} style={s.primaryButton} onPress={() => void searchUsers()}><Text style={s.buttonText}>{busy?"جاري البحث...":"بحث عن مقدم الخدمة"}</Text></TouchableOpacity>
          {users.map((u) => <TouchableOpacity key={u.id} onPress={() => setSelectedUser(u)} style={[s.card,selectedUser?.id===u.id&&s.selectedCard]}>
            <Text style={s.cardTitle}>{u.full_name || "مستخدم"}</Text><Text style={s.muted}>{u.phone || u.email || u.id}</Text>
          </TouchableOpacity>)}
          {!!selectedUser && <>
            <Text style={s.section}>الحساب المحدد: {selectedUser.full_name || selectedUser.phone}</Text>
            <Text style={s.label}>الباقة</Text>
            <View style={s.actions}>{(["bronze","silver","gold"] as const).map((p) => <TouchableOpacity key={p} style={[s.choice,planCode===p&&s.choiceActive]} onPress={() => setPlanCode(p)}><Text style={s.label}>{p==="bronze"?"برونزي":p==="silver"?"فضي":"ذهبي"}</Text></TouchableOpacity>)}</View>
            <Text style={s.label}>المدة</Text>
            {(["month","two_months","year","permanent"] as const).map((d) => <TouchableOpacity key={d} style={[s.choice, duration===d&&s.choiceActive]} onPress={() => setDuration(d)}><Text style={s.label}>{d==="month"?"شهر":d==="two_months"?"شهرين":d==="year"?"سنة":"دائم"}</Text></TouchableOpacity>)}
            <TouchableOpacity disabled={busy} style={s.primaryButton} onPress={() => void grant()}><Text style={s.buttonText}>تأكيد منح الاشتراك</Text></TouchableOpacity>
          </>}
        </>}
        {tab === "bulk" && <>
          <Text style={s.title}>منح اشتراك جماعي</Text>
          <Text style={s.muted}>ابحث عن مقدمي الخدمة وحدد الحسابات المطلوبة. الحد الأعلى 500 حساب في العملية الواحدة.</Text>
          <TextInput value={query} onChangeText={setQuery} placeholder="ابحث بالاسم أو رقم الهاتف" placeholderTextColor={palette.muted} style={s.input} textAlign="right"/>
          <TouchableOpacity disabled={busy || !canManage} style={s.primaryButton} onPress={() => void searchUsers()}><Text style={s.buttonText}>بحث عن مقدمي الخدمة</Text></TouchableOpacity>
          <Text style={s.section}>الحسابات المحددة: {selectedBulkUsers.length}</Text>
          {users.map((u) => {
            const selected = selectedBulkUsers.includes(u.id);
            return <TouchableOpacity key={u.id} onPress={() => toggleBulkUser(u.id)} style={[s.card, selected && s.selectedCard]}>
              <Text style={s.cardTitle}>{selected ? "✓ " : ""}{u.full_name || "مستخدم"}</Text>
              <Text style={s.muted}>{u.phone || u.email || u.id}</Text>
            </TouchableOpacity>;
          })}
          <Text style={s.label}>الباقة</Text>
          <View style={s.actions}>{(["bronze","silver","gold"] as const).map((p) => <TouchableOpacity key={p} style={[s.choice,planCode===p&&s.choiceActive]} onPress={() => setPlanCode(p)}><Text style={s.label}>{p==="bronze"?"برونزي":p==="silver"?"فضي":"ذهبي"}</Text></TouchableOpacity>)}</View>
          <Text style={s.label}>المدة</Text>
          <View style={s.actions}>{(["month","two_months","year","permanent"] as const).map((d) => <TouchableOpacity key={d} style={[s.choice,duration===d&&s.choiceActive]} onPress={() => setDuration(d)}><Text style={s.label}>{d==="month"?"شهر":d==="two_months"?"شهرين":d==="year"?"سنة":"دائم"}</Text></TouchableOpacity>)}</View>
          <TouchableOpacity disabled={busy || !canManage || selectedBulkUsers.length===0 || selectedBulkUsers.length>500} style={s.primaryButton} onPress={() => Alert.alert("تأكيد المنح الجماعي", `راح تمنح اشتراكاً إلى ${selectedBulkUsers.length} حساب. هل تريد المتابعة؟`, [{text:"رجوع",style:"cancel"},{text:"تأكيد",onPress:()=>void grantBulk()}])}><Text style={s.buttonText}>تأكيد منح الاشتراك للمحددين</Text></TouchableOpacity>
          <TouchableOpacity disabled={busy} style={s.smallButtonDanger} onPress={() => setSelectedBulkUsers([])}><Text style={s.buttonText}>إلغاء تحديد الكل</Text></TouchableOpacity>
        </>}
        {tab === "broadcast" && <>
          <Text style={s.title}>إرسال إعلان إداري</Text>
          <Text style={s.muted}>يرسل الإعلان للفئة المحددة عبر نظام الإعلانات داخل التطبيق.</Text>
          <Text style={s.label}>الفئة المستهدفة</Text>
          <View style={s.actions}>
            {([{value:"all",label:"الكل"},{value:"worker",label:"الفنيون"},{value:"driver",label:"سائقو التكسي"},{value:"large_driver",label:"سائقو الكيات"}] as const).map((item) =>
              <TouchableOpacity key={item.value} style={[s.choice,broadcastTarget===item.value&&s.choiceActive]} onPress={() => setBroadcastTarget(item.value)}><Text style={s.label}>{item.label}</Text></TouchableOpacity>)}
          </View>
          <TextInput value={broadcastTitle} onChangeText={setBroadcastTitle} maxLength={100} placeholder="عنوان الإعلان (حتى 100 حرف)" placeholderTextColor={palette.muted} style={s.input}/>
          <TextInput value={broadcastBody} onChangeText={setBroadcastBody} maxLength={1500} multiline numberOfLines={5} placeholder="نص الإعلان (حتى 1500 حرف)" placeholderTextColor={palette.muted} style={[s.input,{minHeight:110,textAlignVertical:"top"}]}/>
          <Text style={s.muted}>{broadcastTitle.length}/100 · {broadcastBody.length}/1500</Text>
          <TouchableOpacity disabled={busy || !canManage || broadcastTitle.trim().length<2 || broadcastBody.trim().length<2} style={s.primaryButton} onPress={() => Alert.alert("تأكيد إرسال الإعلان","سيتم إرسال الإعلان إلى الفئة التي اخترتها. هل تريد المتابعة؟",[{text:"رجوع",style:"cancel"},{text:"إرسال",onPress:()=>void sendBroadcast()}])}><Text style={s.buttonText}>إرسال الإعلان</Text></TouchableOpacity>
        </>}
        {tab === "payments" && <>
          <Text style={s.title}>مدفوعات الاشتراكات</Text>
          <View style={s.grid}>
            <Stat label="مدفوعة" value={data?.payments?.totals?.paidCount ?? 0}/>
            <Stat label="المبالغ المدفوعة" value={money(data?.payments?.totals?.paidAmount ?? 0)}/>
            <Stat label="معلقة" value={data?.payments?.totals?.pendingCount ?? 0}/>
            <Stat label="فاشلة/مسترجعة" value={data?.payments?.totals?.failedCount ?? 0}/>
          </View>
          {payments.slice(0,100).map((p) => <View key={p.id} style={s.card}><Text style={s.cardTitle}>{p.profile?.full_name || p.profile?.phone || "مستخدم"}</Text><Text style={s.label}>{p.plan?.name_ar || "اشتراك"} · {money(p.amount)} · {p.status}</Text><Text style={s.muted}>{new Date(p.created_at).toLocaleString("ar-IQ")}</Text></View>)}
        </>}
        {tab === "settings" && <>
          <Text style={s.title}>إعدادات الاشتراكات</Text>
          <Text style={s.muted}>حالة النظام: {settingsEnabled ? "مفعّل" : "متوقف"}</Text>
          <TouchableOpacity disabled={!canManage || busy} style={s.primaryButton} onPress={() => setSettingsEnabled((v) => !v)}><Text style={s.buttonText}>تغيير الحالة إلى {settingsEnabled?"متوقف":"مفعّل"}</Text></TouchableOpacity>
          <Text style={s.label}>الحد الأدنى للتنزيلات قبل التفعيل</Text>
          <TextInput value={minimumDownloads} onChangeText={setMinimumDownloads} keyboardType="number-pad" style={s.input} placeholderTextColor={palette.muted}/>
          <TouchableOpacity disabled={!canManage || busy || !/^\d+$/.test(minimumDownloads)} style={s.primaryButton} onPress={() => void runAction({action:"save_settings",subscription_enabled:settingsEnabled,minimum_downloads_before_activation:Number(minimumDownloads)},"تم حفظ إعدادات الاشتراكات.")}><Text style={s.buttonText}>حفظ الإعدادات</Text></TouchableOpacity>
        </>}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <View style={s.stat}><Text style={s.statValue}>{String(value)}</Text><Text style={s.muted}>{label}</Text></View>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor: palette.pageCanvas},
  scroll:{flex:1},
  content:{padding:space.lg,paddingBottom:48,gap:12},
  tabs:{paddingHorizontal:space.md,paddingVertical:space.sm,gap:8},
  tab:{paddingHorizontal:14,paddingVertical:10,borderRadius:radius.pill,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line},
  tabActive:{backgroundColor:palette.brand,borderColor:palette.brand},
  tabText:{fontSize:12,fontWeight:"800",color:palette.ink},
  tabTextActive:{color:"#FFFFFF"},
  center:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor: palette.pageCanvas,padding:24,gap:12},
  title:{fontSize:22,fontWeight:"900",color:palette.ink,textAlign:"right"},
  section:{fontSize:16,fontWeight:"900",color:palette.ink,textAlign:"right",marginTop:8},
  muted:{fontSize:12,color:palette.muted,textAlign:"right",lineHeight:20},
  label:{fontSize:13,color:palette.ink,textAlign:"right",fontWeight:"800"},
  value:{fontSize:16,color:palette.brand,fontWeight:"900"},
  grid:{flexDirection:"row",flexWrap:"wrap",gap:10},
  stat:{width:"48%",backgroundColor:palette.surface,borderRadius:radius.lg,padding:14,borderWidth:1,borderColor:palette.line,gap:6},
  statValue:{fontSize:18,fontWeight:"900",color:palette.ink,textAlign:"right"},
  card:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:14,gap:8},
  cardTitle:{fontSize:15,fontWeight:"900",color:palette.ink,textAlign:"right"},
  row:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",backgroundColor:palette.surface,borderRadius:radius.md,padding:12},
  actions:{flexDirection:"row",flexWrap:"wrap",gap:8,alignItems:"center",justifyContent:"flex-end"},
  smallButton:{minHeight:36,backgroundColor:palette.brand,borderRadius:16,paddingHorizontal:12,paddingVertical:6,alignItems:"center",justifyContent:"center"},
  smallButtonDanger:{minHeight:36,backgroundColor:palette.danger,borderRadius:16,paddingHorizontal:12,paddingVertical:6,alignItems:"center",justifyContent:"center"},
  primaryButton:{backgroundColor:palette.brand,borderRadius:radius.md,padding:14,alignItems:"center"},
  dangerButton:{minHeight:40,backgroundColor:palette.danger,borderRadius:16,paddingHorizontal:16,paddingVertical:8,alignItems:"center",justifyContent:"center"},
  buttonText:{color:"#FFFFFF",fontSize:12,fontWeight:"900"},
  input:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:12,color:palette.ink,textAlign:"right"},
  error:{backgroundColor:palette.dangerSoft,borderRadius:radius.md,padding:12,gap:4},
  errorText:{color:palette.danger,fontWeight:"900",textAlign:"right"},
  selectedCard:{borderColor:palette.brand,borderWidth:2},
  choice:{padding:10,borderRadius:radius.md,borderWidth:1,borderColor:palette.line,backgroundColor:palette.surface,marginVertical:3},
  choiceActive:{borderColor:palette.brand,backgroundColor:palette.brandSoft},
});
