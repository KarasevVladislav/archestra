import { vi } from "vitest";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

describe("user permissions routes", () => {
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

    const { default: userRoutes } = await import("./user");
    await app.register(userRoutes);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  test("GET /api/user/permissions returns admin permissions", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/user/permissions",
    });

    expect(response.statusCode).toBe(200);
    const permissions = response.json();

    // Admin should have permissions for key resources
    expect(permissions).toHaveProperty("organization");
    expect(permissions).toHaveProperty("agent");
    expect(permissions).toHaveProperty("toolPolicy");
    expect(permissions).toHaveProperty("member");
    expect(permissions).toHaveProperty("invitation");
    expect(permissions).toHaveProperty("ac");
    expect(permissions).toHaveProperty("team");
  });

  test("GET /api/user/permissions returns member permissions", async ({
    makeUser,
    makeMember,
  }) => {
    const memberUser = await makeUser({ name: "Member User" });
    await makeMember(memberUser.id, organizationId, { role: "member" });

    // Override the request hook for member user
    const memberApp = createFastifyInstance();
    memberApp.addHook("onRequest", async (request) => {
      (request as typeof request & { user: unknown }).user = memberUser;
      (request as typeof request & { organizationId: string }).organizationId =
        organizationId;
    });

    const { default: userRoutes } = await import("./user");
    await memberApp.register(userRoutes);

    const response = await memberApp.inject({
      method: "GET",
      url: "/api/user/permissions",
    });

    expect(response.statusCode).toBe(200);
    const permissions = response.json();

    // Member should have at least read permissions on some resources
    expect(permissions).toHaveProperty("agent");
    // Member should have read on agents
    expect(permissions.agent).toContain("read");

    await memberApp.close();
  });

  test("GET /api/user/permissions returns 404 for user without membership", async ({
    makeUser,
  }) => {
    const orphanUser = await makeUser({ name: "Orphan User" });

    const orphanApp = createFastifyInstance();
    orphanApp.addHook("onRequest", async (request) => {
      (request as typeof request & { user: unknown }).user = orphanUser;
      (request as typeof request & { organizationId: string }).organizationId =
        organizationId;
    });

    const { default: userRoutes } = await import("./user");
    await orphanApp.register(userRoutes);

    const response = await orphanApp.inject({
      method: "GET",
      url: "/api/user/permissions",
    });

    expect(response.statusCode).toBe(404);

    await orphanApp.close();
  });
});
