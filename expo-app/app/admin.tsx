import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack, router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useCompanyBranding } from "@/lib/company-branding";
import { palette, radius, space } from "@/styles/theme";

type Stats = { users: number; requests: number; drivers: number; workers: number; active: number };
type NavItem = { title: string; description: string; route: string; icon: string };
type NavGroup = { title: string; description: string; icon: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  { title: "العمليات والطلبات", description: "إدارة الرحلات والخدمات ومقدمي الخدمة", icon: "🚕", items: [
    { title: "الطلبات", description: "متابعة الطلبات وحالاتها", route: "/admin/requests", icon: "📋" },
    { title: "السائقون والفنيون", description: "الحسابات والتوثيق والتوفر", route: "/admin/providers", icon: "🧑‍🔧" },
    { title: "الخريطة المباشرة", description: "مواقع الطلبات ومقدمي الخدمة", route: "/admin/live-map", icon: "🗺️" },
    { title: "نطاقات التوزيع", description: "حدود وصول الطلبات", route: "/admin/dispatch-zones", icon: "📍" },
    { title: "رتب السائقين", description: "معايير الأداء والتقييم", route: "/admin/driver-tiers", icon: "🏅" },
  ]},
  { title: "المستخدمون وخدمة العملاء", description: "الحسابات والتواصل والبلاغات", icon: "👥", items: [
    { title: "المستخدمون", description: "بحث وإدارة حسابات العملاء", route: "/admin/users", icon: "👤" },
    { title: "المراقبة والبلاغات", description: "مراجعة البلاغات ومتابعة الحالات", route: "/admin/monitoring", icon: "🛡️" },
    { title: "محادثات الدعم", description: "متابعة محادثات الدعم", route: "/admin/chats", icon: "💬" },
    { title: "الأصدقاء", description: "إدارة طلبات وعلاقات الأصدقاء", route: "/admin/friends", icon: "🤝" },
  ]},
  { title: "المالية والاشتراكات", description: "المحافظ والاشتراكات والتقارير", icon: "💰", items: [
    { title: "الاشتراكات", description: "الباقات وطلبات الاشتراك", route: "/admin/subscriptions", icon: "👑" },
    { title: "المالية والكوبونات", description: "المحفظة والحركات والعروض", route: "/admin/finance", icon: "💳" },
    { title: "الإحصائيات", description: "تقارير المنصة ومؤشراتها", route: "/admin/analytics", icon: "📊" },
  ]},
  { title: "المحتوى وهوية الشركة", description: "الشعار والبانرات ومحتوى التطبيق", icon: "🎨", items: [
    { title: "هوية الشركة والشعار", description: "اسم الشركة وشعار الترحيب", route: "/admin/company", icon: "🏢" },
    { title: "بانرات الصفحة الرئيسية", description: "إعلانات واستطلاعات ومسابقات", route: "/admin/home-banners", icon: "🖼️" },
    { title: "الإشعارات", description: "إرسال تنبيهات للمستخدمين", route: "/admin/notifications", icon: "🔔" },
  ]},
  { title: "الموظفون والحوكمة", description: "التعيين والترقية والتنزيل والصلاحيات", icon: "🧑‍💼", items: [
    { title: "إدارة الموظفين والصلاحيات", description: "تعيين الموظفين وتحديد صلاحياتهم", route: "/admin/governance", icon: "🔐" },
    { title: "الهيكل الوظيفي والترقيات", description: "إدارة الرتب والأقسام", route: "/admin/staff-hierarchy", icon: "📈" },
    { title: "مركز الموظفين", description: "الأدوات المتاحة حسب الصلاحية", route: "/admin/staff", icon: "🗂️" },
  ]},
  { title: "الإعدادات المتقدمة", description: "المحافظات والاستيراد", icon: "⚙️", items: [
    { title: "التحكم بالمحافظات", description: "تفعيل الخدمات حسب المحافظة", route: "/admin/regions", icon: "🌍" },
    { title: "استيراد البيانات", description: "أدوات استيراد ومراجعة البيانات", route: "/admin/import", icon: "📥" },
  ]},
];

