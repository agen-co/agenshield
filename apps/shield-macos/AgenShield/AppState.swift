/*
 * AppState.swift — Observable application state for the menu bar
 *
 * Tracks daemon connection status, recent events, and status indicators.
 * Drives the menu bar icon color and dropdown content.
 */

import Foundation
import SwiftUI

enum ConnectionStatus: String {
    case connected = "Connected"
    case disconnected = "Disconnected"
    case connecting = "Connecting..."
}

enum StatusColor {
    case green   // Connected, no issues
    case yellow  // Warnings present
    case red     // Critical alert or disconnected
    case gray    // Daemon not running

    var color: Color {
        switch self {
        case .green: return .green
        case .yellow: return .yellow
        case .red: return .red
        case .gray: return .gray
        }
    }
}

// MARK: - Workspace Skill Models

struct WorkspaceSkillInfo: Identifiable {
    let id: String
    let skillName: String
    let workspacePath: String
    let status: String           // "pending" | "approved" | "denied" | "cloud_forced" | "removed"
    let contentHash: String?
    let cloudSkillId: String?
    var isRequesting: Bool = false  // UI state: approval request in flight
}

// MARK: - Target Models

struct TargetInfo: Identifiable {
    let id: String
    let name: String
    let type: String          // "claude-code" | "openclaw"
    let shielded: Bool
    let running: Bool
    let version: String?
    let gatewayPort: Int?
    let processCount: Int
}

// MARK: - Popover Navigation

enum PopoverRoute {
    case main
    case quarantinedSkills
}

@Observable
class AppState {
    var connectionStatus: ConnectionStatus = .disconnected
    var statusColor: StatusColor = .gray

    // Setup / enrollment state
    var setupStatus: String = "not-configured"   // "not-configured" | "pending" | "complete"
    var setupMode: String?                       // "local" | "cloud"
    var cloudEnrolled: Bool = false
    var companyName: String?
    var enrollmentState: String = "idle"          // "idle" | "initiating" | "pending_user_auth" | "registering" | "complete" | "failed"
    var verificationUri: String?
    var userCode: String?

    // Claim state (user login on managed devices)
    var claimStatus: String = "unclaimed"        // "unclaimed" | "pending" | "claimed"
    var claimedUserName: String?
    var claimedUserEmail: String?

    // Daemon info
    var daemonVersion: String?
    var servicesActive: Bool = false

    // Stats
    var eventCount: Int = 0
    var policyCount: Int = 0
    var skillCount: Int = 0

    // Auto-shield
    var autoShieldState: String = "idle"
    var autoShieldCurrent: Int = 0
    var autoShieldTotal: Int = 0
    var autoShieldCurrentTarget: String?
    var autoShieldShielded: Int = 0
    var autoShieldFailed: Int = 0

    // Quarantined workspace skills
    var pendingSkillCount: Int = 0
    var quarantinedSkills: [WorkspaceSkillInfo] = []
    var quarantineLoading: Bool = false
    var quarantineError: String? = nil

    // Popover navigation
    var popoverRoute: PopoverRoute = .main

    // Targets
    var targets: [TargetInfo] = []

    var shieldedTargets: [TargetInfo] {
        targets.filter { $0.shielded }
    }

    var unshieldedTargets: [TargetInfo] {
        targets.filter { !$0.shielded }
    }

    // Shield target (manual)
    var shieldingTargetId: String? = nil
    var shieldProgress: Int = 0
    var shieldProgressMessage: String? = nil
    var shieldError: String? = nil

    /// Update connection status
    func setConnected(_ connected: Bool) {
        connectionStatus = connected ? .connected : .disconnected
        if connected {
            updateDaemonStatus()
            updateSetupStatus()
            updateTargets()
            updateQuarantinedSkills()
        }
        updateStatusColor()
    }

    /// Compute the status color based on connection and services
    private func updateStatusColor() {
        if connectionStatus == .disconnected {
            statusColor = .gray
            return
        }

        if !servicesActive {
            statusColor = .yellow
            return
        }

        statusColor = .green
    }

