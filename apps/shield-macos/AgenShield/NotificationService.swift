/*
 * NotificationService.swift — macOS notification wrapper
 *
 * Sends native macOS notifications via UNUserNotificationCenter.
 * Handles permission requests, notification categories, and rate limiting.
 */

import Foundation
import UserNotifications
import os

private let logger = Logger(subsystem: "com.frontegg.AgenShield", category: "notifications")

class NotificationService {
    static let shared = NotificationService()

    private let center = UNUserNotificationCenter.current()
    private var lastNotificationTimes: [String: Date] = [:]
    private var batchCounts: [String: Int] = [:]
    private init() {}

    /// Request notification permissions on first launch
    func requestPermission() {
        logger.info("Requesting notification authorization")
        center.requestAuthorization(options: [.alert, .sound, .badge, .provisional]) { granted, error in
            if let error = error {
                logger.error("Notification authorization error: \(error.localizedDescription, privacy: .public)")
            } else {
                logger.info("Notification authorization \(granted ? "granted" : "denied", privacy: .public)")
            }
        }
        registerCategories()
    }

    /// Check and log the current notification authorization status
    func checkAuthorizationStatus() {
        center.getNotificationSettings { settings in
            let status: String
            switch settings.authorizationStatus {
            case .authorized: status = "authorized"
            case .denied: status = "denied"
            case .notDetermined: status = "notDetermined"
            case .provisional: status = "provisional"
            case .ephemeral: status = "ephemeral"
            @unknown default: status = "unknown"
            }
            logger.info("Notification authorization status: \(status, privacy: .public), alert: \(String(describing: settings.alertSetting), privacy: .public), sound: \(String(describing: settings.soundSetting), privacy: .public), badge: \(String(describing: settings.badgeSetting), privacy: .public)")
            if settings.authorizationStatus == .denied {
                logger.warning("Notifications are denied — enable in System Settings > Notifications > AgenShield")
            }
        }
    }

    /// Register notification action categories
    private func registerCategories() {
        let viewDashboard = UNNotificationAction(
            identifier: "VIEW_DASHBOARD",
            title: "View Dashboard",
            options: [.foreground]
        )
        let viewDetails = UNNotificationAction(
            identifier: "VIEW_DETAILS",
            title: "View Details",
            options: [.foreground]
        )
        let viewSkills = UNNotificationAction(
            identifier: "VIEW_SKILLS",
            title: "View Skills",
            options: [.foreground]
        )

        let securityCategory = UNNotificationCategory(
            identifier: "security",
            actions: [viewDashboard],
            intentIdentifiers: []
        )
        let enforcementCategory = UNNotificationCategory(
            identifier: "enforcement",
            actions: [viewDetails],
            intentIdentifiers: []
        )
        let skillsCategory = UNNotificationCategory(
            identifier: "skills",
            actions: [viewSkills],
            intentIdentifiers: []
        )
        let enrollmentCategory = UNNotificationCategory(
            identifier: "enrollment",
            actions: [viewDashboard],
            intentIdentifiers: []
        )

        let workspaceCategory = UNNotificationCategory(
            identifier: "workspace",
            actions: [viewDashboard],
            intentIdentifiers: []
        )

        let openInBrowser = UNNotificationAction(
            identifier: "OPEN_IN_BROWSER",
            title: "Open in Browser",
            options: [.foreground]
        )
        let urlApprovalCategory = UNNotificationCategory(
            identifier: "url_approval",
            actions: [openInBrowser],
            intentIdentifiers: []
        )

        center.setNotificationCategories([
            securityCategory, enforcementCategory, skillsCategory, enrollmentCategory, workspaceCategory, urlApprovalCategory,
        ])
    }

    /// Send a notification for a daemon event (respects rate limiting)
    func notify(for event: DaemonEvent) {
        guard NotificationConfig.shouldNotify(event.type) else {
            logger.debug("Skipping notification for event type: \(event.type, privacy: .public) (not in notify list)")
            return
        }

        // Rate limiting
        let now = Date()
        if let lastTime = lastNotificationTimes[event.type],
           now.timeIntervalSince(lastTime) < NotificationConfig.rateLimitInterval {
            // Increment batch counter
            batchCounts[event.type, default: 0] += 1
            logger.debug("Rate limited event \(event.type, privacy: .public), batch count: \(self.batchCounts[event.type, default: 0])")
            if batchCounts[event.type, default: 0] >= NotificationConfig.batchThreshold {
                sendBatchNotification(for: event.type, count: batchCounts[event.type, default: 0])
                batchCounts[event.type] = 0
                lastNotificationTimes[event.type] = now
            }
            return
        }

        lastNotificationTimes[event.type] = now
        batchCounts[event.type] = 0
        sendNotification(for: event)
    }

