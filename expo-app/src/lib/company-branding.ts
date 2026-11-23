import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type CompanyBranding = {
  companyName: string;
  logoUrl: string | null;
  welcomeMessage: string;
  welcomeVisualUrl: string | null;
  welcomeVisualAnimated: boolean;
  isLoaded: boolean;
};

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "ممنون",
  logoUrl: null,
  welcomeMessage: "مشوارك وخدمات بيتك، بمكان واحد.",
  welcomeVisualUrl: null,
  welcomeVisualAnimated: false,
  isLoaded: false,
};

export function useCompanyBranding() {
  const [branding, setBranding] = useState<CompanyBranding>(DEFAULT_BRANDING);
  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      if (active) console.warn("[company-branding] Load timed out; keeping default branding.");
    }, 6000);
    void (supabase as any)
      .from("company_settings")
      .select("company_name,company_logo_url,welcome_message,company_welcome_visual_url,company_welcome_visual_animated")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data, error }: any) => { if (error) { if (active) setBranding((current) => ({ ...current, isLoaded: true })); } else apply(data); })
      .catch((error: unknown) => { console.warn("[company-branding] load failed", error); if (active) setBranding((current) => ({ ...current, isLoaded: true })); });
    const channel = supabase.channel("company-branding-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "company_settings", filter: "id=eq.1" }, (payload: any) => {
        if (payload.eventType === "DELETE") setBranding({ ...DEFAULT_BRANDING, isLoaded: true });
        else apply(payload.new);
      }).subscribe();
    return () => { active = false; clearTimeout(timeout); };
  }, []);
  return branding;
}
