import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

type Props = {
  isOnline: boolean;
  offlineText: string;
  onlineText: string;
  activeColor: string;
  scaleFn: (value: number) => number;
  onToggle: () => void;
  disabled?: boolean;
};

export function PowerStatusSwitch({
  isOnline,
  offlineText,
  onlineText,
  activeColor,
  scaleFn,
  onToggle,
  disabled = false,
}: Props) {
  const width = scaleFn(184);
  const height = scaleFn(58);
  const padding = scaleFn(6);
  const knobSize = scaleFn(46);
  const travelDistance = width - knobSize - padding * 2;
  const progress = useRef(new Animated.Value(isOnline ? 1 : 0)).current;
  const rotation = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    Animated.spring(progress, {
      toValue: isOnline ? 1 : 0,
      speed: 18,
      bounciness: 5,
      useNativeDriver: true,
    }).start();

    spinLoop.current?.stop();
    if (isOnline) {
      rotation.setValue(0);
      spinLoop.current = Animated.loop(
        Animated.timing(rotation, {
          toValue: 1,
          duration: 1900,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      spinLoop.current.start();
    } else {
      rotation.setValue(0);
    }

    return () => spinLoop.current?.stop();
  }, [isOnline, progress, rotation]);

  const knobTranslateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, travelDistance],
  });
  const arcRotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled, checked: isOnline }}
      accessibilityLabel={isOnline ? onlineText : offlineText}
      activeOpacity={0.9}
      disabled={disabled}
      onPress={onToggle}
      style={[
        styles.track,
        {
          width,
          height,
          borderRadius: height / 2,
          backgroundColor: isOnline ? "#E8F8EE" : "#F1F5F9",
          borderColor: isOnline ? activeColor : "#DCE3EC",
          opacity: disabled ? 0.58 : 1,
        },
      ]}
    >
      <Text numberOfLines={1} style={[styles.label, { color: isOnline ? activeColor : "#64748B" }]}>
        {isOnline ? onlineText : offlineText}
      </Text>
      <Animated.View
        style={[
          styles.knob,
          {
            width: knobSize,
            height: knobSize,
            borderRadius: knobSize / 2,
            left: padding,
            transform: [{ translateX: knobTranslateX }],
            borderColor: isOnline ? activeColor : "#CBD5E1",
          },
        ]}
      >
        <Animated.View style={[styles.arc, { transform: [{ rotate: arcRotate }] }]}>
          <Svg width={knobSize - 3} height={knobSize - 3} viewBox="0 0 44 44">
            <Circle cx="22" cy="22" r="19" fill="none" stroke={isOnline ? activeColor : "#94A3B8"} strokeWidth="1.8" strokeDasharray="18 102" strokeLinecap="round" />
          </Svg>
        </Animated.View>
        <View style={styles.powerGlyph}>
          <Svg width={scaleFn(21)} height={scaleFn(21)} viewBox="0 0 24 24">
            <Path d="M12 2.8v9.1M6.2 5.8a8 8 0 1 0 11.6 0" fill="none" stroke={isOnline ? activeColor : "#64748B"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  track: {
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    elevation: 3,
    shadowColor: "#0F172A",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  label: { fontSize: 12, fontWeight: "900", paddingHorizontal: 54 },
  knob: {
    position: "absolute",
    top: 5,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#0F172A",
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  arc: { position: "absolute", alignItems: "center", justifyContent: "center" },
  powerGlyph: { alignItems: "center", justifyContent: "center" },
});
