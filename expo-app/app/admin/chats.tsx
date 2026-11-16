import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";
import { getAdminStaffRoles } from "@/lib/admin-access";
import { showContactOptions } from "@/lib/contact-actions";

type ChatRow = {
  id: string;
  created_at?: string;
  updated_at?: string;
  participant1?: { full_name?: string | null; phone?: string | null } | null;
  participant2?: { full_name?: string | null; phone?: string | null } | null;
};
type MessageRow = {
  id: string;
  chat_id?: string;
  body?: string | null;
  content?: string | null;
  created_at: string;
  sender?: { full_name?: string | null; phone?: string | null } | null;
  chat?: { id?: string } | null;
};

export default function AdminChatsScreen() {
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"chats" | "messages">("chats");
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: callError } = await supabase.functions.invoke("admin-users", { body });
    if (callError) throw new Error(callError.message || "تعذر الاتصال بخدمة إدارة المحادثات");
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError("");
    try {
      if (tab === "chats") {
        const result = await invoke({ action: "chats", limit: 100 });
        setChats(result.chats ?? []);
      } else {
        const result = await invoke({ action: "messages", limit: 200, ...(selectedChat?.id ? { chat_id: selectedChat.id } : {}) });
        setMessages(result.messages ?? []);
      }
    } catch (e: any) {
      setError(String(e?.message || "تعذر تحميل المحادثات"));
      if (tab === "chats") setChats([]);
      else setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, tab, selectedChat?.id, invoke]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) { setAllowed(false); setLoading(false); return; }
    void (async () => {
      try {
        const roles = await getAdminStaffRoles(user.id);
        const canModerate = roles.some((role) => ["super_admin", "admin", "support", "moderator"].includes(role));
        setAllowed(canModerate);
      } catch {
        setAllowed(false);
      }
    })();
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (allowed === true) void load();
  }, [allowed, load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const showMessages = (chat: ChatRow) => {
    setSelectedChat(chat);
    setTab("messages");
  };

  const deleteMessage = (message: MessageRow) => {
    Alert.alert("حذف الرسالة", "تأكد من حذف هذه الرسالة من المحادثة.", [
      { text: "إلغاء", style: "cancel" },
      { text: "حذف", style: "destructive", onPress: async () => {
        setBusyId(message.id);
        try {
          await invoke({ action: "delete_message", message_id: message.id });
          await load();
          Alert.alert("تم", "تم حذف الرسالة.");
        } catch (e: any) {
          Alert.alert("تعذر الحذف", String(e?.message || "حاول مرة ثانية"));
        } finally { setBusyId(null); }
      } },
    ]);
  };

  if (authLoading || loading && allowed !== false || allowed === null) {
    return <View style={s.center}><ActivityIndicator size="large" color={palette.brand}/><Text style={s.muted}>جارٍ تحميل إدارة المحادثات...</Text></View>;
  }
  if (!allowed) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>إدارة المحادثات الخاصة متاحة للإدارة والمشرفين المخوّلين فقط.</Text></View>;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "إدارة الدردشة" }} />
      <View style={s.header}>
        <Text style={s.title}>إدارة الدردشة</Text>
        <Text style={s.muted}>مراجعة المحادثات الخاصة والرسائل وفق صلاحيات الإدارة</Text>
      </View>
      <View style={s.tabs}>
        <TouchableOpacity onPress={() => { setSelectedChat(null); setTab("chats"); }} style={[s.tab, tab === "chats" && s.tabActive]}>
          <Text style={[s.tabText, tab === "chats" && s.tabTextActive]}>المحادثات</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab("messages")} style={[s.tab, tab === "messages" && s.tabActive]}>
          <Text style={[s.tabText, tab === "messages" && s.tabTextActive]}>الرسائل</Text>
        </TouchableOpacity>
      </View>
      {selectedChat && tab === "messages" && <TouchableOpacity onPress={() => { setSelectedChat(null); void load(); }} style={s.filter}>
        <Text style={s.filterText}>عرض كل الرسائل · {selectedChat.participant1?.full_name || "مستخدم"} ↔ {selectedChat.participant2?.full_name || "مستخدم"} · إلغاء التصفية</Text>
      </TouchableOpacity>}
      {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
        {loading ? <ActivityIndicator color={palette.brand}/> : tab === "chats" ? (
          chats.length === 0 ? <Text style={s.empty}>لا توجد محادثات</Text> : chats.map((chat) => (
            <TouchableOpacity key={chat.id} onPress={() => showMessages(chat)} style={s.card}>
              <Text style={s.name}>{chat.participant1?.full_name || chat.participant1?.phone || "—"} ↔ {chat.participant2?.full_name || chat.participant2?.phone || "—"}</Text>
              <Text style={s.meta}>{new Date(chat.updated_at || chat.created_at || Date.now()).toLocaleString("ar-IQ")}</Text>
              <Text style={s.action}>عرض الرسائل ←</Text>
            </TouchableOpacity>
          ))
        ) : (
          messages.length === 0 ? <Text style={s.empty}>لا توجد رسائل</Text> : messages.map((message) => (
            <View key={message.id} style={s.card}>
              <View style={s.messageHeader}>
                <Text style={s.name}>{message.sender?.full_name || message.sender?.phone || "مستخدم"}</Text>
                {!!message.sender?.phone && <TouchableOpacity onPress={() => showContactOptions(message.sender!.phone!)} style={s.filter}><Text style={s.filterText}>اتصال / واتساب</Text></TouchableOpacity>}
                <TouchableOpacity disabled={busyId === message.id} onPress={() => deleteMessage(message)} style={s.delete}>
                  <Text style={s.deleteText}>{busyId === message.id ? "جارٍ الحذف..." : "حذف"}</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.message}>{message.body || message.content || "—"}</Text>
              <Text style={s.meta}>{new Date(message.created_at).toLocaleString("ar-IQ")}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor: palette.pageCanvas},
  header:{paddingHorizontal:space.lg,paddingTop:space.lg,gap:4},
  center:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor: palette.pageCanvas,padding:24,gap:10},
  title:{fontSize:21,fontWeight:"900",color:palette.ink,textAlign:"right"},
  muted:{fontSize:11,color:palette.muted,textAlign:"right",lineHeight:18},
  tabs:{flexDirection:"row",gap:8,paddingHorizontal:space.lg,paddingTop:space.md},
  tab:{flex:1,padding:12,borderRadius:radius.md,backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,alignItems:"center"},
  tabActive:{backgroundColor:palette.brand,borderColor:palette.brand},
  tabText:{color:palette.ink,fontSize:12,fontWeight:"800"},
  tabTextActive:{color:palette.white},
  filter:{marginHorizontal:space.lg,marginTop:8,padding:10,borderRadius:radius.md,backgroundColor:palette.brandSoft},
  filterText:{color:palette.brand,fontSize:10,fontWeight:"800",textAlign:"right"},
  content:{padding:space.lg,gap:9,paddingBottom:48},
  card:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.lg,padding:14,gap:7},
  name:{color:palette.ink,fontSize:12,fontWeight:"900",textAlign:"right",flexShrink:1},
  meta:{color:palette.muted,fontSize:10,textAlign:"right"},
  action:{color:palette.brand,fontSize:10,fontWeight:"900",textAlign:"right"},
  messageHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8},
  message:{color:palette.ink,fontSize:12,textAlign:"right",lineHeight:20},
  delete:{minHeight:36,backgroundColor:palette.dangerSoft,borderRadius:16,paddingHorizontal:12,paddingVertical:6,alignItems:"center",justifyContent:"center"},
  deleteText:{color:palette.danger,fontSize:10,fontWeight:"900"},
  empty:{color:palette.muted,textAlign:"center",padding:24},
  error:{marginHorizontal:space.lg,marginTop:8,backgroundColor:palette.dangerSoft,borderRadius:radius.md,padding:10},
  errorText:{color:palette.danger,fontSize:11,textAlign:"right"},
});
