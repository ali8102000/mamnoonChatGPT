import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { AnimatedRegion, Marker } from "react-native-maps";

export type ProviderMarkerRole = "captain" | "usta" | "carrier" | "partner";
export type LargeVehicleMarkerType = "kia_cargo" | "kia_passenger" | "bus";
export type ProviderMarkerCoordinate = {
  latitude: number;
  longitude: number;
};

type Props = {
  role: ProviderMarkerRole;
  vehicleType?: LargeVehicleMarkerType | null;
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

function RoleGlyph({ role, vehicleType }: { role: ProviderMarkerRole; vehicleType?: LargeVehicleMarkerType | null }) {
  // Use recognizable symbols rather than hand-drawn vehicle illustrations.
  const symbol = role === "captain"
    ? "🚕"
    : role === "usta"
      ? "🛠️"
      : role === "partner"
        ? "🏪"
        : vehicleType === "bus"
          ? "🚌"
          : vehicleType === "kia_passenger"
            ? "🚐"
            : "🚚";
  return (
    <Text
      accessible
      accessibilityLabel={role === "carrier" ? (vehicleType === "bus" ? "باص" : vehicleType === "kia_passenger" ? "سيارة ركاب" : "شاحنة حمل") : role === "usta" ? "فني خدمات" : role === "captain" ? "سيارة أجرة" : "شريك"}
      style={styles.symbol}
    >
      {symbol}
    </Text>
  );
}

/** Smoothly interpolated provider marker with a distinct icon for each work category. */
export function ProviderLocationMarker({ role, vehicleType, coordinate, heading, title, animated = true }: Props) {
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
        // AnimatedRegion replaces this placeholder with each coordinate value internally.
        toValue: 0,
        latitude: nextCoordinate.latitude,
        longitude: nextCoordinate.longitude,
        latitudeDelta: 0,
        longitudeDelta: 0,
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
      coordinate={coordinateRef.current as any}
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
          <RoleGlyph role={role} vehicleType={vehicleType} />
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
  symbol: { fontSize: 27, lineHeight: 34, textAlign: "center" },
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
