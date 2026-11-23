import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, space } from "@/styles/theme";
import MamnoonChatThread from "../../components/MamnoonChatThread";

type Filter = "all" | "unread" | "bot" | "pending" | "favorites";
type Conversation = {
  id: string; user_id: string; subject: string; status: string; created_at: string; updated_at: string;
  conversation_type?: "support" | "service"; request_id?: string; request_type?: string; request_status?: string;
  priority_tier: number; ai_status: string; ticket_status: string; needs_admin_reply: boolean;
  handoff_status: string; assigned_staff_id: string | null; last_message_source: string; last_message_at: string | null;
  profile: { id: string; full_name: string | null; phone: string | null; email: string | null; governorate_key: string | null } | null;
  provider_profile?: { id: string; full_name: string | null; phone: string | null } | null;
  complaints?: { id: string; reason: string; details: string | null; status: string; created_at: string }[];
  roles: string[]; account_category: string; latest_message: Message | null;
};
type Message = {
  id: string; conversation_id: string; sender_id: string; body: string; created_at: string;
  is_ai: boolean; ai_reply_to?: string | null; read_at?: string | null;
  sender?: { full_name?: string | null; phone?: string | null } | null;
};
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "الكل" }, { key: "unread", label: "غير مقروءة" },
  { key: "bot", label: "محوّلة من البوت" }, { key: "pending", label: "المعلّقة" },
  { key: "favorites", label: "المفضلة" },
];
const categoryLabel: Record<string, string> = { customer: "زبون", technician: "فني", driver: "صاحب تكسي", restaurant: "مطعم", hotel: "فندق", store: "متجر" };
const sourceLabel = (source: string) => source === "bot" ? "البوت" : source === "admin" ? "الإدارة" : source === "provider" ? "منفّذ الخدمة" : source === "customer" || source === "user" ? "الزبون" : "المستخدم";
const isUnread = (item: Conversation) => item.conversation_type !== "service" && !!item.latest_message && !item.latest_message.read_at && item.latest_message.sender_id === item.user_id;
const isBotHandoff = (item: Conversation) => item.conversation_type === "support" && (item.last_message_source === "bot" || item.latest_message?.is_ai === true || item.handoff_status === "waiting_for_admin");
const isPending = (item: Conversation) => item.ticket_status === "pending" || item.ticket_status === "new" || item.status === "pending" || item.needs_admin_reply || item.handoff_status === "waiting_for_admin";

