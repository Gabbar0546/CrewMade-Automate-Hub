type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const globalBuckets = globalThis as typeof globalThis & {
  __automationHubRateLimits?: Map<string, Bucket>;
};

const buckets = globalBuckets.__automationHubRateLimits ?? new Map<string, Bucket>();
globalBuckets.__automationHubRateLimits = buckets;

function requestIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return;

  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw Object.assign(new Error("Invalid request origin"), { status: 403 });
  }

  if (originHost !== host) {
    throw Object.assign(new Error("Invalid request origin"), { status: 403 });
  }
}

export function assertRateLimit(request: Request, options: RateLimitOptions) {
  const now = Date.now();
  const key = `${options.key}:${requestIp(request)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > options.limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    throw Object.assign(new Error(`Too many requests. Try again in ${retryAfter}s.`), { status: 429 });
  }
}
