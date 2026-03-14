import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIG_DIR,
  buildPrompt,
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

test("buildPrompt includes tool section and transcript", () => {
  const prompt = buildPrompt(
    [
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

  assert.match(prompt, /Available sciClaw tools/);
  assert.match(prompt, /get_magic_number/);
  assert.match(prompt, /"role": "system"/);
  assert.match(prompt, /"tool_calls"/);
  assert.match(prompt, /"tool_name": "get_magic_number"/);
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
  assert.equal(response.is_error, false);
  assert.equal(response.content, "OK");
  assert.deepEqual(response.tool_calls, []);
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
