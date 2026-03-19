import SwiftUI
import os

private let logger = Logger(subsystem: "com.frontegg.AgenShield", category: "app")

@main
struct AgenShieldApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var appState = AppState()
    @State private var connection = DaemonConnection()

    init() {
        logger.info("Menu bar mode: launching UI (args: \(CommandLine.arguments.dropFirst().joined(separator: " "), privacy: .public))")
    }

    var body: some Scene {
        MenuBarExtra {
            PopoverContent()
                .environment(appState)
        } label: {
            StatusIcon()
                .environment(appState)
                .onAppear { setupConnection() }
        }
        .menuBarExtraStyle(.window)
    }

    private func setupConnection() {
        connection.onEvent = { [appState] event in
            logger.debug("Received event: \(event.type, privacy: .public)")

            // Parse daemon:status events for live stats updates
            if event.type == "daemon:status" {
                appState.updateFromDaemonStatusEvent(event.data)
                return
            }

            // Parse target status events for live instance updates
            if event.type == "targets:status" {
                appState.updateFromTargetStatusEvent(event.data)
                return
            }

            // Shield progress events
            if event.type == "setup:shield_progress" {
                if let dict = event.data.value as? [String: Any] {
                    appState.shieldProgress = dict["progress"] as? Int ?? 0
                    appState.shieldProgressMessage = dict["message"] as? String
                }
                return
            }
            if event.type == "setup:shield_complete" {
                appState.shieldingTargetId = nil
                appState.shieldProgress = 100
                appState.updateTargets()
                return
            }

            // Refresh quarantined skills on workspace skill events
            if event.type.hasPrefix("workspace_skills:") {
                appState.updateQuarantinedSkills()
                appState.updateDaemonStatus()
            }

            // Send native notifications for relevant events
            NotificationService.shared.notify(for: event)

            // Refresh setup status on enrollment events
            if event.type.hasPrefix("enrollment:") {
                appState.updateSetupStatus()
                appState.updateDaemonStatus()
            }
        }
        connection.onConnectionChange = { [appState] connected in
            appState.setConnected(connected)
        }
        connection.connect()
    }
}
