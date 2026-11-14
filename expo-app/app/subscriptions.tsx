import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type DemandArea = { zone_lat:number; zone_lng:number; waiting_requests:number; online_drivers:number; demand_ratio:number; demand_level:string };

export default function SubscriptionsScreen() {
  const { user, roles } = useAuth();
  const [subscription,setSubscription] = useState<any>(null);
  const [loading,setLoading] = useState(true);
  const [radiusKm,setRadiusKm] = useState(25);
  const [saving,setSaving] = useState(false);
  const [areas,setAreas] = useState<DemandArea[]>([]);
  const [checking,setChecking] = useState(false);
  const [checked,setChecked] = useState(false);
  const isProvider = roles.some((r) => ["worker","driver","large_driver"].includes(r));
  const canSetRadius = roles.includes("worker") || roles.includes("large_driver");
  const canTaxi = roles.includes("driver");
  const planCode = subscription?.is_trial ? "bronze" : subscription?.plan?.code;
  const maxRadius = planCode === "gold" ? 55 : planCode === "silver" ? 40 : 25;
  const canDemandLookup = canTaxi && subscription?.status === "active" && planCode === "gold";
  const radiusOptions = useMemo(() => [5,10,15,20,25,30,35,40,45,50,55].filter((v) => v <= maxRadius),[maxRadius]);

  const load = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    try {
      const [subResult,workerResult,driverResult] = await Promise.all([
        (supabase as any).from("user_subscriptions").select("status,is_trial,current_period_end,grant_type,plan:subscription_plans(code,name_ar)").eq("user_id",user.id).maybeSingle(),
        (supabase as any).from("worker_profiles").select("service_radius_km").eq("user_id",user.id).maybeSingle(),
        (supabase as any).from("driver_profiles").select("service_radius_km").eq("user_id",user.id).maybeSingle(),
      ]);
      if (subResult.error) throw subResult.error;
      setSubscription(subResult.data);
      setRadiusKm(Number(workerResult.data?.service_radius_km ?? driverResult.data?.service_radius_km ?? 25));
    } catch (e:any) {
      Alert.alert("اشتراكات ممنون",e?.message || "تعذر تحميل الاشتراك");
    } finally { setLoading(false); }
  },[user?.id]);

  useEffect(() => { void load(); },[load]);

  async function saveRadius() {
    if (saving || radiusKm > maxRadius) return;
    setSaving(true);
    try {
      const {data,error} = await (supabase as any).rpc("set_provider_service_radius",{p_radius_km:radiusKm});
      if (error) throw error;
      setRadiusKm(Number(data ?? radiusKm));
      Alert.alert("تم الحفظ","تم حفظ النطاق وتطبيقه على توزيع الطلبات من الخادم.");
    } catch(e:any) {
      Alert.alert("تعذر الحفظ",e?.message === "radius_exceeds_subscription_limit" ? "نطاقك يتجاوز حد باقتك." : e?.message || "حاول مرة ثانية.");
    } finally { setSaving(false); }
  }

  async function loadDemand() {
    setChecking(true);
    try {
      const {data,error} = await (supabase as any).rpc("get_taxi_high_demand_areas",{p_category:null});
      if (error) throw error;
      setAreas(data ?? []);
      setChecked(true);
    } catch(e:any) {
      Alert.alert("مناطق الطلب العالي",e?.message || "تعذر جلب المناطق");
    } finally { setChecking(false); }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={palette.brand}/></View>;
  if (!user || !isProvider) return <View style={styles.center}><Text style={styles.text}>هذه الصفحة لمقدمي الخدمة فقط.</Text><Pressable onPress={()=>router.back()}><Text style={styles.link}>رجوع</Text></Pressable></View>;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.page} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: "اشتراكات ممنون" }} />
      <View style={styles.header}>
        <Text style={styles.title}>اشتراكات ممنون</Text>
        <Text style={styles.subtitle}>امتيازات الباقة المفعّلة على حسابك</Text>
        <Text style={styles.current}>{subscription?.plan?.name_ar || "بدون باقة"} · {subscription?.status === "active" ? "نشط" : "غير نشط"}</Text>
        {subscription?.current_period_end ? <Text style={styles.muted}>ينتهي: {new Date(subscription.current_period_end).toLocaleString("ar-IQ")}</Text> : null}
      </View>

      {canSetRadius && <View style={styles.card}>
        <Text style={styles.sectionTitle}>نطاق استقبال الطلبات</Text>
        <Text style={styles.muted}>اختر أبعد مسافة تريد استقبال الطلبات منها. الخادم يفرض هذا الحد فعلياً.</Text>
        <Text style={styles.radiusValue}>{radiusKm} كم</Text>
        <View style={styles.options}>{radiusOptions.map((v)=><Pressable key={v} onPress={()=>setRadiusKm(v)} style={[styles.option,radiusKm===v&&styles.optionActive]}><Text style={[styles.optionText,radiusKm===v&&styles.optionTextActive]}>{v}</Text></Pressable>)}</View>
        <Text style={styles.muted}>حد باقتك الحالية: {maxRadius} كم ({planCode === "gold" ? "ذهبي" : planCode === "silver" ? "فضي" : "برونزي"})</Text>
        <Pressable onPress={saveRadius} disabled={saving || subscription?.status!=="active"} style={[styles.primaryButton,(saving||subscription?.status!=="active")&&styles.disabled]}>
          {saving ? <ActivityIndicator color="#fff"/> : <Text style={styles.primaryText}>حفظ النطاق وتطبيقه</Text>}
        </Pressable>
      </View>}

      {canTaxi && <View style={styles.card}>
        <Text style={styles.sectionTitle}>امتيازات الكابتن</Text>
        {["silver","gold"].includes(planCode) ? <>
          <Text style={styles.benefit}>• تنبيه عند ارتفاع الطلب بالقرب من موقعك.</Text>
          <Text style={styles.benefit}>• أولوية فعلية بترتيب إرسال عروض الرحلات.</Text>
          <Text style={styles.benefit}>• محادثات الدعم تُرتّب حسب أولوية اشتراكك.</Text>
          {planCode==="gold" ? <>
            <Text style={styles.benefit}>• أعلى أولوية في إرسال العروض.</Text>
            <Text style={styles.benefit}>• تنبيهات مميزة عند ظهور طلبات مرتفعة.</Text>
            <Text style={styles.benefit}>• استعلام عن مناطق الطلب العالي.</Text>
          </> : null}
        </> : <Text style={styles.muted}>تنبيهات مناطق الطلب العالي وأولوية التوزيع والاستعلام متاحة في الفضي والذهبي.</Text>}
        {canDemandLookup && <Pressable onPress={loadDemand} disabled={checking} style={[styles.primaryButton,checking&&styles.disabled]}>
          {checking ? <ActivityIndicator color="#fff"/> : <Text style={styles.primaryText}>استعلام عن مناطق الطلب العالي</Text>}
        </Pressable>}
        {checked && (areas.length===0 ? <Text style={styles.muted}>لا توجد حالياً مناطق طلب مرتفع حسب الطلبات المسجلة خلال آخر 30 دقيقة.</Text> : areas.map((area,i)=><View key={String(area.zone_lat)+String(area.zone_lng)+i} style={styles.area}>
          <Text style={styles.areaTitle}>{area.demand_level==="high" ? "طلب مرتفع" : "طلب متوسط"} · {area.waiting_requests} طلبات</Text>
          <Text style={styles.muted}>السائقون القريبون: {area.online_drivers} · مؤشر الطلب: {area.demand_ratio}</Text>
          <Pressable onPress={()=>Linking.openURL("https://www.google.com/maps?q="+area.zone_lat+","+area.zone_lng)}><Text style={styles.link}>فتح المنطقة على الخريطة</Text></Pressable>
        </View>))}
      </View>}
      <Text style={styles.note}>أولوية الدعم تعني تقديم محادثتك في ترتيب فريق الدعم، ولا تعني ضمان رد بشري فوري على مدار الساعة.</Text>
    </ScrollView>
  );
}

