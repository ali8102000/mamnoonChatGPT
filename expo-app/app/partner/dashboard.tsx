import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

export default function PartnerDashboardScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    (supabase as any).from("partner_applications")
      .select("id,partner_type,business_name,contact_name,phone,governorate_key,city,address,description")
      .eq("user_id", user.id).eq("status", "approved").order("created_at", { ascending: false })
      .then(({ data, error }: any) => {
        if (!active) return;
        if (error) console.warn("[partner-dashboard]", error.message);
        setItems(data ?? []);
        setLoading(false);
      });
    return () => { active = false; };
  }, [user?.id]);
  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container}>
    <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>رجوع للإعدادات</Text></TouchableOpacity>
    <View style={styles.hero}><Text style={styles.heroTitle}>لوحة الشريك</Text><Text style={styles.heroHint}>منشآتك المعتمدة في منصة ممنون</Text></View>
    <Text style={styles.sectionTitle}>منشآتي المعتمدة</Text>
    {loading ? <Text style={styles.empty}>جارٍ تحميل بيانات الشراكة...</Text> : items.length===0 ? <Text style={styles.empty}>ما عندك منشأة معتمدة حالياً.</Text> : items.map(item=><View key={item.id} style={styles.card}>
      <Text style={styles.name}>{item.business_name}</Text>
      <Text style={styles.approved}>شريك معتمد ✓</Text>
      <Text style={styles.detail}>{({hotel:"فندق",restaurant:"مطعم",store:"محل",mall:"مول"} as Record<string,string>)[item.partner_type]} · {item.city} · {item.governorate_key}</Text>
      <Text style={styles.detail}>{item.address}</Text>
      <Text style={styles.detail}>هاتف التواصل: {item.phone}</Text>
      {!!item.description && <Text style={styles.detail}>{item.description}</Text>}
      <View style={styles.notice}><Text style={styles.noticeText}>تم اعتماد حساب الشراكة. أدوات الحجوزات والمنتجات والعروض ستظهر هنا عند تفعيل وحدات نشاط الشريك.</Text></View>
    </View>)}
  </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:palette.pageCanvas},
 container:{padding:space.xl,paddingBottom:space.huge,gap:12},
 back:{color:palette.brand,fontSize:13,fontWeight:"900",textAlign:"right",marginBottom:8},
 hero:{backgroundColor:palette.brand,borderRadius:radius.xl,padding:22},
 heroTitle:{color:"#fff",fontSize:24,fontWeight:"900",textAlign:"right"},
 heroHint:{color:"#fff",opacity:0.85,fontSize:12,textAlign:"right",marginTop:5},
 sectionTitle:{color:palette.ink,fontSize:16,fontWeight:"900",textAlign:"right",marginTop:10},
 empty:{color:palette.muted,fontSize:13,textAlign:"center",padding:20},
 card:{backgroundColor:palette.surface,borderColor:palette.line,borderWidth:1,borderRadius:radius.xl,padding:16,gap:8},
 name:{color:palette.ink,fontSize:17,fontWeight:"900",textAlign:"right"},
 approved:{color:"#15803d",fontSize:11,fontWeight:"900",textAlign:"right"},
 detail:{color:palette.muted,fontSize:12,textAlign:"right",lineHeight:20},
 notice:{backgroundColor:palette.brandSoft,borderRadius:radius.md,padding:12,marginTop:4},
 noticeText:{color:palette.ink,fontSize:11,textAlign:"right",lineHeight:19}
});
