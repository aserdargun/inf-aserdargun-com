import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";

type Entry = { url: string; response: Response };
function workerHarness() {
  const handlers = new Map<string, (event: any) => void>();
  const stores = new Map<string, Entry[]>();
  let network: (request: Request) => Promise<Response> = async () => new Response("ok", { status: 200 });
  const caches = {
    async open(name: string) {
      const entries = stores.get(name) ?? []; stores.set(name, entries);
      return {
        match: async (request: Request | string) => entries.find((entry) => entry.url === (typeof request === "string" ? new URL(request, "http://inf.test").href : request.url))?.response.clone(),
        put: async (request: Request | string, response: Response) => { const url = typeof request === "string" ? new URL(request, "http://inf.test").href : request.url; const old = entries.findIndex((entry) => entry.url === url); if (old >= 0) entries.splice(old, 1); entries.push({ url, response: response.clone() }); },
        keys: async () => entries.map((entry) => new Request(entry.url)), delete: async (request: Request) => { const index = entries.findIndex((entry) => entry.url === request.url); return index >= 0 ? Boolean(entries.splice(index, 1)) : false; },
      };
    }, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name),
  };
  const self = { location: { origin: "http://inf.test" }, addEventListener: (name: string, callback: (event: any) => void) => handlers.set(name, callback), skipWaiting: async () => undefined, clients: { claim: async () => undefined } };
  vm.runInNewContext(readFileSync("public/view/sw.js", "utf8"), { self, caches, fetch: (request: Request) => network(request), URL, Request, Response, Error, Promise });
  return {
    setNetwork(value: typeof network) { network = value; }, caches: stores,
    async fetch(url: string, method = "GET") { let response: Promise<Response> | undefined; handlers.get("fetch")!({ request: new Request(url, { method }), respondWith(value: Promise<Response>) { response = value; } }); return response; },
  };
}

describe("public service-worker cache policy", () => {
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
