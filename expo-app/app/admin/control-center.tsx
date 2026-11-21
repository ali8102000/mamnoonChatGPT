import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack, router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

const defaults = { grid_gap_px:12, first_row_height_px:145, second_row_height_px:188, top_banner_height_px:130, wide_column_ratio:2, card_radius_px:20, taxi_icon_size_px:56, service_icon_size_px:64, large_icon_size_px:56, carousel_height_px:188 };
type Config = typeof defaults;
const fields: {key:keyof Config;label:string;min:number;max:number;step?:number}[] = [
 {key:"top_banner_height_px",label:"ارتفاع بانر اطلب الآن",min:100,max:240},
 {key:"grid_gap_px",label:"المسافة بين البطاقات",min:4,max:28},
 {key:"first_row_height_px",label:"ارتفاع الصف الأول",min:100,max:260},
 {key:"second_row_height_px",label:"ارتفاع الصف الثاني",min:120,max:300},
 {key:"wide_column_ratio",label:"نسبة عرض البطاقة الكبيرة",min:1.4,max:2.8,step:.1},
 {key:"carousel_height_px",label:"ارتفاع سلايدر الصور",min:120,max:300},
 {key:"card_radius_px",label:"استدارة الزوايا",min:8,max:32},
 {key:"taxi_icon_size_px",label:"حجم أيقونة التكسي",min:32,max:96},
 {key:"service_icon_size_px",label:"حجم صورة الفني",min:32,max:120},
 {key:"large_icon_size_px",label:"حجم أيقونة السيارة الكبيرة",min:32,max:96},
];
export default function AdminControlCenterScreen(){
 const {user}=useAuth();const [config,setConfig]=useState<Config>(defaults);const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [allowed,setAllowed]=useState(false);const [exists,setExists]=useState(false);
 const load=useCallback(async()=>{
  if(!user?.id){setLoading(false);return;}
  const {data:owner,error:permissionError}=await supabase.rpc("is_super_admin",{p_user_id:user.id});
  if(permissionError||owner!==true){setAllowed(false);setLoading(false);return;}setAllowed(true);
  const {data,error}=await (supabase as any).from("app_ui_elements").select("config,published_config").eq("element_key","home_customer_grid_layout").maybeSingle();
  if(error)Alert.alert("تعذر تحميل المقاسات",error.message);else if(data){setExists(true);setConfig({...defaults,...(data.published_config??{}),...(data.config??{})});}
  setLoading(false);
 },[user?.id]);
 useEffect(()=>{void load();},[load]);
 const save=async(publish:boolean)=>{
  if(!exists)return;setSaving(true);
  const safe={grid_gap_px:Math.max(4,Math.min(28,Number(config.grid_gap_px)||12)),first_row_height_px:Math.max(100,Math.min(260,Number(config.first_row_height_px)||145)),second_row_height_px:Math.max(120,Math.min(300,Number(config.second_row_height_px)||188)),top_banner_height_px:Math.max(100,Math.min(240,Number(config.top_banner_height_px)||130)),wide_column_ratio:Math.max(1.4,Math.min(2.8,Number(config.wide_column_ratio)||2)),card_radius_px:Math.max(8,Math.min(32,Number(config.card_radius_px)||20)),taxi_icon_size_px:Math.max(32,Math.min(96,Number(config.taxi_icon_size_px)||56)),service_icon_size_px:Math.max(32,Math.min(120,Number(config.service_icon_size_px)||64)),large_icon_size_px:Math.max(32,Math.min(96,Number(config.large_icon_size_px)||56)),carousel_height_px:Math.max(120,Math.min(300,Number(config.carousel_height_px)||188))};
  const patch=publish?{config:safe,published_config:safe,is_enabled:true,is_published:true,updated_at:new Date().toISOString()}:{config:safe,updated_at:new Date().toISOString()};
  const {error}=await (supabase as any).from("app_ui_elements").update(patch).eq("element_key","home_customer_grid_layout");setSaving(false);
  if(error)Alert.alert("تعذر الحفظ",error.message);else{setConfig(safe);Alert.alert(publish?"تم النشر":"تم حفظ المسودة",publish?"تم نشر المقاسات للويب والأندرويد.":"المسودة محفوظة ولم تظهر للزبائن.");}
 };
 if(loading)return <View style={s.center}><ActivityIndicator color={palette.brand}/></View>;
 if(!allowed)return <View style={s.center}><Text style={s.title}>هذا المركز متاح للمدير الأعلى فقط.</Text></View>;
 return <ScrollView style={s.page} contentContainerStyle={s.content}>
  <Stack.Screen options={{title:"مركز التحكم الشامل"}}/>
  <View style={s.hero}><Text style={s.eyebrow}>MAMNOON ADMIN CONTROL</Text><Text style={s.heroTitle}>مركز التحكم الشامل</Text><Text style={s.heroText}>تحكم بمقاسات واجهة التطبيق من الإدارة فقط، مع معاينة قبل النشر.</Text></View>
  <View style={s.preview}>
   <Text style={s.sectionTitle}>معاينة شبكة الرئيسية</Text>
   <View style={[s.previewBanner,{height:config.top_banner_height_px,borderRadius:config.card_radius_px}]}><Text style={s.previewText}>اطلب الآن</Text></View>
   <View style={{flexDirection:"row",gap:config.grid_gap_px}}>
    <View style={{flex:config.wide_column_ratio,height:config.first_row_height_px,borderRadius:config.card_radius_px,backgroundColor:"#E9AB2B",justifyContent:"center",alignItems:"center"}}><Text style={s.previewText}>طلب تكسي</Text></View>
    <View style={{flex:1,height:config.first_row_height_px,borderRadius:config.card_radius_px,backgroundColor:"#10B981",justifyContent:"center",alignItems:"center"}}><Text style={s.previewText}>طلب فني</Text></View>
   </View>
   <View style={{flexDirection:"row",gap:config.grid_gap_px}}>
    <View style={{flex:1,height:config.second_row_height_px,borderRadius:config.card_radius_px,backgroundColor:"#C56A16",justifyContent:"center",alignItems:"center"}}><Text style={s.previewText}>سيارة كبيرة</Text></View>
    <View style={{flex:config.wide_column_ratio,height:config.second_row_height_px,borderRadius:config.card_radius_px,backgroundColor:"#173F35",justifyContent:"center",alignItems:"center"}}><Text style={s.previewText}>البانر التالي</Text></View>
   </View>
  </View>
  <View style={s.panel}><Text style={s.sectionTitle}>تعديل المقاسات</Text>{fields.map(field=><View key={field.key} style={s.field}><Text style={s.fieldLabel}>{field.label}</Text><TextInput keyboardType="decimal-pad" value={String(config[field.key])} onChangeText={v=>setConfig(old=>({...old,[field.key]:Number(v)||0}))} style={s.input}/></View>)}
   <TouchableOpacity disabled={!exists||saving} onPress={()=>void save(false)} style={s.draftButton}><Text style={s.draftText}>{saving?"جارٍ الحفظ...":"حفظ مسودة"}</Text></TouchableOpacity>
   <TouchableOpacity disabled={!exists||saving} onPress={()=>void save(true)} style={s.publishButton}><Text style={s.publishText}>نشر المقاسات</Text></TouchableOpacity>
  </View>
  <View style={s.panel}><Text style={s.sectionTitle}>أدوات التصميم والصور</Text>
   {[["محرر الصور والأيقونات","/admin/visual-builder"],["البانرات والإعلانات","/admin/home-banners"],["مركز الصور والتصميم","/admin/image-studio"]].map(([label,path])=><TouchableOpacity key={path} onPress={()=>router.push(path as any)} style={s.link}><Text style={s.linkText}>{label}</Text><Text style={s.arrow}>←</Text></TouchableOpacity>)}
  </View>
 </ScrollView>;
}
const s=StyleSheet.create({
 page:{flex:1,backgroundColor:palette.pageCanvas},content:{padding:space.lg,paddingBottom:50,gap:12},center:{flex:1,alignItems:"center",justifyContent:"center",padding:24},hero:{borderRadius:radius.xl,padding:20,backgroundColor:"#103B58",gap:7},eyebrow:{color:"#9DE7E4",fontSize:10,fontWeight:"900"},heroTitle:{color:"#fff",fontSize:23,fontWeight:"900",textAlign:"right"},heroText:{color:"#E1F7F8",fontSize:12,lineHeight:20,textAlign:"right"},preview:{backgroundColor:"#fff",padding:12,borderRadius:radius.lg,gap:8},previewBanner:{backgroundColor:"#E9AB2B",alignItems:"center",justifyContent:"center"},previewText:{color:"#fff",fontWeight:"900",fontSize:12},panel:{backgroundColor:palette.surface,borderRadius:radius.lg,padding:14,borderWidth:1,borderColor:palette.line,gap:9},sectionTitle:{fontSize:15,fontWeight:"900",color:palette.ink,textAlign:"right"},field:{gap:5},fieldLabel:{fontSize:11,fontWeight:"800",color:palette.ink,textAlign:"right"},input:{borderWidth:1,borderColor:palette.line,borderRadius:12,padding:10,color:palette.ink,textAlign:"right"},draftButton:{borderWidth:1,borderColor:palette.line,borderRadius:12,padding:13,alignItems:"center"},draftText:{color:palette.ink,fontWeight:"900"},publishButton:{backgroundColor:palette.brand,borderRadius:12,padding:14,alignItems:"center"},publishText:{color:"#fff",fontWeight:"900"},link:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",padding:13,borderRadius:12,backgroundColor:palette.pageCanvas},linkText:{color:palette.ink,fontWeight:"800"},arrow:{color:palette.brand,fontSize:18}
});
