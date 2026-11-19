import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";
import { normalizePhone, isValidPhone } from "@/lib/phone";
import { useAuth } from "@/lib/auth-context";
import { Button, RealInput } from "@/components/ui";
import { palette, radius, space } from "@/styles/theme";
import { useThemePreference, type ThemeMode } from "@/lib/theme-preference";
import { loadNotificationPreferences, setNotificationPreferences } from "@/lib/notification-sound";
import Svg, { Path } from "react-native-svg";

export default function AccountSettingsScreen() {
  const { user, profile, roles, refresh, activeRole, setActiveRole } = useAuth();
  const { mode, setMode } = useThemePreference();
  const actualEmail = (() => { const candidate = String(user?.email ?? "").trim().toLowerCase(); return candidate && !/^phone\d+@mamnoon\.app$/.test(candidate) ? candidate : ""; })();
  const [email, setEmail] = useState(actualEmail);
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [otp, setOtp] = useState("");
  const [phonePending, setPhonePending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switchingRole, setSwitchingRole] = useState<string | null>(null);
  const [notificationSound, setNotificationSound] = useState(true);
  const [notificationVibration, setNotificationVibration] = useState(true);
  const [notificationPrefsBusy, setNotificationPrefsBusy] = useState(false);
  const [companyName, setCompanyName] = useState("شركة ممنون");
  const [partnerFormOpen, setPartnerFormOpen] = useState(false);
  const [partnerType, setPartnerType] = useState<"hotel" | "restaurant" | "store" | "mall">("hotel");
  const [partnerName, setPartnerName] = useState("");
  const [partnerContact, setPartnerContact] = useState(profile?.full_name ?? "");
  const [partnerPhone, setPartnerPhone] = useState(profile?.phone ?? "");
  const [partnerEmail, setPartnerEmail] = useState(actualEmail);
  const [partnerGovernorate, setPartnerGovernorate] = useState("najaf");
  const [partnerCity, setPartnerCity] = useState("");
  const [partnerAddress, setPartnerAddress] = useState("");
  const [partnerDescription, setPartnerDescription] = useState("");
  const [partnerApplications, setPartnerApplications] = useState<any[]>([]);
  const [partnerBusy, setPartnerBusy] = useState(false);
  const governorateLabels: Record<string,string> = {baghdad:"بغداد",basra:"البصرة",nineveh:"نينوى",erbil:"أربيل",sulaymaniyah:"السليمانية",duhok:"دهوك",kirkuk:"كركوك",najaf:"النجف",karbala:"كربلاء",babil:"بابل",anbar:"الأنبار",diyala:"ديالى",saladin:"صلاح الدين",wasit:"واسط",dhiqar:"ذي قار",maysan:"ميسان",muthanna:"المثنى",qadisiyah:"القادسية"};

  const isCompanyAdmin = user?.email?.toLowerCase() === "a7md0555666@gmail.com" && roles.includes("super_admin");

  useEffect(() => { setEmail(actualEmail); }, [actualEmail]);
  useEffect(() => { if (user?.id) void loadPartnerApplications(); }, [user?.id]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const local = await loadNotificationPreferences();
      let next = local;
      if (user?.id) {
        const full = await (supabase as any).from("user_push_tokens")
          .select("sound_enabled,vibration_enabled").eq("user_id", user.id).limit(1).maybeSingle();
        if (!full.error && full.data) {
          next = {
            soundEnabled: typeof full.data.sound_enabled === "boolean" ? full.data.sound_enabled : local.soundEnabled,
            vibrationEnabled: typeof full.data.vibration_enabled === "boolean" ? full.data.vibration_enabled : local.vibrationEnabled,
          };
        } else if (full.error?.code === "42703" || full.error?.message?.toLowerCase().includes("vibration_enabled")) {
          const legacy = await (supabase as any).from("user_push_tokens")
            .select("sound_enabled").eq("user_id", user.id).limit(1).maybeSingle();
          if (!legacy.error && typeof legacy.data?.sound_enabled === "boolean") {
            next = { ...local, soundEnabled: legacy.data.sound_enabled };
          }
        }
      }
      if (!active) return;
      setNotificationSound(next.soundEnabled);
      setNotificationVibration(next.vibrationEnabled);
      await setNotificationPreferences(next);
    })().catch((error) => console.warn("[notifications] Could not load account preferences:", error));
    return () => { active = false; };
  }, [user?.id]);

  async function saveNotificationPreference(next: { soundEnabled: boolean; vibrationEnabled: boolean }) {
    setNotificationSound(next.soundEnabled);
    setNotificationVibration(next.vibrationEnabled);
    await setNotificationPreferences(next);
    if (!user?.id) return;
    setNotificationPrefsBusy(true);
    try {
      const { error } = await (supabase as any).from("user_push_tokens")
        .update({ sound_enabled: next.soundEnabled, vibration_enabled: next.vibrationEnabled, updated_at: new Date().toISOString() })
        .eq("user_id", user.id);
      if (error && (error.code === "42703" || error.message?.toLowerCase().includes("vibration_enabled"))) {
        const fallback = await (supabase as any).from("user_push_tokens")
          .update({ sound_enabled: next.soundEnabled, updated_at: new Date().toISOString() })
          .eq("user_id", user.id);
        if (fallback.error) console.warn("[notifications] Could not sync sound preference:", fallback.error.message);
      } else if (error) {
        console.warn("[notifications] Could not sync preferences:", error.message);
      }
    } finally {
      setNotificationPrefsBusy(false);
    }
  }

  async function loadPartnerApplications() {
    if (!user?.id) return;
    const { data, error } = await (supabase as any).from("partner_applications")
      .select("id,partner_type,business_name,status,admin_note,created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(10);
    if (error) { console.warn("[partner-applications] load failed:", error.message); return; }
    setPartnerApplications(data ?? []);
  }

  async function submitPartnerApplication() {
    if (!user?.id) return;
    if (partnerName.trim().length < 2 || partnerContact.trim().length < 2 || partnerPhone.trim().length < 7 || partnerCity.trim().length < 2 || partnerAddress.trim().length < 4) {
      Alert.alert("بيانات ناقصة", "كمّل اسم المنشأة واسم المسؤول والهاتف والمدينة والعنوان.");
      return;
    }
    setPartnerBusy(true);
    try {
      const { error } = await (supabase as any).from("partner_applications").insert({
        user_id: user.id, partner_type: partnerType, business_name: partnerName.trim(),
        contact_name: partnerContact.trim(), phone: partnerPhone.trim(),
        email: partnerEmail.trim() || null, governorate_key: partnerGovernorate,
        city: partnerCity.trim(), address: partnerAddress.trim(),
        description: partnerDescription.trim() || null,
        mall_unit_type: partnerType === "store" ? "shop" : partnerType === "mall" ? "mall" : null
      });
      if (error) throw error;
      Alert.alert("تم إرسال الطلب", "وصل طلب الشراكة إلى إدارة ممنون وبانتظار المراجعة.");
      setPartnerFormOpen(false);
      setPartnerName(""); setPartnerCity(""); setPartnerAddress(""); setPartnerDescription("");
      await loadPartnerApplications();
    } catch (error) {
      Alert.alert("تعذر إرسال الطلب", error instanceof Error ? error.message : "حاول مرة ثانية.");
    } finally { setPartnerBusy(false); }
  }


  useEffect(() => {
    if (!isCompanyAdmin) return;
    (supabase as any).from("company_settings").select("company_name").eq("id", 1).maybeSingle()
      .then(({ data }: any) => { if (data?.company_name) setCompanyName(data.company_name); });
  }, [isCompanyAdmin]);

  async function switchRole(role: string) {
    if (switchingRole) return;
    if (!user?.id || !roles.includes(role as (typeof roles)[number])) {
      Alert.alert("تعذر تبديل الدور", "تأكد من تسجيل الدخول وامتلاكك لهذا الدور.");
      return;
    }

    setSwitchingRole(role);
    try {
      const { data: before, error: beforeError } = await supabase.auth.getSession();
      if (beforeError) throw beforeError;
      if (!before.session || before.session.user.id !== user.id) {
        throw new Error("انتهت جلسة الدخول. سجّل الدخول من جديد قبل تبديل الدور.");
      }

      await setActiveRole(role as (typeof roles)[number]);

      // Role switching changes only the local role preference; it must never
      // sign out or replace the authenticated Supabase session.
      const { data: after, error: afterError } = await supabase.auth.getSession();
      if (afterError) throw afterError;
      if (!after.session || after.session.user.id !== user.id) {
        throw new Error("جلسة الحساب تغيّرت أثناء التبديل. لم نكمل الانتقال حفاظاً على حسابك.");
      }

      router.replace("/home");
    } catch (error) {
      Alert.alert("تعذر تبديل الدور", error instanceof Error ? error.message : "حدث خطأ غير متوقع. حاول مرة ثانية.");
    } finally {
      setSwitchingRole(null);
    }
  }

  function startRegistration(role: "driver" | "large_driver" | "worker") {
    if (role === "large_driver") {
      router.push({ pathname: "/onboarding/driver", params: { providerType: "large_driver" } });
    } else if (role === "driver") {
      router.push("/onboarding/driver");
    } else {
      router.push("/onboarding/worker");
    }
  }

  async function saveCompanyName() {
    const next = companyName.trim().replace(/\s+/g, " ");
    if (next.length < 2 || next.length > 60) { Alert.alert("تنبيه", "اسم الشركة لازم يكون بين حرفين و60 حرفاً"); return; }
    if (!isCompanyAdmin || !user?.id) { Alert.alert("غير مخوّل", "هذه الصلاحية لحساب مالك شركة ممنون فقط"); return; }
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("company_settings")
        .upsert({ id: 1, company_name: next, updated_by: user.id }, { onConflict: "id" });
      if (error) throw error;
      Alert.alert("تم", "تم تحديث اسم الشركة الظاهر للمستخدمين.");
    } catch (e) { Alert.alert("تعذر تحديث الاسم", e instanceof Error ? e.message : "حدث خطأ"); }
    finally { setBusy(false); }
  }

  async function changeEmail() {
    const next = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      Alert.alert("تنبيه", "أدخل بريداً إلكترونياً صحيحاً"); return;
    }
    if (next === actualEmail) {
      Alert.alert("معلومة", "هذا هو بريدك الحالي"); return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser(
        { email: next },
        { emailRedirectTo: Linking.createURL("/auth/callback") },
      );
      if (error) throw error;
      Alert.alert("تم إرسال رسالة التأكيد", "افتح الرسالة في البريد الجديد واضغط رابط التأكيد حتى يتغير بريد حسابك.");
    } catch (e) {
      Alert.alert("تعذر تغيير البريد", e instanceof Error ? e.message : "حدث خطأ");
    } finally { setBusy(false); }
  }

  async function requestPhoneChange() {
    if (!isValidPhone(phone)) { Alert.alert("تنبيه", "رقم الهاتف غير صحيح"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ phone: normalizePhone(phone) });
      if (error) throw error;
      setPhonePending(true);
      Alert.alert("أرسلنا رمز التحقق", "أدخل رمز SMS الذي وصل إلى رقم الهاتف الجديد.");
    } catch (e) {
      Alert.alert("تعذر إرسال الرمز", e instanceof Error ? e.message : "تأكد من تفعيل مزود SMS في Supabase.");
    } finally { setBusy(false); }
  }

  async function verifyPhone() {
    if (!otp.trim()) { Alert.alert("تنبيه", "أدخل رمز التحقق"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: normalizePhone(phone), token: otp.trim(), type: "phone_change",
      });
      if (error) throw error;
      await refresh();
      setPhonePending(false); setOtp("");
      Alert.alert("تم", "تم تأكيد رقم الهاتف وتحديثه في حسابك.");
    } catch (e) {
      Alert.alert("فشل التحقق", e instanceof Error ? e.message : "رمز التحقق غير صحيح");
    } finally { setBusy(false); }
  }

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    <Text style={styles.kicker}>MAMNOON · ACCOUNT</Text>
    <Text style={styles.title}>إعدادات حسابك</Text>
    <Text style={styles.subtitle}>إدارة أدوارك وبيانات التواصل بأمان</Text>
    {isCompanyAdmin && <View style={styles.nameSection}>
      <Text style={styles.sectionTitle}>اسم الشركة الظاهر للمستخدمين</Text>
      <Text style={styles.note}>يظهر هذا الاسم في رسائل انتظار الموافقة والتنبيهات بدلاً من اسم الشخص.</Text>
      <RealInput value={companyName} onChangeText={setCompanyName} placeholder="مثال: شركة ممنون" maxLength={60} />
      <View style={{ height: 12 }} />
      <Button title="حفظ اسم الشركة" onPress={saveCompanyName} loading={busy} />
    </View>}
    <Text style={styles.sectionTitle}>مظهر التطبيق</Text>
    <Text style={styles.note}>اختار الوضع اللي يناسبك، وينحفظ على جهازك.</Text>
    <View style={styles.roleGrid}>{([{key:"system",label:"حسب الجهاز"},{key:"light",label:"نهاري"},{key:"dark",label:"ليلي"}] as const).map((item)=><TouchableOpacity key={item.key} onPress={()=>{void setMode(item.key as ThemeMode);}} style={[styles.roleCard,{minHeight:58,backgroundColor:mode===item.key?palette.brandSoft:palette.surface,borderColor:mode===item.key?palette.brand:palette.line}]}><Text style={[styles.roleTitle,{color:palette.ink}]}>{item.label}{mode===item.key?" ✓":""}</Text></TouchableOpacity>)}</View>
    <Text style={styles.sectionTitle}>إعدادات الإشعارات</Text>
    <Text style={styles.note}>تحكم بصوت واهتزاز تنبيهات ممنون. تنحفظ الإعدادات على جهازك وتتزامن مع أجهزة الحساب المسجلة.</Text>
    <View style={styles.notificationPrefsCard}>
      <View style={styles.notificationPrefsRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.notificationPrefsTitle}>صوت الإشعارات</Text>
          <Text style={styles.notificationPrefsHint}>تشغيل أو كتم صوت التنبيهات</Text>
        </View>
        <TouchableOpacity disabled={notificationPrefsBusy} onPress={() => void saveNotificationPreference({ soundEnabled: !notificationSound, vibrationEnabled: notificationVibration })} style={[styles.notificationPrefsToggle, notificationSound && styles.notificationPrefsToggleOn]}>
          <Text style={[styles.notificationPrefsToggleText, notificationSound && styles.notificationPrefsToggleTextOn]}>{notificationSound ? "مفعّل" : "مكتوم"}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.notificationPrefsDivider} />
      <View style={styles.notificationPrefsRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.notificationPrefsTitle}>اهتزاز الإشعارات</Text>
          <Text style={styles.notificationPrefsHint}>تشغيل أو إيقاف الاهتزاز</Text>
        </View>
        <TouchableOpacity disabled={notificationPrefsBusy} onPress={() => void saveNotificationPreference({ soundEnabled: notificationSound, vibrationEnabled: !notificationVibration })} style={[styles.notificationPrefsToggle, notificationVibration && styles.notificationPrefsToggleOn]}>
          <Text style={[styles.notificationPrefsToggleText, notificationVibration && styles.notificationPrefsToggleTextOn]}>{notificationVibration ? "مفعّل" : "متوقف"}</Text>
        </TouchableOpacity>
      </View>
      {notificationPrefsBusy && <Text style={styles.notificationPrefsHint}>جارٍ حفظ الإعدادات...</Text>}
    </View>
    {roles.filter((role) => ["customer", "worker", "driver", "large_driver"].includes(role)).length > 1 && <>
      <View style={styles.roleSectionHeading}>
        <View style={styles.roleSwitchIcon}>
          <Svg width={25} height={25} viewBox="0 0 24 24">
            <Path d="M7 7h9a3 3 0 0 1 3 3v1m0 0-3-3m3 3 3-3M17 17H8a3 3 0 0 1-3-3v-1m0 0 3 3m-3-3-3 3" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.roleSectionTitle}>تبديل الدور</Text>
          <Text style={styles.roleSectionHint}>بدّل بين الأدوار المرتبطة بحسابك</Text>
        </View>
      </View>
      <View style={styles.roleGrid}>
        {["customer", "worker", "driver", "large_driver"].filter((role) => roles.includes(role as any)).map((role) => {
          const selected = role === "customer"
            ? { title: "الزبون", mark: "ز", backgroundColor: palette.goldSoft, color: palette.brand }
            : role === "worker"
              ? { title: "الفني", mark: "ف", backgroundColor: palette.brandSoft, color: palette.brand }
              : role === "large_driver"
                ? { title: "سيارات كبيرة", mark: "ك", backgroundColor: palette.goldSoft, color: palette.gold }
                : { title: "كابتن تكسي", mark: "س", backgroundColor: palette.brandSoft, color: palette.brand };
          return (
            <TouchableOpacity key={role} disabled={switchingRole !== null} activeOpacity={0.82} style={[styles.roleCard, { backgroundColor: selected.backgroundColor, opacity: switchingRole && switchingRole !== role ? 0.55 : 1 }, activeRole === role && styles.roleCardActive]} onPress={() => switchRole(role)}>
              <View style={styles.roleMark}><Text style={styles.roleEmoji}>{selected.mark}</Text></View>
              <Text style={[styles.roleTitle, { color: selected.color }]}>{selected.title}</Text>
              <Text style={[styles.roleHint, { color: selected.color }]}>{switchingRole === role ? "جاري التبديل..." : activeRole === role ? "المساحة الحالية" : "التبديل إلى هذا الدور"}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>}
    <View style={styles.joinSection}>
      <View style={styles.roleSectionHeading}>
        <View style={[styles.roleSwitchIcon, { backgroundColor: palette.gold }]}>
          <Text style={{ color: palette.brandDeep, fontSize: 22, fontWeight: "900" }}>م</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.roleSectionTitle}>سجّل معنا</Text>
          <Text style={styles.roleSectionHint}>حسابك يبدأ كزبون، واختار مجال العمل إذا تحب تنضم إلينا</Text>
        </View>
      </View>
      <View style={styles.registrationList}>
        {([
          { key: "driver", title: "كابتن تكسي", detail: "بيانات السيارة والهوية", mark: "س" },
          { key: "large_driver", title: "سائق سيارات كبيرة", detail: "كيا حمل أو كيا ركاب أو باص", mark: "ك" },
          { key: "worker", title: "فني أو مقدم خدمة", detail: "اختيار المهن والاختصاصات وتوثيق الهوية", mark: "ف" },
        ] as const).map((item) => (
          <TouchableOpacity key={item.key} activeOpacity={0.82} style={styles.registrationCard} onPress={() => startRegistration(item.key)}>
            <View style={styles.registrationMark}><Text style={styles.registrationMarkText}>{item.mark}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.registrationTitle}>{item.title}</Text>
              <Text style={styles.registrationHint}>{item.detail}</Text>
            </View>
            <Text style={styles.registrationAction}>{roles.includes(item.key as any) ? "متابعة / تحديث" : "ابدأ التسجيل"}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.partnerJoinBox}>
        <Text style={styles.partnerJoinTitle}>انضم كشريك</Text>
        <Text style={styles.note}>سجّل منشأتك بفندق أو مطعم أو محل أو مول، وطلبك يروح للإدارة للمراجعة.</Text>
        <TouchableOpacity activeOpacity={0.85} onPress={() => setPartnerFormOpen(v => !v)} style={styles.partnerJoinButton}>
          <Text style={styles.partnerJoinButtonText}>{partnerFormOpen ? "إغلاق تسجيل الشريك" : "انضم كشريك"}</Text>
        </TouchableOpacity>
        {partnerFormOpen && <View style={styles.partnerForm}>
          <Text style={styles.partnerLabel}>اختار نوع الشراكة</Text>
          <View style={styles.partnerTypeGrid}>
            {([{key:"hotel",label:"🏨 فندق"},{key:"restaurant",label:"🍽️ مطعم"},{key:"store",label:"🏪 محل"},{key:"mall",label:"🏬 مول"}] as const).map(item => <TouchableOpacity key={item.key} onPress={() => setPartnerType(item.key)} style={[styles.partnerTypeOption, partnerType===item.key && styles.partnerTypeSelected]}><Text style={styles.partnerTypeText}>{item.label}</Text></TouchableOpacity>)}
          </View>
          <Text style={styles.partnerLabel}>اسم المنشأة</Text><RealInput value={partnerName} onChangeText={setPartnerName} placeholder="اسم الفندق أو المطعم أو المحل" maxLength={120} />
          <Text style={styles.partnerLabel}>اسم الشخص المسؤول</Text><RealInput value={partnerContact} onChangeText={setPartnerContact} placeholder="الاسم الكامل" maxLength={100} />
          <Text style={styles.partnerLabel}>رقم الهاتف</Text><RealInput value={partnerPhone} onChangeText={setPartnerPhone} placeholder="07XXXXXXXXX" keyboardType="phone-pad" />
          <Text style={styles.partnerLabel}>البريد الإلكتروني (اختياري)</Text><RealInput value={partnerEmail} onChangeText={setPartnerEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" />
          <Text style={styles.partnerLabel}>المحافظة</Text>
          <View style={styles.partnerGovernorates}>{Object.entries(governorateLabels).map(([key,label])=><TouchableOpacity key={key} onPress={()=>setPartnerGovernorate(key)} style={[styles.partnerGovernorateChip,partnerGovernorate===key&&styles.partnerTypeSelected]}><Text style={styles.partnerGovernorateText}>{label}</Text></TouchableOpacity>)}</View>
          <Text style={styles.partnerLabel}>المدينة / القضاء</Text><RealInput value={partnerCity} onChangeText={setPartnerCity} placeholder="مثال: النجف الأشرف" maxLength={80} />
          <Text style={styles.partnerLabel}>العنوان التفصيلي</Text><RealInput value={partnerAddress} onChangeText={setPartnerAddress} placeholder="الحي والشارع وأقرب نقطة دالة" maxLength={240} />
          <Text style={styles.partnerLabel}>نبذة عن المنشأة (اختياري)</Text><RealInput value={partnerDescription} onChangeText={setPartnerDescription} placeholder="الخدمات أو المنتجات" />
          <Button title={partnerBusy ? "جارٍ إرسال الطلب..." : "إرسال طلب الشراكة"} onPress={submitPartnerApplication} loading={partnerBusy} />
        </View>}
        {partnerApplications.length>0 && <View style={{marginTop:12,gap:8}}><Text style={styles.partnerLabel}>طلبات الشراكة السابقة</Text>{partnerApplications.map(item=><View key={item.id} style={styles.partnerApplicationCard}><Text style={styles.partnerApplicationName}>{item.business_name}</Text><Text style={styles.partnerApplicationStatus}>{item.status==="approved"?"تمت الموافقة":item.status==="suspended"?"موقوف من الإدارة":item.status==="rejected"?"مرفوض":"قيد المراجعة"} · {({hotel:"فندق",restaurant:"مطعم",store:"محل",mall:"مول"} as Record<string,string>)[item.partner_type]}</Text>{item.admin_note?<Text style={styles.note}>ملاحظة الإدارة: {item.admin_note}</Text>:null}</View>)}</View>}
        {partnerApplications.some(item=>item.status==="approved") && <TouchableOpacity activeOpacity={0.85} onPress={()=>router.push("/partner/dashboard")} style={styles.partnerJoinButton}><Text style={styles.partnerJoinButtonText}>فتح لوحة الشريك</Text></TouchableOpacity>}
      </View>
      <Text style={styles.note}>كل خيارات الانضمام مجمّعة هنا. بعد إكمال بياناتك ومستنداتك تراجع الإدارة طلبك.</Text>
    </View>
    <Text style={styles.note}>أي تغيير ببيانات الدخول لا يعتمد إلا بعد إكمال التحقق.</Text>
    <Text style={styles.label}>البريد الإلكتروني</Text>
    {actualEmail ? <Text style={styles.current} selectable>{actualEmail}</Text> : <Text style={styles.hint}>ماكو بريد إلكتروني حقيقي مسجّل بحسابك. أضف بريدك حتى تستلم رسائل التأكيد واستعادة الحساب.</Text>}
    <Text style={styles.label}>{actualEmail ? "تغيير البريد الإلكتروني" : "إضافة بريد إلكتروني حقيقي"}</Text>
    <RealInput value={email} onChangeText={setEmail} placeholder="اكتب بريدك الحقيقي" keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />
    <View style={{ height: 12 }} />
    <Button title={actualEmail ? "تأكيد تغيير البريد" : "إضافة البريد وإرسال رابط التأكيد"} onPress={changeEmail} loading={busy} />
    <View style={styles.separator} />
    <Text style={styles.label}>رقم الهاتف الحالي</Text>
    <Text style={styles.current} selectable>{profile?.phone || user?.phone || "غير مسجل"}</Text>
    <Text style={styles.label}>رقم الهاتف الجديد</Text>
    <RealInput value={phone} onChangeText={setPhone} placeholder="07XXXXXXXXX" keyboardType="phone-pad" />
    {!phonePending ? <>
      <View style={{ height: 12 }} />
      <Button title="إرسال رمز SMS للتحقق من الرقم" onPress={requestPhoneChange} loading={busy} />
      <Text style={styles.hint}>يتطلب هذا الخيار تفعيل خدمة SMS والتحقق الهاتفي في إعدادات Supabase.</Text>
    </> : <>
      <Text style={styles.label}>رمز التحقق</Text>
      <RealInput value={otp} onChangeText={setOtp} placeholder="أدخل رمز SMS" keyboardType="numeric" />
      <View style={{ height: 12 }} />
      <Button title="تأكيد الرقم الجديد" onPress={verifyPhone} loading={busy} />
    </>}
    <TouchableOpacity activeOpacity={0.85} onPress={() => router.push("/support-chat")} style={styles.supportCard}>
      <View style={{ flex: 1 }}><Text style={styles.supportTitle}>مراسلة دعم ممنون</Text><Text style={styles.supportHint}>راسل الإدارة وتابع الردود من نفس الحساب</Text></View>
      <Text style={styles.supportAction}>مراسلة الدعم</Text>
    </TouchableOpacity>
    <Text style={styles.back} onPress={() => router.back()}>رجوع</Text>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.pageCanvas },
  container: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.huge },
  kicker: { color: palette.gold, fontSize: 10, fontWeight: "900", letterSpacing: 1.3, marginBottom: 8 },
  title: { fontSize: 27, fontWeight: "900", color: palette.ink, marginBottom: 5 },
  subtitle: { fontSize: 13, color: palette.muted, marginBottom: space.xl },
  sectionTitle: { fontSize: 17, fontWeight: "900", color: palette.ink, marginTop: 20, marginBottom: 8 },
  nameSection: { backgroundColor: palette.surface, borderRadius: radius.xl, padding: space.lg, borderWidth: 1, borderColor: palette.line, marginBottom: 12 },
  joinSection: { marginTop: 8, marginBottom: 12, padding: 14, borderRadius: radius.xl, borderWidth: 1, borderColor: palette.gold + "88", backgroundColor: palette.surface + "CC" },
  partnerJoinBox: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: palette.line },
  partnerJoinTitle: { color: palette.ink, fontSize: 16, fontWeight: "900", textAlign: "right", marginBottom: 6 },
  partnerJoinButton: { backgroundColor: palette.brand, borderRadius: radius.lg, padding: 15, alignItems: "center", marginTop: 8 },
  partnerJoinButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900" },
  partnerForm: { marginTop: 12, padding: 12, borderRadius: radius.lg, backgroundColor: palette.pageCanvas, borderWidth: 1, borderColor: palette.line, gap: 8 },
  partnerLabel: { color: palette.ink, fontSize: 12, fontWeight: "900", textAlign: "right", marginTop: 6 },
  partnerTypeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  partnerTypeOption: { width: "48%", padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, alignItems: "center" },
  partnerTypeSelected: { borderColor: palette.brand, backgroundColor: palette.brandSoft },
  partnerTypeText: { color: palette.ink, fontSize: 12, fontWeight: "900" },
  partnerGovernorates: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  partnerGovernorateChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  partnerGovernorateText: { color: palette.ink, fontSize: 10, fontWeight: "700" },
  partnerApplicationCard: { borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, backgroundColor: palette.surface, padding: 12 },
  partnerApplicationName: { color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right" },
  partnerApplicationStatus: { color: palette.brand, fontSize: 11, fontWeight: "800", textAlign: "right", marginTop: 4 },

  registrationList: { gap: 9, marginTop: 8 },
  registrationCard: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 76, padding: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
  registrationMark: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: palette.brandSoft },
  registrationMarkText: { color: palette.brand, fontSize: 19, fontWeight: "900" },
  registrationTitle: { color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right" },
  registrationHint: { color: palette.muted, fontSize: 10, marginTop: 4, textAlign: "right" },
  registrationAction: { color: palette.brand, fontSize: 10, fontWeight: "900", textAlign: "center" },
  roleSectionHeading: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 20, marginBottom: 8 },
  roleSwitchIcon: { width: 46, height: 46, borderRadius: 16, backgroundColor: palette.brand, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: palette.gold + "88", shadowColor: palette.brand, shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  roleSectionTitle: { fontSize: 17, fontWeight: "900", color: palette.ink },
  roleSectionHint: { fontSize: 10, color: palette.muted, marginTop: 3 },
  roleCurrentHint: { fontSize: 9, color: palette.muted, fontWeight: "700" },
  roleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  roleCard: { width: "48%", minHeight: 124, borderRadius: radius.lg, padding: 14, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "transparent" },
  roleCardActive: { borderColor: palette.gold },
  roleMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.75)", justifyContent: "center", alignItems: "center", marginBottom: 8 },
  roleEmoji: { fontSize: 20, fontWeight: "900" },
  roleTitle: { fontSize: 14, fontWeight: "900" },
  roleHint: { fontSize: 10, fontWeight: "800", marginTop: 5, opacity: 0.9 },
  notificationPrefsCard: { backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, marginBottom: 18 },
  notificationPrefsRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12 },
  notificationPrefsTitle: { color: palette.ink, fontSize: 13, fontWeight: "900", textAlign: "right" },
  notificationPrefsHint: { color: palette.muted, fontSize: 10, marginTop: 4, textAlign: "right" },
  notificationPrefsToggle: { minWidth: 78, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.pageCanvas, alignItems: "center" },
  notificationPrefsToggleOn: { borderColor: palette.brand, backgroundColor: palette.brandSoft },
  notificationPrefsToggleText: { color: palette.muted, fontSize: 11, fontWeight: "900" },
  notificationPrefsToggleTextOn: { color: palette.brand },
  notificationPrefsDivider: { height: 1, backgroundColor: palette.line },
  note: { color: palette.muted, lineHeight: 21, marginBottom: 16, fontSize: 12 },
  label: { fontSize: 12, fontWeight: "900", color: palette.ink, marginTop: 16, marginBottom: 8 },
  current: { color: palette.muted, fontSize: 14, paddingVertical: 8 },
  separator: { height: 1, backgroundColor: palette.line, marginVertical: 24 },
  hint: { color: palette.muted, fontSize: 11, lineHeight: 19, marginTop: 10 },
  supportCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.gold, padding: 16, marginTop: 22 },
  supportTitle: { color: palette.ink, fontSize: 14, fontWeight: "900", textAlign: "right" },
  supportHint: { color: palette.muted, fontSize: 11, marginTop: 5, textAlign: "right" },
  supportAction: { color: palette.white, backgroundColor: palette.brand, paddingHorizontal: 13, paddingVertical: 10, borderRadius: radius.md, fontSize: 11, fontWeight: "900" },
  back: { textAlign: "center", color: palette.brand, fontWeight: "900", padding: 24 },
});
