import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, Send, Loader2, ArrowRight, ShieldCheck, Bell, Volume2, VolumeX } from "lucide-react";
import { toast } from "@/lib/toast";

export const Route = createFileRoute("/support-chat")({
  ssr: false,
  head: () => ({ meta: [{ title: "محادثة إدارة ممنون | ممنون" }] }),
  component: SupportChatPage,
});

function SupportChatPage() {
  const { session, loading } = useAuth();
  const uid = session?.user.id;
  const [isStaff, setIsStaff] = useState(false);
  const [customerServiceOnly, setCustomerServiceOnly] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [providerTargets, setProviderTargets] = useState<any[]>([]);
  const [providerSearch, setProviderSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [unansweredOnly, setUnansweredOnly] = useState(false);
  const [muted, setMuted] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("mamnoon-support-muted") === "1");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, selected?.id]);

  const loadConversations = useCallback(async () => {
    if (!uid) return;
    const { data: staff } = await (supabase as any).rpc("has_staff_role", { p_user_id: uid });
    const { data: staffRoles } = await (supabase as any).rpc("get_staff_roles", { p_user_id: uid });
    const { data: assignment } = await (supabase as any).from("staff_assignments").select("rank").eq("user_id", uid).eq("active", true).maybeSingle();
    const privilegedChatRoles = ["super_admin","admin","support","finance","moderator"];
    const isGeneralManager = assignment?.rank === "general_manager";
    const privilegedChatAccess = isGeneralManager || (staffRoles ?? []).some((r: string) => privilegedChatRoles.includes(r));
    const restrictedSupport = (staffRoles ?? []).includes("customer_service") && !privilegedChatAccess;
    setIsStaff(staff === true || isGeneralManager);
    setCustomerServiceOnly(restrictedSupport);
    if (staff || isGeneralManager) {
      const [drivers, workers] = restrictedSupport ? [{ data: [] }, { data: [] }] : await Promise.all([
        (supabase as any).from("driver_profiles").select("user_id, profiles!inner(full_name, phone)").limit(300),
        (supabase as any).from("worker_profiles").select("user_id, profiles!inner(full_name, phone)").limit(300),
      ]);
      const targetMap = new Map<string, any>();
      for (const row of [...(drivers.data ?? []), ...(workers.data ?? [])]) {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        if (profile) targetMap.set(row.user_id, { id: row.user_id, ...profile });
      }
      setProviderTargets(Array.from(targetMap.values()));
      const { data, error } = await (supabase as any).from("support_conversations").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      const ids: string[] = Array.from(new Set<string>((data ?? []).map((c: any) => String(c.user_id))));
      const { data: profiles } = ids.length ? await supabase.from("profiles").select("id,full_name,phone,avatar_url").in("id", ids) : { data: [] };
      const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      const conversationIds = (data ?? []).map((c: any) => c.id);
      const { data: latestMessages } = conversationIds.length ? await (supabase as any).from("support_messages").select("id,conversation_id,sender_id,body,created_at,is_ai").in("conversation_id", conversationIds).order("created_at", { ascending: false }) : { data: [] };
      const latestByConversation = new Map<string, any>();
      for (const message of latestMessages ?? []) if (!latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message);
      const rows = (data ?? []).map((c: any) => { const lastMessage = latestByConversation.get(c.id); return { ...c, profile: byId.get(c.user_id), lastMessage, unanswered: !!lastMessage && lastMessage.sender_id === c.user_id && !lastMessage.is_ai }; }).sort((a: any, b: any) => new Date(b.lastMessage?.created_at ?? b.updated_at).getTime() - new Date(a.lastMessage?.created_at ?? a.updated_at).getTime());
      setConversations(rows);
      if (selected) setSelected(rows.find((c: any) => c.id === selected.id) ?? null);
    } else {
      const initial = await (supabase as any).from("support_conversations").select("*").eq("user_id", uid).eq("status", "open").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      let data = initial.data;
      if (initial.error) throw initial.error;
      if (!data) {
        const created = await (supabase as any).from("support_conversations").insert({ user_id: uid, created_by: uid }).select("*").single();
        if (created.error) {
          const retry = await (supabase as any).from("support_conversations").select("*").eq("user_id", uid).eq("status", "open").maybeSingle();
          if (retry.error || !retry.data) throw created.error;
          data = retry.data;
        } else data = created.data;
      }
      setConversations([data]);
      setSelected(data);
    }
  }, [uid, selected?.id]);

  const loadMessages = useCallback(async (conversationId: string) => {
    const { data, error } = await (supabase as any).from("support_messages").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: true });
    if (error) throw error;
    setMessages(data ?? []);
    await (supabase as any).from("support_messages").update({ read_at: new Date().toISOString() }).eq("conversation_id", conversationId).neq("sender_id", uid).is("read_at", null);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    let active = true;
    (async () => {
      try { await loadConversations(); }
      catch (e: any) { setLoadError(e.message ?? "تعذر تحميل محادثة الدعم"); toast.error(e.message ?? "تعذر تحميل محادثة الدعم"); }
      finally { if (active) setBooting(false); }
    })();
    return () => { active = false; };
  }, [uid, loadConversations]);

  useEffect(() => {
    if (!selected?.id) return;
    loadMessages(selected.id).catch((e: any) => { setLoadError(e.message ?? "تعذر تحميل الرسائل"); toast.error(e.message ?? "تعذر تحميل الرسائل"); });
    const channel = supabase.channel("support-" + selected.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages", filter: "conversation_id=eq." + selected.id }, (payload: any) => {
        setMessages((current) => current.some((m) => m.id === payload.new.id) ? current : [...current, payload.new]);
        if (payload.new.is_ai === true && !isStaff) {\n          notifyIncoming(payload.new);\n        } else if (payload.new.is_ai !== true && payload.new.sender_id !== uid) {\n          notifyIncoming(payload.new);\n          (supabase as any).from("support_messages").update({ read_at: new Date().toISOString() }).eq("id", payload.new.id).then(() => {});\n        }
        loadConversations().catch(() => {});
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selected?.id, uid, loadMessages, loadConversations, muted]);

  useEffect(() => {
    if (!uid) return;
    const channel = supabase.channel("support-list-" + uid)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations" }, () => loadConversations().catch(() => {}))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [uid, loadConversations]);

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;
  if (booting) return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin" /></div>;

  async function startConversation(targetId: string) {
    if (!uid || !isStaff || customerServiceOnly) return;
    const existing = await (supabase as any).from("support_conversations").select("*").eq("user_id", targetId).eq("status", "open").maybeSingle();
    let conversation = existing.data;
    if (!conversation) {
      const created = await (supabase as any).from("support_conversations").insert({ user_id: targetId, created_by: uid }).select("*").single();
      if (created.error) { toast.error(created.error.message); return; }
      conversation = created.data;
    }
    const target = providerTargets.find((p) => p.id === targetId);
    setSelected({ ...conversation, profile: target });
    await loadMessages(conversation.id);
    await loadConversations();
  }

  function notifyIncoming(message: any) {
    if (muted) return;
    try {
      if ("Notification" in window && Notification.permission === "granted") new Notification("رسالة جديدة في ممنون", { body: String(message.body ?? "وصلتك رسالة جديدة").slice(0, 120), silent: muted });
      const AudioContextClass = window.AudioContext;
      if (AudioContextClass) { const ctx = new AudioContextClass(); const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); oscillator.type = "sine"; oscillator.frequency.value = 880; gain.gain.value = 0.045; oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + 0.16); oscillator.onended = () => void ctx.close(); }
    } catch { /* Browser notification/audio may be unavailable until permission or a user gesture. */ }
  }

  async function send() {
    if (!draft.trim() || !selected || !uid || busy) return;
    const body = draft.trim();
    setBusy(true);
    setDraft("");
    const { data: sentMessage, error } = await (supabase as any).from("support_messages").insert({ conversation_id: selected.id, sender_id: uid, body }).select("*").single();
    setBusy(false);
    if (error) { setDraft(body); toast.error(error.message); }
    else if (sentMessage) {\n      setMessages((current) => current.some((m) => m.id === sentMessage.id) ? current : [...current, sentMessage]);\n      if (!isStaff) {\n        const { error: aiError } = await supabase.functions.invoke("support-ai-reply", { body: { message_id: sentMessage.id } });\n        if (aiError) console.warn("Support AI reply unavailable; staff can answer from inbox.", aiError.message);\n      }\n    }
  }

  return <div className="min-h-screen bg-background p-4 md:p-8">
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <a href={isStaff ? "/admin" : "/messages"} className="h-10 w-10 rounded-xl bg-card border border-border grid place-items-center"><ArrowRight className="h-5 w-5" /></a>
        <div><h1 className="text-2xl font-black">{customerServiceOnly ? "مركز خدمة العملاء" : "محادثة إدارة ممنون"}</h1><p className="text-xs text-muted-foreground">{customerServiceOnly ? "الرد على استفسارات ورسائل الزبائن فقط" : isStaff ? "استقبال رسائل الفنيين والسائقين والرد عليهم" : "تواصل مباشرة مع فريق شركة ممنون"}</p></div>
      </div>
      {isStaff && !customerServiceOnly && <div className="glass rounded-2xl p-3 mb-3">
        <div className="font-bold text-sm mb-2">ابدأ محادثة مع فني أو سائق</div>
        <input value={providerSearch} onChange={(e) => setProviderSearch(e.target.value)} placeholder="ابحث بالاسم أو رقم الهاتف" className="w-full rounded-xl bg-card border border-border px-3 py-2 text-sm outline-none mb-2" />
        <div className="flex flex-wrap gap-2">{providerTargets.filter((p) => !providerSearch.trim() || String(p.full_name ?? "").includes(providerSearch.trim()) || String(p.phone ?? "").includes(providerSearch.trim())).slice(0, 8).map((p) => <button key={p.id} onClick={() => void startConversation(p.id)} className="rounded-xl bg-primary/10 text-primary px-3 py-2 text-xs font-bold">{p.full_name || "مقدم خدمة"} · {p.phone || ""}</button>)}</div>
      </div>}
      <div className="grid md:grid-cols-[280px_1fr] gap-3">
        {isStaff && <aside className="glass rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 mb-3"><div className="font-black text-sm">صندوق الوارد</div><span className="text-[10px] text-muted-foreground">{conversations.length} محادثة</span></div>
          <div className="grid grid-cols-2 gap-1.5 mb-3"><button onClick={() => setUnansweredOnly(false)} className={"rounded-lg py-2 text-xs font-bold " + (!unansweredOnly ? "bg-primary text-primary-foreground" : "bg-card border border-border")}>الكل</button><button onClick={() => setUnansweredOnly(true)} className={"rounded-lg py-2 text-xs font-bold " + (unansweredOnly ? "bg-primary text-primary-foreground" : "bg-card border border-border")}>بانتظار الرد</button></div>
          <div className="space-y-2 max-h-[65vh] overflow-y-auto">{conversations.filter((c) => !unansweredOnly || c.unanswered).length === 0 ? <p className="text-xs text-muted-foreground p-4 text-center">{unansweredOnly ? "ماكو رسائل تنتظر الرد" : "لا توجد محادثات بعد"}</p> : conversations.filter((c) => !unansweredOnly || c.unanswered).map((c) => <button key={c.id} onClick={() => setSelected(c)} className={"w-full text-right rounded-2xl p-3 transition " + (selected?.id === c.id ? "bg-primary/10 border border-primary/40" : "bg-card border border-border hover:border-primary/30")}>
            <div className="flex items-center gap-2.5"><div className="h-11 w-11 rounded-full bg-muted overflow-hidden shrink-0 grid place-items-center">{c.profile?.avatar_url ? <img src={c.profile.avatar_url} alt="" className="h-full w-full object-cover" /> : <span className="font-black text-primary">{String(c.profile?.full_name || "م").slice(0,1)}</span>}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="font-black text-sm truncate">{c.profile?.full_name || "مستخدم ممنون"}</span>{c.unanswered && <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />}</div><div className="text-[11px] text-muted-foreground" dir="ltr">{c.profile?.phone || "—"}</div></div></div>
            <div className="mt-2 flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground truncate flex-1">{c.lastMessage?.body || "لا توجد رسائل بعد"}</p><span className="text-[9px] text-muted-foreground shrink-0">{c.lastMessage?.created_at ? new Date(c.lastMessage.created_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"}) : ""}</span></div>
            {c.unanswered && <div className="text-[10px] font-bold text-emerald-600 mt-1">تنتظر رد فريق الدعم</div>}
          </button>)}</div>
        </aside>}
        <section className="glass rounded-2xl min-h-[70vh] flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between gap-3"><div className="flex items-center gap-3 min-w-0"><div className="h-11 w-11 rounded-full bg-muted overflow-hidden shrink-0 grid place-items-center">{selected?.profile?.avatar_url ? <img src={selected.profile.avatar_url} alt="" className="h-full w-full object-cover" /> : <MessageCircle className="text-primary" />}</div><div className="min-w-0"><div className="font-black truncate">{isStaff ? selected?.profile?.full_name || "اختر محادثة" : "فريق دعم ممنون"}</div>{isStaff && <div className="text-xs text-muted-foreground" dir="ltr">{selected?.profile?.phone || ""}</div>}</div></div>{isStaff && <div className="flex items-center gap-1"><button title={muted ? "تشغيل الصوت" : "كتم الصوت"} onClick={() => { const next = !muted; setMuted(next); window.localStorage.setItem("mamnoon-support-muted", next ? "1" : "0"); }} className="rounded-xl border border-border p-2">{muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button><button title="السماح بالإشعارات" onClick={() => { if ("Notification" in window) void Notification.requestPermission(); }} className="rounded-xl border border-border p-2"><Bell className="h-4 w-4" /></button></div>}</div>
          {loadError && <div role="alert" className="mx-3 mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{loadError} — حدّث الصفحة وحاول مرة ثانية</div>}
          <div className="flex-1 p-4 space-y-3 overflow-y-auto">
            {messages.length === 0 ? <div className="text-center text-sm text-muted-foreground py-12">أهلاً بك، اكتب رسالتك وسيقوم فريق ممنون بالرد عليك.</div> : messages.map((m) => { const isCompanyMessage = m.is_ai === true || (isStaff ? m.sender_id === uid : m.sender_id !== uid); return <div key={m.id} className={"max-w-[85%] rounded-2xl px-3 py-2 text-sm border shadow-sm " + (isCompanyMessage ? "ml-auto border-[#B98A24] bg-gradient-to-br from-[#F8E7A1] via-[#E5BD50] to-[#C99A2E] text-[#2C2108] shadow-[#C99A2E]/20" : "mr-auto border-primary/20 bg-primary text-primary-foreground")}>
              {isCompanyMessage && <div className="flex items-center gap-1 text-[10px] font-black mb-1.5 text-[#5B4210]"><ShieldCheck className="h-3 w-3" /> شركة ممنون <span className="rounded-full bg-[#6D5015] text-[#FFF4C2] px-1.5 py-0.5 text-[9px]">موثّقة</span></div>}
              <p className="whitespace-pre-wrap break-words">{m.body}</p><div className={"text-[10px] mt-1 " + (isCompanyMessage ? "text-[#5B4210]/75" : "opacity-70")}>{new Date(m.created_at).toLocaleString("ar-IQ")}</div>
            </div>; })}
            <div ref={messagesEndRef} />
          </div>
          {selected?.status === "open" && <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="p-3 border-t border-border flex gap-2">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={4000} placeholder="اكتب رسالتك..." className="flex-1 min-w-0 rounded-xl bg-card border border-border px-3 py-3 text-sm outline-none" />
            <button disabled={!draft.trim() || busy} className="rounded-xl bg-primary text-primary-foreground px-4 disabled:opacity-50"><Send className="h-4 w-4" /></button>
          </form>}
        </section>
      </div>
    </div>
  </div>;
}
