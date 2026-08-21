import http from "node:http";

const port = Number.parseInt(process.env.INF_LOCAL_API_PROXY_PORT ?? "7072", 10);
const targetPort = Number.parseInt(process.env.INF_LOCAL_FUNCTIONS_PORT ?? "7071", 10);
const token = process.env.INF_LOCAL_PROXY_TOKEN;

if (!token || !Number.isInteger(port) || !Number.isInteger(targetPort)) {
  throw new Error("The local API proxy requires a per-run capability and valid ports.");
}

const server = http.createServer((request, response) => {
  if (!request.url?.startsWith("/api/")) {
    response.writeHead(404, { "cache-control": "no-store" }).end();
    return;
  }
  const headers = { ...request.headers, host: `127.0.0.1:${targetPort}`, "x-inf-local-proxy-token": token };
  const upstream = http.request({ host: "127.0.0.1", port: targetPort, method: request.method, path: request.url, headers }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => response.writeHead(502, { "cache-control": "no-store" }).end());
  request.pipe(upstream);
});

server.listen(port, "127.0.0.1", () => console.log(`Local API capability proxy is listening on http://127.0.0.1:${port}.`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
