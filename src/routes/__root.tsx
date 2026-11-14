import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,

  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth-context";
import { DriverOfferPopup } from "@/components/driver-offer-popup";
import { GlobalBackButton } from "@/components/back-button";
import { ProviderPresence } from "@/components/provider-presence";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">الصفحة غير موجودة</h2>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            العودة للرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error }: ErrorComponentProps) {
  console.error("[Mamnoon route error]", error);

  const rawMessage = String((error as any)?.message ?? error ?? "Unknown error");
  // Keep the on-screen diagnostic useful without exposing credentials or personal data.
  const diagnostic = rawMessage
    .replace(/Bearer\\s+[A-Za-z0-9._~-]+/gi, "Bearer [hidden]")
    .replace(/(?:sb_(?:publishable|secret)_)[A-Za-z0-9_-]+/gi, "[hidden key]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, "[hidden email]")
    .replace(/\\+?\\d[\\d\\s()-]{7,}\\d/g, "[hidden number]")
    .slice(0, 240);
  const errorName = String((error as any)?.name ?? "Error").slice(0, 60);

  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component", errorName, diagnostic });
    // Retry stale deployment chunks once; storage can be disabled in private browsers.
    if (/dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch/i.test(rawMessage)) {
      try {
        const key = "mamnoon-reloaded-at";
        const last = Number(sessionStorage.getItem(key) ?? 0);
        if (Date.now() - last > 30_000) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
        }
      } catch {
        // Keep the diagnostic screen available when browser storage is blocked.
      }
    }
  }, [error, errorName, diagnostic, rawMessage]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="max-w-md w-full text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">تعذّر تحميل الصفحة</h1>
        <p className="mt-2 text-sm text-muted-foreground">ظهر خطأ تقني محدد. احتفظ بالتفاصيل التالية لإصلاحه:</p>
        <div dir="ltr" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-left">
          <div className="text-xs font-bold text-destructive">{errorName}</div>
          <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-foreground">{diagnostic}</pre>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            إعادة المحاولة
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            الرئيسية
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      },
      { title: "ممنون" },
      {
        name: "description",
        content: "منصة النقل والخدمات الفاخرة — طلب سيارات وخدمات منزلية في مكان واحد",
      },
      { name: "author", content: "Mamnoon" },
      { name: "theme-color", content: "#115e59" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "ممنون" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "application-name", content: "ممنون" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    if ("serviceWorker" in navigator && window.location.hostname !== "localhost") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onPreloadError = () => {
      const key = "mamnoon-reloaded-at";
      try {
        const last = Number(sessionStorage.getItem(key) ?? 0);
        if (Date.now() - last > 30_000) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
        }
      } catch {
        // Ignore blocked session storage; the application must still render.
      }
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <GlobalBackButton />
        <DriverOfferPopup />
        <ProviderPresence />
        <Toaster richColors position="top-center" dir="rtl" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
