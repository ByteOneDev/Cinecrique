import Foundation

final class TMDBService {
    private static let maximumResponseBytes = 2 * 1_024 * 1_024
    private let session: URLSession

    init(session: URLSession? = nil) {
        if let session {
            self.session = session
            return
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        configuration.httpMaximumConnectionsPerHost = 2
        self.session = URLSession(configuration: configuration)
    }

    func search(
        query: String,
        language: String,
        token: String,
        completion: @escaping (Result<[[String: Any]], Error>) -> Void
    ) {
        request(
            path: "/search/multi",
            queryItems: [
                URLQueryItem(name: "query", value: query),
                URLQueryItem(name: "language", value: language),
                URLQueryItem(name: "include_adult", value: "false")
            ],
            token: token
        ) { result in
            completion(result.map { payload in
                let items = payload["results"] as? [[String: Any]] ?? []
                return items.compactMap(Self.normalizeSearchResult).prefix(12).map { $0 }
            })
        }
    }

    func details(
        mediaType: String,
        identifier: Int,
        language: String,
        token: String,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard ["movie", "tv"].contains(mediaType) else {
            completion(.failure(TMDBError.unsupportedMediaType))
            return
        }

        request(
            path: "/\(mediaType)/\(identifier)",
            queryItems: [
                URLQueryItem(name: "language", value: language),
                URLQueryItem(name: "append_to_response", value: "credits")
            ],
            token: token
        ) { result in
            completion(result.map { Self.normalizeDetails($0, mediaType: mediaType, language: language) })
        }
    }

    func coverData(
        posterPath: String,
        completion: @escaping (Result<Data, Error>) -> Void
    ) {
        let allowed = CharacterSet(charactersIn: "/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
        guard
            posterPath.hasPrefix("/"),
            posterPath.count <= 200,
            posterPath.unicodeScalars.allSatisfy({ allowed.contains($0) }),
            let url = URL(string: "https://image.tmdb.org/t/p/w780\(posterPath)")
        else {
            completion(.failure(TMDBError.invalidURL))
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        request.cachePolicy = .reloadIgnoringLocalCacheData
        session.dataTask(with: request) { data, response, error in
            if let error {
                completion(.failure(error))
                return
            }
            guard
                let httpResponse = response as? HTTPURLResponse,
                (200...299).contains(httpResponse.statusCode),
                let data,
                !data.isEmpty,
                data.count <= 10 * 1_024 * 1_024,
                httpResponse.mimeType?.hasPrefix("image/") == true
            else {
                completion(.failure(TMDBError.invalidResponse))
                return
            }
            completion(.success(data))
        }.resume()
    }

    private func request(
        path: String,
        queryItems: [URLQueryItem],
        token: String,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        var components = URLComponents(string: "https://api.themoviedb.org/3\(path)")
        components?.queryItems = queryItems
        guard let url = components?.url else {
            completion(.failure(TMDBError.invalidURL))
            return
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        Task {
            do {
                let (bytes, response) = try await session.bytes(for: request)
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw TMDBError.invalidResponse
                }
                let expectedLength = httpResponse.expectedContentLength
                guard expectedLength <= 0 || expectedLength <= Int64(Self.maximumResponseBytes) else {
                    throw TMDBError.responseTooLarge
                }

                var data = Data()
                if expectedLength > 0 {
                    data.reserveCapacity(Int(expectedLength))
                }
                for try await byte in bytes {
                    guard data.count < Self.maximumResponseBytes else {
                        throw TMDBError.responseTooLarge
                    }
                    data.append(byte)
                }

                let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                guard (200...299).contains(httpResponse.statusCode) else {
                    let message = payload?["status_message"] as? String ?? "TMDB a répondu avec le code \(httpResponse.statusCode)."
                    throw TMDBError.server(message)
                }
                guard let payload else { throw TMDBError.invalidPayload }
                completion(.success(payload))
            } catch {
                completion(.failure(error))
            }
        }
    }

    private static func normalizeSearchResult(_ item: [String: Any]) -> [String: Any]? {
        guard
            let mediaType = item["media_type"] as? String,
            ["movie", "tv"].contains(mediaType),
            let identifier = (item["id"] as? NSNumber)?.intValue
        else { return nil }

        let title = (item[mediaType == "movie" ? "title" : "name"] as? String) ?? "Sans titre"
        let originalTitle = (item[mediaType == "movie" ? "original_title" : "original_name"] as? String) ?? title
        let releaseDate = (item[mediaType == "movie" ? "release_date" : "first_air_date"] as? String) ?? ""
        let overview = (item["overview"] as? String) ?? ""

        return [
            "id": identifier,
            "mediaType": mediaType,
            "title": title,
            "originalTitle": originalTitle,
            "releaseDate": releaseDate,
            "year": String(releaseDate.prefix(4)),
            "overview": overview,
            "posterPath": (item["poster_path"] as? String) ?? ""
        ]
    }

    private static func normalizeDetails(_ item: [String: Any], mediaType: String, language: String) -> [String: Any] {
        let identifier = (item["id"] as? NSNumber)?.intValue ?? 0
        let title = (item[mediaType == "movie" ? "title" : "name"] as? String) ?? "Sans titre"
        let originalTitle = (item[mediaType == "movie" ? "original_title" : "original_name"] as? String) ?? title
        let releaseDate = (item[mediaType == "movie" ? "release_date" : "first_air_date"] as? String) ?? ""
        let genres = (item["genres"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
        let countries = (item["production_countries"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
        let cast = ((item["credits"] as? [String: Any])?["cast"] as? [[String: Any]] ?? [])
            .prefix(8)
            .compactMap { $0["name"] as? String }
        let movieRuntime = (item["runtime"] as? NSNumber)?.intValue
        let episodeRuntime = ((item["episode_run_time"] as? [NSNumber])?.first)?.intValue
        let runtime = movieRuntime ?? episodeRuntime ?? 0

        return [
            "id": identifier,
            "mediaType": mediaType,
            "title": title,
            "originalTitle": originalTitle,
            "overview": (item["overview"] as? String) ?? "",
            "releaseDate": releaseDate,
            "year": String(releaseDate.prefix(4)),
            "genres": genres,
            "countries": countries,
            "cast": cast,
            "runtime": runtime,
            "originalLanguage": (item["original_language"] as? String) ?? "",
            "language": language,
            "source": "TMDB",
            "posterPath": (item["poster_path"] as? String) ?? "",
            "sourceURL": "https://www.themoviedb.org/\(mediaType)/\(identifier)"
        ]
    }

    enum TMDBError: LocalizedError {
        case invalidURL
        case invalidResponse
        case invalidPayload
        case responseTooLarge
        case unsupportedMediaType
        case server(String)

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "La requête TMDB est invalide."
            case .invalidResponse:
                return "TMDB n’a pas renvoyé de réponse exploitable."
            case .invalidPayload:
                return "Les métadonnées TMDB sont illisibles."
            case .responseTooLarge:
                return "La réponse TMDB dépasse la limite de 2 Mo."
            case .unsupportedMediaType:
                return "Ce type de résultat TMDB n’est pas pris en charge."
            case .server(let message):
                return message
            }
        }
    }
}
