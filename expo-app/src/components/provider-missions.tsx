import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { palette, radius, space } from "@/styles/theme";

type Mission = {
  mission_id:string;title:string;description:string;provider_type:string;service_slug:string|null;
  location_scope:string;target_count:number;reward_amount_iqd:number;progress_count:number;
  reward_status:string;starts_at:string;ends_at:string;max_job_duration_hours:number|null;
};
const money=(n:number)=>new Intl.NumberFormat("ar-IQ").format(Number(n)||0)+" د.ع";
const scopeText=(s:string)=>s==="inside_governorate"?"داخل المحافظة فقط":s==="outside_governorate"?"خارج المحافظة فقط":"داخل وخارج المحافظة";
const statusText=(s:string,endsAt:string)=>s==="eligible"?"فزت بالمهمة — بانتظار اعتماد الإدارة":s==="approved"?"مبروك! تم اعتماد مكافأتك وإيداعها":s==="rejected"?"لم تعتمد الإدارة المكافأة":new Date(endsAt).getTime()<=Date.now()?"انتهت المهلة":"مستمرة";

export function ProviderMissions(){
 const [items,setItems]=useState<Mission[]>([]);
 const wonItems=items.filter((m)=>m.reward_status==="eligible"||m.reward_status==="approved");
 const [loading,setLoading]=useState(true);
 const load=useCallback(async()=>{
  const {data,error}=await (supabase as any).rpc("provider_get_missions");
  if(!error)setItems((data??[]) as Mission[]);
  setLoading(false);
 },[]);
 useEffect(()=>{
  void load();
  const timer=setInterval(()=>void load(),30000);
  // Android can remount this screen while the previous named Realtime channel
  // is still subscribed. A second .on() then throws before the home screen renders.
  // The 30-second refresh is sufficient for mission cards and avoids that race.
  return()=>{clearInterval(timer);};
 },[load]);
 return (
  <View style={styles.wrap}>
   <View style={styles.heading}>
    <Text style={styles.headingText}>مكافآتي من المسابقات</Text>
    <TouchableOpacity onPress={()=>void load()}><Text style={styles.refresh}>تحديث</Text></TouchableOpacity>
   </View>
   {loading&&!wonItems.length?<ActivityIndicator color={palette.brand}/>:wonItems.length===0?
    <View style={styles.empty}><Text style={styles.emptyTitle}>ما فزت بمكافأة لحد الآن</Text><Text style={styles.emptyText}>المكافآت اللي تفوز بيها من مسابقات ممنون راح تظهر هنا بعد إكمال شروطها ومراجعتها.</Text></View>:
    <View style={styles.timeline}>
     {wonItems.map((m,index)=>{
      const progress=Math.min(100,Math.round(m.progress_count/Math.max(1,m.target_count)*100));
      const completed=progress>=100 || m.reward_status==="eligible" || m.reward_status==="approved";
      const progressColor=completed?"#10B981":progress>0?"#D4A017":"#94A3B8";
      return <View key={m.mission_id} style={styles.timelineItem}>
       <View style={styles.rail}>
        <View style={[styles.node,{backgroundColor:completed?"#10B981":progress>0?"#D4A017":"#CBD5E1",borderColor:completed?"#A7F3D0":"#E2E8F0"}]}>
         <Text style={styles.nodeText}>{completed?"✓":String(index+1)}</Text>
        </View>
        {index<wonItems.length-1&&<View style={[styles.connector,{backgroundColor:completed?"#10B981":"#D8DEE7"}]}/>}
       </View>
       <View style={styles.card}>
        <View style={styles.titleRow}>
         <Text style={styles.title}>{m.title}</Text>
         <Text style={[styles.percent,{color:progressColor}]}>{progress}%</Text>
        </View>
        <Text style={styles.status}>{statusText(m.reward_status,m.ends_at)}</Text>
        {!!m.description&&<Text style={styles.description}>{m.description}</Text>}
        <View style={styles.progressHeader}><Text style={styles.progressText}>الإنجاز {m.progress_count} من {m.target_count}</Text><Text style={[styles.progressText,{color:progressColor}]}>{completed?"مكتملة":progress>0?"قيد التقدم":"لم تبدأ"}</Text></View>
        <View style={styles.track}><View style={[styles.fill,{width:(progress+"%") as any,backgroundColor:progressColor}]}/></View>
        <View style={styles.metaRow}><View style={styles.meta}><Text style={styles.metaLabel}>المكافأة</Text><Text style={styles.reward}>{money(m.reward_amount_iqd)}</Text></View><View style={styles.meta}><Text style={styles.metaLabel}>المكان</Text><Text style={styles.metaValue}>{scopeText(m.location_scope)}</Text></View></View>
        <Text style={styles.deadline}>تنتهي: {new Date(m.ends_at).toLocaleString("ar-IQ")}</Text>
        {m.max_job_duration_hours!=null&&<Text style={styles.deadline}>الحد الأقصى للعمل الواحد: {m.max_job_duration_hours} ساعة</Text>}
       </View>
      </View>;
     })}
    </View>}
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
 timeline:{gap:0,paddingBottom:4},
 timelineItem:{flexDirection:"row",alignItems:"stretch",gap:10},
 rail:{width:24,alignItems:"center",position:"relative"},
 node:{width:23,height:23,borderRadius:12,borderWidth:2,alignItems:"center",justifyContent:"center",zIndex:1},
 nodeText:{fontSize:10,fontWeight:"900",color:"#FFFFFF"},
 connector:{width:2,flex:1,minHeight:18,marginTop:3,borderRadius:2},
 card:{flex:1,backgroundColor:palette.surface,borderRadius:radius.lg,borderWidth:1,borderColor:palette.line,padding:14,gap:8,marginBottom:14},
 titleRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8},
 percent:{fontSize:12,fontWeight:"900"},
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

