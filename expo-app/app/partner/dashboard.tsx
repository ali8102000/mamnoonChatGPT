import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Switch, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";
import { PartnerCatalogManager } from "@/components/partner-catalog-manager";
import * as Location from "expo-location";

type PartnerProfile = { id:string; application_id:string; partner_type:"hotel"|"restaurant"|"store"|"mall"; business_name:string; phone:string; email:string|null; city:string; address:string; description:string|null; is_published:boolean; business_vertical:"store"|"grocery"|"restaurant"; governorate_key:string; promotion_governorates:string[]; promotion_radius_km:number; promotion_latitude:number|null; promotion_longitude:number|null };
const typeLabels:Record<string,string>={hotel:"فندق",restaurant:"مطعم",store:"محل",mall:"مول"};
const governorates=[["baghdad","بغداد"],["basra","البصرة"],["nineveh","نينوى"],["erbil","أربيل"],["sulaymaniyah","السليمانية"],["duhok","دهوك"],["kirkuk","كركوك"],["najaf","النجف"],["karbala","كربلاء"],["babil","بابل"],["anbar","الأنبار"],["diyala","ديالى"],["saladin","صلاح الدين"],["wasit","واسط"],["dhiqar","ذي قار"],["maysan","ميسان"],["muthanna","المثنى"],["qadisiyah","القادسية"]] as const;

