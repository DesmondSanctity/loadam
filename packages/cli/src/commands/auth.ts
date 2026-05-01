import { readFile } from "node:fs/promises";
import { importCurl } from "@loadam/auth";
import type { Command } from "commander";
import { consola } from "consola";
import { withFriendlyErrors } from "../util/errors.js";

interface AuthImportOptions {
  file?: string;
  json: boolean;
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Auth helpers");

  auth
    .command("import")
    .description(
      "Parse a curl command and infer an auth profile. Reads from --file, then stdin, then args.",
    )
    .option("-f, --file <path>", "read curl command from a file")
    .option("--json", "emit JSON instead of pretty output", false)
    .argument("[curl...]", "inline curl command")
    .action(withFriendlyErrors(runAuthImport));
}

async function runAuthImport(curlArgs: string[], opts: AuthImportOptions): Promise<void> {
  const input = await loadCurlInput(curlArgs, opts);
  if (!input.trim()) {
    consola.error("No curl command provided. Pass via --file, stdin, or as arguments.");
    process.exit(2);
  }

  const result = importCurl(input);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.profile) {
    consola.success(`Detected auth profile: ${result.profile.kind} (id: ${result.profile.id})`);
    consola.log(JSON.stringify(result.profile, null, 2));
  } else {
    consola.warn("No recognizable auth profile found in this curl.");
  }
  if (result.notes.length > 0) {
    consola.info("Notes:");
    for (const n of result.notes) consola.log(`  · ${n}`);
  }
  if (result.url) consola.info(`URL: ${result.url}`);
}

async function loadCurlInput(curlArgs: string[], opts: AuthImportOptions): Promise<string> {
  if (opts.file) {
    return await readFile(opts.file, "utf8");
  }
  if (curlArgs.length > 0) {
    return curlArgs.join(" ");
  }
  if (!process.stdin.isTTY) {
    return await readStdin();
  }
  return "";
}

function readStdin(): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", rejectPromise);
  });
}
