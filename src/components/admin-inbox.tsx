import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "@/lib/toast";
import { MessageSquare, Search, Send, RefreshCw, Bot, UserRound, Headset, CheckCircle2, AlertCircle } from "lucide-react";

type Filter = "all" | "needs_reply" | "unread" | "bot" | "human" | "resolved";
type Conversation = {
  id: string; user_id: string; subject: string; updated_at: string; last_message_at: string | null;
  needs_admin_reply: boolean; handoff_status: string; last_message_source: string; ticket_status: string;
  account_category: string; profile: { full_name: string | null; phone: string | null; email: string | null } | null;
  latest_message: Message | null;
};
type Message = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string; is_ai: boolean; read_at?: string | null; sender?: { full_name?: string | null } | null };

const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "الكل" }, { key: "needs_reply", label: "تحتاج رد" },
  { key: "unread", label: "جديدة" }, { key: "bot", label: "البوت" },
  { key: "human", label: "الدعم المباشر" }, { key: "resolved", label: "محلولة" },
];
const categories: Record<string, string> = { customer: "زبون", technician: "فني", driver: "صاحب تكسي", restaurant: "مطعم", hotel: "فندق", store: "متجر" };

export default function AdminInbox() {
  const { session } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = useMemo(() => items.find(item => item.id === selectedId) ?? null, [items, selectedId]);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: callError } = await supabase.functions.invoke("admin-inbox", { body });
    if (callError) throw new Error(callError.message || "تعذر الاتصال بصندوق المراسلات");
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    const result = await invoke({ action: "list", filter, limit: 100 });
    setItems(result.conversations ?? []);
  }, [filter, invoke]);

  const loadMessages = useCallback(async (id: string) => {
    const result = await invoke({ action: "messages", conversation_id: id });
    setMessages(result.messages ?? []);
  }, [invoke]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void load().catch(e => { if (active) setError(String(e?.message || "تعذر تحميل المحادثات")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    void loadMessages(selectedId).catch(e => setError(String(e?.message || "تعذر تحميل الرسائل")));
  }, [selectedId, loadMessages]);

  useEffect(() => {
    const channel = supabase.channel("mamnoon-web-admin-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_messages" }, () => {
        void load().catch(() => undefined);
        if (selectedId) void loadMessages(selectedId).catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations" }, () => void load().catch(() => undefined))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, loadMessages, selectedId]);

  const send = async () => {
    if (!selectedId || !draft.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await invoke({ action: "reply", conversation_id: selectedId, message: draft.trim() });
      setDraft("");
      await Promise.all([load(), loadMessages(selectedId)]);
    } catch (e: any) { setError(String(e?.message || "تعذر إرسال الرد")); }
    finally { setBusy(false); }
  };

  const runAction = async (action: "handoff" | "resolve") => {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      await invoke({ action, conversation_id: selectedId });
      await Promise.all([load(), loadMessages(selectedId)]);
      toast.success(action === "handoff" ? "تم تحويل المحادثة للدعم المباشر" : "تم إنهاء المحادثة");
    } catch (e: any) { setError(String(e?.message || "تعذر تنفيذ العملية")); }
    finally { setBusy(false); }
  };

  const filtered = items.filter(item => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [item.profile?.full_name, item.profile?.phone, item.profile?.email, item.subject].some(v => String(v || "").toLowerCase().includes(q));
  });

  return <section dir="rtl" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-black flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary"/> مركز المراسلات</h2><p className="text-xs text-muted-foreground mt-1">صندوق وارد موحد يشبه واتساب، مع تمييز البوت والدعم المباشر.</p></div>
      <button onClick={() => { void load(); if (selectedId) void loadMessages(selectedId); }} className="rounded-xl border border-border p-2 text-xs font-bold"><RefreshCw className="inline h-4 w-4 ml-1"/> تحديث</button>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.5fr)] gap-3 min-h-[620px]">
      <aside className="glass rounded-2xl p-3 flex flex-col min-h-[480px]">
        <div className="relative mb-3"><Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث بالاسم أو الهاتف..." className="w-full rounded-xl border border-border bg-background py-2.5 pr-9 pl-3 text-xs outline-none"/></div>
        <div className="flex flex-wrap gap-1.5 mb-3">{filters.map(f=><button key={f.key} onClick={()=>setFilter(f.key)} className={`rounded-full px-3 py-1.5 text-[10px] font-bold ${filter===f.key?"bg-primary text-primary-foreground":"bg-muted text-muted-foreground"}`}>{f.label}</button>)}</div>
        <div className="space-y-2 overflow-y-auto flex-1">
          {loading ? <p className="text-center text-xs text-muted-foreground p-6">جارٍ تحميل المحادثات...</p> : filtered.length===0 ? <p className="text-center text-xs text-muted-foreground p-6">ماكو محادثات بهذا التصنيف</p> : filtered.map(item=><button key={item.id} onClick={()=>setSelectedId(item.id)} className={`w-full rounded-xl border p-3 text-right transition ${selectedId===item.id?"border-primary bg-primary/5":"border-border bg-card hover:bg-muted/40"}`}>
            <div className="flex justify-between items-center gap-2"><span className="font-black text-xs truncate">{item.profile?.full_name || item.profile?.phone || "مستخدم ممنون"}</span><span className="text-[9px] text-muted-foreground">{item.last_message_at?new Date(item.last_message_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"}):""}</span></div>
            <div className="flex flex-wrap gap-1.5 mt-2 justify-start">
              <span className="rounded-md bg-muted px-2 py-1 text-[9px]">{categories[item.account_category]||"مستخدم"}</span>
              <span className="rounded-md bg-muted px-2 py-1 text-[9px]">{item.last_message_source==="bot"?"البوت":item.last_message_source==="admin"?"الإدارة":"المستخدم"}</span>
              {item.needs_admin_reply&&<span className="rounded-md bg-orange-100 text-orange-800 px-2 py-1 text-[9px] font-black">تحتاج رد</span>}
            </div>
            <p className="text-[10px] text-muted-foreground truncate mt-2">{item.latest_message?.body || item.subject}</p>
          </button>)}
        </div>
      </aside>
      <main className="glass rounded-2xl p-3 flex flex-col min-h-[480px]">
        {!selected ? <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2"><MessageSquare className="h-8 w-8"/><p className="text-sm font-bold">اختار محادثة حتى تظهر الرسائل</p></div> : <>
          <header className="flex flex-wrap justify-between items-center gap-2 border-b border-border pb-3">
            <div><h3 className="font-black text-sm">{selected.profile?.full_name || selected.profile?.phone || "مستخدم ممنون"}</h3><p className="text-[10px] text-muted-foreground">{categories[selected.account_category]||"مستخدم"} · {selected.profile?.phone || selected.profile?.email || ""}</p></div>
            <div className="flex gap-1.5"><button disabled={busy} onClick={()=>void runAction("handoff")} className="rounded-lg border border-border px-3 py-2 text-[10px] font-bold"><Headset className="inline h-3.5 w-3.5 ml-1"/> تحويل للدعم</button><button disabled={busy} onClick={()=>void runAction("resolve")} className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-[10px] font-bold"><CheckCircle2 className="inline h-3.5 w-3.5 ml-1"/> إنهاء</button></div>
          </header>
          {selected.needs_admin_reply&&<div className="mt-3 rounded-lg bg-orange-100 text-orange-900 px-3 py-2 text-xs font-black"><AlertCircle className="inline h-4 w-4 ml-1"/> هذه المحادثة تحتاج رد الإدارة</div>}
          <div className="flex-1 overflow-y-auto py-3 space-y-2 min-h-[300px]">
            {messages.map(m=><div key={m.id} className={`max-w-[85%] rounded-2xl p-3 ${m.is_ai?"ml-auto bg-violet-100 text-violet-950":m.sender_id===session?.user.id?"mr-auto bg-primary/10":"ml-auto bg-muted"}`}>
              <div className="text-[9px] font-black mb-1 flex items-center gap-1">{m.is_ai?<><Bot className="h-3 w-3"/> مساعد ممنون</>:m.sender_id===session?.user.id?<><Headset className="h-3 w-3"/> الإدارة</>:<><UserRound className="h-3 w-3"/> المستخدم</>}</div>
              <p className="text-xs whitespace-pre-wrap break-words">{m.body}</p><p className="text-[9px] opacity-60 mt-1">{new Date(m.created_at).toLocaleString("ar-IQ")}</p>
            </div>)}
          </div>
          <div className="border-t border-border pt-3 flex items-end gap-2"><textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={2} maxLength={4000} placeholder="اكتب رد الإدارة..." className="flex-1 rounded-xl border border-border bg-background p-3 text-xs outline-none resize-y"/><button disabled={busy||!draft.trim()} onClick={()=>void send()} className="rounded-xl bg-primary text-primary-foreground p-3 disabled:opacity-40"><Send className="h-4 w-4"/></button></div>
        </>}
      </main>
    </div>
    {!!error&&<p className="text-xs text-destructive">{error}</p>}
  </section>;
}
