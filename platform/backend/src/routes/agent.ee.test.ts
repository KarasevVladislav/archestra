import { vi } from "vitest";
import { metrics } from "@/observability";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

describe("agent type permission routes", () => {
  let app: FastifyInstanceWithZod;
  let adminUser: User;
  let organizationId: string;
  let authenticatedUser: User;

  beforeEach(async ({ makeAdmin, makeMember, makeOrganization }) => {
    vi.clearAllMocks();
    adminUser = await makeAdmin();
    const organization = await makeOrganization();
    organizationId = organization.id;
    await makeMember(adminUser.id, organizationId, { role: "admin" });
    authenticatedUser = adminUser;

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

    // Mock metrics initialization to avoid prom-client registry errors in tests
    vi.spyOn(metrics.llm, "initializeMetrics").mockImplementation(() => {});
    vi.spyOn(metrics.mcp, "initializeMcpMetrics").mockImplementation(() => {});
    vi.spyOn(
      metrics.agentExecution,
      "initializeAgentExecutionMetrics",
    ).mockImplementation(() => {});

    const { default: agentRoutes } = await import("./agent");
    await app.register(agentRoutes);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  test("user with only mcpGateway permissions can list mcp_gateway agents", async ({
    makeUser,
    makeMember,
    makeCustomRole,
    makeAgent,
  }) => {
    const mcpUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "mcp_only",
      name: "MCP Only",
      permission: { mcpGateway: ["read", "create", "admin"] },
    });
    await makeMember(mcpUser.id, organizationId, { role: "mcp_only" });
    authenticatedUser = mcpUser;

    await makeAgent({
      organizationId,
      name: "Gateway Agent",
      agentType: "mcp_gateway",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=mcp_gateway",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("user with only mcpGateway permissions is forbidden from listing agent type", async ({
    makeUser,
    makeMember,
    makeCustomRole,
  }) => {
    const mcpUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "mcp_only_2",
      name: "MCP Only 2",
      permission: { mcpGateway: ["read", "create"] },
    });
    await makeMember(mcpUser.id, organizationId, { role: "mcp_only_2" });
    authenticatedUser = mcpUser;

    const response = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=agent",
    });
    expect(response.statusCode).toBe(403);
  });

  test("user with only mcpGateway permissions is forbidden from listing llmProxy type", async ({
    makeUser,
    makeMember,
    makeCustomRole,
  }) => {
    const mcpUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "mcp_only_3",
      name: "MCP Only 3",
      permission: { mcpGateway: ["read", "create"] },
    });
    await makeMember(mcpUser.id, organizationId, { role: "mcp_only_3" });
    authenticatedUser = mcpUser;

    const response = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=llm_proxy",
    });
    expect(response.statusCode).toBe(403);
  });

  test("user with only llmProxy permissions can list llm_proxy agents", async ({
    makeUser,
    makeMember,
    makeCustomRole,
    makeAgent,
  }) => {
    const llmUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "llm_only",
      name: "LLM Only",
      permission: { llmProxy: ["read", "create", "admin"] },
    });
    await makeMember(llmUser.id, organizationId, { role: "llm_only" });
    authenticatedUser = llmUser;

    await makeAgent({
      organizationId,
      name: "LLM Agent",
      agentType: "llm_proxy",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=llm_proxy",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("user with only llmProxy permissions is forbidden from agent and mcpGateway", async ({
    makeUser,
    makeMember,
    makeCustomRole,
  }) => {
    const llmUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "llm_only_2",
      name: "LLM Only 2",
      permission: { llmProxy: ["read", "create"] },
    });
    await makeMember(llmUser.id, organizationId, { role: "llm_only_2" });
    authenticatedUser = llmUser;

    const agentResp = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=agent",
    });
    expect(agentResp.statusCode).toBe(403);

    const mcpResp = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=mcp_gateway",
    });
    expect(mcpResp.statusCode).toBe(403);
  });

  test("user with only agent permissions can list agent type", async ({
    makeUser,
    makeMember,
    makeCustomRole,
    makeAgent,
  }) => {
    const agentUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "agent_only",
      name: "Agent Only",
      permission: { agent: ["read"] },
    });
    await makeMember(agentUser.id, organizationId, { role: "agent_only" });
    authenticatedUser = agentUser;

    await makeAgent({
      organizationId,
      name: "Internal Agent",
      agentType: "agent",
      scope: "org",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=agent",
    });
    expect(response.statusCode).toBe(200);
  });

  test("user with only agent permissions is forbidden from mcpGateway and llmProxy", async ({
    makeUser,
    makeMember,
    makeCustomRole,
  }) => {
    const agentUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "agent_only_2",
      name: "Agent Only 2",
      permission: { agent: ["read"] },
    });
    await makeMember(agentUser.id, organizationId, { role: "agent_only_2" });
    authenticatedUser = agentUser;

    const mcpResp = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=mcp_gateway",
    });
    expect(mcpResp.statusCode).toBe(403);

    const llmResp = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=llm_proxy",
    });
    expect(llmResp.statusCode).toBe(403);
  });

  test("user with mixed permissions can access allowed types only", async ({
    makeUser,
    makeMember,
    makeCustomRole,
    makeAgent,
  }) => {
    const mixedUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "mixed_perms",
      name: "Mixed Perms",
      permission: {
        agent: ["read"],
        llmProxy: ["read", "create", "admin"],
      },
    });
    await makeMember(mixedUser.id, organizationId, { role: "mixed_perms" });
    authenticatedUser = mixedUser;

    await makeAgent({
      organizationId,
      name: "Agent Visible",
      agentType: "agent",
      scope: "org",
    });
    await makeAgent({
      organizationId,
      name: "LLM Visible",
      agentType: "llm_proxy",
    });

    // Can list agent type
    const agentResp = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=agent",
    });
    expect(agentResp.statusCode).toBe(200);

    // Can list llm_proxy type
    const llmResp = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=llm_proxy",
    });
    expect(llmResp.statusCode).toBe(200);

    // Cannot list mcp_gateway type
    const mcpResp = await app.inject({
      method: "GET",
      url: "/api/agents?limit=10&offset=0&agentType=mcp_gateway",
    });
    expect(mcpResp.statusCode).toBe(403);
  });

  test("mcpGateway user cannot access llmProxy agent by ID", async ({
    makeUser,
    makeMember,
    makeCustomRole,
    makeAgent,
  }) => {
    const mcpUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "mcp_reader",
      name: "MCP Reader",
      permission: { mcpGateway: ["read", "admin"] },
    });
    await makeMember(mcpUser.id, organizationId, { role: "mcp_reader" });

    const llmAgent = await makeAgent({
      organizationId,
      name: "LLM Proxy Agent",
      agentType: "llm_proxy",
    });

    authenticatedUser = mcpUser;

    const response = await app.inject({
      method: "GET",
      url: `/api/agents/${llmAgent.id}`,
    });
    // Returns 404 to avoid leaking existence
    expect(response.statusCode).toBe(404);
  });

  test("mcpGateway user cannot update llmProxy agent", async ({
    makeUser,
    makeMember,
    makeCustomRole,
    makeAgent,
  }) => {
    const mcpUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "mcp_updater",
      name: "MCP Updater",
      permission: { mcpGateway: ["read", "update", "admin"] },
    });
    await makeMember(mcpUser.id, organizationId, { role: "mcp_updater" });

    const llmAgent = await makeAgent({
      organizationId,
      name: "LLM Agent to Update",
      agentType: "llm_proxy",
    });

    authenticatedUser = mcpUser;

    const response = await app.inject({
      method: "PUT",
      url: `/api/agents/${llmAgent.id}`,
      payload: { name: "Hacked" },
    });
    expect(response.statusCode).toBe(404);
  });

  test("mcpGateway user cannot delete llmProxy agent", async ({
    makeUser,
    makeMember,
    makeCustomRole,
    makeAgent,
  }) => {
    const mcpUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "mcp_deleter",
      name: "MCP Deleter",
      permission: { mcpGateway: ["read", "delete", "admin"] },
    });
    await makeMember(mcpUser.id, organizationId, { role: "mcp_deleter" });

    const llmAgent = await makeAgent({
      organizationId,
      name: "LLM Agent to Delete",
      agentType: "llm_proxy",
    });

    authenticatedUser = mcpUser;

    const response = await app.inject({
      method: "DELETE",
      url: `/api/agents/${llmAgent.id}`,
    });
    expect(response.statusCode).toBe(404);
  });

  test("admin can create shared agents with teams for all types", async ({
    makeTeam,
    makeTeamMember,
  }) => {
    const team = await makeTeam(organizationId, adminUser.id, {
      name: "Admin Team",
    });
    await makeTeamMember(team.id, adminUser.id);

    for (const agentType of ["mcp_gateway", "llm_proxy", "agent"] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: {
          name: `Shared ${agentType} Agent`,
          agentType,
          scope: "team",
          teams: [team.id],
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().scope).toBe("team");
    }
  });

  test("user with team-admin can create team-scoped agents", async ({
    makeUser,
    makeMember,
    makeCustomRole,
    makeTeam,
    makeTeamMember,
  }) => {
    const teamUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "team_admin_mcp",
      name: "Team Admin MCP",
      permission: { mcpGateway: ["read", "create", "team-admin"] },
    });
    await makeMember(teamUser.id, organizationId, {
      role: "team_admin_mcp",
    });
    const team = await makeTeam(organizationId, adminUser.id, {
      name: "User Team",
    });
    await makeTeamMember(team.id, teamUser.id);

    authenticatedUser = teamUser;

    const response = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "Team MCP Gateway",
        agentType: "mcp_gateway",
        scope: "team",
        teams: [team.id],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().scope).toBe("team");
  });

  test("non-admin user cannot create org-scoped agents", async ({
    makeUser,
    makeMember,
    makeCustomRole,
  }) => {
    const normalUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "mcp_creator",
      name: "MCP Creator",
      permission: { mcpGateway: ["read", "create"] },
    });
    await makeMember(normalUser.id, organizationId, { role: "mcp_creator" });
    authenticatedUser = normalUser;

    const response = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "Org Scoped Agent",
        agentType: "mcp_gateway",
        scope: "org",
        teams: [],
      },
    });
    expect(response.statusCode).toBe(403);
  });

  test("non-admin user can create personal agents", async ({
    makeUser,
    makeMember,
    makeCustomRole,
  }) => {
    const normalUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "mcp_personal",
      name: "MCP Personal",
      permission: { mcpGateway: ["read", "create"] },
    });
    await makeMember(normalUser.id, organizationId, {
      role: "mcp_personal",
    });
    authenticatedUser = normalUser;

    const response = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "Personal Agent",
        agentType: "mcp_gateway",
        scope: "personal",
        teams: [],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().scope).toBe("personal");
  });

  test("user without agent admin cannot see built-in agents in unfiltered list", async ({
    makeUser,
    makeMember,
    makeCustomRole,
    makeAgent,
  }) => {
    const BUILT_IN_AGENT_IDS = await import("@shared").then(
      (m) => m.BUILT_IN_AGENT_IDS,
    );

    const normalUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "agent_reader_only",
      name: "Agent Reader Only",
      permission: { agent: ["read"] },
    });
    await makeMember(normalUser.id, organizationId, {
      role: "agent_reader_only",
    });

    // Create a built-in agent and a regular org-scoped agent
    await makeAgent({
      organizationId,
      name: "Built-in Dual LLM",
      agentType: "agent",
      scope: "org",
      builtInAgentConfig: { name: BUILT_IN_AGENT_IDS.DUAL_LLM_QUARANTINE },
    });
    await makeAgent({
      organizationId,
      name: "Regular Agent",
      agentType: "agent",
      scope: "org",
    });

    authenticatedUser = normalUser;

    // Non-admin user listing agents — built-in agents are only visible to admin
    const response = await app.inject({
      method: "GET",
      url: "/api/agents/all?agentType=agent",
    });
    expect(response.statusCode).toBe(200);
    const agents = response.json();
    // Non-admin should not see built-in agents (they have scope filtering applied)
    const builtInAgents = agents.filter(
      (a: { builtInAgentConfig?: unknown }) => a.builtInAgentConfig != null,
    );
    expect(builtInAgents).toHaveLength(0);
  });

  test("admin user can see built-in agents", async ({ makeAgent }) => {
    const BUILT_IN_AGENT_IDS = await import("@shared").then(
      (m) => m.BUILT_IN_AGENT_IDS,
    );

    await makeAgent({
      organizationId,
      name: "Built-in Agent",
      agentType: "agent",
      builtInAgentConfig: { name: BUILT_IN_AGENT_IDS.DUAL_LLM_QUARANTINE },
    });

    // Admin user
    authenticatedUser = adminUser;

    const response = await app.inject({
      method: "GET",
      url: "/api/agents/all?agentType=agent",
    });
    expect(response.statusCode).toBe(200);
    const agents = response.json();
    const builtInAgents = agents.filter(
      (a: { builtInAgentConfig?: unknown }) => a.builtInAgentConfig != null,
    );
    expect(builtInAgents.length).toBeGreaterThanOrEqual(1);
  });

  test("user with create but no create on another type is rejected", async ({
    makeUser,
    makeMember,
    makeCustomRole,
  }) => {
    const restrictedUser = await makeUser();
    await makeCustomRole(organizationId, {
      role: "llm_creator_only",
      name: "LLM Creator Only",
      permission: { llmProxy: ["read", "create", "admin"] },
    });
    await makeMember(restrictedUser.id, organizationId, {
      role: "llm_creator_only",
    });
    authenticatedUser = restrictedUser;

    // Try to create an mcp_gateway agent — should fail
    const response = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "Should Fail MCP",
        agentType: "mcp_gateway",
        scope: "personal",
        teams: [],
      },
    });
    expect(response.statusCode).toBe(403);
  });
});
