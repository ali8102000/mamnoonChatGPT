import { useEffect, useId, useState } from "react";
import { supabase } from "@/lib/supabase";

export type CompanyBranding = {
  companyName: string;
  logoUrl: string | null;
  welcomeMessage: string;
  welcomeVisualUrl: string | null;
  welcomeVisualAnimated: boolean;
  welcomeVisualSizePx: number;
  homeVisualUrl: string | null;
  homeVisualAnimated: boolean;
  homeVisualEnabled: boolean;
  homeVisualSizePx: number;
  homeVisualWidthPx: number;
  homeVisualHeightPx: number;
  homeVisualPosition: string;
  homeVisualLinkUrl: string;
  isLoaded: boolean;
};

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: "ممنون",
  logoUrl: null,
  welcomeMessage: "مشوارك وخدمات بيتك، بمكان واحد.",
  welcomeVisualUrl: null,
  welcomeVisualAnimated: false,
  welcomeVisualSizePx: 180,
  homeVisualUrl: null,
  homeVisualAnimated: false,
  homeVisualEnabled: true,
  homeVisualSizePx: 180,
  homeVisualWidthPx: 320,
  homeVisualHeightPx: 180,
  homeVisualPosition: "below_banner",
  homeVisualLinkUrl: "",
  isLoaded: false,
};

export function useCompanyBranding() {
  const channelId = useId().replace(/:/g, "");
  const [branding, setBranding] = useState<CompanyBranding>(DEFAULT_BRANDING);
  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      if (active) setBranding((current) => ({ ...current, isLoaded: true }));
    }, 6000);
    const apply = (data: any) => {
      if (!active) return;
      if (!data) {
        setBranding((current) => ({ ...current, isLoaded: true }));
        return;
      }
      setBranding({
        companyName: data.company_name || DEFAULT_BRANDING.companyName,
        logoUrl: data.company_logo_url || null,
        welcomeMessage: data.welcome_message || DEFAULT_BRANDING.welcomeMessage,
        welcomeVisualUrl: data.company_welcome_visual_url || null,
        welcomeVisualAnimated: data.company_welcome_visual_animated === true,
        welcomeVisualSizePx: Number.isInteger(data.company_welcome_visual_size_px) ? Math.max(80, Math.min(320, data.company_welcome_visual_size_px)) : 180,
        homeVisualUrl: data.home_visual_url || null,
        homeVisualAnimated: data.home_visual_animated === true,
        homeVisualEnabled: data.home_visual_enabled !== false,
        homeVisualSizePx: Number.isInteger(data.home_visual_size_px) ? Math.max(80, Math.min(320, data.home_visual_size_px)) : 180,
        homeVisualWidthPx: Number.isInteger(data.home_visual_width_px) ? Math.max(80, Math.min(600, data.home_visual_width_px)) : 320,
        homeVisualHeightPx: Number.isInteger(data.home_visual_height_px) ? Math.max(80, Math.min(600, data.home_visual_height_px)) : 180,
        homeVisualPosition: ["above_banner", "below_banner", "below_custom_content"].includes(data.home_visual_position) ? data.home_visual_position : "below_banner",
        homeVisualLinkUrl: data.home_visual_link_url || "",
        isLoaded: true,
      });
    };
    void (supabase as any)
      .from("company_settings")
      .select("company_name,company_logo_url,welcome_message,company_welcome_visual_url,company_welcome_visual_animated,company_welcome_visual_size_px,home_visual_url,home_visual_animated,home_visual_enabled,home_visual_size_px,home_visual_width_px,home_visual_height_px,home_visual_position,home_visual_link_url")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data, error }: any) => {
        if (error) {
          console.warn("[company-branding] load failed; keeping defaults", error);
          if (active) setBranding((current) => ({ ...current, isLoaded: true }));
        } else {
          apply(data);
        }
      })
      .catch((error: unknown) => {
        console.warn("[company-branding] load failed; keeping defaults", error);
        if (active) setBranding((current) => ({ ...current, isLoaded: true }));
      })
      .finally(() => clearTimeout(timeout));
    const channel = supabase.channel(`company-branding-live-${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "company_settings", filter: "id=eq.1" }, (payload: any) => {
        if (!active) return;
        if (payload.eventType === "DELETE") setBranding({ ...DEFAULT_BRANDING, isLoaded: true });
        else apply(payload.new);
      })
      .subscribe();
    return () => {
      active = false;
      clearTimeout(timeout);
      void supabase.removeChannel(channel);
    };
  }, []);
  return branding;
}
