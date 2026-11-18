import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export interface FriendStatus {
  friend_id: string;
  status: "available" | "on_job" | "inactive" | "not_provider" | "not_friend";
  full_name: string | null;
  avatar_url: string | null;
}

export const getFriendsStatuses = async (_input?: { data?: unknown }): Promise<FriendStatus[]> => {
  const { data, error } = await supabase.functions.invoke("friends-proxy", {
    body: { action: "statuses" },
  });
  if (error || data?.error) return [];
  return (data?.friends ?? []) as FriendStatus[];
};

export const searchProfileByPhone = async ({ data }: { data: { phone: string } }) => {
  const input = z.object({ phone: z.string().trim().min(1).max(50) }).parse(data);
  const { data: result, error } = await supabase.functions.invoke("friends-proxy", {
    body: { action: "search_by_phone", phone: input.phone },
  });
  if (error || result?.error) return [];
  return result?.profiles ?? [];
};
