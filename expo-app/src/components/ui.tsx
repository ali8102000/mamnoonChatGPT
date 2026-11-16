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
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  style?: ViewStyle;
}) {
  const backgroundColor =
    variant === "primary" ? palette.brand :
    variant === "danger" ? palette.danger :
    variant === "secondary" ? palette.surfaceSoft : "transparent";
  const color =
    variant === "secondary" || variant === "outline" ? palette.ink :
    variant === "ghost" ? palette.brand : palette.white;
  const isElevated = variant === "primary" || variant === "danger";
  const isOutlined = variant === "outline";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor,
          borderColor: isOutlined ? palette.line : "transparent",
          borderWidth: isOutlined ? 1 : 0,
          opacity: disabled || loading ? 0.5 : pressed ? 0.88 : 1,
          shadowColor: isElevated ? palette.brandDeep : "transparent",
          shadowOpacity: isElevated && !disabled && !loading ? 0.16 : 0,
          elevation: isElevated && !disabled && !loading ? 2 : 0,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.buttonText, { color }]}>{title}</Text>
      )}
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
  // Mirrors the web Button default (h-9, px-4, rounded-md, text-sm, shadow)
  // while preserving Android's 44dp minimum touch target.
  button: {
    minHeight: 44,
    paddingHorizontal: space.xl,
    paddingVertical: 9,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  buttonText: {
    fontSize: 16,
    lineHeight: 21,
    fontFamily: "Tajawal_800ExtraBold",
    fontWeight: "800",
    letterSpacing: 0.1,
    includeFontPadding: false,
    textAlign: "center",
  },
  realInput: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: 15,
    fontFamily: "Tajawal_500Medium",
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
  eyebrow: { color: palette.muted, fontSize: 11, fontFamily: "Tajawal_800ExtraBold", fontWeight: "800", letterSpacing: 0.8 },
});
