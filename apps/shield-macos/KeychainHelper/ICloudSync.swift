/**
 * iCloud Drive Sync Operations
 *
 * Provides backup/restore operations using iCloud Drive folder access.
 * Works without App Sandbox — accesses ~/Library/Mobile Documents/ directly.
 * Provisioned container access (iCloud.com.frontegg.AgenShield) requires
 * signing and entitlements (production only).
 */

import Foundation

/// iCloud Drive base path for AgenShield backups
private let iCloudContainerName = "iCloud~com~frontegg~AgenShield"
private let iCloudFolderName = "AgenShield"

/// Files and directories to exclude from backup
private let defaultExcludePatterns = [
    "bin/",
    "lib/",
    "libexec/",
    "logs/",
    "*.tar.gz",
    "daemon.pid",
    "daemon.log",
    ".admin-token",
    "node_modules/",
    "ui-assets/",
    "*.sock",
    "run/",
    "dist/",
]

/// Files to include in backup
private let backupIncludePatterns = [
    "agenshield.db",
    "agenshield-activity.db",
    "vault.enc",
    ".vault-key",
    "version.json",
    "marketplace/",
    "skills/backup/",
    "quarantine/",
    "migrations.json",
    "config.json",
]

enum ICloudSync {

    /// Get the iCloud Drive documents path for AgenShield.
    /// Returns nil if iCloud Drive is not available.
    private static func getICloudPath() -> String? {
        let home = NSHomeDirectory()

        // Direct iCloud Drive access (unsandboxed)
        let mobileDocs = (home as NSString).appendingPathComponent("Library/Mobile Documents")
        let containerPath = (mobileDocs as NSString).appendingPathComponent(iCloudContainerName)

        if FileManager.default.fileExists(atPath: containerPath) {
            return (containerPath as NSString).appendingPathComponent("Documents/\(iCloudFolderName)")
        }

        // Fallback: try generic iCloud Drive folder
        let genericPath = (mobileDocs as NSString).appendingPathComponent("com~apple~CloudDocs/\(iCloudFolderName)")
        // Create directory if iCloud Drive exists but our folder doesn't
        let cloudDocsBase = (mobileDocs as NSString).appendingPathComponent("com~apple~CloudDocs")
        if FileManager.default.fileExists(atPath: cloudDocsBase) {
            return genericPath
        }

        return nil
    }

    /// Detect if an iCloud backup exists.
    static func detect() -> Response {
        guard let icloudPath = getICloudPath() else {
            return Response(success: true, backupFound: false, error: nil)
        }

        let backupPath = icloudPath
        let fm = FileManager.default

        if fm.fileExists(atPath: backupPath) {
            // Check for presence of agenshield.db as a valid backup indicator
            let dbPath = (backupPath as NSString).appendingPathComponent("agenshield.db")
            if fm.fileExists(atPath: dbPath) {
                // Get modification date
                var backupDate: String? = nil
                if let attrs = try? fm.attributesOfItem(atPath: dbPath),
                   let modDate = attrs[.modificationDate] as? Date {
                    let formatter = ISO8601DateFormatter()
                    backupDate = formatter.string(from: modDate)
                }

                // List backup files
                var files: [String] = []
                if let enumerator = fm.enumerator(atPath: backupPath) {
                    while let file = enumerator.nextObject() as? String {
                        files.append(file)
                    }
                }

                return Response(
                    success: true,
                    backupFound: true,
                    backupPath: backupPath,
                    backupDate: backupDate,
                    files: files
                )
            }
        }

        return Response(success: true, backupFound: false)
    }

