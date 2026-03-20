/*
 * PopoverContent.swift — Popover panel content for the menu bar
 *
 * Renders a rich SwiftUI popover (requires .menuBarExtraStyle(.window))
 * with header, org status, target instances, stats, and action buttons.
 */

import SwiftUI

struct PopoverContent: View {
    @Environment(AppState.self) private var appState
    @State private var pendingShieldTargetId: String?
    @State private var shieldUnlockPassword = ""
    @State private var shieldUnlockError: String?
    @State private var shieldUnlockInFlight = false
    @State private var pendingFreshInstall = false

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

            // Unshielded targets (with shield button)
            if appState.connectionStatus == .connected && !appState.unshieldedTargets.isEmpty {
                sectionDivider
                unshieldedSection
            }

            // Suggest installing Claude Code when not detected
            if appState.shouldShowClaudeCodeSuggestion {
                sectionDivider
                claudeCodeSuggestionSection
            }

            // Stats
            if appState.connectionStatus == .connected {
                sectionDivider
                statsSection
            }

            // Quarantined workspace skills
            if appState.connectionStatus == .connected && appState.pendingSkillCount > 0 {
                sectionDivider
                quarantinedSkillsSection
            }

            // Enrollment / Claim
            if appState.enrollmentState == "pending_user_auth" {
                sectionDivider
                enrollmentSection
            } else if appState.claimStatus != "claimed" {
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
        .sheet(isPresented: isShieldUnlockSheetPresented) {
            shieldUnlockSheet
        }
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

            // Claimed user
            if appState.claimStatus == "claimed" {
                HStack(spacing: 6) {
                    Image(systemName: "person.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(.blue)
                        .frame(width: 16, alignment: .center)
                    if let name = appState.claimedUserName, !name.isEmpty,
                       let email = appState.claimedUserEmail, !email.isEmpty {
                        Text("\(name) <\(email)>")
                            .font(.system(size: 12))
                    } else if let email = appState.claimedUserEmail, !email.isEmpty {
                        Text(email)
                            .font(.system(size: 12))
                    } else if let name = appState.claimedUserName, !name.isEmpty {
                        Text(name)
                            .font(.system(size: 12))
                    }
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

    private var unshieldedSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("UNSHIELDED")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.bottom, 2)

            ForEach(appState.unshieldedTargets, id: \.id) { target in
                HStack(spacing: 8) {
                    Image(systemName: iconForTargetType(target.type))
                        .font(.system(size: 12))
                        .foregroundStyle(.orange)
                        .frame(width: 16)

                    Text(target.name)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1)

                    Spacer()

                    if appState.shieldingTargetId == target.id {
                        HStack(spacing: 4) {
                            ProgressView()
                                .controlSize(.mini)
                            if appState.shieldProgress > 0 {
                                Text("\(appState.shieldProgress)%")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } else {
                        Button(action: { startShieldFlow(target.id) }) {
                            HStack(spacing: 4) {
                                Image(systemName: "shield.fill")
                                    .font(.system(size: 9))
                                Text("Shield")
                                    .font(.system(size: 10, weight: .medium))
                            }
                            .foregroundColor(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.accentColor)
                            .cornerRadius(4)
                        }
                        .buttonStyle(.plain)
                        .disabled(appState.shieldingTargetId != nil || shieldUnlockInFlight)
                    }
                }
                .padding(.vertical, 2)

                if appState.shieldingTargetId == target.id, let msg = appState.shieldProgressMessage {
                    Text(msg)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            if let error = appState.shieldError {
                Text(error)
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
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

    private var quarantinedSkillsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Expandable header row
            PopoverActionRow(action: {
                appState.quarantineExpanded.toggle()
                if appState.quarantineExpanded {
                    appState.updateQuarantinedSkills()
                }
            }) {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(.orange)
                        .frame(width: 16, alignment: .center)
                    Text("\(appState.pendingSkillCount) skill\(appState.pendingSkillCount == 1 ? "" : "s") quarantined")
                        .font(.system(size: 12, weight: .medium))
                    Spacer()
                    Image(systemName: appState.quarantineExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 4)

            // Inline expanded skill list
            if appState.quarantineExpanded {
                if appState.quarantineLoading {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Loading...")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                } else if let error = appState.quarantineError {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(error)
                            .font(.system(size: 12))
                            .foregroundStyle(.red)
                        Button(action: { appState.updateQuarantinedSkills() }) {
                            Text("Retry")
                                .font(.system(size: 11))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                } else if appState.quarantinedSkills.isEmpty {
                    Text("No quarantined skills")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(appState.quarantinedSkills) { skill in
                                HStack(spacing: 6) {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(skill.skillName)
                                            .font(.system(size: 11, weight: .medium))
                                            .lineLimit(1)
                                        Text(abbreviatePath(skill.workspacePath))
                                            .font(.system(size: 10))
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                            .truncationMode(.middle)
                                    }
                                    Spacer()
                                    if skill.isRequesting {
                                        ProgressView()
                                            .controlSize(.mini)
                                    } else if skill.cloudSkillId != nil {
                                        Text("Pending")
                                            .font(.system(size: 10, weight: .medium))
                                            .foregroundColor(.white)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Color.secondary)
                                            .cornerRadius(4)

                                        Button(action: { appState.deleteSkill(skill.id) }) {
                                            Image(systemName: "trash")
                                                .font(.system(size: 10))
                                                .foregroundColor(.white)
                                                .padding(3)
                                                .background(Color.red.opacity(0.85))
                                                .cornerRadius(4)
                                        }
                                        .buttonStyle(.plain)
                                    } else {
                                        Button(action: { appState.requestSkillApproval(skill.id) }) {
                                            Text("Request")
                                                .font(.system(size: 10, weight: .medium))
                                                .foregroundColor(.white)
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 2)
                                                .background(Color.accentColor)
                                                .cornerRadius(4)
                                        }
                                        .buttonStyle(.plain)
                                        .disabled(!appState.cloudEnrolled)

                                        Button(action: { appState.deleteSkill(skill.id) }) {
                                            Image(systemName: "trash")
                                                .font(.system(size: 10))
                                                .foregroundColor(.white)
                                                .padding(3)
                                                .background(Color.red.opacity(0.85))
                                                .cornerRadius(4)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.horizontal, 4)
                                .padding(.vertical, 2)

                                if skill.status == "approved" {
                                    Text("Restart Claude Code to apply")
                                        .font(.system(size: 10))
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal, 4)
                                }
                            }
                        }
                        .padding(.horizontal, 8)
                    }
                    .frame(maxHeight: 200)
                }
            }
        }
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

    private var isShieldUnlockSheetPresented: Binding<Bool> {
        Binding(
            get: { pendingShieldTargetId != nil },
            set: { isPresented in
                if !isPresented {
                    dismissShieldUnlockSheet()
                }
            }
        )
    }

    private var shieldUnlockTargetName: String {
        guard let targetId = pendingShieldTargetId else {
            return "this target"
        }
        return appState.targets.first(where: { $0.id == targetId })?.name ?? "this target"
    }

    private var shieldUnlockSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Unlock Shielding")
                .font(.system(size: 16, weight: .semibold))

            Text("Enter your system password to shield \(shieldUnlockTargetName).")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)

            SecureField("System password", text: $shieldUnlockPassword)
                .textFieldStyle(.roundedBorder)
                .disabled(shieldUnlockInFlight)
                .onSubmit {
                    submitShieldUnlock()
                }

            if let shieldUnlockError, !shieldUnlockError.isEmpty {
                Text(shieldUnlockError)
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
            }

            HStack {
                Spacer()
                Button("Cancel") {
                    dismissShieldUnlockSheet()
                }
                .disabled(shieldUnlockInFlight)

                Button(action: submitShieldUnlock) {
                    if shieldUnlockInFlight {
                        HStack(spacing: 6) {
                            ProgressView()
                                .controlSize(.small)
                            Text("Unlocking...")
                        }
                    } else {
                        Text("Unlock & Shield")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(shieldUnlockPassword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || shieldUnlockInFlight)
            }
        }
        .padding(20)
        .frame(width: 340)
    }

    // MARK: - Computed Properties

    private var statusDotColor: Color {
        appState.statusColor.color
    }

    private var statusLabel: String {
        switch appState.statusColor {
        case .green:
            return "Online"
        case .orange:
            return "Attention Required"
        case .red:
            return "Not Logged In"
        case .gray:
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

    /// Abbreviate a file path for display (replace home dir with ~)
    private func abbreviatePath(_ path: String) -> String {
        let home = NSHomeDirectory()
        if path.hasPrefix(home) {
            return "~" + path.dropFirst(home.count)
        }
        return path
    }

    private var claudeCodeSuggestionSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("SUGGESTION")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.bottom, 2)

            HStack(spacing: 8) {
                Image(systemName: "terminal")
                    .font(.system(size: 12))
                    .foregroundStyle(.blue)
                    .frame(width: 16)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Claude Code")
                        .font(.system(size: 12, weight: .medium))
                    Text("Not installed. Install & shield with AgenShield.")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Spacer()

                if appState.shieldingTargetId == "claude-code" {
                    HStack(spacing: 4) {
                        ProgressView()
                            .controlSize(.mini)
                        if appState.shieldProgress > 0 {
                            Text("\(appState.shieldProgress)%")
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Button(action: { startInstallClaudeCode() }) {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.down.circle.fill")
                                .font(.system(size: 9))
                            Text("Install")
                                .font(.system(size: 10, weight: .medium))
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.blue)
                        .cornerRadius(4)
                    }
                    .buttonStyle(.plain)
                    .disabled(appState.shieldingTargetId != nil || shieldUnlockInFlight)
                }
            }

            if appState.shieldingTargetId == "claude-code", let msg = appState.shieldProgressMessage {
                Text(msg)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if let error = appState.shieldError, appState.shieldingTargetId == nil {
                Text(error)
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Actions

    private func startInstallClaudeCode() {
        appState.shieldError = nil
        appState.shieldProgress = 0
        appState.shieldProgressMessage = nil

        Task {
            do {
                if try await DaemonAPI.shared.hasValidSession() {
                    await appState.installClaudeCode()
                    return
                }

                // No valid session — show password dialog
                await MainActor.run {
                    pendingFreshInstall = true
                    pendingShieldTargetId = "claude-code"
                    shieldUnlockPassword = ""
                    shieldUnlockError = nil
                    shieldUnlockInFlight = false
                }
            } catch {
                await MainActor.run {
                    appState.resetShieldingState(
                        error: "Failed to prepare installation: \((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)"
                    )
                }
            }
        }
    }

    private func startShieldFlow(_ targetId: String) {
        // Immediately clear all previous shield state so the UI resets
        appState.shieldError = nil
        appState.shieldProgress = 0
        appState.shieldProgressMessage = nil

        Task {
            do {
                if try await DaemonAPI.shared.hasValidSession() {
                    await appState.startShieldTarget(targetId)
                    return
                }

                // No valid session — show password dialog
                await MainActor.run {
                    pendingShieldTargetId = targetId
                    shieldUnlockPassword = ""
                    shieldUnlockError = nil
                    shieldUnlockInFlight = false
                }
            } catch {
                await MainActor.run {
                    appState.resetShieldingState(
                        error: "Failed to prepare shielding: \((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)"
                    )
                }
            }
        }
    }

    private func submitShieldUnlock() {
        guard let targetId = pendingShieldTargetId else {
            return
        }

        let password = shieldUnlockPassword.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !password.isEmpty else {
            return
        }

        shieldUnlockInFlight = true
        shieldUnlockError = nil

        Task {
            do {
                try await DaemonAPI.shared.loginWithPassword(password)
                let isFreshInstall = pendingFreshInstall
                await MainActor.run {
                    dismissShieldUnlockSheet()
                }
                if isFreshInstall {
                    await appState.installClaudeCode()
                } else {
                    await appState.startShieldTarget(targetId)
                }
            } catch {
                await MainActor.run {
                    shieldUnlockError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    shieldUnlockInFlight = false
                }
            }
        }
    }

    private func dismissShieldUnlockSheet() {
        pendingShieldTargetId = nil
        pendingFreshInstall = false
        shieldUnlockPassword = ""
        shieldUnlockError = nil
        shieldUnlockInFlight = false
    }

    private func startCloudLogin() {
        Task {
            do {
                if appState.cloudEnrolled {
                    // Managed device — use claim flow
                    await startClaimFlow()
                } else {
                    // Unmanaged — use enrollment flow
                    let cloudUrl = ProcessInfo.processInfo.environment["AGENSHIELD_POLICY_URL"] ?? "https://cloud.agenshield.com"
                    let result = try await DaemonAPI.shared.setupCloud(cloudUrl: cloudUrl)
                    let enrollment = result.enrollment

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
                }
            } catch {
                // Silently ignore — user can retry
            }
        }
    }

    private func startClaimFlow() async {
        do {
            let result = try await DaemonAPI.shared.startClaim()

            await MainActor.run {
                appState.claimStatus = result.status
            }

            // Open claim URL in browser (once)
            if result.status == "pending", let urlString = result.claimUrl, let url = URL(string: urlString) {
                await MainActor.run {
                    NSWorkspace.shared.open(url)
                }

                // Poll every 3s until claimed
                pollClaimStatus()
            }
        } catch {
            // Silently ignore — user can retry
        }
    }

    private func pollClaimStatus() {
        Task {
            while appState.claimStatus == "pending" {
                try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds
                do {
                    let result = try await DaemonAPI.shared.startClaim()
                    await MainActor.run {
                        appState.claimStatus = result.status
                        if let user = result.user {
                            appState.claimedUserName = user.name
                            appState.claimedUserEmail = user.email
                        }
                    }
                } catch {
                    break
                }
            }

            // Claim completed — refresh targets and status so unshielded targets appear
            appState.updateTargets()
            appState.updateDaemonStatus()
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
