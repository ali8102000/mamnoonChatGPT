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

    const errorMessage = this.state.error.message || "سبب الخطأ غير متوفر";

    return (
      <View style={styles.container}>
        <Text style={styles.title}>صار خلل غير متوقع</Text>
        <Text style={styles.message}>التطبيق ما زال مفتوحاً، لكن تعذر عرض الصفحة.</Text>
        <Text selectable style={styles.error} testID="app-error-details">{errorMessage}</Text>
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
  error: { color: "#9F1239", fontSize: 12, lineHeight: 19, textAlign: "left", writingDirection: "ltr", marginTop: 16, maxWidth: "100%" },
  button: { marginTop: 22, borderRadius: 12, backgroundColor: "#17324D", paddingHorizontal: 26, paddingVertical: 13 },
  buttonText: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
});
