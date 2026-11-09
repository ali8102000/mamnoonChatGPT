import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { normalizePhone } from '@/lib/phone';

type FriendProfile = { id: string; full_name: string | null; phone: string };
type FriendRequest = { id: string; sender_id: string; sender: FriendProfile | null };
type SearchProfile = FriendProfile;

export default function FriendsScreen() {
  const { user } = useAuth();
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [searchPhone, setSearchPhone] = useState('');
  const [searchResults, setSearchResults] = useState<SearchProfile[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadFriends = useCallback(async () => {
    const { data } = await supabase.from('friends').select('friend:profiles!friends_friend_id_fkey(id, full_name, phone)').eq('user_id', user?.id);
    setFriends((data ?? []).flatMap((row) => row.friend ?? []));
  }, [user?.id]);

  const loadPending = useCallback(async () => {
    const { data } = await supabase.from('friend_requests').select('*, sender:profiles!friend_requests_sender_id_fkey(id, full_name, phone)').eq('receiver_id', user?.id).eq('status', 'pending');
    setPendingRequests(data || []);
  }, [user?.id]);

  const loadAll = useCallback(async () => { await Promise.all([loadFriends(), loadPending()]); }, [loadFriends, loadPending]);

  useEffect(() => {
    loadAll();
    const sub = supabase.channel('friends-realtime').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${user?.id}` }, () => loadPending()).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friends', filter: `user_id=eq.${user?.id}` }, () => loadFriends()).subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [user?.id, loadFriends, loadPending, loadAll]);

  const onRefresh = async () => { setRefreshing(true); await loadAll(); setRefreshing(false); };

  async function searchByPhone() {
    if (!searchPhone.trim()) return;
    const normalized = normalizePhone(searchPhone);
    const { data } = await supabase.from('profiles').select('id, full_name, phone').ilike('phone', `%${normalized.replace('+', '')}%`).neq('id', user?.id).limit(10);
    setSearchResults(data || []);
  }

  async function sendRequest(receiverId: string) {
    const { error } = await supabase.from('friend_requests').insert({ sender_id: user?.id, receiver_id: receiverId, status: 'pending' });
    if (error) Alert.alert('خطأ', error.message); else { Alert.alert('تم', 'تم إرسال طلب الصداقة'); setSearchResults([]); setSearchPhone(''); }
  }

  async function acceptRequest(reqId: string, senderId: string) {
    await supabase.from('friend_requests').update({ status: 'accepted' }).eq('id', reqId);
    await supabase.from('friends').insert([{ user_id: user?.id, friend_id: senderId }, { user_id: senderId, friend_id: user?.id }]);
    loadAll();
  }

  async function rejectRequest(reqId: string) { await supabase.from('friend_requests').update({ status: 'rejected' }).eq('id', reqId); loadAll(); }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>الأصدقاء</Text>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {pendingRequests.length > 0 && (<><Text style={styles.sectionTitle}>طلبات الصداقة</Text>{pendingRequests.map((req) => (<View key={req.id} style={styles.requestCard}><View style={styles.requestAvatar}><Text style={styles.requestAvatarText}>{(req.sender?.full_name || '؟')[0]}</Text></View><View style={{ flex: 1 }}><Text style={styles.requestName}>{req.sender?.full_name}</Text><Text style={styles.requestPhone}>{req.sender?.phone}</Text></View><TouchableOpacity style={styles.acceptBtn} onPress={() => acceptRequest(req.id, req.sender_id)}><Text style={styles.acceptBtnText}>قبول</Text></TouchableOpacity><TouchableOpacity style={styles.rejectBtn} onPress={() => rejectRequest(req.id)}><Text style={styles.rejectBtnText}>رفض</Text></TouchableOpacity></View>))}</>)}
        <Text style={styles.sectionTitle}>إضافة صديق برقم الهاتف</Text>
        <View style={styles.searchRow}><TextInput style={styles.searchInput} value={searchPhone} onChangeText={setSearchPhone} placeholder="07XXXXXXXXX" keyboardType="phone-pad" placeholderTextColor="#94a3b8" /><TouchableOpacity style={styles.searchBtn} onPress={searchByPhone}><Text style={styles.searchBtnText}>بحث</Text></TouchableOpacity></View>
        {searchResults.map((r) => (<View key={r.id} style={styles.searchResultCard}><View style={styles.requestAvatar}><Text style={styles.requestAvatarText}>{(r.full_name || '؟')[0]}</Text></View><View style={{ flex: 1 }}><Text style={styles.requestName}>{r.full_name}</Text><Text style={styles.requestPhone}>{r.phone}</Text></View><TouchableOpacity style={styles.addBtn} onPress={() => sendRequest(r.id)}><Text style={styles.addBtnText}>+ إضافة</Text></TouchableOpacity></View>))}
        <Text style={styles.sectionTitle}>أصدقاؤك ({friends.length})</Text>
        {friends.length === 0 ? (<View style={styles.emptyBox}><Text style={styles.emptyTitle}>لا يوجد أصدقاء بعد</Text><Text style={styles.emptySub}>ابحث برقم الهاتف لإضافة صديق</Text></View>) : friends.map((f) => (<View key={f.id} style={styles.friendCard}><View style={styles.requestAvatar}><Text style={styles.requestAvatarText}>{(f.full_name || '؟')[0]}</Text></View><View style={{ flex: 1 }}><Text style={styles.requestName}>{f.full_name}</Text><Text style={styles.requestPhone}>{f.phone}</Text></View></View>))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', paddingHorizontal: 20, paddingTop: 50 },
  title: { fontSize: 28, fontWeight: '900', color: '#7c3aed', marginBottom: 20 }, sectionTitle: { fontSize: 16, fontWeight: '800', color: '#7c3aed', marginBottom: 12, marginTop: 20 },
  searchRow: { flexDirection: 'row', gap: 8 }, searchInput: { flex: 1, borderWidth: 1, borderColor: 'rgba(30,41,59,0.1)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: '#1e293b', backgroundColor: '#fff', textAlign: 'left' }, searchBtn: { backgroundColor: '#7c3aed', borderRadius: 16, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' }, searchBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  requestCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10, gap: 10 }, requestAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#7c3aed', alignItems: 'center', justifyContent: 'center' }, requestAvatarText: { fontSize: 18, fontWeight: '800', color: '#fff' }, requestName: { fontSize: 15, fontWeight: '700', color: '#1e293b' }, requestPhone: { fontSize: 12, color: '#64748b', marginTop: 2 }, acceptBtn: { backgroundColor: '#16a34a', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }, acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 }, rejectBtn: { backgroundColor: '#fee2e2', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }, rejectBtnText: { color: '#dc2626', fontWeight: '700', fontSize: 13 },
  searchResultCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 8, gap: 10 }, addBtn: { backgroundColor: '#7c3aed10', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }, addBtnText: { color: '#7c3aed', fontWeight: '700', fontSize: 13 },
  friendCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 8, gap: 10 }, emptyBox: { alignItems: 'center', paddingTop: 40 }, emptyTitle: { fontSize: 16, fontWeight: '700', color: '#94a3b8' }, emptySub: { fontSize: 13, color: '#cbd5e1', marginTop: 4 },
});
