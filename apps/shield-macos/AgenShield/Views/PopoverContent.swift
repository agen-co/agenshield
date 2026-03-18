/*
 * PopoverContent.swift — Popover panel content for the menu bar
 *
 * Renders a rich SwiftUI popover (requires .menuBarExtraStyle(.window))
 * with header, org status, target instances, stats, and action buttons.
 */

import SwiftUI

struct PopoverContent: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            headerSection

            sectionDivider

            // Connection & org status
            statusSection

            // Instances (only when connected and have shielded targets)
            if appState.connectionStatus == .connected && !appState.shieldedTargets.isEmpty {
                sectionDivider
                instancesSection
            }

            // Stats
            if appState.connectionStatus == .connected {
                sectionDivider
                statsSection
            }

            // Enrollment
            if appState.enrollmentState == "pending_user_auth" {
                sectionDivider
                enrollmentSection
            } else if !appState.cloudEnrolled {
                sectionDivider
                loginSection
            }

            // Auto-shield progress
            if appState.autoShieldState == "in_progress" || appState.autoShieldState == "pending" {
                sectionDivider
                autoShieldProgressSection
            } else if appState.autoShieldState == "complete" {
                sectionDivider
                autoShieldCompleteSection
            }

            sectionDivider

            // Actions
            actionsSection

            sectionDivider

            // Quit
            quitSection
        }
        .frame(width: 300)
    }

    // MARK: - Sections

    private var headerSection: some View {
        HStack {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 20, height: 20)
            Text("AgenShield")
                .font(.system(size: 13, weight: .semibold))
            Spacer()
            if let version = appState.daemonVersion {
                Text("v\(version)")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Org status
            HStack(spacing: 6) {
                Image(systemName: appState.cloudEnrolled ? "checkmark.shield.fill" : "shield.slash")
                    .font(.system(size: 11))
                    .foregroundStyle(appState.cloudEnrolled ? .green : .secondary)
                    .frame(width: 16, alignment: .center)
                if appState.cloudEnrolled, let company = appState.companyName {
                    Text("Managed by \(company)")
                        .font(.system(size: 12))
                } else {
                    Text("Not managed")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
            }

            // Connection status
            HStack(spacing: 6) {
                Circle()
                    .fill(statusDotColor)
                    .frame(width: 7, height: 7)
                    .frame(width: 16, alignment: .center)
                Text(statusLabel)
                    .font(.system(size: 12))
                    .foregroundStyle(appState.connectionStatus == .connected ? .primary : .secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var instancesSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("INSTANCES")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.bottom, 2)

            ForEach(appState.shieldedTargets, id: \.id) { target in
                PopoverActionRow(action: {
                    openDashboard(path: "/")
                }) {
                    HStack(spacing: 8) {
                        Image(systemName: iconForTargetType(target.type))
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                            .frame(width: 16)

                        VStack(alignment: .leading, spacing: 1) {
                            HStack {
                                Text(target.name)
                                    .font(.system(size: 12, weight: .medium))
                                Spacer()
                                Text(target.running ? "Running" : "Stopped")
                                    .font(.system(size: 11))
                                    .foregroundStyle(target.running ? .green : .secondary)
                            }
                            Text(subtextForTarget(target))
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var statsSection: some View {
        HStack(spacing: 4) {
            Text("\(appState.eventCount) events")
            Text("·").foregroundStyle(.quaternary)
            Text("\(appState.policyCount) policies")
            Text("·").foregroundStyle(.quaternary)
            Text("\(appState.skillCount) skills")
        }
        .font(.system(size: 11))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var enrollmentSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                ProgressView()
                    .controlSize(.small)
                Text("Waiting for authorization...")
                    .font(.system(size: 12))
            }
            if let code = appState.userCode {
                Text("Code: \(code)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            if let uri = appState.verificationUri, let url = URL(string: uri) {
                PopoverActionRow(action: { NSWorkspace.shared.open(url) }) {
                    Text("Open Auth Page")
                        .font(.system(size: 12))
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var autoShieldProgressSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                ProgressView()
                    .controlSize(.small)
                if appState.autoShieldTotal > 0 {
                    Text("Shielding targets (\(appState.autoShieldCurrent)/\(appState.autoShieldTotal))...")
                        .font(.system(size: 12))
                } else {
                    Text("Preparing auto-shield...")
                        .font(.system(size: 12))
                }
            }
            if let target = appState.autoShieldCurrentTarget {
                Text(target)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var autoShieldCompleteSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.shield.fill")
                    .foregroundStyle(.green)
                    .font(.system(size: 12))
                Text("Auto-shield complete")
                    .font(.system(size: 12))
            }
            if appState.autoShieldShielded > 0 || appState.autoShieldFailed > 0 {
                Text("\(appState.autoShieldShielded) shielded, \(appState.autoShieldFailed) failed")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var loginSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            PopoverActionRow(action: { startCloudLogin() }, isDisabled: appState.connectionStatus != .connected) {
                Text(loginButtonLabel)
                    .font(.system(size: 12))
            }
            if appState.connectionStatus != .connected {
                Text("Start daemon to login")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    /// Whether non-daemon actions should be disabled (org-managed mode)
    private var orgManagedActionsDisabled: Bool {
        appState.cloudEnrolled
    }

    private var actionsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            if appState.connectionStatus == .connected {
                PopoverActionRow(action: { appState.stopDaemon() }) {
                    HStack(spacing: 8) {
                        Image(systemName: "stop.circle")
                            .frame(width: 16, alignment: .center)
                        Text("Stop Daemon")
                    }
                }
            } else {
                PopoverActionRow(action: { appState.startDaemon() }) {
                    HStack(spacing: 8) {
                        Image(systemName: "play.circle")
                            .frame(width: 16, alignment: .center)
                        Text("Start Daemon")
                    }
                }
            }

            PopoverActionRow(action: { openDashboard(path: "/") }, isDisabled: orgManagedActionsDisabled) {
                HStack(spacing: 8) {
                    Image(systemName: "globe")
                        .frame(width: 16, alignment: .center)
                    Text("Open Dashboard")
                }
            }

            PopoverActionRow(action: { openDashboard(path: "/policies") }, isDisabled: orgManagedActionsDisabled) {
                HStack(spacing: 8) {
                    Image(systemName: "shield")
                        .frame(width: 16, alignment: .center)
                    Text("Policies")
                }
            }

            PopoverActionRow(action: { openDashboard(path: "/skills") }, isDisabled: orgManagedActionsDisabled) {
                HStack(spacing: 8) {
                    Image(systemName: "puzzlepiece")
                        .frame(width: 16, alignment: .center)
                    Text("Skills")
                }
            }

            PopoverActionRow(action: { openDashboard(path: "/settings") }, isDisabled: orgManagedActionsDisabled) {
                HStack(spacing: 8) {
                    Image(systemName: "gear")
                        .frame(width: 16, alignment: .center)
                    Text("Settings")
                }
            }

            PopoverActionRow(action: { openLogs() }, isDisabled: orgManagedActionsDisabled) {
                HStack(spacing: 8) {
                    Image(systemName: "doc.text")
                        .frame(width: 16, alignment: .center)
                    Text("Open Logs")
                }
            }

            if orgManagedActionsDisabled {
                Text("Managed by organization")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.top, 4)
            }
        }
        .font(.system(size: 12))
        .padding(.horizontal, 4)
        .padding(.vertical, 4)
    }

    private var quitSection: some View {
        PopoverActionRow(action: { NSApplication.shared.terminate(nil) }) {
            Text("Quit AgenShield Menu")
                .font(.system(size: 12))
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 4)
    }

    private var sectionDivider: some View {
        Divider().padding(.horizontal, 8)
    }

    // MARK: - Computed Properties

    private var statusDotColor: Color {
        switch appState.connectionStatus {
        case .connected:
            return appState.servicesActive ? .green : .yellow
        case .connecting:
            return .yellow
        case .disconnected:
            return .gray
        }
    }

    private var statusLabel: String {
        switch appState.connectionStatus {
        case .connected:
            return appState.servicesActive ? "Online" : "Standby"
        case .connecting:
            return "Connecting..."
        case .disconnected:
            return "Offline"
        }
    }

    private var loginButtonLabel: String {
        if let orgName = ProcessInfo.processInfo.environment["AGENSHIELD_ORG_NAME"] {
            return "Login with \(orgName)"
        }
        return "Login to AgenShield Cloud"
    }

    // MARK: - Helpers

    private func iconForTargetType(_ type: String) -> String {
        switch type {
        case "claude-code": return "terminal"
        case "openclaw": return "server.rack"
        default: return "app"
        }
    }

    private func subtextForTarget(_ target: TargetInfo) -> String {
        if target.type == "openclaw", let port = target.gatewayPort {
            return "Gateway port \(port)"
        }
        let count = target.processCount
        if count > 0 {
            return "\(count) active session\(count == 1 ? "" : "s")"
        }
        return target.running ? "Running" : "No active sessions"
    }

    // MARK: - Actions

    private func startCloudLogin() {
        Task {
            do {
                let cloudUrl = ProcessInfo.processInfo.environment["AGENSHIELD_POLICY_URL"] ?? "https://cloud.agenshield.com"
                let result = try await DaemonAPI.shared.setupCloud(cloudUrl: cloudUrl)
                let enrollment = result.enrollment

                // Append redirect_url pointing to the local dashboard
                let port = readDaemonPort()
                let redirectParam = "redirect_url=http://127.0.0.1:\(port)"
                let uriWithRedirect: String? = enrollment.verificationUri.map { uri in
                    let separator = uri.contains("?") ? "&" : "?"
                    return "\(uri)\(separator)\(redirectParam)"
                }

                await MainActor.run {
                    appState.enrollmentState = enrollment.state
                    appState.verificationUri = uriWithRedirect
                    appState.userCode = enrollment.userCode
                }

                if let uri = uriWithRedirect, let url = URL(string: uri) {
                    await MainActor.run {
                        NSWorkspace.shared.open(url)
                    }
                }
            } catch {
                // Silently ignore — user can retry
            }
        }
    }

    private func openDashboard(path: String = "/") {
        let port = readDaemonPort()
        if let url = URL(string: "http://127.0.0.1:\(port)\(path)") {
            NSWorkspace.shared.open(url)
        }
    }

    private func openLogs() {
        let logsPath = NSHomeDirectory() + "/.agenshield/logs"
        NSWorkspace.shared.open(URL(fileURLWithPath: logsPath))
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

// MARK: - Hoverable Action Row

struct PopoverActionRow<Content: View>: View {
    let action: () -> Void
    var isDisabled: Bool = false
    @ViewBuilder let content: Content
    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            HStack {
                content
                Spacer()
            }
            .contentShape(Rectangle())
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(isHovered && !isDisabled ? Color.primary.opacity(0.08) : Color.clear)
            .cornerRadius(4)
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.4 : 1.0)
        .onHover { hovering in
            isHovered = hovering
        }
    }
}
