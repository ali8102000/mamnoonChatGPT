import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[app-boundary] Unhandled render error:", error, info.componentStack);
  }

  private recover = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>صار خلل غير متوقع</Text>
        <Text style={styles.message}>ما راح نغلق التطبيق. تگدر تحاول ترجع للواجهة.</Text>
        <Pressable accessibilityRole="button" onPress={this.recover} style={styles.button}>
          <Text style={styles.buttonText}>إعادة المحاولة</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#F7F8FA" },
  title: { color: "#17324D", fontSize: 22, fontWeight: "900", textAlign: "center" },
  message: { color: "#64748B", fontSize: 14, lineHeight: 24, textAlign: "center", marginTop: 10 },
  button: { marginTop: 22, borderRadius: 12, backgroundColor: "#17324D", paddingHorizontal: 26, paddingVertical: 13 },
  buttonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
});
