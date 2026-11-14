import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import service_build from "../../assets/services/build.png";
import service_plaster from "../../assets/services/plaster.png";
import service_carpentry_form from "../../assets/services/carpentry_form.png";
import service_flooring from "../../assets/services/flooring.png";
import service_chef from "../../assets/services/chef.png";
import service_plumbing from "../../assets/services/plumbing.png";
import service_electric_setup from "../../assets/services/electric_setup.png";
import service_electric_street from "../../assets/services/electric_street.png";
import service_washer_repair from "../../assets/services/washer_repair.png";
import service_stove_repair from "../../assets/services/stove_repair.png";
import service_fridge_repair from "../../assets/services/fridge_repair.png";
import service_ac_repair from "../../assets/services/ac_repair.png";
import service_cleaning from "../../assets/services/cleaning.png";
import service_wood_carpentry from "../../assets/services/wood_carpentry.png";
import service_blacksmith from "../../assets/services/blacksmith.png";
import service_general from "../../assets/services/general.png";
import type { AppRole } from "@/lib/auth-context";

type Offer = {
  id: string;
  request_id: string;
  distance_km: number | null;
  expires_at: string;
  service_requests: {
    id: string;
    type: "taxi" | "service";
    status: string;
    pickup_text: string;
    dest_text: string | null;
    notes: string | null;
    work_description: string | null;
    price_estimate: number | null;
    customer_price: number | null;
    pricing_mode: string | null;
    work_hours: number | null;
    workers_count: number | null;
    service_id: string | null;
    services: { name_ar: string; slug: string; icon: string } | null;
  };
};

const SERVICE_IMAGES: Record<string, number> = {
  build: service_build,
  plaster: service_plaster,
  carpentry_form: service_carpentry_form,
  flooring: service_flooring,
  chef: service_chef,
  plumbing: service_plumbing,
  electric_setup: service_electric_setup,
  electric_street: service_electric_street,
  washer_repair: service_washer_repair,
  stove_repair: service_stove_repair,
  fridge_repair: service_fridge_repair,
  ac_repair: service_ac_repair,
  cleaning: service_cleaning,
  wood_carpentry: service_wood_carpentry,
  blacksmith: service_blacksmith,
  general: service_general,
}

