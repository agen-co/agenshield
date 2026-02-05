/**
 * Command Catalog
 *
 * Static catalog of well-known commands with descriptions, security risk
 * levels, categories, and searchable tags. Used by binary-scanner for
 * classification and by the UI for rich autocomplete.
 */

import type { CatalogEntry } from './types/catalog';

/**
 * Catalog of ~80 well-known commands.
 */
export const COMMAND_CATALOG: Record<string, CatalogEntry> = {
  // ── Network ────────────────────────────────────────────────
  curl: {
    description: 'Transfer data using network protocols',
    category: 'network',
    risk: 'high',
    riskReason: 'Can exfiltrate data or download malicious payloads',
    tags: ['http', 'download', 'upload', 'api', 'request'],
  },
  wget: {
    description: 'Download files from the web',
    category: 'network',
    risk: 'high',
    riskReason: 'Can download malicious payloads or exfiltrate via HTTP',
    tags: ['http', 'download', 'fetch', 'web'],
  },
  ssh: {
    description: 'Secure shell remote login',
    category: 'network',
    risk: 'high',
    riskReason: 'Opens remote shell sessions and can tunnel traffic',
    tags: ['remote', 'login', 'tunnel', 'secure'],
  },
  scp: {
    description: 'Secure copy files over SSH',
    category: 'network',
    risk: 'high',
    riskReason: 'Can exfiltrate files to remote hosts',
    tags: ['copy', 'remote', 'transfer', 'secure'],
  },
  rsync: {
    description: 'Fast incremental file transfer',
    category: 'network',
    risk: 'high',
    riskReason: 'Can sync large amounts of data to remote hosts',
    tags: ['sync', 'copy', 'remote', 'transfer', 'backup'],
  },
  nc: {
    description: 'Netcat — arbitrary TCP/UDP connections',
    category: 'network',
    risk: 'high',
    riskReason: 'Can open arbitrary network connections and reverse shells',
    tags: ['netcat', 'tcp', 'udp', 'socket', 'listen'],
  },
  telnet: {
    description: 'Unencrypted remote terminal protocol',
    category: 'network',
    risk: 'high',
    riskReason: 'Unencrypted remote access, can connect to arbitrary ports',
    tags: ['remote', 'terminal', 'unencrypted'],
  },
  ftp: {
    description: 'File transfer protocol client',
    category: 'network',
    risk: 'high',
    riskReason: 'Unencrypted file transfers, can exfiltrate data',
    tags: ['transfer', 'upload', 'download', 'unencrypted'],
  },
  sftp: {
    description: 'Secure file transfer over SSH',
    category: 'network',
    risk: 'high',
    riskReason: 'Can transfer files to/from remote hosts',
    tags: ['transfer', 'upload', 'download', 'secure', 'ssh'],
  },
  nslookup: {
    description: 'Query DNS name servers',
    category: 'network',
    risk: 'low',
    riskReason: 'Read-only DNS lookups',
    tags: ['dns', 'lookup', 'resolve', 'nameserver'],
  },
  dig: {
    description: 'DNS lookup utility',
    category: 'network',
    risk: 'low',
    riskReason: 'Read-only DNS queries',
    tags: ['dns', 'lookup', 'resolve', 'query'],
  },
  host: {
    description: 'DNS lookup utility',
    category: 'network',
    risk: 'low',
    riskReason: 'Read-only DNS resolution',
    tags: ['dns', 'lookup', 'resolve'],
  },
  ping: {
    description: 'Send ICMP echo requests',
    category: 'network',
    risk: 'low',
    riskReason: 'Read-only network reachability check',
    tags: ['icmp', 'reachability', 'latency', 'network'],
  },
  traceroute: {
    description: 'Trace packet route to host',
    category: 'network',
    risk: 'low',
    riskReason: 'Read-only route tracing',
    tags: ['route', 'hops', 'network', 'diagnostics'],
  },
  netstat: {
    description: 'Display network connections and stats',
    category: 'network',
    risk: 'low',
    riskReason: 'Read-only network status',
    tags: ['connections', 'ports', 'sockets', 'status'],
  },
  ifconfig: {
    description: 'Configure or display network interfaces',
    category: 'network',
    risk: 'medium',
    riskReason: 'Can modify network interface configuration',
    tags: ['interface', 'ip', 'config', 'adapter'],
  },
  ip: {
    description: 'Show/manipulate routing and network devices',
    category: 'network',
    risk: 'medium',
    riskReason: 'Can modify routing tables and network interfaces',
    tags: ['routing', 'interface', 'address', 'link'],
  },

  // ── Package Managers ───────────────────────────────────────
  npm: {
    description: 'Node.js package manager',
    category: 'package-manager',
    risk: 'medium',
    riskReason: 'Can install packages with arbitrary post-install scripts',
    tags: ['node', 'install', 'packages', 'javascript', 'registry'],
  },
  npx: {
    description: 'Execute npm package binaries',
    category: 'package-manager',
    risk: 'high',
    riskReason: 'Downloads and executes arbitrary packages on the fly',
    tags: ['node', 'execute', 'run', 'packages', 'javascript'],
  },
  yarn: {
    description: 'Fast Node.js package manager',
    category: 'package-manager',
    risk: 'medium',
    riskReason: 'Can install packages with arbitrary post-install scripts',
    tags: ['node', 'install', 'packages', 'javascript', 'registry'],
  },
  pnpm: {
    description: 'Efficient Node.js package manager',
    category: 'package-manager',
    risk: 'medium',
    riskReason: 'Can install packages with arbitrary post-install scripts',
    tags: ['node', 'install', 'packages', 'javascript', 'registry'],
  },
  pip: {
    description: 'Python package installer',
    category: 'package-manager',
    risk: 'medium',
    riskReason: 'Can install packages with arbitrary setup scripts',
    tags: ['python', 'install', 'packages', 'pypi'],
  },
  pip3: {
    description: 'Python 3 package installer',
    category: 'package-manager',
    risk: 'medium',
    riskReason: 'Can install packages with arbitrary setup scripts',
    tags: ['python', 'install', 'packages', 'pypi'],
  },
  brew: {
    description: 'macOS/Linux package manager',
    category: 'package-manager',
    risk: 'medium',
    riskReason: 'Can install system-level software and modify PATH',
    tags: ['homebrew', 'install', 'macos', 'linux', 'packages'],
  },
  gem: {
    description: 'Ruby package manager',
    category: 'package-manager',
    risk: 'medium',
    riskReason: 'Can install packages with native extensions',
    tags: ['ruby', 'install', 'packages', 'rubygems'],
  },
  cargo: {
    description: 'Rust package manager and build tool',
    category: 'package-manager',
    risk: 'medium',
    riskReason: 'Compiles and runs arbitrary Rust code during install',
    tags: ['rust', 'install', 'build', 'crates', 'compile'],
  },
  composer: {
    description: 'PHP dependency manager',
    category: 'package-manager',
    risk: 'medium',
    riskReason: 'Can install packages with arbitrary scripts',
    tags: ['php', 'install', 'packages', 'packagist'],
  },
  apt: {
    description: 'Debian/Ubuntu package manager',
    category: 'package-manager',
    risk: 'high',
    riskReason: 'System-level package installation requiring root',
    tags: ['debian', 'ubuntu', 'install', 'system', 'linux'],
  },
  yum: {
    description: 'RPM-based package manager',
    category: 'package-manager',
    risk: 'high',
    riskReason: 'System-level package installation requiring root',
    tags: ['redhat', 'centos', 'install', 'system', 'linux', 'rpm'],
  },

  // ── Shells ─────────────────────────────────────────────────
  bash: {
    description: 'Bourne-Again SHell',
    category: 'shell',
    risk: 'high',
    riskReason: 'Full shell access — can execute arbitrary commands',
    tags: ['shell', 'script', 'terminal', 'bourne'],
  },
  zsh: {
    description: 'Z shell',
    category: 'shell',
    risk: 'high',
    riskReason: 'Full shell access — can execute arbitrary commands',
    tags: ['shell', 'script', 'terminal'],
  },
  sh: {
    description: 'POSIX shell',
    category: 'shell',
    risk: 'high',
    riskReason: 'Full shell access — can execute arbitrary commands',
    tags: ['shell', 'script', 'terminal', 'posix'],
  },
  fish: {
    description: 'Friendly interactive shell',
    category: 'shell',
    risk: 'high',
    riskReason: 'Full shell access — can execute arbitrary commands',
    tags: ['shell', 'script', 'terminal', 'interactive'],
  },
  dash: {
    description: 'Debian Almquist shell',
    category: 'shell',
    risk: 'high',
    riskReason: 'Full shell access — can execute arbitrary commands',
    tags: ['shell', 'script', 'terminal', 'posix'],
  },
  ksh: {
    description: 'KornShell',
    category: 'shell',
    risk: 'high',
    riskReason: 'Full shell access — can execute arbitrary commands',
    tags: ['shell', 'script', 'terminal'],
  },
  csh: {
    description: 'C shell',
    category: 'shell',
    risk: 'high',
    riskReason: 'Full shell access — can execute arbitrary commands',
    tags: ['shell', 'script', 'terminal'],
  },
  tcsh: {
    description: 'Enhanced C shell',
    category: 'shell',
    risk: 'high',
    riskReason: 'Full shell access — can execute arbitrary commands',
    tags: ['shell', 'script', 'terminal'],
  },

  // ── System ─────────────────────────────────────────────────
  ls: {
    description: 'List directory contents',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only directory listing',
    tags: ['list', 'directory', 'files'],
  },
  cp: {
    description: 'Copy files and directories',
    category: 'system',
    risk: 'medium',
    riskReason: 'Can overwrite files and duplicate sensitive data',
    tags: ['copy', 'duplicate', 'file'],
  },
  mv: {
    description: 'Move or rename files',
    category: 'system',
    risk: 'medium',
    riskReason: 'Can overwrite existing files',
    tags: ['move', 'rename', 'file'],
  },
  rm: {
    description: 'Remove files or directories',
    category: 'system',
    risk: 'high',
    riskReason: 'Can permanently delete critical files',
    tags: ['delete', 'remove', 'file'],
  },
  mkdir: {
    description: 'Create directories',
    category: 'system',
    risk: 'low',
    riskReason: 'Creates new directories only',
    tags: ['create', 'directory', 'folder'],
  },
  chmod: {
    description: 'Change file permissions',
    category: 'system',
    risk: 'high',
    riskReason: 'Can make files executable or world-readable',
    tags: ['permissions', 'access', 'mode', 'security'],
  },
  chown: {
    description: 'Change file ownership',
    category: 'system',
    risk: 'high',
    riskReason: 'Can transfer file ownership, requires root',
    tags: ['ownership', 'user', 'group', 'security'],
  },
  chgrp: {
    description: 'Change group ownership',
    category: 'system',
    risk: 'medium',
    riskReason: 'Can change file group access',
    tags: ['ownership', 'group', 'security'],
  },
  cat: {
    description: 'Concatenate and display files',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only file output',
    tags: ['read', 'display', 'file', 'output'],
  },
  echo: {
    description: 'Display text or write to files',
    category: 'system',
    risk: 'low',
    riskReason: 'Text output, low risk unless redirected',
    tags: ['print', 'text', 'output'],
  },
  touch: {
    description: 'Create empty files or update timestamps',
    category: 'system',
    risk: 'low',
    riskReason: 'Creates empty files or updates metadata',
    tags: ['create', 'file', 'timestamp'],
  },
  ln: {
    description: 'Create file links',
    category: 'system',
    risk: 'medium',
    riskReason: 'Symlinks can redirect file access',
    tags: ['link', 'symlink', 'hardlink', 'file'],
  },
  find: {
    description: 'Search for files in directory hierarchy',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only file search with exec option',
    tags: ['search', 'files', 'directory', 'locate'],
  },
  grep: {
    description: 'Search file contents with patterns',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only content search',
    tags: ['search', 'pattern', 'regex', 'text', 'match'],
  },
  sed: {
    description: 'Stream editor for text transformation',
    category: 'system',
    risk: 'medium',
    riskReason: 'Can modify files in-place',
    tags: ['edit', 'transform', 'text', 'replace', 'regex'],
  },
  awk: {
    description: 'Pattern scanning and text processing',
    category: 'system',
    risk: 'medium',
    riskReason: 'Turing-complete language, can execute system commands',
    tags: ['text', 'processing', 'pattern', 'columns', 'transform'],
  },
  ps: {
    description: 'Report process status',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only process listing',
    tags: ['process', 'status', 'list', 'running'],
  },
  kill: {
    description: 'Send signals to processes',
    category: 'system',
    risk: 'high',
    riskReason: 'Can terminate critical processes',
    tags: ['process', 'signal', 'terminate', 'stop'],
  },
  top: {
    description: 'Display real-time process activity',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only system monitoring',
    tags: ['process', 'monitor', 'cpu', 'memory'],
  },
  df: {
    description: 'Report disk space usage',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only disk stats',
    tags: ['disk', 'space', 'usage', 'filesystem'],
  },
  du: {
    description: 'Estimate file space usage',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only file size inspection',
    tags: ['disk', 'size', 'usage', 'file'],
  },
  mount: {
    description: 'Mount filesystems',
    category: 'system',
    risk: 'high',
    riskReason: 'Can attach external filesystems, requires root',
    tags: ['filesystem', 'attach', 'volume', 'disk'],
  },
  umount: {
    description: 'Unmount filesystems',
    category: 'system',
    risk: 'high',
    riskReason: 'Can detach active filesystems, requires root',
    tags: ['filesystem', 'detach', 'volume', 'disk'],
  },
  head: {
    description: 'Output first part of files',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only file output',
    tags: ['read', 'file', 'first', 'lines', 'output'],
  },
  tail: {
    description: 'Output last part of files',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only file output',
    tags: ['read', 'file', 'last', 'lines', 'output', 'follow'],
  },
  wc: {
    description: 'Count lines, words, and bytes',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only counting',
    tags: ['count', 'lines', 'words', 'bytes', 'file'],
  },
  sort: {
    description: 'Sort lines of text',
    category: 'system',
    risk: 'low',
    riskReason: 'Text processing, low risk',
    tags: ['sort', 'order', 'text', 'lines'],
  },
  uniq: {
    description: 'Filter adjacent duplicate lines',
    category: 'system',
    risk: 'low',
    riskReason: 'Text processing, low risk',
    tags: ['unique', 'duplicate', 'filter', 'text'],
  },
  tar: {
    description: 'Archive and compress files',
    category: 'system',
    risk: 'medium',
    riskReason: 'Can overwrite files during extraction',
    tags: ['archive', 'compress', 'extract', 'backup', 'gzip'],
  },
  xargs: {
    description: 'Build and execute commands from stdin',
    category: 'system',
    risk: 'medium',
    riskReason: 'Executes commands with piped arguments',
    tags: ['execute', 'pipe', 'arguments', 'build'],
  },
  tee: {
    description: 'Read stdin and write to files and stdout',
    category: 'system',
    risk: 'low',
    riskReason: 'Writes output to files',
    tags: ['output', 'write', 'pipe', 'file'],
  },
  env: {
    description: 'Display or set environment variables',
    category: 'system',
    risk: 'low',
    riskReason: 'Can expose environment variables including secrets',
    tags: ['environment', 'variables', 'config'],
  },
  printenv: {
    description: 'Print environment variables',
    category: 'system',
    risk: 'low',
    riskReason: 'Can expose environment variables including secrets',
    tags: ['environment', 'variables', 'display'],
  },
  which: {
    description: 'Locate a command',
    category: 'system',
    risk: 'info',
    riskReason: 'Read-only path lookup',
    tags: ['locate', 'path', 'command', 'binary'],
  },
  whoami: {
    description: 'Print current user name',
    category: 'system',
    risk: 'info',
    riskReason: 'Read-only user info',
    tags: ['user', 'identity', 'login'],
  },
  uname: {
    description: 'Print system information',
    category: 'system',
    risk: 'info',
    riskReason: 'Read-only system info',
    tags: ['system', 'kernel', 'os', 'info'],
  },
  date: {
    description: 'Display or set date and time',
    category: 'system',
    risk: 'info',
    riskReason: 'Read-only time display',
    tags: ['time', 'date', 'clock'],
  },
  sudo: {
    description: 'Execute command as superuser',
    category: 'system',
    risk: 'high',
    riskReason: 'Full root privilege escalation',
    tags: ['root', 'superuser', 'privilege', 'admin', 'elevate'],
  },
  crontab: {
    description: 'Schedule periodic commands',
    category: 'system',
    risk: 'high',
    riskReason: 'Can schedule persistent background tasks',
    tags: ['schedule', 'cron', 'periodic', 'job', 'task'],
  },

  // ── Language Runtimes ──────────────────────────────────────
  node: {
    description: 'Node.js JavaScript runtime',
    category: 'language-runtime',
    risk: 'medium',
    riskReason: 'Can execute arbitrary code with network access',
    tags: ['javascript', 'runtime', 'execute', 'v8', 'server'],
  },
  python: {
    description: 'Python interpreter',
    category: 'language-runtime',
    risk: 'medium',
    riskReason: 'Can execute arbitrary code with full system access',
    tags: ['python', 'runtime', 'execute', 'script', 'interpreter'],
  },
  python3: {
    description: 'Python 3 interpreter',
    category: 'language-runtime',
    risk: 'medium',
    riskReason: 'Can execute arbitrary code with full system access',
    tags: ['python', 'runtime', 'execute', 'script', 'interpreter'],
  },
  ruby: {
    description: 'Ruby interpreter',
    category: 'language-runtime',
    risk: 'medium',
    riskReason: 'Can execute arbitrary code with full system access',
    tags: ['ruby', 'runtime', 'execute', 'script', 'interpreter'],
  },
  perl: {
    description: 'Perl interpreter',
    category: 'language-runtime',
    risk: 'medium',
    riskReason: 'Can execute arbitrary code with full system access',
    tags: ['perl', 'runtime', 'execute', 'script', 'interpreter'],
  },
  java: {
    description: 'Java application launcher',
    category: 'language-runtime',
    risk: 'medium',
    riskReason: 'Can execute arbitrary JVM code',
    tags: ['java', 'jvm', 'runtime', 'execute', 'jar'],
  },
  go: {
    description: 'Go programming language tool',
    category: 'language-runtime',
    risk: 'medium',
    riskReason: 'Can compile and run arbitrary Go code',
    tags: ['golang', 'compile', 'runtime', 'build', 'execute'],
  },
  rustc: {
    description: 'Rust compiler',
    category: 'language-runtime',
    risk: 'medium',
    riskReason: 'Compiles code that runs with full system access',
    tags: ['rust', 'compile', 'build'],
  },
  deno: {
    description: 'Secure JavaScript/TypeScript runtime',
    category: 'language-runtime',
    risk: 'medium',
    riskReason: 'Can execute code, sandboxed by default but flags allow access',
    tags: ['javascript', 'typescript', 'runtime', 'execute', 'secure'],
  },
  bun: {
    description: 'Fast JavaScript runtime and toolkit',
    category: 'language-runtime',
    risk: 'medium',
    riskReason: 'Can execute arbitrary code with network access',
    tags: ['javascript', 'typescript', 'runtime', 'execute', 'fast'],
  },
  php: {
    description: 'PHP interpreter',
    category: 'language-runtime',
    risk: 'medium',
    riskReason: 'Can execute arbitrary code with full system access',
    tags: ['php', 'runtime', 'execute', 'script', 'web'],
  },

  // ── Version Control ────────────────────────────────────────
  git: {
    description: 'Distributed version control',
    category: 'network',
    risk: 'medium',
    riskReason: 'Network ops can access remote repos and run hooks',
    tags: ['vcs', 'clone', 'push', 'pull', 'repository', 'commit', 'branch'],
  },
  svn: {
    description: 'Subversion version control',
    category: 'network',
    risk: 'medium',
    riskReason: 'Network access to remote repositories',
    tags: ['vcs', 'checkout', 'repository', 'subversion'],
  },

  // ── Container & Orchestration ──────────────────────────────
  docker: {
    description: 'Container runtime and management',
    category: 'system',
    risk: 'high',
    riskReason: 'Can run containers with host access and mount volumes',
    tags: ['container', 'image', 'build', 'run', 'volume', 'compose'],
  },
  'docker-compose': {
    description: 'Multi-container Docker orchestration',
    category: 'system',
    risk: 'high',
    riskReason: 'Can start multiple containers with host access',
    tags: ['container', 'compose', 'orchestrate', 'multi-container'],
  },
  kubectl: {
    description: 'Kubernetes cluster management',
    category: 'system',
    risk: 'high',
    riskReason: 'Full cluster access — can deploy, delete, and modify workloads',
    tags: ['kubernetes', 'k8s', 'cluster', 'deploy', 'pods', 'orchestrate'],
  },
  helm: {
    description: 'Kubernetes package manager',
    category: 'package-manager',
    risk: 'high',
    riskReason: 'Can install and modify Kubernetes deployments',
    tags: ['kubernetes', 'k8s', 'charts', 'deploy', 'install'],
  },
  podman: {
    description: 'Daemonless container engine',
    category: 'system',
    risk: 'high',
    riskReason: 'Can run containers with host access',
    tags: ['container', 'image', 'build', 'run', 'rootless'],
  },

  // ── Infrastructure & Cloud ─────────────────────────────────
  terraform: {
    description: 'Infrastructure as code tool',
    category: 'system',
    risk: 'high',
    riskReason: 'Can create, modify, and destroy cloud infrastructure',
    tags: ['iac', 'cloud', 'infrastructure', 'provision', 'hcl'],
  },
  aws: {
    description: 'AWS command line interface',
    category: 'network',
    risk: 'high',
    riskReason: 'Full AWS account access — can modify any service',
    tags: ['cloud', 'amazon', 's3', 'ec2', 'lambda', 'infrastructure'],
  },
  gcloud: {
    description: 'Google Cloud CLI',
    category: 'network',
    risk: 'high',
    riskReason: 'Full GCP access — can modify any service',
    tags: ['cloud', 'google', 'gcp', 'infrastructure'],
  },
  az: {
    description: 'Azure command line interface',
    category: 'network',
    risk: 'high',
    riskReason: 'Full Azure access — can modify any service',
    tags: ['cloud', 'azure', 'microsoft', 'infrastructure'],
  },

  // ── Build Tools ────────────────────────────────────────────
  make: {
    description: 'Build automation tool',
    category: 'system',
    risk: 'medium',
    riskReason: 'Executes Makefile targets which can run arbitrary commands',
    tags: ['build', 'compile', 'automation', 'makefile'],
  },
  cmake: {
    description: 'Cross-platform build system generator',
    category: 'system',
    risk: 'medium',
    riskReason: 'Generates build files that can run arbitrary commands',
    tags: ['build', 'compile', 'generate', 'cross-platform'],
  },
  nx: {
    description: 'Monorepo build system',
    category: 'system',
    risk: 'medium',
    riskReason: 'Can run arbitrary scripts defined in project configuration',
    tags: ['monorepo', 'build', 'workspace', 'tasks'],
  },

  // ── Editors / Utilities ────────────────────────────────────
  vi: {
    description: 'Visual text editor',
    category: 'system',
    risk: 'medium',
    riskReason: 'Can execute shell commands from within editor',
    tags: ['editor', 'text', 'file', 'edit'],
  },
  vim: {
    description: 'Vi IMproved text editor',
    category: 'system',
    risk: 'medium',
    riskReason: 'Can execute shell commands from within editor',
    tags: ['editor', 'text', 'file', 'edit'],
  },
  nano: {
    description: 'Simple terminal text editor',
    category: 'system',
    risk: 'low',
    riskReason: 'File editing only, no command execution',
    tags: ['editor', 'text', 'file', 'edit', 'simple'],
  },
  less: {
    description: 'File pager — view file contents',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only file viewing',
    tags: ['view', 'pager', 'read', 'file'],
  },
  more: {
    description: 'File pager',
    category: 'system',
    risk: 'low',
    riskReason: 'Read-only file viewing',
    tags: ['view', 'pager', 'read', 'file'],
  },
};

