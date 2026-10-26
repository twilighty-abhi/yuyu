/**
 * Shared ioredis options for request-path clients (rate limiter, realtime
 * ticket check-in). A limiter check sits in front of most requests, so it
 * must answer quickly even while Redis is unreachable. The offline queue
 * stays on so the first command can open the lazy connection, but every
 * command, queued or sent, gets a short deadline instead of waiting on
 * ioredis reconnect backoff.
 */
export const REDIS_FAIL_FAST_OPTIONS = {
  maxRetriesPerRequest: 1,
  connectTimeout: 1000,
  commandTimeout: 500,
  lazyConnect: true,
} as const;
