// Professional logging system with levels, remote reporting, and local buffering.

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: string;
  url?: string;
  userId?: string;
}

const LOG_BUFFER_KEY = "mumnun_log_buffer";
const MAX_BUFFER = 50;
let remoteEndpoint: string | null = null;
let userId: string | null = null;

export function configureLogging(opts: { endpoint?: string; userId?: string }) {
  if (opts.endpoint) remoteEndpoint = opts.endpoint;
  if (opts.userId) userId = opts.userId;
}

function getBuffer(): LogEntry[] {
  try {
    const raw = sessionStorage.getItem(LOG_BUFFER_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

function saveBuffer(entries: LogEntry[]) {
  try {
    sessionStorage.setItem(LOG_BUFFER_KEY, JSON.stringify(entries.slice(-MAX_BUFFER)));
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

function describeUnknown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function log(level: LogLevel, message: string, data?: unknown) {
  const entry: LogEntry = {
    level,
    message,
    data: data instanceof Error ? { name: data.name, message: data.message, stack: data.stack } : data,
    timestamp: new Date().toISOString(),
    url: typeof window !== "undefined" ? window.location.href : undefined,
    userId: userId ?? undefined,
  };

  const fn = level === "error" || level === "fatal" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[${level.toUpperCase()}] ${message}`, data ?? "");

  const buffer = getBuffer();
  buffer.push(entry);
  saveBuffer(buffer);

  if ((level === "error" || level === "fatal") && remoteEndpoint) {
    try {
      fetch(remoteEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
        keepalive: true,
      }).catch(() => {
        // Remote logging must never interrupt the application.
      });
    } catch {
      // Remote logging is best-effort only.
    }
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => log("debug", msg, data),
  info: (msg: string, data?: unknown) => log("info", msg, data),
  warn: (msg: string, data?: unknown) => log("warn", msg, data),
  error: (msg: string, data?: unknown) => log("error", msg, data),
  fatal: (msg: string, data?: unknown) => log("fatal", msg, data),
  getBuffer: () => getBuffer(),
  clearBuffer: () => saveBuffer([]),
};

if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => {
    log("error", `Uncaught error: ${e.message}`, { filename: e.filename, line: e.lineno, col: e.colno });
  });
  window.addEventListener("unhandledrejection", (e) => {
    log("error", `Unhandled rejection: ${describeUnknown(e.reason)}`, e.reason);
  });
}
