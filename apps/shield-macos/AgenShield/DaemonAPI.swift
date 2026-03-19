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

struct ClaimUserInfo: Codable {
    let id: String
    let name: String
    let email: String
}

struct ClaimStatusInfo: Codable {
    let status: String
    let user: ClaimUserInfo?
}

struct SetupStatusData: Codable {
    let setup: SetupStatus
    let enrollment: SetupEnrollmentState
    let cloudEnrolled: Bool
    let claim: ClaimStatusInfo?
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
    let pendingSkills: Int?
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
    let cloudEnrolled: Bool?
    let enrollmentPending: Bool?
    let claim: ClaimStatusInfo?
    let autoShield: AutoShieldState?
}

struct ApiResponse<T: Codable>: Codable {
    let success: Bool
    let data: T?
}

private struct AdminAuthResponse: Codable {
    let success: Bool
    let token: String?
    let expiresAt: Int?
    let error: String?
}

private struct MenuBarAdminSession {
    let token: String
    let expiresAt: Date
}

// MARK: - DaemonAPI

class DaemonAPI {
    static let shared = DaemonAPI()
    private let session = URLSession.shared
    private let authRefreshLeeway: TimeInterval = 120
    private var adminSession: MenuBarAdminSession?

    private var baseURL: String {
        let port = readDaemonPort()
        return "http://127.0.0.1:\(port)"
    }

    private var defaultAuthenticationMessage: String {
        "Authentication required. Enter your system password to continue."
    }

    // MARK: - Setup Endpoints

    func getSetupStatus() async throws -> SetupStatusData {
        let data = try await get("/api/setup/status")
        let response = try decode(ApiResponse<SetupStatusData>.self, from: data)
        guard response.success, let result = response.data else {
            throw DaemonAPIError.requestFailed("Failed to load setup status.")
        }
        return result
    }

    func setupLocal() async throws -> SetupLocalData {
        let data = try await post("/api/setup/local", body: nil)
        let response = try decode(ApiResponse<SetupLocalData>.self, from: data)
        guard response.success, let result = response.data else {
            throw DaemonAPIError.requestFailed("Failed to start local setup.")
        }
        return result
    }

    func setupCloud(cloudUrl: String) async throws -> SetupCloudData {
        let body = ["cloudUrl": cloudUrl]
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        let data = try await post("/api/setup/cloud", body: bodyData)
        let response = try decode(ApiResponse<SetupCloudData>.self, from: data)
        guard response.success, let result = response.data else {
            throw DaemonAPIError.requestFailed("Failed to start cloud setup.")
        }
        return result
    }

    // MARK: - Claim Endpoints

    struct ClaimResponse: Codable {
        let status: String
        let claimUrl: String?
        let claimSessionId: String?
        let user: ClaimUserInfo?
        let message: String?
    }

    func startClaim() async throws -> ClaimResponse {
        let data = try await post("/api/cloud/claim", body: nil)
        let response = try decode(ClaimResponse.self, from: data)
        return response
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
        let data: Data
        if adminSession != nil {
            data = try await get("/api/targets/lifecycle", requiresAuth: true)
        } else {
            data = try await get("/api/targets/lifecycle")
        }
        let response = try decode(ApiResponse<[TargetLifecycleInfo]>.self, from: data)
        guard response.success, let result = response.data else {
            throw DaemonAPIError.requestFailed("Failed to load detected targets.")
        }
        return result
    }

    // MARK: - Workspace Skills Endpoints

    struct WorkspaceSkillData: Codable {
        let id: String
        let skillName: String
        let workspacePath: String
        let status: String
        let contentHash: String?
        let cloudSkillId: String?
    }

    struct SkillApprovalResponse: Codable {
        let cloudSkillId: String?
        let existingDecision: String?
    }

    func getQuarantinedSkills() async throws -> [WorkspaceSkillInfo] {
        let data = try await get("/api/workspace-skills?status=pending")
        let response = try decode(ApiResponse<[WorkspaceSkillData]>.self, from: data)
        guard response.success, let skills = response.data else {
            throw DaemonAPIError.requestFailed("Failed to load quarantined skills.")
        }
        return skills.map { s in
            WorkspaceSkillInfo(
                id: s.id,
                skillName: s.skillName,
                workspacePath: s.workspacePath,
                status: s.status,
                contentHash: s.contentHash,
                cloudSkillId: s.cloudSkillId
            )
        }
    }

    func requestSkillApproval(skillId: String) async throws {
        _ = try await post("/api/workspace-skills/\(skillId)/request-approval", body: nil)
    }

    func deleteSkill(skillId: String) async throws {
        _ = try await post("/api/workspace-skills/\(skillId)/delete", body: nil)
    }

    // MARK: - Shield Endpoint

