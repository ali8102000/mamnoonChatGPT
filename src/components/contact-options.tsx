import { useState } from "react";
import { MessageCircle, Phone, X } from "lucide-react";
import { isValidPhone, normalizePhone } from "@/lib/phone";

interface ContactOptionsProps {
  phone?: string | null;
  className?: string;
  label?: string;
}

export function ContactOptions({ phone, className, label = "تواصل" }: ContactOptionsProps) {
  const [open, setOpen] = useState(false);
  const normalized = phone ? normalizePhone(phone) : "";
  if (!phone || !isValidPhone(normalized)) return null;
  const digits = normalized.replace(/\D/g, "");

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={className ?? "inline-flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-1.5 text-[11px] font-black text-primary"}
      >
        <Phone className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && (
        <>
          <button type="button" aria-label="إغلاق خيارات التواصل" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 top-full z-50 mt-2 min-w-44 rounded-2xl border border-border bg-background p-2 shadow-xl">
            <a
              role="menuitem"
              href={`tel:${normalized}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold hover:bg-surface-2"
            >
              <Phone className="h-4 w-4 text-primary" />
              اتصال هاتفي
            </a>
            <a
              role="menuitem"
              href={`https://wa.me/${digits}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold hover:bg-surface-2"
            >
              <MessageCircle className="h-4 w-4 text-emerald-600" />
              فتح محادثة واتساب
            </a>
            <button type="button" onClick={() => setOpen(false)} className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[10px] text-muted-foreground hover:bg-surface-2">
              <X className="h-3.5 w-3.5" /> إغلاق
            </button>
          </div>
        </>
      )}
    </div>
  );
}
