import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Smartphone, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/invite")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { ref?: string } => ({
    ref: typeof search.ref === "string" ? search.ref.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "دعوة إلى ممنون" },
      { name: "description", content: "افتح تطبيق ممنون أو أنشئ حسابك باستخدام رمز الدعوة." },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { ref } = Route.useSearch();
  const [appLaunchAttempted, setAppLaunchAttempted] = useState(false);

  const appUrl = `mamnoon://auth?ref=${encodeURIComponent(ref ?? "")}`;

  useEffect(() => {
    if (!ref || appLaunchAttempted) return;
    // Attempt the installed app only after an explicit tap; browsers may block
    // automatic custom-scheme launches and should keep the web fallback available.
  }, [ref, appLaunchAttempted]);

  function openApp() {
    setAppLaunchAttempted(true);
    window.location.href = appUrl;
  }

  function continueOnWeb() {
    window.location.assign(`/auth${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
  }

  return (
    <main className="min-h-screen bg-background px-5 py-12 text-foreground">
      <section className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Smartphone className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-black">دعوة إلى ممنون</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {ref ? `تم إرفاق رمز الدعوة ${ref} بحسابك الجديد.` : "انضم إلى ممنون واطلب النقل والخدمات من مكان واحد."}
        </p>
        <div className="mt-8 grid w-full gap-3">
          <Button type="button" className="h-12 w-full" onClick={openApp}>
            <Smartphone className="ml-2 h-4 w-4" /> افتح تطبيق ممنون
          </Button>
          <Button type="button" variant="outline" className="h-12 w-full" onClick={continueOnWeb}>
            <UserPlus className="ml-2 h-4 w-4" /> إنشاء حساب عبر الموقع
            <ArrowLeft className="mr-auto h-4 w-4" />
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          إذا لم يكن التطبيق مثبتاً، استخدم التسجيل عبر الموقع. سيبقى رمز الدعوة مرفقاً.
        </p>
      </section>
    </main>
  );
}
