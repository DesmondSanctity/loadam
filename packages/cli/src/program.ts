import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { registerCleanCommand } from "./commands/clean.js";
import { registerCompletionCommand } from "./commands/completion.js";
import { registerContractCommand } from "./commands/contract.js";
import { registerDiffCommand } from "./commands/diff.js";
import { registerHistoryCommand } from "./commands/history.js";
import { registerInitCommand } from "./commands/init.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerReportCommand } from "./commands/report.js";
import { registerShowCommand } from "./commands/show.js";
import { registerTestCommand } from "./commands/test.js";
import { registerUpdateCommand } from "./commands/update.js";
import { banner } from "./util/banner.js";

declare const __LOADAM_VERSION__: string;
const VERSION = typeof __LOADAM_VERSION__ === "string" ? __LOADAM_VERSION__ : "0.0.0";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("loadam")
    .description(
      "Generate test rigs and MCP servers from any API spec. From spec to running rig in 60s.",
    )
    .version(VERSION, "-v, --version", "print version")
    .addHelpText("beforeAll", banner());

  registerInitCommand(program);
  registerAuthCommands(program);
  registerTestCommand(program);
  registerContractCommand(program);
  registerDiffCommand(program);
  registerMcpCommand(program);
  registerHistoryCommand(program);
  registerShowCommand(program);
  registerReportCommand(program);
  registerCleanCommand(program);
  registerCompletionCommand(program);
  registerUpdateCommand(program, VERSION);

  return program;
}
