import type { MaterializedInfographic } from "@inf/contracts";
import { compareUtcInstants, parseUtcInstant } from "@inf/domain";

function compareUtcTimestamps(left: string, right: string): number {
  return compareUtcInstants(parseUtcInstant(left), parseUtcInstant(right));
}

export function recentInfographics(items: readonly MaterializedInfographic[]): MaterializedInfographic[] {
  return [...items].filter((item) => !item.archived).sort((left, right) => compareUtcTimestamps(right.capturedAt, left.capturedAt));
}

/** Deleted entries are absent from the owner catalog contract; archived entries are excluded here before selecting the next review rows. */
export function reviewNextInfographics(items: readonly MaterializedInfographic[]): MaterializedInfographic[] {
  return [...items].filter((item) => !item.archived && item.reviewDueAt !== null).sort((left, right) => compareUtcTimestamps(left.reviewDueAt!, right.reviewDueAt!));
}

export function formatDueTiming(dueAt: string, now = new Date()): string {
  const due = new Date(dueAt); if (!Number.isFinite(due.getTime()) || !Number.isFinite(now.getTime())) throw new RangeError("Expected a valid due time");
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayDifference = Math.round((dueDay - currentDay) / 86_400_000);
  if (dayDifference <= 0) {
    const hours = Math.ceil((due.getTime() - now.getTime()) / 3_600_000);
    return hours > 0 ? `Due in ${hours} hour${hours === 1 ? "" : "s"}` : "Due today";
  }
  if (dayDifference === 1) return "Due tomorrow";
  return `Due in ${dayDifference} days`;
}
