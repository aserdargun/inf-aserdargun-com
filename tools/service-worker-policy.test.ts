import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

type Entry = { url: string; response: Response };
type CacheFailure = "open" | "put" | "keys" | "delete-entry";
function workerHarness() {
  const handlers = new Map<string, (event: any) => void>();
  const stores = new Map<string, Entry[]>();
  let network: (request: Request) => Promise<Response> = async () => new Response("ok", { status: 200 });
  let networkCalls = 0;
  let claims = 0;
  let cacheFailure: CacheFailure | undefined;
  let fetchLifetimes: Promise<unknown>[] = [];
  const caches = {
    async open(name: string) {
      if (cacheFailure === "open") throw new Error("cache open failed");
      const entries = stores.get(name) ?? []; stores.set(name, entries);
      return {
        match: async (request: Request | string) => entries.find((entry) => entry.url === (typeof request === "string" ? new URL(request, "http://inf.test").href : request.url))?.response.clone(),
        put: async (request: Request | string, response: Response) => { if (cacheFailure === "put") throw new Error("cache put failed"); const url = typeof request === "string" ? new URL(request, "http://inf.test").href : request.url; const old = entries.findIndex((entry) => entry.url === url); if (old >= 0) entries.splice(old, 1); entries.push({ url, response: response.clone() }); },
        keys: async () => { if (cacheFailure === "keys") throw new Error("cache keys failed"); return entries.map((entry) => new Request(entry.url)); }, delete: async (request: Request) => { if (cacheFailure === "delete-entry") throw new Error("cache delete failed"); const index = entries.findIndex((entry) => entry.url === request.url); return index >= 0 ? Boolean(entries.splice(index, 1)) : false; },
      };
    }, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name),
  };
  const source = readFileSync("public/view/sw.js", "utf8");
  const version = source.match(/const VERSION = "([^"]+)"/)?.[1];
  if (!version) throw new Error("Worker version is missing.");
  const self = { location: { origin: "http://inf.test" }, addEventListener: (name: string, callback: (event: any) => void) => handlers.set(name, callback), skipWaiting: async () => undefined, clients: { claim: async () => { claims += 1; } } };
  vm.runInNewContext(source, { self, caches, fetch: (request: Request) => { networkCalls += 1; return network(request); }, URL, Request, Response, Error, Promise });
  return {
    version,
    setNetwork(value: typeof network) { network = value; },
    setCacheFailure(value: CacheFailure | undefined) { cacheFailure = value; },
    networkCalls() { return networkCalls; },
    claims() { return claims; },
    fetchWaitUntilCalls() { return fetchLifetimes.length; },
    async settleFetchLifetime() { await Promise.all(fetchLifetimes); },
    caches: stores,
    async seed(cacheName: string, url: string, body: string) { const cache = await caches.open(cacheName); await cache.put(url, new Response(body, { status: 200 })); },
    async cached(cacheName: string, url: string) { return (await caches.open(cacheName)).match(url); },
    async lifecycle(name: "install" | "activate") { let completion: Promise<unknown> | undefined; handlers.get(name)!({ waitUntil(value: Promise<unknown>) { completion = value; } }); await completion; },
    async fetch(url: string, method = "GET", mode?: "navigate") {
      let response: Promise<Response> | undefined;
      fetchLifetimes = [];
      const request = new Request(url, { method });
      if (mode) Object.defineProperty(request, "mode", { value: mode });
      handlers.get("fetch")!({ request, respondWith(value: Promise<Response>) { response = value; }, waitUntil(value: Promise<unknown>) { fetchLifetimes.push(value); } });
      return response;
    },
  };
}

