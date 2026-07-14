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
    private let stateQueue = DispatchQueue(label: "app.analyse.state-store", qos: .userInitiated)
    private let mediaProxyService: MediaProxyService?
    private let mediaProxyInitializationError: String?
    private let pendingImportLock = NSLock()
    private var pendingImportedMedia: [String: URL] = [:]

    override init() {
        let loadedStore: AppStateStore?
        let storeError: String?
        do {
            loadedStore = try AppStateStore()
            storeError = nil
        } catch {
            loadedStore = nil
            storeError = error.localizedDescription
        }
        stateStore = loadedStore
        stateStoreInitializationError = storeError

        if let supportPath = loadedStore?.directoryPath {
            do {
                mediaProxyService = try MediaProxyService(
                    applicationSupportDirectory: URL(fileURLWithPath: supportPath, isDirectory: true)
                )
                mediaProxyInitializationError = nil
            } catch {
                mediaProxyService = nil
                mediaProxyInitializationError = error.localizedDescription
            }
        } else {
            mediaProxyService = nil
            mediaProxyInitializationError = storeError
        }
        super.init()
    }

    deinit {
        pendingImportLock.lock()
        let directories = Array(pendingImportedMedia.values)
        pendingImportedMedia.removeAll()
        pendingImportLock.unlock()
        for directory in directories { try? FileManager.default.removeItem(at: directory) }
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
        case "prepareExistingVideo":
            prepareExistingVideo(payload: payload, identifier: identifier)
        case "cancelMediaPreparation":
            guard let operationID = payload["operationId"] as? String, operationID.utf8.count <= 128 else {
                respond(identifier: identifier, error: "Opération média invalide.")
                return
            }
            let cancelled = mediaProxyService?.cancel(operationID: operationID) ?? false
            respond(identifier: identifier, result: ["cancelled": cancelled])
        case "clearMediaProxy":
            clearMediaProxy(payload: payload, identifier: identifier)
        case "openSubtitle":
            chooseSubtitle(identifier: identifier)
        case "inspectMetadata":
            guard let path = payload["path"] as? String else {
                respond(identifier: identifier, error: "Chemin vidéo manquant.")
                return
            }
            inspectMetadata(path: path, identifier: identifier)
        case "renderThumbnail":
            renderThumbnail(payload: payload, identifier: identifier)
        case "chooseCoverImage":
            chooseCoverImage(identifier: identifier)
        case "captureCoverFrame":
            captureCoverFrame(payload: payload, identifier: identifier)
        case "downloadTMDBCover":
            downloadTMDBCover(payload: payload, identifier: identifier)
        case "saveState":
            saveState(payload: payload, identifier: identifier)
        case "createStateSnapshot":
            createStateSnapshot(identifier: identifier)
        case "restoreStateSnapshot":
            restoreStateSnapshot(payload: payload, identifier: identifier)
        case "loadState":
            loadState(identifier: identifier)
        case "exportProject":
            exportProject(payload: payload, identifier: identifier)
        case "importProject":
            importProject(identifier: identifier)
        case "commitImportedProject":
            finishImportedProject(payload: payload, discard: false, identifier: identifier)
        case "discardImportedProject":
            finishImportedProject(payload: payload, discard: true, identifier: identifier)
        case "exportSelection":
            exportSelection(payload: payload, identifier: identifier)
        case "exportComparison":
            exportComparison(payload: payload, identifier: identifier)
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
                "ffmpegAvailable": MediaToolLocator.executableURL(named: "ffmpeg") != nil,
                "mediaProxyAvailable": mediaProxyService?.available == true,
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

            self?.prepareVideo(url, operationID: identifier) { result in
                self?.respond(identifier: identifier, result: result)
            }
        }
    }

    private func chooseCoverImage(identifier: String) {
        DispatchQueue.main.async { [weak self] in
            let panel = NSOpenPanel()
            panel.title = "Choisir une couverture"
            panel.prompt = "Choisir"
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = false
            panel.allowedContentTypes = Self.coverImageTypes
            guard panel.runModal() == .OK, let url = panel.url else {
                self?.respond(identifier: identifier, result: ["cancelled": true])
                return
            }
            self?.workQueue.async { [weak self] in
                do {
                    let dataURL = try CoverService.dataURL(fromFile: url)
                    self?.respond(identifier: identifier, result: ["cancelled": false, "dataURL": dataURL])
                } catch {
                    self?.respond(identifier: identifier, error: error.localizedDescription)
                }
            }
        }
    }

    private func captureCoverFrame(payload: [String: Any], identifier: String) {
        workQueue.async { [weak self] in
            do {
                guard
                    let path = payload["path"] as? String,
                    path.utf8.count <= 16_384,
                    let time = (payload["time"] as? NSNumber)?.doubleValue,
                    time.isFinite,
                    time >= 0
                else { throw SelectionExportError.invalidItem }
                let candidate = MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))
                guard MediaAccessRegistry.shared.isApproved(candidate) else { throw SelectionExportError.missingMedia }
                let mediaURL = try Self.validatedVideoURL(candidate)
                let preview = try ExportService.renderPreview(time: time, mediaURL: mediaURL, maximumWidth: 1_200)
                let dataURL = try CoverService.dataURL(from: preview)
                self?.respond(identifier: identifier, result: ["dataURL": dataURL])
            } catch {
                self?.respond(identifier: identifier, error: error.localizedDescription)
            }
        }
    }

    private func downloadTMDBCover(payload: [String: Any], identifier: String) {
        guard let posterPath = payload["posterPath"] as? String else {
            respond(identifier: identifier, error: "Affiche TMDB manquante.")
            return
        }
        tmdbService.coverData(posterPath: posterPath) { [weak self] result in
            self?.workQueue.async {
                switch result {
                case .success(let data):
                    do {
                        self?.respond(identifier: identifier, result: ["dataURL": try CoverService.dataURL(from: data)])
                    } catch {
                        self?.respond(identifier: identifier, error: error.localizedDescription)
                    }
                case .failure(let error):
                    self?.respond(identifier: identifier, error: error.localizedDescription)
                }
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

    private func prepareExistingVideo(payload: [String: Any], identifier: String) {
        guard
            let path = payload["path"] as? String,
            path.utf8.count <= 16_384
        else {
            respond(identifier: identifier, error: "Chemin vidéo manquant.")
            return
        }
        let candidate = MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))
        guard MediaAccessRegistry.shared.isApproved(candidate) else {
            respond(identifier: identifier, error: "Ce média n’a pas été autorisé.")
            return
        }
        prepareVideo(
            candidate,
            operationID: identifier,
            forceProxy: (payload["forceProxy"] as? Bool) ?? false
        ) { [weak self] result in
            self?.respond(identifier: identifier, result: result)
        }
    }

    private func clearMediaProxy(payload: [String: Any], identifier: String) {
        guard
            let path = payload["path"] as? String,
            path.utf8.count <= 16_384
        else {
            respond(identifier: identifier, error: "Chemin vidéo manquant.")
            return
        }
        let candidate = MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))
        guard MediaAccessRegistry.shared.isApproved(candidate) else {
            respond(identifier: identifier, error: "Ce média n’a pas été autorisé.")
            return
        }
        workQueue.async { [weak self] in
            do {
                let safeURL = try Self.validatedVideoURL(candidate)
                guard let service = self?.mediaProxyService else {
                    throw MediaProxyService.ProxyError.failed(
                        self?.mediaProxyInitializationError ?? "Le cache média local est indisponible."
                    )
                }
                try service.removeCachedProxy(for: safeURL)
                self?.respond(identifier: identifier, result: ["removed": true])
            } catch {
                self?.respond(identifier: identifier, error: error.localizedDescription)
            }
        }
    }

    private func prepareVideo(
        _ url: URL,
        operationID: String = UUID().uuidString,
        forceProxy: Bool = false,
        completion: @escaping ([String: Any]) -> Void
    ) {
        workQueue.async { [weak self] in
            guard let self else { return }
            defer { self.mediaProxyService?.finish(operationID: operationID) }
            do {
                let safeURL = try Self.validatedVideoURL(url)
                MediaAccessRegistry.shared.approve(safeURL)
                self.emitMediaPreparation(
                    operationID: operationID,
                    name: safeURL.lastPathComponent,
                    progress: MediaProxyService.Progress(
                        stage: "inspection",
                        fraction: 0.01,
                        message: "Analyse du média local",
                        cancellable: true
                    )
                )

                let metadata: [String: Any]?
                let metadataError: String?
                do {
                    metadata = try FFprobeService.inspect(safeURL)
                    metadataError = nil
                } catch {
                    metadata = nil
                    metadataError = error.localizedDescription
                }

                let containerNeedsProxy = forceProxy
                    || !MediaProxyPolicy.directContainers.contains(safeURL.pathExtension.lowercased())
                if containerNeedsProxy && metadata == nil {
                    throw MediaProxyService.ProxyError.failed(
                        metadataError ?? "Les pistes du média ne peuvent pas être analysées."
                    )
                }

                let prepared: MediaProxyService.PreparedMedia
                if let metadata {
                    guard let service = self.mediaProxyService else {
                        if containerNeedsProxy {
                            throw MediaProxyService.ProxyError.failed(
                                self.mediaProxyInitializationError ?? "Le moteur de proxy local est indisponible."
                            )
                        }
                        prepared = MediaProxyService.PreparedMedia(
                            playbackURL: safeURL,
                            proxyUsed: false,
                            mode: nil,
                            reused: false,
                            subtitle: nil
                        )
                        return self.completeVideoPreparation(
                            originalURL: safeURL,
                            metadata: metadata,
                            metadataError: metadataError,
                            prepared: prepared,
                            operationID: operationID,
                            completion: completion
                        )
                    }
                    prepared = try service.prepare(
                        originalURL: safeURL,
                        metadata: metadata,
                        operationID: operationID,
                        forceProxy: forceProxy
                    ) { [weak self] progress in
                        self?.emitMediaPreparation(
                            operationID: operationID,
                            name: safeURL.lastPathComponent,
                            progress: progress
                        )
                    }
                } else {
                    prepared = MediaProxyService.PreparedMedia(
                        playbackURL: safeURL,
                        proxyUsed: false,
                        mode: nil,
                        reused: false,
                        subtitle: nil
                    )
                }

                self.completeVideoPreparation(
                    originalURL: safeURL,
                    metadata: metadata,
                    metadataError: metadataError,
                    prepared: prepared,
                    operationID: operationID,
                    completion: completion
                )
            } catch MediaProxyService.ProxyError.cancelled {
                self.emitEvent(named: "analyse:media-preparation", detail: [
                    "operationId": operationID,
                    "stage": "cancelled",
                    "progress": 0,
                    "message": "Préparation annulée",
                    "cancellable": false,
                ])
                completion(["cancelled": true, "operationId": operationID])
            } catch {
                self.emitEvent(named: "analyse:media-preparation", detail: [
                    "operationId": operationID,
                    "stage": "failed",
                    "progress": 0,
                    "message": error.localizedDescription,
                    "cancellable": false,
                ])
                completion(["cancelled": false, "error": error.localizedDescription, "operationId": operationID])
            }
        }
    }

    private func completeVideoPreparation(
        originalURL: URL,
        metadata: [String: Any]?,
        metadataError: String?,
        prepared: MediaProxyService.PreparedMedia,
        operationID: String,
        completion: @escaping ([String: Any]) -> Void
    ) {
        MediaAccessRegistry.shared.approve(prepared.playbackURL)
        var result: [String: Any] = [
            "cancelled": false,
            "operationId": operationID,
            "name": originalURL.lastPathComponent,
            "path": originalURL.path,
            "playbackPath": prepared.playbackURL.path,
            "mediaURL": Self.mediaURL(for: prepared.playbackURL),
            "proxyUsed": prepared.proxyUsed,
            "proxyReused": prepared.reused,
        ]
        if let mode = prepared.mode { result["proxyMode"] = mode.rawValue }
        if let metadata { result["metadata"] = metadata }
        if let metadataError { result["metadataError"] = metadataError }
        if let subtitle = prepared.subtitle {
            result["subtitle"] = ["name": subtitle.name, "content": subtitle.content]
        }
        emitEvent(named: "analyse:media-preparation", detail: [
            "operationId": operationID,
            "stage": "complete",
            "progress": 1,
            "message": prepared.proxyUsed ? "Proxy compatible prêt" : "Média prêt",
            "cancellable": false,
        ])
        completion(result)
    }

    private func emitMediaPreparation(
        operationID: String,
        name: String,
        progress: MediaProxyService.Progress
    ) {
        emitEvent(named: "analyse:media-preparation", detail: [
            "operationId": operationID,
            "name": String(name.prefix(500)),
            "stage": progress.stage,
            "progress": min(max(progress.fraction, 0), 1),
            "message": String(progress.message.prefix(1_000)),
            "cancellable": progress.cancellable,
        ])
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
        let result: (state: [String: Any], version: Int, portable: Bool, importToken: String?)
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
            result = (state, (rawState["version"] as? NSNumber)?.intValue ?? 1, false, nil)
        }

        var response: [String: Any] = [
            "cancelled": false,
            "name": safeURL.lastPathComponent,
            "state": restoreMediaRuntime(in: result.state) ?? result.state,
            "recovered": result.version < 6,
            "portable": result.portable,
        ]
        if let importToken = result.importToken { response["importToken"] = importToken }
        return response
    }

    private func importProjectPackage(from archiveURL: URL, compressedBytes: Int64) throws -> (state: [String: Any], version: Int, portable: Bool, importToken: String?) {
        let manager = FileManager.default
        let expandedLimit = ProjectArchivePolicy.expandedByteLimit(compressedBytes: compressedBytes)
        do {
            try StorageCapacityPolicy.ensureSpace(at: manager.temporaryDirectory, payloadBytes: expandedLimit)
        } catch {
            throw ProjectImportError.insufficientSpace
        }
        let temporaryRoot = manager.temporaryDirectory.appendingPathComponent("Cinecrique-Import-\(UUID().uuidString)", isDirectory: true)
        try manager.createDirectory(at: temporaryRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? manager.removeItem(at: temporaryRoot) }

        let entries = try Self.archiveEntries(at: archiveURL)
        try Self.extractArchive(
            archiveURL,
            entries: entries,
            to: temporaryRoot,
            maximumBytes: expandedLimit
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
        var importedMediaDirectory: URL?
        var importToken: String?
        defer {
            if let importedMediaDirectory { try? manager.removeItem(at: importedMediaDirectory) }
        }
        if let embeddedPath = manifest["embeddedMedia"] as? String {
            _ = try ProjectArchivePolicy.validatedEntries([embeddedPath])
            let sourceURL = packageRoot.appendingPathComponent(embeddedPath).standardizedFileURL
            let rootPrefix = packageRoot.standardizedFileURL.path + "/"
            guard sourceURL.path.hasPrefix(rootPrefix) else { throw ProjectImportError.invalidArchive }
            let importedMediaURL = try persistEmbeddedMedia(try Self.validatedVideoURL(sourceURL))
            importedMediaDirectory = importedMediaURL.deletingLastPathComponent()
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
        if portable, let directory = importedMediaDirectory {
            let token = UUID().uuidString
            pendingImportLock.lock()
            pendingImportedMedia[token] = directory
            pendingImportLock.unlock()
            importToken = token
            importedMediaDirectory = nil
        }
        return (state, (rawState["version"] as? NSNumber)?.intValue ?? 1, portable, importToken)
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
        let sourceValues = try sourceURL.resourceValues(forKeys: [.fileSizeKey])
        guard let sourceBytes = sourceValues.fileSize else { throw ProjectImportError.storageUnavailable }
        do {
            try StorageCapacityPolicy.ensureSpace(at: importedRoot, payloadBytes: Int64(sourceBytes))
        } catch {
            throw ProjectImportError.insufficientSpace
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

    private func renderThumbnail(payload: [String: Any], identifier: String) {
        guard
            let path = payload["path"] as? String,
            path.utf8.count <= 16_384,
            let rawTime = payload["time"] as? NSNumber,
            rawTime.doubleValue.isFinite,
            rawTime.doubleValue >= 0
        else {
            respond(identifier: identifier, error: "Paramètres de miniature invalides.")
            return
        }
        let width = min(max((payload["width"] as? NSNumber)?.doubleValue ?? 240, 80), 640)
        let url = MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))
        guard MediaAccessRegistry.shared.isApproved(url) else {
            respond(identifier: identifier, error: "Ce média n’a pas été autorisé.")
            return
        }
        workQueue.async { [weak self] in
            do {
                let safeURL = try Self.validatedVideoURL(url)
                let data = try ExportService.renderPreview(
                    time: rawTime.doubleValue,
                    mediaURL: safeURL,
                    maximumWidth: CGFloat(width)
                )
                self?.respond(identifier: identifier, result: [
                    "dataURL": "data:image/jpeg;base64,\(data.base64EncodedString())"
                ])
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
        do {
            try PersistedStatePolicy.validate(state)
        } catch {
            respond(identifier: identifier, error: error.localizedDescription)
            return
        }
        let revision = (payload["revision"] as? NSNumber)?.intValue ?? 0
        stateQueue.async { [weak self] in
            guard let self else { return }
            guard let stateStore = self.stateStore else {
                self.respond(identifier: identifier, error: self.stateStoreInitializationError ?? "Le stockage local est indisponible.")
                return
            }
            do {
                try stateStore.save(state)
                self.respond(identifier: identifier, result: ["saved": true, "revision": revision])
            } catch {
                self.respond(identifier: identifier, error: error.localizedDescription)
            }
        }
    }

    private func createStateSnapshot(identifier: String) {
        stateQueue.async { [weak self] in
            guard let self else { return }
            guard let stateStore = self.stateStore else {
                self.respond(identifier: identifier, error: self.stateStoreInitializationError ?? "Le stockage local est indisponible.")
                return
            }
            do {
                let snapshot = try stateStore.createRestorableSnapshot()
                let result: [String: Any] = snapshot.map { ["snapshotId": $0] } ?? ["snapshotId": NSNull()]
                self.respond(identifier: identifier, result: result)
            } catch {
                self.respond(identifier: identifier, error: error.localizedDescription)
            }
        }
    }

    private func restoreStateSnapshot(payload: [String: Any], identifier: String) {
        guard let snapshotID = payload["snapshotId"] as? String, snapshotID.utf8.count <= 256 else {
            respond(identifier: identifier, error: "Snapshot invalide.")
            return
        }
        stateQueue.async { [weak self] in
            guard let self else { return }
            guard let stateStore = self.stateStore else {
                self.respond(identifier: identifier, error: self.stateStoreInitializationError ?? "Le stockage local est indisponible.")
                return
            }
            do {
                let restored = try stateStore.restoreSnapshot(named: snapshotID)
                guard let safe = Self.sanitizedPersistedState(restored) else { throw ProjectImportError.invalidProject }
                self.respond(identifier: identifier, result: self.restoreMediaRuntime(in: safe) ?? safe)
            } catch {
                self.respond(identifier: identifier, error: error.localizedDescription)
            }
        }
    }

    private func loadState(identifier: String) {
        stateQueue.async { [weak self] in
            guard let self else { return }
            guard let stateStore = self.stateStore else {
                self.respond(identifier: identifier, error: self.stateStoreInitializationError ?? "Le stockage local est indisponible.")
                return
            }
            do {
                let loadedState = try stateStore.load()
                var state = self.restoreMediaRuntime(in: Self.sanitizedPersistedState(loadedState))
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

    private func finishImportedProject(payload: [String: Any], discard: Bool, identifier: String) {
        guard let token = payload["importToken"] as? String, token.utf8.count <= 128 else {
            respond(identifier: identifier, error: "Import portable invalide.")
            return
        }
        pendingImportLock.lock()
        let directory = pendingImportedMedia.removeValue(forKey: token)
        pendingImportLock.unlock()
        guard let directory else {
            respond(identifier: identifier, error: "Cet import portable n’est plus disponible.")
            return
        }
        if discard {
            do {
                try FileManager.default.removeItem(at: directory)
            } catch {
                respond(identifier: identifier, error: "Le média temporaire importé n’a pas pu être nettoyé.")
                return
            }
        }
        let key = discard ? "discarded" : "committed"
        respond(identifier: identifier, result: [key: true])
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
            let reports = try Self.exportReports(from: payload["reports"] as? [[String: Any]] ?? [])

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
            let needsOriginalMedia = includeVideo || projectPackage?.includeVideo == true
            let needsRenderMedia = !frames.isEmpty
                || reports.contains(where: { !$0.frames.isEmpty })
                || !(projectPackage?.frames.isEmpty ?? true)
            var originalMediaURL: URL?
            if needsOriginalMedia {
                guard
                    let path = payload["originalMediaPath"] as? String,
                    path.utf8.count <= 16_384
                else { throw SelectionExportError.missingMedia }
                let candidate = MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))
                guard MediaAccessRegistry.shared.isApproved(candidate) else { throw SelectionExportError.missingMedia }
                originalMediaURL = try Self.validatedVideoURL(candidate)
            }
            var renderMediaURL: URL?
            if needsRenderMedia {
                guard
                    let path = payload["renderMediaPath"] as? String,
                    path.utf8.count <= 16_384
                else { throw SelectionExportError.missingMedia }
                let candidate = MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))
                guard MediaAccessRegistry.shared.isApproved(candidate) else { throw SelectionExportError.missingMedia }
                renderMediaURL = try Self.validatedVideoURL(candidate)
            }

            let itemCount = textFiles.count + (includeVideo ? 1 : 0) + frames.count + reports.count + (projectPackage == nil ? 0 : 1)
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
                } else if includeVideo, let originalMediaURL {
                    panel.nameFieldStringValue = originalMediaURL.lastPathComponent
                    panel.allowedContentTypes = [UTType(filenameExtension: originalMediaURL.pathExtension) ?? .movie]
                } else if let frame = frames.first {
                    panel.nameFieldStringValue = frame.name
                    panel.allowedContentTypes = [.png]
                } else if let report = reports.first {
                    panel.nameFieldStringValue = report.name
                    panel.allowedContentTypes = [UTType(filenameExtension: report.format.rawValue) ?? .data]
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
                                originalMediaURL: originalMediaURL,
                                renderMediaURL: renderMediaURL,
                                includeVideo: includeVideo,
                                frames: frames,
                                reports: reports,
                                projectPackage: projectPackage,
                                to: destination
                            )
                        } else if let file = textFiles.first {
                            try ExportService.writeSingleText(file, to: destination)
                        } else if includeVideo, let originalMediaURL {
                            try ExportService.copyVideo(from: originalMediaURL, to: destination)
                        } else if let frame = frames.first, let renderMediaURL {
                            try ExportService.writeFrame(frame, mediaURL: renderMediaURL, to: destination)
                        } else if let report = reports.first {
                            try ExportService.writeReport(report, mediaURL: renderMediaURL, to: destination)
                        } else if let projectPackage {
                            try ExportService.writeProjectPackage(
                                projectPackage,
                                named: baseName,
                                originalMediaURL: originalMediaURL,
                                renderMediaURL: renderMediaURL,
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

    private func exportComparison(payload: [String: Any], identifier: String) {
        do {
            guard
                let path = payload["mediaPath"] as? String,
                path.utf8.count <= 16_384,
                let rawA = payload["a"] as? [String: Any],
                let rawB = payload["b"] as? [String: Any]
            else { throw SelectionExportError.invalidItem }
            let candidate = MediaAccessRegistry.normalizedURL(URL(fileURLWithPath: path))
            guard MediaAccessRegistry.shared.isApproved(candidate) else { throw SelectionExportError.missingMedia }
            let mediaURL = try Self.validatedVideoURL(candidate)
            let a = try Self.comparisonFrame(from: rawA)
            let b = try Self.comparisonFrame(from: rawB)
            let note = String((payload["note"] as? String ?? "").prefix(20_000))
            let suggestedName = Self.safeExportFileName(payload["suggestedName"] as? String) ?? "comparaison.png"
            let fileName = suggestedName.lowercased().hasSuffix(".png") ? suggestedName : "\(suggestedName).png"

            DispatchQueue.main.async { [weak self] in
                let panel = NSSavePanel()
                panel.title = "Exporter la comparaison"
                panel.prompt = "Exporter"
                panel.nameFieldStringValue = fileName
                panel.allowedContentTypes = [.png]
                guard panel.runModal() == .OK, let destination = panel.url else {
                    self?.respond(identifier: identifier, result: ["cancelled": true])
                    return
                }
                self?.workQueue.async { [weak self] in
                    do {
                        try ExportService.writeComparison(a: a, b: b, note: note, mediaURL: mediaURL, to: destination)
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

    private static func exportReports(from rawReports: [[String: Any]]) throws -> [ExportService.Report] {
        guard rawReports.count <= 2 else { throw SelectionExportError.tooManyItems }
        return try rawReports.map { item in
            guard
                let rawFormat = item["format"] as? String,
                let format = ExportService.Report.Format(rawValue: rawFormat.lowercased()),
                let rawName = safeExportFileName(item["name"] as? String),
                let model = item["model"] as? [String: Any],
                JSONSerialization.isValidJSONObject(model),
                let modelData = try? JSONSerialization.data(withJSONObject: model),
                modelData.count <= 16 * 1_024 * 1_024
            else { throw SelectionExportError.invalidItem }
            let extensionName = format.rawValue
            let name = rawName.lowercased().hasSuffix(".\(extensionName)") ? rawName : "\(rawName).\(extensionName)"
            let rawFrames = item["frames"] as? [[String: Any]] ?? []
            guard rawFrames.count <= 100 else { throw SelectionExportError.tooManyItems }
            let frames = try rawFrames.map { frame -> ExportService.ReportFrame in
                guard
                    let time = (frame["time"] as? NSNumber)?.doubleValue,
                    time.isFinite,
                    time >= 0,
                    let rawAnnotations = frame["annotations"] as? [[String: Any]],
                    rawAnnotations.count <= 1_000
                else { throw SelectionExportError.invalidItem }
                return ExportService.ReportFrame(
                    title: String((frame["title"] as? String ?? "Image annotée").prefix(500)),
                    timecode: String((frame["timecode"] as? String ?? "").prefix(100)),
                    time: time,
                    annotations: rawAnnotations
                )
            }
            return ExportService.Report(name: name, format: format, model: model, frames: frames)
        }
    }

    private static func comparisonFrame(from raw: [String: Any]) throws -> ExportService.ComparisonFrame {
        guard
            let time = (raw["time"] as? NSNumber)?.doubleValue,
            time.isFinite,
            time >= 0,
            let annotations = raw["annotations"] as? [[String: Any]],
            annotations.count <= 1_000
        else { throw SelectionExportError.invalidItem }
        return ExportService.ComparisonFrame(
            title: String((raw["title"] as? String ?? "Image").prefix(500)),
            timecode: String((raw["timecode"] as? String ?? "").prefix(100)),
            time: time,
            annotations: annotations
        )
    }

    private static func validatedImportedState(_ rawState: [String: Any]) -> [String: Any]? {
        guard (try? PersistedStatePolicy.validate(rawState)) != nil else { return nil }
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
        let listing = ProjectArchiveListingAccumulator()
        do {
            let status = try BoundedProcessRunner.streamStandardOutput(
                executableURL: URL(fileURLWithPath: "/usr/bin/unzip"),
                arguments: ["-Z1", archiveURL.path],
                timeout: ProjectArchivePolicy.listingTimeout
            ) { chunk in
                try listing.append(chunk)
            }
            guard status == 0 else { throw ProjectImportError.invalidArchive }
            return try listing.finish()
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
            do {
                let status = try BoundedProcessRunner.streamStandardOutput(
                    executableURL: URL(fileURLWithPath: "/usr/bin/unzip"),
                    arguments: ["-p", archiveURL.path, entry],
                    timeout: 30 * 60,
                    chunkBytes: 1 * 1_024 * 1_024
                ) { chunk in
                    guard Int64(chunk.count) <= maximumBytes - expandedBytes else {
                        throw ProjectArchiveError.expandedDataTooLarge
                    }
                    expandedBytes += Int64(chunk.count)
                    writer.write(chunk)
                }
                guard status == 0 else { throw ProjectImportError.invalidArchive }
                try writer.close()
            } catch {
                try? writer.close()
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
        guard (try? PersistedStatePolicy.validate(dictionary)) != nil else { return nil }
        let projects = (dictionary["projects"] as? [[String: Any]] ?? []).prefix(500).map { project in
            var safeProject = project
            safeProject["poster"] = Self.safePosterPath(project["poster"] as? String)
            safeProject["cover"] = Self.safeCover(project["cover"] as? [String: Any], legacyPoster: project["poster"] as? String)
            safeProject.removeValue(forKey: "mediaURL")
            safeProject.removeValue(forKey: "mediaMissing")
            safeProject.removeValue(forKey: "playbackPath")
            safeProject.removeValue(forKey: "proxyMissing")
            safeProject.removeValue(forKey: "proxyUsed")
            safeProject.removeValue(forKey: "proxyMode")

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
            if MediaProxyPolicy.directContainers.contains(safeURL.pathExtension.lowercased()) {
                safeProject["playbackPath"] = safeURL.path
                safeProject["mediaURL"] = mediaURL(for: safeURL)
            } else {
                safeProject["proxyMissing"] = true
            }
            return safeProject
        }
        dictionary["projects"] = Array(projects)
        return dictionary
    }

    private func restoreMediaRuntime(in state: [String: Any]?) -> [String: Any]? {
        guard var state, let projects = state["projects"] as? [[String: Any]] else { return state }
        state["projects"] = projects.map { project in
            var runtime = project
            runtime.removeValue(forKey: "mediaURL")
            runtime.removeValue(forKey: "mediaMissing")
            runtime.removeValue(forKey: "playbackPath")
            runtime.removeValue(forKey: "proxyMissing")
            runtime.removeValue(forKey: "proxyUsed")
            guard
                let path = project["path"] as? String,
                path.utf8.count <= 16_384,
                let original = try? Self.validatedVideoURL(URL(fileURLWithPath: path))
            else {
                if project["path"] != nil { runtime["mediaMissing"] = true }
                return runtime
            }

            MediaAccessRegistry.shared.approve(original)
            if let proxy = mediaProxyService?.cachedProxy(for: original) {
                MediaAccessRegistry.shared.approve(proxy)
                runtime["playbackPath"] = proxy.path
                runtime["mediaURL"] = Self.mediaURL(for: proxy)
                runtime["proxyUsed"] = true
            } else if MediaProxyPolicy.directContainers.contains(original.pathExtension.lowercased()) {
                runtime["playbackPath"] = original.path
                runtime["mediaURL"] = Self.mediaURL(for: original)
            } else {
                runtime["proxyMissing"] = true
            }
            return runtime
        }
        return state
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

    private static func safeCover(_ value: [String: Any]?, legacyPoster: String?) -> [String: Any] {
        if value?["mode"] as? String == "text" {
            let text = String((value?["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(120))
            return ["mode": "text", "text": text]
        }
        if value?["mode"] as? String == "logo" { return ["mode": "logo"] }
        if value?["mode"] as? String == "image", let raw = value?["value"] as? String {
            let source = value?["source"] as? String ?? "local"
            if source == "bundled", safePosterPath(raw) == raw {
                return ["mode": "image", "source": "bundled", "value": raw]
            }
            if raw.utf8.count <= 1_500_000,
               raw.hasPrefix("data:image/jpeg;base64,"),
               let comma = raw.firstIndex(of: ","),
               let data = Data(base64Encoded: String(raw[raw.index(after: comma)...])),
               data.count <= CoverService.maximumEncodedBytes {
                let safeSource = ["local", "frame", "tmdb"].contains(source) ? source : "local"
                return ["mode": "image", "source": safeSource, "value": raw]
            }
        }
        if let legacyPoster, safePosterPath(legacyPoster) == legacyPoster {
            return ["mode": "image", "source": "bundled", "value": legacyPoster]
        }
        return ["mode": "logo"]
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
    private static let videoExtensions = MediaFormatPolicy.videoExtensions
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
        case insufficientSpace

        var errorDescription: String? {
            switch self {
            case .invalidFile: return "Le fichier de projet est invalide ou inaccessible."
            case .invalidProject: return "Le fichier ne contient pas un projet Cinécrique valide."
            case .invalidArchive: return "L’archive .cinecrique est corrompue ou contient des chemins non sûrs."
            case .unsupportedFormat: return "Cette version du format .cinecrique n’est pas prise en charge."
            case .archiveTooLarge: return "L’archive .cinecrique dépasse la limite de 50 Go."
            case .storageUnavailable: return "Le média intégré ne peut pas être copié dans le stockage local."
            case .insufficientSpace: return "L’espace disque disponible est insuffisant pour décompresser ce projet."
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

    private static let coverImageTypes: [UTType] = {
        CoverService.supportedExtensions.compactMap { UTType(filenameExtension: $0) }
    }()
}
