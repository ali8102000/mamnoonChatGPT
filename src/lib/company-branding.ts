import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CompanyBranding = {
  companyName: string;
  logoUrl: string;
  welcomeMessage: string;
  welcomeMediaUrl: string | null;
  welcomeMediaType: "image" | "gif";
};

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "ممنون",
  logoUrl: "",
  welcomeMessage: "مشوارك وخدمات بيتك، بمكان واحد.",
  welcomeMediaUrl: null,
  welcomeMediaType: "image",
};

export function useCompanyBranding() {
  const [branding, setBranding] = useState<CompanyBranding>(DEFAULT_BRANDING);
  useEffect(() => {
    let active = true;
    const apply = (data: any) => {
      if (!active || !data) return;
      setBranding({
        companyName: data.company_name || DEFAULT_BRANDING.companyName,
        logoUrl: data.company_logo_url || "",
        welcomeMessage: data.welcome_message || DEFAULT_BRANDING.welcomeMessage,
        welcomeMediaUrl: data.welcome_media_url || null,
        welcomeMediaType: data.welcome_media_type === "gif" ? "gif" : "image",
      });
    };
    void (supabase as any).from("company_settings")
      .select("company_name,company_logo_url,welcome_message,welcome_media_url,welcome_media_type")
      .eq("id", 1).maybeSingle()
      .then(({ data, error }: any) => { if (!error) apply(data); })
      .catch((error: unknown) => console.warn("[company-branding] load failed", error));
    const channel = supabase.channel("company-branding-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "company_settings", filter: "id=eq.1" }, (payload: any) => {
        if (payload.eventType === "DELETE") setBranding(DEFAULT_BRANDING);
        else apply(payload.new);
      }).subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, []);
  return branding;
}