describe("public service-worker cache policy", () => {
  test("View navigation attempts the network, refreshes the current cache, and falls back offline", async () => {
    const harness = workerHarness();
    const cacheName = `${harness.version}-static`;
    const view = "http://inf.test/view/";
    await harness.seed(cacheName, view, "stale shell");
    harness.setNetwork(async () => new Response("fresh shell", { status: 200 }));
    expect(await (await harness.fetch(view, "GET", "navigate"))?.text()).toBe("fresh shell");
    expect(harness.networkCalls()).toBe(1);
    expect(await (await harness.cached(cacheName, view))?.text()).toBe("fresh shell");
    harness.setNetwork(async () => { throw new TypeError("offline"); });
    expect(await (await harness.fetch("http://inf.test/view/item-id/", "GET", "navigate"))?.text()).toBe("fresh shell");
    expect(harness.networkCalls()).toBe(2);
  });

  test.each<CacheFailure>(["open", "put", "keys", "delete-entry"])("returns the exact fresh View response when cache %s fails", async (failure) => {
    const harness = workerHarness();
    const cacheName = `${harness.version}-static`;
    const view = "http://inf.test/view/";
    await harness.seed(cacheName, view, "stale shell");
    let requestUrl = view;
    if (failure === "delete-entry") {
      for (let index = 0; index < 39; index += 1) await harness.seed(cacheName, `http://inf.test/_next/static/${index}.js`, String(index));
      requestUrl = "http://inf.test/view/fresh-item/";
    }
    const fresh = new Response("fresh shell", { status: 200 });
    harness.setNetwork(async () => fresh);
    harness.setCacheFailure(failure);
    expect(await harness.fetch(requestUrl, "GET", "navigate")).toBe(fresh);
    expect(harness.networkCalls()).toBe(1);
  });

  test("returns the exact fresh View response when response cloning fails", async () => {
    const harness = workerHarness();
    const view = "http://inf.test/view/";
    await harness.seed(`${harness.version}-static`, view, "stale shell");
    const fresh = new Response("fresh shell", { status: 200 });
    Object.defineProperty(fresh, "clone", { value: () => { throw new Error("clone failed"); } });
    harness.setNetwork(async () => fresh);
    expect(await harness.fetch(view, "GET", "navigate")).toBe(fresh);
  });

  test.each([
    { cache: "data", url: "http://inf.test/api/public/infographics", mode: undefined },
    { cache: "images", url: "http://inf.test/api/public/images/item-id", mode: undefined },
    { cache: "static", url: "http://inf.test/icons/icon-192.png", mode: undefined },
  ])("returns fresh $cache responses when cache maintenance fails", async ({ cache, url, mode }) => {
    const harness = workerHarness();
    const fresh = new Response(`fresh ${cache}`, { status: 200 });
    harness.setNetwork(async () => fresh);
    harness.setCacheFailure("put");
    expect(await harness.fetch(url, "GET", mode as "navigate" | undefined)).toBe(fresh);
  });

  test.each<CacheFailure>(["keys", "delete-entry"])("persistent %s failure preserves fresh catalog responses without exceeding the cache bound", async (failure) => {
    const harness = workerHarness();
    const cacheName = `${harness.version}-data`;
    for (let index = 0; index < 40; index += 1) await harness.seed(cacheName, `http://inf.test/api/public/infographics/00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, String(index));
    harness.setCacheFailure(failure);
    for (let index = 40; index < 45; index += 1) {
      const fresh = new Response(`fresh ${index}`, { status: 200 });
      harness.setNetwork(async () => fresh);
      expect(await harness.fetch(`http://inf.test/api/public/infographics/00000000-0000-4000-8000-${String(index).padStart(12, "0")}`)).toBe(fresh);
      expect(harness.caches.get(cacheName)?.length).toBeLessThanOrEqual(40);
    }
  });

  test("extends an image cache-hit event through stale-while-revalidate completion", async () => {
    const harness = workerHarness();
    const cacheName = `${harness.version}-images`;
    const url = "http://inf.test/api/public/images/item-id";
    await harness.seed(cacheName, url, "stale image");
    let releaseNetwork!: (response: Response) => void;
    harness.setNetwork(() => new Promise((resolve) => { releaseNetwork = resolve; }));
    const response = await harness.fetch(url);
    expect(await response?.text()).toBe("stale image");
    expect(harness.fetchWaitUntilCalls()).toBe(1);
    releaseNetwork(new Response("fresh image", { status: 200 }));
    await harness.settleFetchLifetime();
    expect(await (await harness.cached(cacheName, url))?.text()).toBe("fresh image");
  });

  test("install populates only the current static release and hashed assets remain cache-first", async () => {
    const harness = workerHarness();
    await harness.seed("PUBLIC-CACHE-v1-static", "http://inf.test/view/", "old shell");
    harness.setNetwork(async (request) => new Response(`installed:${request.url}`, { status: 200 }));
    await harness.lifecycle("install");
    const current = `${harness.version}-static`;
    expect([...harness.caches.keys()].sort()).toEqual(["PUBLIC-CACHE-v1-static", current].sort());
    expect(harness.caches.get(current)).toHaveLength(5);
    const asset = "http://inf.test/_next/static/chunks/app.123.js";
    await harness.seed(current, asset, "hashed runtime");
    const callsBeforeAsset = harness.networkCalls();
    expect(await (await harness.fetch(asset))?.text()).toBe("hashed runtime");
    expect(harness.networkCalls()).toBe(callsBeforeAsset);
  });

  test("activation deletes only prior INF public releases and claims clients", async () => {
    const harness = workerHarness();
    const current = `${harness.version}-static`;
    await harness.seed(current, "http://inf.test/view/", "current");
    await harness.seed("PUBLIC-CACHE-v1-static", "http://inf.test/view/", "legacy");
    await harness.seed("INF-PUBLIC-deadbeef-static", "http://inf.test/view/", "old");
    await harness.seed("UNRELATED-CACHE-v1", "http://inf.test/other", "unrelated");
    await harness.lifecycle("activate");
    expect([...harness.caches.keys()].sort()).toEqual([current, "UNRELATED-CACHE-v1"].sort());
    expect(harness.claims()).toBe(1);
  });

  test("uses a last-good public catalog response offline without serving it to owner URLs", async () => {
    const harness = workerHarness(); const catalog = "http://inf.test/api/public/infographics";
    const first = await harness.fetch(catalog); expect(await first?.text()).toBe("ok");
    harness.setNetwork(async () => { throw new TypeError("offline"); });
    const offline = await harness.fetch(catalog); expect(await offline?.text()).toBe("ok");
    expect(await harness.fetch("http://inf.test/api/infographics")).toBeUndefined();
    expect([...harness.caches.values()].flat()).toHaveLength(1);
  });

  test("does not intercept or cache POST, cross-origin, 401, or 500 responses", async () => {
    const harness = workerHarness();
    expect(await harness.fetch("http://inf.test/api/public/infographics", "POST")).toBeUndefined();
    expect(await harness.fetch("https://elsewhere.test/api/public/infographics")).toBeUndefined();
    for (const privateUrl of ["/", "/login", "/settings", "/api/infographics", "/api/private/unknown", "/api/public/unknown"]) {
      expect(await harness.fetch(`http://inf.test${privateUrl}`), privateUrl).toBeUndefined();
    }
    harness.setNetwork(async () => new Response("unauthorized", { status: 401 })); await (await harness.fetch("http://inf.test/api/public/infographics"))?.text();
    harness.setNetwork(async () => new Response("failure", { status: 500 })); await (await harness.fetch("http://inf.test/api/public/infographics/00000000-0000-4000-8000-000000000001"))?.text();
    expect([...harness.caches.values()].flat()).toHaveLength(0);
  });

  test("rejects redirected and opaque responses, and serializes concurrent bounded writes", async () => {
    const harness = workerHarness();
    const redirected = new Response("redirected", { status: 200 }); Object.defineProperty(redirected, "redirected", { value: true });
    harness.setNetwork(async () => redirected); await (await harness.fetch("http://inf.test/api/public/infographics"))?.text();
    const opaque = new Response("opaque", { status: 200 }); Object.defineProperty(opaque, "type", { value: "opaque" });
    harness.setNetwork(async () => opaque); await (await harness.fetch("http://inf.test/api/public/infographics/00000000-0000-4000-8000-000000000001"))?.text();
    expect([...harness.caches.values()].flat()).toHaveLength(0);
    harness.setNetwork(async () => new Response("public", { status: 200 }));
    const requests = Array.from({ length: 100 }, (_, index) => `http://inf.test/api/public/infographics/00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    await Promise.all((await Promise.all(requests.map((url) => harness.fetch(url)))).map((response) => response?.text()));
    expect([...harness.caches.values()].flat()).toHaveLength(40);
    expect(await harness.fetch("http://inf.test/api/infographics")).toBeUndefined();
  });
});
