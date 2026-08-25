import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { CachedEventStore, CachedStorage, DEFAULT_CACHE_TTLS } from "./cache/index.js";
import { EventStore } from "./storage/event-store.js";
import { GoogleDriveAdapter } from "./storage/google-drive-adapter.js";
import { LocalDriveAdapter } from "./storage/local-drive-adapter.js";
import { publicGet, publicImage, publicList, type PublicDependencies } from "./functions/public.js";
import { ownerCapture, ownerDelete, ownerDueReview, ownerGet, ownerList, ownerPatch, ownerReplaceImage, ownerReview, ownerSeen, ownerSession, ownerSettingsHealth, ownerStats, ownerSuggestForInfographic, ownerSuggestMetadata, ownerSurprise, ownerSync, type OwnerDependencies } from "./functions/owner.js";
import { openAiServiceFromEnv } from "./services/openai-service.js";
import type { HttpResponse } from "./http/errors.js";

const PUBLIC_ROOT_ID = "1wijWSRvrjEZ3y78bKsAQS8mOP0OPvgsK";

type Environment = NodeJS.ProcessEnv;
const LOCAL = { privateRootId: "inf-local-private", eventsFolderId: "inf-local-events", inboxFolderId: "inf-local-inbox", libraryFolderId: "inf-local-library", thumbnailsFolderId: "inf-local-thumbnails", duplicatesFolderId: "inf-local-duplicates" } as const;

function required(name: string, env: Environment): string {
  const value = env[name]; if (!value) throw new Error(`${name} must be configured`); return value;
}

function localRuntimeEnabled(env: Environment): boolean {
  return env.INF_LOCAL_RUNTIME === "development"
    && env.NODE_ENV !== "production"
    && env.INF_LOCAL_STORAGE_MODE === "true"
    && env.INF_LOCAL_AUTH_BYPASS === "true"
    && env.INF_LOCAL_PROXY_MODE === "bypass"
    && env.WEBSITE_SITE_NAME === undefined
    && typeof env.INF_LOCAL_PROXY_TOKEN === "string"
    && env.INF_LOCAL_PROXY_TOKEN.length >= 32;
}

export function createRuntime(env: Environment = process.env) {
  const local = localRuntimeEnabled(env);
  const privateRootId = local ? LOCAL.privateRootId : required("INF_PRIVATE_DRIVE_FOLDER_ID", env);
  const rawStorage = local
    ? new LocalDriveAdapter({ rootPath: required("INF_LOCAL_STORAGE_ROOT", env), folderPaths: { [PUBLIC_ROOT_ID]: "public", [LOCAL.privateRootId]: "private", [LOCAL.eventsFolderId]: "private/events", [LOCAL.inboxFolderId]: "public/Inbox", [LOCAL.libraryFolderId]: "public/Library", [LOCAL.thumbnailsFolderId]: "public/Thumbnails", [LOCAL.duplicatesFolderId]: "public/Duplicates" } })
    : new GoogleDriveAdapter({
        publicRootId: PUBLIC_ROOT_ID,
        privateRootId,
        credentials: { clientId: required("GOOGLE_CLIENT_ID", env), clientSecret: required("GOOGLE_CLIENT_SECRET", env), refreshToken: required("GOOGLE_REFRESH_TOKEN", env) },
      });
  // Production wraps the live Drive adapter in a bounded read cache; the local
  // runtime leaves it raw so deterministic tests do not leak state across cases.
  const storage = local ? rawStorage : new CachedStorage(rawStorage, DEFAULT_CACHE_TTLS.storage);
  const eventsFolderId = local ? LOCAL.eventsFolderId : required("INF_EVENTS_FOLDER_ID", env);
  const rawEvents = new EventStore(storage, eventsFolderId, privateRootId);
  const events = local ? rawEvents : new CachedEventStore(rawEvents, DEFAULT_CACHE_TTLS.events);
  const common = { storage, events, publicRootId: PUBLIC_ROOT_ID };
  return {
    public: common,
    owner: { ...common, privateRootId, eventsFolderId, inboxFolderId: local ? LOCAL.inboxFolderId : required("INF_INBOX_FOLDER_ID", env), libraryFolderId: local ? LOCAL.libraryFolderId : required("INF_LIBRARY_FOLDER_ID", env), thumbnailsFolderId: local ? LOCAL.thumbnailsFolderId : required("INF_THUMBNAILS_FOLDER_ID", env), duplicatesFolderId: local ? LOCAL.duplicatesFolderId : required("INF_DUPLICATES_FOLDER_ID", env), allowedGithubUser: env.INF_ALLOWED_GITHUB_USER, localAuthBypass: env.INF_LOCAL_AUTH_BYPASS, azureSiteName: env.WEBSITE_SITE_NAME, localProxyMode: env.INF_LOCAL_PROXY_MODE, expectedLocalProxyToken: env.INF_LOCAL_PROXY_TOKEN, openAiService: openAiServiceFromEnv(env) },
  };
}

