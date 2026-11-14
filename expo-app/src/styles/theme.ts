import { Appearance } from "react-native";

const dark = Appearance.getColorScheme() === "dark";

const lightPalette = {
  ink: "#17251F",
  muted: "#718078",
  canvas: "#F5F6F2",
  surface: "#FFFFFF",
  surfaceSoft: "#EEF1EB",
  line: "#E2E7DF",
  brand: "#174C3C",
  brandDeep: "#10382D",
  brandSoft: "#E4EEE8",
  gold: "#C7A45A",
  goldSoft: "#F5EEDC",
  success: "#21845A",
  danger: "#B94B45",
  dangerSoft: "#F9E9E7",
  white: "#FFFFFF",
  shadow: "rgba(20, 42, 32, 0.08)",
} as const;

const darkPalette = {
  ink: "#F1F5F2",
  muted: "#A2B2A8",
  canvas: "#0B1410",
  surface: "#14221B",
  surfaceSoft: "#1B2D24",
  line: "#2B4034",
  brand: "#3B9B76",
  brandDeep: "#1E5B45",
  brandSoft: "#1D382B",
  gold: "#D6B45E",
  goldSoft: "#3A321F",
  success: "#4CC58A",
  danger: "#F07870",
  dangerSoft: "#3A211F",
  white: "#FFFFFF",
  shadow: "rgba(0, 0, 0, 0.38)",
} as const;

// Resolve the palette before screen StyleSheets are created. The app follows
// the device appearance on launch; native system bars use the live color scheme.
export const palette = (dark ? darkPalette : lightPalette);
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, huge: 36 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const;
export const type = {
  hero: 32,
  title: 25,
  heading: 18,
  body: 15,
  caption: 12,
  micro: 10,
} as const;
