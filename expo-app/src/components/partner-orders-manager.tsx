import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { palette, radius } from "@/styles/theme";

type PartnerOrder = { id:string; business_profile_id:string; order_type:string; requested_items:Array<{name?:string;quantity?:number;line_total?:number}>; delivery_address:string|null; customer_note:string|null; status:string; partner_total:number|null; currency:string; created_at:string };
const labels:Record<string,string>={pending:"بانتظار قبول المنشأة",accepted:"تم قبول الطلب",preparing:"قيد التحضير",ready:"جاهز",out_for_delivery:"خرج للتوصيل",completed:"مكتمل",rejected:"مرفوض",cancelled:"ملغي"};
const nextStatus:Record<string,{status:string;label:string}>={pending:{status:"accepted",label:"قبول الطلب"},accepted:{status:"preparing",label:"بدء التحضير"},preparing:{status:"ready",label:"الطلب جاهز"},ready:{status:"out_for_delivery",label:"خرج للتوصيل"},out_for_delivery:{status:"completed",label:"تأكيد التسليم"}};
export function PartnerOrdersManager({businessIds}:{businessIds:string[]}) {
 const [orders,setOrders]=useState<PartnerOrder[]>([]); const [loading,setLoading]=useState(true); const [busyId,setBusyId]=useState<string|null>(null);
 const load=useCallback(async()=>{
  if(!businessIds.length){setOrders([]);setLoading(false);return;}
  setLoading(true);
  const {data,error}=await (supabase as any).from("partner_customer_orders").select("id,business_profile_id,order_type,requested_items,delivery_address,customer_note,status,partner_total,currency,created_at").in("business_profile_id",businessIds).order("created_at",{ascending:false}).limit(100);
  if(error){Alert.alert("تعذر تحميل طلبات الزبائن",error.message);setOrders([]);}else setOrders((data??[]) as PartnerOrder[]);
  setLoading(false);
 },[businessIds.join("|")]);
 useEffect(()=>{void load();},[load]);
 async function updateStatus(order:PartnerOrder,status:string){
  setBusyId(order.id);
  const {error}=await (supabase as any).from("partner_customer_orders").update({status,updated_at:new Date().toISOString()}).eq("id",order.id).eq("business_profile_id",order.business_profile_id);
  setBusyId(null);if(error){Alert.alert("تعذر تحديث الطلب",error.message);return;}await load();
 }
 return <View style={{gap:10,marginTop:12}}>
  <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}><Text style={{color:palette.ink,fontSize:17,fontWeight:"900",textAlign:"right"}}>طلبات الزبائن</Text><TouchableOpacity onPress={()=>void load()}><Text style={{color:palette.brand,fontWeight:"900",fontSize:12}}>تحديث</Text></TouchableOpacity></View>
  {loading?<ActivityIndicator color={palette.brand}/>:orders.length===0?<Text style={{color:palette.muted,textAlign:"center",padding:16,fontSize:12}}>ماكو طلبات جديدة حالياً.</Text>:orders.map(order=><View key={order.id} style={{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:13,gap:7}}>
   <View style={{flexDirection:"row",justifyContent:"space-between",alignItems:"center"}}><Text style={{color:palette.ink,fontWeight:"900"}}>طلب #{order.id.slice(0,8)}</Text><Text style={{color:order.status==="pending"?"#B45309":palette.brand,fontSize:10,fontWeight:"900"}}>{labels[order.status]??order.status}</Text></View>
   <Text style={{color:palette.muted,fontSize:10,textAlign:"right"}}>{order.order_type==="restaurant"?"طلب مطعم":"طلب متجر"} · {new Date(order.created_at).toLocaleString("ar-IQ")}</Text>
   {(order.requested_items??[]).map((item,index)=><Text key={index} style={{color:palette.ink,fontSize:12,textAlign:"right"}}>{item.name??"عنصر"} × {item.quantity??1}{item.line_total!=null?" — "+Number(item.line_total).toLocaleString("ar-IQ"):""}</Text>)}
   {order.delivery_address?<Text style={{color:palette.muted,fontSize:11,textAlign:"right"}}>التوصيل: {order.delivery_address}</Text>:null}
   {order.customer_note?<Text style={{color:palette.muted,fontSize:11,textAlign:"right"}}>ملاحظة: {order.customer_note}</Text>:null}
   <Text style={{color:palette.brand,fontSize:13,fontWeight:"900",textAlign:"right"}}>{order.partner_total==null?"السعر قيد التأكيد":Number(order.partner_total).toLocaleString("ar-IQ")+" "+(order.currency==="USD"?"$":"د.ع")}</Text>
   {nextStatus[order.status]?<TouchableOpacity disabled={busyId===order.id} onPress={()=>void updateStatus(order,nextStatus[order.status].status)} style={{backgroundColor:palette.brand,borderRadius:10,padding:11,alignItems:"center",opacity:busyId===order.id?0.5:1}}><Text style={{color:"#fff",fontWeight:"900"}}>{busyId===order.id?"جارٍ التحديث...":nextStatus[order.status].label}</Text></TouchableOpacity>:null}
   {order.status==="pending"?<TouchableOpacity disabled={busyId===order.id} onPress={()=>Alert.alert("رفض الطلب","متأكد تريد رفض الطلب؟",[{text:"رجوع",style:"cancel"},{text:"رفض",style:"destructive",onPress:()=>void updateStatus(order,"rejected")}])} style={{borderWidth:1,borderColor:"#dc262655",borderRadius:10,padding:10,alignItems:"center"}}><Text style={{color:"#dc2626",fontWeight:"900"}}>رفض الطلب</Text></TouchableOpacity>:null}
  </View>)}
 </View>;
}
