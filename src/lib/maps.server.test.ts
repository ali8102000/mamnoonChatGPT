import { afterEach, describe, expect, it, vi } from "vitest";
import { getTrustedDrivingRoute } from "@/lib/maps.server";

describe("trusted driving route", () => {
  const previousGoogleKey = process.env.GOOGLE_MAPS_API_KEY;
  const previousGatewayKey = process.env.LOVABLE_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousGoogleKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previousGoogleKey;
    if (previousGatewayKey === undefined) delete process.env.LOVABLE_API_KEY;
    else process.env.LOVABLE_API_KEY = previousGatewayKey;
  });

  it("refuses to calculate a fare when server credentials are missing", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.LOVABLE_API_KEY;
    await expect(
      getTrustedDrivingRoute({ lat: 32, lng: 44 }, { lat: 32.1, lng: 44.1 }),
    ).rejects.toThrow("غير مهيأة");
  });

  it("uses the trusted route response and converts meters and seconds", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-google-key";
    process.env.LOVABLE_API_KEY = "test-gateway-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      routes: [{ distanceMeters: 12500, duration: "900s" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getTrustedDrivingRoute({ lat: 32, lng: 44 }, { lat: 32.1, lng: 44.1 }),
    ).resolves.toEqual({ distanceKm: 12.5, durationMin: 15 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/routes/directions/v2:computeRoutes");
    expect(options.method).toBe("POST");
    expect(String(options.body)).toContain('"travelMode":"DRIVE"');
  });

  it("rejects missing, zero, and implausible route results", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-google-key";
    process.env.LOVABLE_API_KEY = "test-gateway-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      routes: [{ distanceMeters: 0, duration: "0s" }],
    }), { status: 200 })));

    await expect(
      getTrustedDrivingRoute({ lat: 32, lng: 44 }, { lat: 32.1, lng: 44.1 }),
    ).rejects.toThrow("مسار طريق صالح");
  });
});
