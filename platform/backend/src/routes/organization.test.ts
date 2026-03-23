import { vi } from "vitest";
import type * as originalConfigModule from "@/config";
import ToolModel from "@/models/tool";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

const VALID_PNG_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/58BAwAI/AL+hc2rNAAAAABJRU5ErkJggg==";

vi.mock("@/config", async (importOriginal) => {
  const actual = await importOriginal<typeof originalConfigModule>();
  return {
    default: {
      ...actual.default,
      enterpriseFeatures: {
        ...actual.default.enterpriseFeatures,
        fullWhiteLabeling: true,
      },
    },
  };
});

describe("organization routes", () => {
  let app: FastifyInstanceWithZod;
  let user: User;
  let organizationId: string;

  beforeEach(async ({ makeOrganization, makeUser }) => {
    user = await makeUser();
    const organization = await makeOrganization();
    organizationId = organization.id;

    app = createFastifyInstance();
    app.addHook("onRequest", async (request) => {
      (request as typeof request & { user: unknown }).user = user;
      (
        request as typeof request & {
          organizationId: string;
        }
      ).organizationId = organizationId;
    });

    const { default: organizationRoutes } = await import("./organization");
    await app.register(organizationRoutes);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  test("syncs built-in MCP branding when appName changes under full white labeling", async () => {
    const syncSpy = vi
      .spyOn(ToolModel, "syncArchestraBuiltInCatalog")
      .mockResolvedValue();

    const response = await app.inject({
      method: "PATCH",
      url: "/api/organization/appearance-settings",
      payload: {
        appName: "Acme Copilot",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(syncSpy).toHaveBeenCalledWith({
      organization: expect.objectContaining({
        appName: "Acme Copilot",
      }),
    });
  });

  test("does not resync built-in MCP branding when appName is unchanged", async () => {
    const syncSpy = vi
      .spyOn(ToolModel, "syncArchestraBuiltInCatalog")
      .mockResolvedValue();

    const response = await app.inject({
      method: "PATCH",
      url: "/api/organization/appearance-settings",
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(syncSpy).not.toHaveBeenCalled();
  });

  test("does not resync built-in MCP branding when only logo assets change", async () => {
    const syncSpy = vi
      .spyOn(ToolModel, "syncArchestraBuiltInCatalog")
      .mockResolvedValue();

    const response = await app.inject({
      method: "PATCH",
      url: "/api/organization/appearance-settings",
      payload: {
        logo: VALID_PNG_BASE64,
        logoDark: VALID_PNG_BASE64,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(syncSpy).not.toHaveBeenCalled();
  });

  test("resyncs built-in MCP branding when iconLogo changes", async () => {
    const syncSpy = vi
      .spyOn(ToolModel, "syncArchestraBuiltInCatalog")
      .mockResolvedValue();

    const response = await app.inject({
      method: "PATCH",
      url: "/api/organization/appearance-settings",
      payload: {
        iconLogo: VALID_PNG_BASE64,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(syncSpy).toHaveBeenCalledWith({
      organization: expect.objectContaining({
        iconLogo: VALID_PNG_BASE64,
      }),
    });
  });

  // ===========================================================================
  // Appearance settings
  // ===========================================================================
  describe("appearance settings", () => {
    test("rejects invalid Base64 payload (400)", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { logo: "data:image/png;base64,NOT_VALID!!!" },
      });
      expect(response.statusCode).toBe(400);
    });

    test("rejects non-PNG content (400)", async () => {
      // JPEG magic bytes (FFD8FF) wrapped in PNG data URI
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const jpegBase64 = `data:image/png;base64,${jpegBytes.toString("base64")}`;
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { logo: jpegBase64 },
      });
      expect(response.statusCode).toBe(400);
    });

    test("rejects wrong MIME type (400)", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { logo: "data:image/jpeg;base64,iVBORw0KGgo=" },
      });
      expect(response.statusCode).toBe(400);
    });

    test("accepts valid PNG logo and returns it", async () => {
      vi.spyOn(ToolModel, "syncArchestraBuiltInCatalog").mockResolvedValue();

      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { logo: VALID_PNG_BASE64 },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.logo).toBe(VALID_PNG_BASE64);
    });

    test("accepts null logo (removal)", async () => {
      vi.spyOn(ToolModel, "syncArchestraBuiltInCatalog").mockResolvedValue();

      // First set a logo
      await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { logo: VALID_PNG_BASE64 },
      });

      // Then remove it
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { logo: null },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.logo).toBeNull();
    });

    test("updates and retrieves appName", async () => {
      vi.spyOn(ToolModel, "syncArchestraBuiltInCatalog").mockResolvedValue();

      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { appName: "My Custom App" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().appName).toBe("My Custom App");
    });

    test("rejects appName > 100 chars (400)", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { appName: "A".repeat(101) },
      });
      expect(response.statusCode).toBe(400);
    });

    test("updates ogDescription", async () => {
      vi.spyOn(ToolModel, "syncArchestraBuiltInCatalog").mockResolvedValue();

      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { ogDescription: "A custom OG description" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().ogDescription).toBe("A custom OG description");
    });

    test("updates footerText", async () => {
      vi.spyOn(ToolModel, "syncArchestraBuiltInCatalog").mockResolvedValue();

      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { footerText: "Powered by Acme" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().footerText).toBe("Powered by Acme");
    });

    test("rejects footerText > 500 chars (400)", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { footerText: "X".repeat(501) },
      });
      expect(response.statusCode).toBe(400);
    });

    test("updates chatPlaceholders array", async () => {
      vi.spyOn(ToolModel, "syncArchestraBuiltInCatalog").mockResolvedValue();

      const placeholders = ["Ask me anything", "How can I help?"];
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { chatPlaceholders: placeholders },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().chatPlaceholders).toEqual(placeholders);
    });

    test("rejects chatPlaceholders > 20 entries (400)", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: {
          chatPlaceholders: Array.from({ length: 21 }, (_, i) => `p${i}`),
        },
      });
      expect(response.statusCode).toBe(400);
    });

    test("rejects chatPlaceholder entry > 80 chars (400)", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { chatPlaceholders: ["Y".repeat(81)] },
      });
      expect(response.statusCode).toBe(400);
    });

    test("updates showTwoFactor toggle", async () => {
      vi.spyOn(ToolModel, "syncArchestraBuiltInCatalog").mockResolvedValue();

      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { showTwoFactor: true },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().showTwoFactor).toBe(true);
    });

    test("accepts favicon as valid PNG", async () => {
      vi.spyOn(ToolModel, "syncArchestraBuiltInCatalog").mockResolvedValue();

      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { favicon: VALID_PNG_BASE64 },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().favicon).toBe(VALID_PNG_BASE64);
    });

    test("updates multiple fields at once", async () => {
      vi.spyOn(ToolModel, "syncArchestraBuiltInCatalog").mockResolvedValue();

      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: {
          appName: "Multi Update",
          footerText: "Footer here",
          ogDescription: "OG desc",
          showTwoFactor: true,
          chatPlaceholders: ["Hello"],
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.appName).toBe("Multi Update");
      expect(body.footerText).toBe("Footer here");
      expect(body.ogDescription).toBe("OG desc");
      expect(body.showTwoFactor).toBe(true);
      expect(body.chatPlaceholders).toEqual(["Hello"]);
    });

    test("GET /api/organization reflects appearance updates", async () => {
      vi.spyOn(ToolModel, "syncArchestraBuiltInCatalog").mockResolvedValue();

      await app.inject({
        method: "PATCH",
        url: "/api/organization/appearance-settings",
        payload: { appName: "Verified App", footerText: "Check footer" },
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/organization",
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.appName).toBe("Verified App");
      expect(body.footerText).toBe("Check footer");
    });
  });

  // ===========================================================================
  // Security settings
  // ===========================================================================
  describe("security settings", () => {
    test("updates globalToolPolicy to restrictive", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/security-settings",
        payload: { globalToolPolicy: "restrictive" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().globalToolPolicy).toBe("restrictive");
    });

    test("updates globalToolPolicy to permissive", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/security-settings",
        payload: { globalToolPolicy: "permissive" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().globalToolPolicy).toBe("permissive");
    });

    test("enables allowChatFileUploads", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/security-settings",
        payload: { allowChatFileUploads: true },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().allowChatFileUploads).toBe(true);
    });

    test("disables allowChatFileUploads", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/security-settings",
        payload: { allowChatFileUploads: false },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().allowChatFileUploads).toBe(false);
    });

    test("updates both security fields at once", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/security-settings",
        payload: {
          globalToolPolicy: "restrictive",
          allowChatFileUploads: false,
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.globalToolPolicy).toBe("restrictive");
      expect(body.allowChatFileUploads).toBe(false);
    });

    test("GET /api/organization reflects security updates", async () => {
      await app.inject({
        method: "PATCH",
        url: "/api/organization/security-settings",
        payload: {
          globalToolPolicy: "restrictive",
          allowChatFileUploads: true,
        },
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/organization",
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.globalToolPolicy).toBe("restrictive");
      expect(body.allowChatFileUploads).toBe(true);
    });
  });

  // ===========================================================================
  // LLM settings
  // ===========================================================================
  describe("LLM settings", () => {
    test("updates compressionScope to organization", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/llm-settings",
        payload: { compressionScope: "organization" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().compressionScope).toBe("organization");
    });

    test("updates compressionScope to team", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/llm-settings",
        payload: { compressionScope: "team" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().compressionScope).toBe("team");
    });

    test("toggles convertToolResultsToToon", async () => {
      const enableResponse = await app.inject({
        method: "PATCH",
        url: "/api/organization/llm-settings",
        payload: { convertToolResultsToToon: true },
      });
      expect(enableResponse.statusCode).toBe(200);
      expect(enableResponse.json().convertToolResultsToToon).toBe(true);

      const disableResponse = await app.inject({
        method: "PATCH",
        url: "/api/organization/llm-settings",
        payload: { convertToolResultsToToon: false },
      });
      expect(disableResponse.statusCode).toBe(200);
      expect(disableResponse.json().convertToolResultsToToon).toBe(false);
    });

    test("updates limitCleanupInterval", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/llm-settings",
        payload: { limitCleanupInterval: "12h" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().limitCleanupInterval).toBe("12h");
    });

    test("GET /api/organization reflects LLM settings updates", async () => {
      await app.inject({
        method: "PATCH",
        url: "/api/organization/llm-settings",
        payload: {
          compressionScope: "team",
          convertToolResultsToToon: true,
          limitCleanupInterval: "1w",
        },
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/organization",
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.compressionScope).toBe("team");
      expect(body.convertToolResultsToToon).toBe(true);
      expect(body.limitCleanupInterval).toBe("1w");
    });
  });

  // ===========================================================================
  // Knowledge settings
  // ===========================================================================
  describe("knowledge settings", () => {
    test("updates embeddingModel", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/knowledge-settings",
        payload: { embeddingModel: "text-embedding-3-small" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().embeddingModel).toBe("text-embedding-3-small");
    });

    test("updates rerankerModel", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/knowledge-settings",
        payload: { rerankerModel: "rerank-english-v3.0" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().rerankerModel).toBe("rerank-english-v3.0");
    });

    test("embedding model lock-in: cannot change once key + model configured", async ({
      makeSecret,
      makeChatApiKey,
    }) => {
      // Create a chat API key with an embedding-compatible provider (openai)
      const secret = await makeSecret();
      const chatApiKey = await makeChatApiKey(organizationId, secret.id, {
        provider: "openai",
      });

      // Configure the embedding with both key and model
      await app.inject({
        method: "PATCH",
        url: "/api/organization/knowledge-settings",
        payload: {
          embeddingModel: "text-embedding-3-small",
          embeddingChatApiKeyId: chatApiKey.id,
        },
      });

      // Attempt to change the model should fail
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/knowledge-settings",
        payload: { embeddingModel: "text-embedding-ada-002" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain(
        "Embedding model cannot be changed once configured",
      );
    });

    test("embedding model lock-in: can set same model again", async ({
      makeSecret,
      makeChatApiKey,
    }) => {
      const secret = await makeSecret();
      const chatApiKey = await makeChatApiKey(organizationId, secret.id, {
        provider: "openai",
      });

      await app.inject({
        method: "PATCH",
        url: "/api/organization/knowledge-settings",
        payload: {
          embeddingModel: "text-embedding-3-small",
          embeddingChatApiKeyId: chatApiKey.id,
        },
      });

      // Setting the same model is allowed
      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/knowledge-settings",
        payload: { embeddingModel: "text-embedding-3-small" },
      });
      expect(response.statusCode).toBe(200);
    });

    test("rejects embedding API key with non-compatible provider", async ({
      makeSecret,
      makeChatApiKey,
    }) => {
      const secret = await makeSecret();
      const chatApiKey = await makeChatApiKey(organizationId, secret.id, {
        provider: "anthropic",
      });

      const response = await app.inject({
        method: "PATCH",
        url: "/api/organization/knowledge-settings",
        payload: { embeddingChatApiKeyId: chatApiKey.id },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toContain("compatible provider");
    });

    test("GET /api/organization reflects knowledge settings updates", async () => {
      await app.inject({
        method: "PATCH",
        url: "/api/organization/knowledge-settings",
        payload: {
          embeddingModel: "text-embedding-3-small",
          rerankerModel: "rerank-english-v3.0",
        },
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/organization",
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.embeddingModel).toBe("text-embedding-3-small");
      expect(body.rerankerModel).toBe("rerank-english-v3.0");
    });
  });

  // ===========================================================================
  // Organization members
  // ===========================================================================
  describe("GET /api/organization/members/:idOrEmail", () => {
    test("gets a member by user ID", async ({ makeMember }) => {
      await makeMember(user.id, organizationId, { role: "admin" });

      const response = await app.inject({
        method: "GET",
        url: `/api/organization/members/${user.id}`,
      });

      expect(response.statusCode).toBe(200);
      const member = response.json();
      expect(member.id).toBe(user.id);
      expect(member.email).toBe(user.email);
      expect(member.role).toBeDefined();
    });

    test("gets a member by email", async ({ makeMember }) => {
      await makeMember(user.id, organizationId, { role: "admin" });

      const response = await app.inject({
        method: "GET",
        url: `/api/organization/members/${user.email}`,
      });

      expect(response.statusCode).toBe(200);
      const member = response.json();
      expect(member.id).toBe(user.id);
      expect(member.email).toBe(user.email);
    });

    test("returns 404 for non-existent user ID", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/organization/members/${crypto.randomUUID()}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.message).toContain("not found");
    });

    test("returns 404 for non-existent email", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/organization/members/nonexistent@example.com",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.message).toContain("not found");
    });
  });
});
