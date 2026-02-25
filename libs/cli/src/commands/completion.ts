/**
 * Completion command
 *
 * Generates shell completion scripts for bash, zsh, and fish.
 *
 * @example
 * ```bash
 * # Zsh
 * agenshield completion zsh > ~/.zsh/completions/_agenshield
 *
 * # Bash
 * agenshield completion bash > /etc/bash_completion.d/agenshield
 *
 * # Fish
 * agenshield completion fish > ~/.config/fish/completions/agenshield.fish
 * ```
 */

import { Command } from 'commander';

// ── Completion script generators ──────────────────────────────────────

const COMMANDS = [
  'start',
  'stop',
  'upgrade',
  'setup',
  'status',
  'doctor',
  'uninstall',
  'dev',
  'install',
  'logs',
  'exec',
  'auth',
  'completion',
];

const GLOBAL_FLAGS = '--json --quiet --verbose --no-color --debug --version --help';

function generateBash(): string {
  return `# bash completion for agenshield
# Add to ~/.bashrc or /etc/bash_completion.d/agenshield
_agenshield() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${COMMANDS.join(' ')}"

  case "\${prev}" in
    agenshield)
      COMPREPLY=( $(compgen -W "\${commands} ${GLOBAL_FLAGS}" -- "\${cur}") )
      return 0
      ;;
    setup)
      COMPREPLY=( $(compgen -W "local cloud" -- "\${cur}") )
      return 0
      ;;
    auth)
      COMPREPLY=( $(compgen -W "token" -- "\${cur}") )
      return 0
      ;;
    token)
      COMPREPLY=( $(compgen -W "ui broker" -- "\${cur}") )
      return 0
      ;;
    dev)
      COMPREPLY=( $(compgen -W "clean shell" -- "\${cur}") )
      return 0
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      return 0
      ;;
    logs)
      COMPREPLY=( $(compgen -W "--level --json -n" -- "\${cur}") )
      return 0
      ;;
    *)
      COMPREPLY=( $(compgen -W "${GLOBAL_FLAGS}" -- "\${cur}") )
      return 0
      ;;
  esac
}
complete -F _agenshield agenshield
`;
}

function generateZsh(): string {
  return `#compdef agenshield
# zsh completion for agenshield
# Add to fpath or source directly

_agenshield() {
  local -a commands
  commands=(
    'start:Start AgenShield and open the dashboard'
    'stop:Stop the AgenShield daemon'
    'upgrade:Upgrade AgenShield (stop, update, restart)'
    'setup:Set up AgenShield (local or cloud mode)'
    'status:Show current AgenShield status'
    'doctor:Check and diagnose common issues'
    'uninstall:Reverse isolation and restore targets'
    'dev:Run AgenShield in dev mode'
    'install:Install AgenShield locally'
    'logs:Stream daemon logs in real time'
    'exec:Open an interactive guarded shell'
    'auth:Authentication token management'
    'completion:Generate shell completions'
  )

  _arguments -C \\
    '--json[Output machine-readable JSON]' \\
    '(-q --quiet)'{-q,--quiet}'[Suppress non-essential output]' \\
    '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \\
    '--no-color[Disable colors]' \\
    '--debug[Show stack traces on errors]' \\
    '(-V --version)'{-V,--version}'[Output the version number]' \\
    '1: :->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe -t commands 'agenshield command' commands
      ;;
    args)
      case $words[1] in
        setup)
          _values 'mode' 'local[Local mode setup]' 'cloud[Cloud mode setup]'
          ;;
        auth)
          _values 'subcommand' 'token[Token management]'
          ;;
        dev)
          _values 'subcommand' 'clean[Clean dev environment]' 'shell[Open agent shell]'
          ;;
        completion)
          _values 'shell' 'bash' 'zsh' 'fish'
          ;;
        logs)
          _arguments \\
            '--level[Minimum log level]:level:(trace debug info warn error fatal)' \\
            '--json[Output raw JSON log entries]' \\
            '-n[Number of recent entries]:lines:'
          ;;
        start)
          _arguments \\
            '(-f --foreground)'{-f,--foreground}'[Run in foreground]' \\
            '--no-browser[Do not open browser]'
          ;;
        upgrade)
          _arguments \\
            '--dry-run[Show what would be done]' \\
            '--force[Re-apply even if latest]' \\
            '--local[Upgrade from local build]' \\
            '--cli[Terminal mode]'
          ;;
      esac
      ;;
  esac
}

_agenshield "$@"
`;
}

