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
  const [platformStats,setPlatformStats] = useState<any>(null);
  const [platformStatsWarning,setPlatformStatsWarning] = useState("");
  const [activity,setActivity] = useState<any>(null);
  const [loading,setLoading] = useState(true);
  const [refreshing,setRefreshing] = useState(false);
  const [error,setError] = useState("");
  const load = useCallback(async () => {
    if (!user?.id) return;
    setError("");
    try {
      const roles = await getAdminStaffRoles(user.id);
      if (!roles.includes("super_admin") && !roles.includes("admin")) throw new Error("هذه الإحصائيات متاحة للمدير الأعلى والإدارة فقط");
      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
      const [users,drivers,workers,activeDrivers,activeWorkers,requests,activeRequests,completed,cancelled,todayTx,monthTx,yearTx] = await Promise.all([
        supabase.from("profiles").select("id",{count:"exact",head:true}),
        supabase.from("driver_profiles").select("id",{count:"exact",head:true}),
        supabase.from("worker_profiles").select("id",{count:"exact",head:true}),
        supabase.from("driver_profiles").select("id",{count:"exact",head:true}).eq("available",true),
        supabase.from("worker_profiles").select("id",{count:"exact",head:true}).eq("available",true),
        supabase.from("service_requests").select("id",{count:"exact",head:true}),
        supabase.from("service_requests").select("id",{count:"exact",head:true}).in("status",["pending","searching","accepted","in_progress"]),
        supabase.from("service_requests").select("id",{count:"exact",head:true}).eq("status","completed"),
        supabase.from("service_requests").select("id",{count:"exact",head:true}).eq("status","cancelled"),
        (supabase as any).from("transactions").select("amount,type").gte("created_at",dayStart),
        (supabase as any).from("transactions").select("amount,type").gte("created_at",monthStart),
        (supabase as any).from("transactions").select("amount,type").gte("created_at",yearStart),
      ]);
      const commission = (result:any) => (result?.data ?? []).filter((row:any)=>row.type==="commission").reduce((sum:number,row:any)=>sum+Math.abs(Number(row.amount)||0),0);
      setPlatformStats({
        totalUsers:users.count ?? 0,totalDrivers:drivers.count ?? 0,totalWorkers:workers.count ?? 0,
        activeDrivers:activeDrivers.count ?? 0,activeWorkers:activeWorkers.count ?? 0,totalRequests:requests.count ?? 0,
        activeRequests:activeRequests.count ?? 0,completedRequests:completed.count ?? 0,cancelledRequests:cancelled.count ?? 0,
        dailyRevenue:commission(todayTx),monthlyRevenue:commission(monthTx),yearlyRevenue:commission(yearTx),
      });
      const metricErrors=[users,drivers,workers,activeDrivers,activeWorkers,requests,activeRequests,completed,cancelled,todayTx,monthTx,yearTx].filter((result:any)=>!!result?.error).length;
      setPlatformStatsWarning(metricErrors ? `تعذر تحميل ${metricErrors} من مؤشرات المنصة؛ قد تكون بعض الأرقام غير مكتملة.` : "");
      const { data, error: invokeError } = await supabase.functions.invoke("admin-users",{body:{action:"governorate_stats"}});
      if (invokeError) throw new Error(invokeError.message);
      if (data?.error) throw new Error(data.error);
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      const { data: detail, error: detailError } = await supabase.functions.invoke("admin-users",{body:{action:"customer_activity_stats",limit:200,offset:0}});
      if (detailError) throw new Error(detailError.message);
      if (detail?.error) throw new Error(detail.error);
      setActivity(detail?.report ?? null);
    } catch (e:any) { setError(e?.message || "تعذر تحميل الإحصائيات"); }
    finally { setLoading(false); setRefreshing(false); }
  },[user?.id]);
  useEffect(()=>{void load();},[load]);
  const total=rows.find(r=>r.governorate_key==="__all__");
  const regions=Object.keys(LABELS).filter(key=>key!=="unknown").map(key=>rows.find(r=>r.governorate_key===key) ?? ({governorate_key:key,workers:0,large_drivers:0,taxi_drivers:0,customers:0,total_users:0})).concat(rows.filter(r=>r.governorate_key==="unknown")).sort((a,b)=>Number(b.total_users)-Number(a.total_users));
  const fmt=(v:any)=>Number(v||0).toLocaleString("ar-IQ");
  return <View style={s.page}>
    <Stack.Screen options={{title:"الإحصائيات الشاملة"}}/>
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);void load();}}/>}>
      <Text style={s.title}>الإحصائيات الشاملة</Text>
      <Text style={s.muted}>مؤشرات المنصة والإيرادات وتوزيع المستخدمين والطلبات حسب المحافظة</Text>
      {loading ? <ActivityIndicator size="large" color={palette.brand}/> : error ? <View style={s.error}><Text style={s.errorText}>{error}</Text><TouchableOpacity onPress={()=>void load()}><Text style={s.link}>إعادة المحاولة</Text></TouchableOpacity></View> : <>
        {!!platformStatsWarning && <View style={s.error}><Text style={s.errorText}>{platformStatsWarning}</Text></View>}
        <View style={s.totalCard}>
          <Text style={s.sectionTitle}>مؤشرات المنصة العامة</Text>
          <View style={s.metrics}>
            {([
              ["المستخدمون",platformStats?.totalUsers],["السائقون",platformStats?.totalDrivers],
              ["الفنيون",platformStats?.totalWorkers],["السائقون المتاحون",platformStats?.activeDrivers],
              ["الفنيون المتاحون",platformStats?.activeWorkers],["إجمالي الطلبات",platformStats?.totalRequests],
              ["الطلبات النشطة",platformStats?.activeRequests],["المكتملة",platformStats?.completedRequests],
              ["الملغاة",platformStats?.cancelledRequests],["إيرادات اليوم",platformStats?.dailyRevenue],
              ["إيرادات الشهر",platformStats?.monthlyRevenue],["إيرادات السنة",platformStats?.yearlyRevenue],
            ] as [string,number|undefined][]).map(([label,value])=><View key={label} style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={s.metricValue}>{fmt(value)}{label.includes("إيرادات") ? " د.ع" : ""}</Text></View>)}
          </View>
        </View>
        <View style={s.totalCard}>
          <Text style={s.sectionTitle}>توزيع المستخدمين حسب المحافظة</Text>
          <Text style={s.muted}>أعداد حقيقية من قاعدة البيانات حسب المحافظة المعتمدة أو آخر نشاط مسجل</Text>
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
        <View style={s.totalCard}>
          <Text style={s.sectionTitle}>إحصائية الحسابات والأدوار والطلبات</Text>
          <Text style={s.note}>كل دور يُحتسب بصورة مستقلة؛ الحساب الذي يحمل أكثر من دور يظهر في كل دور، ولا نمنع التكرار بين الأدوار.</Text>
          <View style={s.metrics}>
            {([
              ["إجمالي الحسابات",activity?.summary?.total_users],
              ["مجموع تعيينات الأدوار",activity?.summary?.total_role_assignments],
              ["الزبائن",activity?.summary?.total_customers],
              ["طلبات الزبائن",activity?.summary?.customer_requests],
              ["طلبات نشطة",activity?.summary?.customer_active_requests],
              ["مكتملة",activity?.summary?.customer_completed_requests],
              ["ملغاة",activity?.summary?.customer_cancelled_requests],
              ["كل طلبات المنصة",activity?.summary?.all_requests],
            ] as [string,number|undefined][]).map(([label,value])=><View key={label} style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={s.metricValue}>{fmt(value)}</Text></View>)}
          </View>
          <Text style={s.sectionTitle}>الحسابات حسب الدور (مع تعدد الأدوار)</Text>
          <View style={s.metrics}>
            {(activity?.role_counts ?? []).map((item:any)=><View key={item.role} style={s.metric}><Text style={s.metricLabel}>{item.role}</Text><Text style={s.metricValue}>{fmt(item.accounts)}</Text></View>)}
          </View>
          <Text style={s.sectionTitle}>حالات جميع الطلبات</Text>
          <View style={s.metrics}>
            {(activity?.request_status_counts ?? []).map((item:any)=><View key={item.status} style={s.metric}><Text style={s.metricLabel}>{item.status}</Text><Text style={s.metricValue}>{fmt(item.requests)}</Text></View>)}
          </View>
          <Text style={s.sectionTitle}>تفاصيل كل زبون وطلباته</Text>
          {(activity?.customers ?? []).map((customer:any)=><View key={customer.id} style={s.customerCard}>
            <Text style={s.customerName}>{customer.full_name}</Text>
            <Text style={s.note}>{customer.phone || "بدون هاتف"} · {LABELS[customer.governorate_key] || customer.governorate_key}</Text>
            <Text style={s.note}>الأدوار ({customer.roles_count}): {(customer.roles ?? []).join("، ") || "لا توجد أدوار"}</Text>
            <View style={s.metrics}>
              {([
                ["كل الطلبات",customer.total_requests],["نشطة",customer.active_requests],
                ["مكتملة",customer.completed_requests],["ملغاة",customer.cancelled_requests],
                ["تكسي",customer.taxi_requests],["خدمات",customer.service_requests],
              ] as [string,number][]).map(([label,value])=><View key={label} style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={s.metricValue}>{fmt(value)}</Text></View>)}
            </View>
            <Text style={s.note}>الحالات: {Object.entries(customer.statuses ?? {}).map(([status,count])=>status+": "+fmt(count)).join(" · ") || "لا توجد طلبات"}</Text>
          </View>)}
          <Text style={s.note}>يعرض أول 200 زبون حسب تاريخ التسجيل.</Text>
        </View>
        <Text style={s.note}>المحافظة المعتمدة في ملف المستخدم أو آخر محافظة مسجلة في طلباته تظهر حسب المحافظة، ومن لا يملك محافظة مسجلة يظهر ضمن غير محددة. الحساب الواحد قد يظهر ضمن أكثر من فئة إذا كان يحمل أكثر من دور؛ الإجمالي يحسب كل حساب مرة واحدة.</Text>
      </>}
    </ScrollView>
  </View>;
}
const s=StyleSheet.create({
 page:{flex:1,backgroundColor:palette.pageCanvas},content:{padding:space.lg,paddingBottom:48,gap:12},
 title:{fontSize:20,fontWeight:"900",color:palette.ink,textAlign:"right"},sectionTitle:{fontSize:14,fontWeight:"900",color:palette.ink,textAlign:"right"},customerCard:{backgroundColor:palette.pageCanvas,borderRadius:radius.md,padding:12,gap:8},customerName:{fontSize:14,fontWeight:"900",color:palette.ink,textAlign:"right"},muted:{fontSize:11,color:palette.muted,textAlign:"right"},
 totalCard:{backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.line,padding:16,gap:10},
 total:{fontSize:34,fontWeight:"900",color:palette.brand,textAlign:"right"},
 metrics:{flexDirection:"row",flexWrap:"wrap",gap:8},metric:{minWidth:"46%",flexGrow:1,backgroundColor:palette.pageCanvas,borderRadius:radius.md,padding:10},
 metricLabel:{fontSize:10,color:palette.muted,textAlign:"right"},metricValue:{fontSize:18,fontWeight:"900",color:palette.ink,textAlign:"right"},
 region:{backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.line,padding:13,gap:10},
 regionHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},regionName:{fontSize:14,fontWeight:"900",color:palette.ink},regionTotal:{fontSize:11,fontWeight:"800",color:palette.brand},
 note:{fontSize:10,color:palette.muted,textAlign:"right",lineHeight:18},error:{padding:16,backgroundColor:palette.surface,borderRadius:radius.lg,gap:8},errorText:{color:palette.danger,textAlign:"right"},link:{color:palette.brand,textAlign:"right",fontWeight:"800"}
});
