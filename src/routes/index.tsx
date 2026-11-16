import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";
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

  // Re-show the branded entry screen whenever the web app is opened/reloaded.
  useEffect(() => {
    if (loading || !ready) return;
    const timer = window.setTimeout(() => setSplashFinished(true), 1200);
    return () => window.clearTimeout(timer);
  }, [loading, ready]);

  if (loading || !ready || !splashFinished) {
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

  if (!session) return <Navigate to={completed ? "/auth" : "/welcome"} />;
  if (!profile) return <Navigate to="/select-role" />;
  if (roles.length === 0) return <Navigate to="/select-role" />;
  return <Navigate to="/home" />;
}
