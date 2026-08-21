import { timingSafeEqual } from "node:crypto";
import { parseClientPrincipal } from "./principal.js";

export interface AuthorizationInput {
  encodedPrincipal: string | null;
  allowedGithubUser: string | undefined;
  requestUrl: string;
  localAuthBypass: string | undefined;
  azureSiteName: string | undefined;
  localProxyMode: string | undefined;
  expectedLocalProxyToken: string | undefined;
  presentedLocalProxyToken: string | null;
}

/** Successful decisions name the authenticated path; failures use 401 for invalid identity and 403 for an authenticated non-owner or failed local capability. */
export type AuthDecision =
  | { authorized: true; mode: "github" | "local-bypass" }
  | { authorized: false; status: 401 | 403 };

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function ownerDecision(input: AuthorizationInput): AuthDecision {
  const principal = parseClientPrincipal(input.encodedPrincipal);
  if (!principal) return { authorized: false, status: 401 };
  if (!input.allowedGithubUser || input.allowedGithubUser.length === 0) return { authorized: false, status: 403 };

  const isGithub = principal.identityProvider.toLocaleLowerCase("en-US") === "github";
  const isOwner = principal.userDetails.toLocaleLowerCase("en-US") === input.allowedGithubUser.toLocaleLowerCase("en-US");
  return isGithub && isOwner ? { authorized: true, mode: "github" } : { authorized: false, status: 403 };
}

function hasMatchingLocalProxyToken(input: AuthorizationInput): boolean {
  if (!input.expectedLocalProxyToken || !input.presentedLocalProxyToken) return false;
  const expected = Buffer.from(input.expectedLocalProxyToken, "utf8");
  const presented = Buffer.from(input.presentedLocalProxyToken, "utf8");
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

function isLocalBypassAllowed(input: AuthorizationInput): boolean {
  if (input.localAuthBypass !== "true" || input.azureSiteName !== undefined) return false;
  try {
    return loopbackHosts.has(new URL(input.requestUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Authorizes the configured GitHub owner. Any configured local proxy turns the
 * proxy token into a required capability; bypass then additionally requires all
 * local-only gates, while swa mode still requires the real owner principal.
 */
export function authorizeOwner(input: AuthorizationInput): AuthDecision {
  const hasLocalProxyConfiguration =
    input.localProxyMode !== undefined || input.expectedLocalProxyToken !== undefined;

  if (!hasLocalProxyConfiguration) return ownerDecision(input);
  if (!hasMatchingLocalProxyToken(input)) return { authorized: false, status: 403 };

  if (input.localProxyMode === "bypass") {
    return isLocalBypassAllowed(input)
      ? { authorized: true, mode: "local-bypass" }
      : { authorized: false, status: 403 };
  }

  if (input.localProxyMode === "swa") {
    const decision = ownerDecision(input);
    return decision.authorized ? decision : { authorized: false, status: 403 };
  }

  return { authorized: false, status: 403 };
}
