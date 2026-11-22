import { useEffect, useMemo, useRef } from "react";
import { Check, CheckCheck, Send } from "lucide-react";

export type MamnoonWebMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  isBot?: boolean;
  senderLabel?: string;
  status?: "sent" | "delivered" | "read";
  replyPreview?: string | null;
};

type Props = {
  messages: MamnoonWebMessage[];
  currentUserId: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  busy?: boolean;
  placeholder?: string;
  emptyText?: string;
  quickReplies?: string[];
  footer?: React.ReactNode;
  className?: string;
};

function dateKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dateKey(value) === dateKey(today.toISOString())) return "اليوم";
  if (dateKey(value) === dateKey(yesterday.toISOString())) return "أمس";
  return date.toLocaleDateString("ar-IQ", { weekday: "long", day: "numeric", month: "long" });
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
}

export function MamnoonChatThread({
  messages,
  currentUserId,
  draft,
  onDraftChange,
  onSend,
  busy = false,
  placeholder = "اكتب رسالة...",
  emptyText = "ابدأ المحادثة 👋",
  quickReplies = [],
  footer,
  className = "",
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const grouped = useMemo(() => {
    let previous = "";
    return messages.map((message) => {
      const key = dateKey(message.createdAt);
      const showDate = key !== previous;
      previous = key;
      return { message, showDate };
    });
  }, [messages]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className={`flex min-h-0 flex-1 flex-col bg-background ${className}`}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" aria-live="polite">
        {messages.length === 0 ? (
          <div className="grid min-h-[220px] place-items-center text-center">
            <div>
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-lg font-black text-primary">م</div>
              <p className="text-sm font-black text-foreground">{emptyText}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">محادثتك تبقى ضمن مساحة ممنون الخاصة</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {grouped.map(({ message, showDate }) => {
              const mine = message.senderId === currentUserId && !message.isBot;
              return (
                <div key={message.id}>
                  {showDate && <div className="my-4 flex justify-center"><span className="rounded-full border border-border bg-card px-3 py-1 text-[10px] font-bold text-muted-foreground">{dateLabel(message.createdAt)}</span></div>}
                  <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[88%] min-w-[76px] rounded-[18px] px-3.5 py-2.5 shadow-sm sm:max-w-[78%] ${mine ? "rounded-br-md bg-primary text-primary-foreground" : message.isBot ? "rounded-bl-md border border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100" : "rounded-bl-md border border-border bg-card text-foreground"}`}>
                      {!!(message.senderLabel || message.isBot) && <div className={`mb-1 text-[10px] font-black ${mine ? "text-primary-foreground/80" : "text-primary"}`}>{message.isBot ? "مساعد ممنون الذكي" : message.senderLabel}</div>}
                      {!!message.replyPreview && <div className={`mb-2 rounded-lg border-r-[3px] px-2.5 py-1.5 text-[11px] ${mine ? "border-amber-200 bg-black/10 text-primary-foreground" : "border-primary bg-muted text-foreground"}`}>{message.replyPreview}</div>}
                      <p className="whitespace-pre-wrap break-words text-[13px] leading-6">{message.body}</p>
                      <div className={`mt-1 flex items-center justify-end gap-1 text-[9px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        <span>{timeLabel(message.createdAt)}</span>
                        {mine && message.status === "sent" && <Check className="h-3 w-3" />}
                        {mine && message.status === "delivered" && <CheckCheck className="h-3 w-3" />}
                        {mine && message.status === "read" && <CheckCheck className="h-3 w-3 text-sky-300" />}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {quickReplies.length > 0 && <div className="flex gap-2 overflow-x-auto border-t border-border/60 px-3 py-2">{quickReplies.map((reply) => <button key={reply} type="button" disabled={busy} onClick={() => { onDraftChange(reply); }} className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[10px] font-bold text-foreground disabled:opacity-50">{reply}</button>)}</div>}
      {footer}
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && draft.trim()) onSend(); }} className="flex shrink-0 items-end gap-2 border-t border-border bg-card p-3 pb-[max(env(safe-area-inset-bottom),12px)]">
        <textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} rows={1} maxLength={4000} placeholder={placeholder} className="max-h-28 min-h-11 flex-1 resize-y rounded-2xl border border-border bg-background px-4 py-3 text-right text-sm outline-none focus:border-primary" />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="إرسال الرسالة" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground disabled:opacity-40"><Send className="h-4 w-4" /></button>
      </form>
    </div>
  );
}
