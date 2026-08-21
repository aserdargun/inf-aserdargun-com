import { randomUUID } from "node:crypto";
import { InfEventSchema, type ReviewRating, type ReviewRecord } from "@inf/contracts";
import { scheduleReview } from "@inf/domain";
import type { EventStore } from "../storage/event-store.js";
import type { CatalogSnapshot } from "./catalog-service.js";
import { AppError } from "../http/errors.js";

export class ReviewService {
  private readonly now: () => Date;
  private readonly uuid: () => string;
  constructor(private readonly events: Pick<EventStore, "append">, options: { now?: () => Date; uuid?: () => string } = {}) {
    this.now = options.now ?? (() => new Date()); this.uuid = options.uuid ?? randomUUID;
  }

  async record(snapshot: CatalogSnapshot, infographicId: string, rating: ReviewRating): Promise<ReviewRecord> {
    const item = snapshot.infographics.find((candidate) => candidate.id === infographicId);
    if (!item) throw new AppError("NOT_FOUND", 404, "Infographic was not found");
    const prior = snapshot.catalog.reviews.filter((review) => review.infographicId === infographicId)
      .sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt) || left.id.localeCompare(right.id)).at(-1);
    const reviewedAt = this.now().toISOString();
    const previousIntervalDays = prior?.intervalDays ?? null;
    const scheduled = scheduleReview(rating, previousIntervalDays, reviewedAt);
    const record: ReviewRecord = { id: this.uuid(), infographicId, rating, reviewedAt, previousIntervalDays, intervalDays: scheduled.intervalDays, dueAt: scheduled.dueAt };
    await this.events.append(InfEventSchema.parse({ eventId: this.uuid(), schemaVersion: 1, type: "review.recorded", occurredAt: reviewedAt, infographicId, payload: { reviewId: record.id, rating, reviewedAt, previousIntervalDays, intervalDays: record.intervalDays, dueAt: record.dueAt } }));
    return record;
  }
}
