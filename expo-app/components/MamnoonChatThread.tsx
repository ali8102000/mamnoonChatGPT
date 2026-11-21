import { useEffect, useRef, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { palette, radius, space } from "@/styles/theme";

export type MamnoonThreadMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  isBot?: boolean;
  senderLabel?: string;
};

type Props = {
  messages: MamnoonThreadMessage[];
  currentUserId: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (value?: string) => void;
  busy?: boolean;
  placeholder?: string;
  emptyText?: string;
  quickReplies?: string[];
  showQuickReplies?: boolean;
  footer?: ReactNode;
};

export default function MamnoonChatThread({
  messages, currentUserId, draft, onDraftChange, onSend, busy = false,
  placeholder = "اكتب رسالة...", emptyText = "ابدأ المحادثة 👋",
  quickReplies = [], showQuickReplies = true, footer,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [messages.length]);

  return (
    <View style={styles.thread}>
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyText}>{emptyText}</Text></View>
        ) : messages.map(message => {
          const mine = message.senderId === currentUserId && !message.isBot;
          return (
            <View key={message.id} style={[styles.row, mine ? styles.mineRow : styles.otherRow]}>
              <View style={[styles.bubble, mine ? styles.mineBubble : message.isBot ? styles.botBubble : styles.otherBubble]}>
                {!!(message.senderLabel || message.isBot) && (
                  <Text style={[styles.sender, mine && styles.mineSender]}>
                    {message.isBot ? "مساعد ممنون · البوت" : message.senderLabel || (mine ? "أنت" : "المستخدم")}
                  </Text>
                )}
                <Text style={[styles.body, mine && styles.mineBody]}>{message.body}</Text>
                <Text style={[styles.time, mine && styles.mineTime]}>
                  {new Date(message.createdAt).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {showQuickReplies && quickReplies.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.quickReplies}>
          {quickReplies.map(reply => (
            <TouchableOpacity key={reply} style={styles.quickReply} disabled={busy} onPress={() => onSend(reply)}>
              <Text style={styles.quickReplyText}>{reply}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {footer}

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={onDraftChange}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={palette.muted}
          textAlign="right"
          multiline
          maxLength={4000}
          returnKeyType="send"
          onSubmitEditing={() => onSend()}
        />
        <TouchableOpacity disabled={!draft.trim() || busy} onPress={() => onSend()} style={[styles.send, (!draft.trim() || busy) && styles.disabled]}>
          <Text style={styles.sendText}>{busy ? "..." : "إرسال"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thread: { flex: 1, minHeight: 0 },
  messages: { flex: 1 },
  messagesContent: { padding: space.md, gap: 10, flexGrow: 1, justifyContent: "flex-end" },
  empty: { flex: 1, minHeight: 180, alignItems: "center", justifyContent: "center" },
  emptyText: { color: palette.muted, fontSize: 12, textAlign: "center" },
  row: { width: "100%", flexDirection: "row" },
  mineRow: { justifyContent: "flex-start" },
  otherRow: { justifyContent: "flex-end" },
  bubble: { maxWidth: "86%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg, gap: 5 },
  mineBubble: { backgroundColor: palette.brand, borderBottomRightRadius: 5 },
  otherBubble: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderBottomLeftRadius: 5 },
  botBubble: { backgroundColor: "#EEE9FF", borderBottomLeftRadius: 5 },
  sender: { fontSize: 9, fontWeight: "900", color: palette.brand, textAlign: "right" },
  mineSender: { color: "rgba(255,255,255,0.82)" },
  body: { color: palette.ink, fontSize: 13, textAlign: "right", lineHeight: 21 },
  mineBody: { color: palette.white },
  time: { color: palette.muted, fontSize: 9, textAlign: "left" },
  mineTime: { color: "rgba(255,255,255,0.72)" },
  quickReplies: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  quickReply: { borderRadius: radius.pill, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, paddingHorizontal: 12, paddingVertical: 8 },
  quickReplyText: { color: palette.ink, fontSize: 10, fontWeight: "800" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.surface },
  input: { flex: 1, minHeight: 44, maxHeight: 112, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, backgroundColor: palette.canvas, paddingHorizontal: 13, paddingVertical: 10, color: palette.ink, fontSize: 13, textAlignVertical: "center" },
  send: { minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 17, borderRadius: radius.lg, backgroundColor: palette.brand },
  disabled: { opacity: 0.45 },
  sendText: { color: palette.white, fontWeight: "900", fontSize: 12 },
});
