import { useState } from 'react';
import { router } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

const ROLES = [
  { key: 'customer', label: 'زبون', desc: 'احجز سيارة أو خدمة منزلية', emoji: '🚗' },
  { key: 'driver', label: 'سائق', desc: 'استقبل طلبات الركاب', emoji: '🚕' },
  { key: 'worker', label: 'فني', desc: 'استقبل طلبات الخدمات', emoji: '🔧' },
] as const;

export default function SelectRole() {
  const { user, refresh } = useAuth();
  const [busy, setBusy] = useState(false);

  async function pickRole(role: string) {
    if (!user) {
      Alert.alert('تنبيه', 'سجّل الدخول أولاً');
      return;
    }
    setBusy(true);
    try {
      // Provider roles are granted only after their onboarding profile exists.
      if (role === 'driver') {
        router.push('/onboarding/driver');
        return;
      }
      if (role === 'worker') {
        router.push('/onboarding/worker');
        return;
      }

      const { error } = await supabase.from('user_roles').upsert(
        { user_id: user.id, role: 'customer' },
        { onConflict: 'user_id,role' },
      );
      if (error) throw error;
      await refresh();
      router.replace('/home');
    } catch (err: unknown) {
      Alert.alert('خطأ', err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>اختر دورك</Text>
      <Text style={styles.subtitle}>يمكنك التبديل بين الأدوار لاحقاً</Text>
      {ROLES.map((r) => (
        <TouchableOpacity key={r.key} style={styles.roleCard} onPress={() => pickRole(r.key)} disabled={busy} activeOpacity={0.85}>
          <Text style={styles.emoji}>{r.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.roleLabel}>{r.label}</Text>
            <Text style={styles.roleDesc}>{r.desc}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: '900', color: '#1e293b', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 32 },
  roleCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, padding: 20, marginBottom: 16, gap: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  emoji: { fontSize: 40 },
  roleLabel: { fontSize: 20, fontWeight: '800', color: '#1e293b' },
  roleDesc: { fontSize: 13, color: '#64748b', marginTop: 2 },
});
