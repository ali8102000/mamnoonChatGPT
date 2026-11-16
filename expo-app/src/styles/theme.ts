import { Appearance } from "react-native";
const lightPalette = {
  ink:"#08101A", muted:"#47515E", canvas:"#F3F7FC", surface:"#FCFEFF", surfaceSoft:"#E5ECF3",
  line:"#D9E1EA", brand:"#0065D2", brandDeep:"#004EA6", brandSoft:"#E7F0FC", gold:"#E9AB2B",
  goldSoft:"#FBF2DF", success:"#168653", danger:"#D83B2F", dangerSoft:"#FCEAE8", white:"#FFFFFF",
  shadow:"rgba(8, 16, 26, 0.08)",
} as const;
const darkPalette = {
  ink:"#F2F5F9", muted:"#B8BEC5", canvas:"#040A14", surface:"#0E1824", surfaceSoft:"#1D2734",
  line:"#2D3948", brand:"#5FA7FF", brandDeep:"#337FD6", brandSoft:"#142B45", gold:"#E9AB2B",
  goldSoft:"#3B2D17", success:"#54C78C", danger:"#FF786D", dangerSoft:"#3A211F", white:"#FFFFFF",
  shadow:"rgba(0, 0, 0, 0.38)",
} as const;
type Palette = typeof lightPalette;
export const palette: Palette = new Proxy({} as Palette, {
  get(_target, property: keyof Palette) {
    return (Appearance.getColorScheme() === "dark" ? darkPalette : lightPalette)[property];
  },
  ownKeys() { return Reflect.ownKeys(lightPalette); },
  getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
});
export const space = { xs:4, sm:8, md:12, lg:16, xl:20, xxl:28, huge:36 } as const;
export const radius = { sm:10, md:14, lg:20, xl:26, pill:999 } as const;
export const type = { hero:32, title:25, heading:18, body:15, caption:12, micro:10 } as const;
