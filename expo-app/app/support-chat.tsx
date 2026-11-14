import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius } from "@/styles/theme";

export default function SupportChatScreen() {
  const { user } = useAuth();
  const [staff, setStaff] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [providerTargets, setProviderTargets] = useState<any[]>([]);
  const [providerSearch, setProviderSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const messagesScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    messagesScrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, selected?.id]);

  const loadConversations = useCallback(async () => {
    if (!user?.id) return;
    const { data: staffCheck } = await (supabase as any).rpc("has_staff_role", { p_user_id: user.id });
    setStaff(staffCheck === true);
    if (staffCheck) {
      const [drivers, workers] = await Promise.all([
        (supabase as any).from("driver_profiles").select("user_id, profiles!inner(full_name, phone)").limit(300),
        (supabase as any).from("worker_profiles").select("user_id, profiles!inner(full_name, phone)").limit(300),
      ]);
      const targetMap = new Map<string, any>();
      for (const row of [...(drivers.data ?? []), ...(workers.data ?? [])]) {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        if (profile) targetMap.set(row.user_id, { id: row.user_id, ...profile });
      }
      setProviderTargets(Array.from(targetMap.values()));
      const { data, error } = await (supabase as any).from("support_conversations").select("*").order("priority_tier", { ascending: false }).order("updated_at", { ascending: true });
      if (error) throw error;
      const ids: string[] = Array.from(new Set<string>((data ?? []).map((c: any) => String(c.user_id))));
      const { data: profiles } = ids.length ? await supabase.from("profiles").select("id,full_name,phone").in("id", ids) : { data: [] };
      const map = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      const rows = (data ?? []).map((c: any) => ({ ...c, profile: map.get(c.user_id) }));
      setConversations(rows);
      if (selected) setSelected(rows.find((c: any) => c.id === selected.id) ?? null);
    } else {
      const initial = await (supabase as any).from("support_conversations").select("*").eq("user_id", user.id).eq("status", "open").limit(1).maybeSingle();
      let data = initial.data;
      if (initial.error) throw initial.error;
      if (!data) {
        const created = await (supabase as any).from("support_conversations").insert({ user_id: user.id, created_by: user.id }).select("*").single();
        if (created.error) {
          const retry = await (supabase as any).from("support_conversations").select("*").eq("user_id", user.id).eq("status", "open").maybeSingle();
          if (retry.error || !retry.data) throw created.error;
          data = retry.data;
        } else data = created.data;
      }
      setConversations([data]);
      setSelected(data);
    }
  }, [user?.id, selected?.id]);

  const loadMessages = useCallback(async (id: string) => {
    const { data, error } = await (supabase as any).from("support_messages").select("*").eq("conversation_id", id).order("created_at", { ascending: true });
    if (error) throw error;
    setMessages(data ?? []);
    await (supabase as any).from("support_messages").update({ read_at: new Date().toISOString() }).eq("conversation_id", id).neq("sender_id", user?.id).is("read_at", null);
  }, [user?.id]);

  useEffect(() => {
    let alive = true;
    loadConversations().catch((e: any) => { setLoadError(e.message ?? "تعذر تحميل المحادثات"); Alert.alert("ممنون", e.message ?? "تعذر تحميل المحادثات"); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loadConversations]);

  useEffect(() => {
    if (!selected?.id) return;
    loadMessages(selected.id).catch((e: any) => { setLoadError(e.message ?? "تعذر تحميل الرسائل"); Alert.alert("ممنون", e.message ?? "تعذر تحميل الرسائل"); });
    const ch = supabase.channel("support-mobile-" + selected.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages", filter: "conversation_id=eq." + selected.id }, (payload: any) => {
        setMessages((old) => old.some((m) => m.id === payload.new.id) ? old : [...old, payload.new]);
        if (payload.new.sender_id !== user?.id) (supabase as any).from("support_messages").update({ read_at: new Date().toISOString() }).eq("id", payload.new.id).then(() => {});
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selected?.id, user?.id, loadMessages]);

  async function startConversation(targetId: string) {
    if (!user?.id || !staff) return;
    const existing = await (supabase as any).from("support_conversations").select("*").eq("user_id", targetId).eq("status", "open").maybeSingle();
    let conversation = existing.data;
    if (!conversation) {
      const created = await (supabase as any).from("support_conversations").insert({ user_id: targetId, created_by: user.id }).select("*").single();
      if (created.error) { Alert.alert("ممنون", created.error.message); return; }
      conversation = created.data;
    }
    const target = providerTargets.find((p) => p.id === targetId);
    setSelected({ ...conversation, profile: target });
    await loadMessages(conversation.id);
    await loadConversations();
  }

  async function send() {
    if (!draft.trim() || !selected?.id || !user?.id || sending) return;
    const body = draft.trim();
    setSending(true);
    setDraft("");
    const { data: sentMessage, error } = await (supabase as any).from("support_messages").insert({ conversation_id: selected.id, sender_id: user.id, body }).select("*").single();
    setSending(false);
    if (error) { setDraft(body); Alert.alert("تعذر الإرسال", error.message); }
    else if (sentMessage) setMessages((current) => current.some((m) => m.id === sentMessage.id) ? current : [...current, sentMessage]);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator /></View>;
  return <View style={styles.container}>
    <Text style={styles.title}>محادثة إدارة ممنون</Text>
    {staff && <View style={styles.startBox}>
      <Text style={styles.startTitle}>ابدأ محادثة مع فني أو سائق</Text>
      <TextInput value={providerSearch} onChangeText={setProviderSearch} placeholder="ابحث بالاسم أو الهاتف" style={styles.searchInput} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {providerTargets.filter((p) => !providerSearch.trim() || String(p.full_name ?? "").includes(providerSearch.trim()) || String(p.phone ?? "").includes(providerSearch.trim())).slice(0, 8).map((p) => <TouchableOpacity key={p.id} onPress={() => void startConversation(p.id)} style={styles.person}><Text style={styles.personName}>{p.full_name || "مقدم خدمة"}</Text><Text style={styles.personPhone}>{p.phone || ""}</Text></TouchableOpacity>)}
      </ScrollView>
    </View>}
    {staff && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.list}>
      {conversations.map((c) => <TouchableOpacity key={c.id} onPress={() => setSelected(c)} style={[styles.person, selected?.id === c.id && styles.personActive]}>
        <Text style={styles.personName}>{c.profile?.full_name || "مستخدم"}</Text>
        <Text style={styles.personPhone}>{c.profile?.phone || ""}</Text><Text style={styles.personPhone}>{c.priority_tier === 3 ? "أولوية ذهبية" : c.priority_tier === 2 ? "أولوية فضية" : c.priority_tier === 1 ? "أولوية برونزية" : "اعتيادي"}</Text>
      </TouchableOpacity>)}
    </ScrollView>}
    {!!loadError && <Text style={styles.loadError}>{loadError} — حدّث الصفحة وحاول مرة ثانية</Text>}
    <ScrollView ref={messagesScrollRef} style={styles.messages} contentContainerStyle={{ paddingVertical: 14, gap: 10 }}>
      {messages.length === 0 ? <Text style={styles.empty}>أهلاً بك، اكتب رسالتك لفريق دعم ممنون.</Text> : messages.map((m) => { const isCompanyMessage = staff ? m.sender_id === user?.id : m.sender_id !== user?.id; return <View key={m.id} style={[styles.bubble, isCompanyMessage ? styles.company : styles.customer]}>
        {isCompanyMessage && <View style={styles.officialRow}><Text style={styles.officialMark}>✓</Text><Text style={styles.officialLabel}>شركة ممنون · موثّقة</Text></View>}
        <Text style={isCompanyMessage ? styles.companyText : styles.customerText}>{m.body}</Text>
        <Text style={isCompanyMessage ? styles.companyTime : styles.time}>{new Date(m.created_at).toLocaleString("ar-IQ")}</Text>
      </View>; })}
    </ScrollView>
    {selected?.status === "open" && <View style={styles.composer}>
      <TextInput value={draft} onChangeText={setDraft} placeholder="اكتب رسالتك..." multiline maxLength={4000} style={styles.input} />
      <TouchableOpacity onPress={send} disabled={!draft.trim() || sending} style={styles.send}><Text style={styles.sendText}>{sending ? "..." : "إرسال"}</Text></TouchableOpacity>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas, paddingTop: 52, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 23, fontWeight: "900", color: palette.ink, marginBottom: 14, textAlign: "right" },
  startBox: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: palette.line },
  startTitle: { fontSize: 13, fontWeight: "900", color: palette.ink, textAlign: "right", marginBottom: 8 },
  searchInput: { backgroundColor: palette.canvas, borderRadius: radius.md, padding: 12, textAlign: "right", marginBottom: 8, color: palette.ink },
  list: { maxHeight: 76, marginBottom: 10 },
  person: { backgroundColor: palette.surface, borderRadius: radius.md, padding: 10, marginRight: 8, minWidth: 130, borderWidth: 1, borderColor: palette.line },
  personActive: { borderColor: palette.gold, backgroundColor: palette.goldSoft },
  personName: { fontWeight: "900", color: palette.ink, textAlign: "right" },
  personPhone: { fontSize: 11, color: palette.muted, textAlign: "right" },
  messages: { flex: 1, backgroundColor: palette.surface, borderRadius: radius.lg, paddingHorizontal: 10, borderWidth: 1, borderColor: palette.line },
  empty: { color: palette.muted, textAlign: "center", marginTop: 40 },
  loadError: { color: palette.danger, backgroundColor: palette.dangerSoft, padding: 10, borderRadius: 10, marginBottom: 8, textAlign: "right", fontSize: 12 },
  bubble: { padding: 12, borderRadius: radius.lg, maxWidth: "86%" },
  customer: { alignSelf: "flex-start", backgroundColor: palette.brand, borderWidth: 1, borderColor: palette.brand },
  company: { alignSelf: "flex-end", backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: palette.gold, shadowColor: palette.gold, shadowOpacity: 0.14, shadowRadius: 5, elevation: 2 },
  customerText: { color: palette.white, fontSize: 14, textAlign: "right" },
  companyText: { color: palette.ink, fontSize: 14, textAlign: "right", fontWeight: "600" },
  officialRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, marginBottom: 7 },
  officialMark: { color: palette.brandDeep, backgroundColor: palette.gold, overflow: "hidden", borderRadius: 10, width: 16, height: 16, textAlign: "center", fontSize: 11, fontWeight: "900" },
  officialLabel: { color: palette.gold, fontSize: 10, fontWeight: "900" },
  time: { color: "rgba(255,255,255,0.72)", fontSize: 9, marginTop: 5, textAlign: "right" },
  companyTime: { color: palette.muted, fontSize: 9, marginTop: 5, textAlign: "right" },
  composer: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
  input: { flex: 1, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.pill, padding: 13, maxHeight: 100, textAlign: "right", color: palette.ink },
  send: { backgroundColor: palette.brand, borderRadius: radius.pill, paddingHorizontal: 17, paddingVertical: 14 },
  sendText: { color: palette.white, fontWeight: "900" },
});
