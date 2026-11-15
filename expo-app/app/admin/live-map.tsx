import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type LocationRow = { user_id: string; latitude?: number; longitude?: number; lat?: number; lng?: number; updated_at?: string; profile?: { full_name?: string | null; phone?: string | null } | null };
type RequestRow = { id: string; type?: string; status?: string; pickup_text?: string | null; dest_text?: string | null; created_at?: string };

export default function AdminLiveMapScreen() {
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError("");
    try {
      const { data: roles, error: rolesError } = await supabase.rpc("get_staff_roles", { p_user_id: user.id });
      const names = (roles ?? []).map((entry: any) => typeof entry === "string" ? entry : entry.role);
      if (rolesError || !names.some((role: string) => ["super_admin", "admin", "support"].includes(role))) {
        setAllowed(false); setLocations([]); setRequests([]); return;
      }
      setAllowed(true);
      const { data, error: callError } = await supabase.functions.invoke("admin-users", { body: { action: "live_map" } });
      if (callError) throw new Error(callError.message || "تعذر الاتصال بخدمة المواقع");
      if (data?.error) throw new Error(data.error);
      setLocations(data.locations ?? []);
      setRequests(data.requests ?? []);
    } catch (e: any) {
      setError(String(e?.message || "تعذر تحميل المواقع والطلبات"));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setAllowed(false); setLoading(false); }
    else void load();
  }, [authLoading, user, load]);

  useEffect(() => {
    if (allowed !== true) return;
    const interval = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(interval);
  }, [allowed, load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (authLoading || loading || allowed === null) return <View style={s.center}><ActivityIndicator color={palette.brand}/><Text style={s.muted}>جاري تحميل المواقع...</Text></View>;
  if (!allowed) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>هذه الصفحة للمدير والدعم المخوّل فقط.</Text></View>;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "الخريطة المباشرة" }} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>} contentContainerStyle={s.content}>
        <Text style={s.title}>الخريطة المباشرة</Text>
        <View style={s.stats}>
          <View style={s.stat}><Text style={s.value}>{locations.length.toLocaleString("ar-IQ")}</Text><Text style={s.label}>مزودون متاحون</Text></View>
          <View style={s.stat}><Text style={s.value}>{requests.length.toLocaleString("ar-IQ")}</Text><Text style={s.label}>طلبات نشطة</Text></View>
        </View>
        {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
        <Text style={s.section}>مواقع المزودين</Text>
        {!locations.length ? <Text style={s.empty}>لا توجد مواقع حالياً.</Text> : locations.map((location) => {
          const lat = Number(location.latitude ?? location.lat ?? 0);
          const lng = Number(location.longitude ?? location.lng ?? 0);
          return <View key={location.user_id} style={s.card}>
            <Text style={s.name}>{location.profile?.full_name || location.profile?.phone || "مقدم خدمة"}</Text>
            <Text style={s.coords}>{lat.toFixed(5)}, {lng.toFixed(5)}</Text>
            {!!location.updated_at && <Text style={s.muted}>آخر تحديث: {new Date(location.updated_at).toLocaleString("ar-IQ")}</Text>}
          </View>;
        })}
        <Text style={s.section}>الطلبات النشطة</Text>
        {!requests.length ? <Text style={s.empty}>لا توجد طلبات نشطة.</Text> : requests.map((request) => <View key={request.id} style={s.card}>
          <Text style={s.name}>{request.type === "taxi" ? "🚕 طلب تكسي" : "🛠️ طلب خدمة"} · {request.pickup_text || "موقع الانطلاق غير محدد"}</Text>
          <Text style={s.muted}>الحالة: {request.status || "—"}</Text>
          {!!request.dest_text && <Text style={s.muted}>الوجهة: {request.dest_text}</Text>}
          <Text style={s.muted}>رقم الطلب: {request.id.slice(0, 8)}</Text>
        </View>)}
        <Text style={s.footnote}>تُحدّث القائمة تلقائياً كل 15 ثانية. هذه الشاشة تعرض بيانات المواقع المسجلة ولا ترسم خريطة تفاعلية.</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:palette.canvas},
  content:{padding:space.lg,gap:10,paddingBottom:48},
  center:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor:palette.canvas,padding:24,gap:10},
  title:{fontSize:21,fontWeight:"900",color:palette.ink,textAlign:"right"},
  section:{fontSize:15,fontWeight:"900",color:palette.ink,textAlign:"right",marginTop:8},
  muted:{fontSize:10,color:palette.muted,textAlign:"right",lineHeight:18},
  stats:{flexDirection:"row",gap:9},
  stat:{flex:1,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:15},
  value:{fontSize:25,fontWeight:"900",color:palette.brand,textAlign:"right"},
  label:{fontSize:10,fontWeight:"800",color:palette.muted,textAlign:"right"},
  card:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:13,gap:5},
  name:{fontSize:12,fontWeight:"900",color:palette.ink,textAlign:"right"},
  coords:{fontSize:11,fontWeight:"800",color:palette.brand,textAlign:"right"},
  empty:{color:palette.muted,textAlign:"center",padding:20},
  footnote:{fontSize:10,color:palette.muted,textAlign:"right",lineHeight:18},
  error:{backgroundColor:palette.dangerSoft,borderRadius:radius.md,padding:10},
  errorText:{color:palette.danger,fontSize:11,textAlign:"right"},
});
