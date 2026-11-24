import { useState } from "react";
import { X, Loader2, AlertTriangle, Check } from "lucide-react";

type Props = {
  role: "customer" | "provider";
  requestType: "taxi" | "service";
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void> | void;
};

const CUSTOMER_REASONS = [
  "طلبت بالخطأ",
  "لم أعد بحاجة للخدمة",
  "تغيير الموعد",
  "الموقع أو تفاصيل الطلب غير صحيحة",
  "تأخر مقدم الخدمة",
  "اخترت مقدم خدمة آخر",
  "سبب آخر",
];

const PROVIDER_REASONS = [
  "الزبون لا يرد",
  "الموقع غير صحيح",
  "عطل بالمركبة أو المعدات",
  "ظرف طارئ",
  "ازدحام شديد أو تعذر الوصول",
  "تفاصيل الطلب لا تطابق الخدمة المطلوبة",
  "سبب آخر",
];

export function CancelReasonModal({ role, requestType, onClose, onSubmit }: Props) {
  const reasons = role === "customer" ? CUSTOMER_REASONS : PROVIDER_REASONS;
  const [selected, setSelected] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const isOther = selected === "سبب آخر";
  const finalReason = isOther ? note.trim() : selected;
  const disabled = busy || !finalReason || (isOther && note.trim().length < 2);

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-md grid place-items-end sm:place-items-center p-0 sm:p-4 animate-in fade-in"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-gradient-to-b from-background to-muted/40 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-border/80 animate-in slide-in-from-bottom-6 duration-300"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-2xl bg-destructive/10 grid place-items-center">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <div className="text-[9px] font-black tracking-[0.18em] text-primary mb-1">MAMNOON · REQUEST CONTROL</div>
              <div className="font-black text-base">{role === "customer" ? (requestType === "taxi" ? "إلغاء الرحلة" : "إلغاء الطلب") : (requestType === "taxi" ? "الاعتذار عن الرحلة" : "الاعتذار عن الطلب") }</div>
              <div className="text-[11px] text-muted-foreground">
                {role === "customer" ? "سيتم إيقاف الطلب وإبلاغ الطرف الآخر" : requestType === "taxi" ? "سيتم فك ارتباطك بالرحلة وإعادتها للبحث عن سائق آخر" : "سيتم فك ارتباطك بالطلب وإعادته للبحث عن فني آخر"}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-full grid place-items-center hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2 mb-3 max-h-[45vh] overflow-y-auto">
          {reasons.map((r, index) => {
            const active = selected === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setSelected(r)}
                className={`w-full flex items-center gap-3 text-right rounded-2xl px-3.5 py-3 text-sm font-extrabold border transition-all active:scale-[0.985] ${active
                  ? "border-primary bg-primary/10 text-primary shadow-[0_8px_24px_-16px_hsl(var(--primary))]"
                  : "border-border/80 bg-card/90 hover:border-primary/40 hover:bg-muted/70"}`}
              >
                <span className={`h-8 w-8 rounded-xl grid place-items-center text-[10px] font-black shrink-0 ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{active ? <Check className="h-4 w-4" /> : String(index + 1).padStart(2, "0")}</span>
                <span className="flex-1">{r}</span>
                <span className={`h-4 w-4 rounded-full border grid place-items-center shrink-0 ${active ? "border-primary" : "border-muted-foreground/40"}`}>{active && <span className="h-2 w-2 rounded-full bg-primary" />}</span>
              </button>
            );
          })}
        </div>

        {isOther && (
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 280))}
            placeholder="اكتب السبب بالتفصيل..."
            rows={3}
            className="w-full bg-input border border-border rounded-2xl px-4 py-3 text-sm outline-none focus:border-primary resize-none mb-3"
          />
        )}

        <div className="grid grid-cols-2 gap-3 mt-2">
          <button
            onClick={onClose}
            className="py-3.5 rounded-2xl border-2 border-border bg-card font-black active:scale-95 transition"
          >
            تراجع
          </button>
          <button
            disabled={disabled}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(finalReason);
              } finally {
                setBusy(false);
              }
            }}
            className="py-3.5 rounded-2xl bg-destructive text-destructive-foreground font-black active:scale-95 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : role === "customer" ? (requestType === "taxi" ? "تأكيد إلغاء الرحلة" : "تأكيد إلغاء الطلب") : (requestType === "taxi" ? "تأكيد الاعتذار وإعادة الرحلة للبحث" : "تأكيد الاعتذار وإعادة الطلب للبحث")}
          </button>
        </div>
      </div>
    </div>
  );
}