const styles=StyleSheet.create({
 page:{flex:1,backgroundColor:palette.canvas},
 content:{padding:space.xl,gap:14,paddingBottom:42},
 center:{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:palette.canvas,padding:24},
 header:{backgroundColor:palette.brand,borderRadius:radius.xl,padding:20,gap:7,borderWidth:1,borderColor:palette.gold},
 title:{fontSize:22,fontWeight:"900",color:palette.white,textAlign:"right"},
 subtitle:{fontSize:12,color:"rgba(255,255,255,0.75)",textAlign:"right"},
 current:{fontSize:15,fontWeight:"900",color:palette.gold,textAlign:"right",marginTop:8},
 card:{backgroundColor:palette.surface,borderRadius:radius.xl,padding:18,borderWidth:1,borderColor:palette.line,gap:12},
 sectionTitle:{fontSize:16,fontWeight:"900",color:palette.ink,textAlign:"right"},
 muted:{fontSize:12,color:palette.muted,textAlign:"right",lineHeight:20},
 radiusValue:{fontSize:28,fontWeight:"900",color:palette.brand,textAlign:"center"},
 options:{flexDirection:"row",flexWrap:"wrap",gap:8,justifyContent:"flex-start"},
 option:{minWidth:48,paddingVertical:10,paddingHorizontal:12,borderRadius:radius.md,borderWidth:1,borderColor:palette.line,alignItems:"center"},
 optionActive:{backgroundColor:palette.brand,borderColor:palette.gold},
 optionText:{fontWeight:"800",color:palette.ink},
 optionTextActive:{color:palette.white},
 primaryButton:{minHeight:48,backgroundColor:palette.brand,borderRadius:radius.md,alignItems:"center",justifyContent:"center",padding:12},
 primaryText:{color:palette.white,fontSize:13,fontWeight:"900"},
 disabled:{opacity:0.5},
 benefit:{fontSize:13,color:palette.ink,textAlign:"right",lineHeight:22},
 area:{padding:12,borderWidth:1,borderColor:palette.line,borderRadius:radius.md,gap:6},
 areaTitle:{fontSize:13,fontWeight:"900",color:palette.brand,textAlign:"right"},
 link:{fontSize:12,fontWeight:"900",color:palette.brand,textDecorationLine:"underline",textAlign:"right"},
 note:{fontSize:11,color:palette.muted,textAlign:"center",lineHeight:18},
 text:{color:palette.ink,fontSize:14}
});
