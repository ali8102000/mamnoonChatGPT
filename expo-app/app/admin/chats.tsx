import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";
import MamnoonChatThread from "../../components/MamnoonChatThread";

type Filter = "all" | "needs_reply" | "unread" | "bot" | "human" | "resolved" | "customer" | "technician" | "driver" | "restaurant" | "hotel" | "store";
type Conversation = {
  id: string; user_id: string; subject: string; status: string; created_at: string; updated_at: string; conversation_type?: "support" | "service"; request_id?: string; request_type?: string; request_status?: string;
  priority_tier: number; ai_status: string; ticket_status: string; needs_admin_reply: boolean;
  handoff_status: string; assigned_staff_id: string | null; last_message_source: string; last_message_at: string | null;
  profile: { id: string; full_name: string | null; phone: string | null; email: string | null; governorate_key: string | null } | null;\n  provider_profile?: { id: string; full_name: string | null; phone: string | null } | null;
  roles: string[]; account_category: string; latest_message: Message | null;
};
type Message = {
  id: string; conversation_id: string; sender_id: string; body: string; created_at: string;
  is_ai: boolean; ai_reply_to?: string | null; read_at?: string | null;
  sender?: { full_name?: string | null; phone?: string | null } | null;
};

const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "الكل" }, { key: "needs_reply", label: "تحتاج رد" },
  { key: "unread", label: "جديدة" }, { key: "bot", label: "البوت" },
  { key: "human", label: "الدعم المباشر" }, { key: "resolved", label: "محلولة" }, { key: "customer", label: "الزبائن" },
  { key: "technician", label: "الفنيون" }, { key: "driver", label: "التكسي" },
  { key: "restaurant", label: "المطاعم" }, { key: "hotel", label: "الفنادق" }, { key: "store", label: "المتاجر" },
];
const categoryLabel: Record<string, string> = {
  customer: "زبون", technician: "فني", driver: "صاحب تكسي",
  restaurant: "مطعم", hotel: "فندق", store: "متجر",
};
const sourceLabel = (source: string) => source === "bot" ? "البوت" : source === "admin" ? "الإدارة" : source === "provider" ? "منفّذ الخدمة" : source === "customer" ? "الزبون" : "المستخدم";

