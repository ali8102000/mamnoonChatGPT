import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { router } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { authProxy, supabase } from '@/lib/supabase';
import { isValidPhone, normalizePhone } from '@/lib/phone';
import { useAuth } from '@/lib/auth-context';
import { Button, RealInput } from '@/components/ui';

type Mode = 'signup' | 'login';
type AuthSessionTokens = Pick<Session, 'access_token' | 'refresh_token'>;

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signup');
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();

  async function onSubmit() {
    if (password.length < 6) {
      Alert.alert('خطأ', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        if (name.trim().length < 2) {
          Alert.alert('خطأ', 'الرجاء إدخال الاسم');
          setBusy(false);
          return;
        }
        if (!isValidPhone(phone)) {
          Alert.alert('خطأ', 'رقم الهاتف غير صالح');
          setBusy(false);
          return;
        }
        const normalized = normalizePhone(phone);
        const realEmail = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(realEmail)) {
          Alert.alert('تنبيه', 'حالياً يلزم بريد إلكتروني حقيقي للتسجيل إلى أن يتم تفعيل التحقق برسالة SMS.');
          setBusy(false);
          return;
        }
        const authEmail = realEmail;
        const result = await authProxy<{ session: AuthSessionTokens | null }>('/signup', { email: authEmail, password, phone: normalized, full_name: name.trim() });
        if (!result.session) { Alert.alert('تم التسجيل', 'تحقق من بريدك الإلكتروني ثم سجل الدخول'); setMode('login'); return; }
        const { error } = await supabase.auth.setSession(result.session);
        if (error) throw error;
        await refresh();
        router.replace('/select-role');
      } else {
        const id = identifier.trim();
        if (!id) {
          Alert.alert('خطأ', 'أدخل رقم الهاتف أو البريد الإلكتروني');
          setBusy(false);
          return;
        }
        const isEmail = id.includes('@');
        const finalId = isEmail ? id : normalizePhone(id);
        if (!isEmail && !isValidPhone(id)) {
          Alert.alert('خطأ', 'رقم الهاتف غير صالح');
          setBusy(false);
          return;
        }
        const loginPayload = isEmail
          ? { email: finalId, password }
          : { phone: finalId, password };
        const result = await authProxy<{ session: AuthSessionTokens | null }>('/login', loginPayload);
        if (!result.session) throw new Error('تعذر إنشاء جلسة تسجيل الدخول');
        const { error } = await supabase.auth.setSession(result.session);
        if (error) throw error;
        await refresh();
        router.replace('/');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ';
      if (/Failed to fetch|NetworkError/i.test(msg)) {
        Alert.alert('خطأ', 'تعذّر الاتصال بالخادم. تحقق من اتصال الإنترنت');
      } else if (/already registered|User already/i.test(msg)) {
        Alert.alert('خطأ', 'هذا الحساب مسجّل مسبقاً. حاول تسجيل الدخول');
      } else if (/Invalid login|Invalid credentials/i.test(msg)) {
        Alert.alert('خطأ', 'بيانات الدخول غير صحيحة');
      } else {
        Alert.alert('خطأ', msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.logoWrap}>
        <View style={styles.logo}><Text style={styles.logoText}>م</Text></View>
        <Text style={styles.title}>ممنون</Text>
        <Text style={styles.subtitle}>منصة النقل والخدمات الفاخرة</Text>
      </View>
      <View style={styles.card}>
        <View style={styles.tabs}>
          {(['signup', 'login'] as Mode[]).map((m) => (
            <View key={m} style={[styles.tab, mode === m && styles.tabActive]}>
              <Text style={[styles.tabText, mode === m && styles.tabTextActive]} onPress={() => setMode(m)}>
                {m === 'signup' ? 'حساب جديد' : 'تسجيل دخول'}
              </Text>
            </View>
          ))}
        </View>
        {mode === 'signup' ? (
          <>
            <Text style={styles.label}>الاسم الكامل</Text>
            <RealInput value={name} onChangeText={setName} placeholder="مثال: أحمد محمد" />
            <Text style={styles.label}>رقم الهاتف</Text>
            <RealInput value={phone} onChangeText={setPhone} placeholder="07XXXXXXXXX" keyboardType="phone-pad" />
            <Text style={styles.label}>البريد الإلكتروني (مطلوب حالياً إلى حين تفعيل SMS)</Text>
            <RealInput value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
          </>
        ) : (
          <>
            <Text style={styles.label}>رقم الهاتف أو البريد</Text>
            <RealInput value={identifier} onChangeText={setIdentifier} placeholder="07XXXXXXXXX" keyboardType="phone-pad" />
          </>
        )}
        <Text style={styles.label}>كلمة المرور</Text>
        <RealInput value={password} onChangeText={setPassword} placeholder="••••••" secureTextEntry />
        {mode === 'login' && (
          <Text style={styles.forgotLink} onPress={() => router.push('/forgot-password')}>نسيت كلمة المرور؟</Text>
        )}
        <View style={{ height: 24 }} />
        <Button title={mode === 'signup' ? 'إنشاء الحساب' : 'دخول'} onPress={onSubmit} loading={busy} />
        <Text style={styles.terms}>بمتابعتك أنت توافق على الشروط والأحكام وسياسة الخصوصية</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 60, paddingBottom: 30 },
  logoWrap: { alignItems: 'center', marginBottom: 40 },
  logo: { width: 80, height: 80, borderRadius: 24, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  logoText: { fontSize: 32, fontWeight: '900', color: '#fff' },
  title: { fontSize: 36, fontWeight: '900', color: '#1e293b' },
  subtitle: { fontSize: 14, color: '#64748b', marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 24, flex: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 6 },
  tabs: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 16, padding: 4, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  tabActive: { backgroundColor: '#2563eb' },
  tabText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  tabTextActive: { color: '#fff' },
  label: { fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 8, marginTop: 16 },
  forgotLink: { fontSize: 12, fontWeight: '700', color: '#2563eb', marginTop: 12, textAlign: 'left' },
  terms: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 16, lineHeight: 18 },
});
