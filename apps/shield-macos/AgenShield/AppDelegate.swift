/*
 * AppDelegate.swift — NSApplicationDelegate for notification handling
 *
 * Handles UNUserNotificationCenter delegate callbacks and notification
 * action responses (e.g., "View Dashboard" → opens browser).
 */

import AppKit
import UserNotifications
import os

private let logger = Logger(subsystem: "com.frontegg.AgenShield", category: "delegate")

class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        logger.info("Application did finish launching")
        UNUserNotificationCenter.current().delegate = self
        NotificationService.shared.requestPermission()
        NotificationService.shared.checkAuthorizationStatus()
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
