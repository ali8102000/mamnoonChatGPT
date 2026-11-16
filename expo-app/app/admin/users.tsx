import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Modal, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";
import { getAdminStaffRoles } from "@/lib/admin-access";
import { showContactOptions } from "@/lib/contact-actions";

type UserRow = {
  id: string; full_name: string | null; phone: string | null; email: string | null;
  created_at: string; avatar_url?: string | null;
  blocked?: { reason?: string | null; expires_at?: string | null; blocked_at?: string | null } | null;
};
type Detail = {
  profile: any; roles: { role: string; created_at: string }[]; block: any;
  driverProfile: any; workerProfile: any; transactions: any[]; requests: any[]; ratings: any[];
  ratings_error?: boolean;
};
const DURATIONS = [
  ["1_hour", "ساعة واحدة"], ["1_day", "يوم واحد"], ["1_week", "أسبوع"],
  ["1_month", "شهر"], ["permanent", "دائم"],
] as const;

export default function AdminUsersScreen() {
  const { user, loading: authLoading } = useAuth();
  const [canView, setCanView] = useState<boolean | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [editName, setEditName] = useState("");
  const [editGovernorate, setEditGovernorate] = useState("");
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarMime, setAvatarMime] = useState<"image/jpeg" | "image/png" | "image/webp">("image/jpeg");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [blockTarget, setBlockTarget] = useState<UserRow | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [duration, setDuration] = useState<(typeof DURATIONS)[number][0]>("permanent");
  const [error, setError] = useState("");

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: invokeError } = await supabase.functions.invoke("admin-users", { body });
    if (invokeError) throw new Error(invokeError.message || "تعذر الاتصال بخدمة إدارة المستخدمين");
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError("");
    try {
      const roleNames = await getAdminStaffRoles(user.id);
      if (!roleNames.some((role: string) => ["super_admin", "admin", "support", "moderator", "department_monitoring"].includes(role))) {
        setCanView(false); setRows([]); return;
      }
      setCanManage(roleNames.includes("super_admin") || roleNames.includes("admin"));
      setCanView(true);
      const result = await invoke(query.trim().length >= 2
        ? { action: "search", query: query.trim() }
        : { action: "list", page, limit: 50 });
      setRows(result.users ?? []);
      setTotal(result.total ?? result.users?.length ?? 0);
    } catch (e: any) {
      setError(String(e?.message || "تعذر تحميل المستخدمين"));
    } finally {
      setLoading(false);
    }
  }, [user?.id, query, page, invoke]);

  useEffect(() => {
    if (!authLoading) {
      if (!user) { setCanView(false); setLoading(false); }
      else void load();
    }
  }, [authLoading, user, load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const showDetail = async (id: string) => {
    setBusyId(id);
    try { const loaded = await invoke({ action: "detail", user_id: id }); setDetail(loaded); setEditName(loaded.profile?.full_name ?? ""); setEditGovernorate(loaded.profile?.governorate_key ?? ""); setAvatarBase64(null); setAvatarPreview(loaded.profile?.avatar_url ?? null); }
    catch (e: any) { Alert.alert("تعذر تحميل التفاصيل", String(e?.message || "حاول مرة ثانية")); }
    finally { setBusyId(null); }
  };


  const pickAdminAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert("إذن الصور", "اسمح بالوصول للصور حتى تختار صورة المستخدم."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1,1],
      quality: 0.82, base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) { Alert.alert("حجم الصورة", "اختر صورة أقل من 5 ميغابايت."); return; }
    setAvatarBase64(asset.base64);
    const mime = asset.mimeType || "image/jpeg";
    setAvatarMime(mime === "image/png" || mime === "image/webp" ? mime : "image/jpeg");
    setAvatarPreview(asset.uri);
  };

  const saveProfile = async () => {
    if (!detail?.profile?.id || editName.trim().length < 2) { Alert.alert("تحقق من الاسم", "اكتب اسماً من حرفين على الأقل."); return; }
    setBusyId(detail.profile.id);
    try {
      const result = await invoke({
        action: "update_profile", user_id: detail.profile.id,
        full_name: editName.trim(), governorate_key: editGovernorate || null,
        ...(avatarBase64 ? { avatar_base64: avatarBase64, avatar_mime: avatarMime } : {}),
      });
      setDetail((current) => current ? { ...current, profile: { ...current.profile, ...result.profile } } : current);
      setRows((current) => current.map((row) => row.id === detail.profile.id ? { ...row, ...result.profile } : row));
      setAvatarBase64(null);
      Alert.alert("تم الحفظ", "تم تحديث اسم المستخدم وصورته ومحافظته.");
    } catch (e:any) { Alert.alert("تعذر الحفظ", String(e?.message || "حاول مرة ثانية")); }
    finally { setBusyId(null); }
  };

  const unblock = (row: UserRow) => {
    Alert.alert("رفع الحظر", `تريد رفع الحظر عن ${row.full_name || row.phone || "هذا المستخدم"}؟`, [
      { text: "رجوع", style: "cancel" },
      { text: "رفع الحظر", onPress: async () => {
        setBusyId(row.id);
        try { await invoke({ action: "unblock", user_id: row.id }); await load(); }
        catch (e: any) { Alert.alert("تعذر رفع الحظر", String(e?.message || "حاول مرة ثانية")); }
        finally { setBusyId(null); }
      } },
    ]);
  };

  const confirmBlock = async () => {
    if (!blockTarget) return;
    setBusyId(blockTarget.id);
    try {
      await invoke({ action: "block", user_id: blockTarget.id, reason: blockReason.trim(), duration });
      setBlockTarget(null); setBlockReason(""); await load();
      Alert.alert("تم", "تم حظر المستخدم وتسجيل الإجراء في سجل الإدارة.");
    } catch (e: any) { Alert.alert("تعذر الحظر", String(e?.message || "حاول مرة ثانية")); }
    finally { setBusyId(null); }
  };

  if (authLoading || loading) return <View style={s.center}><ActivityIndicator size="large" color={palette.brand}/><Text style={s.muted}>جاري تحميل المستخدمين...</Text></View>;
  if (canView === false) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>هذه الصفحة متاحة للمشرفين والدعم والمراقبين المخوّلين.</Text></View>;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "إدارة المستخدمين" }} />
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
        <Text style={s.title}>إدارة المستخدمين</Text>
        <Text style={s.muted}>إجمالي النتائج: {total.toLocaleString("ar-IQ")}</Text>
        <View style={s.searchRow}>
          <TextInput value={query} onChangeText={(v) => { setQuery(v); setPage(1); }} placeholder="بحث بالاسم أو الهاتف أو البريد" placeholderTextColor={palette.muted} style={[s.input,{flex:1}]} textAlign="right" returnKeyType="search" onSubmitEditing={() => void load()}/>
          <TouchableOpacity style={s.primary} onPress={() => void load()}><Text style={s.buttonText}>بحث</Text></TouchableOpacity>
        </View>
        {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
        {rows.length === 0 ? <Text style={s.empty}>لا يوجد مستخدمون مطابقون</Text> : rows.map((row) => (
          <View key={row.id} style={s.card}>
            <Text style={s.name}>{row.full_name || "بدون اسم"}</Text>
            <Text style={s.muted}>{row.phone || row.email || row.id}</Text>
            <Text style={s.muted}>تاريخ التسجيل: {row.created_at ? new Date(row.created_at).toLocaleDateString("ar-IQ") : "—"}</Text>
            {!!row.blocked && <Text style={s.blocked}>محظور · {row.blocked.reason || "بدون سبب"}{row.blocked.expires_at ? " · حتى " + new Date(row.blocked.expires_at).toLocaleDateString("ar-IQ") : " · حظر دائم"}</Text>}
            <View style={s.actions}>
              {!!row.phone && <TouchableOpacity style={s.secondary} onPress={() => showContactOptions(row.phone!)}><Text style={s.secondaryText}>اتصال / واتساب</Text></TouchableOpacity>}
              <TouchableOpacity style={s.secondary} disabled={busyId===row.id} onPress={() => void showDetail(row.id)}><Text style={s.secondaryText}>{busyId===row.id ? "..." : "التفاصيل"}</Text></TouchableOpacity>
              {canManage && (row.blocked
                ? <TouchableOpacity style={s.success} disabled={busyId===row.id} onPress={() => unblock(row)}><Text style={s.buttonText}>رفع الحظر</Text></TouchableOpacity>
                : <TouchableOpacity style={s.danger} disabled={busyId===row.id} onPress={() => {setBlockTarget(row);setBlockReason("");setDuration("permanent");}}><Text style={s.buttonText}>حظر</Text></TouchableOpacity>)}
            </View>
          </View>
        ))}
        {!query.trim() && total > 50 && <View style={s.actions}>
          <TouchableOpacity disabled={page===1} style={[s.secondary,page===1&&s.disabled]} onPress={() => setPage(p=>Math.max(1,p-1))}><Text style={s.secondaryText}>السابق</Text></TouchableOpacity>
          <Text style={s.muted}>صفحة {page}</Text>
          <TouchableOpacity disabled={rows.length<50} style={[s.secondary,rows.length<50&&s.disabled]} onPress={() => setPage(p=>p+1)}><Text style={s.secondaryText}>التالي</Text></TouchableOpacity>
        </View>}
      </ScrollView>

      <Modal visible={!!blockTarget} transparent animationType="fade" onRequestClose={() => setBlockTarget(null)}>
        <View style={s.overlay}><View style={s.modalCard}>
          <Text style={s.title}>حظر المستخدم</Text>
          <Text style={s.muted}>{blockTarget?.full_name || blockTarget?.phone}</Text>
          <TextInput value={blockReason} onChangeText={setBlockReason} placeholder="سبب الحظر (اختياري)" placeholderTextColor={palette.muted} multiline style={[s.input,{minHeight:76}]} textAlign="right"/>
          <Text style={s.section}>مدة الحظر</Text>
          <View style={s.durationWrap}>{DURATIONS.map(([key,label])=><TouchableOpacity key={key} onPress={()=>setDuration(key)} style={[s.duration,duration===key&&s.durationActive]}><Text style={[s.durationText,duration===key&&s.durationTextActive]}>{label}</Text></TouchableOpacity>)}</View>
          <View style={s.actions}>
            <TouchableOpacity style={s.secondary} onPress={()=>setBlockTarget(null)}><Text style={s.secondaryText}>إلغاء</Text></TouchableOpacity>
            <TouchableOpacity style={s.danger} disabled={!!busyId} onPress={()=>void confirmBlock()}><Text style={s.buttonText}>تأكيد الحظر</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={s.overlay}><View style={[s.modalCard,{maxHeight:"92%"}]}>
          <View style={s.actions}><Text style={s.title}>تفاصيل المستخدم</Text><TouchableOpacity onPress={()=>setDetail(null)}><Text style={s.secondaryText}>إغلاق</Text></TouchableOpacity></View>
          <ScrollView>
            <Info label="الاسم" value={detail?.profile?.full_name}/>
            <Info label="الهاتف" value={detail?.profile?.phone}/>
            <Info label="البريد" value={detail?.profile?.email}/>
            <Info label="تاريخ التسجيل" value={detail?.profile?.created_at ? new Date(detail.profile.created_at).toLocaleString("ar-IQ") : "—"}/>
            <Text style={s.section}>الأدوار</Text>
            <Text style={s.muted}>{detail?.roles?.map(r=>r.role).join("، ") || "لا توجد أدوار"}</Text>
            {!!detail?.block && <Info label="الحظر" value={detail.block.reason || "بدون سبب"}/>}
            {!!detail?.driverProfile && <><Text style={s.section}>ملف السائق</Text><Info label="المركبة" value={`${detail.driverProfile.vehicle_make || "—"} ${detail.driverProfile.vehicle_model || ""}`}/><Info label="متاح" value={detail.driverProfile.available ? "نعم" : "لا"}/></>}
            {!!detail?.workerProfile && <><Text style={s.section}>ملف الفني</Text><Info label="متاح" value={detail.workerProfile.available ? "نعم" : "لا"}/></>}
            <Text style={s.section}>المعاملات ({detail?.transactions?.length ?? 0})</Text>
            {(detail?.transactions ?? []).map(tx=><Info key={tx.id} label={tx.type || "معاملة"} value={`${Number(tx.amount||0).toLocaleString("ar-IQ")} د.ع · ${new Date(tx.created_at).toLocaleDateString("ar-IQ")}`}/>)}
            <Text style={s.section}>الطلبات ({detail?.requests?.length ?? 0})</Text>
            {(detail?.requests ?? []).map(req=><Info key={req.id} label={req.type || "طلب"} value={`${req.status} · ${new Date(req.created_at).toLocaleDateString("ar-IQ")}`}/>)}
            <Text style={s.section}>التقييمات ({detail?.ratings?.length ?? 0})</Text>
            {detail?.ratings_error ? <Text style={s.errorText}>تعذر تحميل التقييمات؛ بقية تفاصيل المستخدم متاحة.</Text> : null}
            {(detail?.ratings ?? []).slice(0,20).map(r=><Info key={r.id} label={`${r.stars ?? "—"} نجوم`} value={r.comment || "بدون تعليق"}/>)}
          </ScrollView>
        </View></View>
      </Modal>
    </View>
  );
}

