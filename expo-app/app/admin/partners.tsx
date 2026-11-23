import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { getAdminStaffRoles } from "@/lib/admin-access";
import { palette, space } from "@/styles/theme";

type Partner = {id:string;business_name:string;partner_type:string;license_number:string;contact_phone:string;governorate:string;city:string;business_address:string;latitude:number;longitude:number;status:string;review_notes?:string|null;created_at:string;profile?:{full_name?:string;phone?:string}|null;documents?:{license?:string|null;id_front?:string|null;id_back?:string|null}};
const labels:Record<string,string>={hotel:"فندق",store:"متجر",mall:"مول",company:"شركة",other:"نشاط آخر"};
const filters=[["pending","بانتظار"],["approved","معتمد"],["rejected","مرفوض"],["all","الكل"]];
export default function AdminPartnersScreen(){
 const {user,loading:authLoading}=useAuth();
 const [allowed,setAllowed]=useState<boolean|null>(null);const [rows,setRows]=useState<Partner[]>([]);
 const [filter,setFilter]=useState("pending");const [loading,setLoading]=useState(true);const [refreshing,setRefreshing]=useState(false);
 const [notes,setNotes]=useState<Record<string,string>>({});const [busy,setBusy]=useState<string|null>(null);const [error,setError]=useState("");
 const invoke=useCallback(async(body:Record<string,unknown>)=>{const {data,error}=await supabase.functions.invoke("admin-users",{body});if(error)throw error;if(data?.error)throw new Error(data.error);return data;},[]);
 const load=useCallback(async()=>{
  if(!user?.id)return;setError("");
  try{const roles=await getAdminStaffRoles(user.id);if(!roles.some((r:string)=>["super_admin","admin"].includes(r))){setAllowed(false);setRows([]);return;}setAllowed(true);const result=await invoke({action:"list_partner_applications",status:filter,limit:200});setRows(result.applications||[]);}
  catch(e:any){setError(e?.message||"تعذر تحميل طلبات الشركاء");setRows([]);}
  finally{setLoading(false);}
 },[user?.id,filter,invoke]);
 useEffect(()=>{if(!authLoading){if(!user){setAllowed(false);setLoading(false);}else void load();}},[authLoading,user,load]);
 const refresh=async()=>{setRefreshing(true);await load();setRefreshing(false);};
 async function review(row:Partner,status:"approved"|"rejected"){
  const review_notes=(notes[row.id]||"").trim();if(status==="rejected"&&!review_notes){Alert.alert("سبب الرفض مطلوب","اكتب سبب الرفض حتى يعرف الشريك شنو يعدّل.");return;}
  setBusy(row.id);try{await invoke({action:"review_partner_application",application_id:row.id,status,review_notes});Alert.alert("تم الحفظ",status==="approved"?"تم اعتماد الشريك":"تم رفض الطلب مع توضيح السبب");await load();}
  catch(e:any){Alert.alert("تعذر حفظ القرار",e?.message||"حاول مرة ثانية");}finally{setBusy(null);}
 }
 if(authLoading||loading)return <View style={s.center}><ActivityIndicator color={palette.brand}/><Text style={s.muted}>جاري تحميل طلبات الشركاء...</Text></View>;
 if(allowed===false)return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>اعتماد الشركاء متاح للمدير أو المدير الأعلى فقط.</Text></View>;
 return <View style={s.page}><Stack.Screen options={{title:"اعتماد الشركاء"}}/><ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
  <Text style={s.title}>اعتماد الشركاء والمنشآت</Text><Text style={s.muted}>مراجعة إجازة العمل والهويات وموقع الفندق أو المتجر أو المول قبل اعتماد الطلب.</Text>
  <View style={s.filters}>{filters.map(([v,label])=><TouchableOpacity key={v} onPress={()=>setFilter(v)} style={[s.filter,filter===v&&s.filterActive]}><Text style={[s.filterText,filter===v&&s.filterTextActive]}>{label}</Text></TouchableOpacity>)}</View>
  {!!error&&<Text style={s.error}>{error}</Text>}
  {rows.length===0?<Text style={s.empty}>ماكو طلبات بهذا التصنيف.</Text>:rows.map(row=><View key={row.id} style={s.card}>
   <View style={s.row}><Text style={[s.status,row.status==="approved"?s.good:row.status==="rejected"?s.bad:s.wait]}>{row.status==="pending"?"بانتظار":row.status==="approved"?"معتمد":"مرفوض"}</Text><View style={{flex:1}}><Text style={s.name}>{row.business_name}</Text><Text style={s.muted}>{labels[row.partner_type]||row.partner_type} · {row.governorate} / {row.city}</Text></View></View>
   <Info label="صاحب الحساب" value={row.profile?.full_name||"—"}/><Info label="رقم هاتف المنشأة" value={row.contact_phone}/><Info label="رقم الإجازة" value={row.license_number}/><Info label="عنوان المنشأة" value={row.business_address}/>
   <TouchableOpacity onPress={()=>Linking.openURL("https://www.google.com/maps?q="+row.latitude+","+row.longitude)} style={s.mapLink}><Text style={s.linkText}>📍 فتح دبوس موقع المنشأة بالخريطة</Text></TouchableOpacity>
   <View style={s.docs}>{[["إجازة العمل",row.documents?.license],["الهوية - أمام",row.documents?.id_front],["الهوية - خلف",row.documents?.id_back]].map(([label,url])=><View key={String(label)} style={s.doc}><Text style={s.docTitle}>{label}</Text>{url?<TouchableOpacity onPress={()=>Linking.openURL(String(url))}><Image source={{uri:String(url)}} style={s.docImage} resizeMode="contain"/><Text style={s.linkText}>فتح المستند</Text></TouchableOpacity>:<Text style={s.muted}>غير متاح</Text>}</View>)}</View>
   {row.status==="pending"&&<><Text style={s.label}>ملاحظات الإدارة / سبب الرفض</Text><TextInput multiline value={notes[row.id]||""} onChangeText={v=>setNotes(old=>({...old,[row.id]:v}))} placeholder="اكتب سبب الرفض عند الحاجة" placeholderTextColor={palette.muted} style={s.notes}/><View style={s.actions}><TouchableOpacity disabled={busy===row.id} onPress={()=>void review(row,"approved")} style={[s.approve,busy===row.id&&s.disabled]}><Text style={s.actionText}>اعتماد الشريك</Text></TouchableOpacity><TouchableOpacity disabled={busy===row.id} onPress={()=>void review(row,"rejected")} style={[s.reject,busy===row.id&&s.disabled]}><Text style={s.actionText}>رفض مع السبب</Text></TouchableOpacity></View></>}
   {row.status!=="pending"&&!!row.review_notes&&<Text style={s.muted}>ملاحظات المراجعة: {row.review_notes}</Text>}
  </View>)}
 </ScrollView></View>;
}
function Info({label,value}:{label:string;value:string}){return <View style={s.info}><Text style={s.infoValue}>{value}</Text><Text style={s.infoLabel}>{label}</Text></View>}
const s=StyleSheet.create({page:{flex:1,backgroundColor:palette.pageCanvas},content:{padding:space.lg,paddingBottom:40,gap:12},center:{flex:1,alignItems:"center",justifyContent:"center",gap:10},title:{fontSize:22,fontWeight:"900",color:palette.ink,textAlign:"right"},muted:{fontSize:11,color:palette.muted,textAlign:"right",lineHeight:18},filters:{flexDirection:"row",gap:7},filter:{paddingHorizontal:13,paddingVertical:9,borderRadius:10,borderWidth:1,borderColor:palette.line},filterActive:{backgroundColor:palette.brand,borderColor:palette.brand},filterText:{fontSize:11,fontWeight:"800",color:palette.ink},filterTextActive:{color:palette.white},card:{backgroundColor:palette.surface,borderRadius:16,borderWidth:1,borderColor:palette.line,padding:13,gap:10},row:{flexDirection:"row",alignItems:"center",gap:10},name:{fontSize:16,fontWeight:"900",color:palette.ink,textAlign:"right"},status:{fontSize:10,fontWeight:"900",padding:7,borderRadius:8,overflow:"hidden"},good:{backgroundColor:"#dcfce7",color:"#166534"},bad:{backgroundColor:"#fee2e2",color:"#991b1b"},wait:{backgroundColor:"#fef3c7",color:"#92400e"},info:{flexDirection:"row",justifyContent:"space-between",gap:8},infoLabel:{fontSize:11,color:palette.muted},infoValue:{fontSize:12,color:palette.ink,fontWeight:"700",flex:1,textAlign:"right"},mapLink:{padding:10,backgroundColor:palette.surfaceSoft,borderRadius:10},linkText:{fontSize:11,fontWeight:"800",color:palette.brand,textAlign:"center"},docs:{flexDirection:"row",gap:7},doc:{flex:1,borderWidth:1,borderColor:palette.line,borderRadius:10,padding:6,gap:5},docTitle:{fontSize:10,fontWeight:"800",color:palette.ink,textAlign:"center"},docImage:{height:110,width:"100%"},label:{fontSize:12,fontWeight:"800",color:palette.ink,textAlign:"right"},notes:{minHeight:65,borderWidth:1,borderColor:palette.line,borderRadius:10,padding:10,textAlign:"right",color:palette.ink},actions:{flexDirection:"row",gap:8},approve:{flex:1,backgroundColor:"#15803d",padding:12,borderRadius:10},reject:{flex:1,backgroundColor:"#b91c1c",padding:12,borderRadius:10},actionText:{color:"#fff",fontSize:11,fontWeight:"900",textAlign:"center"},disabled:{opacity:.5},empty:{padding:25,textAlign:"center",color:palette.muted},error:{color:"#b91c1c",textAlign:"right"}});