export default function AdminChatsScreen() {
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [remoteSearch, setRemoteSearch] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
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
    const result = await invoke({ action: "list", filter: "all", limit: 100, search: remoteSearch });
    setConversations(result.conversations ?? []);
  }, [invoke, remoteSearch]);

  const selected = useMemo(() => conversations.find(c => c.id === selectedId) ?? null, [conversations, selectedId]);
  const visibleConversations = useMemo(() => conversations.filter(item => {
    if (filter === "unread") return isUnread(item);
    if (filter === "bot") return isBotHandoff(item);
    if (filter === "pending") return isPending(item);
    if (filter === "favorites") return favorites.includes(item.id);
    return true;
  }), [conversations, favorites, filter]);
  const counts = useMemo(() => ({
    all: conversations.length,
    unread: conversations.filter(isUnread).length,
    bot: conversations.filter(isBotHandoff).length,
    pending: conversations.filter(isPending).length,
    favorites: conversations.filter(item => favorites.includes(item.id)).length,
  }), [conversations, favorites]);

  const loadMessages = useCallback(async (id: string) => {
    const conversation = conversations.find(item => item.id === id);
    const result = await invoke({ action: "messages", conversation_id: id, conversation_type: conversation?.conversation_type ?? "support" });
    setMessages(result.messages ?? []);
  }, [conversations, invoke]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) { setAllowed(false); setLoading(false); return; }
    let active = true;
    void (async () => {
      try {
        const [{ data: moderation, error: accessError }, { data: superAdmin }] = await Promise.all([
          supabase.rpc("has_chat_moderation_access", { p_user_id: user.id }),
          supabase.rpc("is_super_admin", { p_user_id: user.id }),
        ]);
        if (active) setAllowed(superAdmin === true || (!accessError && moderation === true));
      } catch { if (active) setAllowed(false); }
    })();
    return () => { active = false; };
  }, [authLoading, user?.id]);

  useEffect(() => {
    void SecureStore.getItemAsync("mamnoon_admin_chat_favorites")
      .then(value => { if (value) setFavorites(JSON.parse(value)); })
      .catch(() => undefined);
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites(current => {
      const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id];
      void SecureStore.setItemAsync("mamnoon_admin_chat_favorites", JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  useEffect(() => {
    if (allowed !== true) return;
    let active = true;
    setLoading(true); setError("");
    void loadInbox().catch(e => { if (active) setError(String(e?.message || "تعذر تحميل المحادثات")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed, loadInbox]);

  useEffect(() => {
    if (allowed !== true || !selectedId) { setMessages([]); return; }
    let active = true;
    void loadMessages(selectedId).catch(e => { if (active) setError(String(e?.message || "تعذر تحميل الرسائل")); });
    return () => { active = false; };
  }, [allowed, selectedId, loadMessages]);

  useEffect(() => {
    if (allowed !== true) return;
    const channel = supabase.channel("mamnoon-admin-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_messages" }, () => {
        void loadInbox().catch(() => undefined);
        if (selectedId) void loadMessages(selectedId).catch(() => undefined);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations" }, () => { void loadInbox().catch(() => undefined); })
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

  const closeConversation = () => { setSelectedId(null); setMessages([]); setDraft(""); setError(""); };
  const renderConversation = ({ item }: { item: Conversation }) => {
    const name = item.conversation_type === "service" ? `${item.profile?.full_name || "الزبون"} ↔ ${item.provider_profile?.full_name || "منفّذ الخدمة"}` : item.profile?.full_name || item.profile?.phone || "مستخدم ممنون";
    const unread = isUnread(item);
    return (
      <TouchableOpacity activeOpacity={0.75} onPress={() => { setSelectedId(item.id); setDraft(""); setError(""); }} style={s.conversation}>
        <View style={s.avatar}><Text style={s.avatarText}>{(name.trim()[0] || "م").toUpperCase()}</Text></View>
        <View style={s.conversationBody}>
          <View style={s.conversationTop}>
            <Text style={s.person} numberOfLines={1}>{name}</Text>
            <Text style={s.time}>{new Date(item.last_message_at || item.updated_at).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}</Text>
          </View>
          <View style={s.previewRow}>
            <Text style={s.preview} numberOfLines={1}>{item.latest_message?.body || item.subject || "لا توجد رسائل بعد"}</Text>
            <View style={s.rowBadges}>
              {isBotHandoff(item) && <Text style={s.botBadge}>بوت</Text>}
              {unread && <Text style={s.unreadBadge}>جديد</Text>}
              {isPending(item) && <Text style={s.pendingDot}>•</Text>}
            </View>
          </View>
          <Text style={s.role} numberOfLines={1}>{item.conversation_type === "service" ? "محادثة طلب خدمة" : categoryLabel[item.account_category] || "مستخدم"}{item.request_id ? ` · طلب ${item.request_id.slice(0,8)}` : ""}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={favorites.includes(item.id) ? "إزالة من المفضلة" : "إضافة للمفضلة"} onPress={() => toggleFavorite(item.id)} style={s.favoriteButton}>
          <Text style={[s.favoriteIcon, favorites.includes(item.id) && s.favoriteActive]}>{favorites.includes(item.id) ? "★" : "☆"}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  if (authLoading || allowed === null || (loading && allowed !== false)) {
    return <View style={s.center}><ActivityIndicator size="large" color={palette.brand}/><Text style={s.muted}>جارٍ تحميل صندوق المراسلات...</Text></View>;
  }
  if (!allowed) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>صندوق المراسلات متاح للموظفين المخوّلين فقط.</Text></View>;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "مراسلات ممنون", headerShown: false }} />
      {!selectedId ? (
        <>
          <View style={s.header}>
            <Text style={s.title}>مراسلات ممنون</Text>
            <TouchableOpacity onPress={() => void refresh()} style={s.headerAction}><Text style={s.headerActionText}>↻</Text></TouchableOpacity>
          </View>
          <View style={s.searchRow}>
            <Text style={s.searchIcon}>⌕</Text>
            <TextInput value={searchInput} onChangeText={setSearchInput} onSubmitEditing={()=>setRemoteSearch(searchInput.trim())} returnKeyType="search" placeholder="ابحث بالاسم أو الهاتف..." placeholderTextColor={palette.muted} style={s.searchInput}/>
            {!!searchInput && <TouchableOpacity onPress={()=>{setSearchInput("");setRemoteSearch("");}} style={s.clearSearch}><Text style={s.clearText}>×</Text></TouchableOpacity>}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
            {FILTERS.map(f => <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)} style={[s.filter, filter === f.key && s.filterActive]}>
              <Text style={[s.filterText, filter === f.key && s.filterTextActive]}>{f.label}</Text>
              <Text style={[s.filterCount, filter === f.key && s.filterCountActive]}>{counts[f.key]}</Text>
            </TouchableOpacity>)}
          </ScrollView>
          {!!error && <Text style={s.error}>{error}</Text>}
          <FlatList
            style={s.listFlex}
            data={visibleConversations}
            keyExtractor={item => item.id}
            renderItem={renderConversation}
            contentContainerStyle={s.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}
            ListEmptyComponent={<Text style={s.empty}>ماكو محادثات بهذا التصنيف حالياً</Text>}
            keyboardShouldPersistTaps="handled"
          />
        </>
      ) : (
        <KeyboardAvoidingView style={s.detail} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={s.detailHeader}>
            <TouchableOpacity onPress={closeConversation} style={s.back}><Text style={s.backText}>‹</Text></TouchableOpacity>
            <View style={s.detailAvatar}><Text style={s.detailAvatarText}>{(selected?.profile?.full_name?.[0] || "م").toUpperCase()}</Text></View>
            <View style={s.detailIdentity}>
              <Text style={s.detailName} numberOfLines={1}>{selected?.conversation_type === "service" ? `${selected?.profile?.full_name || "الزبون"} ↔ ${selected?.provider_profile?.full_name || "منفّذ الخدمة"}` : selected?.profile?.full_name || selected?.profile?.phone || "مستخدم ممنون"}</Text>
              <Text style={s.muted} numberOfLines={1}>{selected?.conversation_type === "service" ? "محادثة طلب خدمة" : categoryLabel[selected?.account_category || ""] || "مستخدم"} · {sourceLabel(selected?.last_message_source || "user")}</Text>
            </View>
            <TouchableOpacity onPress={() => selected && toggleFavorite(selected.id)} style={s.headerAction}><Text style={[s.favoriteIcon, selected && favorites.includes(selected.id) && s.favoriteActive]}>★</Text></TouchableOpacity>
          </View>
          {!!selected && isBotHandoff(selected) && <View style={s.botHandoff}><Text style={s.botHandoffText}>محوّلة من البوت · {selected?.subject || "بانتظار متابعة موظف الدعم"}</Text></View>}
          {selected?.needs_admin_reply && <View style={s.alert}><Text style={s.alertText}>هذه المحادثة تحتاج رد من الإدارة</Text></View>}
          {!!selected?.complaints?.length && <View style={s.alert}><Text style={s.alertText}>شكوى مرتبطة بالطلب: {selected.complaints[0].reason}</Text></View>}
          {!!error && <Text style={s.error}>{error}</Text>}
          <MamnoonChatThread
            messages={messages.map(message => ({
              id: message.id, senderId: message.sender_id, body: message.body, createdAt: message.created_at,
              isBot: message.is_ai, senderLabel: message.is_ai ? "مساعد ممنون" : message.sender_id === user?.id ? "الإدارة" : selected?.conversation_type === "service" && message.sender_id === selected.provider_profile?.id ? "منفّذ الخدمة" : selected?.conversation_type === "service" && message.sender_id === selected.profile?.id ? "الزبون" : selected?.conversation_type === "service" ? "الإدارة" : "المستخدم",
            }))}
            currentUserId={user?.id ?? ""} draft={draft} onDraftChange={setDraft} onSend={() => void sendReply()} busy={busy}
            placeholder="اكتب رسالة..." emptyText="لا توجد رسائل في هذه المحادثة بعد" showQuickReplies={false}
            footer={selected?.conversation_type === "service" ? null : (
              <View style={s.actions}>
                <TouchableOpacity disabled={busy} onPress={() => changeStatus("handoff")} style={s.secondaryAction}><Text style={s.secondaryText}>تحويل للدعم</Text></TouchableOpacity>
                <TouchableOpacity disabled={busy} onPress={() => changeStatus("resolve")} style={s.secondaryAction}><Text style={s.secondaryText}>إنهاء</Text></TouchableOpacity>
              </View>
            )}
          />
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor:palette.pageCanvas},
  center:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor:palette.pageCanvas,padding:24,gap:10},
  header:{height:56,paddingHorizontal:16,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  title:{fontSize:21,fontWeight:"900",color:palette.ink,textAlign:"right"},
  muted:{fontSize:12,color:palette.muted,textAlign:"right"},
  headerAction:{width:40,height:40,borderRadius:20,alignItems:"center",justifyContent:"center"},
  headerActionText:{fontSize:24,color:palette.ink},
  searchRow:{height:38,marginHorizontal:16,marginTop:4,marginBottom:5,paddingHorizontal:12,borderRadius:19,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,flexDirection:"row",alignItems:"center",gap:8},
  searchIcon:{fontSize:21,color:palette.muted},
  searchInput:{flex:1,height:38,padding:0,color:palette.ink,textAlign:"right",fontSize:14},
  clearSearch:{width:24,height:30,alignItems:"center",justifyContent:"center"},
  clearText:{fontSize:22,color:palette.muted},
  filters:{height:42,paddingHorizontal:16,alignItems:"center",gap:8},
  filter:{height:32,paddingHorizontal:12,borderRadius:16,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,flexDirection:"row",alignItems:"center",gap:5},
  filterActive:{backgroundColor:palette.brand,borderColor:palette.brand},
  filterText:{fontSize:13,color:palette.ink,fontWeight:"600"},
  filterTextActive:{color:palette.white},
  filterCount:{fontSize:10,color:palette.muted,fontWeight:"800"},
  filterCountActive:{color:palette.white},
  listFlex:{flex:1},
  list:{paddingHorizontal:0,paddingBottom:12},
  conversation:{height:72,paddingHorizontal:16,flexDirection:"row",alignItems:"center",gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:palette.line,backgroundColor:palette.pageCanvas},
  avatar:{width:48,height:48,borderRadius:24,backgroundColor:palette.brandSoft,alignItems:"center",justifyContent:"center"},
  avatarText:{fontSize:19,fontWeight:"800",color:palette.brand},
  conversationBody:{flex:1,minWidth:0,justifyContent:"center",gap:5},
  conversationTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:8},
  person:{fontSize:15.5,fontWeight:"700",color:palette.ink,textAlign:"right",flex:1},
  time:{fontSize:12,color:palette.muted},
  previewRow:{flexDirection:"row",alignItems:"center",gap:6},
  preview:{flex:1,fontSize:13.5,color:palette.muted,textAlign:"right"},
  rowBadges:{flexDirection:"row",alignItems:"center",gap:5},
  botBadge:{fontSize:10,fontWeight:"800",color:"#6842B8",backgroundColor:"#EEE9FF",paddingHorizontal:6,paddingVertical:2,borderRadius:8},
  unreadBadge:{fontSize:10,fontWeight:"800",color:palette.white,backgroundColor:palette.brand,paddingHorizontal:6,paddingVertical:3,borderRadius:10,overflow:"hidden"},
  pendingDot:{fontSize:18,color:"#D97706",lineHeight:18},
  role:{fontSize:10,color:palette.muted,textAlign:"right"},
  favoriteButton:{width:30,height:40,alignItems:"center",justifyContent:"center"},
  favoriteIcon:{fontSize:21,color:palette.muted},
  favoriteActive:{color:"#D69E24"},
  empty:{textAlign:"center",color:palette.muted,padding:30},
  error:{color:palette.danger,fontSize:11,textAlign:"right",paddingHorizontal:16,paddingVertical:6},
  detail:{flex:1},
  detailHeader:{height:56,flexDirection:"row",alignItems:"center",gap:9,paddingHorizontal:12,borderBottomWidth:1,borderBottomColor:palette.line,backgroundColor:palette.surface},
  back:{width:40,height:40,alignItems:"center",justifyContent:"center"},
  backText:{fontSize:32,color:palette.ink},
  detailAvatar:{width:38,height:38,borderRadius:19,backgroundColor:palette.brandSoft,alignItems:"center",justifyContent:"center"},
  detailAvatarText:{fontSize:16,fontWeight:"800",color:palette.brand},
  detailIdentity:{flex:1,minWidth:0,gap:2},
  detailName:{fontSize:16,fontWeight:"700",color:palette.ink,textAlign:"right"},
  alert:{paddingHorizontal:12,paddingVertical:8,backgroundColor:"#FFF1D6"},
  botHandoff:{paddingHorizontal:12,paddingVertical:8,backgroundColor:"#EEE9FF"},
  botHandoffText:{fontSize:11,fontWeight:"700",color:"#6842B8",textAlign:"right"},
  alertText:{fontSize:11,fontWeight:"700",color:"#8A4B08",textAlign:"right"},
  actions:{flexDirection:"row",justifyContent:"flex-end",gap:8,paddingHorizontal:12,paddingTop:6},
  secondaryAction:{paddingHorizontal:12,paddingVertical:8,borderRadius:12,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line},
  secondaryText:{fontSize:11,fontWeight:"800",color:palette.ink},
});
