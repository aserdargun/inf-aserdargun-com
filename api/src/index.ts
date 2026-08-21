import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { EventStore } from "./storage/event-store.js";
import { GoogleDriveAdapter } from "./storage/google-drive-adapter.js";
import { publicGet, publicImage, publicList, type PublicDependencies } from "./functions/public.js";
import { ownerCapture, ownerDelete, ownerDueReview, ownerGet, ownerList, ownerPatch, ownerReview, ownerSeen, ownerSession, ownerStats, ownerSurprise, ownerSync, type OwnerDependencies } from "./functions/owner.js";
import type { HttpResponse } from "./http/errors.js";

const PUBLIC_ROOT_ID = "1wijWSRvrjEZ3y78bKsAQS8mOP0OPvgsK";

function required(name: string): string {
  const value = process.env[name]; if (!value) throw new Error(`${name} must be configured`); return value;
}

let dependencies: { public: PublicDependencies; owner: OwnerDependencies } | undefined;
function runtime() {
  if (dependencies) return dependencies;
  const privateRootId = required("INF_PRIVATE_DRIVE_FOLDER_ID");
  const storage = new GoogleDriveAdapter({ publicRootId: PUBLIC_ROOT_ID, privateRootId, credentials: { clientId: required("GOOGLE_CLIENT_ID"), clientSecret: required("GOOGLE_CLIENT_SECRET"), refreshToken: required("GOOGLE_REFRESH_TOKEN") } });
  const events = new EventStore(storage, required("INF_EVENTS_FOLDER_ID"), privateRootId);
  const common = { storage, events, publicRootId: PUBLIC_ROOT_ID };
  dependencies = {
    public: common,
    owner: { ...common, privateRootId, eventsFolderId: required("INF_EVENTS_FOLDER_ID"), inboxFolderId: required("INF_INBOX_FOLDER_ID"), thumbnailsFolderId: required("INF_THUMBNAILS_FOLDER_ID"), duplicatesFolderId: required("INF_DUPLICATES_FOLDER_ID"), allowedGithubUser: process.env.INF_ALLOWED_GITHUB_USER, localAuthBypass: process.env.INF_LOCAL_AUTH_BYPASS, azureSiteName: process.env.WEBSITE_SITE_NAME, localProxyMode: process.env.INF_LOCAL_PROXY_MODE, expectedLocalProxyToken: process.env.INF_LOCAL_PROXY_TOKEN },
  };
  return dependencies;
}

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
app.http("seen-infographic", { methods: ["POST"], authLevel: "anonymous", route: "infographics/{id}/seen", handler: async (request: HttpRequest) => response(await ownerSeen(request, ownerDeps())) });
app.http("review-infographic", { methods: ["POST"], authLevel: "anonymous", route: "infographics/{id}/reviews", handler: async (request: HttpRequest) => response(await ownerReview(request, ownerDeps())) });
app.http("surprise", { methods: ["GET"], authLevel: "anonymous", route: "surprise", handler: async (request: HttpRequest) => response(await ownerSurprise(request, ownerDeps())) });
app.http("due-review", { methods: ["GET"], authLevel: "anonymous", route: "review", handler: async (request: HttpRequest) => response(await ownerDueReview(request, ownerDeps())) });
app.http("settings-stats", { methods: ["GET"], authLevel: "anonymous", route: "settings/stats", handler: async (request: HttpRequest) => response(await ownerStats(request, ownerDeps())) });
