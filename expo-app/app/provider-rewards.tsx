import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { ProviderMissions } from "@/components/provider-missions";
import { palette } from "@/styles/theme";

export default function ProviderRewardsScreen() {
  return (
    <View style={styles.page}>
      <Stack.Screen options={{ title: "مكافآتي من المسابقات" }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>المكافآت اللي فزت بيها</Text>
        <Text style={styles.subtitle}>هنا تظهر مهمات المسابقات اللي أكملتها ومكافآتها، مو كوبونات أو قسائم.</Text>
        <ProviderMissions />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.pageCanvas },
  content: { paddingTop: 18, paddingBottom: 36 },
  title: { color: palette.ink, fontSize: 21, fontWeight: "900", textAlign: "right", paddingHorizontal: 20 },
  subtitle: { color: palette.muted, fontSize: 12, lineHeight: 20, textAlign: "right", paddingHorizontal: 20, marginTop: 6, marginBottom: 18 },
});
