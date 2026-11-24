import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { getSupabasePublishableKey, getSupabaseSecretKey, createSupabaseFetch } from "../_shared/api-keys.ts";
import boundaries from "./iraq-governorate-boundaries.json" with { type: "json" };
import { calculateServerTaxiFare } from "../_shared/taxi-pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: corsHeaders });
type Category = "economy" | "premium" | "luxury";
type Point = { lat: number; lng: number };
const names: Record<string,string> = {
  baghdad:"Baghdad",basra:"Al-Basrah",nineveh:"Ninawa",erbil:"Erbil",
  sulaymaniyah:"Al-Sulaimaniyah",duhok:"Dohuk",kirkuk:"Kirkuk",najaf:"An-Najaf",
  karbala:"Karbala",babil:"Babil",anbar:"Al-Anbar",diyala:"Diyala",
  saladin:"Salah al-Din",wasit:"Wasit",dhiqar:"Dhi Qar",maysan:"Maysan",
  muthanna:"Al-Muthanna",qadisiyah:"Al-Qadisiyah",
};
const governorates = [
  ["baghdad","بغداد",33.3152,44.3661],["basra","البصرة",30.5085,47.7804],
  ["nineveh","نينوى",36.34,43.13],["erbil","أربيل",36.1911,44.0092],
  ["sulaymaniyah","السليمانية",35.5613,45.4306],["duhok","دهوك",36.8669,42.9503],
  ["kirkuk","كركوك",35.4681,44.3922],["najaf","النجف",32.0259,44.3462],
  ["karbala","كربلاء",32.616,44.0249],["babil","بابل",32.4637,44.4196],
  ["anbar","الأنبار",33.4206,43.3058],["diyala","ديالى",33.7502,44.6066],
  ["saladin","صلاح الدين",34.6,43.68],["wasit","واسط",32.5128,45.8182],
  ["dhiqar","ذي قار",31.0439,46.2573],["maysan","ميسان",31.8356,47.1449],
  ["muthanna","المثنى",31.3099,45.2803],["qadisiyah","القادسية",31.9929,44.925],
] as const;
function validPoint(p: any): p is Point {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
}
function inRing(point: Point, ring: number[][]) {
  let hit=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j]; if(!a||!b) continue;
    if(a[1]>point.lat!==b[1]>point.lat &&
      point.lng<((b[0]-a[0])*(point.lat-a[1]))/(b[1]-a[1])+a[0]) hit=!hit;
  }
  return hit;
}
function featureFor(key:string) {
  const shape=names[key];
  return (boundaries as any).features.find((f:any)=>f.properties?.shapeName===shape);
}
function isInGovernorate(point:Point,key:string) {
  const feature=featureFor(key); if(!feature) return false;
  const rings=feature.geometry.coordinates;
  return !!rings[0] && inRing(point,rings[0]) && !rings.slice(1).some((ring:number[][])=>inRing(point,ring));
}

function governorateKeyFor(point: Point): string | null {
  return governorates.find((item) => isInGovernorate(point, item[0]))?.[0] ?? null;
}

function decodeGooglePolyline(encoded:string):Point[] {
  const points:Point[]=[]; let index=0,lat=0,lng=0;
  while(index<encoded.length) {
    let result=0,shift=0,byte=0;
    do { byte=encoded.charCodeAt(index++)-63; result|=(byte&0x1f)<<shift; shift+=5; } while(byte>=0x20&&index<encoded.length);
    lat+=(result&1)?~(result>>1):(result>>1);
    result=0;shift=0;
    do { byte=encoded.charCodeAt(index++)-63; result|=(byte&0x1f)<<shift; shift+=5; } while(byte>=0x20&&index<encoded.length);
    lng+=(result&1)?~(result>>1):(result>>1);
    points.push({lat:lat/1e5,lng:lng/1e5});
  }
  return points;
}
// Reject provider/cache distances that are physically implausible for the
// submitted endpoints. This is a guardrail, not a replacement for road routing.
function straightLineDistanceKm(from: Point, to: Point) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(to.lat - from.lat);
  const dLng = radians(to.lng - from.lng);
  const lat1 = radians(from.lat);
  const lat2 = radians(to.lat);
  const rawA = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const a = Math.max(0, Math.min(1, rawA));
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function plausibleRoadDistance(from: Point, to: Point, distanceKm: number) {
  const directKm = straightLineDistanceKm(from, to);
  if (!Number.isFinite(directKm) || directKm <= 0 ||
      !Number.isFinite(distanceKm) || distanceKm <= 0) return false;
  const maximumPlausibleKm = Math.max(directKm * 4, directKm + 8, 3);
  return distanceKm >= directKm * 0.95 && distanceKm <= maximumPlausibleKm;
}

