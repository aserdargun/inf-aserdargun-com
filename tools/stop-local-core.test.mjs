import assert from "node:assert/strict";
import test from "node:test";
import { executeStop } from "../scripts/stop-local-core.mjs";

function harness({ recorded = true, boundary, discovered = false } = {}) {
  const pid = 4242;
  const control = recorded ? { version: 2, checkout: process.cwd(), pids: [{ pid, startIdentity: "identity-a", group: false }] } : undefined;
  let identityReads = 0;
  let aliveReads = 0;
  const signals = [];
  const removed = [];
  const deps = {
    checkout: process.cwd(),
    controlPath: "/control",
    configPath: "/config",
    ports: [4280],
    readControl: async () => control,
    listenerPids: async () => discovered ? [pid] : [],
    startIdentityFor: async () => {
      identityReads += 1;
      const termRead = recorded ? 2 : 3;
      const killRead = termRead + 1;
      if (boundary === "term" && identityReads === termRead) return "identity-b";
      if (boundary === "kill" && identityReads === killRead) return "identity-b";
      return "identity-a";
    },
    cwdFor: async () => process.cwd(),
    isAlive: async () => {
      aliveReads += 1;
      return boundary === "term" || boundary === "kill" || aliveReads === 1;
    },
    signal: (target, signal) => signals.push([target, signal]),
    delay: async () => undefined,
    now: (() => { let value = 0; return () => (value += 6_000); })(),
    remove: async (path) => removed.push(path),
  };
  return { deps, signals, removed, pid };
}

for (const recorded of [true, false]) {
  for (const boundary of ["term", "kill"]) {
    test(`${recorded ? "recorded" : "discovered"} PID substitution at ${boundary.toUpperCase()} is refused and recovery state is retained`, async () => {
      const h = harness({ recorded, discovered: !recorded, boundary });
      const result = await executeStop(h.deps);
      assert.equal(result.code, 1);
      assert.match(result.stderr, new RegExp(`PID ${h.pid}.*${boundary}`, "i"));
      assert.deepEqual(h.removed, []);
      assert.equal(h.signals.some(([, signal]) => signal === (boundary === "term" ? "SIGTERM" : "SIGKILL")), false);
    });
  }
}

test("a normal owned process is stopped and control/config are removed", async () => {
  const h = harness();
  let alive = true;
  h.deps.isAlive = async () => alive;
  h.deps.signal = (target, signal) => { h.signals.push([target, signal]); alive = false; };
  const result = await executeStop(h.deps);
  assert.equal(result.code, 0);
  assert.deepEqual(h.signals, [[h.pid, "SIGTERM"]]);
  assert.deepEqual(h.removed, ["/control", "/config"]);
});

test("duplicate records fail closed before discovery or signalling", async () => {
  const h = harness();
  h.deps.readControl = async () => ({ version: 2, checkout: process.cwd(), pids: [
    { pid: h.pid, startIdentity: "identity-a", group: false },
    { pid: h.pid, startIdentity: "identity-a", group: false },
  ] });
  const result = await executeStop(h.deps);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /duplicate/i);
  assert.deepEqual(h.signals, []);
  assert.deepEqual(h.removed, []);
});

test("foreign cwd is an explicit refusal and retains state", async () => {
  const h = harness();
  h.deps.cwdFor = async () => "/tmp/foreign-checkout";
  const result = await executeStop(h.deps);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /outside/i);
  assert.deepEqual(h.signals, []);
  assert.deepEqual(h.removed, []);
});
