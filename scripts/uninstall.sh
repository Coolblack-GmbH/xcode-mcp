#!/bin/bash

################################################################################
# coolblack-xcode-mcp Uninstaller Script
#
# Removes all components installed by the coolblack-xcode-mcp installer.
# Interactive by default -- asks before removing optional components.
#
# Usage:
#   ./scripts/uninstall.sh          # Interactive mode
#   ./scripts/uninstall.sh --yes    # Remove everything without asking
#   ./scripts/uninstall.sh --help   # Show help
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

# Script state
SCRIPT_NAME="$(basename "$0")"
TOTAL_STEPS=7
CURRENT_STEP=0
ACTIONS_TAKEN=()
ACTIONS_SKIPPED=()
WARNINGS=()
AUTO_YES=false

# ============================================================================
# Output Functions
# ============================================================================

print_header() {
    clear
    echo -e "${BOLD}${CYAN}"
    cat << "EOF"
╔════════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║        coolblack-xcode-mcp Uninstaller                                   ║
║                                                                          ║
║        Removes components installed by the installer                     ║
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

print_usage() {
    echo "Usage: ${SCRIPT_NAME} [OPTIONS]"
    echo ""
    echo "Removes components installed by the coolblack-xcode-mcp installer."
    echo ""
    echo "Options:"
    echo "  --yes, -y    Remove all components without asking (non-interactive)"
    echo "  --help, -h   Show this help message"
    echo ""
    echo "The following components are removed:"
    echo "  - Claude Desktop MCP configuration entry"
    echo "  - Claude Code MCP registration"
    echo "  - Simulators created by the installer (iPhone 16 Pro, iPhone 16, iPad Air)"
    echo "  - XcodeGen (optional, asks first)"
    echo "  - CocoaPods (optional, asks first)"
    echo "  - Claude Code CLI (optional, asks first)"
    echo "  - Build artifacts (build/, node_modules/)"
    echo ""
    echo "The following are NOT removed (may be needed by other tools):"
    echo "  - Node.js, Homebrew, Xcode, Claude Desktop App"
    echo "  - Shell profile entries (Homebrew PATH)"
}

print_summary() {
    print_section "Uninstall Summary"

    if [[ ${#ACTIONS_TAKEN[@]} -gt 0 ]]; then
        echo -e "${BOLD}Durchgefuehrte Aktionen:${NC}"
        for action in "${ACTIONS_TAKEN[@]}"; do
            echo -e "  ${GREEN}${CHECK}${NC} ${action}"
        done
        echo ""
    fi

    if [[ ${#ACTIONS_SKIPPED[@]} -gt 0 ]]; then
        echo -e "${BOLD}Uebersprungen:${NC}"
        for action in "${ACTIONS_SKIPPED[@]}"; do
            echo -e "  ${DIM}${ARROW} ${action}${NC}"
        done
        echo ""
    fi

    if [[ ${#WARNINGS[@]} -gt 0 ]]; then
        echo -e "${BOLD}Hinweise:${NC}"
        for warning in "${WARNINGS[@]}"; do
            echo -e "  ${YELLOW}${WARN}${NC} ${warning}"
        done
        echo ""
    fi

    if [[ ${#ACTIONS_TAKEN[@]} -eq 0 ]]; then
        echo -e "${DIM}Keine Aenderungen vorgenommen.${NC}\n"
    else
        echo -e "${GREEN}${BOLD}${CHECK} Deinstallation abgeschlossen.${NC}\n"
    fi
}

# ============================================================================
# Utility Functions
# ============================================================================

command_exists() {
    command -v "$1" &> /dev/null
    return $?
}

# Ask a yes/no question. Returns 0 for yes, 1 for no.
# In --yes mode, always returns 0.
ask_yes_no() {
    local prompt="$1"
    local default="${2:-n}"  # default: no

    if [[ "$AUTO_YES" == "true" ]]; then
        return 0
    fi

    if [[ "$default" == "y" ]]; then
        echo -ne "  ${prompt} [${BOLD}Y${NC}/n] "
    else
        echo -ne "  ${prompt} [y/${BOLD}N${NC}] "
    fi

    local answer
    read -r answer < /dev/tty 2>/dev/null || answer=""

    if [[ "$default" == "y" ]]; then
        [[ ! "$answer" =~ ^[nN]$ ]]
    else
        [[ "$answer" =~ ^[yYjJ]$ ]]
    fi
}

# ============================================================================
# Step Functions
# ============================================================================

remove_claude_desktop_config() {
    print_step "Claude Desktop MCP-Konfiguration entfernen"

    local config_file="${HOME}/Library/Application Support/Claude/claude_desktop_config.json"

    if [[ ! -f "$config_file" ]]; then
        print_info "Keine Claude Desktop Konfigurationsdatei gefunden"
        ACTIONS_SKIPPED+=("Claude Desktop MCP-Config (Datei nicht vorhanden)")
        return 0
    fi

    # Check if our entry exists
    if ! grep -q "coolblack-xcode-mcp" "$config_file" 2>/dev/null; then
        print_info "coolblack-xcode-mcp nicht in Claude Desktop Konfiguration gefunden"
        ACTIONS_SKIPPED+=("Claude Desktop MCP-Config (Eintrag nicht vorhanden)")
        return 0
    fi

    print_info "Entferne coolblack-xcode-mcp aus claude_desktop_config.json..."

    if command_exists python3; then
        python3 - << 'PYTHON_EOF'
import json, os, sys

config_file = os.path.expanduser("~/Library/Application Support/Claude/claude_desktop_config.json")

try:
    with open(config_file, 'r') as f:
        config = json.load(f)
except (json.JSONDecodeError, FileNotFoundError):
    sys.exit(0)

if 'mcpServers' in config and 'coolblack-xcode-mcp' in config['mcpServers']:
    del config['mcpServers']['coolblack-xcode-mcp']

    with open(config_file, 'w') as f:
        json.dump(config, f, indent=2)

    print('removed')
else:
    print('not_found')
PYTHON_EOF
        if [[ $? -eq 0 ]]; then
            print_success "coolblack-xcode-mcp aus Claude Desktop Konfiguration entfernt"
            ACTIONS_TAKEN+=("Claude Desktop MCP-Config: coolblack-xcode-mcp entfernt")
        else
            print_error "Fehler beim Bearbeiten der Konfigurationsdatei"
        fi
    elif command_exists jq; then
        local temp_file
        temp_file=$(mktemp)

        if jq 'del(.mcpServers["coolblack-xcode-mcp"])' "$config_file" > "$temp_file" 2>/dev/null; then
            mv "$temp_file" "$config_file"
            print_success "coolblack-xcode-mcp aus Claude Desktop Konfiguration entfernt"
            ACTIONS_TAKEN+=("Claude Desktop MCP-Config: coolblack-xcode-mcp entfernt")
        else
            rm -f "$temp_file"
            print_error "Fehler beim Bearbeiten der Konfigurationsdatei mit jq"
        fi
    else
        print_warning "Weder python3 noch jq gefunden -- manuelle Entfernung noetig"
        print_info "Bitte manuell entfernen: ${config_file}"
        ACTIONS_SKIPPED+=("Claude Desktop MCP-Config (kein python3/jq verfuegbar)")
    fi
}

remove_claude_code_mcp() {
    print_step "Claude Code MCP-Registrierung entfernen"

    if ! command_exists claude; then
        print_info "Claude Code CLI nicht installiert -- ueberspringe"
        ACTIONS_SKIPPED+=("Claude Code MCP (CLI nicht installiert)")
        return 0
    fi

    # Check if registered
    if ! claude mcp list 2>/dev/null | grep -q "coolblack-xcode-mcp" 2>/dev/null; then
        # Also check settings.json as fallback
        local settings_file="${HOME}/.claude/settings.json"
        if [[ -f "$settings_file" ]] && grep -q "coolblack-xcode-mcp" "$settings_file" 2>/dev/null; then
            print_info "coolblack-xcode-mcp in settings.json gefunden, entferne..."
            if command_exists python3; then
                python3 - << 'PYTHON_EOF'
import json, os

settings_file = os.path.expanduser("~/.claude/settings.json")

try:
    with open(settings_file, 'r') as f:
        settings = json.load(f)
except (json.JSONDecodeError, FileNotFoundError):
    exit(0)

if 'mcpServers' in settings and 'coolblack-xcode-mcp' in settings['mcpServers']:
    del settings['mcpServers']['coolblack-xcode-mcp']
    with open(settings_file, 'w') as f:
        json.dump(settings, f, indent=2)
    print('removed')
PYTHON_EOF
                if [[ $? -eq 0 ]]; then
                    print_success "coolblack-xcode-mcp aus Claude Code settings.json entfernt"
                    ACTIONS_TAKEN+=("Claude Code MCP: aus settings.json entfernt")
                fi
            fi
        else
            print_info "coolblack-xcode-mcp nicht in Claude Code registriert"
            ACTIONS_SKIPPED+=("Claude Code MCP (nicht registriert)")
        fi
        return 0
    fi

    print_info "Entferne coolblack-xcode-mcp aus Claude Code..."
    if claude mcp remove coolblack-xcode-mcp &> /dev/null 2>&1; then
        print_success "coolblack-xcode-mcp aus Claude Code entfernt"
        ACTIONS_TAKEN+=("Claude Code MCP: coolblack-xcode-mcp deregistriert")
    else
        print_warning "claude mcp remove fehlgeschlagen -- versuche manuelle Entfernung"
        # Fallback: settings.json direkt bearbeiten
        local settings_file="${HOME}/.claude/settings.json"
        if [[ -f "$settings_file" ]] && command_exists python3; then
            python3 - << 'PYTHON_EOF'
import json, os

settings_file = os.path.expanduser("~/.claude/settings.json")

try:
    with open(settings_file, 'r') as f:
        settings = json.load(f)
except (json.JSONDecodeError, FileNotFoundError):
    exit(0)

if 'mcpServers' in settings and 'coolblack-xcode-mcp' in settings['mcpServers']:
    del settings['mcpServers']['coolblack-xcode-mcp']
    with open(settings_file, 'w') as f:
        json.dump(settings, f, indent=2)
    print('removed')
PYTHON_EOF
            if [[ $? -eq 0 ]]; then
                print_success "coolblack-xcode-mcp aus Claude Code settings.json entfernt"
                ACTIONS_TAKEN+=("Claude Code MCP: aus settings.json entfernt")
            fi
        else
            print_warning "Manuelle Entfernung fehlgeschlagen"
        fi
    fi
}

remove_simulators() {
    print_step "Vom Installer erstellte Simulatoren entfernen"

    if ! command_exists xcrun; then
        print_info "xcrun nicht verfuegbar -- ueberspringe Simulator-Bereinigung"
        ACTIONS_SKIPPED+=("Simulatoren (xcrun nicht verfuegbar)")
        return 0
    fi

    local removed=0
    local sim_names=("iPhone 16 Pro" "iPhone 16" "iPad Air 13-inch (M3)")

    for sim_name in "${sim_names[@]}"; do
        # Find UDIDs for simulators with this exact name
        local udids
        udids=$(xcrun simctl list devices -j 2>/dev/null | python3 -c "
import json, sys
data = json.load(sys.stdin)
for runtime, devices in data.get('devices', {}).items():
    for d in devices:
        if d.get('name') == '${sim_name}' and d.get('isAvailable', False):
            print(d['udid'])
" 2>/dev/null || echo "")

        if [[ -z "$udids" ]]; then
            print_info "${sim_name}: nicht gefunden"
            continue
        fi

        while IFS= read -r udid; do
            if [[ -n "$udid" ]]; then
                if xcrun simctl delete "$udid" &> /dev/null; then
                    print_success "${sim_name} entfernt (${udid})"
                    ((removed++))
                else
                    print_warning "${sim_name} konnte nicht entfernt werden (${udid})"
                fi
            fi
        done <<< "$udids"
    done

    if [[ $removed -gt 0 ]]; then
        ACTIONS_TAKEN+=("${removed} Simulator(en) entfernt")
    else
        print_info "Keine vom Installer erstellten Simulatoren gefunden"
        ACTIONS_SKIPPED+=("Simulatoren (keine gefunden)")
    fi
}

remove_xcodegen() {
    print_step "XcodeGen deinstallieren (optional)"

    if ! command_exists xcodegen; then
        print_info "XcodeGen ist nicht installiert"
        ACTIONS_SKIPPED+=("XcodeGen (nicht installiert)")
        return 0
    fi

    local xg_version
    xg_version=$(xcodegen version 2>/dev/null || echo "unbekannt")
    print_info "XcodeGen ${xg_version} ist installiert"

    if ! ask_yes_no "XcodeGen deinstallieren?"; then
        print_info "XcodeGen beibehalten"
        ACTIONS_SKIPPED+=("XcodeGen (beibehalten)")
        return 0
    fi

    if command_exists brew; then
        if brew uninstall xcodegen &> /dev/null 2>&1; then
            print_success "XcodeGen deinstalliert"
            ACTIONS_TAKEN+=("XcodeGen deinstalliert")
        else
            print_error "XcodeGen Deinstallation fehlgeschlagen"
        fi
    else
        print_warning "Homebrew nicht gefunden -- XcodeGen manuell deinstallieren"
    fi
}

remove_cocoapods() {
    print_step "CocoaPods deinstallieren (optional)"

    if ! command_exists pod; then
        print_info "CocoaPods ist nicht installiert"
        ACTIONS_SKIPPED+=("CocoaPods (nicht installiert)")
        return 0
    fi

    local pod_version
    pod_version=$(pod --version 2>/dev/null || echo "unbekannt")
    print_info "CocoaPods ${pod_version} ist installiert"

    if ! ask_yes_no "CocoaPods deinstallieren?"; then
        print_info "CocoaPods beibehalten"
        ACTIONS_SKIPPED+=("CocoaPods (beibehalten)")
        return 0
    fi

    if command_exists brew; then
        if brew uninstall cocoapods &> /dev/null 2>&1; then
            print_success "CocoaPods deinstalliert"
            ACTIONS_TAKEN+=("CocoaPods deinstalliert")
        else
            print_warning "brew uninstall fehlgeschlagen -- versuche gem uninstall"
            if gem uninstall cocoapods --all --executables &> /dev/null 2>&1; then
                print_success "CocoaPods via gem deinstalliert"
                ACTIONS_TAKEN+=("CocoaPods deinstalliert (gem)")
            else
                print_error "CocoaPods Deinstallation fehlgeschlagen"
            fi
        fi
    else
        if gem uninstall cocoapods --all --executables &> /dev/null 2>&1; then
            print_success "CocoaPods via gem deinstalliert"
            ACTIONS_TAKEN+=("CocoaPods deinstalliert (gem)")
        else
            print_error "CocoaPods Deinstallation fehlgeschlagen"
        fi
    fi
}

remove_claude_code_cli() {
    # This is part of the CocoaPods step count-wise, we combine steps 5+6
    # Actually we handle this as a sub-part of step 5
    echo "" # visual separator

    if ! command_exists claude && ! npm list -g @anthropic-ai/claude-code &> /dev/null 2>&1; then
        print_info "Claude Code CLI ist nicht installiert"
        ACTIONS_SKIPPED+=("Claude Code CLI (nicht installiert)")
        return 0
    fi

    local claude_version
    claude_version=$(claude --version 2>/dev/null | head -1 || echo "installiert")
    print_info "Claude Code CLI ist installiert (${claude_version})"

    if ! ask_yes_no "Claude Code CLI deinstallieren?"; then
        print_info "Claude Code CLI beibehalten"
        ACTIONS_SKIPPED+=("Claude Code CLI (beibehalten)")
        return 0
    fi

    if command_exists npm; then
        if npm uninstall -g @anthropic-ai/claude-code &> /dev/null 2>&1; then
            print_success "Claude Code CLI deinstalliert"
            ACTIONS_TAKEN+=("Claude Code CLI deinstalliert")
        else
            print_error "Claude Code CLI Deinstallation fehlgeschlagen"
            print_info "Manuell ausfuehren: npm uninstall -g @anthropic-ai/claude-code"
        fi
    else
        print_warning "npm nicht gefunden -- Claude Code CLI manuell deinstallieren"
    fi
}

remove_build_artifacts() {
    print_step "Build-Artefakte entfernen"

    local project_dir
    project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    local removed=0

    # Remove build/
    if [[ -d "${project_dir}/build" ]]; then
        rm -rf "${project_dir}/build"
        print_success "build/ entfernt"
        ((removed++))
    else
        print_info "build/ nicht vorhanden"
    fi

    # Remove node_modules/
    if [[ -d "${project_dir}/node_modules" ]]; then
        rm -rf "${project_dir}/node_modules"
        print_success "node_modules/ entfernt"
        ((removed++))
    else
        print_info "node_modules/ nicht vorhanden"
    fi

    if [[ $removed -gt 0 ]]; then
        ACTIONS_TAKEN+=("Build-Artefakte entfernt (${removed} Verzeichnis(se))")
    else
        ACTIONS_SKIPPED+=("Build-Artefakte (nicht vorhanden)")
    fi
}

print_post_uninstall_hints() {
    print_section "Hinweise"

    echo -e "  ${BOLD}Nicht entfernt${NC} (werden moeglicherweise anderweitig benoetigt):"
    echo -e "  ${DIM}${ARROW} Node.js, Homebrew, Xcode, Claude Desktop App${NC}"
    echo ""

    # Check if Homebrew PATH entries exist in shell profiles
    local has_brew_entries=false
    for profile in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile"; do
        if grep -q "coolblack-xcode-mcp installer" "$profile" 2>/dev/null; then
            has_brew_entries=true
            break
        fi
    done

    if [[ "$has_brew_entries" == "true" ]]; then
        echo -e "  ${YELLOW}${WARN}${NC} ${BOLD}Shell-Profile enthalten vom Installer eingetragene Zeilen:${NC}"
        for profile in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile"; do
            if grep -q "coolblack-xcode-mcp installer" "$profile" 2>/dev/null; then
                echo -e "     ${DIM}${profile}: Homebrew PATH (coolblack-xcode-mcp installer)${NC}"
            fi
        done
        echo -e "  ${DIM}  Diese Eintraege sind harmlos und werden von Homebrew benoetigt.${NC}"
        echo -e "  ${DIM}  Falls gewuenscht, manuell die Zeilen mit 'coolblack-xcode-mcp installer' entfernen.${NC}"
        echo ""
    fi

    echo -e "  ${BOLD}Claude Desktop neu starten${NC}, damit die Aenderungen wirksam werden."
    echo ""
}

# ============================================================================
# Main
# ============================================================================

main() {
    # Parse arguments
    for arg in "$@"; do
        case "$arg" in
            --yes|-y)
                AUTO_YES=true
                ;;
            --help|-h)
                print_usage
                exit 0
                ;;
            *)
                echo "Unbekannte Option: ${arg}"
                echo "Verwende --help fuer Hilfe."
                exit 1
                ;;
        esac
    done

    print_header

    if [[ "$AUTO_YES" == "true" ]]; then
        echo -e "  ${YELLOW}${WARN}${NC} ${BOLD}Nicht-interaktiver Modus (--yes)${NC}"
        echo -e "  ${DIM}  Alle optionalen Komponenten werden entfernt.${NC}"
    fi

    # Run all uninstall steps
    remove_claude_desktop_config
    remove_claude_code_mcp
    remove_simulators
    remove_xcodegen
    remove_cocoapods
    remove_claude_code_cli
    remove_build_artifacts

    print_summary
    print_post_uninstall_hints
}

# ============================================================================
# Entry Point
# ============================================================================

main "$@"
exit 0
