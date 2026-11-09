import { afterEach, expect, test, vi } from "vitest";
import publicBackend from "../../config/public-backend.json";

vi.mock("@/integrations/supabase/previewAuthStorage", () => ({
  brokeredPreviewStorage: () => undefined,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("public deployment fallback initializes authentication without server environment variables", async () => {
  vi.stubEnv("VITE_SUPABASE_URL", publicBackend.VITE_SUPABASE_URL);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", publicBackend.VITE_SUPABASE_PUBLISHABLE_KEY);
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
  expect(publicBackend.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_")).toBe(true);
  const { supabase } = await import("@/integrations/supabase/client");
  const result = await supabase.auth.getSession();
  expect(result.error).toBeNull();
  expect(result.data.session).toBeNull();
});