import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { getSupabasePublishableKey, getSupabaseSecretKey, createSupabaseFetch } from "./api-keys.ts";
import boundaries from "./iraq-governorate-boundaries.json" with { type: "json" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

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
function governorateOf(point:Point) {
  const exact=governorates.find(g=>isInGovernorate(point,g[0]));
  if(exact) return exact;
  const cos=Math.cos(point.lat*Math.PI/180);
  return governorates.reduce((best,g)=>{
    const d=(point.lat-g[2])**2+((point.lng-g[3])*cos)**2;
    const bd=(point.lat-best[2])**2+((point.lng-best[3])*cos)**2;
    return d<bd?g:best;
  },governorates[0]);
}
function boundsFor(key:string) {
  const feature=featureFor(key); if(!feature) return null;
  const points=feature.geometry.coordinates.flat(1) as number[][];
  return {
    low:{lat:Math.min(...points.map(p=>p[1])),lng:Math.min(...points.map(p=>p[0]))},
    high:{lat:Math.max(...points.map(p=>p[1])),lng:Math.max(...points.map(p=>p[0]))},
  };
}
function normalized(value:string) {
  return value.normalize("NFKC").replace(/[\u064B-\u065F\u0670]/g,"")
    .replace(/[إأآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه")
    .replace(/\s+/g," ").trim().toLocaleLowerCase("ar");
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
async function route(from:Point,to:Point,admin:any,includeGeometry=false) {
  const osrmBase=Deno.env.get("OSRM_ROUTING_URL")?.trim().replace(/\/+$/,"")||"";
  const cacheScope=osrmBase?new URL(osrmBase).host:"google-routes";
  const cacheInput=["mamnoon-driving-route-v1",cacheScope,from.lat.toFixed(6),from.lng.toFixed(6),to.lat.toFixed(6),to.lng.toFixed(6)].join("|");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(cacheInput));
  const routeKey=Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2,"0")).join("");
  const now=new Date().toISOString();
  const {data:cached,error:cacheReadError}=await admin.from("route_distance_cache")
    .select("distance_meters,duration_seconds,route_source")
    .eq("route_key",routeKey).gt("expires_at",now).maybeSingle();
  if(!includeGeometry&&!cacheReadError&&cached&&Number(cached.distance_meters)>0&&Number(cached.duration_seconds)>0) {
    return {distanceKm:Number(cached.distance_meters)/1000,durationMin:Number(cached.duration_seconds)/60,
      routeSource:String(cached.route_source),cacheHit:true};
  }
  if(cacheReadError) console.warn("[route] cache read unavailable",cacheReadError.code||"unknown");

  let routed:{distanceKm:number;durationMin:number;routeSource:string;routePoints?:Point[]}|null=null;
  if(osrmBase) {
    try {
      const url=new URL(osrmBase+"/route/v1/driving/"+from.lng+","+from.lat+";"+to.lng+","+to.lat);
      url.searchParams.set("overview",includeGeometry?"full":"false");
      url.searchParams.set("geometries","geojson");
      url.searchParams.set("alternatives","true");
      url.searchParams.set("steps","false");
      const response=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(5000)});
      if(!response.ok) throw new Error("OSRM HTTP "+response.status);
      const result=await response.json() as any;
      const routes=(result.routes??[]).filter((r:any)=>Number.isFinite(r.distance)&&r.distance>0&&Number.isFinite(r.duration)&&r.duration>0);
      if(result.code!=="Ok"||!routes.length) throw new Error("OSRM returned no valid driving route");
      const selected=routes.reduce((a:any,b:any)=>b.distance<a.distance?b:a);
      routed={distanceKm:selected.distance/1000,durationMin:selected.duration/60,routeSource:"osrm",
        ...(includeGeometry&&Array.isArray(selected.geometry?.coordinates)?{routePoints:selected.geometry.coordinates.map((p:number[])=>({lat:Number(p[1]),lng:Number(p[0])})).filter((p:Point)=>validPoint(p))}:{})};
      if(includeGeometry&&(routed.routePoints?.length??0)<2) routed=null;
    } catch(error) {
      console.warn("[route] configured OSRM unavailable; trying Google Routes",error instanceof Error?error.message:"unknown");
    }
  }

  if(!routed) {
    const key=Deno.env.get("GOOGLE_MAPS_API_KEY");
    if(!key) throw new Error("تعذّر حساب مسافة الطريق الفعلية حالياً. أعد المحاولة لاحقاً.");
    const response=await fetch("https://routes.googleapis.com/directions/v2:computeRoutes",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,
        "X-Goog-FieldMask":includeGeometry?"routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline":"routes.distanceMeters,routes.duration"},
      body:JSON.stringify({
        origin:{location:{latLng:{latitude:from.lat,longitude:from.lng}}},
        destination:{location:{latLng:{latitude:to.lat,longitude:to.lng}}},
        travelMode:"DRIVE",routingPreference:"TRAFFIC_UNAWARE",computeAlternativeRoutes:true,
        languageCode:"ar",units:"METRIC"
      }),
      signal:AbortSignal.timeout(9000)
    });
    if(!response.ok) throw new Error("تعذّر حساب مسافة الطريق الفعلية من خدمة الخرائط. أعد المحاولة.");
    const result=await response.json() as any;
    const routes=(result.routes??[]).filter((r:any)=>Number.isFinite(r.distanceMeters)&&r.distanceMeters>0&&
      typeof r.duration==="string"&&/^\d+(\.\d+)?s$/.test(r.duration)&&parseFloat(r.duration)>0);
    if(!routes.length) throw new Error("لم يتم العثور على طريق سيارة صالح بين النقطتين.");
    const selected=routes.reduce((a:any,b:any)=>b.distanceMeters<a.distanceMeters?b:a);
    routed={distanceKm:selected.distanceMeters/1000,durationMin:parseFloat(selected.duration)/60,routeSource:"google_routes",
      ...(includeGeometry&&typeof selected.polyline?.encodedPolyline==="string"?{routePoints:decodeGooglePolyline(selected.polyline.encodedPolyline)}:{})};
  }

  if(!Number.isFinite(routed.distanceKm)||routed.distanceKm<=0||
     !Number.isFinite(routed.durationMin)||routed.durationMin<=0) {
    throw new Error("خدمة الطرق أعادت مسافة أو مدة غير صالحة. أعد المحاولة.");
  }
  const {error:cacheWriteError}=await admin.from("route_distance_cache").upsert({
    route_key:routeKey,distance_meters:routed.distanceKm*1000,duration_seconds:routed.durationMin*60,
    route_source:routed.routeSource,expires_at:new Date(Date.now()+24*60*60*1000).toISOString()
  },{onConflict:"route_key"});
  if(cacheWriteError) console.warn("[route] cache write unavailable",cacheWriteError.code||"unknown");
  return {...routed,cacheHit:false};
}
async function reverse(point:Point) {
  const url=new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lat",String(point.lat));url.searchParams.set("lon",String(point.lng));url.searchParams.set("lang","ar");
  const response=await fetch(url,{headers:{Accept:"application/geo+json","User-Agent":"Mamnoon/1.0"},
    signal:AbortSignal.timeout(6000)});
  if(!response.ok) return {address:""};
  const p=(await response.json() as any).features?.[0]?.properties??{};
  return {address:[p.name,p.street,p.district,p.city,p.state,p.country].filter(Boolean).join("، ")};
}
async function autocomplete(admin:any,input:string,key:string) {
  const governorate=governorates.find(g=>g[0]===key);
  const bounds=boundsFor(key);
  if(!governorate||!bounds) return json({error:"اختر المحافظة أولاً حتى تظهر اقتراحاتها فقط."},400);
  const q=input.trim(); if(q.length<2) return json({suggestions:[],attribution:"بيانات الأماكن © OpenStreetMap"});
  const [cached,initial]=await Promise.all([
    admin.from("map_place_search_cache").select("expires_at").eq("governorate_key",key).eq("normalized_query",normalized(q)).maybeSingle(),
    admin.rpc("search_map_place_suggestions",{p_governorate_key:key,p_query:q,p_limit:30}),
  ]);
  if(initial.error) throw new Error("تعذّر تحميل اقتراحات الأماكن من قاعدة البيانات.");
  const mapRows=(rows:any[]) => (rows??[]).map(row=>({id:row.id?.startsWith?.("db:")?row.id:"db:"+row.id,
    text:row.name_ar,address:row.address||row.name_ar,coords:{lat:Number(row.latitude),lng:Number(row.longitude)}}));
  const cacheFresh=cached.data?.expires_at&&new Date(cached.data.expires_at).getTime()>Date.now();
  if(!cacheFresh&&(initial.data??[]).length<30) {
    const url=new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q",q);url.searchParams.set("limit","50");url.searchParams.set("countrycode","IQ");
    url.searchParams.set("bbox",[bounds.low.lng,bounds.low.lat,bounds.high.lng,bounds.high.lat].join(","));
    url.searchParams.set("lat",String(governorate[2]));url.searchParams.set("lon",String(governorate[3]));url.searchParams.set("zoom","12");
    try {
      const response=await fetch(url,{headers:{Accept:"application/geo+json","User-Agent":"Mamnoon/1.0"},signal:AbortSignal.timeout(7000)});
      if(response.ok) {
        const features=(await response.json() as any).features??[];
        const rows=features.flatMap((feature:any)=>{
          const c=feature.geometry?.coordinates,p=feature.properties??{};
          if(!Array.isArray(c)||c.length<2) return [];
          const point={lat:Number(c[1]),lng:Number(c[0])};
          if(!validPoint(point)||!isInGovernorate(point,key)) return [];
          const name=[p.name,p.locality,p.suburb,p.city,p.district,p.street].find(v=>typeof v==="string"&&v.trim());
          if(!name) return [];
          const parts=[p.street,p.locality,p.suburb,p.district,p.city,p.county,p.state,p.country].filter(v=>typeof v==="string"&&v.trim());
          return [{governorate_key:key,source:"photon",source_key:"photon:"+(p.osm_type||"P")+":"+(p.osm_id||point.lat.toFixed(6)+":"+point.lng.toFixed(6)),
            name_ar:String(name).trim(),address:[...new Set(parts)].join("، ")||String(name),search_terms:[name,q,normalized(q)].join(" "),
            latitude:point.lat,longitude:point.lng,is_active:true,updated_at:new Date().toISOString()}];
        });
        if(rows.length) {
          const {error}=await admin.from("map_place_suggestions").upsert(rows,{onConflict:"governorate_key,source_key"});
          if(error) console.error("[maps-proxy] suggestions upsert failed",error.code);
        }
        await admin.from("map_place_search_cache").upsert({governorate_key:key,normalized_query:normalized(q),
          expires_at:new Date(Date.now()+(rows.length?7*86400000:300000)).toISOString(),updated_at:new Date().toISOString()},
          {onConflict:"governorate_key,normalized_query"});
      }
    } catch(error) { console.warn("[maps-proxy] Photon unavailable",error instanceof Error?error.message:"unknown"); }
  }
  const {data,error}=await admin.rpc("search_map_place_suggestions",{p_governorate_key:key,p_query:q,p_limit:30});
  if(error) throw new Error("تعذّر تحميل اقتراحات الأماكن.");
  const suggestions=mapRows(data);
  return json({suggestions:suggestions.length?suggestions:mapRows(initial.data).slice(0,30),
    attribution:"بيانات الأماكن © OpenStreetMap"});
}

