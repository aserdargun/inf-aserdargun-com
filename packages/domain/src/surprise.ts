import type { MaterializedInfographic } from "@inf/contracts";
import { elapsedWholeUtcDaysSince, utcInstantFrom } from "./utc-instant";

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
  return value;
}

/**
 * Uses the surprise-selection formula from the design spec. Day differences are
 * floored elapsed 24-hour UTC periods, so time-zone transitions cannot affect them.
 */
export function surpriseWeight(item: MaterializedInfographic, now: Date | string): number {
  const nowInstant = utcInstantFrom(now);
  const seenCount = nonnegativeInteger(item.seenCount, "seenCount");
  const reviewCount = nonnegativeInteger(item.reviewCount, "reviewCount");
  const lastSeenAt = item.lastSeenAt;
  const neverSeen = lastSeenAt === null;
  const age = neverSeen
    ? Math.max(14, elapsedWholeUtcDaysSince(item.capturedAt, nowInstant) + 7)
    : Math.max(1, elapsedWholeUtcDaysSince(lastSeenAt, nowInstant));
  const weight = age * (neverSeen ? 2 : 1)
    / ((1 + seenCount) * (1 + reviewCount * 0.5));

  if (!Number.isFinite(weight) || weight <= 0) throw new RangeError("Expected a positive surprise weight");
  return weight;
}

/** FNV-1a UTF-16 code-unit hash reduced to an unsigned 32-bit PRNG state. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** One Mulberry32 step; returns a reproducible floating point value in [0, 1). */
function mulberry32(seed: number): number {
  let state = (seed + 0x6d2b79f5) >>> 0;
  let mixed = Math.imul(state ^ (state >>> 15), state | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
}

/**
 * Chooses an active item by its surprise weight without mutating the catalog.
 * The caller supplies a persisted string seed; FNV-1a and Mulberry32 make the
 * result repeatable without using Math.random(). Empty or inactive catalogs return null.
 */
export function selectWeighted(
  items: readonly MaterializedInfographic[],
  seed: string,
  now: Date | string,
): MaterializedInfographic | null {
  if (typeof seed !== "string") throw new TypeError("seed must be a string");

  const candidates = items.filter((item) => !item.archived);
  if (candidates.length === 0) return null;

  const weighted = candidates.map((item) => ({ item, weight: surpriseWeight(item, now) }));
  const totalWeight = weighted.reduce((total, candidate) => total + candidate.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;

  const target = mulberry32(hashSeed(seed)) * totalWeight;
  let cumulativeWeight = 0;
  for (const candidate of weighted) {
    cumulativeWeight += candidate.weight;
    if (target < cumulativeWeight) return candidate.item;
  }

  return weighted.at(-1)?.item ?? null;
}
