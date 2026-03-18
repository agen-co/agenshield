/*
 * DaemonConnection.swift — SSE client for the AgenShield daemon
 *
 * Connects to http://127.0.0.1:{port}/sse/events using URLSession streaming.
 * Reads port from ~/.agenshield/config.json or defaults to 5200.
 * Auto-reconnects with exponential backoff (1s → 2s → 4s → max 30s).
 */

import Foundation
import os

private let logger = Logger(subsystem: "com.frontegg.AgenShield", category: "connection")

@Observable
class DaemonConnection {
    private var task: URLSessionDataTask?
    private var session: URLSession?
    private var parser = SSEParser()
    private var backoffSeconds: TimeInterval = 1
    private var reconnectWorkItem: DispatchWorkItem?
    private var isRunning = false

    var onEvent: ((DaemonEvent) -> Void)?
    var onConnectionChange: ((Bool) -> Void)?

    /// Start the SSE connection
    func connect() {
        guard !isRunning else { return }
        isRunning = true
        startConnection()
    }

    /// Disconnect and stop auto-reconnect
    func disconnect() {
        logger.info("Disconnecting SSE client")
        isRunning = false
        reconnectWorkItem?.cancel()
        reconnectWorkItem = nil
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        parser.reset()
        onConnectionChange?(false)
    }

    private func startConnection() {
        guard isRunning else { return }

        let port = readDaemonPort()
        guard let url = URL(string: "http://127.0.0.1:\(port)/sse/events") else {
            logger.error("Failed to construct SSE URL for port \(port)")
            scheduleReconnect()
            return
        }

        logger.info("Connecting to SSE at \(url.absoluteString, privacy: .public)")

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = .infinity
        config.timeoutIntervalForResource = .infinity

        let delegate = SSESessionDelegate(
            onData: { [weak self] data in
                self?.handleData(data)
            },
            onComplete: { [weak self] error in
                self?.handleDisconnect(error: error)
            },
            onResponse: { [weak self] statusCode in
                logger.info("SSE HTTP response: \(statusCode)")
                if (200..<300).contains(statusCode) {
                    self?.backoffSeconds = 1
                    DispatchQueue.main.async {
                        self?.onConnectionChange?(true)
                    }
                } else {
                    logger.warning("SSE non-success status \(statusCode), will reconnect")
                }
            }
        )

        session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)

        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        task = session?.dataTask(with: request)
        task?.resume()
    }

    private func handleData(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        let events = parser.feed(text)

        for sseEvent in events {
            guard sseEvent.event != "heartbeat" else { continue }
            guard let jsonData = sseEvent.data.data(using: .utf8) else { continue }

            do {
                let daemonEvent = try JSONDecoder().decode(DaemonEvent.self, from: jsonData)
                DispatchQueue.main.async { [weak self] in
                    self?.onEvent?(daemonEvent)
                }
            } catch {
                logger.warning("Failed to decode SSE event: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private func handleDisconnect(error: Error?) {
        if let error = error {
            logger.warning("SSE disconnected with error: \(error.localizedDescription, privacy: .public)")
        } else {
            logger.info("SSE disconnected")
        }
        parser.reset()
        DispatchQueue.main.async { [weak self] in
            self?.onConnectionChange?(false)
        }
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard isRunning else { return }

        reconnectWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            self?.startConnection()
        }
        reconnectWorkItem = workItem

        logger.info("Scheduling reconnect in \(self.backoffSeconds, format: .fixed(precision: 0))s")
        DispatchQueue.main.asyncAfter(deadline: .now() + backoffSeconds, execute: workItem)
        backoffSeconds = min(backoffSeconds * 2, 30)
    }

    /// Read daemon port from ~/.agenshield/config.json
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

/// URLSession delegate that forwards streaming data
private class SSESessionDelegate: NSObject, URLSessionDataDelegate {
    let onData: (Data) -> Void
    let onComplete: (Error?) -> Void
    let onResponse: (Int) -> Void

    init(
        onData: @escaping (Data) -> Void,
        onComplete: @escaping (Error?) -> Void,
        onResponse: @escaping (Int) -> Void
    ) {
        self.onData = onData
        self.onComplete = onComplete
        self.onResponse = onResponse
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        onData(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        onComplete(error)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        onResponse(statusCode)
        completionHandler(.allow)
    }
}
