import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const repoRoot = resolve(projectRoot, "..");
const manifest = JSON.parse(readFileSync(resolve(projectRoot, "parity/screen-parity-manifest.json"), "utf8"));
const failures = [];
const checks = [];
const read = (path) => readFileSync(resolve(projectRoot, path), "utf8");
const readWeb = (path) => readFileSync(resolve(repoRoot, path), "utf8");
const existsNative = (path) => existsSync(resolve(projectRoot, path));
const existsWeb = (path) => existsSync(resolve(repoRoot, path));
const check = (name, pass, detail = "") => {
  checks.push({ name, pass: !!pass, detail });
  if (!pass) failures.push({ name, detail });
};

for (const screen of manifest.screenPairs) {
  check("native screen: " + screen.id, existsNative(screen.native), screen.native);
  check("web screen: " + screen.id, existsWeb(screen.web), screen.web);
}
for (const section of manifest.adminSections) {
  for (const path of section.native) check("native admin " + section.key, existsNative(path), path);
  for (const path of section.web) check("web admin " + section.key, existsWeb(path), path);
}

const webAdmin = readWeb("src/routes/admin.tsx");
const nativeAdmin = read("app/admin.tsx");
const nativeStaffHub = read("app/admin/staff.tsx");
for (const section of manifest.adminSections) {
  check("web admin section key: " + section.key, webAdmin.includes('key: "' + section.key + '"'), section.label);
}
for (const route of [
  "/admin/monitoring", "/admin/live-map", "/admin/subscriptions", "/admin/users",
  "/admin/providers", "/admin/requests", "/admin/finance", "/admin/governance",
  "/admin/staff", "/admin/staff-hierarchy", "/admin/friends", "/admin/notifications",
  "/admin/regions", "/admin/import", "/admin/chats", "/support-chat"
]) {
  const found = nativeAdmin.includes('router.push("' + route + '"') ||
    nativeStaffHub.includes('route: "' + route + '"');
  check("native admin navigation: " + route, found, "Dashboard or staff hub must expose the destination");
}

const webSupport = readWeb("src/routes/support-chat.tsx");
const nativeSupport = read("app/support-chat.tsx");
check("web general-manager support reply access", webSupport.includes('assignment?.rank === "general_manager"') &&
  webSupport.includes('from("support_messages").insert') && !webSupport.includes("complaintsReadOnly"));
check("Android general-manager support reply access", nativeSupport.includes('assignment?.rank === "general_manager"') &&
  nativeSupport.includes('from("support_messages").insert') && !nativeSupport.includes("complaintsReadOnly"));
const webRegions = readWeb("src/components/admin-regional-controls.tsx");
const nativeRegions = read("app/admin/regions.tsx");
const webRegionsNav = webAdmin.slice(webAdmin.indexOf('key: "regions"'), webAdmin.indexOf('key: "roles"'));
check("web regional controls super-admin gate", webRegionsNav.includes("super_admin") && !webRegionsNav.includes("rank:general_manager"));
check("Android regional controls super-admin gate", nativeRegions.includes("is_super_admin") || nativeRegions.includes("super_admin"));

