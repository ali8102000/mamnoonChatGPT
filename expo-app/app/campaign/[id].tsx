import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type Option={id:string;label:string;sort_order:number};
type Campaign={id:string;campaign_type:"poll"|"contest";title:string;description:string|null;image_url:string|null;starts_at:string|null;ends_at:string|null;participation_mode?:"options"|"text"|"image"|"both";rules?:string|null;prize_description?:string|null;app_campaign_options:Option[]};
type Entry={id:string;text_content:string|null;storage_path:string|null;status:string;image_url:string|null};

export default function CampaignDetailsScreen(){
  const {id}=useLocalSearchParams<{id:string}>();
  const {user}=useAuth();
  const [campaign,setCampaign]=useState<Campaign|null>(null);
  const [selected,setSelected]=useState("");
  const [answer,setAnswer]=useState<string|null>(null);
  const [entry,setEntry]=useState<Entry|null>(null);
  const [entryText,setEntryText]=useState("");
  const [asset,setAsset]=useState<ImagePicker.ImagePickerAsset|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    setLoading(true);setError("");
    const {data,error:queryError}=await (supabase as any).from("app_campaigns").select("id,campaign_type,title,description,image_url,starts_at,ends_at,participation_mode,rules,prize_description,app_campaign_options(id,label,sort_order)").eq("id",id).eq("status","published").maybeSingle();
    if(queryError||!data){setCampaign(null);setError("الحملة غير متاحة حالياً أو انتهى نشرها.");setLoading(false);return;}
    setCampaign(data as Campaign);
    if(user?.id){
      const [own,ownEntry]=await Promise.all([
        (supabase as any).from("app_campaign_responses").select("option_id").eq("campaign_id",id).eq("user_id",user.id).maybeSingle(),
        (supabase as any).from("app_campaign_entries").select("id,text_content,storage_path,status").eq("campaign_id",id).eq("user_id",user.id).maybeSingle()
      ]);
      setAnswer(own.data?.option_id??null);
      if(ownEntry.data){let imageUrl:string|null=null;if(ownEntry.data.storage_path){const signed=await supabase.storage.from("campaign-entries").createSignedUrl(ownEntry.data.storage_path,3600);imageUrl=signed.data?.signedUrl??null;}setEntry({...ownEntry.data,image_url:imageUrl});}
    }
    setLoading(false);
  },[id,user?.id]);
  useEffect(()=>{void load();},[load]);
  const open=!!campaign&&(!campaign.starts_at||new Date(campaign.starts_at).getTime()<=Date.now())&&(!campaign.ends_at||new Date(campaign.ends_at).getTime()>Date.now());
  const mode=campaign?.participation_mode??"options";
  const entryMode=mode==="text"||mode==="image"||mode==="both";
  const chooseImage=async()=>{
    const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,quality:0.85});
    if(!result.canceled&&result.assets[0]){const picked=result.assets[0];if(picked.fileSize&&picked.fileSize>8*1024*1024){Alert.alert("الصورة كبيرة","اختار صورة حجمها 8 ميغابايت أو أقل.");return;}setAsset(picked);setError("");}
  };
  const submitEntry=async()=>{
    if(!campaign||!user?.id||entry||busy)return;
    const needsText=mode==="text"||mode==="both",needsImage=mode==="image"||mode==="both";
    if(needsText&&!entryText.trim()){setError("اكتب نص مشاركتك أولاً.");return;}
    if(needsImage&&!asset){setError("اختار صورة للمشاركة أولاً.");return;}
    setBusy(true);setError("");let storagePath:string|null=null;
    try{
      if(needsImage&&asset){
        const ext=(asset.fileName?.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"").toLowerCase()||"jpg";
        storagePath=campaign.id+"/"+user.id+"/"+Date.now()+"-"+Math.random().toString(36).slice(2)+"."+ext;
        const response=await fetch(asset.uri);if(!response.ok)throw new Error("image_read_failed");
        const bytes=await response.arrayBuffer();
        const uploaded=await supabase.storage.from("campaign-entries").upload(storagePath,bytes,{upsert:false,contentType:asset.mimeType||"image/jpeg"});
        if(uploaded.error)throw uploaded.error;
      }
      const {data, error:saveError}=await (supabase as any).from("app_campaign_entries").insert({campaign_id:campaign.id,user_id:user.id,text_content:needsText?entryText.trim():null,image_url:storagePath?"private://"+storagePath:null,storage_path:storagePath}).select("id,text_content,storage_path,status").single();
      if(saveError)throw saveError;
      let imageUrl:string|null=null;if(storagePath){const signed=await supabase.storage.from("campaign-entries").createSignedUrl(storagePath,3600);imageUrl=signed.data?.signedUrl??null;}
      setEntry({...data,image_url:imageUrl});setEntryText("");setAsset(null);
      Alert.alert("تم استلام المشاركة","وصلت مشاركتك وهي الآن قيد مراجعة الإدارة.");
    }catch(e:any){if(storagePath)await supabase.storage.from("campaign-entries").remove([storagePath]);setError(e?.code==="23505"?"سبق وقدمت مشاركة بهذه المسابقة.":"تعذر إرسال المشاركة. تحقق من الاتصال وحاول مرة ثانية.");}
    finally{setBusy(false);}
  };
  const submitVote=async()=>{if(!campaign||!user?.id||!selected||busy)return;setBusy(true);setError("");const {error:saveError}=await (supabase as any).from("app_campaign_responses").insert({campaign_id:id,option_id:selected,user_id:user.id});if(saveError){setError(saveError.code==="23505"?"سبق سجلت مشاركتك بهذه الحملة.":"تعذر تسجيل المشاركة. حاول مرة ثانية.");if(saveError.code==="23505")setAnswer(selected);}else setAnswer(selected);setBusy(false);};
  return <View style={{flex:1,backgroundColor:palette.pageCanvas}}>
    <Stack.Screen options={{title:"استطلاع ومسابقات"}}/>
    <ScrollView contentContainerStyle={{padding:space.lg,paddingBottom:40,gap:14}}>
      <TouchableOpacity onPress={()=>router.back()}><Text style={{color:palette.brand,textAlign:"right",fontWeight:"900"}}>→ رجوع</Text></TouchableOpacity>
      {loading?<ActivityIndicator size="large" color={palette.brand}/>:!campaign?<Text style={{color:palette.danger,textAlign:"right"}}>{error||"الحملة غير متاحة."}</Text>:<>
        {campaign.image_url?<Image source={{uri:campaign.image_url}} resizeMode="cover" style={{width:"100%",height:210,borderRadius:radius.lg}}/>:null}
        <View style={{backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.line,padding:space.lg,gap:14}}>
          <Text style={{color:palette.brand,fontWeight:"900",textAlign:"right"}}>{campaign.campaign_type==="poll"?"استطلاع رأي":"مسابقة ممنون"}</Text>
          <Text style={{color:palette.ink,fontSize:21,fontWeight:"900",textAlign:"right"}}>{campaign.title}</Text>
          {campaign.description?<Text style={{color:palette.muted,fontSize:13,lineHeight:23,textAlign:"right"}}>{campaign.description}</Text>:null}
          {campaign.prize_description?<Text style={{color:palette.ink,textAlign:"right",backgroundColor:palette.brandSoft,padding:12,borderRadius:radius.md}}>الجائزة: {campaign.prize_description}</Text>:null}
          {campaign.rules?<Text style={{color:palette.muted,fontSize:12,lineHeight:22,textAlign:"right",backgroundColor:palette.pageCanvas,padding:12,borderRadius:radius.md}}>الشروط والتعليمات:{"\n"}{campaign.rules}</Text>:null}
          {!open?<Text style={{color:palette.danger,textAlign:"right"}}>المشاركة غير متاحة حالياً.</Text>:null}
          {!user?.id?<TouchableOpacity onPress={()=>router.push("/auth")}><Text style={{color:palette.brand,textAlign:"right",fontWeight:"900"}}>سجّل الدخول حتى تشارك</Text></TouchableOpacity>:null}
          {entryMode?<View style={{gap:12}}>
            <Text style={{color:palette.ink,fontWeight:"900",textAlign:"right"}}>شارك بالمسابقة</Text>
            {(mode==="text"||mode==="both")?<TextInput value={entryText} onChangeText={setEntryText} editable={!entry&&!busy&&open} multiline numberOfLines={5} maxLength={3000} placeholder="اكتب مشاركتك هنا..." placeholderTextColor={palette.muted} textAlign="right" style={{minHeight:110,borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:12,color:palette.ink,textAlignVertical:"top"}}/>:null}
            {(mode==="image"||mode==="both")?<TouchableOpacity onPress={()=>void chooseImage()} disabled={!!entry||busy||!open} style={{padding:13,borderRadius:radius.md,borderWidth:1,borderColor:palette.line}}><Text style={{color:palette.brand,textAlign:"right",fontWeight:"900"}}>{asset?.fileName||"اختيار صورة للمشاركة (حتى 8 ميغابايت)"}</Text></TouchableOpacity>:null}
            {entry?<View style={{padding:12,borderRadius:radius.md,borderWidth:1,borderColor:palette.line,gap:8}}><Text style={{color:palette.ink,fontWeight:"900",textAlign:"right"}}>وصلتنا مشاركتك</Text><Text style={{color:palette.muted,textAlign:"right",fontSize:12}}>الحالة: {entry.status==="approved"?"مقبولة":entry.status==="rejected"?"مرفوضة":"قيد المراجعة"}</Text>{entry.text_content?<Text style={{color:palette.ink,textAlign:"right"}}>{entry.text_content}</Text>:null}{entry.image_url?<Image source={{uri:entry.image_url}} resizeMode="contain" style={{width:"100%",height:220,borderRadius:radius.md}}/>:null}</View>:<TouchableOpacity disabled={!open||!user?.id||busy} onPress={()=>void submitEntry()} style={{padding:14,borderRadius:radius.md,backgroundColor:palette.brand,opacity:!open||!user?.id||busy?0.5:1}}><Text style={{color:palette.white,textAlign:"center",fontWeight:"900"}}>{busy?"جارٍ إرسال المشاركة...":"إرسال المشاركة"}</Text></TouchableOpacity>}
          </View>:<>
            <Text style={{color:palette.ink,fontWeight:"900",textAlign:"right"}}>اختر إجابتك</Text>
            {[...(campaign.app_campaign_options??[])].sort((a,b)=>a.sort_order-b.sort_order).map(option=><TouchableOpacity key={option.id} disabled={!open||!!answer||!user?.id||busy} onPress={()=>setSelected(option.id)} style={{padding:13,borderRadius:radius.md,borderWidth:1,borderColor:selected===option.id?palette.brand:palette.line,backgroundColor:selected===option.id?palette.brandSoft:palette.pageCanvas,opacity:answer?0.7:1}}><Text style={{color:palette.ink,textAlign:"right",fontWeight:"800"}}>{answer===option.id?"✓ ":""}{option.label}</Text></TouchableOpacity>)}
            {answer?<Text style={{color:"#15803d",fontWeight:"900",textAlign:"right"}}>تم تسجيل مشاركتك بنجاح. شكراً إلك.</Text>:<TouchableOpacity disabled={!open||!user?.id||!selected||busy} onPress={()=>void submitVote()} style={{padding:14,borderRadius:radius.md,backgroundColor:palette.brand,opacity:!open||!user?.id||!selected||busy?0.5:1}}><Text style={{color:palette.white,textAlign:"center",fontWeight:"900"}}>{busy?"جارٍ تسجيل المشاركة...":"إرسال الإجابة"}</Text></TouchableOpacity>}
          </>}
          {error?<Text style={{color:palette.danger,textAlign:"right"}}>{error}</Text>:null}
        </View>
      </>}
    </ScrollView>
  </View>;
}
