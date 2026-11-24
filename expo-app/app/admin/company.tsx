import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import mamnoonLogo from "../../assets/mamnoon-logo.png";
import { Image as ExpoImage } from "expo-image";
import { useCompanyBranding } from "@/lib/company-branding";
import { palette, radius, space } from "@/styles/theme";

export default function CompanySettingsScreen() {
  const { user } = useAuth();
  const branding = useCompanyBranding();
  const [name, setName] = useState("ممنون");
  const [welcome, setWelcome] = useState("مشوارك وخدمات بيتك، بمكان واحد.");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoAsset, setLogoAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [welcomeVisualUrl, setWelcomeVisualUrl] = useState<string | null>(null);
  const [welcomeVisualAsset, setWelcomeVisualAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [welcomeVisualAnimated, setWelcomeVisualAnimated] = useState(false);
  const [welcomeVisualSizePx, setWelcomeVisualSizePx] = useState(180);
  const [removeWelcomeVisual, setRemoveWelcomeVisual] = useState(false);
  const [homeVisualUrl, setHomeVisualUrl] = useState<string | null>(null);
  const [homeVisualAsset, setHomeVisualAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [homeVisualAnimated, setHomeVisualAnimated] = useState(true);
  const [homeVisualEnabled, setHomeVisualEnabled] = useState(true);
  const [homeVisualSizePx, setHomeVisualSizePx] = useState(180);
  const [homeVisualWidthPx, setHomeVisualWidthPx] = useState(320);
  const [homeVisualHeightPx, setHomeVisualHeightPx] = useState(180);
  const [homeVisualPosition, setHomeVisualPosition] = useState("below_banner");
  const [homeVisualLinkUrl, setHomeVisualLinkUrl] = useState("");
  const [removeHomeVisual, setRemoveHomeVisual] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!user?.id) { if (active) setLoading(false); return; }
      try {
        const [{ data: owner, error: permissionError }, { data, error }] = await Promise.all([
          supabase.rpc("is_super_admin", { p_user_id: user.id }),
          (supabase as any).from("company_settings").select("company_name,company_logo_url,welcome_message,company_welcome_visual_url,company_welcome_visual_animated,company_welcome_visual_size_px,home_visual_url,home_visual_animated,home_visual_enabled,home_visual_size_px").eq("id",1).maybeSingle(),
        ]);
        if (!active) return;
        setAllowed(!permissionError && owner === true);
        if (error) Alert.alert("تعذر تحميل بيانات الشركة", error.message);
        setName(data?.company_name || branding.companyName);
        setLogoUrl(data?.company_logo_url || branding.logoUrl);
        setWelcome(data?.welcome_message || branding.welcomeMessage);
        setWelcomeVisualUrl(data?.company_welcome_visual_url || branding.welcomeVisualUrl);
        setWelcomeVisualAnimated(data?.company_welcome_visual_animated === true);
        setWelcomeVisualSizePx(Number.isInteger(data?.company_welcome_visual_size_px) ? Math.max(80, Math.min(320, data.company_welcome_visual_size_px)) : 180);
        setHomeVisualUrl(data?.home_visual_url || null); setHomeVisualAnimated(data?.home_visual_animated !== false); setHomeVisualEnabled(data?.home_visual_enabled !== false); setHomeVisualSizePx(Number.isInteger(data?.home_visual_size_px) ? Math.max(80, Math.min(320, data.home_visual_size_px)) : 180); setHomeVisualWidthPx(Number.isInteger(data?.home_visual_width_px) ? Math.max(80, Math.min(600, data.home_visual_width_px)) : 320); setHomeVisualHeightPx(Number.isInteger(data?.home_visual_height_px) ? Math.max(80, Math.min(600, data.home_visual_height_px)) : 180); setHomeVisualPosition(["above_banner","below_banner","below_custom_content"].includes(data?.home_visual_position) ? data.home_visual_position : "below_banner"); setHomeVisualLinkUrl(data?.home_visual_link_url ?? "");
      } catch (error: any) {
        if (active) Alert.alert("تعذر تحميل بيانات الشركة", error?.message || "تحقق من الاتصال وحاول مرة ثانية.");
      } finally {
        if (active) setLoading(false);
      }
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

  async function chooseWelcomeVisual() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert("إذن الصور مطلوب", "اسمح للتطبيق بالوصول إلى الصور حتى تختار صورة البداية."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 1 });
    if (!result.canceled && result.assets[0]) { setWelcomeVisualAsset(result.assets[0]); setRemoveWelcomeVisual(false); }
  }

  async function chooseHomeVisual() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert("إذن الصور مطلوب", "اسمح للتطبيق بالوصول إلى الصور حتى تختار GIF الصفحة الرئيسية."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 1 });
    if (!result.canceled && result.assets[0]) { setHomeVisualAsset(result.assets[0]); setRemoveHomeVisual(false); }
  }

  async function save() {
    const companyName = name.trim();
    const message = welcome.trim();
    if (companyName.length < 2 || companyName.length > 80) { Alert.alert("تحقق من الاسم", "اسم الشركة يجب أن يكون بين حرفين و80 حرفاً."); return; }
    if (message.length < 2 || message.length > 180) { Alert.alert("تحقق من رسالة الترحيب", "رسالة الترحيب يجب أن تكون بين حرفين و180 حرفاً."); return; }
    if (homeVisualLinkUrl.trim() && !(homeVisualLinkUrl.trim().startsWith("https://") || homeVisualLinkUrl.trim().startsWith("http://"))) { Alert.alert("تحقق من الرابط", "اكتب رابطاً يبدأ بـ https:// أو http://."); return; }
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
      let nextWelcomeVisualUrl = removeWelcomeVisual ? null : welcomeVisualUrl;
      if (welcomeVisualAsset) {
        if (!welcomeVisualAsset.mimeType?.startsWith("image/") || (welcomeVisualAsset.fileSize != null && welcomeVisualAsset.fileSize > 12 * 1024 * 1024)) throw new Error("اختار صورة بداية حجمها 12 ميغابايت أو أقل.");
        const visualResponse = await fetch(welcomeVisualAsset.uri);
        if (!visualResponse.ok) throw new Error("تعذر قراءة صورة البداية المختارة.");
        const visualBytes = await visualResponse.arrayBuffer();
        const visualExt = (welcomeVisualAsset.mimeType?.split("/")[1] || "jpeg").replace(/[^a-z0-9]/gi,"").toLowerCase() || "jpg";
        const visualPath = `company-branding/welcome-${Date.now()}.${visualExt}`;
        const { error: visualUploadError } = await supabase.storage.from("app-visuals").upload(visualPath, visualBytes, { upsert: false, contentType: welcomeVisualAsset.mimeType || "image/jpeg" });
        if (visualUploadError) throw visualUploadError;
        nextWelcomeVisualUrl = supabase.storage.from("app-visuals").getPublicUrl(visualPath).data.publicUrl;
      }
      let nextHomeVisualUrl = removeHomeVisual ? null : homeVisualUrl;
      if (homeVisualAsset) {
        if (!homeVisualAsset.mimeType?.startsWith("image/") || (homeVisualAsset.fileSize != null && homeVisualAsset.fileSize > 12 * 1024 * 1024)) throw new Error("اختار GIF أو صورة للصفحة الرئيسية بحجم 12 ميغابايت أو أقل.");
        const response = await fetch(homeVisualAsset.uri); if (!response.ok) throw new Error("تعذر قراءة صورة الصفحة الرئيسية المختارة.");
        const bytes = await response.arrayBuffer(); const ext = (homeVisualAsset.mimeType?.split("/")[1] || "jpeg").replace(/[^a-z0-9]/gi,"").toLowerCase() || "jpg";
        const path = `company-branding/home-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("app-visuals").upload(path, bytes, { upsert: false, contentType: homeVisualAsset.mimeType || "image/jpeg" }); if (uploadError) throw uploadError;
        nextHomeVisualUrl = supabase.storage.from("app-visuals").getPublicUrl(path).data.publicUrl;
      }
      const { error } = await (supabase as any).from("company_settings").upsert({
        id: 1, company_name: companyName, company_logo_url: nextLogoUrl,
        welcome_message: message, company_welcome_visual_url: nextWelcomeVisualUrl, company_welcome_visual_animated: welcomeVisualAnimated, company_welcome_visual_size_px: welcomeVisualSizePx, home_visual_url: nextHomeVisualUrl, home_visual_animated: homeVisualAnimated, home_visual_enabled: homeVisualEnabled, home_visual_size_px: homeVisualSizePx, home_visual_width_px: homeVisualWidthPx, home_visual_height_px: homeVisualHeightPx, home_visual_position: homeVisualPosition, home_visual_link_url: homeVisualLinkUrl.trim() || null, updated_by: user.id, updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (error) throw error;
      if (welcomeVisualUrl && nextWelcomeVisualUrl !== welcomeVisualUrl) {
        const marker = "/storage/v1/object/public/app-visuals/";
        const storedPath = welcomeVisualUrl.split(marker)[1]?.split("?")[0];
        if (storedPath) await supabase.storage.from("app-visuals").remove([decodeURIComponent(storedPath)]);
      }
      setLogoUrl(nextLogoUrl);
      setLogoAsset(null);
      setWelcomeVisualUrl(nextWelcomeVisualUrl);
      setWelcomeVisualAsset(null);
      if (homeVisualUrl && nextHomeVisualUrl !== homeVisualUrl) { const marker = "/storage/v1/object/public/app-visuals/"; const oldPath = homeVisualUrl.split(marker)[1]?.split("?")[0]; if (oldPath) await supabase.storage.from("app-visuals").remove([decodeURIComponent(oldPath)]); }
      setHomeVisualUrl(nextHomeVisualUrl); setHomeVisualAsset(null); setRemoveHomeVisual(false);
      setRemoveWelcomeVisual(false);
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
        <Text style={s.muted}>الشعار الافتراضي يظهر تلقائياً، ويمكن تغييره من هنا. فعّل الحركة الناعمة لتتحرك هوية الشعار وصورة البداية.</Text>
        <View style={s.preview}>
          {logoAsset ? <Image source={{uri:logoAsset.uri}} style={s.logo} resizeMode="contain"/> : logoUrl ? <Image source={{uri:logoUrl}} style={s.logo} resizeMode="contain"/> : <Image source={mamnoonLogo} style={s.logo} resizeMode="contain"/>}
          <Text style={s.previewName}>{name || "اسم الشركة"}</Text>
          <Text style={s.muted}>{welcome}</Text>
          {(!removeWelcomeVisual && (welcomeVisualAsset?.uri || welcomeVisualUrl)) ? <ExpoImage source={{uri:welcomeVisualAsset?.uri || welcomeVisualUrl || undefined}} style={[s.welcomeVisual,{width:welcomeVisualSizePx,height:welcomeVisualSizePx}]} contentFit="cover" autoplay={true}/> : <View style={[s.welcomeVisualEmpty,{width:welcomeVisualSizePx,height:welcomeVisualSizePx}]}><Text style={s.muted}>بدون صورة بداية</Text></View>}
        </View>
        <Text style={s.label}>اسم الشركة</Text>
        <TextInput value={name} onChangeText={setName} maxLength={80} placeholder="اسم الشركة" placeholderTextColor={palette.muted} style={s.input} textAlign="right"/>
        <Text style={s.label}>شعار الشركة</Text>
        <TouchableOpacity onPress={()=>void chooseLogo()} style={s.pickButton}><Text style={s.pickText}>{logoAsset ? "اختيار صورة أخرى" : logoUrl ? "تغيير صورة الشعار" : "اختيار صورة الشعار"}</Text></TouchableOpacity>
        {!!logoAsset && <Text style={s.muted}>الصورة الجديدة محددة وجاهزة للحفظ.</Text>}
        <Text style={s.label}>صورة شاشة بداية التطبيق (تقبل GIF متحرك)</Text>
        <TouchableOpacity onPress={()=>void chooseWelcomeVisual()} style={s.pickButton}><Text style={s.pickText}>{welcomeVisualAsset ? "اختيار صورة أخرى" : welcomeVisualUrl ? "تبديل صورة البداية" : "اختيار صورة البداية"}</Text></TouchableOpacity>
        {!!welcomeVisualAsset && <><Text style={s.muted}>الصورة الجديدة محددة وجاهزة للحفظ.</Text><TouchableOpacity onPress={()=>setWelcomeVisualAsset(null)} style={s.removeButton}><Text style={s.removeButtonText}>إلغاء الصورة المختارة</Text></TouchableOpacity></>}
        {!!welcomeVisualUrl && !removeWelcomeVisual && <TouchableOpacity onPress={()=>Alert.alert("حذف صورة البداية","راح تنحذف الصورة من شاشة فتح التطبيق بعد الحفظ. متأكد؟",[{text:"إلغاء",style:"cancel"},{text:"حذف",style:"destructive",onPress:()=>{setWelcomeVisualAsset(null);setRemoveWelcomeVisual(true);}}])} style={s.removeButton}><Text style={s.removeButtonText}>حذف صورة البداية</Text></TouchableOpacity>}
        <Text style={s.label}>حجم صورة البداية (80–320 بكسل)</Text>
        <TextInput value={String(welcomeVisualSizePx)} onChangeText={value=>setWelcomeVisualSizePx(Math.max(80,Math.min(320,Math.round(Number(value)||180))))} keyboardType="numeric" style={s.input} textAlign="right" />
        <TouchableOpacity onPress={()=>setWelcomeVisualAnimated(value=>!value)} style={s.animationToggle}><View style={[s.toggleDot,welcomeVisualAnimated&&s.toggleDotOn]}/><Text style={s.pickText}>{welcomeVisualAnimated ? "الحركة التفاعلية مفعّلة" : "تفعيل حركة تفاعلية ناعمة للشعار وصورة البداية"}</Text></TouchableOpacity>
        <Text style={s.label}>GIF الصفحة الرئيسية (مستقل عن صورة البداية)</Text>
        {(!removeHomeVisual && (homeVisualAsset?.uri || homeVisualUrl)) ? <ExpoImage source={{uri:homeVisualAsset?.uri || homeVisualUrl || undefined}} style={[s.welcomeVisual,{width:Math.min(homeVisualWidthPx,300),height:homeVisualHeightPx}]} contentFit="cover" autoplay={homeVisualAnimated}/> : <Text style={s.muted}>ماكو صورة للصفحة الرئيسية حالياً</Text>}
        <TouchableOpacity onPress={()=>void chooseHomeVisual()} style={s.pickButton}><Text style={s.pickText}>{homeVisualAsset ? "اختيار صورة أخرى" : homeVisualUrl ? "تبديل GIF الصفحة الرئيسية" : "اختيار GIF الصفحة الرئيسية"}</Text></TouchableOpacity>
        {!!homeVisualAsset && <TouchableOpacity onPress={()=>setHomeVisualAsset(null)} style={s.removeButton}><Text style={s.removeButtonText}>إلغاء الصورة المختارة</Text></TouchableOpacity>}
        {!!homeVisualUrl && !removeHomeVisual && <TouchableOpacity onPress={()=>Alert.alert("حذف GIF الصفحة الرئيسية","راح تنحذف من الصفحة الرئيسية بعد الحفظ. متأكد؟",[{text:"إلغاء",style:"cancel"},{text:"حذف",style:"destructive",onPress:()=>{setHomeVisualAsset(null);setRemoveHomeVisual(true);}}])} style={s.removeButton}><Text style={s.removeButtonText}>حذف GIF الصفحة الرئيسية</Text></TouchableOpacity>}
        <TouchableOpacity onPress={()=>setHomeVisualEnabled(v=>!v)} style={s.animationToggle}><View style={[s.toggleDot,homeVisualEnabled&&s.toggleDotOn]}/><Text style={s.pickText}>{homeVisualEnabled ? "إظهار GIF الصفحة الرئيسية" : "إخفاء GIF الصفحة الرئيسية"}</Text></TouchableOpacity>
        <TouchableOpacity onPress={()=>setHomeVisualAnimated(v=>!v)} style={s.animationToggle}><View style={[s.toggleDot,homeVisualAnimated&&s.toggleDotOn]}/><Text style={s.pickText}>{homeVisualAnimated ? "حركة GIF مفعّلة" : "حركة GIF متوقفة"}</Text></TouchableOpacity>
        <Text style={s.label}>مكان ظهور صورة الصفحة الرئيسية</Text>
        {([{value:"above_banner",label:"فوق البانر العلوي"},{value:"below_banner",label:"تحت البانر العلوي"},{value:"below_custom_content",label:"بعد محتوى الصفحة وقبل أزرار الطلب"}] as const).map(option=><TouchableOpacity key={option.value} onPress={()=>setHomeVisualPosition(option.value)} style={s.animationToggle}><View style={[s.toggleDot,homeVisualPosition===option.value&&s.toggleDotOn]}/><Text style={s.pickText}>{option.label}</Text></TouchableOpacity>)}
        <Text style={s.label}>عرض الصورة بالبكسل (80–600)</Text><TextInput value={String(homeVisualWidthPx)} onChangeText={value=>setHomeVisualWidthPx(Math.max(80,Math.min(600,Math.round(Number(value)||80))))} keyboardType="numeric" style={s.input} textAlign="right"/>
        <Text style={s.label}>ارتفاع الصورة بالبكسل (80–600)</Text><TextInput value={String(homeVisualHeightPx)} onChangeText={value=>setHomeVisualHeightPx(Math.max(80,Math.min(600,Math.round(Number(value)||80))))} keyboardType="numeric" style={s.input} textAlign="right"/>
        <Text style={s.label}>رابط يفتح عند الضغط على الصورة (اختياري)</Text><TextInput value={homeVisualLinkUrl} onChangeText={setHomeVisualLinkUrl} autoCapitalize="none" keyboardType="url" placeholder="https://example.com" placeholderTextColor={palette.muted} style={s.input} textAlign="left"/>
        <Text style={s.label}>رسالة الترحيب</Text>
        <TextInput value={welcome} onChangeText={setWelcome} maxLength={180} multiline placeholder="مشوارك وخدمات بيتك، بمكان واحد." placeholderTextColor={palette.muted} style={[s.input,{minHeight:120,textAlignVertical:"top",lineHeight:24}]} textAlign="right"/>
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
  animationToggle:{minHeight:48,borderRadius:radius.md,borderWidth:1,borderColor:palette.line,backgroundColor:palette.canvas,flexDirection:"row",alignItems:"center",justifyContent:"flex-end",gap:10,padding:12},toggleDot:{width:18,height:18,borderRadius:9,borderWidth:2,borderColor:palette.muted},toggleDotOn:{backgroundColor:palette.gold,borderColor:palette.gold},
  welcomeVisual:{borderRadius:24,backgroundColor:"#050B13",overflow:"hidden"},welcomeVisualEmpty:{borderRadius:24,backgroundColor:"#EAF0F4",alignItems:"center",justifyContent:"center"},
  removeButton:{minHeight:42,borderRadius:radius.md,borderWidth:1,borderColor:"#D96B6B",backgroundColor:"#FFF3F3",alignItems:"center",justifyContent:"center",padding:10},removeButtonText:{color:"#B42318",fontWeight:"900",fontSize:12},
  input:{minHeight:48,borderWidth:1,borderColor:palette.line,borderRadius:radius.md,paddingHorizontal:13,paddingVertical:10,color:palette.ink,backgroundColor:palette.canvas,fontSize:13},
  pickButton:{minHeight:46,backgroundColor:palette.brandSoft,borderRadius:radius.md,alignItems:"center",justifyContent:"center",padding:12,borderWidth:1,borderColor:palette.brand},
  pickText:{color:palette.brand,fontWeight:"900",fontSize:13},
  saveButton:{minHeight:48,backgroundColor:palette.brand,borderRadius:radius.md,alignItems:"center",justifyContent:"center",padding:12},
  saveText:{color:palette.white,fontWeight:"900",fontSize:13},
});
