import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function AdminTripLookup() {
  const [code, setCode] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    if (!code.trim()) { setError("اكتب رقم الرحلة أولاً"); return; }
    setBusy(true); setError(""); setDetail(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("admin-users", {
        body: { action: "request_detail", request_code: code.trim() },
      });
      if (invokeError || data?.error) throw new Error(data?.error || invokeError?.message || "تعذر تحميل الرحلة");
      setDetail(data);
    } catch (e: any) {
      setError(e?.message || "لم نعثر على الرحلة أو لا تملك صلاحية عرضها");
    } finally { setBusy(false); }
  }

  const req = detail?.request;
  return (
    <section className="glass mb-4 space-y-3 rounded-2xl p-4" dir="rtl">
      <div className="font-black">متابعة الرحلة برقمها</div>
      <div className="flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} placeholder="MN-2026-00000124" className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-3 text-sm" />
        <button type="button" disabled={busy} onClick={() => void search()} className="rounded-xl bg-primary px-4 py-2 text-xs font-black text-primary-foreground">{busy ? "جارٍ البحث..." : "بحث"}</button>
      </div>
      {!!error && <div className="rounded-xl bg-red-500/10 p-3 text-xs text-red-700">{error}</div>}
      {req && <div className="space-y-3 rounded-xl border border-primary/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <b className="text-sm">الرحلة {req.request_code || req.id}</b>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-black text-primary">{req.status}</span>
        </div>
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div>النوع: <b>{req.type}</b></div>
          <div>المبلغ: <b>{req.price_estimate == null ? "—" : Number(req.price_estimate).toLocaleString("ar-IQ") + " د.ع"}</b></div>
          <div>تاريخ الطلب: {req.created_at ? new Date(req.created_at).toLocaleString("ar-IQ") : "—"}</div>
          <div>تاريخ البدء: {req.started_at ? new Date(req.started_at).toLocaleString("ar-IQ") : "—"}</div>
          <div>تاريخ الاكتمال: {req.completed_at ? new Date(req.completed_at).toLocaleString("ar-IQ") : "—"}</div>
          {(req.status === "cancelled" || req.cancelled_by) && <>
            <div>آخر إجراء: <b>{req.status === "cancelled" ? "إلغاء الرحلة" : "اعتذار مقدم الخدمة وإعادة البحث"}</b> · المنفذ: <b>{!req.cancelled_by ? "النظام" : req.cancelled_by === req.customer_id ? "الزبون" : "السائق / مقدم الخدمة"}</b></div>
            <div className="sm:col-span-2">سبب الإلغاء: <b>{req.cancellation_reason || "غير مسجل"}</b></div>
          </>}
          <div>طريقة الدفع: {req.payment_method || "—"}</div>
          <div>الانطلاق: {req.pickup_text || "—"}</div>
          <div>الوجهة: {req.dest_text || "—"}</div>
          <div className="sm:col-span-2">تفاصيل العمل: {req.work_description || req.notes || "—"}</div>
          <div>المسافة: {req.distance_km == null ? "—" : req.distance_km + " كم"}</div>
          <div>المدة: {req.duration_min == null ? "—" : req.duration_min + " دقيقة"}</div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[detail.customer, detail.provider].map((person: any, index: number) => person && <div key={person.id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
            {person.avatar_url ? <img src={person.avatar_url} alt="صورة الشخص" className="h-12 w-12 rounded-full object-cover" /> : <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10">👤</div>}
            <div className="min-w-0"><div className="truncate text-xs font-black">{person.full_name || (index === 0 ? "الزبون" : "مقدم الخدمة")}</div><div className="text-[10px] text-muted-foreground">{person.phone || "—"}</div></div>
          </div>)}
        </div>
        {req.attachment_url && <div><b className="mb-2 block text-xs">صورة العمل المرفقة</b><img src={req.attachment_url} alt="صورة العمل" className="max-h-80 w-full rounded-xl bg-background object-contain" /></div>}
        <div className="rounded-xl bg-surface-2 p-3 text-xs font-bold">نقاط مسار الرحلة: {detail.route_points?.length || 0}</div>
        <div className="rounded-xl bg-surface-2 p-3 text-xs font-bold">العروض: {detail.offers?.length || 0} · التقييمات: {detail.ratings?.length || 0} · البلاغات: {detail.reports?.length || 0}</div>
        {(detail.ratings || []).map((rating: any) => <div key={rating.id} className="rounded-xl border border-border p-3 text-xs space-y-1">
          <div className="flex items-center justify-between"><b>تقييم الرحلة</b><span className="font-black text-primary">{"★".repeat(Math.max(0, Math.min(5, Number(rating.stars) || 0)))} · {rating.stars}/5</span></div>
          <div>الاحترافية: {rating.professionalism ?? "—"}/5 · الالتزام: {rating.punctuality ?? "—"}/5 · الجودة: {rating.quality ?? "—"}/5</div>
          {!!rating.reasons?.length && <div>الاختيارات: {rating.reasons.join("، ")}</div>}
          {!!rating.comment && <div>{rating.comment}</div>}
        </div>)}
        {(detail.reports || []).map((report: any) => <div key={report.id} className="rounded-xl border border-border p-3 text-xs">
          <b>{report.reason}</b><div className="mt-1">{report.details || "بدون تفاصيل"}</div><div className="mt-1 text-muted-foreground">{report.status} · {new Date(report.created_at).toLocaleString("ar-IQ")}</div>
        </div>)}
        <button type="button" onClick={() => setDetail(null)} className="rounded-xl border border-border px-4 py-2 text-xs font-bold">إغلاق التفاصيل</button>
      </div>}
    </section>
  );
}
