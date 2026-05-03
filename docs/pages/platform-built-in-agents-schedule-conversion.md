---
title: Schedule Conversion Agent
category: Agents
subcategory: Built-In Agents
order: 8
description: Built-in agent that summarizes chats into standalone prompts for recurring scheduled tasks
---

<!--
Check ../docs_writer_prompt.md before changing this file.
-->

When you save a [Scheduled Task](/docs/platform-agent-triggers-schedule) from chat or via the Archestra MCP tool `convert_conversation_to_scheduled_task`, Archestra can compress the transcript into a single recurring prompt using an LLM. That summarization uses the **Schedule Conversion** built-in agent: its **system prompt** and **LLM API key / model** apply to this step only (not to the agent that runs the schedule).

## Configuration

Open **Agents**, filter **Built-in**, and edit **Schedule Conversion Subagent**. You can reset the system prompt to the platform default, choose a dedicated LLM API key and model, or leave those unset to fall back to the organization’s smart default LLM selection.

## User-Facing Flow

End users still click **Schedule** in chat or rely on the MCP tool as before. Changing this built-in agent does not alter RBAC or the schedule form — only how the default prompt text is produced when AI summary is enabled.