Deno.serve(async (req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"الطريقة غير مدعومة"},405);
  const url=Deno.env.get("SUPABASE_URL"),anon=getSupabasePublishableKey(),service=getSupabaseSecretKey();
  if(!url||!anon||!service) return json({error:"إعدادات خدمة الخرائط غير مكتملة"},503);
  const auth=req.headers.get("Authorization")||"",token=auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token) return json({error:"سجّل الدخول أولاً."},401);
  const userClient=createClient(url,anon,{global:{fetch:createSupabaseFetch(anon),headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const admin=createClient(url,service,{global:{fetch:createSupabaseFetch(service)},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await userClient.auth.getUser(token);
  if(userError||!user) return json({error:"انتهت جلسة الدخول. سجّل الدخول مرة ثانية."},401);
  const body=await req.json().catch(()=>null);
  if(!body||typeof body.action!=="string") return json({error:"بيانات طلب الخرائط غير صحيحة."},400);
  const action=body.action;
  try {
    if(action==="autocomplete") {
      if(typeof body.input!=="string"||body.input.trim().length<2||body.input.length>160||
        typeof body.governorateKey!=="string") return json({error:"بيانات البحث غير صحيحة."},400);
      return await autocomplete(admin,body.input,body.governorateKey);
    }
    if(action==="details") {
      if(typeof body.placeId!=="string"||body.placeId.length>320||!/^(db:)?[A-Za-z0-9_-]+$/.test(body.placeId))
        return json({error:"معرّف المكان غير صحيح."},400);
      if(body.placeId.startsWith("db:")) {
        const {data,error}=await admin.from("map_place_suggestions").select("name_ar,address,latitude,longitude")
          .eq("id",body.placeId.slice(3)).maybeSingle();
        if(error||!data) return json({error:"لم يتم العثور على المكان المحفوظ."},404);
        return json({coords:{lat:Number(data.latitude),lng:Number(data.longitude)},address:data.address||data.name_ar});
      }
      const key=Deno.env.get("GOOGLE_MAPS_API_KEY");
      if(!key) return json({error:"تفاصيل Google Places غير مهيأة؛ اختر اقتراحاً محفوظاً أو جرّب لاحقاً."},503);
      const url=new URL("https://places.googleapis.com/v1/places/"+encodeURIComponent(body.placeId));
      url.searchParams.set("languageCode","ar");
      if(typeof body.sessionToken==="string") url.searchParams.set("sessionToken",body.sessionToken);
      const response=await fetch(url,{headers:{"X-Goog-Api-Key":key,"X-Goog-FieldMask":"location,formattedAddress,displayName"}});
      if(!response.ok) return json({error:"تعذّر جلب تفاصيل المكان من Google."},502);
      const result=await response.json() as any;
      if(!result.location) return json({error:"لا يتوفر موقع لهذا المكان."},404);
      return json({coords:{lat:result.location.latitude,lng:result.location.longitude},
        address:result.formattedAddress||result.displayName?.text||""});
    }
    if(action==="reverse") {
      if(!validPoint(body.center)) return json({error:"الإحداثيات غير صحيحة."},400);
      return json(await reverse(body.center));
    }
    if(action==="detectGovernorate") {
      if(!validPoint(body.center)) return json({error:"الإحداثيات غير صحيحة."},400);
      const g=governorateOf(body.center);return json({key:g[0],name:g[1]});
    }
    if(action==="validateGovernorate") {
      if(!validPoint(body.center)||typeof body.governorateKey!=="string"||!names[body.governorateKey])
        return json({error:"المحافظة أو الإحداثيات غير صحيحة."},400);
      return json({valid:isInGovernorate(body.center,body.governorateKey)});
    }
    if(action==="route") {
      if(!validPoint(body.from)||!validPoint(body.to)) return json({error:"إحداثيات الطريق غير صحيحة."},400);
      const from=governorates.find(g=>isInGovernorate(body.from,g[0]));
      const to=governorates.find(g=>isInGovernorate(body.to,g[0]));
      if(!from||!to) return json({error:"يجب أن تكون نقطتا الانطلاق والوجهة داخل حدود العراق."},400);
      return json({...await route(body.from,body.to,admin,body.includeGeometry===true),fromGovernorateKey:from[0],toGovernorateKey:to[0],isIntercity:from[0]!==to[0]});
    }
    if(action==="createTaxiRequest") {
      return json({error:"إنشاء طلب التاكسي يجب أن يمر عبر auto-taxi-pricing لضمان احتساب الأجرة والكوبون والتحقق من الطلب."},410);
    }
    return json({error:"نوع طلب الخرائط غير مدعوم."},400);
  } catch(error) {
    console.error("[maps-proxy] request failed",error instanceof Error?error.message:"unknown");
    return json({error:error instanceof Error?error.message:"تعذّر تنفيذ طلب الخرائط."},500);
  }
});
