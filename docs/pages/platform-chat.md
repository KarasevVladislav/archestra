---
title: Chat
category: Agents
order: 2
description: Built-in Chat interface with LLM API key configuration and MCP Apps support
lastUpdated: 2026-03-11
---

<!--
Check ../docs_writer_prompt.md before changing this file.

-->

Archestra includes a built-in Chat interface that allows users to interact with AI agents using MCP tools. To use Chat, you need to configure LLM provider API keys.

![Agent Platform Swarm](/docs/platform-chat.png)

### API Keys
Chat will use LLM API Keys configured in Settings -> LLM API Keys. When a chat request is made, the system determines which API key to use in this order:

1. **Profile-specific key** - If the profile has an API key assigned for the provider, use it
2. **Organization default** - Fall back to the organization's default key for that provider
3. **Environment variable** - Final fallback to `ARCHESTRA_CHAT_<PROVIDER>_API_KEY`

### Supported Providers

See [Supported LLM Providers](/docs/platform-supported-llm-providers) for the full list.

## MCP Apps

MCP servers can expose interactive UI panels alongside tool results. When a tool's definition includes a UI resource URI, Chat renders the app inline below the tool call instead of showing raw JSON output.

MCP Apps run inside a double-sandboxed iframe: an outer proxy iframe on a separate origin enforces CSP, and an inner iframe renders the untrusted HTML. The two iframes communicate with the host page via the AppBridge protocol.

**Display modes** — Apps start inline and can request fullscreen via the AppBridge protocol. Press Escape or the close button to return to inline.

**Tool calls from apps** — An MCP App can invoke tools on its own MCP server directly from the UI. These calls are proxied through `/api/mcp/{agentId}` and appear in the chat history like any other tool call.

**Permissions** — Camera, microphone, geolocation, and clipboard-write access are opt-in. The MCP server must declare them in the resource `_meta.ui.permissions` field; the user's browser will prompt for consent as normal.

**After upgrading** — Existing MCP servers installed before the MCP Apps update will not display apps until their tools are re-synced. Go to the MCP Catalog and reinstall each MCP server that provides UI resources. This populates the tool metadata needed for app rendering.

## Security Notes

- API keys are stored encrypted using the configured [secrets manager](/docs/platform-secrets-management)
- Keys are never exposed in the UI after creation
- Profile assignments allow separation of billing/usage across teams