export default function PartnerDashboardScreen() {
  const { user } = useAuth();
  const [items,setItems]=useState<PartnerProfile[]>([]);
  const [loading,setLoading]=useState(true);
  const [savingId,setSavingId]=useState<string|null>(null);
  const [locationBusyId,setLocationBusyId]=useState<string|null>(null);

  const load=useCallback(async()=>{
    if(!user?.id)return;
    setLoading(true);
    const {data:approved,error:approvalError}=await (supabase as any).from("partner_applications")
      .select("id,partner_type").eq("user_id",user.id).eq("status","approved").in("partner_type",["store","restaurant"]);
    if(approvalError){Alert.alert("تعذر تحميل حالة الشراكة",approvalError.message);setItems([]);setLoading(false);return;}
    const ids=(approved??[]).map((row:any)=>row.id);
    if(!ids.length){setItems([]);setLoading(false);return;}
    const {data,error}=await (supabase as any).from("partner_business_profiles")
      .select("id,application_id,partner_type,business_name,phone,email,city,address,description,is_published,business_vertical,governorate_key,promotion_governorates,promotion_radius_km,promotion_latitude,promotion_longitude")
      .eq("user_id",user.id).in("application_id",ids).order("created_at",{ascending:false});
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
      is_published:item.is_published,business_vertical:item.business_vertical,promotion_governorates:item.business_vertical==="grocery"?[]:(item.promotion_governorates?.length?item.promotion_governorates:[item.governorate_key]),promotion_radius_km:item.promotion_radius_km,promotion_latitude:item.promotion_latitude,promotion_longitude:item.promotion_longitude,updated_at:new Date().toISOString()
    }).eq("id",item.id).eq("user_id",user?.id);
    setSavingId(null);
    if(error){Alert.alert("تعذر الحفظ",error.message);return;}
    Alert.alert("تم الحفظ","تحدثت بيانات المنشأة بنجاح.");
    await load();
  };

  const toggleGovernorate=(id:string,key:string)=>setItems(current=>current.map(item=>item.id!==id?item:{...item,promotion_governorates:(item.promotion_governorates??[]).includes(key)?item.promotion_governorates.filter(v=>v!==key):[...(item.promotion_governorates??[]),key]}));
  const captureBusinessLocation=async(item:PartnerProfile)=>{setLocationBusyId(item.id);try{let permission=await Location.getForegroundPermissionsAsync();if(!permission.granted)permission=await Location.requestForegroundPermissionsAsync();if(!permission.granted)throw new Error("اسمح لممنون بالوصول للموقع حتى نحدد موقع منشأتك.");const position=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});setItems(current=>current.map(row=>row.id===item.id?{...row,promotion_latitude:position.coords.latitude,promotion_longitude:position.coords.longitude}:row));Alert.alert("تم تحديد الموقع","احفظ التعديلات حتى نعتمد موقع المنشأة.");}catch(error){Alert.alert("تعذر تحديد الموقع",error instanceof Error?error.message:"حاول مرة ثانية.");}finally{setLocationBusyId(null);}};

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container}>
    <TouchableOpacity onPress={()=>router.back()}><Text style={styles.back}>رجوع للإعدادات</Text></TouchableOpacity>
    <View style={styles.hero}><Text style={styles.heroTitle}>إعدادات أعمالي</Text><Text style={styles.heroHint}>تحكم بانتشار منتجاتك وعروضك حسب المحافظات أو النطاق الجغرافي</Text></View>
    <View style={styles.heading}><Text style={styles.sectionTitle}>منشآتي المعتمدة</Text><TouchableOpacity onPress={()=>void load()}><Text style={styles.refresh}>تحديث</Text></TouchableOpacity></View>
    {loading?<ActivityIndicator color={palette.brand}/>:items.length===0?<Text style={styles.empty}>ما عندك منشأة معتمدة حالياً. تابع حالة طلبك من الإعدادات.</Text>:items.map(item=><View key={item.id} style={styles.card}>
      <View style={styles.cardHead}><View style={{flex:1}}><Text style={styles.name}>{item.business_name}</Text><Text style={styles.detail}>{typeLabels[item.partner_type]}</Text></View><Text style={[styles.status,item.is_published?styles.visible:styles.hidden]}>{item.is_published?"ظاهر للمستخدمين":"غير منشور"}</Text></View>
      <Text style={styles.label}>اسم المنشأة</Text><TextInput value={item.business_name} onChangeText={v=>change(item.id,"business_name",v)} maxLength={120} style={styles.input}/>
      <Text style={styles.label}>رقم التواصل</Text><TextInput value={item.phone} onChangeText={v=>change(item.id,"phone",v)} keyboardType="phone-pad" maxLength={30} style={styles.input}/>
      <Text style={styles.label}>البريد الإلكتروني</Text><TextInput value={item.email??""} onChangeText={v=>change(item.id,"email",v)} keyboardType="email-address" autoCapitalize="none" style={styles.input}/>
      <Text style={styles.label}>المدينة</Text><TextInput value={item.city} onChangeText={v=>change(item.id,"city",v)} maxLength={80} style={styles.input}/>
      <Text style={styles.label}>العنوان</Text><TextInput value={item.address} onChangeText={v=>change(item.id,"address",v)} maxLength={240} style={styles.input}/>
      <Text style={styles.label}>نبذة المنشأة</Text><TextInput value={item.description??""} onChangeText={v=>change(item.id,"description",v)} multiline maxLength={1000} style={[styles.input,styles.multiline]}/>
      <View style={styles.switchRow}><Text style={styles.label}>تفعيل حالة النشر</Text><Switch value={item.is_published} onValueChange={v=>change(item.id,"is_published",v)} trackColor={{true:palette.brand}}/></View>
      <TouchableOpacity disabled={savingId===item.id} onPress={()=>void save(item)} style={[styles.save,savingId===item.id&&{opacity:0.5}]}><Text style={styles.saveText}>{savingId===item.id?"جارٍ الحفظ...":"حفظ التعديلات"}</Text></TouchableOpacity>
      {["store","mall"].includes(item.partner_type)?<View style={styles.switchRow}><Text style={styles.label}>نوع النشاط: {item.business_vertical==="grocery"?"بقالة وخضروات مستقلة":"محلات ومتاجر"}</Text><TouchableOpacity onPress={()=>change(item.id,"business_vertical",item.business_vertical==="grocery"?"store":"grocery")}><Text style={{color:palette.brand,fontWeight:"900"}}>تغيير</Text></TouchableOpacity></View>:null}
      <View style={styles.promotionBox}><Text style={styles.promotionTitle}>نطاق عرض وترويج البضاعة</Text>{item.business_vertical==="grocery" ? <><Text style={styles.promotionHint}>البقالة تظهر ضمن دائرة حول موقع منشأتك فقط. النطاق الافتراضي ٥ كم.</Text><View style={styles.switchRow}><Text style={styles.label}>نطاق الترويج: {Number(item.promotion_radius_km||5).toLocaleString("ar-IQ")} كم</Text><View style={{flexDirection:"row",gap:8}}><TouchableOpacity onPress={()=>change(item.id,"promotion_radius_km",Math.max(1,Number(item.promotion_radius_km||5)-1))} style={styles.radiusButton}><Text style={styles.radiusButtonText}>−</Text></TouchableOpacity><TouchableOpacity onPress={()=>change(item.id,"promotion_radius_km",Math.min(100,Number(item.promotion_radius_km||5)+1))} style={styles.radiusButton}><Text style={styles.radiusButtonText}>+</Text></TouchableOpacity></View></View><Text style={styles.promotionHint}>{item.promotion_latitude!=null&&item.promotion_longitude!=null?"تم تحديد موقع المنشأة":"حدد موقع البقالة حتى يشتغل نطاق الـ ٥ كم بدقة."}</Text><TouchableOpacity disabled={locationBusyId===item.id} onPress={()=>void captureBusinessLocation(item)} style={styles.locationButton}><Text style={styles.locationButtonText}>{locationBusyId===item.id?"جارٍ تحديد الموقع...":"تحديد موقع المنشأة الحالي"}</Text></TouchableOpacity></> : <><Text style={styles.promotionHint}>اختار محافظة أو أكثر حتى تظهر منتجاتك وعروضك للزبائن داخل المحافظات المحددة فقط.</Text><View style={styles.governorateGrid}>{governorates.map(([key,label])=>{const selected=(item.promotion_governorates??[]).includes(key);return <TouchableOpacity key={key} onPress={()=>toggleGovernorate(item.id,key)} style={[styles.governorateChip,selected&&styles.governorateChipSelected]}><Text style={[styles.governorateChipText,selected&&styles.governorateChipTextSelected]}>{label}{selected?" ✓":""}</Text></TouchableOpacity>;})}</View></>}<TouchableOpacity disabled={savingId===item.id} onPress={()=>void save(item)} style={styles.save}><Text style={styles.saveText}>{savingId===item.id?"جارٍ الحفظ...":"حفظ إعدادات الانتشار"}</Text></TouchableOpacity></View>
      <PartnerCatalogManager profileId={item.id} partnerType={item.partner_type} businessVertical={item.business_vertical}/>
    </View>)}
    <View style={styles.notice}><Text style={styles.noticeText}>حالة النشر تُحفظ بملف الشريك. ربط الدليل العام للزبائن وإدارة الحجوزات والغرف وقائمة الطعام والمنتجات يحتاج وحدات عرض وتشغيل مستقلة.</Text></View>
  </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:palette.pageCanvas},container:{padding:space.xl,paddingBottom:space.huge,gap:12},
 back:{color:palette.brand,fontSize:13,fontWeight:"900",textAlign:"right",marginBottom:8},
 hero:{backgroundColor:palette.brand,borderRadius:radius.xl,padding:22},heroTitle:{color:"#fff",fontSize:24,fontWeight:"900",textAlign:"right"},
 heroHint:{color:"#fff",opacity:0.85,fontSize:12,textAlign:"right",marginTop:5},promotionBox:{backgroundColor:palette.brandSoft,borderRadius:radius.lg,padding:12,gap:10},promotionTitle:{color:palette.brand,fontSize:14,fontWeight:"900",textAlign:"right"},promotionHint:{color:palette.muted,fontSize:11,textAlign:"right",lineHeight:18},governorateGrid:{flexDirection:"row",flexWrap:"wrap",gap:7,justifyContent:"flex-end"},governorateChip:{borderWidth:1,borderColor:palette.line,borderRadius:18,paddingHorizontal:10,paddingVertical:8,backgroundColor:palette.surface},governorateChipSelected:{backgroundColor:palette.brand,borderColor:palette.brand},governorateChipText:{color:palette.ink,fontSize:11,fontWeight:"700"},governorateChipTextSelected:{color:"#fff"},radiusButton:{width:34,height:34,borderRadius:10,backgroundColor:palette.brand,alignItems:"center",justifyContent:"center"},radiusButtonText:{color:"#fff",fontSize:20,fontWeight:"900"},locationButton:{borderRadius:radius.md,backgroundColor:palette.surface,padding:11,alignItems:"center",borderWidth:1,borderColor:palette.brand},locationButtonText:{color:palette.brand,fontWeight:"900",fontSize:12},heading:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
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
