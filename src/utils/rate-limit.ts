type LimitState = {
  count: number;
  windowStartedAt: number;
  blockedUntil: number;
};

type LimitInput = {
  key: string;
  maxRequests: number;
  windowMs: number;
  blockMs: number;
};

type LimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const state = new Map<string, LimitState>();

function nowMs(): number {
  return Date.now();
}

function cleanupIfNeeded(currentTime: number): void {
  if (state.size < 2000) return;

  for (const [key, item] of state.entries()) {
    const windowExpired = currentTime - item.windowStartedAt > 24 * 60 * 60 * 1000;
    const unblocked = item.blockedUntil <= currentTime;
    if (windowExpired && unblocked) {
      state.delete(key);
    }
  }
}

export function checkRateLimit(input: LimitInput): LimitResult {
  const { key, maxRequests, windowMs, blockMs } = input;
  const currentTime = nowMs();

  cleanupIfNeeded(currentTime);

  const item = state.get(key);
  if (!item) {
    state.set(key, {
      count: 1,
      windowStartedAt: currentTime,
      blockedUntil: 0,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (item.blockedUntil > currentTime) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((item.blockedUntil - currentTime) / 1000)),
    };
  }

  if (currentTime - item.windowStartedAt >= windowMs) {
    item.count = 1;
    item.windowStartedAt = currentTime;
    item.blockedUntil = 0;
    state.set(key, item);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  item.count += 1;
  if (item.count > maxRequests) {
    item.blockedUntil = currentTime + blockMs;
    state.set(key, item);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(blockMs / 1000)),
    };
  }

  state.set(key, item);
  return { allowed: true, retryAfterSeconds: 0 };
}
