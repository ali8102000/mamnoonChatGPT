import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, Send, Loader2, ArrowRight } from "lucide-react";
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
  const [conversations, setConversations] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);

  const loadConversations = useCallback(async () => {
    if (!uid) return;
    const { data: staff } = await (supabase as any).rpc("has_staff_role", { p_user_id: uid });
    setIsStaff(staff === true);
    if (staff) {
      const { data, error } = await (supabase as any).from("support_conversations").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      const ids: string[] = Array.from(new Set<string>((data ?? []).map((c: any) => String(c.user_id))));
      const { data: profiles } = ids.length ? await supabase.from("profiles").select("id,full_name,phone").in("id", ids) : { data: [] };
      const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      const rows = (data ?? []).map((c: any) => ({ ...c, profile: byId.get(c.user_id) }));
      setConversations(rows);
      if (selected) setSelected(rows.find((c: any) => c.id === selected.id) ?? null);
    } else {
      let { data, error } = await (supabase as any).from("support_conversations").select("*").eq("user_id", uid).eq("status", "open").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
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
      catch (e: any) { toast.error(e.message ?? "تعذر تحميل محادثة الدعم"); }
      finally { if (active) setBooting(false); }
    })();
    return () => { active = false; };
  }, [uid, loadConversations]);

  useEffect(() => {
    if (!selected?.id) return;
    loadMessages(selected.id).catch((e: any) => toast.error(e.message ?? "تعذر تحميل الرسائل"));
    const channel = supabase.channel("support-" + selected.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages", filter: "conversation_id=eq." + selected.id }, (payload: any) => {
        setMessages((current) => current.some((m) => m.id === payload.new.id) ? current : [...current, payload.new]);
        if (payload.new.sender_id !== uid) {
          (supabase as any).from("support_messages").update({ read_at: new Date().toISOString() }).eq("id", payload.new.id).then(() => {});
        }
        loadConversations().catch(() => {});
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selected?.id, uid, loadMessages, loadConversations]);

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

  async function send() {
    if (!draft.trim() || !selected || !uid || busy) return;
    const body = draft.trim();
    setBusy(true);
    setDraft("");
    const { error } = await (supabase as any).from("support_messages").insert({ conversation_id: selected.id, sender_id: uid, body });
    setBusy(false);
    if (error) { setDraft(body); toast.error(error.message); }
  }

  return <div className="min-h-screen bg-background p-4 md:p-8">
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <a href={isStaff ? "/admin" : "/messages"} className="h-10 w-10 rounded-xl bg-card border border-border grid place-items-center"><ArrowRight className="h-5 w-5" /></a>
        <div><h1 className="text-2xl font-black">محادثة إدارة ممنون</h1><p className="text-xs text-muted-foreground">{isStaff ? "استقبال رسائل الفنيين والسائقين والرد عليهم" : "تواصل مباشرة مع فريق شركة ممنون"}</p></div>
      </div>
      <div className="grid md:grid-cols-[280px_1fr] gap-3">
        {isStaff && <aside className="glass rounded-2xl p-3 space-y-2">
          <div className="font-bold text-sm mb-2">المحادثات الواردة</div>
          {conversations.length === 0 ? <p className="text-xs text-muted-foreground p-3">لا توجد محادثات بعد</p> : conversations.map((c) => <button key={c.id} onClick={() => setSelected(c)} className={"w-full text-right rounded-xl p-3 " + (selected?.id === c.id ? "bg-primary/10 border border-primary/30" : "bg-card border border-border")}>
            <div className="font-bold text-sm">{c.profile?.full_name || "مستخدم ممنون"}</div><div className="text-xs text-muted-foreground" dir="ltr">{c.profile?.phone || ""}</div><div className="text-[10px] text-muted-foreground mt-1">{c.status === "open" ? "مفتوحة" : "مغلقة"}</div>
          </button>)}
        </aside>}
        <section className="glass rounded-2xl min-h-[70vh] flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-2"><MessageCircle className="text-primary" /><div className="font-bold">{isStaff ? selected?.profile?.full_name || "اختر محادثة" : "فريق دعم ممنون"}</div></div>
          <div className="flex-1 p-4 space-y-3 overflow-y-auto">
            {messages.length === 0 ? <div className="text-center text-sm text-muted-foreground py-12">أهلاً بك، اكتب رسالتك وسيقوم فريق ممنون بالرد عليك.</div> : messages.map((m) => <div key={m.id} className={"max-w-[85%] rounded-2xl px-3 py-2 text-sm " + (m.sender_id === uid ? "mr-auto bg-primary text-primary-foreground" : "ml-auto bg-card border border-border")}>
              <p className="whitespace-pre-wrap break-words">{m.body}</p><div className="text-[10px] opacity-70 mt-1">{new Date(m.created_at).toLocaleString("ar-IQ")}</div>
            </div>)}
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
