import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ReputationData {
  score: number;
  level: string;
  level_name: string;
  level_icon: string;
  level_color: string;
  avg_stars: number;
  professionalism_avg: number;
  punctuality_avg: number;
  quality_avg: number;
  ratings_count: number;
  completed_jobs: number;
  badges: Array<{
    code: string;
    name_ar: string;
    icon: string;
    color: string;
  }>;
}

export const getReputation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const obj = d as { userId: string };
    if (!obj?.userId || typeof obj.userId !== "string") {
      throw new Error("userId is required");
    }
    return obj;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rep, error } = await (
      supabaseAdmin as unknown as {
        rpc: (
          name: string,
          args: Record<string, string>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc("get_provider_reputation", { p_user_id: data.userId });
    if (error || !rep) {
      return {
        score: 0,
        level: "bronze",
        level_name: "برونزي",
        level_icon: "🥉",
        level_color: "#CD7F32",
        avg_stars: 5,
        professionalism_avg: 5,
        punctuality_avg: 5,
        quality_avg: 5,
        ratings_count: 0,
        completed_jobs: 0,
        badges: [],
      } satisfies ReputationData;
    }
    return rep as ReputationData;
  });

export const getProviderReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => {
    const obj = d as { userId: string };
    if (!obj?.userId || typeof obj.userId !== "string") {
      throw new Error("userId is required");
    }
    return obj;
  })
  .handler(async ({ data, context }) => {
    const { data: ratings, error } = await context.supabase
      .from("ratings")
      .select("id, stars, professionalism, punctuality, quality, comment, created_at, rater_id")
      .eq("ratee_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !ratings?.length) return [];

    const raterIds = [...new Set(ratings.map((rating) => rating.rater_id))];
    const { data: profiles } = await context.supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", raterIds);
    const profilesById = new Map(profiles?.map((profile) => [profile.id, profile]) ?? []);

    return ratings.map((rating) => ({
      ...rating,
      rater: profilesById.get(rating.rater_id) ?? null,
    }));
  });
