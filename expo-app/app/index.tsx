import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { View, ActivityIndicator, StyleSheet } from "react-native";

export default function Index() {
  const { loading } = useAuth();

  // The welcome screen is the app's entry point on every cold launch.
  // Authentication is resolved first so the welcome action can continue
  // the existing signed-in or signed-out journey without losing the session.
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return <Redirect href="/welcome" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
});
