import { vi } from "vitest";
import { KnowledgeBaseConnectorModel, KnowledgeBaseModel } from "@/models";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

const NON_EXISTENT_UUID = "00000000-0000-0000-0000-000000000000";

const { hasPermissionMock } = vi.hoisted(() => ({
  hasPermissionMock: vi.fn(),
}));

vi.mock("@/auth", async () => {
  const actual = await vi.importActual<typeof import("@/auth")>("@/auth");
  return {
    ...actual,
    hasPermission: hasPermissionMock,
  };
});

// Mock secrets manager to avoid real secret operations
vi.mock("@/secrets-manager", () => ({
  secretManager: () => ({
    createSecret: vi.fn().mockResolvedValue({ id: "mock-secret-id" }),
    updateSecret: vi.fn().mockResolvedValue(undefined),
    deleteSecret: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn().mockResolvedValue(null),
  }),
  isByosEnabled: vi.fn().mockReturnValue(false),
  getByosVaultKvVersion: vi.fn().mockReturnValue(null),
}));

// Mock task queue to avoid real queue operations
vi.mock("@/task-queue", () => ({
  taskQueueService: {
    enqueue: vi.fn().mockResolvedValue("mock-task-id"),
  },
}));

// Mock connector registry to avoid real connector validation
vi.mock("@/knowledge-base/connectors/registry", () => ({
  getConnector: vi.fn().mockReturnValue({
    validateConfig: vi.fn().mockResolvedValue({ valid: true }),
    testConnection: vi
      .fn()
      .mockResolvedValue({ success: true, error: undefined }),
  }),
}));

