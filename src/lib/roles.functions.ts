import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export const grantProviderRole = async ({ data }: { data: { role: "driver" | "large_driver" | "worker" } }) => {
  const input = z.object({ role: z.enum(["driver", "large_driver", "worker"]) }).parse(data);
  const { error } = await supabase.rpc("grant_provider_role_safe", { _role: input.role });
  if (error) {
    console.error("[grantProviderRole]", error.message);
    if (/large_driver_profile_required/.test(error.message)) throw new Error("أكمل بيانات السيارة الكبيرة أولاً");
    if (/driver_profile_required/.test(error.message)) throw new Error("أكمل بيانات السيارة أولاً");
    if (/worker_profile_required/.test(error.message)) throw new Error("أكمل بيانات الفني أولاً");
    throw new Error("تعذّر تفعيل الدور، حاول مرة أخرى");
  }
  return { ok: true };
};
