import { ReactNode } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextInput,
  TextInputProps,
} from "react-native";
import { palette, radius, space } from "@/styles/theme";

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = "primary",
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  style?: ViewStyle;
}) {
  const backgroundColor =
    variant === "primary" ? palette.brand :
    variant === "danger" ? palette.danger :
    variant === "secondary" ? palette.surfaceSoft : "transparent";
  const color = variant === "secondary" ? palette.ink :
    variant === "ghost" ? palette.brand : palette.white;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, opacity: disabled || loading ? 0.55 : pressed ? 0.82 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{title}</Text>}
    </Pressable>
  );
}

export function RealInput({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  style,
  autoFocus,
  autoCapitalize,
  maxLength,
  ...props
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: TextInputProps["keyboardType"];
  style?: ViewStyle;
  autoFocus?: boolean;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  maxLength?: number;
} & Pick<TextInputProps, "textContentType" | "autoComplete" | "returnKeyType" | "onSubmitEditing">) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={palette.muted}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType || "default"}
      autoFocus={autoFocus}
      autoCapitalize={autoCapitalize}
      maxLength={maxLength}
      selectionColor={palette.brand}
      style={[styles.realInput, style]}
      {...props}
    />
  );
}

export function Surface({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 15, fontWeight: "800", letterSpacing: 0.1 },
  realInput: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: 15,
    fontWeight: "600",
    color: palette.ink,
    backgroundColor: palette.surfaceSoft,
    textAlign: "left",
  },
  surface: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.line,
    padding: space.xl,
  },
  eyebrow: { color: palette.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
});
