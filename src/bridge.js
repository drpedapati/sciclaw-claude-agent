import os from "node:os";
import path from "node:path";
import process from "node:process";

import { query } from "@anthropic-ai/claude-agent-sdk";

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), ".picoclaw", "claude-agent");
export const DEFAULT_MAX_TURNS = 4;

export function expandHome(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "~") {
    return os.homedir();
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function normalizeWorkspace(workspace) {
  const expanded = expandHome(workspace);
  if (!expanded) {
    return process.cwd();
  }
  return path.resolve(expanded);
}

export function normalizeClaudeModel(model) {
  if (typeof model !== "string") {
    return undefined;
  }
  let normalized = model.trim();
  if (!normalized || normalized === "claude-code") {
    return undefined;
  }
  if (normalized.startsWith("anthropic/")) {
    normalized = normalized.slice("anthropic/".length);
  }
  return normalized.replaceAll(".", "-");
}

export function normalizeThinking(thinking) {
  if (!thinking) {
    return { type: "disabled" };
  }
  if (typeof thinking === "string") {
    if (thinking === "adaptive") {
      return { type: "adaptive" };
    }
    if (thinking === "enabled") {
      return { type: "enabled" };
    }
    return { type: "disabled" };
  }
  if (typeof thinking === "object" && typeof thinking.type === "string") {
    if (thinking.type === "adaptive") {
      return { type: "adaptive" };
    }
    if (thinking.type === "enabled") {
      const out = { type: "enabled" };
      if (Number.isFinite(thinking.budgetTokens)) {
        out.budgetTokens = thinking.budgetTokens;
      }
      return out;
    }
  }
  return { type: "disabled" };
}

export function extractSystemMessages(messages = []) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .filter((message) => message && message.role === "system" && typeof message.content === "string" && message.content.trim())
    .map((message) => message.content.trim());
}

export function buildToolSection(tools = []) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return [
      "No external sciClaw tools are available for this turn.",
      "Set tool_calls to [] and answer directly in content.",
    ].join("\n");
  }

  const lines = [
    "Available sciClaw tools for this turn:",
    "If you need a tool, leave content as an empty string and populate tool_calls.",
    "Each tool call must use type=function and function.arguments must be a JSON-encoded string.",
    "",
  ];

  for (const tool of tools) {
    if (!tool || tool.type !== "function" || !tool.function) {
      continue;
    }
    lines.push(`- ${tool.function.name}`);
    if (tool.function.description) {
      lines.push(`  Description: ${tool.function.description}`);
    }
    if (tool.function.parameters) {
      lines.push(`  Parameters JSON: ${JSON.stringify(tool.function.parameters)}`);
    }
  }

  return lines.join("\n");
}

function serializeToolCall(call) {
  const id = typeof call?.id === "string" && call.id.trim() ? call.id.trim() : "call_generated";
  const type = typeof call?.type === "string" && call.type.trim() ? call.type.trim() : "function";
  let name = "";
  let argsString = "{}";
  if (call?.function && typeof call.function.name === "string") {
    name = call.function.name;
  } else if (typeof call?.name === "string") {
    name = call.name;
  }
  if (call?.function && typeof call.function.arguments === "string" && call.function.arguments.trim()) {
    argsString = call.function.arguments;
  } else if (call && typeof call.arguments === "object" && call.arguments !== null) {
    argsString = JSON.stringify(call.arguments);
  }
  return {
    id,
    type,
    function: {
      name,
      arguments: argsString,
    },
  };
}

export function normalizeMessages(messages = []) {
  return messages
    .filter((message) => message && typeof message.role === "string" && message.role !== "system")
    .map((message) => {
      const out = {
        role: message.role,
      };
      if (typeof message.content === "string" && message.content !== "") {
        out.content = message.content;
      }
      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        out.tool_calls = message.tool_calls.map(serializeToolCall);
      }
      if (typeof message.tool_call_id === "string" && message.tool_call_id) {
        out.tool_call_id = message.tool_call_id;
      }
      if (typeof message.tool_name === "string" && message.tool_name) {
        out.tool_name = message.tool_name;
      }
      return out;
    });
}

export function buildSystemPrompt(messages = [], tools = []) {
  const lines = [
    "You are the sciClaw Claude bridge.",
    "Read the conversation transcript and fill the structured output schema attached to this request.",
    "Rules:",
    "- If you can answer directly, set content to the assistant reply and tool_calls to [].",
    "- If you need one or more tools, set content to an empty string and populate tool_calls.",
    "- The caller will execute any tool_calls you request and return the results as later role=tool messages.",
    "- If a listed tool can answer the request, request it. Do not claim that tools are unavailable.",
    "- Never invent a tool that is not listed below.",
    "- Never wrap JSON in markdown fences.",
    "- If the transcript contains role=tool messages, those are authoritative tool results. Use them directly.",
    "",
  ];

  const callerSystem = extractSystemMessages(messages);
  if (callerSystem.length > 0) {
    lines.push("Caller system instructions:");
    for (const message of callerSystem) {
      lines.push(message);
    }
    lines.push("");
  }

  lines.push(buildToolSection(tools));
  return lines.join("\n");
}