let dependencies: ReturnType<typeof createRuntime> | undefined;
function runtime() { dependencies ??= createRuntime(); return dependencies; }

function response(value: HttpResponse): HttpResponseInit { return value; }
const publicDeps = () => runtime().public;
const ownerDeps = () => runtime().owner;

// Registrations deliberately only adapt Azure's request/response types; handlers own all authorization and domain behavior.
app.http("public-infographics", { methods: ["GET"], authLevel: "anonymous", route: "public/infographics", handler: async (request: HttpRequest) => response(await publicList(request, publicDeps())) });
app.http("public-infographic", { methods: ["GET"], authLevel: "anonymous", route: "public/infographics/{id}", handler: async (request: HttpRequest) => response(await publicGet(request, publicDeps())) });
app.http("public-image", { methods: ["GET"], authLevel: "anonymous", route: "public/images/{driveFileId}", handler: async (request: HttpRequest) => response(await publicImage(request, publicDeps())) });
app.http("session", { methods: ["GET"], authLevel: "anonymous", route: "session", handler: async (request: HttpRequest) => response(await ownerSession(request, ownerDeps())) });
app.http("sync", { methods: ["POST"], authLevel: "anonymous", route: "sync", handler: async (request: HttpRequest) => response(await ownerSync(request, ownerDeps())) });
app.http("infographics", { methods: ["GET"], authLevel: "anonymous", route: "infographics", handler: async (request: HttpRequest) => response(await ownerList(request, ownerDeps())) });
app.http("capture-infographic", { methods: ["POST"], authLevel: "anonymous", route: "infographics", handler: async (request: HttpRequest) => response(await ownerCapture(request, ownerDeps())) });
app.http("infographic", { methods: ["GET"], authLevel: "anonymous", route: "infographics/{id}", handler: async (request: HttpRequest) => response(await ownerGet(request, ownerDeps())) });
app.http("patch-infographic", { methods: ["PATCH"], authLevel: "anonymous", route: "infographics/{id}", handler: async (request: HttpRequest) => response(await ownerPatch(request, ownerDeps())) });
app.http("delete-infographic", { methods: ["DELETE"], authLevel: "anonymous", route: "infographics/{id}", handler: async (request: HttpRequest) => response(await ownerDelete(request, ownerDeps())) });
app.http("replace-image-infographic", { methods: ["POST"], authLevel: "anonymous", route: "infographics/{id}/image", handler: async (request: HttpRequest) => response(await ownerReplaceImage(request, ownerDeps())) });
app.http("seen-infographic", { methods: ["POST"], authLevel: "anonymous", route: "infographics/{id}/seen", handler: async (request: HttpRequest) => response(await ownerSeen(request, ownerDeps())) });
app.http("review-infographic", { methods: ["POST"], authLevel: "anonymous", route: "infographics/{id}/reviews", handler: async (request: HttpRequest) => response(await ownerReview(request, ownerDeps())) });
app.http("suggest-for-infographic", { methods: ["POST"], authLevel: "anonymous", route: "infographics/{id}/suggest", handler: async (request: HttpRequest) => response(await ownerSuggestForInfographic(request, ownerDeps())) });
app.http("surprise", { methods: ["GET"], authLevel: "anonymous", route: "surprise", handler: async (request: HttpRequest) => response(await ownerSurprise(request, ownerDeps())) });
app.http("due-review", { methods: ["GET"], authLevel: "anonymous", route: "review", handler: async (request: HttpRequest) => response(await ownerDueReview(request, ownerDeps())) });
app.http("settings-stats", { methods: ["GET"], authLevel: "anonymous", route: "settings/stats", handler: async (request: HttpRequest) => response(await ownerStats(request, ownerDeps())) });
app.http("settings-health", { methods: ["GET"], authLevel: "anonymous", route: "settings/health", handler: async (request: HttpRequest) => response(await ownerSettingsHealth(request, ownerDeps())) });
app.http("suggest-metadata", { methods: ["POST"], authLevel: "anonymous", route: "infographics/suggest-metadata", handler: async (request: HttpRequest) => response(await ownerSuggestMetadata(request, ownerDeps())) });
