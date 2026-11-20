import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type CompanyBranding = {
  companyName: string;
  logoUrl: string | null;
  welcomeMessage: string;
};

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "ممنون",
  logoUrl: null,
  welcomeMessage: "مشوارك وخدمات بيتك، بمكان واحد.",
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
      .select("company_name,company_logo_url,welcome_message")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data, error }: any) => {
        if (!active || error || !data) return;
        setBranding({
          companyName: data.company_name || DEFAULT_BRANDING.companyName,
          logoUrl: data.company_logo_url || null,
          welcomeMessage: data.welcome_message || DEFAULT_BRANDING.welcomeMessage,
        });
      })
      .catch((error: unknown) => console.warn("[company-branding] load failed; keeping defaults", error))
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); };
  }, []);
  return branding;
}
