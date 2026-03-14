# sciclaw-claude-agent

`sciclaw-claude-agent` is a small stdin/stdout bridge around `@anthropic-ai/claude-agent-sdk`.

It is intended for the narrow sciClaw use case where a user supplies a Claude.ai oat token and sciClaw needs a Claude Code / Agent SDK execution path instead of the direct Anthropic API path.

## Current scope

- one request per process
- JSON request on stdin
- JSON response on stdout
- structured `content` or `tool_calls` output for sciClaw's existing tool loop
- Claude.ai path forced with `settings.forceLoginMethod = "claudeai"`
- built-in Claude Code tools disabled for now; the bridge returns tool calls back to sciClaw instead

## Authentication

The bridge supports an `oauth_token` request field. When present, it is passed to the Claude runtime through `CLAUDE_CODE_OAUTH_TOKEN`.

The bridge keeps its own Claude config directory under `~/.picoclaw/claude-agent` by default so this path does not depend on, or overwrite, the user's normal `~/.claude` state.

## Request shape

```json
{
  "oauth_token": "sk-ant-oat...",
  "model": "anthropic/claude-sonnet-4.6",
  "workspace": "/absolute/path",
  "messages": [
    { "role": "user", "content": "Reply with exactly OK" }
  ],
  "tools": []
}
```

## Local experimentation boundary

Anthropic staff clarified on February 18, 2026 that they want to encourage local development and experimentation with the Agent SDK and `claude -p`, while businesses built on top of the Agent SDK should use API keys instead.

This repo follows that boundary:

- local experimentation path: Claude.ai/oat token through the Agent SDK
- business / product path: regular Anthropic API keys should stay on the direct API route

There is still practical enforcement risk around OAuth-heavy usage in third-party tools. This bridge is intentionally narrow and should not be treated as the general commercial Anthropic integration path for sciClaw.
