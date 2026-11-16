import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";
import { getAdminStaffRoles } from "@/lib/admin-access";

type Tab = "friends" | "requests";
type Person = { full_name?: string | null; phone?: string | null } | null;
type Row = {
  id: string;
  user_id?: string;
  friend_id?: string;
  sender_id?: string;
  receiver_id?: string;
  created_at: string;
  user?: Person;
  friend?: Person;
  sender?: Person;
  receiver?: Person;
};

export default function AdminFriendsScreen() {
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [tab, setTab] = useState<Tab>("friends");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: callError } = await supabase.functions.invoke("admin-users", { body });
    if (callError) throw new Error(callError.message || "تعذر الاتصال بخدمة الإدارة");
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setError("");
    try {
      const names = await getAdminStaffRoles(user.id);
      if (!names.some((role: string) => ["super_admin", "admin", "moderator", "department_monitoring"].includes(role))) {
        setAllowed(false); setRows([]); return;
      }
      setCanManage(names.some((role: string) => ["super_admin", "admin", "moderator"].includes(role)));
      setAllowed(true);
      const result = await invoke({ action: tab === "friends" ? "friends" : "friend_requests", limit: 200 });
      setRows(tab === "friends" ? result.friends ?? [] : result.requests ?? []);
    } catch (e: any) {
      setError(String(e?.message || "تعذر تحميل البيانات"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, tab, invoke]);

  useEffect(() => {
    if (!authLoading) {
      if (!user) { setAllowed(false); setLoading(false); }
      else void load();
    }
  }, [authLoading, user, load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const remove = (row: Row) => {
    const isFriend = tab === "friends";
    Alert.alert(
      isFriend ? "حذف الصداقة" : "حذف طلب الصداقة",
      isFriend ? "تأكد من حذف علاقة الصداقة بين المستخدمين." : "تأكد من حذف طلب الصداقة المحدد.",
      [
        { text: "رجوع", style: "cancel" },
        { text: "حذف", style: "destructive", onPress: async () => {
          setBusyId(row.id);
          try {
            if (isFriend) {
              if (!row.user_id || !row.friend_id) throw new Error("بيانات الصداقة غير مكتملة");
              await invoke({ action: "delete_friendship", user1_id: row.user_id, user2_id: row.friend_id });
            } else {
              await invoke({ action: "delete_friend_request", request_id: row.id });
            }
            await load();
          } catch (e: any) {
            Alert.alert("تعذر الحذف", String(e?.message || "حاول مرة ثانية"));
          } finally { setBusyId(null); }
        } },
      ],
    );
  };

  if (authLoading || loading) return <View style={s.center}><ActivityIndicator size="large" color={palette.brand}/><Text style={s.muted}>جاري تحميل إدارة الأصدقاء...</Text></View>;
  if (allowed === false) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>هذه الصفحة متاحة للمدير والمراقب المخوّل فقط.</Text></View>;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "إدارة الأصدقاء" }} />
      <View style={s.tabs}>
        <TouchableOpacity onPress={() => setTab("friends")} style={[s.tab, tab === "friends" && s.tabActive]}><Text style={[s.tabText, tab === "friends" && s.tabTextActive]}>الصداقات</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setTab("requests")} style={[s.tab, tab === "requests" && s.tabActive]}><Text style={[s.tabText, tab === "requests" && s.tabActive && s.tabTextActive]}>طلبات الصداقة</Text></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh}/>}>
        {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
        {rows.length === 0 ? <Text style={s.empty}>{tab === "friends" ? "لا توجد صداقات" : "لا توجد طلبات صداقة"}</Text> : rows.map((row) => {
          const left = tab === "friends" ? row.user : row.sender;
          const right = tab === "friends" ? row.friend : row.receiver;
          return (
            <View key={row.id} style={s.card}>
              <Text style={s.name}>{left?.full_name || left?.phone || "—"} {tab === "friends" ? "↔" : "←"} {right?.full_name || right?.phone || "—"}</Text>
              <Text style={s.muted}>{new Date(row.created_at).toLocaleString("ar-IQ")}</Text>
              {canManage && <TouchableOpacity disabled={busyId === row.id} onPress={() => remove(row)} style={s.delete}>
                <Text style={s.deleteText}>{busyId === row.id ? "جاري الحذف..." : "حذف"}</Text>
              </TouchableOpacity>}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.pageCanvas },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: space.lg, paddingTop: space.md },
  tab: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, alignItems: "center" },
  tabActive: { backgroundColor: palette.brand, borderColor: palette.brand },
  tabText: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  tabTextActive: { color: palette.white },
  content: { padding: space.lg, gap: 10, paddingBottom: 48 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: palette.pageCanvas, padding: 24, gap: 10 },
  muted: { color: palette.muted, fontSize: 11, textAlign: "right" },
  title: { color: palette.ink, fontSize: 21, fontWeight: "900", textAlign: "right" },
  name: { color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right" },
  card: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: 14, gap: 8 },
  delete: { alignSelf: "flex-start", backgroundColor: palette.dangerSoft, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 9 },
  deleteText: { color: palette.danger, fontSize: 11, fontWeight: "900" },
  empty: { color: palette.muted, textAlign: "center", padding: 24 },
  error: { backgroundColor: palette.dangerSoft, borderRadius: radius.md, padding: 12 },
  errorText: { color: palette.danger, textAlign: "right", fontWeight: "800" },
});
