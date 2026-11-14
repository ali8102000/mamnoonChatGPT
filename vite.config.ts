// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";
import publicBackend from "./config/public-backend.json";

// The committed public backend config is the single source of truth for both
// preview and published builds. A stale Lovable VITE_* value must never silently
// override the verified Supabase project and ship a production bundle with a
// different/invalid API key. Update config/public-backend.json when rotating keys.
const env = loadEnv(process.env.NODE_ENV === "development" ? "development" : "production", process.cwd(), "VITE_");
const publicSupabaseUrl = publicBackend.VITE_SUPABASE_URL;
const publicSupabaseKey = publicBackend.VITE_SUPABASE_PUBLISHABLE_KEY;

if (
  (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_URL !== publicSupabaseUrl) ||
  (env.VITE_SUPABASE_PUBLISHABLE_KEY && env.VITE_SUPABASE_PUBLISHABLE_KEY !== publicSupabaseKey)
) {
  console.warn(
    "[Mamnoon] Ignoring mismatched VITE_SUPABASE_* build environment values; using config/public-backend.json to keep preview and published builds on the same verified backend.",
  );
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(publicSupabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(publicSupabaseKey),
    },
  },
});
