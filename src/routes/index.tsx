import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Crosshair, Loader2, MapPin } from "lucide-react";
import { GOVERNORATES, GOV_STORAGE_KEY, governorateOf } from "@/lib/governorates";
import { getCurrentLocation, locationError } from "@/lib/location";
import { useWelcomePreferences } from "@/lib/welcome-preferences";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ممنون | النقل والخدمات" },
      { name: "description", content: "رحلات التاكسي والخدمات المنزلية في تطبيق ممنون." },
      { property: "og:title", content: "ممنون | النقل والخدمات" },
      { property: "og:description", content: "رحلات التاكسي والخدمات المنزلية في تطبيق ممنون." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const { loading, session, roles, profile } = useAuth();
  const { ready, completed } = useWelcomePreferences();
  const [splashFinished, setSplashFinished] = useState(false);
  const [governorate, setGovernorate] = useState<string | null>(null);
  const [governorateReady, setGovernorateReady] = useState(false);
  const [locatingGovernorate, setLocatingGovernorate] = useState(false);
  const [governorateError, setGovernorateError] = useState<string | null>(null);

  useEffect(() => {
    try { setGovernorate(window.localStorage.getItem(GOV_STORAGE_KEY)); } catch { setGovernorate(null); }
    setGovernorateReady(true);
  }, []);

  function saveGovernorate(key: string) {
    try { window.localStorage.setItem(GOV_STORAGE_KEY, key); } catch { /* Continue for this session if storage is blocked. */ }
    setGovernorate(key);
    setGovernorateError(null);
  }

  async function detectGovernorate() {
    setLocatingGovernorate(true);
    setGovernorateError(null);
    try {
      const coords = await getCurrentLocation(navigator.geolocation);
      saveGovernorate(governorateOf(coords).key);
    } catch (error) {
      setGovernorateError(locationError(error as { code?: number }));
    } finally {
      setLocatingGovernorate(false);
    }
  }

  // Re-show the branded entry screen whenever the web app is opened/reloaded.
  useEffect(() => {
    if (loading || !ready) return;
    const timer = window.setTimeout(() => setSplashFinished(true), 1200);
    return () => window.clearTimeout(timer);
  }, [loading, ready]);

  if (loading || !ready || !governorateReady || !splashFinished) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#F7F8F5] px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <img src="/icon-192.png" alt="شعار ممنون" className="h-28 w-28 object-contain" />
          <div className="text-4xl font-black tracking-wide text-[#17324D]">ممنون</div>
          <div className="text-sm font-semibold text-[#758394]">مشوارك وخدماتك… بمكان واحد</div>
          {loading || !ready ? <Loader2 className="mt-5 h-5 w-5 animate-spin text-amber-600" /> : <div className="mt-5 h-5" />}
        </div>
      </main>
    );
  }

  if (!governorate) {
    return (
      <main dir="rtl" className="min-h-screen bg-[#F7F8F5] px-4 py-10 text-[#17324D]">
        <section className="mx-auto flex min-h-[80vh] w-full max-w-xl flex-col items-center justify-center">
          <div className="grid h-20 w-20 place-items-center rounded-[26px] bg-[#17324D] text-4xl font-black text-white shadow-xl">م</div>
          <h1 className="mt-4 text-3xl font-black">بأي محافظة أنت؟</h1>
          <p className="mt-2 max-w-sm text-center text-sm leading-7 text-slate-500">اختَر محافظتك حتى نعرض لك السائقين والفنيين والخدمات الأقرب إلك.</p>
          <button type="button" onClick={() => void detectGovernorate()} disabled={locatingGovernorate} className="mt-6 flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-[#D6A43B] bg-[#17324D] px-4 font-black text-white shadow-lg disabled:opacity-70">
            {locatingGovernorate ? <Loader2 className="h-5 w-5 animate-spin" /> : <Crosshair className="h-5 w-5" />}
            {locatingGovernorate ? "جارٍ تحديد محافظتك..." : "تحديد محافظتي تلقائياً"}
          </button>
          {governorateError && <p className="mt-3 text-center text-xs font-bold text-red-600">{governorateError}</p>}
          <div className="mt-7 w-full text-right text-sm font-black">أو اختَر المحافظة يدوياً</div>
          <div className="mt-3 grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
            {GOVERNORATES.map((item) => (
              <button key={item.key} type="button" onClick={() => saveGovernorate(item.key)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-extrabold shadow-sm transition hover:border-[#D6A43B] hover:bg-amber-50 active:scale-[0.98]">
                <MapPin className="h-4 w-4 text-[#D6A43B]" />{item.name}
              </button>
            ))}
          </div>
          <p className="mt-5 text-center text-xs text-slate-400">اختيار المحافظة يساعدنا نعرض الخدمات القريبة منك.</p>
        </section>
      </main>
    );
  }

  if (!session) return <Navigate to={completed ? "/auth" : "/welcome"} />;
  if (!profile) return <Navigate to="/select-role" />;
  if (roles.length === 0) return <Navigate to="/select-role" />;
  return <Navigate to="/home" />;
}
