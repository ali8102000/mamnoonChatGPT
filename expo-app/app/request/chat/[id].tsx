import { useCallback, useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius } from "@/styles/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loadNotificationSoundPreference, setNotificationSoundPreference } from "@/lib/notification-sound";
import { showContactOptions } from "@/lib/contact-actions";

type ChatMessage = {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

const QUICK_REPLIES_CUSTOMER = ["وصلت!", "كم دقيقة؟", "أين أنت؟", "شكراً جزيلاً", "هل أنت قريب؟"];
const QUICK_REPLIES_PROVIDER = ["قادم إليك", "وصلت للموقع", "بانتظارك", "تم الإنجاز", "دقيقة واحدة"];

export default function RequestChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [chatId, setChatId] = useState<string | null>(null);
  const [request, setRequest] = useState<any>(null);
  const [otherProfile, setOtherProfile] = useState<any>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const isCustomer = request?.customer_id === user?.id;
  const quickReplies = isCustomer ? QUICK_REPLIES_CUSTOMER : QUICK_REPLIES_PROVIDER;

  useEffect(() => { void loadNotificationSoundPreference().then(setSoundEnabled); }, []);

  const loadMessages = useCallback(async (currentChatId: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("id, chat_id, sender_id, content, created_at")
      .eq("chat_id", currentChatId)
      .order("created_at", { ascending: true });
    if (!error) setMessages((data ?? []) as ChatMessage[]);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const { data: req, error: requestError } = await supabase
        .from("service_requests")
        .select("id, customer_id, provider_id, status, type")
        .eq("id", id)
        .maybeSingle();
      if (!active) return;
      if (requestError || !req || !user || ![req.customer_id, req.provider_id].includes(user.id)) {
        setLoading(false);
        return;
      }
      setRequest(req);
      if (["completed", "cancelled"].includes(req.status)) {
        setLoading(false);
        return;
      }
      const otherId = req.customer_id === user.id ? req.provider_id : req.customer_id;
      if (otherId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, avatar_url, phone")
          .eq("id", otherId)
          .maybeSingle();
        if (active) setOtherProfile(profile ?? null);
      }
      const { data: chat } = await supabase
        .from("chats")
        .select("id")
        .eq("request_id", id)
        .maybeSingle();
      if (!active) return;
      if (chat?.id) {
        setChatId(chat.id);
        await loadMessages(chat.id);
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [id, user?.id, loadMessages]);

  useEffect(() => {
    if (!chatId) return;
    const channel = supabase
      .channel(`request-chat-fullscreen-${chatId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `chat_id=eq.${chatId}`,
      }, () => { void loadMessages(chatId); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [chatId, loadMessages]);

  async function sendMessage(value?: string) {
    const content = (value ?? draft).trim();
    if (!content || !chatId || !user || sending) return;
    setSending(true);
    setDraft("");
    const { error } = await supabase.from("messages").insert({
      chat_id: chatId,
      sender_id: user.id,
      content,
    });
    if (error) setDraft(content);
    else await loadMessages(chatId);
    setSending(false);
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={palette.brand} size="large" /></View>;
  }

  if (!request || !chatId || ["completed", "cancelled"].includes(request.status)) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>المحادثة غير متاحة</Text>
        <Text style={styles.emptyText}>تبدأ المحادثة بعد قبول الطلب وتُغلق عند انتهاء الطلب.</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}><Text style={styles.backText}>رجوع</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerAction}>
          <Text style={styles.headerActionText}>رجوع</Text>
        </TouchableOpacity>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            {otherProfile?.avatar_url
              ? <Image source={{ uri: otherProfile.avatar_url }} style={styles.avatarImage} onError={() => setOtherProfile((p: any) => p ? { ...p, avatar_url: null } : p)} />
              : <Text style={styles.avatarFallback}>{(otherProfile?.full_name || "؟").charAt(0)}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{otherProfile?.full_name || "المستخدم"}</Text>
            <Text style={styles.subtitle}>{request.type === "taxi" ? "محادثة الرحلة" : "محادثة الخدمة"}</Text>
          </View>
        </View>
        {otherProfile?.phone ? (
          <TouchableOpacity style={styles.callButton} onPress={() => showContactOptions(otherProfile.phone!)}>
            <Text style={styles.callText}>اتصال</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={styles.soundButton}
          onPress={() => {
            const next = !soundEnabled;
            setSoundEnabled(next);
            void setNotificationSoundPreference(next);
          }}
        >
          <Text style={styles.soundText}>{soundEnabled ? "🔊" : "🔇"}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyMessages}><Text style={styles.emptyText}>ابدأ المحادثة 👋</Text></View>
        ) : messages.map((message) => {
          const mine = message.sender_id === user?.id;
          return (
            <View key={message.id} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text style={[styles.messageText, mine && styles.mineText]}>{message.content}</Text>
              <Text style={[styles.time, mine && styles.mineTime]}>{new Date(message.created_at).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}</Text>
            </View>
          );
        })}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.quickReplies}>
        {quickReplies.map((reply) => (
          <TouchableOpacity key={reply} style={styles.quickReply} onPress={() => void sendMessage(reply)}>
            <Text style={styles.quickReplyText}>{reply}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          style={styles.input}
          placeholder="اكتب رسالة..."
          placeholderTextColor={palette.muted}
          textAlign="right"
          multiline
          maxLength={2000}
          returnKeyType="send"
          onSubmitEditing={() => void sendMessage()}
        />
        <TouchableOpacity disabled={!draft.trim() || sending} onPress={() => void sendMessage()} style={[styles.sendButton, (!draft.trim() || sending) && { opacity: 0.5 }]}>
          <Text style={styles.sendText}>{sending ? "..." : "إرسال"}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: palette.canvas, gap: 12 },
  emptyTitle: { color: palette.ink, fontSize: 18, fontWeight: "900" },
  emptyText: { color: palette.muted, fontSize: 13, textAlign: "center" },
  backButton: { backgroundColor: palette.brand, paddingHorizontal: 24, paddingVertical: 12, borderRadius: radius.md, marginTop: 8 },
  backText: { color: palette.white, fontWeight: "900" },
  header: { minHeight: 76, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.line, flexDirection: "row", alignItems: "center", gap: 10 },
  headerAction: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: radius.md, backgroundColor: palette.surfaceSoft },
  headerActionText: { color: palette.ink, fontWeight: "900", fontSize: 12 },
  profile: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  avatar: { width: 42, height: 42, borderRadius: 15, overflow: "hidden", backgroundColor: palette.brandSoft, alignItems: "center", justifyContent: "center" },
  avatarImage: { width: "100%", height: "100%" },
  avatarFallback: { color: palette.brand, fontWeight: "900", fontSize: 17 },
  name: { color: palette.ink, fontWeight: "900", fontSize: 14, textAlign: "right" },
  subtitle: { color: palette.muted, fontSize: 10, marginTop: 3, textAlign: "right" },
  callButton: { backgroundColor: palette.brand, paddingHorizontal: 13, paddingVertical: 10, borderRadius: radius.md },
  callText: { color: palette.white, fontWeight: "900", fontSize: 12 },
  soundButton: { width: 40, height: 40, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface },
  soundText: { fontSize: 17 },
  messages: { flex: 1 },
  messagesContent: { padding: 16, gap: 10, flexGrow: 1, justifyContent: "flex-end" },
  emptyMessages: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  bubble: { maxWidth: "84%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, gap: 5 },
  mine: { alignSelf: "flex-start", backgroundColor: palette.brand },
  theirs: { alignSelf: "flex-end", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  messageText: { color: palette.ink, fontSize: 14, textAlign: "right", lineHeight: 21 },
  mineText: { color: palette.white },
  time: { color: palette.muted, fontSize: 9, textAlign: "left" },
  mineTime: { color: "rgba(255,255,255,0.72)" },
  quickReplies: { paddingHorizontal: 12, paddingVertical: 9, gap: 8 },
  quickReply: { borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, paddingHorizontal: 12, paddingVertical: 8 },
  quickReplyText: { color: palette.ink, fontSize: 11, fontWeight: "800" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 12, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.surface },
  input: { flex: 1, minHeight: 44, maxHeight: 110, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, backgroundColor: palette.canvas, paddingHorizontal: 13, paddingVertical: 10, color: palette.ink, fontSize: 14 },
  sendButton: { minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 17, borderRadius: radius.lg, backgroundColor: palette.brand },
  sendText: { color: palette.white, fontWeight: "900", fontSize: 13 },
});
