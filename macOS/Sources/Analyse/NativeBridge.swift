import AppKit
import UniformTypeIdentifiers
import WebKit
import AnalyseCore

final class NativeBridge: NSObject, WKScriptMessageHandler {
    static let messageName = "analyse"

    weak var webView: WKWebView?
    var onFrontendReady: (() -> Void)?
    private let stateStore: AppStateStore?
    private let stateStoreInitializationError: String?
    private let credentialStore = CredentialStore()
    private let tmdbService = TMDBService()
    private let workQueue = DispatchQueue(label: "app.analyse.native-bridge", qos: .userInitiated)

    override init() {
        do {
            stateStore = try AppStateStore()
            stateStoreInitializationError = nil
        } catch {
            stateStore = nil
            stateStoreInitializationError = error.localizedDescription
        }
        super.init()
    }

    static let injectedScript = #"""
    (() => {
      if (window.location.protocol !== "analyse-app:" || window.location.hostname !== "local") return;
      Object.defineProperty(window, "__ANALYSE_NATIVE__", { value: true, configurable: false, writable: false });
      const markNative = () => document.documentElement?.classList.add("native-shell");
      markNative();
      document.addEventListener("DOMContentLoaded", markNative, { once: true });

      let sequence = 0;
      const pending = new Map();

      const bridge = {
        call(command, payload = {}) {
          return new Promise((resolve, reject) => {
            if (typeof command !== "string" || command.length > 64) {
              reject(new Error("Commande native invalide."));
              return;
            }
            if (pending.size >= 64) {
              reject(new Error("Trop d’opérations natives sont déjà en cours."));
              return;
            }
            const id = `native-${Date.now()}-${++sequence}`;
            pending.set(id, { resolve, reject });
            window.webkit.messageHandlers.analyse.postMessage({ id, command, payload });
          });
        },
        _receive(message) {
          const request = pending.get(message.id);
          if (!request) return;
          pending.delete(message.id);
          if (message.error) request.reject(new Error(message.error));
          else request.resolve(message.result);
        }
      };
      Object.freeze(bridge);
      Object.defineProperty(window, "AnalyseNative", { value: bridge, configurable: false, writable: false });
    })();
    """#

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            message.name == Self.messageName,
            message.frameInfo.isMainFrame,
            message.frameInfo.securityOrigin.protocol == "analyse-app",
            message.frameInfo.securityOrigin.host == "local",
            message.webView === webView,
            let body = message.body as? [String: Any],
            let identifier = body["id"] as? String,
            identifier.utf8.count <= 128,
            let command = body["command"] as? String,
            command.utf8.count <= 64
        else { return }

        let payload = body["payload"] as? [String: Any] ?? [:]
        handle(command: command, identifier: identifier, payload: payload)
    }

    func handleExternalFiles(_ urls: [URL]) {
        guard let first = urls.first, first.isFileURL else { return }
        if Self.isSubtitle(first) {
            prepareSubtitle(first) { [weak self] result in
                self?.emitEvent(named: "analyse:subtitle-dropped", detail: result)
            }
        } else if Self.isVideo(first) {
            prepareVideo(first) { [weak self] result in
                self?.emitEvent(named: "analyse:file-dropped", detail: result)
            }
        } else if Self.isProject(first) {
            prepareProject(first) { [weak self] result in
                self?.emitEvent(named: "analyse:project-dropped", detail: result)
            }
        } else {
            emitEvent(named: "analyse:file-rejected", detail: [
                "message": "Ce type de fichier n’est pas pris en charge."
            ])
        }
    }

    private func handle(command: String, identifier: String, payload: [String: Any]) {
        switch command {
        case "openVideo":
            chooseVideo(identifier: identifier)
        case "openSubtitle":
            chooseSubtitle(identifier: identifier)
        case "inspectMetadata":
            guard let path = payload["path"] as? String else {
                respond(identifier: identifier, error: "Chemin vidéo manquant.")
                return
            }
            inspectMetadata(path: path, identifier: identifier)
        case "saveState":
            saveState(payload: payload, identifier: identifier)
        case "loadState":
            loadState(identifier: identifier)
        case "exportProject":
            exportProject(payload: payload, identifier: identifier)
        case "importProject":
            importProject(identifier: identifier)
        case "exportSelection":
            exportSelection(payload: payload, identifier: identifier)
        case "revealInFinder":
            guard
                let path = payload["path"] as? String,
                path.utf8.count <= 16_384,
                MediaAccessRegistry.shared.isApproved(URL(fileURLWithPath: path))
            else {
                respond(identifier: identifier, error: "Chemin manquant.")
                return
            }
            NSWorkspace.shared.activateFileViewerSelecting([MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))])
            respond(identifier: identifier, result: ["revealed": true])
        case "openExternal":
            guard
                let rawURL = payload["url"] as? String,
                rawURL.utf8.count <= 4_096,
                let url = URL(string: rawURL),
                AppURLPolicy.isAllowedExternalURL(url)
            else {
                respond(identifier: identifier, error: "Lien externe invalide.")
                return
            }
            DispatchQueue.main.async { [weak self] in
                let opened = NSWorkspace.shared.open(url)
                self?.respond(identifier: identifier, result: ["opened": opened])
            }
        case "tmdbStatus":
            do {
                let token = try credentialStore.readTMDBToken()
                respond(identifier: identifier, result: ["configured": !(token?.isEmpty ?? true)])
            } catch {
                respond(identifier: identifier, error: error.localizedDescription)
            }
        case "saveTMDBToken":
            guard let token = payload["token"] as? String else {
                respond(identifier: identifier, error: "Jeton TMDB manquant.")
                return
            }
            do {
                try credentialStore.saveTMDBToken(token)
                respond(identifier: identifier, result: ["configured": !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty])
            } catch {
                respond(identifier: identifier, error: error.localizedDescription)
            }
        case "searchTMDB":
            searchTMDB(payload: payload, identifier: identifier)
        case "tmdbDetails":
            loadTMDBDetails(payload: payload, identifier: identifier)
        case "applicationInfo":
            respond(identifier: identifier, result: [
                "platform": "macOS",
                "native": true,
                "ffprobeAvailable": FFprobeService.executableURL != nil,
                "applicationSupport": stateStore?.directoryPath ?? ""
            ])
        case "frontendReady":
            DispatchQueue.main.async { [weak self] in
                self?.onFrontendReady?()
                self?.respond(identifier: identifier, result: ["ready": true])
            }
        default:
            respond(identifier: identifier, error: "Commande native inconnue : \(command)")
        }
    }

    private func searchTMDB(payload: [String: Any], identifier: String) {
        guard let rawQuery = payload["query"] as? String else {
            respond(identifier: identifier, error: "Titre à rechercher manquant.")
            return
        }
        let query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, query.count <= 200 else {
            respond(identifier: identifier, error: "Le titre doit contenir entre 1 et 200 caractères.")
            return
        }
        let language = Self.validatedLanguage(payload["language"] as? String)
        do {
            guard let token = try credentialStore.readTMDBToken(), !token.isEmpty else {
                respond(identifier: identifier, error: "Ajoutez d’abord votre jeton d’accès TMDB.")
                return
            }
            tmdbService.search(query: query, language: language, token: token) { [weak self] result in
                switch result {
                case .success(let items):
                    self?.respond(identifier: identifier, result: items)
                case .failure(let error):
                    self?.respond(identifier: identifier, error: error.localizedDescription)
                }
            }
        } catch {
            respond(identifier: identifier, error: error.localizedDescription)
        }
    }

    private func loadTMDBDetails(payload: [String: Any], identifier: String) {
        guard
            let mediaType = payload["mediaType"] as? String,
            ["movie", "tv"].contains(mediaType),
            let rawIdentifier = payload["id"] as? NSNumber,
            rawIdentifier.intValue > 0
        else {
            respond(identifier: identifier, error: "Résultat TMDB incomplet.")
            return
        }
        let language = Self.validatedLanguage(payload["language"] as? String)
        do {
            guard let token = try credentialStore.readTMDBToken(), !token.isEmpty else {
                respond(identifier: identifier, error: "Ajoutez d’abord votre jeton d’accès TMDB.")
                return
            }
            tmdbService.details(
                mediaType: mediaType,
                identifier: rawIdentifier.intValue,
                language: language,
                token: token
            ) { [weak self] result in
                switch result {
                case .success(let details):
                    self?.respond(identifier: identifier, result: details)
                case .failure(let error):
                    self?.respond(identifier: identifier, error: error.localizedDescription)
                }
            }
        } catch {
            respond(identifier: identifier, error: error.localizedDescription)
        }
    }

    private func chooseVideo(identifier: String) {
        DispatchQueue.main.async { [weak self] in
            let panel = NSOpenPanel()
            panel.title = "Ouvrir un film ou un épisode"
            panel.prompt = "Ouvrir"
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = false
            panel.allowedContentTypes = Self.videoTypes

            guard panel.runModal() == .OK, let url = panel.url else {
                self?.respond(identifier: identifier, result: ["cancelled": true])
                return
            }

            self?.prepareVideo(url) { result in
                self?.respond(identifier: identifier, result: result)
            }
        }
    }

    private func chooseSubtitle(identifier: String) {
        DispatchQueue.main.async { [weak self] in
            let panel = NSOpenPanel()
            panel.title = "Ouvrir des sous-titres"
            panel.prompt = "Ouvrir"
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = false
            panel.allowedContentTypes = Self.subtitleTypes

            guard panel.runModal() == .OK, let url = panel.url else {
                self?.respond(identifier: identifier, result: ["cancelled": true])
                return
            }

            self?.prepareSubtitle(url) { result in
                self?.respond(identifier: identifier, result: result)
            }
        }
    }

    private func prepareVideo(_ url: URL, completion: @escaping ([String: Any]) -> Void) {
        workQueue.async {
            do {
                let safeURL = try Self.validatedVideoURL(url)
                MediaAccessRegistry.shared.approve(safeURL)
                var result: [String: Any] = [
                    "cancelled": false,
                    "name": safeURL.lastPathComponent,
                    "path": safeURL.path,
                    "mediaURL": Self.mediaURL(for: safeURL)
                ]
                do {
                    result["metadata"] = try FFprobeService.inspect(safeURL)
                } catch {
                    result["metadataError"] = error.localizedDescription
                }
                completion(result)
            } catch {
                completion(["cancelled": false, "error": error.localizedDescription])
            }
        }
    }

    private func prepareSubtitle(_ url: URL, completion: @escaping ([String: Any]) -> Void) {
        workQueue.async {
            do {
                let safeURL = try Self.validatedSubtitleURL(url)
                let data = try Data(contentsOf: safeURL, options: .mappedIfSafe)
                let content = String(data: data, encoding: .utf8)
                    ?? String(data: data, encoding: .windowsCP1252)
                    ?? String(decoding: data, as: UTF8.self)
                completion([
                    "cancelled": false,
                    "name": safeURL.lastPathComponent,
                    "path": safeURL.path,
                    "content": content
                ])
            } catch {
                completion([
                    "cancelled": false,
                    "name": url.lastPathComponent,
                    "path": url.path,
                    "error": error.localizedDescription
                ])
            }
        }
    }

    private func prepareProject(_ url: URL, completion: @escaping ([String: Any]) -> Void) {
        workQueue.async { [weak self] in
            guard let self else { return }
            do {
                completion(try self.projectImportResult(from: url))
            } catch {
                completion([
                    "cancelled": false,
                    "name": url.lastPathComponent,
                    "error": error.localizedDescription,
                ])
            }
        }
    }

    private func projectImportResult(from url: URL) throws -> [String: Any] {
        let safeURL = MediaAccessRegistry.normalizedURL(url)
        let values = try safeURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard
            safeURL.isFileURL,
            values.isRegularFile == true,
            values.isSymbolicLink != true,
            let rawSize = values.fileSize,
            rawSize > 0
        else { throw ProjectImportError.invalidFile }

        let extensionName = safeURL.pathExtension.lowercased()
        let result: (state: [String: Any], version: Int, portable: Bool)
        if extensionName == "cinecrique" {
            guard Int64(rawSize) <= ProjectArchivePolicy.maxArchiveBytes else {
                throw ProjectImportError.archiveTooLarge
            }
            result = try importProjectPackage(from: safeURL, compressedBytes: Int64(rawSize))
        } else {
            guard extensionName == "json", rawSize <= AppStateStore.maxStateBytes else {
                throw ProjectImportError.invalidFile
            }
            let rawState = try Self.readJSONObject(at: safeURL, maximumBytes: AppStateStore.maxStateBytes)
            guard let state = Self.validatedImportedState(rawState) else { throw ProjectImportError.invalidProject }
            result = (state, (rawState["version"] as? NSNumber)?.intValue ?? 1, false)
        }

        return [
            "cancelled": false,
            "name": safeURL.lastPathComponent,
            "state": result.state,
            "recovered": result.version < 5,
            "portable": result.portable,
        ]
    }

    private func importProjectPackage(from archiveURL: URL, compressedBytes: Int64) throws -> (state: [String: Any], version: Int, portable: Bool) {
        let manager = FileManager.default
        let temporaryRoot = manager.temporaryDirectory.appendingPathComponent("Cinecrique-Import-\(UUID().uuidString)", isDirectory: true)
        try manager.createDirectory(at: temporaryRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? manager.removeItem(at: temporaryRoot) }

        let entries = try Self.archiveEntries(at: archiveURL)
        try Self.extractArchive(
            archiveURL,
            entries: entries,
            to: temporaryRoot,
            maximumBytes: ProjectArchivePolicy.expandedByteLimit(compressedBytes: compressedBytes)
        )
        let packageRoot = try Self.projectPackageRoot(in: temporaryRoot)
        let manifest = try Self.readJSONObject(
            at: packageRoot.appendingPathComponent("manifest.json"),
            maximumBytes: 1 * 1_024 * 1_024
        )
        guard
            manifest["format"] as? String == "app.cinecrique.project",
            let formatVersion = (manifest["formatVersion"] as? NSNumber)?.intValue,
            formatVersion == 1
        else { throw ProjectImportError.unsupportedFormat }

        var rawState = try Self.readJSONObject(
            at: packageRoot.appendingPathComponent("project.json"),
            maximumBytes: AppStateStore.maxStateBytes
        )
        guard Self.validatedImportedState(rawState) != nil else { throw ProjectImportError.invalidProject }

        var portable = false
        if let embeddedPath = manifest["embeddedMedia"] as? String {
            _ = try ProjectArchivePolicy.validatedEntries([embeddedPath])
            let sourceURL = packageRoot.appendingPathComponent(embeddedPath).standardizedFileURL
            let rootPrefix = packageRoot.standardizedFileURL.path + "/"
            guard sourceURL.path.hasPrefix(rootPrefix) else { throw ProjectImportError.invalidArchive }
            let importedMediaURL = try persistEmbeddedMedia(try Self.validatedVideoURL(sourceURL))
            let activeIdentifier = rawState["activeProjectId"] as? String
            var projects = rawState["projects"] as? [[String: Any]] ?? []
            let targetIndex = projects.firstIndex(where: { ($0["id"] as? String) == activeIdentifier })
                ?? (projects.isEmpty ? nil : 0)
            if let targetIndex {
                projects[targetIndex]["path"] = importedMediaURL.path
                projects[targetIndex].removeValue(forKey: "mediaURL")
                rawState["projects"] = projects
                portable = true
            }
        }

        guard let state = Self.validatedImportedState(rawState) else { throw ProjectImportError.invalidProject }
        return (state, (rawState["version"] as? NSNumber)?.intValue ?? 1, portable)
    }

    private func persistEmbeddedMedia(_ sourceURL: URL) throws -> URL {
        guard let supportPath = stateStore?.directoryPath else {
            throw ProjectImportError.storageUnavailable
        }
        let manager = FileManager.default
        let importedRoot = URL(fileURLWithPath: supportPath, isDirectory: true)
            .appendingPathComponent("Imported Media", isDirectory: true)
        if manager.fileExists(atPath: importedRoot.path) {
            let values = try importedRoot.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else {
                throw ProjectImportError.storageUnavailable
            }
        } else {
            try manager.createDirectory(at: importedRoot, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        }
        let destinationDirectory = importedRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try manager.createDirectory(at: destinationDirectory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        do {
            let destination = destinationDirectory.appendingPathComponent(sourceURL.lastPathComponent)
            try manager.copyItem(at: sourceURL, to: destination)
            try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
            return try Self.validatedVideoURL(destination)
        } catch {
            try? manager.removeItem(at: destinationDirectory)
            throw error
        }
    }

    private func inspectMetadata(path: String, identifier: String) {
        guard path.utf8.count <= 16_384 else {
            respond(identifier: identifier, error: "Chemin vidéo invalide.")
            return
        }
        let url = MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))
        guard MediaAccessRegistry.shared.isApproved(url) else {
            respond(identifier: identifier, error: "Ce média n’a pas été autorisé.")
            return
        }
        workQueue.async { [weak self] in
            do {
                let metadata = try FFprobeService.inspect(Self.validatedVideoURL(url))
                self?.respond(identifier: identifier, result: metadata)
            } catch {
                self?.respond(identifier: identifier, error: error.localizedDescription)
            }
        }
    }

    private func saveState(payload: [String: Any], identifier: String) {
        guard let state = payload["state"] else {
            respond(identifier: identifier, error: "État du projet manquant.")
            return
        }
        workQueue.async { [weak self] in
            guard let self else { return }
            guard let stateStore = self.stateStore else {
                self.respond(identifier: identifier, error: self.stateStoreInitializationError ?? "Le stockage local est indisponible.")
                return
            }
            do {
                try stateStore.save(state)
                self.respond(identifier: identifier, result: ["saved": true])
            } catch {
                self.respond(identifier: identifier, error: error.localizedDescription)
            }
        }
    }

    private func loadState(identifier: String) {
        workQueue.async { [weak self] in
            guard let self else { return }
            guard let stateStore = self.stateStore else {
                self.respond(identifier: identifier, error: self.stateStoreInitializationError ?? "Le stockage local est indisponible.")
                return
            }
            do {
                let loadedState = try stateStore.load()
                var state = Self.sanitizedPersistedState(loadedState)
                if stateStore.recoveredFromSnapshot {
                    state?["_recoveredFromSnapshot"] = true
                }
                self.respond(identifier: identifier, result: state ?? NSNull())
            } catch {
                self.respond(identifier: identifier, error: error.localizedDescription)
            }
        }
    }

    private func exportProject(payload: [String: Any], identifier: String) {
        guard let state = payload["state"], JSONSerialization.isValidJSONObject(state) else {
            respond(identifier: identifier, error: "Projet invalide.")
            return
        }
        guard
            let data = try? JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys]),
            data.count <= AppStateStore.maxStateBytes
        else {
            respond(identifier: identifier, error: "Le projet dépasse la limite d’export de 32 Mo.")
            return
        }

        let rawName = (payload["suggestedName"] as? String) ?? "analyse-projet.json"
        let safeName = rawName
            .components(separatedBy: CharacterSet(charactersIn: "/\\:"))
            .joined(separator: "-")
            .prefix(180)

        DispatchQueue.main.async { [weak self] in
            let panel = NSSavePanel()
            panel.title = "Exporter le projet"
            panel.prompt = "Exporter"
            panel.nameFieldStringValue = safeName.isEmpty ? "analyse-projet.json" : String(safeName)
            panel.allowedContentTypes = [UTType.json]

            guard panel.runModal() == .OK, let url = panel.url else {
                self?.respond(identifier: identifier, result: ["cancelled": true])
                return
            }

            do {
                try data.write(to: url, options: .atomic)
                self?.respond(identifier: identifier, result: ["cancelled": false, "path": url.path])
            } catch {
                self?.respond(identifier: identifier, error: error.localizedDescription)
            }
        }
    }

    private func importProject(identifier: String) {
        DispatchQueue.main.async { [weak self] in
            let panel = NSOpenPanel()
            panel.title = "Importer un projet Cinécrique"
            panel.prompt = "Importer"
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = false
            panel.allowedContentTypes = [Self.projectType, .json]

            guard panel.runModal() == .OK, let url = panel.url else {
                self?.respond(identifier: identifier, result: ["cancelled": true])
                return
            }

            self?.prepareProject(url) { result in
                if let error = result["error"] as? String {
                    self?.respond(identifier: identifier, error: error)
                } else {
                    self?.respond(identifier: identifier, result: result)
                }
            }
        }
    }

    private func exportSelection(payload: [String: Any], identifier: String) {
        do {
            let rawFiles = payload["files"] as? [[String: Any]] ?? []
            guard rawFiles.count <= 20 else { throw SelectionExportError.tooManyItems }
            var totalTextBytes = 0
            let textFiles = try rawFiles.map { item -> ExportService.TextFile in
                guard let name = Self.safeExportFileName(item["name"] as? String), let content = item["content"] as? String else {
                    throw SelectionExportError.invalidItem
                }
                totalTextBytes += content.utf8.count
                guard content.utf8.count <= 8 * 1_024 * 1_024, totalTextBytes <= AppStateStore.maxStateBytes else {
                    throw SelectionExportError.tooLarge
                }
                return ExportService.TextFile(name: name, content: content)
            }

            let rawFrames = payload["frames"] as? [[String: Any]] ?? []
            let frames = try Self.exportFrames(from: rawFrames)

            var projectPackage: ExportService.ProjectPackage?
            if let rawPackage = payload["projectPackage"] as? [String: Any] {
                guard
                    let state = rawPackage["state"] as? [String: Any],
                    JSONSerialization.isValidJSONObject(state),
                    let stateData = try? JSONSerialization.data(withJSONObject: state),
                    stateData.count <= AppStateStore.maxStateBytes
                else { throw SelectionExportError.invalidProject }
                let projectFrames = try Self.exportFrames(from: rawPackage["frames"] as? [[String: Any]] ?? [])
                projectPackage = ExportService.ProjectPackage(
                    state: state,
                    includeVideo: (rawPackage["includeVideo"] as? Bool) ?? false,
                    frames: projectFrames
                )
            }

            let includeVideo = (payload["includeVideo"] as? Bool) ?? false
            let needsMedia = includeVideo
                || !frames.isEmpty
                || projectPackage?.includeVideo == true
                || !(projectPackage?.frames.isEmpty ?? true)
            var mediaURL: URL?
            if needsMedia {
                guard
                    let path = payload["mediaPath"] as? String,
                    path.utf8.count <= 16_384
                else { throw SelectionExportError.missingMedia }
                let candidate = MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))
                guard MediaAccessRegistry.shared.isApproved(candidate) else { throw SelectionExportError.missingMedia }
                mediaURL = try Self.validatedVideoURL(candidate)
            }

            let itemCount = textFiles.count + (includeVideo ? 1 : 0) + frames.count + (projectPackage == nil ? 0 : 1)
            guard itemCount > 0 else { throw SelectionExportError.emptySelection }
            let baseName = Self.safeExportBaseName(payload["suggestedName"] as? String)

            DispatchQueue.main.async { [weak self] in
                let panel = NSSavePanel()
                panel.title = itemCount > 1 ? "Exporter une archive Cinécrique" : "Exporter l’élément"
                panel.prompt = "Exporter"
                if itemCount > 1 {
                    panel.nameFieldStringValue = "\(baseName).zip"
                    panel.allowedContentTypes = [.zip]
                } else if let file = textFiles.first {
                    panel.nameFieldStringValue = file.name
                    panel.allowedContentTypes = [UTType(filenameExtension: URL(fileURLWithPath: file.name).pathExtension) ?? .data]
                } else if includeVideo, let mediaURL {
                    panel.nameFieldStringValue = mediaURL.lastPathComponent
                    panel.allowedContentTypes = [UTType(filenameExtension: mediaURL.pathExtension) ?? .movie]
                } else if let frame = frames.first {
                    panel.nameFieldStringValue = frame.name
                    panel.allowedContentTypes = [.png]
                } else if projectPackage != nil {
                    panel.nameFieldStringValue = "\(baseName).cinecrique"
                    panel.allowedContentTypes = [Self.projectType]
                }

                guard panel.runModal() == .OK, let destination = panel.url else {
                    self?.respond(identifier: identifier, result: ["cancelled": true])
                    return
                }

                self?.workQueue.async { [weak self] in
                    do {
                        if itemCount > 1 {
                            try ExportService.writeArchive(
                                named: baseName,
                                textFiles: textFiles,
                                mediaURL: mediaURL,
                                includeVideo: includeVideo,
                                frames: frames,
                                projectPackage: projectPackage,
                                to: destination
                            )
                        } else if let file = textFiles.first {
                            try ExportService.writeSingleText(file, to: destination)
                        } else if includeVideo, let mediaURL {
                            try ExportService.copyVideo(from: mediaURL, to: destination)
                        } else if let frame = frames.first, let mediaURL {
                            try ExportService.writeFrame(frame, mediaURL: mediaURL, to: destination)
                        } else if let projectPackage {
                            try ExportService.writeProjectPackage(
                                projectPackage,
                                named: baseName,
                                mediaURL: mediaURL,
                                to: destination
                            )
                        }
                        self?.respond(identifier: identifier, result: ["cancelled": false, "path": destination.path])
                    } catch {
                        self?.respond(identifier: identifier, error: error.localizedDescription)
                    }
                }
            }
        } catch {
            respond(identifier: identifier, error: error.localizedDescription)
        }
    }

    private func respond(identifier: String, result: Any? = nil, error: String? = nil) {
        var envelope: [String: Any] = ["id": identifier]
        envelope["result"] = result ?? NSNull()
        envelope["error"] = error ?? NSNull()

        guard JSONSerialization.isValidJSONObject(envelope) else { return }

        DispatchQueue.main.async { [weak self] in
            self?.webView?.callAsyncJavaScript(
                "window.AnalyseNative?._receive(message);",
                arguments: ["message": envelope],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }
    }

    private func emitEvent(named name: String, detail: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(detail) else { return }

        DispatchQueue.main.async { [weak self] in
            self?.webView?.callAsyncJavaScript(
                "window.dispatchEvent(new CustomEvent(name, { detail }));",
                arguments: ["name": name, "detail": detail],
                in: nil,
                in: .page,
                completionHandler: nil
            )
        }
    }

    private static func exportFrames(from rawFrames: [[String: Any]]) throws -> [ExportService.Frame] {
        guard rawFrames.count <= 500 else { throw SelectionExportError.tooManyItems }
        return try rawFrames.map { item in
            guard
                let rawName = safeExportFileName(item["name"] as? String),
                let time = (item["time"] as? NSNumber)?.doubleValue,
                time.isFinite,
                time >= 0
            else { throw SelectionExportError.invalidItem }
            let name = rawName.lowercased().hasSuffix(".png") ? rawName : "\(rawName).png"
            let annotations = (item["annotations"] as? [[String: Any]] ?? []).prefix(1_000)
            return ExportService.Frame(name: name, time: time, annotations: Array(annotations))
        }
    }

    private static func validatedImportedState(_ rawState: [String: Any]) -> [String: Any]? {
        guard
            let projects = rawState["projects"] as? [Any],
            projects.count <= 500,
            (!projects.isEmpty || ((rawState["version"] as? NSNumber)?.intValue ?? 0) >= 5),
            projects.allSatisfy({ $0 is [String: Any] })
        else { return nil }
        return sanitizedPersistedState(rawState)
    }

    private static func readJSONObject(at url: URL, maximumBytes: Int) throws -> [String: Any] {
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard
            values.isRegularFile == true,
            values.isSymbolicLink != true,
            let size = values.fileSize,
            size >= 0,
            size <= maximumBytes
        else { throw ProjectImportError.invalidFile }
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ProjectImportError.invalidProject
        }
        return object
    }

    private static func archiveEntries(at archiveURL: URL) throws -> [String] {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = ["-Z1", archiveURL.path]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            throw ProjectImportError.invalidArchive
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard
            process.terminationStatus == 0,
            let listing = String(data: data, encoding: .utf8)
        else { throw ProjectImportError.invalidArchive }
        let names = listing.split(whereSeparator: { $0.isNewline }).map(String.init)
        do {
            return try ProjectArchivePolicy.validatedEntries(names)
        } catch {
            throw ProjectImportError.invalidArchive
        }
    }

    private static func extractArchive(
        _ archiveURL: URL,
        entries: [String],
        to root: URL,
        maximumBytes: Int64
    ) throws {
        let manager = FileManager.default
        let rootPrefix = root.standardizedFileURL.path + "/"
        var expandedBytes: Int64 = 0

        for entry in entries {
            let isDirectory = entry.hasSuffix("/")
            let destination = root.appendingPathComponent(entry, isDirectory: isDirectory).standardizedFileURL
            guard destination.path.hasPrefix(rootPrefix) else { throw ProjectImportError.invalidArchive }
            if isDirectory {
                try manager.createDirectory(at: destination, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                continue
            }

            try manager.createDirectory(
                at: destination.deletingLastPathComponent(),
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            guard manager.createFile(atPath: destination.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
                throw ProjectImportError.invalidArchive
            }
            let writer = try FileHandle(forWritingTo: destination)
            let output = Pipe()
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
            process.arguments = ["-p", archiveURL.path, entry]
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            do {
                try process.run()
                while true {
                    let chunk = output.fileHandleForReading.readData(ofLength: 1 * 1_024 * 1_024)
                    if chunk.isEmpty { break }
                    guard Int64(chunk.count) <= maximumBytes - expandedBytes else {
                        process.terminate()
                        process.waitUntilExit()
                        throw ProjectArchiveError.expandedDataTooLarge
                    }
                    expandedBytes += Int64(chunk.count)
                    writer.write(chunk)
                }
                process.waitUntilExit()
                guard process.terminationStatus == 0 else { throw ProjectImportError.invalidArchive }
                try writer.close()
            } catch {
                try? writer.close()
                if process.isRunning {
                    process.terminate()
                    process.waitUntilExit()
                }
                try? manager.removeItem(at: destination)
                throw error
            }
        }
    }

    private static func projectPackageRoot(in extractionRoot: URL) throws -> URL {
        let manager = FileManager.default
        func isPackageRoot(_ url: URL) -> Bool {
            manager.fileExists(atPath: url.appendingPathComponent("manifest.json").path)
                && manager.fileExists(atPath: url.appendingPathComponent("project.json").path)
        }
        if isPackageRoot(extractionRoot) { return extractionRoot }

        let children = try manager.contentsOfDirectory(
            at: extractionRoot,
            includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
            options: [.skipsHiddenFiles]
        )
        let candidates = try children.filter { child in
            let values = try child.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            return values.isDirectory == true && values.isSymbolicLink != true && isPackageRoot(child)
        }
        guard candidates.count == 1, let root = candidates.first else {
            throw ProjectImportError.invalidArchive
        }
        return root
    }

    private static func mediaURL(for url: URL) -> String {
        var components = URLComponents()
        components.scheme = "analyse-media"
        components.host = "local"
        components.queryItems = [URLQueryItem(name: "path", value: MediaAccessRegistry.normalizedURL(url).path)]
        return components.url?.absoluteString ?? ""
    }

    private static func sanitizedPersistedState(_ state: Any?) -> [String: Any]? {
        guard var dictionary = state as? [String: Any] else { return nil }
        let projects = (dictionary["projects"] as? [[String: Any]] ?? []).prefix(500).map { project in
            var safeProject = project
            safeProject["poster"] = Self.safePosterPath(project["poster"] as? String)
            safeProject.removeValue(forKey: "mediaURL")
            safeProject.removeValue(forKey: "mediaMissing")

            guard
                let path = project["path"] as? String,
                !path.hasPrefix("browser:"),
                path.utf8.count <= 16_384
            else {
                safeProject.removeValue(forKey: "path")
                return safeProject
            }

            let candidate = MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))
            guard videoExtensions.contains(candidate.pathExtension.lowercased()) else {
                safeProject.removeValue(forKey: "path")
                return safeProject
            }
            safeProject["path"] = candidate.path
            guard let safeURL = try? validatedVideoURL(candidate) else { return safeProject }

            MediaAccessRegistry.shared.approve(safeURL)
            safeProject["path"] = safeURL.path
            safeProject["mediaURL"] = mediaURL(for: safeURL)
            return safeProject
        }
        dictionary["projects"] = Array(projects)
        return dictionary
    }

    private static func validatedVideoURL(_ url: URL) throws -> URL {
        try validatedFileURL(url, extensions: videoExtensions, maximumBytes: nil)
    }

    private static func validatedSubtitleURL(_ url: URL) throws -> URL {
        try validatedFileURL(url, extensions: subtitleExtensions, maximumBytes: 20 * 1_024 * 1_024)
    }

    private static func validatedFileURL(
        _ url: URL,
        extensions: Set<String>,
        maximumBytes: Int?
    ) throws -> URL {
        guard url.isFileURL, url.path.utf8.count <= 16_384 else { throw FileValidationError.invalidFile }
        let safeURL = MediaAccessRegistry.normalizedURL(url)
        guard extensions.contains(safeURL.pathExtension.lowercased()) else {
            throw FileValidationError.unsupportedType
        }
        let values = try safeURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, let size = values.fileSize, size >= 0 else {
            throw FileValidationError.invalidFile
        }
        if let maximumBytes, size > maximumBytes {
            throw FileValidationError.tooLarge(maximumBytes / (1_024 * 1_024))
        }
        return safeURL
    }

    private static func safePosterPath(_ value: String?) -> String {
        let allowed = ["./assets/poster-coast.png", "./assets/poster-paris.png", "./assets/poster-rain.png"]
        guard let value, allowed.contains(value) else { return "./assets/poster-coast.png" }
        return value
    }

    private static func safeExportFileName(_ value: String?) -> String? {
        guard let value, !value.isEmpty, value.utf8.count <= 512 else { return nil }
        let cleaned = value
            .components(separatedBy: CharacterSet(charactersIn: "/\\:"))
            .joined(separator: "-")
            .components(separatedBy: .controlCharacters)
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty, cleaned != ".", cleaned != "..", !cleaned.hasPrefix(".") else { return nil }
        return String(cleaned.prefix(180))
    }

    private static func safeExportBaseName(_ value: String?) -> String {
        let candidate = safeExportFileName(value) ?? "cinecrique"
        let withoutExtension = URL(fileURLWithPath: candidate).deletingPathExtension().lastPathComponent
        return withoutExtension.isEmpty ? "cinecrique" : String(withoutExtension.prefix(100))
    }

    private static func validatedLanguage(_ value: String?) -> String {
        guard let value, allowedLanguages.contains(value) else { return "fr-FR" }
        return value
    }

    private static let allowedLanguages: Set<String> = ["fr-FR", "en-US", "es-ES", "de-DE", "it-IT"]
    private static let videoExtensions: Set<String> = [
        "mov", "mp4", "m4v", "mkv", "avi", "webm", "mpg", "mpeg", "ts", "m2ts"
    ]
    private static let subtitleExtensions: Set<String> = ["srt", "vtt", "ass", "ssa"]

    private enum FileValidationError: LocalizedError {
        case invalidFile
        case unsupportedType
        case tooLarge(Int)

        var errorDescription: String? {
            switch self {
            case .invalidFile:
                return "Le fichier sélectionné est invalide ou inaccessible."
            case .unsupportedType:
                return "Ce type de fichier n’est pas pris en charge."
            case .tooLarge(let megabytes):
                return "Le fichier dépasse la limite de \(megabytes) Mo."
            }
        }
    }

    private enum ProjectImportError: LocalizedError {
        case invalidFile
        case invalidProject
        case invalidArchive
        case unsupportedFormat
        case archiveTooLarge
        case storageUnavailable

        var errorDescription: String? {
            switch self {
            case .invalidFile: return "Le fichier de projet est invalide ou inaccessible."
            case .invalidProject: return "Le fichier ne contient pas un projet Cinécrique valide."
            case .invalidArchive: return "L’archive .cinecrique est corrompue ou contient des chemins non sûrs."
            case .unsupportedFormat: return "Cette version du format .cinecrique n’est pas prise en charge."
            case .archiveTooLarge: return "L’archive .cinecrique dépasse la limite de 50 Go."
            case .storageUnavailable: return "Le média intégré ne peut pas être copié dans le stockage local."
            }
        }
    }

    private enum SelectionExportError: LocalizedError {
        case emptySelection
        case invalidItem
        case tooManyItems
        case tooLarge
        case missingMedia
        case invalidProject

        var errorDescription: String? {
            switch self {
            case .emptySelection: return "Sélectionnez au moins un élément à exporter."
            case .invalidItem: return "Un élément d’export est invalide."
            case .tooManyItems: return "La sélection contient trop d’éléments."
            case .tooLarge: return "Les données textuelles dépassent la limite de 32 Mo."
            case .missingMedia: return "Le média original est introuvable ou n’est plus autorisé."
            case .invalidProject: return "Le projet Cinécrique à exporter est invalide ou trop volumineux."
            }
        }
    }

    private static func isSubtitle(_ url: URL) -> Bool {
        subtitleExtensions.contains(url.pathExtension.lowercased())
    }

    private static func isVideo(_ url: URL) -> Bool {
        videoExtensions.contains(url.pathExtension.lowercased())
    }

    private static func isProject(_ url: URL) -> Bool {
        ["cinecrique", "json"].contains(url.pathExtension.lowercased())
    }

    private static let projectType = UTType(exportedAs: "app.cinecrique.project", conformingTo: .data)

    private static let videoTypes: [UTType] = {
        videoExtensions.compactMap { UTType(filenameExtension: $0) }
    }()

    private static let subtitleTypes: [UTType] = {
        subtitleExtensions.compactMap { UTType(filenameExtension: $0) }
    }()
}
