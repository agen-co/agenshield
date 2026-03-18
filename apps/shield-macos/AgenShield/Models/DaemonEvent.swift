/*
 * DaemonEvent.swift — Codable model for daemon SSE events
 *
 * Matches the DaemonEvent structure from libs/shield-daemon/src/events/emitter.ts:
 *   { type: string, timestamp: string, data: object, profileId?: string, source?: string }
 */

import Foundation

struct DaemonEvent: Codable, Identifiable {
    let type: String
    let timestamp: String
    let data: AnyCodable
    let profileId: String?
    let source: String?

    var id: String { "\(type)_\(timestamp)" }

    /// Parse the ISO 8601 timestamp
    var date: Date? {
        ISO8601DateFormatter().date(from: timestamp)
    }

    /// Human-readable time ago string
    var timeAgo: String {
        guard let date = date else { return "" }
        let interval = Date().timeIntervalSince(date)
        if interval < 60 { return "\(Int(interval))s ago" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86400 { return "\(Int(interval / 3600))h ago" }
        return "\(Int(interval / 86400))d ago"
    }

    /// Display-friendly event description
    var displayTitle: String {
        let parts = type.split(separator: ":")
        guard parts.count >= 2 else { return type }
        let action = parts[1].replacingOccurrences(of: "_", with: " ")
        return action.prefix(1).uppercased() + action.dropFirst()
    }

    /// Event channel (prefix before the colon)
    var channel: String {
        String(type.split(separator: ":").first ?? Substring(type))
    }
}

/// Type-erased Codable wrapper for arbitrary JSON data
struct AnyCodable: Codable {
    let value: Any?

    init(_ value: Any?) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = nil
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            var result: [String: Any] = [:]
            for (key, val) in dict {
                if let v = val.value { result[key] = v }
            }
            value = result
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.compactMap { $0.value }
        } else {
            value = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if value == nil {
            try container.encodeNil()
        } else if let bool = value as? Bool {
            try container.encode(bool)
        } else if let int = value as? Int {
            try container.encode(int)
        } else if let double = value as? Double {
            try container.encode(double)
        } else if let string = value as? String {
            try container.encode(string)
        } else {
            try container.encodeNil()
        }
    }
}
