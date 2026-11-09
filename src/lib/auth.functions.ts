import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const loginWithIdentifier = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({
      identifier: z.string().trim().min(3).max(255),
      password: z.string().min(6).max(128),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const id = data.identifier.trim();
    let email = id.toLowerCase();

    if (!id.includes("@")) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: foundEmail, error: lookupError } = await supabaseAdmin.rpc(
        "lookup_email_by_phone",
        { _phone: id },
      );
      if (lookupError) throw new Error("تعذر التحقق من بيانات الدخول");
      const digits = id.replace(/[^\\d]/g, "");
      email = foundEmail ? String(foundEmail).toLowerCase() : `phone${digits}@mamnoon.app`;
    }

    const supabaseUrl = process.env["SUPABASE_URL"] || import.meta.env["VITE_SUPABASE_URL"];
    const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"] || import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
    if (!supabaseUrl || !publishableKey) {
      throw new Error("إعدادات تسجيل الدخول غير مكتملة على الخادم");
    }

    const authFetch: typeof fetch = (input, init) => {
      const headers = new Headers(
        typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
      );
      if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      if (
        (publishableKey.startsWith("sb_publishable_") || publishableKey.startsWith("sb_secret_")) &&
        headers.get("Authorization") === `Bearer ${publishableKey}`
      ) headers.delete("Authorization");
      headers.set("apikey", publishableKey);
      return fetch(input, { ...init, headers });
    };

    const authClient = createClient(supabaseUrl, publishableKey, {
      global: { fetch: authFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error } = await authClient.auth.signInWithPassword({
      email,
      password: data.password,
    });
    if (error || !authData.session) throw new Error("بيانات الدخول غير صحيحة");
    return { session: authData.session };
  });

export const sendPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        identifier: z.string().trim().min(3).max(255),
        redirectTo: z.string().url().max(500),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const id = data.identifier.trim();
    const isEmail = id.includes("@");

    let email: string | null = null;
    if (isEmail) {
      email = id.toLowerCase();
    } else {
      const { data: emailResult } = await supabaseAdmin.rpc("lookup_email_by_phone", {
        _phone: id,
      });
      email = emailResult ? String(emailResult) : null;
    }

    if (!email) {
      return { ok: true };
    }

    try {
      const redirectUrl = new URL(data.redirectTo);
      const configuredOrigins = (process.env.ALLOWED_REDIRECT_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const appUrl = process.env.APP_URL || import.meta.env["VITE_APP_URL"];
      const fallbackOrigin = appUrl ? new URL(appUrl).origin : null;
      const allowedOrigins = configuredOrigins.length
        ? configuredOrigins
        : fallbackOrigin
          ? [fallbackOrigin]
          : [];
      if (!allowedOrigins.includes(redirectUrl.origin)) return { ok: true };
    } catch {
      return { ok: true };
    }

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: data.redirectTo,
    });
    if (error) console.error("[sendPasswordReset]", error.message);
    return { ok: true };
  });