    /// Fetch full daemon status (includes stats and activation state)
    func updateDaemonStatus() {
        Task {
            do {
                let status = try await DaemonAPI.shared.getDaemonStatus()
                await MainActor.run {
                    self.daemonVersion = status.version
                    self.servicesActive = status.servicesActive ?? false
                    if status.cloudEnrolled == true || status.cloudConnected == true { self.cloudEnrolled = true }
                    self.companyName = status.cloudCompany
                    if let stats = status.stats {
                        self.eventCount = stats.events
                        self.policyCount = stats.policies
                        self.skillCount = stats.skills
                        self.pendingSkillCount = stats.pendingSkills ?? 0
                    }
                    if let claim = status.claim {
                        self.claimStatus = claim.status
                        self.claimedUserName = claim.user?.name
                        self.claimedUserEmail = claim.user?.email
                    }
                    if let autoShield = status.autoShield {
                        self.autoShieldState = autoShield.state
                        if let progress = autoShield.progress {
                            self.autoShieldCurrent = progress.current
                            self.autoShieldTotal = progress.total
                            self.autoShieldCurrentTarget = progress.currentTarget
                        }
                        if let result = autoShield.result {
                            self.autoShieldShielded = result.shielded
                            self.autoShieldFailed = result.failed
                        }
                    }
                    self.updateStatusColor()
                }
            } catch {
                // Silently ignore — daemon may not be reachable
            }
        }
    }

    /// Update setup/enrollment status from daemon API
    func updateSetupStatus() {
        Task {
            do {
                let status = try await DaemonAPI.shared.getSetupStatus()
                await MainActor.run {
                    self.setupStatus = status.setup.state
                    self.setupMode = status.setup.mode
                    self.cloudEnrolled = status.cloudEnrolled
                    self.companyName = status.enrollment.companyName
                    self.enrollmentState = status.enrollment.state
                    self.verificationUri = status.enrollment.verificationUri
                    self.userCode = status.enrollment.userCode
                    if let claim = status.claim {
                        self.claimStatus = claim.status
                        self.claimedUserName = claim.user?.name
                        self.claimedUserEmail = claim.user?.email
                    }
                }
            } catch {
                // Silently ignore — daemon may not be reachable
            }
        }
    }

    /// Update stats from a daemon:status SSE event
    func updateFromDaemonStatusEvent(_ data: AnyCodable) {
        guard let dict = data.value as? [String: Any] else { return }

        if let version = dict["version"] as? String {
            self.daemonVersion = version
        }
        if let active = dict["servicesActive"] as? Bool {
            self.servicesActive = active
        }
        if let cloudEnrolled = dict["cloudEnrolled"] as? Bool, cloudEnrolled {
            self.cloudEnrolled = true
        } else if let cloudConnected = dict["cloudConnected"] as? Bool, cloudConnected {
            self.cloudEnrolled = true
        }
        if let company = dict["cloudCompany"] as? String {
            self.companyName = company
        }
        if let stats = dict["stats"] as? [String: Any] {
            if let events = stats["events"] as? Int { self.eventCount = events }
            if let policies = stats["policies"] as? Int { self.policyCount = policies }
            if let skills = stats["skills"] as? Int { self.skillCount = skills }
            if let pending = stats["pendingSkills"] as? Int { self.pendingSkillCount = pending }
        }
        if let claim = dict["claim"] as? [String: Any] {
            if let status = claim["status"] as? String { self.claimStatus = status }
            if let user = claim["user"] as? [String: Any] {
                self.claimedUserName = user["name"] as? String
                self.claimedUserEmail = user["email"] as? String
            }
        }

        updateStatusColor()
    }

    /// Fetch targets from lifecycle API
    func updateTargets() {
        Task {
            do {
                let apiTargets = try await DaemonAPI.shared.getTargets()
                await MainActor.run {
                    self.targets = apiTargets.map { t in
                        TargetInfo(
                            id: t.id,
                            name: t.name,
                            type: t.type,
                            shielded: t.shielded,
                            running: t.running,
                            version: t.version,
                            gatewayPort: t.gatewayPort,
                            processCount: t.processes?.count ?? 0
                        )
                    }
                }
            } catch {
                // Silently ignore — daemon may not be reachable
            }
        }
    }

