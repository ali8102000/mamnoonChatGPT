import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type CompanyBranding = {
  companyName: string;
  logoUrl: string | null;
  welcomeMessage: string;
  welcomeMediaUrl: string | null;
  welcomeMediaAnimated: boolean;
  isLoaded: boolean;
};

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "ممنون",
  logoUrl: null,
  welcomeMessage: "مشوارك وخدمات بيتك، بمكان واحد.",
  welcomeMediaUrl: null,
  welcomeMediaAnimated: false,
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
        logoUrl: data.company_logo_url || null,
        welcomeMessage: data.welcome_message || DEFAULT_BRANDING.welcomeMessage,
        welcomeMediaUrl: data.company_welcome_visual_url || null,
        welcomeMediaAnimated: data.company_welcome_visual_animated === true,
        isLoaded: true,
      });
    };
    const timeout = setTimeout(() => {
      if (active) console.warn("[company-branding] Load timed out; keeping default branding.");
    }, 6000);
    void (supabase as any).from("company_settings")
      .select("company_name,company_logo_url,welcome_message,company_welcome_visual_url,company_welcome_visual_animated")
      .eq("id", 1).maybeSingle()
      .then(({ data, error }: any) => { if (!error) apply(data); else if (active) setBranding((current) => ({ ...current, isLoaded: true })); })
      .catch((error: unknown) => { console.warn("[company-branding] load failed; keeping defaults", error); if (active) setBranding((current) => ({ ...current, isLoaded: true })); })
      .finally(() => clearTimeout(timeout));
    const channel = supabase.channel("company-branding-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "company_settings", filter: "id=eq.1" }, (payload: any) => {
        if (payload.eventType === "DELETE") setBranding(DEFAULT_BRANDING);
        else apply(payload.new);
      }).subscribe();
    return () => { active = false; clearTimeout(timeout); void supabase.removeChannel(channel); };
  }, []);
  return branding;
}
