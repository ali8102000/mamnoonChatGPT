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
function fare(
  category: Category,
  economyRaw: number,
  settings: any,
  tripType: string,
  extraMinutes: number,
  peakPercent: number,
  urgencyPercent: number,
) {
  const tierPercent = category === "economy"
    ? 0
    : category === "premium"
      ? (economyRaw < 10000 ? 20 : economyRaw <= 50000 ? 15 : 5)
      : (economyRaw < 10000 ? 40 : economyRaw <= 50000 ? 25 : 10);
  const tripMultiplier = tripType === "round_trip" ? 1.8 : tripType === "second_trip" ? 2 : 1;
  const extraFare = Math.ceil(extraMinutes / 5) * 500;
  // The 1,000 IQD minimum is a floor, not a surcharge. When the raw
  // economy calculation is below it, category percentages start from 1,000.
  const pricingEconomyBase = Math.max(1000, economyRaw);
  let raw = pricingEconomyBase * (1 + tierPercent / 100) * tripMultiplier + extraFare;
  if (tripType === "round_trip") raw = pricingEconomyBase * (1 + tierPercent / 100) * 2 * 0.9 + extraFare;
  raw *= 1 + peakPercent / 100;
  raw *= 1 + urgencyPercent / 100;
  return Math.max(1000, Number(settings.min_fare) || 0, Math.round(raw / 250) * 250);
}
Deno.serve(async (req) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"الطريقة غير مدعومة"},405);
  const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service) return json({error:"إعدادات خدمة التسعير غير مكتملة"},503);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer ")) return json({error:"سجّل الدخول أولاً"},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  // Edge Functions have no browser session storage: validate the bearer token explicitly.
  const {data:{user},error:userError}=await userClient.auth.getUser(auth.slice(7));
  if(userError||!user) {
    console.error("[auto-taxi-pricing] bearer validation failed", userError?.code || "no_user", userError?.message || "");
    return json({error:"انتهت جلسة الدخول أو تعذّر التحقق منها. سجّل الدخول مجدداً وحاول.",code:"AUTH_SESSION_INVALID"},401);
  }
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
  const suppliedPickupKey = typeof body.pickupGovernorateKey === "string"
    ? body.pickupGovernorateKey
    : typeof body.governorateKey === "string" ? body.governorateKey : null;
  const suppliedDestinationKey = typeof body.destinationGovernorateKey === "string"
    ? body.destinationGovernorateKey
    : null;
  // Use the same polygon-validated route service as the map UI. Never trust
  // client-supplied governorate names for intercity pricing.
  const routeResponse = await fetch(`${url.replace(/\\/+$/, "")}/functions/v1/maps-proxy`, {
    method: "POST",
    headers: { Authorization: auth, apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "route", from: body.from, to: body.to }),
    signal: AbortSignal.timeout(15000),
  });
  const routeData = await routeResponse.json().catch(() => null) as any;
  if (!routeResponse.ok || !routeData) {
    const status = routeResponse.status >= 400 && routeResponse.status < 500 ? routeResponse.status : 503;
    return json({ error: routeData?.error || "تعذّر التحقق من مسار الرحلة داخل العراق", code: "ROUTE_VALIDATION_FAILED" }, status);
  }
  const fromGovernorate = typeof routeData.fromGovernorateKey === "string" ? routeData.fromGovernorateKey : "";
  const toGovernorate = typeof routeData.toGovernorateKey === "string" ? routeData.toGovernorateKey : "";
  const isIntercity = routeData.isIntercity === true;
  if (!fromGovernorate || !toGovernorate || typeof routeData.isIntercity !== "boolean" ||
      !Number.isFinite(Number(routeData.distanceKm)) || Number(routeData.distanceKm) <= 0 ||
      !Number.isFinite(Number(routeData.durationMin)) || Number(routeData.durationMin) <= 0) {
    return json({ error: "أعادت خدمة الخرائط بيانات مسار غير صالحة", code: "ROUTE_VALIDATION_FAILED" }, 503);
  }
  if ((suppliedPickupKey && suppliedPickupKey !== fromGovernorate) ||
      (suppliedDestinationKey && suppliedDestinationKey !== toGovernorate)) {
    return json({ error: "المحافظة المحددة لا تطابق موقع الرحلة الفعلي. حدّد المحافظات من جديد." }, 400);
  }
  if (isIntercity && !suppliedDestinationKey) {
    return json({ error: "أنت خارج محافظتك، يرجى تحديد المحافظة المراد التوجه إليها." }, 400);
  }
  if (typeof body.isIntercity === "boolean" && body.isIntercity !== isIntercity) {
    return json({ error: "المحافظة المحددة لا تطابق مسار الرحلة. حدّد محافظة الوجهة من جديد." }, 400);
  }
  const routed = {
    distanceKm: Number(routeData.distanceKm),
    durationMin: Number(routeData.durationMin),
    routeSource: String(routeData.routeSource || "maps_proxy"),
    cacheHit: routeData.cacheHit === true,
  };
  // Read through the authenticated customer session: pricing_settings grants
  // SELECT to authenticated only. Keep service-role access for request creation.
  const {data:settingsRows,error:settingsError}=await userClient.from("pricing_settings").select("*")
    .in("governorate_key",["all",fromGovernorate])
    .in("service_type",["economy","premium","luxury"]).eq("is_intercity",isIntercity);
  if(settingsError||!settingsRows?.length) {
    console.error("[auto-taxi-pricing] pricing settings lookup failed", settingsError?.code || "no_row");
    return json({error:"تعذّر قراءة تعريفة السيارة حالياً",code:"PRICING_SETTINGS_READ_FAILED"},503);
  }
  const effectiveSettings=(serviceType:string)=>settingsRows.find((row:any)=>row.service_type===serviceType&&row.governorate_key===fromGovernorate)
    ||settingsRows.find((row:any)=>row.service_type===serviceType&&row.governorate_key==="all");
  const settings=effectiveSettings(category);
  const economySettings=effectiveSettings("economy");
  if(!settings||!economySettings) {
    console.error("[auto-taxi-pricing] category pricing row missing",category,isIntercity);
    return json({error:"تعذّر قراءة تعريفة السيارة المختارة",code:"PRICING_SETTINGS_READ_FAILED"},503);
  }
  const {data:controlRows,error:controlError}=await userClient.from("taxi_pricing_controls")
    .select("governorate_key,peak_enabled,peak_percent,urgency_enabled,urgency_max_percent")
    .in("governorate_key",["all",fromGovernorate]);
  if(controlError) {
    console.error("[auto-taxi-pricing] controls lookup failed",controlError.code||"unknown");
    return json({error:"تعذّر قراءة إعدادات الذروة والاستعجال",code:"TAXI_CONTROLS_READ_FAILED"},503);
  }
  const globalControls=controlRows?.find((r:any)=>r.governorate_key==="all");
  const regionalControls=controlRows?.find((r:any)=>r.governorate_key===fromGovernorate)||globalControls;
  const peakPercent=regionalControls?.peak_enabled
    ? Math.max(0,Math.min(200,Number(regionalControls.peak_percent)||0)) : 0;
  const urgencyEnabled=body.urgencyEnabled===true && globalControls?.urgency_enabled===true;
  const urgencyPercent=urgencyEnabled
    ? Math.max(0,Math.min(100,Number(globalControls?.urgency_max_percent)||0)) : 0;
  const economyRaw=Number(economySettings.base_fare)+routed.distanceKm*Number(economySettings.per_km_rate)+routed.durationMin*Number(economySettings.per_min_rate);
  const effectiveRows=(["economy","premium","luxury"] as Category[]).map((serviceType)=>effectiveSettings(serviceType)).filter(Boolean);
  const categoryPrices=Object.fromEntries(effectiveRows.map((row:any)=>{
    // The quote returns all three category prices in one request. Apply the
    // same customer-selected urgency setting to every displayed category so
    // changing the vehicle card does not require another route/pricing call.
    return [row.service_type,fare(row.service_type as Category,economyRaw,{...row,is_intercity:isIntercity},tripType,extraMinutes,peakPercent,urgencyPercent)];
  })) as Record<Category,number>;
  const priceEstimate=categoryPrices[category];
  if(body.action==="quote") return json({...routed,priceEstimate,categoryPrices,currency:"IQD",vehicleCategory:category,peakPercent,urgencyEnabled:urgencyPercent>0,urgencyAllowed:Boolean(globalControls?.urgency_enabled && Number(globalControls?.urgency_max_percent)>0),urgencyPercent,governorateKey:fromGovernorate,fromGovernorateKey:fromGovernorate,toGovernorateKey:toGovernorate,isIntercity});
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
    price_estimate:priceEstimate,is_intercity:isIntercity,trip_type:tripType,extra_minutes:extraMinutes,
    taxi_urgency_enabled:urgencyPercent>0,taxi_urgency_percent:urgencyPercent,taxi_peak_percent:peakPercent
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