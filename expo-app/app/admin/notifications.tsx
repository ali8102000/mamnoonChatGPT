import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { palette, radius, space } from "@/styles/theme";
import { getAdminStaffRoles } from "@/lib/admin-access";

type Target = "all" | "drivers" | "workers" | "single";
const TARGETS: { value: Target; label: string }[] = [
  { value: "all", label: "جميع المستخدمين" },
  { value: "drivers", label: "السائقون" },
  { value: "workers", label: "الفنيون" },
  { value: "single", label: "مستخدم محدد" },
];

export default function AdminNotificationsScreen() {
  const { user, loading: authLoading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [target, setTarget] = useState<Target>("all");
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);
  const [error, setError] = useState("");

  const sendNotification = useCallback(async () => {
    const { data, error: callError } = await supabase.functions.invoke("admin-users", {
      body: { action: "broadcast_notification", target, title: title.trim(), body: body.trim(), ...(target === "single" ? { user_id: userId.trim() } : {}) },
    });
    if (callError) throw new Error(callError.message || "تعذر الاتصال بخدمة الإشعارات");
    if (data?.error) throw new Error(data.error);
    return data;
  }, [target, title, body, userId]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) { setAllowed(false); return; }
    void (async () => {
      try {
        const roles = await getAdminStaffRoles(user.id);
        setAllowed(roles.some((role: string) => ["super_admin", "admin", "support", "finance", "moderator"].includes(role)));
      } catch {
        setAllowed(false);
      }
    })();
  }, [authLoading, user?.id]);

  const send = () => {
    if (title.trim().length < 1 || title.length > 200 || body.trim().length < 1 || body.length > 2000) {
      Alert.alert("تحقق من البيانات", "اكتب عنواناً ونصاً للإشعار ضمن الحدود المطلوبة."); return;
    }
    if (target === "single" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId.trim())) {
      Alert.alert("معرف المستخدم", "أدخل UUID صحيحاً للمستخدم المستهدف."); return;
    }
    Alert.alert("تأكيد إرسال الإشعار", target === "all" ? "سيصل الإشعار إلى جميع المستخدمين. هل تريد المتابعة؟" : "هل تريد إرسال الإشعار إلى الفئة المحددة؟", [
      { text: "رجوع", style: "cancel" },
      { text: "إرسال", onPress: async () => {
        setBusy(true); setError("");
        try {
          const result = await sendNotification();
          setSentCount(Number(result.sent ?? 0));
          setTitle(""); setBody(""); setUserId("");
          Alert.alert("تم الإرسال", `تم إرسال الإشعار إلى ${Number(result.sent ?? 0).toLocaleString("ar-IQ")} مستخدم.`);
        } catch (e: any) {
          setError(String(e?.message || "تعذر إرسال الإشعار"));
        } finally { setBusy(false); }
      } },
    ]);
  };

  if (authLoading || allowed === null) return <View style={s.center}><ActivityIndicator size="large" color={palette.brand}/><Text style={s.muted}>جاري التحقق من الصلاحيات...</Text></View>;
  if (allowed === false) return <View style={s.center}><Text style={s.title}>غير مصرّح</Text><Text style={s.muted}>هذه الصفحة متاحة للموظفين المخوّلين فقط.</Text></View>;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ title: "إرسال الإشعارات" }} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>إرسال إشعار من إدارة ممنون</Text>
        <Text style={s.muted}>اختر الفئة واكتب عنوان الإشعار ونصه. سيظهر للمستخدم داخل التطبيق.</Text>
        <Text style={s.label}>الهدف</Text>
        <View style={s.targets}>{TARGETS.map((item) => <TouchableOpacity key={item.value} onPress={() => setTarget(item.value)} style={[s.target, target === item.value && s.targetActive]}><Text style={[s.targetText, target === item.value && s.targetTextActive]}>{item.label}</Text></TouchableOpacity>)}</View>
        {target === "single" && <><Text style={s.label}>معرّف المستخدم UUID</Text><TextInput value={userId} onChangeText={setUserId} autoCapitalize="none" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" placeholderTextColor={palette.muted} style={s.input}/></>}
        <Text style={s.label}>عنوان الإشعار</Text>
        <TextInput value={title} onChangeText={setTitle} maxLength={200} placeholder="عنوان واضح ومختصر" placeholderTextColor={palette.muted} style={s.input} textAlign="right"/>
        <Text style={s.label}>نص الإشعار</Text>
        <TextInput value={body} onChangeText={setBody} maxLength={2000} multiline placeholder="اكتب تفاصيل الإشعار..." placeholderTextColor={palette.muted} style={[s.input,{minHeight:130,textAlignVertical:"top"}]} textAlign="right"/>
        {sentCount !== null && <Text style={s.success}>آخر إرسال ناجح: {sentCount.toLocaleString("ar-IQ")} مستخدم</Text>}
        {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text></View>}
        <TouchableOpacity disabled={busy || !title.trim() || !body.trim()} onPress={send} style={[s.send,busy&&{opacity:.55}]}><Text style={s.sendText}>{busy ? "جاري الإرسال..." : "إرسال الإشعار"}</Text></TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page:{flex:1,backgroundColor: palette.pageCanvas},
  content:{padding:space.lg,gap:10,paddingBottom:48},
  center:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor: palette.pageCanvas,padding:24,gap:10},
  title:{fontSize:21,fontWeight:"900",color:palette.ink,textAlign:"right"},
  muted:{fontSize:12,color:palette.muted,textAlign:"right",lineHeight:20},
  label:{fontSize:13,fontWeight:"900",color:palette.ink,textAlign:"right",marginTop:8},
  targets:{flexDirection:"row",flexWrap:"wrap",gap:7},
  target:{paddingHorizontal:12,paddingVertical:10,borderRadius:radius.md,borderWidth:1,borderColor:palette.line,backgroundColor:palette.surface},
  targetActive:{backgroundColor:palette.brand,borderColor:palette.brand},
  targetText:{fontSize:11,fontWeight:"800",color:palette.ink},
  targetTextActive:{color:palette.white},
  input:{backgroundColor:palette.surface,borderWidth:1,borderColor:palette.line,borderRadius:radius.md,padding:13,color:palette.ink},
  send:{minHeight:40,backgroundColor:palette.brand,borderRadius:16,paddingHorizontal:16,paddingVertical:8,alignItems:"center",justifyContent:"center",marginTop:8},
  sendText:{color:palette.white,fontSize:13,fontWeight:"900"},
  success:{color:"#15803d",fontSize:12,fontWeight:"800",textAlign:"right"},
  error:{backgroundColor:palette.dangerSoft,borderRadius:radius.md,padding:12},
  errorText:{color:palette.danger,fontSize:11,textAlign:"right"},
});
