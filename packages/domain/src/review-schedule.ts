import type { MaterializedInfographic, ReviewRating } from "@inf/contracts";
import { addWholeUtcDays, compareUtcInstants, parseUtcInstant } from "./utc-instant";

export interface ReviewSchedule {
  intervalDays: number;
  dueAt: string;
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
  const intervalDays = previousIntervalDays === null
    ? firstInterval(rating)
    : subsequentInterval(rating, validPreviousInterval(previousIntervalDays));

  return {
    intervalDays,
    dueAt: addWholeUtcDays(reviewedAt, intervalDays),
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
      const dueOrder = compareUtcInstants(parseUtcInstant(left.reviewDueAt!), parseUtcInstant(right.reviewDueAt!));
      if (dueOrder !== 0) return dueOrder;

      if (left.lastReviewedAt === null && right.lastReviewedAt !== null) return -1;
      if (left.lastReviewedAt !== null && right.lastReviewedAt === null) return 1;
      if (left.lastReviewedAt !== null && right.lastReviewedAt !== null) {
        const reviewOrder = compareUtcInstants(parseUtcInstant(left.lastReviewedAt), parseUtcInstant(right.lastReviewedAt));
        if (reviewOrder !== 0) return reviewOrder;
      }
      return compareText(left.id, right.id);
    });
}