async function route(from:Point,to:Point,admin:any) {
  const key=Deno.env.get("GOOGLE_MAPS_API_KEY");
  if(!key) throw new Error("سنصل إليك قريباً. خدمة التحقق من الطريق غير متاحة حالياً.");
  // Use standard routing only. Live traffic and traffic-based pricing are deferred.
  const response=await fetch("https://routes.googleapis.com/directions/v2:computeRoutes",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,
      "X-Goog-FieldMask":"routes.distanceMeters,routes.duration"},
    body:JSON.stringify({
      origin:{location:{latLng:{latitude:from.lat,longitude:from.lng}}},
      destination:{location:{latLng:{latitude:to.lat,longitude:to.lng}}},
      travelMode:"DRIVE",routingPreference:"TRAFFIC_UNAWARE",
      computeAlternativeRoutes:false,
      languageCode:"ar",units:"METRIC"
    }),
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok) throw new Error("سنصل إليك قريباً. تعذّر التحقق من الطريق حالياً.");
  const result=await response.json() as any;
  const selected=(result.routes??[]).find((r:any)=>
    Number.isFinite(r.distanceMeters)&&r.distanceMeters>0&&
    typeof r.duration==="string"&&/^\\d+(\\.\\d+)?s$/.test(r.duration)&&parseFloat(r.duration)>0);
  if(!selected) throw new Error("سنصل إليك قريباً. لم نعثر على طريق سيارة صالح ومؤكد بين الموقعين.");
  const distanceKm=Number(selected.distanceMeters)/1000;
  const durationMin=parseFloat(selected.duration)/60;
  if(!plausibleRoadDistance(from,to,distanceKm)||!Number.isFinite(durationMin)||durationMin<=0) {
    throw new Error("سنصل إليك قريباً. بيانات الطريق أو المسافة غير متطابقة، لذلك لم نعرض سعراً.");
  }
  return { distanceKm,durationMin,routeSource:"google_routes",cacheHit:false };
}

