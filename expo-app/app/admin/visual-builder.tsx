import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius } from "@/styles/theme";

type Element = { element_key:string; label:string; screen_key:string; placement_key:string; title:string|null; subtitle:string|null; image_url:string|null; icon_name:string|null; width_px:number|null; height_px:number|null; sort_order:number; is_enabled:boolean; is_published:boolean; config:Record<string,any> };
export default function AdminVisualBuilderScreen(){
 const {user}=useAuth();const [allowed,setAllowed]=useState(false);const [rows,setRows]=useState<Element[]>([]);const [selected,setSelected]=useState<Element|null>(null);const [title,setTitle]=useState("");const [subtitle,setSubtitle]=useState("");const [url,setUrl]=useState("");const [width,setWidth]=useState("64");const [height,setHeight]=useState("64");const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [legalDrafts,setLegalDrafts]=useState<Record<string,{title:string;body:string}>>({});
 const load=useCallback(async()=>{
  if(!user?.id){setLoading(false);return;}
  const {data:owner,error:permissionError}=await supabase.rpc("is_super_admin",{p_user_id:user.id});
  if(permissionError||owner!==true){setAllowed(false);setLoading(false);return;}setAllowed(true);
  const {data,error}=await (supabase as any).from("app_ui_elements").select("*").order("sort_order");
  if(error)Alert.alert("تعذر تحميل عناصر الصور",error.message);else{const list=(data??[]) as Element[];setRows(list);}
  const {data:legal}=await (supabase as any).from("app_legal_pages").select("slug,title,body");
  if(legal)setLegalDrafts(Object.fromEntries(legal.map((page:any)=>[page.slug,{title:page.title||"",body:page.body||""}])));
  setLoading(false);
 },[user?.id]);
 const choose=(item:Element)=>{setSelected(item);const d=item.config??{};setTitle(String(d.title??item.title??""));setSubtitle(String(d.subtitle??item.subtitle??""));setUrl(String(d.image_url??item.image_url??""));setWidth(String(d.width_px??item.width_px??64));setHeight(String(d.height_px??item.height_px??64));};
 useEffect(()=>{void load();},[load]);
 const upload=async()=>{
  const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();if(!permission.granted){Alert.alert("إذن الصور مطلوب","اسمح بالوصول إلى الصور حتى تختار صورة.");return;}
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,quality:.9});
  if(result.canceled||!result.assets[0])return;const asset=result.assets[0];
  if(!asset.mimeType?.startsWith("image/")||(asset.fileSize??0)>8*1024*1024){Alert.alert("صورة غير مناسبة","اختار صورة أقل من 8 ميغابايت.");return;}
  if(!selected)return;setBusy(true);
  try{const response=await fetch(asset.uri);const bytes=await response.arrayBuffer();const ext=(asset.mimeType.split("/")[1]||"jpeg").replace(/[^a-z0-9]/gi,"");const path="app-ui/"+selected.element_key+"/"+Date.now()+"."+ext;
   const {error}=await supabase.storage.from("app-visuals").upload(path,bytes,{upsert:false,contentType:asset.mimeType});if(error)throw error;
   setUrl(supabase.storage.from("app-visuals").getPublicUrl(path).data.publicUrl);
  }catch(e){Alert.alert("تعذر رفع الصورة",e instanceof Error?e.message:"حاول مرة ثانية");}finally{setBusy(false);}
 };
 const saveLegal=async(slug:"privacy"|"terms")=>{
  const draft=legalDrafts[slug];if(!draft?.title.trim()||!draft.body.trim()){Alert.alert("بيانات ناقصة","اكتب عنوان ومحتوى الصفحة أولاً.");return;}
  setBusy(true);const {error}=await (supabase as any).from("app_legal_pages").upsert({slug,title:draft.title.trim(),body:draft.body.trim(),is_published:true,updated_at:new Date().toISOString()},{onConflict:"slug"});
  setBusy(false);if(error)Alert.alert("تعذر الحفظ",error.message);else Alert.alert("تم الحفظ","تم تحديث الصفحة القانونية.");
 };
 const save=async(publish:boolean)=>{
  if(!selected)return;const w=Number(width),h=Number(height);if(!Number.isInteger(w)||!Number.isInteger(h)||w<24||h<24||w>512||h>512){Alert.alert("تحقق من الحجم","العرض والارتفاع لازم يكونان بين 24 و512 بكسل.");return;}
  setBusy(true);const draft={...(selected.config??{}),title,subtitle,image_url:url,icon_name:"",width_px:w,height_px:h,sort_order:selected.sort_order};
  const patch:any=publish?{title,subtitle,image_url:url||null,icon_name:null,width_px:w,height_px:h,sort_order:selected.sort_order,is_enabled:true,is_published:true,config:draft,published_config:draft,updated_at:new Date().toISOString()}:{config:draft,updated_at:new Date().toISOString()};
  const {error}=await (supabase as any).from("app_ui_elements").update(patch).eq("element_key",selected.element_key);
  setBusy(false);if(error)Alert.alert("تعذر الحفظ",error.message);else{Alert.alert(publish?"تم النشر":"تم حفظ المسودة",publish?"تم نشر الصورة وإعداداتها.":"المسودة محفوظة ولم تُنشر بعد.");await load();}
 };
 if(loading)return <View style={s.center}><ActivityIndicator color={palette.brand}/></View>;
 if(!allowed)return <View style={s.center}><Text style={s.title}>هذا المحرر متاح للمدير الأعلى فقط.</Text></View>;
 return <ScrollView style={s.page} contentContainerStyle={s.content}>
  <Text style={s.title}>محرر صور وأيقونات التطبيق</Text><Text style={s.note}>اختار العنصر لتعديل صورته ومقاسه. احفظ المسودة أولاً أو انشرها حتى تظهر للمستخدمين.</Text>
  {rows.map(item=><TouchableOpacity key={item.element_key} onPress={()=>choose(item)} style={[s.row,selected?.element_key===item.element_key&&s.rowActive]}>
   {item.image_url?<Image source={{uri:item.image_url}} style={s.thumb}/>:<View style={s.thumbEmpty}><Text>🖼️</Text></View>}
   <View style={{flex:1}}><Text style={s.rowTitle}>{item.label}</Text><Text style={s.meta}>{item.screen_key} · {item.element_key}</Text><Text style={s.meta}>{item.is_published?"منشور":"غير منشور"}</Text></View><Text style={s.arrow}>←</Text>
  </TouchableOpacity>)}
  {selected&&<View style={s.editor}>
   <Text style={s.section}>{selected.label}</Text>
   {url?<Image source={{uri:url}} style={s.preview} resizeMode="contain"/>:<View style={s.previewEmpty}><Text style={s.meta}>لا توجد صورة مضافة</Text></View>}
   <TouchableOpacity style={s.upload} onPress={()=>void upload()} disabled={busy}><Text style={s.uploadText}>{busy?"جارٍ العمل...":"اختيار صورة من الجهاز"}</Text></TouchableOpacity>
   <Text style={s.label}>عنوان العنصر</Text><TextInput value={title} onChangeText={setTitle} style={s.input}/>
   <Text style={s.label}>الوصف</Text><TextInput value={subtitle} onChangeText={setSubtitle} style={s.input}/>
   <Text style={s.label}>رابط الصورة</Text><TextInput value={url} onChangeText={setUrl} autoCapitalize="none" style={s.input}/>
   <View style={s.dimensions}><View style={{flex:1}}><Text style={s.label}>العرض px</Text><TextInput value={width} onChangeText={setWidth} keyboardType="number-pad" style={s.input}/></View><View style={{flex:1}}><Text style={s.label}>الارتفاع px</Text><TextInput value={height} onChangeText={setHeight} keyboardType="number-pad" style={s.input}/></View></View>
   <TouchableOpacity style={s.secondary} onPress={()=>void save(false)} disabled={busy}><Text style={s.buttonText}>حفظ المسودة</Text></TouchableOpacity>
   <TouchableOpacity style={s.primary} onPress={()=>void save(true)} disabled={busy}><Text style={s.buttonText}>{busy?"جارٍ الحفظ...":"نشر التغييرات"}</Text></TouchableOpacity>
  </View>}
  <View style={s.editor}>
   <Text style={s.section}>إدارة سياسة الخصوصية والشروط</Text>
   {(["privacy","terms"] as const).map(slug=>{const draft=legalDrafts[slug]??{title:slug==="privacy"?"سياسة الخصوصية":"الشروط والأحكام",body:""};return <View key={slug} style={{gap:7,marginTop:8}}>
    <Text style={s.label}>{slug==="privacy"?"سياسة الخصوصية":"الشروط والأحكام"} · العنوان</Text>
    <TextInput value={draft.title} onChangeText={v=>setLegalDrafts(old=>({...old,[slug]:{...draft,title:v}}))} style={s.input}/>
    <Text style={s.label}>المحتوى</Text>
    <TextInput value={draft.body} onChangeText={v=>setLegalDrafts(old=>({...old,[slug]:{...draft,body:v}}))} multiline textAlignVertical="top" style={[s.input,{minHeight:170}]}/>
    <TouchableOpacity style={s.primary} onPress={()=>void saveLegal(slug)} disabled={busy}><Text style={s.buttonText}>حفظ ونشر الصفحة</Text></TouchableOpacity>
   </View>;})}
  </View>
 </ScrollView>;
}
const s=StyleSheet.create({
 page:{flex:1,backgroundColor:palette.pageCanvas},content:{padding:14,paddingBottom:42,gap:9},center:{flex:1,alignItems:"center",justifyContent:"center",padding:20},title:{fontSize:19,fontWeight:"900",color:palette.ink,textAlign:"right"},note:{fontSize:11,lineHeight:19,color:palette.muted,textAlign:"right",marginBottom:8},
 row:{flexDirection:"row",alignItems:"center",gap:10,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:14,padding:10},rowActive:{borderColor:palette.brand,backgroundColor:"#E9F7F8"},thumb:{width:48,height:48,borderRadius:11,backgroundColor:"#EAF2F7"},thumbEmpty:{width:48,height:48,borderRadius:11,backgroundColor:"#EAF2F7",alignItems:"center",justifyContent:"center"},rowTitle:{fontSize:12,fontWeight:"900",color:palette.ink,textAlign:"right"},meta:{fontSize:9,color:palette.muted,textAlign:"right",marginTop:3},arrow:{fontSize:19,color:palette.brand,fontWeight:"900"},
 editor:{marginTop:8,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:18,padding:14,gap:8},section:{fontSize:16,fontWeight:"900",color:palette.ink,textAlign:"right"},preview:{width:"100%",height:150,borderRadius:13,backgroundColor:"#F0F5F8"},previewEmpty:{height:110,borderRadius:13,backgroundColor:"#F0F5F8",alignItems:"center",justifyContent:"center"},
 upload:{backgroundColor:"#DFF4F5",borderRadius:12,padding:12,alignItems:"center"},uploadText:{color:"#075B70",fontWeight:"900",fontSize:12},label:{fontSize:11,color:palette.ink,fontWeight:"800",textAlign:"right",marginTop:4},input:{minHeight:43,borderWidth:1,borderColor:palette.line,borderRadius:10,paddingHorizontal:10,color:palette.ink,textAlign:"right",backgroundColor:palette.canvas},dimensions:{flexDirection:"row",gap:9},secondary:{backgroundColor:"#DCECF7",borderRadius:12,padding:13,alignItems:"center"},primary:{backgroundColor:palette.brand,borderRadius:12,padding:13,alignItems:"center"},buttonText:{fontSize:12,fontWeight:"900",color:"#FFFFFF"}
});
