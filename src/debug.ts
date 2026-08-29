type LogDetails = Record<string, unknown>;
type LogScope = "background" | "content" | "popup" | "options";

const SECRET_KEYS = new Set([
  "apikey",
  "authorization",
  "content",
  "credential",
  "prompt",
  "response",
  "secret",
  "text",
  "token",
]);

export function logInfo(scope: LogScope, event: string, details: LogDetails = {}): void {
  console.info(`[LinguaMark:${scope}] ${event}`, sanitize(details));
}

export function logWarn(scope: LogScope, event: string, details: LogDetails = {}): void {
  console.warn(`[LinguaMark:${scope}] ${event}`, sanitize(details));
}

export function logError(scope: LogScope, event: string, details: LogDetails = {}): void {
  console.error(`[LinguaMark:${scope}] ${event}`, sanitize(details));
}

function sanitize(value: unknown, key = "", depth = 0): unknown {
  const normalizedKey = key.replaceAll(/[^a-z]/giu, "").toLowerCase();
  if (SECRET_KEYS.has(normalizedKey)) return "[redacted]";
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") {
    if (/\bBearer\s+\S+/iu.test(value) || /\bsk-[a-z0-9_-]+/iu.test(value)) return "[redacted]";
    return value.length > 160 ? `${value.slice(0, 157)}…` : value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: sanitize(value.message, "message", depth + 1) };
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitize(entryValue, entryKey, depth + 1),
    ]));
  }
  return value;
}
