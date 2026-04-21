import { describe, expect, test } from "vitest";
import {
  getChatMessagesSyncSignature,
  getServerMessagesToApplyToChat,
  type IChatMessageForSync,
} from "./chat-message-sync";

function msg(id: string): IChatMessageForSync {
  return { id };
}

describe("getServerMessagesToApplyToChat", () => {
  test("returns null while streaming", () => {
    expect(
      getServerMessagesToApplyToChat({
        status: "streaming",
        clientMessages: [msg("a")],
        serverMessages: [msg("a"), msg("b")],
      }),
    ).toBeNull();
  });

  test("hydrates empty client from server", () => {
    const server = [msg("1"), msg("2")];
    expect(
      getServerMessagesToApplyToChat({
        status: "ready",
        clientMessages: [],
        serverMessages: server,
      }),
    ).toEqual(server);
  });

  test("returns server when strict append by id", () => {
    const client = [msg("u1"), msg("a1")];
    const server = [...client, msg("u2"), msg("a2")];
    expect(
      getServerMessagesToApplyToChat({
        status: "ready",
        clientMessages: client,
        serverMessages: server,
      }),
    ).toEqual(server);
  });

  test("returns null on id mismatch at prefix", () => {
    expect(
      getServerMessagesToApplyToChat({
        status: "ready",
        clientMessages: [msg("a")],
        serverMessages: [msg("b"), msg("c")],
      }),
    ).toBeNull();
  });

  test("hard resync on prefix mismatch when enabled and server is longer", () => {
    const server = [msg("b"), msg("c"), msg("d")];
    expect(
      getServerMessagesToApplyToChat({
        status: "ready",
        clientMessages: [msg("a")],
        serverMessages: server,
        allowHardResyncOnReadyPrefixMismatch: true,
      }),
    ).toEqual(server);
  });

  test("does not hard resync when server is not longer", () => {
    expect(
      getServerMessagesToApplyToChat({
        status: "ready",
        clientMessages: [msg("a")],
        serverMessages: [msg("b")],
        allowHardResyncOnReadyPrefixMismatch: true,
      }),
    ).toBeNull();
  });

  test("returns null when server not longer", () => {
    const m = [msg("a")];
    expect(
      getServerMessagesToApplyToChat({
        status: "ready",
        clientMessages: m,
        serverMessages: m,
      }),
    ).toBeNull();
  });
});

describe("getChatMessagesSyncSignature", () => {
  test("joins ids", () => {
    expect(getChatMessagesSyncSignature([msg("a"), msg("b")])).toBe("a\u0001b");
  });
});