    /// Backup AgenShield data to iCloud Drive.
    static func backup(sourcePath: String, excludePatterns: [String]) -> Response {
        guard let icloudPath = getICloudPath() else {
            return Response(success: false, error: "iCloud Drive not available")
        }

        let fm = FileManager.default

        // Create backup directory
        do {
            try fm.createDirectory(atPath: icloudPath, withIntermediateDirectories: true)
        } catch {
            return Response(success: false, error: "Failed to create iCloud directory: \(error.localizedDescription)")
        }

        let allExcludes = defaultExcludePatterns + excludePatterns
        var copiedFiles: [String] = []

        // Walk the source directory
        guard let enumerator = fm.enumerator(atPath: sourcePath) else {
            return Response(success: false, error: "Cannot enumerate source path: \(sourcePath)")
        }

        while let relativePath = enumerator.nextObject() as? String {
            // Check exclusions
            if shouldExclude(relativePath, patterns: allExcludes) {
                if enumerator.fileAttributes?[.type] as? FileAttributeType == .typeDirectory {
                    enumerator.skipDescendants()
                }
                continue
            }

            let srcFull = (sourcePath as NSString).appendingPathComponent(relativePath)
            let dstFull = (icloudPath as NSString).appendingPathComponent(relativePath)

            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: srcFull, isDirectory: &isDir) else { continue }

            if isDir.boolValue {
                try? fm.createDirectory(atPath: dstFull, withIntermediateDirectories: true)
            } else {
                // Create parent directory
                let dstDir = (dstFull as NSString).deletingLastPathComponent
                try? fm.createDirectory(atPath: dstDir, withIntermediateDirectories: true)

                // Copy file (overwrite if exists)
                if fm.fileExists(atPath: dstFull) {
                    try? fm.removeItem(atPath: dstFull)
                }
                do {
                    try fm.copyItem(atPath: srcFull, toPath: dstFull)
                    copiedFiles.append(relativePath)
                } catch {
                    // Log but continue
                    FileHandle.standardError.write(
                        Data("Warning: Failed to copy \(relativePath): \(error.localizedDescription)\n".utf8)
                    )
                }
            }
        }

        return Response(success: true, files: copiedFiles)
    }

    /// Restore AgenShield data from iCloud Drive backup.
    static func restore(destPath: String) -> Response {
        guard let icloudPath = getICloudPath() else {
            return Response(success: false, error: "iCloud Drive not available")
        }

        let fm = FileManager.default

        guard fm.fileExists(atPath: icloudPath) else {
            return Response(success: false, error: "No backup found at \(icloudPath)")
        }

        // Create destination directory
        do {
            try fm.createDirectory(atPath: destPath, withIntermediateDirectories: true)
        } catch {
            return Response(success: false, error: "Failed to create destination: \(error.localizedDescription)")
        }

        var restoredFiles: [String] = []

        guard let enumerator = fm.enumerator(atPath: icloudPath) else {
            return Response(success: false, error: "Cannot enumerate backup path")
        }

        while let relativePath = enumerator.nextObject() as? String {
            let srcFull = (icloudPath as NSString).appendingPathComponent(relativePath)
            let dstFull = (destPath as NSString).appendingPathComponent(relativePath)

            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: srcFull, isDirectory: &isDir) else { continue }

            if isDir.boolValue {
                try? fm.createDirectory(atPath: dstFull, withIntermediateDirectories: true)
            } else {
                let dstDir = (dstFull as NSString).deletingLastPathComponent
                try? fm.createDirectory(atPath: dstDir, withIntermediateDirectories: true)

                if fm.fileExists(atPath: dstFull) {
                    try? fm.removeItem(atPath: dstFull)
                }
                do {
                    try fm.copyItem(atPath: srcFull, toPath: dstFull)
                    restoredFiles.append(relativePath)
                } catch {
                    FileHandle.standardError.write(
                        Data("Warning: Failed to restore \(relativePath): \(error.localizedDescription)\n".utf8)
                    )
                }
            }
        }

        return Response(success: true, files: restoredFiles)
    }

    /// Check if a relative path matches any exclude pattern.
    private static func shouldExclude(_ relativePath: String, patterns: [String]) -> Bool {
        for pattern in patterns {
            if pattern.hasSuffix("/") {
                // Directory pattern
                let dirName = String(pattern.dropLast())
                if relativePath == dirName || relativePath.hasPrefix(dirName + "/") {
                    return true
                }
                // Also match path components
                let components = relativePath.split(separator: "/")
                if components.contains(Substring(dirName)) {
                    return true
                }
            } else if pattern.hasPrefix("*.") {
                // Extension pattern
                let ext = String(pattern.dropFirst(1))
                if relativePath.hasSuffix(ext) {
                    return true
                }
            } else {
                // Exact match
                if relativePath == pattern {
                    return true
                }
                // Or filename match
                let filename = (relativePath as NSString).lastPathComponent
                if filename == pattern {
                    return true
                }
            }
        }
        return false
    }
}