export function buildPrompt(messages = []) {
  const normalizedMessages = normalizeMessages(messages);
  return [
    "Conversation transcript as JSON:",
    JSON.stringify(normalizedMessages, null, 2),
  ].join("\n");
}

export function createOutputFormat() {
  return {
    type: "json_schema",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: { type: "string" },
        tool_calls: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              type: { type: "string", enum: ["function"] },
              function: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  arguments: { type: "string" },
                },
                required: ["name", "arguments"],
              },
            },
            required: ["id", "type", "function"],
          },
        },
      },
      required: ["content", "tool_calls"],
    },
  };
}

export function normalizeStructuredOutput(structuredOutput) {
  const out = structuredOutput && typeof structuredOutput === "object" ? structuredOutput : {};
  const content = typeof out.content === "string" ? out.content : "";
  const toolCalls = Array.isArray(out.tool_calls) ? out.tool_calls : [];

  return {
    content,
    tool_calls: toolCalls.map((call, index) => {
      const id = typeof call?.id === "string" && call.id.trim() ? call.id.trim() : `call_${index + 1}`;
      const type = "function";
      const name = typeof call?.function?.name === "string" ? call.function.name : "";
      const argumentsText =
        typeof call?.function?.arguments === "string" && call.function.arguments.trim()
          ? call.function.arguments
          : "{}";

      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(argumentsText);
      } catch {
        parsedArgs = { raw: argumentsText };
      }

      return {
        id,
        type,
        name,
        arguments: parsedArgs,
        function: {
          name,
          arguments: argumentsText,
        },
      };
    }),
  };
}

export function usageFromResult(result) {
  const usage = result?.usage ?? {};
  return {
    input_tokens: Number(usage.input_tokens ?? 0),
    output_tokens: Number(usage.output_tokens ?? 0),
    cache_creation_input_tokens: Number(usage.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: Number(usage.cache_read_input_tokens ?? 0),
  };
}

function buildBridgeEnv(request = {}) {
  const env = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: `sciclaw-claude-agent/${process.env.npm_package_version ?? "0.1.0"}`,
    CLAUDE_CONFIG_DIR: path.resolve(expandHome(request.config_dir || DEFAULT_CONFIG_DIR)),
  };

  const oauthToken = typeof request.oauth_token === "string" ? request.oauth_token.trim() : "";
  if (oauthToken) {
    env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }

  return env;
}

function buildOptions(request = {}) {
  const options = {
    cwd: normalizeWorkspace(request.workspace),
    env: buildBridgeEnv(request),
    tools: [],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: Math.max(Number(request.max_turns ?? DEFAULT_MAX_TURNS), 2),
    outputFormat: createOutputFormat(),
    persistSession: request.persist_session === true,
    systemPrompt: buildSystemPrompt(request.messages, request.tools ?? []),
    settings: {
      forceLoginMethod: "claudeai",
    },
    thinking: normalizeThinking(request.thinking),
  };

  const model = normalizeClaudeModel(request.model);
  if (model) {
    options.model = model;
  }
  if (typeof request.effort === "string" && request.effort) {
    options.effort = request.effort;
  }
  if (Array.isArray(request.additional_directories) && request.additional_directories.length > 0) {
    options.additionalDirectories = request.additional_directories
      .map((dir) => normalizeWorkspace(dir))
      .filter(Boolean);
  }

  return options;
}

function buildErrorResponse(message, extra = {}) {
  return {
    is_error: true,
    error: message,
    content: "",
    tool_calls: [],
    finish_reason: "error",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    ...extra,
  };
}

export async function runBridge(request, deps = {}) {
  if (!request || typeof request !== "object") {
    return buildErrorResponse("request must be a JSON object");
  }
  if (!Array.isArray(request.messages)) {
    return buildErrorResponse("messages must be an array");
  }

  const doQuery = deps.query ?? query;
  const prompt = buildPrompt(request.messages, request.tools ?? []);
  const options = buildOptions(request);

  let finalResult = null;
  try {
    const stream = doQuery({ prompt, options });
    for await (const message of stream) {
      if (message?.type === "result") {
        finalResult = message;
      }
    }
  } catch (error) {
    if (!finalResult) {
      return buildErrorResponse(error instanceof Error ? error.message : String(error));
    }
  }

  if (!finalResult) {
    return buildErrorResponse("Claude bridge did not receive a result message");
  }

  const structured = normalizeStructuredOutput(finalResult.structured_output);
  const finishReason = structured.tool_calls.length > 0 ? "tool_calls" : "stop";
  const isError = finalResult.is_error === true;
  const errorText = isError ? String(finalResult.result || (finalResult.errors || []).join("; ")) : "";

  return {
    type: "result",
    subtype: finalResult.subtype ?? "success",
    is_error: isError,
    error: errorText,
    result: typeof finalResult.result === "string" ? finalResult.result : "",
    content: structured.content || (isError ? "" : String(finalResult.result || "")),
    tool_calls: structured.tool_calls,
    finish_reason: finishReason,
    session_id: finalResult.session_id ?? "",
    usage: usageFromResult(finalResult),
  };
}
