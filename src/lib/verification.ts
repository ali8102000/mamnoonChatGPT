// Provider identity verification (Captains and Technicians)
// Handles face selfie capture, national ID card photo, legal name matching, and admin approval workflows.
import { compressImage } from "./image-compression";

export interface VerificationDocument {
  userId: string;
  role: "driver" | "worker";
  legalName: string;
  phone?: string;
  email?: string;
  facePhotoUrl: string; // Base64 data URL
  idCardPhotoUrl: string; // Base64 data URL
  idCardBackPhotoUrl?: string; // Back side of national ID, Base64 data URL
  vehicleDocumentPhotoUrl?: string; // Vehicle registration or power of attorney image
  idNumber?: string;
  documentType: "national_id" | "driver_license" | "passport";
  verifiedAt: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason?: string;
  // Specific driver details
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  vehiclePlate?: string;
  vehicleColor?: string;
  vehicleCategory?: string;
  // Specific worker details
  workerLevel?: "fani" | "khabir";
  workerBio?: string;
  workerServices?: string[];
}

const STORAGE_KEY_PREFIX = "mumnun_verification_";
const ALL_VERIFICATIONS_KEY = "mumnun_all_verifications";

export function getProviderVerification(userId: string, role?: VerificationDocument["role"]): VerificationDocument | null {
  if (typeof window === "undefined") return null;
  try {
    if (role) {
      const roleRaw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}_${role}`);
      if (roleRaw) return JSON.parse(roleRaw);
    }
    const legacyRaw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as VerificationDocument;
      if (!role || legacy.role === role) return legacy;
    }
    const list = getAllProviderVerifications();
    return list.find((v) => v.userId === userId && (!role || v.role === role)) ?? null;
  } catch {
    return null;
  }
}

export function getAllProviderVerifications(): VerificationDocument[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ALL_VERIFICATIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveProviderVerification(doc: VerificationDocument): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${doc.userId}_${doc.role}`, JSON.stringify(doc));
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${doc.userId}`, JSON.stringify(doc));
    const all = getAllProviderVerifications().filter((v) => !(v.userId === doc.userId && v.role === doc.role));
    all.unshift(doc);
    localStorage.setItem(ALL_VERIFICATIONS_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn("[verification] Failed to persist verification", e);
  }
}

export function updateVerificationStatus(
  userId: string,
  status: "pending" | "approved" | "rejected",
  rejectionReason?: string,
): VerificationDocument | null {
  if (typeof window === "undefined") return null;
  try {
    const current = getProviderVerification(userId);
    if (!current) return null;
    const updated: VerificationDocument = {
      ...current,
      status,
      rejectionReason: rejectionReason ?? (status === "approved" ? undefined : current.rejectionReason),
      verifiedAt: new Date().toISOString(),
    };
    saveProviderVerification(updated);
    return updated;
  } catch {
    return null;
  }
}

/** Reads a File into a compressed Base64 Data URL for instant rendering and storage */
export async function fileToCompressedDataUrl(
  file: File,
  maxWidth = 1000,
  maxHeight = 1000,
  quality = 0.75,
): Promise<string> {
  const compressed = await compressImage(file, maxWidth, maxHeight, quality);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(compressed);
  });
}

/**
 * Uploads verification images to private Supabase Storage and persists their
 * paths and review metadata in the database. The localStorage copy is only a
 * same-device convenience; the database/storage copy is authoritative.
 */
export async function saveProviderVerificationRemote(doc: VerificationDocument): Promise<void> {
  const { supabase } = await import("@/integrations/supabase/client");
  const bucket = "provider-verification";
  const stamp = Date.now();
  const uploadImage = async (dataUrl: string, kind: "face" | "id-card" | "id-card-back" | "vehicle-registration") => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const mime = blob.type === "image/png" ? "image/png" : "image/jpeg";
    const extension = mime === "image/png" ? "png" : "jpg";
    const path = `${doc.userId}/${doc.role}/${kind}-${stamp}.${extension}`;
    const { error } = await supabase.storage.from(bucket).upload(path, blob, {
      contentType: mime,
      upsert: true,
      cacheControl: "3600",
    });
    if (error) throw new Error(`تعذر حفظ ${kind === "face" ? "صورة الوجه" : kind === "id-card" ? "صورة الهوية" : "صورة سنوية السيارة أو الوكالة"}: ${error.message}`);
    return path;
  };

  const [facePath, idPath, idBackPath, vehicleDocumentPath] = await Promise.all([
    uploadImage(doc.facePhotoUrl, "face"),
    uploadImage(doc.idCardPhotoUrl, "id-card"),
    doc.documentType === "national_id" && doc.idCardBackPhotoUrl
      ? uploadImage(doc.idCardBackPhotoUrl, "id-card-back")
      : Promise.resolve(null),
    doc.role === "driver" && doc.vehicleDocumentPhotoUrl
      ? uploadImage(doc.vehicleDocumentPhotoUrl, "vehicle-registration")
      : Promise.resolve(null),
  ]);

  const { error } = await (supabase as any).from("provider_verifications").upsert({
    user_id: doc.userId,
    provider_type: doc.role,
    legal_name: doc.legalName,
    phone: doc.phone ?? null,
    email: doc.email ?? null,
    face_photo_path: facePath,
    id_card_photo_path: idPath,
    id_card_back_photo_path: idBackPath,
    vehicle_document_path: vehicleDocumentPath,
    document_type: doc.documentType,
    id_number: doc.idNumber ?? null,
    metadata: {
      vehicleMake: doc.vehicleMake ?? null,
      vehicleModel: doc.vehicleModel ?? null,
      vehicleYear: doc.vehicleYear ?? null,
      vehiclePlate: doc.vehiclePlate ?? null,
      vehicleColor: doc.vehicleColor ?? null,
      vehicleCategory: doc.vehicleCategory ?? null,
      workerLevel: doc.workerLevel ?? null,
      workerBio: doc.workerBio ?? null,
      workerServices: doc.workerServices ?? [],
    },
    status: "pending",
    rejection_reason: null,
    submitted_at: new Date().toISOString(),
    reviewed_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,provider_type" });
  if (error) throw new Error(`تعذر حفظ طلب التوثيق: ${error.message}`);
}
