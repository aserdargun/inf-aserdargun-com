import {
  InfEventSchema,
  type Category,
  type InfEvent,
  type MaterializedCatalog,
  type MaterializedInfographic,
  type RejectedFile,
  type ReviewRecord,
  type Tag,
} from "@inf/contracts";

export type QuarantineReason =
  | "invalid-event"
  | "unknown-schema-version"
  | "duplicate-event-id"
  | "orphan-event";

export interface QuarantinedEvent {
  input: unknown;
  inputIndex: number;
  reason: QuarantineReason;
}

export interface FoldResult {
  catalog: MaterializedCatalog;
  quarantine: QuarantinedEvent[];
}

interface FoldState {
  infographics: Map<string, MaterializedInfographic>;
  categories: Map<string, Category>;
  tags: Map<string, Tag>;
  reviews: ReviewRecord[];
  deletedInfographicIds: Set<string>;
  rejectedFiles: RejectedFile[];
}

interface ValidInput {
  event: InfEvent;
  input: unknown;
  inputIndex: number;
}

interface IsoInstantParts {
  wholeSecondMilliseconds: number;
  fractionalSecond: string;
}

const ISO_INSTANT_PARTS = /^(.*?)(?:\.(\d+))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isUnknownSchemaVersion(input: unknown): boolean {
  if (typeof input !== "object" || input === null || !("schemaVersion" in input)) {
    return false;
  }

  return (input as { schemaVersion?: unknown }).schemaVersion !== 1;
}

function parseIsoInstant(timestamp: string): IsoInstantParts {
  const parts = ISO_INSTANT_PARTS.exec(timestamp);
  if (parts === null) throw new TypeError("Expected a validated ISO instant");

  return {
    wholeSecondMilliseconds: Date.parse(`${parts[1]}${parts[3]}`),
    fractionalSecond: parts[2] ?? "",
  };
}

function compareFractionalSeconds(left: string, right: string): number {
  const width = Math.max(left.length, right.length);
  const leftPadded = left.padEnd(width, "0");
  const rightPadded = right.padEnd(width, "0");
  if (leftPadded < rightPadded) return -1;
  if (leftPadded > rightPadded) return 1;
  return 0;
}

function compareEvents(left: ValidInput, right: ValidInput): number {
  const leftInstant = parseIsoInstant(left.event.occurredAt);
  const rightInstant = parseIsoInstant(right.event.occurredAt);

  return leftInstant.wholeSecondMilliseconds - rightInstant.wholeSecondMilliseconds
    || compareFractionalSeconds(leftInstant.fractionalSecond, rightInstant.fractionalSecond)
    || left.event.eventId.localeCompare(right.event.eventId);
}

function applyCreated(state: FoldState, event: Extract<InfEvent, { type: "infographic.created" }>): boolean {
  if (state.infographics.has(event.infographicId) || state.deletedInfographicIds.has(event.infographicId)) {
    return false;
  }

  const payload = event.payload;
  state.infographics.set(event.infographicId, {
    id: event.infographicId,
    title: payload.title,
    notes: payload.notes ?? null,
    sourceUrl: payload.sourceUrl ?? null,
    sourcePlatform: payload.sourcePlatform ?? null,
    sourceAuthor: payload.sourceAuthor ?? null,
    originalDriveFileId: payload.originalDriveFileId,
    thumbnailDriveFileId: payload.thumbnailDriveFileId,
    sha256: payload.sha256,
    detectedMimeType: payload.detectedMimeType,
    width: payload.width,
    height: payload.height,
    favorite: false,
    archived: false,
    createdAt: payload.createdAt,
    capturedAt: payload.capturedAt,
    processedAt: null,
    lastSeenAt: null,
    seenCount: 0,
    categoryIds: [],
    tagIds: [],
    folderState: payload.folderState,
    reviewCount: 0,
    lastReviewedAt: null,
    reviewDueAt: null,
  });
  return true;
}

function itemFor(state: FoldState, infographicId: string): MaterializedInfographic | undefined {
  return state.infographics.get(infographicId);
}

function applyMetadataUpdated(
  item: MaterializedInfographic,
  event: Extract<InfEvent, { type: "infographic.metadataUpdated" }>,
): void {
  const payload = event.payload;
  if (payload.title !== undefined) item.title = payload.title;
  if (payload.notes !== undefined) item.notes = payload.notes;
  if (payload.sourceUrl !== undefined) item.sourceUrl = payload.sourceUrl;
  if (payload.sourcePlatform !== undefined) item.sourcePlatform = payload.sourcePlatform;
  if (payload.sourceAuthor !== undefined) item.sourceAuthor = payload.sourceAuthor;
}

function applyCategoriesAssigned(
  state: FoldState,
  item: MaterializedInfographic,
  event: Extract<InfEvent, { type: "infographic.categoriesAssigned" }>,
): void {
  for (const category of event.payload.categories) state.categories.set(category.id, category);
  item.categoryIds = event.payload.categories.map(({ id }) => id);

  if (item.processedAt === null && item.categoryIds.length > 0) {
    item.processedAt = event.occurredAt;
    if (!item.archived) item.folderState = "Library";
  }
}

