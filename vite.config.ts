import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import viteReact from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";
import publicBackend from "./config/public-backend.json";

// The committed public backend config is the single source of truth for both
// preview and published builds. A stale environment value must never silently
// override the verified Supabase project and ship a production bundle with a
// different or invalid public key. Update config/public-backend.json when
// rotating the public key.
const env = loadEnv(
  process.env.NODE_ENV === "development" ? "development" : "production",
  process.cwd(),
  "VITE_",
);
const publicSupabaseUrl = publicBackend.VITE_SUPABASE_URL;
const publicSupabaseKey = publicBackend.VITE_SUPABASE_PUBLISHABLE_KEY;

if (
  (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_URL !== publicSupabaseUrl) ||
  (env.VITE_SUPABASE_PUBLISHABLE_KEY &&
    env.VITE_SUPABASE_PUBLISHABLE_KEY !== publicSupabaseKey)
) {
  console.warn(
    "[Mamnoon] Ignoring mismatched VITE_SUPABASE_* build environment values; using config/public-backend.json to keep preview and published builds on the same verified backend.",
  );
}

export default defineConfig({
  plugins: [
    tanstackStart({
      // Keep the existing SSR error wrapper in src/server.ts.
      server: { entry: "server" },
    }),
    nitro(),
    viteReact(),
    tailwindcss(),
    tsConfigPaths(),
  ],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(publicSupabaseUrl),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(publicSupabaseKey),
  },
});
