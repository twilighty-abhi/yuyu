import "server-only";

import { EventEmitter } from "node:events";
import Redis from "ioredis";
import { REDIS_FAIL_FAST_OPTIONS } from "@/lib/redisOptions";

/**
 * Realtime "your ticket was just checked in" notifications.
 *
 * Channels are keyed by the RSVP id, never by the bearer ticket token, so the
 * token does not travel through Redis, its monitoring, or logs. With
 * `REDIS_URL` configured, publishes fan out across every app replica through
 * Redis pub/sub using one lazily created, shared subscriber connection per
 * process with per-channel reference counting. Without Redis (single instance
 * or development), an in-process EventEmitter is used instead.
 *
 * Delivery is best effort: a missed message only delays the ticket animation
 * until the client's next status read or reconnect. Publishing never throws.
 */

export type TicketCheckedInMessage = { checkedInAt: string };
export type TicketCheckedInListener = (message: TicketCheckedInMessage) => void;
export type TicketCheckInUnsubscribe = (() => void) & {
  /** Resolves once the subscription is active (or failed); never rejects. */
  ready: Promise<void>;
};

const CHANNEL_PREFIX = "yuyu:ticket-checkin:";
const RSVP_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Shared through globalThis: Next.js can load this module more than once in
// one process (e.g. separate server-action and route-handler bundles), and
// without Redis a check-in published in one copy must reach streams held by
// another.
const EMITTER_KEY = Symbol.for("yuyu.ticketCheckInEmitter");
const globalScope = globalThis as typeof globalThis & { [EMITTER_KEY]?: EventEmitter };
const emitter: EventEmitter = globalScope[EMITTER_KEY] ?? (globalScope[EMITTER_KEY] = new EventEmitter());
// One listener per open ticket stream; the process-wide stream cap bounds it.
emitter.setMaxListeners(0);

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let redisMode: boolean | null = null;

function channelFor(rsvpId: string) {
  return `${CHANNEL_PREFIX}${rsvpId}`;
}

function usesRedis(): boolean {
  if (redisMode !== null) return redisMode;
  const url = process.env.REDIS_URL;
  redisMode = Boolean(url && /^rediss?:\/\//i.test(url));
  return redisMode;
}

function createClient(role: "publisher" | "subscriber"): Redis {
  // Mirrors lib/rateLimit.ts: fail fast per command and connect on first use.
  const client = new Redis(process.env.REDIS_URL as string, REDIS_FAIL_FAST_OPTIONS);
  client.on("error", () => {
    console.warn(`[ticketCheckInEvents] Redis ${role} error`);
  });
  return client;
}

function getPublisher(): Redis {
  publisher ??= createClient("publisher");
  return publisher;
}

function getSubscriber(): Redis {
  if (subscriber) return subscriber;
  subscriber = createClient("subscriber");
  subscriber.on("message", (channel: string, raw: string) => {
    if (!channel.startsWith(CHANNEL_PREFIX)) return;
    const message = parseMessage(raw);
    if (message) emitter.emit(channel, message);
  });
  return subscriber;
}

function parseMessage(raw: string): TicketCheckedInMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const checkedInAt = (value as { checkedInAt?: unknown }).checkedInAt;
    if (typeof checkedInAt !== "string" || Number.isNaN(Date.parse(checkedInAt))) return null;
    return { checkedInAt: new Date(checkedInAt).toISOString() };
  } catch {
    return null;
  }
}

function dispatchLocally(channel: string, message: TicketCheckedInMessage) {
  // Never run listener code synchronously inside the check-in request path.
  queueMicrotask(() => emitter.emit(channel, message));
}

/**
 * Announce that an RSVP has just transitioned to checked in. Call only after
 * the database write has committed. Fire-and-forget: never throws or rejects.
 */
export function publishTicketCheckedIn(params: { rsvpId: string; checkedInAt: Date | string }): void {
  try {
    if (!RSVP_ID_PATTERN.test(params.rsvpId)) return;
    const at = new Date(params.checkedInAt);
    if (Number.isNaN(at.getTime())) return;
    const channel = channelFor(params.rsvpId);
    const message: TicketCheckedInMessage = { checkedInAt: at.toISOString() };

    if (!usesRedis()) {
      dispatchLocally(channel, message);
      return;
    }

    getPublisher()
      .publish(channel, JSON.stringify(message))
      .catch(() => {
        console.warn("[ticketCheckInEvents] publish failed");
        // Best effort for viewers connected to this replica.
        dispatchLocally(channel, message);
      });
  } catch {
    console.warn("[ticketCheckInEvents] publish failed");
  }
}

/**
 * Listen for the check-in of one RSVP. Returns an idempotent unsubscribe
 * function whose `ready` promise settles once the subscription is live.
 */
export function subscribeTicketCheckedIn(rsvpId: string, listener: TicketCheckedInListener): TicketCheckInUnsubscribe {
  const channel = channelFor(rsvpId);
  const wrapped = (message: TicketCheckedInMessage) => {
    try {
      listener(message);
    } catch {
      console.warn("[ticketCheckInEvents] listener failed");
    }
  };

  let ready: Promise<void> = Promise.resolve();
  if (RSVP_ID_PATTERN.test(rsvpId)) {
    const firstForChannel = emitter.listenerCount(channel) === 0;
    emitter.on(channel, wrapped);
    if (firstForChannel && usesRedis()) {
      ready = getSubscriber()
        .subscribe(channel)
        .then(() => undefined, () => {
          console.warn("[ticketCheckInEvents] subscribe failed");
        });
    }
  }

  let active = true;
  const unsubscribe = (() => {
    if (!active) return;
    active = false;
    emitter.off(channel, wrapped);
    if (emitter.listenerCount(channel) === 0 && subscriber) {
      subscriber.unsubscribe(channel).catch(() => {
        console.warn("[ticketCheckInEvents] unsubscribe failed");
      });
    }
  }) as TicketCheckInUnsubscribe;
  unsubscribe.ready = ready;
  return unsubscribe;
}
