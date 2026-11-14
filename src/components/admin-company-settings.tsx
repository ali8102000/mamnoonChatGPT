import { useEffect, useState } from "react";
import { Save, Building2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const OWNER_EMAIL = "a7md0555666@gmail.com";

export default function AdminCompanySettings() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user?.email?.toLowerCase() !== OWNER_EMAIL) {
        if (active) { setMessage("هذه الإعدادات مخصصة لصاحب الحساب فقط."); setLoading(false); }
        return;
      }
      const { data: allowed, error: permissionError } = await (supabase as any).rpc("is_super_admin", { p_user_id: auth.user.id });
      if (permissionError || allowed !== true) {
        if (active) { setMessage("لا توجد صلاحية المدير الأعلى لهذا الحساب."); setLoading(false); }
        return;
      }
      const { data, error } = await (supabase as any).from("company_settings").select("company_name").eq("id", 1).maybeSingle();
      if (active) {
        if (error) setMessage("تعذر تحميل اسم الشركة: " + error.message);
        else setName(data?.company_name ?? "شركة ممنون");
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const save = async () => {
    const value = name.trim();
    if (value.length < 2 || value.length > 80) { setMessage("اكتب اسماً من حرفين إلى 80 حرفاً."); return; }
    setSaving(true); setMessage("");
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user?.email?.toLowerCase() !== OWNER_EMAIL) { setMessage("غير مصرّح."); setSaving(false); return; }
    const { data: allowed } = await (supabase as any).rpc("is_super_admin", { p_user_id: auth.user.id });
    if (allowed !== true) { setMessage("لا توجد صلاحية المدير الأعلى."); setSaving(false); return; }
    const { error } = await (supabase as any).from("company_settings").upsert({ id: 1, company_name: value, updated_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: "id" });
    setMessage(error ? "فشل الحفظ: " + error.message : "تم حفظ اسم الشركة.");
    setSaving(false);
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل إعدادات الشركة...</div>;
  return <section className="max-w-2xl">
    <div className="flex items-center gap-3 mb-5"><Building2 className="h-6 w-6 text-primary" /><div><h2 className="text-xl font-black">إعدادات شركة ممنون</h2><p className="text-sm text-muted-foreground">تغيير الاسم الظاهر للمنصة</p></div></div>
    <div className="glass rounded-2xl p-5 space-y-4">
      <label className="block text-sm font-bold" htmlFor="company-name">اسم الشركة</label>
      <input id="company-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary" placeholder="مثلاً: شركة ممنون" />
      <button type="button" onClick={save} disabled={saving || !name.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} حفظ الاسم</button>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </div>
  </section>;
}