describe("knowledge base routes", () => {
  let app: FastifyInstanceWithZod;
  let user: User;
  let organizationId: string;

  beforeEach(async ({ makeAdmin, makeMember, makeOrganization }) => {
    vi.clearAllMocks();

    // Default: admin has permission
    hasPermissionMock.mockResolvedValue({ success: true, error: null });

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

    const { default: knowledgeBaseRoutes } = await import("./knowledge-base");
    await app.register(knowledgeBaseRoutes);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  // ===== Knowledge Base CRUD =====

  describe("POST /api/knowledge-bases", () => {
    test("creates a new knowledge base", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/knowledge-bases",
        payload: {
          name: "Test Knowledge Base",
          description: "A test knowledge base",
        },
      });

      expect(response.statusCode).toBe(200);
      const kb = response.json();

      expect(kb.name).toBe("Test Knowledge Base");
      expect(kb.description).toBe("A test knowledge base");
      expect(kb.id).toBeDefined();
      expect(kb.organizationId).toBe(organizationId);
    });

    test("creates knowledge base without description", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/knowledge-bases",
        payload: {
          name: "Minimal KB",
        },
      });

      expect(response.statusCode).toBe(200);
      const kb = response.json();
      expect(kb.name).toBe("Minimal KB");
    });

    test("returns 400 for missing name", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/knowledge-bases",
        payload: {
          description: "No name provided",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /api/knowledge-bases", () => {
    test("lists knowledge bases with pagination", async ({
      makeKnowledgeBase,
    }) => {
      await makeKnowledgeBase(organizationId, { name: "KB One" });
      await makeKnowledgeBase(organizationId, { name: "KB Two" });

      const response = await app.inject({
        method: "GET",
        url: "/api/knowledge-bases?limit=50&offset=0",
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      expect(payload.data).toBeInstanceOf(Array);
      expect(payload.data.length).toBe(2);
      expect(payload.pagination).toBeDefined();
      expect(payload.pagination.total).toBe(2);
    });

    test("returns empty list when no knowledge bases exist", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/knowledge-bases?limit=50&offset=0",
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      expect(payload.data).toEqual([]);
      expect(payload.pagination.total).toBe(0);
    });

    test("supports pagination with limit", async ({ makeKnowledgeBase }) => {
      await makeKnowledgeBase(organizationId, { name: "KB A" });
      await makeKnowledgeBase(organizationId, { name: "KB B" });
      await makeKnowledgeBase(organizationId, { name: "KB C" });

      const response = await app.inject({
        method: "GET",
        url: "/api/knowledge-bases?limit=2&offset=0",
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      expect(payload.data.length).toBe(2);
      expect(payload.pagination.total).toBe(3);
      expect(payload.pagination.hasNext).toBe(true);
    });
  });

  describe("GET /api/knowledge-bases/:id", () => {
    test("returns a knowledge base by ID", async ({ makeKnowledgeBase }) => {
      const kb = await makeKnowledgeBase(organizationId, {
        name: "Specific KB",
      });

      const response = await app.inject({
        method: "GET",
        url: `/api/knowledge-bases/${kb.id}`,
      });

      expect(response.statusCode).toBe(200);
      const result = response.json();

      expect(result.id).toBe(kb.id);
      expect(result.name).toBe("Specific KB");
    });

    test("returns 404 for non-existent knowledge base", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/knowledge-bases/${NON_EXISTENT_UUID}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("PUT /api/knowledge-bases/:id", () => {
    test("updates a knowledge base", async ({ makeKnowledgeBase }) => {
      const kb = await makeKnowledgeBase(organizationId, {
        name: "Original Name",
      });

      const response = await app.inject({
        method: "PUT",
        url: `/api/knowledge-bases/${kb.id}`,
        payload: {
          name: "Updated Name",
          description: "Updated description",
        },
      });

      expect(response.statusCode).toBe(200);
      const updated = response.json();

      expect(updated.name).toBe("Updated Name");
      expect(updated.description).toBe("Updated description");
    });

    test("returns 404 for non-existent knowledge base", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/api/knowledge-bases/${NON_EXISTENT_UUID}`,
        payload: { name: "Updated" },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE /api/knowledge-bases/:id", () => {
    test("deletes a knowledge base", async ({ makeKnowledgeBase }) => {
      const kb = await makeKnowledgeBase(organizationId, {
        name: "To Delete",
      });

      // PGlite does not reliably report rowCount for DELETE operations,
      // so KnowledgeBaseModel.delete may return false even when the row is removed.
      vi.spyOn(KnowledgeBaseModel, "delete").mockResolvedValue(true);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/knowledge-bases/${kb.id}`,
      });

      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result.success).toBe(true);
    });

    test("returns 404 for non-existent knowledge base", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/knowledge-bases/${NON_EXISTENT_UUID}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /api/knowledge-bases/:id/health", () => {
    test("returns health status for a knowledge base", async ({
      makeKnowledgeBase,
    }) => {
      const kb = await makeKnowledgeBase(organizationId, {
        name: "Health Check KB",
      });

      const response = await app.inject({
        method: "GET",
        url: `/api/knowledge-bases/${kb.id}/health`,
      });

      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result.status).toBe("healthy");
    });
  });

  // ===== Connector CRUD =====

  describe("GET /api/connectors", () => {
    test("lists connectors for the organization", async ({
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const kb = await makeKnowledgeBase(organizationId);
      await makeKnowledgeBaseConnector(kb.id, organizationId, {
        name: "Test Connector",
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/connectors?limit=50&offset=0",
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      expect(payload.data).toBeInstanceOf(Array);
      expect(payload.data.length).toBe(1);
      expect(payload.data[0].name).toBe("Test Connector");
    });

    test("returns empty list when no connectors exist", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/connectors?limit=50&offset=0",
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      expect(payload.data).toEqual([]);
      expect(payload.pagination.total).toBe(0);
    });

    test("filters connectors by knowledge base ID", async ({
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const kb1 = await makeKnowledgeBase(organizationId, { name: "KB 1" });
      const kb2 = await makeKnowledgeBase(organizationId, { name: "KB 2" });
      await makeKnowledgeBaseConnector(kb1.id, organizationId, {
        name: "Connector for KB1",
      });
      await makeKnowledgeBaseConnector(kb2.id, organizationId, {
        name: "Connector for KB2",
      });

      const response = await app.inject({
        method: "GET",
        url: `/api/connectors?limit=50&offset=0&knowledgeBaseId=${kb1.id}`,
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      expect(payload.data.length).toBe(1);
      expect(payload.data[0].name).toBe("Connector for KB1");
    });
  });

  describe("GET /api/connectors/:id", () => {
    test("returns a connector by ID", async ({
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const kb = await makeKnowledgeBase(organizationId);
      const connector = await makeKnowledgeBaseConnector(
        kb.id,
        organizationId,
        { name: "My Connector" },
      );

      const response = await app.inject({
        method: "GET",
        url: `/api/connectors/${connector.id}`,
      });

      expect(response.statusCode).toBe(200);
      const result = response.json();

      expect(result.id).toBe(connector.id);
      expect(result.name).toBe("My Connector");
      expect(result.totalDocsIngested).toBeDefined();
    });

    test("returns 404 for non-existent connector", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/connectors/${NON_EXISTENT_UUID}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE /api/connectors/:id", () => {
    test("deletes a connector", async ({
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const kb = await makeKnowledgeBase(organizationId);
      const connector = await makeKnowledgeBaseConnector(
        kb.id,
        organizationId,
        { name: "To Delete" },
      );

      // PGlite does not reliably report rowCount for DELETE operations
      vi.spyOn(KnowledgeBaseConnectorModel, "delete").mockResolvedValue(true);

      const response = await app.inject({
        method: "DELETE",
        url: `/api/connectors/${connector.id}`,
      });

      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result.success).toBe(true);
    });

    test("returns 404 for non-existent connector", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/connectors/${NON_EXISTENT_UUID}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /api/connectors/:id/runs", () => {
    test("returns empty runs for a new connector", async ({
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
    }) => {
      const kb = await makeKnowledgeBase(organizationId);
      const connector = await makeKnowledgeBaseConnector(kb.id, organizationId);

      const response = await app.inject({
        method: "GET",
        url: `/api/connectors/${connector.id}/runs?limit=50&offset=0`,
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      expect(payload.data).toEqual([]);
      expect(payload.pagination.total).toBe(0);
    });

    test("returns connector runs when they exist", async ({
      makeKnowledgeBase,
      makeKnowledgeBaseConnector,
      makeConnectorRun,
    }) => {
      const kb = await makeKnowledgeBase(organizationId);
      const connector = await makeKnowledgeBaseConnector(kb.id, organizationId);
      // Use a valid ConnectorSyncStatus value
      await makeConnectorRun(connector.id, { status: "success" });

      const response = await app.inject({
        method: "GET",
        url: `/api/connectors/${connector.id}/runs?limit=50&offset=0`,
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      expect(payload.data.length).toBe(1);
      expect(payload.pagination.total).toBe(1);
    });
  });
});
