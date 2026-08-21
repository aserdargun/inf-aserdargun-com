import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? "");
if (!root || root === process.cwd()) throw new Error("Pass a compiled output directory.");
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts")) {
      const source = await readFile(path, "utf8");
      const fixed = source.replace(/((?:from|export \* from)\s+["']\.{1,2}\/(?:[^"'.]|\.(?!js["']))+)(["'])/g, "$1.js$2");
      if (fixed !== source) await writeFile(path, fixed);
    }
  }
}
await visit(root);
