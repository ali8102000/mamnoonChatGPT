import { useCallback, useEffect, useState } from "react";
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";

const IMPORTANT_NOTIFICATION_TYPES = /^(support_message|provider_approved|provider_rejected|provider_suspended|coupon_received|coupon_redeemed|announcement|company_announcement|admin_alert|security_alert|account_verified|verification_approved|subscription_expiring|subscription_expired|subscription_granted|subscription_admin_updated|subscription_extended)$/i;

function isImportantNotificationType(type: string) {
  return IMPORTANT_NOTIFICATION_TYPES.test(type);
}

type NotificationRow = { id: string; type: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

export function NotificationsBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [featured, setFeatured] = useState<NotificationRow | null>(null);
  const load = useCallback(async () => {
    if (!user?.id) return;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data, error }, { data: pendingGrant }] = await Promise.all([
      (supabase as any).from("notifications").select("id,type,title,body,link,read_at,created_at").eq("user_id", user.id).gte("created_at", since).order("created_at", { ascending: false }).limit(50),
      (supabase as any).from("notifications").select("id,type,title,body,link,read_at,created_at").eq("user_id",user.id).eq("type","subscription_granted").is("read_at",null).order("created_at",{ascending:false}).limit(5),
    ]);
    if (!error) {
      const merged=[...(pendingGrant??[]),...(data??[])].filter((item:NotificationRow,i:number,all:NotificationRow[])=>all.findIndex(x=>x.id===item.id)===i).filter((item:NotificationRow)=>isImportantNotificationType(item.type));
      setItems(merged);
      setFeatured(current=>current&&!current.read_at?current:merged.find((item:NotificationRow)=>!item.read_at&&(item.type==="subscription_granted"||item.type==="company_announcement"))??null);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void load();
    const refresh = setInterval(() => { setNow(Date.now()); void load(); }, 60_000);
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") { setNow(Date.now()); void load(); } });
    const channel = supabase.channel("native-notifications-" + user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + user.id }, (payload: any) => {
        const item = payload.new as NotificationRow;
        if ((Date.now() - new Date(item.created_at).getTime() <= 24 * 60 * 60 * 1000 || item.type === "subscription_granted") && isImportantNotificationType(item.type)) setItems((current) => [item, ...current.filter((row) => row.id !== item.id)]);
        if (item.type === "subscription_granted" || item.type === "company_announcement") setFeatured(item);
        // Request offers already receive a dedicated Expo push; other in-app events get a local audible alert.
        if (isImportantNotificationType(item.type)) {
          void Notifications.scheduleNotificationAsync({
            content: { title: item.title, body: item.body ?? undefined, sound: true, data: { url: item.link ?? "/home" } },
            trigger: null,
          }).catch((error) => console.warn("[notifications] local sound alert failed:", error));
        }
      }).subscribe();
    return () => { clearInterval(refresh); appState.remove(); supabase.removeChannel(channel); };
  }, [user?.id, load]);

  const visible = items.filter((item) => now - new Date(item.created_at).getTime() <= 24 * 60 * 60 * 1000);
  const unread = visible.filter((item) => !item.read_at).length;

  async function markAllRead() {
    if (!user?.id || unread === 0) return;
    const stamp = new Date().toISOString();
    const { error } = await (supabase as any).from("notifications").update({ read_at: stamp }).eq("user_id", user.id).is("read_at", null);
    if (!error) setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? stamp })));
  }

  async function showNotifications() {
    setOpen(true);
    await markAllRead();
  }

  function isOfficial(item: NotificationRow) {
    return /company|admin|provider_approved|provider_rejected|provider_suspended|announcement|security_alert|account_verified|verification_approved|subscription_expiring|subscription_expired|subscription_granted|subscription_admin_updated|subscription_extended/i.test(item.type);
  }

  function openItem(item: NotificationRow) {
    setOpen(false);
    if (item.link?.startsWith("/request/")) router.push({ pathname: "/request/[id]", params: { id: item.link.split("/").pop() || "" } });
    else if (item.link === "/profile") router.push("/profile");
    else if (item.link === "/home" || !item.link) router.push("/home");
  }

  async function dismissFeatured() {
    if (!featured || !user?.id) { setFeatured(null); return; }
    const stamp=new Date().toISOString();
    const {error}=await (supabase as any).from("notifications").update({read_at:stamp}).eq("id",featured.id).eq("user_id",user.id);
    if (!error) { setItems(current=>current.map(item=>item.id===featured.id?{...item,read_at:stamp}:item)); setFeatured(null); }
  }

  if (!user) return null;
  return (
    <>
      <Modal visible={!!featured} transparent animationType="fade" onRequestClose={dismissFeatured} statusBarTranslucent>
        <View style={styles.featuredScrim}>
          <View style={styles.featuredCard}>
            <View style={styles.featuredSeal}><Text style={styles.featuredSealText}>✦</Text></View>
            <Text style={styles.featuredKicker}>رسالة رسمية · شركة ممنون</Text>
            <Text style={styles.featuredTitle}>{featured?.title}</Text>
            <Text style={styles.featuredBody}>{featured?.body}</Text>
            <TouchableOpacity onPress={dismissFeatured} style={styles.featuredButton}><Text style={styles.featuredButtonText}>استلمت الرسالة</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
      <TouchableOpacity onPress={showNotifications} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel="الإشعارات" style={styles.bell}>
        <Text style={styles.bellIcon}>🔔</Text>
        {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text></View>}
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View><Text style={styles.title}>مركز الإشعارات</Text><Text style={styles.subtitle}>إشعارات آخر 24 ساعة</Text></View>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.close}><Text style={styles.closeText}>×</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.list}>
              {visible.length === 0 ? <Text style={styles.empty}>ما عندك إشعارات جديدة حالياً</Text> : visible.map((item) => {
                const official = isOfficial(item);
                return (
                  <TouchableOpacity key={item.id} activeOpacity={item.link ? 0.75 : 1} onPress={() => item.link && openItem(item)} style={[styles.item, official ? styles.officialItem : null]}>
                    <View style={[styles.iconWrap, official ? styles.officialIcon : null]}><Text style={[styles.iconText, official ? styles.officialIconText : null]}>{official ? "✦" : "•"}</Text></View>
                    <View style={styles.itemContent}>
                      <View style={styles.itemTitleRow}>
                        <Text style={[styles.itemTitle, official ? styles.officialTitle : null]}>{item.title}</Text>
                        {official && <Text style={styles.verified}>✓ رسمي · ممنون</Text>}
                        {!item.read_at && <View style={styles.unreadDot} />}
                      </View>
                      {!!item.body && <Text style={[styles.body, official ? styles.officialBody : null]}>{item.body}</Text>}
                      <Text style={styles.date}>{new Date(item.created_at).toLocaleString("ar-IQ")}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  featuredScrim:{flex:1,backgroundColor:"rgba(0,0,0,0.72)",alignItems:"center",justifyContent:"center",padding:22},
  featuredCard:{width:"100%",borderRadius:28,borderWidth:2,borderColor:palette.gold,backgroundColor:palette.goldSoft,padding:24,alignItems:"center",gap:10},
  featuredSeal:{width:64,height:64,borderRadius:32,backgroundColor:palette.goldSoft,borderWidth:1,borderColor:palette.gold,alignItems:"center",justifyContent:"center"},
  featuredSealText:{fontSize:34,color:palette.gold,fontWeight:"900"},
  featuredKicker:{fontSize:10,fontWeight:"900",color:palette.gold},
  featuredTitle:{fontSize:21,fontWeight:"900",color:palette.ink,textAlign:"center"},
  featuredBody:{fontSize:13,lineHeight:23,color:palette.muted,textAlign:"center"},
  featuredButton:{width:"100%",borderRadius:15,backgroundColor:palette.gold,padding:14,alignItems:"center",marginTop:8},
  featuredButtonText:{color:palette.brandDeep,fontWeight:"900",fontSize:13},
  bell: { width: 46, height: 46, borderRadius: 17, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "center", position: "relative" },
  bellIcon: { color: palette.ink, fontSize: 25, fontWeight: "900" },
  badge: { position: "absolute", top: -5, right: -5, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, backgroundColor: "#C83D3D", borderWidth: 2, borderColor: palette.canvas, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "900" },
  scrim: { flex: 1, backgroundColor: "rgba(10,15,12,0.55)", justifyContent: "flex-start" },
  sheet: { backgroundColor: palette.canvas, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, paddingTop: 58, paddingHorizontal: space.lg, paddingBottom: 18, maxHeight: "86%", borderBottomWidth: 1, borderColor: palette.gold },
  handle: { width: 42, height: 4, borderRadius: 3, backgroundColor: palette.line, alignSelf: "center", marginBottom: 17 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 15 },
  title: { color: palette.ink, fontSize: 21, fontWeight: "900", textAlign: "right" },
  subtitle: { color: palette.muted, fontSize: 11, marginTop: 4, textAlign: "right" },
  close: { width: 36, height: 36, borderRadius: 13, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
  closeText: { color: palette.ink, fontSize: 24, lineHeight: 27 },
  list: { gap: 10, paddingBottom: 18 },
  empty: { color: palette.muted, textAlign: "center", paddingVertical: 40, fontSize: 13 },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 11, padding: 14, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  officialItem: { backgroundColor: palette.goldSoft, borderColor: palette.gold, borderWidth: 1.4 },
  iconWrap: { width: 39, height: 39, borderRadius: 14, backgroundColor: palette.brandSoft, alignItems: "center", justifyContent: "center" },
  officialIcon: { backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: palette.gold },
  iconText: { color: palette.brand, fontSize: 22, fontWeight: "900" },
  officialIconText: { color: palette.gold },
  itemContent: { flex: 1 },
  itemTitleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  itemTitle: { color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right" },
  officialTitle: { color: palette.gold, fontFamily: "serif" },
  verified: { color: palette.gold, backgroundColor: palette.goldSoft, borderWidth: 1, borderColor: palette.gold, overflow: "hidden", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, fontSize: 9, fontWeight: "900" },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.brand },
  body: { color: palette.muted, fontSize: 12, lineHeight: 20, marginTop: 5, textAlign: "right" },
  officialBody: { color: "#6F5318" },
  date: { color: palette.muted, fontSize: 9, marginTop: 8, textAlign: "right" },
});
