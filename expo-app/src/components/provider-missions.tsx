import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { palette, radius, space } from "@/styles/theme";

type Mission = {
  mission_id:string;title:string;description:string;provider_type:string;service_slug:string|null;
  location_scope:string;target_count:number;reward_amount_iqd:number;progress_count:number;
  reward_status:string;starts_at:string;ends_at:string;max_job_duration_hours:number|null;
};
const money=(n:number)=>new Intl.NumberFormat("ar-IQ").format(Number(n)||0)+" د.ع";
const scopeText=(s:string)=>s==="inside_governorate"?"داخل المحافظة فقط":s==="outside_governorate"?"خارج المحافظة فقط":"داخل وخارج المحافظة";
const statusText=(s:string,endsAt:string)=>s==="eligible"?"مكتملة — بانتظار مراجعة الإدارة":s==="approved"?"تم اعتماد المكافأة وإيداعها":s==="rejected"?"لم تعتمد الإدارة المكافأة":new Date(endsAt).getTime()<=Date.now()?"انتهت المهلة":"مستمرة";

export function ProviderMissions(){
 const [items,setItems]=useState<Mission[]>([]);
 const [loading,setLoading]=useState(true);
 const load=useCallback(async()=>{
  const {data,error}=await (supabase as any).rpc("provider_get_missions");
  if(!error)setItems((data??[]) as Mission[]);
  setLoading(false);
 },[]);
 useEffect(()=>{
  void load();
  const timer=setInterval(()=>void load(),30000);
  const channel=supabase.channel("native-provider-missions")
   .on("postgres_changes",{event:"INSERT",schema:"public",table:"notifications"},()=>void load())
   .subscribe();
  return()=>{clearInterval(timer);void supabase.removeChannel(channel);};
 },[load]);
 return (
  <View style={styles.wrap}>
   <View style={styles.heading}>
    <Text style={styles.headingText}>مهماتي ومكافآتي</Text>
    <TouchableOpacity onPress={()=>void load()}><Text style={styles.refresh}>تحديث</Text></TouchableOpacity>
   </View>
   {loading&&!items.length?<ActivityIndicator color={palette.brand}/>:items.length===0?
    <View style={styles.empty}><Text style={styles.emptyTitle}>ما عندك مهمات حالياً</Text><Text style={styles.emptyText}>أي مهمة جديدة من الإدارة راح توصلك هنا ويصلك إشعار بيها.</Text></View>:
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
     {items.map(m=>{
      const progress=Math.min(100,Math.round(m.progress_count/Math.max(1,m.target_count)*100));
      return <View key={m.mission_id} style={styles.card}>
       <Text style={styles.title}>{m.title}</Text>
       <Text style={styles.status}>{statusText(m.reward_status,m.ends_at)}</Text>
       {!!m.description&&<Text style={styles.description}>{m.description}</Text>}
       <View style={styles.progressHeader}><Text style={styles.progressText}>الإنجاز {m.progress_count} من {m.target_count}</Text><Text style={styles.progressText}>{progress}%</Text></View>
       <View style={styles.track}><View style={[styles.fill,{width:(progress+"%") as any}]}/></View>
       <View style={styles.metaRow}><View style={styles.meta}><Text style={styles.metaLabel}>المكافأة</Text><Text style={styles.reward}>{money(m.reward_amount_iqd)}</Text></View><View style={styles.meta}><Text style={styles.metaLabel}>المكان</Text><Text style={styles.metaValue}>{scopeText(m.location_scope)}</Text></View></View>
       <Text style={styles.deadline}>تنتهي: {new Date(m.ends_at).toLocaleString("ar-IQ")}</Text>
       {m.max_job_duration_hours!=null&&<Text style={styles.deadline}>الحد الأقصى للعمل الواحد: {m.max_job_duration_hours} ساعة</Text>}
      </View>;
     })}
    </ScrollView>}
  </View>
 );
}
const styles=StyleSheet.create({
 wrap:{marginBottom:20,paddingHorizontal:20},
 heading:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:10},
 headingText:{fontSize:16,fontWeight:"900",color:palette.ink,textAlign:"right"},
 refresh:{fontSize:12,fontWeight:"800",color:palette.brand},
 empty:{backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.line,padding:14},
 emptyTitle:{fontSize:13,fontWeight:"900",color:palette.ink,textAlign:"right"},
 emptyText:{fontSize:11,color:palette.muted,textAlign:"right",marginTop:4,lineHeight:18},
 cards:{gap:10,paddingBottom:4},
 card:{width:DimensionsWidth(),backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.line,padding:14,gap:8},
 title:{fontSize:14,fontWeight:"900",color:palette.ink,textAlign:"right"},
 status:{fontSize:10,fontWeight:"800",color:palette.brand,textAlign:"right"},
 description:{fontSize:11,color:palette.muted,textAlign:"right",lineHeight:17},
 progressHeader:{flexDirection:"row",justifyContent:"space-between"},
 progressText:{fontSize:11,fontWeight:"800",color:palette.ink},
 track:{height:8,borderRadius:8,backgroundColor:palette.surfaceSoft,overflow:"hidden"},
 fill:{height:8,borderRadius:8,backgroundColor:"#10B981"},
 metaRow:{flexDirection:"row",gap:8},
 meta:{flex:1,backgroundColor:palette.surfaceSoft,borderRadius:12,padding:9},
 metaLabel:{fontSize:10,color:palette.muted,textAlign:"right"},
 reward:{fontSize:13,fontWeight:"900",color:"#059669",textAlign:"right",marginTop:3},
 metaValue:{fontSize:11,fontWeight:"800",color:palette.ink,textAlign:"right",marginTop:3},
 deadline:{fontSize:10,color:palette.muted,textAlign:"right"},
});
function DimensionsWidth(){return 285;}
