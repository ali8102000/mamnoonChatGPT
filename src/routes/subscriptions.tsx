import { createFileRoute, Link } from "@tanstack/react-router";
import { MobileShell } from "@/components/mobile-shell";
import { Wallet, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/subscriptions")({
  ssr: false,
  head: () => ({ meta: [{ title: "نظام العمولات | ممنون" }, { name: "description", content: "ممنون يعتمد على العمولات وليس الاشتراكات." }] }),
  component: CommissionOnlyPage,
});

function CommissionOnlyPage() {
  return <MobileShell>
    <main dir="rtl" className="mx-auto max-w-xl p-5 pt-10">
      <div className="glass rounded-3xl border border-border p-6 text-center space-y-4">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/10"><Wallet className="h-8 w-8 text-primary"/></div>
        <h1 className="text-xl font-black">ممنون بدون اشتراكات</h1>
        <p className="text-sm leading-7 text-muted-foreground">ماكو باقات أو اشتراكات شهرية وسنوية. استخدام ممنون يعتمد على العمولات والاستقطاعات التي تحددها الإدارة حسب نوع الخدمة والمحافظة، وتظهر تفاصيل أي مبلغ مستحق داخل المحفظة.</p>
        <Link to="/home" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-black text-primary-foreground"><ArrowRight className="h-4 w-4"/> الرجوع للتطبيق</Link>
      </div>
    </main>
  </MobileShell>;
}
