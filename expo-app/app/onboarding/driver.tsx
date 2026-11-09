import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui';

type VehicleModel = { id: string; make: string; model: string; category: string };

export default function DriverOnboarding() {
  const { user } = useAuth();
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [selectedMake, setSelectedMake] = useState('');
  const [selectedModel, setSelectedModel] = useState<VehicleModel | null>(null);
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [color, setColor] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { supabase.from('vehicle_models').select('*').order('make', { ascending: true }).then(({ data }) => { setModels(data || []); }); }, []);
  const makes = [...new Set(models.map((m) => m.make))];

  async function submit() {
    if (!selectedModel || !year || !plate) { Alert.alert('خطأ', 'الرجاء تعبئة جميع الحقول'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('driver_profiles').upsert({ user_id: user?.id, vehicle_model: `${selectedMake} ${selectedModel.model}`, vehicle_plate: plate, vehicle_color: color || null, available: false });
      if (error) throw error;
      const { error: roleError } = await supabase.rpc('grant_provider_role_safe', { _role: 'driver' });
      if (roleError) throw roleError;
      router.replace('/home');
    } catch (err: unknown) { Alert.alert('خطأ', err instanceof Error ? err.message : 'حدث خطأ'); } finally { setBusy(false); }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.title}>تسجيل السائق</Text>
      <Text style={styles.label}>الماركة</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{makes.map((m) => (<TouchableOpacity key={m} style={[styles.chip, selectedMake === m && styles.chipActive]} onPress={() => { setSelectedMake(m); setSelectedModel(null); }}><Text style={[styles.chipText, selectedMake === m && styles.chipTextActive]}>{m}</Text></TouchableOpacity>))}</ScrollView>
      {selectedMake && (<><Text style={styles.label}>الموديل</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{models.filter((m) => m.make === selectedMake).map((m) => (<TouchableOpacity key={m.id} style={[styles.chip, selectedModel?.id === m.id && styles.chipActive]} onPress={() => setSelectedModel(m)}><Text style={[styles.chipText, selectedModel?.id === m.id && styles.chipTextActive]}>{m.model} ({m.category})</Text></TouchableOpacity>))}</ScrollView></>)}
      <Text style={styles.label}>سنة الصنع</Text><TextInput style={styles.input} value={year} onChangeText={setYear} placeholder="2020" keyboardType="numeric" placeholderTextColor="#94a3b8" />
      <Text style={styles.label}>رقم اللوحة</Text><TextInput style={styles.input} value={plate} onChangeText={setPlate} placeholder="123456" placeholderTextColor="#94a3b8" />
      <Text style={styles.label}>اللون (اختياري)</Text><TextInput style={styles.input} value={color} onChangeText={setColor} placeholder="أبيض" placeholderTextColor="#94a3b8" />
      <View style={{ height: 24 }} /><Button title="إكمال التسجيل" onPress={submit} loading={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, paddingHorizontal: 20, paddingTop: 50 }, title: { fontSize: 28, fontWeight: '900', color: '#1e293b', marginBottom: 24 }, label: { fontSize: 13, fontWeight: '700', color: '#64748b', marginBottom: 8, marginTop: 16 }, chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: '#fff', borderWidth: 2, borderColor: 'transparent' }, chipActive: { borderColor: '#2563eb', backgroundColor: '#2563eb10' }, chipText: { fontSize: 14, fontWeight: '600', color: '#64748b' }, chipTextActive: { color: '#2563eb' }, input: { borderWidth: 1, borderColor: 'rgba(30,41,59,0.1)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, fontWeight: '600', color: '#1e293b', backgroundColor: 'rgba(30,41,59,0.03)', textAlign: 'left' } });
