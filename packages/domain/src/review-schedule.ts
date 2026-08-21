import type { MaterializedInfographic, ReviewRating } from "@inf/contracts";

const MILLISECONDS_PER_DAY = 86_400_000;

export interface ReviewSchedule {
  intervalDays: number;
  dueAt: string;
}

function validUtcMilliseconds(timestamp: string): number {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new RangeError("Expected a valid reviewedAt timestamp");
  return milliseconds;
}

function validPreviousInterval(previousIntervalDays: number): number {
  if (!Number.isSafeInteger(previousIntervalDays) || previousIntervalDays < 1) {
    throw new RangeError("previousIntervalDays must be a positive safe integer");
  }
  return previousIntervalDays;
}

function firstInterval(rating: ReviewRating): number {
  switch (rating) {
    case "again": return 1;
    case "hard": return 3;
    case "good": return 7;
    case "easy": return 14;
  }
}

function subsequentInterval(rating: ReviewRating, previousIntervalDays: number): number {
  switch (rating) {
    case "again": return 1;
    case "hard": return Math.max(2, Math.round(previousIntervalDays * 1.2));
    case "good": return Math.max(4, Math.round(previousIntervalDays * 2));
    case "easy": return Math.max(7, Math.round(previousIntervalDays * 3));
  }
}

/**
 * Schedules from the supplied UTC review instant by adding exact 24-hour days.
 * This preserves the UTC time of day across local daylight-saving transitions.
 */
export function scheduleReview(
  rating: ReviewRating,
  previousIntervalDays: number | null,
  reviewedAt: string,
): ReviewSchedule {
  const reviewedAtMilliseconds = validUtcMilliseconds(reviewedAt);
  const intervalDays = previousIntervalDays === null
    ? firstInterval(rating)
    : subsequentInterval(rating, validPreviousInterval(previousIntervalDays));

  return {
    intervalDays,
    dueAt: new Date(reviewedAtMilliseconds + intervalDays * MILLISECONDS_PER_DAY).toISOString(),
  };
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Returns a new due-item list ordered by due time, least recent review, then ID. */
export function sortDueItems(items: readonly MaterializedInfographic[]): MaterializedInfographic[] {
  return items
    .filter((item) => item.reviewDueAt !== null)
    .sort((left, right) => {
      const dueOrder = validUtcMilliseconds(left.reviewDueAt!) - validUtcMilliseconds(right.reviewDueAt!);
      if (dueOrder !== 0) return dueOrder;

      const leftReviewedAt = left.lastReviewedAt === null ? Number.NEGATIVE_INFINITY : validUtcMilliseconds(left.lastReviewedAt);
      const rightReviewedAt = right.lastReviewedAt === null ? Number.NEGATIVE_INFINITY : validUtcMilliseconds(right.lastReviewedAt);
      return leftReviewedAt - rightReviewedAt || compareText(left.id, right.id);
    });
}
