import { useState, useEffect } from "react";
import { router } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";

type WorkerService = { id: string; slug: string; name_ar: string };
type PickedImage = { uri: string; mimeType?: string | null; fileName?: string | null };
type PhotoKind = "face" | "id-front" | "id-back";

export default function WorkerOnboarding() {
  const { user, refresh } = useAuth();
  const [companyName, setCompanyName] = useState("شركة ممنون");
  const [services, setServices] = useState<WorkerService[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [level, setLevel] = useState<"fani" | "khabir">("fani");
  const [bio, setBio] = useState("");
  const [legalName, setLegalName] = useState(String(user?.user_metadata?.full_name ?? ""));
  const [facePhoto, setFacePhoto] = useState<PickedImage | null>(null);
  const [idFrontPhoto, setIdFrontPhoto] = useState<PickedImage | null>(null);
  const [idBackPhoto, setIdBackPhoto] = useState<PickedImage | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (supabase as any).from("company_settings").select("company_name").eq("id", 1).maybeSingle()
      .then(({ data }: any) => { if (data?.company_name) setCompanyName(data.company_name); });
  }, []);

  useEffect(() => {
    let active = true;
    setServicesLoading(true);
    supabase.rpc("get_worker_service_catalog").then(({ data, error }) => {
      if (!active) return;
      if (error) {
        console.error("get_worker_service_catalog failed:", error);
        setServicesError(
          /invalid api key/i.test(error.message || "")
            ? "مفتاح اتصال Supabase في نسخة التطبيق غير صالح أو قديم. حدّث إعداد EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY في بيئة Production ثم أنشئ نسخة APK جديدة."
            : `تعذر تحميل المهن (${error.code || "اتصال"}): ${error.message || "تحقق من اتصالك"}`,
        );
      } else {
        const available = (data || []).filter((s: WorkerService) => s.slug !== "taxi");
        setServices(available);
        setServicesError(available.length ? null : "قائمة المهن فارغة حالياً. تواصل مع الإدارة.");
      }
      setServicesLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    setLegalName((current) => current || String(user.user_metadata?.full_name ?? ""));
    let active = true;
    Promise.all([
      supabase.from("provider_verifications").select("status,rejection_reason")
        .eq("user_id", user.id).eq("provider_type", "worker").maybeSingle(),
      supabase.from("worker_profiles").select("status").eq("user_id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "worker").maybeSingle(),
    ]).then(([verification, workerProfile, workerRole]) => {
      if (!active) return;
      // A granted worker role is authoritative proof of prior approval.
      const approved = !!workerRole.data
        || verification.data?.status === "approved"
        || workerProfile.data?.status === "approved";
      const resolvedStatus = approved
        ? "approved"
        : verification.data?.status ?? workerProfile.data?.status ?? null;
      if (resolvedStatus) setStatus(resolvedStatus);
      setRejectionReason(verification.data?.rejection_reason ?? null);
    }).catch((error) => {
      console.error("Unable to restore worker approval:", error);
    });
    return () => { active = false; };
  }, [user?.id]);

  function toggleService(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function pickPhoto(kind: PhotoKind, source: "camera" | "library" = "camera") {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("إذن الكاميرا", "اسمح للتطبيق باستخدام الكاميرا لإرفاق المستند.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: kind === "face",
          ...(kind === "face" ? { aspect: [1, 1] as [number, number] } : {}),
          quality: 0.85,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("إذن الصور", "اسمح للتطبيق بالوصول إلى الصور لاختيار المستند.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          quality: 0.8,
        });
      }
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const picked = { uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName };
      if (kind === "face") setFacePhoto(picked);
      else if (kind === "id-front") setIdFrontPhoto(picked);
      else setIdBackPhoto(picked);
    } catch {
      Alert.alert("خطأ", "تعذر اختيار الصورة. حاول مرة أخرى.");
    }
  }

  function choosePhoto(kind: PhotoKind) {
    const title = kind === "face" ? "الصورة الشخصية" : kind === "id-front" ? "البطاقة الوطنية الأمامية" : "البطاقة الوطنية الخلفية";
    Alert.alert(title, "اختَر طريقة إرفاق الصورة", [
      { text: "تصوير بالكاميرا", onPress: () => { void pickPhoto(kind, "camera"); } },
      { text: "اختيار من المعرض", onPress: () => { void pickPhoto(kind, "library"); } },
      { text: "إلغاء", style: "cancel" },
    ]);
  }

  async function uploadImage(image: PickedImage, kind: "face" | "id-card" | "id-card-back") {
    if (!user) throw new Error("انتهت جلسة الدخول.");
    const response = await fetch(image.uri);
    const body = await response.arrayBuffer();
    const mime = image.mimeType === "image/png" ? "image/png" : "image/jpeg";
    const extension = mime === "image/png" ? "png" : "jpg";
    const path = `${user.id}/worker/${kind}-${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from("provider-verification").upload(path, body, {
      contentType: mime,
      upsert: true,
      cacheControl: "3600",
    });
    if (error) throw new Error(`تعذر حفظ الصورة: ${error.message}`);
    return path;
  }

  async function submit() {
    if (!user) {
      Alert.alert("تسجيل الدخول مطلوب", "سجّل الدخول أولاً ثم أكمل تسجيل الفني.");
      return;
    }
    if (servicesLoading || servicesError) {
      Alert.alert("قائمة المهن", servicesError || "انتظر تحميل قائمة المهن أولاً.");
      return;
    }
    if (selected.length === 0) {
      Alert.alert("حدد مهنتك", "اختَر مهنة واحدة على الأقل حتى يعرف الزبون شنو الخدمة اللي تقدمها.");
      return;
    }
    if (legalName.trim().length < 5) {
      Alert.alert("الاسم مطلوب", "اكتب الاسم الثلاثي واللقب كما هو في البطاقة الوطنية.");
      return;
    }
    if (!facePhoto || !idFrontPhoto || !idBackPhoto) {
      Alert.alert("المستمسكات مطلوبة", "أرفق الصورة الشخصية والبطاقة الوطنية من الأمام والخلف.");
      return;
    }

    setBusy(true);
    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: legalName.trim() })
        .eq("id", user.id);
      if (profileError) throw new Error(`تعذر حفظ الاسم: ${profileError.message}`);

      const [facePath, idFrontPath, idBackPath] = await Promise.all([
        uploadImage(facePhoto, "face"),
        uploadImage(idFrontPhoto, "id-card"),
        uploadImage(idBackPhoto, "id-card-back"),
      ]);

      const { error: verificationError } = await supabase.from("provider_verifications").upsert({
        user_id: user.id,
        provider_type: "worker",
        legal_name: legalName.trim(),
        phone: user.phone ?? null,
        email: user.email ?? null,
        face_photo_path: facePath,
        id_card_photo_path: idFrontPath,
        id_card_back_photo_path: idBackPath,
        vehicle_document_path: null,
        document_type: "national_id",
        id_number: null,
        metadata: { workerLevel: level, workerBio: bio.trim() || null, workerServices: selected },
        status: "pending",
        rejection_reason: null,
        submitted_at: new Date().toISOString(),
        reviewed_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,provider_type" });
      if (verificationError) throw new Error(`تعذر حفظ مستمسكات التوثيق: ${verificationError.message}`);

      const { error: workerError } = await supabase.from("worker_profiles").upsert({
        user_id: user.id,
        level,
        bio: bio.trim() || null,
        available: false,
        status: "pending",
      }, { onConflict: "user_id" });
      if (workerError) throw workerError;

      const { error: deleteServicesError } = await supabase
        .from("worker_services")
        .delete()
        .eq("worker_id", user.id);
      if (deleteServicesError) throw deleteServicesError;
      const { error: insertServicesError } = await supabase
        .from("worker_services")
        .insert(selected.map((serviceId) => ({ worker_id: user.id, service_id: serviceId })));
      if (insertServicesError) throw insertServicesError;

      setStatus("pending");
      setRejectionReason(null);
      await refresh();
      Alert.alert("تم إرسال الطلب", "تم حفظ الصورة الشخصية والبطاقة الوطنية من الجهتين. طلبك الآن بانتظار موافقة " + companyName + ".");
    } catch (err: unknown) {
      Alert.alert("تعذر إكمال التسجيل", err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "pending" || status === "approved") {
    return (
      <View style={styles.statusContainer}>
        <Text style={styles.title}>{status === "approved" ? "تم اعتماد حسابك كفني" : "طلبك قيد المراجعة"}</Text>
        <Text style={styles.statusText}>
          {status === "approved"
            ? "تهانينا! تم تفعيل حسابك كفني بعد تدقيق مستمسكاتك. نرحب بك ضمن أسرة شركة ممنون الموثّقة ونتمنى لك التوفيق والنجاح."
            : "استلمنا صورتك الشخصية والبطاقة الوطنية من الأمام والخلف. طلبك بانتظار موافقة " + companyName + "، وستتمكن من استقبال الطلبات بعد الاعتماد."}
        </Text>
        {status === "pending" ? (
          <Button title="تعديل البيانات وإعادة إرفاق المستمسكات" onPress={() => setStatus(null)} />
        ) : (
          <>
            <Button title="تفعيل واجهة الفني والانتقال للرئيسية" onPress={async () => {
              if (!user) return;
              const { error } = await supabase.rpc("grant_provider_role_safe", { _role: "worker" });
              if (error) {
                Alert.alert("تعذر تفعيل دور الفني", "حسابك معتمد، لكن تعذر تفعيل الدور تلقائياً. تواصل مع الدعم.");
                return;
              }
              await refresh();
              await (await import("expo-secure-store")).setItemAsync("mamnoon_active_role", "worker");
              router.replace("/home");
            }} />
            <Button title="تواصل مع الدعم" onPress={() => router.push("/support-chat")} />
          </>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 48 }}>
      <Text style={styles.title}>تسجيل الفني في ممنون</Text>
      <Text style={styles.note}>أكمل اختصاصاتك وارفق المستمسكات الثلاثة. يبقى الحساب قيد المراجعة لحين موافقة الإدارة.</Text>
      {!!rejectionReason && <Text style={styles.rejection}>سبب الرفض السابق: {rejectionReason}</Text>}

      <Text style={styles.label}>الاسم الكامل المطابق للبطاقة الوطنية *</Text>
      <TextInput style={styles.input} value={legalName} onChangeText={setLegalName} placeholder="الاسم الثلاثي واللقب" placeholderTextColor="#94a3b8" />

      <Text style={styles.label}>حدد مهنتك واختصاصك داخل ممنون * (تقدر تختار أكثر من مهنة)</Text>
      {servicesLoading ? <Text style={styles.note}>جاري تحميل قائمة المهن...</Text> : null}
      {!!servicesError && (
        <TouchableOpacity onPress={() => {
          setServicesError(null);
          setServicesLoading(true);
          supabase.rpc("get_worker_service_catalog").then(({ data, error }) => {
            if (error) console.error("get_worker_service_catalog retry failed:", error);
            const available = (data || []).filter((s: WorkerService) => s.slug !== "taxi");
            setServices(available);
            setServicesError(error
              ? (/invalid api key/i.test(error.message || "")
                  ? "مفتاح اتصال Supabase في نسخة التطبيق غير صالح أو قديم. حدّث إعداد EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY في بيئة Production ثم أنشئ نسخة APK جديدة."
                  : `تعذر تحميل المهن: ${error.message}`)
              : available.length ? null : "قائمة المهن فارغة حالياً.");
            setServicesLoading(false);
          });
        }}>
          <Text style={styles.rejection}>{servicesError} اضغط هنا لإعادة المحاولة.</Text>
        </TouchableOpacity>
      )}
      <View style={styles.servicesGrid}>
        {services.map((s) => (
          <TouchableOpacity key={s.id} style={[styles.serviceChip, selected.includes(s.id) && styles.serviceChipActive]} onPress={() => toggleService(s.id)}>
            <Text style={[styles.serviceChipText, selected.includes(s.id) && styles.serviceChipTextActive]}>{s.name_ar}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>حدد مستواك المهني *</Text>
      <View style={styles.levelRow}>
        <TouchableOpacity style={[styles.levelChip, level === "fani" && styles.levelChipActive]} onPress={() => setLevel("fani")}>
          <Text style={[styles.levelText, level === "fani" && styles.levelTextActive]}>فني</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.levelChip, level === "khabir" && styles.levelChipActive]} onPress={() => setLevel("khabir")}>
          <Text style={[styles.levelText, level === "khabir" && styles.levelTextActive]}>خبير</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>نبذة عن خبرتك (اختياري)</Text>
      <TextInput style={[styles.input, { height: 80 }]} value={bio} onChangeText={setBio} placeholder="خبراتك ومهاراتك..." multiline placeholderTextColor="#94a3b8" />

      <Text style={styles.label}>الصورة الشخصية للوجه *</Text>
      <TouchableOpacity style={styles.photoButton} onPress={() => choosePhoto("face")}>
        {facePhoto ? <Image source={{ uri: facePhoto.uri }} style={styles.preview} /> : <Text style={styles.photoText}>اضغط لالتقاط أو اختيار صورتك الشخصية</Text>}
      </TouchableOpacity>

      <Text style={styles.label}>البطاقة الوطنية - الجهة الأمامية *</Text>
      <TouchableOpacity style={styles.photoButton} onPress={() => choosePhoto("id-front")}>
        {idFrontPhoto ? <Image source={{ uri: idFrontPhoto.uri }} style={styles.preview} /> : <Text style={styles.photoText}>اضغط لإرفاق الوجه الأمامي</Text>}
      </TouchableOpacity>

      <Text style={styles.label}>البطاقة الوطنية - الجهة الخلفية *</Text>
      <TouchableOpacity style={styles.photoButton} onPress={() => choosePhoto("id-back")}>
        {idBackPhoto ? <Image source={{ uri: idBackPhoto.uri }} style={styles.preview} /> : <Text style={styles.photoText}>اضغط لإرفاق الوجه الخلفي</Text>}
      </TouchableOpacity>

      <View style={{ height: 24 }} />
      <Button title="إرسال طلب التسجيل للمراجعة" onPress={submit} loading={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 50 },
  statusContainer: { flex: 1, justifyContent: "center", padding: 24, gap: 18 },
  title: { fontSize: 28, fontWeight: "900", color: "#1e293b", marginBottom: 16, textAlign: "right" },
  note: { color: "#64748b", fontSize: 13, lineHeight: 22, textAlign: "right" },
  rejection: { color: "#b91c1c", backgroundColor: "#fee2e2", padding: 12, borderRadius: 12, marginTop: 12, textAlign: "right", lineHeight: 22 },
  statusText: { color: "#475569", fontSize: 15, lineHeight: 26, textAlign: "right" },
  label: { fontSize: 13, fontWeight: "700", color: "#475569", marginBottom: 8, marginTop: 18, textAlign: "right" },
  servicesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  serviceChip: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: "#fff", borderWidth: 2, borderColor: "transparent" },
  serviceChipActive: { borderColor: "#0f766e", backgroundColor: "#0f766e10" },
  serviceChipText: { fontSize: 14, fontWeight: "600", color: "#64748b" },
  serviceChipTextActive: { color: "#0f766e" },
  levelRow: { flexDirection: "row", gap: 10 },
  levelChip: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: 14, backgroundColor: "#fff", borderWidth: 2, borderColor: "transparent" },
  levelChipActive: { borderColor: "#0f766e", backgroundColor: "#0f766e10" },
  levelText: { fontSize: 15, fontWeight: "700", color: "#64748b" },
  levelTextActive: { color: "#0f766e" },
  input: { borderWidth: 1, borderColor: "rgba(30,41,59,0.1)", borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, fontWeight: "600", color: "#1e293b", backgroundColor: "rgba(30,41,59,0.03)", textAlign: "right" },
  photoButton: { minHeight: 112, borderWidth: 1, borderStyle: "dashed", borderColor: "#94a3b8", borderRadius: 16, backgroundColor: "#f8fafc", alignItems: "center", justifyContent: "center", padding: 10 },
  photoText: { color: "#0f766e", fontWeight: "700", textAlign: "center" },
  preview: { width: 150, height: 110, borderRadius: 12, resizeMode: "cover" },
});
