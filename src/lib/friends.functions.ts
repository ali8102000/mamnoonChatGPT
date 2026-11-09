import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface FriendStatus {
  friend_id: string;
  status: "available" | "on_job" | "inactive" | "not_provider" | "not_friend";
  full_name: string | null;
  avatar_url: string | null;
}

export interface ProfileSearchResult {
  id: string;
  phone: string;
  full_name: string | null;
  avatar_url: string | null;
}

const friendStatusSchema = z.object({
  status: z.enum(["available", "on_job", "inactive", "not_provider", "not_friend"]).optional(),
  full_name: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
});
const profileSearchSchema = z.array(z.object({
  id: z.string().uuid(),
  phone: z.string(),
  full_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
}));

type FriendsAdminClient = {
  from: (table: "friends") => {
    select: (columns: "friend_id") => {
      eq: (column: "user_id", value: string) => Promise<{
        data: Array<{ friend_id: string }> | null;
        error: { message: string } | null;
      }>;
    };
  };
  rpc: (
    name: "get_friend_status" | "search_profile_by_phone",
    args: { p_friend_id: string } | { _phone: string },
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export const getFriendsStatuses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as FriendsAdminClient;

    const { data: friends, error: friendsError } = await admin
      .from("friends")
      .select("friend_id")
      .eq("user_id", userId);
    if (friendsError) throw new Error("فشل تحميل قائمة الأصدقاء");
    if (!friends?.length) return [];

    const results: FriendStatus[] = [];
    for (const friend of friends) {
      const { data, error } = await admin.rpc("get_friend_status", {
        p_friend_id: friend.friend_id,
      });
      const parsed = friendStatusSchema.safeParse(data);
      if (error || !parsed.success) {
        results.push({
          friend_id: friend.friend_id,
          status: "inactive",
          full_name: null,
          avatar_url: null,
        });
      } else {
        results.push({
          friend_id: friend.friend_id,
          status: parsed.data.status ?? "inactive",
          full_name: parsed.data.full_name ?? null,
          avatar_url: parsed.data.avatar_url ?? null,
        });
      }
    }
    return results;
  });

export const searchProfileByPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ phone: z.string().trim().min(1).max(50) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as FriendsAdminClient;
    const { data: rows, error } = await admin.rpc(
      "search_profile_by_phone",
      { _phone: data.phone },
    );
    if (error || !rows) return [];
    const parsed = profileSearchSchema.safeParse(rows);
    if (!parsed.success) return [];
    return parsed.data.filter((row) => row.id !== userId).slice(0, 10);
  });
