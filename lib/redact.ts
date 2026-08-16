const SECRET_KEY_PATTERN = /(api[-_ ]?key|token|secret|password|authorization|credential|cookie|session)/i;
const MAX_STRING_LENGTH = 1200;

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[Max depth]";
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSensitive(item, depth + 1);
    }
    return redacted;
  }
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
  }
  return value;
}

export function safeJson(value: unknown) {
  return JSON.stringify(redactSensitive(value));
}
