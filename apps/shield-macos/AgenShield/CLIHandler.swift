/*
 * CLIHandler.swift — CLI argument handling extracted from main.swift
 *
 * When the app is launched with CLI arguments (--install-es, --uninstall-es, --status),
 * this handler processes them and exits. This preserves the original CLI behavior
 * while the app's @main entry point handles menu bar mode when no args are present.
 */

import Foundation
import SystemExtensions

enum CLIHandler {

    /// Known CLI commands that trigger CLI mode
    static let knownCommands: Set<String> = ["--install-es", "--uninstall-es", "--status", "--help", "-h"]

    /// Returns true if any CLI argument (after argv[0]) is a known CLI command
    static var hasCLICommand: Bool {
        CommandLine.arguments.dropFirst().contains(where: { knownCommands.contains($0) })
    }

    static func run() {
        let manager = ExtensionManager()

        guard let command = CommandLine.arguments.dropFirst().first(where: { knownCommands.contains($0) }) else {
            printUsage()
            exit(2)
        }

        switch command {
        case "--install-es":
            manager.install { exitCode in
                exit(exitCode)
            }

        case "--uninstall-es":
            manager.uninstall { exitCode in
                exit(exitCode)
            }

        case "--status":
            checkStatus()

        case "--help", "-h":
            printUsage()
            exit(0)

        default:
            fputs("Unknown command: \(command)\n", stderr)
            printUsage()
            exit(2)
        }

        // Run the main run loop to receive delegate callbacks
        RunLoop.main.run()
    }

    private static func printUsage() {
        let usage = """
        Usage: AgenShield <command>

        Commands:
          --install-es      Install and activate the ES system extension
          --uninstall-es    Deactivate and remove the ES system extension
          --status          Print current extension status

        Output tokens:
          OK                Operation completed successfully
          OK_AFTER_REBOOT   Operation will complete after reboot
          NEEDS_APPROVAL    User must approve in System Settings > Privacy & Security
          ERROR:<msg>       Operation failed with error message

        When launched without arguments, runs as a menu bar app.
        """
        print(usage)
    }

    private static func checkStatus() {
        let extensionId = "com.frontegg.AgenShield.es-extension"

        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/systemextensionsctl")
        task.arguments = ["list"]

        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe

        do {
            try task.run()
            task.waitUntilExit()

            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8) ?? ""

            if output.contains(extensionId) {
                if output.contains("[activated enabled]") {
                    print("ACTIVE")
                } else if output.contains("[activated waiting for user]") {
                    print("NEEDS_APPROVAL")
                } else {
                    print("INSTALLED_NOT_ACTIVE")
                }
            } else {
                print("NOT_INSTALLED")
            }
        } catch {
            // Under App Sandbox, Process execution may be denied.
            // Fall back to UNKNOWN status rather than crashing.
            print("ERROR:Cannot check status under App Sandbox — use the daemon API instead")
        }

        exit(0)
    }
}
