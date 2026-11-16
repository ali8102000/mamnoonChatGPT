import fs from "node:fs";

const gradlePath = "android/app/build.gradle";
let gradle = fs.readFileSync(gradlePath, "utf8");

if (!gradle.includes("mamnoonAbiSplits")) {
  const marker = "android {";
  if (!gradle.includes(marker)) {
    throw new Error("Could not find android block in generated app/build.gradle");
  }
  const abiConfig = `android {
    // mamnoonAbiSplits: phone ARM64 plus emulator x86_64
    splits {
      abi {
        enable true
        reset()
        include "arm64-v8a", "x86_64"
        universalApk false
      }
    }
`;
  gradle = gradle.replace(marker, abiConfig);
  fs.writeFileSync(gradlePath, gradle);
}

console.log("Configured ABI splits: arm64-v8a and x86_64");