    /// Update targets from a targets:status SSE event
    func updateFromTargetStatusEvent(_ data: AnyCodable) {
        guard let dict = data.value as? [String: Any],
              let targetsArray = dict["targets"] as? [[String: Any]] else { return }

        self.targets = targetsArray.compactMap { t in
            guard let id = t["id"] as? String,
                  let name = t["name"] as? String,
                  let type = t["type"] as? String,
                  let shielded = t["shielded"] as? Bool,
                  let running = t["running"] as? Bool else { return nil }

            let processes = t["processes"] as? [[String: Any]]
            return TargetInfo(
                id: id,
                name: name,
                type: type,
                shielded: shielded,
                running: running,
                version: t["version"] as? String,
                gatewayPort: t["gatewayPort"] as? Int,
                processCount: processes?.count ?? 0
            )
        }
    }

    /// Fetch quarantined (pending) workspace skills from daemon API
    func updateQuarantinedSkills() {
        quarantineLoading = true
        quarantineError = nil
        Task {
            do {
                let skills = try await DaemonAPI.shared.getQuarantinedSkills()
                await MainActor.run {
                    self.quarantinedSkills = skills
                    self.pendingSkillCount = skills.count
                    self.quarantineLoading = false
                }
            } catch {
                await MainActor.run {
                    self.quarantineLoading = false
                    self.quarantineError = "Failed to load skills"
                }
            }
        }
    }

    /// Request admin approval for a quarantined skill (uploads to cloud)
    func requestSkillApproval(_ skillId: String) {
        // Mark as requesting in UI
        if let idx = quarantinedSkills.firstIndex(where: { $0.id == skillId }) {
            quarantinedSkills[idx].isRequesting = true
        }
        Task {
            do {
                try await DaemonAPI.shared.requestSkillApproval(skillId: skillId)
                await MainActor.run {
                    // Refresh the list after successful request
                    self.updateQuarantinedSkills()
                }
            } catch {
                await MainActor.run {
                    if let idx = self.quarantinedSkills.firstIndex(where: { $0.id == skillId }) {
                        self.quarantinedSkills[idx].isRequesting = false
                    }
                }
            }
        }
    }

    /// Delete a quarantined skill from disk
    func deleteSkill(_ skillId: String) {
        Task {
            do {
                try await DaemonAPI.shared.deleteSkill(skillId: skillId)
                await MainActor.run {
                    self.quarantinedSkills.removeAll { $0.id == skillId }
                    self.pendingSkillCount = self.quarantinedSkills.count
                }
            } catch {
                // Silently ignore
            }
        }
    }

    /// Shield a specific target
    func shieldTarget(_ targetId: String) {
        shieldingTargetId = targetId
        shieldProgress = 0
        shieldProgressMessage = nil
        shieldError = nil
        Task {
            do {
                try await DaemonAPI.shared.shieldTarget(targetId: targetId)
            } catch {
                await MainActor.run {
                    if self.shieldingTargetId != nil {
                        // HTTP timeout doesn't mean daemon failed — SSE events will drive final state
                        NSLog("[AgenShield] Shield HTTP request failed (may still be in progress): \(error.localizedDescription)")
                    } else {
                        self.shieldError = "Failed to start shielding: \(error.localizedDescription)"
                    }
                }
            }
        }
    }

    /// Stop the daemon via API
    func stopDaemon() {
        Task {
            try? await DaemonAPI.shared.shutdownDaemon()
            await MainActor.run {
                self.connectionStatus = .disconnected
                self.statusColor = .gray
            }
        }
    }

    /// Start the daemon — no-op under App Sandbox (daemon is managed by launchd)
    func startDaemon() {
        NSLog("[AgenShield] startDaemon() is a no-op under App Sandbox. The daemon is managed by launchd.")
    }

    /// Clear all state
    func reset() {
        connectionStatus = .disconnected
        statusColor = .gray
        setupStatus = "not-configured"
        setupMode = nil
        cloudEnrolled = false
        companyName = nil
        enrollmentState = "idle"
        verificationUri = nil
        userCode = nil
        daemonVersion = nil
        servicesActive = false
        eventCount = 0
        policyCount = 0
        skillCount = 0
        pendingSkillCount = 0
        quarantinedSkills = []
        quarantineLoading = false
        quarantineError = nil
        popoverRoute = .main
        targets = []
        shieldingTargetId = nil
        shieldProgress = 0
        shieldProgressMessage = nil
        shieldError = nil
    }
}
