import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

type DriverWallet = { balance: number; total_earned: number; total_commission: number };
type WalletTransaction = { id: string; type: string; created_at: string; amount: number };

export default function ProfileScreen() {
  const { user, profile, roles, signOut } = useAuth();
  const [wallet, setWallet] = useState<DriverWallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    async function load() {
      if (roles.includes('driver')) {
        const { data } = await supabase.from('driver_wallets').select('*').eq('driver_id', user?.id).maybeSingle();
        setWallet(data);
        const { data: txns } = await supabase.from('transactions').select('*').eq('driver_id', user?.id).order('created_at', { ascending: false }).limit(10);
        setTransactions(txns || []);
      }
      const { data: adminCheck } = await supabase.rpc('has_role', { _user_id: user?.id, _role: 'admin' });
      setIsAdmin(!!adminCheck);
    }
    load();
  }, [user?.id, roles]);

  async function handleSignOut() {
    Alert.alert('تسجيل الخروج', 'هل أنت متأكد؟', [{ text: 'تراجع', style: 'cancel' }, { text: 'خروج', style: 'destructive', onPress: async () => { await signOut(); router.replace('/auth'); } }]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.header}><View style={styles.avatar}><Text style={styles.avatarText}>{(profile?.full_name || '؟')[0]}</Text></View><Text style={styles.name}>{profile?.full_name || 'مستخدم'}</Text><Text style={styles.phone}>{profile?.phone}</Text></View>
      <View style={styles.rolesRow}>{roles.map((r) => (<View key={r} style={styles.roleBadge}><Text style={styles.roleBadgeText}>{r === 'customer' ? 'زبون' : r === 'driver' ? 'سائق' : 'فني'}</Text></View>))}</View>
      {wallet && (<View style={styles.walletCard}><Text style={styles.walletTitle}>محفظة السائق</Text><Text style={styles.walletBalance}>{(wallet.balance || 0).toLocaleString('en')} د.ع</Text><View style={styles.walletStats}><View style={{ flex: 1 }}><Text style={styles.walletStatLabel}>إجمالي الأرباح</Text><Text style={styles.walletStatValue}>{(wallet.total_earned || 0).toLocaleString('en')} د.ع</Text></View><View style={{ flex: 1 }}><Text style={styles.walletStatLabel}>العمولة</Text><Text style={styles.walletStatValue}>{(wallet.total_commission || 0).toLocaleString('en')} د.ع</Text></View></View></View>)}
      {transactions.length > 0 && (<><Text style={styles.sectionTitle}>آخر العمليات</Text>{transactions.map((txn) => (<View key={txn.id} style={styles.txnCard}><View style={{ flex: 1 }}><Text style={styles.txnType}>{txn.type === 'credit' ? 'إضافة' : 'خصم'}</Text><Text style={styles.txnDate}>{new Date(txn.created_at).toLocaleDateString('ar')}</Text></View><Text style={[styles.txnAmount, { color: txn.type === 'credit' ? '#16a34a' : '#dc2626' }]}>{txn.type === 'credit' ? '+' : '-'}{(txn.amount || 0).toLocaleString('en')} د.ع</Text></View>))}</>)}
      {isAdmin && (<TouchableOpacity style={styles.menuItem} onPress={() => router.push('/admin')}><Text style={styles.menuItemText}>لوحة التحكم</Text><Text style={styles.menuArrow}>←</Text></TouchableOpacity>)}
      {!roles.includes('driver') && (<TouchableOpacity style={styles.menuItem} onPress={() => router.push('/onboarding/driver')}><Text style={styles.menuItemText}>التسجيل كسائق</Text><Text style={styles.menuArrow}>←</Text></TouchableOpacity>)}
      {!roles.includes('worker') && (<TouchableOpacity style={styles.menuItem} onPress={() => router.push('/onboarding/worker')}><Text style={styles.menuItemText}>التسجيل كفني</Text><Text style={styles.menuArrow}>←</Text></TouchableOpacity>)}
      <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={handleSignOut}><Text style={[styles.menuItemText, { color: '#dc2626' }]}>تسجيل الخروج</Text><Text style={[styles.menuArrow, { color: '#dc2626' }]}>←</Text></TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', paddingHorizontal: 20, paddingTop: 50 }, header: { alignItems: 'center', marginBottom: 24 }, avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }, avatarText: { fontSize: 32, fontWeight: '900', color: '#fff' }, name: { fontSize: 22, fontWeight: '800', color: '#1e293b' }, phone: { fontSize: 14, color: '#64748b', marginTop: 4 },
  rolesRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: 24 }, roleBadge: { backgroundColor: '#2563eb10', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 }, roleBadgeText: { fontSize: 13, fontWeight: '700', color: '#2563eb' },
  walletCard: { backgroundColor: '#2563eb', borderRadius: 20, padding: 20, marginBottom: 24 }, walletTitle: { fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: '600' }, walletBalance: { fontSize: 32, fontWeight: '900', color: '#fff', marginTop: 4 }, walletStats: { flexDirection: 'row', gap: 16, marginTop: 16 }, walletStatLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)' }, walletStatValue: { fontSize: 16, fontWeight: '700', color: '#fff', marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1e293b', marginBottom: 12 }, txnCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8 }, txnType: { fontSize: 14, fontWeight: '700', color: '#1e293b' }, txnDate: { fontSize: 12, color: '#94a3b8', marginTop: 2 }, txnAmount: { fontSize: 15, fontWeight: '800' },
  menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 8 }, menuItemText: { fontSize: 16, fontWeight: '700', color: '#1e293b' }, menuArrow: { fontSize: 20, color: '#94a3b8' },
});
