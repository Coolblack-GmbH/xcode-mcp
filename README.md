<p align="center">
  <strong>@coolblack/xcode-mcp</strong><br>
  <em>Complete Xcode Automation via AI</em>
</p>

<p align="center">
  <a href="#installation">Installation</a> |
  <a href="#tools-64-total">64 Tools</a> |
  <a href="#deutsche-zusammenfassung">Deutsch</a> |
  <a href="https://coolblack.gmbh">coolblack.gmbh</a>
</p>

---

> **Beta Software** -- This project is under active development and provided free of charge without any warranty. Use at your own risk. See [LICENSE](LICENSE) for full terms.
>
> **Beta-Software** -- Dieses Projekt befindet sich in aktiver Entwicklung und wird kostenlos ohne jegliche Gewaehrleistung zur Verfuegung gestellt. Nutzung auf eigene Gefahr. Siehe [LICENSE](LICENSE) fuer die vollstaendigen Bedingungen.

A full-featured [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives AI assistants complete control over Xcode. Create projects, build, test, sign, profile, and deploy Apple apps across all platforms -- entirely through natural language.

Built by **[Dirk Nesner](mailto:nesner@coolblack.gmbh)** at **[coolblack](https://coolblack.gmbh)**.

**Supported platforms:** iOS, macOS, watchOS, tvOS, visionOS
**Works with:** Claude Desktop (recommended), Claude Code, any MCP-compatible client
**Requirements:** macOS, Xcode 16+, Node.js 18+, [Claude Desktop](https://claude.ai/download)

> Works with the **free** Claude Desktop plan. No API key required. A [Pro subscription](https://claude.com/pricing) ($20/month) is recommended for regular development work.
>
> Funktioniert mit dem **kostenlosen** Claude Desktop Plan. Kein API-Key noetig. Fuer regelmaessige Entwicklung empfehlen wir ein [Pro-Abo](https://claude.com/pricing) ($20/Monat).

## Installation

### One-Line Install (recommended)

```bash
git clone https://github.com/Coolblack-GmbH/xcode-mcp.git
cd xcode-mcp
./scripts/install.sh
```

The installer automatically checks and installs all prerequisites (Xcode CLI Tools, Homebrew, Node.js, XcodeGen, CocoaPods) and registers the MCP server for Claude Desktop. Claude Code CLI installation is optional and only needed for terminal usage.

> **Note:** The installation may take some time depending on your setup. Xcode platform SDKs and Simulator Runtimes are several gigabytes each and can require 10--30 minutes to download. The installer will show progress where possible.
>
> **Hinweis:** Die Installation kann je nach Setup etwas dauern. Xcode-SDKs und Simulator-Runtimes sind mehrere Gigabyte gross und koennen 10--30 Minuten fuer den Download benoetigen.

### Important: After Installation

After the installer finishes, you **must restart Claude Desktop** for the MCP server to be recognized:

1. **Start** Claude Desktop
2. **Quit** Claude Desktop completely (Cmd+Q)
3. **Start** Claude Desktop again

Without this restart cycle, Claude will not detect the new MCP tools. This is a one-time step -- after the initial restart, the server will be available automatically in every future session.

> **Wichtig:** Nach der Installation muss Claude Desktop einmal gestartet, komplett beendet (Cmd+Q) und erneut gestartet werden. Erst dann werden die MCP-Tools erkannt. Dies ist nur einmalig noetig.

### Manual Setup

```bash
# 1. Install dependencies
npm install

# 2. Build TypeScript
npm run build
```

**For Claude Desktop (GUI) -- recommended:**

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "coolblack-xcode-mcp": {
      "command": "node",
      "args": ["/path/to/xcode-mcp/build/index.js"]
    }
  }
}
```

Then restart Claude Desktop (Cmd+Q, reopen).

**For Claude Code (CLI) -- optional:**

```bash
claude mcp add coolblack-xcode-mcp -- node $(pwd)/build/index.js
```

### Xcode 26+ Note

Starting with Xcode 26, platform SDKs must be downloaded separately. The installer handles iOS automatically. For other platforms:

```bash
xcodebuild -downloadPlatform watchOS
xcodebuild -downloadPlatform tvOS
xcodebuild -downloadPlatform visionOS
```

The Simulator Runtime (~8 GB) is a separate download from the SDK (compile headers). The server detects both automatically and provides clear error messages when something is missing.

## Quick Start

Once installed, just ask Claude in natural language:

> *"Create a weather app called SkyView with animated gradient backgrounds that change by time of day, a 5-day forecast, and elegant SF Symbols. Build it and launch it on the simulator."*

More things you can ask:

```
"Take a screenshot of my app and tell me what I can improve"
"Find and fix all build errors in my project"
"Run all unit tests and show me the coverage report"
"Archive the app and export an IPA for App Store distribution"
"Set up a GitHub Actions CI/CD pipeline"
```

## Tools (64 total)

### Setup (6)

| Tool | Description |
|------|-------------|
| `setup-xcode-select` | Check or switch active Xcode installation |
| `verify-environment` | Verify all prerequisites (Xcode, Homebrew, XcodeGen, etc.) |
| `install-xcodegen` | Install or upgrade XcodeGen via Homebrew |
| `check-cocoapods` | Check CocoaPods status, optionally upgrade |
| `download-platform` | Download platform SDK (iOS, watchOS, tvOS, visionOS) |
| `check-download-status` | Check SDK and simulator runtime download/installation status |

### Project Management (5)

| Tool | Description |
|------|-------------|
| `create-project` | Create new Xcode project (SwiftUI / Swift / Objective-C) |
| `get-project-info` | Read project metadata (targets, schemes, configurations) |
| `list-schemes` | List available build schemes |
| `modify-project` | Modify build settings for a target |
| `generate-from-yaml` | Generate Xcode project from XcodeGen YAML spec |

### Build (6)

| Tool | Description |
|------|-------------|
| `build-project` | Compile project with structured error and warning output |
| `build-universal-binary` | Create universal binary (arm64 + x86_64) via lipo |
| `clean-build` | Clean build artifacts, optionally remove DerivedData |
| `run-on-simulator` | Build, install, and auto-launch app on simulator |
| `archive-project` | Create archive for distribution |
| `analyze-project` | Run static analysis with xcodebuild analyze |

### Testing (4)

| Tool | Description |
|------|-------------|
| `run-tests` | Run unit and integration tests with result parsing |
| `run-ui-tests` | Run UI tests on simulator |
| `generate-coverage-report` | Generate coverage in JSON, LCOV, or HTML |
| `parse-test-results` | Parse xcresult bundles for structured results |

### Simulator (8)

| Tool | Description |
|------|-------------|
| `list-simulators` | List available and booted simulators |
| `create-simulator` | Create new simulator device |
| `boot-simulator` | Boot a simulator by UDID or name |
| `shutdown-simulator` | Shutdown specific or all simulators |
| `install-app-simulator` | Install .app bundle on simulator |
| `launch-app-simulator` | Launch app by bundle ID on simulator |
| `simulator-push-notification` | Send push notification to simulator app |
| `simulator-screenshot` | Capture screenshot or record video (returns image directly to Claude for visual debugging) |

### Code Signing (7)

| Tool | Description |
|------|-------------|
| `list-certificates` | List signing certificates (development / distribution) |
| `list-provisioning-profiles` | List provisioning profiles |
| `import-certificate` | Import certificate (.p12 / .cer) |
| `install-profile` | Install provisioning profile |
| `sign-binary` | Code sign binary or framework |
| `notarize-macos-app` | Notarize macOS app for distribution |
| `verify-signature` | Verify code signature |

### Distribution (3)

| Tool | Description |
|------|-------------|
| `export-ipa` | Export archive to IPA file |
| `upload-to-appstore` | Upload IPA to App Store Connect |
| `upload-to-testflight` | Upload IPA to TestFlight |

### Dependencies (6)

| Tool | Description |
|------|-------------|
| `pod-install` | Install CocoaPods dependencies |
| `pod-update` | Update specific or all pods |
| `spm-add-package` | Add Swift Package dependency |
| `spm-resolve` | Resolve SPM dependencies |
| `list-dependencies` | List all project dependencies (CocoaPods + SPM) |
| `check-outdated-deps` | Check for outdated dependencies |

### Profiling & Diagnostics (5)

| Tool | Description |
|------|-------------|
| `profile-with-instruments` | Run Instruments profiling session |
| `memory-profile` | Memory profiling (Leaks / Allocations) |
| `parse-build-logs` | Parse build logs into structured errors with suggestions |
| `suggest-build-fixes` | Suggest fixes for specific build errors |
| `export-build-log` | Export build logs as JSON or text |

### Utility (5)

| Tool | Description |
|------|-------------|
| `get-xcode-version` | Get Xcode version and installation path |
| `validate-bundle-id` | Validate bundle ID format |
| `convert-to-pkg` | Convert macOS .app to PKG installer |
| `get-sdk-info` | Show installed SDKs |
| `list-device-types` | List available simulator device types and runtimes |

### CI/CD (4)

| Tool | Description |
|------|-------------|
| `setup-github-actions` | Generate GitHub Actions workflow |
| `setup-gitlab-ci` | Generate GitLab CI configuration |
| `setup-fastlane` | Initialize Fastlane with build lanes |
| `validate-ci-config` | Validate CI configuration files |

### Filesystem (5)

| Tool | Description |
|------|-------------|
| `write-file` | Write content to a file (create/update Swift source files, configs) |
| `read-file` | Read file contents from the host filesystem |
| `list-directory` | List files and directories with sizes and types |
| `create-directory` | Create directories with automatic parent creation |
| `delete-file` | Delete files or directories |

## Resources & Prompts

The server also provides MCP resources for direct data access (`xcode://project/current`, `xcode://sdks`, `xcode://certificates`, `xcode://profiles`, `xcode://simulators`) and workflow prompts for common tasks like creating apps, fixing build errors, preparing App Store submissions, and setting up CI/CD pipelines.

## Architecture

```
@coolblack/xcode-mcp/
  src/
    index.ts              # Server entry point (StdioServerTransport)
    types.ts              # Shared TypeScript types
    tools/                # 12 tool modules (64 tools total)
    resources/            # MCP resource providers
    prompts/              # Workflow prompt templates
    utils/
      exec.ts             # Subprocess execution, platform/runtime checks
      logger.ts           # Logging
      paths.ts            # Path helpers
  scripts/
    install.sh            # Automated installer
  build/                  # Compiled JavaScript output
```

**Tech stack:** TypeScript (ESM), `@modelcontextprotocol/sdk` v1.12.0, XcodeGen, `xcrun simctl`

## Development

```bash
npm run build     # Compile TypeScript
npm run dev       # Watch mode
npm run clean     # Remove build folder
```

To add new tools, create a module in `src/tools/` that exports a `ToolDefinition[]` array, then import it in `src/tools/index.ts`. After changes, rebuild and restart the MCP server process (Node.js caches modules in memory).

See the [Developer Guide](docs/DEVELOPMENT.md) for detailed instructions on extending the server.

---

## Deutsche Zusammenfassung

**@coolblack/xcode-mcp** ist ein vollstaendiger MCP-Server zur Xcode-Automatisierung. Er ermoeglicht die komplette Steuerung von Xcode ueber **Claude Desktop** -- von der Projekterstellung ueber Build, Test und Signierung bis zur App Store-Auslieferung. Funktioniert bereits mit dem kostenlosen Plan -- fuer regelmaessige Entwicklung empfiehlt sich das [Pro-Abo](https://claude.com/pricing) ($20/Monat). Kein API-Key und kein Terminal noetig.

### Highlights

- **64 Tools** fuer alle Aspekte der Apple-Entwicklung
- **Claude Desktop** als empfohlene Methode -- einfach installieren und loslegen
- **Automatische Installation** mit einem einzigen Befehl (inkl. Simulator-Einrichtung)
- **Xcode 26+ kompatibel** -- erkennt automatisch fehlende SDKs und Simulator-Runtimes
- **Simulator-Automation** -- baut, installiert und startet Apps vollautomatisch
- **Visuelles Debugging** -- Claude kann Simulator-Screenshots sehen und UI-Probleme erkennen
- **Dateisystem-Zugriff** -- Claude kann Swift-Quelldateien direkt ins Projekt schreiben
- **CI/CD-Generierung** fuer GitHub Actions, GitLab CI und Fastlane

### Schnellstart

```bash
git clone https://github.com/Coolblack-GmbH/xcode-mcp.git
cd xcode-mcp
./scripts/install.sh
```

**Wichtig nach der Installation:** Claude Desktop einmal starten, komplett beenden (Cmd+Q) und erneut starten -- erst dann werden die MCP-Tools erkannt (einmalig).

**Hinweis zur Dauer:** Die Installation kann je nach Internetverbindung laenger dauern, da Xcode-SDKs und Simulator-Runtimes mehrere Gigabyte gross sind (10--30 Minuten Download).

Danach einfach Claude in der Desktop-App fragen:

> *"Erstelle eine Wetter-App namens SkyView mit animierten Gradient-Hintergruenden je nach Tageszeit, einer 5-Tage-Vorschau und eleganten SF Symbols. Baue sie und starte sie auf dem Simulator."*

---

## License & Disclaimer

MIT License -- see [LICENSE](LICENSE) for full terms including the **Beta Software Notice**.

This software is provided "as is" without warranty. The authors and coolblack assume no liability for damages arising from its use. This software interacts with Xcode, code signing, and build tools -- always verify critical operations independently. / Diese Software wird ohne Gewaehrleistung bereitgestellt. Die Autoren und die coolblack uebernehmen keine Haftung. Kritische Vorgaenge stets unabhaengig pruefen.

## Author

**Dirk Nesner**
[coolblack](https://coolblack.gmbh) | [nesner@coolblack.gmbh](mailto:nesner@coolblack.gmbh)

---

<p align="center">
  <sub>Made with care by <a href="https://coolblack.gmbh">coolblack</a></sub>
</p>
