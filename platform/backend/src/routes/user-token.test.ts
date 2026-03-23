import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

describe("user token routes", () => {
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

    const { default: userTokenRoutes } = await import("./user-token");
    await app.register(userTokenRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("GET /api/user-tokens/me creates and returns a token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/user-tokens/me",
    });

    expect(response.statusCode).toBe(200);
    const token = response.json();
    expect(token.id).toBeDefined();
    expect(token.name).toBeDefined();
    expect(token.tokenStart).toBeDefined();
    expect(token.createdAt).toBeDefined();
  });

  test("repeated calls to GET /api/user-tokens/me return the same token", async () => {
    const response1 = await app.inject({
      method: "GET",
      url: "/api/user-tokens/me",
    });
    const response2 = await app.inject({
      method: "GET",
      url: "/api/user-tokens/me",
    });

    expect(response1.statusCode).toBe(200);
    expect(response2.statusCode).toBe(200);
    expect(response1.json().id).toBe(response2.json().id);
    expect(response1.json().tokenStart).toBe(response2.json().tokenStart);
  });

  test("GET /api/user-tokens/me/value returns the full token value", async () => {
    // First ensure the token exists
    await app.inject({
      method: "GET",
      url: "/api/user-tokens/me",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/user-tokens/me/value",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.value).toBeDefined();
    expect(typeof body.value).toBe("string");
    expect(body.value.length).toBeGreaterThan(0);
  });

  test("tokenStart matches the beginning of the full value", async () => {
    // Create token
    const meResponse = await app.inject({
      method: "GET",
      url: "/api/user-tokens/me",
    });
    const { tokenStart } = meResponse.json();

    // Get full value
    const valueResponse = await app.inject({
      method: "GET",
      url: "/api/user-tokens/me/value",
    });
    const { value } = valueResponse.json();

    expect(value.startsWith(tokenStart)).toBe(true);
  });

  test("POST /api/user-tokens/me/rotate rotates and returns a new value", async () => {
    // First ensure the token exists
    await app.inject({
      method: "GET",
      url: "/api/user-tokens/me",
    });

    // Get the original value
    const originalValueResponse = await app.inject({
      method: "GET",
      url: "/api/user-tokens/me/value",
    });
    const originalValue = originalValueResponse.json().value;

    // Rotate
    const rotateResponse = await app.inject({
      method: "POST",
      url: "/api/user-tokens/me/rotate",
    });

    expect(rotateResponse.statusCode).toBe(200);
    const rotated = rotateResponse.json();
    expect(rotated.value).toBeDefined();
    expect(rotated.value).not.toBe(originalValue);
    expect(rotated.id).toBeDefined();
    expect(rotated.tokenStart).toBeDefined();

    // Verify new value starts with new tokenStart
    expect(rotated.value.startsWith(rotated.tokenStart)).toBe(true);
  });

  test("GET /api/user-tokens/me/value returns 404 when no token exists yet", async () => {
    // Don't create the token first - just try to get the value
    const response = await app.inject({
      method: "GET",
      url: "/api/user-tokens/me/value",
    });

    expect(response.statusCode).toBe(404);
  });

  test("POST /api/user-tokens/me/rotate returns 404 when no token exists yet", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/user-tokens/me/rotate",
    });

    expect(response.statusCode).toBe(404);
  });
});
