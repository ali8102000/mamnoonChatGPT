import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui';

type WorkerService = { id: string; slug: string; name_ar: string };

export default function WorkerOnboarding() {
  const { user } = useAuth();
  const [services, setServices] = useState<WorkerService[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [level, setLevel] = useState<'fani' | 'khabir'>('fani');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { supabase.from('services').select('*').order('name').then(({ data }) => { setServices((data || []).filter((s) => s.slug !== 'taxi')); }); }, []);
  function toggleService(id: string) { setSelected((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]); }

  async function submit() {
    if (selected.length === 0) { Alert.alert('خطأ', 'الرجاء اختيار خدمة واحدة على الأقل'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('worker_profiles').upsert({ user_id: user?.id, level, bio: bio || null, available: false });
      if (error) throw error;
      await supabase.from('worker_services').delete().eq('worker_id', user?.id);
      await supabase.from('worker_services').insert(selected.map((serviceId) => ({ worker_id: user?.id, service_id: serviceId })));
      const { error: roleError } = await supabase.rpc('grant_provider_role_safe', { _role: 'worker' });
      if (roleError) throw roleError;
      router.replace('/home');
    } catch (err: unknown) { Alert.alert('خطأ', err instanceof Error ? err.message : 'حدث خطأ'); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.title}>تسجيل الفني</Text>
      <Text style={styles.label}>الخدمات</Text>
      <View style={styles.servicesGrid}>{services.map((s) => (<TouchableOpacity key={s.id} style={[styles.serviceChip, selected.includes(s.id) && styles.serviceChipActive]} onPress={() => toggleService(s.id)}><Text style={[styles.serviceChipText, selected.includes(s.id) && styles.serviceChipTextActive]}>{s.name_ar}</Text></TouchableOpacity>))}</View>
      <Text style={styles.label}>المستوى</Text>
      <View style={styles.levelRow}><TouchableOpacity style={[styles.levelChip, level === 'fani' && styles.levelChipActive]} onPress={() => setLevel('fani')}><Text style={[styles.levelText, level === 'fani' && styles.levelTextActive]}>فني</Text></TouchableOpacity><TouchableOpacity style={[styles.levelChip, level === 'khabir' && styles.levelChipActive]} onPress={() => setLevel('khabir')}><Text style={[styles.levelText, level === 'khabir' && styles.levelTextActive]}>خبير</Text></TouchableOpacity></View>
      <Text style={styles.label}>نبذة (اختياري)</Text><TextInput style={[styles.input, { height: 80 }]} value={bio} onChangeText={setBio} placeholder="خبراتك ومهاراتك..." multiline placeholderTextColor="#94a3b8" />
      <View style={{ height: 24 }} /><Button title="إكمال التسجيل" onPress={submit} loading={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, paddingHorizontal: 20, paddingTop: 50 }, title: { fontSize: 28, fontWeight: '900', color: '#1e293b', marginBottom: 24 }, label: { fontSize: 13, fontWeight: '700', color: '#64748b', marginBottom: 8, marginTop: 16 }, servicesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, serviceChip: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: '#fff', borderWidth: 2, borderColor: 'transparent' }, serviceChipActive: { borderColor: '#2563eb', backgroundColor: '#2563eb10' }, serviceChipText: { fontSize: 14, fontWeight: '600', color: '#64748b' }, serviceChipTextActive: { color: '#2563eb' }, levelRow: { flexDirection: 'row', gap: 10 }, levelChip: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 14, backgroundColor: '#fff', borderWidth: 2, borderColor: 'transparent' }, levelChipActive: { borderColor: '#2563eb', backgroundColor: '#2563eb10' }, levelText: { fontSize: 15, fontWeight: '700', color: '#64748b' }, levelTextActive: { color: '#2563eb' }, input: { borderWidth: 1, borderColor: 'rgba(30,41,59,0.1)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, fontWeight: '600', color: '#1e293b', backgroundColor: 'rgba(30,41,59,0.03)', textAlign: 'left' } });
