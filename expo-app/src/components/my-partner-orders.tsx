import { useCallback,useEffect,useState } from "react";
import { ActivityIndicator,Text,TouchableOpacity,View } from "react-native";
import { supabase } from "@/lib/supabase";
import { palette,radius } from "@/styles/theme";
type Order={id:string;business_profile_id:string;order_type:string;requested_items:Array<{name?:string;quantity?:number}>;status:string;partner_total:number|null;currency:string;created_at:string};
const statusLabels:Record<string,string>={pending:"بانتظار قبول المنشأة",accepted:"تم قبول الطلب",preparing:"قيد التحضير",ready:"جاهز",out_for_delivery:"خرج للتوصيل",completed:"مكتمل",rejected:"مرفوض",cancelled:"ملغي"};
export function MyPartnerOrders({customerId}:{customerId:string|null}) {
 const [orders,setOrders]=useState<Order[]>([]);const [names,setNames]=useState<Record<string,string>>({});const [loading,setLoading]=useState(true);
 const load=useCallback(async()=>{
  if(!customerId){setOrders([]);setLoading(false);return;}
  setLoading(true);
  const {data,error}=await (supabase as any).from("partner_customer_orders").select("id,business_profile_id,order_type,requested_items,status,partner_total,currency,created_at").eq("customer_id",customerId).order("created_at",{ascending:false}).limit(20);
  if(error){setOrders([]);setLoading(false);return;}
  const rows=(data??[]) as Order[];setOrders(rows);
  const ids=[...new Set(rows.map(row=>row.business_profile_id))];
  if(ids.length){const {data:businesses}=await (supabase as any).from("partner_business_profiles").select("id,business_name").in("id",ids);setNames(Object.fromEntries((businesses??[]).map((row:any)=>[row.id,row.business_name])));}
  setLoading(false);
 },[customerId]);
 useEffect(()=>{void load();},[load]);
 return <View style={{gap:10,marginTop:18}}>
  <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={{color:palette.ink,fontSize:16,fontWeight:"900",textAlign:"right"}}>طلباتي من المطاعم والمتاجر</Text><TouchableOpacity onPress={()=>void load()}><Text style={{color:palette.brand,fontSize:11,fontWeight:"900"}}>تحديث</Text></TouchableOpacity></View>
  {loading?<ActivityIndicator color={palette.brand}/>:orders.length===0?<Text style={{color:palette.muted,fontSize:11,textAlign:"center",padding:12}}>ما عندك طلبات مشتريات لحد الآن.</Text>:orders.map(order=><View key={order.id} style={{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:12,gap:5}}>
   <View style={{flexDirection:"row",justifyContent:"space-between",gap:8}}><Text style={{color:palette.ink,fontWeight:"900",fontSize:12}}>{names[order.business_profile_id]??"منشأة"}</Text><Text style={{color:palette.brand,fontWeight:"900",fontSize:10}}>{statusLabels[order.status]??order.status}</Text></View>
   <Text style={{color:palette.muted,fontSize:10}}>{order.order_type==="restaurant"?"مطعم":"متجر"} · {new Date(order.created_at).toLocaleString("ar-IQ")}</Text>
   {(order.requested_items??[]).map((item,index)=><Text key={index} style={{color:palette.ink,fontSize:11,textAlign:"right"}}>{item.name??"عنصر"} × {item.quantity??1}</Text>)}
   {order.partner_total!=null?<Text style={{color:palette.brand,fontWeight:"900",fontSize:12}}>{Number(order.partner_total).toLocaleString("ar-IQ")} {order.currency==="USD"?"$":"د.ع"}</Text>:null}
  </View>)}
 </View>;
}
