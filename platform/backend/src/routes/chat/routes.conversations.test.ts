import { vi } from "vitest";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

// Mock auth to always grant admin permissions (simplifies conversation creation)
vi.mock("@/auth", async () => {
  const actual = await vi.importActual<typeof import("@/auth")>("@/auth");
  return {
    ...actual,
    hasAnyAgentTypeAdminPermission: vi.fn().mockResolvedValue(true),
  };
});

describe("chat conversation routes", () => {
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

    const { default: chatRoutes } = await import("./routes.chat");
    await app.register(chatRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("creates a conversation with agentId and selectedModel", async ({
    makeAgent,
  }) => {
    const agent = await makeAgent({ organizationId });

    const response = await app.inject({
      method: "POST",
      url: "/api/chat/conversations",
      payload: {
        agentId: agent.id,
        selectedModel: "gpt-4o",
        selectedProvider: "openai",
      },
    });

    expect(response.statusCode).toBe(200);
    const conversation = response.json();
    expect(conversation.agentId).toBe(agent.id);
    expect(conversation.selectedModel).toBe("gpt-4o");
    expect(conversation.selectedProvider).toBe("openai");
    expect(conversation.id).toBeDefined();
  });

  test("pins a conversation with PATCH pinnedAt timestamp", async ({
    makeAgent,
  }) => {
    const agent = await makeAgent({ organizationId });

    // Create conversation
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/chat/conversations",
      payload: {
        agentId: agent.id,
        selectedModel: "gpt-4o",
        selectedProvider: "openai",
      },
    });
    const conversation = createResponse.json();

    // Pin the conversation
    const pinnedAt = new Date().toISOString();
    const pinResponse = await app.inject({
      method: "PATCH",
      url: `/api/chat/conversations/${conversation.id}`,
      payload: { pinnedAt },
    });

    expect(pinResponse.statusCode).toBe(200);
    const pinned = pinResponse.json();
    expect(pinned.pinnedAt).toBeDefined();
    expect(pinned.pinnedAt).not.toBeNull();
  });

  test("pinned status persists when fetching conversation", async ({
    makeAgent,
  }) => {
    const agent = await makeAgent({ organizationId });

    // Create conversation
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/chat/conversations",
      payload: {
        agentId: agent.id,
        selectedModel: "gpt-4o",
        selectedProvider: "openai",
      },
    });
    const conversation = createResponse.json();

    // Pin it
    const pinnedAt = new Date().toISOString();
    await app.inject({
      method: "PATCH",
      url: `/api/chat/conversations/${conversation.id}`,
      payload: { pinnedAt },
    });

    // Fetch and verify pinned status persists
    const getResponse = await app.inject({
      method: "GET",
      url: `/api/chat/conversations/${conversation.id}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const fetched = getResponse.json();
    expect(fetched.pinnedAt).not.toBeNull();
  });

  test("unpins a conversation with PATCH pinnedAt: null", async ({
    makeAgent,
  }) => {
    const agent = await makeAgent({ organizationId });

    // Create conversation
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/chat/conversations",
      payload: {
        agentId: agent.id,
        selectedModel: "gpt-4o",
        selectedProvider: "openai",
      },
    });
    const conversation = createResponse.json();

    // Pin it
    await app.inject({
      method: "PATCH",
      url: `/api/chat/conversations/${conversation.id}`,
      payload: { pinnedAt: new Date().toISOString() },
    });

    // Unpin it
    const unpinResponse = await app.inject({
      method: "PATCH",
      url: `/api/chat/conversations/${conversation.id}`,
      payload: { pinnedAt: null },
    });

    expect(unpinResponse.statusCode).toBe(200);
    const unpinned = unpinResponse.json();
    expect(unpinned.pinnedAt).toBeNull();
  });

  test("returns 404 for non-existent conversation", async () => {
    const nonExistentId = crypto.randomUUID();
    const response = await app.inject({
      method: "GET",
      url: `/api/chat/conversations/${nonExistentId}`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.message).toContain("not found");
  });

  test("lists conversations for the current user", async ({ makeAgent }) => {
    const agent = await makeAgent({ organizationId });

    // Create two conversations
    await app.inject({
      method: "POST",
      url: "/api/chat/conversations",
      payload: {
        agentId: agent.id,
        selectedModel: "gpt-4o",
        selectedProvider: "openai",
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/chat/conversations",
      payload: {
        agentId: agent.id,
        selectedModel: "gpt-4o",
        selectedProvider: "openai",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/chat/conversations",
    });

    expect(response.statusCode).toBe(200);
    const conversations = response.json();
    expect(conversations.length).toBeGreaterThanOrEqual(2);
  });

  test("deletes a conversation", async ({ makeAgent }) => {
    const agent = await makeAgent({ organizationId });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/chat/conversations",
      payload: {
        agentId: agent.id,
        selectedModel: "gpt-4o",
        selectedProvider: "openai",
      },
    });
    const conversation = createResponse.json();

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/chat/conversations/${conversation.id}`,
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({ success: true });

    // Verify deleted
    const getResponse = await app.inject({
      method: "GET",
      url: `/api/chat/conversations/${conversation.id}`,
    });
    expect(getResponse.statusCode).toBe(404);
  });
});
