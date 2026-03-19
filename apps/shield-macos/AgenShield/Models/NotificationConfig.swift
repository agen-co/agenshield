/*
 * NotificationConfig.swift — Notification severity mapping and rate limiting
 *
 * Maps daemon event types to notification severity levels and controls
 * which events generate macOS notifications.
 */

import Foundation

enum NotificationSeverity: String {
    case critical   // Always notify with sound
    case medium     // Notify without sound (default on)
    case low        // Opt-in only
}

struct NotificationConfig {

    /// Rate limiting: max 1 notification per event type per this interval
    static let rateLimitInterval: TimeInterval = 5.0

    /// Maximum recent events to batch before showing a summary
    static let batchThreshold = 3

    /// Event type → severity mapping
    static let severityMap: [String: NotificationSeverity] = [
        // Critical — always notify with sound
        "security:critical": .critical,
        "security:locked": .critical,
        "security:config_tampered": .critical,
        "enforcement:process_killed": .critical,
        "skills:quarantined": .critical,
        "skills:untrusted_detected": .critical,
        "workspace_skills:detected": .critical,
        "workspace_skills:tampered": .critical,
        "api:open_url_request": .critical,

        // Medium — notify without sound (default on)
        "workspace:path_granted": .medium,
        "enrollment:complete": .medium,
        "enforcement:process_violation": .medium,
        "security:warning": .medium,
        "security:alert": .medium,
        "resource:limit_enforced": .medium,
        "skills:integrity_violation": .medium,

        // Low — opt-in
        "skills:downloaded": .low,
        "skills:installed": .low,
        "skills:uninstalled": .low,
        "process:started": .low,
        "process:stopped": .low,
        "process:broker_started": .low,
        "process:broker_stopped": .low,
        "config:policies_updated": .low,
    ]

    /// Notification category identifiers for UNNotificationCenter
    static let categories: [String: String] = [
        "security": "View Dashboard",
        "enforcement": "View Details",
        "skills": "View Skills",
        "enrollment": "View Dashboard",
        "workspace": "View Dashboard",
        "workspace_skills": "View Skills",
        "url_approval": "Open URL",
    ]

    /// Event types that should always notify regardless of severity level
    private static let alwaysNotify: Set<String> = [
        "enrollment:complete",
        "workspace:path_granted",
        "skills:downloaded",
    ]

    /// Check if an event type should generate a notification
    static func shouldNotify(_ eventType: String) -> Bool {
        if alwaysNotify.contains(eventType) { return true }
        guard let severity = severityMap[eventType] else { return false }
        switch severity {
        case .critical, .medium:
            return true
        case .low:
            return false
        }
    }

    /// Check if notification should play a sound
    static func shouldPlaySound(_ eventType: String) -> Bool {
        severityMap[eventType] == .critical
    }

    /// Get the notification category for an event type
    static func category(for eventType: String) -> String {
        // Special case: open_url_request uses its own approval category
        if eventType == "api:open_url_request" { return "url_approval" }
        let channel = String(eventType.split(separator: ":").first ?? "")
        return categories[channel] != nil ? channel : "security"
    }
}
