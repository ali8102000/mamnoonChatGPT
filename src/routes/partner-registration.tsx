import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { MapPin, Upload, Loader2, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/partner-registration")({ ssr: false, component: PartnerRegistrationPage });
type DocKey = "license" | "idFront" | "idBack";
const TYPES = [{value:"hotel",label:"فندق"},{value:"store",label:"متجر"},{value:"mall",label:"مول"},{value:"company",label:"شركة"},{value:"other",label:"نشاط آخر"}];
const IRAQ_CENTER = {lat:33.3152,lng:44.3661};

function PartnerRegistrationPage(){
  const {user,profile,loading:authLoading}=useAuth();
  const navigate=useNavigate();
  const mapRef=useRef<HTMLDivElement>(null);
  const [kind,setKind]=useState("hotel");
  const [businessName,setBusinessName]=useState("");
  const [licenseNumber,setLicenseNumber]=useState("");
  const [phone,setPhone]=useState(profile?.phone||"");
  const [governorate,setGovernorate]=useState("");
  const [city,setCity]=useState("");
  const [address,setAddress]=useState("");
  const [lat,setLat]=useState(IRAQ_CENTER.lat);
  const [lng,setLng]=useState(IRAQ_CENTER.lng);
  const [files,setFiles]=useState<Partial<Record<DocKey,File>>>({});
  const [status,setStatus]=useState<string|null>(null);
  const [reviewNotes,setReviewNotes]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [mapReady,setMapReady]=useState(false);
  const [mapError,setMapError]=useState("");
  useEffect(()=>{if(!authLoading&&!user)navigate({to:"/auth"});},[authLoading,user,navigate]);
  useEffect(()=>{if(profile?.phone)setPhone(profile.phone);},[profile?.phone]);
  useEffect(()=>{let active=true;(async()=>{
    if(!user?.id)return;
    const {data,error}=await supabase.from("partner_verifications").select("*").eq("user_id",user.id).maybeSingle();
    if(!active)return;
    if(data&&!error){setStatus(data.status);setReviewNotes(data.review_notes);setKind(data.partner_type);setBusinessName(data.business_name);setLicenseNumber(data.license_number);setPhone(data.contact_phone);setGovernorate(data.governorate);setCity(data.city);setAddress(data.business_address);setLat(Number(data.latitude));setLng(Number(data.longitude));}
    setLoading(false);
  })();return()=>{active=false;}},[user?.id]);
  useEffect(()=>{
    if(typeof window==="undefined"||!mapRef.current)return;
    const key=(import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string|undefined;
    if(!key){setMapError("خريطة التحديد غير متاحة حالياً؛ تحقق من إعداد مفتاح الخرائط.");return;}
    const init=()=>{
      if(!active||!mapRef.current||!window.google?.maps)return;
      const map=new window.google.maps.Map(mapRef.current,{center:{lat,lng},zoom:16,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,gestureHandling:"greedy"});
      const marker=new window.google.maps.Marker({position:{lat,lng},map,draggable:true,title:"موقع المنشأة"});
      map.addListener("click",(event:google.maps.MapMouseEvent)=>{if(!event.latLng)return;const point={lat:event.latLng.lat(),lng:event.latLng.lng()};marker.setPosition(point);setLat(point.lat);setLng(point.lng);});
      marker.addListener("dragend",()=>{const point=marker.getPosition();if(point){setLat(point.lat());setLng(point.lng());}});
      setMapReady(true);
    };
    let active=true;
    if(window.google?.maps){init();return()=>{active=false;};}
    const existing=document.getElementById("mamnoon-partner-google-maps") as HTMLScriptElement|null;
    if(existing){existing.addEventListener("load",init,{once:true});return()=>{active=false;existing.removeEventListener("load",init);};}
    const script=document.createElement("script");script.id="mamnoon-partner-google-maps";script.src="https://maps.googleapis.com/maps/api/js?key="+encodeURIComponent(key)+"&v=weekly";script.async=true;script.defer=true;script.onload=init;script.onerror=()=>setMapError("تعذر تحميل خرائط Google.");document.head.appendChild(script);
    return()=>{active=false;};
  },[]);
  async function upload(key:DocKey){
    const file=files[key];if(!file)return null;
    const path=`${user!.id}/partner-registration/${key}-${Date.now()}.${file.name.split(".").pop()?.toLowerCase()||"jpg"}`;
    const {data,error}=await supabase.storage.from("provider-verification").upload(path,file,{contentType:file.type,upsert:false});
    if(error)throw error;return data.path;
  }
  async function submit(e:React.FormEvent){
    e.preventDefault();if(!user)return;
    if(businessName.trim().length<2||licenseNumber.trim().length<2||phone.trim().length<7||governorate.trim().length<2||city.trim().length<2||address.trim().length<5){toast.error("أكمل جميع بيانات المنشأة والترخيص والعنوان");return;}
    if(!files.license||!files.idFront||!files.idBack){toast.error("إجازة العمل وهوية الوجهين مطلوبة");return;}
    if(Object.values(files).some(file=>file&&(file.size>8*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type)))){toast.error("ارفع صور JPG أو PNG أو WebP وبحجم لا يتجاوز 8 ميغابايت");return;}
    setBusy(true);
    try{
      const [license_document_path,id_front_path,id_back_path]=await Promise.all([upload("license"),upload("idFront"),upload("idBack")]);
      const {error}=await supabase.from("partner_verifications").upsert({user_id:user.id,partner_type:kind,business_name:businessName.trim(),license_number:licenseNumber.trim(),contact_phone:phone.trim(),governorate:governorate.trim(),city:city.trim(),business_address:address.trim(),latitude:lat,longitude:lng,license_document_path,id_front_path,id_back_path,status:"pending",review_notes:null,reviewed_by:null,reviewed_at:null},{onConflict:"user_id"});
      if(error)throw error;
      setStatus("pending");setReviewNotes(null);toast.success("تم إرسال طلب الشراكة إلى إدارة ممنون للمراجعة");
    }catch(error:any){toast.error(error?.message||"تعذر إرسال طلب الشراكة");}
    finally{setBusy(false);}
  }
  if(authLoading||loading)return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin"/></div>;
  return <main dir="rtl" className="mx-auto min-h-screen w-full max-w-2xl space-y-5 px-4 py-8">
    <header><h1 className="text-2xl font-black">تسجيل منشأتك كشريك في ممنون</h1><p className="mt-2 text-sm text-muted-foreground">أرسل معلومات المنشأة وإجازة العمل والمستمسكات وحدد موقعها على الخريطة. لا يتم تفعيل الشراكة قبل مراجعة الإدارة.</p></header>
    {status==="approved"&&<div className="rounded-xl bg-emerald-500/10 p-4 text-sm font-bold text-emerald-700">تم اعتماد منشأتك كشريك</div>}
    {status==="pending"&&<div className="rounded-xl bg-amber-500/10 p-4 text-sm font-bold text-amber-700">طلبك قيد المراجعة لدى إدارة ممنون</div>}
    {status==="rejected"&&<div className="rounded-xl bg-red-500/10 p-4 text-sm font-bold text-red-700">الطلب يحتاج تعديل: {reviewNotes||"راجع الإدارة ثم أعد الإرسال"}</div>}
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <label className="block space-y-2"><span className="text-sm font-bold">نوع النشاط</span><select value={kind} onChange={e=>setKind(e.target.value)} className="input-base w-full">{TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
      <Field label="اسم الفندق أو المتجر أو المول" value={businessName} onChange={setBusinessName}/>
      <Field label="رقم إجازة العمل أو الترخيص" value={licenseNumber} onChange={setLicenseNumber}/>
      <Field label="رقم هاتف المنشأة" value={phone} onChange={setPhone} type="tel"/>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="المحافظة" value={governorate} onChange={setGovernorate}/><Field label="المدينة أو القضاء" value={city} onChange={setCity}/></div>
      <Field label="العنوان التفصيلي" value={address} onChange={setAddress}/>
      <section className="space-y-2"><div className="flex items-center gap-2 font-bold"><MapPin size={18}/> دبوس موقع المنشأة</div><p className="text-xs text-muted-foreground">اضغط على الخريطة لوضع الدبوس أو اسحبه إلى مدخل المنشأة.</p><div ref={mapRef} className="h-72 w-full overflow-hidden rounded-xl border border-border bg-muted"/>{mapError&&<p className="text-xs text-amber-700">{mapError}</p>}<p className="text-center text-[11px] text-muted-foreground">{mapReady?"تم تحديد الموقع":"الموقع الافتراضي وسط بغداد — حرّك الدبوس إلى موقع منشأتك"} · {lat.toFixed(6)}, {lng.toFixed(6)}</p></section>
      <section className="space-y-3"><h2 className="font-black">المستندات المطلوبة</h2><DocInput label="إجازة العمل / رخصة النشاط" file={files.license} onChange={file=>setFiles(v=>({...v,license:file}))}/><DocInput label="هوية صاحب المنشأة - الوجه الأمامي" file={files.idFront} onChange={file=>setFiles(v=>({...v,idFront:file}))}/><DocInput label="هوية صاحب المنشأة - الوجه الخلفي" file={files.idBack} onChange={file=>setFiles(v=>({...v,idBack:file}))}/><p className="text-xs text-muted-foreground">المستندات تحفظ في مساحة خاصة ولا تظهر للزبائن، ويطلع عليها الشريك والإدارة المخوّلة فقط.</p></section>
      <Button type="submit" disabled={busy||status==="approved"} className="h-12 w-full font-black">{busy?<><Loader2 className="animate-spin"/> جارٍ إرسال الطلب</>:status==="pending"?"تحديث وإعادة إرسال الطلب":"إرسال طلب اعتماد الشريك"}</Button>
    </form>
  </main>;
}
function Field({label,value,onChange,type="text"}:{label:string;value:string;onChange:(value:string)=>void;type?:string}){return <label className="block space-y-2"><span className="text-sm font-bold">{label}</span><input required type={type} value={value} onChange={e=>onChange(e.target.value)} className="input-base w-full" /></label>}
function DocInput({label,file,onChange}:{label:string;file?:File;onChange:(file?:File)=>void}){return <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border p-3"><span className="min-w-0"><b className="block text-sm">{label}</b><small className="text-muted-foreground">{file?.name||"اختر صورة واضحة (حتى 8 ميغابايت)"}</small></span>{file?<CheckCircle2 className="shrink-0 text-emerald-600"/>:<Upload className="shrink-0"/>}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e=>onChange(e.target.files?.[0])}/></label>}
