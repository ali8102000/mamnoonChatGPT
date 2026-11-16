import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  DeviceEventEmitter,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Constants from "expo-constants";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { startMamnoonBackgroundLocation } from "@/lib/background-location";

const APP_ORIGIN = "https://mamnoon-theta.vercel.app";
const APP_URL = APP_ORIGIN + "/";
const AUTH_BRIDGE_EVENT = "mamnoon-auth-session";

function getSupabaseStorageKey(): string | null {
  try {
    const configuredUrl = String(Constants.expoConfig?.extra?.supabaseUrl ?? "");
    const projectRef = new URL(configuredUrl).hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

function buildAuthBridgeScript(storageKey: string | null, nativeSession: unknown) {
  if (!storageKey) return "true;";
  const key = JSON.stringify(storageKey);
  const session = nativeSession ? JSON.stringify(JSON.stringify(nativeSession)) : "null";
  return `(function () {
    try {
      var key = ${key};
      var nativeSession = ${session};
      if (nativeSession) {
        var existing = localStorage.getItem(key);
        var parsedExisting = existing ? JSON.parse(existing) : null;
        if (!parsedExisting || parsedExisting.access_token !== JSON.parse(nativeSession).access_token) {
          localStorage.setItem(key, nativeSession);
        }
      }
      var lastAccessToken = "";
      var signedInBefore = false;
      function send(type, value) {
        try {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, session: value }));
        } catch (_) {}
      }
      function syncSession() {
        try {
          var raw = localStorage.getItem(key);
          var stored = raw ? JSON.parse(raw) : null;
          var session = stored && (stored.currentSession || stored);
          if (session && session.access_token && session.refresh_token) {
            signedInBefore = true;
            if (session.access_token !== lastAccessToken) {
              lastAccessToken = session.access_token;
              send("${AUTH_BRIDGE_EVENT}", session);
            }
          } else if (signedInBefore) {
            signedInBefore = false;
            lastAccessToken = "";
            send("mamnoon-auth-signout", null);
          }
        } catch (_) {}
      }
      var originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        var result = originalSetItem.apply(this, arguments);
        if (this === localStorage && name === key) setTimeout(syncSession, 0);
        return result;
      };
      var originalRemoveItem = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (name) {
        var result = originalRemoveItem.apply(this, arguments);
        if (this === localStorage && name === key) setTimeout(syncSession, 0);
        return result;
      };
      syncSession();
      setInterval(syncSession, 1200);
    } catch (_) {}
  })();
  true;`;
}

function safeAppUrl(path: string): string {
  const candidate = path.startsWith("/") ? path : "/";
  return APP_ORIGIN + candidate;
}

export default function WebAppShell() {
  const { loading: authLoading, session, user } = useAuth();
  const webViewRef = useRef<WebView>(null);
  const lastTrackedRequest = useRef<string | null>(null);
  const [targetUrl, setTargetUrl] = useState(APP_URL);
  const [canGoBack, setCanGoBack] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(false);

  const storageKey = useMemo(getSupabaseStorageKey, []);
  const authBridgeScript = useMemo(
    () => buildAuthBridgeScript(storageKey, session),
    [storageKey, session?.access_token, session?.refresh_token],
  );

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener("mamnoon:web:navigate", (path: string) => {
      setPageError(false);
      setTargetUrl(safeAppUrl(path));
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  const syncNativeSession = useCallback(async (event: WebViewMessageEvent) => {
    if (event.nativeEvent.url) {
      try {
        if (new URL(event.nativeEvent.url).origin !== APP_ORIGIN) return;
      } catch {
        return;
      }
    }
    let message: any;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message?.type === AUTH_BRIDGE_EVENT) {
      const accessToken = message.session?.access_token;
      const refreshToken = message.session?.refresh_token;
      if (typeof accessToken !== "string" || typeof refreshToken !== "string") return;
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) console.warn("[Mamnoon WebView] Native session sync failed:", error.message);
    } else if (message?.type === "mamnoon-auth-signout") {
      await supabase.auth.signOut();
    }
  }, []);

  const handleNavigation = useCallback(async (navigation: WebViewNavigation) => {
    setCanGoBack(navigation.canGoBack);
    try {
      const url = new URL(navigation.url);
      if (url.origin !== APP_ORIGIN) return;
      const match = url.pathname.match(/^\/request\/([^/]+)\/?$/);
      const requestId = match?.[1];
      if (!requestId || !user?.id || !session || lastTrackedRequest.current === requestId) return;
      lastTrackedRequest.current = requestId;
      const { data: request, error } = await supabase
        .from("service_requests")
        .select("customer_id, provider_id, status")
        .eq("id", requestId)
        .maybeSingle();
      if (error || !request || !["accepted", "in_progress"].includes(request.status)) {
        lastTrackedRequest.current = null;
        return;
      }
      const role = request.customer_id === user.id
        ? "customer"
        : request.provider_id === user.id
          ? "provider"
          : null;
      if (!role) {
        lastTrackedRequest.current = null;
        return;
      }
      await startMamnoonBackgroundLocation({ requestId, userId: user.id, role });
    } catch (error) {
      lastTrackedRequest.current = null;
      console.warn("[Mamnoon WebView] Request location bridge failed:", error);
    }
  }, [session, user?.id]);

  const shouldStartNavigation = useCallback((request: { url: string }) => {
    if (request.url === "about:blank") return true;
    try {
      const url = new URL(request.url);
      if (url.origin === APP_ORIGIN) return true;
      if (url.protocol === "https:" || url.protocol === "mailto:" || url.protocol === "tel:") {
        void Linking.openURL(request.url).catch(() => undefined);
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  if (authLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0B65C2" />
        <Text style={styles.loadingText}>جاري تجهيز ممنون...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: targetUrl }}
        style={styles.webView}
        originWhitelist={[APP_ORIGIN + "/*", "about:blank"]}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled={false}
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="never"
        cacheEnabled
        incognito={false}
        injectedJavaScriptBeforeContentLoaded={authBridgeScript}
        injectedJavaScript={authBridgeScript}
        onMessage={syncNativeSession}
        onNavigationStateChange={handleNavigation}
        onShouldStartLoadWithRequest={shouldStartNavigation}
        onLoadStart={() => { setPageLoading(true); setPageError(false); }}
        onLoadEnd={() => setPageLoading(false)}
        onError={() => { setPageLoading(false); setPageError(true); }}
        onHttpError={(event) => {
          if (event.nativeEvent.statusCode >= 500) {
            setPageLoading(false);
            setPageError(true);
          }
        }}
        renderLoading={() => (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#0B65C2" />
          </View>
        )}
        startInLoadingState
        pullToRefreshEnabled={Platform.OS === "android"}
        textZoom={100}
        webviewDebuggingEnabled={__DEV__}
      />
      {pageLoading && (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0B65C2" />
        </View>
      )}
      {pageError && !pageLoading && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>تعذر الاتصال بممنون</Text>
          <Text style={styles.errorText}>تحقق من الإنترنت وحاول مرة ثانية</Text>
          <Text style={styles.retry} onPress={() => { setPageError(false); webViewRef.current?.reload(); }}>
            إعادة المحاولة
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F8FA" },
  webView: { flex: 1, backgroundColor: "transparent" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F7F8FA", gap: 12 },
  loadingText: { color: "#1E293B", fontSize: 14, fontWeight: "700" },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#F7F8FA" },
  errorOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#F7F8FA", padding: 24, gap: 12 },
  errorTitle: { color: "#172033", fontSize: 18, fontWeight: "900" },
  errorText: { color: "#64748B", fontSize: 14, textAlign: "center" },
  retry: { color: "#0B65C2", fontSize: 15, fontWeight: "900", padding: 12 },
});
