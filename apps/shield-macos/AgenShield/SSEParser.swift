/*
 * SSEParser.swift — Server-Sent Events (text/event-stream) parser
 *
 * Parses the SSE format matching libs/shield-daemon/src/routes/sse.ts:
 *   event: <type>\n
 *   data: <json>\n
 *   \n
 *
 * Yields (eventType, jsonData) tuples as complete events are received.
 */

import Foundation

struct SSEEvent {
    let event: String
    let data: String
}

class SSEParser {
    private var buffer = ""
    private var currentEvent: String?
    private var currentData: String?

    /// Feed raw text data from the stream. Returns any complete events parsed.
    func feed(_ text: String) -> [SSEEvent] {
        buffer += text
        var events: [SSEEvent] = []

        while let newlineRange = buffer.range(of: "\n") {
            let line = String(buffer[buffer.startIndex..<newlineRange.lowerBound])
            buffer = String(buffer[newlineRange.upperBound...])

            if line.isEmpty {
                // Empty line = end of event
                if let event = currentEvent, let data = currentData {
                    events.append(SSEEvent(event: event, data: data))
                }
                currentEvent = nil
                currentData = nil
            } else if line.hasPrefix("event:") {
                currentEvent = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                let dataLine = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                if currentData != nil {
                    currentData! += "\n" + dataLine
                } else {
                    currentData = dataLine
                }
            }
            // Ignore id:, retry:, and comment lines (starting with :)
        }

        return events
    }

    /// Reset the parser state
    func reset() {
        buffer = ""
        currentEvent = nil
        currentData = nil
    }
}
