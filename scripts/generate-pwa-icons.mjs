import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(resolve(root, "api/package.json"))("sharp");
const icons = resolve(root, "public/icons");
await mkdir(icons, { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["maskable-512.png", 512]]) await sharp(resolve(icons, "inf-icon.svg"), { density: 144 }).resize(size, size).png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(resolve(icons, name));
