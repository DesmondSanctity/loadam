import type { Command } from "commander";

const BASH = `# loadam bash completion. Install:
#   loadam completion bash > ~/.loadam-completion.bash
#   echo 'source ~/.loadam-completion.bash' >> ~/.bashrc
_loadam_complete() {
  local cur prev cmds
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmds="init auth test contract diff mcp completion help -h --help -v --version"
  if [ "\$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( \$(compgen -W "\$cmds" -- "\$cur") )
    return 0
  fi
  COMPREPLY=( \$(compgen -f -- "\$cur") )
}
complete -F _loadam_complete loadam
`;

const ZSH = `#compdef loadam
# loadam zsh completion. Install:
#   loadam completion zsh > "\${fpath[1]}/_loadam"
#   then restart your shell.
_loadam() {
  local -a cmds
  cmds=(
    'init:Parse spec and emit loadam.ir.json'
    'auth:Auth helpers (e.g. import from curl)'
    'test:Compile to k6 smoke + load tests'
    'contract:Compile to Schemathesis contract suite'
    'diff:Probe live API and report drift'
    'mcp:Compile to MCP server (stdio + HTTP)'
    'completion:Print shell completion script'
  )
  if (( CURRENT == 2 )); then
    _describe 'command' cmds
  else
    _files
  fi
}
_loadam "\$@"
`;

const FISH = `# loadam fish completion. Install:
#   loadam completion fish > ~/.config/fish/completions/loadam.fish
complete -c loadam -f
complete -c loadam -n __fish_use_subcommand -a init     -d 'Parse spec to IR'
complete -c loadam -n __fish_use_subcommand -a auth     -d 'Auth helpers'
complete -c loadam -n __fish_use_subcommand -a test     -d 'Compile to k6 tests'
complete -c loadam -n __fish_use_subcommand -a contract -d 'Compile to Schemathesis suite'
complete -c loadam -n __fish_use_subcommand -a diff     -d 'Spec-vs-live drift report'
complete -c loadam -n __fish_use_subcommand -a mcp      -d 'Compile to MCP server'
complete -c loadam -n __fish_use_subcommand -a completion -d 'Print shell completion'
`;

export function registerCompletionCommand(program: Command): void {
  program
    .command("completion")
    .description("Print shell completion script (bash | zsh | fish)")
    .argument("<shell>", "shell name: bash, zsh, or fish")
    .action((shell: string) => {
      switch (shell) {
        case "bash":
          process.stdout.write(BASH);
          return;
        case "zsh":
          process.stdout.write(ZSH);
          return;
        case "fish":
          process.stdout.write(FISH);
          return;
        default:
          process.stderr.write(`Unknown shell: ${shell}. Use bash, zsh, or fish.\n`);
          process.exit(1);
      }
    });
}
