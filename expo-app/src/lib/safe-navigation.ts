import { router, type Href } from "expo-router";

const NAVIGATION_GUARD_MS = 450;
let lastNavigationAt = 0;

function acquireNavigationLock(): boolean {
  const now = Date.now();
  if (now - lastNavigationAt < NAVIGATION_GUARD_MS) return false;
  lastNavigationAt = now;
  return true;
}

/** Prevents rapid duplicate pushes from repeated taps. */
export function safeNavigate(href: Href, mode: "push" | "replace" = "push"): boolean {
  if (!acquireNavigationLock()) return false;
  try {
    if (mode === "replace") router.replace(href);
    else router.push(href);
    return true;
  } catch (error) {
    console.warn("[navigation] Route change failed:", error);
    lastNavigationAt = 0;
    return false;
  }
}

/** Goes back only when a previous screen exists; otherwise replaces safely. */
export function safeBack(fallback: Href = "/home"): boolean {
  if (!acquireNavigationLock()) return false;
  try {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
    return true;
  } catch (error) {
    console.warn("[navigation] Back navigation failed:", error);
    lastNavigationAt = 0;
    return false;
  }
}
