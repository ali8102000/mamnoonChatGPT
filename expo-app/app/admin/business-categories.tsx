import {useCallback,useEffect,useState} from "react";
import {ActivityIndicator,Alert,Image,RefreshControl,ScrollView,StyleSheet,Text,TextInput,TouchableOpacity,View,Switch} from "react-native";
import {Stack} from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {supabase} from "@/lib/supabase";
import {useAuth} from "@/lib/auth-context";
import {palette,radius,space} from "@/styles/theme";
type Category={category_key:string;vertical:"store"|"restaurant"|"grocery"|"hotel";title:string;image_url:string;is_active:boolean;sort_order:number;tile_width_px:number;tile_height_px:number;auto_scroll_seconds:number};
const verticalLabel=(v:string)=>v==="restaurant"?"المطاعم":v==="grocery"?"البقالة المستقلة":v==="hotel"?"الفنادق":"المحلات والمتاجر";
export default function AdminBusinessCategoriesScreen(){
 const {user}=useAuth();const [authorized,setAuthorized]=useState<boolean|null>(null);const [rows,setRows]=useState<Category[]>([]);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState<string|null>(null);const [refreshing,setRefreshing]=useState(false);const [newVertical,setNewVertical]=useState<Category["vertical"]>("restaurant");const [newTitle,setNewTitle]=useState("");const [newKey,setNewKey]=useState("");const [newImage,setNewImage]=useState<string|null>(null);
 const load=useCallback(async()=>{
  if(!user?.id){setLoading(false);return;}
  const {data:allowed,error:permissionError}=await supabase.rpc("is_super_admin",{p_user_id:user.id});
  if(permissionError||allowed!==true){setAuthorized(false);setRows([]);setLoading(false);setRefreshing(false);return;}
  setAuthorized(true);
  const {data,error}=await (supabase as any).from("partner_catalog_categories").select("*").order("sort_order");
  if(error)Alert.alert("تعذر تحميل الفئات",error.message);else setRows((data??[]) as Category[]);
  setLoading(false);setRefreshing(false);
 },[user?.id]);
 useEffect(()=>{void load();},[load]);
 const patch=(key:string,changes:Partial<Category>)=>setRows(current=>current.map(x=>x.category_key===key?{...x,...changes}:x));
 const create=async()=>{const name=newTitle.trim();const categoryKey=(newKey.trim()||("category-"+Date.now())).toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-|-$/g,"").slice(0,48);if(name.length<2||!categoryKey||!newImage){Alert.alert("بيانات ناقصة","اكتب اسم الفئة واختر صورة.");return;}setBusy("new");try{const response=await fetch(newImage);const bytes=await response.arrayBuffer();const path="business-categories/"+categoryKey+"/"+Date.now()+".jpg";const up=await supabase.storage.from("app-visuals").upload(path,bytes,{upsert:false,contentType:"image/jpeg"});if(up.error)throw up.error;const image_url=supabase.storage.from("app-visuals").getPublicUrl(path).data.publicUrl;const {error}=await(supabase as any).from("partner_catalog_categories").insert({category_key:categoryKey,vertical:newVertical,title:name,image_url,is_active:true,sort_order:Math.max(0,...rows.filter(x=>x.vertical===newVertical).map(x=>x.sort_order))+10,tile_width_px:72,tile_height_px:72,auto_scroll_seconds:5});if(error)throw error;setNewTitle("");setNewKey("");setNewImage(null);Alert.alert("تمت الإضافة","أضيفت الفئة وصورتها.");await load();}catch(e){Alert.alert("تعذر الإضافة",e instanceof Error?e.message:"حاول مرة ثانية");}finally{setBusy(null);}};\n const upload=async(item:Category)=>{
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,quality:.88});
  if(result.canceled||!result.assets[0])return;
  const asset=result.assets[0];if(!asset.mimeType?.startsWith("image/")||(asset.fileSize??0)>8*1024*1024){Alert.alert("صورة غير مناسبة","اختار صورة أقل من 8 ميغابايت.");return;}
  setBusy(item.category_key);
  try{
   const response=await fetch(asset.uri);const bytes=await response.arrayBuffer();
   const ext=(asset.fileName?.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"")||"jpg";
   const path="business-categories/"+item.category_key+"/"+Date.now()+"."+ext;
   const {error}=await supabase.storage.from("app-visuals").upload(path,bytes,{upsert:false,contentType:asset.mimeType||"image/jpeg"});
   if(error)throw error;
   const url=supabase.storage.from("app-visuals").getPublicUrl(path).data.publicUrl;
   patch(item.category_key,{image_url:url});
  }catch(e){Alert.alert("تعذر رفع الصورة",e instanceof Error?e.message:"حاول مرة ثانية");}
  setBusy(null);
 };
 const save=async(item:Category)=>{
  setBusy(item.category_key);
  const {error}=await (supabase as any).from("partner_catalog_categories").update({title:item.title.trim(),image_url:item.image_url.trim(),is_active:item.is_active,sort_order:Number(item.sort_order)||0,tile_width_px:Math.max(48,Math.min(160,Number(item.tile_width_px)||72)),tile_height_px:Math.max(48,Math.min(160,Number(item.tile_height_px)||72)),auto_scroll_seconds:Math.max(1,Math.min(30,Number(item.auto_scroll_seconds)||5)),updated_at:new Date().toISOString()}).eq("category_key",item.category_key);
  setBusy(null);if(error)Alert.alert("تعذر الحفظ",error.message);else Alert.alert("تم الحفظ","تحدثت إعدادات الفئة.");
 };
 if(loading)return <View style={s.center}><ActivityIndicator color={palette.brand}/></View>;
 if(authorized!==true)return <View style={s.center}><Text style={s.denied}>هذا القسم متاح للمدير الأعلى فقط.</Text></View>;
 return <><Stack.Screen options={{title:"محرر فئات المتاجر"}}/><ScrollView style={s.page} contentContainerStyle={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);void load();}}/>}>
  <View style={s.hero}><Text style={s.heroTitle}>إدارة فئات وصور الأقسام</Text><Text style={s.heroHint}>أضف فئات بأسماء وصور تختارها للمطاعم والمحلات والبقالة والفنادق.</Text></View>\n  <View style={s.card}><Text style={s.label}>القسم</Text><View style={s.row}>{(["restaurant","store","grocery","hotel"] as Category["vertical"][]).map(v=><TouchableOpacity key={v} onPress={()=>setNewVertical(v)} style={[s.secondary,newVertical===v&&{backgroundColor:palette.brand}]}><Text style={[s.secondaryText,newVertical===v&&{color:"#fff"}]}>{verticalLabel(v)}</Text></TouchableOpacity>)}</View><Text style={s.label}>اسم الفئة</Text><TextInput value={newTitle} onChangeText={setNewTitle} placeholder="مثلاً: مشاوي على الفحم" style={s.input}/><Text style={s.label}>معرّف اختياري</Text><TextInput value={newKey} onChangeText={setNewKey} autoCapitalize="none" style={s.input}/><TouchableOpacity onPress={async()=>{const p=await ImagePicker.requestMediaLibraryPermissionsAsync();if(!p.granted){Alert.alert("صلاحية الصور","اسمح بالوصول إلى الصور.");return;}const r=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],quality:.88});if(!r.canceled&&r.assets[0])setNewImage(r.assets[0].uri);}} style={s.secondary}><Text style={s.secondaryText}>{newImage?"تم اختيار صورة الفئة":"اختيار صورة للفئة"}</Text></TouchableOpacity><TouchableOpacity disabled={busy==="new"} onPress={()=>void create()} style={s.save}><Text style={s.saveText}>إضافة الفئة والصورة</Text></TouchableOpacity></View>
  {rows.map(item=><View key={item.category_key} style={s.card}>
   <View style={s.row}><Image source={{uri:item.image_url}} style={s.preview}/><View style={{flex:1}}><Text style={s.name}>{item.title}</Text><Text style={s.meta}>{verticalLabel(item.vertical)} · {item.category_key}</Text></View><Switch value={item.is_active} onValueChange={v=>patch(item.category_key,{is_active:v})} trackColor={{true:palette.brand}}/></View>
   <Text style={s.label}>اسم الفئة</Text><TextInput value={item.title} onChangeText={v=>patch(item.category_key,{title:v})} style={s.input}/>
   <Text style={s.label}>رابط الصورة</Text><TextInput value={item.image_url} onChangeText={v=>patch(item.category_key,{image_url:v})} autoCapitalize="none" style={s.input}/>
   <TouchableOpacity onPress={()=>void upload(item)} style={s.secondary}><Text style={s.secondaryText}>{busy===item.category_key?"جارٍ الرفع...":"تبديل الصورة من الجهاز"}</Text></TouchableOpacity>
   <View style={s.row}>{([["العرض", "tile_width_px"],["الارتفاع","tile_height_px"],["سرعة الحركة بالثواني","auto_scroll_seconds"],["الترتيب","sort_order"]] as const).map(([label,key])=><View key={key} style={{flex:1}}><Text style={s.label}>{label}</Text><TextInput value={String(item[key])} onChangeText={v=>patch(item.category_key,{[key]:Number(v)||0} as Partial<Category>)} keyboardType="number-pad" style={s.input}/></View>)}</View>
   <TouchableOpacity disabled={busy===item.category_key} onPress={()=>void save(item)} style={s.save}><Text style={s.saveText}>{busy===item.category_key?"جارٍ الحفظ...":"حفظ إعدادات الفئة"}</Text></TouchableOpacity>
  </View>)}
 </ScrollView></>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:palette.pageCanvas},container:{padding:space.lg,paddingBottom:50,gap:12},center:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor:palette.pageCanvas},denied:{color:palette.danger,fontWeight:"900"},hero:{backgroundColor:palette.brand,borderRadius:radius.xl,padding:18,gap:7},heroTitle:{color:"#fff",fontSize:18,fontWeight:"900",textAlign:"right"},heroHint:{color:"#fff",fontSize:11,lineHeight:19,textAlign:"right",opacity:.9},card:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:12,gap:8},row:{flexDirection:"row",alignItems:"center",gap:8},preview:{width:58,height:58,borderRadius:10},name:{fontSize:14,fontWeight:"900",color:palette.ink,textAlign:"right"},meta:{fontSize:9,color:palette.muted,textAlign:"right"},label:{fontSize:10,fontWeight:"800",color:palette.ink,textAlign:"right"},input:{borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:9,color:palette.ink,textAlign:"right",fontSize:11},secondary:{borderWidth:1,borderColor:palette.brand,borderRadius:radius.md,padding:10,alignItems:"center"},secondaryText:{color:palette.brand,fontWeight:"900",fontSize:11},save:{backgroundColor:palette.brand,borderRadius:radius.md,padding:12,alignItems:"center"},saveText:{color:"#fff",fontWeight:"900",fontSize:12}});