/**
 * Score and search catalog entries.
 *
 * Multi-word queries score each token independently and sum.
 * Returns results sorted by score descending, sliced to `limit`.
 */
export function searchCatalog(
  query: string,
  entries: Record<string, CatalogEntry> = COMMAND_CATALOG,
  limit = 20,
): Array<{ name: string; entry: CatalogEntry; score: number }> {
  const q = query.toLowerCase().trim();
  if (!q) {
    return Object.entries(entries)
      .slice(0, limit)
      .map(([name, entry]) => ({ name, entry, score: 0 }));
  }

  const tokens = q.split(/\s+/);
  const results: Array<{ name: string; entry: CatalogEntry; score: number }> = [];

  for (const [name, entry] of Object.entries(entries)) {
    let totalScore = 0;
    const nameLower = name.toLowerCase();
    const descLower = entry.description.toLowerCase();

    for (const token of tokens) {
      let tokenScore = 0;

      // Name matching
      if (nameLower === token) {
        tokenScore = 100;
      } else if (nameLower.startsWith(token)) {
        tokenScore = 60;
      } else if (nameLower.includes(token)) {
        tokenScore = 40;
      }

      // Tag matching
      for (const tag of entry.tags) {
        const tagLower = tag.toLowerCase();
        if (tagLower === token) {
          tokenScore = Math.max(tokenScore, 30);
        } else if (tagLower.includes(token)) {
          tokenScore = Math.max(tokenScore, 15);
        }
      }

      // Description matching
      if (descLower.includes(token)) {
        tokenScore = Math.max(tokenScore, 10);
      }

      totalScore += tokenScore;
    }

    if (totalScore > 0) {
      results.push({ name, entry, score: totalScore });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
