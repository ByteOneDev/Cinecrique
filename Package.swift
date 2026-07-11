// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "Cinecrique",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "Cinecrique", targets: ["Cinecrique"]),
        .executable(name: "AnalyseCoreChecks", targets: ["AnalyseCoreChecks"])
    ],
    targets: [
        .target(
            name: "AnalyseCore",
            path: "macOS/Sources/AnalyseCore"
        ),
        .executableTarget(
            name: "Cinecrique",
            dependencies: ["AnalyseCore"],
            path: "macOS/Sources/Analyse",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Security"),
                .linkedFramework("UniformTypeIdentifiers"),
                .linkedFramework("WebKit")
            ]
        ),
        .executableTarget(
            name: "AnalyseCoreChecks",
            dependencies: ["AnalyseCore"],
            path: "macOS/Checks/AnalyseCoreChecks"
        )
    ]
)
