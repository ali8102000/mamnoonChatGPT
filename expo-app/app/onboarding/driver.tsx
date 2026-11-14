import { useState, useEffect } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui";
import { palette, radius } from "@/styles/theme";

type VehicleModel = { id: string; make: string; model: string; category: string; min_year: number };
type DocumentType = "national_id" | "driver_license";
type PickedImage = { uri: string; mimeType?: string | null; fileName?: string | null };

const CATEGORIES = [
  { key: "economy", label: "اقتصادي" },
  { key: "premium", label: "متميز" },
  { key: "luxury", label: "فاخر" },
  { key: "large", label: "سيارات كبيرة (كيا حمل / كيا ركاب / باص)" },
] as const;

export default function DriverOnboarding() {
  const { user, profile, refresh } = useAuth();
  const params = useLocalSearchParams<{ providerType?: string }>();
  const largeDriverMode = params.providerType === "large_driver";
  const providerRole = largeDriverMode ? "large_driver" : "driver";
  const [companyName, setCompanyName] = useState("شركة ممنون");
  const [models, setModels] = useState<VehicleModel[]>([]);
  const [selectedMake, setSelectedMake] = useState("");
  const [selectedModel, setSelectedModel] = useState<VehicleModel | null>(null);
  const [category, setCategory] = useState<"economy" | "premium" | "luxury" | "large">(largeDriverMode ? "large" : "economy");
  const [vehicleType, setVehicleType] = useState<"kia_cargo" | "kia_passenger" | "bus">("kia_cargo");
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
  const [checkingSavedDriver, setCheckingSavedDriver] = useState(true);
  const [vehicleChangeMode, setVehicleChangeMode] = useState(false);
  const [pendingVehicleChange, setPendingVehicleChange] = useState(false);

  useEffect(() => {
    (supabase as any).from("company_settings").select("company_name").eq("id", 1).maybeSingle()
      .then(({ data }: any) => { if (data?.company_name) setCompanyName(data.company_name); });
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    (supabase as any).from("provider_change_requests").select("id")
      .eq("user_id", user.id).eq("provider_type", providerRole).eq("status", "pending").maybeSingle()
      .then((result: any) => { if (active) setPendingVehicleChange(!!result.data); });
    return () => { active = false; };
  }, [user?.id, providerRole]);

  useEffect(() => {
    let active = true;
    setCheckingSavedDriver(true);
    supabase.from("vehicle_models").select("id,make,model,category,min_year").order("make")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) Alert.alert("تنبيه", "تعذر تحميل قائمة السيارات.");
        setModels((data ?? []) as VehicleModel[]);
      });
    if (user) {
      Promise.all([
        supabase.from("provider_verifications")
          .select("status,rejection_reason,metadata")
          .eq("user_id", user.id).eq("provider_type", providerRole).maybeSingle(),
        supabase.from("driver_profiles")
          .select("status,vehicle_make,vehicle_model,vehicle_year,vehicle_plate,vehicle_color,vehicle_category,vehicle_type")
          .eq("user_id", user.id).maybeSingle(),
      ]).then(([verification, driverProfile]) => {
        if (!active) return;
        const saved = driverProfile.data;
        const verificationData = verification.data;
        const m = (verificationData?.metadata ?? {}) as Record<string, unknown>;
        const resolvedStatus = verificationData?.status ?? saved?.status ?? null;
        if (resolvedStatus) setStatus(resolvedStatus);
        setRejectionReason(verificationData?.rejection_reason ?? null);
        const make = typeof m.vehicleMake === "string" ? m.vehicleMake : saved?.vehicle_make;
        const model = typeof m.vehicleModel === "string" ? m.vehicleModel : saved?.vehicle_model;
        const savedYear = typeof m.vehicleYear === "number" ? m.vehicleYear : saved?.vehicle_year;
        const savedPlate = typeof m.vehiclePlate === "string" ? m.vehiclePlate : saved?.vehicle_plate;
        const savedColor = typeof m.vehicleColor === "string" ? m.vehicleColor : saved?.vehicle_color;
        const savedCategory = m.vehicleCategory ?? saved?.vehicle_category;
        if (typeof make === "string") setSelectedMake(make);
        if (typeof model === "string") setSavedModelName(model);
        if (typeof savedYear === "number") setYear(String(savedYear));
        if (typeof savedPlate === "string") setPlate(savedPlate);
        if (typeof savedColor === "string") setColor(savedColor);
        if (savedCategory === "economy" || savedCategory === "premium" || savedCategory === "luxury" || savedCategory === "large") setCategory(savedCategory);
        if (saved?.vehicle_type === "kia_cargo" || saved?.vehicle_type === "kia_passenger" || saved?.vehicle_type === "bus") setVehicleType(saved.vehicle_type);
        setCheckingSavedDriver(false);
      }).catch(() => { if (active) setCheckingSavedDriver(false); });
    } else {
      setCheckingSavedDriver(false);
    }
    return () => { active = false; };
  }, [user?.id, providerRole]);

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
    if (vehicleChangeMode) {
      setBusy(true);
      try {
        const requestedData = largeDriverMode
          ? { vehicle_type: vehicleType }
          : { vehicle_category: category };
        const { error } = await (supabase as any).rpc("submit_provider_change_request", {
          _provider_type: providerRole,
          _requested_data: requestedData,
        });
        if (error) throw error;
        setPendingVehicleChange(true);
        setVehicleChangeMode(false);
        setStatus("approved");
        Alert.alert("تم إرسال الطلب", "وصل طلب تغيير فئة المركبة إلى الإدارة. مركبتك الحالية تبقى فعالة لحين الموافقة.");
      } catch (error: any) {
        Alert.alert("تعذر إرسال الطلب", error?.message || "حاول مرة ثانية.");
      } finally {
        setBusy(false);
      }
      return;
    }
    const vehicleYear = Number(year.trim());
    const largeModelName = vehicleType === "kia_cargo" ? "كيا حمل" : vehicleType === "kia_passenger" ? "كيا ركاب" : "باص";
    const catalogModel = category === "large" ? models.find((m) => m.make === "Kia" && m.model === largeModelName) : selectedModel;
    const resolvedModel: VehicleModel = catalogModel ?? {
      id: "large-kia-local",
      make: "Kia",
      model: largeModelName,
      category: "large",
      min_year: 1990,
    };
    if ((category !== "large" && !selectedModel) || !/^\d{4}$/.test(year.trim()) || !plate.trim()) {
      Alert.alert("بيانات السيارة", category === "large"
        ? "أدخل سنة الصنع ورقم اللوحة."
        : "اختر ماركة وموديل السيارة وأدخل سنة الصنع ورقم اللوحة.");
      return;
    }
    if (!Number.isInteger(vehicleYear) || vehicleYear < (category === "large" ? 1990 : resolvedModel.min_year) || vehicleYear > new Date().getFullYear() + 1) {
      const minimumYear = category === "large" ? 1990 : resolvedModel.min_year;
      Alert.alert("سنة الصنع غير صحيحة", `السنة يجب أن تكون بين ${minimumYear} و${new Date().getFullYear() + 1}.`);
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
        vehicle_make: category === "large" ? "Kia" : selectedMake,
        vehicle_model: resolvedModel.model,
        vehicle_year: vehicleYear,
        vehicle_category: category as any,
        vehicle_type: category === "large" ? vehicleType : null,
        vehicle_plate: plate.trim(),
        vehicle_color: color.trim() || null,
        available: false,
        status: "pending",
      }, { onConflict: "user_id" });
      if (driverError) throw new Error(`تعذر إنشاء ملف السائق: ${driverError.message}`);

      const [facePath, idPath, idBackPath, vehicleDocumentPath] = await Promise.all([
        uploadImage(facePhoto, "face"),
        uploadImage(idPhoto, "id-card"),
        idBackPhoto ? uploadImage(idBackPhoto, "id-card-back") : Promise.resolve(null),
        uploadImage(vehicleDocumentPhoto, "vehicle-registration"),
      ]);
      const { error: verificationError } = await supabase.from("provider_verifications").upsert({
        user_id: user.id,
        provider_type: providerRole,
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
          vehicleModel: resolvedModel.model,
          vehicleYear,
          vehiclePlate: plate.trim(),
          vehicleColor: color.trim() || null,
          vehicleCategory: category,
          vehicleType: category === "large" ? vehicleType : null,
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
      Alert.alert("تم إرسال الطلب", "وصل طلبك إلى إدارة " + companyName + " وهو الآن بانتظار الموافقة. لا يمكنك استقبال الرحلات قبل الاعتماد.");
    } catch (err: unknown) {
      Alert.alert("تعذر إكمال التسجيل", err instanceof Error ? err.message : "حدث خطأ غير متوقع.");
    } finally {
      setBusy(false);
    }
  }

  if (checkingSavedDriver) {
    return <View style={styles.statusContainer}><Text style={styles.statusText}>جاري استرجاع بيانات تسجيلك السابقة...</Text></View>;
  }

  if (status === "pending" || status === "approved") {
    return (
      <View style={styles.statusContainer}>
        <Text style={styles.title}>{status === "approved" ? "تم اعتماد حسابك" : "طلبك قيد المراجعة"}</Text>
        <Text style={styles.statusText}>
          {status === "approved"
            ? (largeDriverMode ? "تم اعتمادك سائقاً للسيارات الكبيرة. تقدر تستقبل طلبات كيا الحمل والركاب والباص حسب نوع مركبتك." : "تهانينا! تم تفعيل حسابك كسائق تكسي بعد تدقيق مستمسكاتك وسيارتك. نرحب بك ضمن أسرة شركة ممنون الموثّقة ونتمنى لك التوفيق والنجاح.")
            : "استلمنا بيانات السيارة والهوية. طلبك الآن بانتظار موافقة " + companyName + "، وستتمكن من استقبال الرحلات بعد الاعتماد."}
        </Text>
        {status === "approved" ? (
          <>
          {pendingVehicleChange && <Text style={styles.note}>طلب تغيير فئة المركبة بانتظار موافقة الإدارة. مركبتك الحالية تبقى فعالة.</Text>}
          {!pendingVehicleChange && <Button title="طلب تغيير فئة أو نوع المركبة" onPress={() => { setVehicleChangeMode(true); setStatus(null); }} />}
          <Button title="تفعيل دور السائق والمتابعة" onPress={async () => {
            if (!user) return;
            setBusy(true);
            try {
              const { error } = await supabase.rpc("grant_provider_role_safe", { _role: providerRole });
              if (error) throw error;
              await refresh();
              await (await import("expo-secure-store")).setItemAsync("mamnoon_active_role", providerRole);
              router.replace("/home");
            } catch (error) {
              Alert.alert("تعذر تفعيل دور السائق", error instanceof Error ? error.message : "تأكد من اعتماد طلبك ثم حاول مجدداً.");
            } finally {
              setBusy(false);
            }
          }} loading={busy} />
          </>
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
      <Text style={styles.title}>{vehicleChangeMode ? "طلب تغيير فئة المركبة" : largeDriverMode ? "تسجيل سائق السيارات الكبيرة" : "تسجيل كابتن التكسي"}</Text>
      <Text style={styles.note}>{vehicleChangeMode ? "حدد الفئة أو نوع المركبة الجديد. مركبتك الحالية تبقى فعالة حتى موافقة الإدارة." : largeDriverMode ? "قسم مستقل لكيا الحمل وكيا الركاب والباص. أكمل بيانات المركبة والهوية." : "أكمل بيانات سيارة التكسي والهوية. حسابك يبقى معلّقاً لحين موافقة الإدارة."}</Text>
      {!!rejectionReason && <Text style={styles.rejection}>سبب الرفض السابق: {rejectionReason}</Text>}

      <Text style={styles.label}>اختر نوع تسجيلك كسائق</Text>
      <View style={styles.row}>
        {CATEGORIES.filter((item) => largeDriverMode ? item.key === "large" : item.key !== "large").map((item) => (
          <TouchableOpacity key={item.key} style={[styles.category, category === item.key && styles.chipActive]}
            onPress={() => {
              setCategory(item.key);
              if (item.key === "large") {
                setSelectedMake("Kia");
                setSelectedModel(null);
              }
            }}>
            <Text style={[styles.chipText, category === item.key && styles.chipTextActive]}>{item.key === "large" ? "🚚 " : "🚗 "}{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {category !== "large" && <>
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
      </>}

      {category === "large" && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.label}>نوع السيارة الكبيرة</Text>
          <View style={styles.row}>
            {([{ key: "kia_cargo", label: "كيا حمل", emoji: "🛻" }, { key: "kia_passenger", label: "كيا ركاب", emoji: "🚐" }, { key: "bus", label: "باص", emoji: "🚌" }] as const).map((item) => (
              <TouchableOpacity key={item.key} style={[styles.category, vehicleType === item.key && styles.chipActive]} onPress={() => {
                setVehicleType(item.key);
                setSelectedMake("Kia");
                setSelectedModel(models.find((m) => m.make === "Kia" && m.model === item.label) ?? null);
              }}>
                <Text style={{ fontSize: 24 }}>{item.emoji}</Text>
                <Text style={[styles.chipText, vehicleType === item.key && styles.chipTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
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
  container: { flex: 1, backgroundColor: palette.canvas, paddingHorizontal: 20, paddingTop: 52 },
  statusContainer: { flex: 1, justifyContent: "center", padding: 24, gap: 18, backgroundColor: palette.canvas },
  title: { fontSize: 26, fontWeight: "900", color: palette.ink, marginBottom: 12, textAlign: "right" },
  note: { color: palette.muted, fontSize: 13, lineHeight: 22, textAlign: "right" },
  rejection: { color: palette.danger, backgroundColor: palette.dangerSoft, padding: 13, borderRadius: radius.md, marginTop: 12, textAlign: "right", lineHeight: 22 },
  statusText: { color: palette.ink, fontSize: 14, lineHeight: 26, textAlign: "right" },
  label: { fontSize: 13, fontWeight: "900", color: palette.ink, marginBottom: 8, marginTop: 18, textAlign: "right" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  category: { flex: 1, minWidth: 90, alignItems: "center", paddingHorizontal: 10, paddingVertical: 14, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  chipActive: { borderColor: palette.gold, backgroundColor: palette.brandSoft },
  chipText: { fontSize: 13, fontWeight: "800", color: palette.muted, textAlign: "center" },
  chipTextActive: { color: palette.brand },
  input: { minHeight: 54, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14, color: palette.ink, backgroundColor: palette.surface, textAlign: "right" },
  photoButton: { minHeight: 112, borderWidth: 1, borderStyle: "dashed", borderColor: palette.gold, borderRadius: radius.lg, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center", padding: 12 },
  photoText: { color: palette.brand, fontWeight: "900", textAlign: "center" },
  preview: { width: 150, height: 110, borderRadius: radius.md, resizeMode: "cover" },
});
