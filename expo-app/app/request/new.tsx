import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';
import { haversineKm, estimateFare } from '@/lib/pricing';
import { Button } from '@/components/ui';

type Coordinates = { latitude: number; longitude: number };
type VehicleCategory = 'economy' | 'premium' | 'luxury';

const SERVICES = [
  { slug: 'taxi', label: 'سيارة', emoji: '🚕', color: '#2563eb' },
  { slug: 'build', label: 'بناء', emoji: '🧱', color: '#ea580c' },
  { slug: 'plaster', label: 'لبخ', emoji: '🪣', color: '#d97706' },
  { slug: 'carpentry_form', label: 'نجارة وقالب', emoji: '📐', color: '#a16207' },
  { slug: 'flooring', label: 'أرضيات', emoji: '🟫', color: '#78716c' },
  { slug: 'chef', label: 'طباخ', emoji: '👨‍🍳', color: '#e11d48' },
  { slug: 'plumbing', label: 'تأسيس ماء', emoji: '🚰', color: '#0891b2' },
  { slug: 'electric_setup', label: 'تأسيس كهرباء', emoji: '💡', color: '#ca8a04' },
  { slug: 'electric_street', label: 'تصليح كهرباء', emoji: '⚡', color: '#d97706' },
  { slug: 'washer_repair', label: 'تصليح غسالة', emoji: '🧺', color: '#0284c7' },
  { slug: 'stove_repair', label: 'تصليح طباخ', emoji: '🔥', color: '#dc2626' },
  { slug: 'fridge_repair', label: 'تصليح ثلاجة', emoji: '🧊', color: '#0ea5e9' },
  { slug: 'ac_repair', label: 'مكيفات', emoji: '❄️', color: '#0284c7' },
  { slug: 'cleaning', label: 'تنظيف بيوت', emoji: '🧹', color: '#16a34a' },
  { slug: 'wood_carpentry', label: 'نجارة أخشاب', emoji: '🪵', color: '#a16207' },
  { slug: 'blacksmith', label: 'حدادة', emoji: '⚒️', color: '#475569' },
  { slug: 'general', label: 'خدمات عامة', emoji: '🏠', color: '#7c3aed' },
];

const VEHICLE_CATS: { key: VehicleCategory; label: string; emoji: string }[] = [
  { key: 'economy', label: 'اقتصادية', emoji: '🚗' },
  { key: 'premium', label: 'فاخرة', emoji: '🚙' },
  { key: 'luxury', label: 'VIP', emoji: '🚘' },
];

const BAGHDAD_REGION = {
  latitude: 33.3152,
  longitude: 44.3661,
  latitudeDelta: 0.035,
  longitudeDelta: 0.035,
};

function formatAddress(parts: Location.LocationGeocodedAddress[] | null | undefined) {
  const item = parts?.[0];
  if (!item) return '';
  return [item.name, item.street, item.district, item.city, item.region]
    .filter((part): part is string => Boolean(part?.trim()))
    .filter((part, index, all) => all.indexOf(part) === index)
    .join('، ');
}

