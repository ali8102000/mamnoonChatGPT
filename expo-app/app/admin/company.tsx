import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useCompanyBranding } from "@/lib/company-branding";
import { palette, radius, space } from "@/styles/theme";

export default function CompanySettingsScreen() {
  const { user } = useAuth();
  const branding = useCompanyBranding();
  const [name, setName] = useState("ممنون");
  const [welcome, setWelcome] = useState("مشوارك وخدمات بيتك، بمكان واحد.");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoAsset, setLogoAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!user?.id) { if (active) setLoading(false); return; }
      const [{ data: owner, error: permissionError }, { data, error }] = await Promise.all([
        supabase.rpc("is_super_admin", { p_user_id: user.id }),
        (supabase as any).from("company_settings").select("company_name,company_logo_url,welcome_message").eq("id",1).maybeSingle(),
      ]);
      if (!active) return;
      setAllowed(!permissionError && owner === true);
      if (error) Alert.alert("تعذر تحميل بيانات الشركة", error.message);
      setName(data?.company_name || branding.companyName);
      setLogoUrl(data?.company_logo_url || branding.logoUrl);
      setWelcome(data?.welcome_message || branding.welcomeMessage);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [user?.id, branding.companyName, branding.logoUrl, branding.welcomeMessage]);

  async function chooseLogo() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert("إذن الصور مطلوب", "اسمح للتطبيق بالوصول إلى الصور حتى تختار شعار الشركة."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1,1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) setLogoAsset(result.assets[0]);
  }

  async function save() {
    const companyName = name.trim();
    const message = welcome.trim();
    if (companyName.length < 2 || companyName.length > 80) { Alert.alert("تحقق من الاسم", "اسم الشركة يجب أن يكون بين حرفين و80 حرفاً."); return; }
    if (message.length < 2 || message.length > 180) { Alert.alert("تحقق من رسالة الترحيب", "رسالة الترحيب يجب أن تكون بين حرفين و180 حرفاً."); return; }
    if (!user?.id || !allowed) { Alert.alert("غير مصرّح", "تعديل هوية الشركة متاح للمدير الأعلى فقط."); return; }
    setSaving(true);
    try {
      const { data: owner, error: permissionError } = await supabase.rpc("is_super_admin", { p_user_id: user.id });
      if (permissionError || owner !== true) throw new Error("انتهت صلاحية الإدارة. سجّل الدخول من جديد.");
      let nextLogoUrl = logoUrl;
      if (logoAsset) {
        if (!logoAsset.mimeType?.startsWith("image/") || (logoAsset.fileSize != null && logoAsset.fileSize > 8 * 1024 * 1024)) throw new Error("اختار صورة شعار حجمها 8 ميغابايت أو أقل.");
        const response = await fetch(logoAsset.uri);
        if (!response.ok) throw new Error("تعذر قراءة الصورة المختارة.");
        const bytes = await response.arrayBuffer();
        const ext = (logoAsset.mimeType?.split("/")[1] || "jpeg").replace(/[^a-z0-9]/gi,"").toLowerCase() || "jpg";
        const path = `company-branding/logo-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("app-visuals").upload(path, bytes, { upsert: false, contentType: logoAsset.mimeType || "image/jpeg" });
        if (uploadError) throw uploadError;
        nextLogoUrl = supabase.storage.from("app-visuals").getPublicUrl(path).data.publicUrl;
      }
      const { error } = await (supabase as any).from("company_settings").upsert({
        id: 1, company_name: companyName, company_logo_url: nextLogoUrl,
        welcome_message: message, updated_by: user.id, updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (error) throw error;
      setLogoUrl(nextLogoUrl);
      setLogoAsset(null);
      Alert.alert("تم الحفظ", "تحدثت هوية الشركة وستظهر في شاشة الترحيب وتسجيل الدخول.");
    } catch (error: any) {
      Alert.alert("تعذر الحفظ", error?.message || "حدث خطأ أثناء حفظ بيانات الشركة.");
    } finally { setSaving(false); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator color={palette.brand}/><Text style={s.muted}>تحميل إعدادات الشركة...</Text></View>;
  if (!allowed) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>تعديل هوية الشركة متاح للمدير الأعلى فقط.</Text></View>;

  return <View style={s.page}>
    <Stack.Screen options={{ title: "هوية الشركة والشعار" }}/>
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.card}>
        <Text style={s.title}>هوية شركة ممنون</Text>
        <Text style={s.muted}>الشعار والاسم ورسالة الترحيب تظهر في شاشة الدخول والترحيب وباقي مواضع تعريف الشركة.</Text>
        <View style={s.preview}>
          {logoAsset ? <Image source={{uri:logoAsset.uri}} style={s.logo} resizeMode="contain"/> : logoUrl ? <Image source={{uri:logoUrl}} style={s.logo} resizeMode="contain"/> : <View style={s.fallback}><Text style={s.fallbackText}>م</Text></View>}
          <Text style={s.previewName}>{name || "اسم الشركة"}</Text>
          <Text style={s.muted}>{welcome}</Text>
        </View>
        <Text style={s.label}>اسم الشركة</Text>
        <TextInput value={name} onChangeText={setName} maxLength={80} placeholder="اسم الشركة" placeholderTextColor={palette.muted} style={s.input} textAlign="right"/>
        <Text style={s.label}>شعار الشركة</Text>
        <TouchableOpacity onPress={()=>void chooseLogo()} style={s.pickButton}><Text style={s.pickText}>{logoAsset ? "اختيار صورة أخرى" : logoUrl ? "تغيير صورة الشعار" : "اختيار صورة الشعار"}</Text></TouchableOpacity>
        {!!logoAsset && <Text style={s.muted}>الصورة الجديدة محددة وجاهزة للحفظ.</Text>}
        <Text style={s.label}>رسالة الترحيب</Text>
        <TextInput value={welcome} onChangeText={setWelcome} maxLength={180} multiline placeholder="مشوارك وخدمات بيتك، بمكان واحد." placeholderTextColor={palette.muted} style={[s.input,{minHeight:92,textAlignVertical:"top"}]} textAlign="right"/>
        <TouchableOpacity disabled={saving} onPress={()=>void save()} style={[s.saveButton,saving&&{opacity:0.6}]}><Text style={s.saveText}>{saving?"جاري الحفظ...":"حفظ بيانات الشركة"}</Text></TouchableOpacity>
      </View>
    </ScrollView>
  </View>;
}

const s=StyleSheet.create({
  page:{flex:1,backgroundColor:palette.pageCanvas},content:{padding:space.lg,paddingBottom:40},
  center:{flex:1,alignItems:"center",justifyContent:"center",gap:10,backgroundColor:palette.pageCanvas},
  card:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:16,gap:11},
  title:{color:palette.ink,fontSize:20,fontWeight:"900",textAlign:"right"},label:{color:palette.ink,fontSize:12,fontWeight:"900",textAlign:"right"},
  muted:{color:palette.muted,fontSize:11,lineHeight:19,textAlign:"right"},
  preview:{alignItems:"center",backgroundColor:palette.canvas,borderRadius:radius.md,padding:16,gap:7},
  logo:{width:96,height:96,borderRadius:22,backgroundColor:"#fff"},fallback:{width:96,height:96,borderRadius:22,backgroundColor:palette.brand,alignItems:"center",justifyContent:"center"},
  fallbackText:{color:palette.white,fontSize:48,fontWeight:"900"},previewName:{color:palette.ink,fontSize:20,fontWeight:"900"},
  input:{minHeight:48,borderWidth:1,borderColor:palette.line,borderRadius:radius.md,paddingHorizontal:13,paddingVertical:10,color:palette.ink,backgroundColor:palette.canvas,fontSize:13},
  pickButton:{minHeight:46,backgroundColor:palette.brandSoft,borderRadius:radius.md,alignItems:"center",justifyContent:"center",padding:12,borderWidth:1,borderColor:palette.brand},
  pickText:{color:palette.brand,fontWeight:"900",fontSize:13},
  saveButton:{minHeight:48,backgroundColor:palette.brand,borderRadius:radius.md,alignItems:"center",justifyContent:"center",padding:12},
  saveText:{color:palette.white,fontWeight:"900",fontSize:13},
});
