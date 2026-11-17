import { ReactNode } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  StyleProp,
  TextInput,
  TextInputProps,
} from "react-native";
import { palette, radius, space } from "@/styles/theme";

type ButtonVariant = "primary" | "default" | "secondary" | "danger" | "destructive" | "outline" | "ghost" | "link";
type ButtonSize = "default" | "sm" | "lg" | "icon";

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = "primary",
  size = "default",
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: ViewStyle;
}) {
  const resolvedVariant = variant === "default" ? "primary" : variant === "destructive" ? "danger" : variant;
  const isGhost = resolvedVariant === "ghost" || resolvedVariant === "link";
  const backgroundColor =
    resolvedVariant === "primary" ? palette.brand :
    resolvedVariant === "danger" ? palette.danger :
    resolvedVariant === "secondary" ? palette.surfaceSoft :
    resolvedVariant === "outline" ? palette.canvasSolid : "transparent";
  const color = resolvedVariant === "secondary" || resolvedVariant === "outline"
    ? palette.ink
    : isGhost ? palette.brand : palette.white;
  const borderColor = resolvedVariant === "outline" ? palette.line : "transparent";
  const buttonSizeStyle = size === "sm" ? styles.small :
    size === "lg" ? styles.large :
    size === "icon" ? styles.icon : styles.defaultSize;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        buttonSizeStyle,
        { backgroundColor, borderColor, borderWidth: resolvedVariant === "outline" ? 1 : 0 },
        ["primary", "danger", "secondary", "outline"].includes(resolvedVariant) ? styles.elevated : null,
        { opacity: disabled || loading ? 0.5 : pressed ? 0.86 : 1, transform: [{ scale: pressed && !disabled && !loading ? 0.985 : 1 }] },
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={color} />
        : <Text numberOfLines={1} style={[styles.buttonText, size === "sm" && styles.smallText, { color, textDecorationLine: resolvedVariant === "link" ? "underline" : "none" }]}>{title}</Text>}
    </Pressable>
  );
}


export function ActionButton({
  children,
  onPress,
  disabled,
  style,
  size = "default",
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: ButtonSize;
  accessibilityLabel?: string;
}) {
  const dimensions = size === "sm" ? styles.actionSmall : size === "lg" ? styles.actionLarge : size === "icon" ? styles.actionIcon : styles.actionDefault;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        style,
        styles.actionBase,
        dimensions,
        { opacity: disabled ? 0.5 : pressed ? 0.86 : 1, transform: [{ scale: pressed && !disabled ? 0.985 : 1 }] },
      ]}
    >
      {children}
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
    minWidth: 0,
    paddingHorizontal: space.lg,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    alignSelf: "stretch",
  },
  defaultSize: { minHeight: 50, paddingVertical: 12, paddingHorizontal: 20 },
  actionBase: { borderRadius: 16, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  actionDefault: { minHeight: 50, paddingVertical: 12, paddingHorizontal: 20 },
  actionSmall: { minHeight: 44, paddingVertical: 9, paddingHorizontal: 16 },
  actionLarge: { minHeight: 58, paddingVertical: 14, paddingHorizontal: 34 },
  actionIcon: { width: 50, height: 50, minHeight: 50, padding: 0 },
  small: { minHeight: 44, paddingVertical: 9, paddingHorizontal: 16 },
  large: { minHeight: 58, paddingVertical: 14, paddingHorizontal: 34 },
  icon: { width: 50, height: 50, minHeight: 50, paddingHorizontal: 0, paddingVertical: 0, alignSelf: "center" },
  elevated: {
    shadowColor: "#08101A",
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  buttonText: { fontSize: 17, lineHeight: 23, fontFamily: "Tajawal_700Bold", fontWeight: "700", letterSpacing: 0, textAlign: "center" },
  smallText: { fontSize: 15, lineHeight: 20 },
  realInput: {
    minHeight: 62,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: 16,
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
