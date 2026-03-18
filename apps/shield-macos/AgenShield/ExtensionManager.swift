/*
 * ExtensionManager.swift — System Extension lifecycle management
 *
 * Wraps OSSystemExtensionManager for install/uninstall/status operations.
 * Prints machine-readable tokens to stdout for CLI consumption:
 *   OK                  — operation completed successfully
 *   NEEDS_APPROVAL      — user must approve in System Settings
 *   ERROR:<message>     — operation failed
 */

import Foundation
import SystemExtensions

class ExtensionManager: NSObject, OSSystemExtensionRequestDelegate {

    enum Action {
        case install
        case uninstall
    }

    private let extensionIdentifier = "com.frontegg.AgenShield.es-extension"
    private var action: Action = .install
    private var completionHandler: ((Int32) -> Void)?

    // MARK: - Public API

    func install(completion: @escaping (Int32) -> Void) {
        self.action = .install
        self.completionHandler = completion

        let request = OSSystemExtensionRequest.activationRequest(
            forExtensionWithIdentifier: extensionIdentifier,
            queue: .main
        )
        request.delegate = self
        OSSystemExtensionManager.shared.submitRequest(request)
    }

    func uninstall(completion: @escaping (Int32) -> Void) {
        self.action = .uninstall
        self.completionHandler = completion

        let request = OSSystemExtensionRequest.deactivationRequest(
            forExtensionWithIdentifier: extensionIdentifier,
            queue: .main
        )
        request.delegate = self
        OSSystemExtensionManager.shared.submitRequest(request)
    }

    // MARK: - OSSystemExtensionRequestDelegate

    func request(
        _ request: OSSystemExtensionRequest,
        didFinishWithResult result: OSSystemExtensionRequest.Result
    ) {
        switch result {
        case .completed:
            print("OK")
            completionHandler?(0)
        case .willCompleteAfterReboot:
            print("OK_AFTER_REBOOT")
            completionHandler?(0)
        @unknown default:
            print("OK")
            completionHandler?(0)
        }
    }

    func request(
        _ request: OSSystemExtensionRequest,
        didFailWithError error: Error
    ) {
        let nsError = error as NSError
        print("ERROR:\(nsError.localizedDescription)")
        completionHandler?(1)
    }

    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        print("NEEDS_APPROVAL")
        // Don't exit — wait for the delegate to receive didFinishWithResult or didFailWithError
    }

    func request(
        _ request: OSSystemExtensionRequest,
        actionForReplacingExtension existing: OSSystemExtensionProperties,
        withExtension ext: OSSystemExtensionProperties
    ) -> OSSystemExtensionRequest.ReplacementAction {
        // Always replace with the new version
        return .replace
    }
}
