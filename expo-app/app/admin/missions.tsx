import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius } from "@/styles/theme";
import { IRAQ_GOVERNORATES } from "@/lib/governorates";

type ProviderType="driver"|"large_driver"|"worker";
type Reward={participant_id:string;mission_id:string;mission_title:string;provider_id:string;provider_name:string|null;provider_phone:string|null;governorate_key:string|null;provider_type:ProviderType;progress_count:number;target_count:number;reward_amount_iqd:number;eligible_at:string|null;reward_status:string};
type Mission={mission_id:string;title:string;provider_type:ProviderType;service_slug:string|null;target_governorates:string[];location_scope:string;target_count:number;reward_amount_iqd:number;ends_at:string;status:string;participant_count:number;eligible_count:number;approved_count:number;rejected_count:number};
type Detail={request_id:string;request_type:string;request_created_at:string;request_completed_at:string;duration_minutes:number|null;customer_name:string|null;customer_phone:string|null;origin_governorate:string|null;destination_governorate:string|null;pickup_text:string|null;dest_text:string|null};
const TYPES:{value:ProviderType;label:string}[]=[{value:"driver",label:"كباتن التكسي"},{value:"large_driver",label:"السيارات الكبيرة"},{value:"worker",label:"الفنيون"}];
const money=(n:number)=>new Intl.NumberFormat("ar-IQ").format(Number(n)||0)+" د.ع";
const govName=(key:string|null)=>IRAQ_GOVERNORATES.find(g=>g.key===key)?.name??key??"—";
const date=(v:string|null)=>v?new Date(v).toLocaleString("ar-IQ"):"—";
export default function AdminMissionsScreen(){
 const {user,loading:authLoading}=useAuth();
 const [allowed,setAllowed]=useState<boolean|null>(null);
 const [title,setTitle]=useState("");const [description,setDescription]=useState("");
 const [providerType,setProviderType]=useState<ProviderType>("driver");
 const [services,setServices]=useState<{slug:string;name_ar:string}[]>([]);
 const [serviceSlug,setServiceSlug]=useState("all");
 const [governorates,setGovernorates]=useState<string[]>([]);
 const [scope,setScope]=useState("any");
 const [target,setTarget]=useState("10");const [reward,setReward]=useState("10000");const [duration,setDuration]=useState("24");const [maxJobHours,setMaxJobHours]=useState("");
 const [missions,setMissions]=useState<Mission[]>([]);const [rewards,setRewards]=useState<Reward[]>([]);
 const [selected,setSelected]=useState<string[]>([]);const [note,setNote]=useState("");
 const [details,setDetails]=useState<Record<string,Detail[]>>({});
 const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);const [busy,setBusy]=useState(false);
 const eligible=useMemo(()=>rewards.filter(r=>r.reward_status==="eligible"),[rewards]);
 const load=useCallback(async()=>{
  setLoading(true);
  const [m,r,s]=await Promise.all([
   (supabase as any).rpc("admin_list_provider_missions"),
   (supabase as any).rpc("admin_list_provider_mission_rewards"),
   (supabase as any).from("services").select("slug,name_ar").order("sort_order"),
  ]);
  if(m.error)Alert.alert("تعذر تحميل المهمات",m.error.message);else setMissions((m.data??[]) as Mission[]);
  if(r.error)Alert.alert("تعذر تحميل المكافآت",r.error.message);else setRewards((r.data??[]) as Reward[]);
  if(!s.error)setServices((s.data??[]) as {slug:string;name_ar:string}[]);
  setSelected([]);setLoading(false);
 },[]);
 useEffect(()=>{
  if(authLoading)return;
  if(!user?.id){setAllowed(false);setLoading(false);return;}
  void (async()=>{
   const {data,error}=await supabase.rpc("has_admin_access",{p_user_id:user.id});
   if(error||data!==true){setAllowed(false);setLoading(false);return;}
   setAllowed(true);await load();
  })();
 },[authLoading,user?.id,load]);
 const create=async()=>{
  const count=Number(target),amount=Number(reward),hours=Number(duration),jobHours=maxJobHours.trim()?Number(maxJobHours):null;
  if(title.trim().length<3||!Number.isInteger(count)||count<1||!Number.isSafeInteger(amount)||amount<1||!Number.isInteger(hours)||hours<1||(jobHours!==null&&(!Number.isFinite(jobHours)||jobHours<=0))){Alert.alert("بيانات غير صحيحة","راجع العنوان والعدد والمكافأة والمدة.");return;}
  setSaving(true);
  const {error}=await (supabase as any).rpc("admin_create_provider_mission",{
   p_title:title.trim(),p_description:description.trim(),p_provider_type:providerType,
   p_service_slug:providerType==="worker"&&serviceSlug!=="all"?serviceSlug:null,
   p_target_governorates:governorates,p_location_scope:scope,p_target_count:count,
   p_reward_amount_iqd:amount,p_duration_hours:hours,p_max_job_duration_hours:jobHours,
  });
  setSaving(false);
  if(error){Alert.alert("تعذر نشر المهمة",error.message);return;}
  Alert.alert("تم النشر","تم إنشاء المهمة وإرسال الإشعارات للمستهدفين.");
  setTitle("");setDescription("");setGovernorates([]);await load();
 };
 const decide=(decision:"approve"|"reject",ids:string[])=>{
  if(!ids.length)return;
  if(decision==="reject"&&!note.trim()){Alert.alert("سبب الرفض مطلوب","اكتب سبب الرفض ليصل للمستخدم.");return;}
  Alert.alert(decision==="approve"?"اعتماد المكافآت":"رفض المكافآت",decision==="approve"?"سيتم إيداع المبالغ المحددة في محافظ المستخدمين.":"سيتم رفض المطالبات المحددة.",[
   {text:"رجوع",style:"cancel"},
   {text:"تأكيد",style:decision==="reject"?"destructive":"default",onPress:()=>{void (async()=>{
    setBusy(true);const {error}=await (supabase as any).rpc("admin_decide_provider_mission_rewards",{p_participant_ids:ids,p_decision:decision,p_note:note.trim()||null});setBusy(false);
    if(error)Alert.alert("تعذر تنفيذ القرار",error.message);else{Alert.alert("تم","تم حفظ قرار الإدارة.");setNote("");setSelected([]);await load();}
   })();}},
  ]);
 };
 const showDetails=async(r:Reward)=>{
  if(details[r.participant_id])return;
  const {data,error}=await (supabase as any).rpc("admin_get_provider_mission_reward_details",{p_participant_id:r.participant_id});
  if(error){Alert.alert("تعذر تحميل التفاصيل",error.message);return;}
  setDetails(old=>({...old,[r.participant_id]:(data??[]) as Detail[]}));
 };
 if(authLoading||allowed===null||loading&&!allowed)return <View style={styles.center}><ActivityIndicator color={palette.brand}/></View>;
 if(!allowed)return <View style={styles.center}><Text style={styles.title}>غير مصرّح</Text><Text style={styles.muted}>هذه الصفحة مخصصة لإدارة المهمات.</Text></View>;
 return <ScrollView style={styles.page} contentContainerStyle={{paddingBottom:48}}>
  <Stack.Screen options={{title:"المهمات والمكافآت"}}/>
  <Text style={styles.title}>المهمات والمكافآت</Text>
  <Text style={styles.muted}>أنشئ تحدياً لفئة ومحافظة محددة، وراجع الإنجاز قبل إيداع المكافأة.</Text>
  <View style={styles.card}>
   <Text style={styles.heading}>إنشاء مهمة جديدة</Text>
   <Text style={styles.label}>عنوان المهمة</Text><TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder="أنجز 10 رحلات واحصل على 10 آلاف" placeholderTextColor={palette.muted} style={styles.input}/>
   <Text style={styles.label}>تفاصيل المهمة</Text><TextInput value={description} onChangeText={setDescription} multiline numberOfLines={3} maxLength={1000} placeholder="الشروط والتفاصيل" placeholderTextColor={palette.muted} style={[styles.input,{minHeight:78,textAlignVertical:"top"}]}/>
   <Text style={styles.label}>الفئة المستهدفة</Text><View style={styles.chips}>{TYPES.map(t=><TouchableOpacity key={t.value} onPress={()=>setProviderType(t.value)} style={[styles.chip,providerType===t.value&&styles.chipActive]}><Text style={[styles.chipText,providerType===t.value&&styles.chipTextActive]}>{t.label}</Text></TouchableOpacity>)}</View>
   {providerType==="worker"&&<><Text style={styles.label}>تخصص الفني</Text><View style={styles.chips}><TouchableOpacity onPress={()=>setServiceSlug("all")} style={[styles.chip,serviceSlug==="all"&&styles.chipActive]}><Text style={[styles.chipText,serviceSlug==="all"&&styles.chipTextActive]}>كل التخصصات</Text></TouchableOpacity>{services.map(s=><TouchableOpacity key={s.slug} onPress={()=>setServiceSlug(s.slug)} style={[styles.chip,serviceSlug===s.slug&&styles.chipActive]}><Text style={[styles.chipText,serviceSlug===s.slug&&styles.chipTextActive]}>{s.name_ar}</Text></TouchableOpacity>)}</View></>}
   <Text style={styles.label}>شرط المكان</Text><View style={styles.chips}>{[{v:"any",l:"داخل وخارج"},{v:"inside_governorate",l:"داخل المحافظة"},{v:"outside_governorate",l:"خارج المحافظة"}].map(x=><TouchableOpacity key={x.v} onPress={()=>setScope(x.v)} style={[styles.chip,scope===x.v&&styles.chipActive]}><Text style={[styles.chipText,scope===x.v&&styles.chipTextActive]}>{x.l}</Text></TouchableOpacity>)}</View>
   <Text style={styles.label}>المحافظات المستهدفة — اتركها فارغة لكل العراق</Text><View style={styles.chips}>{IRAQ_GOVERNORATES.map(g=><TouchableOpacity key={g.key} onPress={()=>setGovernorates(old=>old.includes(g.key)?old.filter(x=>x!==g.key):[...old,g.key])} style={[styles.chip,governorates.includes(g.key)&&styles.chipActive]}><Text style={[styles.chipText,governorates.includes(g.key)&&styles.chipTextActive]}>{g.name}</Text></TouchableOpacity>)}</View>
   <Text style={styles.label}>عدد الرحلات / الأعمال المطلوبة</Text><TextInput value={target} onChangeText={setTarget} keyboardType="number-pad" style={styles.input}/>
   <Text style={styles.label}>المكافأة لكل مستخدم — دينار</Text><TextInput value={reward} onChangeText={setReward} keyboardType="number-pad" style={styles.input}/>
   <Text style={styles.label}>مدة المهمة بالساعات</Text><TextInput value={duration} onChangeText={setDuration} keyboardType="number-pad" style={styles.input}/>
   <Text style={styles.label}>الحد الأعلى لمدة العمل الواحد بالساعات — اختياري</Text><TextInput value={maxJobHours} onChangeText={setMaxJobHours} keyboardType="decimal-pad" placeholder="مثلاً 2" placeholderTextColor={palette.muted} style={styles.input}/>
   <TouchableOpacity disabled={saving} onPress={()=>void create()} style={[styles.primaryButton,saving&&{opacity:.5}]}><Text style={styles.primaryText}>{saving?"جارٍ النشر...":"نشر المهمة وإرسال الإشعارات"}</Text></TouchableOpacity>
  </View>
  <View style={styles.card}>
   <View style={styles.row}><Text style={styles.heading}>المهمات المنشورة</Text><TouchableOpacity onPress={()=>void load()}><Text style={styles.link}>تحديث</Text></TouchableOpacity></View>
   {missions.length===0?<Text style={styles.muted}>لا توجد مهمات.</Text>:missions.map(m=><View key={m.mission_id} style={styles.listItem}><Text style={styles.itemTitle}>{m.title}</Text><Text style={styles.muted}>{TYPES.find(t=>t.value===m.provider_type)?.label} · {m.target_governorates.length?m.target_governorates.map(govName).join("، "):"كل العراق"} · {m.status==="active"?"نشطة":m.status==="expired"?"منتهية":m.status==="paused"?"متوقفة":m.status}</Text><Text style={styles.itemText}>الهدف {m.target_count} · المكافأة {money(m.reward_amount_iqd)} · المشاركون {m.participant_count}</Text><Text style={styles.muted}>بانتظار القرار {m.eligible_count} · معتمدة {m.approved_count} · مرفوضة {m.rejected_count} · تنتهي {date(m.ends_at)}</Text></View>)}
  </View>
  <View style={styles.card}>
   <View style={styles.row}><Text style={styles.heading}>مراجعة المكافآت</Text><TouchableOpacity onPress={()=>void load()}><Text style={styles.link}>تحديث</Text></TouchableOpacity></View>
   {eligible.length>0&&<><TouchableOpacity onPress={()=>setSelected(selected.length===eligible.length?[]:eligible.map(r=>r.participant_id))} style={styles.secondaryButton}><Text style={styles.secondaryText}>{selected.length===eligible.length?"إلغاء تحديد الكل":"تحديد الكل"}</Text></TouchableOpacity><TextInput value={note} onChangeText={setNote} placeholder="سبب الرفض (مطلوب عند الرفض)" placeholderTextColor={palette.muted} style={styles.input}/><View style={styles.row}><TouchableOpacity disabled={busy||!selected.length} onPress={()=>decide("approve",selected)} style={[styles.approveButton,(!selected.length||busy)&&{opacity:.5}]}><Text style={styles.primaryText}>موافقة وإيداع ({selected.length})</Text></TouchableOpacity><TouchableOpacity disabled={busy||!selected.length} onPress={()=>decide("reject",selected)} style={[styles.rejectButton,(!selected.length||busy)&&{opacity:.5}]}><Text style={styles.primaryText}>رفض</Text></TouchableOpacity></View></>}
   {rewards.length===0?<Text style={styles.muted}>لا توجد مطالبات.</Text>:rewards.map(r=><View key={r.participant_id} style={styles.listItem}>
    <View style={styles.row}><TouchableOpacity disabled={r.reward_status!=="eligible"} onPress={()=>setSelected(old=>old.includes(r.participant_id)?old.filter(x=>x!==r.participant_id):[...old,r.participant_id])}><Text style={styles.link}>{selected.includes(r.participant_id)?"☑":"□"}</Text></TouchableOpacity><View style={{flex:1}}><Text style={styles.itemTitle}>{r.provider_name??"مقدم خدمة"} · {r.mission_title}</Text><Text style={styles.muted}>{r.provider_phone??"—"} · {govName(r.governorate_key)}</Text><Text style={styles.itemText}>{r.progress_count}/{r.target_count} · {money(r.reward_amount_iqd)}</Text><Text style={styles.muted}>{r.reward_status==="eligible"?"بانتظار القرار":r.reward_status==="approved"?"تم الإيداع":"مرفوضة"}</Text></View><TouchableOpacity onPress={()=>void showDetails(r)}><Text style={styles.link}>التفاصيل</Text></TouchableOpacity></View>
    {details[r.participant_id]?.map(d=><View key={d.request_id} style={styles.detail}><Text style={styles.itemText}>{d.request_type==="taxi"?"رحلة سيارة":"عمل خدمة"} · {date(d.request_completed_at)}</Text><Text style={styles.muted}>المدة {d.duration_minutes??"—"} دقيقة · العميل {d.customer_name??"—"} · {d.customer_phone??"—"}</Text><Text style={styles.muted}>من {d.pickup_text??"—"} إلى {d.dest_text??"—"}</Text><Text style={styles.muted}>{govName(d.origin_governorate)} ← {govName(d.destination_governorate)}</Text></View>)}
   </View>)}
  </View>
 </ScrollView>;
}
const styles=StyleSheet.create({
 page:{flex:1,backgroundColor:palette.pageCanvas,paddingHorizontal:16,paddingTop:38},
 center:{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:palette.pageCanvas},
 title:{fontSize:23,fontWeight:"900",color:palette.ink,textAlign:"right",marginBottom:6},
 muted:{fontSize:11,color:palette.muted,textAlign:"right",lineHeight:18},
 card:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.xl,padding:15,marginTop:14,gap:8},
 heading:{fontSize:16,fontWeight:"900",color:palette.ink,textAlign:"right"},
 label:{fontSize:12,fontWeight:"800",color:palette.ink,textAlign:"right",marginTop:5},
 input:{borderWidth:1,borderColor:palette.line,borderRadius:12,padding:11,color:palette.ink,textAlign:"right",backgroundColor:palette.pageCanvas},
 chips:{flexDirection:"row",flexWrap:"wrap",gap:7},
 chip:{borderWidth:1,borderColor:palette.line,borderRadius:999,paddingHorizontal:10,paddingVertical:8},
 chipActive:{backgroundColor:palette.brand,borderColor:palette.brand},
 chipText:{fontSize:10,fontWeight:"800",color:palette.ink},
 chipTextActive:{color:"#fff"},
 primaryButton:{backgroundColor:palette.brand,borderRadius:14,padding:14,alignItems:"center",marginTop:8},
 primaryText:{fontSize:12,fontWeight:"900",color:"#fff"},
 secondaryButton:{borderWidth:1,borderColor:palette.line,borderRadius:12,padding:11,alignItems:"center"},
 secondaryText:{fontSize:12,fontWeight:"800",color:palette.ink},
 row:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8},
 link:{fontSize:12,fontWeight:"900",color:palette.brand},
 listItem:{borderTopWidth:1,borderTopColor:palette.line,paddingTop:10,marginTop:6,gap:4},
 itemTitle:{fontSize:13,fontWeight:"900",color:palette.ink,textAlign:"right"},
 itemText:{fontSize:12,fontWeight:"700",color:palette.ink,textAlign:"right"},
 approveButton:{flex:1,backgroundColor:"#059669",borderRadius:12,padding:11,alignItems:"center"},
 rejectButton:{flex:1,backgroundColor:"#DC2626",borderRadius:12,padding:11,alignItems:"center"},
 detail:{backgroundColor:palette.pageCanvas,borderRadius:12,padding:9,marginTop:7,gap:4},
});
