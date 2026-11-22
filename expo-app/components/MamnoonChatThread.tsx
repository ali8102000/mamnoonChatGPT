import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { palette, radius, space } from "@/styles/theme";

export type MamnoonThreadMessage = {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  isBot?: boolean;
  senderLabel?: string;
  status?: "sent" | "delivered" | "read";
  replyPreview?: string | null;
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
  onMessageLongPress?: (message: MamnoonThreadMessage) => void;
};

function dayKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(value) === dayKey(today.toISOString())) return "اليوم";
  if (dayKey(value) === dayKey(yesterday.toISOString())) return "أمس";
  return date.toLocaleDateString("ar-IQ", { weekday: "long", day: "numeric", month: "long" });
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" });
}

function StatusMark({ status }: { status?: MamnoonThreadMessage["status"] }) {
  if (!status) return null;
  const mark = status === "read" ? "✓✓" : status === "delivered" ? "✓✓" : "✓";
  return (
    <Text style={[styles.status, status === "read" && styles.statusRead]}>
      {mark}
    </Text>
  );
}

export default function MamnoonChatThread({
  messages,
  currentUserId,
  draft,
  onDraftChange,
  onSend,
  busy = false,
  placeholder = "اكتب رسالة...",
  emptyText = "ابدأ المحادثة 👋",
  quickReplies = [],
  showQuickReplies = true,
  footer,
  onMessageLongPress,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const groupedMessages = useMemo(() => {
    let previousDay = "";
    return messages.map((message) => {
      const key = dayKey(message.createdAt);
      const showDay = key !== previousDay;
      previousDay = key;
      return { message, showDay };
    });
  }, [messages]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [messages.length]);

  return (
    <View style={styles.thread}>
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={[
          styles.messagesContent,
          messages.length === 0 && styles.messagesEmptyContent,
        ]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Text style={styles.emptyIconText}>م</Text></View>
            <Text style={styles.emptyText}>{emptyText}</Text>
            <Text style={styles.emptyHint}>محادثتك مع الطرف الآخر تبقى خاصة ضمن ممنون</Text>
          </View>
        ) : groupedMessages.map(({ message, showDay }) => {
          const mine = message.senderId === currentUserId && !message.isBot;
          return (
            <View key={message.id}>
              {showDay && (
                <View style={styles.dayDivider}>
                  <Text style={styles.dayLabel}>{dayLabel(message.createdAt)}</Text>
                </View>
              )}
              <View style={[styles.row, mine ? styles.mineRow : styles.otherRow]}>
                <TouchableOpacity
                  activeOpacity={0.92}
                  disabled={!onMessageLongPress}
                  onLongPress={() => onMessageLongPress?.(message)}
                  style={[
                    styles.bubble,
                    mine ? styles.mineBubble : message.isBot ? styles.botBubble : styles.otherBubble,
                  ]}
                >
                  {!!(message.senderLabel || message.isBot) && (
                    <Text style={[styles.sender, mine && styles.mineSender]}>
                      {message.isBot ? "مساعد ممنون · البوت" : message.senderLabel || (mine ? "أنت" : "المستخدم")}
                    </Text>
                  )}
                  {!!message.replyPreview && (
                    <View style={[styles.replyPreview, mine && styles.mineReplyPreview]}>
                      <Text numberOfLines={2} style={[styles.replyPreviewText, mine && styles.mineReplyPreviewText]}>
                        {message.replyPreview}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.body, mine && styles.mineBody]}>{message.body}</Text>
                  <View style={styles.messageMeta}>
                    <Text style={[styles.time, mine && styles.mineTime]}>{timeLabel(message.createdAt)}</Text>
                    {mine && <StatusMark status={message.status} />}
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {showQuickReplies && quickReplies.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.quickReplies}
        >
          {quickReplies.map(reply => (
            <TouchableOpacity
              key={reply}
              style={styles.quickReply}
              disabled={busy}
              onPress={() => onSend(reply)}
            >
              <Text style={styles.quickReplyText}>{reply}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {footer}

      <View style={styles.composer}>
        <View style={styles.inputShell}>
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
          <Text style={styles.inputHint}>{draft.length > 0 ? draft.length.toLocaleString("ar-IQ") : ""}</Text>
        </View>
        <TouchableOpacity
          disabled={!draft.trim() || busy}
          onPress={() => onSend()}
          style={[styles.send, (!draft.trim() || busy) && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="إرسال الرسالة"
        >
          <Text style={styles.sendText}>{busy ? "…" : "➤"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  thread: { flex: 1, minHeight: 0, backgroundColor: palette.pageCanvas },
  messages: { flex: 1 },
  messagesContent: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.lg, gap: 8 },
  messagesEmptyContent: { flexGrow: 1, justifyContent: "center" },
  empty: { alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 38, gap: 8 },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: palette.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: 5 },
  emptyIconText: { color: palette.brand, fontSize: 23, fontWeight: "900" },
  emptyText: { color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "center" },
  emptyHint: { color: palette.muted, fontSize: 10, textAlign: "center", lineHeight: 16 },
  dayDivider: { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, marginVertical: 8 },
  dayLabel: { color: palette.muted, fontSize: 9, fontWeight: "800" },
  row: { width: "100%", flexDirection: "row", marginVertical: 2 },
  mineRow: { justifyContent: "flex-end" },
  otherRow: { justifyContent: "flex-start" },
  bubble: { maxWidth: "86%", minWidth: 76, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 7, borderRadius: 17, gap: 5 },
  mineBubble: { backgroundColor: palette.brand, borderBottomRightRadius: 5 },
  otherBubble: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderBottomLeftRadius: 5 },
  botBubble: { backgroundColor: "#EEE9FF", borderBottomLeftRadius: 5 },
  sender: { fontSize: 9, fontWeight: "900", color: palette.brand, textAlign: "right" },
  mineSender: { color: "rgba(255,255,255,0.82)" },
  replyPreview: { borderRightWidth: 3, borderRightColor: palette.brand, backgroundColor: palette.pageCanvas, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6 },
  mineReplyPreview: { borderRightColor: "#F3D88A", backgroundColor: "rgba(0,0,0,0.12)" },
  replyPreviewText: { color: palette.ink, fontSize: 10, textAlign: "right" },
  mineReplyPreviewText: { color: palette.white },
  body: { color: palette.ink, fontSize: 13, textAlign: "right", lineHeight: 21 },
  mineBody: { color: palette.white },
  messageMeta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 4 },
  time: { color: palette.muted, fontSize: 9, textAlign: "left" },
  mineTime: { color: "rgba(255,255,255,0.72)" },
  status: { color: "rgba(255,255,255,0.72)", fontSize: 10, fontWeight: "900" },
  statusRead: { color: "#8DD7FF" },
  quickReplies: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  quickReply: { borderRadius: radius.pill, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, paddingHorizontal: 12, paddingVertical: 8 },
  quickReplyText: { color: palette.ink, fontSize: 10, fontWeight: "800" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 11, paddingTop: 9, paddingBottom: 11, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.surface },
  inputShell: { flex: 1, minHeight: 44, maxHeight: 118, borderWidth: 1, borderColor: palette.line, borderRadius: 22, backgroundColor: palette.canvas, paddingHorizontal: 13, paddingVertical: 5, justifyContent: "center" },
  input: { minHeight: 32, maxHeight: 96, paddingVertical: 5, color: palette.ink, fontSize: 13, textAlignVertical: "center" },
  inputHint: { color: palette.muted, fontSize: 8, textAlign: "left", minHeight: 9 },
  send: { width: 44, height: 44, justifyContent: "center", alignItems: "center", borderRadius: 16, backgroundColor: palette.brand },
  disabled: { opacity: 0.4 },
  sendText: { color: palette.white, fontWeight: "900", fontSize: 20, transform: [{ rotate: "180deg" }] },
});
