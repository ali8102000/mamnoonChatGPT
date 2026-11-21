import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type BannerCategory = "restaurant" | "hotel" | "store";
type BannerKind = "category" | "poll" | "contest" | "ad" | "top_square";
type MotionAxis = "horizontal" | "vertical";
type MotionDirection = "left" | "right" | "up" | "down";
type MotionStyle = "slide" | "fade" | "drop";
type Campaign = { id: string; title: string; campaign_type: "poll" | "contest"; status: string; starts_at: string | null; ends_at: string | null; result_visibility: string; participation_mode?: "options"|"text"|"image"|"both"; rules?: string|null; prize_description?: string|null; app_campaign_options: { id: string; label: string; sort_order: number }[]; app_campaign_option_results: { option_id: string; vote_count: number }[] };
type Banner = {
  id: string;
  image_url: string;
  storage_path: string | null;
  target_category: BannerCategory;
  banner_type: BannerKind;
  target_campaign_id: string | null;
  is_active: boolean;
  scroll_speed: number;
  display_order: number;
  badge_text: string | null;
  banner_title?: string | null;
  banner_description?: string | null;
  motion_axis: MotionAxis;
  motion_direction: MotionDirection;
  motion_style: MotionStyle;
  display_config?: Record<string, any>;
};

type ContestEntry={id:string;campaign_id:string;user_id:string;text_content:string|null;storage_path:string|null;image_url:string|null;status:string;created_at:string};

const CATEGORY_LABELS: Record<BannerCategory, string> = {
  restaurant: "المطاعم",
  hotel: "الفنادق",
  store: "المتاجر",
};

