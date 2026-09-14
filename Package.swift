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
            path: "source/macos/AnalyseCore"
        ),
        .executableTarget(
            name: "Cinecrique",
            dependencies: ["AnalyseCore"],
            path: "source/macos/Analyse",
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
            path: "checks/AnalyseCoreChecks"
        )
    ]
)
