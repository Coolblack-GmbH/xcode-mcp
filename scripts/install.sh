#!/bin/bash

################################################################################
# coolblack-xcode-mcp Installer Script
#
# A comprehensive, user-friendly installer for the coolblack-xcode-mcp MCP server.
# Installs all prerequisites and configures the MCP server for Claude Desktop.
#
# Usage:
#   curl -L https://github.com/Coolblack-GmbH/xcode-mcp/archive/main.tar.gz | tar xz
#   cd xcode-mcp-main
#   ./scripts/install.sh
################################################################################

set -euo pipefail

# ============================================================================
# Configuration & Colors
# ============================================================================

# Color codes and formatting
readonly GREEN='\033[0;32m'
readonly RED='\033[0;31m'
readonly YELLOW='\033[0;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly DIM='\033[2m'
readonly NC='\033[0m' # No Color

# Status indicators
readonly CHECK='✓'
readonly CROSS='✗'
readonly WARN='⚠'
readonly ARROW='→'

# Logging variables
SCRIPT_NAME="$(basename "$0")"
TOTAL_STEPS=14
CURRENT_STEP=0
FAILED_STEPS=()
WARNINGS=()
CLAUDE_CODE_INSTALLED=false

# ============================================================================
# Output Functions
# ============================================================================

print_header() {
    clear
    echo -e "${BOLD}${CYAN}"
    cat << "EOF"
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║        coolblack-xcode-mcp Installer                                     ║
║                                                                          ║
║        Complete Xcode Automation MCP Server for Apple Platforms           ║
║                                                                          ║
╚════════════════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}\n"
}

print_step() {
    ((CURRENT_STEP++))
    local title="$1"
    echo -e "\n${BOLD}${BLUE}[${CURRENT_STEP}/${TOTAL_STEPS}]${NC} ${BOLD}${title}${NC}"
}

print_success() {
    local message="$1"
    echo -e "  ${GREEN}${CHECK}${NC} ${message}"
}

print_error() {
    local message="$1"
    echo -e "  ${RED}${CROSS}${NC} ${message}"
    FAILED_STEPS+=("${message}")
}

print_warning() {
    local message="$1"
    echo -e "  ${YELLOW}${WARN}${NC} ${message}"
    WARNINGS+=("${message}")
}

print_info() {
    local message="$1"
    echo -e "  ${CYAN}${ARROW}${NC} ${message}"
}

print_section() {
    echo -e "\n${BOLD}${CYAN}═══ ${1} ═══${NC}\n"
}

