import { useState } from 'react';
import { router } from 'expo-router';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { normalizePhone, isValidPhone } from '@/lib/phone';
import { Button, RealInput } from '@/components/ui';

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const id = identifier.trim();
    if (!id) { Alert.alert('خطأ', 'أدخل رقم الهاتف أو البريد'); return; }
    setBusy(true);
    try {
      const isEmail = id.includes('@');
      let email = id;
      if (!isEmail) {
        const normalized = normalizePhone(id);
        if (!isValidPhone(id)) { Alert.alert('خطأ', 'رقم الهاتف غير صالح'); setBusy(false); return; }
        const { data: emailResult } = await supabase.rpc('lookup_email_by_phone', { _phone: normalized });
        email = emailResult ? String(emailResult) : `phone${normalized.replace(/[^\d]/g, '')}@mamnoon.app`;
      }
      await supabase.auth.resetPasswordForEmail(email);
      Alert.alert('تم', 'إذا كان الحساب موجوداً، ستصل رسالة استعادة كلمة المرور');
      router.back();
    } catch { Alert.alert('تم', 'إذا كان الحساب موجوداً، ستصل رسالة استعادة كلمة المرور'); router.back(); }
    finally { setBusy(false); }
  }

  return (
    <View style={styles.container}><Text style={styles.title}>استعادة كلمة المرور</Text><Text style={styles.subtitle}>أدخل رقم هاتفك أو بريدك الإلكتروني</Text><RealInput value={identifier} onChangeText={setIdentifier} placeholder="07XXXXXXXXX أو you@example.com" keyboardType="phone-pad" /><View style={{ height: 24 }} /><Button title="إرسال" onPress={submit} loading={busy} /></View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, paddingHorizontal: 20, paddingTop: 50 }, title: { fontSize: 26, fontWeight: '900', color: '#1e293b', marginBottom: 8 }, subtitle: { fontSize: 14, color: '#64748b', marginBottom: 24 } });
