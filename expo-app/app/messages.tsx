import { useState, useEffect, useCallback } from "react";
import { router } from "expo-router";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

type ChatListItem = {
  id: string;
  request_id: string;
  other: { full_name: string | null; phone: string | null } | null;
  request: { type: string; status: string } | null;
};

export default function MessagesScreen() {
  const { user } = useAuth();
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadChats = useCallback(async () => {
    if (!user?.id) {
      setChats([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("chats")
      .select("id, request_id, customer_id, provider_id, request:service_requests(type, status)")
      .or(`customer_id.eq.${user.id},provider_id.eq.${user.id}`)
      .order("updated_at", { ascending: false });
    if (error || !data) {
      setChats([]);
      setLoading(false);
      return;
    }
    const otherIds = [...new Set(data.map((chat) =>
      chat.customer_id === user.id ? chat.provider_id : chat.customer_id
    ))];
    const { data: profiles } = otherIds.length
      ? await supabase.from("profiles").select("id, full_name, phone").in("id", otherIds)
      : { data: [] };
    const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    setChats(data.map((chat) => ({
      id: chat.id,
      request_id: chat.request_id,
      request: Array.isArray(chat.request) ? chat.request[0] ?? null : chat.request,
      other: profileById.get(chat.customer_id === user.id ? chat.provider_id : chat.customer_id) ?? null,
    })));
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    loadChats();
    const sub = supabase
      .channel("chats-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "chats" }, () => loadChats())
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [loadChats]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadChats();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>الرسائل</Text>
      <TouchableOpacity onPress={() => router.push("/support-chat")} style={styles.supportButton}><Text style={styles.supportButtonText}>مراسلة إدارة ممنون</Text></TouchableOpacity>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loading ? (
          <Text style={styles.empty}>جاري التحميل...</Text>
        ) : chats.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>لا توجد محادثات</Text>
            <Text style={styles.emptySub}>ستظهر المحادثات هنا عند بدء طلب</Text>
          </View>
        ) : (
          chats.map((chat) => (
            <TouchableOpacity
              key={chat.id}
              style={styles.chatCard}
              onPress={() =>
                router.push({ pathname: "/request/[id]", params: { id: chat.request_id } })
              }
              activeOpacity={0.85}
            >
              <View style={styles.chatAvatar}>
                <Text style={styles.chatAvatarText}>{(chat.other?.full_name || "؟")[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.chatName}>{chat.other?.full_name || "مستخدم"}</Text>
                <Text style={styles.chatType}>
                  {chat.request?.type === "taxi" ? "🚕 سيارة" : `🔧 ${chat.request?.type || ""}`}
                </Text>
              </View>
              <Text style={styles.chatArrow}>←</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas, paddingHorizontal: 20, paddingTop: 52 },
  title: { fontSize: 27, fontWeight: "900", color: palette.ink, marginBottom: 20 },
  supportButton: { backgroundColor: palette.brand, borderRadius: radius.md, padding: 15, marginBottom: 16 },
  supportButtonText: { color: palette.white, fontWeight: "900", textAlign: "center" },
  empty: { textAlign: "center", color: palette.muted, marginTop: 40 },
  emptyBox: { alignItems: "center", paddingTop: 60 },
  emptyTitle: { fontSize: 17, fontWeight: "900", color: palette.ink },
  emptySub: { fontSize: 12, color: palette.muted, marginTop: 5 },
  chatCard: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 16, marginBottom: 10, gap: 12, borderWidth: 1, borderColor: palette.line },
  chatAvatar: { width: 48, height: 48, borderRadius: 17, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  chatAvatarText: { fontSize: 20, fontWeight: "900", color: palette.white },
  chatName: { fontSize: 15, fontWeight: "900", color: palette.ink },
  chatType: { fontSize: 12, color: palette.muted, marginTop: 3 },
  chatArrow: { fontSize: 20, color: palette.gold },
});
