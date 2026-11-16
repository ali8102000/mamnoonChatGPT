#!/usr/bin/env python3
from pathlib import Path
from zipfile import ZipFile
import shutil

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "mamnoon-25-service-photos.zip"
SLUGS = [
  "build",
  "plaster",
  "carpentry_form",
  "flooring",
  "chef",
  "plumbing",
  "electric_setup",
  "electric_street",
  "washer_repair",
  "stove_repair",
  "fridge_repair",
  "ac_repair",
  "cleaning",
  "wood_carpentry",
  "blacksmith",
  "goods_transport",
  "furniture_moving",
  "cargo_handling",
  "gardener",
  "internet_install",
  "phone_repair",
  "electronics_repair",
  "computer_repair",
  "security_cameras",
  "general"
]

if not ARCHIVE.is_file():
    raise SystemExit(f"Missing archive: {ARCHIVE}")

with ZipFile(ARCHIVE) as archive:
    names = set(archive.namelist())
    missing = [f"{slug}.jpg" for slug in SLUGS if f"{slug}.jpg" not in names]
    if missing:
        raise SystemExit("Missing expected images: " + ", ".join(missing))
    web_dir = ROOT / "src" / "assets"
    native_dir = ROOT / "expo-app" / "assets" / "services"
    web_dir.mkdir(parents=True, exist_ok=True)
    native_dir.mkdir(parents=True, exist_ok=True)
    for slug in SLUGS:
        source = archive.open(f"{slug}.jpg")
        web_path = web_dir / f"service-{slug}.jpg"
        native_path = native_dir / f"{slug}.jpg"
        with source, web_path.open("wb") as target:
            shutil.copyfileobj(source, target)
        shutil.copy2(web_path, native_path)

(ROOT / "src" / "lib" / "service-visuals.ts").write_text("import build from \"@/assets/service-build.jpg\";\nimport plaster from \"@/assets/service-plaster.jpg\";\nimport carpentryForm from \"@/assets/service-carpentry_form.jpg\";\nimport flooring from \"@/assets/service-flooring.jpg\";\nimport chef from \"@/assets/service-chef.jpg\";\nimport plumbing from \"@/assets/service-plumbing.jpg\";\nimport electricSetup from \"@/assets/service-electric_setup.jpg\";\nimport electricStreet from \"@/assets/service-electric_street.jpg\";\nimport washer from \"@/assets/service-washer_repair.jpg\";\nimport stove from \"@/assets/service-stove_repair.jpg\";\nimport fridge from \"@/assets/service-fridge_repair.jpg\";\nimport ac_repair from \"@/assets/service-ac_repair.jpg\";\nimport cleaning from \"@/assets/service-cleaning.jpg\";\nimport wood from \"@/assets/service-wood_carpentry.jpg\";\nimport blacksmith from \"@/assets/service-blacksmith.jpg\";\nimport goods from \"@/assets/service-goods_transport.jpg\";\nimport furniture from \"@/assets/service-furniture_moving.jpg\";\nimport cargo from \"@/assets/service-cargo_handling.jpg\";\nimport gardener from \"@/assets/service-gardener.jpg\";\nimport internet from \"@/assets/service-internet_install.jpg\";\nimport phoneRepair from \"@/assets/service-phone_repair.jpg\";\nimport electronicsRepair from \"@/assets/service-electronics_repair.jpg\";\nimport computerRepair from \"@/assets/service-computer_repair.jpg\";\nimport securityCameras from \"@/assets/service-security_cameras.jpg\";\nimport general from \"@/assets/service-general.jpg\";\nimport kiaDriver from \"@/assets/service-kia-driver.png\";\nimport fallback from \"@/assets/service-fallback.png\";\n\nconst serviceIcons: Record<string, string> = {\n  build: build,\n  plaster: plaster,\n  carpentry_form: carpentryForm,\n  flooring: flooring,\n  chef: chef,\n  plumbing: plumbing,\n  electric_setup: electricSetup,\n  electric_street: electricStreet,\n  washer_repair: washer,\n  stove_repair: stove,\n  fridge_repair: fridge,\n  ac_repair: ac_repair,\n  cleaning: cleaning,\n  wood_carpentry: wood,\n  blacksmith: blacksmith,\n  goods_transport: goods,\n  furniture_moving: furniture,\n  cargo_handling: cargo,\n  gardener: gardener,\n  internet_install: internet,\n  phone_repair: phoneRepair,\n  electronics_repair: electronicsRepair,\n  computer_repair: computerRepair,\n  security_cameras: securityCameras,\n  general: general,\n  kia_driver: kiaDriver,\n};\n\nexport function serviceIcon(slug: string): string {\n  return serviceIcons[slug] ?? fallback;\n}\n", encoding="utf-8")
(ROOT / "expo-app" / "src" / "lib" / "service-visuals.ts").write_text("/* eslint-disable @typescript-eslint/no-require-imports -- React Native requires static asset require() calls. */\nimport type { ImageSourcePropType } from \"react-native\";\n\n// Local bundled JPG assets keep the web/native service catalog visually aligned\n// and make the service artwork available offline.\nconst images: Record<string, ImageSourcePropType> = {\n  build: require(\"../../assets/services/build.jpg\"),\n  plaster: require(\"../../assets/services/plaster.jpg\"),\n  carpentry_form: require(\"../../assets/services/carpentry_form.jpg\"),\n  flooring: require(\"../../assets/services/flooring.jpg\"),\n  chef: require(\"../../assets/services/chef.jpg\"),\n  plumbing: require(\"../../assets/services/plumbing.jpg\"),\n  electric_setup: require(\"../../assets/services/electric_setup.jpg\"),\n  electric_street: require(\"../../assets/services/electric_street.jpg\"),\n  washer_repair: require(\"../../assets/services/washer_repair.jpg\"),\n  stove_repair: require(\"../../assets/services/stove_repair.jpg\"),\n  fridge_repair: require(\"../../assets/services/fridge_repair.jpg\"),\n  ac_repair: require(\"../../assets/services/ac_repair.jpg\"),\n  cleaning: require(\"../../assets/services/cleaning.jpg\"),\n  wood_carpentry: require(\"../../assets/services/wood_carpentry.jpg\"),\n  blacksmith: require(\"../../assets/services/blacksmith.jpg\"),\n  goods_transport: require(\"../../assets/services/goods_transport.jpg\"),\n  furniture_moving: require(\"../../assets/services/furniture_moving.jpg\"),\n  cargo_handling: require(\"../../assets/services/cargo_handling.jpg\"),\n  gardener: require(\"../../assets/services/gardener.jpg\"),\n  internet_install: require(\"../../assets/services/internet_install.jpg\"),\n  phone_repair: require(\"../../assets/services/phone_repair.jpg\"),\n  electronics_repair: require(\"../../assets/services/electronics_repair.jpg\"),\n  computer_repair: require(\"../../assets/services/computer_repair.jpg\"),\n  security_cameras: require(\"../../assets/services/security_cameras.jpg\"),\n  general: require(\"../../assets/services/general.jpg\"),\n  // No dedicated Kia-driver photo is included in this 25-image package.\n  kia_driver: { uri: \"https://raw.githubusercontent.com/ali8102000/mamnoonChatGPT/main/src/assets/service-kia-driver.png\" },\n};\n\nexport function getServiceImage(slug: string): ImageSourcePropType {\n  return images[slug] ?? images.general;\n}\n", encoding="utf-8")

print(f"Imported {len(SLUGS)} service photos into web and Android assets.")
