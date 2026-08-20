import { accessSync, constants } from "node:fs";

const required = [
  "out/index.html",
  "out/staticwebapp.config.json",
  "out/manifest.webmanifest",
  "api-dist/host.json",
  "api-dist/package.json"
];

for (const artifact of required) {
  try {
    accessSync(artifact, constants.R_OK);
  } catch {
    console.error(`Missing required artifact: ${artifact}`);
    process.exit(1);
  }
}

console.log("Artifacts verified.");