export function IncomingRequestModal() {
  const { user, roles } = useAuth();
  const canReceive = roles.some((role: AppRole) => role === "driver" || role === "large_driver" || role === "worker");
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [visible, setVisible] = useState(false);

  const loadOffer = useCallback(async () => {
    if (!user || !canReceive) {
      setOffer(null);
      setVisible(false);
      return;
    }
    const { data, error } = await (supabase as any)
      .from("request_offers")
      .select("id, request_id, distance_km, expires_at, service_requests!inner(id, type, status, pickup_text, dest_text, notes, work_description, price_estimate, customer_price, pricing_mode, work_hours, workers_count, service_id, services(name_ar, slug, icon))")
      .eq("provider_id", user.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[incoming-offer] Could not load targeted offer:", error.message);
      return;
    }
    if (data?.service_requests?.status === "pending" || data?.service_requests?.status === "searching") {
      setOffer(data as Offer);
      setVisible(true);
    } else {
      setOffer(null);
      setVisible(false);
    }
  }, [user, canReceive]);

  useEffect(() => {
    void loadOffer();
    if (!user || !canReceive) return;
    const channel = supabase
      .channel(`incoming-offers-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "request_offers",
          filter: `provider_id=eq.${user.id}`,
        },
        () => void loadOffer(),
      )
      .subscribe();
    const timer = setInterval(() => void loadOffer(), 8000);
    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [user, canReceive, loadOffer]);

  const request = offer?.service_requests;
  const serviceSlug = request?.services?.slug ?? "";
  const imageSource = useMemo(() => SERVICE_IMAGES[serviceSlug], [serviceSlug]);
  const amount = request?.customer_price ?? request?.price_estimate;
  const code = offer?.request_id.slice(-6).toUpperCase();

  async function respond(action: "accept" | "reject") {
    if (!offer || busy) return;
    setBusy(action);
    try {
      if (action === "accept") {
        const { error } = await supabase.rpc("accept_service_request", {
          _request_id: offer.request_id,
        });
        if (error) throw error;
        setVisible(false);
        setOffer(null);
        router.push({ pathname: "/request/[id]", params: { id: offer.request_id } });
      } else {
        const { error } = await supabase.rpc("reject_request_offer", {
          _offer_id: offer.id,
        });
        if (error) throw error;
        setVisible(false);
        setOffer(null);
        await loadOffer();
      }
    } catch (error) {
      Alert.alert(
        "تعذّر تنفيذ الطلب",
        error instanceof Error ? error.message : "انتهت صلاحية العرض أو لم يعد متاحاً.",
      );
      await loadOffer();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      visible={visible && Boolean(offer && request)}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setVisible(false)}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.topLine}>
            <View style={styles.pulse} />
            <Text style={styles.topText}>طلب جديد موجّه إلك</Text>
            <Text style={styles.code}>#{code}</Text>
          </View>

          <View style={styles.serviceRow}>
            {imageSource ? (
              <Image source={imageSource} style={styles.serviceImage} resizeMode="cover" />
            ) : (
              <View style={styles.taxiImage}>
                <Text style={styles.taxiEmoji}>{request?.type === "taxi" ? "🚕" : "🛠️"}</Text>
              </View>
            )}
            <View style={styles.serviceInfo}>
              <Text style={styles.serviceTitle}>
                {request?.type === "taxi" ? "طلب سيارة" : request?.services?.name_ar ?? "خدمة منزلية"}
              </Text>
              <Text style={styles.distance}>
                {offer?.distance_km != null ? `يبعد عنك ${Number(offer.distance_km).toFixed(1)} كم` : "طلب قريب منك"}
              </Text>
            </View>
          </View>

          <View style={styles.details}>
            <Text style={styles.detailLabel}>موقع الزبون</Text>
            <Text style={styles.detailValue}>{request?.pickup_text || "لم يحدد وصف الموقع"}</Text>
            {request?.dest_text ? (
              <>
                <Text style={styles.detailLabel}>الوجهة</Text>
                <Text style={styles.detailValue}>{request.dest_text}</Text>
              </>
            ) : null}
            {request?.work_description || request?.notes ? (
              <>
                <Text style={styles.detailLabel}>تفاصيل العمل</Text>
                <Text style={styles.detailValue}>{request.work_description || request.notes}</Text>
              </>
            ) : null}
            <Text style={styles.detailLabel}>عدد العاملين</Text>
            <Text style={styles.detailValue}>{request?.workers_count ?? 1}</Text>
            {request?.work_hours != null ? (
              <>
                <Text style={styles.detailLabel}>ساعات العمل المتوقعة</Text>
                <Text style={styles.detailValue}>{request.work_hours} ساعة</Text>
              </>
            ) : null}
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>الأجر المعروض</Text>
            <Text style={styles.priceValue}>
              {amount != null ? `${Number(amount).toLocaleString("en")} د.ع${request?.pricing_mode === "hourly" ? " / ساعة" : ""}` : "قابل للتفاوض"}
            </Text>
          </View>

          <Text style={styles.expiry}>العرض مؤقت؛ اقبله قبل انتهاء المهلة.</Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.action, styles.reject]}
              onPress={() => void respond("reject")}
              disabled={Boolean(busy)}
            >
              <Text style={styles.rejectText}>رفض</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.action, styles.accept]}
              onPress={() => void respond("accept")}
              disabled={Boolean(busy)}
            >
              {busy === "accept" ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>قبول الطلب</Text>}
            </TouchableOpacity>
          </View>
          {busy === "reject" ? <ActivityIndicator style={{ marginTop: 10 }} color="#64748b" /> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.68)", justifyContent: "center", padding: 18 },
  card: { backgroundColor: "#fff", borderRadius: 26, padding: 18, elevation: 16 },
  topLine: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  pulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#16a34a" },
  topText: { flex: 1, color: "#0f766e", fontSize: 15, fontWeight: "900" },
  code: { color: "#64748b", fontSize: 12, fontWeight: "800" },
  serviceRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  serviceImage: { width: 78, height: 78, borderRadius: 18, backgroundColor: "#f1f5f9" },
  taxiImage: { width: 78, height: 78, borderRadius: 18, backgroundColor: "#e0f2fe", alignItems: "center", justifyContent: "center" },
  taxiEmoji: { fontSize: 34 },
  serviceInfo: { flex: 1 },
  serviceTitle: { color: "#0f172a", fontSize: 20, fontWeight: "900" },
  distance: { color: "#64748b", fontSize: 13, marginTop: 5 },
  details: { backgroundColor: "#f8fafc", borderRadius: 16, padding: 13 },
  detailLabel: { color: "#64748b", fontSize: 11, fontWeight: "800", marginTop: 5 },
  detailValue: { color: "#1e293b", fontSize: 13, fontWeight: "600", marginTop: 2, lineHeight: 20 },
  priceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
  priceLabel: { color: "#475569", fontSize: 13, fontWeight: "700" },
  priceValue: { color: "#0f766e", fontSize: 18, fontWeight: "900" },
  expiry: { color: "#b45309", fontSize: 11, marginTop: 10, textAlign: "center" },
  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  action: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  reject: { backgroundColor: "#f1f5f9" },
  accept: { backgroundColor: "#0f766e" },
  rejectText: { color: "#475569", fontWeight: "800" },
  acceptText: { color: "#fff", fontWeight: "900" },
});
