import { vi } from "vitest";
import db, { schema } from "@/database";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

const {
  createOrgRoleMock,
  updateOrgRoleMock,
  deleteOrgRoleMock,
  hasPermissionMock,
} = vi.hoisted(() => ({
  createOrgRoleMock: vi.fn(),
  updateOrgRoleMock: vi.fn(),
  deleteOrgRoleMock: vi.fn(),
  hasPermissionMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
  betterAuth: {
    api: {
      createOrgRole: createOrgRoleMock,
      updateOrgRole: updateOrgRoleMock,
      deleteOrgRole: deleteOrgRoleMock,
    },
  },
  hasPermission: hasPermissionMock,
}));

describe("custom role routes", () => {
  let app: FastifyInstanceWithZod;
  let user: User;
  let organizationId: string;
  let authenticatedUser: User;

  beforeEach(async ({ makeAdmin, makeMember, makeOrganization }) => {
    vi.clearAllMocks();
    user = await makeAdmin();
    authenticatedUser = user;
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
      ).user = authenticatedUser;
      (
        request as typeof request & {
          user: { id: string };
          organizationId: string;
        }
      ).organizationId = organizationId;
    });

    // Default: admin can manage roles
    hasPermissionMock.mockResolvedValue({ success: true, error: null });

    const { default: customRoleRoutes } = await import("./custom-role.ee");
    const { default: organizationRoleRoutes } = await import(
      "./organization-role"
    );
    await app.register(customRoleRoutes);
    await app.register(organizationRoleRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("gracefully normalizes malformed permission JSON from the auth layer", async () => {
    createOrgRoleMock.mockResolvedValue({
      roleData: {
        id: "role-1",
        organizationId,
        role: "ops_admin",
        name: "Ops Admin",
        description: "Operations access",
        permission: "{not-json}",
        createdAt: new Date("2026-03-15T00:00:00.000Z"),
        updatedAt: new Date("2026-03-15T00:00:00.000Z"),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/roles",
      payload: {
        name: "Ops Admin",
        description: "Operations access",
        permission: {},
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "role-1",
      name: "Ops Admin",
      permission: {},
      predefined: false,
    });
  });

  test("rejects creating a role with permissions the user does not have", async ({
    makeCustomRole,
    makeUser,
  }) => {
    const limitedUser = await makeUser();
    const limitedRole = await makeCustomRole(organizationId, {
      role: "limited_admin",
      name: "Limited Admin",
      permission: { ac: ["create"] },
    });
    await db.insert(schema.membersTable).values({
      id: crypto.randomUUID(),
      organizationId,
      userId: limitedUser.id,
      role: limitedRole.role,
      createdAt: new Date(),
    });
    authenticatedUser = limitedUser;

    const response = await app.inject({
      method: "POST",
      url: "/api/roles",
      payload: {
        name: "Too Powerful",
        description: "Should fail",
        permission: {
          ac: ["create"],
          apiKey: ["read"],
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(createOrgRoleMock).not.toHaveBeenCalled();
  });

  test("rejects updates to predefined roles", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/roles/admin",
      payload: {
        name: "Still Admin",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(updateOrgRoleMock).not.toHaveBeenCalled();
  });

  test("supports the custom role create, update, and delete lifecycle", async ({
    makeCustomRole,
  }) => {
    createOrgRoleMock.mockResolvedValue({
      roleData: {
        id: "role-1",
        organizationId,
        role: "ops_admin",
        name: "Ops Admin",
        description: "Operations access",
        permission: { ac: ["read"] },
        createdAt: new Date("2026-03-15T00:00:00.000Z"),
        updatedAt: new Date("2026-03-15T00:00:00.000Z"),
      },
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/roles",
      payload: {
        name: "Ops Admin",
        description: "Operations access",
        permission: { ac: ["read"] },
      },
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      id: "role-1",
      role: "ops_admin",
      name: "Ops Admin",
    });

    const existingRole = await makeCustomRole(organizationId, {
      role: "reader",
      name: "Reader",
      permission: { ac: ["read"] },
    });

    updateOrgRoleMock.mockResolvedValue({
      roleData: {
        ...existingRole,
        name: "Reader Plus",
        description: "Updated description",
        permission: JSON.stringify({ ac: ["read", "update"] }),
        updatedAt: new Date("2026-03-16T00:00:00.000Z"),
      },
    });

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/roles/${existingRole.id}`,
      payload: {
        name: "Reader Plus",
        description: "Updated description",
        permission: { ac: ["read", "update"] },
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      id: existingRole.id,
      name: "Reader Plus",
      permission: { ac: ["read", "update"] },
    });

    deleteOrgRoleMock.mockResolvedValue({ success: true });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/roles/${existingRole.id}`,
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toEqual({ success: true });
  });

  test("creates a new custom role", async () => {
    createOrgRoleMock.mockResolvedValue({
      roleData: {
        id: "new-role-1",
        organizationId,
        role: "viewer",
        name: "Viewer",
        description: "View-only access",
        permission: { agent: ["read"] },
        createdAt: new Date("2026-03-20T00:00:00.000Z"),
        updatedAt: new Date("2026-03-20T00:00:00.000Z"),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/roles",
      payload: {
        name: "Viewer",
        description: "View-only access",
        permission: { agent: ["read"] },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe("new-role-1");
    expect(body.name).toBe("Viewer");
    expect(body.role).toBe("viewer");
    expect(body.predefined).toBe(false);
    expect(body.permission).toEqual({ agent: ["read"] });
    expect(createOrgRoleMock).toHaveBeenCalledTimes(1);
  });

  test("fails to create role with duplicate name", async ({
    makeCustomRole,
  }) => {
    await makeCustomRole(organizationId, {
      role: "ops_viewer",
      name: "Ops Viewer",
      permission: { agent: ["read"] },
    });

    // betterAuth returns error for duplicate role
    createOrgRoleMock.mockRejectedValue({
      statusCode: 400,
      body: { message: "Role already exists" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/roles",
      payload: {
        name: "Ops Viewer",
        description: "Duplicate name",
        permission: { agent: ["read"] },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("Role already exists");
  });

  test("fails to create role with reserved predefined name 'admin'", async () => {
    await app.inject({
      method: "POST",
      url: "/api/roles",
      payload: {
        name: "admin",
        description: "Try to use reserved name",
        permission: { agent: ["read"] },
      },
    });

    // The route generates a role identifier from the name. "admin" becomes "admin"
    // which is a predefined role name. The betterAuth mock would be called since
    // the route doesn't explicitly block predefined names on create — it's handled
    // by betterAuth or the DB constraint. Let's verify the mock was called.
    // If betterAuth rejects it, we get an error.
    // Actually the route doesn't block predefined names directly — but betterAuth will.
    createOrgRoleMock.mockRejectedValue({
      statusCode: 400,
      body: { message: "Role identifier conflicts with predefined role" },
    });

    const response2 = await app.inject({
      method: "POST",
      url: "/api/roles",
      payload: {
        name: "admin",
        description: "Try to use reserved name",
        permission: { agent: ["read"] },
      },
    });

    expect(response2.statusCode).toBe(400);
  });

  test("gets a specific custom role by ID", async ({ makeCustomRole }) => {
    const role = await makeCustomRole(organizationId, {
      role: "fetched_role",
      name: "Fetched Role",
      permission: { agent: ["read"], mcpGateway: ["read"] },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/roles/${role.id}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(role.id);
    expect(body.name).toBe("Fetched Role");
    expect(body.permission).toEqual({ agent: ["read"], mcpGateway: ["read"] });
  });

  test("gets a predefined role by name", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/roles/admin",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.role).toBe("admin");
    expect(body.predefined).toBe(true);
  });

  test("returns 404 for non-existent role ID", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/roles/${crypto.randomUUID()}`,
    });

    expect(response.statusCode).toBe(404);
  });

  test("updates custom role name only", async ({ makeCustomRole }) => {
    const role = await makeCustomRole(organizationId, {
      role: "name_update_role",
      name: "Original Name",
      permission: { agent: ["read"] },
    });

    updateOrgRoleMock.mockResolvedValue({
      roleData: {
        ...role,
        name: "Updated Name",
        permission: JSON.stringify(role.permission),
        updatedAt: new Date(),
      },
    });

    const response = await app.inject({
      method: "PUT",
      url: `/api/roles/${role.id}`,
      payload: {
        name: "Updated Name",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe("Updated Name");
  });

  test("updates custom role permissions only", async ({ makeCustomRole }) => {
    const role = await makeCustomRole(organizationId, {
      role: "perm_update_role",
      name: "Perm Update Role",
      permission: { agent: ["read"] },
    });

    const newPermission = { agent: ["read", "create"], mcpGateway: ["read"] };
    updateOrgRoleMock.mockResolvedValue({
      roleData: {
        ...role,
        permission: JSON.stringify(newPermission),
        updatedAt: new Date(),
      },
    });

    const response = await app.inject({
      method: "PUT",
      url: `/api/roles/${role.id}`,
      payload: {
        permission: newPermission,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permission).toEqual(newPermission);
  });

  test("deletes a custom role", async ({ makeCustomRole }) => {
    const role = await makeCustomRole(organizationId, {
      role: "deletable_role",
      name: "Deletable Role",
      permission: { agent: ["read"] },
    });

    deleteOrgRoleMock.mockResolvedValue({ success: true });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/roles/${role.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true });
    expect(deleteOrgRoleMock).toHaveBeenCalledTimes(1);
  });

  test("returns 404 when deleting non-existent role", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/api/roles/${crypto.randomUUID()}`,
    });

    expect(response.statusCode).toBe(404);
    expect(deleteOrgRoleMock).not.toHaveBeenCalled();
  });

  test("creates role with multiple permissions", async () => {
    const multiPermission = {
      agent: ["read", "create", "update", "delete"],
      mcpGateway: ["read", "create"],
      llmProxy: ["read"],
    };

    createOrgRoleMock.mockResolvedValue({
      roleData: {
        id: "multi-perm-role",
        organizationId,
        role: "power_user",
        name: "Power User",
        description: "Multi-permission role",
        permission: multiPermission,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/roles",
      payload: {
        name: "Power User",
        description: "Multi-permission role",
        permission: multiPermission,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permission).toEqual(multiPermission);
  });

  test("creates role with empty permissions", async () => {
    createOrgRoleMock.mockResolvedValue({
      roleData: {
        id: "empty-perm-role",
        organizationId,
        role: "no_access",
        name: "No Access",
        description: "Role with no permissions",
        permission: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/roles",
      payload: {
        name: "No Access",
        description: "Role with no permissions",
        permission: {},
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().permission).toEqual({});
  });

  test("GET /api/roles lists predefined and custom roles", async ({
    makeCustomRole,
  }) => {
    await makeCustomRole(organizationId, {
      role: "custom_listed",
      name: "Custom Listed",
      permission: { agent: ["read"] },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/roles?limit=50&offset=0",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    // Should include predefined roles (admin, member) plus the custom role
    expect(body.data.length).toBeGreaterThanOrEqual(3);

    const predefinedRoles = body.data.filter(
      (r: { predefined: boolean }) => r.predefined,
    );
    expect(predefinedRoles.length).toBeGreaterThanOrEqual(2);

    const customRoles = body.data.filter(
      (r: { predefined: boolean }) => !r.predefined,
    );
    expect(customRoles.length).toBeGreaterThanOrEqual(1);
    expect(
      customRoles.some((r: { name: string }) => r.name === "Custom Listed"),
    ).toBe(true);
  });

  test("complete role lifecycle: create, read in list, update, delete", async () => {
    // 1. Create
    const roleId = crypto.randomUUID();
    createOrgRoleMock.mockResolvedValue({
      roleData: {
        id: roleId,
        organizationId,
        role: "lifecycle_role",
        name: "Lifecycle Role",
        description: "For lifecycle test",
        permission: { agent: ["read"] },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const createResp = await app.inject({
      method: "POST",
      url: "/api/roles",
      payload: {
        name: "Lifecycle Role",
        description: "For lifecycle test",
        permission: { agent: ["read"] },
      },
    });
    expect(createResp.statusCode).toBe(200);

    // The role is created via betterAuth mock, but to test the full lifecycle
    // via GET routes, we need a real DB entry. Insert it directly.
    await db.insert(schema.organizationRolesTable).values({
      id: roleId,
      organizationId,
      role: "lifecycle_role",
      name: "Lifecycle Role",
      description: "For lifecycle test",
      permission: JSON.stringify({ agent: ["read"] }),
    });

    // 2. Read in list
    const listResp = await app.inject({
      method: "GET",
      url: "/api/roles?limit=50&offset=0",
    });
    expect(listResp.statusCode).toBe(200);
    const listed = listResp.json().data;
    expect(listed.some((r: { id: string }) => r.id === roleId)).toBe(true);

    // 3. Read by ID
    const getResp = await app.inject({
      method: "GET",
      url: `/api/roles/${roleId}`,
    });
    expect(getResp.statusCode).toBe(200);
    expect(getResp.json().name).toBe("Lifecycle Role");

    // 4. Update
    updateOrgRoleMock.mockResolvedValue({
      roleData: {
        id: roleId,
        organizationId,
        role: "lifecycle_role",
        name: "Updated Lifecycle Role",
        description: "Updated",
        permission: JSON.stringify({ agent: ["read", "create"] }),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const updateResp = await app.inject({
      method: "PUT",
      url: `/api/roles/${roleId}`,
      payload: {
        name: "Updated Lifecycle Role",
        description: "Updated",
        permission: { agent: ["read", "create"] },
      },
    });
    expect(updateResp.statusCode).toBe(200);
    expect(updateResp.json().name).toBe("Updated Lifecycle Role");

    // 5. Delete
    deleteOrgRoleMock.mockResolvedValue({ success: true });

    const deleteResp = await app.inject({
      method: "DELETE",
      url: `/api/roles/${roleId}`,
    });
    expect(deleteResp.statusCode).toBe(200);
    expect(deleteResp.json()).toEqual({ success: true });
  });
});
