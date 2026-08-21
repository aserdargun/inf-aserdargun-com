import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(resolve(root, "api/package.json"))("sharp");
const icons = resolve(root, "public/icons");
await mkdir(icons, { recursive: true });
for (const [name, size, source] of [["icon-192.png", 192, "inf-icon.svg"], ["icon-512.png", 512, "inf-icon.svg"], ["maskable-512.png", 512, "inf-maskable-icon.svg"]]) await sharp(resolve(icons, source), { density: 144 }).resize(size, size).png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(resolve(icons, name));
