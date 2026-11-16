import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";

const manifest = JSON.parse(await import("node:fs/promises").then(({ readFile }) =>
  readFile(resolve("parity/screen-parity-manifest.json"), "utf8")));
const captures = [...manifest.screenPairs, ...manifest.adminSections].flatMap((screen) =>
  (screen.contexts ?? ["customer"]).flatMap((context) =>
    manifest.capture.theme.map((theme) => screen.id + "__" + context + "__" + theme + ".png")));

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}
function png(pixel) {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  const row = Buffer.from([0, ...pixel, ...pixel]);
  const raw = Buffer.concat([row, row]);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const root = mkdtempSync(join(tmpdir(), "mamnoon-parity-smoke-"));
const web = join(root, "web"), android = join(root, "android");
mkdirSync(web); mkdirSync(android);
const basePixel = [40, 90, 160, 255];
const expected = png(basePixel);
for (const name of captures) {
  writeFileSync(join(web, name), expected);
  writeFileSync(join(android, name), expected);
}
const script = resolve("scripts/compare-screen-captures.mjs");
const run = () => execFileSync(process.execPath, [script, "--web-dir", web, "--android-dir", android], { encoding: "utf8", stdio: "pipe" });
try {
  const passOutput = run();
  if (!passOutput.includes('"status": "PASS"')) throw new Error("Identical screenshots did not pass.");
  const first = captures[0];
  writeFileSync(join(android, first), png([255, 0, 0, 255]));
  let rejected = false;
  try { run(); } catch (error) { rejected = error.status === 1; }
  if (!rejected) throw new Error("A deliberate screenshot mismatch was not rejected.");
  console.log("Screenshot comparator smoke test passed: " + captures.length + " role/theme captures accepted; deliberate pixel mismatch rejected.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
