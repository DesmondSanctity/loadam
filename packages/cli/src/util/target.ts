/**
 * Apply `LOADAM_TARGET` as a fallback when `--target` was not passed on the
 * CLI. Lets users export the target once per shell session (or in `.envrc`)
 * instead of repeating it on every invocation.
 *
 * Precedence: CLI flag > LOADAM_TARGET env var > whatever the caller defaults to.
 */
export function resolveTarget(flag: string | undefined): string | undefined {
  if (typeof flag === "string" && flag.length > 0) return flag;
  const env = process.env.LOADAM_TARGET;
  if (typeof env === "string" && env.length > 0) return env;
  return undefined;
}
