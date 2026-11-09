import type { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const easProjectId = process.env.EAS_PROJECT_ID;
  const isProduction = process.env.APP_ENV === "production";
  const isEasBuild = process.env.EAS_BUILD === "true";

  // EAS env:exec must be able to resolve the project before it can inject
  // remote production variables. Validate those values in the env:exec
  // preflight script and again on the remote production build worker.
  const missingProductionConfig = [
    ...(!supabaseUrl ? ["EXPO_PUBLIC_SUPABASE_URL"] : []),
    ...(!supabasePublishableKey ? ["EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] : []),
    ...(!mapsKey ? ["EXPO_PUBLIC_GOOGLE_MAPS_API_KEY"] : []),
    ...(!easProjectId ? ["EAS_PROJECT_ID"] : []),
  ];
  if (isProduction && isEasBuild && missingProductionConfig.length) {
    throw new Error(
      `Production build is missing required Expo environment variables: ${missingProductionConfig.join(", ")}`,
    );
  }
  if (isProduction && supabaseUrl && !supabaseUrl.startsWith("https://")) {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL must use HTTPS in production.");
  }
  if (
    isProduction &&
    easProjectId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      easProjectId,
    )
  ) {
    throw new Error("EAS_PROJECT_ID must be a valid Expo project UUID.");
  }

  return {
    ...config,
    name: config.name ?? "ممنون",
    slug: config.slug ?? "mamnoon",
    ios: {
      ...config.ios,
      ...(mapsKey
        ? {
            config: {
              ...config.ios?.config,
              googleMapsApiKey: mapsKey,
            },
          }
        : {}),
    },
    android: {
      ...config.android,
      ...(mapsKey
        ? {
            config: {
              ...config.android?.config,
              googleMaps: { apiKey: mapsKey },
            },
          }
        : {}),
    },
    extra: {
      ...config.extra,
      ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
      ...(supabaseUrl ? { supabaseUrl } : {}),
      ...(supabasePublishableKey ? { supabasePublishableKey } : {}),
    },
  };
};
