import { supabase } from "@/integrations/supabase/client";

type MapLookupInput =
  | { action: "autocomplete"; input: string; sessionToken: string; center: { lat: number; lng: number }; governorateKey?: string }
  | { action: "details"; placeId: string; sessionToken: string }
  | { action: "reverse"; center: { lat: number; lng: number } }
  | { action: "route"; from: { lat: number; lng: number }; to: { lat: number; lng: number } }
  | { action: "validateGovernorate"; center: { lat: number; lng: number }; governorateKey: string }
  | { action: "detectGovernorate"; center: { lat: number; lng: number } };

export async function lookupMapPlace({ data }: { data: MapLookupInput }) {
  const { data: result, error } = await supabase.functions.invoke("maps-proxy", { body: data });
  if (error) {
    const message = typeof (result as any)?.error === "string"
      ? (result as any).error
      : error.message || "تعذّر الاتصال بخدمة الخرائط.";
    throw new Error(message);
  }
  if (result && typeof result === "object" && typeof (result as any).error === "string") {
    throw new Error((result as any).error);
  }
  return result;
}
