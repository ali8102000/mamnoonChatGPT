import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert, Image } from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius } from "@/styles/theme";
import { getNotificationChannelId, isNotificationSoundEnabled, isNotificationVibrationEnabled, loadNotificationPreferences } from "@/lib/notification-sound";

export default function SupportChatScreen() {
  const { user } = useAuth();
  const [staff, setStaff] = useState(false);
  const [customerServiceOnly, setCustomerServiceOnly] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [providerTargets, setProviderTargets] = useState<any[]>([]);
  const [providerSearch, setProviderSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [unansweredOnly, setUnansweredOnly] = useState(false);
  const [muted, setMuted] = useState(false);
  const messagesScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    messagesScrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, selected?.id]);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync("mamnoon-support-muted")
      .then((value) => { if (active) setMuted(value === "1"); })
      .catch(() => {});
    void loadNotificationPreferences().catch(() => {});
    return () => { active = false; };
  }, []);

  const loadConversations = useCallback(async () => {
    if (!user?.id) return;
    const { data: staffCheck } = await (supabase as any).rpc("has_staff_role", { p_user_id: user.id });
    const { data: staffRoles } = await (supabase as any).rpc("get_staff_roles", { p_user_id: user.id });
    const { data: assignment } = await (supabase as any).from("staff_assignments").select("rank").eq("user_id", user.id).eq("active", true).maybeSingle();
    const privilegedChatRoles = ["super_admin","admin","support","finance","moderator"];
    const isGeneralManager = assignment?.rank === "general_manager";
    const privilegedChatAccess = isGeneralManager || (staffRoles ?? []).some((r: string) => privilegedChatRoles.includes(r));
    const restrictedSupport = (staffRoles ?? []).includes("customer_service") && !privilegedChatAccess;
    setStaff(staffCheck === true || isGeneralManager);
    setCustomerServiceOnly(restrictedSupport);
    if (staffCheck || isGeneralManager) {
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
      const map = new Map((profiles ?? []).map((p: any) => [p.id, p]));
      const conversationIds = (data ?? []).map((c: any) => c.id);
      const { data: latestMessages } = conversationIds.length ? await (supabase as any).from("support_messages").select("id,conversation_id,sender_id,body,created_at").in("conversation_id", conversationIds).order("created_at", { ascending: false }) : { data: [] };
      const latestByConversation = new Map<string, any>();
      for (const message of latestMessages ?? []) if (!latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message);
      const rows = (data ?? []).map((c: any) => { const lastMessage = latestByConversation.get(c.id); return { ...c, profile: map.get(c.user_id), lastMessage, unanswered: !!lastMessage && lastMessage.sender_id === c.user_id }; })
        .sort((a: any, b: any) => new Date(b.lastMessage?.created_at ?? b.updated_at).getTime() - new Date(a.lastMessage?.created_at ?? a.updated_at).getTime());
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
  }, [selected?.id, loadMessages]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase.channel("support-mobile-inbox-" + user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages" }, (payload: any) => {
        const incoming = payload.new.sender_id !== user.id;
        if (payload.new.conversation_id === selected?.id) {
          setMessages((old) => old.some((m) => m.id === payload.new.id) ? old : [...old, payload.new]);
          if (incoming) {
            void (supabase as any).from("support_messages").update({ read_at: new Date().toISOString() }).eq("id", payload.new.id);
          }
        }
        if (incoming && !muted) {
          void Notifications.scheduleNotificationAsync({
            content: {
              title: "رسالة جديدة في ممنون",
              body: String(payload.new.body ?? "وصلتك رسالة جديدة").slice(0, 120),
              sound: isNotificationSoundEnabled() ? "default" : false,
              vibrate: isNotificationVibrationEnabled() ? [0, 250, 150, 250] : [],
            },
            trigger: { channelId: getNotificationChannelId() },
          }).catch(() => {});
        }
        if (staff) void loadConversations().catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, selected?.id, staff, muted, loadConversations]);

  async function enableNotifications() {
    try {
      await loadNotificationPreferences();
      const current = await Notifications.getPermissionsAsync();
      const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
      if (!permission.granted) Alert.alert("الإشعارات", "فعّل إذن الإشعارات من إعدادات الجهاز حتى توصلك تنبيهات الرسائل.");
      else Alert.alert("ممنون", "تم تفعيل إذن إشعارات الرسائل.");
    } catch {
      Alert.alert("الإشعارات", "تعذر تفعيل التنبيهات حالياً. تحقق من إعدادات الجهاز وحاول مرة ثانية.");
    }
  }

  async function startConversation(targetId: string) {
    if (!user?.id || !staff || customerServiceOnly) return;
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
    <Text style={styles.title}>{customerServiceOnly ? "مركز خدمة العملاء" : "محادثة إدارة ممنون"}</Text>
    {staff && !customerServiceOnly && <View style={styles.startBox}>
      <Text style={styles.startTitle}>ابدأ محادثة مع فني أو سائق</Text>
      <TextInput value={providerSearch} onChangeText={setProviderSearch} placeholder="ابحث بالاسم أو الهاتف" style={styles.searchInput} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {providerTargets.filter((p) => !providerSearch.trim() || String(p.full_name ?? "").includes(providerSearch.trim()) || String(p.phone ?? "").includes(providerSearch.trim())).slice(0, 8).map((p) => <TouchableOpacity key={p.id} onPress={() => void startConversation(p.id)} style={styles.person}><Text style={styles.personName}>{p.full_name || "مقدم خدمة"}</Text><Text style={styles.personPhone}>{p.phone || ""}</Text></TouchableOpacity>)}
      </ScrollView>
    </View>}
    {staff && <View style={styles.inbox}><View style={styles.inboxTop}><Text style={styles.inboxTitle}>صندوق الوارد</Text><View style={styles.actions}><TouchableOpacity onPress={() => { const next = !muted; setMuted(next); void SecureStore.setItemAsync("mamnoon-support-muted", next ? "1" : "0").catch(() => {}); }} style={styles.action}><Text style={styles.actionText}>{muted ? "🔕 مكتوم" : "🔔 الصوت"}</Text></TouchableOpacity><TouchableOpacity onPress={() => void enableNotifications()} style={styles.action}><Text style={styles.actionText}>تفعيل التنبيهات</Text></TouchableOpacity></View></View><View style={styles.filters}><TouchableOpacity onPress={() => setUnansweredOnly(false)} style={[styles.filter, !unansweredOnly && styles.filterActive]}><Text style={[styles.filterText, !unansweredOnly && styles.filterTextActive]}>الكل</Text></TouchableOpacity><TouchableOpacity onPress={() => setUnansweredOnly(true)} style={[styles.filter, unansweredOnly && styles.filterActive]}><Text style={[styles.filterText, unansweredOnly && styles.filterTextActive]}>بانتظار الرد</Text></TouchableOpacity></View><ScrollView style={styles.list} nestedScrollEnabled>{conversations.filter((c) => !unansweredOnly || c.unanswered).map((c) => <TouchableOpacity key={c.id} onPress={() => setSelected(c)} style={[styles.personRow, selected?.id === c.id && styles.personActive]}>{c.profile?.avatar_url ? <Image source={{ uri: c.profile.avatar_url }} style={styles.avatar} /> : <View style={styles.avatarFallback}><Text style={styles.avatarLetter}>{String(c.profile?.full_name || "م").slice(0,1)}</Text></View>}<View style={styles.personInfo}><View style={styles.personLine}><Text style={styles.personName}>{c.profile?.full_name || "مستخدم ممنون"}</Text>{c.unanswered && <View style={styles.unansweredDot} />}</View><Text style={styles.personPhone}>{c.profile?.phone || "—"}</Text><Text numberOfLines={1} style={styles.preview}>{c.lastMessage?.body || "لا توجد رسائل بعد"}</Text></View><Text style={styles.personTime}>{c.lastMessage?.created_at ? new Date(c.lastMessage.created_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"}) : ""}</Text></TouchableOpacity>)}{conversations.filter((c) => !unansweredOnly || c.unanswered).length === 0 && <Text style={styles.empty}>{unansweredOnly ? "ماكو رسائل تنتظر الرد" : "لا توجد محادثات بعد"}</Text>}</ScrollView></View>}
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
  inbox: { backgroundColor: palette.surface, borderRadius: radius.lg, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: palette.line, maxHeight: 310 },
  inboxTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  inboxTitle: { color: palette.ink, fontWeight: "900", fontSize: 15 },
  actions: { flexDirection: "row", gap: 5 },
  action: { borderWidth: 1, borderColor: palette.line, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 6 },
  actionText: { color: palette.ink, fontSize: 10, fontWeight: "800" },
  filters: { flexDirection: "row", gap: 6, marginBottom: 8 },
  filter: { flex: 1, borderRadius: 9, padding: 8, backgroundColor: palette.canvas, alignItems: "center" },
  filterActive: { backgroundColor: palette.brand },
  filterText: { color: palette.muted, fontSize: 11, fontWeight: "800" },
  filterTextActive: { color: palette.white },
  personRow: { flexDirection: "row", alignItems: "center", gap: 9, padding: 9, borderRadius: 12, borderWidth: 1, borderColor: palette.line, marginBottom: 6, backgroundColor: palette.canvas },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.goldSoft },
  avatarFallback: { width: 42, height: 42, borderRadius: 21, backgroundColor: palette.goldSoft, alignItems: "center", justifyContent: "center" },
  avatarLetter: { color: palette.brandDeep, fontWeight: "900", fontSize: 17 },
  personInfo: { flex: 1, minWidth: 0 },
  personLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  unansweredDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#16A34A" },
  preview: { color: palette.muted, fontSize: 10, textAlign: "right", marginTop: 2 },
  personTime: { color: palette.muted, fontSize: 9 },
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
