#!/usr/bin/env node
// Generates .github/assets/demo.cast (asciicast v2) by simulating a typed terminal session
// using REAL captured loadam output. No actual recording — deterministic, reproducible,
// regenerates whenever the CLI output changes.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = resolve(ROOT, "packages/cli/dist/bin.js");
const SPEC = resolve(ROOT, "fixtures/specs/petstore.openapi.yaml");

// Pull real output from the CLI so the demo never lies.
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const stripAnsi = (s) => s.replace(ANSI, "");
const helpOut = stripAnsi(
  execSync(`node ${CLI} --help`, {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  }),
);
const mcpOut = stripAnsi(
  execSync(`node ${CLI} mcp ${SPEC} -o /tmp/_loadam_demo_mcp`, {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  }),
);

// Asciicast v2 builder.
const events = [];
let t = 0;
const PROMPT = "\x1b[32m$\x1b[0m ";
const push = (delay, data) => {
  t += delay;
  events.push([Number(t.toFixed(3)), "o", data]);
};
const typeLine = (cmd) => {
  push(0.4, PROMPT);
  for (const ch of cmd) push(0.04, ch);
  push(0.3, "\r\n");
};
const block = (text) => {
  push(0.15, `${text.replace(/\n/g, "\r\n")}\r\n`);
};

// Banner-style intro.
push(0.0, "\x1b[36m");
push(
  0.0,
  [
    "   _                 _",
    "  | | ___   __ _  __| | __ _ _ __ ___",
    "  | |/ _ \\ / _` |/ _` |/ _` | '_ ` _ \\",
    "  | | (_) | (_| | (_| | (_| | | | | | |",
    "  |_|\\___/ \\__,_|\\__,_|\\__,_|_| |_| |_|",
    "\x1b[0m\x1b[2m  spec → tests · contract · drift · MCP server\x1b[0m",
    "",
  ].join("\r\n"),
);

typeLine("loadam mcp ./openapi.yaml");
block(mcpOut.trimEnd());

typeLine("cd loadam-out/mcp && npm install --silent && node bin.js --http &");
block("[loadam] mcp http listening on :3333");

typeLine("loadam --help");
block(helpOut.trimEnd());

push(2.0, PROMPT);

const header = {
  version: 2,
  width: 100,
  height: 30,
  timestamp: Math.floor(Date.now() / 1000),
  env: { SHELL: "/bin/zsh", TERM: "xterm-256color" },
  title: "loadam in 30 seconds",
};

const out = [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))].join("\n");
mkdirSync(resolve(ROOT, ".github/assets"), { recursive: true });
writeFileSync(resolve(ROOT, ".github/assets/demo.cast"), `${out}\n`);
console.log(`wrote .github/assets/demo.cast (${events.length} events, ~${t.toFixed(1)}s)`);