print_summary() {
    print_section "Installation Summary"

    if [[ ${#FAILED_STEPS[@]} -eq 0 ]] && [[ ${#WARNINGS[@]} -eq 0 ]]; then
        echo -e "${GREEN}${BOLD}✓ Installation completed successfully!${NC}\n"
        echo "Alle Komponenten sind installiert und konfiguriert. Du kannst jetzt:"
        echo "  • Claude Desktop neu starten und die Xcode-Tools nutzen"
        echo "  • Xcode-Automatisierung per natuerlicher Sprache steuern"
        echo "  • iOS/macOS/watchOS/tvOS/visionOS Projekte verwalten"
        echo ""
        return 0
    elif [[ ${#FAILED_STEPS[@]} -eq 0 ]]; then
        echo -e "${YELLOW}${BOLD}⚠ Installation completed with warnings:${NC}\n"
        for warning in "${WARNINGS[@]}"; do
            echo -e "  ${YELLOW}${WARN}${NC} ${warning}"
        done
        echo ""
        return 0
    else
        echo -e "${RED}${BOLD}✗ Installation failed with errors:${NC}\n"
        for error in "${FAILED_STEPS[@]}"; do
            echo -e "  ${RED}${CROSS}${NC} ${error}"
        done
        echo ""
        return 1
    fi
}

# ============================================================================
# Utility Functions
# ============================================================================

command_exists() {
    command -v "$1" &> /dev/null
    return $?
}

get_macos_version() {
    sw_vers -productVersion 2>/dev/null || echo "unknown"
}

get_xcode_version() {
    xcodebuild -version 2>/dev/null | head -1 | awk '{print $2}' || echo "not installed"
}

get_node_version() {
    node -v 2>/dev/null || echo "not installed"
}

get_homebrew_version() {
    brew --version 2>/dev/null | head -1 || echo "not installed"
}

get_xcodegen_version() {
    xcodegen version 2>/dev/null || echo "not installed"
}

get_cocoapods_version() {
    pod --version 2>/dev/null || echo "not installed"
}

is_arm64_mac() {
    [[ "$(uname -m)" == "arm64" ]]
}

is_intel_mac() {
    [[ "$(uname -m)" == "x86_64" ]]
}

# Spinner for long-running commands
# Usage: run_with_spinner "message" command arg1 arg2 ...
run_with_spinner() {
    local message="$1"
    shift
    local spin_chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local pid

    # Run command in background
    "$@" &> /tmp/xmm_install_output.log &
    pid=$!

    local i=0
    while kill -0 "$pid" 2>/dev/null; do
        local char="${spin_chars:$i:1}"
        echo -ne "\r  ${CYAN}${char}${NC} ${message}..."
        sleep 0.15
        i=$(( (i + 1) % ${#spin_chars} ))
    done

    # Get exit code
    wait "$pid"
    local exit_code=$?
    echo -ne "\r                                                                \r"
    return $exit_code
}

# Progress-Anzeige fuer grosse Downloads (zeigt Elapsed Time + Groesse)
# Usage: run_with_progress "message" "~35 GB" command arg1 arg2 ...
run_with_progress() {
    local message="$1"
    local size_info="$2"
    shift 2
    local pid
    local start_time
    start_time=$(date +%s)

    # Run command in background
    "$@" &> /tmp/xmm_download_progress.log &
    pid=$!

    local spin_chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local i=0

    while kill -0 "$pid" 2>/dev/null; do
        local elapsed=$(( $(date +%s) - start_time ))
        local mins=$((elapsed / 60))
        local secs=$((elapsed % 60))
        local char="${spin_chars:$i:1}"
        printf "\r  ${CYAN}%s${NC} %s ${DIM}[%s] %d:%02d vergangen${NC}    " "$char" "$message" "$size_info" "$mins" "$secs"
        sleep 0.5
        i=$(( (i + 1) % ${#spin_chars} ))
    done

    # Get exit code
    wait "$pid"
    local exit_code=$?
    local total_elapsed=$(( $(date +%s) - start_time ))
    local total_mins=$((total_elapsed / 60))
    local total_secs=$((total_elapsed % 60))
    printf "\r                                                                              \r"

    if [[ $exit_code -eq 0 ]]; then
        printf "  ${GREEN}${CHECK}${NC} %s ${DIM}(Dauer: %d:%02d)${NC}\n" "$message" "$total_mins" "$total_secs"
    fi

    return $exit_code
}

# ============================================================================
# Step Functions
# ============================================================================

check_macos() {
    print_step "Verify macOS Environment"

    if [[ "$OSTYPE" != "darwin"* ]]; then
        print_error "This script only supports macOS"
        return 1
    fi

    local macos_version
    macos_version=$(get_macos_version)
    print_success "Running macOS ${macos_version}"

    # Check architecture
    local arch
    arch=$(uname -m)
    print_success "Architecture: ${arch} ($(is_arm64_mac && echo 'Apple Silicon' || echo 'Intel'))"
}

install_xcode_cli() {
    print_step "Check/Install Xcode Command Line Tools"

    if command_exists xcode-select; then
        local xcode_path
        xcode_path=$(xcode-select -p 2>/dev/null || echo "")
        if [[ -n "$xcode_path" && -d "$xcode_path" ]]; then
            print_success "Xcode Command Line Tools already installed"
            print_info "Path: ${xcode_path}"
            return 0
        fi
    fi

    print_info "Installing Xcode Command Line Tools..."
    print_info "A system dialog will appear. Please click 'Install' and wait for completion."
    print_info "This may take several minutes..."

    # Start the installation
    xcode-select --install &> /dev/null || true

    # Wait for installation to complete with timeout
    local timeout=3600  # 1 hour timeout
    local elapsed=0
    local interval=10

    while [[ $elapsed -lt $timeout ]]; do
        if xcode-select -p &> /dev/null; then
            print_success "Xcode Command Line Tools installed successfully"
            return 0
        fi

        echo -ne "\r  ${ARROW} Waiting for installation... (${elapsed}s)"
        sleep $interval
        ((elapsed+=interval))
    done

    print_error "Xcode Command Line Tools installation timed out or failed"
    print_info "You can manually complete the installation by running:"
    print_info "  xcode-select --install"
    return 1
}

check_xcode() {
    print_step "Check Full Xcode Installation"

    if [[ -d "/Applications/Xcode.app" ]]; then
        # xcode-select auf die volle Xcode-Installation umstellen
        local current_path
        current_path=$(xcode-select -p 2>/dev/null || echo "")
        if [[ "$current_path" != "/Applications/Xcode.app/Contents/Developer" ]]; then
            print_info "Stelle xcode-select auf Xcode.app um..."
            if sudo xcode-select -s /Applications/Xcode.app/Contents/Developer 2>/dev/null; then
                print_success "xcode-select auf Xcode.app umgestellt"
            fi
        fi

        local xcode_version
        xcode_version=$(get_xcode_version)
        print_success "Xcode ist installiert (${xcode_version})"

        # Lizenz akzeptieren
        print_info "Akzeptiere Xcode-Lizenz..."
        if sudo xcodebuild -license accept &> /dev/null; then
            print_success "Xcode-Lizenz akzeptiert"
        fi

        # Pruefen ob iOS-Plattform installiert ist (Xcode 26+ erfordert separaten Download)
        print_info "Pruefe iOS-Plattform SDK..."
        if xcrun --sdk iphoneos --show-sdk-path &> /dev/null; then
            print_success "iOS SDK ist installiert"
        else
            print_warning "iOS Plattform SDK nicht gefunden"
            echo ""
            echo -e "  ${BOLD}${YELLOW}In Xcode 26+ muss das iOS SDK separat heruntergeladen werden.${NC}"
            echo ""
            if run_with_progress "iOS Plattform herunterladen" "~8 GB" xcodebuild -downloadPlatform iOS; then
                print_success "iOS Plattform erfolgreich installiert"
            else
                print_warning "iOS Plattform-Download fehlgeschlagen"
                echo -e "  ${DIM}Bitte manuell ausfuehren: xcodebuild -downloadPlatform iOS${NC}"
                WARNINGS+=("iOS Plattform nicht installiert")
            fi
        fi
    else
        print_warning "Xcode.app nicht gefunden"
        echo ""
        echo -e "  ${BOLD}${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "  ${BOLD}${YELLOW}║  Xcode wird fuer die volle Funktionalitaet benoetigt!      ║${NC}"
        echo -e "  ${BOLD}${YELLOW}║  Download: ~35 GB                                           ║${NC}"
        echo -e "  ${BOLD}${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
        echo ""

        # Versuche Xcode ueber mas (Mac App Store CLI) zu installieren
        local xcode_installed_via_mas=false

        if command_exists brew; then
            # mas installieren falls noch nicht vorhanden
            if ! command_exists mas; then
                print_info "Installiere mas (Mac App Store CLI)..."
                brew install mas &>/dev/null 2>&1 || true
                # PATH aktualisieren fuer Apple Silicon
                if is_arm64_mac && [[ -x "/opt/homebrew/bin/mas" ]]; then
                    export PATH="/opt/homebrew/bin:$PATH"
                fi
            fi

            if command_exists mas; then
                # Pruefen ob im App Store angemeldet
                # mas account gibt bei neueren macOS-Versionen manchmal Fehler,
                # daher versuchen wir einfach die Installation direkt
                echo ""
                echo -e "  ${BOLD}${CYAN}Xcode wird direkt aus dem App Store installiert (~35 GB)...${NC}"
                echo -e "  ${DIM}Das kann 20-60 Minuten dauern (abhaengig von der Internetverbindung).${NC}"
                echo -e "  ${DIM}Falls ein Passwort abgefragt wird, bitte eingeben.${NC}"
                echo ""

                # mas install laeuft im Vordergrund (braucht ggf. Passwort-Eingabe)
                if mas install 497799835; then
                    xcode_installed_via_mas=true
                    print_success "Xcode erfolgreich installiert!"

                    # xcode-select auf die neue Installation umstellen
                    if [[ -d "/Applications/Xcode.app" ]]; then
                        sudo xcode-select -s /Applications/Xcode.app/Contents/Developer 2>/dev/null || true
                        # Lizenz akzeptieren
                        print_info "Akzeptiere Xcode-Lizenz..."
                        sudo xcodebuild -license accept &>/dev/null || true
                        print_success "Xcode-Lizenz akzeptiert"

                        # iOS SDK pruefen (Xcode 26+)
                        print_info "Pruefe iOS-Plattform SDK..."
                        if xcrun --sdk iphoneos --show-sdk-path &> /dev/null; then
                            print_success "iOS SDK ist installiert"
                        else
                            print_warning "iOS Plattform SDK nicht gefunden"
                            echo -e "  ${BOLD}${YELLOW}In Xcode 26+ muss das iOS SDK separat heruntergeladen werden.${NC}"
                            if run_with_progress "iOS Plattform herunterladen" "~8 GB" xcodebuild -downloadPlatform iOS; then
                                print_success "iOS Plattform erfolgreich installiert"
                            else
                                print_warning "iOS Plattform-Download fehlgeschlagen"
                                echo -e "  ${DIM}Bitte manuell ausfuehren: xcodebuild -downloadPlatform iOS${NC}"
                                WARNINGS+=("iOS Plattform nicht installiert")
                            fi
                        fi
                    fi
                else
                    print_warning "mas install fehlgeschlagen -- Fallback auf App Store"
                    print_info "Moegliche Ursache: Nicht im App Store angemeldet"
                fi
            fi
        fi

        # Fallback: App Store manuell oeffnen (nur wenn mas nicht funktioniert hat)
        if [[ "$xcode_installed_via_mas" != "true" ]]; then
            echo ""
            echo -e "  ${BOLD}${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
            echo -e "  ${BOLD}${YELLOW}║  Der App Store wird jetzt geoeffnet.                        ║${NC}"
            echo -e "  ${BOLD}${YELLOW}║  Bitte starte die Xcode-Installation dort manuell.          ║${NC}"
            echo -e "  ${BOLD}${YELLOW}║  Der Installer hier laeuft normal weiter.                   ║${NC}"
            echo -e "  ${BOLD}${YELLOW}║                                                              ║${NC}"
            echo -e "  ${BOLD}${YELLOW}║  Nach der Xcode-Installation einfach nochmal ausfuehren:    ║${NC}"
            echo -e "  ${BOLD}${YELLOW}║  ${CYAN}./scripts/install.sh${YELLOW}                                        ║${NC}"
            echo -e "  ${BOLD}${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
            echo ""

            # App Store direkt zur Xcode-Seite oeffnen
            print_info "Oeffne App Store -> Xcode..."
            open "macappstore://itunes.apple.com/app/id497799835" 2>/dev/null || \
            open "https://apps.apple.com/app/xcode/id497799835" 2>/dev/null || true

            print_info "Xcode-Download: ~35 GB – installiere im Hintergrund"
            print_info "Danach einfach diesen Installer nochmal starten!"
            echo ""
            sleep 3  # Kurz warten, damit Nutzer die Meldung liest
        fi
    fi
}

install_homebrew() {
    print_step "Check/Install Homebrew"

    if command_exists brew; then
        local brew_version
        brew_version=$(get_homebrew_version)
        print_success "Homebrew already installed (${brew_version})"
        return 0
    fi

    # Homebrew might be installed but not in PATH (common on Apple Silicon)
    if [[ -x "/opt/homebrew/bin/brew" ]]; then
        print_info "Homebrew found but not in PATH -- activating..."
        export PATH="/opt/homebrew/bin:$PATH"
        eval "$(/opt/homebrew/bin/brew shellenv)"

        # Persist to shell profiles
        for profile in "$HOME/.zprofile" "$HOME/.zshrc"; do
            if ! grep -qF '/opt/homebrew/bin' "$profile" 2>/dev/null; then
                echo '' >> "$profile"
                echo '# Homebrew (added by coolblack-xcode-mcp installer)' >> "$profile"
                echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$profile"
                print_info "Homebrew PATH in ${profile} eingetragen"
            fi
        done

        print_success "Homebrew activated ($(get_homebrew_version))"
        return 0
    fi

    print_info "Homebrew wird installiert (kann einige Minuten dauern)..."

    if run_with_spinner "Homebrew installieren" /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; then
        print_success "Homebrew installed successfully"

        # Add Homebrew to PATH for current session and shell profiles
        if is_arm64_mac && [[ -d "/opt/homebrew/bin" ]]; then
            print_info "Configuring Homebrew for Apple Silicon..."
            export PATH="/opt/homebrew/bin:$PATH"
            eval "$(/opt/homebrew/bin/brew shellenv)"

            # Persist to both .zprofile and .zshrc
            for profile in "$HOME/.zprofile" "$HOME/.zshrc"; do
                if ! grep -qF '/opt/homebrew/bin' "$profile" 2>/dev/null; then
                    echo '' >> "$profile"
                    echo '# Homebrew (added by coolblack-xcode-mcp installer)' >> "$profile"
                    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$profile"
                    print_info "Homebrew PATH in ${profile} eingetragen"
                fi
            done
        elif is_intel_mac && [[ -d "/usr/local/bin" ]]; then
            export PATH="/usr/local/bin:$PATH"
        fi
        return 0
    else
        print_error "Homebrew installation failed"
        print_info "Try manual installation: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        return 1
    fi
}

install_node() {
    print_step "Check/Install Node.js (v18+)"

    if command_exists node; then
        local node_version
        node_version=$(node -v)
        print_success "Node.js already installed (${node_version})"

        # Check version is >= 18
        local major_version
        major_version=$(echo "$node_version" | cut -d'.' -f1 | sed 's/v//')
        if [[ $major_version -ge 18 ]]; then
            return 0
        else
            print_warning "Node.js version ${node_version} is less than required v18"
            print_info "Will upgrade via Homebrew..."
        fi
    fi

    if ! command_exists brew; then
        print_error "Homebrew is required to install Node.js but not found"
        return 1
    fi

    print_info "Node.js wird via Homebrew installiert..."
    if run_with_spinner "Node.js installieren" brew install node; then
        # Refresh PATH so node/npm are available immediately
        hash -r 2>/dev/null || true
        if is_arm64_mac && [[ -x "/opt/homebrew/bin/node" ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
        print_success "Node.js installed successfully ($(node -v))"
        return 0
    else
        print_error "Node.js installation failed"
        print_info "Try manual installation: brew install node"
        return 1
    fi
}

install_claude_code() {
    print_step "Check/Install Claude Code (CLI) [Optional]"

    if command_exists claude; then
        local claude_version
        claude_version=$(claude --version 2>/dev/null | head -1 || echo "installed")
        print_success "Claude Code already installed (${claude_version})"
        CLAUDE_CODE_INSTALLED=true
        return 0
    fi

    # Claude Code CLI ist optional -- nur noetig wenn man Claude im Terminal nutzen will.
    # Claude Desktop (GUI) funktioniert auch ohne Claude Code CLI.
    echo ""
    echo -e "  ${BOLD}${CYAN}Claude Code (CLI) ist optional.${NC}"
    echo -e "  ${DIM}Wenn du nur Claude Desktop (GUI) nutzt, kannst du diesen Schritt ueberspringen.${NC}"
    echo -e "  ${DIM}Claude Code CLI ist ein separates Terminal-Tool fuer Entwickler.${NC}"
    echo ""
    echo -ne "  Claude Code CLI installieren? [y/${BOLD}N${NC}] "
    read -r install_choice < /dev/tty 2>/dev/null || install_choice=""

    if [[ ! "$install_choice" =~ ^[yYjJ]$ ]]; then
        print_info "Claude Code CLI uebersprungen (nicht benoetigt fuer Claude Desktop)"
        CLAUDE_CODE_INSTALLED=false
        return 0
    fi

    if ! command_exists npm; then
        print_error "npm is required to install Claude Code but not found"
        return 1
    fi

    print_info "Claude Code wird installiert (kann 1-2 Minuten dauern)..."

    if run_with_spinner "Claude Code installieren" npm install -g @anthropic-ai/claude-code; then
        # npm global bin zum PATH hinzufuegen falls noetig
        local npm_global_bin
        npm_global_bin=$(npm config get prefix 2>/dev/null)/bin
        if [[ -d "$npm_global_bin" ]] && [[ ":$PATH:" != *":$npm_global_bin:"* ]]; then
            export PATH="$npm_global_bin:$PATH"

            # Dauerhaft in Shell-Profil schreiben
            local shell_profile=""
            if [[ -n "${ZSH_VERSION:-}" ]] || [[ "$SHELL" == */zsh ]]; then
                shell_profile="$HOME/.zshrc"
            elif [[ -n "${BASH_VERSION:-}" ]] || [[ "$SHELL" == */bash ]]; then
                shell_profile="$HOME/.bash_profile"
            fi

            if [[ -n "$shell_profile" ]]; then
                local path_line="export PATH=\"${npm_global_bin}:\$PATH\""
                if ! grep -qF "$npm_global_bin" "$shell_profile" 2>/dev/null; then
                    echo "" >> "$shell_profile"
                    echo "# npm global packages (added by coolblack-xcode-mcp installer)" >> "$shell_profile"
                    echo "$path_line" >> "$shell_profile"
                    print_info "PATH dauerhaft in ${shell_profile} eingetragen"
                fi
            fi
        fi

        # Verify installation
        if command_exists claude; then
            local installed_version
            installed_version=$(claude --version 2>/dev/null | head -1 || echo "installed")
            print_success "Claude Code installiert (${installed_version})"
            CLAUDE_CODE_INSTALLED=true
        else
            print_success "Claude Code npm-Paket installiert"
            print_info "Neues Terminal oeffnen, damit 'claude' im PATH ist"
            CLAUDE_CODE_INSTALLED=true
        fi
        return 0
    else
        print_warning "Claude Code Installation fehlgeschlagen (optional)"
        print_info "Manuell installieren: npm install -g @anthropic-ai/claude-code"
        CLAUDE_CODE_INSTALLED=false
        return 0  # Non-critical
    fi
}

configure_claude_code() {
    print_step "Configure Claude Code MCP"

    # Determine project root
    local project_dir
    project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    local build_index="${project_dir}/build/index.js"

    if [[ ! -f "$build_index" ]]; then
        print_error "build/index.js not found -- was the build step successful?"
        return 1
    fi

    if [[ "$CLAUDE_CODE_INSTALLED" != "true" ]] && ! command_exists claude; then
        print_info "Claude Code CLI nicht installiert -- ueberspringe Claude Code MCP-Konfiguration"
        print_info "Claude Desktop wird im naechsten Schritt konfiguriert."
        return 0
    fi

    print_info "Registering coolblack-xcode-mcp with Claude Code..."
    print_info "Server path: ${build_index}"

    # Register MCP server with local build path
    if claude mcp add coolblack-xcode-mcp -- node "$build_index" &> /dev/null 2>&1; then
        print_success "coolblack-xcode-mcp registered with Claude Code"
    else
        print_warning "claude mcp add fehlgeschlagen -- versuche manuelle Konfiguration..."

        local claude_settings_dir="${HOME}/.claude"
        local claude_settings_file="${claude_settings_dir}/settings.json"
        mkdir -p "$claude_settings_dir" 2>/dev/null || true

        if command_exists python3; then
            python3 - "$build_index" << 'PYTHON_CLAUDE_CODE'
import json, os, sys

build_path = sys.argv[1]
settings_file = os.path.expanduser("~/.claude/settings.json")

try:
    with open(settings_file, 'r') as f:
        settings = json.load(f)
except (json.JSONDecodeError, FileNotFoundError):
    settings = {}

if 'mcpServers' not in settings:
    settings['mcpServers'] = {}

settings['mcpServers']['coolblack-xcode-mcp'] = {
    'command': 'node',
    'args': [build_path]
}

with open(settings_file, 'w') as f:
    json.dump(settings, f, indent=2)

print('ok')
PYTHON_CLAUDE_CODE
            if [[ $? -eq 0 ]]; then
                print_success "Claude Code settings manuell konfiguriert"
            else
                print_warning "Manuelle Konfiguration fehlgeschlagen"
                print_info "Bitte manuell ausfuehren:"
                print_info "  claude mcp add coolblack-xcode-mcp -- node ${build_index}"
            fi
        else
            print_info "Bitte manuell ausfuehren:"
            print_info "  claude mcp add coolblack-xcode-mcp -- node ${build_index}"
        fi
    fi

    print_info "Verify with: claude mcp list"
}

install_xcodegen() {
    print_step "Check/Install XcodeGen"

    if command_exists xcodegen; then
        local xg_version
        xg_version=$(get_xcodegen_version)
        print_success "XcodeGen already installed (${xg_version})"
        return 0
    fi

    if ! command_exists brew; then
        print_error "Homebrew is required to install XcodeGen but not found"
        return 1
    fi

    print_info "XcodeGen wird via Homebrew installiert..."
    if run_with_spinner "XcodeGen installieren" brew install xcodegen; then
        print_success "XcodeGen installed successfully"
        return 0
    else
        print_warning "XcodeGen installation fehlgeschlagen (optional)"
        print_info "Spaeter manuell installieren: brew install xcodegen"
        return 0  # Non-critical, don't fail
    fi
}

install_cocoapods() {
    print_step "Check/Install CocoaPods"

    if command_exists pod; then
        local pod_version
        pod_version=$(pod --version 2>/dev/null)
        print_success "CocoaPods already installed (${pod_version})"
        return 0
    fi

    print_info "Installing CocoaPods via RubyGems..."

    # Try brew first (more reliable on modern macOS), then gem as fallback
    if command_exists brew; then
        print_info "CocoaPods wird via Homebrew installiert..."
        if run_with_spinner "CocoaPods installieren" brew install cocoapods; then
            print_success "CocoaPods installed via Homebrew"
            return 0
        fi
    fi

    print_info "Trying RubyGems installation..."
    if gem install cocoapods --user-install &> /dev/null 2>&1; then
        print_success "CocoaPods installed via RubyGems (user)"
        return 0
    fi

    if sudo gem install cocoapods &> /dev/null 2>&1; then
        print_success "CocoaPods installed via RubyGems (system)"
        return 0
    fi

    print_warning "CocoaPods installation fehlgeschlagen (optional)"
    print_info "Spaeter manuell installieren: brew install cocoapods"
    return 0  # Non-critical, don't fail
}

install_coolblack_xcode_mcp() {
    print_step "Build coolblack-xcode-mcp"

    if ! command_exists npm; then
        print_error "npm is required but not found. Please ensure Node.js is properly installed."
        return 1
    fi

    # Determine project root (script is in scripts/, so go one level up)
    local project_dir
    project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

    if [[ ! -f "${project_dir}/package.json" ]]; then
        print_error "package.json not found in ${project_dir}"
        print_info "Make sure you cloned the repository first:"
        print_info "  git clone https://github.com/Coolblack-GmbH/xcode-mcp.git"
        return 1
    fi

    # Change to project directory
    cd "$project_dir" || return 1
    print_info "Projektverzeichnis: ${project_dir}"

    # Step 1: npm install
    print_info "Installiere npm-Abhaengigkeiten..."
    if run_with_spinner "npm install" npm install; then
        print_success "npm-Abhaengigkeiten installiert"
    else
        print_error "npm install fehlgeschlagen"
        return 1
    fi

    # Step 2: npm run build
    print_info "Kompiliere TypeScript..."
    if run_with_spinner "npm run build" npm run build; then
        print_success "TypeScript erfolgreich kompiliert"
    else
        print_error "npm run build fehlgeschlagen"
        return 1
    fi

    # Verify build output exists
    if [[ ! -f "${project_dir}/build/index.js" ]]; then
        print_error "build/index.js nicht gefunden nach Build"
        return 1
    fi

    print_success "coolblack-xcode-mcp erfolgreich gebaut in ${project_dir}/build/"
}

check_claude_desktop() {
    print_step "Check/Install Claude Desktop App"

    # Claude Desktop ist die empfohlene Methode, um den MCP-Server zu nutzen.
    if [[ -d "/Applications/Claude.app" ]]; then
        print_success "Claude Desktop ist installiert"
        return 0
    fi

    # Auch unter ~/Applications pruefen
    if [[ -d "$HOME/Applications/Claude.app" ]]; then
        print_success "Claude Desktop ist installiert (~/Applications)"
        return 0
    fi

    print_warning "Claude Desktop nicht gefunden"
    echo ""
    echo -e "  ${BOLD}${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "  ${BOLD}${YELLOW}║  Claude Desktop wird fuer den MCP-Server benoetigt.         ║${NC}"
    echo -e "  ${BOLD}${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Versuche Claude Desktop ueber Homebrew Cask zu installieren
    local claude_installed_via_brew=false

    if command_exists brew; then
        echo -e "  ${BOLD}${CYAN}Claude Desktop wird via Homebrew installiert...${NC}"
        echo ""

        if run_with_progress "Claude Desktop installieren" "~250 MB" brew install --cask claude; then
            claude_installed_via_brew=true

            # Pruefen ob Installation erfolgreich war
            if [[ -d "/Applications/Claude.app" ]] || [[ -d "$HOME/Applications/Claude.app" ]]; then
                print_success "Claude Desktop erfolgreich installiert!"
            else
                print_warning "brew install abgeschlossen, aber Claude.app nicht gefunden"
                claude_installed_via_brew=false
            fi
        else
            print_warning "Homebrew-Installation fehlgeschlagen -- Fallback auf manuellen Download"
        fi
    fi

    # Fallback: Download-Seite oeffnen (nur wenn brew nicht funktioniert hat)
    if [[ "$claude_installed_via_brew" != "true" ]]; then
        echo ""
        echo -ne "  Claude Desktop Download-Seite jetzt oeffnen? [${BOLD}Y${NC}/n] "
        read -r open_choice < /dev/tty 2>/dev/null || open_choice=""

        if [[ ! "$open_choice" =~ ^[nN]$ ]]; then
            open "https://claude.ai/download" 2>/dev/null || true
            print_info "Download-Seite geoeffnet -- bitte Claude Desktop installieren"
        else
            print_info "Du kannst Claude Desktop spaeter herunterladen: https://claude.ai/download"
        fi
    fi

    # Weitermachen -- die Konfigurationsdatei wird trotzdem erstellt,
    # damit sie bereit ist wenn Claude Desktop installiert wird.
    print_info "MCP-Konfiguration wird trotzdem erstellt (fuer spaeter)"
    return 0
}

configure_claude_desktop() {
    print_step "Configure Claude Desktop"

    # Determine project root
    local project_dir
    project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    local build_index="${project_dir}/build/index.js"

    local config_dir="${HOME}/Library/Application Support/Claude"
    local config_file="${config_dir}/claude_desktop_config.json"

    # Ensure config directory exists
    if [[ ! -d "$config_dir" ]]; then
        print_info "Creating Claude config directory..."
        mkdir -p "$config_dir" || {
            print_error "Failed to create Claude config directory at ${config_dir}"
            return 1
        }
    fi

    print_info "Configuring Claude Desktop..."
    print_info "Server path: ${build_index}"

    if [[ ! -f "$config_file" ]]; then
        # Create new config with local path
        print_info "Creating new Claude Desktop configuration..."
        cat > "$config_file" << EOF
{
  "mcpServers": {
    "coolblack-xcode-mcp": {
      "command": "node",
      "args": ["${build_index}"]
    }
  }
}
EOF
        print_success "Created Claude Desktop configuration"
    else
        # Update existing config
        print_info "Updating existing Claude Desktop configuration..."

        if command_exists python3; then
            python3 - "$build_index" << 'PYTHON_EOF'
import json, os, sys

build_path = sys.argv[1]
config_file = os.path.expanduser("~/Library/Application Support/Claude/claude_desktop_config.json")

try:
    with open(config_file, 'r') as f:
        config = json.load(f)
except (json.JSONDecodeError, FileNotFoundError):
    config = {}

if 'mcpServers' not in config:
    config['mcpServers'] = {}

config['mcpServers']['coolblack-xcode-mcp'] = {
    'command': 'node',
    'args': [build_path]
}

with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)

print('ok')
PYTHON_EOF
            if [[ $? -eq 0 ]]; then
                print_success "Updated Claude Desktop configuration"
            else
                print_error "Failed to update configuration"
                return 1
            fi
        elif command_exists jq; then
            local temp_file
            temp_file=$(mktemp)

            if ! jq -e '.mcpServers' "$config_file" &> /dev/null; then
                jq '.mcpServers = {}' "$config_file" > "$temp_file"
                mv "$temp_file" "$config_file"
            fi

            jq --arg path "$build_index" '.mcpServers["coolblack-xcode-mcp"] = {"command": "node", "args": [$path]}' "$config_file" > "$temp_file"

            if mv "$temp_file" "$config_file"; then
                print_success "Updated Claude Desktop configuration"
            else
                print_error "Failed to update configuration with jq"
                return 1
            fi
        fi
    fi

    print_info "Configuration file: ${config_file}"
}

setup_simulators() {
    print_step "Setup iOS Simulators"

    # Ohne Xcode keine Simulatoren
    if [[ ! -d "/Applications/Xcode.app" ]]; then
        print_warning "Xcode.app nicht installiert -- Simulatoren koennen nicht eingerichtet werden"
        return 0
    fi

    # Pruefen ob iOS Simulator Runtime installiert ist
    local runtime_installed=false
    local ios_runtime=""

    # Suche nach installierten iOS-Runtimes
    ios_runtime=$(xcrun simctl list runtimes 2>/dev/null | grep -i "iOS" | grep -v "unavailable" | tail -1 || echo "")

    if [[ -n "$ios_runtime" ]]; then
        print_success "iOS Simulator-Runtime bereits installiert"
        print_info "${ios_runtime}"
        runtime_installed=true
    else
        print_warning "Keine iOS Simulator-Runtime gefunden"
        echo ""
        echo -e "  ${BOLD}${YELLOW}Die iOS Simulator-Runtime (~8 GB) wird benoetigt,${NC}"
        echo -e "  ${BOLD}${YELLOW}um Apps auf dem Simulator zu testen.${NC}"
        echo ""
        echo -ne "  iOS Simulator-Runtime jetzt herunterladen? [${BOLD}Y${NC}/n] "
        read -r download_choice < /dev/tty 2>/dev/null || download_choice=""

        if [[ "$download_choice" =~ ^[nN]$ ]]; then
            print_info "Simulator-Runtime Download uebersprungen"
            print_info "Spaeter herunterladen mit: xcodebuild -downloadPlatform iOS"
            return 0
        fi

        echo ""
        echo -e "  ${DIM}Du kannst waehrenddessen weiterarbeiten.${NC}"
        echo ""

        if run_with_progress "iOS Simulator-Runtime herunterladen" "~8 GB" xcodebuild -downloadPlatform iOS; then
            print_success "iOS Simulator-Runtime erfolgreich heruntergeladen"
            runtime_installed=true
            # Runtime-Identifier neu laden
            ios_runtime=$(xcrun simctl list runtimes 2>/dev/null | grep -i "iOS" | grep -v "unavailable" | tail -1 || echo "")
        else
            print_warning "Download fehlgeschlagen oder abgebrochen"
            print_info "Spaeter manuell herunterladen: xcodebuild -downloadPlatform iOS"
            print_info "Oder in Xcode: Settings > Platforms > iOS Simulator"
            return 0
        fi
    fi

    # Pruefen ob bereits Simulatoren existieren
    local existing_sims
    existing_sims=$(xcrun simctl list devices available 2>/dev/null | grep -c "iPhone" || echo "0")

    if [[ "$existing_sims" -gt 0 ]]; then
        print_success "${existing_sims} iPhone-Simulator(en) bereits vorhanden"
        return 0
    fi

    # Runtime-Identifier extrahieren (z.B. com.apple.CoreSimulator.SimRuntime.iOS-26-2)
    if [[ "$runtime_installed" != "true" ]] || [[ -z "$ios_runtime" ]]; then
        print_warning "Keine Runtime verfuegbar -- Simulatoren koennen nicht erstellt werden"
        return 0
    fi

    local runtime_id
    runtime_id=$(xcrun simctl list runtimes 2>/dev/null | grep -i "iOS" | grep -v "unavailable" | tail -1 | sed 's/.*(\(com\.apple[^)]*\)).*/\1/' || echo "")

    if [[ -z "$runtime_id" ]]; then
        print_warning "Runtime-Identifier nicht erkannt -- Simulatoren manuell erstellen"
        return 0
    fi

    print_info "Runtime: ${runtime_id}"

    # Standard-Simulatoren erstellen
    echo ""
    echo -e "  ${BOLD}${CYAN}Erstelle Standard-Simulatoren...${NC}"

    local created=0

    # iPhone 16 Pro (aktuelles Flaggschiff)
    if xcrun simctl create "iPhone 16 Pro" com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro "$runtime_id" &> /dev/null; then
        print_success "iPhone 16 Pro erstellt"
        ((created++))
    else
        print_warning "iPhone 16 Pro konnte nicht erstellt werden"
    fi

    # iPhone 16 (Standard-Modell)
    if xcrun simctl create "iPhone 16" com.apple.CoreSimulator.SimDeviceType.iPhone-16 "$runtime_id" &> /dev/null; then
        print_success "iPhone 16 erstellt"
        ((created++))
    else
        print_warning "iPhone 16 konnte nicht erstellt werden"
    fi

    # iPad (fuer Universal-Apps)
    if xcrun simctl create "iPad Air 13-inch (M3)" com.apple.CoreSimulator.SimDeviceType.iPad-Air-13-inch-M3 "$runtime_id" &> /dev/null; then
        print_success "iPad Air 13-inch (M3) erstellt"
        ((created++))
    else
        print_warning "iPad Air konnte nicht erstellt werden"
    fi

    if [[ $created -gt 0 ]]; then
        print_success "${created} Simulator(en) erfolgreich erstellt"
    else
        print_warning "Keine Simulatoren erstellt -- spaeter manuell in Xcode einrichten"
    fi
}

verify_installation() {
    print_step "Verify Installation"

    local all_ok=true

    # Check Node.js
    if command_exists node; then
        print_success "Node.js: $(node -v)"
    else
        print_error "Node.js not found in PATH"
        all_ok=false
    fi

    # Check npm
    if command_exists npm; then
        print_success "npm: $(npm -v)"
    else
        print_error "npm not found in PATH"
        all_ok=false
    fi

    # Check xcode-select
    if xcode-select -p &> /dev/null; then
        print_success "Xcode CLI Tools: $(xcode-select -p)"
    else
        print_warning "Xcode CLI Tools nicht konfiguriert"
    fi

    # Check full Xcode
    if [[ -d "/Applications/Xcode.app" ]]; then
        local xc_ver
        xc_ver=$(get_xcode_version)
        print_success "Xcode.app: ${xc_ver}"
    else
        print_warning "Xcode.app: wird installiert (App Store pruefen)"
    fi

    # Check Homebrew
    if command_exists brew; then
        print_success "Homebrew: $(brew --version | head -1)"
    else
        print_warning "Homebrew not found (optional)"
    fi

    # Check Claude Desktop App
    if [[ -d "/Applications/Claude.app" ]] || [[ -d "$HOME/Applications/Claude.app" ]]; then
        print_success "Claude Desktop App: installiert"
    else
        print_warning "Claude Desktop App: nicht gefunden -- Download: https://claude.ai/download"
    fi

    # Check Claude Code (optional)
    if command_exists claude; then
        local claude_ver
        claude_ver=$(claude --version 2>/dev/null | head -1 || echo "installed")
        print_success "Claude Code: ${claude_ver}"

        # Check Claude Code MCP config
        if claude mcp list 2>/dev/null | grep -q "coolblack-xcode-mcp" &> /dev/null; then
            print_success "Claude Code MCP: coolblack-xcode-mcp registered"
        else
            local project_dir
            project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
            print_warning "Claude Code MCP: coolblack-xcode-mcp may need manual registration"
            print_info "  Run: claude mcp add coolblack-xcode-mcp -- node ${project_dir}/build/index.js"
        fi
    else
        print_info "Claude Code CLI: nicht installiert (optional, nur fuer Terminal-Nutzung)"
    fi

    # Check Claude Desktop config
    local config_file="${HOME}/Library/Application Support/Claude/claude_desktop_config.json"
    if [[ -f "$config_file" ]]; then
        if grep -q "coolblack-xcode-mcp" "$config_file" &> /dev/null; then
            print_success "Claude Desktop configuration: configured"
        else
            print_warning "Claude Desktop configuration: exists but coolblack-xcode-mcp not found"
        fi
    else
        print_warning "Claude Desktop configuration: not found"
    fi

    [[ $all_ok == true ]] && return 0 || return 1
}

print_next_steps() {
    print_section "Naechste Schritte"

    # Xcode-Warnung ganz oben falls nicht installiert
    if [[ ! -d "/Applications/Xcode.app" ]]; then
        echo -e "  ${BOLD}${RED}⚠  WICHTIG: Xcode aus dem App Store fertig installieren,${NC}"
        echo -e "  ${BOLD}${RED}   dann diesen Installer nochmal ausfuehren:${NC}"
        echo -e "  ${CYAN}   ./scripts/install.sh${NC}"
        echo ""
    fi

    # Restart-Hinweis -- das Wichtigste zuerst!
    echo -e "  ${BOLD}${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "  ${BOLD}${YELLOW}║  WICHTIG: Claude Desktop einmal neu starten,                ║${NC}"
    echo -e "  ${BOLD}${YELLOW}║  damit die MCP-Tools erkannt werden!                        ║${NC}"
    echo -e "  ${BOLD}${YELLOW}║                                                              ║${NC}"
    echo -e "  ${BOLD}${YELLOW}║  1. Claude Desktop starten                                  ║${NC}"
    echo -e "  ${BOLD}${YELLOW}║  2. Komplett beenden (Cmd+Q)                                 ║${NC}"
    echo -e "  ${BOLD}${YELLOW}║  3. Erneut starten -- fertig!                                ║${NC}"
    echo -e "  ${BOLD}${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    echo -e "1. ${BOLD}Claude Desktop (GUI) -- Empfohlen${NC}"
    echo -e "   Schliesse und starte Claude Desktop neu,"
    echo -e "   damit die MCP-Konfiguration geladen wird."
    echo -e "   Die Xcode-Tools stehen danach sofort zur Verfuegung."
    echo ""

    if [[ "$CLAUDE_CODE_INSTALLED" == "true" ]] || command_exists claude; then
        echo -e "2. ${BOLD}Claude Code (Terminal) -- Optional${NC}"
        echo -e "   Starte direkt im Terminal mit: ${CYAN}claude${NC}"
        echo -e "   Der MCP-Server ist automatisch registriert."
        echo -e "   Teste mit: ${CYAN}claude mcp list${NC}"
        echo ""
        echo -e "3. ${BOLD}Sofort loslegen${NC}"
    else
        echo -e "2. ${BOLD}Sofort loslegen${NC}"
    fi

    echo -e "   Frage Claude einfach, z.B.:"
    echo ""
    echo -e "   ${CYAN}\"Erstelle eine Wetter-App namens SkyView mit animierten"
    echo -e "    Gradient-Hintergruenden je nach Tageszeit, einer 5-Tage-Vorschau"
    echo -e "    und eleganten SF Symbols. Baue sie und starte sie auf dem Simulator.\"${NC}"
    echo ""
    echo -e "   ${DIM}Weitere Ideen:${NC}"
    echo -e "   ${DIM}\"Zeig mir einen Screenshot meiner App und sag mir was ich verbessern kann\"${NC}"
    echo -e "   ${DIM}\"Finde und behebe alle Build-Fehler in meinem Projekt\"${NC}"
    echo ""
}

# ============================================================================
# Main Installation Flow
# ============================================================================

main() {
    print_header

    # Run all installation steps
    check_macos || return 1
    install_xcode_cli || return 1
    install_homebrew || return 1
    install_node || return 1
    check_xcode
    install_claude_code
    install_xcodegen
    install_cocoapods
    install_coolblack_xcode_mcp || return 1
    configure_claude_code
    check_claude_desktop
    configure_claude_desktop || return 1
    setup_simulators
    verify_installation

    print_summary && {
        print_next_steps
        return 0
    } || {
        print_next_steps
        return 1
    }
}

# ============================================================================
# Entry Point
# ============================================================================

# Run main function
main "$@"
exit $?
