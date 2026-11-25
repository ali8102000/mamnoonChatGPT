import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { AnimatedRegion, Marker } from "react-native-maps";
import Svg, { Circle, Path, Rect } from "react-native-svg";

export type ProviderMarkerRole = "captain" | "usta" | "carrier" | "partner";
export type ProviderMarkerCoordinate = {
  latitude: number;
  longitude: number;
};

type Props = {
  role: ProviderMarkerRole;
  coordinate: ProviderMarkerCoordinate;
  heading?: number | null;
  title?: string;
  animated?: boolean;
};

const ROLE_STYLE: Record<ProviderMarkerRole, { color: string; title: string }> = {
  captain: { color: "#2563EB", title: "موقع الكابتن" },
  usta: { color: "#D97706", title: "موقع الأُسطة" },
  carrier: { color: "#0F766E", title: "موقع سيارة النقل" },
  partner: { color: "#7C3AED", title: "موقع الشريك" },
};

function validHeading(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 360;
}

function bearingBetween(from: ProviderMarkerCoordinate, to: ProviderMarkerCoordinate) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const degrees = (value: number) => (value * 180) / Math.PI;
  const lat1 = radians(from.latitude);
  const lat2 = radians(to.latitude);
  const deltaLng = radians(to.longitude - from.longitude);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

function shortestTurn(from: number, to: number) {
  const normalized = ((to % 360) + 360) % 360;
  const delta = ((normalized - (from % 360) + 540) % 360) - 180;
  return from + delta;
}

function RoleGlyph({ role, color }: { role: ProviderMarkerRole; color: string }) {
  const common = { stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" as const };
  if (role === "captain") {
    return (
      <Svg width={30} height={30} viewBox="0 0 24 24">
        <Path {...common} d="M4 14.5 5.7 9a2 2 0 0 1 1.9-1.4h8.8A2 2 0 0 1 18.3 9l1.7 5.5V18h-2v-1.5H6V18H4v-3.5Z" />
        <Path {...common} d="M6 12h12M8 7.6l1-2h6l1 2" />
        <Circle {...common} cx="7.5" cy="14.5" r="1" />
        <Circle {...common} cx="16.5" cy="14.5" r="1" />
      </Svg>
    );
  }
  if (role === "carrier") {
    return (
      <Svg width={30} height={30} viewBox="0 0 24 24">
        <Path {...common} d="M2.5 6.5h12v11h-12zM14.5 10h4l3 3.5v4h-7z" />
        <Path {...common} d="M16 10v4h5M6.5 17.5a1.7 1.7 0 1 0 0 .1M17.5 17.5a1.7 1.7 0 1 0 0 .1" />
      </Svg>
    );
  }
  if (role === "usta") {
    return (
      <Svg width={30} height={30} viewBox="0 0 24 24">
        <Path {...common} d="M14.7 6.2a5 5 0 0 0-6.5 6.5l-5.1 5.1a1.8 1.8 0 0 0 2.6 2.6l5.1-5.1a5 5 0 0 0 6.5-6.5l-3 3-2.6-2.6 3-3Z" />
        <Circle {...common} cx="5" cy="18" r=".8" />
      </Svg>
    );
  }
  return (
    <Svg width={30} height={30} viewBox="0 0 24 24">
      <Path {...common} d="M20 10.2c0 5.1-8 11.1-8 11.1S4 15.3 4 10.2a8 8 0 1 1 16 0Z" />
      <Rect {...common} x="8" y="8" width="8" height="6" rx="1" />
      <Path {...common} d="M10 14v-3h4v3" />
    </Svg>
  );
}

/** Smoothly interpolated provider marker with a distinct icon for each work category. */
export function ProviderLocationMarker({ role, coordinate, heading, title, animated = true }: Props) {
  const initialHeading = validHeading(heading) ? heading : 0;
  const coordinateRef = useRef(
    new AnimatedRegion({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
    }),
  );
  const rotation = useRef(new Animated.Value(initialHeading)).current;
  const previousCoordinate = useRef(coordinate);
  const previousHeading = useRef(initialHeading);
  const color = ROLE_STYLE[role].color;
  const rotationDegrees = rotation.interpolate({
    inputRange: [-36000, 36000],
    outputRange: ["-36000deg", "36000deg"],
    extrapolate: "extend",
  });

  useEffect(() => {
    const nextCoordinate = coordinate;
    const movedEnough =
      Math.abs(nextCoordinate.latitude - previousCoordinate.current.latitude) > 0.000001 ||
      Math.abs(nextCoordinate.longitude - previousCoordinate.current.longitude) > 0.000001;

    if (animated && movedEnough) {
      coordinateRef.current.timing({
        latitude: nextCoordinate.latitude,
        longitude: nextCoordinate.longitude,
        duration: 850,
        useNativeDriver: false,
      }).start();
    } else {
      coordinateRef.current.setValue({
        latitude: nextCoordinate.latitude,
        longitude: nextCoordinate.longitude,
        latitudeDelta: 0,
        longitudeDelta: 0,
      });
    }

    const nextHeading = validHeading(heading)
      ? heading
      : movedEnough
        ? bearingBetween(previousCoordinate.current, nextCoordinate)
        : previousHeading.current;
    const smoothTarget = shortestTurn(previousHeading.current, nextHeading);

    if (animated && Math.abs(smoothTarget - previousHeading.current) > 0.5) {
      Animated.timing(rotation, {
        toValue: smoothTarget,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (!animated) {
      rotation.setValue(smoothTarget);
    }

    previousCoordinate.current = nextCoordinate;
    previousHeading.current = smoothTarget;
  }, [animated, coordinate.latitude, coordinate.longitude, heading, rotation]);

  return (
    <Marker.Animated
      coordinate={coordinateRef.current}
      anchor={{ x: 0.5, y: role === "partner" ? 0.92 : 0.5 }}
      title={title || ROLE_STYLE[role].title}
      tracksViewChanges
      flat={role !== "partner"}
    >
      <Animated.View
        style={[
          styles.marker,
          { borderColor: color, transform: [{ rotate: rotationDegrees }] },
          role === "partner" && styles.partnerMarker,
        ]}
      >
        <View style={[styles.glyphWrap, role === "partner" && styles.partnerGlyphWrap]}>
          <RoleGlyph role={role} color={color} />
        </View>
        {role !== "partner" ? <View style={[styles.directionNose, { borderBottomColor: color }]} /> : null}
      </Animated.View>
    </Marker.Animated>
  );
}

const styles = StyleSheet.create({
  marker: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#FFFFFF",
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    elevation: 9,
    shadowColor: "#0F172A",
    shadowOpacity: 0.22,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
  },
  glyphWrap: { alignItems: "center", justifyContent: "center" },
  directionNose: {
    position: "absolute",
    top: -7,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 9,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  partnerMarker: { width: 50, height: 58, borderRadius: 25, borderBottomLeftRadius: 8, transform: [{ rotate: "-45deg" }] },
  partnerGlyphWrap: { transform: [{ rotate: "45deg" }] },
});
