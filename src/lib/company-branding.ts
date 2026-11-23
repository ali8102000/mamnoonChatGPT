import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CompanyBranding = {
  companyName: string;
  logoUrl: string;
  welcomeMessage: string;
  welcomeVisualUrl: string;
  welcomeVisualAnimated: boolean;
};

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "ممنون",
  logoUrl: "",
  welcomeMessage: "مشوارك وخدمات بيتك، بمكان واحد.",
  welcomeVisualUrl: "",
  welcomeVisualAnimated: false,
};

export function useCompanyBranding() {
  const [branding, setBranding] = useState<CompanyBranding>(DEFAULT_BRANDING);
  useEffect(() => {
    let active = true;
    void (supabase as any).from("company_settings")
      .select("company_name,company_logo_url,welcome_message,company_welcome_visual_url,company_welcome_visual_animated")
      .eq("id", 1).maybeSingle()
      .then(({ data, error }: any) => {
        if (!active || error || !data) return;
        setBranding({
          companyName: data.company_name || DEFAULT_BRANDING.companyName,
          logoUrl: data.company_logo_url || "",
          welcomeMessage: data.welcome_message || DEFAULT_BRANDING.welcomeMessage,
          welcomeVisualUrl: data.company_welcome_visual_url || "",
          welcomeVisualAnimated: data.company_welcome_visual_animated === true,
        });
      })
      .catch((error: unknown) => console.warn("[company-branding] load failed", error));
    return () => { active = false; };
  }, []);
  return branding;
}
