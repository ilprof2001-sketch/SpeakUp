import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Returns true if the request is allowed, false if rate limit exceeded.
// Uses Redis INCR + EXPIRE: first request in the window sets the TTL.
export async function checkRateLimit(userId, endpoint, maxRequests, windowSeconds) {
  const key = `rl:${endpoint}:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count <= maxRequests;
}
