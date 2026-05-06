import { kv } from '@vercel/kv';

// Returns true if the request is allowed, false if rate limit exceeded.
// Uses Redis INCR + EXPIRE: first request in the window sets the TTL.
export async function checkRateLimit(userId, endpoint, maxRequests, windowSeconds) {
  const key = `rl:${endpoint}:${userId}`;
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, windowSeconds);
  return count <= maxRequests;
}
