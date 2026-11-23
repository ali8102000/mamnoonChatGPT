import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { MobileShell } from "@/components/mobile-shell";
import { ClipboardList } from "lucide-react";

export const Route = createFileRoute("/history")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "سجل الطلبات | ممنون" },
      { name: "description", content: "تابع طلبات النقل والخدمات السابقة والنشطة في ممنون." },
      { property: "og:title", content: "سجل الطلبات | ممنون" },
      {
        property: "og:description",
        content: "تابع طلبات النقل والخدمات السابقة والنشطة في ممنون.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { session, loading } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [tab, setTab] = useState<"all" | "active" | "done">("all");
  const [showAllRequests, setShowAllRequests] = useState(true);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const loadHistory = async () => {
      const { data: directRows, error: directError } = await supabase
        .from("service_requests")
        .select("id, request_code, type, status, price_estimate, pickup_text, dest_text, created_at, attachment_path, customer_id, provider_id, cancelled_by, cancellation_reason")
        .or(`customer_id.eq.${session.user.id},provider_id.eq.${session.user.id}`)
        .order("created_at", { ascending: false });
      if (directError) {
        console.warn("[history] Direct request history failed:", directError.message);
        if (active) setItems([]);
        return;
      }
      const { data: memberships, error: membershipError } = await (supabase as any)
        .from("service_request_providers")
        .select("request_id")
        .eq("provider_id", session.user.id);
      let teamRows: any[] = [];
      if (!membershipError && memberships?.length) {
        const teamIds = [...new Set<string>(memberships.map((row: any) => String(row.request_id)))];
        const { data: rows, error: teamError } = await supabase
          .from("service_requests")
          .select("id, request_code, type, status, price_estimate, pickup_text, dest_text, created_at, attachment_path, customer_id, provider_id, cancelled_by, cancellation_reason")
          .in("id", teamIds);
        if (!teamError) teamRows = rows ?? [];
        else console.warn("[history] Team request history failed:", teamError.message);
      }
      if (membershipError) console.warn("[history] Team membership history unavailable:", membershipError.message);
      const merged = new Map<string, any>();
      [...(directRows ?? []), ...teamRows].forEach((row) => merged.set(row.id, row));
      const baseRows = [...merged.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const otherIds = [...new Set<string>(baseRows.map((row: any) =>
        String(row.customer_id === session.user.id ? row.provider_id : row.customer_id || ""),
      ).filter(Boolean))];
      const { data: profiles } = otherIds.length
        ? await supabase.from("profiles").select("id,avatar_url").in("id", otherIds)
        : { data: [] };
      const avatarById = new Map((profiles ?? []).map((profile: any) => [profile.id, profile.avatar_url]));
      const rows = await Promise.all(baseRows.map(async (row: any) => {
        let workPhotoUrl: string | null = null;
        if (row.attachment_path) {
          const { data: signed } = await supabase.storage.from("request-attachments").createSignedUrl(row.attachment_path, 1800);
          workPhotoUrl = signed?.signedUrl ?? null;
        }
        const otherId = row.customer_id === session.user.id ? row.provider_id : row.customer_id;
        return { ...row, workPhotoUrl, personAvatarUrl: otherId ? avatarById.get(otherId) ?? null : null };
      }));
      if (active) setItems(rows);
    };
    void loadHistory();
    return () => { active = false; };
  }, [session]);

  if (loading) return null;
  if (!session) return <Navigate to="/auth" />;

  const lastHour = Date.now() - 60 * 60 * 1000;
  const filtered = items.filter((r) => {
    const matchesTime = showAllRequests || new Date(r.created_at).getTime() >= lastHour;
    const matchesTab = tab === "all"
      ? true
      : tab === "active"
        ? ["pending", "searching", "accepted", "in_progress"].includes(r.status)
        : ["completed", "cancelled"].includes(r.status);
    return matchesTime && matchesTab;
  });

  return (
    <MobileShell>
      <div className="px-5 pt-10">
        <h1 className="text-3xl font-black mb-4">سجل الطلبات</h1>

        <div className="flex gap-2 mb-3">
          <button type="button" onClick={() => setShowAllRequests(false)} className={"px-4 py-2 rounded-xl text-xs font-bold btn-press " + (!showAllRequests ? "bg-primary text-primary-foreground" : "glass")}>آخر ساعة</button>
          <button type="button" onClick={() => setShowAllRequests(true)} className={"px-4 py-2 rounded-xl text-xs font-bold btn-press " + (showAllRequests ? "bg-primary text-primary-foreground" : "glass")}>كل الطلبات</button>
        </div>
        <div className="flex gap-2 mb-4">
          {(["all", "active", "done"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-xs font-bold btn-press ${tab === t ? "bg-primary text-primary-foreground" : "glass"}`}
            >
              {t === "all" ? "الكل" : t === "active" ? "نشطة" : "منجزة"}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
            <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-50" />
            لا توجد طلبات بعد
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <Link
                key={r.id}
                to="/request/$id"
                params={{ id: r.id }}
                className="glass rounded-2xl p-4 flex items-center gap-3 btn-press"
              >
                <div className="flex w-14 shrink-0 flex-col items-center gap-1">
                  {r.personAvatarUrl ? <img src={r.personAvatarUrl} alt="صورة الشخص" className="h-9 w-9 rounded-full object-cover" /> : <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10">👤</div>}
                  {r.workPhotoUrl ? <img src={r.workPhotoUrl} alt="صورة العمل" className="h-10 w-14 rounded-lg object-cover" /> : <div className="grid h-10 w-14 place-items-center rounded-lg bg-surface-2 text-[9px] text-muted-foreground">صورة العمل</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{r.type === "taxi" ? "رحلة تكسي" : "خدمة منزلية"}</div>
                  <div className="text-[10px] font-black text-primary">رقم الرحلة: {r.request_code || String(r.id).slice(0, 8).toUpperCase()}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{r.pickup_text || "—"}{r.dest_text ? " ← " + r.dest_text : ""}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.status === "pending"
                      ? "بانتظار"
                      : r.status === "searching"
                        ? "بحث"
                        : r.status === "accepted"
                          ? "مقبول"
                          : r.status === "in_progress"
                            ? "قيد التنفيذ"
                            : r.status === "completed"
                              ? "مكتمل"
                              : r.status === "cancelled"
                                ? "ملغي"
                                : r.status}
                  </div>
                  {(r.status === "cancelled" || r.cancelled_by) && <div className="mt-1 text-[10px] leading-5 text-muted-foreground">{r.status === "cancelled" ? "ألغى الرحلة" : "آخر اعتذار عن الرحلة"}: {!r.cancelled_by ? "النظام" : r.cancelled_by === r.customer_id ? "الزبون" : "السائق / مقدم الخدمة"} · السبب: {r.cancellation_reason || "غير مسجل"}</div>}
                  </div>
                {r.price_estimate && (
                  <div className="text-left">
                    <div className="font-black text-sm">
                      {Number(r.price_estimate).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">د.ع</div>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </MobileShell>
  );
}
