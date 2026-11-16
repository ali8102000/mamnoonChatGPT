import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { palette, radius, space } from "@/styles/theme";
import { useAuth } from "@/lib/auth-context";
import { getAdminStaffRoles } from "@/lib/admin-access";

const LABELS: Record<string,string> = {
  baghdad:"بغداد",basra:"البصرة",nineveh:"نينوى",erbil:"أربيل",sulaymaniyah:"السليمانية",
  duhok:"دهوك",kirkuk:"كركوك",najaf:"النجف",karbala:"كربلاء",babil:"بابل",anbar:"الأنبار",
  diyala:"ديالى",saladin:"صلاح الدين",wasit:"واسط",dhiqar:"ذي قار",maysan:"ميسان",
  muthanna:"المثنى",qadisiyah:"القادسية",unknown:"غير محددة",
};
type Row = { governorate_key:string; workers:number; large_drivers:number; taxi_drivers:number; customers:number; total_users:number };

export default function AdminAnalyticsScreen() {
  const { user } = useAuth();
  const [rows,setRows] = useState<Row[]>([]);
  const [loading,setLoading] = useState(true);
  const [refreshing,setRefreshing] = useState(false);
  const [error,setError] = useState("");
  const load = useCallback(async () => {
    if (!user?.id) return;
    setError("");
    try {
      const roles = await getAdminStaffRoles(user.id);
      if (!roles.includes("super_admin") && !roles.includes("admin")) throw new Error("هذه الإحصائيات متاحة للمدير الأعلى والإدارة فقط");
      const { data, error: invokeError } = await supabase.functions.invoke("admin-users",{body:{action:"governorate_stats"}});
      if (invokeError) throw new Error(invokeError.message);
      if (data?.error) throw new Error(data.error);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e:any) { setError(e?.message || "تعذر تحميل الإحصائيات"); }
    finally { setLoading(false); setRefreshing(false); }
  },[user?.id]);
  useEffect(()=>{void load();},[load]);
  const total=rows.find(r=>r.governorate_key==="__all__");
  const regions=rows.filter(r=>r.governorate_key!=="__all__").sort((a,b)=>Number(b.total_users)-Number(a.total_users));
  const fmt=(v:any)=>Number(v||0).toLocaleString("ar-IQ");
  return <View style={s.page}>
    <Stack.Screen options={{title:"إحصائيات المستخدمين حسب المحافظة"}}/>
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);void load();}}/>}>
      <Text style={s.title}>إحصائيات المستخدمين حسب المحافظة</Text>
      <Text style={s.muted}>أعداد حقيقية مباشرة من قاعدة بيانات ممنون</Text>
      {loading ? <ActivityIndicator size="large" color={palette.brand}/> : error ? <View style={s.error}><Text style={s.errorText}>{error}</Text><TouchableOpacity onPress={()=>void load()}><Text style={s.link}>إعادة المحاولة</Text></TouchableOpacity></View> : <>
        <View style={s.totalCard}>
          <Text style={s.muted}>إجمالي الحسابات المسجلة</Text>
          <Text style={s.total}>{fmt(total?.total_users)}</Text>
          <View style={s.metrics}>
            {([["الفنيون",total?.workers],["سائقو السيارات الكبيرة",total?.large_drivers],["كباتن التكسي",total?.taxi_drivers],["الزبائن",total?.customers]] as [string,number|undefined][]).map(([label,value])=><View key={label} style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={s.metricValue}>{fmt(value)}</Text></View>)}
          </View>
        </View>
        {regions.map(row=><View key={row.governorate_key} style={s.region}>
          <View style={s.regionHead}><Text style={s.regionName}>{LABELS[row.governorate_key]||row.governorate_key}</Text><Text style={s.regionTotal}>{fmt(row.total_users)} مستخدم</Text></View>
          <View style={s.metrics}>
            {([["فنيون",row.workers],["سيارات كبيرة",row.large_drivers],["تكسي",row.taxi_drivers],["زبائن",row.customers]] as [string,number][]).map(([label,value])=><View key={label} style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={s.metricValue}>{fmt(value)}</Text></View>)}
          </View>
        </View>)}
        <Text style={s.note}>المحافظة غير المحددة تظهر منفصلة. الحساب الواحد قد يظهر ضمن أكثر من فئة إذا كان يحمل أكثر من دور؛ الإجمالي يحسب كل حساب مرة واحدة.</Text>
      </>}
    </ScrollView>
  </View>;
}
const s=StyleSheet.create({
 page:{flex:1,backgroundColor:palette.pageCanvas},content:{padding:space.lg,paddingBottom:48,gap:12},
 title:{fontSize:20,fontWeight:"900",color:palette.ink,textAlign:"right"},muted:{fontSize:11,color:palette.muted,textAlign:"right"},
 totalCard:{backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.line,padding:16,gap:10},
 total:{fontSize:34,fontWeight:"900",color:palette.brand,textAlign:"right"},
 metrics:{flexDirection:"row",flexWrap:"wrap",gap:8},metric:{minWidth:"46%",flexGrow:1,backgroundColor:palette.pageCanvas,borderRadius:radius.md,padding:10},
 metricLabel:{fontSize:10,color:palette.muted,textAlign:"right"},metricValue:{fontSize:18,fontWeight:"900",color:palette.ink,textAlign:"right"},
 region:{backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.line,padding:13,gap:10},
 regionHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},regionName:{fontSize:14,fontWeight:"900",color:palette.ink},regionTotal:{fontSize:11,fontWeight:"800",color:palette.brand},
 note:{fontSize:10,color:palette.muted,textAlign:"right",lineHeight:18},error:{padding:16,backgroundColor:palette.surface,borderRadius:radius.lg,gap:8},errorText:{color:palette.danger,textAlign:"right"},link:{color:palette.brand,textAlign:"right",fontWeight:"800"}
});
