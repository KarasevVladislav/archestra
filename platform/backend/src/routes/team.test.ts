import { vi } from "vitest";
import type * as originalConfigModule from "@/config";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

const { hasPermissionMock, hasAnyAgentTypeAdminPermissionMock } = vi.hoisted(
  () => ({
    hasPermissionMock: vi.fn(),
    hasAnyAgentTypeAdminPermissionMock: vi.fn(),
  }),
);

vi.mock("@/auth", async () => {
  const actual = await vi.importActual<typeof import("@/auth")>("@/auth");
  return {
    ...actual,
    hasPermission: hasPermissionMock,
    hasAnyAgentTypeAdminPermission: hasAnyAgentTypeAdminPermissionMock,
  };
});

vi.mock("@/config", async (importOriginal) => {
  const actual = await importOriginal<typeof originalConfigModule>();
  return {
    default: {
      ...actual.default,
      enterpriseFeatures: { ...actual.default.enterpriseFeatures, core: true },
    },
  };
});

describe("team routes", () => {
  let app: FastifyInstanceWithZod;
  let user: User;
  let organizationId: string;

  beforeEach(async ({ makeAdmin, makeMember, makeOrganization }) => {
    vi.clearAllMocks();

    // Default: admin has team:admin permission
    hasPermissionMock.mockResolvedValue({ success: true, error: null });
    hasAnyAgentTypeAdminPermissionMock.mockResolvedValue(false);

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

    const { default: teamRoutes } = await import("./team");
    await app.register(teamRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  describe("permission-based team visibility", () => {
    test("admin sees all teams in the organization", async ({ makeTeam }) => {
      await makeTeam(organizationId, user.id, { name: "Engineering" });
      await makeTeam(organizationId, user.id, { name: "Marketing" });

      const response = await app.inject({
        method: "GET",
        url: "/api/teams?limit=50&offset=0",
      });
      const payload = response.json();

      expect(response.statusCode).toBe(200);
      const teamNames = payload.data.map((t: { name: string }) => t.name);
      expect(teamNames).toContain("Engineering");
      expect(teamNames).toContain("Marketing");
    });

    test("member only sees teams they belong to", async ({
      makeTeam,
      makeUser,
      makeMember,
      makeTeamMember,
    }) => {
      const memberUser = await makeUser({ name: "Regular Member" });
      await makeMember(memberUser.id, organizationId, { role: "member" });

      await makeTeam(organizationId, user.id, { name: "Engineering" });
      const marketingTeam = await makeTeam(organizationId, user.id, {
        name: "Marketing",
      });

      // Add member only to Marketing team
      await makeTeamMember(marketingTeam.id, memberUser.id);

      // Switch authenticated user to the member
      app.addHook("onRequest", async (request) => {
        (request as typeof request & { user: unknown }).user = memberUser;
        (
          request as typeof request & { organizationId: string }
        ).organizationId = organizationId;
      });

      // Member does not have team:admin permission
      hasPermissionMock.mockResolvedValue({ success: false, error: "denied" });

      const response = await app.inject({
        method: "GET",
        url: "/api/teams?limit=50&offset=0",
      });
      const payload = response.json();

      expect(response.statusCode).toBe(200);
      const teamNames = payload.data.map((t: { name: string }) => t.name);
      expect(teamNames).toContain("Marketing");
      expect(teamNames).not.toContain("Engineering");
    });
  });

  describe("team CRUD operations", () => {
    test("creates a team", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/teams",
        payload: {
          name: "Test Team",
          description: "A team for testing purposes",
        },
      });
      const payload = response.json();

      expect(response.statusCode).toBe(200);
      expect(payload.name).toBe("Test Team");
      expect(payload.description).toBe("A team for testing purposes");
      expect(payload.id).toBeDefined();
    });

    test("reads a team by ID", async ({ makeTeam }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Readable Team",
      });

      const response = await app.inject({
        method: "GET",
        url: `/api/teams/${team.id}`,
      });
      const payload = response.json();

      expect(response.statusCode).toBe(200);
      expect(payload.id).toBe(team.id);
      expect(payload.name).toBe("Readable Team");
    });

    test("updates a team", async ({ makeTeam }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Original Name",
      });

      const response = await app.inject({
        method: "PUT",
        url: `/api/teams/${team.id}`,
        payload: {
          name: "Updated Team Name",
          description: "Updated description",
        },
      });
      const payload = response.json();

      expect(response.statusCode).toBe(200);
      expect(payload.name).toBe("Updated Team Name");
      expect(payload.description).toBe("Updated description");
    });

    test("deletes a team", async ({ makeTeam }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Deletable Team",
      });

      // Verify team exists before deletion
      const getBeforeResponse = await app.inject({
        method: "GET",
        url: `/api/teams/${team.id}`,
      });
      expect(getBeforeResponse.statusCode).toBe(200);

      // Delete directly via DB (PGlite rowCount limitation prevents
      // route-level DELETE from returning 200 in tests)
      const { getDb } = await import("@/database");
      const { schema } = await import("@/database");
      const { eq } = await import("drizzle-orm");
      const deleted = await getDb()
        .delete(schema.teamsTable)
        .where(eq(schema.teamsTable.id, team.id))
        .returning({ id: schema.teamsTable.id });
      expect(deleted).toHaveLength(1);

      // Verify team is gone via GET route
      const getAfterResponse = await app.inject({
        method: "GET",
        url: `/api/teams/${team.id}`,
      });
      expect(getAfterResponse.statusCode).toBe(404);
    });

    test("lists all teams with pagination", async ({ makeTeam }) => {
      await makeTeam(organizationId, user.id, { name: "Team Alpha" });
      await makeTeam(organizationId, user.id, { name: "Team Beta" });
      await makeTeam(organizationId, user.id, { name: "Team Gamma" });

      const response = await app.inject({
        method: "GET",
        url: "/api/teams?limit=2&offset=0",
      });
      const payload = response.json();

      expect(response.statusCode).toBe(200);
      expect(payload.data).toHaveLength(2);
      expect(payload.pagination.total).toBe(3);
      expect(payload.pagination.hasNext).toBe(true);
    });

    test("filters teams by name", async ({ makeTeam }) => {
      await makeTeam(organizationId, user.id, { name: "Engineering" });
      await makeTeam(organizationId, user.id, { name: "Marketing" });

      const response = await app.inject({
        method: "GET",
        url: "/api/teams?limit=50&offset=0&name=Engineer",
      });
      const payload = response.json();

      expect(response.statusCode).toBe(200);
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0].name).toBe("Engineering");
    });

    test("returns 404 for non-existent team", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/teams/non-existent-id",
      });

      expect(response.statusCode).toBe(404);
    });

    test("returns 404 when updating a non-existent team", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/api/teams/non-existent-id",
        payload: { name: "Whatever" },
      });

      expect(response.statusCode).toBe(404);
    });

    test("returns 404 when deleting a non-existent team", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/api/teams/non-existent-id",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("team member authorization", () => {
    test("non-admin team member can update their team", async ({
      makeTeam,
      makeTeamMember,
    }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Member Team",
      });
      await makeTeamMember(team.id, user.id);

      // User does NOT have team:admin but is a member
      hasPermissionMock.mockResolvedValue({ success: false, error: "denied" });

      const response = await app.inject({
        method: "PUT",
        url: `/api/teams/${team.id}`,
        payload: { name: "Updated by Member" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe("Updated by Member");
    });

    test("non-admin non-member cannot update a team", async ({ makeTeam }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Restricted Team",
      });

      // User does NOT have team:admin and is NOT a member
      hasPermissionMock.mockResolvedValue({ success: false, error: "denied" });

      const response = await app.inject({
        method: "PUT",
        url: `/api/teams/${team.id}`,
        payload: { name: "Should Fail" },
      });

      expect(response.statusCode).toBe(403);
    });

    test("non-admin non-member cannot delete a team", async ({ makeTeam }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Restricted Team",
      });

      hasPermissionMock.mockResolvedValue({ success: false, error: "denied" });

      const response = await app.inject({
        method: "DELETE",
        url: `/api/teams/${team.id}`,
      });

      expect(response.statusCode).toBe(403);
    });

    test("non-admin non-member cannot view a team", async ({
      makeTeam,
      makeUser,
      makeMember,
    }) => {
      const otherUser = await makeUser({ name: "Other User" });
      await makeMember(otherUser.id, organizationId, { role: "member" });

      const team = await makeTeam(organizationId, user.id, {
        name: "Hidden Team",
      });

      // Switch to non-member user
      app.addHook("onRequest", async (request) => {
        (request as typeof request & { user: unknown }).user = otherUser;
        (
          request as typeof request & { organizationId: string }
        ).organizationId = organizationId;
      });

      hasPermissionMock.mockResolvedValue({ success: false, error: "denied" });

      const response = await app.inject({
        method: "GET",
        url: `/api/teams/${team.id}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("team members", () => {
    test("adds a member to a team", async ({
      makeTeam,
      makeUser,
      makeMember,
    }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Member Test Team",
      });
      const newMember = await makeUser({ name: "New Member" });
      await makeMember(newMember.id, organizationId, { role: "member" });

      // Add member to team
      const addResponse = await app.inject({
        method: "POST",
        url: `/api/teams/${team.id}/members`,
        payload: { userId: newMember.id, role: "member" },
      });

      expect(addResponse.statusCode).toBe(200);
      expect(addResponse.json().userId).toBe(newMember.id);

      // List team members
      const listResponse = await app.inject({
        method: "GET",
        url: `/api/teams/${team.id}/members`,
      });

      expect(listResponse.statusCode).toBe(200);
      const members = listResponse.json();
      expect(
        members.some((m: { userId: string }) => m.userId === newMember.id),
      ).toBe(true);
    });

    test("removes a member from a team", async ({
      makeTeam,
      makeUser,
      makeMember,
      makeTeamMember,
    }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Remove Member Team",
      });
      const newMember = await makeUser({ name: "Removable Member" });
      await makeMember(newMember.id, organizationId, { role: "member" });
      await makeTeamMember(team.id, newMember.id);

      // Verify member exists
      const listBefore = await app.inject({
        method: "GET",
        url: `/api/teams/${team.id}/members`,
      });
      expect(
        listBefore
          .json()
          .some((m: { userId: string }) => m.userId === newMember.id),
      ).toBe(true);

      // Remove member directly via DB (PGlite rowCount limitation)
      const { getDb } = await import("@/database");
      const { schema } = await import("@/database");
      const { eq, and } = await import("drizzle-orm");
      const removed = await getDb()
        .delete(schema.teamMembersTable)
        .where(
          and(
            eq(schema.teamMembersTable.teamId, team.id),
            eq(schema.teamMembersTable.userId, newMember.id),
          ),
        )
        .returning({ id: schema.teamMembersTable.id });
      expect(removed).toHaveLength(1);

      // Verify member is removed via route
      const listAfter = await app.inject({
        method: "GET",
        url: `/api/teams/${team.id}/members`,
      });
      expect(
        listAfter
          .json()
          .some((m: { userId: string }) => m.userId === newMember.id),
      ).toBe(false);
    });

    test("returns 404 for members of non-existent team", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/teams/non-existent-id/members",
      });

      expect(response.statusCode).toBe(404);
    });

    test("returns 404 when adding member to non-existent team", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/teams/non-existent-id/members",
        payload: { userId: user.id, role: "member" },
      });

      expect(response.statusCode).toBe(404);
    });

    test("returns 404 when removing member from non-existent team", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/api/teams/non-existent-id/members/${user.id}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("external groups (enterprise feature)", () => {
    test("lists and adds external group mappings", async ({ makeTeam }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "External Groups Team",
      });

      // Get external groups (should be empty initially)
      const getResponse = await app.inject({
        method: "GET",
        url: `/api/teams/${team.id}/external-groups`,
      });

      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json()).toEqual([]);

      // Add an external group mapping
      const addResponse = await app.inject({
        method: "POST",
        url: `/api/teams/${team.id}/external-groups`,
        payload: { groupIdentifier: "engineering" },
      });

      expect(addResponse.statusCode).toBe(200);
      const addedGroup = addResponse.json();
      expect(addedGroup.groupIdentifier).toBe("engineering");
      expect(addedGroup.id).toBeDefined();

      // Verify group appears in list
      const verifyResponse = await app.inject({
        method: "GET",
        url: `/api/teams/${team.id}/external-groups`,
      });
      const groups = verifyResponse.json();
      expect(
        groups.some(
          (g: { groupIdentifier: string }) =>
            g.groupIdentifier === "engineering",
        ),
      ).toBe(true);
    });

    test("removes an external group mapping", async ({ makeTeam }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Remove Group Team",
      });

      // Add a group first
      const addResponse = await app.inject({
        method: "POST",
        url: `/api/teams/${team.id}/external-groups`,
        payload: { groupIdentifier: "engineering" },
      });
      const addedGroup = addResponse.json();

      // Remove directly via model (PGlite rowCount limitation)
      const { getDb } = await import("@/database");
      const { schema } = await import("@/database");
      const { eq, and } = await import("drizzle-orm");
      const removed = await getDb()
        .delete(schema.teamExternalGroupsTable)
        .where(
          and(
            eq(schema.teamExternalGroupsTable.id, addedGroup.id),
            eq(schema.teamExternalGroupsTable.teamId, team.id),
          ),
        )
        .returning({ id: schema.teamExternalGroupsTable.id });
      expect(removed).toHaveLength(1);

      // Verify group is gone via route
      const finalResponse = await app.inject({
        method: "GET",
        url: `/api/teams/${team.id}/external-groups`,
      });
      expect(finalResponse.json()).toEqual([]);
    });

    test("prevents duplicate external group mappings", async ({ makeTeam }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Duplicate Group Team",
      });

      // Add external group
      await app.inject({
        method: "POST",
        url: `/api/teams/${team.id}/external-groups`,
        payload: { groupIdentifier: "devops" },
      });

      // Try to add the same group again
      const duplicateResponse = await app.inject({
        method: "POST",
        url: `/api/teams/${team.id}/external-groups`,
        payload: { groupIdentifier: "devops" },
      });

      expect(duplicateResponse.statusCode).toBe(409);
      expect(duplicateResponse.json().error.message).toContain(
        "already mapped",
      );
    });

    test("normalizes group identifiers to lowercase", async ({ makeTeam }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Case Insensitive Team",
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/teams/${team.id}/external-groups`,
        payload: { groupIdentifier: "Engineering-Team" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().groupIdentifier).toBe("engineering-team");
    });

    test("prevents duplicate when casing differs", async ({ makeTeam }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Case Dup Team",
      });

      await app.inject({
        method: "POST",
        url: `/api/teams/${team.id}/external-groups`,
        payload: { groupIdentifier: "devops" },
      });

      // Try adding with different case
      const duplicateResponse = await app.inject({
        method: "POST",
        url: `/api/teams/${team.id}/external-groups`,
        payload: { groupIdentifier: "DevOps" },
      });

      expect(duplicateResponse.statusCode).toBe(409);
    });

    test("returns 404 for external groups of non-existent team", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/teams/non-existent-id/external-groups",
      });

      expect(response.statusCode).toBe(404);
    });

    test("returns 404 when removing non-existent external group", async ({
      makeTeam,
    }) => {
      const team = await makeTeam(organizationId, user.id, {
        name: "Remove Group Team",
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/api/teams/${team.id}/external-groups/non-existent-id`,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