function Info({label,value}:{label:string;value:any}) {
  return <View style={s.info}><Text style={s.infoLabel}>{label}</Text><Text style={s.infoValue}>{value == null || value === "" ? "—" : String(value)}</Text></View>;
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor: palette.pageCanvas}, content:{padding:space.lg,paddingBottom:48,gap:10},
  center:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor: palette.pageCanvas,padding:24,gap:10},
  title:{fontSize:21,fontWeight:"900",color:palette.ink,textAlign:"right"},
  section:{fontSize:14,fontWeight:"900",color:palette.ink,textAlign:"right",marginTop:12,marginBottom:6},
  muted:{fontSize:11,color:palette.muted,textAlign:"right",lineHeight:19},
  searchRow:{flexDirection:"row",gap:8,alignItems:"center"},
  input:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:12,color:palette.ink,textAlign:"right"},
  card:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:14,gap:6},
  avatarPreview:{width:76,height:76,borderRadius:38,alignSelf:"flex-end",backgroundColor:palette.pageCanvas},\n  name:{fontSize:14,fontWeight:"900",color:palette.ink,textAlign:"right"},
  actions:{flexDirection:"row",gap:8,alignItems:"center",justifyContent:"flex-end",flexWrap:"wrap",marginTop:8},
  primary:{minHeight:40,backgroundColor:palette.brand,borderRadius:16,paddingHorizontal:16,paddingVertical:8,alignItems:"center",justifyContent:"center"},
  danger:{minHeight:36,backgroundColor:palette.danger,borderRadius:16,paddingHorizontal:12,paddingVertical:6,alignItems:"center",justifyContent:"center"},
  success:{minHeight:36,backgroundColor:"#15803d",borderRadius:16,paddingHorizontal:12,paddingVertical:6,alignItems:"center",justifyContent:"center"},
  secondary:{backgroundColor:palette.brandSoft,borderRadius:radius.md,paddingHorizontal:13,paddingVertical:10},
  secondaryText:{color:palette.brand,fontSize:11,fontWeight:"900"},
  buttonText:{color:"#FFFFFF",fontSize:11,fontWeight:"900"},
  blocked:{fontSize:11,color:palette.danger,textAlign:"right"},
  empty:{color:palette.muted,textAlign:"center",padding:24},
  error:{backgroundColor:palette.dangerSoft,borderRadius:radius.md,padding:12},
  errorText:{color:palette.danger,textAlign:"right",fontWeight:"800"},
  disabled:{opacity:0.45},
  overlay:{flex:1,backgroundColor:"rgba(0,0,0,0.55)",justifyContent:"center",padding:18},
  modalCard:{backgroundColor:palette.canvas,borderRadius:radius.xl,padding:18,gap:10},
  durationWrap:{flexDirection:"row",flexWrap:"wrap",gap:7},
  duration:{padding:10,borderRadius:radius.md,borderWidth:1,borderColor:palette.line,backgroundColor:palette.surface},
  durationActive:{backgroundColor:palette.brand,borderColor:palette.brand},
  durationText:{color:palette.ink,fontSize:11,fontWeight:"800"},
  durationTextActive:{color:"#FFFFFF"},
  info:{flexDirection:"row",justifyContent:"space-between",gap:12,paddingVertical:8,borderBottomWidth:1,borderBottomColor:palette.line},
  infoLabel:{color:palette.muted,fontSize:11,fontWeight:"700"},
  infoValue:{color:palette.ink,fontSize:11,fontWeight:"800",flexShrink:1,textAlign:"right"},
});
