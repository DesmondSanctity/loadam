// ASCII banner shown on `loadam` (no args) and `loadam --help`.
// Skipped in --json mode and for subcommand help to keep output clean.

const ART = String.raw`
   _                 _
  | | ___   __ _  __| | __ _ _ __ ___
  | |/ _ \ / _' |/ _' |/ _' | '_ ' _ \
  | | (_) | (_| | (_| | (_| | | | | | |
  |_|\___/ \__,_|\__,_|\__,_|_| |_| |_|
`;

const TAGLINE = "  spec → tests · contract · drift · MCP server";

export function banner(): string {
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  if (!useColor) {
    return `${ART}\n${TAGLINE}\n`;
  }
  // dim cyan art, dim tagline
  const cyan = "\x1b[36m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  return `${cyan}${ART}${reset}\n${dim}${TAGLINE}${reset}\n`;
}
