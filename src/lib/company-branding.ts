import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CompanyBranding = {
  companyName: string;
  logoUrl: string;
  welcomeMessage: string;
  welcomeVisualUrl: string;
  welcomeVisualAnimated: boolean;
  isLoaded: boolean;
};

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "ممنون",
  logoUrl: "",
  welcomeMessage: "مشوارك وخدمات بيتك، بمكان واحد.",
  welcomeVisualUrl: "",
  welcomeVisualAnimated: false,
  isLoaded: false,
};

export function useCompanyBranding() {
  const [branding, setBranding] = useState<CompanyBranding>(DEFAULT_BRANDING);
  useEffect(() => {
    let active = true;
    const apply = (data: any) => {
      if (!active) return;
      if (!data) { setBranding((current) => ({ ...current, isLoaded: true })); return; }
      setBranding({
        companyName: data.company_name || DEFAULT_BRANDING.companyName,
        logoUrl: data.company_logo_url || DEFAULT_BRANDING.logoUrl,
        welcomeMessage: data.welcome_message || DEFAULT_BRANDING.welcomeMessage,
        welcomeVisualUrl: data.company_welcome_visual_url || DEFAULT_BRANDING.welcomeVisualUrl,
        welcomeVisualAnimated: data.company_welcome_visual_animated === true,
        isLoaded: true,
      });
    };
    void (supabase as any).from("company_settings")
      .select("company_name,company_logo_url,welcome_message,company_welcome_visual_url,company_welcome_visual_animated")
      .eq("id", 1).maybeSingle()
      .then(({ data, error }: any) => { if (error) { if (active) setBranding((current) => ({ ...current, isLoaded: true })); } else apply(data); })
      .catch((error: unknown) => { console.warn("[company-branding] load failed", error); if (active) setBranding((current) => ({ ...current, isLoaded: true })); });
    const channel = supabase.channel("company-branding-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "company_settings", filter: "id=eq.1" }, (payload: any) => {
        if (payload.eventType === "DELETE") setBranding({ ...DEFAULT_BRANDING, isLoaded: true });
        else apply(payload.new);
      }).subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, []);
  return branding;
}
