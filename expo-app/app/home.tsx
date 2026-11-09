import { useState, useEffect, useCallback } from 'react';
import { router } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import * as Location from 'expo-location';

type IncomingRequest = {
  id: string;
  type: string;
  price_estimate: number | null;
};

export default function HomeScreen() {
  const { user, profile, roles } = useAuth();
  const [activeRole, setActiveRole] = useState<string>(roles[0] || 'customer');
  const [available, setAvailable] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState('pending');
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const isWorker = activeRole === 'worker' || activeRole === 'driver';

  const loadIncoming = useCallback(async () => {
    if (activeRole === 'customer') return;
    const isDriver = activeRole === 'driver';
    const { data } = await supabase
      .from('service_requests')
      .select('id, type, price_estimate, status, created_at')
      .eq('type', isDriver ? 'taxi' : 'service')
      .in('status', isDriver ? ['searching'] : ['pending', 'searching'])
      .order('created_at', { ascending: false })
      .limit(10);
    setIncoming((data ?? []) as IncomingRequest[]);
  }, [activeRole]);

  useEffect(() => {
    loadIncoming();
    const sub = supabase.channel('incoming-requests').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'service_requests' }, () => loadIncoming()).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'service_requests' }, () => loadIncoming()).subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [loadIncoming]);

  useEffect(() => {
    if (!user || (activeRole !== 'driver' && activeRole !== 'worker')) {
      setAvailable(false);
      setVerified(false);
      setVerificationStatus('pending');
      return;
    }
    const table = activeRole === 'driver' ? 'driver_profiles' : 'worker_profiles';
    supabase.from(table).select('available, is_verified, verification_status').eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          Alert.alert('تعذر تحميل الحالة', 'حاول تحديث الصفحة');
          return;
        }
        setAvailable(Boolean(data?.available));
        setVerified(Boolean(data?.is_verified));
        setVerificationStatus(data?.verification_status ?? 'pending');
      });
  }, [activeRole, user]);

  useEffect(() => {
    if (!user || !verified || !available || (activeRole !== 'driver' && activeRole !== 'worker')) return;
    const userId = user.id;
    let mounted = true;
    let loadedIncoming = false;
    let subscription: Location.LocationSubscription | null = null;

    async function publishPresence(location: Location.LocationObject) {
      if (!mounted || !user) return;
      const { error } = await supabase.from('provider_locations').upsert({
        user_id: userId,
        role: activeRole,
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        heading: location.coords.heading,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error && mounted) {
        Alert.alert('تعذر مشاركة الموقع', 'تم إيقاف التوفر حتى لا تستقبل طلبات دون موقع صحيح.');
        const table = activeRole === 'driver' ? 'driver_profiles' : 'worker_profiles';
        await supabase.from(table).update({ available: false }).eq('user_id', userId);
        setAvailable(false);
      } else if (mounted && !loadedIncoming) {
        loadedIncoming = true;
        void loadIncoming();
      }
    }

    async function startPresence() {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        if (mounted) {
          Alert.alert('إذن الموقع مطلوب', 'فعّل الموقع حتى تظهر للسائقين والزبائن القريبين.');
          setAvailable(false);
          const table = activeRole === 'driver' ? 'driver_profiles' : 'worker_profiles';
          await supabase.from(table).update({ available: false }).eq('user_id', userId);
        }
        return;
      }
      const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await publishPresence(first);
      if (!mounted) return;
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 20 },
        (location) => { void publishPresence(location); },
      );
    }

    void startPresence().catch(async () => {
      if (!mounted || !user) return;
      Alert.alert('تعذر تحديد الموقع', 'تم إيقاف التوفر؛ تحقق من GPS وحاول مرة أخرى.');
      const table = activeRole === 'driver' ? 'driver_profiles' : 'worker_profiles';
      await supabase.from(table).update({ available: false }).eq('user_id', userId);
      setAvailable(false);
    });

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, [activeRole, available, verified, user, loadIncoming]);

  async function toggleAvailable() {
    if (!user || (activeRole !== 'driver' && activeRole !== 'worker')) return;
    if (!verified) {
      Alert.alert('الحساب بانتظار التوثيق', 'لن تستقبل طلبات حتى تراجع الإدارة بياناتك وتفعّل حسابك.');
      return;
    }
    const next = !available;
    if (next) {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('إذن الموقع مطلوب', 'اسمح بمشاركة موقعك قبل استقبال الطلبات.');
        return;
      }
    }
    const table = activeRole === 'driver' ? 'driver_profiles' : 'worker_profiles';
    const { error } = await supabase.from(table).update({ available: next }).eq('user_id', user.id);
    if (error) {
      Alert.alert('تعذر تحديث التوفر', error.message);
      return;
    }
    setAvailable(next);
  }

  const onRefresh = async () => { setRefreshing(true); await loadIncoming(); setRefreshing(false); };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>أهلاً {profile?.full_name || ''}</Text>
          <Text style={styles.roleText}>دورك: {activeRole === 'customer' ? 'زبون' : activeRole === 'driver' ? 'سائق' : 'فني'}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/profile')}><View style={styles.avatar}><Text style={styles.avatarText}>{(profile?.full_name || '؟')[0]}</Text></View></TouchableOpacity>
      </View>
      <View style={styles.roleSwitcher}>
        {roles.map((r) => (
          <TouchableOpacity key={r} style={[styles.roleChip, activeRole === r && styles.roleChipActive]} onPress={() => { setActiveRole(r); setAvailable(false); }}>
            <Text style={[styles.roleChipText, activeRole === r && styles.roleChipTextActive]}>{r === 'customer' ? 'زبون' : r === 'driver' ? 'سائق' : 'فني'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {activeRole === 'customer' ? <CustomerHome /> : <ProviderHome available={available} verified={verified} verificationStatus={verificationStatus} toggleAvailable={toggleAvailable} incoming={incoming} />}
      </ScrollView>
      <View style={styles.bottomTabs}>
        <TabBtn label="الرئيسية" icon="🏠" active onPress={() => {}} />
        <TabBtn label="الرسائل" icon="💬" onPress={() => router.push('/messages')} />
        {isWorker && <TabBtn label="الأصدقاء" icon="👥" onPress={() => router.push('/friends')} />}
        <TabBtn label="السجل" icon="📋" onPress={() => router.push('/history')} />
        <TabBtn label="حسابي" icon="👤" onPress={() => router.push('/profile')} />
      </View>
    </View>
  );
}

function CustomerHome() {
  const tiles = [
    { key: 'taxi', label: 'سيارة', emoji: '🚕', color: '#2563eb' },
    { key: 'build', label: 'بناء', emoji: '🧱', color: '#ea580c' },
    { key: 'plaster', label: 'لبخ', emoji: '🪣', color: '#d97706' },
    { key: 'carpentry_form', label: 'نجارة وقالب', emoji: '📐', color: '#a16207' },
    { key: 'flooring', label: 'أرضيات', emoji: '🟫', color: '#78716c' },
    { key: 'chef', label: 'طباخ', emoji: '👨‍🍳', color: '#e11d48' },
    { key: 'plumbing', label: 'تأسيس ماء', emoji: '🚰', color: '#0891b2' },
    { key: 'electric_setup', label: 'تأسيس كهرباء', emoji: '💡', color: '#ca8a04' },
    { key: 'electric_street', label: 'تصليح كهرباء', emoji: '⚡', color: '#d97706' },
    { key: 'washer_repair', label: 'تصليح غسالة', emoji: '🧺', color: '#0284c7' },
    { key: 'stove_repair', label: 'تصليح طباخ', emoji: '🔥', color: '#dc2626' },
    { key: 'fridge_repair', label: 'تصليح ثلاجة', emoji: '🧊', color: '#0ea5e9' },
    { key: 'ac_repair', label: 'مكيفات', emoji: '❄️', color: '#0284c7' },
    { key: 'cleaning', label: 'تنظيف بيوت', emoji: '🧹', color: '#16a34a' },
    { key: 'wood_carpentry', label: 'نجارة أخشاب', emoji: '🪵', color: '#a16207' },
    { key: 'blacksmith', label: 'حدادة', emoji: '⚒️', color: '#475569' },
    { key: 'general', label: 'خدمات عامة', emoji: '🏠', color: '#7c3aed' },
  ];
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
      <Text style={styles.sectionTitle}>ماذا تحتاج؟</Text>
      <View style={styles.tilesGrid}>
        {tiles.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tile, { backgroundColor: t.color + '15' }]} onPress={() => router.push({ pathname: '/request/new', params: { type: t.key } })} activeOpacity={0.85}>
            <Text style={styles.tileEmoji}>{t.emoji}</Text>
            <Text style={[styles.tileLabel, { color: t.color }]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function ProviderHome({ available, verified, verificationStatus, toggleAvailable, incoming }: { available: boolean; verified: boolean; verificationStatus: string; toggleAvailable: () => void; incoming: IncomingRequest[] }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
      <TouchableOpacity style={[styles.availCard, available && styles.availCardActive, !verified && { opacity: 0.65 }]} onPress={toggleAvailable} activeOpacity={0.85} disabled={!verified}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.availTitle, available && { color: '#fff' }]}>{available ? 'متاح للعمل' : 'غير متاح'}</Text>
          <Text style={[styles.availDesc, available && { color: 'rgba(255,255,255,0.8)' }]}>{!verified ? (verificationStatus === 'rejected' ? 'تم رفض التوثيق — راجع الإدارة' : verificationStatus === 'suspended' ? 'تم تعليق الحساب — راجع الإدارة' : 'بانتظار مراجعة الإدارة') : available ? 'ستصلك الطلبات الجديدة' : 'اضغط لتفعيل الاستقبال'}</Text>
        </View>
        <View style={[styles.availDot, available && styles.availDotActive]} />
      </TouchableOpacity>
      <Text style={styles.sectionTitle}>الطلبات الواردة</Text>
      {incoming.length === 0 ? (
        <View style={styles.emptyBox}><Text style={styles.emptyText}>لا توجد طلبات حالياً</Text><Text style={styles.emptySubtext}>سيظهر هنا عند وصول طلب جديد</Text></View>
      ) : (
        incoming.map((req) => (
          <TouchableOpacity key={req.id} style={styles.requestCard} onPress={() => router.push({ pathname: '/request/[id]', params: { id: req.id } })} activeOpacity={0.85}>
            <View style={{ flex: 1 }}>
              <Text style={styles.requestCustomer}>طلب جديد</Text>
              <Text style={styles.requestType}>{req.type === 'taxi' ? '🚕 طلب سيارة' : `🔧 ${req.type}`}</Text>
              <Text style={styles.requestPrice}>{req.price_estimate?.toLocaleString('en')} د.ع</Text>
            </View>
            <Text style={styles.requestArrow}>←</Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

function TabBtn({ label, icon, active, onPress }: { label: string; icon: string; active?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.tabBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{icon}</Text>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 50, paddingBottom: 12 },
  greeting: { fontSize: 22, fontWeight: '800', color: '#1e293b' },
  roleText: { fontSize: 13, color: '#64748b', marginTop: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '800', color: '#fff' },
  roleSwitcher: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  roleChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, backgroundColor: '#e2e8f0' },
  roleChipActive: { backgroundColor: '#2563eb' },
  roleChipText: { fontSize: 13, fontWeight: '700', color: '#64748b' },
  roleChipTextActive: { color: '#fff' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#1e293b', marginBottom: 16 },
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47%', aspectRatio: 1, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tileEmoji: { fontSize: 40, marginBottom: 8 },
  tileLabel: { fontSize: 16, fontWeight: '700' },
  availCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 20, marginBottom: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  availCardActive: { backgroundColor: '#16a34a' },
  availTitle: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  availDesc: { fontSize: 13, color: '#64748b', marginTop: 2 },
  availDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#cbd5e1' },
  availDotActive: { backgroundColor: '#fff' },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#94a3b8' },
  emptySubtext: { fontSize: 13, color: '#cbd5e1', marginTop: 4 },
  requestCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  requestCustomer: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  requestType: { fontSize: 14, color: '#64748b', marginTop: 2 },
  requestPrice: { fontSize: 14, fontWeight: '700', color: '#2563eb', marginTop: 4 },
  requestArrow: { fontSize: 20, color: '#94a3b8' },
  bottomTabs: { flexDirection: 'row', backgroundColor: '#fff', paddingVertical: 8, paddingBottom: 24, borderTopWidth: 1, borderTopColor: 'rgba(30,41,59,0.06)' },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  tabIcon: { fontSize: 22 },
  tabIconActive: {},
  tabLabel: { fontSize: 10, color: '#94a3b8', marginTop: 2, fontWeight: '600' },
  tabLabelActive: { color: '#2563eb' },
});
