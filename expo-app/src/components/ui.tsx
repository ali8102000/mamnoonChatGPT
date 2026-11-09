import { ReactNode } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, ViewStyle, TextInput } from 'react-native';

export function Button({ title, onPress, loading, disabled, variant = 'primary', style }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; style?: ViewStyle }) {
  const bg = variant === 'primary' ? '#2563eb' : variant === 'danger' ? '#dc2626' : variant === 'secondary' ? '#e2e8f0' : 'transparent';
  const color = variant === 'secondary' ? '#1e293b' : variant === 'ghost' ? '#2563eb' : '#fff';
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled || loading} activeOpacity={0.85} style={[styles.button, { backgroundColor: bg }, disabled && styles.disabled, style]}>
      {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{title}</Text>}
    </TouchableOpacity>
  );
}

export function RealInput({ value, onChangeText, placeholder, secureTextEntry, keyboardType, style, autoFocus }: { value: string; onChangeText: (v: string) => void; placeholder?: string; secureTextEntry?: boolean; keyboardType?: 'default' | 'phone-pad' | 'email-address' | 'numeric'; style?: ViewStyle; autoFocus?: boolean }) {
  return (
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#94a3b8" secureTextEntry={secureTextEntry} keyboardType={keyboardType || 'default'} autoFocus={autoFocus} style={[styles.realInput, style]} />
  );
}

const styles = StyleSheet.create({
  button: { paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  realInput: { borderWidth: 1, borderColor: 'rgba(30,41,59,0.1)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, fontWeight: '600', color: '#1e293b', backgroundColor: 'rgba(30,41,59,0.03)', textAlign: 'left' },
});
