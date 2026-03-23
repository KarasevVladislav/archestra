import { afterEach, vi } from "vitest";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";
import { getIdpLogoutUrl } from "./identity-provider.ee";

// Logger is silenced via ARCHESTRA_LOGGING_LEVEL=silent in test setup

describe("getIdpLogoutUrl", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns null for non-SSO user (credential-only account)", async ({
    makeUser,
  }) => {
    const user = await makeUser();
    // The makeUser fixture creates a "credential" provider account by default

    const url = await getIdpLogoutUrl(user.id);
    expect(url).toBeNull();
  });

  test("returns null for SAML provider (no oidcConfig)", async ({
    makeUser,
    makeAccount,
    makeOrganization,
    makeIdentityProvider,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();

    // Create an SSO provider with SAML config (no OIDC)
    await makeIdentityProvider(org.id, {
      providerId: "saml-provider",
      samlConfig: {
        entityId: "https://saml.example.com",
        signOnUrl: "https://saml.example.com/sso",
        certificate: "test-cert",
      },
    });

    // Create an SSO account linked to the SAML provider
    await makeAccount(user.id, {
      providerId: "saml-provider",
    });

    const url = await getIdpLogoutUrl(user.id);
    expect(url).toBeNull();
  });

  test("returns constructed URL for OIDC provider with valid discovery doc", async ({
    makeUser,
    makeAccount,
    makeOrganization,
    makeIdentityProvider,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();

    await makeIdentityProvider(org.id, {
      providerId: "oidc-provider",
      oidcConfig: {
        clientId: "test-client",
        clientSecret: "test-secret",
        issuer: "https://idp.example.com",
        pkce: false,
        discoveryEndpoint:
          "https://idp.example.com/.well-known/openid-configuration",
      },
    });

    const testIdToken = "eyJhbGciOiJSUzI1NiJ9.test-id-token";
    await makeAccount(user.id, {
      providerId: "oidc-provider",
      idToken: testIdToken,
    });

    // Mock fetch to return a discovery doc with end_session_endpoint
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issuer: "https://idp.example.com",
        end_session_endpoint:
          "https://idp.example.com/protocol/openid-connect/logout",
      }),
    });

    const url = await getIdpLogoutUrl(user.id);

    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://idp.example.com/protocol/openid-connect/logout",
    );
    expect(parsed.searchParams.get("id_token_hint")).toBe(testIdToken);
    expect(parsed.searchParams.get("client_id")).toBe("test-client");
    expect(parsed.searchParams.get("post_logout_redirect_uri")).toContain(
      "/auth/sign-in",
    );
  });

  test("returns null when discovery fetch fails (graceful degradation)", async ({
    makeUser,
    makeAccount,
    makeOrganization,
    makeIdentityProvider,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();

    await makeIdentityProvider(org.id, {
      providerId: "oidc-failing",
      oidcConfig: {
        clientId: "test-client",
        clientSecret: "test-secret",
        issuer: "https://idp.example.com",
        pkce: false,
        discoveryEndpoint:
          "https://idp.example.com/.well-known/openid-configuration",
      },
    });

    await makeAccount(user.id, {
      providerId: "oidc-failing",
    });

    // Mock fetch to throw a network error
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const url = await getIdpLogoutUrl(user.id);
    expect(url).toBeNull();
  });

  test("returns null when discovery fetch returns non-2xx status", async ({
    makeUser,
    makeAccount,
    makeOrganization,
    makeIdentityProvider,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();

    await makeIdentityProvider(org.id, {
      providerId: "oidc-500",
      oidcConfig: {
        clientId: "test-client",
        clientSecret: "test-secret",
        issuer: "https://idp.example.com",
        pkce: false,
        discoveryEndpoint:
          "https://idp.example.com/.well-known/openid-configuration",
      },
    });

    await makeAccount(user.id, {
      providerId: "oidc-500",
    });

    // Mock fetch to return a 500 server error
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const url = await getIdpLogoutUrl(user.id);
    expect(url).toBeNull();
  });

  test("returns null when discovery doc has no end_session_endpoint", async ({
    makeUser,
    makeAccount,
    makeOrganization,
    makeIdentityProvider,
  }) => {
    const user = await makeUser();
    const org = await makeOrganization();

    await makeIdentityProvider(org.id, {
      providerId: "oidc-no-logout",
      oidcConfig: {
        clientId: "test-client",
        clientSecret: "test-secret",
        issuer: "https://idp.example.com",
        pkce: false,
        discoveryEndpoint:
          "https://idp.example.com/.well-known/openid-configuration",
      },
    });

    await makeAccount(user.id, {
      providerId: "oidc-no-logout",
    });

    // Mock fetch to return a discovery doc WITHOUT end_session_endpoint
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issuer: "https://idp.example.com",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        // no end_session_endpoint
      }),
    });

    const url = await getIdpLogoutUrl(user.id);
    expect(url).toBeNull();
  });
});

