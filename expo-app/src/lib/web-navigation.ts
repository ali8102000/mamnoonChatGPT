let pendingPath: string | null = null;
const listeners = new Set<(path: string) => void>();

export function navigateToWebPath(path: string) {
  const safePath = path.startsWith("/") ? path : "/";
  pendingPath = safePath;
  for (const listener of listeners) listener(safePath);
}

export function subscribeToWebNavigation(listener: (path: string) => void) {
  listeners.add(listener);
  if (pendingPath) {
    const path = pendingPath;
    pendingPath = null;
    listener(path);
  }
  return () => listeners.delete(listener);
}
