import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type UserRow = { id: string; full_name?: string | null; phone?: string | null; email?: string | null };
type RoleRow = string | { role?: string };
type AuditRow = { id?: string; action?: string; table_name?: string; record_id?: string; created_at?: string; details?: any; admin?: { full_name?: string; phone?: string } };
type StaffActivityRow = { id: string; activity: string; created_at: string; staff_user_id: string; actor_user_id: string; message_id?: string | null; staff?: { full_name?: string | null; email?: string | null }; actor?: { full_name?: string | null; email?: string | null } };
const ROLES = [
  ["admin", "مدير"], ["support", "دعم فني"], ["finance", "مالية"], ["moderator", "مشرف محتوى"],
] as const;

export default function AdminGovernanceScreen() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [tab, setTab] = useState<"roles" | "audit" | "hierarchy" | "activity">("hierarchy");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [staffActivity, setStaffActivity] = useState<StaffActivityRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: callError } = await supabase.functions.invoke("admin-governance", { body });
    if (callError) throw new Error(callError.message || "تعذر الاتصال بخدمة الصلاحيات");
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError("");
    try {
      const { data: assignment } = await (supabase as any).from("staff_assignments")
        .select("scope_type,scope_governorate").eq("user_id", user.id).eq("active", true).maybeSingle();
      const scopeType = assignment?.scope_type === "governorate" ? "governorate" : "global";
      const scopeGovernorate = scopeType === "governorate" ? assignment?.scope_governorate ?? null : null;
      const [staffRead, auditRead, root] = await Promise.all([
        (supabase as any).rpc("admin_has_permission", {
          p_permission_key: "staff.read", p_scope_type: scopeType, p_scope_governorate: scopeGovernorate,
        }),
        (supabase as any).rpc("admin_has_permission", {
          p_permission_key: "audit.read", p_scope_type: scopeType, p_scope_governorate: scopeGovernorate,
        }),
        supabase.rpc("is_super_admin", { p_user_id: user.id }),
      ]);
      if (staffRead.error || staffRead.data !== true) { setAllowed(false); return; }
      setAllowed(true);
      setSuperAdmin(root.data === true);
      if (root.data === true) {
        const activityResult = await invoke({ action: "staff_activity", limit: 100 });
        setStaffActivity(activityResult.rows ?? []);
      } else setStaffActivity([]);
      if (auditRead.data === true) {
        const r = await invoke({ action: "audit_logs", limit: 100 });
        setLogs(r.logs ?? []);
      } else setLogs([]);
    } catch (e: any) {
      setError(String(e?.message || "تعذر تحميل الصلاحيات والسجل"));
    } finally { setLoading(false); }
  }, [user?.id, invoke]);

  useEffect(() => {
    if (!authLoading) {
      if (!user) { setAllowed(false); setLoading(false); }
      else void load();
    }
  }, [authLoading, user, load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const search = async () => {
    if (query.trim().length < 2) { Alert.alert("البحث", "اكتب حرفين أو أكثر."); return; }
    setBusy(true);
    try { const r = await invoke({ action: "search_users", query: query.trim() }); setUsers(r.users ?? []); }
    catch (e: any) { Alert.alert("تعذر البحث", String(e?.message || "حاول مرة ثانية")); }
    finally { setBusy(false); }
  };
  const selectUser = async (u: UserRow) => {
    setSelected(u); setRoles([]); setBusy(true);
    try {
      const r = await invoke({ action: "get_roles", user_id: u.id });
      setRoles((r.roles ?? []).map((v: RoleRow) => typeof v === "string" ? v : v.role).filter(Boolean));
    } catch (e: any) { Alert.alert("تعذر تحميل الأدوار", String(e?.message || "حاول مرة ثانية")); }
    finally { setBusy(false); }
  };
  const changeRole = (role: string, grant: boolean) => {
    if (!selected) return;
    Alert.alert(grant ? "منح صلاحية" : "سحب صلاحية", `${grant ? "تريد تمنح" : "تريد تسحب"} صلاحية ${role} من ${selected.full_name || selected.phone || "هذا الحساب"}؟`, [
      { text: "رجوع", style: "cancel" },
      { text: "تأكيد", style: grant ? "default" : "destructive", onPress: () => void (async () => {
        setBusy(true);
        try {
          await invoke({ action: grant ? "grant_role" : "revoke_role", user_id: selected.id, role });
          const r = await invoke({ action: "get_roles", user_id: selected.id });
          setRoles((r.roles ?? []).map((v: RoleRow) => typeof v === "string" ? v : v.role).filter(Boolean));
          Alert.alert("تم", grant ? "تم منح الصلاحية." : "تم سحب الصلاحية.");
          await load();
        } catch (e: any) { Alert.alert("تعذر تغيير الصلاحية", String(e?.message || "حاول مرة ثانية")); }
        finally { setBusy(false); }
      })() },
    ]);
  };

  if (authLoading || loading) return <View style={s.center}><ActivityIndicator color={palette.brand}/><Text style={s.muted}>جاري تحميل الحماية الإدارية...</Text></View>;
  if (!allowed) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>هذه الصفحة للموظفين المخوّلين فقط.</Text></View>;

  return <View style={s.page}>
    <Stack.Screen options={{ title: "الصلاحيات وسجل العمليات" }}/>
    <View style={s.tabs}>
      <TouchableOpacity onPress={()=>setTab("hierarchy")} style={[s.tab,tab==="hierarchy"&&s.active]}><Text style={[s.tabText,tab==="hierarchy"&&s.activeText]}>الإدارة الهرمية</Text></TouchableOpacity>
      <TouchableOpacity onPress={()=>setTab("roles")} style={[s.tab,tab==="roles"&&s.active]}><Text style={[s.tabText,tab==="roles"&&s.activeText]}>الصلاحيات</Text></TouchableOpacity>
      <TouchableOpacity onPress={()=>setTab("audit")} style={[s.tab,tab==="audit"&&s.active]}><Text style={[s.tabText,tab==="audit"&&s.activeText]}>سجل العمليات</Text></TouchableOpacity>
      {superAdmin && <TouchableOpacity onPress={()=>setTab("activity")} style={[s.tab,tab==="activity"&&s.active]}><Text style={[s.tabText,tab==="activity"&&s.activeText]}>نشاط الموظفين</Text></TouchableOpacity>}
    </View>
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
      {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
      {tab==="hierarchy" && <HierarchicalGovernancePanel />}
      {tab==="roles" && <>
        <Text style={s.title}>إدارة صلاحيات الموظفين</Text>
        <Text style={s.muted}>هذه العمليات للمدير الأعلى فقط، وكل تغيير يتطلب تأكيداً.</Text>
        {!superAdmin ? <Text style={s.muted}>حسابك يملك عرض لوحة الإدارة، لكن ما عنده صلاحية منح أو سحب الأدوار.</Text> : <>
          <TextInput value={query} onChangeText={setQuery} placeholder="ابحث بالاسم أو الهاتف أو البريد" placeholderTextColor={palette.muted} style={s.input} textAlign="right"/>
          <Action label="بحث عن حساب" disabled={busy} onPress={()=>void search()}/>
          {users.map(u=><TouchableOpacity key={u.id} onPress={()=>void selectUser(u)} style={[s.card,selected?.id===u.id&&s.selected]}>
            <Text style={s.cardTitle}>{u.full_name||"مستخدم ممنون"}</Text><Text style={s.muted}>{u.phone||u.email||u.id}</Text>
          </TouchableOpacity>)}
          {!!selected && <View style={s.card}>
            <Text style={s.cardTitle}>أدوار {selected.full_name||selected.phone||"الحساب المحدد"}</Text>
            {ROLES.map(([role,label])=><View key={role} style={s.roleRow}>
              <View style={{flex:1}}><Text style={s.cardTitle}>{label}</Text><Text style={s.muted}>{role}</Text></View>
              {roles.includes(role) ? <TouchableOpacity disabled={busy} style={s.revoke} onPress={()=>changeRole(role,false)}><Text style={s.buttonText}>سحب</Text></TouchableOpacity>
                : <TouchableOpacity disabled={busy} style={s.grant} onPress={()=>changeRole(role,true)}><Text style={s.buttonText}>منح</Text></TouchableOpacity>}
            </View>)}
            <Text style={s.muted}>الأدوار الحالية: {roles.length?roles.join("، "):"لا توجد أدوار إدارية"}</Text>
          </View>}
        </>}
      </>}
      {tab==="activity" && superAdmin && <>
        <Text style={s.title}>سجل نشاط الموظفين</Text>
        <Text style={s.muted}>آخر {staffActivity.length.toLocaleString("ar-IQ")} نشاط مسجل لخدمة العملاء وتغييرات الرتب، للمدير الأعلى فقط.</Text>
        {staffActivity.map((entry) => <View key={entry.id} style={s.card}>
          <Text style={s.cardTitle}>{({ view_support_message: "شاهد رسالة دعم", reply_support_message: "رد على رسالة دعم", rank_changed: "تغيير رتبة", department_changed: "تغيير قسم", staff_activated: "تفعيل موظف", staff_deactivated: "إيقاف موظف" } as Record<string, string>)[entry.activity] ?? entry.activity}</Text>
          <Text style={s.muted}>الموظف: {entry.staff?.full_name || entry.staff?.email || entry.staff_user_id.slice(0, 8)} · بواسطة: {entry.actor?.full_name || entry.actor?.email || entry.actor_user_id.slice(0, 8)}</Text>
          {!!entry.message_id && <Text style={s.muted}>رقم الرسالة: {entry.message_id}</Text>}
          <Text style={s.muted}>{new Date(entry.created_at).toLocaleString("ar-IQ")}</Text>
        </View>)}
        {!staffActivity.length && <Text style={s.muted}>ماكو أنشطة موظفين مسجلة بعد.</Text>}
      </>}
      {tab==="audit" && <>
        <Text style={s.title}>سجل العمليات الإدارية</Text>
        <Text style={s.muted}>آخر {logs.length} عملية مسجلة. السجل للقراءة فقط من التطبيق.</Text>
        {logs.map((log,i)=><View key={String(log.id||i)} style={s.card}>
          <Text style={s.cardTitle}>{log.action||log.table_name||"عملية إدارية"}</Text>
          <Text style={s.muted}>بواسطة: {log.admin?.full_name||log.admin?.phone||"حساب إداري"}</Text>
          {!!log.table_name&&<Text style={s.muted}>الجدول: {log.table_name}</Text>}
          {!!log.record_id&&<Text style={s.muted}>المعرّف: {log.record_id}</Text>}
          {!!log.created_at&&<Text style={s.muted}>{new Date(log.created_at).toLocaleString("ar-IQ")}</Text>}
          {!!log.details&&<Text style={s.detail}>{typeof log.details==="string"?log.details:JSON.stringify(log.details)}</Text>}
        </View>)}
        {!logs.length&&<Text style={s.muted}>ماكو عمليات مسجلة أو ما عندك صلاحية عرض السجل.</Text>}
      </>}
    </ScrollView>
  </View>;
}
function Action({label,onPress,disabled}:{label:string;onPress:()=>void;disabled?:boolean}) {
  return <TouchableOpacity disabled={disabled} onPress={onPress} style={[s.action,disabled&&{opacity:.5}]}><Text style={s.buttonText}>{label}</Text></TouchableOpacity>;
}
const s=StyleSheet.create({
  page:{flex:1,backgroundColor: palette.pageCanvas},content:{padding:space.lg,paddingBottom:48,gap:10},
  center:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor: palette.pageCanvas,padding:24,gap:10},
  title:{color:palette.ink,fontSize:21,fontWeight:"900",textAlign:"right"},cardTitle:{color:palette.ink,fontSize:14,fontWeight:"900",textAlign:"right"},
  muted:{color:palette.muted,fontSize:11,textAlign:"right",lineHeight:19},tabs:{flexDirection:"row",padding:10,gap:8,backgroundColor:palette.surface,borderBottomWidth:1,borderBottomColor:palette.line},
  tab:{flex:1,alignItems:"center",padding:11,borderRadius:radius.md},active:{backgroundColor:palette.brand},tabText:{color:palette.ink,fontSize:12,fontWeight:"800"},activeText:{color:palette.white},
  input:{backgroundColor:palette.surface,color:palette.ink,borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:12,textAlign:"right"},
  card:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:14,gap:8},selected:{borderColor:palette.brand,borderWidth:2},
  action:{minHeight:40,backgroundColor:palette.brand,borderRadius:16,paddingHorizontal:16,paddingVertical:8,alignItems:"center",justifyContent:"center"},buttonText:{color:palette.white,fontWeight:"900",fontSize:12},
  roleRow:{flexDirection:"row",alignItems:"center",gap:10,borderTopWidth:1,borderTopColor:palette.line,paddingTop:9},
  grant:{minHeight:36,backgroundColor:palette.brand,paddingHorizontal:12,paddingVertical:6,borderRadius:16,alignItems:"center",justifyContent:"center"},revoke:{minHeight:36,backgroundColor:palette.danger,paddingHorizontal:12,paddingVertical:6,borderRadius:16,alignItems:"center",justifyContent:"center"},
  detail:{color:palette.ink,fontSize:10,textAlign:"right"},error:{backgroundColor:palette.dangerSoft,padding:12,borderRadius:radius.md},errorText:{color:palette.danger,textAlign:"right",fontWeight:"800"},
});