describe("identity provider routes", () => {
  let app: FastifyInstanceWithZod;
  let user: User;
  let organizationId: string;

  beforeEach(async ({ makeAdmin, makeMember, makeOrganization }) => {
    user = await makeAdmin();
    const organization = await makeOrganization();
    organizationId = organization.id;
    await makeMember(user.id, organizationId, { role: "admin" });

    app = createFastifyInstance();
    app.addHook("onRequest", async (request) => {
      (
        request as typeof request & {
          user: unknown;
          organizationId: string;
        }
      ).user = user;
      (
        request as typeof request & {
          user: { id: string };
          organizationId: string;
        }
      ).organizationId = organizationId;
    });

    const { default: identityProviderRoutes } = await import(
      "./identity-provider.ee"
    );
    await app.register(identityProviderRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("GET /api/identity-providers returns list of identity providers", async ({
    makeIdentityProvider,
  }) => {
    await makeIdentityProvider(organizationId, {
      providerId: "test-idp-1",
      oidcConfig: {
        clientId: "client-1",
        clientSecret: "secret-1",
        issuer: "https://idp1.example.com",
        pkce: false,
        discoveryEndpoint:
          "https://idp1.example.com/.well-known/openid-configuration",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/identity-providers",
    });

    expect(response.statusCode).toBe(200);
    const providers = response.json();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThanOrEqual(1);
    expect(
      providers.some(
        (p: { providerId: string }) => p.providerId === "test-idp-1",
      ),
    ).toBe(true);
  });

  test("GET /api/identity-providers/public returns public provider info", async ({
    makeIdentityProvider,
  }) => {
    await makeIdentityProvider(organizationId, {
      providerId: "public-idp",
      oidcConfig: {
        clientId: "public-client",
        clientSecret: "public-secret",
        issuer: "https://public-idp.example.com",
        pkce: false,
        discoveryEndpoint:
          "https://public-idp.example.com/.well-known/openid-configuration",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/identity-providers/public",
    });

    expect(response.statusCode).toBe(200);
    const providers = response.json();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThanOrEqual(1);
    // Public endpoint should not expose secrets
    for (const provider of providers) {
      expect(provider).not.toHaveProperty("oidcConfig");
      expect(provider).not.toHaveProperty("samlConfig");
    }
  });

  test("GET /api/identity-providers/:id returns 404 for non-existent provider", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/identity-providers/${crypto.randomUUID()}`,
    });

    expect(response.statusCode).toBe(404);
  });

  test("GET /api/identity-providers/:id returns existing provider", async ({
    makeIdentityProvider,
  }) => {
    const provider = await makeIdentityProvider(organizationId, {
      providerId: "get-by-id-idp",
      oidcConfig: {
        clientId: "get-client",
        clientSecret: "get-secret",
        issuer: "https://get-idp.example.com",
        pkce: false,
        discoveryEndpoint:
          "https://get-idp.example.com/.well-known/openid-configuration",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/identity-providers/${provider.id}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(provider.id);
    expect(body.providerId).toBe("get-by-id-idp");
  });

  test("GET /api/identity-providers/idp-logout-url returns null for non-SSO user", async () => {
    // The authenticated user is a credential-only user (no SSO account)
    const response = await app.inject({
      method: "GET",
      url: "/api/identity-providers/idp-logout-url",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.url).toBeNull();
  });
});
