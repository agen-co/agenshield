/*
 * AppDelegate.swift — NSApplicationDelegate for menu bar + notifications
 *
 * Owns the NSStatusItem (with autosaveName for menu bar persistence),
 * NSPopover (hosting SwiftUI PopoverContent), AppState, and DaemonConnection.
 * Also handles UNUserNotificationCenter delegate callbacks.
 */

import AppKit
import SwiftUI
import UserNotifications
import os

private let logger = Logger(subsystem: "com.frontegg.AgenShield", category: "delegate")

class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate, NSPopoverDelegate {

    let appState = AppState()
    let connection = DaemonConnection()
    private var statusItem: NSStatusItem!
    private let popover = NSPopover()
    private var statusDotView: NSView?

    // MARK: - Application Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        logger.info("Application did finish launching")

        // Notification setup
        UNUserNotificationCenter.current().delegate = self
        NotificationService.shared.requestPermission()
        NotificationService.shared.checkAuthorizationStatus()

        // Create status item with autosaveName so macOS persists its position
        // and treats it as higher priority (prevents hiding on notch Macs)
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.autosaveName = "com.frontegg.AgenShield.statusItem"

        if let button = statusItem.button {
            button.image = NSImage(named: "StatusBarIcon")
            button.image?.size = NSSize(width: 18, height: 18)
            button.image?.isTemplate = true
            button.action = #selector(togglePopover(_:))
            button.target = self

            // Add colored status dot as a sublayer (separate from template icon)
            let dot = NSView(frame: NSRect(x: 14, y: 0, width: 6, height: 6))
            dot.wantsLayer = true
            dot.layer?.cornerRadius = 3
            dot.layer?.backgroundColor = NSColor.systemGray.cgColor
            button.addSubview(dot)
            statusDotView = dot
        }

        // Configure popover with SwiftUI content
        let hostingController = NSHostingController(
            rootView: PopoverContent().environment(appState)
        )
        popover.contentViewController = hostingController
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self

        // Start SSE connection
        setupConnection()

        // Observe appState.statusColor to update the dot
        setupStatusObservation()
    }

    // MARK: - Status Item

    @objc private func togglePopover(_ sender: AnyObject?) {
        if popover.isShown {
            popover.performClose(nil)
        } else if let button = statusItem.button {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        }
    }

    // MARK: - NSPopoverDelegate

    func popoverDidClose(_ notification: Notification) {
        appState.popoverRoute = .main
    }

    // MARK: - Status Dot Observation

    private func setupStatusObservation() {
        func observe() {
            withObservationTracking {
                _ = appState.statusColor
            } onChange: {
                DispatchQueue.main.async { [weak self] in
                    self?.updateStatusDot()
                    observe()
                }
            }
        }
        observe()
        updateStatusDot()
    }

    private func updateStatusDot() {
        let nsColor: NSColor
        switch appState.statusColor {
        case .green:  nsColor = .systemGreen
        case .yellow: nsColor = .systemYellow
        case .red:    nsColor = .systemRed
        case .gray:   nsColor = .systemGray
        }
        statusDotView?.layer?.backgroundColor = nsColor.cgColor
    }

    // MARK: - Daemon Connection

    private func setupConnection() {
        connection.onEvent = { [weak self] event in
            guard let self = self else { return }
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
            if event.type == "setup:error" {
                if let dict = event.data.value as? [String: Any] {
                    let errorMessage = dict["error"] as? String ?? "Unknown error"
                    let errorTargetId = dict["targetId"] as? String
                    if errorTargetId == nil || errorTargetId == appState.shieldingTargetId {
                        appState.shieldError = errorMessage
                        appState.shieldingTargetId = nil
                        appState.shieldProgress = 0
                        appState.shieldProgressMessage = nil
                    }
                }
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
        connection.onConnectionChange = { [weak self] connected in
            self?.appState.setConnected(connected)
        }
        connection.connect()
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Show notifications even when app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        logger.debug("Will present notification: \(notification.request.content.body, privacy: .public)")
        completionHandler([.banner, .sound])
    }

    /// Handle notification action button taps
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        logger.info("Notification action: \(response.actionIdentifier, privacy: .public)")
        let port = readDaemonPort()
        let baseURL = "http://127.0.0.1:\(port)"

        let payload = response.notification.request.content.userInfo

        switch response.actionIdentifier {
        case "VIEW_DASHBOARD":
            openURL("\(baseURL)/")
        case "VIEW_DETAILS":
            openURL("\(baseURL)/policies")
        case "VIEW_SKILLS":
            openURL("\(baseURL)/skills")
        case "OPEN_IN_BROWSER":
            if let urlString = payload["url"] as? String {
                logger.info("Opening URL directly: \(urlString, privacy: .public)")
                openURL(urlString)
            }
        case UNNotificationDefaultActionIdentifier:
            // Default tap on open_url_request notification → open URL directly
            if let urlString = payload["url"] as? String {
                logger.info("Default action opening URL: \(urlString, privacy: .public)")
                openURL(urlString)
            } else {
                openURL("\(baseURL)/")
            }
        default:
            break
        }

        completionHandler()
    }

    private func openURL(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        NSWorkspace.shared.open(url)
    }

    private func readDaemonPort() -> Int {
        let configPath = NSHomeDirectory() + "/.agenshield/config.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: configPath)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let daemon = json["daemon"] as? [String: Any],
              let port = daemon["port"] as? Int else {
            return 5200
        }
        return port
    }
}