    func shieldTarget(targetId: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["enforcementMode": "both"])
        _ = try await post("/api/targets/lifecycle/\(targetId)/shield", body: body, timeout: 600, requiresAuth: true)
    }

    // MARK: - Status Endpoints

    func getDaemonStatus() async throws -> DaemonStatusData {
        let data = try await get("/api/status")
        let response = try decode(ApiResponse<DaemonStatusData>.self, from: data)
        guard response.success, let result = response.data else {
            throw DaemonAPIError.requestFailed("Failed to load daemon status.")
        }
        return result
    }

    func shutdownDaemon() async throws {
        _ = try await post("/api/shutdown", body: nil)
    }

    // MARK: - Admin Session

    func hasValidSession() async throws -> Bool {
        guard adminSession != nil else {
            return false
        }

        do {
            _ = try await ensureAdminSession()
            return true
        } catch let error as DaemonAPIError {
            if case .authenticationRequired = error {
                return false
            }
            throw error
        }
    }

    func loginWithPassword(_ password: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["password": password])
        let data = try await post("/api/auth/sudo-login", body: body, timeout: 15)
        let response = try decode(AdminAuthResponse.self, from: data)

        guard response.success, let token = response.token, let expiresAt = response.expiresAt else {
            throw DaemonAPIError.requestFailed(response.error ?? "Authentication failed.")
        }

        storeAdminSession(token: token, expiresAtMillis: expiresAt)
    }

    func clearSession() {
        adminSession = nil
    }

    // MARK: - HTTP Helpers

    private func get(_ path: String, requiresAuth: Bool = false) async throws -> Data {
        guard let url = URL(string: baseURL + path) else {
            throw DaemonAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 10
        if requiresAuth {
            request.setValue("Bearer \(try await ensureAdminSession())", forHTTPHeaderField: "Authorization")
        }
        return try await perform(request, requiresAuth: requiresAuth)
    }

    private func post(
        _ path: String,
        body: Data?,
        timeout: TimeInterval = 30,
        requiresAuth: Bool = false,
        extraHeaders: [String: String] = [:]
    ) async throws -> Data {
        guard let url = URL(string: baseURL + path) else {
            throw DaemonAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        if let body = body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        for (header, value) in extraHeaders {
            request.setValue(value, forHTTPHeaderField: header)
        }
        if requiresAuth {
            request.setValue("Bearer \(try await ensureAdminSession())", forHTTPHeaderField: "Authorization")
        }
        return try await perform(request, requiresAuth: requiresAuth)
    }

    private func perform(_ request: URLRequest, requiresAuth: Bool) async throws -> Data {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw DaemonAPIError.invalidResponse
            }

            guard (200..<300).contains(http.statusCode) else {
                let message = parseErrorMessage(from: data) ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode).capitalized
                if requiresAuth && (http.statusCode == 401 || http.statusCode == 403) {
                    clearSession()
                    throw DaemonAPIError.authenticationRequired(message.isEmpty ? defaultAuthenticationMessage : message)
                }
                if http.statusCode == 429 {
                    throw DaemonAPIError.rateLimited(message.isEmpty ? "Too many attempts. Please wait before trying again." : message)
                }
                throw DaemonAPIError.httpError(statusCode: http.statusCode, message: message)
            }

            return data
        } catch let error as DaemonAPIError {
            throw error
        } catch let error as URLError {
            if error.code == .timedOut {
                throw DaemonAPIError.timedOut
            }
            throw DaemonAPIError.transport(error.localizedDescription)
        } catch {
            throw DaemonAPIError.transport(error.localizedDescription)
        }
    }

    private func ensureAdminSession() async throws -> String {
        guard let currentSession = adminSession else {
            throw DaemonAPIError.authenticationRequired(defaultAuthenticationMessage)
        }

        let now = Date()
        if currentSession.expiresAt.timeIntervalSince(now) > authRefreshLeeway {
            return currentSession.token
        }

        if currentSession.expiresAt > now {
            do {
                return try await refreshAdminSession(using: currentSession.token)
            } catch let error as DaemonAPIError {
                switch error {
                case .authenticationRequired:
                    clearSession()
                    throw error
                default:
                    return currentSession.token
                }
            }
        }

        clearSession()
        throw DaemonAPIError.authenticationRequired(defaultAuthenticationMessage)
    }

    private func refreshAdminSession(using token: String) async throws -> String {
        do {
            let data = try await post(
                "/api/auth/refresh",
                body: Data("{}".utf8),
                timeout: 15,
                extraHeaders: ["Authorization": "Bearer \(token)"]
            )
            let response = try decode(AdminAuthResponse.self, from: data)

            guard response.success, let refreshedToken = response.token, let expiresAt = response.expiresAt else {
                clearSession()
                throw DaemonAPIError.authenticationRequired(response.error ?? defaultAuthenticationMessage)
            }

            storeAdminSession(token: refreshedToken, expiresAtMillis: expiresAt)
            return refreshedToken
        } catch let error as DaemonAPIError {
            switch error {
            case .httpError(let statusCode, let message) where statusCode == 401 || statusCode == 403:
                clearSession()
                throw DaemonAPIError.authenticationRequired(message)
            default:
                throw error
            }
        }
    }

    private func storeAdminSession(token: String, expiresAtMillis: Int) {
        let expiresAt = Date(timeIntervalSince1970: Double(expiresAtMillis) / 1000)
        adminSession = MenuBarAdminSession(token: token, expiresAt: expiresAt)
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw DaemonAPIError.decodingFailed(error.localizedDescription)
        }
    }

    private func parseErrorMessage(from data: Data) -> String? {
        guard !data.isEmpty else {
            return nil
        }

        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let error = json["error"] as? String, !error.isEmpty {
                return error
            }
            if let error = json["error"] as? [String: Any],
               let message = error["message"] as? String,
               !message.isEmpty {
                return message
            }
            if let message = json["message"] as? String, !message.isEmpty {
                return message
            }
        }

        let raw = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return raw?.isEmpty == false ? raw : nil
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
    case invalidResponse
    case decodingFailed(String)
    case authenticationRequired(String)
    case rateLimited(String)
    case httpError(statusCode: Int, message: String)
    case timedOut
    case transport(String)
    case requestFailed(String)

    var isTimeout: Bool {
        if case .timedOut = self {
            return true
        }
        return false
    }

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid daemon URL"
        case .invalidResponse: return "Invalid daemon response"
        case .decodingFailed(let message): return "Failed to decode daemon response: \(message)"
        case .authenticationRequired(let message): return message
        case .rateLimited(let message): return message
        case .httpError(_, let message): return message
        case .timedOut: return "The daemon took too long to respond."
        case .transport(let message): return message
        case .requestFailed(let message): return message
        }
    }
}
