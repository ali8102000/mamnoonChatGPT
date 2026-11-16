import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: corsHeaders });
type Category = "economy" | "premium" | "luxury";
type Point = { lat: number; lng: number };
function validPoint(p: any): p is Point {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
}
function haversine(a: Point,b: Point) {
  const rad=(v:number)=>v*Math.PI/180, dLat=rad(b.lat-a.lat), dLng=rad(b.lng-a.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
async function route(from: Point,to: Point) {
  const key=Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (key) {
    try {
      const res=await fetch("https://routes.googleapis.com/directions/v2:computeRoutes",{
        method:"POST",
        headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,
          "X-Goog-FieldMask":"routes.distanceMeters,routes.duration"},
        body:JSON.stringify({
          origin:{location:{latLng:{latitude:from.lat,longitude:from.lng}}},
          destination:{location:{latLng:{latitude:to.lat,longitude:to.lng}}},
          travelMode:"DRIVE",routingPreference:"TRAFFIC_AWARE",
          computeAlternativeRoutes:false,languageCode:"ar",units:"METRIC"
        }),
        signal:AbortSignal.timeout(9000)
      });
      if (res.ok) {
        const data=await res.json(), r=data.routes?.[0];
        const distanceKm=Number(r?.distanceMeters)/1000;
        const durationMin=Number.parseFloat(String(r?.duration||"").replace("s",""))/60;
        if (Number.isFinite(distanceKm)&&distanceKm>0&&Number.isFinite(durationMin)&&durationMin>=0)
          return {distanceKm,durationMin,routeSource:"google_routes"};
      }
    } catch (e) { console.warn("[auto-taxi-pricing] Google Routes unavailable; using Haversine fallback"); }
  }
  const distanceKm=Math.max(0.1,haversine(from,to)*1.35);
  return {distanceKm:Number(distanceKm.toFixed(3)),durationMin:Number((distanceKm/32*60+3).toFixed(1)),routeSource:"haversine_fallback"};
}
function fare(category:Category,distanceKm:number,durationMin:number,settings:any,tripType:string,extraMinutes:number) {
  const base=Number(settings.base_fare)+distanceKm*Number(settings.per_km_rate)+durationMin*Number(settings.per_min_rate);
  const transition=Math.min(1,Math.max(0,(base-4500)/1000));
  const tier=category==="economy"?1:category==="premium"?(settings.is_intercity?1.05:1.10-0.05*transition):(settings.is_intercity?1.10:1.25-0.15*transition);
  const trip=tripType==="round_trip"?1.8:tripType==="second_trip"?2:1;
  const raw=(tripType==="round_trip"?base*tier*2*0.9:base*tier*trip)+Math.ceil(extraMinutes/5)*500;
  return Math.max(Number(settings.min_fare),Math.ceil(raw/250)*250);
}
Deno.serve(async (req) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"الطريقة غير مدعومة"},405);
  const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service) return json({error:"إعدادات خدمة التسعير غير مكتملة"},503);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer ")) return json({error:"سجّل الدخول أولاً"},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await userClient.auth.getUser();
  if(userError||!user) return json({error:"جلسة الدخول غير صالحة"},401);
  const {data:roles,error:rolesError}=await admin.from("user_roles").select("role").eq("user_id",user.id);
  if(rolesError||!roles?.some((r:any)=>r.role==="customer"))
    return json({error:"إنشاء طلبات التاكسي متاح لحسابات الزبائن فقط"},403);
  const body=await req.json().catch(()=>null);
  if(!body||!validPoint(body.from)||!validPoint(body.to)) return json({error:"إحداثيات الانطلاق والوجهة غير صالحة"},400);
  const rawCategory=typeof body.vehicleCategory==="string"?body.vehicleCategory.trim().toLowerCase():"";
  if(!["economy","premium","luxury"].includes(rawCategory)) {
    console.warn("[auto-taxi-pricing] invalid vehicle category", { action: body.action, category: rawCategory.slice(0,40) || "(missing)" });
    return json({error:"فئة السيارة المرسلة غير مدعومة للتسعير التلقائي",code:"INVALID_VEHICLE_CATEGORY",receivedCategory:rawCategory||null,allowedCategories:["economy","premium","luxury"]},400);
  }
  const category=rawCategory as Category;
  const tripType=["one_way","round_trip","second_trip","stop"].includes(body.tripType)?body.tripType:"one_way";
  const extraMinutes=Number(body.extraMinutes??0);
  if(!Number.isInteger(extraMinutes)||extraMinutes<0||extraMinutes>120||extraMinutes%5!==0) return json({error:"وقت التوقف يجب أن يكون من 0 إلى 120 دقيقة وبفواصل 5 دقائق"},400);
  const routed=await route(body.from,body.to);
  const [fromGovResult,toGovResult]=await Promise.all([admin.rpc("infer_governorate_key",{p_lat:body.from.lat,p_lng:body.from.lng}),admin.rpc("infer_governorate_key",{p_lat:body.to.lat,p_lng:body.to.lng})]);
  const fromGovernorate=fromGovResult.data;
  const toGovernorate=toGovResult.data;
  if(fromGovResult.error||toGovResult.error||!fromGovernorate||!toGovernorate) {
    console.error("[auto-taxi-pricing] governorate lookup failed", { fromCode: fromGovResult.error?.code || null, toCode: toGovResult.error?.code || null, fromFound: !!fromGovernorate, toFound: !!toGovernorate });
    return json({error:"تعذّر التحقق من المحافظتين من إحداثيات الرحلة",code:"GOVERNORATE_LOOKUP_FAILED"},400);
  }
  const isIntercity=fromGovernorate!==toGovernorate;
  const {data:settings,error:settingsError}=await admin.from("pricing_settings").select("*").eq("service_type",category).eq("is_intercity",isIntercity).single();
  if(settingsError||!settings) return json({error:"إعدادات التسعير غير متوفرة حالياً"},503);
  const priceEstimate=fare(category,routed.distanceKm,routed.durationMin,{...settings,is_intercity:isIntercity},tripType,extraMinutes);
  if(body.action==="quote") return json({...routed,priceEstimate,currency:"IQD",vehicleCategory:category});
  if(body.action!=="create") return json({error:"نوع العملية غير مدعوم"},400);
  const governorate=fromGovernorate;
  const couponCode=typeof body.couponCode==="string"&&body.couponCode.trim()?body.couponCode.trim().toUpperCase():null;
  if(couponCode) {
    const {data:preview,error:previewError}=await userClient.rpc("preview_my_coupon",{p_code:couponCode,p_amount:priceEstimate});
    const previewRow=Array.isArray(preview)?preview[0]:preview;
    if(previewError||!previewRow) return json({error:"الكوبون غير متاح لهذا السعر أو لهذا الحساب"},400);
  }
  const insert={
    customer_id:user.id,type:"taxi",status:"pending",governorate_key:governorate,
    coupon_code:null,
    vehicle_category:category,vehicle_type:null,
    pickup_text:String(body.pickupText||"موقع محدد على الخريطة").slice(0,300),
    pickup_lat:body.from.lat,pickup_lng:body.from.lng,
    dest_text:String(body.destinationText||"الوجهة المحددة على الخريطة").slice(0,300),
    dest_lat:body.to.lat,dest_lng:body.to.lng,
    notes:typeof body.notes==="string"?body.notes.slice(0,2000):null,
    distance_km:routed.distanceKm,duration_min:routed.durationMin,
    price_estimate:priceEstimate,is_intercity:isIntercity,trip_type:tripType,extra_minutes:extraMinutes
  };
  const {data:created,error:createError}=await admin.from("service_requests").insert(insert).select("id,coupon_discount,customer_payable,price_estimate,distance_km,duration_min").single();
  if(createError||!created){console.error("[auto-taxi-pricing] request insert failed:",createError?.code||"unknown");return json({error:"تعذّر إنشاء الطلب. تحقق من البيانات وحاول مرة أخرى."},400);}
  let couponResult:any=null;
  let couponWarning:string|null=null;
  if(couponCode) {
    const {data:applied,error:applyError}=await userClient.rpc("apply_coupon_to_existing_request",{p_request_id:created.id,p_code:couponCode});
    if(applyError) couponWarning="تم إنشاء الطلب، لكن تعذّر تطبيق الكوبون. يمكنك متابعة الطلب دون الخصم.";
    else couponResult=applied;
  }
  return json({requestId:created.id,distanceKm:Number(created.distance_km),durationMin:Number(created.duration_min),priceEstimate:Number(created.price_estimate),couponDiscount:Number(couponResult?.discount||0),customerPayable:couponResult?.payable??created.customer_payable??null,couponWarning,routeSource:routed.routeSource});
});
