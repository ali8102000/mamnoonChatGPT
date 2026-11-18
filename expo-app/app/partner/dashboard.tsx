import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Switch, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type PartnerProfile = { id:string; application_id:string; partner_type:"hotel"|"restaurant"|"store"|"mall"; business_name:string; phone:string; email:string|null; city:string; address:string; description:string|null; is_published:boolean };
const typeLabels:Record<string,string>={hotel:"فندق",restaurant:"مطعم",store:"محل",mall:"مول"};

export default function PartnerDashboardScreen() {
  const { user } = useAuth();
  const [items,setItems]=useState<PartnerProfile[]>([]);
  const [loading,setLoading]=useState(true);
  const [savingId,setSavingId]=useState<string|null>(null);

  const load=useCallback(async()=>{
    if(!user?.id)return;
    setLoading(true);
    const {data,error}=await (supabase as any).from("partner_business_profiles")
      .select("id,application_id,partner_type,business_name,phone,email,city,address,description,is_published")
      .eq("user_id",user.id).order("created_at",{ascending:false});
    if(error)Alert.alert("تعذر تحميل لوحة الشريك",error.message);
    setItems(data??[]);setLoading(false);
  },[user?.id]);
  useEffect(()=>{void load();},[load]);

  const change=(id:string,key:keyof PartnerProfile,value:any)=>setItems(current=>current.map(item=>item.id===id?{...item,[key]:value}:item));
  const save=async(item:PartnerProfile)=>{
    if(item.business_name.trim().length<2||item.phone.trim().length<7||item.city.trim().length<2||item.address.trim().length<4){Alert.alert("بيانات ناقصة","تأكد من اسم المنشأة والهاتف والمدينة والعنوان.");return;}
    setSavingId(item.id);
    const {error}=await (supabase as any).from("partner_business_profiles").update({
      business_name:item.business_name.trim(),phone:item.phone.trim(),email:item.email?.trim()||null,
      city:item.city.trim(),address:item.address.trim(),description:item.description?.trim()||null,
      is_published:item.is_published,updated_at:new Date().toISOString()
    }).eq("id",item.id).eq("user_id",user?.id);
    setSavingId(null);
    if(error){Alert.alert("تعذر الحفظ",error.message);return;}
    Alert.alert("تم الحفظ","تحدثت بيانات المنشأة بنجاح.");
    await load();
  };

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container}>
    <TouchableOpacity onPress={()=>router.back()}><Text style={styles.back}>رجوع للإعدادات</Text></TouchableOpacity>
    <View style={styles.hero}><Text style={styles.heroTitle}>لوحة الشريك</Text><Text style={styles.heroHint}>إدارة بيانات منشآتك وحالة ظهورها في ممنون</Text></View>
    <View style={styles.heading}><Text style={styles.sectionTitle}>منشآتي المعتمدة</Text><TouchableOpacity onPress={()=>void load()}><Text style={styles.refresh}>تحديث</Text></TouchableOpacity></View>
    {loading?<ActivityIndicator color={palette.brand}/>:items.length===0?<Text style={styles.empty}>ما عندك منشأة معتمدة حالياً. تابع حالة طلبك من الإعدادات.</Text>:items.map(item=><View key={item.id} style={styles.card}>
      <View style={styles.cardHead}><View style={{flex:1}}><Text style={styles.name}>{item.business_name}</Text><Text style={styles.detail}>{typeLabels[item.partner_type]}</Text></View><Text style={[styles.status,item.is_published?styles.visible:styles.hidden]}>{item.is_published?"ظاهر للمستخدمين":"غير منشور"}</Text></View>
      <Text style={styles.label}>اسم المنشأة</Text><TextInput value={item.business_name} onChangeText={v=>change(item.id,"business_name",v)} maxLength={120} style={styles.input}/>
      <Text style={styles.label}>رقم التواصل</Text><TextInput value={item.phone} onChangeText={v=>change(item.id,"phone",v)} keyboardType="phone-pad" maxLength={30} style={styles.input}/>
      <Text style={styles.label}>البريد الإلكتروني</Text><TextInput value={item.email??""} onChangeText={v=>change(item.id,"email",v)} keyboardType="email-address" autoCapitalize="none" style={styles.input}/>
      <Text style={styles.label}>المدينة</Text><TextInput value={item.city} onChangeText={v=>change(item.id,"city",v)} maxLength={80} style={styles.input}/>
      <Text style={styles.label}>العنوان</Text><TextInput value={item.address} onChangeText={v=>change(item.id,"address",v)} maxLength={240} style={styles.input}/>
      <Text style={styles.label}>نبذة المنشأة</Text><TextInput value={item.description??""} onChangeText={v=>change(item.id,"description",v)} multiline maxLength={1000} style={[styles.input,styles.multiline]}/>
      <View style={styles.switchRow}><Text style={styles.label}>إظهار المنشأة للمستخدمين</Text><Switch value={item.is_published} onValueChange={v=>change(item.id,"is_published",v)} trackColor={{true:palette.brand}}/></View>
      <TouchableOpacity disabled={savingId===item.id} onPress={()=>void save(item)} style={[styles.save,savingId===item.id&&{opacity:0.5}]}><Text style={styles.saveText}>{savingId===item.id?"جارٍ الحفظ...":"حفظ التعديلات"}</Text></TouchableOpacity>
    </View>)}
    <View style={styles.notice}><Text style={styles.noticeText}>إدارة الحجوزات والغرف وقائمة الطعام والمنتجات ستُربط بوحدات النشاط الخاصة بكل نوع شريك. هذه اللوحة حالياً تدير بيانات المنشأة ونشرها.</Text></View>
  </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:palette.pageCanvas},container:{padding:space.xl,paddingBottom:space.huge,gap:12},
 back:{color:palette.brand,fontSize:13,fontWeight:"900",textAlign:"right",marginBottom:8},
 hero:{backgroundColor:palette.brand,borderRadius:radius.xl,padding:22},heroTitle:{color:"#fff",fontSize:24,fontWeight:"900",textAlign:"right"},
 heroHint:{color:"#fff",opacity:0.85,fontSize:12,textAlign:"right",marginTop:5},heading:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
 sectionTitle:{color:palette.ink,fontSize:16,fontWeight:"900",textAlign:"right"},refresh:{color:palette.brand,fontSize:12,fontWeight:"900"},
 empty:{color:palette.muted,fontSize:13,textAlign:"center",padding:20},
 card:{backgroundColor:palette.surface,borderColor:palette.line,borderWidth:1,borderRadius:radius.xl,padding:16,gap:8},
 cardHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8},name:{color:palette.ink,fontSize:17,fontWeight:"900",textAlign:"right"},
 detail:{color:palette.muted,fontSize:11,textAlign:"right"},status:{fontSize:10,fontWeight:"900",padding:7,borderRadius:10,overflow:"hidden"},
 visible:{backgroundColor:"#dcfce7",color:"#166534"},hidden:{backgroundColor:"#fef3c7",color:"#92400e"},
 label:{color:palette.ink,fontSize:12,fontWeight:"800",textAlign:"right"},input:{borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:11,color:palette.ink,textAlign:"right",fontSize:13,backgroundColor:palette.pageCanvas},
 multiline:{minHeight:82,textAlignVertical:"top"},switchRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
 save:{backgroundColor:palette.brand,borderRadius:radius.md,padding:13,alignItems:"center"},saveText:{color:"#fff",fontWeight:"900",fontSize:13},
 notice:{backgroundColor:palette.brandSoft,borderRadius:radius.md,padding:12},noticeText:{color:palette.ink,fontSize:11,textAlign:"right",lineHeight:19}
});