const PERMISSIONS: [string,string][] = [
  ["dashboard.view","لوحة القيادة"],["analytics.view","عرض التحليلات"],
  ["live_map.read","عرض الخريطة المباشرة"],["reports.read","عرض البلاغات"],["reports.resolve","معالجة البلاغات"],
  ["chats.moderate","إدارة الدردشة الخاصة"],["friends.manage","إدارة الأصدقاء"],
  ["users.read","عرض العملاء"],["users.profile.edit","تعديل بيانات العملاء"],["users.block","حظر العملاء"],["users.unblock","إلغاء حظر العملاء"],
  ["providers.read","عرض مقدمي الخدمة"],["providers.profile.edit","تعديل بيانات مقدمي الخدمة"],
  ["providers.verify","توثيق مقدمي الخدمة"],["providers.suspend","إيقاف مقدمي الخدمة"],
  ["orders.read","عرض الطلبات"],["orders.assign","إدارة التعيين"],["orders.override","التدخل بالطلبات"],
  ["orders.cancel","إلغاء الطلبات إدارياً"],["orders.reopen","إعادة فتح الطلبات"],
  ["pricing.taxi.read","عرض تعرفة التاكسي"],["pricing.taxi.edit","تعديل تعرفة التاكسي"],
  ["pricing.peak.edit","الذروة والاستعجال"],["pricing.services.edit","تسعير الخدمات"],
  ["promotions.read","عرض الخصومات"],["promotions.manage","إدارة الخصومات"],
  ["finance.read","عرض المالية"],["finance.wallet.adjust","تسوية المحفظة"],["finance.refund","استرداد المدفوعات"],
  ["subscriptions.manage","الاشتراكات"],["support.manage","الدعم"],["notifications.send","الإشعارات"],
  ["regions.manage","المحافظات"],["staff.read","عرض الموظفين"],["staff.assign","إضافة موظفين"],
  ["staff.manage_created","إدارة الموظفين التابعين"],["staff.delegate","تفويض الصلاحيات"],
  ["staff.approve","مراجعة الموافقات"],["settings.manage","إعدادات المنصة"],["audit.read","سجل التدقيق"],
  ["reports.export","تصدير التقارير"],
];
const RANKS = ["general_manager","department_manager","supervisor","employee"];
const DEPARTMENTS = ["executive","customer_service","finance","operations","monitoring"];
const GOVERNORATES = ["baghdad","basra","nineveh","erbil","sulaymaniyah","duhok","kirkuk","najaf","karbala","babil","anbar","diyala","saladin","wasit","dhiqar","maysan","muthanna","qadisiyah"];
const LABELS: Record<string,string> = {
  general_manager:"مدير عام",department_manager:"مدير قسم",supervisor:"مشرف",employee:"موظف",
  executive:"الإدارة التنفيذية",customer_service:"خدمة العملاء",finance:"المالية",operations:"التشغيل",monitoring:"المراقبة",
  global:"كل المحافظات",governorate:"محافظة محددة",
};

