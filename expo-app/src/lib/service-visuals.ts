import type { ImageSourcePropType } from "react-native";

// Keep service artwork keyed by the same stable slug stored in Supabase.
// New catalog entries safely use the general-service illustration until artwork is added.
const images: Record<string, ImageSourcePropType> = {
  ac_repair: require("../../assets/services/ac_repair.png"),
  blacksmith: require("../../assets/services/blacksmith.png"),
  build: require("../../assets/services/build.png"),
  carpentry_form: require("../../assets/services/carpentry_form.png"),
  chef: require("../../assets/services/chef.png"),
  cleaning: require("../../assets/services/cleaning.png"),
  electric_setup: require("../../assets/services/electric_setup.png"),
  electric_street: require("../../assets/services/electric_street.png"),
  flooring: require("../../assets/services/flooring.png"),
  fridge_repair: require("../../assets/services/fridge_repair.png"),
  general: require("../../assets/services/general.png"),
  plaster: require("../../assets/services/plaster.png"),
  plumbing: require("../../assets/services/plumbing.png"),
  stove_repair: require("../../assets/services/stove_repair.png"),
  washer_repair: require("../../assets/services/washer_repair.png"),
  wood_carpentry: require("../../assets/services/wood_carpentry.png"),
};

export function getServiceImage(slug: string): ImageSourcePropType {
  return images[slug] ?? images.general;
}