export default function AdminScreen() {
  const { user, loading: authLoading } = useAuth();
  const { companyName, logoUrl } = useCompanyBranding();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [stats, setStats] = useState<Stats>({ users: 0, requests: 0, drivers: 0, workers: 0, active: 0 });
  const [statsError, setStatsError] = useState("");
  const [expanded, setExpanded] = useState<string | null>("العمليات والطلبات");

  const load = useCallback(async () => {
    if (!user?.id) { router.replace("/auth"); setLoading(false); return; }
    setLoading(true);
    setStatsError("");
    try {
      const { data: owner, error: ownerError } = await supabase.rpc("is_super_admin", { p_user_id: user.id });
      if (ownerError) throw ownerError;
      if (owner !== true) {
        const [{ data: roles, error: rolesError }, { data: assignment, error: assignmentError }] = await Promise.all([
          supabase.rpc("get_staff_roles", { p_user_id: user.id }),
          (supabase as any).from("staff_assignments").select("rank,department,active").eq("user_id", user.id).maybeSingle(),
        ]);
        if (rolesError || assignmentError) throw rolesError ?? assignmentError;
        const names = (roles ?? []).map((v: any) => typeof v === "string" ? v : v.role);
        const hasAccess = names.some((v: string) => ["admin","support","finance","moderator","customer_service","department_finance","department_operations","department_monitoring"].includes(v)) || assignment?.active === true;
        if (hasAccess) router.replace("/admin/staff");
        else router.replace("/home");
        setAuthorized(false);
        return;
      }
      setAuthorized(true);
      const [users, requests, drivers, workers, active] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("service_requests").select("id", { count: "exact", head: true }),
        supabase.from("driver_profiles").select("id", { count: "exact", head: true }),
        supabase.from("worker_profiles").select("id", { count: "exact", head: true }),
        supabase.from("service_requests").select("id", { count: "exact", head: true }).in("status", ["pending","searching","accepted","in_progress"]),
      ]);
      const failed = [users, requests, drivers, workers, active].find((result) => result.error);
      if (failed?.error) throw failed.error;
      setStats({ users: users.count ?? 0, requests: requests.count ?? 0, drivers: drivers.count ?? 0, workers: workers.count ?? 0, active: active.count ?? 0 });
    } catch (error: any) {
      setStatsError(String(error?.message || "تعذر تحميل إحصائيات الإدارة"));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { if (!authLoading) void load(); }, [authLoading, load]);
  const refresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false); }, [load]);

  if (authLoading || loading) return <View style={s.center}><ActivityIndicator color={palette.brand} size="large"/><Text style={s.muted}>جاري تجهيز مركز الإدارة...</Text></View>;
  if (!authorized) return <View style={s.center}><Text style={s.title}>جارٍ تحويلك إلى القسم المسموح</Text></View>;

  return <View style={s.page}>
    <Stack.Screen options={{ title: "مركز إدارة ممنون" }}/>
    <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
      <View style={s.hero}>
        <View style={s.brandRow}>
          {logoUrl ? <Image source={{ uri: logoUrl }} style={s.logo} resizeMode="contain"/> : <View style={s.logoFallback}><Text style={s.logoLetter}>م</Text></View>}
          <View style={{flex:1}}><Text style={s.brandName}>{companyName}</Text><Text style={s.heroCaption}>مركز التحكم والإدارة العليا</Text></View>
        </View>
        <Text style={s.heroTitle}>كل أقسام الشركة بمكان واحد</Text>
        <Text style={s.heroText}>اختَر القسم حتى تفتح أدواته ومحتوياته وحدها، بدون تكدّس بقية الأقسام أسفل الصفحة.</Text>
        <View style={s.flow}>
          <View style={s.flowNode}><Text style={s.flowIcon}>🏢</Text><Text style={s.flowLabel}>الإدارة العليا</Text></View>
          <Text style={s.flowArrow}>↓</Text>
          <View style={s.flowBranches}>
            {["العمليات","المالية","المحتوى","الموظفون"].map((v,i)=><View key={v} style={s.flowBranch}><Text style={s.flowBranchIcon}>{["🚕","💰","🎨","🧑‍💼"][i]}</Text><Text style={s.flowBranchText}>{v}</Text></View>)}
          </View>
        </View>
      </View>

      {statsError ? <View style={s.statsError}>
        <Text style={s.statsErrorText}>تعذر تحميل بعض الإحصائيات: {statsError}</Text>
        <TouchableOpacity onPress={() => void load()} style={s.retryButton}><Text style={s.retryText}>إعادة المحاولة</Text></TouchableOpacity>
      </View> : <View style={s.statsGrid}>
        {[
          ["المستخدمون",stats.users,"👥"],["كل الطلبات",stats.requests,"📋"],["السائقون",stats.drivers,"🚗"],["الفنيون",stats.workers,"🧰"],["الطلبات النشطة",stats.active,"⚡"],
        ].map(([label,value,icon])=><View key={String(label)} style={s.statCard}><Text style={s.statIcon}>{icon}</Text><Text style={s.statValue}>{Number(value).toLocaleString("ar-IQ")}</Text><Text style={s.statLabel}>{label}</Text></View>)}
      </View>}

      {GROUPS.map(group=><View key={group.title} style={s.groupCard}>
        <TouchableOpacity onPress={()=>setExpanded(current=>current===group.title?null:group.title)} style={s.groupHeader} accessibilityRole="button" accessibilityState={{expanded:expanded===group.title}}>
          <View style={s.groupIcon}><Text style={{fontSize:23}}>{group.icon}</Text></View>
          <View style={{flex:1}}><Text style={s.groupTitle}>{group.title}</Text><Text style={s.groupDescription}>{group.description}</Text></View>
          <Text style={s.expand}>{expanded===group.title?"−":"+"}</Text>
        </TouchableOpacity>
        {expanded===group.title&&<View style={s.items}>
          {group.items.map(item=><TouchableOpacity key={item.route} onPress={()=>item.route === "/admin/staff" ? router.push("/admin/staff") : router.push(item.route as any)} style={s.item}>
            <Text style={s.itemIcon}>{item.icon}</Text>
            <View style={{flex:1}}><Text style={s.itemTitle}>{item.title}</Text><Text style={s.itemDescription}>{item.description}</Text></View>
            <Text style={s.arrow}>←</Text>
          </TouchableOpacity>)}
        </View>}
      </View>)}
    </ScrollView>
  </View>;
}

