import { vi } from "vitest";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

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

describe("organization role routes", () => {
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

    const { default: organizationRoleRoutes } = await import(
      "./organization-role"
    );
    await app.register(organizationRoleRoutes);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  describe("GET /api/roles", () => {
    test("returns predefined roles (admin, editor, member)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/roles?limit=50&offset=0",
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      expect(payload.data).toBeInstanceOf(Array);
      expect(payload.data.length).toBeGreaterThanOrEqual(3);

      const roleNames = payload.data.map((r: { name: string }) => r.name);
      expect(roleNames).toContain("admin");
      expect(roleNames).toContain("editor");
      expect(roleNames).toContain("member");
    });

    test("includes custom roles for admin users", async ({
      makeCustomRole,
    }) => {
      await makeCustomRole(organizationId, {
        name: "Custom Viewer",
        role: "custom_viewer",
        permission: { agent: ["read"] },
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/roles?limit=50&offset=0",
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      const roleNames = payload.data.map((r: { name: string }) => r.name);
      expect(roleNames).toContain("admin");
      expect(roleNames).toContain("Custom Viewer");
    });

    test("non-admin only sees predefined roles", async ({ makeCustomRole }) => {
      hasPermissionMock.mockResolvedValue({
        success: false,
        error: "Forbidden",
      });

      await makeCustomRole(organizationId, {
        name: "Hidden Custom",
        role: "hidden_custom",
        permission: { agent: ["read"] },
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/roles?limit=50&offset=0",
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      const roleNames = payload.data.map((r: { name: string }) => r.name);
      expect(roleNames).toContain("admin");
      expect(roleNames).toContain("editor");
      expect(roleNames).toContain("member");
      expect(roleNames).not.toContain("Hidden Custom");
    });

    test("returns pagination metadata", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/roles?limit=2&offset=0",
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      expect(payload.pagination).toBeDefined();
      expect(payload.pagination.total).toBeGreaterThanOrEqual(3);
      expect(payload.pagination.limit).toBe(2);
    });

    test("supports name filtering", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/roles?limit=50&offset=0&name=admin",
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json();

      expect(payload.data.length).toBeGreaterThanOrEqual(1);
      const roleNames = payload.data.map((r: { name: string }) => r.name);
      expect(roleNames).toContain("admin");
    });
  });

  describe("GET /api/roles/:roleId", () => {
    test("returns predefined admin role by name", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/roles/admin",
      });

      expect(response.statusCode).toBe(200);
      const role = response.json();

      expect(role.name).toBe("admin");
      expect(role.predefined).toBe(true);
      expect(role.permission).toBeDefined();
      // Admin should have broad permissions
      expect(role.permission.agent).toBeDefined();
      expect(role.permission.organization).toBeDefined();
    });

    test("returns predefined member role by name", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/roles/member",
      });

      expect(response.statusCode).toBe(200);
      const role = response.json();

      expect(role.name).toBe("member");
      expect(role.predefined).toBe(true);
      expect(role.permission).toBeDefined();
    });

    test("returns predefined editor role by name", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/roles/editor",
      });

      expect(response.statusCode).toBe(200);
      const role = response.json();

      expect(role.name).toBe("editor");
      expect(role.predefined).toBe(true);
    });

    test("returns custom role by ID", async ({ makeCustomRole }) => {
      const customRole = await makeCustomRole(organizationId, {
        name: "Viewer Role",
        role: "viewer_role",
        permission: { agent: ["read"] },
      });

      const response = await app.inject({
        method: "GET",
        url: `/api/roles/${customRole.id}`,
      });

      expect(response.statusCode).toBe(200);
      const role = response.json();

      expect(role.name).toBe("Viewer Role");
      expect(role.predefined).toBe(false);
      expect(role.permission).toEqual({ agent: ["read"] });
    });

    test("returns 404 for non-existent role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/roles/non-existent-role-id",
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
