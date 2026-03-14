import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIG_DIR,
  buildPrompt,
  buildSystemPrompt,
  extractAssistantFallback,
  extractSystemMessages,
  hasMeaningfulStructuredOutput,
  normalizeClaudeModel,
  normalizeStructuredOutput,
  normalizeWorkspace,
  runBridge,
} from "../src/bridge.js";

test("normalizeClaudeModel strips provider prefix and dots", () => {
  assert.equal(normalizeClaudeModel("anthropic/claude-sonnet-4.6"), "claude-sonnet-4-6");
  assert.equal(normalizeClaudeModel("claude-opus-4.6"), "claude-opus-4-6");
  assert.equal(normalizeClaudeModel("claude-code"), undefined);
});

test("normalizeWorkspace expands home", () => {
  const value = normalizeWorkspace("~/tmp-claude-agent-test");
  assert.match(value, /tmp-claude-agent-test$/);
  assert.ok(value.startsWith("/"));
});

test("extractSystemMessages returns only non-empty system content", () => {
  const system = extractSystemMessages([
    { role: "system", content: "Be precise." },
    { role: "user", content: "Ignore me." },
    { role: "system", content: " " },
    { role: "system", content: "Use tools when needed." },
  ]);

  assert.deepEqual(system, ["Be precise.", "Use tools when needed."]);
});

test("buildSystemPrompt carries system instructions and tool section", () => {
  const systemPrompt = buildSystemPrompt(
    [
      { role: "system", content: "Be precise." },
      { role: "user", content: "What is the magic number?" },
    ],
    [
      {
        type: "function",
        function: {
          name: "get_magic_number",
          description: "Return the magic number.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
    ],
  );

  assert.match(systemPrompt, /Caller system instructions/);
  assert.match(systemPrompt, /Be precise\./);
  assert.match(systemPrompt, /Available sciClaw tools/);
  assert.match(systemPrompt, /get_magic_number/);
});

test("buildPrompt excludes system messages and preserves transcript", () => {
  const prompt = buildPrompt([
      { role: "system", content: "Be precise." },
      { role: "user", content: "What is the magic number?" },
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_magic_number", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", tool_name: "get_magic_number", content: "42" },
    ]);

  assert.match(prompt, /"tool_calls"/);
  assert.match(prompt, /"tool_name": "get_magic_number"/);
  assert.doesNotMatch(prompt, /"role": "system"/);
});

test("normalizeStructuredOutput parses tool arguments JSON", () => {
  const out = normalizeStructuredOutput({
    content: "",
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "lookup", arguments: "{\"query\":\"abc\"}" },
      },
    ],
  });

  assert.equal(out.tool_calls[0].name, "lookup");
  assert.deepEqual(out.tool_calls[0].arguments, { query: "abc" });
});

test("extractAssistantFallback reads assistant text and StructuredOutput tool payload", () => {
  const fallback = extractAssistantFallback({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "First line." },
        {
          type: "tool_use",
          name: "StructuredOutput",
          input: {
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: "{\"query\":\"abc\"}" },
              },
            ],
          },
        },
        { type: "text", text: "Second line." },
      ],
    },
  });

  assert.equal(fallback.content, "First line.\n\nSecond line.");
  assert.equal(hasMeaningfulStructuredOutput(fallback.structured_output), true);
  assert.equal(fallback.structured_output.tool_calls[0].name, "lookup");
});

