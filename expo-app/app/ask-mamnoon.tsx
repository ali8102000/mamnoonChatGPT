import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type ChatMessage = { id: string; role: "user" | "assistant"; text: string };

export default function AskMamnoonScreen() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [supportHandoff, setSupportHandoff] = useState(false);

  async function send() {
    const message = draft.trim();
    if (!message || sending || !user?.id) return;
    setDraft("");
    setError("");
    setSupportHandoff(false);
    setMessages((current) => [...current, { id: String(Date.now()), role: "user", text: message }]);
    setSending(true);
    const { data, error: invokeError } = await supabase.functions.invoke("mamnoon-ai", {
      body: { action: "chat", message },
    });
    setSending(false);
    if (invokeError || !data?.answer) {
      setError("المساعد الذكي غير متاح حالياً. تأكد من تفعيل الخدمة وحاول مرة ثانية.");
      return;
    }
    setMessages((current) => [...current, { id: String(Date.now()) + "-assistant", role: "assistant", text: data.answer }]);
    setSupportHandoff(data.handoff === true);
  }

  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>رجوع</Text></TouchableOpacity>
        <Text style={styles.title}>اسأل ممنون</Text>
        <Text style={styles.subtitle}>مساعدك لمعرفة خدمات ممنون والمنشآت والأسعار المنشورة</Text>
      </View>
      <ScrollView style={styles.messages} contentContainerStyle={styles.messageContent}>
        {messages.length === 0 && <Text style={styles.empty}>هلا بيك! اسألني عن خدمات ممنون أو الفنادق والمطاعم والمحلات المنشورة.</Text>}
        {messages.map((item) => <View key={item.id} style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.aiBubble]}><Text style={[styles.messageText, item.role === "user" && styles.userText]}>{item.text}</Text></View>)}
        {sending && <View style={styles.loading}><ActivityIndicator color={palette.brand}/><Text style={styles.hint}>ممنون يفكر...</Text></View>}
      </ScrollView>
      {supportHandoff && <TouchableOpacity onPress={() => router.push("/support-chat")} style={styles.supportHandoff}><Text style={styles.supportHandoffText}>متابعة الاستفسار مع فريق الدعم ←</Text></TouchableOpacity>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.composer}>
        <TextInput value={draft} onChangeText={setDraft} placeholder="اكتب سؤالك..." maxLength={1200} multiline style={styles.input}/>
        <TouchableOpacity onPress={() => void send()} disabled={!draft.trim() || sending} style={[styles.send, (!draft.trim() || sending) && styles.disabled]}><Text style={styles.sendText}>إرسال</Text></TouchableOpacity>
      </View>
      <Text style={styles.disclaimer}>الإجابات معلوماتية ولا تؤكد الحجز أو تنفيذ الطلب.</Text>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.pageCanvas },
  flex: { flex: 1, padding: space.lg, gap: 12 },
  header: { backgroundColor: palette.brand, borderRadius: radius.xl, padding: 18 },
  back: { color: "#fff", textAlign: "right", fontWeight: "800", marginBottom: 10 },
  title: { color: "#fff", fontSize: 24, fontWeight: "900", textAlign: "right" },
  subtitle: { color: "#fff", opacity: 0.85, fontSize: 12, textAlign: "right", marginTop: 5 },
  messages: { flex: 1, backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.line },
  messageContent: { padding: 12, gap: 10, flexGrow: 1, justifyContent: "flex-end" },
  empty: { color: palette.muted, textAlign: "center", marginVertical: 40, lineHeight: 24 },
  bubble: { maxWidth: "88%", borderRadius: radius.lg, padding: 12 },
  userBubble: { alignSelf: "flex-end", backgroundColor: palette.brand },
  aiBubble: { alignSelf: "flex-start", backgroundColor: palette.canvas, borderWidth: 1, borderColor: palette.line },
  messageText: { color: palette.ink, textAlign: "right", lineHeight: 22, fontSize: 14 },
  userText: { color: "#fff" },
  loading: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  hint: { color: palette.muted, fontSize: 12 },
  supportHandoff: { backgroundColor: palette.brandSoft, borderWidth: 1, borderColor: palette.brand, borderRadius: radius.md, padding: 12, alignItems: "center" },
  supportHandoffText: { color: palette.brand, fontWeight: "900", fontSize: 13 },
  error: { color: palette.danger, backgroundColor: palette.dangerSoft, borderRadius: 10, padding: 10, textAlign: "right", fontSize: 12 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, backgroundColor: palette.surface, padding: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 110, textAlign: "right", color: palette.ink, padding: 8 },
  send: { backgroundColor: palette.brand, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 13 },
  disabled: { opacity: 0.5 },
  sendText: { color: "#fff", fontWeight: "900" },
  disclaimer: { color: palette.muted, fontSize: 10, textAlign: "center" },
});
