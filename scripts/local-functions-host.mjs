import http from "node:http";
import { createRuntime } from "../api-dist/dist/index.js";
import { publicGet, publicImage, publicList } from "../api-dist/dist/functions/public.js";
import { ownerCapture, ownerDelete, ownerDueReview, ownerGet, ownerList, ownerPatch, ownerReview, ownerSeen, ownerSession, ownerSettingsHealth, ownerStats, ownerSurprise, ownerSync } from "../api-dist/dist/functions/owner.js";

const port = Number.parseInt(process.env.INF_LOCAL_FUNCTIONS_PORT ?? "7071", 10);
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
if (!Number.isInteger(port)) throw new Error("The local Functions port is invalid.");
const dependencies = createRuntime();

function route(method, path) {
  if (method === "GET" && path === "/api/public/infographics") return () => publicList;
  if (method === "GET" && /^\/api\/public\/infographics\/[^/]+$/.test(path)) return () => publicGet;
  if (method === "GET" && /^\/api\/public\/images\/[^/]+$/.test(path)) return () => publicImage;
  if (method === "GET" && path === "/api/session") return () => ownerSession;
  if (method === "POST" && path === "/api/sync") return () => ownerSync;
  if (method === "GET" && path === "/api/infographics") return () => ownerList;
  if (method === "POST" && path === "/api/infographics") return () => ownerCapture;
  if (method === "GET" && /^\/api\/infographics\/[^/]+$/.test(path)) return () => ownerGet;
  if (method === "PATCH" && /^\/api\/infographics\/[^/]+$/.test(path)) return () => ownerPatch;
  if (method === "DELETE" && /^\/api\/infographics\/[^/]+$/.test(path)) return () => ownerDelete;
  if (method === "POST" && /^\/api\/infographics\/[^/]+\/seen$/.test(path)) return () => ownerSeen;
  if (method === "POST" && /^\/api\/infographics\/[^/]+\/reviews$/.test(path)) return () => ownerReview;
  if (method === "GET" && path === "/api/surprise") return () => ownerSurprise;
  if (method === "GET" && path === "/api/review") return () => ownerDueReview;
  if (method === "GET" && path === "/api/settings/stats") return () => ownerStats;
  if (method === "GET" && path === "/api/settings/health") return () => ownerSettingsHealth;
  return undefined;
}

async function toRequest(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  const declared = headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_REQUEST_BYTES) {
    // Consume a declared-too-large request before replying. Ending the response
    // while the client is still writing makes Node reset a chunked client socket
    // (EPIPE/ECONNRESET) rather than reliably delivering the 413.
    for await (const chunk of request) { void chunk; /* drain without retaining bytes */ }
    const error = new Error("REQUEST_TOO_LARGE"); error.code = "REQUEST_TOO_LARGE"; throw error;
  }
  if (["GET", "HEAD"].includes(request.method ?? "GET")) return new Request(`http://127.0.0.1:${port}${request.url}`, { method: request.method, headers });
  let total = 0;
  const chunks = [];
  let tooLarge = false;
  // This is the first request boundary. It retains at most the accepted 20 MiB
  // body, then drains the remainder before writing a 413. No body is passed to
  // the function runtime until that bounded transport check has completed.
  for await (const chunk of request) {
    if (tooLarge) continue;
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) {
    const error = new Error("REQUEST_TOO_LARGE"); error.code = "REQUEST_TOO_LARGE"; throw error;
  }
  return new Request(`http://127.0.0.1:${port}${request.url}`, { method: request.method, headers, body: Buffer.concat(chunks), duplex: "half" });
}

const server = http.createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname;
  const handler = route(request.method ?? "GET", path)?.();
  if (!handler) { response.writeHead(404, { "cache-control": "no-store" }).end(); return; }
  try {
    const result = await handler(await toRequest(request), path.startsWith("/api/public/") ? dependencies.public : dependencies.owner);
    response.writeHead(result.status, result.headers).end(result.body);
  } catch (error) {
    if (error?.code === "REQUEST_TOO_LARGE") { response.writeHead(413, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end('{"code":"MULTIPART_TOO_LARGE","message":"Request exceeds 20 MiB"}'); return; }
    response.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end('{"code":"INTERNAL","message":"Internal server error"}');
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Local compiled Functions adapter is listening on http://127.0.0.1:${port}.`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
