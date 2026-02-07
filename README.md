<p align="center">
  <strong>@coolblack/xcode-mcp</strong><br>
  <em>Complete Xcode Automation via AI</em>
</p>

<p align="center">
  <a href="#installation">Installation</a> |
  <a href="#tools-58-total">58 Tools</a> |
  <a href="#deutsche-zusammenfassung">Deutsch</a> |
  <a href="https://coolblack.gmbh">coolblack.gmbh</a>
</p>

---

> **Beta Software** -- This project is under active development and provided free of charge without any warranty. Use at your own risk. See [LICENSE](LICENSE) for full terms.
>
> **Beta-Software** -- Dieses Projekt befindet sich in aktiver Entwicklung und wird kostenlos ohne jegliche Gewaehrleistung zur Verfuegung gestellt. Nutzung auf eigene Gefahr. Siehe [LICENSE](LICENSE) fuer die vollstaendigen Bedingungen.

A full-featured [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives AI assistants complete control over Xcode. Create projects, build, test, sign, profile, and deploy Apple apps across all platforms -- entirely through natural language.

Built by **[Dirk Nesner](mailto:dirk.nesner@gmail.com)** at **[coolblack GmbH](https://coolblack.gmbh)**.

**Supported platforms:** iOS, macOS, watchOS, tvOS, visionOS
**Works with:** Claude Code, Claude Desktop, any MCP-compatible client
**Requirements:** Node.js 18+, Xcode 16+, macOS

## Installation


### Prerequisites

Before installing xcode-mcp, ensure you have:

- **macOS** (latest version recommended)
- - **Xcode 16+** - Install from App Store
  - - **Node.js 18+** - Download from [nodejs.org](https://nodejs.org)
    - - **Command Line Tools** - Run `xcode-select --install` if not already installed
     
      - ### Installation Methods
     
      - Choose the installation method that best suits your workflow:
### One-Line Install (recommended)

```bash
git clone https://github.com/coolblack-gmbh/xcode-mcp.git
cd xcode-mcp
./scripts/install.sh
```

The installer automatically checks and installs all prerequisites (Xcode CLI Tools, Homebrew, Node.js, XcodeGen, CocoaPods, Claude Code) and registers the MCP server.

### Manual Setup

```bash
# 1. Install dependencies
npm install

# 2. Build TypeScript
npm run build

# 3. Register with Claude Code
claude mcp add coolblack-xcode-mcp -- node $(pwd)/build/index.js

# Or configure Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json):
{
  "mcpServers": {
    "coolblack-xcode-mcp": {
      "command": "node",
      "args": ["/path/to/xcode-mcp/build/index.js"]
    }
  }
}
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

```
"Create a new SwiftUI app called WeatherApp"
"Build my project and run it on the iPhone 16 Pro simulator"
"Run all unit tests and show me the coverage report"
"Archive the app and export an IPA for App Store distribution"
"Set up a GitHub Actions CI/CD pipeline"
```


## Troubleshooting

### Common Issues

#### "install.sh not found" or "Permission denied"
```bash
chmod +x scripts/install.sh
./scripts/install.sh
```

#### Node.js not found
- Verify Node.js installation: `node --version`
- - If missing, install from [nodejs.org](https://nodejs.org)
  - - Restart your terminal after installation
   
    - #### Xcode Command Line Tools not installed
    - ```bash
      xcode-select --install
      ```

      #### "Cannot find module" errors after installation
      ```bash
      npm install
      npm run build
      ```

      #### Claude Desktop config not recognized
      - Ensure the path to `build/index.js` is absolute (not relative)
      - - Use the full path: `/Users/yourusername/path/to/xcode-mcp/build/index.js`
        - - Restart Claude Desktop after updating the config
         
          - ### Getting Help
         
          - If you encounter issues:
          - 1. Check the error message for clues about what's missing
            2. 2. Verify all prerequisites are installed
               3. 3. Try reinstalling with the automatic install script
                  4. 4. Open an issue on [GitHub](https://github.com/Coolblack-GmbH/xcode-mcp/issues)
                    
                     5. 
## Tools (58 total)

### Setup (5)

| Tool | Description |
|------|-------------|
| `setup-xcode-select` | Check or switch active Xcode installation |
| `verify-environment` | Verify all prerequisites (Xcode, Homebrew, XcodeGen, etc.) |
| `install-xcodegen` | Install or upgrade XcodeGen via Homebrew |
| `check-cocoapods` | Check CocoaPods status, optionally upgrade |
| `download-platform` | Download platform SDK (iOS, watchOS, tvOS, visionOS) |

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
| `simulator-screenshot` | Capture screenshot or record video |

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

## Resources & Prompts

The server also provides MCP resources for direct data access (`xcode://project/current`, `xcode://sdks`, `xcode://certificates`, `xcode://profiles`, `xcode://simulators`) and workflow prompts for common tasks like creating apps, fixing build errors, preparing App Store submissions, and setting up CI/CD pipelines.

## Architecture

```
@coolblack/xcode-mcp/
  src/
    index.ts              # Server entry point (StdioServerTransport)
    types.ts              # Shared TypeScript types
    tools/                # 11 tool modules (58 tools total)
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

**@coolblack/xcode-mcp** ist ein vollstaendiger MCP-Server zur Xcode-Automatisierung. Er ermoeglicht die komplette Steuerung von Xcode ueber KI-Assistenten wie Claude -- von der Projekterstellung ueber Build, Test und Signierung bis zur App Store-Auslieferung.

### Highlights

- **58 Tools** fuer alle Aspekte der Apple-Entwicklung
- **Automatische Installation** mit einem einzigen Befehl
- **Xcode 26+ kompatibel** -- erkennt automatisch fehlende SDKs und Simulator-Runtimes
- **Simulator-Automation** -- baut, installiert und startet Apps vollautomatisch
- **CI/CD-Generierung** fuer GitHub Actions, GitLab CI und Fastlane

### Schnellstart

```bash
git clone https://github.com/coolblack-gmbh/xcode-mcp.git
cd xcode-mcp
./scripts/install.sh
```

Danach einfach Claude fragen: *"Erstelle eine neue SwiftUI-App namens MeineApp und starte sie auf dem Simulator."*

---

## License & Disclaimer

MIT License -- see [LICENSE](LICENSE) for full terms including the **Beta Software Notice**.

This software is provided "as is" without warranty. The authors and coolblack GmbH assume no liability for damages arising from its use. This software interacts with Xcode, code signing, and build tools -- always verify critical operations independently. / Diese Software wird ohne Gewaehrleistung bereitgestellt. Die Autoren und die coolblack GmbH uebernehmen keine Haftung. Kritische Vorgaenge stets unabhaengig pruefen.

## Author

**Dirk Nesner**
[coolblack GmbH](https://coolblack.gmbh) | [dirk.nesner@gmail.com](mailto:dirk.nesner@gmail.com)

---

<p align="center">
  <sub>Made with care by <a href="https://coolblack.gmbh">coolblack GmbH</a></sub>
</p>
