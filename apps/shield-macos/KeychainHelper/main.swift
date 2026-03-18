/**
 * AgenShield Keychain Helper
 *
 * A lightweight CLI tool that bridges Node.js with macOS Security.framework.
 * Reads JSON commands from stdin, performs Keychain operations, writes JSON to stdout.
 *
 * Protocol:
 *   stdin  → { "command": "set"|"get"|"delete"|"has"|"icloud-detect"|"icloud-backup"|"icloud-restore",
 *              "service": "...", "account": "...", "data": "base64...", ... }
 *   stdout → { "success": true|false, "data": "base64...", "error": "..." }
 *
 * Build (no signing required):
 *   swiftc -O -o agenshield-keychain main.swift KeychainOperations.swift ICloudSync.swift
 */

import Foundation

// MARK: - JSON Request/Response Types

struct Request: Codable {
    let command: String
    let service: String?
    let account: String?
    let data: String? // base64 encoded
    let accessible: String?
    let synchronizable: Bool?
    let label: String?
    // iCloud fields
    let sourcePath: String?
    let destPath: String?
    let excludePatterns: [String]?
}

struct Response: Codable {
    let success: Bool
    var data: String? // base64 encoded
    var error: String?
    var errorCode: String?
    // iCloud-specific
    var backupFound: Bool?
    var backupPath: String?
    var backupDate: String?
    var files: [String]?
}

// MARK: - Main

func main() {
    // Read all stdin
    let inputData = FileHandle.standardInput.readDataToEndOfFile()

    guard !inputData.isEmpty else {
        writeResponse(Response(success: false, error: "No input provided"))
        return
    }

    let decoder = JSONDecoder()
    guard let request = try? decoder.decode(Request.self, from: inputData) else {
        writeResponse(Response(success: false, error: "Invalid JSON input"))
        return
    }

    let response: Response

    switch request.command {
    case "set":
        response = handleSet(request)
    case "get":
        response = handleGet(request)
    case "delete":
        response = handleDelete(request)
    case "has":
        response = handleHas(request)
    case "icloud-detect":
        response = handleICloudDetect(request)
    case "icloud-backup":
        response = handleICloudBackup(request)
    case "icloud-restore":
        response = handleICloudRestore(request)
    default:
        response = Response(success: false, error: "Unknown command: \(request.command)")
    }

    writeResponse(response)
}

func writeResponse(_ response: Response) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    if let data = try? encoder.encode(response),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    } else {
        print("{\"success\":false,\"error\":\"Failed to encode response\"}")
    }
}

// MARK: - Keychain Handlers

func handleSet(_ request: Request) -> Response {
    guard let service = request.service,
          let account = request.account,
          let dataB64 = request.data,
          let data = Data(base64Encoded: dataB64) else {
        return Response(success: false, error: "Missing required fields: service, account, data")
    }

    let accessible = mapAccessibility(request.accessible)
    let synchronizable = request.synchronizable ?? false

    let result = KeychainOperations.set(
        service: service,
        account: account,
        data: data,
        accessible: accessible,
        synchronizable: synchronizable,
        label: request.label
    )

    switch result {
    case .success:
        return Response(success: true)
    case .failure(let error):
        return Response(success: false, error: error.localizedDescription, errorCode: error.code)
    }
}

func handleGet(_ request: Request) -> Response {
    guard let service = request.service,
          let account = request.account else {
        return Response(success: false, error: "Missing required fields: service, account")
    }

    let result = KeychainOperations.get(service: service, account: account)

    switch result {
    case .success(let data):
        return Response(success: true, data: data.base64EncodedString())
    case .failure(let error):
        if error.code == "errSecItemNotFound" {
            return Response(success: false, error: "Item not found", errorCode: "errSecItemNotFound")
        }
        return Response(success: false, error: error.localizedDescription, errorCode: error.code)
    }
}

func handleDelete(_ request: Request) -> Response {
    guard let service = request.service,
          let account = request.account else {
        return Response(success: false, error: "Missing required fields: service, account")
    }

    let result = KeychainOperations.delete(service: service, account: account)

    switch result {
    case .success:
        return Response(success: true)
    case .failure(let error):
        return Response(success: false, error: error.localizedDescription, errorCode: error.code)
    }
}

func handleHas(_ request: Request) -> Response {
    guard let service = request.service,
          let account = request.account else {
        return Response(success: false, error: "Missing required fields: service, account")
    }

    let result = KeychainOperations.has(service: service, account: account)

    switch result {
    case .success(let exists):
        return Response(success: exists)
    case .failure(let error):
        return Response(success: false, error: error.localizedDescription, errorCode: error.code)
    }
}

// MARK: - iCloud Handlers

func handleICloudDetect(_ request: Request) -> Response {
    return ICloudSync.detect()
}

func handleICloudBackup(_ request: Request) -> Response {
    guard let sourcePath = request.sourcePath else {
        return Response(success: false, error: "Missing sourcePath")
    }
    return ICloudSync.backup(
        sourcePath: sourcePath,
        excludePatterns: request.excludePatterns ?? []
    )
}

func handleICloudRestore(_ request: Request) -> Response {
    guard let destPath = request.destPath else {
        return Response(success: false, error: "Missing destPath")
    }
    return ICloudSync.restore(destPath: destPath)
}

// MARK: - Helpers

func mapAccessibility(_ value: String?) -> CFString {
    switch value {
    case "WhenUnlocked":
        return kSecAttrAccessibleWhenUnlocked
    case "WhenUnlockedThisDeviceOnly":
        return kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    case "AfterFirstUnlock":
        return kSecAttrAccessibleAfterFirstUnlock
    case "AfterFirstUnlockThisDeviceOnly":
        return kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    default:
        return kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    }
}

// Entry point
main()
