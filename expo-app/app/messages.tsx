import { useState, useEffect, useCallback } from "react";
import { router } from "expo-router";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

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
  container: { flex: 1, backgroundColor: "#f9fafb", paddingHorizontal: 20, paddingTop: 50 },
  title: { fontSize: 28, fontWeight: "900", color: "#1e293b", marginBottom: 20 },
  supportButton: { backgroundColor: "#2563eb", borderRadius: 14, padding: 13, marginBottom: 16 },
  supportButtonText: { color: "#fff", fontWeight: "800", textAlign: "center" },
  supportButton: { backgroundColor: "#2563eb", borderRadius: 14, padding: 13, marginBottom: 16 },
  supportButtonText: { color: "#fff", fontWeight: "800", textAlign: "center" },
  empty: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  emptyBox: { alignItems: "center", paddingTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: "#94a3b8" },
  emptySub: { fontSize: 14, color: "#cbd5e1", marginTop: 4 },
  chatCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  chatAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
  },
  chatAvatarText: { fontSize: 20, fontWeight: "800", color: "#fff" },
  chatName: { fontSize: 16, fontWeight: "700", color: "#1e293b" },
  chatType: { fontSize: 13, color: "#64748b", marginTop: 2 },
  chatArrow: { fontSize: 20, color: "#94a3b8" },
});
