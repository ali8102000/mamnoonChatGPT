import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { MobileShell } from "@/components/mobile-shell";

type Option = { id: string; label: string; sort_order: number };
type Campaign = { id: string; campaign_type: "poll" | "contest"; title: string; description: string | null; image_url: string | null; starts_at: string | null; ends_at: string | null; app_campaign_options: Option[] };

export const Route = createFileRoute("/campaign/$id")({ ssr: false, component: CampaignPage });

function CampaignPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const [campaign,setCampaign] = useState<Campaign|null>(null);
  const [answer,setAnswer] = useState<string|null>(null);
  const [selected,setSelected] = useState("");
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const {data,error:queryError}=await (supabase as any).from("app_campaigns").select("id,campaign_type,title,description,image_url,starts_at,ends_at,app_campaign_options(id,label,sort_order)").eq("id",id).eq("status","published").maybeSingle();
    if(queryError||!data){setCampaign(null);setError("الحملة غير متاحة حالياً أو انتهى نشرها.");setLoading(false);return;}
    setCampaign(data as Campaign);
    if(session?.user?.id){const {data:own}=await (supabase as any).from("app_campaign_responses").select("option_id").eq("campaign_id",id).eq("user_id",session.user.id).maybeSingle();setAnswer(own?.option_id??null);}
    setLoading(false);
  },[id,session?.user?.id]);
  useEffect(()=>{void load();},[load]);
  const submit=async()=>{if(!campaign||!session?.user?.id||!selected||busy)return;setBusy(true);setError("");const {error:saveError}=await (supabase as any).from("app_campaign_responses").insert({campaign_id:id,option_id:selected,user_id:session.user.id});if(saveError){setError(saveError.code==="23505"?"سبق وسجلت مشاركتك بهذه الحملة.":"تعذر تسجيل المشاركة. حاول مرة ثانية.");if(saveError.code==="23505")setAnswer(selected);}else setAnswer(selected);setBusy(false);};
  const open=!!campaign&&(!campaign.starts_at||new Date(campaign.starts_at).getTime()<=Date.now())&&(!campaign.ends_at||new Date(campaign.ends_at).getTime()>Date.now());
  return <MobileShell><main dir="rtl" className="mx-auto min-h-[70vh] max-w-xl space-y-4 px-4 py-6">
    <Link to="/home" className="text-sm font-black text-primary">← الرجوع للرئيسية</Link>
    {loading?<div className="rounded-2xl border p-8 text-center">جارٍ تحميل الحملة...</div>:!campaign?<div role="alert" className="rounded-2xl border p-6 text-center text-destructive">{error}</div>:<>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        {campaign.image_url&&<img src={campaign.image_url} alt="" className="max-h-64 w-full object-cover"/>}
        <div className="space-y-3 p-5">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary">{campaign.campaign_type==="poll"?"استطلاع رأي":"مسابقة ممنون"}</span>
          <h1 className="text-2xl font-black">{campaign.title}</h1>
          {campaign.description&&<div className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm leading-7">{campaign.description}</div>}
          <h2 className="font-black">{campaign.campaign_type==="poll"?"اختر إجابتك":"طريقة المشاركة / اختر إجابتك"}</h2>
          {!open&&<p className="text-sm font-bold text-destructive">المشاركة غير متاحة حالياً.</p>}
          {!session?.user?.id&&<p className="text-sm">سجّل الدخول حتى تگدر تشارك. <Link to="/auth" className="font-black text-primary">تسجيل الدخول</Link></p>}
          <div className="space-y-2">{[...(campaign.app_campaign_options??[])].sort((a,b)=>a.sort_order-b.sort_order).map(option=><button key={option.id} type="button" disabled={!open||!!answer||!session?.user?.id||busy} onClick={()=>setSelected(option.id)} className={`w-full rounded-xl border p-3 text-right font-bold disabled:opacity-60 ${selected===option.id?"border-primary bg-primary/10":"border-border"}`}>{answer===option.id?"✓ ":""}{option.label}</button>)}</div>
          {answer?<p className="rounded-xl bg-emerald-500/10 p-3 text-sm font-black text-emerald-700">تم تسجيل مشاركتك بنجاح. شكراً إلك.</p>:<button type="button" disabled={!open||!session?.user?.id||!selected||busy} onClick={()=>void submit()} className="w-full rounded-xl bg-primary p-3 font-black text-primary-foreground disabled:opacity-50">{busy?"جارٍ تسجيل المشاركة...":campaign.campaign_type==="poll"?"إرسال الإجابة":"تأكيد المشاركة"}</button>}
          {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </div>
    </>}
  </main></MobileShell>;
}
