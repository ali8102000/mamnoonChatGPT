import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type Option={id:string;label:string;sort_order:number};
type Campaign={id:string;campaign_type:"poll"|"contest";title:string;description:string|null;image_url:string|null;starts_at:string|null;ends_at:string|null;app_campaign_options:Option[]};

export default function CampaignDetailsScreen(){
  const {id}=useLocalSearchParams<{id:string}>();
  const {user}=useAuth();
  const [campaign,setCampaign]=useState<Campaign|null>(null);
  const [selected,setSelected]=useState("");
  const [answer,setAnswer]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    setLoading(true);setError("");
    const {data,error:queryError}=await (supabase as any).from("app_campaigns").select("id,campaign_type,title,description,image_url,starts_at,ends_at,app_campaign_options(id,label,sort_order)").eq("id",id).eq("status","published").maybeSingle();
    if(queryError||!data){setCampaign(null);setError("الحملة غير متاحة حالياً أو انتهى نشرها.");setLoading(false);return;}
    setCampaign(data as Campaign);
    if(user?.id){const {data:own}=await (supabase as any).from("app_campaign_responses").select("option_id").eq("campaign_id",id).eq("user_id",user.id).maybeSingle();setAnswer(own?.option_id??null);}
    setLoading(false);
  },[id,user?.id]);
  useEffect(()=>{void load();},[load]);
  const open=!!campaign&&(!campaign.starts_at||new Date(campaign.starts_at).getTime()<=Date.now())&&(!campaign.ends_at||new Date(campaign.ends_at).getTime()>Date.now());
  const submit=async()=>{if(!campaign||!user?.id||!selected||busy)return;setBusy(true);setError("");const {error:saveError}=await (supabase as any).from("app_campaign_responses").insert({campaign_id:id,option_id:selected,user_id:user.id});if(saveError){setError(saveError.code==="23505"?"سبق وسجلت مشاركتك بهذه الحملة.":"تعذر تسجيل المشاركة. حاول مرة ثانية.");if(saveError.code==="23505")setAnswer(selected);}else setAnswer(selected);setBusy(false);};
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
          <Text style={{color:palette.ink,fontWeight:"900",textAlign:"right"}}>{campaign.campaign_type==="poll"?"اختر إجابتك":"تعليمات المسابقة واختيار المشاركة"}</Text>
          {!open?<Text style={{color:palette.danger,textAlign:"right"}}>المشاركة غير متاحة حالياً.</Text>:null}
          {!user?.id?<TouchableOpacity onPress={()=>router.push("/auth")}><Text style={{color:palette.brand,textAlign:"right",fontWeight:"900"}}>سجّل الدخول حتى تشارك</Text></TouchableOpacity>:null}
          {[...(campaign.app_campaign_options??[])].sort((a,b)=>a.sort_order-b.sort_order).map(option=><TouchableOpacity key={option.id} disabled={!open||!!answer||!user?.id||busy} onPress={()=>setSelected(option.id)} style={{padding:13,borderRadius:radius.md,borderWidth:1,borderColor:selected===option.id?palette.brand:palette.line,backgroundColor:selected===option.id?palette.brandSoft:palette.pageCanvas,opacity:answer?0.7:1}}><Text style={{color:palette.ink,textAlign:"right",fontWeight:"800"}}>{answer===option.id?"✓ ":""}{option.label}</Text></TouchableOpacity>)}
          {answer?<Text style={{color:"#15803d",fontWeight:"900",textAlign:"right"}}>تم تسجيل مشاركتك بنجاح. شكراً إلك.</Text>:<TouchableOpacity disabled={!open||!user?.id||!selected||busy} onPress={()=>void submit()} style={{padding:14,borderRadius:radius.md,backgroundColor:palette.brand,opacity:!open||!user?.id||!selected||busy?0.5:1}}><Text style={{color:palette.white,textAlign:"center",fontWeight:"900"}}>{busy?"جارٍ تسجيل المشاركة...":campaign.campaign_type==="poll"?"إرسال الإجابة":"تأكيد المشاركة"}</Text></TouchableOpacity>}
          {error?<Text style={{color:palette.danger,textAlign:"right"}}>{error}</Text>:null}
        </View>
      </>}
    </ScrollView>
  </View>;
}
