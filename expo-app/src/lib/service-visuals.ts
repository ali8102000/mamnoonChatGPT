/* eslint-disable @typescript-eslint/no-require-imports -- React Native requires static asset require() calls. */
import type { ImageSourcePropType } from "react-native";

// Local bundled JPG assets keep the web/native service catalog visually aligned
// and make the service artwork available offline.
const images: Record<string, ImageSourcePropType> = {
  build: require("../../assets/services/build.jpg"),
  plaster: require("../../assets/services/plaster.jpg"),
  carpentry_form: require("../../assets/services/carpentry_form.jpg"),
  flooring: require("../../assets/services/flooring.jpg"),
  chef: require("../../assets/services/chef.jpg"),
  plumbing: require("../../assets/services/plumbing.jpg"),
  electric_setup: require("../../assets/services/electric_setup.jpg"),
  electric_street: require("../../assets/services/electric_street.jpg"),
  washer_repair: require("../../assets/services/washer_repair.jpg"),
  stove_repair: require("../../assets/services/stove_repair.jpg"),
  fridge_repair: require("../../assets/services/fridge_repair.jpg"),
  ac_repair: require("../../assets/services/ac_repair.jpg"),
  cleaning: require("../../assets/services/cleaning.jpg"),
  wood_carpentry: require("../../assets/services/wood_carpentry.jpg"),
  blacksmith: require("../../assets/services/blacksmith.jpg"),
  goods_transport: require("../../assets/services/goods_transport.jpg"),
  furniture_moving: require("../../assets/services/furniture_moving.jpg"),
  cargo_handling: require("../../assets/services/cargo_handling.jpg"),
  gardener: require("../../assets/services/gardener.jpg"),
  internet_install: require("../../assets/services/internet_install.jpg"),
  phone_repair: require("../../assets/services/phone_repair.jpg"),
  electronics_repair: require("../../assets/services/electronics_repair.jpg"),
  computer_repair: require("../../assets/services/computer_repair.jpg"),
  security_cameras: require("../../assets/services/security_cameras.jpg"),
  general: require("../../assets/services/general.jpg"),
  // No dedicated Kia-driver photo is included in this 25-image package.
  kia_driver: { uri: "https://raw.githubusercontent.com/ali8102000/mamnoonChatGPT/main/src/assets/service-kia-driver.png" },
};

export function getServiceImage(slug: string): ImageSourcePropType {
  return images[slug] ?? images.general;
}
