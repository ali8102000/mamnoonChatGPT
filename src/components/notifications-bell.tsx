import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Bell, Check } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "@/lib/toast";

type Notif = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationsBell() {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const uid = session?.user.id;
  const [now, setNow] = useState(Date.now());
  const loadNotifications = useCallback(async () => {
    if (!uid) return;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await (supabase as any).from("notifications").select("*").eq("user_id", uid).gte("created_at", since).order("created_at", { ascending: false }).limit(50);
    if (error) console.warn("[notifications] fetch error:", error.message); else setItems(data ?? []);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    void loadNotifications();
    const refresh = window.setInterval(() => { setNow(Date.now()); void loadNotifications(); }, 60_000);
    const refreshOnFocus = () => { setNow(Date.now()); void loadNotifications(); };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    const ch = supabase.channel("notif-" + uid).on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + uid }, (payload: any) => {
      const n = payload.new as Notif;
      if (Date.now() - new Date(n.created_at).getTime() > 24 * 60 * 60 * 1000) return;
      setItems((cur) => [n, ...cur.filter((item) => item.id !== n.id)]);
      toast(n.title, { description: n.body ?? undefined });
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audio = new AudioContextClass(); const oscillator = audio.createOscillator(); const gain = audio.createGain();
          oscillator.type = "sine"; oscillator.frequency.setValueAtTime(880, audio.currentTime); oscillator.frequency.setValueAtTime(1174, audio.currentTime + 0.11);
          gain.gain.setValueAtTime(0.0001, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.025); gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.32);
          oscillator.connect(gain); gain.connect(audio.destination); void audio.resume(); oscillator.start(); oscillator.stop(audio.currentTime + 0.34); oscillator.onended = () => { void audio.close(); };
        }
      } catch {}
    }).subscribe();
    return () => {
      window.clearInterval(refresh);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      supabase.removeChannel(ch);
    };
  }, [uid, loadNotifications]);
  const visibleItems = items.filter((n) => now - new Date(n.created_at).getTime() <= 24 * 60 * 60 * 1000);
  const unread = visibleItems.filter((n) => !n.read_at).length;

  async function markAll() {
    if (!uid) return;
    const { error } = await (supabase as any)
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", uid)
      .is("read_at", null);
    if (error) {
      toast.error("تعذّر تعليم الإشعارات");
      return;
    }
    setItems((cur) => cur.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  }

  async function openNotifications() { setOpen(true); if (unread > 0) await markAll(); }
  function isCompanyNotification(n: Notif) { return /company|admin|provider_approved|provider_rejected|provider_suspended|support_message|coupon_received|coupon_redeemed|promotion|announcement/i.test(n.type); }

  if (!uid) return null;

  return (
    <>
      <button
        onClick={openNotifications}
        className="relative z-[60] h-11 w-11 rounded-2xl bg-card border border-border grid place-items-center btn-press shadow-sm"
        aria-label="الإشعارات"
      >
        <Bell className="h-5 w-5 text-foreground" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[2147483000] isolate bg-black/55 backdrop-blur-md"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute top-0 right-0 left-0 bg-background rounded-b-[28px] p-5 pt-[max(1.25rem,env(safe-area-inset-top))] max-h-[82vh] overflow-y-auto shadow-2xl border-b border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div><h2 className="font-black text-lg">مركز الإشعارات</h2><p className="text-[10px] text-muted-foreground mt-1">إشعارات آخر 24 ساعة</p></div>
              {unread > 0 && (
                <button
                  onClick={markAll}
                  className="text-xs font-bold text-primary inline-flex items-center gap-1"
                >
                  <Check className="h-3 w-3" /> تعليم الكل
                </button>
              )}
            </div>
            {visibleItems.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">لا توجد إشعارات</div>
            ) : (
              <ul className="space-y-2">
                {visibleItems.map((n) => {
                  const official = isCompanyNotification(n);
                  const content = (
                    <div className="flex items-start gap-3">
                      <div className={official ? "mt-0.5 h-10 w-10 shrink-0 rounded-2xl grid place-items-center bg-gradient-to-br from-amber-300/30 to-yellow-600/15 border border-amber-400/50 text-amber-500" : "mt-0.5 h-10 w-10 shrink-0 rounded-2xl grid place-items-center bg-primary/10 text-primary"}>{official ? <span className="text-lg">✦</span> : <Bell className="h-4 w-4" />}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center flex-wrap gap-1.5">
                          <div className={official ? "font-black text-sm text-amber-600 dark:text-amber-300 font-serif" : "font-black text-sm text-foreground"}>{n.title}</div>
                          {official && <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-black text-amber-600 dark:text-amber-300">✓ رسمي · ممنون</span>}
                          {!n.read_at && <span className="h-2 w-2 rounded-full bg-primary" />}</div>
                        {n.body && <div className={official ? "text-xs leading-6 mt-1 text-amber-900/80 dark:text-amber-100/80" : "text-xs leading-6 mt-1 text-muted-foreground"}>{n.body}</div>}
                        <div className="text-[10px] text-muted-foreground mt-2">{new Date(n.created_at).toLocaleString("ar-IQ")}</div>
                      </div>
                    </div>
                  );
                  return <li key={n.id} className={official ? "rounded-2xl border border-amber-400/50 p-3.5 shadow-sm bg-gradient-to-br from-amber-50/80 to-card dark:from-amber-950/30 dark:to-card" : "rounded-2xl border border-border p-3.5 shadow-sm " + (!n.read_at ? "bg-primary/5" : "bg-card")}>
                    {n.link?.startsWith("/") ? <Link to={n.link as any} onClick={() => setOpen(false)} className="block">{content}</Link> : content}
                  </li>;
                })}
              </ul>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
