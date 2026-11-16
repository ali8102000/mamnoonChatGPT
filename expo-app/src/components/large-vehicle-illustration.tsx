import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { View } from "react-native";

type VehicleKind = "kia_cargo" | "kia_passenger" | "bus";
export function LargeVehicleIllustration({ kind }: { kind: VehicleKind }) {
  return (
    <View style={{ width: 104, height: 68, alignItems: "center", justifyContent: "center" }}>
      <Svg width="100%" height="100%" viewBox="0 0 140 90">
        <Rect x="3" y="3" width="134" height="84" rx="18" fill="#EFF6FB" />
        {kind === "kia_cargo" && <>
          <Path d="M15 37 Q15 31 23 31 H75 V64 H15Z" fill="#E7A64B" />
          <Path d="M75 43 H103 Q111 43 116 53 L124 64 H75Z" fill="#477FA7" />
          <Path d="M83 47 H101 Q106 47 110 55 H83Z" fill="#D8EDF8" />
          <Path d="M23 23 H65 V31 H23Z" fill="#D18B35" />
          <Circle cx="38" cy="66" r="10" fill="#243B50" /><Circle cx="38" cy="66" r="4" fill="#DCE8EF" />
          <Circle cx="101" cy="66" r="10" fill="#243B50" /><Circle cx="101" cy="66" r="4" fill="#DCE8EF" />
          <Path d="M20 39 H69 M28 23 V31 M49 23 V31" stroke="#F8D9A6" strokeWidth="2.5" />
        </>}
        {kind === "kia_passenger" && <>
          <Path d="M14 59 L22 39 Q26 31 39 31 H91 Q103 31 110 43 L124 59 V65 H14Z" fill="#3F8DBB" />
          <Path d="M34 35 H88 Q95 35 101 44 L106 52 H25 L30 40Z" fill="#D7EFFA" />
          <Path d="M67 35 V52 M25 54 H118" stroke="#28658C" strokeWidth="2.5" />
          <Circle cx="39" cy="66" r="10" fill="#243B50" /><Circle cx="39" cy="66" r="4" fill="#DCE8EF" />
          <Circle cx="101" cy="66" r="10" fill="#243B50" /><Circle cx="101" cy="66" r="4" fill="#DCE8EF" />
          <Path d="M16 55 H24 M115 55 H122" stroke="#F0B85F" strokeWidth="4" strokeLinecap="round" />
        </>}
        {kind === "bus" && <>
          <Rect x="20" y="19" width="100" height="48" rx="10" fill="#D9A34B" />
          <Rect x="27" y="26" width="86" height="23" rx="4" fill="#DDF1FA" />
          <Path d="M48 26 V49 M69 26 V49 M90 26 V49" stroke="#A4C9DE" strokeWidth="3" />
          <Path d="M25 55 H115" stroke="#B77D2E" strokeWidth="3" />
          <Circle cx="42" cy="68" r="9" fill="#243B50" /><Circle cx="42" cy="68" r="4" fill="#DCE8EF" />
          <Circle cx="98" cy="68" r="9" fill="#243B50" /><Circle cx="98" cy="68" r="4" fill="#DCE8EF" />
          <Path d="M20 57 H15 M120 57 H125" stroke="#E8B45D" strokeWidth="4" strokeLinecap="round" />
        </>}
      </Svg>
    </View>
  );
}