function applyTagsAssigned(
  state: FoldState,
  item: MaterializedInfographic,
  event: Extract<InfEvent, { type: "infographic.tagsAssigned" }>,
): void {
  for (const tag of event.payload.tags) state.tags.set(tag.id, tag);
  item.tagIds = event.payload.tags.map(({ id }) => id);
}

function applyReview(
  state: FoldState,
  item: MaterializedInfographic,
  event: Extract<InfEvent, { type: "review.recorded" }>,
): void {
  state.reviews.push({
    id: event.payload.reviewId,
    infographicId: event.infographicId,
    rating: event.payload.rating,
    reviewedAt: event.payload.reviewedAt,
    previousIntervalDays: event.payload.previousIntervalDays,
    intervalDays: event.payload.intervalDays,
    dueAt: event.payload.dueAt,
  });
  item.reviewCount += 1;
  item.lastReviewedAt = event.payload.reviewedAt;
  item.reviewDueAt = event.payload.dueAt;
}

function applyRejectedFile(
  state: FoldState,
  event: Extract<InfEvent, { type: "sync.fileRejected" }>,
): void {
  state.rejectedFiles.push({
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    ...event.payload,
  });
}

function applyMutation(state: FoldState, event: Exclude<InfEvent, { type: "infographic.created" | "sync.fileRejected" }>): boolean {
  const item = itemFor(state, event.infographicId);
  if (item === undefined) return false;

  switch (event.type) {
    case "infographic.metadataUpdated":
      applyMetadataUpdated(item, event);
      break;
    case "infographic.categoriesAssigned":
      applyCategoriesAssigned(state, item, event);
      break;
    case "infographic.tagsAssigned":
      applyTagsAssigned(state, item, event);
      break;
    case "infographic.favoriteChanged":
      item.favorite = event.payload.favorite;
      break;
    case "infographic.archived":
      item.archived = true;
      item.folderState = "Archive";
      break;
    case "infographic.deleted":
      state.infographics.delete(event.infographicId);
      state.deletedInfographicIds.add(event.infographicId);
      break;
    case "infographic.imageReplaced":
      item.originalDriveFileId = event.payload.originalDriveFileId;
      item.thumbnailDriveFileId = event.payload.thumbnailDriveFileId;
      item.sha256 = event.payload.sha256;
      item.detectedMimeType = event.payload.detectedMimeType;
      item.width = event.payload.width;
      item.height = event.payload.height;
      break;
    case "infographic.seen":
      item.seenCount += 1;
      item.lastSeenAt = event.occurredAt;
      break;
    case "review.recorded":
      applyReview(state, item, event);
      break;
  }

  return true;
}

function createState(): FoldState {
  return {
    infographics: new Map(),
    categories: new Map(),
    tags: new Map(),
    reviews: [],
    deletedInfographicIds: new Set(),
    rejectedFiles: [],
  };
}

function toCatalog(state: FoldState): MaterializedCatalog {
  return {
    infographics: [...state.infographics.values()],
    categories: [...state.categories.values()],
    tags: [...state.tags.values()],
    reviews: state.reviews,
    deletedInfographicIds: [...state.deletedInfographicIds],
    rejectedFiles: state.rejectedFiles,
  };
}

export function foldEvents(events: readonly unknown[]): FoldResult {
  const quarantine: QuarantinedEvent[] = [];
  const valid: ValidInput[] = [];

  events.forEach((input, inputIndex) => {
    const parsed = InfEventSchema.safeParse(input);
    if (!parsed.success) {
      quarantine.push({
        input,
        inputIndex,
        reason: isUnknownSchemaVersion(input) ? "unknown-schema-version" : "invalid-event",
      });
      return;
    }
    valid.push({ event: parsed.data, input, inputIndex });
  });

  valid.sort(compareEvents);

  const state = createState();
  const seenEventIds = new Set<string>();
  for (const candidate of valid) {
    const { event } = candidate;
    if (seenEventIds.has(event.eventId)) {
      quarantine.push({ input: candidate.input, inputIndex: candidate.inputIndex, reason: "duplicate-event-id" });
      continue;
    }
    seenEventIds.add(event.eventId);

    if (event.type === "sync.fileRejected") {
      applyRejectedFile(state, event);
      continue;
    }

    if (event.type === "infographic.created") {
      if (!applyCreated(state, event)) {
        quarantine.push({ input: candidate.input, inputIndex: candidate.inputIndex, reason: "orphan-event" });
      }
      continue;
    }

    if (!applyMutation(state, event)) {
      quarantine.push({ input: candidate.input, inputIndex: candidate.inputIndex, reason: "orphan-event" });
    }
  }

  return { catalog: toCatalog(state), quarantine };
}
