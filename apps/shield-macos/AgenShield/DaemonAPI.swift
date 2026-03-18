/*
 * DaemonAPI.swift — HTTP client for the AgenShield daemon setup API
 *
 * Provides methods to call the daemon's setup endpoints:
 *   GET  /api/setup/status
 *   POST /api/setup/local
 *   POST /api/setup/cloud
 *
 * Reads the daemon port from ~/.agenshield/config.json (defaults to 5200).
 */

import Foundation

// MARK: - Response Types

struct SetupStatus: Codable {
    let state: String            // "not-configured" | "pending" | "complete"
    let mode: String?            // "local" | "cloud"
    let cloudUrl: String?
    let completedAt: String?
}

struct SetupEnrollmentState: Codable {
    let state: String            // "idle" | "initiating" | "pending_user_auth" | "registering" | "complete" | "failed"
    let verificationUri: String?
    let userCode: String?
    let expiresAt: String?
    let error: String?
    let agentId: String?
    let companyName: String?
}

struct SetupStatusData: Codable {
    let setup: SetupStatus
    let enrollment: SetupEnrollmentState
    let cloudEnrolled: Bool
}

struct SetupLocalData: Codable {
    let adminToken: String
}

struct SetupCloudData: Codable {
    let enrollment: SetupEnrollmentState
}

struct DaemonStats: Codable {
    let events: Int
    let policies: Int
    let skills: Int
}

struct AutoShieldProgress: Codable {
    let current: Int
    let total: Int
    let currentTarget: String?
}

struct AutoShieldResult: Codable {
    let shielded: Int
    let failed: Int
    let skipped: Int
}

struct AutoShieldState: Codable {
    let state: String
    let progress: AutoShieldProgress?
    let result: AutoShieldResult?
    let error: String?
}

struct DaemonStatusData: Codable {
    let running: Bool
    let pid: Int?
    let uptime: Int?
    let version: String
    let port: Int
    let startedAt: String?
    let agentUsername: String?
    let servicesActive: Bool?
    let stats: DaemonStats?
    let cloudConnected: Bool?
    let cloudCompany: String?
    let enrollmentPending: Bool?
    let autoShield: AutoShieldState?
}

struct ApiResponse<T: Codable>: Codable {
    let success: Bool
    let data: T?
}

// MARK: - DaemonAPI

class DaemonAPI {
    static let shared = DaemonAPI()
    private let session = URLSession.shared

    private var baseURL: String {
        let port = readDaemonPort()
        return "http://127.0.0.1:\(port)"
    }

    // MARK: - Setup Endpoints

    func getSetupStatus() async throws -> SetupStatusData {
        let data = try await get("/api/setup/status")
        let response = try JSONDecoder().decode(ApiResponse<SetupStatusData>.self, from: data)
        guard response.success, let result = response.data else {
            throw DaemonAPIError.requestFailed
        }
        return result
    }

    func setupLocal() async throws -> SetupLocalData {
        let data = try await post("/api/setup/local", body: nil)
        let response = try JSONDecoder().decode(ApiResponse<SetupLocalData>.self, from: data)
        guard response.success, let result = response.data else {
            throw DaemonAPIError.requestFailed
        }
        return result
    }

    func setupCloud(cloudUrl: String) async throws -> SetupCloudData {
        let body = ["cloudUrl": cloudUrl]
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let data = try await post("/api/setup/cloud", body: bodyData)
        let response = try JSONDecoder().decode(ApiResponse<SetupCloudData>.self, from: data)
        guard response.success, let result = response.data else {
            throw DaemonAPIError.requestFailed
        }
        return result
    }

    // MARK: - Target Endpoints

    struct TargetProcessInfo: Codable {
        let pid: Int
        let elapsed: String
        let command: String
    }

    struct TargetLifecycleInfo: Codable {
        let id: String
        let name: String
        let type: String
        let shielded: Bool
        let running: Bool
        let version: String?
        let binaryPath: String?
        let gatewayPort: Int?
        let pid: Int?
        let processes: [TargetProcessInfo]?
    }

    func getTargets() async throws -> [TargetLifecycleInfo] {
        let data = try await get("/api/targets/lifecycle")
        let response = try JSONDecoder().decode(ApiResponse<[TargetLifecycleInfo]>.self, from: data)
        guard response.success, let result = response.data else {
            throw DaemonAPIError.requestFailed
        }
        return result
    }

    // MARK: - Status Endpoints

    func getDaemonStatus() async throws -> DaemonStatusData {
        let data = try await get("/api/status")
        let response = try JSONDecoder().decode(ApiResponse<DaemonStatusData>.self, from: data)
        guard response.success, let result = response.data else {
            throw DaemonAPIError.requestFailed
        }
        return result
    }

    func shutdownDaemon() async throws {
        _ = try await post("/api/shutdown", body: nil)
    }

    // MARK: - HTTP Helpers

    private func get(_ path: String) async throws -> Data {
        guard let url = URL(string: baseURL + path) else {
            throw DaemonAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw DaemonAPIError.requestFailed
        }
        return data
    }

    private func post(_ path: String, body: Data?) async throws -> Data {
        guard let url = URL(string: baseURL + path) else {
            throw DaemonAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        if let body = body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw DaemonAPIError.requestFailed
        }
        return data
    }

    // MARK: - Port Discovery

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

// MARK: - Errors

enum DaemonAPIError: Error, LocalizedError {
    case invalidURL
    case requestFailed

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid daemon URL"
        case .requestFailed: return "Daemon request failed"
        }
    }
}