test("runBridge injects Claude Code oauth token env and returns structured output", async () => {
  let seenRequest;
  const response = await runBridge(
    {
      oauth_token: "sk-ant-oat-test",
      model: "anthropic/claude-sonnet-4.6",
      workspace: "~/workspace",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    },
    {
      query({ prompt, options }) {
        seenRequest = { prompt, options };
        return (async function* () {
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "OK",
            structured_output: { content: "OK", tool_calls: [] },
            session_id: "sess_1",
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          };
        })();
      },
    },
  );

  assert.equal(seenRequest.options.model, "claude-sonnet-4-6");
  assert.equal(seenRequest.options.env.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat-test");
  assert.equal(seenRequest.options.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(seenRequest.options.env.CLAUDE_CONFIG_DIR, DEFAULT_CONFIG_DIR);
  assert.equal(seenRequest.options.persistSession, false);
  assert.equal(seenRequest.options.systemPrompt.includes("You are the sciClaw Claude bridge."), true);
  assert.equal(response.is_error, false);
  assert.equal(response.content, "OK");
  assert.deepEqual(response.tool_calls, []);
});

test("runBridge passes explicit thinking, effort, additional directories, and session persistence", async () => {
  let seenRequest;
  await runBridge(
    {
      oauth_token: "sk-ant-oat-test",
      model: "anthropic/claude-sonnet-4.6",
      workspace: "~/workspace",
      messages: [{ role: "system", content: "Be exact." }, { role: "user", content: "Hello" }],
      tools: [],
      persist_session: true,
      effort: "high",
      thinking: { type: "enabled", budgetTokens: 2048 },
      additional_directories: ["~/extra-a", "~/extra-b"],
    },
    {
      query({ prompt, options }) {
        seenRequest = { prompt, options };
        return (async function* () {
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "OK",
            structured_output: { content: "OK", tool_calls: [] },
            session_id: "sess_3",
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          };
        })();
      },
    },
  );

  assert.equal(seenRequest.options.persistSession, true);
  assert.equal(seenRequest.options.effort, "high");
  assert.deepEqual(seenRequest.options.thinking, { type: "enabled", budgetTokens: 2048 });
  assert.equal(seenRequest.options.additionalDirectories.length, 2);
  assert.match(seenRequest.options.systemPrompt, /Be exact\./);
  assert.doesNotMatch(seenRequest.prompt, /"role": "system"/);
});

test("runBridge preserves result when SDK emits error result then throws", async () => {
  const response = await runBridge(
    {
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    },
    {
      query() {
        return (async function* () {
          yield {
            type: "result",
            subtype: "success",
            is_error: true,
            result: "Failed to authenticate.",
            session_id: "sess_2",
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          };
          throw new Error("Claude Code returned an error result: Failed to authenticate.");
        })();
      },
    },
  );

  assert.equal(response.is_error, true);
  assert.match(response.error, /Failed to authenticate/);
});

test("runBridge falls back to last assistant text when final result is empty", async () => {
  const response = await runBridge(
    {
      oauth_token: "sk-ant-oat-test",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    },
    {
      query() {
        return (async function* () {
          yield {
            type: "assistant",
            message: {
              content: [{ type: "text", text: "Recovered assistant text" }],
            },
          };
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "",
            structured_output: { content: "", tool_calls: [] },
            session_id: "sess_fallback_text",
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          };
        })();
      },
    },
  );

  assert.equal(response.is_error, false);
  assert.equal(response.content, "Recovered assistant text");
  assert.deepEqual(response.tool_calls, []);
});

test("runBridge falls back to last StructuredOutput tool payload when final result is empty", async () => {
  const response = await runBridge(
    {
      oauth_token: "sk-ant-oat-test",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    },
    {
      query() {
        return (async function* () {
          yield {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  name: "StructuredOutput",
                  input: {
                    content: "",
                    tool_calls: [
                      {
                        id: "call_1",
                        type: "function",
                        function: { name: "lookup", arguments: "{\"query\":\"abc\"}" },
                      },
                    ],
                  },
                },
              ],
            },
          };
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            result: "",
            structured_output: { content: "", tool_calls: [] },
            session_id: "sess_fallback_tool",
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          };
        })();
      },
    },
  );

  assert.equal(response.is_error, false);
  assert.equal(response.content, "");
  assert.equal(response.tool_calls.length, 1);
  assert.equal(response.tool_calls[0].name, "lookup");
});
