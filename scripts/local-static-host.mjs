import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(process.env.INF_LOCAL_STATIC_ROOT ?? resolve(process.cwd(), "out"));
const port = Number.parseInt(process.env.INF_LOCAL_WEB_PORT ?? "3000", 10);
const mime = new Map([[".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".txt", "text/plain; charset=utf-8"], [".png", "image/png"], [".svg", "image/svg+xml"], [".webp", "image/webp"], [".ico", "image/x-icon"], [".webmanifest", "application/manifest+json"]]);

function safe(candidate) {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !relation.startsWith("/"));
}
async function fileFor(pathname) {
  const decoded = decodeURIComponent(pathname);
  const base = resolve(root, `.${decoded}`);
  if (!safe(base)) return undefined;
  const candidates = decoded.endsWith("/") ? [resolve(base, "index.html")] : [base, resolve(base, "index.html")];
  for (const candidate of candidates) {
    if (!safe(candidate)) continue;
    try { if ((await stat(candidate)).isFile()) return candidate; } catch { /* try route fallback */ }
  }
  return undefined;
}

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { "cache-control": "no-store" }).end(); return; }
  let pathname;
  try { pathname = new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname; } catch { response.writeHead(400).end(); return; }
  const file = await fileFor(pathname);
  if (!file) { response.writeHead(404, { "cache-control": "no-store" }).end(); return; }
  const bytes = await readFile(file);
  response.writeHead(200, { "content-type": mime.get(extname(file)) ?? "application/octet-stream", "content-length": String(bytes.length), "cache-control": file.endsWith(".html") ? "no-store" : "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
  response.end(request.method === "HEAD" ? undefined : bytes);
});
server.listen(port, "127.0.0.1", () => console.log(`INF production artifact is listening on http://127.0.0.1:${port}.`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
