export interface ClientPrincipal {
  identityProvider: string;
  userDetails: string;
  userId?: string;
  userRoles?: string[];
}

const MAX_ENCODED_PRINCIPAL_LENGTH = 16_384;
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isClientPrincipal(value: unknown): value is ClientPrincipal {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;

  const record = value as Record<string, unknown>;
  return (
    typeof record.identityProvider === "string" &&
    record.identityProvider.length > 0 &&
    typeof record.userDetails === "string" &&
    record.userDetails.length > 0 &&
    (record.userId === undefined || typeof record.userId === "string") &&
    (record.userRoles === undefined || isStringArray(record.userRoles))
  );
}

/** Parses the Static Web Apps base64 JSON identity header, returning null for every invalid shape. */
export function parseClientPrincipal(encoded: string | null | undefined): ClientPrincipal | null {
  if (!encoded || encoded.length > MAX_ENCODED_PRINCIPAL_LENGTH || !base64.test(encoded)) return null;

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    if (decoded.includes("\uFFFD")) return null;
    const value: unknown = JSON.parse(decoded);
    return isClientPrincipal(value) ? value : null;
  } catch {
    return null;
  }
}
