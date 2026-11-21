import { useCallback,useEffect,useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
 return <section className="mt-6 space-y-3">
  <div className="flex items-center justify-between"><h2 className="font-black">طلباتي من المطاعم والمتاجر</h2><button type="button" onClick={()=>void load()} className="text-xs font-bold text-primary">تحديث</button></div>
  {loading?<div className="rounded-xl border p-4 text-center text-xs text-muted-foreground">جارٍ تحميل طلباتك...</div>:orders.length===0?<div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">ما عندك طلبات مشتريات لحد الآن.</div>:orders.map(order=><article key={order.id} className="space-y-2 rounded-2xl border border-border bg-card p-3">
   <div className="flex items-center justify-between gap-2"><b className="text-sm">{names[order.business_profile_id]??"منشأة"}</b><span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-black text-primary">{statusLabels[order.status]??order.status}</span></div>
   <p className="text-[10px] text-muted-foreground">{order.order_type==="restaurant"?"مطعم":"متجر"} · {new Date(order.created_at).toLocaleString("ar-IQ")}</p>
   {(order.requested_items??[]).map((item,index)=><p key={index} className="text-xs">{item.name??"عنصر"} × {item.quantity??1}</p>)}
   {order.partner_total!=null&&<p className="text-sm font-black text-primary">{Number(order.partner_total).toLocaleString("ar-IQ")} {order.currency==="USD"?"$":"د.ع"}</p>}
  </article>)}
 </section>;
}