export default function AdminHomeBannersScreen() {
  const { user } = useAuth();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Banner[]>([]);
  const [category, setCategory] = useState<BannerCategory>("restaurant");
  const [bannerType, setBannerType] = useState<BannerKind>("category");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [entries,setEntries]=useState<ContestEntry[]>([]);
  const [editingRules,setEditingRules]=useState<Record<string,string>>({});
  const [editingPrize,setEditingPrize]=useState<Record<string,string>>({});
  const [newCampaignType,setNewCampaignType]=useState<"poll"|"contest">("contest");
  const [newCampaignTitle,setNewCampaignTitle]=useState("");
  const [newCampaignDescription,setNewCampaignDescription]=useState("");
  const [newCampaignMode,setNewCampaignMode]=useState<"options"|"text"|"image"|"both">("both");
  const [newCampaignOptions,setNewCampaignOptions]=useState("");
  const [newCampaignRules,setNewCampaignRules]=useState("");
  const [newCampaignPrize,setNewCampaignPrize]=useState("");
  const [campaignId, setCampaignId] = useState("");
  const [speed, setSpeed] = useState("5");
  const [order, setOrder] = useState("0");
  const [badge, setBadge] = useState("");
  const [bannerTitle, setBannerTitle] = useState("");
  const [bannerDescription, setBannerDescription] = useState("");
  const [motionAxis, setMotionAxis] = useState<MotionAxis>("horizontal");
  const [motionDirection, setMotionDirection] = useState<MotionDirection>("left");
  const [motionStyle, setMotionStyle] = useState<MotionStyle>("slide");
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    const { data: allowed, error: permissionError } = await supabase.rpc("is_super_admin", {
      p_user_id: user.id,
    });
    if (permissionError || allowed !== true) {
      setAuthorized(false);
      setRows([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setAuthorized(true);
    const { data, error } = await (supabase as any)
      .from("home_carousel_banners")
      .select("id,image_url,storage_path,target_category,banner_type,target_campaign_id,is_active,scroll_speed,display_order,badge_text,banner_title,banner_description,motion_axis,motion_direction,motion_style,display_config")
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      setMessage("تعذر تحميل البانرات. تحقق من الاتصال ثم أعد المحاولة.");
    } else {
      setRows((data ?? []).filter((row: Banner) => row.banner_type !== "top_square") as Banner[]);
      setMessage("");
    }
    const { data: campaignRows } = await (supabase as any).from("app_campaigns").select("id,title,campaign_type,status,starts_at,ends_at,result_visibility,participation_mode,rules,prize_description,app_campaign_options(id,label,sort_order),app_campaign_option_results(option_id,vote_count)").order("sort_order").order("created_at",{ascending:false});
    setCampaigns((campaignRows ?? []) as Campaign[]);
    const {data:entryRows,error:entryError}=await (supabase as any).from("app_campaign_entries").select("id,campaign_id,user_id,text_content,storage_path,status,created_at").order("created_at",{ascending:false});
    if(!entryError){const withImages=await Promise.all((entryRows??[]).map(async(entry:any)=>{let image_url:string|null=null;if(entry.storage_path){const signed=await supabase.storage.from("campaign-entries").createSignedUrl(entry.storage_path,3600);image_url=signed.data?.signedUrl??null;}return {...entry,image_url};}));setEntries(withImages as ContestEntry[]);}
    setLoading(false);
    setRefreshing(false);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (authorized !== true) return;
    const channel = supabase
      .channel("admin-home-banners-mobile")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "home_carousel_banners" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [authorized, load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
  };

  const chooseImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      setAsset(result.assets[0]);
      setMessage("");
    }
  };

  const publish = async () => {
    if ((bannerType === "poll" || bannerType === "contest") && !campaignId) {
      Alert.alert("الحملة مطلوبة", "اختار الاستطلاع أو المسابقة المرتبطة بالبانر.");
      return;
    }
    if ((bannerType === "poll" || bannerType === "contest") && !campaigns.some((item) => item.id === campaignId && item.campaign_type === bannerType)) {
      Alert.alert("اختيار غير صحيح", "نوع الحملة لا يطابق نوع البانر.");
      return;
    }
    if (!asset) {
      Alert.alert("الصورة مطلوبة", "اختار صورة البانر أولاً.");
      return;
    }
    if (!asset.mimeType?.startsWith("image/") || (asset.fileSize != null && asset.fileSize > 8 * 1024 * 1024)) {
      Alert.alert("الصورة غير مناسبة", "اختار ملف صورة حجمه 8 ميغابايت أو أقل.");
      return;
    }
    const numericSpeed = Math.max(1, Math.min(60, Number(speed) || 5));
    const numericOrder = Number.isFinite(Number(order)) ? Number(order) : 0;
    setBusy(true);
    setMessage("");
    const extension = (asset.fileName?.split(".").pop() || "jpg")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `home-banners/${category}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    let uploaded = false;
    try {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error("image_read_failed");
      const bytes = await response.arrayBuffer();
      const contentType = asset.mimeType || (extension === "jpg" ? "image/jpeg" : `image/${extension}`);
      const { error: uploadError } = await supabase.storage
        .from("app-visuals")
        .upload(path, bytes, { upsert: false, contentType });
      if (uploadError) throw new Error("image_upload_failed");
      uploaded = true;
      const { data: publicData } = supabase.storage.from("app-visuals").getPublicUrl(path);
      const { error: insertError } = await (supabase as any)
        .from("home_carousel_banners")
        .insert({
          image_url: publicData.publicUrl,
          storage_path: path,
          target_category: category,
          banner_type: bannerType,
          target_campaign_id: bannerType === "poll" || bannerType === "contest" ? campaignId : null,
          is_active: true,
          scroll_speed: numericSpeed,
          display_order: numericOrder,
          badge_text: badge.trim() || null,
          banner_title: bannerTitle.trim() || null,
          banner_description: bannerDescription.trim() || null,
          motion_axis: bannerType === "top_square" ? "horizontal" : motionAxis,
          motion_direction: bannerType === "top_square" ? "left" : motionDirection,
          motion_style: bannerType === "top_square" ? "slide" : motionStyle,
        });
      if (insertError) {
        await supabase.storage.from("app-visuals").remove([path]);
        uploaded = false;
        throw new Error("banner_save_failed");
      }
      let campaignImageWarning = false;
      if ((bannerType === "poll" || bannerType === "contest") && campaignId) {
        const { error: campaignImageError } = await (supabase as any).from("app_campaigns").update({ image_url: publicData.publicUrl, updated_at: new Date().toISOString() }).eq("id", campaignId);
        campaignImageWarning = Boolean(campaignImageError);
      }
      setAsset(null);
      setBadge("");
      setBannerTitle("");
      setBannerDescription("");
      await load();
      setMessage(campaignImageWarning ? "تم نشر البانر، لكن تعذر تحديث صورة الحملة نفسها." : "تم نشر البانر وصورة الحملة، وسيظهر في الويب والأندرويد.");
    } catch {
      if (uploaded) {
        await supabase.storage.from("app-visuals").remove([path]);
      }
      Alert.alert("تعذر النشر", "ما اكتمل رفع البانر. تحقق من صلاحية الإدارة والاتصال ثم حاول مرة ثانية.");
    } finally {
      setBusy(false);
    }
  };

  const createCampaign = async () => {
    const title=newCampaignTitle.trim();
    const options=newCampaignOptions.split(String.fromCharCode(10)).map(value=>value.trim()).filter(Boolean);
    const mode=newCampaignType==="poll"?"options":newCampaignMode;
    if(!title){Alert.alert("العنوان مطلوب","اكتب عنوان الحملة أولاً.");return;}
    if(mode==="options"&&options.length<2){Alert.alert("الخيارات مطلوبة","أضف خيارين على الأقل.");return;}
    setBusy(true);
    const {data,error}=await (supabase as any).from("app_campaigns").insert({campaign_type:newCampaignType,title,description:newCampaignDescription.trim()||null,status:"draft",participation_mode:mode,rules:newCampaignRules.trim()||null,prize_description:newCampaignType==="contest"?(newCampaignPrize.trim()||null):null,created_by:user?.id??null}).select("id").single();
    if(error||!data){Alert.alert("تعذر الإنشاء",error?.message??"حاول مرة ثانية.");setBusy(false);return;}
    if(options.length&&mode==="options"){
      const {error:optionsError}=await (supabase as any).from("app_campaign_options").insert(options.map((label,index)=>({campaign_id:data.id,label,sort_order:index})));
      if(optionsError){await (supabase as any).from("app_campaigns").delete().eq("id",data.id);Alert.alert("تعذر حفظ الخيارات",optionsError.message);setBusy(false);return;}
    }
    setNewCampaignTitle("");setNewCampaignDescription("");setNewCampaignOptions("");setNewCampaignRules("");setNewCampaignPrize("");
    await load();setMessage("تم إنشاء الحملة كمسودة. راجعها ثم انشرها.");setBusy(false);
  };

  const updateCampaign = async (campaign:Campaign,patch:Record<string,unknown>) => {
    setBusy(true);const {error}=await (supabase as any).from("app_campaigns").update({...patch,updated_at:new Date().toISOString()}).eq("id",campaign.id);
    if(error)Alert.alert("تعذر الحفظ","لم نتمكن من حفظ إعدادات المسابقة.");else{setMessage("تم حفظ إعدادات الحملة.");await load();}setBusy(false);
  };
  const reviewEntry = async(entry:ContestEntry,status:"approved"|"rejected")=>{
    setBusy(true);const {error}=await (supabase as any).from("app_campaign_entries").update({status,reviewed_at:new Date().toISOString()}).eq("id",entry.id);
    if(error)Alert.alert("تعذر تحديث المشاركة","تحقق من الصلاحيات والاتصال.");else{setMessage(status==="approved"?"تم قبول المشاركة.":"تم رفض المشاركة.");await load();}setBusy(false);
  };

  const toggleCampaignStatus = async (campaign: Campaign) => {
    setBusy(true);
    const nextStatus = campaign.status === "published" ? "draft" : "published";
    const { error } = await (supabase as any).from("app_campaigns").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", campaign.id);
    if (error) Alert.alert("تعذر تحديث الحملة", "تحقق من الصلاحيات والاتصال ثم حاول مرة ثانية.");
    else { setMessage(nextStatus === "published" ? "تم نشر الحملة." : "تم إيقاف نشر الحملة."); await load(); }
    setBusy(false);
  };

  const toggleBanner = async (banner: Banner) => {
    setBusy(true);
    const { error } = await (supabase as any)
      .from("home_carousel_banners")
      .update({ is_active: !banner.is_active, updated_at: new Date().toISOString() })
      .eq("id", banner.id);
    if (error) {
      Alert.alert("تعذر تحديث البانر", "تحقق من صلاحيتك واتصالك ثم حاول مرة ثانية.");
    } else {
      await load();
      setMessage(banner.is_active ? "تم إيقاف البانر." : "تم تفعيل البانر.");
    }
    setBusy(false);
  };

  const replaceBannerImage = async (banner: Banner) => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (!asset.mimeType?.startsWith("image/") || (asset.fileSize ?? 0) > 8 * 1024 * 1024) {
      Alert.alert("صورة غير مناسبة", "اختار صورة أقل من 8 ميغابايت."); return;
    }
    setBusy(true);
    try {
      const response = await fetch(asset.uri);
      const bytes = await response.arrayBuffer();
      const extension = (asset.fileName?.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "");
      const path = `home-banners/${banner.target_category}/${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("app-visuals").upload(path, bytes, { upsert: false, contentType: asset.mimeType });
      if (uploadError) throw uploadError;
      const url = supabase.storage.from("app-visuals").getPublicUrl(path).data.publicUrl;
      const { error } = await (supabase as any).from("home_carousel_banners").update({ image_url: url, storage_path: path, updated_at: new Date().toISOString() }).eq("id", banner.id);
      if (error) {
        await supabase.storage.from("app-visuals").remove([path]);
        throw error;
      }
      if (banner.storage_path) await supabase.storage.from("app-visuals").remove([banner.storage_path]);
      await load();
      setMessage("تم تبديل صورة البانر.");
    } catch (error) {
      Alert.alert("تعذر تبديل الصورة", error instanceof Error ? error.message : "حاول مرة ثانية.");
    } finally { setBusy(false); }
  };

  const updateBannerSettings = async (banner: Banner, patch: Record<string, unknown>) => {
    setBusy(true);
    const { error } = await (supabase as any).from("home_carousel_banners")
      .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", banner.id);
    if (error) Alert.alert("تعذر حفظ البانر", error.message);
    else { setMessage("تم حفظ إعدادات البانر."); await load(); }
    setBusy(false);
  };

  const deleteBanner = (banner: Banner) => {
    Alert.alert("حذف البانر", "سيتم حذف سجل البانر وصورته من التخزين. هل تريد المتابعة؟", [
      { text: "إلغاء", style: "cancel" },
      {
        text: "حذف",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            const { error } = await (supabase as any)
              .from("home_carousel_banners")
              .delete()
              .eq("id", banner.id);
            if (error) {
              Alert.alert("تعذر الحذف", "لم يتم حذف البانر. تحقق من الصلاحيات وحاول مرة ثانية.");
            } else {
              let storageFailed = false;
              if (banner.storage_path) {
                const { error: storageError } = await supabase.storage
                  .from("app-visuals")
                  .remove([banner.storage_path]);
                storageFailed = Boolean(storageError);
              }
              await load();
              setMessage(storageFailed
                ? "حُذف البانر من القائمة، لكن تعذر حذف ملف الصورة من التخزين."
                : "تم حذف البانر وصورته.");
            }
            setBusy(false);
          })();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={palette.brand} />
      </View>
    );
  }

  if (authorized !== true) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>غير مصرّح</Text>
        <Text style={styles.muted}>إدارة البانرات متاحة للمدير الأعلى فقط.</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: "بانرات الصفحة الرئيسية" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <Text style={styles.title}>بانرات المطاعم والفنادق والمتاجر</Text>
        <Text style={styles.muted}>
          بانور واحد كبير للفنادق والمطاعم والمتاجر يعرض الصور بالتتابع. تحكم بمدة كل صورة واتجاه الحركة ونمط الانتقال. والمستطيل العلوي «مجاناً بلا عمولة» مخصص للإعلانات والاستطلاعات والمسابقات؛ التغييرات تتزامن بين الويب والأندرويد.
        </Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>إضافة بانر جديد</Text>
          <Text style={styles.label}>نوع البانر</Text>
          <View style={styles.categoryRow}>
            {([{key:"category",label:"مطاعم وفنادق"},{key:"poll",label:"استطلاع"},{key:"contest",label:"مسابقة"},{key:"ad",label:"الإعلان العلوي"},] as {key:BannerKind;label:string}[]).map((item) => (
              <TouchableOpacity key={item.key} onPress={() => {setBannerType(item.key);setCampaignId("");}} style={[styles.categoryButton,bannerType===item.key&&styles.categorySelected]}>
                <Text style={[styles.categoryText,bannerType===item.key&&styles.categoryTextSelected]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {bannerType === "category" ? <><Text style={styles.label}>القسم</Text>
          <View style={styles.categoryRow}>
            {(["restaurant", "hotel", "store"] as BannerCategory[]).map((value) => (
              <TouchableOpacity
                key={value}
                onPress={() => setCategory(value)}
                style={[styles.categoryButton, category === value && styles.categorySelected]}
              >
                <Text style={[styles.categoryText, category === value && styles.categoryTextSelected]}>
                  {CATEGORY_LABELS[value]}
                </Text>
              </TouchableOpacity>
            ))}
          </View></> : null}
          {(bannerType === "poll" || bannerType === "contest") ? <>
            <Text style={styles.label}>الحملة المرتبطة</Text>
            <View style={{gap:7}}>
              {campaigns.filter((item)=>item.campaign_type===bannerType && item.status==="published").map((item)=><TouchableOpacity key={item.id} onPress={()=>setCampaignId(item.id)} style={[styles.categoryButton,campaignId===item.id&&styles.categorySelected]}><Text style={[styles.categoryText,campaignId===item.id&&styles.categoryTextSelected]}>{item.title}</Text></TouchableOpacity>)}
              {!campaigns.some((item)=>item.campaign_type===bannerType) ? <Text style={styles.muted}>ماكو {bannerType==="poll"?"استطلاع":"مسابقة"} منشورة حالياً. انشرها أولاً من إدارة الحملات.</Text> : null}
            </View>
          </> : null}
          {bannerType === "ad" ? <><Text style={styles.muted}>هذا هو المستطيل العلوي الرئيسي «مجاناً بلا عمولة».</Text><Text style={styles.label}>عنوان الإعلان</Text><TextInput value={bannerTitle} onChangeText={setBannerTitle} style={styles.input} textAlign="right" placeholder="عنوان البانر الرئيسي" maxLength={100}/><Text style={styles.label}>وصف الإعلان</Text><TextInput value={bannerDescription} onChangeText={setBannerDescription} style={styles.input} textAlign="right" placeholder="تفاصيل مختصرة تظهر أسفل العنوان" maxLength={240}/></> : null}
          <View style={styles.fieldsRow}>
            <View style={styles.field}>
              <Text style={styles.label}>مدة عرض الصورة (1–60 ثانية)</Text>
              <TextInput
                value={speed}
                onChangeText={setSpeed}
                keyboardType="numeric"
                style={styles.input}
                textAlign="right"
                maxLength={2}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>ترتيب العرض</Text>
              <TextInput
                value={order}
                onChangeText={setOrder}
                keyboardType="numeric"
                style={styles.input}
                textAlign="right"
                maxLength={5}
              />
            </View>
          </View>
          <Text style={styles.label}>اتجاه حركة الصور</Text>
          <View style={styles.categoryRow}>
            {([{key:"horizontal",label:"أفقي"},{key:"vertical",label:"عمودي"}] as {key:MotionAxis;label:string}[]).map((item)=><TouchableOpacity key={item.key} onPress={()=>{setMotionAxis(item.key);setMotionDirection(item.key==="horizontal"?"left":"up");}} style={[styles.categoryButton,motionAxis===item.key&&styles.categorySelected]}><Text style={[styles.categoryText,motionAxis===item.key&&styles.categoryTextSelected]}>{item.label}</Text></TouchableOpacity>)}
          </View>
          <View style={styles.categoryRow}>
            {((motionAxis==="horizontal"?[{key:"left",label:"من اليمين لليسار"},{key:"right",label:"من اليسار لليمين"}]:[{key:"up",label:"من الأسفل للأعلى"},{key:"down",label:"من الأعلى للأسفل"}]) as {key:MotionDirection;label:string}[]).map((item)=><TouchableOpacity key={item.key} onPress={()=>setMotionDirection(item.key)} style={[styles.categoryButton,motionDirection===item.key&&styles.categorySelected]}><Text style={[styles.categoryText,motionDirection===item.key&&styles.categoryTextSelected]}>{item.label}</Text></TouchableOpacity>)}
          </View>
          <Text style={styles.label}>أسلوب الانتقال</Text>
          <View style={styles.categoryRow}>
            {([{key:"slide",label:"انزلاق"},{key:"fade",label:"تلاشي"},{key:"drop",label:"إسقاط"}] as {key:MotionStyle;label:string}[]).map((item)=><TouchableOpacity key={item.key} onPress={()=>setMotionStyle(item.key)} style={[styles.categoryButton,motionStyle===item.key&&styles.categorySelected]}><Text style={[styles.categoryText,motionStyle===item.key&&styles.categoryTextSelected]}>{item.label}</Text></TouchableOpacity>)}
          </View>
          <Text style={styles.label}>شارة اختيارية</Text>
          <TextInput
            value={badge}
            onChangeText={setBadge}
            style={styles.input}
            textAlign="right"
            placeholder="مثلاً: قريباً"
            placeholderTextColor={palette.muted}
            maxLength={32}
          />
          <TouchableOpacity style={styles.secondaryButton} onPress={() => void chooseImage()} disabled={busy}>
            <Text style={styles.secondaryButtonText}>
              {asset ? "تغيير الصورة المختارة" : "اختيار صورة من الجهاز"}
            </Text>
          </TouchableOpacity>
          {asset ? (
            <View style={styles.preview}>
              <Image source={{ uri: asset.uri }} style={styles.previewImage} />
              <Text numberOfLines={2} style={styles.muted}>{asset.fileName || "الصورة المختارة"}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={[styles.primaryButton, (!asset || busy) && styles.disabled]}
            onPress={() => void publish()}
            disabled={!asset || busy}
          >
            <Text style={styles.primaryButtonText}>{busy ? "جارٍ التنفيذ..." : "رفع ونشر البانر"}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>البانرات المضافة ({rows.length})</Text>
          <TouchableOpacity onPress={() => void refresh()} disabled={refreshing || busy}>
            <Text style={styles.link}>تحديث</Text>
          </TouchableOpacity>
        </View>
        {!rows.length ? (
          <Text style={styles.empty}>ماكو صور مرفوعة حالياً. مكان البانر يبقى فارغاً للمستخدمين.</Text>
        ) : rows.map((banner) => (
          <View key={banner.id + "-container"} style={{ width: "100%" }}>
          <View key={banner.id} style={styles.bannerCard}>
            <Image source={{ uri: banner.image_url }} style={styles.bannerImage} />
            <View style={styles.bannerDetails}>
              <Text style={styles.bannerTitle}>{banner.banner_type === "poll" ? "استطلاع رأي" : banner.banner_type === "contest" ? "مسابقة" : banner.banner_type === "ad" ? "الإعلان العلوي الرئيسي" : banner.banner_type === "top_square" ? "البانر المربع أعلى الصفحة" : CATEGORY_LABELS[banner.target_category]}</Text>
              <Text style={styles.muted}>الترتيب {banner.display_order} · كل {banner.scroll_speed} ثوانٍ · {banner.motion_direction} · {banner.motion_style}</Text>
              <Text style={[styles.status, banner.is_active ? styles.active : styles.inactive]}>
                {banner.is_active ? "منشور" : "متوقف"}
              </Text>
              {banner.banner_title ? <Text style={styles.muted}>العنوان: {banner.banner_title}</Text> : null}{banner.banner_description ? <Text style={styles.muted}>الوصف: {banner.banner_description}</Text> : null}{banner.badge_text ? <Text style={styles.muted}>الشارة: {banner.badge_text}</Text> : null}
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setEditingBannerId(editingBannerId === banner.id ? null : banner.id)} disabled={busy}>
                <Text style={styles.secondaryButtonText}>{editingBannerId === banner.id ? "إغلاق" : "تعديل"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => void replaceBannerImage(banner)} disabled={busy}>
                <Text style={styles.secondaryButtonText}>تبديل الصورة</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => void toggleBanner(banner)} disabled={busy}>
                <Text style={styles.secondaryButtonText}>{banner.is_active ? "إيقاف" : "تفعيل"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteButton} onPress={() => deleteBanner(banner)} disabled={busy}>
                <Text style={styles.deleteButtonText}>حذف</Text>
              </TouchableOpacity>
            </View>
          </View>
          {editingBannerId === banner.id ? (
            <View style={[styles.card, { marginTop: 8, width: "100%" }]}>
              <Text style={styles.sectionTitle}>تعديل إعدادات هذا البانر</Text>
              <Text style={styles.label}>العنوان</Text>
              <TextInput defaultValue={banner.banner_title ?? ""} style={styles.input} textAlign="right" onEndEditing={({nativeEvent})=>void updateBannerSettings(banner,{banner_title:nativeEvent.text.trim()||null})}/>
              <Text style={styles.label}>الوصف</Text>
              <TextInput defaultValue={banner.banner_description ?? ""} style={styles.input} textAlign="right" onEndEditing={({nativeEvent})=>void updateBannerSettings(banner,{banner_description:nativeEvent.text.trim()||null})}/>
              <Text style={styles.label}>الشارة</Text>
              <TextInput defaultValue={banner.badge_text ?? ""} style={styles.input} textAlign="right" onEndEditing={({nativeEvent})=>void updateBannerSettings(banner,{badge_text:nativeEvent.text.trim()||null})}/>
              <View style={styles.fieldsRow}>
                <View style={styles.field}><Text style={styles.label}>مدة العرض (ثوانٍ)</Text><TextInput defaultValue={String(banner.scroll_speed)} keyboardType="number-pad" style={styles.input} onEndEditing={({nativeEvent})=>void updateBannerSettings(banner,{scroll_speed:Math.max(1,Math.min(60,Number(nativeEvent.text)||5))})}/></View>
                <View style={styles.field}><Text style={styles.label}>ترتيب العرض</Text><TextInput defaultValue={String(banner.display_order)} keyboardType="number-pad" style={styles.input} onEndEditing={({nativeEvent})=>void updateBannerSettings(banner,{display_order:Number(nativeEvent.text)||0})}/></View>
              </View>
              <Text style={styles.label}>اتجاه الحركة</Text>
              <View style={styles.categoryRow}>{([{value:"left",label:"يمين ← يسار"},{value:"right",label:"يسار ← يمين"},{value:"up",label:"أسفل ← أعلى"},{value:"down",label:"أعلى ← أسفل"}] as const).map(item=><TouchableOpacity key={item.value} onPress={()=>void updateBannerSettings(banner,{motion_direction:item.value,motion_axis:item.value==="up"||item.value==="down"?"vertical":"horizontal"})} style={[styles.categoryButton,banner.motion_direction===item.value&&styles.categorySelected]}><Text style={[styles.categoryText,banner.motion_direction===item.value&&styles.categoryTextSelected]}>{item.label}</Text></TouchableOpacity>)}</View>
              <Text style={styles.label}>نمط الانتقال</Text>
              <View style={styles.categoryRow}>{([{value:"slide",label:"انزلاق"},{value:"fade",label:"تلاشي"},{value:"drop",label:"هبوط"}] as const).map(item=><TouchableOpacity key={item.value} onPress={()=>void updateBannerSettings(banner,{motion_style:item.value})} style={[styles.categoryButton,banner.motion_style===item.value&&styles.categorySelected]}><Text style={[styles.categoryText,banner.motion_style===item.value&&styles.categoryTextSelected]}>{item.label}</Text></TouchableOpacity>)}</View>
              {banner.banner_type === "ad" || banner.banner_type === "poll" || banner.banner_type === "contest" ? <>
                <Text style={styles.sectionTitle}>شكل المستطيل العلوي</Text>
                <View style={styles.fieldsRow}>
                  {([{key:"height_px",label:"الارتفاع",fallback:142},{key:"padding_px",label:"الحشوة",fallback:12},{key:"border_radius_px",label:"الاستدارة",fallback:20}] as const).map(field=><View key={field.key} style={styles.field}><Text style={styles.label}>{field.label}</Text><TextInput defaultValue={String(banner.display_config?.[field.key]??field.fallback)} keyboardType="number-pad" style={styles.input} onEndEditing={({nativeEvent})=>void updateBannerSettings(banner,{display_config:{...(banner.display_config??{}),[field.key]:Math.max(8,Math.min(300,Number(nativeEvent.text)||field.fallback))}})}/></View>)}
                </View>
                <View style={styles.fieldsRow}>
                  {([{key:"title_size_px",label:"حجم العنوان",fallback:20},{key:"subtitle_size_px",label:"حجم الوصف",fallback:11}] as const).map(field=><View key={field.key} style={styles.field}><Text style={styles.label}>{field.label}</Text><TextInput defaultValue={String(banner.display_config?.[field.key]??field.fallback)} keyboardType="number-pad" style={styles.input} onEndEditing={({nativeEvent})=>void updateBannerSettings(banner,{display_config:{...(banner.display_config??{}),[field.key]:Math.max(8,Math.min(30,Number(nativeEvent.text)||field.fallback))}})}/></View>)}
                </View>
                <Text style={styles.label}>نص زر الطلب</Text>
                <TextInput defaultValue={banner.display_config?.cta_text??"اطلب الآن"} style={styles.input} textAlign="right" onEndEditing={({nativeEvent})=>void updateBannerSettings(banner,{display_config:{...(banner.display_config??{}),cta_text:nativeEvent.text.trim()||"اطلب الآن"}})}/>
                <Text style={styles.label}>محاذاة النص</Text>
                <View style={styles.categoryRow}>{([{value:"right",label:"يمين"},{value:"center",label:"وسط"},{value:"left",label:"يسار"}] as const).map(item=><TouchableOpacity key={item.value} onPress={()=>void updateBannerSettings(banner,{display_config:{...(banner.display_config??{}),text_alignment:item.value}})} style={[styles.categoryButton,(banner.display_config?.text_alignment??"right")===item.value&&styles.categorySelected]}><Text style={styles.categoryText}>{item.label}</Text></TouchableOpacity>)}</View>
                <TouchableOpacity style={styles.secondaryButton} onPress={()=>void updateBannerSettings(banner,{display_config:{...(banner.display_config??{}),cta_visible:banner.display_config?.cta_visible===false}})}><Text style={styles.secondaryButtonText}>{banner.display_config?.cta_visible===false?"إظهار زر اطلب الآن":"إخفاء زر اطلب الآن"}</Text></TouchableOpacity>
              </> : null}
            </View>
          ) : null}
          </View>
        ))}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>إنشاء استطلاع أو مسابقة جديدة</Text>
          <Text style={styles.label}>نوع الحملة</Text>
          <View style={styles.categoryRow}>{([{value:"contest",label:"مسابقة"},{value:"poll",label:"استطلاع"}] as const).map(item=><TouchableOpacity key={item.value} onPress={()=>setNewCampaignType(item.value)} style={[styles.categoryButton,newCampaignType===item.value&&styles.categorySelected]}><Text style={[styles.categoryText,newCampaignType===item.value&&styles.categoryTextSelected]}>{item.label}</Text></TouchableOpacity>)}</View>
          {newCampaignType==="contest"?<>
            <Text style={styles.label}>طريقة المشاركة</Text>
            <View style={styles.categoryRow}>{([{value:"text",label:"نص"},{value:"image",label:"صورة"},{value:"both",label:"الاثنين"},{value:"options",label:"اختيارات"}] as const).map(item=><TouchableOpacity key={item.value} onPress={()=>setNewCampaignMode(item.value)} style={[styles.categoryButton,newCampaignMode===item.value&&styles.categorySelected]}><Text style={[styles.categoryText,newCampaignMode===item.value&&styles.categoryTextSelected]}>{item.label}</Text></TouchableOpacity>)}</View>
          </>:null}
          <Text style={styles.label}>عنوان الحملة</Text><TextInput value={newCampaignTitle} onChangeText={setNewCampaignTitle} textAlign="right" style={styles.input} placeholder="عنوان المسابقة أو الاستطلاع"/>
          <Text style={styles.label}>الوصف</Text><TextInput value={newCampaignDescription} onChangeText={setNewCampaignDescription} multiline textAlign="right" style={[styles.input,{minHeight:65,textAlignVertical:"top"}]}/>
          {(newCampaignType==="poll"||newCampaignMode==="options")?<><Text style={styles.label}>الخيارات (كل خيار بسطر مستقل)</Text><TextInput value={newCampaignOptions} onChangeText={setNewCampaignOptions} multiline textAlign="right" style={[styles.input,{minHeight:80,textAlignVertical:"top"}]} placeholder="الخيار الأول والخيار الثاني كل واحد بسطر"/></>:null}
          {newCampaignType==="contest"?<>
            <Text style={styles.label}>الشروط والتعليمات</Text><TextInput value={newCampaignRules} onChangeText={setNewCampaignRules} multiline textAlign="right" style={[styles.input,{minHeight:70,textAlignVertical:"top"}]}/>
            <Text style={styles.label}>الجائزة</Text><TextInput value={newCampaignPrize} onChangeText={setNewCampaignPrize} multiline textAlign="right" style={[styles.input,{minHeight:55,textAlignVertical:"top"}]}/>
          </>:null}
          <TouchableOpacity style={styles.primaryButton} onPress={()=>void createCampaign()} disabled={busy}><Text style={styles.primaryButtonText}>{busy?"جارٍ الإنشاء...":"إنشاء كمسودة"}</Text></TouchableOpacity>
        </View>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>إدارة الاستطلاعات والمسابقات والنتائج ({campaigns.length})</Text>
          <TouchableOpacity onPress={() => void refresh()} disabled={refreshing || busy} style={{ alignSelf: "flex-start" }}><Text style={styles.link}>تحديث النتائج</Text></TouchableOpacity>
          {!campaigns.length ? <Text style={styles.empty}>ماكو حملات مسجلة حالياً.</Text> : campaigns.map((campaign) => {
            const results = campaign.app_campaign_option_results || [];
            const total = results.reduce((sum, item) => sum + Number(item.vote_count || 0), 0);
            return <View key={campaign.id} style={{ borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 12, gap: 8 }}>
              <Text style={styles.sectionTitle}>{campaign.campaign_type === "poll" ? "استطلاع رأي" : "مسابقة"} · {campaign.title}</Text>
              <Text style={styles.muted}>المشاركات المسجلة: {total} · الحالة: {campaign.status === "published" ? "منشورة" : campaign.status}</Text>
              {[...(campaign.app_campaign_options || [])].sort((a,b)=>a.sort_order-b.sort_order).map(option => {
                const count = Number(results.find(item => item.option_id === option.id)?.vote_count || 0);
                return <View key={option.id} style={{ flexDirection: "row", justifyContent: "space-between", padding: 9, borderRadius: 9, backgroundColor: palette.pageCanvas }}><Text style={styles.muted}>{option.label}</Text><Text style={{ color: palette.brand, fontWeight: "900" }}>{count}</Text></View>;
              })}
              {campaign.campaign_type==="contest"?<View style={{gap:9,borderTopWidth:1,borderTopColor:palette.line,paddingTop:10}}>
                <Text style={styles.label}>طريقة المشاركة بهذه المسابقة</Text>
                <View style={styles.categoryRow}>{([{value:"text",label:"نص"},{value:"image",label:"صورة"},{value:"both",label:"الاثنين"},{value:"options",label:"اختيارات"}] as const).map(item=><TouchableOpacity key={item.value} onPress={()=>void updateCampaign(campaign,{participation_mode:item.value})} style={[styles.categoryButton,(campaign.participation_mode??"options")===item.value&&styles.categorySelected]}><Text style={[styles.categoryText,(campaign.participation_mode??"options")===item.value&&styles.categoryTextSelected]}>{item.label}</Text></TouchableOpacity>)}</View>
                <Text style={styles.label}>الشروط والتعليمات</Text><TextInput value={editingRules[campaign.id]??campaign.rules??""} onChangeText={v=>setEditingRules(old=>({...old,[campaign.id]:v}))} multiline textAlign="right" style={[styles.input,{minHeight:75,textAlignVertical:"top"}]} placeholder="شروط المشاركة..."/>
                <TouchableOpacity style={styles.secondaryButton} onPress={()=>void updateCampaign(campaign,{rules:(editingRules[campaign.id]??campaign.rules??"").trim()||null})} disabled={busy}><Text style={styles.secondaryButtonText}>حفظ الشروط</Text></TouchableOpacity>
                <Text style={styles.label}>الجائزة</Text><TextInput value={editingPrize[campaign.id]??campaign.prize_description??""} onChangeText={v=>setEditingPrize(old=>({...old,[campaign.id]:v}))} multiline textAlign="right" style={[styles.input,{minHeight:55,textAlignVertical:"top"}]} placeholder="وصف الجائزة..."/>
                <TouchableOpacity style={styles.secondaryButton} onPress={()=>void updateCampaign(campaign,{prize_description:(editingPrize[campaign.id]??campaign.prize_description??"").trim()||null})} disabled={busy}><Text style={styles.secondaryButtonText}>حفظ الجائزة</Text></TouchableOpacity>
                <Text style={styles.label}>مشاركات المتسابقين ({entries.filter(entry=>entry.campaign_id===campaign.id).length})</Text>
                {entries.filter(entry=>entry.campaign_id===campaign.id).map(entry=><View key={entry.id} style={{gap:8,padding:10,borderWidth:1,borderColor:palette.line,borderRadius:radius.md}}>
                  <Text style={styles.muted}>مستخدم {entry.user_id.slice(0,8)}… · {new Date(entry.created_at).toLocaleString("ar-IQ")}</Text>
                  {entry.text_content?<Text style={{color:palette.ink,textAlign:"right"}}>{entry.text_content}</Text>:null}
                  {entry.image_url?<Image source={{uri:entry.image_url}} resizeMode="contain" style={{width:"100%",height:210,borderRadius:radius.md}}/>:null}
                  <Text style={styles.muted}>الحالة: {entry.status==="approved"?"مقبولة":entry.status==="rejected"?"مرفوضة":"قيد المراجعة"}</Text>
                  {entry.status==="pending"?<View style={styles.categoryRow}><TouchableOpacity onPress={()=>void reviewEntry(entry,"approved")} disabled={busy} style={[styles.secondaryButton,{flex:1}]}><Text style={styles.secondaryButtonText}>قبول</Text></TouchableOpacity><TouchableOpacity onPress={()=>void reviewEntry(entry,"rejected")} disabled={busy} style={[styles.deleteButton,{flex:1}]}><Text style={styles.deleteButtonText}>رفض</Text></TouchableOpacity></View>:null}
                </View>)}
              </View>:null}
              <TouchableOpacity onPress={() => void toggleCampaignStatus(campaign)} disabled={busy} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{campaign.status === "published" ? "إيقاف نشر الحملة" : "نشر الحملة"}</Text></TouchableOpacity>
            </View>;
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.pageCanvas },
  content: { padding: space.lg, paddingBottom: 48, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10, backgroundColor: palette.pageCanvas },
  title: { color: palette.ink, fontSize: 20, fontWeight: "900", textAlign: "right" },
  sectionTitle: { color: palette.ink, fontSize: 15, fontWeight: "900", textAlign: "right" },
  muted: { color: palette.muted, fontSize: 11, lineHeight: 18, textAlign: "right" },
  message: { color: palette.brand, fontSize: 12, fontWeight: "800", textAlign: "right", backgroundColor: palette.surface, borderRadius: radius.md, padding: 12 },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 15, gap: 10 },
  label: { color: palette.ink, fontSize: 12, fontWeight: "800", textAlign: "right" },
  categoryRow: { flexDirection: "row", gap: 7 },
  categoryButton: { flex: 1, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, alignItems: "center" },
  categorySelected: { borderColor: palette.brand, backgroundColor: palette.brandSoft },
  categoryText: { color: palette.ink, fontSize: 11, fontWeight: "800" },
  categoryTextSelected: { color: palette.brand },
  fieldsRow: { flexDirection: "row", gap: 10 },
  field: { flex: 1, gap: 7 },
  input: { minHeight: 46, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 12, color: palette.ink, backgroundColor: palette.pageCanvas },
  secondaryButton: { minHeight: 42, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: palette.brand, fontSize: 11, fontWeight: "900" },
  preview: { flexDirection: "row", alignItems: "center", gap: 10 },
  previewImage: { width: 88, height: 64, borderRadius: radius.md },
  primaryButton: { minHeight: 48, backgroundColor: palette.brand, borderRadius: radius.md, alignItems: "center", justifyContent: "center", padding: 12 },
  primaryButtonText: { color: palette.white, fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  link: { color: palette.brand, fontSize: 12, fontWeight: "900" },
  empty: { color: palette.muted, textAlign: "center", padding: 20, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: palette.line, fontSize: 12 },
  bannerCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 10 },
  bannerImage: { width: 76, height: 76, borderRadius: radius.md },
  bannerDetails: { flex: 1, gap: 4, alignItems: "flex-end" },
  bannerTitle: { color: palette.ink, fontSize: 13, fontWeight: "900" },
  status: { fontSize: 10, fontWeight: "900" },
  active: { color: "#15803d" },
  inactive: { color: palette.muted },
  actions: { gap: 7, width: 72 },
  deleteButton: { minHeight: 38, paddingHorizontal: 8, borderRadius: radius.md, backgroundColor: "#fee2e2", alignItems: "center", justifyContent: "center" },
  deleteButtonText: { color: "#991b1b", fontSize: 11, fontWeight: "900" },
});
