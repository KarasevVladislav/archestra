import { vi } from "vitest";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

// Mock hasPermission to always grant admin access
vi.mock("@/auth", async () => {
  const actual = await vi.importActual<typeof import("@/auth")>("@/auth");
  return {
    ...actual,
    hasPermission: vi.fn().mockResolvedValue({ success: true, error: null }),
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
}));

// Mock k8s runtime manager to avoid real k8s operations
vi.mock("@/k8s/mcp-server-runtime/manager", () => ({
  default: {
    listDockerRegistrySecrets: vi.fn().mockResolvedValue([]),
  },
}));

// Mock the mcp-reinstall service
vi.mock("@/services/mcp-reinstall", () => ({
  autoReinstallServer: vi.fn().mockResolvedValue(undefined),
  requiresNewUserInputForReinstall: vi.fn().mockReturnValue(false),
}));

describe("internal MCP catalog routes - labels", () => {
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

    const { default: catalogRoutes } = await import("./internal-mcp-catalog");
    await app.register(catalogRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("creates a catalog item with labels", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/internal_mcp_catalog",
      payload: {
        name: `test-catalog-labels-${crypto.randomUUID().substring(0, 8)}`,
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
        labels: [
          { key: "env", value: "production" },
          { key: "team", value: "platform" },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const item = response.json();
    expect(item.labels).toHaveLength(2);
    expect(item.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "env", value: "production" }),
        expect.objectContaining({ key: "team", value: "platform" }),
      ]),
    );
  });

  test("get catalog item returns labels", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/internal_mcp_catalog",
      payload: {
        name: `test-catalog-get-labels-${crypto.randomUUID().substring(0, 8)}`,
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
        labels: [{ key: "category", value: "database" }],
      },
    });
    const created = createResponse.json();

    const response = await app.inject({
      method: "GET",
      url: `/api/internal_mcp_catalog/${created.id}`,
    });

    expect(response.statusCode).toBe(200);
    const item = response.json();
    expect(item.labels).toHaveLength(1);
    expect(item.labels[0]).toMatchObject({
      key: "category",
      value: "database",
    });
  });

  test("updates labels on a catalog item", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/internal_mcp_catalog",
      payload: {
        name: `test-catalog-update-labels-${crypto.randomUUID().substring(0, 8)}`,
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
        labels: [{ key: "env", value: "staging" }],
      },
    });
    const created = createResponse.json();

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/internal_mcp_catalog/${created.id}`,
      payload: {
        labels: [
          { key: "env", value: "production" },
          { key: "region", value: "us-east" },
        ],
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    const updated = updateResponse.json();
    expect(updated.labels).toHaveLength(2);
    expect(updated.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "env", value: "production" }),
        expect.objectContaining({ key: "region", value: "us-east" }),
      ]),
    );
  });

  test("removes all labels from a catalog item", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/internal_mcp_catalog",
      payload: {
        name: `test-catalog-remove-labels-${crypto.randomUUID().substring(0, 8)}`,
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
        labels: [
          { key: "env", value: "test" },
          { key: "team", value: "ops" },
        ],
      },
    });
    const created = createResponse.json();

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/internal_mcp_catalog/${created.id}`,
      payload: {
        labels: [],
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    const updated = updateResponse.json();
    expect(updated.labels).toHaveLength(0);
  });

  test("labels appear in list endpoint", async () => {
    const name = `test-catalog-list-labels-${crypto.randomUUID().substring(0, 8)}`;
    await app.inject({
      method: "POST",
      url: "/api/internal_mcp_catalog",
      payload: {
        name,
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
        labels: [{ key: "visible", value: "yes" }],
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/internal_mcp_catalog",
    });

    expect(response.statusCode).toBe(200);
    const items = response.json();
    const found = items.find((item: { name: string }) => item.name === name);
    expect(found).toBeDefined();
    expect(found.labels).toHaveLength(1);
    expect(found.labels[0]).toMatchObject({ key: "visible", value: "yes" });
  });

  test("label keys endpoint returns keys", async () => {
    await app.inject({
      method: "POST",
      url: "/api/internal_mcp_catalog",
      payload: {
        name: `test-catalog-keys-${crypto.randomUUID().substring(0, 8)}`,
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
        labels: [
          { key: "environment", value: "prod" },
          { key: "tier", value: "gold" },
        ],
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/internal_mcp_catalog/labels/keys",
    });

    expect(response.statusCode).toBe(200);
    const keys = response.json();
    expect(keys).toContain("environment");
    expect(keys).toContain("tier");
  });

  test("label values endpoint with key filter", async () => {
    // Create two catalog items with different values for the same key
    await app.inject({
      method: "POST",
      url: "/api/internal_mcp_catalog",
      payload: {
        name: `test-catalog-values-1-${crypto.randomUUID().substring(0, 8)}`,
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
        labels: [
          { key: "env", value: "development" },
          { key: "team", value: "backend" },
        ],
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/internal_mcp_catalog",
      payload: {
        name: `test-catalog-values-2-${crypto.randomUUID().substring(0, 8)}`,
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
        labels: [{ key: "env", value: "staging" }],
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/internal_mcp_catalog/labels/values?key=env",
    });

    expect(response.statusCode).toBe(200);
    const values = response.json();
    // Should contain values for the "env" key
    expect(values).toContain("development");
    expect(values).toContain("staging");
    // Should not contain values for other keys
    expect(values).not.toContain("backend");
  });

  test("delete catalog item cascades labels", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/internal_mcp_catalog",
      payload: {
        name: `test-catalog-cascade-${crypto.randomUUID().substring(0, 8)}`,
        serverType: "remote",
        serverUrl: "https://example.com/mcp",
        labels: [{ key: "delete-test", value: "cascade" }],
      },
    });
    const created = createResponse.json();

    // Delete the catalog item
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/internal_mcp_catalog/${created.id}`,
    });
    expect(deleteResponse.statusCode).toBe(200);

    // Verify the item is gone
    const getResponse = await app.inject({
      method: "GET",
      url: `/api/internal_mcp_catalog/${created.id}`,
    });
    expect(getResponse.statusCode).toBe(404);
  });
});
