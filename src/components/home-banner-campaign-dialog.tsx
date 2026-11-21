import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "@/lib/toast";

type CampaignOption = { id: string; label: string; sort_order: number };
type Entry = { id: string; text_content: string | null; image_url: string | null; status: string };
type Campaign = {
  id: string; campaign_type: "poll" | "contest"; title: string; description: string | null;
  image_url: string | null; starts_at: string | null; ends_at: string | null;
  result_visibility: "private" | "public" | "after_end"; participation_mode?: "options" | "text" | "image" | "both";
  rules?: string | null; prize_description?: string | null; app_campaign_options: CampaignOption[];
};

export function HomeBannerCampaignDialog({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const { session } = useAuth();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [entry, setEntry] = useState<Entry | null>(null);
  const [entryText, setEntryText] = useState("");
  const [entryFile, setEntryFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await (supabase as any).from("app_campaigns")
        .select("id,campaign_type,title,description,image_url,starts_at,ends_at,result_visibility,participation_mode,rules,prize_description,app_campaign_options(id,label,sort_order)")
        .eq("id", campaignId).eq("status", "published").maybeSingle();
      if (!active) return;
      if (error || !data || !["poll", "contest"].includes(data.campaign_type)) {
        toast.error("تعذر فتح الحملة أو أنها لم تعد منشورة."); onClose(); return;
      }
      setCampaign(data as Campaign);
      if (session?.user?.id) {
        const [own, results, ownEntry] = await Promise.all([
          (supabase as any).from("app_campaign_responses").select("option_id").eq("campaign_id", campaignId).eq("user_id", session.user.id).maybeSingle(),
          (supabase as any).from("app_campaign_option_results").select("option_id,vote_count").eq("campaign_id", campaignId),
          (supabase as any).from("app_campaign_entries").select("id,text_content,image_url,status").eq("campaign_id", campaignId).eq("user_id", session.user.id).maybeSingle(),
        ]);
        if (!active) return;
        setSelected(own.data?.option_id ?? null);
        setCounts(Object.fromEntries((results.data ?? []).map((row: any) => [row.option_id, Number(row.vote_count ?? 0)])));
        setEntry(ownEntry.data ?? null);
      }
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [campaignId, session?.user?.id, onClose]);

  const vote = async (optionId: string) => {
    if (!campaign || !session?.user?.id || selected || saving) return;
    setSaving(true);
    const { error } = await (supabase as any).from("app_campaign_responses").insert({ campaign_id: campaign.id, option_id: optionId, user_id: session.user.id });
    if (error) toast.error(error.code === "23505" ? "سبق وشاركت بهذه الحملة." : "تعذر تسجيل المشاركة. حاول مرة ثانية.");
    else { setSelected(optionId); setCounts((old) => ({ ...old, [optionId]: (old[optionId] ?? 0) + 1 })); toast.success("تم تسجيل مشاركتك."); }
    setSaving(false);
  };

  const submitEntry = async () => {
    if (!campaign || !session?.user?.id || entry || saving) return;
    const mode = campaign.participation_mode ?? "options";
    const needsText = mode === "text" || mode === "both";
    const needsImage = mode === "image" || mode === "both";
    if (needsText && !entryText.trim()) { toast.error("اكتب نص مشاركتك أولاً."); return; }
    if (needsImage && !entryFile) { toast.error("اختار صورة للمشاركة أولاً."); return; }
    if (entryFile && (!entryFile.type.startsWith("image/") || entryFile.size > 8 * 1024 * 1024)) { toast.error("الصورة لازم تكون أقل من 8 ميغابايت."); return; }
    setSaving(true);
    let storagePath: string | null = null;
    let imageUrl: string | null = null;
    try {
      if (needsImage && entryFile) {
        const ext = (entryFile.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
        storagePath = campaign.id + "/" + session.user.id + "/" + Date.now() + "-" + Math.random().toString(36).slice(2) + "." + ext;
        const { error: uploadError } = await supabase.storage.from("campaign-entries").upload(storagePath, entryFile, { upsert: false, contentType: entryFile.type });
        if (uploadError) throw uploadError;
        const { data: signed, error: signedError } = await supabase.storage.from("campaign-entries").createSignedUrl(storagePath, 60 * 60);
        if (signedError) throw signedError;
        imageUrl = signed.signedUrl;
      }
      const { data, error } = await (supabase as any).from("app_campaign_entries").insert({
        campaign_id: campaign.id, user_id: session.user.id, text_content: needsText ? entryText.trim() : null,
        image_url: imageUrl, storage_path: storagePath,
      }).select("id,text_content,image_url,status").single();
      if (error) throw error;
      setEntry(data as Entry); setEntryText(""); setEntryFile(null); toast.success("تم استلام مشاركتك وإرسالها للمراجعة.");
    } catch (error: any) {
      if (storagePath) await supabase.storage.from("campaign-entries").remove([storagePath]);
      toast.error(error?.code === "23505" ? "سبق وقدمت مشاركة بهذه المسابقة." : "تعذر إرسال المشاركة. حاول مرة ثانية.");
    } finally { setSaving(false); }
  };

  const open = !!campaign && (!campaign.starts_at || new Date(campaign.starts_at).getTime() <= Date.now()) && (!campaign.ends_at || new Date(campaign.ends_at).getTime() > Date.now());
  const showResults = campaign?.result_visibility === "public" || (campaign?.result_visibility === "after_end" && !!campaign.ends_at && new Date(campaign.ends_at).getTime() <= Date.now());
  const mode = campaign?.participation_mode ?? "options";
  const entryMode = mode === "text" || mode === "image" || mode === "both";

  return <div className="fixed inset-0 z-[120] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="تفاصيل الحملة" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section dir="rtl" className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-2xl">
      <button type="button" onClick={onClose} aria-label="إغلاق" className="absolute left-3 top-3 rounded-full bg-muted p-2"><X className="h-4 w-4" /></button>
      {loading ? <p className="py-10 text-center text-sm text-muted-foreground">جارٍ تحميل الحملة...</p> : campaign ? <>
        <span className="text-xs font-black text-primary">{campaign.campaign_type === "contest" ? "مسابقة" : "استطلاع رأي"}</span>
        {campaign.image_url && <img src={campaign.image_url} alt="" className="mt-3 max-h-52 w-full rounded-xl object-contain" />}
        <h2 className="mt-3 text-lg font-black">{campaign.title}</h2>
        {campaign.description && <p className="mt-1 text-sm leading-6 text-muted-foreground">{campaign.description}</p>}
        {campaign.prize_description && <p className="mt-3 rounded-xl bg-primary/5 p-3 text-sm"><b>الجائزة:</b> {campaign.prize_description}</p>}
        {campaign.rules && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-sm leading-6"><b>الشروط والتعليمات:</b>{"\n"}{campaign.rules}</p>}
        {!session?.user?.id && <p className="mt-3 text-xs text-muted-foreground">سجّل الدخول حتى تشارك.</p>}
        {!open && <p className="mt-3 text-xs text-muted-foreground">انتهى وقت المشاركة أو لم تبدأ الحملة بعد.</p>}
        {entryMode ? <div className="mt-4 space-y-3">
          <h3 className="font-black">شارك بالمسابقة</h3>
          {(mode === "text" || mode === "both") && <label className="block space-y-1 text-sm font-bold">نص المشاركة<textarea value={entryText} onChange={(e) => setEntryText(e.target.value)} rows={4} maxLength={3000} disabled={!!entry || !open} className="w-full rounded-xl border border-border bg-background p-3 font-normal" placeholder="اكتب مشاركتك هنا..." /></label>}
          {(mode === "image" || mode === "both") && <label className="block space-y-2 text-sm font-bold">صورة المشاركة<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!entry || !open} onChange={(e) => setEntryFile(e.target.files?.[0] ?? null)} className="block w-full text-xs"/><span className="text-xs font-normal text-muted-foreground">{entryFile?.name ?? "JPG أو PNG أو WEBP · حتى 8 ميغابايت"}</span></label>}
          {entry ? <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm"><b>وصلتنا مشاركتك</b><p className="mt-1 text-xs text-muted-foreground">الحالة: {entry.status === "approved" ? "مقبولة" : entry.status === "rejected" ? "مرفوضة" : "قيد المراجعة"}</p>{entry.text_content && <p className="mt-2 whitespace-pre-wrap">{entry.text_content}</p>}</div> : <button type="button" disabled={!open || !session?.user?.id || saving} onClick={() => void submitEntry()} className="w-full rounded-xl bg-primary p-3 font-black text-primary-foreground disabled:opacity-50">{saving ? "جارٍ إرسال المشاركة..." : "إرسال المشاركة"}</button>}
        </div> : <div className="mt-4 space-y-2">{[...(campaign.app_campaign_options ?? [])].sort((a,b)=>a.sort_order-b.sort_order).map((option) => {
          const count = counts[option.id] ?? 0;
          return <button key={option.id} type="button" disabled={!open || !session?.user?.id || !!selected || saving} onClick={() => void vote(option.id)} className={`w-full rounded-xl border p-3 text-right text-sm ${selected === option.id ? "border-primary bg-primary/5" : "border-border"} disabled:opacity-60`}>
            <span className="flex items-center justify-between gap-2"><span>{option.label}</span>{showResults && <b className="text-primary">{count}</b>}</span>
          </button>;
        })}</div>}
        {selected && <p className="mt-3 text-xs font-bold text-primary">تم تسجيل مشاركتك.</p>}
      </> : <p className="py-8 text-center text-sm text-muted-foreground">الحملة غير متاحة حالياً.</p>}
    </section>
  </div>;
}
