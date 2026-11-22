// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Systemproxy",
    platforms: [.iOS(.v17)],
    products: [.library(name: "Systemproxy", type: .dynamic, targets: ["Systemproxy"])],
    dependencies: [],
    targets: [
        .target(name: "Systemproxy"),
    ],
    swiftLanguageModes: [.v5]
)