    private func sendNotification(for event: DaemonEvent) {
        let content = UNMutableNotificationContent()
        content.title = "AgenShield"
        content.body = notificationBody(for: event)
        content.categoryIdentifier = NotificationConfig.category(for: event.type)

        if NotificationConfig.shouldPlaySound(event.type) {
            content.sound = .default
        }

        // Attach metadata for actionable notifications (e.g. URL approval)
        if event.type == "api:open_url_request",
           let dict = event.data.value as? [String: Any] {
            var userInfo: [String: Any] = [:]
            if let requestId = dict["requestId"] as? String {
                userInfo["requestId"] = requestId
            }
            if let url = dict["url"] as? String {
                userInfo["url"] = url
            }
            content.userInfo = userInfo
        }

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )

        logger.info("Sending notification for \(event.type, privacy: .public): \(content.body, privacy: .public)")
        center.add(request) { error in
            if let error = error {
                logger.error("Failed to deliver notification for \(event.type, privacy: .public): \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private func sendBatchNotification(for eventType: String, count: Int) {
        let content = UNMutableNotificationContent()
        content.title = "AgenShield"
        content.body = "\(count)+ \(eventType.replacingOccurrences(of: ":", with: " ")) events"
        content.categoryIdentifier = NotificationConfig.category(for: eventType)

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )

        center.add(request) { error in
            if let error = error {
                logger.error("Failed to deliver batch notification for \(eventType, privacy: .public): \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// Extract a string value from the event's data dictionary
    private func dataString(_ event: DaemonEvent, key: String) -> String? {
        guard let dict = event.data.value as? [String: Any] else { return nil }
        return dict[key] as? String
    }

    private func notificationBody(for event: DaemonEvent) -> String {
        switch event.type {
        case "enrollment:complete":
            let company = dataString(event, key: "companyName") ?? "your organization"
            return "Successfully enrolled with \(company)"
        case "skills:downloaded":
            let name = dataString(event, key: "name") ?? "Unknown"
            return "Skill \"\(name)\" has been downloaded"
        case "skills:integrity_violation":
            let name = dataString(event, key: "name") ?? "Unknown"
            return "Skill \"\(name)\" files may have been tampered"
        case "skills:quarantined":
            let name = dataString(event, key: "name") ?? "Unknown"
            return "Skill \"\(name)\" has been quarantined"
        case "workspace_skills:detected":
            let wsSkillName = dataString(event, key: "skillName") ?? "Unknown"
            return "New skill \"\(wsSkillName)\" quarantined — approval required"
        case "workspace_skills:tampered":
            let tamperedName = dataString(event, key: "skillName") ?? "Unknown"
            return "Skill \"\(tamperedName)\" was modified — re-quarantined"
        case "workspace_skills:approved":
            let approvedName = dataString(event, key: "skillName") ?? "Unknown"
            return "Skill \"\(approvedName)\" has been approved"
        case "workspace_skills:denied":
            let deniedName = dataString(event, key: "skillName") ?? "Unknown"
            return "Skill \"\(deniedName)\" has been denied"
        case "workspace_skills:revoked":
            let revokedName = dataString(event, key: "skillName") ?? "Unknown"
            return "Skill \"\(revokedName)\" approval was revoked"
        case "workspace_skills:cloud_forced":
            let forcedName = dataString(event, key: "skillName") ?? "Unknown"
            return "Skill \"\(forcedName)\" was pushed by organization"
        case "workspace_skills:removed":
            let removedName = dataString(event, key: "skillName") ?? "Unknown"
            return "Skill \"\(removedName)\" was removed"
        case "skills:untrusted_detected":
            let name = dataString(event, key: "name") ?? "Unknown"
            return "Untrusted skill \"\(name)\" detected"
        case "workspace:path_granted":
            let wsPath = dataString(event, key: "path") ?? "unknown path"
            return "New workspace directory added: \(wsPath)"
        case "enforcement:process_killed":
            let command = dataString(event, key: "commandPreview")
                ?? dataString(event, key: "command")
                ?? "unknown process"
            let policy = dataString(event, key: "policyName") ?? "managed policy"
            return "Process \"\(command)\" was killed by \(policy)"
        case "enforcement:process_violation":
            let command = dataString(event, key: "commandPreview")
                ?? dataString(event, key: "command")
                ?? "unknown process"
            return "Process \"\(command)\" violated policy"
        case "security:critical":
            return dataString(event, key: "message") ?? "Critical security event detected"
        case "security:locked":
            let reason = dataString(event, key: "reason") ?? "security policy"
            return "Security locked: \(reason)"
        case "security:config_tampered":
            return "Security configuration tampering detected"
        case "security:warning":
            return dataString(event, key: "message") ?? "Security warning"
        case "security:alert":
            return dataString(event, key: "message") ?? "Security alert"
        case "resource:limit_enforced":
            return "Resource limit enforced"
        case "api:open_url_request":
            let url = dataString(event, key: "url") ?? "unknown URL"
            return "Agent wants to open: \(url)"
        default:
            return event.displayTitle
        }
    }
}
