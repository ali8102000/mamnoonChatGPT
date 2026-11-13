import { useCallback, useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

export default function SupportChatScreen() {
  const { user } = useAuth();
  const [staff, setStaff] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const loadConversations = useCallback(async () => {
    if (!user?.id) return;
    const { data: staffCheck } = await (supabase as any).rpc("has_staff_role", { p_user_id: user.id });
    setStaff(staffCheck === true);
    if (staffCheck) {
      const { data, error } = await (supabase as any).from("support_conversations").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((c: any) => c.user_id))];
      const { data: profiles } = ids.length ? await supabase.from("profiles").select("id,full_name,phone").in("id", ids) : { data: [] };
      const map = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      const rows = (data ?? []).map((c: any) => ({ ...c, profile: map.get(c.user_id) }));
      setConversations(rows);
      if (selected) setSelected(rows.find((c: any) => c.id === selected.id) ?? null);
    } else {
      let { data, error } = await (supabase as any).from("support_conversations").select("*").eq("user_id", user.id).eq("status", "open").limit(1).maybeSingle();
      if (error) throw error;
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
    loadConversations().catch((e: any) => Alert.alert("ممنون", e.message ?? "تعذر تحميل المحادثات")).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loadConversations]);

  useEffect(() => {
    if (!selected?.id) return;
    loadMessages(selected.id).catch((e: any) => Alert.alert("ممنون", e.message ?? "تعذر تحميل الرسائل"));
    const ch = supabase.channel("support-mobile-" + selected.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages", filter: "conversation_id=eq." + selected.id }, (payload: any) => {
        setMessages((old) => old.some((m) => m.id === payload.new.id) ? old : [...old, payload.new]);
        if (payload.new.sender_id !== user?.id) (supabase as any).from("support_messages").update({ read_at: new Date().toISOString() }).eq("id", payload.new.id).then(() => {});
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selected?.id, user?.id, loadMessages]);

  async function send() {
    if (!draft.trim() || !selected?.id || !user?.id || sending) return;
    const body = draft.trim();
    setSending(true);
    setDraft("");
    const { error } = await (supabase as any).from("support_messages").insert({ conversation_id: selected.id, sender_id: user.id, body });
    setSending(false);
    if (error) { setDraft(body); Alert.alert("تعذر الإرسال", error.message); }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator /></View>;
  return <View style={styles.container}>
    <Text style={styles.title}>محادثة إدارة ممنون</Text>
    {staff && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.list}>
      {conversations.map((c) => <TouchableOpacity key={c.id} onPress={() => setSelected(c)} style={[styles.person, selected?.id === c.id && styles.personActive]}>
        <Text style={styles.personName}>{c.profile?.full_name || "مستخدم"}</Text>
        <Text style={styles.personPhone}>{c.profile?.phone || ""}</Text>
      </TouchableOpacity>)}
    </ScrollView>}
    <ScrollView style={styles.messages} contentContainerStyle={{ paddingVertical: 14, gap: 10 }}>
      {messages.length === 0 ? <Text style={styles.empty}>أهلاً بك، اكتب رسالتك لفريق دعم ممنون.</Text> : messages.map((m) => <View key={m.id} style={[styles.bubble, m.sender_id === user?.id ? styles.mine : styles.theirs]}>
        <Text style={m.sender_id === user?.id ? styles.mineText : styles.theirText}>{m.body}</Text>
        <Text style={styles.time}>{new Date(m.created_at).toLocaleString("ar-IQ")}</Text>
      </View>)}
    </ScrollView>
    {selected?.status === "open" && <View style={styles.composer}>
      <TextInput value={draft} onChangeText={setDraft} placeholder="اكتب رسالتك..." multiline maxLength={4000} style={styles.input} />
      <TouchableOpacity onPress={send} disabled={!draft.trim() || sending} style={styles.send}><Text style={styles.sendText}>{sending ? "..." : "إرسال"}</Text></TouchableOpacity>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", paddingTop: 52, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 23, fontWeight: "900", color: "#172033", marginBottom: 14, textAlign: "right" },
  list: { maxHeight: 76, marginBottom: 10 },
  person: { backgroundColor: "#fff", borderRadius: 12, padding: 10, marginRight: 8, minWidth: 130, borderWidth: 1, borderColor: "#e2e8f0" },
  personActive: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  personName: { fontWeight: "800", color: "#172033", textAlign: "right" },
  personPhone: { fontSize: 11, color: "#64748b", textAlign: "right" },
  messages: { flex: 1, backgroundColor: "#fff", borderRadius: 16, paddingHorizontal: 10 },
  empty: { color: "#94a3b8", textAlign: "center", marginTop: 40 },
  bubble: { padding: 11, borderRadius: 14, maxWidth: "86%" },
  mine: { alignSelf: "flex-start", backgroundColor: "#2563eb" },
  theirs: { alignSelf: "flex-end", backgroundColor: "#f1f5f9" },
  mineText: { color: "#fff", fontSize: 14, textAlign: "right" },
  theirText: { color: "#172033", fontSize: 14, textAlign: "right" },
  time: { color: "#94a3b8", fontSize: 9, marginTop: 5, textAlign: "right" },
  composer: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
  input: { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, maxHeight: 100, textAlign: "right" },
  send: { backgroundColor: "#2563eb", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13 },
  sendText: { color: "#fff", fontWeight: "800" },
});