const css = readWeb("src/styles.css");
const nativeTheme = read("src/styles/theme.ts");
const nativeLayout = read("app/_layout.tsx");
const nativeButton = read("src/components/ui.tsx");
function cssBlock(selector) {
  const pattern = selector === ":root" ? /:root\s*\{([\s\S]*?)\n\}/m : /\.dark\s*\{([\s\S]*?)\n\}/m;
  const match = css.match(pattern);
  if (!match) throw new Error("Missing CSS theme block: " + selector);
  return match[1];
}
function cssVar(block, name) {
  const match = block.match(new RegExp("--" + name + "\\s*:\\s*([^;]+);"));
  if (!match) throw new Error("Missing CSS variable: " + name);
  return match[1].trim();
}
function oklchToHex(value) {
  const match = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (!match) {
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    return hex ? "#" + hex[1].toUpperCase() : null;
  }
  const [L, C, H] = match.slice(1).map(Number);
  const h = H * Math.PI / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const lp = L + 0.3963377774 * a + 0.2158037573 * b;
  const mp = L - 0.1055613458 * a - 0.0638541728 * b;
  const sp = L - 0.0894841775 * a - 1.291485548 * b;
  const l = lp ** 3, m = mp ** 3, s = sp ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
  const gamma = (x) => {
    x = Math.max(0, Math.min(1, x));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  };
  return "#" + linear.map((x) => Math.round(gamma(x) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function paletteObject(name) {
  const match = nativeTheme.match(new RegExp("const " + name + " = \\{([\\s\\S]*?)\\} as const;"));
  if (!match) throw new Error("Missing native palette " + name);
  return Object.fromEntries([...match[1].matchAll(/([A-Za-z][A-Za-z0-9]*):\s*"(#[0-9A-Fa-f]{6})"/g)]
    .map((entry) => [entry[1], entry[2].toUpperCase()]));
}
const colorMap = {
  ink: "foreground", muted: "muted-foreground", canvasSolid: "background",
  surface: "surface", surfaceSoft: "surface-2", brand: "primary",
  brandGlow: "primary-glow", gold: "accent", success: "success", danger: "destructive"
};
for (const [selector, paletteName] of [[":root", "lightPalette"], [".dark", "darkPalette"]]) {
  const block = cssBlock(selector);
  const palette = paletteObject(paletteName);
  for (const [nativeKey, webKey] of Object.entries(colorMap)) {
    const expected = oklchToHex(cssVar(block, webKey));
    check(selector + " color " + nativeKey + " ↔ --" + webKey,
      !!expected && palette[nativeKey] === expected,
      "Android=" + palette[nativeKey] + " Web=" + expected);
  }
}
check("Android page canvas is transparent over shared gradient", nativeTheme.includes('pageCanvas:"transparent"') && nativeTheme.includes('canvas:"#F3F7FC"') && nativeLayout.includes("ApplicationBackdrop") && nativeLayout.includes("contentStyle: { backgroundColor: \"transparent\" }"));
check("Web radial background gradient", css.includes("radial-gradient") && css.includes("--primary-glow"));

const webButton = readWeb("src/components/ui/button.tsx");
for (const variant of ["default", "destructive", "outline", "secondary", "ghost", "link"]) {
  check("Web button variant " + variant, webButton.includes(variant + ":"));
}
for (const variant of ["primary", "danger", "secondary", "outline", "ghost", "link"]) {
  check("Android button variant " + variant, nativeButton.includes('"' + variant + '"'));
}
for (const [label, token] of [["default 40dp", "minHeight: 40"], ["small 36dp", "minHeight: 36"], ["large 45dp", "minHeight: 45"], ["icon 40dp", "width: 40"]]) {
  check("Android button size " + label, nativeButton.includes(token));
}
check("Android button web-matched typography", nativeButton.includes("fontSize: 15.75") && nativeButton.includes("lineHeight: 20"));
check("Android button web-matched radius", nativeButton.includes("borderRadius: 16"));
check("Android button pressed and disabled states", nativeButton.includes("pressed ? 0.86 : 1") && nativeButton.includes("disabled || loading ? 0.5"));

check("Web Tajawal font token", css.includes('--font-sans: "Tajawal"'));
check("Web 112.5% root type scale", /html\s*\{[^}]*font-size:\s*112\.5%/s.test(css));
for (const weight of ["Tajawal_400Regular","Tajawal_500Medium","Tajawal_700Bold","Tajawal_800ExtraBold","Tajawal_900Black"]) {
  check("Android Tajawal font " + weight, nativeLayout.includes(weight), "Font weight must be loaded");
}
check("Android TextInput font inheritance", nativeLayout.includes("TextInput") &&
  nativeLayout.includes('fontFamily: "Tajawal_400Regular"'));
for (const token of ["hero:32","title:25","heading:18","body:15","caption:12","micro:10"]) {
  check("Android typography token " + token, nativeTheme.includes(token));
}
for (const token of ["--gradient-primary","--gradient-friends","--shadow-glow","--shadow-elegant","--shadow-card"]) {
  check("Web visual token " + token, css.includes(token));
}
for (const token of ["space =","radius =","type ="]) check("Android design token group " + token, nativeTheme.includes(token));

const ids = [...manifest.screenPairs, ...manifest.adminSections].map((item) => item.id);
check("unique screenshot ids", new Set(ids).size === ids.length, "Screen IDs are screenshot filenames");
const result = {
  version: manifest.version,
  totalChecks: checks.length,
  passed: checks.filter((item) => item.pass).length,
  failed: failures.length,
  screenPairs: manifest.screenPairs.length,
  adminSections: manifest.adminSections.length,
  status: failures.length ? "FAIL" : "PASS",
  checks,
  failures
};
const reportPath = process.env.PARITY_REPORT_PATH;
if (reportPath) writeFileSync(resolve(projectRoot, reportPath), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
