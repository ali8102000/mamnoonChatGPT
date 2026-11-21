import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/lib/toast";
type PartnerOrder = { id:string; business_profile_id:string; order_type:string; requested_items:Array<{name?:string;quantity?:number;line_total?:number}>; delivery_address:string|null; customer_note:string|null; status:string; partner_total:number|null; currency:string; created_at:string };
const labels:Record<string,string>={pending:"بانتظار قبول المنشأة",accepted:"تم قبول الطلب",preparing:"قيد التحضير",ready:"جاهز",out_for_delivery:"خرج للتوصيل",completed:"مكتمل",rejected:"مرفوض",cancelled:"ملغي"};
const nextStatus:Record<string,{status:string;label:string}>={pending:{status:"accepted",label:"قبول الطلب"},accepted:{status:"preparing",label:"بدء التحضير"},preparing:{status:"ready",label:"الطلب جاهز"},ready:{status:"out_for_delivery",label:"خرج للتوصيل"},out_for_delivery:{status:"completed",label:"تأكيد التسليم"}};
export function PartnerOrdersManager({businessIds}:{businessIds:string[]}) {
 const [orders,setOrders]=useState<PartnerOrder[]>([]);const [loading,setLoading]=useState(true);const [busyId,setBusyId]=useState<string|null>(null);
 const load=useCallback(async()=>{
  if(!businessIds.length){setOrders([]);setLoading(false);return;}
  setLoading(true);
  const {data,error}=await (supabase as any).from("partner_customer_orders").select("id,business_profile_id,order_type,requested_items,delivery_address,customer_note,status,partner_total,currency,created_at").in("business_profile_id",businessIds).order("created_at",{ascending:false}).limit(100);
  if(error){toast.error("تعذر تحميل طلبات الزبائن");setOrders([]);}else setOrders((data??[]) as PartnerOrder[]);
  setLoading(false);
 },[businessIds.join("|")]);
 useEffect(()=>{void load();},[load]);
 async function updateStatus(order:PartnerOrder,status:string){
  setBusyId(order.id);
  const {error}=await (supabase as any).from("partner_customer_orders").update({status,updated_at:new Date().toISOString()}).eq("id",order.id).eq("business_profile_id",order.business_profile_id);
  setBusyId(null);if(error){toast.error(error.message);return;}toast.success("تم تحديث حالة الطلب");await load();
 }
 return <section className="space-y-3">
  <div className="flex items-center justify-between"><h2 className="font-black">طلبات الزبائن</h2><button type="button" onClick={()=>void load()} className="text-xs font-bold text-primary">تحديث</button></div>
  {loading?<div className="rounded-xl border p-5 text-center text-xs text-muted-foreground">جارٍ تحميل الطلبات...</div>:orders.length===0?<div className="rounded-xl border border-dashed p-5 text-center text-xs text-muted-foreground">ماكو طلبات جديدة حالياً.</div>:orders.map(order=><article key={order.id} className="space-y-2 rounded-2xl border border-border bg-card p-4">
   <div className="flex items-center justify-between gap-2"><b className="text-sm">طلب #{order.id.slice(0,8)}</b><span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-black text-primary">{labels[order.status]??order.status}</span></div>
   <p className="text-[10px] text-muted-foreground">{order.order_type==="restaurant"?"طلب مطعم":"طلب متجر"} · {new Date(order.created_at).toLocaleString("ar-IQ")}</p>
   <div className="space-y-1">{(order.requested_items??[]).map((item,index)=><p key={index} className="text-xs">{item.name??"عنصر"} × {item.quantity??1}{item.line_total!=null?" — "+Number(item.line_total).toLocaleString("ar-IQ"):""}</p>)}</div>
   {order.delivery_address&&<p className="text-xs text-muted-foreground">التوصيل: {order.delivery_address}</p>}
   {order.customer_note&&<p className="text-xs text-muted-foreground">ملاحظة: {order.customer_note}</p>}
   <p className="text-sm font-black text-primary">{order.partner_total==null?"السعر قيد التأكيد":Number(order.partner_total).toLocaleString("ar-IQ")+" "+(order.currency==="USD"?"$":"د.ع")}</p>
   {nextStatus[order.status]&&<button type="button" disabled={busyId===order.id} onClick={()=>void updateStatus(order,nextStatus[order.status].status)} className="w-full rounded-xl bg-primary p-3 text-xs font-black text-primary-foreground disabled:opacity-50">{busyId===order.id?"جارٍ التحديث...":nextStatus[order.status].label}</button>}
   {order.status==="pending"&&<button type="button" disabled={busyId===order.id} onClick={()=>{if(window.confirm("متأكد تريد رفض الطلب؟"))void updateStatus(order,"rejected");}} className="w-full rounded-xl border border-destructive/30 p-3 text-xs font-black text-destructive disabled:opacity-50">رفض الطلب</button>}
  </article>)}
 </section>;
}
