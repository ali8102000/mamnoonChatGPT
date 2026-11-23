import { useEffect, useState } from "react";
import { Alert, ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import MapView, { Marker, type MapPressEvent } from "react-native-maps";
import * as ImagePicker from "expo-image-picker";
import { Stack, router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, space } from "@/styles/theme";

type DocKey = "license" | "idFront" | "idBack";
type PickedDoc = { uri: string; mimeType?: string | null; fileName?: string | null };
const TYPES = [{value:"hotel",label:"فندق"},{value:"store",label:"متجر"},{value:"mall",label:"مول"},{value:"company",label:"شركة"},{value:"other",label:"نشاط آخر"}];

export default function PartnerRegistrationScreen() {
  const { user, loading: authLoading } = useAuth() as any;
  const [kind,setKind]=useState("hotel");
  const [businessName,setBusinessName]=useState("");
  const [licenseNumber,setLicenseNumber]=useState("");
  const [phone,setPhone]=useState("");
  const [governorate,setGovernorate]=useState("");
  const [city,setCity]=useState("");
  const [address,setAddress]=useState("");
  const [latitude,setLatitude]=useState(33.3152);
  const [longitude,setLongitude]=useState(44.3661);
  const [docs,setDocs]=useState<Partial<Record<DocKey,PickedDoc>>>({});
  const [status,setStatus]=useState<string|null>(null);
  const [reviewNotes,setReviewNotes]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{let active=true;(async()=>{
    if(!user?.id){if(!authLoading)router.replace("/auth");return;}
    const [{data:profile},{data:application,error}] = await Promise.all([
      supabase.from("profiles").select("phone").eq("id",user.id).maybeSingle(),
      supabase.from("partner_verifications").select("status,review_notes,partner_type,business_name,license_number,contact_phone,governorate,city,business_address,latitude,longitude").eq("user_id",user.id).maybeSingle()
    ]);
    if(!active)return;
    if(profile?.phone)setPhone(profile.phone);
    if(application&&!error){
      setStatus(application.status);setReviewNotes(application.review_notes);
      setKind(application.partner_type);setBusinessName(application.business_name);setLicenseNumber(application.license_number);
      setPhone(application.contact_phone);setGovernorate(application.governorate);setCity(application.city);setAddress(application.business_address);
      setLatitude(Number(application.latitude));setLongitude(Number(application.longitude));
    }
    setLoading(false);
  })();return()=>{active=false;}},[user?.id,authLoading]);

  async function chooseDoc(key:DocKey){
    const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsEditing:true,quality:0.85});
    if(!result.canceled&&result.assets?.[0]){
      const asset=result.assets[0];
      if(asset.fileSize && asset.fileSize>8*1024*1024){Alert.alert("حجم الملف كبير","الحد الأعلى لكل مستند 8 ميغابايت");return;}
      setDocs(old=>({...old,[key]:{uri:asset.uri,mimeType:asset.mimeType,fileName:asset.fileName}}));
    }
  }
  async function upload(key:DocKey,label:string){
    const file=docs[key];if(!file)return null;
    const ext=(file.fileName?.split(".").pop()||file.mimeType?.split("/")[1]||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"");
    const path=`${user.id}/partner-registration/${key}-${Date.now()}.${ext}`;
    const bytes=await fetch(file.uri).then(r=>r.arrayBuffer());
    const {data,error}=await supabase.storage.from("provider-verification").upload(path,bytes,{contentType:file.mimeType||"image/jpeg",upsert:false});
    if(error)throw error;return data.path;
  }
  async function submit(){
    if(!user?.id)return;
    if(status==="approved"){Alert.alert("تم اعتماد الشريك","إذا تحتاج تغيير البيانات تواصل مع الإدارة.");return;}
    if(businessName.trim().length<2||licenseNumber.trim().length<2||phone.trim().length<7||governorate.trim().length<2||city.trim().length<2||address.trim().length<5){Alert.alert("بيانات ناقصة","أكمل بيانات المنشأة والترخيص والعنوان.");return;}
    if(!docs.license||!docs.idFront||!docs.idBack){Alert.alert("المستندات مطلوبة","ارفع إجازة العمل وصورة هوية الوجه الأمامي والخلفي.");return;}
    setBusy(true);
    try{
      const [license_document_path,id_front_path,id_back_path]=await Promise.all([upload("license","إجازة العمل"),upload("idFront","هوية أمامية"),upload("idBack","هوية خلفية")]);
      const payload={user_id:user.id,partner_type:kind,business_name:businessName.trim(),license_number:licenseNumber.trim(),contact_phone:phone.trim(),governorate:governorate.trim(),city:city.trim(),business_address:address.trim(),latitude,longitude,license_document_path,id_front_path,id_back_path,status:"pending",review_notes:null,reviewed_by:null,reviewed_at:null};
      const {error}=await supabase.from("partner_verifications").upsert(payload,{onConflict:"user_id"});
      if(error)throw error;
      setStatus("pending");setReviewNotes(null);
      Alert.alert("تم إرسال الطلب","وصلت بيانات المنشأة والمستندات إلى إدارة ممنون للمراجعة.");
    }catch(e:any){Alert.alert("تعذر إرسال الطلب",e?.message||"حاول مرة ثانية");}
    finally{setBusy(false);}
  }

  if(authLoading||loading)return <View style={s.center}><ActivityIndicator color={palette.brand}/><Text style={s.muted}>جاري تحميل بيانات الشريك...</Text></View>;
  return <View style={s.page}>
    <Stack.Screen options={{title:"تسجيل شريك تجاري"}}/>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>تسجيل منشأتك كشريك في ممنون</Text>
      <Text style={s.muted}>أرسل بيانات النشاط وإجازة العمل والمستمسكات. لن يتم تفعيل حساب الشريك قبل مراجعة الإدارة.</Text>
      {status==="approved"&&<View style={s.approved}><Text style={s.approvedText}>تم اعتماد منشأتك</Text></View>}
      {status==="pending"&&<View style={s.pending}><Text style={s.pendingText}>طلبك قيد المراجعة لدى الإدارة</Text></View>}
      {status==="rejected"&&<View style={s.rejected}><Text style={s.rejectedText}>الطلب يحتاج تعديل: {reviewNotes||"راجع الإدارة"}</Text></View>}
      <Text style={s.label}>نوع النشاط</Text><View style={s.types}>{TYPES.map(t=><TouchableOpacity key={t.value} onPress={()=>setKind(t.value)} style={[s.type,kind===t.value&&s.typeActive]}><Text style={[s.typeText,kind===t.value&&s.typeTextActive]}>{t.label}</Text></TouchableOpacity>)}</View>
      <Field label="اسم الفندق أو المتجر أو المول" value={businessName} onChangeText={setBusinessName} placeholder="اسم المنشأة الرسمي"/>
      <Field label="رقم إجازة العمل أو الترخيص" value={licenseNumber} onChangeText={setLicenseNumber} placeholder="رقم الإجازة"/>
      <Field label="رقم هاتف المنشأة" value={phone} onChangeText={setPhone} placeholder="07xxxxxxxxx" keyboardType="phone-pad"/>
      <Field label="المحافظة" value={governorate} onChangeText={setGovernorate} placeholder="مثال: النجف"/>
      <Field label="المدينة أو القضاء" value={city} onChangeText={setCity} placeholder="مثال: النجف الأشرف"/>
      <Field label="العنوان التفصيلي" value={address} onChangeText={setAddress} placeholder="الحي والشارع وأقرب نقطة دالة"/>
      <Text style={s.label}>حدد موقع المنشأة على الخريطة</Text>
      <Text style={s.muted}>اضغط على موقع المنشأة حتى يثبت الدبوس، وتكدر تحركه بتحديد مكان جديد.</Text>
      <MapView style={s.map} initialRegion={{latitude,longitude,latitudeDelta:0.035,longitudeDelta:0.035}} region={{latitude,longitude,latitudeDelta:0.035,longitudeDelta:0.035}} onPress={(e:MapPressEvent)=>{setLatitude(e.nativeEvent.coordinate.latitude);setLongitude(e.nativeEvent.coordinate.longitude);}}>
        <Marker coordinate={{latitude,longitude}} draggable onDragEnd={e=>{setLatitude(e.nativeEvent.coordinate.latitude);setLongitude(e.nativeEvent.coordinate.longitude);}} title={businessName||"موقع المنشأة"}/>
      </MapView>
      <Text style={s.coords}>خط العرض: {latitude.toFixed(6)} · خط الطول: {longitude.toFixed(6)}</Text>
      <Text style={s.label}>المستندات المطلوبة</Text>
      <DocButton title="إجازة العمل / رخصة النشاط" file={docs.license} onPress={()=>void chooseDoc("license")}/>
      <DocButton title="هوية صاحب المنشأة - الوجه الأمامي" file={docs.idFront} onPress={()=>void chooseDoc("idFront")}/>
      <DocButton title="هوية صاحب المنشأة - الوجه الخلفي" file={docs.idBack} onPress={()=>void chooseDoc("idBack")}/>
      <Text style={s.note}>المستندات سرية ولا تظهر للزبائن. يطلع عليها الشريك والإدارة المخوّلة فقط.</Text>
      <TouchableOpacity disabled={busy||status==="approved"} onPress={()=>void submit()} style={[s.submit,(busy||status==="approved")&&{opacity:0.55}]}><Text style={s.submitText}>{busy?"جارٍ إرسال الطلب...":status==="pending"?"تحديث وإعادة إرسال البيانات":"إرسال طلب اعتماد الشريك"}</Text></TouchableOpacity>
    </ScrollView>
  </View>;
}
function Field({label,...props}:any){return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput {...props} placeholderTextColor={palette.muted} style={s.input}/></View>}
function DocButton({title,file,onPress}:any){return <TouchableOpacity onPress={onPress} style={s.doc}><Text style={s.docTitle}>{title}</Text>{file?<Text style={s.docPicked}>تم اختيار المستند ✓</Text>:<Text style={s.docHint}>اضغط لاختيار صورة واضحة</Text>}</TouchableOpacity>}
const s=StyleSheet.create({
 page:{flex:1,backgroundColor:palette.pageCanvas},content:{padding:space.lg,paddingBottom:48,gap:10},center:{flex:1,alignItems:"center",justifyContent:"center",gap:10},title:{fontSize:24,fontWeight:"900",color:palette.ink,textAlign:"right"},muted:{fontSize:12,color:palette.muted,textAlign:"right",lineHeight:20},label:{fontSize:13,fontWeight:"900",color:palette.ink,textAlign:"right",marginTop:10},field:{gap:7},input:{minHeight:52,borderWidth:1,borderColor:palette.line,borderRadius:12,paddingHorizontal:14,color:palette.ink,backgroundColor:palette.surfaceSoft,textAlign:"right",fontSize:14},types:{flexDirection:"row",flexWrap:"wrap",gap:7},type:{borderWidth:1,borderColor:palette.line,borderRadius:12,paddingHorizontal:13,paddingVertical:11},typeActive:{backgroundColor:palette.brand,borderColor:palette.brand},typeText:{color:palette.ink,fontWeight:"800",fontSize:12},typeTextActive:{color:palette.white},map:{height:260,borderRadius:16,overflow:"hidden"},coords:{fontSize:10,color:palette.muted,textAlign:"center"},doc:{borderWidth:1,borderColor:palette.line,borderRadius:12,padding:14,gap:5,backgroundColor:palette.surface},docTitle:{color:palette.ink,fontWeight:"800",textAlign:"right"},docHint:{color:palette.muted,fontSize:11,textAlign:"right"},docPicked:{color:palette.success,fontWeight:"800",fontSize:11,textAlign:"right"},note:{color:palette.muted,fontSize:11,lineHeight:19,textAlign:"right"},submit:{minHeight:54,borderRadius:14,backgroundColor:palette.brand,alignItems:"center",justifyContent:"center",marginTop:12},submitText:{color:palette.white,fontWeight:"900"},approved:{backgroundColor:"#dcfce7",padding:12,borderRadius:10},approvedText:{color:"#166534",fontWeight:"900",textAlign:"right"},pending:{backgroundColor:"#fef3c7",padding:12,borderRadius:10},pendingText:{color:"#92400e",fontWeight:"900",textAlign:"right"},rejected:{backgroundColor:"#fee2e2",padding:12,borderRadius:10},rejectedText:{color:"#991b1b",fontWeight:"900",textAlign:"right"}
});
