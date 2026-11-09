// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";
import publicBackend from "./config/public-backend.json";

// Only public browser configuration belongs here; runtime secrets remain in Cloud.
const env = loadEnv(process.env.NODE_ENV === "development" ? "development" : "production", process.cwd(), "VITE_");

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      'import.meta.env["VITE_SUPABASE_URL"]': JSON.stringify(env.VITE_SUPABASE_URL || publicBackend.VITE_SUPABASE_URL),
      'import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]': JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY || publicBackend.VITE_SUPABASE_PUBLISHABLE_KEY),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL || publicBackend.VITE_SUPABASE_URL),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY || publicBackend.VITE_SUPABASE_PUBLISHABLE_KEY),
    },
  },
});
