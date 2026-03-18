/*
 * StatusIcon.swift — Menu bar icon with colored status indicator
 *
 * Shows a shield SF Symbol with a colored circle overlay:
 *   Green  — connected, no issues
 *   Yellow — warnings present
 *   Red    — critical alert or disconnected
 *   Gray   — daemon not running
 */

import SwiftUI

struct StatusIcon: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Image("StatusBarIcon")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 18, height: 18)

            Circle()
                .fill(appState.statusColor.color)
                .frame(width: 6, height: 6)
                .offset(x: 2, y: 2)
        }
    }
}
