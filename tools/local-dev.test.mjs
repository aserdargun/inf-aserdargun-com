import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local development keeps the proxy capability in ignored checkout-private state", async () => {
  const source = await readFile("scripts/local-dev.mjs", "utf8");
  const proxy = await readFile("scripts/local-api-proxy.mjs", "utf8");
  const ignore = await readFile(".gitignore", "utf8");
  assert.match(source, /randomBytes/);
  assert.match(source, /\.codex[\\/]run/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(proxy, /x-inf-local-proxy-token/);
  assert.match(source, /local-functions-host\.mjs/);
  assert.match(source, /"swa", "start"/);
  assert.match(source, /"4280"/);
  assert.match(ignore, /^\.codex\/run\/$/m);
});

test("all local listeners are explicitly loopback-bound", async () => {
  const source = await readFile("scripts/local-dev.mjs", "utf8");
  const functions = await readFile("scripts/local-functions-host.mjs", "utf8");
  const proxy = await readFile("scripts/local-api-proxy.mjs", "utf8");
  assert.match(source, /--hostname", "127\.0\.0\.1", "--port", "3000"/);
  assert.match(source, /--host", "127\.0\.0\.1", "--port", "4280"/);
  assert.match(functions, /server\.listen\(port, "127\.0\.0\.1"/);
  assert.match(proxy, /server\.listen\(port, "127\.0\.0\.1"/);
});

test("the browser bundle never receives the local proxy capability", async () => {
  const source = await readFile("scripts/local-dev.mjs", "utf8");
  assert.doesNotMatch(source, /NEXT_PUBLIC_INF_LOCAL_PROXY_TOKEN/);
  assert.doesNotMatch(source, /localStorage.*INF_LOCAL_PROXY_TOKEN/);
});

test("Playwright cleanup delegates to the bounded checkout Stop path", async () => {
  const source = await readFile("scripts/local-dev.mjs", "utf8");
  const config = await readFile("playwright.config.ts", "utf8");
  const wrapper = await readFile("scripts/playwright-local-server.mjs", "utf8");
  assert.match(config, /playwright-local-server/);
  assert.match(config, /gracefulShutdown/);
  assert.match(wrapper, /stop-local\.mjs/);
  assert.match(wrapper, /SIGTERM/);
  assert.match(wrapper, /INF_LOCAL_WEB_ARTIFACT: "out"/);
  assert.match(source, /out[\s\S]*staticwebapp\.config\.json/);
});
