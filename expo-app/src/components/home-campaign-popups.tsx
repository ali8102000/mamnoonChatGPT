import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { palette, radius, space } from "@/styles/theme";

type Campaign = {
  id: string;
  campaign_type: "poll" | "contest";
  title: string;
  description: string | null;
  image_url: string | null;
  popup_display_seconds: number;
  starts_at: string | null;
  ends_at: string | null;
  app_campaign_options: { id: string; label: string; sort_order: number }[];
};

export function HomeCampaignPopups({ userId, placementKey = "home.customer.content", campaignId, onClose }: { userId: string | null; placementKey?: string; campaignId?: string | null; onClose?: () => void }) {
  const [items, setItems] = useState<Campaign[]>([]);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [imageVisible, setImageVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error: queryError } = await (supabase as any)
      .from("app_campaigns")
      .select("id,campaign_type,title,description,image_url,popup_display_seconds,starts_at,ends_at,app_campaign_options(id,label,sort_order)")
      .eq("status", "published")
      .eq(campaignId ? "id" : "placement_key", campaignId || placementKey)
      .order("sort_order")
      .order("created_at", { ascending: false });
    if (queryError) { setError(queryError.message); setLoading(false); return; }
    const now = Date.now();
    const active = (data ?? []).filter((item: Campaign) => campaignId || (
      (!item.starts_at || new Date(item.starts_at).getTime() <= now) &&
      (!item.ends_at || new Date(item.ends_at).getTime() > now)
    ));
    setItems(active);
    if (userId && active.length) {
      const { data: own } = await (supabase as any).from("app_campaign_responses")
        .select("campaign_id,option_id").eq("user_id", userId).in("campaign_id", active.map((item: Campaign) => item.id));
      const ownMap: Record<string, string> = {};
      for (const row of own ?? []) ownMap[row.campaign_id] = row.option_id;
      setAnswered(ownMap);
    }
    setLoading(false);
  }, [placementKey, userId, campaignId]);

  useEffect(() => { void load(); }, [load]);

  const pending = campaignId ? (items.length ? { item: items[0], index: 0 } : undefined) : items.map((item, index) => ({ item, index })).find(({ item }) => !answered[item.id]);
  const current = pending?.item ?? null;
  useEffect(() => {
    setImageVisible(true);
    if (!current?.image_url) return;
    const seconds = Math.max(1, Math.min(60, Number(current.popup_display_seconds) || 5));
    const timer = setTimeout(() => setImageVisible(false), seconds * 1000);
    return () => clearTimeout(timer);
  }, [current?.id, current?.image_url, current?.popup_display_seconds]);

  const close = () => {
    if (current) setAnswered((old) => ({ ...old, [current.id]: "dismissed" }));
    onClose?.();
  };

  const vote = async (optionId: string) => {
    if (!current || !userId || saving) return;
    const now = Date.now();
    const votingOpen = (!current.starts_at || new Date(current.starts_at).getTime() <= now) && (!current.ends_at || new Date(current.ends_at).getTime() > now);
    if (!votingOpen) return;
    setSaving(true); setError("");
    const { error: voteError } = await (supabase as any).from("app_campaign_responses").insert({
      campaign_id: current.id, option_id: optionId, user_id: userId,
    });
    if (voteError) {
      if (voteError.code === "23505") setAnswered((old) => ({ ...old, [current.id]: optionId }));
      else setError("تعذر تسجيل إجابتك. حاول مرة ثانية.");
    } else setAnswered((old) => ({ ...old, [current.id]: optionId }));
    setSaving(false);
    if (!voteError) onClose?.();
  };

  if (loading || !current) return null;
  const options = [...(current.app_campaign_options ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const votingOpen = (!current.starts_at || new Date(current.starts_at).getTime() <= Date.now()) && (!current.ends_at || new Date(current.ends_at).getTime() > Date.now());
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", padding: space.lg }}>
        <View style={{ backgroundColor: palette.surface, borderRadius: radius.xl, padding: space.lg, maxHeight: "88%" }}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ color: palette.brand, fontWeight: "900", fontSize: 12 }}>{current.campaign_type === "contest" ? "مسابقة ممنون" : "استطلاع ممنون"}</Text>
              <Pressable onPress={close} accessibilityRole="button"><Text style={{ color: palette.muted, fontWeight: "900", padding: 8 }}>إغلاق ✕</Text></Pressable>
            </View>
            {current.image_url && imageVisible ? <Image source={{ uri: current.image_url }} resizeMode="contain" style={{ width: "100%", height: 190, borderRadius: radius.md, marginBottom: 14, backgroundColor: palette.pageCanvas }} /> : null}
            <Text style={{ color: palette.ink, fontSize: 19, fontWeight: "900", textAlign: "right" }}>{current.title}</Text>
            {current.description ? <Text style={{ color: palette.muted, fontSize: 12, textAlign: "right", marginTop: 6, lineHeight: 20 }}>{current.description}</Text> : null}
            <View style={{ gap: 9, marginTop: 16 }}>
              {options.map((option) => <Pressable key={option.id} disabled={saving || Boolean(answered[current.id]) || !votingOpen} onPress={() => void vote(option.id)} style={{ borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: 13, backgroundColor: palette.pageCanvas }}>
                <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "800", textAlign: "right" }}>{option.label}</Text>
              </Pressable>)}
            </View>
            {!userId ? <Text style={{ color: palette.muted, fontSize: 12, textAlign: "right", marginTop: 10 }}>سجّل الدخول حتى تشارك.</Text> : null}
            {!votingOpen ? <Text style={{ color: palette.muted, fontSize: 12, textAlign: "right", marginTop: 10 }}>انتهى وقت المشاركة أو لم تبدأ الحملة بعد.</Text> : null}
            {answered[current.id] ? <Text style={{ color: palette.brand, fontSize: 12, fontWeight: "800", textAlign: "right", marginTop: 10 }}>سبق وسجلت مشاركتك بهذه الحملة.</Text> : null}
            {saving ? <ActivityIndicator color={palette.brand} style={{ marginTop: 12 }} /> : null}
            {error ? <Text style={{ color: palette.danger, fontSize: 12, textAlign: "right", marginTop: 10 }}>{error}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
