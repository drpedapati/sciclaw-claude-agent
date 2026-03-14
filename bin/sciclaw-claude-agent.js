#!/usr/bin/env node

import { readFileSync } from "node:fs";
import process from "node:process";

import { runBridge } from "../src/bridge.js";

function resolveVersion() {
  if (process.env.npm_package_version) {
    return process.env.npm_package_version;
  }
  if (process.env.SCICLAW_CLAUDE_AGENT_VERSION) {
    return process.env.SCICLAW_CLAUDE_AGENT_VERSION;
  }
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const pkg = JSON.parse(raw);
    if (typeof pkg.version === "string" && pkg.version.trim()) {
      return pkg.version.trim();
    }
  } catch {}
  return "0.1.0";
}

function printHelp() {
  process.stdout.write(`Usage: sciclaw-claude-agent < request.json

Reads a sciClaw Claude bridge request from stdin and writes a single JSON response to stdout.

Request fields:
  messages              Array of sciClaw chat messages (required)
  tools                 Array of sciClaw tool definitions
  model                 Claude model ID (supports anthropic/... and dotted aliases)
  workspace             Workspace path for Claude Code cwd
  oauth_token           Optional Claude.ai oat token
  max_turns             Optional max turns (defaults to 4; minimum 2)
  persist_session       Optional boolean
  thinking              Optional thinking config
  effort                Optional effort string
  config_dir            Optional Claude config dir (defaults to ~/.picoclaw/claude-agent)
`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    process.stdout.write(`${resolveVersion()}\n`);
    return;
  }

  let raw = "";
  try {
    raw = await new Promise((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", reject);
    });
  } catch (error) {
    process.stdout.write(JSON.stringify({ is_error: true, error: `failed to read stdin: ${String(error)}` }) + "\n");
    process.exitCode = 1;
    return;
  }

  let request;
  try {
    request = JSON.parse(raw);
  } catch (error) {
    process.stdout.write(JSON.stringify({ is_error: true, error: `invalid JSON request: ${String(error)}` }) + "\n");
    process.exitCode = 1;
    return;
  }

  try {
    const response = await runBridge(request);
    process.stdout.write(JSON.stringify(response) + "\n");
  } catch (error) {
    process.stdout.write(JSON.stringify({ is_error: true, error: error instanceof Error ? error.message : String(error) }) + "\n");
    process.exitCode = 1;
  }
}

await main();
