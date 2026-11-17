import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type UserRow = { id: string; full_name?: string | null; phone?: string | null; email?: string | null };
type RoleRow = string | { role?: string };
type AuditRow = { id?: string; action?: string; table_name?: string; record_id?: string; created_at?: string; details?: any; admin?: { full_name?: string; phone?: string } };
const ROLES = [
  ["admin", "مدير"], ["support", "دعم فني"], ["finance", "مالية"], ["moderator", "مشرف محتوى"],
] as const;

export default function AdminGovernanceScreen() {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [tab, setTab] = useState<"roles" | "audit" | "hierarchy">("hierarchy");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [logs, setLogs] = useState<AuditRow[]>([]);
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
      const [staff, admin, root] = await Promise.all([
        supabase.rpc("has_staff_role", { p_user_id: user.id }),
        supabase.rpc("has_admin_access", { p_user_id: user.id }),
        supabase.rpc("is_super_admin", { p_user_id: user.id }),
      ]);
      if (staff.error || staff.data !== true) { setAllowed(false); return; }
      setAllowed(true);
      setSuperAdmin(root.data === true);
      if (admin.data === true) {
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
  ["dashboard.view","لوحة القيادة"],["users.read","عرض العملاء"],["users.block","حظر العملاء"],
  ["providers.read","عرض مقدمي الخدمة"],["providers.verify","توثيق مقدمي الخدمة"],["providers.suspend","إيقاف مقدمي الخدمة"],
  ["orders.read","عرض الطلبات"],["orders.assign","إدارة التعيين"],["orders.override","التدخل بالطلبات"],
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
    await run(async()=>{
      const {error:e}=await (supabase as any).rpc("admin_change_staff_rank",{
        p_target_user:person.user_id,p_new_rank:rank,p_new_department:department,p_new_display_title:null,
      });
      if(e) throw e;
    },"تم تحديث رتبة الموظف وقسمه");
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
    <View style={card}>
      <Text style={title}>إضافة موظف جديد</Text>
      <Text style={muted}>البحث يعرض الحسابات ضمن نطاقك فقط، ولا يتيح ترقية شخص إلى رتبة مساوية أو أعلى.</Text>
      <TextInput value={query} onChangeText={setQuery} placeholder="ابحث بالاسم أو الهاتف أو البريد" placeholderTextColor={palette.muted} style={s.input}/>
      <TouchableOpacity disabled={busy} onPress={()=>void searchUsers()} style={button}><Text style={s.buttonText}>بحث عن حساب</Text></TouchableOpacity>
      {candidates.map(p=><TouchableOpacity key={p.user_id} onPress={()=>setSelected(p)} style={[card,{borderColor:selected?.user_id===p.user_id?palette.brand:palette.line}]}>
        <Text style={title}>{p.full_name||"مستخدم ممنون"}</Text><Text style={muted}>{p.phone||p.email||p.user_id} · {p.governorate_key||"المحافظة غير محددة"}</Text>
      </TouchableOpacity>)}
      {!!selected&&<Text style={muted}>المحدد: {selected.full_name||selected.user_id}</Text>}
      <Text style={muted}>الرتبة</Text><View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{RANKS.map(v=><TouchableOpacity key={v} onPress={()=>setRank(v)} style={chip(rank===v)}><Text style={muted}>{LABELS[v]}</Text></TouchableOpacity>)}</View>
      <Text style={muted}>القسم</Text><View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{DEPARTMENTS.map(v=><TouchableOpacity key={v} onPress={()=>setDepartment(v)} style={chip(department===v)}><Text style={muted}>{LABELS[v]}</Text></TouchableOpacity>)}</View>
      <Text style={muted}>نطاق العمل</Text><View style={{flexDirection:"row",gap:6,justifyContent:"flex-end"}}>{(["global","governorate"] as const).map(v=><TouchableOpacity key={v} onPress={()=>setScopeType(v)} style={chip(scopeType===v)}><Text style={muted}>{LABELS[v]}</Text></TouchableOpacity>)}</View>
      {scopeType==="governorate"&&<View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{GOVERNORATES.map(v=><TouchableOpacity key={v} onPress={()=>setGovernorate(v)} style={chip(governorate===v)}><Text style={muted}>{v}</Text></TouchableOpacity>)}</View>}
      <TouchableOpacity disabled={busy||!selected} onPress={()=>void assign()} style={[button,{opacity:busy||!selected?0.5:1}]}><Text style={s.buttonText}>تعيين الموظف</Text></TouchableOpacity>
    </View>
    <View style={card}>
      <Text style={title}>الموظفون ضمن صلاحيتك ({staff.length})</Text>
      <TextInput value={reason} onChangeText={setReason} placeholder="سبب إيقاف الموظف عند الحاجة" placeholderTextColor={palette.muted} style={s.input}/>
      {staff.map(p=><View key={p.user_id} style={{borderTopWidth:1,borderTopColor:palette.line,paddingTop:9,gap:6}}>
        <Text style={title}>{p.full_name||p.phone||"موظف"}</Text><Text style={muted}>{LABELS[p.rank]||p.rank} · {LABELS[p.department]||p.department} · {p.scope_type==="global"?"كل المحافظات":p.scope_governorate||"نطاق قديم"}</Text>
        <Text style={muted}>{p.phone||p.email||p.user_id}</Text>
        {p.active&&<View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>
          <TouchableOpacity onPress={()=>{setSelected(p);setRank(p.rank);setDepartment(p.department);}} style={chip(false)}><Text style={muted}>اختيار للتعديل والصلاحيات</Text></TouchableOpacity>
          <TouchableOpacity disabled={busy} onPress={()=>void updateRank(p)} style={button}><Text style={s.buttonText}>حفظ الرتبة المختارة</Text></TouchableOpacity>
          <TouchableOpacity disabled={busy||reason.trim().length<3} onPress={()=>void deactivate(p)} style={[button,{backgroundColor:palette.danger,opacity:reason.trim().length<3?0.5:1}]}><Text style={s.buttonText}>إيقاف الموظف</Text></TouchableOpacity>
        </View>}
      </View>)}
      {!staff.length&&!loading&&<Text style={muted}>لا يوجد موظفون ضمن نطاق إدارتك.</Text>}
    </View>
    {!!selected&&<View style={card}>
      <Text style={title}>صلاحيات وتفويض: {selected.full_name||selected.user_id}</Text>
      <Text style={muted}>اختر صلاحية ونطاقاً لا يتجاوزان صلاحياتك.</Text>
      <View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{PERMISSIONS.map(([key,label])=><TouchableOpacity key={key} onPress={()=>setPermission(key)} style={chip(permission===key)}><Text style={muted}>{label}</Text></TouchableOpacity>)}</View>
      <View style={{flexDirection:"row",gap:6,justifyContent:"flex-end"}}>{(["global","governorate"] as const).map(v=><TouchableOpacity key={v} onPress={()=>setScopeType(v)} style={chip(scopeType===v)}><Text style={muted}>{LABELS[v]}</Text></TouchableOpacity>)}</View>
      {scopeType==="governorate"&&<View style={{flexDirection:"row",flexWrap:"wrap",gap:6,justifyContent:"flex-end"}}>{GOVERNORATES.map(v=><TouchableOpacity key={v} onPress={()=>setGovernorate(v)} style={chip(governorate===v)}><Text style={muted}>{v}</Text></TouchableOpacity>)}</View>}
      <View style={{flexDirection:"row",gap:8}}><TouchableOpacity disabled={busy} onPress={()=>void grant(selected.user_id)} style={[button,{flex:1}]}><Text style={s.buttonText}>منح صلاحية</Text></TouchableOpacity><TouchableOpacity disabled={busy} onPress={()=>void delegate(selected.user_id)} style={[button,{flex:1}]}><Text style={s.buttonText}>تفويض 7 أيام</Text></TouchableOpacity></View>
    </View>}
    <View style={card}>
      <Text style={title}>الصلاحيات الممنوحة ({grants.length})</Text>
      {grants.map(g=><View key={g.id} style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8,borderTopWidth:1,borderTopColor:palette.line,paddingTop:8}}>
        <View style={{flex:1}}><Text style={muted}>{PERMISSIONS.find(x=>x[0]===g.permission_key)?.[1]||g.permission_key} · {g.scope_type==="global"?"كل المحافظات":g.scope_governorate}</Text><Text style={muted}>{g.user_id}</Text></View>
        <TouchableOpacity disabled={busy} onPress={()=>void revokeGrant(g.id)} style={[button,{backgroundColor:palette.danger}]}><Text style={s.buttonText}>سحب</Text></TouchableOpacity>
      </View>)}
    </View>
    <View style={card}>
      <Text style={title}>التفويضات الفعّالة ({delegations.length})</Text>
      {delegations.map(d=><View key={d.id} style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8,borderTopWidth:1,borderTopColor:palette.line,paddingTop:8}}>
        <View style={{flex:1}}><Text style={muted}>{PERMISSIONS.find(x=>x[0]===d.permission_key)?.[1]||d.permission_key} · إلى {d.delegate_id}</Text><Text style={muted}>{d.scope_type==="global"?"كل المحافظات":d.scope_governorate} · {d.expires_at?new Date(d.expires_at).toLocaleDateString("ar-IQ"):"بدون انتهاء"}</Text></View>
        <TouchableOpacity disabled={busy} onPress={()=>void revokeDelegation(d.id)} style={[button,{backgroundColor:palette.danger}]}><Text style={s.buttonText}>إلغاء</Text></TouchableOpacity>
      </View>)}
    </View>
    <View style={card}>
      <Text style={title}>طلبات الموافقة ({approvals.length})</Text>
      {approvals.map(a=><View key={a.id} style={{borderTopWidth:1,borderTopColor:palette.line,paddingTop:8,gap:6}}>
        <Text style={title}>{a.request_type} · {a.scope_type==="global"?"كل المحافظات":a.scope_governorate}</Text><Text style={muted}>مقدم الطلب: {a.requester_id} · {new Date(a.created_at).toLocaleString("ar-IQ")}</Text>
        <View style={{flexDirection:"row",gap:8}}><TouchableOpacity disabled={busy} onPress={()=>void review(a.id,"approved")} style={[button,{flex:1}]}><Text style={s.buttonText}>موافقة</Text></TouchableOpacity><TouchableOpacity disabled={busy} onPress={()=>void review(a.id,"rejected")} style={[button,{flex:1,backgroundColor:palette.danger}]}><Text style={s.buttonText}>رفض</Text></TouchableOpacity></View>
      </View>)}
      {!approvals.length&&<Text style={muted}>لا توجد طلبات معلقة ضمن صلاحيتك.</Text>}
    </View>
  </ScrollView>;
}
