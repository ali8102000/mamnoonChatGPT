import { useState, useEffect } from "react";
import { router } from "expo-router";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";

type VehicleModel = { id: string; make: string; model: string; category: string; min_year: number };
type DocumentType = "national_id" | "driver_license";
type PickedImage = { uri: string; mimeType?: string | null; fileName?: string | null };

const CATEGORIES = [
  { key: "economy", label: "اقتصادي" },
  { key: "premium", label: "متميز" },
  { key: "luxury", label: "فاخر" },
] as const;

export default function DriverOnboarding() {
  const { user, profile, refresh } = useAuth();
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [selectedMake, setSelectedMake] = useState("");
  const [selectedModel, setSelectedModel] = useState<VehicleModel | null>(null);
  const [category, setCategory] = useState<"economy" | "premium" | "luxury">("economy");
  const [year, setYear] = useState("");
  const [plate, setPlate] = useState("");
  const [color, setColor] = useState("");
  const [legalName, setLegalName] = useState(profile?.full_name ?? "");
  const [documentType, setDocumentType] = useState<DocumentType>("national_id");
  const [facePhoto, setFacePhoto] = useState<PickedImage | null>(null);
  const [idPhoto, setIdPhoto] = useState<PickedImage | null>(null);
  const [idBackPhoto, setIdBackPhoto] = useState<PickedImage | null>(null);
  const [vehicleDocumentPhoto, setVehicleDocumentPhoto] = useState<PickedImage | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savedModelName, setSavedModelName] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.from("vehicle_models").select("id,make,model,category,min_year").order("make")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) Alert.alert("تنبيه", "تعذر تحميل قائمة السيارات.");
        setModels((data ?? []) as VehicleModel[]);
      });
    if (user) {
      supabase.from("provider_verifications")
        .select("status,rejection_reason,metadata")
        .eq("user_id", user.id).eq("provider_type", "driver").maybeSingle()
        .then(({ data }) => {
          if (!active || !data) return;
          setStatus(data.status);
          setRejectionReason(data.rejection_reason ?? null);
          const m = (data.metadata ?? {}) as Record<string, unknown>;
          if (typeof m.vehicleMake === "string") setSelectedMake(m.vehicleMake);
          if (typeof m.vehicleModel === "string") setSavedModelName(m.vehicleModel);
          if (typeof m.vehicleYear === "number") setYear(String(m.vehicleYear));
          if (typeof m.vehiclePlate === "string") setPlate(m.vehiclePlate);
          if (typeof m.vehicleColor === "string") setColor(m.vehicleColor);
          if (m.vehicleCategory === "economy" || m.vehicleCategory === "premium" || m.vehicleCategory === "luxury") setCategory(m.vehicleCategory);
        });
    }
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!selectedModel && selectedMake && savedModelName && models.length) {
      const found = models.find((m) => m.make === selectedMake && m.model === savedModelName);
      if (found) setSelectedModel(found);
    }
  }, [models, selectedMake, savedModelName, selectedModel]);

  const makes = [...new Set(models.map((m) => m.make))];

  async function pickPhoto(kind: "face" | "id" | "id-back" | "vehicle-document", source?: "camera" | "library") {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (kind === "face" || source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("إذن الكاميرا", "اسمح للتطبيق باستخدام الكاميرا لالتقاط صورة الوجه.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"], allowsEditing: kind === "face", ...(kind === "face" ? { aspect: [1, 1] as [number, number] } : {}), quality: 0.85,
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("إذن الصور", kind === "vehicle-document" ? "اسمح للتطبيق بالوصول إلى الصور حتى تختار السنوية أو الوكالة." : "اسمح للتطبيق بالوصول إلى الصور لاختيار صورة المستمسك.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"], allowsEditing: true, quality: 0.75,
        });
      }
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const picked = { uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName };
        if (kind === "face") setFacePhoto(picked);
        else if (kind === "id") setIdPhoto(picked);
        else if (kind === "id-back") setIdBackPhoto(picked);
        else setVehicleDocumentPhoto(picked);
      }
    } catch {
      Alert.alert("خطأ", "تعذر اختيار الصورة. حاول مرة أخرى.");
    }
  }

  async function uploadImage(image: PickedImage, kind: "face" | "id-card" | "id-card-back" | "vehicle-registration") {
    if (!user) throw new Error("انتهت جلسة الدخول.");
    const response = await fetch(image.uri);
    const body = await response.arrayBuffer();
    const mime = image.mimeType === "image/png" ? "image/png" : "image/jpeg";
    const extension = mime === "image/png" ? "png" : "jpg";
    const path = `${user.id}/driver/${kind}-${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from("provider-verification").upload(path, body, {
      contentType: mime, upsert: true, cacheControl: "3600",
    });
    if (error) throw new Error(`تعذر حفظ ${kind === "face" ? "صورة الوجه" : kind === "id-card" || kind === "id-card-back" ? "صورة الهوية" : "صورة سنوية السيارة أو الوكالة"}: ${error.message}`);
    return path;
  }

  async function submit() {
    if (!user) {
      Alert.alert("خطأ", "انتهت جلسة الدخول. سجّل الدخول مرة أخرى.");
      return;
    }
    const vehicleYear = Number(year.trim());
    if (!selectedModel || !/^\d{4}$/.test(year.trim()) || !plate.trim()) {
      Alert.alert("بيانات السيارة", "اختر الماركة والموديل وأدخل سنة الصنع ورقم اللوحة.");
      return;
    }
    if (!Number.isInteger(vehicleYear) || vehicleYear < selectedModel.min_year || vehicleYear > new Date().getFullYear() + 1) {
      Alert.alert("سنة الصنع غير صحيحة", `السنة يجب أن تكون بين ${selectedModel.min_year} و${new Date().getFullYear() + 1}.`);
      return;
    }
    if (legalName.trim().length < 5) {
      Alert.alert("الاسم مطلوب", "اكتب الاسم الثلاثي واللقب كما هو في الهوية.");
      return;
    }
    if (!facePhoto || !idPhoto || (documentType === "national_id" && !idBackPhoto) || !vehicleDocumentPhoto) {
      Alert.alert("الصور مطلوبة", "أرفق صورة الوجه والجهة الأمامية والخلفية للبطاقة الوطنية (أو صورة إجازة السوق) وصورة سنوية السيارة أو الوكالة التي يظهر فيها رقم المركبة.");
      return;
    }

    setBusy(true);
    try {
      const { error: profileError } = await supabase.from("profiles")
        .update({ full_name: legalName.trim() }).eq("id", user.id);
      if (profileError) throw new Error(`تعذر تحديث الاسم: ${profileError.message}`);

      const { error: driverError } = await supabase.from("driver_profiles").upsert({
        user_id: user.id,
        vehicle_make: selectedMake,
        vehicle_model: selectedModel.model,
        vehicle_year: vehicleYear,
        vehicle_category: category,
        vehicle_plate: plate.trim(),
        vehicle_color: color.trim() || null,
        available: false,
        status: "pending",
      }, { onConflict: "user_id,provider_type" });
      if (driverError) throw new Error(`تعذر إنشاء ملف السائق: ${driverError.message}`);

      const [facePath, idPath, idBackPath, vehicleDocumentPath] = await Promise.all([
        uploadImage(facePhoto, "face"),
        uploadImage(idPhoto, "id-card"),
        idBackPhoto ? uploadImage(idBackPhoto, "id-card-back") : Promise.resolve(null),
        uploadImage(vehicleDocumentPhoto, "vehicle-registration"),
      ]);
      const { error: verificationError } = await supabase.from("provider_verifications").upsert({
        user_id: user.id,
        provider_type: "driver",
        legal_name: legalName.trim(),
        phone: profile?.phone ?? null,
        email: user.email ?? null,
        face_photo_path: facePath,
        id_card_photo_path: idPath,
        id_card_back_photo_path: idBackPath,
        vehicle_document_path: vehicleDocumentPath,
        document_type: documentType,
        metadata: {
          vehicleMake: selectedMake,
          vehicleModel: selectedModel.model,
          vehicleYear,
          vehiclePlate: plate.trim(),
          vehicleColor: color.trim() || null,
          vehicleCategory: category,
        },
        status: "pending",
        rejection_reason: null,
        submitted_at: new Date().toISOString(),
        reviewed_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,provider_type" });
      if (verificationError) throw new Error(`تعذر حفظ طلب التوثيق: ${verificationError.message}`);

      setStatus("pending");
      setRejectionReason(null);
      await refresh();
      Alert.alert("تم إرسال الطلب", "وصل طلبك للإدارة وهو الآن قيد المراجعة. لا يمكنك استقبال الرحلات قبل الموافقة.");
    } catch (err: unknown) {
      Alert.alert("تعذر إكمال التسجيل", err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "pending" || status === "approved") {
    return (
      <View style={styles.statusContainer}>
        <Text style={styles.title}>{status === "approved" ? "تم اعتماد حسابك" : "طلبك قيد المراجعة"}</Text>
        <Text style={styles.statusText}>
          {status === "approved"
            ? "تهانينا! تم تفعيل حسابك كسائق تكسي بعد تدقيق مستمسكاتك وسيارتك. نرحب بك ضمن أسرة شركة ممنون الموثّقة ونتمنى لك التوفيق والنجاح."
            : "استلمنا بيانات السيارة والهوية. ستتمكن من استقبال الرحلات بعد موافقة الإدارة."}
        </Text>
        {status === "approved" ? (
          <Button title="تحديث الحساب والمتابعة" onPress={async () => {
            await refresh();
            const { data } = await supabase.from("user_roles").select("role").eq("user_id", user!.id).eq("role", "driver").maybeSingle();
            if (data) router.replace("/home");
            else Alert.alert("تنبيه", "الموافقة لم تكتمل صلاحياتها بعد. أعد المحاولة بعد قليل.");
          }} />
        ) : (
          <View style={{ gap: 10 }}>
            <Button title="تعديل البيانات وإعادة إرفاق السنوية والمستمسكات" onPress={() => setStatus(null)} />
            <Button title="العودة للرئيسية" onPress={() => router.replace("/home")} />
          </View>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 48 }}>
      <Text style={styles.title}>تسجيل السائق في ممنون</Text>
      <Text style={styles.note}>أكمل بيانات السيارة والهوية. حسابك يبقى معلّقاً لحين موافقة الإدارة.</Text>
      {!!rejectionReason && <Text style={styles.rejection}>سبب الرفض السابق: {rejectionReason}</Text>}

      <Text style={styles.label}>ماركة السيارة</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {makes.map((m) => (
          <TouchableOpacity key={m} style={[styles.chip, selectedMake === m && styles.chipActive]}
            onPress={() => { setSelectedMake(m); setSelectedModel(null); }}>
            <Text style={[styles.chipText, selectedMake === m && styles.chipTextActive]}>{m}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {!!selectedMake && <>
        <Text style={styles.label}>موديل السيارة</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {models.filter((m) => m.make === selectedMake).map((m) => (
            <TouchableOpacity key={m.id} style={[styles.chip, selectedModel?.id === m.id && styles.chipActive]}
              onPress={() => setSelectedModel(m)}>
              <Text style={[styles.chipText, selectedModel?.id === m.id && styles.chipTextActive]}>{m.model}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </>}

      <Text style={styles.label}>فئة السيارة في ممنون</Text>
      <View style={styles.row}>
        {CATEGORIES.map((item) => (
          <TouchableOpacity key={item.key} style={[styles.category, category === item.key && styles.chipActive]}
            onPress={() => setCategory(item.key)}>
            <Text style={[styles.chipText, category === item.key && styles.chipTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>سنة الصنع</Text>
      <TextInput style={styles.input} value={year} onChangeText={setYear} placeholder="2020" keyboardType="numeric" placeholderTextColor="#94a3b8" />
      <Text style={styles.label}>رقم اللوحة</Text>
      <TextInput style={styles.input} value={plate} onChangeText={setPlate} placeholder="رقم اللوحة والمحافظة" placeholderTextColor="#94a3b8" />
      <Text style={styles.label}>لون السيارة</Text>
      <TextInput style={styles.input} value={color} onChangeText={setColor} placeholder="أبيض" placeholderTextColor="#94a3b8" />

      <Text style={styles.label}>الاسم الكامل المطابق للهوية</Text>
      <TextInput style={styles.input} value={legalName} onChangeText={setLegalName} placeholder="الاسم الثلاثي واللقب" placeholderTextColor="#94a3b8" />

      <Text style={styles.label}>نوع المستمسك</Text>
      <View style={styles.row}>
        <TouchableOpacity style={[styles.category, documentType === "national_id" && styles.chipActive]} onPress={() => setDocumentType("national_id")}>
          <Text style={[styles.chipText, documentType === "national_id" && styles.chipTextActive]}>البطاقة الوطنية</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.category, documentType === "driver_license" && styles.chipActive]} onPress={() => setDocumentType("driver_license")}>
          <Text style={[styles.chipText, documentType === "driver_license" && styles.chipTextActive]}>إجازة السوق</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>صورة الوجه الشخصية *</Text>
      <TouchableOpacity style={styles.photoButton} onPress={() => pickPhoto("face")}>
        {facePhoto ? <Image source={{ uri: facePhoto.uri }} style={styles.preview} /> : <Text style={styles.photoText}>فتح الكاميرا والتقاط صورة الوجه</Text>}
      </TouchableOpacity>
      <Text style={styles.label}>{documentType === "national_id" ? "الجهة الأمامية للبطاقة الوطنية *" : "صورة إجازة السوق *"}</Text>
      <TouchableOpacity style={styles.photoButton} onPress={() => Alert.alert("الوجه الأمامي", "اختَر طريقة الإرفاق", [
        { text: "تصوير بالكاميرا", onPress: () => { void pickPhoto("id", "camera"); } },
        { text: "اختيار من المعرض", onPress: () => { void pickPhoto("id", "library"); } },
        { text: "إلغاء", style: "cancel" },
      ])}>
        {idPhoto ? <Image source={{ uri: idPhoto.uri }} style={styles.preview} /> : <Text style={styles.photoText}>اضغط لتصوير أو اختيار الوجه الأمامي</Text>}
      </TouchableOpacity>
      {documentType === "national_id" && <>
        <Text style={styles.label}>الجهة الخلفية للبطاقة الوطنية *</Text>
        <TouchableOpacity style={styles.photoButton} onPress={() => Alert.alert("الوجه الخلفي", "اختَر طريقة الإرفاق", [
          { text: "تصوير بالكاميرا", onPress: () => { void pickPhoto("id-back", "camera"); } },
          { text: "اختيار من المعرض", onPress: () => { void pickPhoto("id-back", "library"); } },
          { text: "إلغاء", style: "cancel" },
        ])}>
          {idBackPhoto ? <Image source={{ uri: idBackPhoto.uri }} style={styles.preview} /> : <Text style={styles.photoText}>اضغط لتصوير أو اختيار الوجه الخلفي</Text>}
        </TouchableOpacity>
      </>}

      <Text style={styles.label}>صورة سنوية السيارة أو الوكالة *</Text>
      <Text style={styles.note}>صوّر صفحة المستند كاملة وبوضوح، بحيث يظهر رقم المركبة أو رقم اللوحة وبيانات السيارة. إذا عندك وكالة استخدمها بدلاً من السنوية.</Text>
      <TouchableOpacity style={styles.photoButton} onPress={() => Alert.alert("إرفاق مستند السيارة", "اختَر طريقة إرفاق السنوية أو الوكالة", [
        { text: "تصوير المستند بالكاميرا", onPress: () => { void pickPhoto("vehicle-document", "camera"); } },
        { text: "اختيار صورة من المعرض", onPress: () => { void pickPhoto("vehicle-document", "library"); } },
        { text: "إلغاء", style: "cancel" },
      ])}>
        {vehicleDocumentPhoto ? <Image source={{ uri: vehicleDocumentPhoto.uri }} style={styles.preview} /> : <Text style={styles.photoText}>اضغط هنا لتصوير السنوية أو اختيارها من المعرض</Text>}
      </TouchableOpacity>

      <View style={{ height: 24 }} />
      <Button title="إرسال طلب التسجيل للمراجعة" onPress={submit} loading={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 50 },
  statusContainer: { flex: 1, justifyContent: "center", padding: 24, gap: 18 },
  title: { fontSize: 26, fontWeight: "900", color: "#1e293b", marginBottom: 12, textAlign: "right" },
  note: { color: "#64748b", fontSize: 13, lineHeight: 22, textAlign: "right" },
  rejection: { color: "#b91c1c", backgroundColor: "#fee2e2", padding: 12, borderRadius: 12, marginTop: 12, textAlign: "right", lineHeight: 22 },
  statusText: { color: "#475569", fontSize: 15, lineHeight: 26, textAlign: "right" },
  label: { fontSize: 13, fontWeight: "700", color: "#475569", marginBottom: 8, marginTop: 18, textAlign: "right" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: "#fff", borderWidth: 2, borderColor: "transparent" },
  category: { flex: 1, minWidth: 90, alignItems: "center", paddingHorizontal: 10, paddingVertical: 13, borderRadius: 12, backgroundColor: "#fff", borderWidth: 2, borderColor: "transparent" },
  chipActive: { borderColor: "#0f766e", backgroundColor: "#0f766e10" },
  chipText: { fontSize: 13, fontWeight: "700", color: "#64748b", textAlign: "center" },
  chipTextActive: { color: "#0f766e" },
  input: { borderWidth: 1, borderColor: "rgba(30,41,59,0.15)", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: "#1e293b", backgroundColor: "#fff", textAlign: "right" },
  photoButton: { minHeight: 112, borderWidth: 1, borderStyle: "dashed", borderColor: "#94a3b8", borderRadius: 16, backgroundColor: "#f8fafc", alignItems: "center", justifyContent: "center", padding: 10 },
  photoText: { color: "#0f766e", fontWeight: "700", textAlign: "center" },
  preview: { width: 150, height: 110, borderRadius: 12, resizeMode: "cover" },
});
