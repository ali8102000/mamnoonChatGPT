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
  const [tab, setTab] = useState<"roles" | "audit">("roles");
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
      <TouchableOpacity onPress={()=>setTab("roles")} style={[s.tab,tab==="roles"&&s.active]}><Text style={[s.tabText,tab==="roles"&&s.activeText]}>الصلاحيات</Text></TouchableOpacity>
      <TouchableOpacity onPress={()=>setTab("audit")} style={[s.tab,tab==="audit"&&s.active]}><Text style={[s.tabText,tab==="audit"&&s.activeText]}>سجل العمليات</Text></TouchableOpacity>
    </View>
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
      {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
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
