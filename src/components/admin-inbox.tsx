import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "@/lib/toast";
import { MessageSquare, Search, RefreshCw, Headset, CheckCircle2, AlertCircle, ArrowRight, Star, X } from "lucide-react";
import { MamnoonChatThread } from "@/components/mamnoon-chat-thread";

type Filter = "all" | "unread" | "bot" | "pending" | "favorites";
type Conversation = {
  id: string; user_id: string; subject: string; updated_at: string; last_message_at: string | null; conversation_type?: "support" | "service"; request_id?: string; request_type?: string;
  needs_admin_reply: boolean; handoff_status: string; last_message_source: string; ticket_status: string;
  account_category: string; profile: { id?: string; full_name: string | null; phone: string | null; email: string | null } | null; provider_profile?: { id: string; full_name: string | null; phone: string | null } | null; complaints?: { id: string; reason: string; details: string | null; status: string; created_at: string }[];
  latest_message: Message | null;
};
type Message = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string; is_ai: boolean; read_at?: string | null; sender?: { full_name?: string | null } | null };

const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "الكل" }, { key: "unread", label: "غير مقروءة" },
  { key: "bot", label: "محوّلة من البوت" }, { key: "pending", label: "المعلّقة" },
  { key: "favorites", label: "المفضلة" },
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
  const [remoteSearch, setRemoteSearch] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = useMemo(() => items.find(item => item.id === selectedId) ?? null, [items, selectedId]);
  useEffect(() => { try { const saved = localStorage.getItem("mamnoon_admin_chat_favorites"); if (saved) setFavorites(JSON.parse(saved)); } catch { /* optional browser storage */ } }, []);
  const isUnread = (item: Conversation) => item.conversation_type !== "service" && !!item.latest_message && !item.latest_message.read_at && item.latest_message.sender_id === item.user_id;
  const isBot = (item: Conversation) => item.conversation_type === "support" && (item.last_message_source === "bot" || item.latest_message?.is_ai === true || item.handoff_status === "waiting_for_admin");
  const isPending = (item: Conversation) => item.ticket_status === "pending" || item.ticket_status === "new" || item.needs_admin_reply || item.handoff_status === "waiting_for_admin";
  const toggleFavorite = (id: string) => setFavorites(current => { const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id]; try { localStorage.setItem("mamnoon_admin_chat_favorites", JSON.stringify(next)); } catch { /* optional browser storage */ } return next; });
  const counts = { all: items.length, unread: items.filter(isUnread).length, bot: items.filter(isBot).length, pending: items.filter(isPending).length, favorites: items.filter(item => favorites.includes(item.id)).length };

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: callError } = await supabase.functions.invoke("admin-inbox", { body });
    if (callError) throw new Error(callError.message || "تعذر الاتصال بصندوق المراسلات");
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    const result = await invoke({ action: "list", filter: "all", limit: 100, search: remoteSearch });
    setItems(result.conversations ?? []);
  }, [invoke, remoteSearch]);

  const loadMessages = useCallback(async (id: string) => {
    const result = await invoke({ action: "messages", conversation_id: id, conversation_type: selected?.conversation_type ?? "support" });
    setMessages(result.messages ?? []);
  }, [invoke, selected?.conversation_type]);

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
      await invoke({ action: "reply", conversation_id: selectedId, conversation_type: selected?.conversation_type ?? "support", message: draft.trim() });
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
    if (filter === "unread" && !isUnread(item)) return false;
    if (filter === "bot" && !isBot(item)) return false;
    if (filter === "pending" && !isPending(item)) return false;
    if (filter === "favorites" && !favorites.includes(item.id)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [item.profile?.full_name, item.profile?.phone, item.profile?.email, item.subject].some(v => String(v || "").toLowerCase().includes(q));
  });

  return <section dir="rtl" className="flex h-[calc(100dvh-150px)] min-h-[70vh] flex-col overflow-hidden">
    {!selected && <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
      <div><h2 className="text-xl font-black flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary"/> مركز المراسلات</h2><p className="text-xs text-muted-foreground mt-1">صندوق وارد موحد يشبه واتساب، مع تمييز البوت والدعم المباشر.</p></div>
      <button onClick={() => { void load(); if (selectedId) void loadMessages(selectedId); }} className="rounded-xl border border-border p-2 text-xs font-bold"><RefreshCw className="inline h-4 w-4 ml-1"/> تحديث</button>
    </div>}
    <div className="flex min-h-0 flex-1 flex-col">
      {!selected && <aside className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mx-4 mb-1 flex h-[38px] shrink-0 gap-2"><div className="relative flex-1"><Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground"/><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")setRemoteSearch(search.trim());}} placeholder="ابحث بالاسم أو الهاتف..." className="h-[38px] w-full rounded-full border border-border bg-background py-1.5 pr-9 pl-3 text-sm outline-none"/>{!!search&&<button onClick={()=>{setSearch("");setRemoteSearch("");}} aria-label="مسح البحث" className="absolute left-3 top-2 text-muted-foreground"><X className="h-4 w-4"/></button>}</div><button onClick={()=>setRemoteSearch(search.trim())} className="rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground">بحث</button></div>
        <div className="mb-1 flex h-[42px] shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap">{filters.map(f=><button key={f.key} onClick={()=>setFilter(f.key)} className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold ${filter===f.key?"border-primary bg-primary text-primary-foreground":"border-border bg-muted text-muted-foreground"}`}>{f.label}<span className="text-[10px]">{counts[f.key]}</span></button>)}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? <p className="text-center text-xs text-muted-foreground p-6">جارٍ تحميل المحادثات...</p> : filtered.length===0 ? <p className="text-center text-xs text-muted-foreground p-6">ماكو محادثات بهذا التصنيف</p> : filtered.map(item=><button key={item.id} onClick={()=>setSelectedId(item.id)} className={`w-full rounded-xl border p-3 text-right transition ${selectedId===item.id?"border-primary bg-primary/5":"border-border bg-card hover:bg-muted/40"}`}>
            <div className="flex justify-between items-center gap-2"><span className="font-black text-xs truncate">{item.conversation_type === "service" ? `${item.profile?.full_name || "الزبون"} ↔ ${item.provider_profile?.full_name || "منفّذ الخدمة"}` : item.profile?.full_name || item.profile?.phone || "مستخدم ممنون"}</span><span className="text-[9px] text-muted-foreground">{item.last_message_at?new Date(item.last_message_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"}):""}</span></div>
            <div className="flex flex-wrap gap-1.5 mt-2 justify-start">
              <span className="rounded-md bg-muted px-2 py-1 text-[9px]">{item.conversation_type === "service" ? "محادثة طلب" : categories[item.account_category]||"مستخدم"}</span>
              <span className="rounded-md bg-muted px-2 py-1 text-[9px]">{item.last_message_source==="bot"?"البوت":item.last_message_source==="admin"?"الإدارة":item.last_message_source==="provider"?"منفّذ الخدمة":item.last_message_source==="customer"?"الزبون":"المستخدم"}</span>
              {item.needs_admin_reply&&<span className="rounded-md bg-orange-100 text-orange-800 px-2 py-1 text-[9px] font-black">تحتاج رد</span>}{!!item.complaints?.length&&<span className="rounded-md bg-red-100 text-red-800 px-2 py-1 text-[9px] font-black">شكوى · {item.complaints.length}</span>}
            </div>
            <p className="text-[10px] text-muted-foreground truncate mt-2">{item.latest_message?.body || item.subject}</p>
          </button>)}
        </div>
      </aside>}
      {selected && <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {<>
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3"><button onClick={()=>{setSelectedId(null);setMessages([]);setDraft("");setError("");}} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted" aria-label="رجوع"><ArrowRight className="h-5 w-5"/></button>
            <div className="min-w-0 flex-1"><h3 className="truncate font-black text-sm">{selected.conversation_type === "service" ? `${selected.profile?.full_name || "الزبون"} ↔ ${selected.provider_profile?.full_name || "منفّذ الخدمة"}` : selected.profile?.full_name || selected.profile?.phone || "مستخدم ممنون"}</h3><p className="text-[10px] text-muted-foreground">{selected.conversation_type === "service" ? "محادثة طلب خدمة" : categories[selected.account_category]||"مستخدم"} · {selected.profile?.phone || selected.profile?.email || ""}</p></div>
            <button onClick={()=>toggleFavorite(selected.id)} aria-label="تبديل المفضلة" className="flex h-10 w-10 items-center justify-center"><Star className={favorites.includes(selected.id)?"h-5 w-5 fill-amber-400 text-amber-500":"h-5 w-5 text-muted-foreground"}/></button>
            {selected.conversation_type !== "service" && <div className="flex gap-1.5"><button disabled={busy} onClick={()=>void runAction("handoff")} className="rounded-lg border border-border px-3 py-2 text-[10px] font-bold"><Headset className="inline h-3.5 w-3.5 ml-1"/> تحويل للدعم</button><button disabled={busy} onClick={()=>void runAction("resolve")} className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-[10px] font-bold"><CheckCircle2 className="inline h-3.5 w-3.5 ml-1"/> إنهاء</button></div>}
          </header>
          {isBot(selected)&&<div className="shrink-0 bg-violet-100 px-3 py-2 text-xs font-bold text-violet-900">محوّلة من البوت · {selected.subject || "بانتظار متابعة موظف الدعم"}</div>}
          {!!selected.complaints?.length&&<div className="mt-3 rounded-lg bg-red-100 text-red-900 px-3 py-2 text-xs font-black">شكوى مرتبطة بالطلب: {selected.complaints[0].reason}{selected.complaints.length > 1 ? ` · وشكاوى أخرى ${selected.complaints.length - 1}` : ""}</div>}{selected.conversation_type !== "service" && selected.needs_admin_reply&&<div className="mt-3 rounded-lg bg-orange-100 text-orange-900 px-3 py-2 text-xs font-black"><AlertCircle className="inline h-4 w-4 ml-1"/> هذه المحادثة تحتاج رد الإدارة</div>}
          <MamnoonChatThread
            messages={messages.map((m) => ({
              id: m.id,
              senderId: m.sender_id,
              body: m.body,
              createdAt: m.created_at,
              isBot: m.is_ai,
              senderLabel: m.is_ai ? "مساعد ممنون" : m.sender_id === session?.user.id ? "الإدارة" : selected.conversation_type === "service" && m.sender_id === selected.provider_profile?.id ? "منفّذ الخدمة" : selected.conversation_type === "service" && m.sender_id === selected.profile?.id ? "الزبون" : selected.conversation_type === "service" ? "الإدارة" : "المستخدم",
            }))}
            currentUserId={session?.user.id ?? ""}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void send()}
            busy={busy}
            placeholder="اكتب رد الإدارة..."
            emptyText="لا توجد رسائل في هذه المحادثة بعد"
          />
        </>}
      </main>}
    </div>
    {!!error&&<p className="text-xs text-destructive">{error}</p>}
  </section>;
}
