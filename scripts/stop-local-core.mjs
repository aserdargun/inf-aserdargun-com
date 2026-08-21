import { relative, resolve } from "node:path";

const insideCheckout = (checkout, value) => {
  const relation = relative(resolve(checkout), resolve(value));
  return relation === "" || (!relation.startsWith("..") && !relation.startsWith("/"));
};

function validateControl(control, checkout) {
  if (control === undefined) return [];
  if (!control || typeof control !== "object" || control.version !== 2 || control.checkout !== checkout || !Array.isArray(control.pids) || control.pids.length === 0) throw new Error("invalid control schema/version/checkout");
  const records = control.pids.map((entry) => {
    if (!entry || !Number.isInteger(entry.pid) || entry.pid < 1 || typeof entry.startIdentity !== "string" || entry.startIdentity.length === 0 || typeof entry.group !== "boolean") throw new Error("invalid control process");
    return { pid: entry.pid, startIdentity: entry.startIdentity, group: entry.group };
  });
  if (new Set(records.map(({ pid }) => pid)).size !== records.length) throw new Error("duplicate control process");
  return records;
}

export async function executeStop(deps) {
  let recorded;
  try { recorded = validateControl(await deps.readControl(), deps.checkout); }
  catch (error) { return { code: 1, stdout: "", stderr: `Refusing to stop with corrupt local control state: ${error.message}\n` }; }
  const candidates = new Map(recorded.map((entry) => [entry.pid, { ...entry, ports: [] }]));
  for (const port of deps.ports) for (const pid of await deps.listenerPids(port)) {
    const entry = candidates.get(pid) ?? { pid, startIdentity: undefined, group: false, ports: [] };
    entry.ports.push(port); candidates.set(pid, entry);
  }
  const owned = []; const refused = [];
  const describe = (entry) => `PID ${entry.pid}${entry.ports.length ? ` on port${entry.ports.length === 1 ? "" : "s"} ${entry.ports.join(",")}` : ""}`;
  for (const entry of candidates.values()) {
    if (!await deps.isAlive(entry.pid)) continue;
    if (!entry.startIdentity) entry.startIdentity = await deps.startIdentityFor(entry.pid);
    const identity = await deps.startIdentityFor(entry.pid); const cwd = await deps.cwdFor(entry.pid);
    if (!entry.startIdentity || identity !== entry.startIdentity) { if (await deps.isAlive(entry.pid)) refused.push(`${describe(entry)} identity changed during ownership admission`); }
    else if (!cwd || !insideCheckout(deps.checkout, cwd)) refused.push(`${describe(entry)} cwd ${cwd ?? "is unresolved"} is outside the checkout`);
    else owned.push(entry);
  }
  for (const entry of owned) {
    if (!await deps.isAlive(entry.pid)) continue;
    const identity = await deps.startIdentityFor(entry.pid); const cwd = await deps.cwdFor(entry.pid);
    if (identity !== entry.startIdentity || !cwd || !insideCheckout(deps.checkout, cwd)) { if (await deps.isAlive(entry.pid)) refused.push(`${describe(entry)} identity/cwd changed at TERM boundary`); continue; }
    try { deps.signal(entry.group ? -entry.pid : entry.pid, "SIGTERM"); }
    catch (error) { if (error?.code !== "ESRCH") refused.push(`${describe(entry)} TERM failed: ${error?.message ?? error}`); }
  }
  const deadline = deps.now() + 5_000;
  while (deps.now() < deadline && (await Promise.all(owned.map(({ pid }) => deps.isAlive(pid)))).some(Boolean)) await deps.delay(100);
  for (const entry of owned) {
    if (!await deps.isAlive(entry.pid)) continue;
    const identity = await deps.startIdentityFor(entry.pid); const cwd = await deps.cwdFor(entry.pid);
    if (identity !== entry.startIdentity || !cwd || !insideCheckout(deps.checkout, cwd)) { if (await deps.isAlive(entry.pid)) refused.push(`${describe(entry)} identity/cwd changed at KILL boundary`); continue; }
    try { deps.signal(entry.group ? -entry.pid : entry.pid, "SIGKILL"); }
    catch (error) { if (error?.code !== "ESRCH") refused.push(`${describe(entry)} KILL failed: ${error?.message ?? error}`); }
  }
  for (const entry of owned) if (await deps.isAlive(entry.pid)) refused.push(`${describe(entry)} remains alive after Stop`);
  if (refused.length) return { code: 1, stdout: "", stderr: `${refused.map((message) => `Refusing to claim Stop: ${message}.`).join("\n")}\n` };
  await deps.remove(deps.controlPath); await deps.remove(deps.configPath);
  const message = owned.length === 0 ? "INF local services are already stopped." : `Stopped ${owned.length} checkout-owned INF local process${owned.length === 1 ? "" : "es"}.`;
  return { code: 0, stdout: `${message}\n`, stderr: "" };
}