export default function NewRequest() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const { user } = useAuth();
  const [selectedService, setSelectedService] = useState(type || 'taxi');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupCoords, setPickupCoords] = useState<Coordinates | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<Coordinates | null>(null);
  const [mapMode, setMapMode] = useState<'pickup' | 'destination'>('pickup');
  const [region, setRegion] = useState(BAGHDAD_REGION);
  const [locationLoading, setLocationLoading] = useState(true);
  const [vehicleCat, setVehicleCat] = useState<VehicleCategory>('economy');
  const [workerLevel, setWorkerLevel] = useState<'fani' | 'khabir'>('fani');
  const [extraWorkers, setExtraWorkers] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const isTaxi = selectedService === 'taxi';

  useEffect(() => {
    let mounted = true;
    async function locateInitialPosition() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') return;
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!mounted) return;
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setPickupCoords(coords);
        setRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 });
        const address = formatAddress(await Location.reverseGeocodeAsync(coords));
        if (address) setPickup(address);
      } catch {
        if (mounted) Alert.alert('تعذر تحديد الموقع', 'حدد موقع الانطلاق يدوياً من الخريطة.');
      } finally {
        if (mounted) setLocationLoading(false);
      }
    }
    locateInitialPosition();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!pickupCoords || !destinationCoords || !isTaxi) {
      setPrice(null);
      return;
    }
    const straightDistance = haversineKm(
      pickupCoords.latitude,
      pickupCoords.longitude,
      destinationCoords.latitude,
      destinationCoords.longitude,
    );
    // A display-only estimate. The server must calculate and confirm the final fare.
    setPrice(estimateFare(straightDistance * 1.35, vehicleCat));
  }, [pickupCoords, destinationCoords, isTaxi, vehicleCat]);

  async function locateMe() {
    setLocationLoading(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('إذن الموقع مطلوب', 'اسمح لممنون باستخدام الموقع أو اختر النقطة يدوياً.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      setPickupCoords(coords);
      setRegion({ ...coords, latitudeDelta: 0.015, longitudeDelta: 0.015 });
      const address = formatAddress(await Location.reverseGeocodeAsync(coords));
      setPickup(address || 'موقعي الحالي');
      setMapMode('pickup');
    } catch {
      Alert.alert('تعذر تحديد الموقع', 'تأكد من تشغيل GPS وحاول مرة أخرى.');
    } finally {
      setLocationLoading(false);
    }
  }

  async function chooseMapPoint(coords: Coordinates) {
    if (mapMode === 'pickup') {
      setPickupCoords(coords);
      const address = formatAddress(await Location.reverseGeocodeAsync(coords).catch(() => []));
      setPickup(address || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
    } else {
      setDestinationCoords(coords);
      const address = formatAddress(await Location.reverseGeocodeAsync(coords).catch(() => []));
      setDestination(address || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
    }
  }

  async function submit() {
    if (!user) {
      Alert.alert('تسجيل الدخول مطلوب', 'سجّل الدخول قبل إرسال الطلب.');
      return;
    }
    if (!pickupCoords) {
      Alert.alert('حدد موقع الانطلاق', 'اختر موقعك من الخريطة أو استخدم تحديد موقعي.');
      return;
    }
    if (isTaxi && !destinationCoords) {
      Alert.alert('حدد الوجهة', 'اختر الوجهة من الخريطة قبل طلب السيارة.');
      return;
    }
    if (!pickup.trim() || (isTaxi && !destination.trim())) {
      Alert.alert('بيانات ناقصة', 'أكمل وصف الموقع والوجهة.');
      return;
    }

    setBusy(true);
    try {
      let requestId: string;
      if (isTaxi) {
        const { data: taxiRequest, error: taxiError } = await supabase.functions.invoke('create-taxi-request', {
          body: {
            pickupLat: pickupCoords.latitude,
            pickupLng: pickupCoords.longitude,
            pickupText: pickup,
            destinationLat: destinationCoords!.latitude,
            destinationLng: destinationCoords!.longitude,
            destinationText: destination,
            vehicleCategory: vehicleCat,
            notes,
          },
        });
        if (taxiError) throw taxiError;
        if (!taxiRequest?.requestId) throw new Error('تعذّر إنشاء طلب التكسي.');
        requestId = taxiRequest.requestId;

        const { error: dispatchError } = await supabase.rpc('dispatch_request', {
          _request_id: requestId,
        });
        if (dispatchError) {
          Alert.alert('تم إنشاء الطلب', 'تعذر توزيع الطلب على السائقين الآن. افتح تفاصيل الطلب وحاول إعادة المحاولة لاحقاً.');
        }
      } else {
        const { data: serviceRow, error: serviceError } = await supabase
          .from('services')
          .select('id')
          .eq('slug', selectedService)
          .maybeSingle();
        if (serviceError) throw serviceError;
        if (!serviceRow?.id) throw new Error('الخدمة المختارة غير متاحة حالياً.');

        const { data: request, error } = await supabase
          .from('service_requests')
          .insert({
            customer_id: user.id,
            type: 'service',
            status: 'pending',
            service_id: serviceRow.id,
            pickup_text: pickup,
            pickup_lat: pickupCoords.latitude,
            pickup_lng: pickupCoords.longitude,
            dest_text: destination || null,
            dest_lat: destinationCoords?.latitude ?? null,
            dest_lng: destinationCoords?.longitude ?? null,
            level_required: workerLevel,
            workers_count: extraWorkers + 1,
            pricing_mode: 'negotiable',
            customer_price: null,
            notes: notes || null,
          })
          .select('id')
          .single();
        if (error || !request) throw error ?? new Error('تعذّر إنشاء طلب الخدمة.');
        requestId = request.id;
      }

      router.replace({ pathname: '/request/[id]', params: { id: requestId } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      Alert.alert('تعذر إرسال الطلب', message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>طلب جديد</Text>
      <Text style={styles.label}>نوع الخدمة</Text>
      <View style={styles.serviceGrid}>
        {SERVICES.map((service) => (
          <TouchableOpacity
            key={service.slug}
            style={[
              styles.serviceTile,
              selectedService === service.slug && {
                backgroundColor: service.color + '20',
                borderColor: service.color,
              },
            ]}
            onPress={() => setSelectedService(service.slug)}
          >
            <Text style={styles.serviceEmoji}>{service.emoji}</Text>
            <Text
              style={[
                styles.serviceLabel,
                { color: selectedService === service.slug ? service.color : '#64748b' },
              ]}
            >
              {service.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>حدد النقطة على الخريطة</Text>
      <View style={styles.mapModeRow}>
        <TouchableOpacity
          style={[styles.mapModeButton, mapMode === 'pickup' && styles.mapModeButtonActive]}
          onPress={() => setMapMode('pickup')}
        >
          <Text style={[styles.mapModeText, mapMode === 'pickup' && styles.mapModeTextActive]}>
            نقطة الانطلاق
          </Text>
        </TouchableOpacity>
        {isTaxi && (
          <TouchableOpacity
            style={[
              styles.mapModeButton,
              mapMode === 'destination' && styles.mapModeButtonActive,
            ]}
            onPress={() => setMapMode('destination')}
          >
            <Text
              style={[
                styles.mapModeText,
                mapMode === 'destination' && styles.mapModeTextActive,
              ]}
            >
              الوجهة
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.locateButton} onPress={locateMe} disabled={locationLoading}>
          {locationLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.locateButtonText}>موقعي</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.mapContainer}>
        <MapView
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          region={region}
          onRegionChangeComplete={setRegion}
          onPress={(event) => chooseMapPoint(event.nativeEvent.coordinate)}
          showsUserLocation
          showsMyLocationButton={false}
          loadingEnabled
        >
          {pickupCoords && (
            <Marker coordinate={pickupCoords} title="نقطة الانطلاق" pinColor="#2563eb" />
          )}
          {destinationCoords && isTaxi && (
            <Marker coordinate={destinationCoords} title="الوجهة" pinColor="#16a34a" />
          )}
        </MapView>
        <Text style={styles.mapHint}>
          {mapMode === 'pickup' ? 'اضغط على الخريطة لتحديد الانطلاق' : 'اضغط على الخريطة لتحديد الوجهة'}
        </Text>
      </View>

      <Text style={styles.label}>وصف نقطة الانطلاق</Text>
      <TextInput
        style={styles.input}
        value={pickup}
        onChangeText={setPickup}
        placeholder="موقعك الحالي أو وصف المكان"
        placeholderTextColor="#94a3b8"
      />
      {isTaxi && (
        <>
          <Text style={styles.label}>وصف الوجهة</Text>
          <TextInput
            style={styles.input}
            value={destination}
            onChangeText={setDestination}
            placeholder="إلى أين؟"
            placeholderTextColor="#94a3b8"
          />
        </>
      )}

      {isTaxi ? (
        <>
          <Text style={styles.label}>فئة السيارة</Text>
          <View style={styles.catRow}>
            {VEHICLE_CATS.map((category) => (
              <TouchableOpacity
                key={category.key}
                style={[
                  styles.catChip,
                  vehicleCat === category.key && styles.catChipActive,
                ]}
                onPress={() => setVehicleCat(category.key)}
              >
                <Text style={styles.catEmoji}>{category.emoji}</Text>
                <Text
                  style={[
                    styles.catLabel,
                    vehicleCat === category.key && styles.catLabelActive,
                  ]}
                >
                  {category.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : (
        <>
          <Text style={styles.label}>مستوى الفني</Text>
          <View style={styles.catRow}>
            <TouchableOpacity
              style={[styles.catChip, workerLevel === 'fani' && styles.catChipActive]}
              onPress={() => setWorkerLevel('fani')}
            >
              <Text style={[styles.catLabel, workerLevel === 'fani' && styles.catLabelActive]}>
                فني
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.catChip, workerLevel === 'khabir' && styles.catChipActive]}
              onPress={() => setWorkerLevel('khabir')}
            >
              <Text style={[styles.catLabel, workerLevel === 'khabir' && styles.catLabelActive]}>
                خبير
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.label}>عدد الفنيين الإضافيين: {extraWorkers}</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => setExtraWorkers(Math.max(0, extraWorkers - 1))}
            >
              <Text style={styles.stepperText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.stepperValue}>{extraWorkers}</Text>
            <TouchableOpacity
              style={styles.stepperBtn}
              onPress={() => setExtraWorkers(Math.min(5, extraWorkers + 1))}
            >
              <Text style={styles.stepperText}>+</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <Text style={styles.label}>ملاحظات (اختياري)</Text>
      <TextInput
        style={[styles.input, { height: 80 }]}
        value={notes}
        onChangeText={setNotes}
        placeholder="أي تفاصيل إضافية..."
        placeholderTextColor="#94a3b8"
        multiline
      />

      {price !== null && isTaxi && (
        <View style={styles.priceBox}>
          <Text style={styles.priceLabel}>تقدير أولي تقريبي (ليس السعر النهائي)</Text>
          <Text style={styles.priceValue}>{price.toLocaleString('en')} د.ع</Text>
          <Text style={styles.priceNote}>السعر النهائي يحتاج حساب مسار الطريق من الخادم</Text>
        </View>
      )}
      <View style={{ height: 24 }} />
      <Button title="إرسال الطلب" onPress={submit} loading={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 50 },
  title: { fontSize: 28, fontWeight: '900', color: '#1e293b', marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '700', color: '#64748b', marginBottom: 8, marginTop: 16 },
  serviceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  serviceTile: { width: '31%', aspectRatio: 1, borderRadius: 16, backgroundColor: '#fff', borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  serviceEmoji: { fontSize: 32, marginBottom: 4 },
  serviceLabel: { fontSize: 13, fontWeight: '700' },
  mapModeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  mapModeButton: { flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: '#e2e8f0', alignItems: 'center' },
  mapModeButtonActive: { backgroundColor: '#1e40af' },
  mapModeText: { color: '#64748b', fontWeight: '700', fontSize: 12 },
  mapModeTextActive: { color: '#fff' },
  locateButton: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: '#16a34a', minWidth: 62, alignItems: 'center' },
  locateButtonText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  mapContainer: { height: 280, borderRadius: 18, overflow: 'hidden', marginTop: 8 },
  map: { flex: 1 },
  mapHint: { position: 'absolute', bottom: 10, alignSelf: 'center', backgroundColor: 'rgba(15,23,42,0.82)', color: '#fff', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, fontSize: 11, overflow: 'hidden' },
  input: { borderWidth: 1, borderColor: 'rgba(30,41,59,0.1)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, fontWeight: '600', color: '#1e293b', backgroundColor: 'rgba(30,41,59,0.03)', textAlign: 'left' },
  catRow: { flexDirection: 'row', gap: 10 },
  catChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, backgroundColor: '#fff', borderWidth: 2, borderColor: 'transparent' },
  catChipActive: { borderColor: '#2563eb', backgroundColor: '#2563eb10' },
  catEmoji: { fontSize: 18 },
  catLabel: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  catLabelActive: { color: '#2563eb' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  stepperBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(30,41,59,0.1)' },
  stepperText: { fontSize: 24, fontWeight: '900', color: '#2563eb' },
  stepperValue: { fontSize: 20, fontWeight: '800', color: '#1e293b' },
  priceBox: { backgroundColor: '#2563eb10', borderRadius: 16, padding: 16, alignItems: 'center', marginTop: 20 },
  priceLabel: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  priceValue: { fontSize: 24, fontWeight: '900', color: '#2563eb', marginTop: 4 },
  priceNote: { fontSize: 11, color: '#64748b', marginTop: 6, textAlign: 'center' },
});