function generateFish(): string {
  return `# fish completion for agenshield
# Add to ~/.config/fish/completions/agenshield.fish

# Disable file completions
complete -c agenshield -f

# Commands
complete -c agenshield -n '__fish_use_subcommand' -a start -d 'Start AgenShield and open the dashboard'
complete -c agenshield -n '__fish_use_subcommand' -a stop -d 'Stop the AgenShield daemon'
complete -c agenshield -n '__fish_use_subcommand' -a upgrade -d 'Upgrade AgenShield (stop, update, restart)'
complete -c agenshield -n '__fish_use_subcommand' -a setup -d 'Set up AgenShield (local or cloud mode)'
complete -c agenshield -n '__fish_use_subcommand' -a status -d 'Show current AgenShield status'
complete -c agenshield -n '__fish_use_subcommand' -a doctor -d 'Check and diagnose common issues'
complete -c agenshield -n '__fish_use_subcommand' -a uninstall -d 'Reverse isolation and restore targets'
complete -c agenshield -n '__fish_use_subcommand' -a dev -d 'Run AgenShield in dev mode'
complete -c agenshield -n '__fish_use_subcommand' -a install -d 'Install AgenShield locally'
complete -c agenshield -n '__fish_use_subcommand' -a logs -d 'Stream daemon logs in real time'
complete -c agenshield -n '__fish_use_subcommand' -a exec -d 'Open an interactive guarded shell'
complete -c agenshield -n '__fish_use_subcommand' -a auth -d 'Authentication token management'
complete -c agenshield -n '__fish_use_subcommand' -a completion -d 'Generate shell completions'

# Global flags
complete -c agenshield -l json -d 'Output machine-readable JSON'
complete -c agenshield -s q -l quiet -d 'Suppress non-essential output'
complete -c agenshield -s v -l verbose -d 'Show detailed output'
complete -c agenshield -l no-color -d 'Disable colors'
complete -c agenshield -l debug -d 'Show stack traces on errors'

# setup subcommands
complete -c agenshield -n '__fish_seen_subcommand_from setup' -a local -d 'Local mode setup'
complete -c agenshield -n '__fish_seen_subcommand_from setup' -a cloud -d 'Cloud mode setup'

# auth subcommands
complete -c agenshield -n '__fish_seen_subcommand_from auth' -a token -d 'Token management'

# dev subcommands
complete -c agenshield -n '__fish_seen_subcommand_from dev' -a clean -d 'Clean dev environment'
complete -c agenshield -n '__fish_seen_subcommand_from dev' -a shell -d 'Open agent shell'

# completion subcommands
complete -c agenshield -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'

# start flags
complete -c agenshield -n '__fish_seen_subcommand_from start' -s f -l foreground -d 'Run in foreground'
complete -c agenshield -n '__fish_seen_subcommand_from start' -l no-browser -d 'Do not open browser'

# upgrade flags
complete -c agenshield -n '__fish_seen_subcommand_from upgrade' -l dry-run -d 'Show what would be done'
complete -c agenshield -n '__fish_seen_subcommand_from upgrade' -l force -d 'Re-apply even if latest'
complete -c agenshield -n '__fish_seen_subcommand_from upgrade' -l local -d 'Upgrade from local build'
complete -c agenshield -n '__fish_seen_subcommand_from upgrade' -l cli -d 'Terminal mode'

# logs flags
complete -c agenshield -n '__fish_seen_subcommand_from logs' -l level -d 'Minimum log level' -xa 'trace debug info warn error fatal'
complete -c agenshield -n '__fish_seen_subcommand_from logs' -l json -d 'Output raw JSON log entries'
complete -c agenshield -n '__fish_seen_subcommand_from logs' -s n -d 'Number of recent entries'
`;
}

// ── Command definition ────────────────────────────────────────────────

/**
 * Create the completion command
 */
export function createCompletionCommand(): Command {
  const cmd = new Command('completion')
    .description('Generate shell completion scripts')
    .argument('[shell]', 'Shell type: bash, zsh, or fish')
    .action((shell?: string) => {
      if (!shell) {
        // Auto-detect from SHELL env var
        const currentShell = process.env['SHELL'] || '';
        if (currentShell.includes('zsh')) {
          shell = 'zsh';
        } else if (currentShell.includes('fish')) {
          shell = 'fish';
        } else {
          shell = 'bash';
        }
      }

      switch (shell) {
        case 'bash':
          process.stdout.write(generateBash());
          break;
        case 'zsh':
          process.stdout.write(generateZsh());
          break;
        case 'fish':
          process.stdout.write(generateFish());
          break;
        default:
          process.stderr.write(`Unknown shell: ${shell}. Supported: bash, zsh, fish\n`);
          process.exitCode = 2;
      }
    });

  return cmd;
}
