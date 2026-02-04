/**
 * Seatbelt Profile Templates
 *
 * Base templates for different operation types.
 */

export class SeatbeltTemplates {
  /**
   * Base profile with minimal permissions
   */
  baseProfile(): string {
    return `
(version 1)
(deny default)

;; Allow reading system libraries
(allow file-read*
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/usr/share"))

;; Allow basic process operations
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
`.trim();
  }

  /**
   * Profile for file read operations
   */
  fileReadProfile(targetPath: string): string {
    return `
(version 1)
(deny default)

;; Allow reading system libraries
(allow file-read*
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/usr/share"))

;; Allow reading target path
(allow file-read*
  (subpath "${targetPath}"))

;; Deny all network
(deny network*)

;; Allow basic process operations
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
`.trim();
  }

  /**
   * Profile for file write operations
   */
  fileWriteProfile(targetPath: string): string {
    return `
(version 1)
(deny default)

;; Allow reading system libraries
(allow file-read*
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/usr/share"))

;; Allow reading and writing target path
(allow file-read* file-write*
  (subpath "${targetPath}"))

;; Deny all network
(deny network*)

;; Allow basic process operations
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)
`.trim();
  }

  /**
   * Profile for HTTP request operations
   */
  httpRequestProfile(host?: string, port?: number): string {
    const networkRule = host && port
      ? `(allow network-outbound (remote tcp "${host}:${port}"))`
      : '(deny network*)';

    return `
(version 1)
(deny default)

;; Allow reading system libraries
(allow file-read*
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/private/var/db")
  (subpath "/Library/Preferences"))

;; Network access
${networkRule}

;; Allow DNS resolution
(allow network-outbound
  (remote udp "*:53")
  (remote tcp "*:53"))

;; Allow basic process operations
(allow process-fork)
(allow signal (target self))
(allow sysctl-read)

;; Allow mach lookups for network
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.networkd")
  (global-name "com.apple.nsurlsessiond"))
`.trim();
  }

  /**
   * Profile for command execution
   */
  execProfile(binaryPath?: string): string {
    const execRule = binaryPath
      ? `(allow process-exec (literal "${binaryPath}"))`
      : '(deny process-exec)';

    return `
(version 1)
(deny default)

;; Allow reading system libraries and binaries
(allow file-read*
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/usr/bin")
  (subpath "/bin")
  (subpath "/usr/share"))

;; Execution permission
${execRule}
(allow process-exec
  (literal "/bin/sh")
  (literal "/bin/bash")
  (literal "/usr/bin/env"))

;; Deny all network
(deny network*)

;; Allow process operations
(allow process-fork)
(allow signal)
(allow sysctl-read)
`.trim();
  }

  /**
   * Profile for broker daemon (has network)
   */
  brokerProfile(socketPath: string): string {
    return `
(version 1)
(deny default)

;; Allow reading system libraries
(allow file-read*
  (subpath "/System")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/private/var/db")
  (subpath "/Library/Preferences")
  (subpath "/opt/agenshield"))

;; Allow config and policy access
(allow file-read* file-write*
  (subpath "/opt/agenshield")
  (subpath "/var/log/agenshield")
  (subpath "/etc/agenshield"))

;; Allow socket operations
(allow file-read* file-write*
  (literal "${socketPath}")
  (subpath "/var/run/agenshield"))

;; Allow outbound network (broker needs it)
(allow network*)

;; Allow process operations
(allow process-fork)
(allow process-exec)
(allow signal)
(allow sysctl-read)

;; Allow mach lookups
(allow mach-lookup)
`.trim();
  }

  /**
   * Deny-all profile for testing
   */
  denyAllProfile(): string {
    return `
(version 1)
(deny default)
`.trim();
  }
}
