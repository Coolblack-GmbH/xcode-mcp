// Platform enum
export type Platform = 'iOS' | 'macOS' | 'watchOS' | 'tvOS' | 'visionOS';

// Language enum
export type Language = 'swift' | 'objc' | 'swiftui';

// Build configuration
export type Configuration = 'Debug' | 'Release';

// Export method
export type ExportMethod = 'app-store' | 'ad-hoc' | 'enterprise' | 'development';

// Signing style
export type SigningStyle = 'automatic' | 'manual';

// Certificate type
export type CertificateType = 'development' | 'distribution' | 'developer_id_application';

// CI/CD platform
export type CICDPlatform = 'github' | 'gitlab';

// Coverage format
export type CoverageFormat = 'json' | 'lcov' | 'html';

// Log format
export type LogFormat = 'json' | 'xml' | 'text';

// ToolResult - standard response from all tools
export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
  warnings?: string[];
  executionTime: number;
  /** Optional base64-encoded image to include in the MCP response (e.g., simulator screenshots) */
  _imageBase64?: string;
  /** MIME type of the image (e.g., 'image/png') */
  _imageMimeType?: string;
}

// XcodeProject
export interface XcodeProject {
  name: string;
  path: string;
  version: string;
  bundleId: string;
  platform: Platform;
  targets: XcodeTarget[];
  schemes: string[];
  minDeploymentTarget: string;
}

// XcodeTarget
export interface XcodeTarget {
  name: string;
  type: 'application' | 'framework' | 'test' | 'extension' | 'app-extension';
  platform: string;
  bundleId: string;
  productName: string;
}

// BuildResult
export interface BuildResult {
  success: boolean;
  projectPath: string;
  scheme: string;
  configuration: string;
  platform: string;
  outputPath: string;
  warnings: BuildIssue[];
  errors: BuildIssue[];
  duration: number;
}

// BuildIssue
export interface BuildIssue {
  severity: 'error' | 'warning' | 'note';
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

// Simulator
export interface Simulator {
  udid: string;
  name: string;
  deviceType: string;
  osVersion: string;
  state: 'Booted' | 'Shutdown' | 'Unavailable';
  isAvailable: boolean;
}

// SigningIdentity
export interface SigningIdentity {
  id: string;
  name: string;
  commonName: string;
  issuer: string;
  expiryDate: string;
  type: CertificateType;
  thumbprint: string;
}

// ProvisioningProfile
export interface ProvisioningProfile {
  identifier: string;
  name: string;
  bundleId: string;
  teamId: string;
  expiryDate: string;
  capabilities: string[];
  path: string;
}

// TestResult
export interface TestResult {
  testName: string;
  className: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  failureMessage?: string;
  failureFile?: string;
  failureLine?: number;
}

// TestSummary
export interface TestSummary {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  results: TestResult[];
}

// Dependency
export interface Dependency {
  name: string;
  version: string;
  source: 'cocoapods' | 'spm';
  latestVersion?: string;
  isOutdated: boolean;
}

// SDKInfo
export interface SDKInfo {
  platform: string;
  version: string;
  path: string;
  buildVersion: string;
}

// ProfileInfo for Instruments
export interface ProfileResult {
  tracePath: string;
  template: string;
  duration: number;
  summary: string;
}

// ArchiveInfo
export interface ArchiveInfo {
  path: string;
  scheme: string;
  bundleId: string;
  version: string;
  buildVersion: string;
  signingIdentity: string;
  size: number;
}

// Physical device
export interface PhysicalDevice {
  udid: string;
  name: string;
  model: string;
  osVersion: string;
  connectionType: string;
  state: string;
}

// Crash report summary
export interface CrashReportSummary {
  fileName: string;
  path: string;
  appName: string;
  date: string;
  size: number;
}

// Lint violation
export interface LintViolation {
  file: string;
  line: number;
  column: number;
  severity: 'Warning' | 'Error';
  type: string;
  rule_id: string;
  reason: string;
}

// Localization status
export interface LocalizationStatus {
  locale: string;
  total: number;
  translated: number;
  missing: number;
  coverage: number;
}

// Helper type for tool handler functions
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

// Platform SDK mappings
export const PLATFORM_SDK_MAP: Record<Platform, string> = {
  'iOS': 'iphoneos',
  'macOS': 'macosx',
  'watchOS': 'watchos',
  'tvOS': 'appletvos',
  'visionOS': 'xros',
};

export const PLATFORM_SIMULATOR_SDK_MAP: Record<string, string> = {
  'iOS': 'iphonesimulator',
  'watchOS': 'watchsimulator',
  'tvOS': 'appletvsimulator',
  'visionOS': 'xrsimulator',
};
