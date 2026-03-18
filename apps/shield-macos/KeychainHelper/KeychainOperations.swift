/**
 * Keychain Operations
 *
 * Wraps Security.framework SecItem* functions for generic password operations.
 * Works without entitlements for app-own keychain items in development.
 * keychain-access-groups entitlement is only needed for cross-app sharing (production).
 */

import Foundation
import Security

struct KeychainOpsError: Error, LocalizedError {
    let code: String
    let message: String

    var errorDescription: String? { message }

    static func fromOSStatus(_ status: OSStatus) -> KeychainOpsError {
        let code: String
        switch status {
        case errSecItemNotFound:
            code = "errSecItemNotFound"
        case errSecDuplicateItem:
            code = "errSecDuplicateItem"
        case errSecAuthFailed:
            code = "errSecAuthFailed"
        case errSecUserCanceled:
            code = "errSecUserCanceled"
        case errSecInteractionNotAllowed:
            code = "errSecInteractionNotAllowed"
        default:
            code = "errSec\(status)"
        }

        let message = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
        return KeychainOpsError(code: code, message: message)
    }
}

enum KeychainOperations {

    /// Store or update a generic password in the Keychain.
    static func set(
        service: String,
        account: String,
        data: Data,
        accessible: CFString,
        synchronizable: Bool,
        label: String?
    ) -> Result<Void, KeychainOpsError> {

        // Try to update first (if item already exists)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        var updateAttrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: accessible,
            kSecAttrSynchronizable as String: synchronizable ? kCFBooleanTrue! : kCFBooleanFalse!,
        ]
        if let label = label {
            updateAttrs[kSecAttrLabel as String] = label
        }

        let updateStatus = SecItemUpdate(query as CFDictionary, updateAttrs as CFDictionary)

        if updateStatus == errSecSuccess {
            return .success(())
        }

        if updateStatus != errSecItemNotFound {
            // Update failed for a reason other than "not found" — try delete + add
            SecItemDelete(query as CFDictionary)
        }

        // Add new item
        var addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: accessible,
            kSecAttrSynchronizable as String: synchronizable ? kCFBooleanTrue! : kCFBooleanFalse!,
        ]
        if let label = label {
            addQuery[kSecAttrLabel as String] = label
        }

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)

        if addStatus == errSecSuccess {
            return .success(())
        }

        return .failure(.fromOSStatus(addStatus))
    }

    /// Retrieve a generic password from the Keychain.
    static func get(service: String, account: String) -> Result<Data, KeychainOpsError> {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess, let data = result as? Data {
            return .success(data)
        }

        return .failure(.fromOSStatus(status))
    }

    /// Delete a generic password from the Keychain.
    static func delete(service: String, account: String) -> Result<Void, KeychainOpsError> {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        let status = SecItemDelete(query as CFDictionary)

        if status == errSecSuccess || status == errSecItemNotFound {
            return .success(())
        }

        return .failure(.fromOSStatus(status))
    }

    /// Check if a generic password exists in the Keychain.
    static func has(service: String, account: String) -> Result<Bool, KeychainOpsError> {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: false,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        let status = SecItemCopyMatching(query as CFDictionary, nil)

        if status == errSecSuccess {
            return .success(true)
        }

        if status == errSecItemNotFound {
            return .success(false)
        }

        return .failure(.fromOSStatus(status))
    }
}
