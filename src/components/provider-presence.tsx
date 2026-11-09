import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "@/lib/toast";

const SEND_EVERY_MS = 30_000;

/** Publishes fresh, verified provider coordinates while the provider is available. */
export function ProviderPresence() {
  const { session, roles } = useAuth();
  const uid = session?.user.id;
  const hasDriverRole = roles.includes("driver");
  const hasWorkerRole = roles.includes("worker");
  const isProvider = hasDriverRole || hasWorkerRole;

  useEffect(() => {
    if (!uid || !isProvider) return;
    let stopped = false;
    let last: GeolocationPosition | null = null;
    let lastSent = 0;

    const setUnavailable = async () => {
      const updates = [];
      if (hasDriverRole) {
        updates.push(supabase.from("driver_profiles").update({ available: false }).eq("user_id", uid));
      }
      if (hasWorkerRole) {
        updates.push(supabase.from("worker_profiles").update({ available: false }).eq("user_id", uid));
      }
      await Promise.all(updates);
      await supabase.from("provider_presence").delete().eq("user_id", uid);
    };

    const isAvailable = async () => {
      const [driver, worker] = await Promise.all([
        hasDriverRole
          ? supabase.from("driver_profiles")
              .select("available, is_verified, verification_status, status")
              .eq("user_id", uid).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        hasWorkerRole
          ? supabase.from("worker_profiles")
              .select("available, is_verified, verification_status, status")
              .eq("user_id", uid).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (driver.error || worker.error) return false;
      const driverReady = Boolean(driver.data?.available && driver.data.is_verified
        && driver.data.verification_status === "approved" && driver.data.status === "approved");
      const workerReady = Boolean(worker.data?.available && worker.data.is_verified
        && worker.data.verification_status === "approved" && worker.data.status === "approved");
      const someoneAvailable = Boolean(driver.data?.available || worker.data?.available);
      if (someoneAvailable && !driverReady && !workerReady) {
        await setUnavailable();
        toast.error("حسابك غير موثق حالياً؛ أوقفنا مشاركة موقعك");
      }
      return driverReady || workerReady;
    };

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      void setUnavailable();
      return;
    }

    const send = async (force = false) => {
      if (stopped || !last) return;
      if (!force && Date.now() - lastSent < SEND_EVERY_MS) return;
      if (!(await isAvailable())) return;
      lastSent = Date.now();
      const { error } = await supabase.from("provider_presence").upsert({
        user_id: uid,
        lat: last.coords.latitude,
        lng: last.coords.longitude,
        heading: last.coords.heading ?? null,
      }, { onConflict: "user_id" });
      if (error && !stopped) {
        await setUnavailable();
        toast.error("تعذّر تحديث موقعك؛ أوقفنا استقبال الطلبات");
      }
    };

    const watch = navigator.geolocation.watchPosition(
      (position) => {
        last = position;
        void send();
      },
      () => {
        if (stopped) return;
        void setUnavailable();
        toast.error("تعذّر الوصول إلى موقعك؛ أوقفنا استقبال الطلبات");
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    const timer = setInterval(() => void send(true), SEND_EVERY_MS);
    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watch);
      clearInterval(timer);
    };
  }, [uid, hasDriverRole, hasWorkerRole]);

  return null;
}
