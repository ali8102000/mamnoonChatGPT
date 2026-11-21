import { createFileRoute, Link } from "@tanstack/react-router";
import { MobileShell } from "@/components/mobile-shell";
import { ShieldCheck, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/admin/subscriptions")({
  ssr: false,
  head: () => ({ meta: [{ title: "حقوق ممنون | الإدارة" }] }),
  component: RetiredSubscriptionsAdmin,
});

function RetiredSubscriptionsAdmin() {
  return <MobileShell><main dir="rtl" className="mx-auto max-w-xl p-5 pt-10">
    <div className="glass rounded-3xl border border-border p-6 text-center space-y-4">
      <ShieldCheck className="mx-auto h-12 w-12 text-primary"/>
      <h1 className="text-xl font-black">تم إيقاف نظام الاشتراكات</h1>
      <p className="text-sm leading-7 text-muted-foreground">ممنون يعتمد الآن على العمولات والاستقطاعات التي تتحكم بها الإدارة من قسم حقوق ممنون. السجلات التاريخية محفوظة.</p>
      <Link to="/admin" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-black text-primary-foreground"><ArrowRight className="h-4 w-4"/> العودة إلى الإدارة</Link>
    </div>
  </main></MobileShell>;
}
