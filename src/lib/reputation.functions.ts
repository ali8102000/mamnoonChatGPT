import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

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
  badges: Array<{ code: string; name_ar: string; icon: string; color: string }>;
}

const emptyReputation: ReputationData = {
  score: 0,
  level: "unranked",
  level_name: "قيد التقييم",
  level_icon: "🥉",
  level_color: "#CD7F32",
  avg_stars: 0,
  professionalism_avg: 0,
  punctuality_avg: 0,
  quality_avg: 0,
  ratings_count: 0,
  completed_jobs: 0,
  badges: [],
};

const userIdSchema = z.object({ userId: z.string().uuid() });

export const getReputation = async ({ data }: { data: { userId: string } }): Promise<ReputationData> => {
  const input = userIdSchema.parse(data);
  const { data: result, error } = await supabase.rpc("get_provider_reputation", {
    p_user_id: input.userId,
  });
  if (error || !result) return emptyReputation;
  return result as unknown as ReputationData;
};

export const getProviderReviews = async ({ data }: { data: { userId: string } }) => {
  const input = userIdSchema.parse(data);
  const { data: result, error } = await supabase.functions.invoke("reputation-proxy", {
    body: { action: "reviews", user_id: input.userId },
  });
  if (error || result?.error) return [];
  return result?.reviews ?? [];
};
