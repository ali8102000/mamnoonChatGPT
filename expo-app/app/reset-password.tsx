import { useState } from 'react';
import { router } from 'expo-router';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { Button, RealInput } from '@/components/ui';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (password.length < 6) { Alert.alert('خطأ', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
    if (password !== confirm) { Alert.alert('خطأ', 'كلمتا المرور غير متطابقتين'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      Alert.alert('تم', 'تم تغيير كلمة المرور بنجاح');
      router.replace('/');
    } catch (error: unknown) { Alert.alert('خطأ', error instanceof Error ? error.message : 'حدث خطأ'); } finally { setBusy(false); }
  }

  return (
    <View style={styles.container}><Text style={styles.title}>كلمة المرور الجديدة</Text><Text style={styles.label}>كلمة المرور</Text><RealInput value={password} onChangeText={setPassword} placeholder="••••••" secureTextEntry /><Text style={styles.label}>تأكيد كلمة المرور</Text><RealInput value={confirm} onChangeText={setConfirm} placeholder="••••••" secureTextEntry /><View style={{ height: 24 }} /><Button title="تغيير كلمة المرور" onPress={submit} loading={busy} /></View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, paddingHorizontal: 20, paddingTop: 50 }, title: { fontSize: 26, fontWeight: '900', color: '#1e293b', marginBottom: 24 }, label: { fontSize: 13, fontWeight: '700', color: '#64748b', marginBottom: 8, marginTop: 16 } });
