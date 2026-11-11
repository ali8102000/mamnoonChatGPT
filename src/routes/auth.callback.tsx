import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [message, setMessage] = useState("جارٍ تأكيد حسابك...");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    async function complete() {
      try {
        const url = new URL(window.location.href);
        const errorDescription = url.searchParams.get("error_description");
        if (errorDescription) throw new Error(errorDescription);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) throw new Error("الرابط غير صالح أو منتهي الصلاحية. اطلب رابطاً جديداً.");
        }
        await refresh();
        if (!active) return;
        setMessage("تم تأكيد البريد الإلكتروني بنجاح");
        window.setTimeout(() => navigate({ to: "/" }), 1200);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "تعذر تأكيد البريد");
      } finally {
        if (active) setBusy(false);
      }
    }
    complete();
    return () => { active = false; };
  }, [navigate, refresh]);

  return <main dir="rtl" className="min-h-screen grid place-items-center p-6 text-center">
    <section className="max-w-md space-y-4">
      <h1 className="text-2xl font-black">{message}</h1>
      {!busy && <button className="text-primary font-bold" onClick={() => navigate({ to: "/auth" })}>العودة لتسجيل الدخول</button>}
    </section>
  </main>;
}
