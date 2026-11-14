import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { normalizePhone } from "@/lib/phone";
import { palette, radius } from "@/styles/theme";

type FriendProfile = { id: string; full_name: string | null; phone: string };
type FriendRequest = { id: string; sender_id: string; sender: FriendProfile | null };
type SearchProfile = FriendProfile;

export default function FriendsScreen() {
  const { user } = useAuth();
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [searchPhone, setSearchPhone] = useState("");
  const [searchResults, setSearchResults] = useState<SearchProfile[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadFriends = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_my_friends");
    if (error) {
      Alert.alert("تعذر تحميل الأصدقاء", error.message);
      return;
    }
    setFriends(data ?? []);
  }, []);

  const loadPending = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_pending_friend_requests");
    if (error) {
      Alert.alert("تعذر تحميل طلبات الصداقة", error.message);
      return;
    }
    setPendingRequests(
      (data ?? []).map((request: {
        id: string;
        sender_id: string;
        sender_full_name: string | null;
        sender_phone: string;
      }) => ({
        id: request.id,
        sender_id: request.sender_id,
        sender: {
          id: request.sender_id,
          full_name: request.sender_full_name,
          phone: request.sender_phone,
        },
      })),
    );
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadFriends(), loadPending()]);
  }, [loadFriends, loadPending]);

  useEffect(() => {
    loadAll();
    const sub = supabase
      .channel("friends-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "friend_requests",
          filter: `receiver_id=eq.${user?.id}`,
        },
        () => loadPending(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "friends", filter: `user_id=eq.${user?.id}` },
        () => loadFriends(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [user?.id, loadFriends, loadPending, loadAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  async function searchByPhone() {
    if (!searchPhone.trim()) return;
    const normalized = normalizePhone(searchPhone);
    const { data, error } = await supabase.rpc("search_profiles_for_friend", {
      _phone: normalized,
    });
    if (error) {
      Alert.alert("تعذر البحث", error.message);
      return;
    }
    setSearchResults(data ?? []);
  }

  async function sendRequest(receiverId: string) {
    const { error } = await supabase
      .from("friend_requests")
      .insert({ sender_id: user?.id, receiver_id: receiverId, status: "pending" });
    if (error) Alert.alert("خطأ", error.message);
    else {
      Alert.alert("تم", "تم إرسال طلب الصداقة");
      setSearchResults([]);
      setSearchPhone("");
    }
  }

  async function acceptRequest(reqId: string) {
    const { error } = await supabase.rpc("respond_friend_request", {
      _request_id: reqId,
      _accept: true,
    });
    if (error) {
      Alert.alert("تعذر قبول الطلب", error.message);
      return;
    }
    await loadAll();
  }

  async function rejectRequest(reqId: string) {
    const { error } = await supabase.rpc("respond_friend_request", {
      _request_id: reqId,
      _accept: false,
    });
    if (error) {
      Alert.alert("تعذر رفض الطلب", error.message);
      return;
    }
    await loadAll();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>الأصدقاء</Text>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {pendingRequests.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>طلبات الصداقة</Text>
            {pendingRequests.map((req) => (
              <View key={req.id} style={styles.requestCard}>
                <View style={styles.requestAvatar}>
                  <Text style={styles.requestAvatarText}>{(req.sender?.full_name || "؟")[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.requestName}>{req.sender?.full_name}</Text>
                  <Text style={styles.requestPhone}>{req.sender?.phone}</Text>
                </View>
                <TouchableOpacity
                  style={styles.acceptBtn}
                  onPress={() => acceptRequest(req.id)}
                >
                  <Text style={styles.acceptBtnText}>قبول</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rejectBtn} onPress={() => rejectRequest(req.id)}>
                  <Text style={styles.rejectBtnText}>رفض</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
        <Text style={styles.sectionTitle}>إضافة صديق برقم الهاتف</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={searchPhone}
            onChangeText={setSearchPhone}
            placeholder="07XXXXXXXXX"
            keyboardType="phone-pad"
            placeholderTextColor="#94a3b8"
          />
          <TouchableOpacity style={styles.searchBtn} onPress={searchByPhone}>
            <Text style={styles.searchBtnText}>بحث</Text>
          </TouchableOpacity>
        </View>
        {searchResults.map((r) => (
          <View key={r.id} style={styles.searchResultCard}>
            <View style={styles.requestAvatar}>
              <Text style={styles.requestAvatarText}>{(r.full_name || "؟")[0]}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.requestName}>{r.full_name}</Text>
              <Text style={styles.requestPhone}>{r.phone}</Text>
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={() => sendRequest(r.id)}>
              <Text style={styles.addBtnText}>+ إضافة</Text>
            </TouchableOpacity>
          </View>
        ))}
        <Text style={styles.sectionTitle}>أصدقاؤك ({friends.length})</Text>
        {friends.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>لا يوجد أصدقاء بعد</Text>
            <Text style={styles.emptySub}>ابحث برقم الهاتف لإضافة صديق</Text>
          </View>
        ) : (
          friends.map((f) => (
            <View key={f.id} style={styles.friendCard}>
              <View style={styles.requestAvatar}>
                <Text style={styles.requestAvatarText}>{(f.full_name || "؟")[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.requestName}>{f.full_name}</Text>
                <Text style={styles.requestPhone}>{f.phone}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas, paddingHorizontal: 20, paddingTop: 52 },
  title: { fontSize: 27, fontWeight: "900", color: palette.ink, marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: palette.brand, marginBottom: 12, marginTop: 20 },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: { flex: 1, minHeight: 52, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: palette.ink, backgroundColor: palette.surface, textAlign: "left" },
  searchBtn: { backgroundColor: palette.brand, borderRadius: radius.md, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  searchBtnText: { color: palette.white, fontWeight: "900", fontSize: 13 },
  requestCard: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, marginBottom: 10, gap: 10, borderWidth: 1, borderColor: palette.line },
  requestAvatar: { width: 44, height: 44, borderRadius: 16, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  requestAvatarText: { fontSize: 18, fontWeight: "900", color: palette.white },
  requestName: { fontSize: 14, fontWeight: "900", color: palette.ink },
  requestPhone: { fontSize: 11, color: palette.muted, marginTop: 3 },
  acceptBtn: { backgroundColor: palette.success, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 9 },
  acceptBtnText: { color: palette.white, fontWeight: "900", fontSize: 12 },
  rejectBtn: { backgroundColor: "#F8E9E7", borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 9 },
  rejectBtnText: { color: palette.danger, fontWeight: "900", fontSize: 12 },
  searchResultCard: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, marginBottom: 8, gap: 10, borderWidth: 1, borderColor: palette.line },
  addBtn: { backgroundColor: palette.brandSoft, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 9 },
  addBtnText: { color: palette.brand, fontWeight: "900", fontSize: 12 },
  friendCard: { flexDirection: "row", alignItems: "center", backgroundColor: palette.surface, borderRadius: radius.lg, padding: 14, marginBottom: 8, gap: 10, borderWidth: 1, borderColor: palette.line },
  emptyBox: { alignItems: "center", paddingTop: 40 },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: palette.ink },
  emptySub: { fontSize: 12, color: palette.muted, marginTop: 5 },
});