Deno.serve(async (req) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"الطريقة غير مدعومة"},405);
  const url=Deno.env.get("SUPABASE_URL"), anon=getSupabasePublishableKey(), service=getSupabaseSecretKey();
  if(!url||!anon||!service) return json({error:"إعدادات خدمة التسعير غير مكتملة"},503);
  const auth=req.headers.get("Authorization")||"";
  if(!auth.startsWith("Bearer ")) return json({error:"سجّل الدخول أولاً"},401);
  const userClient=createClient(url,anon,{global:{fetch:createSupabaseFetch(anon),headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const admin=createClient(url,service,{global:{fetch:createSupabaseFetch(service)},auth:{persistSession:false,autoRefreshToken:false}});
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
  const allowedTripTypes = ["one_way","round_trip","second_trip","stop"] as const;
  if (body.tripType != null && !allowedTripTypes.includes(body.tripType)) {
    return json({error:"نوع الرحلة غير صالح",code:"INVALID_TRIP_TYPE"},400);
  }
  const tripType = (body.tripType ?? "one_way") as typeof allowedTripTypes[number];
  const extraMinutes=Number(body.extraMinutes??0);
  if(!Number.isInteger(extraMinutes)||extraMinutes<0||extraMinutes>120||extraMinutes%5!==0) return json({error:"وقت التوقف يجب أن يكون من 0 إلى 120 دقيقة وبفواصل 5 دقائق"},400);
  const suppliedPickupKey = typeof body.pickupGovernorateKey === "string"
    ? body.pickupGovernorateKey
    : typeof body.governorateKey === "string" ? body.governorateKey : null;
  const suppliedDestinationKey = typeof body.destinationGovernorateKey === "string"
    ? body.destinationGovernorateKey
    : null;
  // Validate both coordinates against the exact same Iraq governorate polygons
  // used by maps-proxy, then use the same route cache/provider directly. This
  // removes a second Edge Function hop and duplicate auth validation.
  const fromGovernorate = governorateKeyFor(body.from);
  const toGovernorate = governorateKeyFor(body.to);
  if (!fromGovernorate || !toGovernorate) {
    return json({ error: "يجب أن تكون نقطتا الانطلاق والوجهة داخل حدود العراق", code: "ROUTE_VALIDATION_FAILED" }, 400);
  }
  const isIntercity = fromGovernorate !== toGovernorate;
  let routeData: any;
  try {
    routeData = await route(body.from, body.to, admin);
  } catch (error) {
    console.error("[auto-taxi-pricing] driving route unavailable", error instanceof Error ? error.message : "unknown");
    return json({ error: error instanceof Error ? error.message : "تعذّر حساب مسار الطريق", code: "ROUTE_VALIDATION_FAILED" }, 503);
  }
  if (!Number.isFinite(Number(routeData.distanceKm)) || Number(routeData.distanceKm) <= 0 ||
      !Number.isFinite(Number(routeData.durationMin)) || Number(routeData.durationMin) <= 0) {
    return json({ error: "سنصل إليك قريباً. بيانات الطريق أو المسافة غير صالحة، لذلك لم نعرض سعراً.", code: "ROUTE_VALIDATION_FAILED" }, 503);
  }
  if ((suppliedPickupKey && suppliedPickupKey !== fromGovernorate) ||
      (suppliedDestinationKey && suppliedDestinationKey !== toGovernorate)) {
    return json({ error: "المحافظة المحددة لا تطابق موقع الرحلة الفعلي. حدّد المحافظات من جديد." }, 400);
  }
  // Quotes already derive the exact destination governorate from the
  // submitted coordinates. Do not force an extra client lookup before showing
  // the price; request creation still requires the returned exact key.
  if (body.action !== "quote" && isIntercity && !suppliedDestinationKey) {
    return json({ error: "أنت خارج محافظتك، يرجى تحديد المحافظة المراد التوجه إليها." }, 400);
  }
  if (typeof body.isIntercity === "boolean" && body.isIntercity !== isIntercity) {
    return json({ error: "المحافظة المحددة لا تطابق مسار الرحلة. حدّد محافظة الوجهة من جديد." }, 400);
  }
  // This release keeps demand/traffic observation separate from customer pricing.
  // Automatic adjustments are explicitly zero until the user approves a later pricing engine.
  const trafficPercent=0;
  const demandPercent=0;
  const autoPercent=0;
  const routed = {
    distanceKm: Number(routeData.distanceKm),
    durationMin: Number(routeData.durationMin),
    routeSource: String(routeData.routeSource || "maps_proxy"),
    cacheHit: routeData.cacheHit === true,
  };
  // Supabase is the single source of truth for tariffs and fare arithmetic.
  // The private RPC is executable only by service_role; it resolves local then global admin tariffs.
  const {data:quoteData,error:quoteError}=await admin.rpc("calculate_taxi_quote_internal",{
    p_governorate_key:fromGovernorate,
    p_is_intercity:isIntercity,
    p_distance_km:routed.distanceKm,
    p_duration_min:routed.durationMin,
    p_trip_type:tripType,
    p_extra_minutes:extraMinutes,
    p_urgency_enabled:body.urgencyEnabled===true,
    p_auto_percent:autoPercent,
  });
  if(quoteError||!quoteData) {
    console.error("[auto-taxi-pricing] canonical Supabase quote failed",quoteError?.code||"no_quote");
    return json({error:"سنصل إليك قريباً. تعذّر التحقق من السعر المعتمد من الإدارة.",code:"CANONICAL_PRICING_FAILED"},503);
  }
  const categoryPrices=quoteData.categoryPrices as Record<Category,number>;
  const minFares=quoteData.minFares as Record<Category,number>;
  const economyRaw=Number(quoteData.economyRaw);
  const peakPercent=Number(quoteData.peakPercent);
  const regionalPercent=Number(quoteData.regionalPercent);
  const quotedAutoPercent=Number(quoteData.autoPercent);
  const urgencyPercent=Number(quoteData.urgencyPercent);
  if(!categoryPrices||!minFares||!Number.isFinite(economyRaw)||economyRaw<0||
     !Number.isFinite(peakPercent)||peakPercent<0||peakPercent>200||
     !Number.isFinite(regionalPercent)||regionalPercent<0||regionalPercent>200||
     !Number.isFinite(quotedAutoPercent)||quotedAutoPercent < -50 || quotedAutoPercent > 200||
     !Number.isFinite(urgencyPercent)||urgencyPercent<0||urgencyPercent>100||
     !Number.isSafeInteger(Number(categoryPrices.economy))||
     !Number.isSafeInteger(Number(categoryPrices.premium))||
     !Number.isSafeInteger(Number(categoryPrices.luxury))) {
    console.error("[auto-taxi-pricing] canonical quote returned invalid fields");
    return json({error:"سنصل إليك قريباً. بيانات السعر غير مكتملة، لذلك أوقفنا الطلب للحماية.",code:"INVALID_CANONICAL_QUOTE"},503);
  }
  // Independent parity check: if edge and database arithmetic ever diverge,
  // reject the quote rather than show a price that could differ on insert.
  for(const fareCategory of ["economy","premium","luxury"] as Category[]) {
    const minimum=Number(minFares[fareCategory]);
    if(!Number.isFinite(minimum)||minimum<0) {
      return json({error:"سنصل إليك قريباً. تعذّر التحقق من الحد الأدنى للأجرة.",code:"INVALID_CATEGORY_MINIMUM"},503);
    }
    const expected=calculateServerTaxiFare({
      category:fareCategory,economyRaw,minFare:minimum,tripType,extraMinutes,peakPercent,regionalPercent,autoPercent:quotedAutoPercent,urgencyPercent,
    });
    if(expected!==Number(categoryPrices[fareCategory])) {
      console.error("[auto-taxi-pricing] database/edge fare parity mismatch",fareCategory);
      return json({error:"سنصل إليك قريباً. تعذّر مطابقة السعر النهائي، لذلك لم نعرض مبلغاً غير مؤكد.",code:"FARE_PARITY_MISMATCH"},503);
    }
  }
  const priceEstimate=Number(categoryPrices[category]);
  const urgencyAllowed=Boolean(quoteData.urgencyAllowed);
  const urgencyIsEnabled=Boolean(quoteData.urgencyEnabled);
  if(body.action==="quote") return json({...routed,priceEstimate,categoryPrices,currency:"IQD",vehicleCategory:category,peakPercent,regionalPercent,autoPercent:quotedAutoPercent,trafficPercent,demandPercent,urgencyEnabled:urgencyIsEnabled,urgencyAllowed,urgencyPercent,governorateKey:fromGovernorate,fromGovernorateKey:fromGovernorate,toGovernorateKey:toGovernorate,isIntercity});
  if(body.action!=="create") return json({error:"نوع العملية غير مدعوم"},400);
  const expectedPrice=Number(body.expectedPriceEstimate);
  if(!Number.isSafeInteger(expectedPrice)||expectedPrice!==priceEstimate) {
    return json({error:"تغيّر السعر بعد آخر عرض. حدّث السعر وراجعه قبل إرسال الطلب.",code:"FARE_CHANGED",currentPrice:priceEstimate},409);
  }
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
    taxi_auto_percent:quotedAutoPercent,
    taxi_urgency_enabled:urgencyPercent>0,taxi_urgency_percent:urgencyPercent,taxi_peak_percent:peakPercent
  };
  const {data:created,error:createError}=await admin.from("service_requests").insert(insert).select("id,coupon_discount,customer_payable,price_estimate,distance_km,duration_min").single();
  if(createError||!created){console.error("[auto-taxi-pricing] request insert failed:",createError?.code||"unknown");return json({error:"سنصل إليك قريباً. تعذّر اعتماد الطريق والسعر النهائي، ولم نرسل الطلب."},400);}
  let couponResult:any=null;
  let couponWarning:string|null=null;
  if(couponCode) {
    const {data:applied,error:applyError}=await userClient.rpc("apply_coupon_to_existing_request",{p_request_id:created.id,p_code:couponCode});
    if(applyError) couponWarning="تم إنشاء الطلب، لكن تعذّر تطبيق الكوبون. يمكنك متابعة الطلب دون الخصم.";
    else couponResult=applied;
  }
  return json({requestId:created.id,distanceKm:Number(created.distance_km),durationMin:Number(created.duration_min),priceEstimate:Number(created.price_estimate),autoPercent:quotedAutoPercent,trafficPercent,demandPercent,routeSource:routed.routeSource,couponDiscount:Number(couponResult?.discount||0),customerPayable:couponResult?.payable??created.customer_payable??null,couponWarning});
});