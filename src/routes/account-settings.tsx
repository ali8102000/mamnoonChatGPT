import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeftRight, UserRound, CarFront, Wrench, Mail, Phone, ShieldCheck, Truck, MapPin, Upload } from "lucide-react";

export const Route = createFileRoute("/account-settings")({ ssr: false, component: AccountSettingsPage });

function AccountSettingsPage() {
  const { session, profile, refresh, loading, roles, activeRole, setActiveRole } = useAuth();
  const navigate = useNavigate();
  const actualEmail = (() => { const candidate = String(session?.user.email ?? "").trim().toLowerCase(); return candidate && !/^phone\d+@mamnoon\.app$/.test(candidate) ? candidate : ""; })();
  const [email, setEmail] = useState(actualEmail);
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [otp, setOtp] = useState("");
  const [phonePending, setPhonePending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [companyName, setCompanyName] = useState("شركة ممنون");
  const [partnerFormOpen, setPartnerFormOpen] = useState(false);
  const [partnerType, setPartnerType] = useState<"hotel" | "restaurant" | "store" | "mall">("hotel");
  const [partnerName, setPartnerName] = useState("");
  const [partnerContact, setPartnerContact] = useState(profile?.full_name ?? "");
  const [partnerPhone, setPartnerPhone] = useState(profile?.phone ?? "");
  const [partnerEmail, setPartnerEmail] = useState(actualEmail);
  const [partnerGovernorate, setPartnerGovernorate] = useState("najaf");
  const [partnerCity, setPartnerCity] = useState("");
  const [partnerAddress, setPartnerAddress] = useState("");
  const [partnerDescription, setPartnerDescription] = useState("");
  const [partnerLicenseNumber, setPartnerLicenseNumber] = useState("");
  const [partnerLicenseFile, setPartnerLicenseFile] = useState<File | null>(null);
  const [partnerIdFrontFile, setPartnerIdFrontFile] = useState<File | null>(null);
  const [partnerIdBackFile, setPartnerIdBackFile] = useState<File | null>(null);
  const [partnerLat, setPartnerLat] = useState(32.0000);
  const [partnerLng, setPartnerLng] = useState(44.3300);
  const [partnerPlaceQuery, setPartnerPlaceQuery] = useState("");
  const [partnerMapBusy, setPartnerMapBusy] = useState(false);
  const [partnerLocationSelected, setPartnerLocationSelected] = useState(false);
  const partnerMapRef = useRef<HTMLDivElement>(null);
  const partnerMoveMapRef = useRef<((lat: number, lng: number) => void) | null>(null);
  const [partnerApplications, setPartnerApplications] = useState<any[]>([]);
  const [partnerBusy, setPartnerBusy] = useState(false);
  const governorateLabels: Record<string,string> = {baghdad:"بغداد",basra:"البصرة",nineveh:"نينوى",erbil:"أربيل",sulaymaniyah:"السليمانية",duhok:"دهوك",kirkuk:"كركوك",najaf:"النجف",karbala:"كربلاء",babil:"بابل",anbar:"الأنبار",diyala:"ديالى",saladin:"صلاح الدين",wasit:"واسط",dhiqar:"ذي قار",maysan:"ميسان",muthanna:"المثنى",qadisiyah:"القادسية"};

  const isCompanyAdmin = session?.user.email?.toLowerCase() === "a7md0555666@gmail.com" && roles.includes("super_admin");

  useEffect(() => { setEmail(actualEmail); }, [actualEmail]);
  useEffect(() => { if (new URLSearchParams(window.location.search).get("partner") === "1") setPartnerFormOpen(true); }, []);
  useEffect(() => {
    if (!session?.user.id) return;
    void loadPartnerApplications();
  }, [session?.user.id]);

  useEffect(() => {
    if (!partnerFormOpen || !partnerMapRef.current) return;
    const key = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    let active = true;
    const initializeLeaflet = () => {
      const L = (window as any).L;
      if (!active || !partnerMapRef.current || !L) return;
      const center: [number, number] = [partnerLat, partnerLng];
      const map = L.map(partnerMapRef.current, { scrollWheelZoom: true }).setView(center, 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
      const marker = L.marker(center, { draggable: true }).addTo(map);
      partnerMoveMapRef.current = (lat, lng) => { map.setView([lat, lng], 16); marker.setLatLng([lat, lng]); };
      map.on("click", (event: any) => { marker.setLatLng(event.latlng); setPartnerLat(event.latlng.lat); setPartnerLng(event.latlng.lng); setPartnerLocationSelected(true); });
      marker.on("dragend", () => { const point = marker.getLatLng(); setPartnerLat(point.lat); setPartnerLng(point.lng); setPartnerLocationSelected(true); });
    };
    if (!key) {
      if (!(window as any).L) {
        if (!document.getElementById("mamnoon-leaflet-css")) { const link = document.createElement("link"); link.id = "mamnoon-leaflet-css"; link.rel = "stylesheet"; link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(link); }
        const script = document.createElement("script"); script.id = "mamnoon-leaflet-js"; script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; script.onload = initializeLeaflet; document.head.appendChild(script);
      } else initializeLeaflet();
      return () => { active = false; };
    }
    const initialize = () => {
      if (!active || !partnerMapRef.current || !window.google?.maps) return;
      const center = { lat: partnerLat, lng: partnerLng };
      const map = new window.google.maps.Map(partnerMapRef.current, { center, zoom: 16, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: "greedy" });
      const marker = new window.google.maps.Marker({ position: center, map, draggable: true, title: partnerName || "موقع المنشأة" });
      partnerMoveMapRef.current = (lat, lng) => { const point = { lat, lng }; map.setCenter(point); marker.setPosition(point); };
      map.addListener("click", (event: google.maps.MapMouseEvent) => { if (!event.latLng) return; const point = { lat: event.latLng.lat(), lng: event.latLng.lng() }; marker.setPosition(point); setPartnerLat(point.lat); setPartnerLng(point.lng); setPartnerLocationSelected(true); });
      marker.addListener("dragend", () => { const point = marker.getPosition(); if (point) { setPartnerLat(point.lat()); setPartnerLng(point.lng()); setPartnerLocationSelected(true); } });
    };
    if (window.google?.maps) initialize();
    else {
      const existing = document.getElementById("mamnoon-partner-map") as HTMLScriptElement | null;
      if (existing) existing.addEventListener("load", initialize, { once: true });
      else { const script = document.createElement("script"); script.id = "mamnoon-partner-map"; script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&v=weekly"; script.async = true; script.defer = true; script.onload = initialize; document.head.appendChild(script); }
    }
    return () => { active = false; };
  }, [partnerFormOpen]);
  async function loadPartnerApplications() {
    if (!session?.user.id) return;
    const { data, error } = await (supabase as any).from("partner_applications")
      .select("id,partner_type,business_name,status,admin_note,created_at,license_number,business_latitude,business_longitude")
      .eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(10);
    if (error) { console.warn("[partner-applications] load failed:", error.message); return; }
    setPartnerApplications(data ?? []);
  }

  function setPartnerBusinessPoint(lat: number, lng: number) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    setPartnerLat(lat); setPartnerLng(lng); setPartnerLocationSelected(true);
    partnerMoveMapRef.current?.(lat, lng);
  }

  async function locatePartnerBusiness() {
    if (!navigator.geolocation) { toast.error("المتصفح لا يدعم تحديد الموقع"); return; }
    setPartnerMapBusy(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
      );
      setPartnerBusinessPoint(position.coords.latitude, position.coords.longitude);
    } catch (error: any) {
      toast.error(error?.code === 1 ? "اسمح للمتصفح بالوصول إلى الموقع" : "تعذر تحديد الموقع الحالي");
    } finally { setPartnerMapBusy(false); }
  }

  async function searchPartnerBusiness() {
    const query = partnerPlaceQuery.trim();
    if (query.length < 3) { toast.error("اكتب اسم المنطقة أو الشارع أولاً"); return; }
    setPartnerMapBusy(true);
    try {
      const fullQuery = [query, partnerCity.trim(), governorateLabels[partnerGovernorate], "Iraq"].filter(Boolean).join(", ");
      const response = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(fullQuery));
      if (!response.ok) throw new Error("تعذر البحث عن المكان");
      const results = await response.json();
      if (!Array.isArray(results) || !results[0]) throw new Error("ما لكيت المكان، جرّب اسم منطقة أو شارع أوضح");
      setPartnerBusinessPoint(Number(results[0].lat), Number(results[0].lon));
    } catch (error: any) {
      toast.error(error?.message || "تعذر البحث عن المكان");
    } finally { setPartnerMapBusy(false); }
  }

  async function submitPartnerApplication(event: React.FormEvent) {
    event.preventDefault();
    if (!session?.user.id) return;
    if (partnerName.trim().length < 2 || partnerContact.trim().length < 2 || partnerPhone.trim().length < 7 || partnerCity.trim().length < 2 || partnerAddress.trim().length < 4 || partnerLicenseNumber.trim().length < 2) {
      toast.error("كمّل اسم المنشأة واسم المسؤول والهاتف ورقم الإجازة والمحافظة والمدينة والعنوان"); return;
    }
    if (!partnerLocationSelected) { toast.error("حدد موقع المنشأة على الخريطة قبل إرسال الطلب"); return; }
    const docs = [partnerLicenseFile, partnerIdFrontFile, partnerIdBackFile];
    if (docs.some(file => !file)) { toast.error("إجازة العمل وصورتي هوية الوجهين مطلوبة"); return; }
    if (docs.some(file => file && (file.size > 8 * 1024 * 1024 || !["image/jpeg","image/png","image/webp"].includes(file.type)))) { toast.error("ارفع صور JPG أو PNG أو WebP وبحجم لا يتجاوز 8 ميغابايت لكل مستند"); return; }
    setPartnerBusy(true);
    try {
      const uploadPartnerDoc = async (file: File, key: string) => {
        const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = session.user.id + "/partner-applications/" + key + "-" + Date.now() + "-" + Math.random().toString(36).slice(2,8) + "." + extension;
        const { data, error } = await supabase.storage.from("provider-verification").upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error; return data.path;
      };
      const [license_document_path, id_front_path, id_back_path] = await Promise.all([uploadPartnerDoc(partnerLicenseFile!, "license"), uploadPartnerDoc(partnerIdFrontFile!, "id-front"), uploadPartnerDoc(partnerIdBackFile!, "id-back")]);
      const { error } = await (supabase as any).from("partner_applications").insert({
        user_id: session.user.id,
        partner_type: partnerType,
        business_name: partnerName.trim(),
        contact_name: partnerContact.trim(),
        phone: partnerPhone.trim(),
        email: partnerEmail.trim() || null,
        governorate_key: partnerGovernorate,
        city: partnerCity.trim(),
        address: partnerAddress.trim(),
        description: partnerDescription.trim() || null,
        mall_unit_type: partnerType === "store" ? "shop" : partnerType === "mall" ? "mall" : null,
        license_number: partnerLicenseNumber.trim(),
        license_document_path, id_front_path, id_back_path,
        business_latitude: partnerLat, business_longitude: partnerLng
      });
      if (error) throw error;
      toast.success("وصل طلب الشراكة للإدارة وبانتظار المراجعة");
      setPartnerFormOpen(false);
      setPartnerLocationSelected(false); setPartnerPlaceQuery("");
      setPartnerName(""); setPartnerCity(""); setPartnerAddress(""); setPartnerDescription(""); setPartnerLicenseNumber(""); setPartnerLicenseFile(null); setPartnerIdFrontFile(null); setPartnerIdBackFile(null);
      await loadPartnerApplications();
    } catch (error: any) {
      toast.error(error?.message || "تعذر إرسال طلب الشراكة");
    } finally { setPartnerBusy(false); }
  }


  useEffect(() => {
    if (!isCompanyAdmin) return;
    (supabase as any).from("company_settings").select("company_name").eq("id", 1).maybeSingle()
      .then(({ data }: any) => { if (data?.company_name) setCompanyName(data.company_name); });
  }, [isCompanyAdmin]);

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;
  const currentUser = session.user;

  async function saveCompanyName() {
    const next = companyName.trim().replace(/\s+/g, " ");
    if (next.length < 2 || next.length > 60) { toast.error("اسم الشركة لازم يكون بين حرفين و60 حرفاً"); return; }
    if (!isCompanyAdmin) { toast.error("هذه الصلاحية لحساب مالك شركة ممنون فقط"); return; }
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("company_settings")
        .upsert({ id: 1, company_name: next, updated_by: currentUser.id }, { onConflict: "id" });
      if (error) throw error;
      toast.success("تم تحديث اسم الشركة الظاهر للمستخدمين");
    } catch (e) { toast.error(e instanceof Error ? e.message : "تعذر تحديث اسم الشركة"); }
    finally { setBusy(false); }
  }

  async function changeEmail() {
    const next = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { toast.error("أدخل بريداً إلكترونياً صحيحاً"); return; }
    if (next === actualEmail) { toast.error("هذا هو بريدك الحالي"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: next }, { emailRedirectTo: `${window.location.origin}/auth/callback` });
      if (error) throw error;
      toast.success("أرسلنا رابط تأكيد إلى البريد الجديد. لن يتغير بريد الحساب قبل الضغط على الرابط.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "تعذر تغيير البريد"); }
    finally { setBusy(false); }
  }

  async function requestPhoneChange() {
    if (!isValidPhone(phone)) { toast.error("رقم الهاتف غير صحيح"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ phone: normalizePhone(phone) });
      if (error) throw error;
      setPhonePending(true);
      toast.success("أرسلنا رمز SMS إلى الرقم الجديد");
    } catch (e) { toast.error(e instanceof Error ? e.message : "تعذر إرسال رمز SMS. تحقق من إعدادات SMS في Supabase."); }
    finally { setBusy(false); }
  }

  async function verifyPhone() {
    if (!otp.trim()) { toast.error("أدخل رمز التحقق"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: normalizePhone(phone), token: otp.trim(), type: "phone_change" });
      if (error) throw error;
      await refresh();
      setPhonePending(false); setOtp("");
      toast.success("تم تأكيد رقم الهاتف وتحديثه");
    } catch (e) { toast.error(e instanceof Error ? e.message : "رمز التحقق غير صحيح"); }
    finally { setBusy(false); }
  }

  const roleItems = [
    { role: "customer", title: "زبون", subtitle: "اطلب التكسي والخدمات المنزلية", icon: UserRound, style: "bg-sky-500/10 border-sky-500/20 text-sky-700 dark:text-sky-300" },
    { role: "driver", title: "سائق تكسي", subtitle: "التسجيل لاستقبال طلبات الرحلات", icon: CarFront, style: "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300" },
    { role: "large_driver", title: "سائق سيارات كبيرة", subtitle: "كيا حمل أو كيا ركاب أو باص", icon: Truck, style: "bg-orange-500/10 border-orange-500/20 text-orange-700 dark:text-orange-300" },
    { role: "worker", title: "فني", subtitle: "التسجيل لتقديم الخدمات للعملاء", icon: Wrench, style: "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300" },
  ];

  return <main dir="rtl" className="min-h-screen max-w-lg mx-auto px-4 pt-5 pb-10">
    <header className="flex items-center gap-3 mb-6">
      <button onClick={() => navigate({ to: "/profile" })} aria-label="رجوع" className="h-10 w-10 rounded-2xl bg-muted/70 grid place-items-center">
        <ArrowRight className="h-5 w-5" />
      </button>
      <div>
        <h1 className="text-xl font-black">الإعدادات</h1>
        <p className="text-xs text-muted-foreground mt-0.5">كل أمور حسابك بمكان واحد</p>
      </div>
    </header>

    {roles.some(role => ["worker", "driver", "large_driver"].includes(role)) && <section className="mb-6">
      <div className="flex items-center gap-3 mb-3 px-1">
        <span className="h-11 w-11 shrink-0 rounded-2xl bg-gradient-to-br from-primary to-primary-glow text-white shadow-lg grid place-items-center">
          <ArrowLeftRight className="h-5 w-5" strokeWidth={2.4} />
        </span>
        <div>
          <h2 className="font-black text-sm">تبديل الدور</h2>
          <p className="text-[10px] text-muted-foreground mt-1">بدّل بين الأدوار المرتبطة بحسابك</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {roleItems.filter(item => roles.includes(item.role as any)).map(item => {
          const Icon = item.icon;
          const selected = activeRole === item.role;
          return <button key={item.role} type="button" onClick={() => {
            setActiveRole(item.role as any);
            navigate({ to: "/home" });
            toast.success("تم التبديل إلى دور " + item.title);
          }} className={`relative min-h-[112px] rounded-3xl border p-4 text-right transition active:scale-[0.98] ${item.style} ${selected ? "ring-2 ring-primary shadow-md" : "opacity-90"}`}>
            {selected && <span className="absolute left-3 top-3 rounded-full bg-primary text-primary-foreground px-2 py-0.5 text-[9px] font-bold">الحالي</span>}
            <span className="h-10 w-10 rounded-2xl bg-white/60 dark:bg-black/10 grid place-items-center mb-3"><Icon className="h-5 w-5" /></span>
            <span className="block text-sm font-black">{item.title}</span>
            <span className="block text-[10px] opacity-75 mt-1">التبديل إلى هذا الدور</span>
          </button>;
        })}
      </div>
    </section>}

    <section className="mb-6 rounded-3xl border border-amber-500/25 bg-card/75 p-4 shadow-soft">
      <div className="flex items-center gap-3 mb-3">
        <span className="h-11 w-11 shrink-0 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md grid place-items-center"><ShieldCheck className="h-5 w-5" /></span>
        <div><h2 className="font-black text-sm">انضم كشريك</h2><p className="text-[10px] text-muted-foreground mt-1">قدّم طلباً واحداً واختر نوع منشأتك، والإدارة تراجع بياناتك قبل التفعيل.</p></div>
      </div>
      <button type="button" onClick={() => setPartnerFormOpen(v => !v)} className="w-full rounded-2xl bg-primary text-primary-foreground p-4 text-sm font-black shadow-md">
        {partnerFormOpen ? "إغلاق تسجيل الشريك" : "انضم كشريك"}
      </button>
      {partnerFormOpen && <form onSubmit={submitPartnerApplication} className="mt-4 space-y-3 rounded-2xl border border-border bg-background/70 p-3">
        <div className="text-xs font-black">اختار نوع الشراكة</div>
        <div className="grid grid-cols-2 gap-2">
          {([{value:"hotel",label:"شريك فندق",mark:"🏨"},{value:"restaurant",label:"شريك مطعم",mark:"🍽️"},{value:"store",label:"شريك محل",mark:"🏪"},{value:"mall",label:"شريك مول",mark:"🏬"}] as const).map(item => <button key={item.value} type="button" onClick={() => setPartnerType(item.value)} className={`rounded-xl border p-3 text-xs font-black ${partnerType===item.value?"border-primary bg-primary/10 text-primary":"border-border bg-card"}`}><span className="block text-xl mb-1">{item.mark}</span>{item.label}</button>)}
        </div>
        <label className="block text-xs font-bold">اسم المنشأة<input required minLength={2} maxLength={120} value={partnerName} onChange={e=>setPartnerName(e.target.value)} className="input-base mt-1 w-full rounded-xl" placeholder="اسم الفندق أو المطعم أو المحل" /></label>
        <label className="block text-xs font-bold">اسم الشخص المسؤول<input required minLength={2} maxLength={100} value={partnerContact} onChange={e=>setPartnerContact(e.target.value)} className="input-base mt-1 w-full rounded-xl" placeholder="الاسم الكامل" /></label>
        <label className="block text-xs font-bold">رقم الهاتف<input required value={partnerPhone} onChange={e=>setPartnerPhone(e.target.value)} dir="ltr" className="input-base mt-1 w-full rounded-xl text-left" placeholder="07XXXXXXXXX" /></label>
        <label className="block text-xs font-bold">البريد الإلكتروني (اختياري)<input type="email" value={partnerEmail} onChange={e=>setPartnerEmail(e.target.value)} dir="ltr" className="input-base mt-1 w-full rounded-xl text-left" placeholder="name@example.com" /></label>
        <label className="block text-xs font-bold">المحافظة<select value={partnerGovernorate} onChange={e=>setPartnerGovernorate(e.target.value)} className="input-base mt-1 w-full rounded-xl">{Object.entries(governorateLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block text-xs font-bold">المدينة / القضاء<input required minLength={2} maxLength={80} value={partnerCity} onChange={e=>setPartnerCity(e.target.value)} className="input-base mt-1 w-full rounded-xl" placeholder="مثال: النجف الأشرف" /></label>
        <label className="block text-xs font-bold">العنوان التفصيلي<input required minLength={4} maxLength={240} value={partnerAddress} onChange={e=>setPartnerAddress(e.target.value)} className="input-base mt-1 w-full rounded-xl" placeholder="الحي والشارع وأقرب نقطة دالة" /></label>        <label className="block text-xs font-bold">رقم إجازة العمل / الترخيص<input required minLength={2} maxLength={100} value={partnerLicenseNumber} onChange={e=>setPartnerLicenseNumber(e.target.value)} className="input-base mt-1 w-full rounded-xl" placeholder="رقم الإجازة الرسمية" /></label>
        <div className="space-y-2"><div className="flex items-center gap-2 text-xs font-black"><MapPin className="h-4 w-4"/> دبوس موقع المنشأة</div><p className="text-[10px] text-muted-foreground">ابحث عن العنوان أو حدد موقعك، ثم اضغط على الخريطة أو اسحب الدبوس إلى مدخل المنشأة.</p><div className="flex gap-2"><input value={partnerPlaceQuery} onChange={e=>setPartnerPlaceQuery(e.target.value)} className="input-base min-w-0 flex-1 rounded-xl" placeholder="اسم المنطقة أو الشارع"/><Button type="button" variant="outline" disabled={partnerMapBusy} onClick={()=>void searchPartnerBusiness()}>بحث</Button></div><Button type="button" variant="outline" disabled={partnerMapBusy} onClick={()=>void locatePartnerBusiness()} className="w-full">{partnerMapBusy?"جارٍ تحديد الموقع...":"تحديد موقعي الحالي"}</Button><div ref={partnerMapRef} className="h-64 w-full rounded-xl border border-border bg-muted"/><p className="text-center text-[10px] text-muted-foreground">الإحداثيات: {partnerLat.toFixed(6)}, {partnerLng.toFixed(6)} · {partnerLocationSelected?"تم تحديد الموقع":"لم يتم تحديد الموقع بعد"}</p></div>
        <div className="space-y-2"><div className="text-xs font-black">المستندات الإلزامية</div>
          <PartnerDocUpload label="إجازة العمل / رخصة النشاط" file={partnerLicenseFile} onChange={setPartnerLicenseFile}/>
          <PartnerDocUpload label="هوية صاحب المنشأة - الوجه الأمامي" file={partnerIdFrontFile} onChange={setPartnerIdFrontFile}/>
          <PartnerDocUpload label="هوية صاحب المنشأة - الوجه الخلفي" file={partnerIdBackFile} onChange={setPartnerIdBackFile}/>
          <p className="text-[10px] text-muted-foreground">المستندات تحفظ بشكل خاص ولا تظهر للزبائن. الحد الأعلى 8 ميغابايت للصورة.</p></div>
        <label className="block text-xs font-bold">نبذة عن المنشأة (اختياري)<textarea maxLength={1000} value={partnerDescription} onChange={e=>setPartnerDescription(e.target.value)} className="input-base mt-1 min-h-20 w-full rounded-xl" placeholder="الخدمات أو المنتجات التي تقدمها" /></label>
        <button type="submit" disabled={partnerBusy} className="w-full rounded-xl bg-primary text-primary-foreground py-3 text-sm font-black disabled:opacity-50">{partnerBusy?"جارٍ إرسال الطلب...":"إرسال طلب الشراكة"}</button>
      </form>}
      {partnerApplications.length>0 && <div className="mt-4 space-y-2"><h3 className="text-xs font-black">طلبات الشراكة السابقة</h3>{partnerApplications.map((item:any)=><div key={item.id} className="rounded-xl border border-border p-3 text-xs"><div className="flex items-center justify-between gap-2"><b>{item.business_name}</b><span className={`rounded-full px-2 py-1 font-bold ${item.status==="approved"?"bg-emerald-500/10 text-emerald-700":item.status==="rejected"?"bg-red-500/10 text-red-700":"bg-amber-500/10 text-amber-700"}`}>{item.status==="approved"?"تمت الموافقة":item.status==="suspended"?"موقوف من الإدارة":item.status==="rejected"?"مرفوض":"قيد المراجعة"}</span></div><p className="mt-1 text-muted-foreground">{({hotel:"فندق",restaurant:"مطعم",store:"محل",mall:"مول"} as Record<string,string>)[item.partner_type]} · {new Date(item.created_at).toLocaleDateString("ar-IQ")}</p>{item.admin_note&&<p className="mt-1 text-muted-foreground">ملاحظة الإدارة: {item.admin_note}</p>}</div>)}</div>}
      {partnerApplications.some((item:any)=>item.status==="approved" && ["store","restaurant"].includes(item.partner_type)) && <Link to="/partner/dashboard" className="block w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 p-3 text-center text-xs font-black">إعدادات أعمالي</Link>}
    </section>

    <section className="mb-6 rounded-3xl border border-border/60 bg-card/60 p-4">
      <div className="mb-3"><h2 className="font-black text-sm">سجّل كسائق أو فني</h2><p className="text-[10px] text-muted-foreground mt-1">طلبات التكسي والسيارات الكبيرة والفنيين تبقى ضمن مساراتها الحالية.</p></div>
      <div className="grid grid-cols-1 gap-3">
        {roleItems.filter(item => item.role !== "customer").map(item => {
          const Icon = item.icon;
          const alreadyRegistered = roles.includes(item.role as any);
          return <button key={item.role} type="button" onClick={() => {
            if (item.role === "large_driver") window.location.href = "/onboarding/driver?provider=large_driver";
            else navigate({ to: item.role === "driver" ? "/onboarding/driver" : "/onboarding/worker" });
          }} className="w-full rounded-2xl border border-border/70 bg-background/70 p-4 flex items-center gap-3 text-right transition active:scale-[0.99] hover:border-primary/40">
            <span className={`h-11 w-11 shrink-0 rounded-2xl grid place-items-center ${item.style}`}><Icon className="h-5 w-5" /></span>
            <span className="flex-1 min-w-0"><span className="block text-sm font-black">{item.title}</span><span className="block text-[10px] text-muted-foreground mt-1">{item.subtitle}</span></span>
            <span className="shrink-0 rounded-xl bg-primary/10 text-primary px-3 py-2 text-[10px] font-black">{alreadyRegistered ? "متابعة / تحديث" : "ابدأ التسجيل"}</span>
          </button>;
        })}
      </div>
    </section>

    {isCompanyAdmin && <section className="mb-6">
      <h2 className="font-black text-sm mb-3 px-1">اسم الشركة الظاهر للمستخدمين</h2>
      <div className="rounded-3xl border border-primary/20 bg-card p-4">
        <p className="text-xs text-muted-foreground mb-3">هذا الاسم يظهر برسائل انتظار الموافقة والتنبيهات بدلاً من اسم الشخص.</p>
        <input value={companyName} onChange={e => setCompanyName(e.target.value)} maxLength={60} className="input-base w-full rounded-2xl" placeholder="مثال: شركة ممنون" />
        <Button className="w-full mt-3 rounded-2xl" disabled={busy} onClick={saveCompanyName}>حفظ اسم الشركة</Button>
      </div>
    </section>}

    {(roles.includes("worker") || roles.includes("driver") || roles.includes("large_driver")) && <section className="mb-6 rounded-3xl border border-primary/20 bg-primary/5 p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="font-black text-sm">اشتراكات ممنون</h2><p className="text-[11px] text-muted-foreground mt-1">إدارة تجربتك المجانية واختيار باقة الفنيين والسائقين</p></div><Button onClick={() => navigate({ to: "/subscriptions" })} className="rounded-xl shrink-0">عرض الباقات</Button></div></section>}

    <section className="mb-6">
      <h2 className="font-black text-sm mb-3 px-1">معلومات التواصل</h2>
      <div className="rounded-3xl border border-border/60 bg-card overflow-hidden">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-2"><span className="h-8 w-8 rounded-xl bg-violet-500/10 text-violet-600 grid place-items-center"><Mail className="h-4 w-4" /></span><div className="font-bold text-sm">البريد الإلكتروني</div></div>
          <p className="text-[11px] text-muted-foreground mb-3" dir="ltr">{actualEmail || "ماكو بريد إلكتروني حقيقي مسجّل بحسابك"}</p>
          {!actualEmail && <p className="text-xs text-muted-foreground mb-3">أضف بريدك الحقيقي حتى تستلم رابط التأكيد وتستعيد حسابك بسهولة.</p>}
          <input dir="ltr" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="input-base w-full rounded-2xl" placeholder="اكتب بريدك الحقيقي" />
          <Button className="w-full mt-3 rounded-2xl" disabled={busy} onClick={changeEmail}>{actualEmail ? "تأكيد تغيير البريد" : "إضافة البريد وإرسال رابط التأكيد"}</Button>
        </div>
        <div className="h-px bg-border/70 mx-4" />
        <div className="p-4">
          <div className="flex items-center gap-2 mb-2"><span className="h-8 w-8 rounded-xl bg-emerald-500/10 text-emerald-600 grid place-items-center"><Phone className="h-4 w-4" /></span><div className="font-bold text-sm">رقم الهاتف</div></div>
          <p className="text-[11px] text-muted-foreground mb-3" dir="ltr">{profile?.phone || session.user.phone || "غير مسجل"}</p>
          <input dir="ltr" type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="input-base w-full rounded-2xl text-left" placeholder="07XXXXXXXXX" />
          {!phonePending ? <Button className="w-full mt-3 rounded-2xl" disabled={busy} onClick={requestPhoneChange}>إرسال رمز التحقق</Button> : <>
            <label className="block text-xs font-bold mt-3 mb-2">رمز SMS</label>
            <input dir="ltr" inputMode="numeric" value={otp} onChange={e => setOtp(e.target.value)} className="input-base w-full rounded-2xl text-left" placeholder="أدخل الرمز" />
            <Button className="w-full mt-3 rounded-2xl" disabled={busy} onClick={verifyPhone}>تأكيد الرقم الجديد</Button>
          </>}
          <p className="text-[10px] text-muted-foreground mt-3">يتطلب تغيير الرقم تفعيل خدمة SMS في النظام.</p>
        </div>
      </div>
    </section>

    <button type="button" onClick={() => navigate({ to: "/support-chat" })} className="w-full mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-4 flex items-center justify-between text-right active:scale-[0.99] transition">
      <span><span className="block text-sm font-black text-foreground">مراسلة دعم ممنون</span><span className="block text-[11px] text-muted-foreground mt-1">أرسل استفسارك أو بلاغك وتابع رد الإدارة</span></span>
      <span className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-xs font-black">مراسلة الدعم</span>
    </button>
    <div className="rounded-2xl bg-primary/5 border border-primary/10 p-3 flex items-center gap-2 text-xs text-muted-foreground">
      <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
      <span>بيانات حسابك محمية، ولا يتغير البريد أو الهاتف إلا بعد إكمال التحقق.</span>
    </div>
  </main>;
}

function PartnerDocUpload({label,file,onChange}:{label:string;file:File|null;onChange:(file:File|null)=>void}) {
  return <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border p-3"><span className="min-w-0"><b className="block text-xs">{label}</b><small className="text-muted-foreground">{file?.name||"اختيار صورة واضحة"}</small></span><Upload className="h-4 w-4 shrink-0"/><input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e=>onChange(e.target.files?.[0]||null)}/></label>;
}