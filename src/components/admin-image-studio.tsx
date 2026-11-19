import { useState } from "react";
import { Image, Images, LayoutTemplate, Store, Building2, PanelsTopLeft } from "lucide-react";
import AdminVisualBuilder from "@/components/admin-visual-builder";
import AdminBusinessCategories from "@/components/admin-business-categories";
import AdminHomeBanners from "@/components/admin-home-banners";
import AdminCompanySettings from "@/components/admin-company-settings";

type StudioTab = "visuals" | "categories" | "banners" | "identity";
const tabs: { id: StudioTab; title: string; detail: string; icon: typeof Image }[] = [
  { id: "visuals", title: "صور وأيقونات التطبيق", detail: "الأيقونات والرسوم وصور فئات التكسي", icon: LayoutTemplate },
  { id: "categories", title: "فئات المتاجر والمطاعم", detail: "صور الفئات وأحجامها وحركة الأشرطة", icon: Store },
  { id: "banners", title: "البانرات والإعلانات", detail: "صور الصفحة الرئيسية والحملات", icon: PanelsTopLeft },
  { id: "identity", title: "هوية ممنون", detail: "شعار الشركة وصورها الأساسية", icon: Building2 },
];

export default function AdminImageStudio() {
  const [active, setActive] = useState<StudioTab>("visuals");
  return <div dir="rtl" className="space-y-5">
    <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-l from-[#071b34] via-[#123d61] to-[#087e8b] p-5 text-white shadow-xl sm:p-7">
      <div className="pointer-events-none absolute -left-8 -top-10 h-48 w-48 rounded-full border-[22px] border-white/10"/>
      <div className="pointer-events-none absolute -bottom-20 right-1/3 h-56 w-56 rounded-full bg-cyan-300/10 blur-2xl"/>
      <div className="relative flex items-center gap-3">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/20 bg-white/10 shadow-lg backdrop-blur"><Images className="h-7 w-7"/></div>
        <div><p className="text-xs font-bold text-cyan-100">MAMNOON CREATIVE CONTROL</p><h2 className="mt-1 text-2xl font-black">مركز الصور والتصميم</h2></div>
      </div>
      <p className="relative mt-4 max-w-2xl text-sm leading-7 text-sky-50/90">كل صور التطبيق ورسوماته في مكان واحد. اختار القسم، عدّل الصورة والحجم، وشاهد إعدادات النشر من نفس المركز.</p>
      <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tabs.map((tab) => { const Icon = tab.icon; return <div key={tab.id} className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur"><Icon className="mb-2 h-5 w-5 text-cyan-100"/><p className="text-xs font-black">{tab.title}</p><p className="mt-1 text-[10px] leading-4 text-sky-100/75">{tab.detail}</p></div>; })}
      </div>
    </section>
    <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tabs.map((tab) => { const Icon = tab.icon; const selected = active === tab.id; return <button key={tab.id} onClick={() => setActive(tab.id)} className={`flex min-h-14 items-center gap-2 rounded-2xl border p-3 text-right text-xs font-black transition-all ${selected ? "border-cyan-500 bg-gradient-to-l from-cyan-600 to-blue-600 text-white shadow-lg shadow-blue-900/15" : "border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:bg-cyan-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"}`}><Icon className="h-5 w-5 shrink-0"/><span>{tab.title}</span></button>; })}
    </nav>
    <section className="min-w-0 rounded-3xl border border-slate-200/80 bg-white/80 p-2 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/80 sm:p-4">
      {active === "visuals" && <AdminVisualBuilder/>}
      {active === "categories" && <AdminBusinessCategories/>}
      {active === "banners" && <AdminHomeBanners/>}
      {active === "identity" && <AdminCompanySettings/>}
    </section>
  </div>;
}
