import type { Command } from "commander";
import { compareVersions, fetchLatestVersion } from "../util/update.js";

export function registerUpdateCommand(program: Command, currentVersion: string): void {
  program
    .command("update")
    .description("Check whether a newer version of @loadam/cli is on npm")
    .option("--json", "emit machine-readable output")
    .action(async (opts: { json?: boolean }) => {
      const latest = await fetchLatestVersion();
      if (!latest) {
        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify({ ok: false, current: currentVersion, latest: null, reason: "registry-unreachable" })}\n`,
          );
        } else {
          process.stderr.write("Could not reach the npm registry. Skipping update check.\n");
        }
        return;
      }
      const cmp = compareVersions(currentVersion, latest);
      const upToDate = cmp >= 0;
      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify({ ok: true, current: currentVersion, latest, upToDate })}\n`,
        );
        return;
      }
      if (upToDate) {
        process.stdout.write(`loadam ${currentVersion} is up to date (latest: ${latest}).\n`);
      } else {
        process.stdout.write(
          `A new version of loadam is available: ${currentVersion} → ${latest}\nRun: npm i -g @loadam/cli\n`,
        );
      }
    });
}
