import { SupportedProviders } from "@shared";
import { vi } from "vitest";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

// Mock k8s runtime manager
vi.mock("@/k8s/mcp-server-runtime", () => ({
  McpServerRuntimeManager: {
    isEnabled: false,
  },
}));

// Mock secrets manager
vi.mock("@/secrets-manager", () => ({
  secretManager: () => ({
    createSecret: vi.fn(),
    getSecret: vi.fn(),
    deleteSecret: vi.fn(),
  }),
  isByosEnabled: vi.fn().mockReturnValue(false),
  getByosVaultKvVersion: vi.fn().mockReturnValue(null),
}));

// Mock bedrock credentials
vi.mock("@/clients/bedrock-credentials", () => ({
  isBedrockIamAuthEnabled: vi.fn().mockReturnValue(false),
}));

// Mock gemini client
vi.mock("@/clients/gemini-client", () => ({
  isVertexAiEnabled: vi.fn().mockReturnValue(false),
}));

// Mock email provider info
vi.mock("@/agents/incoming-email", () => ({
  getEmailProviderInfo: vi.fn().mockReturnValue({
    enabled: false,
    provider: undefined,
    displayName: undefined,
    emailDomain: undefined,
  }),
}));

describe("config routes", () => {
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
      (request as typeof request & { user: unknown }).user = user;
      (request as typeof request & { organizationId: string }).organizationId =
        organizationId;
    });

    const { default: configRoutes } = await import("./config");
    await app.register(configRoutes);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  test("GET /api/config returns expected structure", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/config",
    });

    expect(response.statusCode).toBe(200);
    const config = response.json();

    // Top-level keys
    expect(config).toHaveProperty("enterpriseFeatures");
    expect(config).toHaveProperty("features");
    expect(config).toHaveProperty("providerBaseUrls");
  });

  test("GET /api/config returns enterprise features", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/config",
    });

    expect(response.statusCode).toBe(200);
    const config = response.json();

    expect(config.enterpriseFeatures).toHaveProperty("core");
    expect(config.enterpriseFeatures).toHaveProperty("knowledgeBase");
    expect(config.enterpriseFeatures).toHaveProperty("fullWhiteLabeling");
    expect(typeof config.enterpriseFeatures.core).toBe("boolean");
    expect(typeof config.enterpriseFeatures.knowledgeBase).toBe("boolean");
    expect(typeof config.enterpriseFeatures.fullWhiteLabeling).toBe("boolean");
  });

  test("GET /api/config returns feature flags", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/config",
    });

    expect(response.statusCode).toBe(200);
    const config = response.json();

    const { features } = config;
    expect(features).toHaveProperty("orchestratorK8sRuntime");
    expect(features).toHaveProperty("byosEnabled");
    expect(features).toHaveProperty("byosVaultKvVersion");
    expect(features).toHaveProperty("bedrockIamAuthEnabled");
    expect(features).toHaveProperty("geminiVertexAiEnabled");
    expect(features).toHaveProperty("globalToolPolicy");
    expect(features).toHaveProperty("incomingEmail");
    expect(features).toHaveProperty("mcpServerBaseImage");
    expect(features).toHaveProperty("orchestratorK8sNamespace");
    expect(features).toHaveProperty("isQuickstart");
    expect(features).toHaveProperty("ngrokDomain");
    expect(features).toHaveProperty("virtualKeyDefaultExpirationSeconds");

    expect(typeof features.orchestratorK8sRuntime).toBe("boolean");
    expect(typeof features.byosEnabled).toBe("boolean");
    expect(typeof features.globalToolPolicy).toBe("string");
    expect(["permissive", "restrictive"]).toContain(features.globalToolPolicy);
  });

  test("GET /api/config returns provider base URLs for all supported providers", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/config",
    });

    expect(response.statusCode).toBe(200);
    const config = response.json();

    const { providerBaseUrls } = config;
    expect(providerBaseUrls).toBeDefined();

    // Check that all supported providers have an entry
    for (const provider of SupportedProviders) {
      expect(providerBaseUrls).toHaveProperty(provider);
    }
  });

  test("GET /api/config globalToolPolicy defaults to permissive", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/config",
    });

    expect(response.statusCode).toBe(200);
    const config = response.json();

    // Default is permissive when no org has set it
    expect(config.features.globalToolPolicy).toBe("permissive");
  });
});
