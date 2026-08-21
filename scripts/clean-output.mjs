import { lstat, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";

const checkout = resolve(process.cwd());
for (const target of process.argv.slice(2)) {
  const output = resolve(checkout, target);
  const relation = relative(checkout, output);
  if (!relation || relation.startsWith("..") || relation.includes("..")) throw new Error(`Refusing to clean outside this checkout: ${target}`);
  const info = await lstat(output).catch((error) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (info?.isSymbolicLink()) throw new Error(`Refusing to clean symlink output: ${target}`);
  await rm(output, { recursive: true, force: true });
}
