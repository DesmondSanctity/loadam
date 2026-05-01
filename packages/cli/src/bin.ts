import { buildProgram } from "./program.js";

async function main(): Promise<void> {
  const program = buildProgram();
  // No subcommand → show banner + help (commander would print help-only).
  if (process.argv.length <= 2) {
    program.outputHelp();
    return;
  }
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  // commander already prints user-friendly errors for known issues;
  // this catches everything else and exits non-zero.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