function HierarchicalGovernancePanel() {
  const { user } = useAuth();
  const [staff,setStaff] = useState<any[]>([]);
  const [grants,setGrants] = useState<any[]>([]);
  const [delegations,setDelegations] = useState<any[]>([]);
  const [approvals,setApprovals] = useState<any[]>([]);
  const [query,setQuery] = useState("");
  const [candidates,setCandidates] = useState<any[]>([]);
  const [selected,setSelected] = useState<any|null>(null);
  const [rank,setRank] = useState("employee");
  const [department,setDepartment] = useState("customer_service");
  const [scopeType,setScopeType] = useState<"global"|"governorate">("global");
  const [governorate,setGovernorate] = useState("najaf");
  const [permission,setPermission] = useState("users.read");
  const [reason,setReason] = useState("");
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [panelTab,setPanelTab] = useState<"staff"|"permissions"|"delegations"|"approvals"|"pricing">("staff");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [staffRes,grantRes,delegationRes,approvalRes] = await Promise.all([
        (supabase as any).rpc("admin_list_managed_staff"),
        (supabase as any).from("admin_staff_permission_grants").select("id,user_id,permission_key,scope_type,scope_governorate,expires_at,granted_by").is("revoked_at",null).order("created_at",{ascending:false}).limit(100),
        (supabase as any).from("admin_staff_delegations").select("id,delegate_id,permission_key,scope_type,scope_governorate,expires_at,delegator_id").is("revoked_at",null).order("created_at",{ascending:false}).limit(100),
        (supabase as any).from("admin_approval_requests").select("id,requester_id,request_type,target_user_id,scope_type,scope_governorate,payload,status,created_at").eq("status","pending").order("created_at",{ascending:false}).limit(50),
      ]);
      if(staffRes.error) throw staffRes.error;
      if(grantRes.error) throw grantRes.error;
      if(delegationRes.error) throw delegationRes.error;
      if(approvalRes.error) throw approvalRes.error;
      setStaff(staffRes.data??[]); setGrants(grantRes.data??[]);
      setDelegations(delegationRes.data??[]); setApprovals(approvalRes.data??[]);
    } catch(e:any) { setError(e?.message||"تعذر تحميل إدارة الموظفين"); }
    finally { setLoading(false); }
  },[]);
  useEffect(()=>{ if(user?.id) void load(); },[user?.id,load]);

  async function run(action:()=>Promise<any>,success:string) {
    setBusy(true);
    try { await action(); Alert.alert("تم",success); await load(); }
    catch(e:any) { Alert.alert("تعذر التنفيذ",e?.message||"راجع الصلاحيات وحاول مرة ثانية"); }
    finally { setBusy(false); }
  }
  async function searchUsers() {
    if(query.trim().length<2) { Alert.alert("البحث","اكتب حرفين على الأقل"); return; }
    setBusy(true);
    const {data,error:searchError}=await (supabase as any).rpc("admin_search_staff_candidates",{p_query:query.trim()});
    setBusy(false);
    if(searchError) Alert.alert("تعذر البحث",searchError.message);
    else setCandidates(data??[]);
  }
  async function assign() {
    if(!selected) return;
    await run(async()=>{
      const {error:e}=await (supabase as any).rpc("admin_assign_staff",{
        p_target_user:selected.user_id,p_rank:rank,p_department:department,p_display_title:null,
        p_scope_type:scopeType,p_scope_governorate:scopeType==="global"?null:governorate,
      });
      if(e) throw e;
      setSelected(null); setCandidates([]); setQuery("");
    },"تم تعيين الموظف ضمن النطاق المحدد");
  }
  async function updateRank(person:any) {
    if (!selected || selected.user_id !== person.user_id || !person.active) {
      Alert.alert("اختَر الموظف أولاً", "حدد الموظف الذي تريد تعديل رتبته أو قسمه.");
      return;
    }
    await run(async()=>{
      const {error:e}=await (supabase as any).rpc("admin_change_staff_rank",{
        p_target_user:person.user_id,p_new_rank:rank,p_new_department:department,p_new_display_title:person.display_title ?? null,
      });
      if(e) throw e;
    },"تم تحديث رتبة الموظف أو تنزيلها وقسمه");
  }
  async function deactivate(person:any) {
    if(reason.trim().length<3) { Alert.alert("سبب الإيقاف","اكتب سبباً واضحاً قبل الإيقاف"); return; }
    await run(async()=>{
      const {error:e}=await (supabase as any).rpc("admin_deactivate_staff",{p_target_user:person.user_id,p_reason:reason.trim()});
      if(e) throw e;
      setReason("");
    },"تم إيقاف الموظف مع تسجيل السبب");
  }
  async function grant(targetId:string) {
    await run(async()=>{
      const {error:e}=await (supabase as any).rpc("admin_grant_staff_permission",{
        p_target_user:targetId,p_permission_key:permission,p_scope_type:scopeType,
        p_scope_governorate:scopeType==="global"?null:governorate,p_expires_at:null,
      });
      if(e) throw e;
    },"تم منح الصلاحية");
  }
  async function delegate(targetId:string) {
    await run(async()=>{
      const {error:e}=await (supabase as any).rpc("admin_create_delegation",{
        p_delegate_id:targetId,p_permission_key:permission,p_scope_type:scopeType,
        p_scope_governorate:scopeType==="global"?null:governorate,
        p_expires_at:new Date(Date.now()+7*24*60*60*1000).toISOString(),
      });
      if(e) throw e;
    },"تم إنشاء تفويض لمدة 7 أيام");
  }
  async function review(id:string,decision:"approved"|"rejected") {
    await run(async()=>{
      const {error:e}=await (supabase as any).rpc("admin_review_approval",{p_request_id:id,p_decision:decision,p_note:decision==="rejected"?"رُفض من لوحة الإدارة":null});
      if(e) throw e;
    },decision==="approved"?"تمت الموافقة على الطلب (بانتظار تنفيذ الإجراء)":"تم رفض الطلب");
  }
  async function revokeGrant(id:string) {
    await run(async()=>{const {error:e}=await (supabase as any).rpc("admin_revoke_staff_permission",{p_grant_id:id});if(e)throw e;},"تم سحب الصلاحية");
  }
  async function revokeDelegation(id:string) {
    await run(async()=>{const {error:e}=await (supabase as any).rpc("admin_revoke_delegation",{p_delegation_id:id});if(e)throw e;},"تم إلغاء التفويض");
  }

  const card={backgroundColor:palette.surface,borderColor:palette.line,borderWidth:1,borderRadius:radius.lg,padding:13,gap:8} as const;
  const button={backgroundColor:palette.brand,paddingHorizontal:12,paddingVertical:9,borderRadius:radius.md,alignItems:"center" as const};
  const muted={color:palette.muted,fontSize:11,textAlign:"right" as const,lineHeight:18};
  const title={color:palette.ink,fontWeight:"900" as const,fontSize:15,textAlign:"right" as const};
  const chip=(active:boolean)=>({backgroundColor:active?palette.brandSoft:palette.canvas,borderColor:active?palette.brand:palette.line,borderWidth:1,borderRadius:radius.pill,paddingHorizontal:9,paddingVertical:7});
  return <ScrollView contentContainerStyle={{padding:space.md,gap:12}} refreshControl={<RefreshControl refreshing={loading} onRefresh={()=>void load()}/>}>
    {!!error&&<View style={{...card,backgroundColor:palette.dangerSoft}}><Text style={{color:palette.danger,textAlign:"right"}}>{error}</Text></View>}
    <View style={{flexDirection:"row",flexWrap:"wrap",gap:6}}>
      {([
        ["staff","الموظفون"],
        ["permissions","الصلاحيات"],
        ["delegations","التفويضات"],
        ["approvals","الموافقات"],
        ["pricing","التسعير"],
      ] as const).map(([key,label])=><TouchableOpacity key={key} onPress={()=>setPanelTab(key)} style={[chip(panelTab===key),{paddingHorizontal:12,paddingVertical:10}]}><Text style={[muted,{fontWeight:"900",color:panelTab===key?palette.brand:palette.muted}]}>{label}</Text></TouchableOpacity>)}
    </View>

    {panelTab==="staff"&&<>
      <View style={card}>
        <Text style={title}>إضافة موظف جديد</Text>
        <Text style={muted}>ابحث عن حساب، ثم حدّد الرتبة والقسم ونطاق العمل. النظام يمنع تجاوز صلاحياتك أو ترقية شخص فوق رتبتك.</Text>
        <TextInput value={query} onChangeText={setQuery} placeholder="ابحث بالاسم أو الهاتف أو البريد" placeholderTextColor={palette.muted} style={s.input}/>
        <TouchableOpacity disabled={busy} onPress={()=>void searchUsers()} style={[button,{opacity:busy?0.5:1}]}><Text style={s.buttonText}>{busy?"جاري التنفيذ...":"بحث عن حساب"}</Text></TouchableOpacity>
        {candidates.map(p=><TouchableOpacity key={p.user_id} onPress={()=>setSelected(p)} style={[card,{borderColor:selected?.user_id===p.user_id?palette.brand:palette.line}]}>
          <Text style={title}>{p.full_name||"مستخدم ممنون"}</Text><Text style={muted}>{p.phone||p.email||p.user_id} · {p.governorate_key||"المحافظة غير محددة"}</Text>
          {selected?.user_id===p.user_id&&<Text style={[muted,{color:palette.brand,fontWeight:"900"}]}>هذا الحساب محدد للإضافة</Text>}
        </TouchableOpacity>)}
        <Text style={muted}>الرتبة الوظيفية</Text>
        <View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{RANKS.map(v=><TouchableOpacity key={v} onPress={()=>setRank(v)} style={chip(rank===v)}><Text style={[muted,{color:rank===v?palette.brand:palette.muted}]}>{LABELS[v]}</Text></TouchableOpacity>)}</View>
        <Text style={muted}>القسم</Text>
        <View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{DEPARTMENTS.map(v=><TouchableOpacity key={v} onPress={()=>setDepartment(v)} style={chip(department===v)}><Text style={[muted,{color:department===v?palette.brand:palette.muted}]}>{LABELS[v]}</Text></TouchableOpacity>)}</View>
        <Text style={muted}>نطاق العمل</Text>
        <View style={{flexDirection:"row",gap:6,justifyContent:"flex-end"}}>{(["global","governorate"] as const).map(v=><TouchableOpacity key={v} onPress={()=>setScopeType(v)} style={chip(scopeType===v)}><Text style={[muted,{color:scopeType===v?palette.brand:palette.muted}]}>{LABELS[v]}</Text></TouchableOpacity>)}</View>
        {scopeType==="governorate"&&<View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{GOVERNORATES.map(v=><TouchableOpacity key={v} onPress={()=>setGovernorate(v)} style={chip(governorate===v)}><Text style={[muted,{color:governorate===v?palette.brand:palette.muted}]}>{v}</Text></TouchableOpacity>)}</View>}
        <TouchableOpacity disabled={busy||!selected} onPress={()=>void assign()} style={[button,{opacity:busy||!selected?0.5:1}]}><Text style={s.buttonText}>تعيين الموظف</Text></TouchableOpacity>
      </View>
      <View style={card}>
        <Text style={title}>الموظفون ضمن صلاحيتك ({staff.length})</Text>
        <Text style={muted}>افتح الموظف الذي تريد ترقيته أو تنزيل رتبته أو تغيير قسمه، ثم احفظ التعديل من تبويب الصلاحيات.</Text>
        <TextInput value={reason} onChangeText={setReason} placeholder="سبب إيقاف الموظف عند الحاجة" placeholderTextColor={palette.muted} style={s.input}/>
        {staff.map(p=><View key={p.user_id} style={{borderTopWidth:1,borderTopColor:palette.line,paddingTop:10,gap:6}}>
          <Text style={title}>{p.full_name||p.phone||"موظف"}</Text>
          <Text style={muted}>{LABELS[p.rank]||p.rank} · {LABELS[p.department]||p.department} · {p.scope_type==="global"?"كل المحافظات":p.scope_governorate||"نطاق قديم"}</Text>
          <Text style={muted}>{p.phone||p.email||p.user_id}</Text>
          {p.active&&<View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>
            <TouchableOpacity onPress={()=>{setSelected(p);setRank(p.rank);setDepartment(p.department);setScopeType(p.scope_type==="governorate"?"governorate":"global");setPanelTab("permissions");}} style={chip(selected?.user_id===p.user_id)}><Text style={[muted,{color:selected?.user_id===p.user_id?palette.brand:palette.muted}]}>تعديل الرتبة والصلاحيات</Text></TouchableOpacity>
            <TouchableOpacity disabled={busy||reason.trim().length<3} onPress={()=>void deactivate(p)} style={[button,{backgroundColor:palette.danger,opacity:reason.trim().length<3?0.5:1}]}><Text style={s.buttonText}>إيقاف الموظف</Text></TouchableOpacity>
          </View>}
        </View>)}
        {!staff.length&&!loading&&<Text style={muted}>لا يوجد موظفون ضمن نطاق إدارتك.</Text>}
      </View>
    </>}

    {panelTab==="permissions"&&<>
      {!!selected&&<View style={card}>
        <Text style={title}>تعديل الموظف: {selected.full_name||selected.user_id}</Text>
        <Text style={muted}>يمكنك اختيار رتبة أعلى للترقية أو أدنى للتنزيل، وتغيير القسم. ستتحقق قاعدة البيانات من التسلسل الإداري قبل الحفظ.</Text>
        <Text style={muted}>الرتبة الجديدة</Text>
        <View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{RANKS.map(v=><TouchableOpacity key={v} onPress={()=>setRank(v)} style={chip(rank===v)}><Text style={[muted,{color:rank===v?palette.brand:palette.muted}]}>{LABELS[v]}</Text></TouchableOpacity>)}</View>
        <Text style={muted}>القسم الجديد</Text>
        <View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{DEPARTMENTS.map(v=><TouchableOpacity key={v} onPress={()=>setDepartment(v)} style={chip(department===v)}><Text style={[muted,{color:department===v?palette.brand:palette.muted}]}>{LABELS[v]}</Text></TouchableOpacity>)}</View>
        <TouchableOpacity disabled={busy||!selected.active} onPress={()=>void updateRank(selected)} style={[button,{opacity:busy||!selected.active?0.5:1}]}><Text style={s.buttonText}>حفظ الترقية أو تنزيل الرتبة</Text></TouchableOpacity>
        <TouchableOpacity onPress={()=>setSelected(null)} style={[chip(false),{alignItems:"center"}]}><Text style={muted}>إلغاء تحديد الموظف</Text></TouchableOpacity>
      </View>}
      {!selected&&<View style={card}><Text style={title}>حدد موظفاً أولاً</Text><Text style={muted}>ارجع إلى تبويب الموظفون واختر الموظف المطلوب لتعديل رتبته ومنحه الصلاحيات.</Text></View>}
      {!!selected&&<View style={card}>
        <Text style={title}>منح صلاحية: {selected.full_name||selected.user_id}</Text>
        <Text style={muted}>اختر صلاحية ونطاقاً لا يتجاوزان صلاحياتك.</Text>
        <View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{PERMISSIONS.map(([key,label])=><TouchableOpacity key={key} onPress={()=>setPermission(key)} style={chip(permission===key)}><Text style={[muted,{color:permission===key?palette.brand:palette.muted}]}>{label}</Text></TouchableOpacity>)}</View>
        <View style={{flexDirection:"row",gap:6,justifyContent:"flex-end"}}>{(["global","governorate"] as const).map(v=><TouchableOpacity key={v} onPress={()=>setScopeType(v)} style={chip(scopeType===v)}><Text style={[muted,{color:scopeType===v?palette.brand:palette.muted}]}>{LABELS[v]}</Text></TouchableOpacity>)}</View>
        {scopeType==="governorate"&&<View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{GOVERNORATES.map(v=><TouchableOpacity key={v} onPress={()=>setGovernorate(v)} style={chip(governorate===v)}><Text style={[muted,{color:governorate===v?palette.brand:palette.muted}]}>{v}</Text></TouchableOpacity>)}</View>}
        <TouchableOpacity disabled={busy||!selected.active} onPress={()=>void grant(selected.user_id)} style={[button,{opacity:busy||!selected.active?0.5:1}]}><Text style={s.buttonText}>منح الصلاحية</Text></TouchableOpacity>
      </View>}
      <View style={card}>
        <Text style={title}>الصلاحيات الممنوحة ({grants.length})</Text>
        {grants.map(g=><View key={g.id} style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8,borderTopWidth:1,borderTopColor:palette.line,paddingTop:8}}>
          <View style={{flex:1}}><Text style={muted}>{PERMISSIONS.find(x=>x[0]===g.permission_key)?.[1]||g.permission_key} · {g.scope_type==="global"?"كل المحافظات":g.scope_governorate}</Text><Text style={muted}>{g.user_id}</Text></View>
          <TouchableOpacity disabled={busy} onPress={()=>void revokeGrant(g.id)} style={[button,{backgroundColor:palette.danger}]}><Text style={s.buttonText}>سحب</Text></TouchableOpacity>
        </View>)}
        {!grants.length&&<Text style={muted}>لا توجد صلاحيات إضافية ممنوحة.</Text>}
      </View>
    </>}

    {panelTab==="delegations"&&<View style={card}>
      <Text style={title}>التفويضات الفعّالة ({delegations.length})</Text>
      <Text style={muted}>التفويض يمنح صلاحية محددة لمدة سبعة أيام ويمكن إلغاؤه من هنا.</Text>
      {delegations.map(d=><View key={d.id} style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8,borderTopWidth:1,borderTopColor:palette.line,paddingTop:8}}>
        <View style={{flex:1}}><Text style={muted}>{PERMISSIONS.find(x=>x[0]===d.permission_key)?.[1]||d.permission_key} · إلى {d.delegate_id}</Text><Text style={muted}>{d.scope_type==="global"?"كل المحافظات":d.scope_governorate} · {d.expires_at?new Date(d.expires_at).toLocaleDateString("ar-IQ"):"بدون انتهاء"}</Text></View>
        <TouchableOpacity disabled={busy} onPress={()=>void revokeDelegation(d.id)} style={[button,{backgroundColor:palette.danger}]}><Text style={s.buttonText}>إلغاء</Text></TouchableOpacity>
      </View>)}
      {!delegations.length&&<Text style={muted}>لا توجد تفويضات فعّالة.</Text>}
    </View>}

    {panelTab==="approvals"&&<View style={card}>
      <Text style={title}>طلبات الموافقة ({approvals.length})</Text>
      {approvals.map(a=><View key={a.id} style={{borderTopWidth:1,borderTopColor:palette.line,paddingTop:8,gap:6}}>
        <Text style={title}>{a.request_type} · {a.scope_type==="global"?"كل المحافظات":a.scope_governorate}</Text><Text style={muted}>مقدم الطلب: {a.requester_id} · {new Date(a.created_at).toLocaleString("ar-IQ")}</Text>
        <View style={{flexDirection:"row",gap:8}}><TouchableOpacity disabled={busy} onPress={()=>void review(a.id,"approved")} style={[button,{flex:1}]}><Text style={s.buttonText}>موافقة</Text></TouchableOpacity><TouchableOpacity disabled={busy} onPress={()=>void review(a.id,"rejected")} style={[button,{flex:1,backgroundColor:palette.danger}]}><Text style={s.buttonText}>رفض</Text></TouchableOpacity></View>
      </View>)}
      {!approvals.length&&<Text style={muted}>لا توجد طلبات معلقة ضمن صلاحيتك.</Text>}
    </View>}

    {panelTab==="pricing"&&<TaxiPricingPanel />}
  </ScrollView>;
}


