import { createHash } from "node:crypto";

/** Calculates the canonical lowercase SHA-256 digest of the supplied bytes. */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
