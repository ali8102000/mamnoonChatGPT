import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nManager, LogBox } from 'react-native';
import { AuthProvider } from '@/lib/auth-context';

I18nManager.forceRTL(true);
I18nManager.allowRTL(true);

LogBox.ignoreLogs(['Setting a timer', 'AsyncStorage']);

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#f9fafb' },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="select-role" />
        <Stack.Screen name="home" />
        <Stack.Screen name="request/new" />
        <Stack.Screen name="request/[id]" />
        <Stack.Screen name="messages" />
        <Stack.Screen name="friends" />
        <Stack.Screen name="history" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="onboarding/driver" />
        <Stack.Screen name="onboarding/worker" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="reset-password" />
      </Stack>
    </AuthProvider>
  );
}
