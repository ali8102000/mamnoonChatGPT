import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { MessageCircle, Send, Loader2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { MobileShell } from "@/components/mobile-shell";

type ChatMessage = { id: string; role: "user" | "assistant"; text: string };

export const Route = createFileRoute("/ask-mamnoon")({
  ssr: false,
  head: () => ({ meta: [{ title: "اسأل ممنون | ممنون" }] }),
  component: AskMamnoonPage,
});

function AskMamnoonPage() {
  const { session, loading } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [supportHandoff, setSupportHandoff] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    setError("");
    setSupportHandoff(false);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    setSending(true);
    const { data, error: invokeError } = await supabase.functions.invoke("mamnoon-ai", {
      body: { action: "chat", message },
    });
    setSending(false);
    if (invokeError || !data?.answer) {
      setError("المساعد الذكي غير متاح حالياً. تأكد من تفعيل خدمة الذكاء الاصطناعي وحاول مرة ثانية.");
      return;
    }
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: data.answer }]);
    setSupportHandoff(data.handoff === true);
  }

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;
  return <MobileShell>
    <main dir="rtl" className="mx-auto flex min-h-[75vh] max-w-2xl flex-col gap-4 px-4 pb-8 pt-5">
      <a href="/" className="inline-flex items-center gap-2 text-sm font-bold text-primary"><ArrowRight className="h-4 w-4"/> رجوع للرئيسية</a>
      <header className="rounded-3xl bg-gradient-to-br from-primary to-primary-glow p-5 text-primary-foreground">
        <div className="flex items-center gap-3"><MessageCircle className="h-8 w-8"/><div><h1 className="text-2xl font-black">اسأل ممنون</h1><p className="mt-1 text-xs opacity-85">مساعدك لمعرفة خدمات ممنون والمنشآت والأسعار المنشورة</p></div></div>
      </header>
      <section aria-live="polite" className="flex min-h-64 flex-1 flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        {messages.length === 0 && <p className="m-auto max-w-sm text-center text-sm leading-7 text-muted-foreground">هلا بيك! اسألني عن خدمات ممنون أو الفنادق والمطاعم والمحلات المنشورة.</p>}
        {messages.map((message) => <div key={message.id} className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 ${message.role === "user" ? "mr-auto bg-primary text-primary-foreground" : "ml-auto border border-border bg-muted text-foreground"}`}>{message.text}</div>)}
        {sending && <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/> ممنون يفكر...</div>}
      </section>
      {supportHandoff && <a href="/support-chat" className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-center text-sm font-black text-primary">متابعة الاستفسار مع فريق الدعم ←</a>}
      {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-xs text-destructive">{error}</p>}
      <form onSubmit={send} className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2">
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1200} rows={2} placeholder="اكتب سؤالك..." className="min-h-12 flex-1 resize-none bg-transparent p-2 text-sm outline-none" />
        <button type="submit" disabled={!draft.trim() || sending} aria-label="إرسال السؤال" className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"><Send className="h-4 w-4"/></button>
      </form>
      <p className="text-center text-[10px] text-muted-foreground">الإجابات معلوماتية ولا تؤكد الحجز أو تنفيذ الطلب. تأكد من التفاصيل مع المنشأة قبل الدفع.</p>
    </main>
  </MobileShell>;
}