function TaxiPricingPanel() {
  const [tariffs,setTariffs]=useState<any[]>([]);
  const [global,setGlobal]=useState<any>({peak_enabled:false,peak_percent:0,urgency_enabled:false,urgency_max_percent:10});
  const [regional,setRegional]=useState<any>({peak_enabled:false,peak_percent:0});
  const [governorate,setGovernorate]=useState("najaf");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [canTariff,setCanTariff]=useState(false);
  const [canGlobalPeak,setCanGlobalPeak]=useState(false);
  const [canRegionalPeak,setCanRegionalPeak]=useState(false);
  const [error,setError]=useState("");
  const inputStyle={backgroundColor:palette.canvas,borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:10,color:palette.ink,textAlign:"right" as const,flex:1};
  const labelStyle={color:palette.ink,fontSize:11,fontWeight:"800" as const,textAlign:"right" as const};
  const cardStyle={backgroundColor:palette.surface,borderColor:palette.line,borderWidth:1,borderRadius:radius.lg,padding:13,gap:9};
  const load=useCallback(async()=>{
    setLoading(true);setError("");
    const [tariffPermission,globalPeakPermission,regionalPeakPermission,tariffResult,controlResult]=await Promise.all([
      (supabase as any).rpc("admin_has_permission",{p_permission_key:"pricing.taxi.edit",p_scope_type:"global",p_scope_governorate:null}),
      (supabase as any).rpc("admin_has_permission",{p_permission_key:"pricing.peak.edit",p_scope_type:"global",p_scope_governorate:null}),
      (supabase as any).rpc("admin_has_permission",{p_permission_key:"pricing.peak.edit",p_scope_type:"governorate",p_scope_governorate:governorate}),
      (supabase as any).from("pricing_settings").select("id,service_type,is_intercity,base_fare,per_km_rate,per_min_rate,min_fare").order("is_intercity").order("service_type"),
      (supabase as any).from("taxi_pricing_controls").select("governorate_key,peak_enabled,peak_percent,urgency_enabled,urgency_max_percent"),
    ]);
    const tariffOk=!tariffPermission.error&&tariffPermission.data===true;
    const globalPeakOk=!globalPeakPermission.error&&globalPeakPermission.data===true;
    const regionalPeakOk=!regionalPeakPermission.error&&regionalPeakPermission.data===true;
    setCanTariff(tariffOk);setCanGlobalPeak(globalPeakOk);setCanRegionalPeak(regionalPeakOk);
    if(!tariffOk&&!globalPeakOk&&!regionalPeakOk){setError("ما عندك صلاحية لتعديل التعرفة أو الذروة ضمن هذا النطاق.");setLoading(false);return;}
    if(tariffResult.error||controlResult.error){setError(tariffResult.error?.message||controlResult.error?.message||"تعذر تحميل الأسعار");}
    else{
      setTariffs((tariffResult.data??[]).map((r:any)=>({...r,base_fare:Number(r.base_fare)||0,per_km_rate:Number(r.per_km_rate)||0,per_min_rate:Number(r.per_min_rate)||0,min_fare:Math.max(1000,Number(r.min_fare)||0)})));
      const controls=controlResult.data??[];
      setGlobal(controls.find((r:any)=>r.governorate_key==="all")??{peak_enabled:false,peak_percent:0,urgency_enabled:false,urgency_max_percent:10});
      setRegional(controls.find((r:any)=>r.governorate_key===governorate)??{peak_enabled:false,peak_percent:0});
    }
    setLoading(false);
  },[governorate]);
  useEffect(()=>{void load();},[load]);
  async function saveTariff(row:any){
    setSaving(true);
    const {error:e}=await (supabase as any).rpc("admin_update_taxi_pricing_settings",{
      p_service_type:row.service_type,p_is_intercity:row.is_intercity,p_base_fare:Number(row.base_fare),
      p_per_km_rate:Number(row.per_km_rate),p_per_min_rate:Number(row.per_min_rate),p_min_fare:Number(row.min_fare),
    });
    setSaving(false);
    if(e)Alert.alert("تعذر حفظ التعرفة",e.message);else{Alert.alert("تم","انحفظت التعرفة وتوثق التغيير بسجل التدقيق.");await load();}
  }
  async function saveControl(key:string,row:any){
    setSaving(true);
    const {error:e}=await (supabase as any).rpc("admin_update_taxi_pricing_control",{
      p_governorate_key:key,p_peak_enabled:row.peak_enabled,p_peak_percent:Number(row.peak_percent)||0,
      p_urgency_enabled:key==="all"?global.urgency_enabled:false,
      p_urgency_max_percent:Number(global.urgency_max_percent)||10,
    });
    setSaving(false);
    if(e)Alert.alert("تعذر حفظ إعداد الذروة",e.message);else{Alert.alert("تم","انحفظت الإعدادات.");await load();}
  }
  if(loading)return <View style={cardStyle}><ActivityIndicator color={palette.brand}/><Text style={labelStyle}>تحميل تعرفة التاكسي...</Text></View>;
  if(!canTariff&&!canGlobalPeak&&!canRegionalPeak)return <View style={cardStyle}><Text style={labelStyle}>{error||"غير مصرّح"}</Text></View>;
  return <View style={{gap:12}}>
    <View style={cardStyle}>
      {canTariff&&<><Text style={{...labelStyle,fontSize:16}}>تعرفة التاكسي الأساسية</Text>
      <Text style={labelStyle}>تعرفة الاقتصاد هي أساس حساب كل الفئات؛ المتميز والفاخر يطبّق عليهما فرق الفئة المتفق عليه، مع حد أدنى مستقل فقط. كل حفظ موثق بسجل التدقيق.</Text>
      {tariffs.map(row=><View key={row.id} style={{borderTopWidth:1,borderTopColor:palette.line,paddingTop:10,gap:8}}>
        <Text style={labelStyle}>{row.service_type==="economy"?"اقتصادي":row.service_type==="premium"?"متميز":"فاخر"} · {row.is_intercity?"بين المحافظات":"داخل المدينة"}</Text>
        {(row.service_type==="economy"?["base_fare","per_km_rate","per_min_rate","min_fare"]:["min_fare"]).map((key:string)=> <View key={key} style={{flexDirection:"row",alignItems:"center",gap:8}}><Text style={[labelStyle,{width:104}]}>{key==="base_fare"?"أجرة الانطلاق":key==="per_km_rate"?"سعر الكيلومتر":key==="per_min_rate"?"سعر الدقيقة":"الحد الأدنى للفئة"}</Text><TextInput keyboardType="numeric" value={String(row[key])} onChangeText={v=>setTariffs(old=>old.map(t=>t.id===row.id?{...t,[key]:Number(v)||0}:t))} style={inputStyle}/></View>)}
        <TouchableOpacity disabled={saving} onPress={()=>void saveTariff(row)} style={{backgroundColor:palette.brand,padding:10,borderRadius:radius.md,alignItems:"center"}}><Text style={{color:palette.white,fontWeight:"900"}}>حفظ التعرفة</Text></TouchableOpacity>
      </View>)}
      </>}
    </View>
    <View style={cardStyle}>
      {(canGlobalPeak||canRegionalPeak)&&<Text style={{...labelStyle,fontSize:16}}>الاستعجال والذروة</Text>}
      {canGlobalPeak&&<><View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}><Text style={labelStyle}>تفعيل الاستعجال لكل العراق</Text><Switch value={!!global.urgency_enabled} onValueChange={v=>setGlobal((x:any)=>({...x,urgency_enabled:v}))}/></View>
      <Text style={labelStyle}>أعلى زيادة للاستعجال (%)</Text><TextInput keyboardType="numeric" value={String(global.urgency_max_percent)} onChangeText={v=>setGlobal((x:any)=>({...x,urgency_max_percent:Number(v)||0}))} style={inputStyle}/>
      <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}><Text style={labelStyle}>تفعيل الذروة العامة</Text><Switch value={!!global.peak_enabled} onValueChange={v=>setGlobal((x:any)=>({...x,peak_enabled:v}))}/></View>
      <Text style={labelStyle}>نسبة الذروة العامة (%)</Text><TextInput keyboardType="numeric" value={String(global.peak_percent)} onChangeText={v=>setGlobal((x:any)=>({...x,peak_percent:Number(v)||0}))} style={inputStyle}/>
      <TouchableOpacity disabled={saving} onPress={()=>void saveControl("all",global)} style={{backgroundColor:palette.brand,padding:10,borderRadius:radius.md,alignItems:"center"}}><Text style={{color:palette.white,fontWeight:"900"}}>حفظ الإعداد العام</Text></TouchableOpacity></>}
      {canRegionalPeak&&<><Text style={labelStyle}>ذروة محافظة محددة</Text>
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{GOVERNORATES.map(g=><TouchableOpacity key={g} onPress={()=>setGovernorate(g)} style={{backgroundColor:governorate===g?palette.brandSoft:palette.canvas,borderWidth:1,borderColor:governorate===g?palette.brand:palette.line,padding:7,borderRadius:radius.pill}}><Text style={labelStyle}>{g}</Text></TouchableOpacity>)}</View>
      <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}><Text style={labelStyle}>تفعيل الذروة في {governorate}</Text><Switch value={!!regional.peak_enabled} onValueChange={v=>setRegional((x:any)=>({...x,peak_enabled:v}))}/></View>
      <Text style={labelStyle}>نسبة الذروة (%)</Text><TextInput keyboardType="numeric" value={String(regional.peak_percent)} onChangeText={v=>setRegional((x:any)=>({...x,peak_percent:Number(v)||0}))} style={inputStyle}/>
      <TouchableOpacity disabled={saving} onPress={()=>void saveControl(governorate,regional)} style={{backgroundColor:palette.brand,padding:10,borderRadius:radius.md,alignItems:"center"}}><Text style={{color:palette.white,fontWeight:"900"}}>حفظ ذروة المحافظة</Text></TouchableOpacity></>}
      <Text style={labelStyle}>الاستعجال والذروة يطبّقان على سيارات الاقتصاد والمتميز والفاخرة فقط.</Text>
    </View>
  </View>;
}