const s=StyleSheet.create({
  page:{flex:1,backgroundColor:palette.pageCanvas},content:{padding:space.lg,paddingBottom:50,gap:12},
  center:{flex:1,alignItems:"center",justifyContent:"center",gap:12,backgroundColor:palette.pageCanvas,padding:24},
  hero:{backgroundColor:palette.surface,borderColor:palette.line,borderWidth:1,borderRadius:radius.xl,padding:16,gap:10},
  brandRow:{flexDirection:"row",alignItems:"center",gap:12},
  logo:{width:58,height:58,borderRadius:18,backgroundColor:"#fff"},logoFallback:{width:58,height:58,borderRadius:18,backgroundColor:palette.brand,alignItems:"center",justifyContent:"center"},
  logoLetter:{color:palette.white,fontSize:30,fontWeight:"900"},brandName:{color:palette.ink,fontSize:20,fontWeight:"900",textAlign:"right"},heroCaption:{color:palette.muted,fontSize:11,textAlign:"right",marginTop:3},
  heroTitle:{color:palette.ink,fontSize:21,fontWeight:"900",textAlign:"right",marginTop:8},heroText:{color:palette.muted,fontSize:12,lineHeight:20,textAlign:"right"},
  flow:{backgroundColor:palette.canvas,borderRadius:radius.lg,padding:10,alignItems:"center",gap:7,marginTop:4},
  flowNode:{backgroundColor:palette.brandSoft,borderColor:palette.brand,borderWidth:1,borderRadius:14,paddingHorizontal:20,paddingVertical:8,alignItems:"center",minWidth:140},
  flowIcon:{fontSize:20},flowLabel:{fontSize:11,fontWeight:"900",color:palette.ink},flowArrow:{fontSize:20,color:palette.brand,fontWeight:"900"},
  flowBranches:{width:"100%",flexDirection:"row",flexWrap:"wrap",justifyContent:"center",gap:7},
  flowBranch:{minWidth:"22%",flexGrow:1,backgroundColor:palette.surface,borderColor:palette.line,borderWidth:1,borderRadius:12,padding:8,alignItems:"center",gap:4},
  flowBranchIcon:{fontSize:17},flowBranchText:{fontSize:10,color:palette.ink,fontWeight:"800"},
  statsGrid:{flexDirection:"row",flexWrap:"wrap",gap:8},statCard:{flexBasis:"30%",flexGrow:1,backgroundColor:palette.surface,borderColor:palette.line,borderWidth:1,borderRadius:radius.md,padding:11,alignItems:"center",gap:3},
  statIcon:{fontSize:19},statValue:{fontSize:21,color:palette.brand,fontWeight:"900"},statLabel:{fontSize:10,color:palette.muted,fontWeight:"800"},
  groupCard:{backgroundColor:palette.surface,borderColor:palette.line,borderWidth:1,borderRadius:radius.lg,overflow:"hidden"},
  groupHeader:{flexDirection:"row",alignItems:"center",gap:10,padding:13},groupIcon:{width:42,height:42,borderRadius:14,backgroundColor:palette.brandSoft,alignItems:"center",justifyContent:"center"},
  groupTitle:{color:palette.ink,fontSize:14,fontWeight:"900",textAlign:"right"},groupDescription:{color:palette.muted,fontSize:10,textAlign:"right",marginTop:3},expand:{fontSize:24,color:palette.brand,fontWeight:"900",paddingHorizontal:5},
  items:{paddingHorizontal:10,paddingBottom:10,gap:7},item:{flexDirection:"row",alignItems:"center",gap:10,backgroundColor:palette.canvas,borderRadius:radius.md,padding:11,minHeight:62},
  supportButton: { minHeight: 40 }, reportAction: { minHeight: 36 }, inboxOpen: { minHeight: 36 },
  itemIcon:{fontSize:21,width:28,textAlign:"center"},itemTitle:{color:palette.ink,fontSize:12,fontWeight:"900",textAlign:"right"},itemDescription:{color:palette.muted,fontSize:10,textAlign:"right",marginTop:3},arrow:{color:palette.brand,fontSize:17,fontWeight:"900"},
  statsError:{backgroundColor:palette.surface,borderColor:palette.danger,borderWidth:1,borderRadius:radius.md,padding:12,gap:8},statsErrorText:{color:palette.danger,fontSize:12,textAlign:"right"},retryButton:{alignSelf:"flex-end",paddingHorizontal:14,paddingVertical:8,borderRadius:10,backgroundColor:palette.brand},retryText:{color:palette.white,fontSize:11,fontWeight:"900"},
  title:{color:palette.ink,fontSize:18,fontWeight:"900"},muted:{color:palette.muted,fontSize:12,textAlign:"center"},
});
