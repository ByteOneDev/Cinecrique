import Foundation
import Security

final class CredentialStore {
    private let service = "app.analyse.local"
    private let account = "tmdb-read-token"

    func readTMDBToken() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        guard let data = item as? Data, let token = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }
        return token
    }

    func saveTMDBToken(_ token: String) throws {
        let value = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty {
            guard value.utf8.count <= 4_096, value.unicodeScalars.allSatisfy({ 33...126 ~= $0.value }) else {
                throw KeychainError.invalidToken
            }
        }
        let deleteStatus = SecItemDelete(baseQuery as CFDictionary)
        guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
            throw KeychainError(status: deleteStatus)
        }
        guard !value.isEmpty else { return }

        var item = baseQuery
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
            kSecUseDataProtectionKeychain as String: true
        ]
    }

    enum KeychainError: LocalizedError {
        case invalidData
        case invalidToken
        case status(OSStatus)

        init(status: OSStatus) {
            self = .status(status)
        }

        var errorDescription: String? {
            switch self {
            case .invalidData:
                return "Le jeton TMDB enregistré est illisible."
            case .invalidToken:
                return "Le jeton TMDB contient des caractères invalides ou dépasse 4 Ko."
            case .status(let status):
                return SecCopyErrorMessageString(status, nil) as String? ?? "Erreur du Trousseau macOS (\(status))."
            }
        }
    }
}
