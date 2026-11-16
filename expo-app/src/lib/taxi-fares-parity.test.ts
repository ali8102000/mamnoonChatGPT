import { taxiFare } from "../../../src/lib/taxi-fares";
import { calculateMobileTaxiFare } from "./taxi-fares";
import { isValidPhone as isWebPhoneValid, normalizePhone as normalizeWebPhone, phoneToEmail as webPhoneToEmail } from "../../../src/lib/phone";
import { isValidPhone as isAndroidPhoneValid, normalizePhone as normalizeAndroidPhone, phoneToEmail as androidPhoneToEmail } from "./phone";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runTaxiFareParityTests() {
  const distances = [0, 0.625, 5, 8.3, 10, 12.49, 12.5, 15, 68];
  const categories = ["economy", "premium", "luxury"] as const;
  const tripTypes = ["one_way", "round_trip", "second_trip", "stop"] as const;
  const extraMinuteValues = [0, 5, 15, 60, 120];
  let comparisons = 0;

  for (const category of categories) {
    for (const distanceKm of distances) {
      for (const isIntercity of [false, true]) {
        for (const tripType of tripTypes) {
          for (const extraMinutes of extraMinuteValues) {
            const webFare = taxiFare(category, distanceKm, {
              isIntercity,
              tripType,
              extraMinutes,
            });
            const androidFare = calculateMobileTaxiFare(
              category,
              distanceKm,
              1,
              isIntercity,
              tripType,
              extraMinutes,
            );
            assert(
              androidFare === webFare,
              `Fare mismatch: ${JSON.stringify({ category, distanceKm, isIntercity, tripType, extraMinutes, webFare, androidFare })}`,
            );
            comparisons += 1;
          }
        }
      }
    }
  }

  for (const distanceKm of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    let webRejected = false;
    let androidRejected = false;
    try { taxiFare("economy", distanceKm); } catch { webRejected = true; }
    try { calculateMobileTaxiFare("economy", distanceKm); } catch { androidRejected = true; }
    assert(webRejected && androidRejected, `Invalid distance accepted: ${distanceKm}`);
  }

  for (const extraMinutes of [-5, 7, 125]) {
    let webRejected = false;
    let androidRejected = false;
    try { taxiFare("economy", 5, { extraMinutes }); } catch { webRejected = true; }
    try { calculateMobileTaxiFare("economy", 5, 1, false, "one_way", extraMinutes); } catch { androidRejected = true; }
    assert(webRejected && androidRejected, `Invalid waiting time accepted: ${extraMinutes}`);
  }

  const phoneSamples = [
    "07701234567",
    "+9647701234567",
    "9647701234567",
    "7701234567",
    "07 70-123-4567",
    "12345678",
    "",
    "+abc",
  ];
  for (const phone of phoneSamples) {
    assert(normalizeAndroidPhone(phone) === normalizeWebPhone(phone), `Phone normalization mismatch: ${phone}`);
    assert(isAndroidPhoneValid(phone) === isWebPhoneValid(phone), `Phone validation mismatch: ${phone}`);
    assert(androidPhoneToEmail(phone) === webPhoneToEmail(phone), `Phone identity mismatch: ${phone}`);
  }

  return { comparisons, invalidInputsChecked: 6, phoneSamplesChecked: phoneSamples.length };
}