export default function AdminChatsScreen() {
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [remoteSearch, setRemoteSearch] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: callError } = await supabase.functions.invoke("admin-inbox", { body });
    if (callError) throw new Error(callError.message || "تعذر الاتصال بصندوق المراسلات");
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const loadInbox = useCallback(async () => {
    const result = await invoke({ action: "list", filter, limit: 100, search: remoteSearch });
    setConversations(result.conversations ?? []);
  }, [filter, invoke, remoteSearch]);

  const selected = useMemo(() => conversations.find(c => c.id === selectedId) ?? null, [conversations, selectedId]);

  const loadMessages = useCallback(async (id: string) => {
    const result = await invoke({ action: "messages", conversation_id: id, conversation_type: selected?.conversation_type ?? "support" });
    setMessages(result.messages ?? []);
  }, [invoke]);


  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) { setAllowed(false); setLoading(false); return; }
    void (async () => {
      try {
        const [{ data: moderation, error: accessError }, { data: superAdmin }] = await Promise.all([
          supabase.rpc("has_chat_moderation_access", { p_user_id: user.id }),
          supabase.rpc("is_super_admin", { p_user_id: user.id }),
        ]);
        setAllowed(superAdmin === true || (!accessError && moderation === true));
      } catch {
        setAllowed(false);
      }
    })();
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (allowed !== true) return;
    let active = true;
    setLoading(true);
    void loadInbox().catch(e => { if (active) setError(String(e?.message || "تعذر تحميل المحادثات")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed, loadInbox]);

  useEffect(() => {
    if (allowed !== true || !selectedId) { setMessages([]); return; }
    void loadMessages(selectedId).catch(e => setError(String(e?.message || "تعذر تحميل الرسائل")));
  }, [allowed, selectedId, loadMessages]);

  useEffect(() => {
    if (allowed !== true) return;
    const channel = supabase.channel("mamnoon-admin-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_messages" }, () => {
        void loadInbox().catch(() => undefined);
        if (selectedId) void loadMessages(selectedId).catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations" }, () => {
        void loadInbox().catch(() => undefined);
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [allowed, selectedId, loadInbox, loadMessages]);

  const refresh = async () => {
    setRefreshing(true);
    try { await loadInbox(); if (selectedId) await loadMessages(selectedId); }
    catch (e: any) { setError(String(e?.message || "تعذر التحديث")); }
    finally { setRefreshing(false); }
  };

  const sendReply = async () => {
    if (!selectedId || !draft.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await invoke({ action: "reply", conversation_id: selectedId, conversation_type: selected?.conversation_type ?? "support", message: draft.trim() });
      setDraft("");
      await Promise.all([loadMessages(selectedId), loadInbox()]);
    } catch (e: any) { setError(String(e?.message || "تعذر إرسال الرد")); }
    finally { setBusy(false); }
  };

  const changeStatus = (action: "handoff" | "resolve") => {
    if (!selectedId || busy) return;
    const title = action === "handoff" ? "تحويل للدعم المباشر" : "إنهاء المحادثة";
    Alert.alert(title, action === "handoff" ? "ستظهر المحادثة ضمن الرسائل التي تحتاج تدخلاً بشرياً." : "سيتم تعليم المحادثة كمحلولة.", [
      { text: "رجوع", style: "cancel" },
      { text: "تأكيد", onPress: () => {
        setBusy(true);
        void invoke({ action, conversation_id: selectedId })
          .then(async () => { await Promise.all([loadInbox(), loadMessages(selectedId)]); })
          .catch((e: any) => setError(String(e?.message || "تعذر تنفيذ العملية")))
          .finally(() => setBusy(false));
      } },
    ]);
  };

  const renderConversation = ({ item }: { item: Conversation }) => {
    const name = item.conversation_type === "service" ? `${item.profile?.full_name || "الزبون"} ↔ ${item.provider_profile?.full_name || "منفّذ الخدمة"}` : item.profile?.full_name || item.profile?.phone || "مستخدم ممنون";
    return (
      <TouchableOpacity onPress={() => setSelectedId(item.id)} style={[s.conversation, selectedId === item.id && s.conversationSelected]}>
        <View style={s.conversationTop}>
          <Text style={s.person} numberOfLines={1}>{name}</Text>
          <Text style={s.time}>{new Date(item.last_message_at || item.updated_at).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}</Text>
        </View>
        <View style={s.badges}>
          <Text style={s.category}>{item.conversation_type === "service" ? "محادثة طلب" : categoryLabel[item.account_category] || "مستخدم"}</Text>
          <Text style={s.source}>{sourceLabel(item.last_message_source)}</Text>
          {item.needs_admin_reply && <Text style={s.replyBadge}>تحتاج رد</Text>}
          {item.handoff_status === "resolved" && <Text style={s.resolvedBadge}>محلولة</Text>}
        </View>
        <Text style={s.preview} numberOfLines={2}>{item.latest_message?.body || item.subject || "لا توجد رسائل بعد"}</Text>
      </TouchableOpacity>
    );
  };

  if (authLoading || allowed === null || (loading && allowed !== false)) {
    return <View style={s.center}><ActivityIndicator size="large" color={palette.brand}/><Text style={s.muted}>جارٍ تحميل صندوق المراسلات...</Text></View>;
  }
  if (!allowed) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>صندوق المراسلات متاح للموظفين المخوّلين فقط.</Text></View>;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "مراسلات ممنون" }} />
      {!selectedId ? (
        <>
          <View style={s.header}>
            <Text style={s.title}>مراسلات ممنون</Text>
            <Text style={s.muted}>صندوق موحد للزبائن والفنيين والسائقين والشركاء والبوت</Text>
          </View>
          <View style={s.searchRow}>
            <TextInput value={searchInput} onChangeText={setSearchInput} onSubmitEditing={()=>setRemoteSearch(searchInput.trim())} placeholder="ابحث بالاسم أو الهاتف..." placeholderTextColor={palette.muted} style={s.searchInput}/>
            <TouchableOpacity onPress={()=>setRemoteSearch(searchInput.trim())} style={s.searchButton}><Text style={s.sendText}>بحث</Text></TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
            {filters.map(f => <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)} style={[s.filter, filter === f.key && s.filterActive]}>
              <Text style={[s.filterText, filter === f.key && s.filterTextActive]}>{f.label}</Text>
            </TouchableOpacity>)}
          </ScrollView>
          {!!error && <Text style={s.error}>{error}</Text>}
          <FlatList
            data={conversations}
            keyExtractor={item => item.id}
            renderItem={renderConversation}
            contentContainerStyle={s.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}
            ListEmptyComponent={<Text style={s.empty}>ماكو محادثات بهذا التصنيف حالياً</Text>}
          />
        </>
      ) : (
        <KeyboardAvoidingView style={s.detail} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={s.detailHeader}>
            <TouchableOpacity onPress={() => { setSelectedId(null); setMessages([]); setError(""); }} style={s.back}><Text style={s.backText}>رجوع</Text></TouchableOpacity>
            <View style={s.detailIdentity}>
              <Text style={s.person}>{selected?.conversation_type === "service" ? `${selected?.profile?.full_name || "الزبون"} ↔ ${selected?.provider_profile?.full_name || "منفّذ الخدمة"}` : selected?.profile?.full_name || selected?.profile?.phone || "مستخدم ممنون"}</Text>
              <Text style={s.muted}>{selected?.conversation_type === "service" ? "محادثة طلب خدمة" : categoryLabel[selected?.account_category || ""] || "مستخدم"} · {sourceLabel(selected?.last_message_source || "user")}</Text>
            </View>
          </View>
          {selected?.needs_admin_reply && <View style={s.alert}><Text style={s.alertText}>هذه المحادثة تحتاج رد من الإدارة</Text></View>}
          {!!error && <Text style={s.error}>{error}</Text>}
          <MamnoonChatThread
            messages={messages.map(message => ({
              id: message.id,
              senderId: message.sender_id,
              body: message.body,
              createdAt: message.created_at,
              isBot: message.is_ai,
              senderLabel: message.is_ai ? "مساعد ممنون" : message.sender_id === user?.id ? "الإدارة" : "المستخدم",
            }))}
            currentUserId={user?.id ?? ""}
            draft={draft}
            onDraftChange={setDraft}
            onSend={() => void sendReply()}
            busy={busy}
            placeholder="اكتب رد الإدارة..."
            emptyText="لا توجد رسائل في هذه المحادثة بعد"
            showQuickReplies={false}
            footer={
              <View style={s.actions}>
                <TouchableOpacity disabled={busy} onPress={() => changeStatus("handoff")} style={s.secondaryAction}><Text style={s.secondaryText}>تحويل للدعم</Text></TouchableOpacity>
                <TouchableOpacity disabled={busy} onPress={() => changeStatus("resolve")} style={s.secondaryAction}><Text style={s.secondaryText}>إنهاء</Text></TouchableOpacity>
              </View>
            }
          />
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:palette.pageCanvas},
  center:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor:palette.pageCanvas,padding:24,gap:10},
  header:{paddingHorizontal:space.lg,paddingTop:space.lg,gap:4},
  title:{fontSize:21,fontWeight:"900",color:palette.ink,textAlign:"right"},
  muted:{fontSize:11,color:palette.muted,textAlign:"right",lineHeight:18},
  searchRow:{flexDirection:"row",gap:8,paddingHorizontal:space.lg,paddingTop:space.md},
  searchInput:{flex:1,minHeight:40,borderRadius:12,borderWidth:1,borderColor:palette.line,backgroundColor:palette.surface,paddingHorizontal:12,color:palette.ink,textAlign:"right",fontSize:11},
  searchButton:{paddingHorizontal:16,justifyContent:"center",borderRadius:12,backgroundColor:palette.brand},
  filters:{paddingHorizontal:space.lg,paddingVertical:space.md,gap:7},
  filter:{paddingHorizontal:13,paddingVertical:9,borderRadius:30,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line},
  filterActive:{backgroundColor:palette.brand,borderColor:palette.brand},
  filterText:{fontSize:11,fontWeight:"800",color:palette.ink},
  filterTextActive:{color:palette.white},
  list:{paddingHorizontal:space.lg,paddingBottom:40,gap:8},
  conversation:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:13,gap:7},
  conversationSelected:{borderColor:palette.brand},
  conversationTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:10},
  person:{fontSize:13,fontWeight:"900",color:palette.ink,textAlign:"right",flexShrink:1},
  time:{fontSize:9,color:palette.muted},
  badges:{flexDirection:"row",justifyContent:"flex-end",alignItems:"center",flexWrap:"wrap",gap:6},
  category:{fontSize:9,fontWeight:"800",color:palette.brand,backgroundColor:palette.brandSoft,paddingHorizontal:8,paddingVertical:4,borderRadius:10},
  source:{fontSize:9,color:palette.muted,backgroundColor:palette.pageCanvas,paddingHorizontal:8,paddingVertical:4,borderRadius:10},
  replyBadge:{fontSize:9,fontWeight:"900",color:"#9A3412",backgroundColor:"#FFEDD5",paddingHorizontal:8,paddingVertical:4,borderRadius:10},
  resolvedBadge:{fontSize:9,fontWeight:"900",color:"#166534",backgroundColor:"#DCFCE7",paddingHorizontal:8,paddingVertical:4,borderRadius:10},
  preview:{fontSize:11,color:palette.muted,textAlign:"right",lineHeight:18},
  empty:{textAlign:"center",color:palette.muted,padding:30},
  error:{color:palette.danger,fontSize:11,textAlign:"right",paddingHorizontal:space.lg,paddingVertical:8},
  detail:{flex:1},
  detailHeader:{flexDirection:"row",alignItems:"center",gap:12,padding:space.lg,borderBottomWidth:1,borderBottomColor:palette.line,backgroundColor:palette.surface},
  back:{paddingHorizontal:12,paddingVertical:8,borderRadius:12,backgroundColor:palette.brandSoft},
  backText:{fontSize:11,fontWeight:"900",color:palette.brand},
  detailIdentity:{flex:1,gap:3},
  alert:{margin:space.md,padding:11,borderRadius:radius.md,backgroundColor:"#FFEDD5"},
  alertText:{fontSize:11,fontWeight:"900",color:"#9A3412",textAlign:"right"},
  messageList:{flex:1},
  messageContent:{padding:space.md,gap:10},
  bubble:{maxWidth:"88%",padding:12,borderRadius:16,gap:5},
  mine:{alignSelf:"flex-end",backgroundColor:palette.brandSoft,borderBottomRightRadius:4},
  theirs:{alignSelf:"flex-start",backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderBottomLeftRadius:4},
  bot:{alignSelf:"flex-start",backgroundColor:"#EDE9FE",borderBottomLeftRadius:4},
  bubbleSource:{fontSize:9,fontWeight:"900",color:palette.brand,textAlign:"right"},
  bubbleText:{fontSize:12,color:palette.ink,textAlign:"right",lineHeight:20},
  bubbleTime:{fontSize:8,color:palette.muted,textAlign:"left"},
  actions:{flexDirection:"row",justifyContent:"flex-end",gap:8,paddingHorizontal:space.md,paddingTop:8},
  secondaryAction:{paddingHorizontal:12,paddingVertical:8,borderRadius:12,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line},
  secondaryText:{fontSize:10,fontWeight:"800",color:palette.ink},
  composer:{flexDirection:"row",alignItems:"flex-end",gap:8,padding:space.md,borderTopWidth:1,borderTopColor:palette.line,backgroundColor:palette.surface},
  input:{flex:1,minHeight:42,maxHeight:110,borderRadius:14,borderWidth:1,borderColor:palette.line,padding:10,color:palette.ink,textAlign:"right",textAlignVertical:"center",fontSize:12},
  send:{paddingHorizontal:18,paddingVertical:13,borderRadius:14,backgroundColor:palette.brand},
  sendDisabled:{opacity:0.45},
  sendText:{fontSize:11,fontWeight:"900",color:palette.white},
});
