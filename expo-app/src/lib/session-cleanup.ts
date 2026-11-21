import { supabase } from "@/lib/supabase";
import { stopProviderPresenceBackgroundLocation } from "@/lib/background-location";

/**
 * Detaches realtime listeners before changing the active account role.
 * Screen-owned subscriptions are recreated by the newly mounted route.
 * Active-request trip tracking is intentionally preserved; it belongs to the
 * request lifecycle rather than the provider-presence role lifecycle.
 */
export async function cleanupSessionAndListeners(): Promise<void> {
  const channels = supabase.getChannels();
  const channelResults = await Promise.allSettled(
    channels.map((channel) => supabase.removeChannel(channel)),
  );
  const channelFailures = channelResults.filter((result) => result.status === "rejected");
  if (channelFailures.length) {
    console.warn("[session-cleanup] Some Realtime channels could not be removed:", channelFailures.length);
  }

  try {
    await stopProviderPresenceBackgroundLocation();
  } catch (error) {
    console.warn("[session-cleanup] Could not stop provider presence tracking:", error);
  }
}
