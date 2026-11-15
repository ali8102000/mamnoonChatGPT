import React from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

type Props = { slug: string };
const ink = "#18324B", blue = "#4D91C6", pale = "#EAF3F8", gold = "#E6A94E", green = "#67A886";
export const hasServiceArtwork = (slug: string) => [
  "security_cameras", "goods_transport", "furniture_moving", "cargo_handling",
  "gardener", "kia_driver", "internet_install",
].includes(slug);

export function ServiceArtwork({ slug }: Props) {
  return (
    <View style={{ width: 88, height: 66, alignItems: "center", justifyContent: "center" }}>
      <Svg width="100%" height="100%" viewBox="0 0 120 90">
        <Rect x="2" y="2" width="116" height="86" rx="16" fill={pale} />
        {slug === "security_cameras" && <>
          <Path d="M20 27 H99" stroke={ink} strokeWidth="5" strokeLinecap="round" />
          <Path d="M39 27 V39" stroke={ink} strokeWidth="4" />
          <Rect x="29" y="38" width="40" height="25" rx="7" fill={blue} />
          <Path d="M69 44 L91 37 V65 L69 57 Z" fill={ink} />
          <Circle cx="49" cy="50" r="8" fill="#D9F0FA" /><Circle cx="49" cy="50" r="4" fill={ink} />
          <Path d="M37 65 L32 74 M60 65 L65 74" stroke={gold} strokeWidth="4" strokeLinecap="round" />
        </>}
        {slug === "goods_transport" && <>
          <Rect x="12" y="45" width="64" height="24" rx="5" fill={blue} />
          <Path d="M76 52 H94 L106 64 V69 H76 Z" fill={ink} />
          <Rect x="82" y="54" width="12" height="9" rx="2" fill="#D9F0FA" />
          <Rect x="22" y="29" width="18" height="16" rx="2" fill={gold} /><Rect x="43" y="24" width="24" height="21" rx="2" fill="#D99A48" />
          <Circle cx="31" cy="71" r="7" fill={ink} /><Circle cx="88" cy="71" r="7" fill={ink} />
        </>}
        {slug === "furniture_moving" && <>
          <Rect x="22" y="39" width="72" height="30" rx="8" fill={blue} />
          <Rect x="28" y="30" width="60" height="18" rx="7" fill="#75A9CC" />
          <Path d="M29 67 V76 M86 67 V76" stroke={ink} strokeWidth="5" strokeLinecap="round" />
          <Path d="M13 33 L22 25 L31 33 M13 33 V57" stroke={gold} strokeWidth="4" fill="none" strokeLinecap="round" />
          <Circle cx="13" cy="61" r="5" fill={ink} />
        </>}
        {slug === "cargo_handling" && <>
          <Path d="M26 25 H83 L94 37 V70 H26 Z" fill={gold} />
          <Path d="M26 42 H94 M54 25 V70" stroke="#B87935" strokeWidth="3" />
          <Path d="M16 65 L28 54 L39 65" stroke={blue} strokeWidth="6" fill="none" strokeLinecap="round" />
          <Circle cx="19" cy="73" r="5" fill={ink} /><Circle cx="38" cy="73" r="5" fill={ink} />
        </>}
        {slug === "gardener" && <>
          <Path d="M60 72 V37" stroke={green} strokeWidth="5" strokeLinecap="round" />
          <Path d="M59 53 C29 56 27 33 43 29 C55 28 59 42 59 53Z" fill={green} />
          <Path d="M61 46 C63 20 91 20 91 37 C89 51 73 54 61 46Z" fill="#4B9876" />
          <Path d="M18 72 H103" stroke={gold} strokeWidth="5" strokeLinecap="round" />
          <Path d="M25 60 L42 47 M25 60 L18 48 M25 60 L37 64" stroke={ink} strokeWidth="4" strokeLinecap="round" />
        </>}
        {slug === "kia_driver" && <>
          <Path d="M14 58 L22 39 Q25 33 35 33 H82 Q91 33 97 45 L106 58 V68 H14Z" fill={blue} />
          <Path d="M32 38 H79 L89 53 H25Z" fill="#D9F0FA" />
          <Circle cx="33" cy="68" r="8" fill={ink} /><Circle cx="88" cy="68" r="8" fill={ink} />
          <Path d="M18 57 H28 M96 57 H104" stroke={gold} strokeWidth="4" strokeLinecap="round" />
        </>}
        {slug === "internet_install" && <>
          <Rect x="24" y="31" width="72" height="39" rx="8" fill={blue} />
          <Circle cx="43" cy="57" r="2.8" fill="#D9F0FA" /><Circle cx="54" cy="57" r="2.8" fill="#D9F0FA" /><Circle cx="65" cy="57" r="2.8" fill={gold} />
          <Path d="M60 27 V18 M40 22 Q60 4 80 22 M48 28 Q60 17 72 28" stroke={ink} strokeWidth="4" fill="none" strokeLinecap="round" />
          <Path d="M35 70 V78 M85 70 V78" stroke={ink} strokeWidth="3" />
        </>}
      </Svg>
    </View>
  );
}
