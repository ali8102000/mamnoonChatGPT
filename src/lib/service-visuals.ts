import build from "@/assets/service-build.jpg";
import plaster from "@/assets/service-plaster.jpg";
import carpentryForm from "@/assets/service-carpentry_form.jpg";
import flooring from "@/assets/service-flooring.jpg";
import chef from "@/assets/service-chef.jpg";
import plumbing from "@/assets/service-plumbing.jpg";
import electricSetup from "@/assets/service-electric_setup.jpg";
import electricStreet from "@/assets/service-electric_street.jpg";
import washer from "@/assets/service-washer_repair.jpg";
import stove from "@/assets/service-stove_repair.jpg";
import fridge from "@/assets/service-fridge_repair.jpg";
import ac_repair from "@/assets/service-ac_repair.jpg";
import cleaning from "@/assets/service-cleaning.jpg";
import wood from "@/assets/service-wood_carpentry.jpg";
import blacksmith from "@/assets/service-blacksmith.jpg";
import goods from "@/assets/service-goods_transport.jpg";
import furniture from "@/assets/service-furniture_moving.jpg";
import cargo from "@/assets/service-cargo_handling.jpg";
import gardener from "@/assets/service-gardener.jpg";
import internet from "@/assets/service-internet_install.jpg";
import phoneRepair from "@/assets/service-phone_repair.jpg";
import electronicsRepair from "@/assets/service-electronics_repair.jpg";
import computerRepair from "@/assets/service-computer_repair.jpg";
import securityCameras from "@/assets/service-security_cameras.jpg";
import general from "@/assets/service-general.jpg";
import kiaDriver from "@/assets/service-kia-driver.png";
import fallback from "@/assets/service-fallback.png";

const serviceIcons: Record<string, string> = {
  build: build,
  plaster: plaster,
  carpentry_form: carpentryForm,
  flooring: flooring,
  chef: chef,
  plumbing: plumbing,
  electric_setup: electricSetup,
  electric_street: electricStreet,
  washer_repair: washer,
  stove_repair: stove,
  fridge_repair: fridge,
  ac_repair: ac_repair,
  cleaning: cleaning,
  wood_carpentry: wood,
  blacksmith: blacksmith,
  goods_transport: goods,
  furniture_moving: furniture,
  cargo_handling: cargo,
  gardener: gardener,
  internet_install: internet,
  phone_repair: phoneRepair,
  electronics_repair: electronicsRepair,
  computer_repair: computerRepair,
  security_cameras: securityCameras,
  general: general,
  kia_driver: kiaDriver,
};

export function serviceIcon(slug: string): string {
  return serviceIcons[slug] ?? fallback;
}
