/**
 * Command Allowlist Manager
 *
 * Manages both static (builtin) and dynamic (admin-configured) allowed commands.
 * Dynamic commands are persisted to /opt/agenshield/config/allowed-commands.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Dynamic allowed command entry
 */
export interface AllowedCommand {
  name: string;
  paths: string[];
  addedAt: string;
  addedBy: string;
  category?: string;
}

/**
 * Persisted config file format
 */
interface AllowedCommandsConfig {
  version: string;
  commands: AllowedCommand[];
}

/**
 * Static builtin commands that are always allowed.
 * Command name -> list of absolute paths to search (ordered by preference).
 */
const BUILTIN_COMMANDS: Record<string, string[]> = {
  git: ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'],
  ssh: ['/usr/bin/ssh'],
  scp: ['/usr/bin/scp'],
  rsync: ['/usr/bin/rsync', '/opt/homebrew/bin/rsync'],
  brew: ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'],
  npm: ['/opt/homebrew/bin/npm', '/usr/local/bin/npm'],
  npx: ['/opt/homebrew/bin/npx', '/usr/local/bin/npx'],
  pip: ['/usr/bin/pip', '/usr/local/bin/pip', '/opt/homebrew/bin/pip'],
  pip3: ['/usr/bin/pip3', '/usr/local/bin/pip3', '/opt/homebrew/bin/pip3'],
  node: ['/opt/homebrew/bin/node', '/usr/local/bin/node'],
  python: ['/usr/bin/python', '/usr/local/bin/python', '/opt/homebrew/bin/python'],
  python3: ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'],
  ls: ['/bin/ls'],
  cat: ['/bin/cat'],
  grep: ['/usr/bin/grep'],
  find: ['/usr/bin/find'],
  mkdir: ['/bin/mkdir'],
  cp: ['/bin/cp'],
  mv: ['/bin/mv'],
  rm: ['/bin/rm'],
  touch: ['/usr/bin/touch'],
  chmod: ['/bin/chmod'],
  head: ['/usr/bin/head'],
  tail: ['/usr/bin/tail'],
  wc: ['/usr/bin/wc'],
  sort: ['/usr/bin/sort'],
  uniq: ['/usr/bin/uniq'],
  sed: ['/usr/bin/sed'],
  awk: ['/usr/bin/awk'],
  tar: ['/usr/bin/tar'],
  curl: ['/usr/bin/curl'],
  wget: ['/usr/local/bin/wget', '/opt/homebrew/bin/wget'],
};

export class CommandAllowlist {
  private configPath: string;
  private dynamicCommands: Map<string, AllowedCommand> = new Map();

  constructor(configPath: string) {
    this.configPath = configPath;
    this.load();
  }

  /**
   * Load dynamic commands from disk
   */
  load(): void {
    if (!fs.existsSync(this.configPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const config = JSON.parse(content) as AllowedCommandsConfig;

      this.dynamicCommands.clear();
      for (const cmd of config.commands || []) {
        this.dynamicCommands.set(cmd.name, cmd);
      }
    } catch {
      // Ignore parse errors, keep existing state
    }
  }

  /**
   * Persist dynamic commands to disk
   */
  save(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const config: AllowedCommandsConfig = {
      version: '1.0.0',
      commands: Array.from(this.dynamicCommands.values()),
    };

    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  }

  /**
   * Add a dynamic command
   */
  add(cmd: AllowedCommand): void {
    this.dynamicCommands.set(cmd.name, cmd);
    this.save();
  }

  /**
   * Remove a dynamic command
   */
  remove(name: string): boolean {
    const existed = this.dynamicCommands.delete(name);
    if (existed) {
      this.save();
    }
    return existed;
  }

  /**
   * Get a dynamic command by name
   */
  get(name: string): AllowedCommand | undefined {
    return this.dynamicCommands.get(name);
  }

  /**
   * List all commands (builtin + dynamic)
   */
  list(): Array<AllowedCommand & { builtin: boolean }> {
    const result: Array<AllowedCommand & { builtin: boolean }> = [];

    // Add builtin commands
    for (const [name, paths] of Object.entries(BUILTIN_COMMANDS)) {
      result.push({
        name,
        paths,
        addedAt: '',
        addedBy: 'builtin',
        builtin: true,
      });
    }

    // Add dynamic commands
    for (const cmd of this.dynamicCommands.values()) {
      result.push({ ...cmd, builtin: false });
    }

    return result;
  }

  /**
   * List only dynamic commands
   */
  listDynamic(): AllowedCommand[] {
    return Array.from(this.dynamicCommands.values());
  }

  /**
   * Check if a command name conflicts with a builtin
   */
  isBuiltin(name: string): boolean {
    return name in BUILTIN_COMMANDS;
  }

  /**
   * Resolve a command name to an absolute path.
   * Checks builtin commands first, then dynamic commands.
   * Returns null if the command is not allowed.
   */
  resolve(command: string): string | null {
    // If command is already an absolute path, check it's in an allowed list
    if (path.isAbsolute(command)) {
      // Check builtins
      for (const paths of Object.values(BUILTIN_COMMANDS)) {
        if (paths.includes(command)) {
          return command;
        }
      }
      // Check dynamic
      for (const cmd of this.dynamicCommands.values()) {
        if (cmd.paths.includes(command)) {
          return command;
        }
      }
      return null;
    }

    // Look up by command basename
    const basename = path.basename(command);

    // Check builtins first
    const builtinPaths = BUILTIN_COMMANDS[basename];
    if (builtinPaths) {
      return builtinPaths[0];
    }

    // Check dynamic commands
    const dynamicCmd = this.dynamicCommands.get(basename);
    if (dynamicCmd && dynamicCmd.paths.length > 0) {
      return dynamicCmd.paths[0];
    }

    return null;
  }
}
