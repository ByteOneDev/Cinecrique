import AppKit
import Foundation

enum CoverService {
    static let maximumInputBytes = 20 * 1_024 * 1_024
    static let maximumEncodedBytes = 1 * 1_024 * 1_024
    static let supportedExtensions: Set<String> = ["jpg", "jpeg", "png", "webp", "heic", "heif", "tif", "tiff"]

    static func dataURL(fromFile url: URL) throws -> String {
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard
            url.isFileURL,
            supportedExtensions.contains(url.pathExtension.lowercased()),
            values.isRegularFile == true,
            values.isSymbolicLink != true,
            let size = values.fileSize,
            size > 0,
            size <= maximumInputBytes
        else { throw CoverError.invalidImage }
        return try dataURL(from: Data(contentsOf: url, options: .mappedIfSafe))
    }

    static func dataURL(from data: Data) throws -> String {
        guard data.count <= maximumInputBytes, let image = NSImage(data: data) else {
            throw CoverError.invalidImage
        }
        let source = image.size
        guard source.width > 0, source.height > 0 else { throw CoverError.invalidImage }
        let scale = min(1, 900 / source.width, 1_350 / source.height)
        let targetSize = NSSize(width: max(1, source.width * scale), height: max(1, source.height * scale))
        let rendered = NSImage(size: targetSize)
        rendered.lockFocus()
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(in: NSRect(origin: .zero, size: targetSize), from: .zero, operation: .sourceOver, fraction: 1)
        rendered.unlockFocus()

        guard let tiff = rendered.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else {
            throw CoverError.invalidImage
        }
        for quality in [0.82, 0.68, 0.52] {
            if let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: quality]),
               jpeg.count <= maximumEncodedBytes {
                return "data:image/jpeg;base64,\(jpeg.base64EncodedString())"
            }
        }
        throw CoverError.imageTooLarge
    }

    enum CoverError: LocalizedError {
        case invalidImage
        case imageTooLarge

        var errorDescription: String? {
            switch self {
            case .invalidImage: return "Cette image de couverture est invalide ou n’est pas prise en charge."
            case .imageTooLarge: return "La couverture reste trop volumineuse après redimensionnement."
            }
        }
    }
}

