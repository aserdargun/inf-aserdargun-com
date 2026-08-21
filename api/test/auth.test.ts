import { describe, expect, it } from "vitest";
import {
  authorizeOwner,
  type AuthorizationInput,
} from "../src/auth/authorize.js";
import { parseClientPrincipal } from "../src/auth/principal.js";

const ownerPrincipal = (overrides: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      identityProvider: "github",
      userDetails: "aserdargun",
      userRoles: ["authenticated"],
      ...overrides,
    }),
  ).toString("base64");

const ownerInput = (user = "aserdargun", overrides: Partial<AuthorizationInput> = {}): AuthorizationInput => ({
  encodedPrincipal: ownerPrincipal({ userDetails: user }),
  allowedGithubUser: "aserdargun",
  requestUrl: "https://inf.aserdargun.com/api/session",
  localAuthBypass: undefined,
  azureSiteName: "swa-inf-aserdargun-com",
  localProxyMode: undefined,
  expectedLocalProxyToken: undefined,
  presentedLocalProxyToken: null,
  ...overrides,
});

const localBypassInput = (overrides: Partial<AuthorizationInput> = {}): AuthorizationInput => ({
  ...ownerInput("aserdargun", {
    encodedPrincipal: null,
    requestUrl: "http://127.0.0.1:7071/api/session",
    localAuthBypass: "true",
    azureSiteName: undefined,
    localProxyMode: "bypass",
    expectedLocalProxyToken: "per-run-local-proxy-token",
    presentedLocalProxyToken: "per-run-local-proxy-token",
  }),
  ...overrides,
});

describe("Azure client-principal parsing", () => {
  it("accepts a well-shaped GitHub principal", () => {
    expect(parseClientPrincipal(ownerPrincipal())).toEqual({
      identityProvider: "github",
      userDetails: "aserdargun",
      userRoles: ["authenticated"],
    });
  });

  it.each([
    null,
    "",
    "not-base64-json",
    Buffer.from("[]").toString("base64"),
    Buffer.from("null").toString("base64"),
    Buffer.from(JSON.stringify({ identityProvider: 42, userDetails: "aserdargun" })).toString("base64"),
    Buffer.from(JSON.stringify({ identityProvider: "github", userDetails: 42 })).toString("base64"),
    Buffer.from(JSON.stringify({ identityProvider: "github", userDetails: "aserdargun", userId: 42 })).toString("base64"),
    Buffer.from(JSON.stringify({ identityProvider: "github", userDetails: "aserdargun", userRoles: [42] })).toString("base64"),
    "a".repeat(16_385),
  ])("rejects malformed or wrong-shaped principal %j", (encodedPrincipal) => {
    expect(parseClientPrincipal(encodedPrincipal)).toBeNull();
  });
});

describe("owner authorization", () => {
  it("accepts only the configured GitHub owner", () => {
    expect(authorizeOwner(ownerInput("aserdargun"))).toEqual({ authorized: true, mode: "github" });
    expect(authorizeOwner(ownerInput("another-user"))).toEqual({ authorized: false, status: 403 });
  });

  it("matches provider and configured GitHub username case-insensitively", () => {
    expect(authorizeOwner(ownerInput("AsErDaRgUn", { encodedPrincipal: ownerPrincipal({ identityProvider: "GitHub", userDetails: "AsErDaRgUn" }), allowedGithubUser: "ASERDARGUN" }))).toEqual({ authorized: true, mode: "github" });
  });

  it("accepts an authenticated-only owner principal without a special owner role", () => {
    expect(authorizeOwner(ownerInput())).toEqual({ authorized: true, mode: "github" });
  });

  it("fails closed for missing or malformed identity", () => {
    expect(authorizeOwner(ownerInput("aserdargun", { encodedPrincipal: null }))).toEqual({ authorized: false, status: 401 });
    expect(authorizeOwner(ownerInput("aserdargun", { encodedPrincipal: "not-base64-json" }))).toEqual({ authorized: false, status: 401 });
  });

  it("rejects a non-GitHub provider and a missing configured owner", () => {
    expect(authorizeOwner(ownerInput("aserdargun", { encodedPrincipal: ownerPrincipal({ identityProvider: "twitter" }) }))).toEqual({ authorized: false, status: 403 });
    expect(authorizeOwner(ownerInput("aserdargun", { allowedGithubUser: undefined }))).toEqual({ authorized: false, status: 403 });
  });
});

describe("capability-protected local authorization", () => {
  it.each([
    "http://localhost:7071/api/session",
    "http://127.0.0.1:7071/api/session",
    "http://[::1]:7071/api/session",
  ])("allows bypass only at loopback host %s", (requestUrl) => {
    expect(authorizeOwner(localBypassInput({ requestUrl }))).toEqual({ authorized: true, mode: "local-bypass" });
  });

  it.each([
    ["LAN", "http://192.168.1.20:7071/api/session"],
    ["public", "https://inf.aserdargun.com/api/session"],
    ["malformed", "not a url"],
  ])("rejects %s request URL", (_label, requestUrl) => {
    expect(authorizeOwner(localBypassInput({ requestUrl }))).toEqual({ authorized: false, status: 403 });
  });

  it.each([undefined, "", "TRUE", "True", "false", " true"]) (
    "requires the exact true bypass flag: %j",
    (localAuthBypass) => {
      expect(authorizeOwner(localBypassInput({ localAuthBypass }))).toEqual({ authorized: false, status: 403 });
    },
  );

  it.each(["", "swa-inf-aserdargun-com"]) ("rejects any defined Azure signal: %j", (azureSiteName) => {
    expect(authorizeOwner(localBypassInput({ azureSiteName }))).toEqual({ authorized: false, status: 403 });
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["same-length mismatch", "per-run-local-proxy-tokex"],
    ["different-length mismatch", "short"],
  ])("requires a matching non-empty proxy token: %s", (_label, presentedLocalProxyToken) => {
    expect(authorizeOwner(localBypassInput({ presentedLocalProxyToken: presentedLocalProxyToken ?? null }))).toEqual({ authorized: false, status: 403 });
  });

  it.each([undefined, ""]) ("rejects an absent or empty expected proxy token: %j", (expectedLocalProxyToken) => {
    expect(authorizeOwner(localBypassInput({ expectedLocalProxyToken }))).toEqual({ authorized: false, status: 403 });
  });

  it("fails closed when a proxy token is configured without a recognized proxy mode", () => {
    expect(authorizeOwner(localBypassInput({ localProxyMode: undefined, encodedPrincipal: ownerPrincipal() }))).toEqual({ authorized: false, status: 403 });
  });

  it("does not use a forged owner principal when local-proxy configuration is present", () => {
    expect(authorizeOwner(localBypassInput({ encodedPrincipal: ownerPrincipal(), presentedLocalProxyToken: null }))).toEqual({ authorized: false, status: 403 });
  });

  it("requires a matching token and real owner in swa proxy mode", () => {
    expect(authorizeOwner(localBypassInput({
      encodedPrincipal: ownerPrincipal(),
      localAuthBypass: "false",
      localProxyMode: "swa",
    }))).toEqual({ authorized: true, mode: "github" });
    expect(authorizeOwner(localBypassInput({
      encodedPrincipal: ownerPrincipal({ userDetails: "forged-owner" }),
      localAuthBypass: "true",
      localProxyMode: "swa",
    }))).toEqual({ authorized: false, status: 403 });
  });

  it("does not mutate authorization input", () => {
    const input = localBypassInput();
    const before = structuredClone(input);
    authorizeOwner(input);
    expect(input).toEqual(before);
  });
});
