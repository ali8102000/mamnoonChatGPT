import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { MobileShell } from "@/components/mobile-shell";

type Option = { id: string; label: string; sort_order: number };
type Campaign = { id: string; campaign_type: "poll" | "contest"; title: string; description: string | null; image_url: string | null; starts_at: string | null; ends_at: string | null; participation_mode?: "options"|"text"|"image"|"both"; rules?:string|null; prize_description?:string|null; app_campaign_options: Option[] };
type Entry = { id:string;text_content:string|null;storage_path:string|null;status:string;image_url:string|null };

export const Route = createFileRoute("/campaign/$id")({ ssr: false, component: CampaignPage });

function CampaignPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const [campaign,setCampaign] = useState<Campaign|null>(null);
  const [answer,setAnswer] = useState<string|null>(null);
  const [selected,setSelected] = useState("");
  const [entry,setEntry] = useState<Entry|null>(null);
  const [entryText,setEntryText] = useState("");
  const [entryFile,setEntryFile] = useState<File|null>(null);
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const {data,error:queryError}=await (supabase as any).from("app_campaigns").select("id,campaign_type,title,description,image_url,starts_at,ends_at,participation_mode,rules,prize_description,app_campaign_options(id,label,sort_order)").eq("id",id).eq("status","published").maybeSingle();
    if(queryError||!data){setCampaign(null);setError("الحملة غير متاحة حالياً أو انتهى نشرها.");setLoading(false);return;}
    setCampaign(data as Campaign);
    if(session?.user?.id){
      const [own,ownEntry]=await Promise.all([
        (supabase as any).from("app_campaign_responses").select("option_id").eq("campaign_id",id).eq("user_id",session.user.id).maybeSingle(),
        (supabase as any).from("app_campaign_entries").select("id,text_content,storage_path,status").eq("campaign_id",id).eq("user_id",session.user.id).maybeSingle()
      ]);
      setAnswer(own.data?.option_id??null);
      if(ownEntry.data){let imageUrl:string|null=null;if(ownEntry.data.storage_path){const signed=await supabase.storage.from("campaign-entries").createSignedUrl(ownEntry.data.storage_path,3600);imageUrl=signed.data?.signedUrl??null;}setEntry({...ownEntry.data,image_url:imageUrl});}
    }
    setLoading(false);
  },[id,session?.user?.id]);
  useEffect(()=>{void load();},[load]);
  const open=!!campaign&&(!campaign.starts_at||new Date(campaign.starts_at).getTime()<=Date.now())&&(!campaign.ends_at||new Date(campaign.ends_at).getTime()>Date.now());
  const mode=campaign?.participation_mode??"options";
  const entryMode=mode==="text"||mode==="image"||mode==="both";
  const submitEntry=async()=>{
    if(!campaign||!session?.user?.id||entry||busy)return;
    const needsText=mode==="text"||mode==="both",needsImage=mode==="image"||mode==="both";
    if(needsText&&!entryText.trim()){setError("اكتب نص مشاركتك أولاً.");return;}
    if(needsImage&&!entryFile){setError("اختار صورة للمشاركة أولاً.");return;}
    if(entryFile&&(!entryFile.type.startsWith("image/")||entryFile.size>8*1024*1024)){setError("الصورة لازم تكون أقل من 8 ميغابايت.");return;}
    setBusy(true);setError("");let storagePath:string|null=null;
    try{
      if(needsImage&&entryFile){
        const ext=(entryFile.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"").toLowerCase()||"jpg";
        storagePath=campaign.id+"/"+session.user.id+"/"+Date.now()+"-"+Math.random().toString(36).slice(2)+"."+ext;
        const uploaded=await supabase.storage.from("campaign-entries").upload(storagePath,entryFile,{upsert:false,contentType:entryFile.type});
        if(uploaded.error)throw uploaded.error;
      }
      const {data,error:saveError}=await (supabase as any).from("app_campaign_entries").insert({campaign_id:campaign.id,user_id:session.user.id,text_content:needsText?entryText.trim():null,image_url:storagePath?"private://"+storagePath:null,storage_path:storagePath}).select("id,text_content,storage_path,status").single();
      if(saveError)throw saveError;
      let imageUrl:string|null=null;if(storagePath){const signed=await supabase.storage.from("campaign-entries").createSignedUrl(storagePath,3600);imageUrl=signed.data?.signedUrl??null;}
      setEntry({...data,image_url:imageUrl});setEntryText("");setEntryFile(null);
    }catch(e:any){if(storagePath)await supabase.storage.from("campaign-entries").remove([storagePath]);setError(e?.code==="23505"?"سبق وقدمت مشاركة بهذه المسابقة.":"تعذر إرسال المشاركة. تحقق من الاتصال وحاول مرة ثانية.");}
    finally{setBusy(false);}
  };
  const submitVote=async()=>{if(!campaign||!session?.user?.id||!selected||busy)return;setBusy(true);setError("");const {error:saveError}=await (supabase as any).from("app_campaign_responses").insert({campaign_id:id,option_id:selected,user_id:session.user.id});if(saveError){setError(saveError.code==="23505"?"سبق سجلت مشاركتك بهذه الحملة.":"تعذر تسجيل المشاركة. حاول مرة ثانية.");if(saveError.code==="23505")setAnswer(selected);}else setAnswer(selected);setBusy(false);};
  return <MobileShell><main dir="rtl" className="mx-auto min-h-[70vh] max-w-xl space-y-4 px-4 py-6">
    <Link to="/home" className="text-sm font-black text-primary">← الرجوع للرئيسية</Link>
    {loading?<div className="rounded-2xl border p-8 text-center">جارٍ تحميل الحملة...</div>:!campaign?<div role="alert" className="rounded-2xl border p-6 text-center text-destructive">{error}</div>:<>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        {campaign.image_url&&<img src={campaign.image_url} alt="" className="max-h-64 w-full object-cover"/>}
        <div className="space-y-3 p-5">
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary">{campaign.campaign_type==="poll"?"استطلاع رأي":"مسابقة ممنون"}</span>
          <h1 className="text-2xl font-black">{campaign.title}</h1>
          {campaign.description&&<div className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm leading-7">{campaign.description}</div>}
          {campaign.prize_description&&<div className="rounded-xl bg-primary/5 p-3 text-sm"><b>الجائزة:</b> {campaign.prize_description}</div>}
          {campaign.rules&&<div className="whitespace-pre-wrap rounded-xl bg-muted/40 p-3 text-sm leading-7"><b>الشروط والتعليمات:</b>{"\n"}{campaign.rules}</div>}
          {!open&&<p className="text-sm font-bold text-destructive">المشاركة غير متاحة حالياً.</p>}
          {!session?.user?.id&&<p className="text-sm">سجّل الدخول حتى تگدر تشارك. <Link to="/auth" className="font-black text-primary">تسجيل الدخول</Link></p>}
          {entryMode?<div className="space-y-3">
            <h2 className="font-black">شارك بالمسابقة</h2>
            {(mode==="text"||mode==="both")&&<label className="block space-y-2 text-sm font-bold">نص المشاركة<textarea value={entryText} onChange={e=>setEntryText(e.target.value)} rows={5} maxLength={3000} disabled={!!entry||!open} className="w-full rounded-xl border border-border bg-background p-3 font-normal" placeholder="اكتب مشاركتك هنا..."/></label>}
            {(mode==="image"||mode==="both")&&<label className="block space-y-2 text-sm font-bold">صورة المشاركة<input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!entry||!open} onChange={e=>setEntryFile(e.target.files?.[0]??null)} className="block w-full text-xs"/><span className="text-xs font-normal text-muted-foreground">{entryFile?.name??"JPG أو PNG أو WEBP · حتى 8 ميغابايت"}</span></label>}
            {entry?<div className="rounded-xl border p-3 text-sm"><b>وصلتنا مشاركتك</b><p className="mt-1 text-xs text-muted-foreground">الحالة: {entry.status==="approved"?"مقبولة":entry.status==="rejected"?"مرفوضة":"قيد المراجعة"}</p>{entry.text_content&&<p className="mt-2 whitespace-pre-wrap">{entry.text_content}</p>}{entry.image_url&&<img src={entry.image_url} alt="صورة المشاركة" className="mt-2 max-h-64 rounded-xl object-contain"/>}</div>:<button type="button" disabled={!open||!session?.user?.id||busy} onClick={()=>void submitEntry()} className="w-full rounded-xl bg-primary p-3 font-black text-primary-foreground disabled:opacity-50">{busy?"جارٍ إرسال المشاركة...":"إرسال المشاركة"}</button>}
          </div>:<>
            <h2 className="font-black">اختر إجابتك</h2>
            <div className="space-y-2">{[...(campaign.app_campaign_options??[])].sort((a,b)=>a.sort_order-b.sort_order).map(option=><button key={option.id} type="button" disabled={!open||!!answer||!session?.user?.id||busy} onClick={()=>setSelected(option.id)} className={`w-full rounded-xl border p-3 text-right font-bold disabled:opacity-60 ${selected===option.id?"border-primary bg-primary/10":"border-border"}`}>{answer===option.id?"✓ ":""}{option.label}</button>)}</div>
            {answer?<p className="rounded-xl bg-emerald-500/10 p-3 text-sm font-black text-emerald-700">تم تسجيل مشاركتك بنجاح. شكراً إلك.</p>:<button type="button" disabled={!open||!session?.user?.id||!selected||busy} onClick={()=>void submitVote()} className="w-full rounded-xl bg-primary p-3 font-black text-primary-foreground disabled:opacity-50">{busy?"جارٍ تسجيل المشاركة...":"إرسال الإجابة"}</button>}
          </>}
          {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      </div>
    </>}
  </main></MobileShell>;
}
