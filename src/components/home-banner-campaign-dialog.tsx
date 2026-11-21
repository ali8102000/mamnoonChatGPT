import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "@/lib/toast";

type CampaignOption = { id: string; label: string; sort_order: number };
type Campaign = {
  id: string;
  campaign_type: "poll" | "contest";
  title: string;
  description: string | null;
  image_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  result_visibility: "private" | "public" | "after_end";
  app_campaign_options: CampaignOption[];
};

export function HomeBannerCampaignDialog({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const { session } = useAuth();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await (supabase as any)
        .from("app_campaigns")
        .select("id,campaign_type,title,description,image_url,starts_at,ends_at,result_visibility,app_campaign_options(id,label,sort_order)")
        .eq("id", campaignId)
        .eq("status", "published")
        .maybeSingle();
      if (!active) return;
      if (error || !data || !["poll", "contest"].includes(data.campaign_type)) {
        toast.error("تعذر فتح الحملة أو أنها لم تعد منشورة.");
        onClose();
        return;
      }
      setCampaign(data as Campaign);
      if (session?.user?.id) {
        const [{ data: own }, { data: results }] = await Promise.all([
          (supabase as any).from("app_campaign_responses").select("option_id").eq("campaign_id", campaignId).eq("user_id", session.user.id).maybeSingle(),
          (supabase as any).from("app_campaign_option_results").select("option_id,vote_count").eq("campaign_id", campaignId),
        ]);
        if (!active) return;
        setSelected(own?.option_id ?? null);
        setCounts(Object.fromEntries((results ?? []).map((row: any) => [row.option_id, Number(row.vote_count ?? 0)])));
      }
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [campaignId, session?.user?.id, onClose]);

  const vote = async (optionId: string) => {
    if (!campaign || !session?.user?.id || selected || saving) return;
    const now = Date.now();
    const open = (!campaign.starts_at || new Date(campaign.starts_at).getTime() <= now) && (!campaign.ends_at || new Date(campaign.ends_at).getTime() > now);
    if (!open) return;
    setSaving(true);
    const { error } = await (supabase as any).from("app_campaign_responses").insert({
      campaign_id: campaign.id, option_id: optionId, user_id: session.user.id,
    });
    if (error) {
      toast.error(error.code === "23505" ? "سبق وشاركت بهذه الحملة." : "تعذر تسجيل المشاركة. حاول مرة ثانية.");
    } else {
      setSelected(optionId);
      setCounts((old) => ({ ...old, [optionId]: (old[optionId] ?? 0) + 1 }));
      toast.success(campaign.campaign_type === "contest" ? "تم تسجيل مشاركتك بالمسابقة." : "تم تسجيل تصويتك.");
    }
    setSaving(false);
  };

  const open = !!campaign && (!campaign.starts_at || new Date(campaign.starts_at).getTime() <= Date.now()) && (!campaign.ends_at || new Date(campaign.ends_at).getTime() > Date.now());
  const showResults = campaign?.result_visibility === "public" || (campaign?.result_visibility === "after_end" && !!campaign.ends_at && new Date(campaign.ends_at).getTime() <= Date.now());

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="تفاصيل الحملة" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section dir="rtl" className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-2xl">
        <button type="button" onClick={onClose} aria-label="إغلاق" className="absolute left-3 top-3 rounded-full bg-muted p-2"><X className="h-4 w-4" /></button>
        {loading ? <p className="py-10 text-center text-sm text-muted-foreground">جارٍ تحميل الحملة...</p> : campaign ? <>
          <span className="text-xs font-black text-primary">{campaign.campaign_type === "contest" ? "مسابقة" : "استطلاع رأي"}</span>
          {campaign.image_url && <img src={campaign.image_url} alt="" className="mt-3 max-h-52 w-full rounded-xl object-contain" />}
          <h2 className="mt-3 text-lg font-black">{campaign.title}</h2>
          {campaign.description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{campaign.description}</p>}
          <div className="mt-4 space-y-2">{[...(campaign.app_campaign_options ?? [])].sort((a,b)=>a.sort_order-b.sort_order).map((option) => {
            const count = counts[option.id] ?? 0;
            return <button key={option.id} type="button" disabled={!open || !session?.user?.id || !!selected || saving} onClick={() => void vote(option.id)} className={`w-full rounded-xl border p-3 text-right text-sm ${selected === option.id ? "border-primary bg-primary/5" : "border-border"} disabled:opacity-60`}>
              <span className="flex items-center justify-between gap-2"><span>{option.label}</span>{showResults && <b className="text-primary">{count}</b>}</span>
            </button>;
          })}</div>
          {!session?.user?.id && <p className="mt-3 text-xs text-muted-foreground">سجّل الدخول حتى تشارك.</p>}
          {selected && <p className="mt-3 text-xs font-bold text-primary">تم تسجيل مشاركتك.</p>}
          {!open && <p className="mt-3 text-xs text-muted-foreground">انتهى وقت المشاركة أو لم تبدأ الحملة بعد.</p>}
        </> : <p className="py-8 text-center text-sm text-muted-foreground">الحملة غير متاحة حالياً.</p>}
      </section>
    </div>
  );
}
