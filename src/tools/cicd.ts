import { ToolResult, ToolHandler } from '../types.js';
import { execCommand, execXcode, ExecResult } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';

/**
 * Tool definition interface
 */
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * setup-github-actions tool
 * Generate GitHub Actions workflow for iOS/macOS builds
 */
const setupGithubActions: ToolDefinition = {
  name: 'setup-github-actions',
  description: 'Generate a complete GitHub Actions workflow file for building and testing Xcode projects. Optionally includes TestFlight deployment.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Xcode project or workspace. If not specified, uses current directory.',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme name. Required for the workflow.',
      },
      platforms: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of platforms to build for (e.g., ["iOS", "macOS"]). Defaults to iOS.',
      },
      includeTestFlight: {
        type: 'boolean',
        description: 'If true, includes TestFlight deployment step. Defaults to false.',
      },
      outputPath: {
        type: 'string',
        description: 'Output path for the workflow file. Defaults to .github/workflows/build.yml',
      },
    },
    required: ['scheme'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const scheme = args.scheme as string;
      const projectPath = (args.projectPath as string) || '.';
      const platforms = (args.platforms as string[]) || ['iOS'];
      const includeTestFlight = (args.includeTestFlight as boolean) || false;
      let outputPath = (args.outputPath as string) || '.github/workflows/build.yml';

      if (!scheme || typeof scheme !== 'string') {
        return {
          success: false,
          error: 'scheme must be a non-empty string',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Generating GitHub Actions workflow for scheme: ${scheme}`);

      // Create output directory if needed
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
        logger.info(`Created directory: ${outputDir}`);
      }

      // Generate workflow YAML
      const workflowContent = generateGithubActionsWorkflow(scheme, platforms, includeTestFlight);

      writeFileSync(outputPath, workflowContent, 'utf-8');
      logger.info(`GitHub Actions workflow created at: ${outputPath}`);

      return {
        success: true,
        data: {
          workflowFile: resolve(outputPath),
          scheme,
          platforms,
          includeTestFlight,
          message: 'GitHub Actions workflow generated successfully',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in setup-github-actions:', error);

      return {
        success: false,
        error: `Failed to setup GitHub Actions: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * setup-gitlab-ci tool
 * Generate GitLab CI configuration
 */
const setupGitlabCi: ToolDefinition = {
  name: 'setup-gitlab-ci',
  description: 'Generate GitLab CI configuration file for building and testing Xcode projects on macOS runners.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Xcode project or workspace. If not specified, uses current directory.',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme name. Required for the CI configuration.',
      },
      platforms: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of platforms to build for (e.g., ["iOS", "macOS"]). Defaults to iOS.',
      },
      outputPath: {
        type: 'string',
        description: 'Output path for the CI file. Defaults to .gitlab-ci.yml',
      },
    },
    required: ['scheme'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const scheme = args.scheme as string;
      const projectPath = (args.projectPath as string) || '.';
      const platforms = (args.platforms as string[]) || ['iOS'];
      let outputPath = (args.outputPath as string) || '.gitlab-ci.yml';

      if (!scheme || typeof scheme !== 'string') {
        return {
          success: false,
          error: 'scheme must be a non-empty string',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Generating GitLab CI configuration for scheme: ${scheme}`);

      // Create output directory if needed
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      // Generate GitLab CI YAML
      const ciContent = generateGitlabCiConfig(scheme, platforms);

      writeFileSync(outputPath, ciContent, 'utf-8');
      logger.info(`GitLab CI configuration created at: ${outputPath}`);

      return {
        success: true,
        data: {
          configFile: resolve(outputPath),
          scheme,
          platforms,
          message: 'GitLab CI configuration generated successfully',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in setup-gitlab-ci:', error);

      return {
        success: false,
        error: `Failed to setup GitLab CI: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * setup-fastlane tool
 * Initialize Fastlane configuration
 */
const setupFastlane: ToolDefinition = {
  name: 'setup-fastlane',
  description: 'Initialize Fastlane with configuration files. Creates Fastfile with test, beta, and release lanes, and Appfile with app configuration.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Xcode project or workspace. Defaults to current directory.',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme name. Required for Fastlane configuration.',
      },
      bundleId: {
        type: 'string',
        description: 'App bundle ID. Required for Fastlane configuration.',
      },
    },
    required: ['scheme', 'bundleId'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const scheme = args.scheme as string;
      const bundleId = args.bundleId as string;
      const projectPath = (args.projectPath as string) || '.';

      if (!scheme || typeof scheme !== 'string') {
        return {
          success: false,
          error: 'scheme must be a non-empty string',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      if (!bundleId || typeof bundleId !== 'string') {
        return {
          success: false,
          error: 'bundleId must be a non-empty string',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Initializing Fastlane for scheme: ${scheme}, bundleId: ${bundleId}`);

      const fastlaneDir = join(projectPath, 'fastlane');

      // Create fastlane directory if needed
      if (!existsSync(fastlaneDir)) {
        mkdirSync(fastlaneDir, { recursive: true });
        logger.info(`Created fastlane directory: ${fastlaneDir}`);
      }

      // Create Appfile
      const appfilePath = join(fastlaneDir, 'Appfile');
      const appfileContent = generateAppfile(bundleId);
      writeFileSync(appfilePath, appfileContent, 'utf-8');
      logger.info(`Appfile created at: ${appfilePath}`);

      // Create Fastfile
      const fastfilePath = join(fastlaneDir, 'Fastfile');
      const fastfileContent = generateFastfile(scheme, bundleId);
      writeFileSync(fastfilePath, fastfileContent, 'utf-8');
      logger.info(`Fastfile created at: ${fastfilePath}`);

      return {
        success: true,
        data: {
          fastlaneDir: resolve(fastlaneDir),
          appfile: resolve(appfilePath),
          fastfile: resolve(fastfilePath),
          scheme,
          bundleId,
          message: 'Fastlane configuration initialized successfully',
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in setup-fastlane:', error);

      return {
        success: false,
        error: `Failed to setup Fastlane: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * validate-ci-config tool
 * Validate CI configuration files
 */
const validateCiConfig: ToolDefinition = {
  name: 'validate-ci-config',
  description: 'Validate CI configuration files (YAML). Performs basic YAML structure validation and checks for common issues.',
  inputSchema: {
    type: 'object',
    properties: {
      configFile: {
        type: 'string',
        description: 'Path to the CI configuration file to validate',
      },
    },
    required: ['configFile'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const configFile = args.configFile as string;

      if (!configFile || typeof configFile !== 'string') {
        return {
          success: false,
          error: 'configFile must be a non-empty string',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Validating CI config: ${configFile}`);

      if (!existsSync(configFile)) {
        return {
          success: false,
          error: `Configuration file not found: ${configFile}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      const content = readFileSync(configFile, 'utf-8');

      // Perform validation
      const issues: string[] = [];
      const warnings: string[] = [];

      // Basic YAML structure checks
      const lines = content.split('\n');

      // Check for basic YAML structure
      let isValidYaml = true;
      let bracketBalance = 0;
      let braceBalance = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for tab indentation (YAML prefers spaces)
        if (line.includes('\t')) {
          warnings.push(`Line ${i + 1}: Contains tabs, YAML prefers spaces for indentation`);
        }

        // Count brackets and braces
        bracketBalance += (line.match(/\[/g) || []).length - (line.match(/\]/g) || []).length;
        braceBalance += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

        // Check for required CI elements
        if (configFile.includes('github')) {
          if (i === 0 && !line.includes('name:')) {
            warnings.push('GitHub Actions workflow should have a name field');
          }
        }

        if (configFile.includes('gitlab')) {
          if (!content.includes('stages:')) {
            issues.push('GitLab CI should define stages');
          }
        }
      }

      // Check bracket/brace balance
      if (bracketBalance !== 0) {
        issues.push('Unbalanced brackets in configuration');
      }
      if (braceBalance !== 0) {
        issues.push('Unbalanced braces in configuration');
      }

      // Check for common issues
      if (!content.includes('checkout') && !content.includes('fetch-depth')) {
        warnings.push('Configuration might be missing repository checkout step');
      }

      if (content.includes('TODO') || content.includes('FIXME')) {
        warnings.push('Configuration contains TODO/FIXME comments');
      }

      const isValid = issues.length === 0;

      return {
        success: isValid,
        data: {
          configFile: resolve(configFile),
          isValid,
          lineCount: lines.length,
          issues: issues.length > 0 ? issues : undefined,
          warnings: warnings.length > 0 ? warnings : undefined,
          summary: {
            totalIssues: issues.length,
            totalWarnings: warnings.length,
          },
        },
        warnings: warnings.length > 0 ? warnings : undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in validate-ci-config:', error);

      return {
        success: false,
        error: `Failed to validate CI config: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Helper: Generate GitHub Actions workflow content
 */
function generateGithubActionsWorkflow(scheme: string, platforms: string[], includeTestFlight: boolean): string {
  const matrixPlatforms = platforms.map(p => `"${p}"`).join(', ');

  let workflowContent = `name: Build and Test

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  build:
    runs-on: macos-latest
    strategy:
      matrix:
        platform: [${matrixPlatforms}]

    steps:
    - uses: actions/checkout@v4

    - name: Setup Xcode
      uses: maxim-lobanov/setup-xcode@v1
      with:
        xcode-version: latest-stable

    - name: Build for \${{ matrix.platform }}
      run: |
        xcodebuild clean build \\
          -scheme "${scheme}" \\
          -configuration Release \\
          -sdk iphoneos \\
          SYMROOT=build

    - name: Run Tests
      run: |
        xcodebuild test \\
          -scheme "${scheme}" \\
          -configuration Debug \\
          -sdk iphonesimulator \\
          -destination "platform=iOS Simulator,name=iPhone 15"
`;

  if (includeTestFlight) {
    workflowContent += `
  deploy:
    needs: build
    runs-on: macos-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'

    steps:
    - uses: actions/checkout@v4

    - name: Setup Xcode
      uses: maxim-lobanov/setup-xcode@v1
      with:
        xcode-version: latest-stable

    - name: Build Archive
      run: |
        xcodebuild archive \\
          -scheme "${scheme}" \\
          -configuration Release \\
          -archivePath build/\${scheme}.xcarchive

    - name: Export IPA
      run: |
        xcodebuild -exportArchive \\
          -archivePath build/\${scheme}.xcarchive \\
          -exportPath build/ipa \\
          -exportOptionsPlist ExportOptions.plist

    - name: Upload to TestFlight
      uses: apple-actions/upload-testflight-build@v1
      with:
        app-path: 'build/ipa/\${scheme}.ipa'
        issuer-id: \${{ secrets.APP_STORE_ISSUER_ID }}
        api-key-id: \${{ secrets.APP_STORE_API_KEY_ID }}
        api-private-key: \${{ secrets.APP_STORE_API_PRIVATE_KEY }}
`;
  }

  return workflowContent;
}

/**
 * Helper: Generate GitLab CI configuration
 */
function generateGitlabCiConfig(scheme: string, platforms: string[]): string {
  return `image: macos-latest

stages:
  - build
  - test
  - deploy

variables:
  SCHEME: "${scheme}"

before_script:
  - xcode-select --install || true
  - xcode-select --switch /Applications/Xcode.app/Contents/Developer

build:
  stage: build
  script:
    - xcodebuild clean build -scheme $SCHEME -configuration Release
  artifacts:
    paths:
      - build/
    expire_in: 1 day
  only:
    - main
    - develop

test:
  stage: test
  script:
    - xcodebuild test -scheme $SCHEME -configuration Debug -destination "platform=iOS Simulator,name=iPhone 15"
  dependencies:
    - build
  only:
    - main
    - develop
    - merge_requests

deploy:
  stage: deploy
  script:
    - echo "Deploying to App Store Connect..."
    - xcodebuild archive -scheme $SCHEME -configuration Release -archivePath build/\${SCHEME}.xcarchive
    - xcodebuild -exportArchive -archivePath build/\${SCHEME}.xcarchive -exportPath build/ipa -exportOptionsPlist ExportOptions.plist
  dependencies:
    - test
  only:
    - main
`;
}

/**
 * Helper: Generate Appfile content
 */
function generateAppfile(bundleId: string): string {
  return `app_identifier("${bundleId}")
apple_id("YOUR_APPLE_ID@example.com")
team_id("YOUR_TEAM_ID")
team_name("YOUR_TEAM_NAME")

# For Fastlane Live
# itc_team_id("YOUR_ITC_TEAM_ID")
`;
}

/**
 * Helper: Generate Fastfile content
 */
function generateFastfile(scheme: string, bundleId: string): string {
  return `default_platform(:ios)

platform :ios do
  desc "Run tests"
  lane :test do
    build_app(
      workspace: ".",
      scheme: "${scheme}",
      configuration: "Debug",
      derived_data_path: "build",
      destination: "generic/platform=iOS Simulator",
      build_for_testing: true,
      sdk: "iphonesimulator"
    )

    run_tests(
      workspace: ".",
      scheme: "${scheme}",
      destination: "generic/platform=iOS Simulator"
    )
  end

  desc "Build beta version and upload to TestFlight"
  lane :beta do
    setup_ci if is_ci

    build_app(
      workspace: ".",
      scheme: "${scheme}",
      configuration: "Release",
      archive_path: "build/\${scheme}.xcarchive",
      derived_data_path: "build",
      destination: "generic/platform=iOS",
      export_method: "app-store",
      export_xcargs: "-allowProvisioningUpdates"
    )

    upload_to_testflight(
      app_identifier: "${bundleId}",
      skip_waiting_for_build_processing: true
    )
  end

  desc "Build release version"
  lane :release do
    setup_ci if is_ci

    build_app(
      workspace: ".",
      scheme: "${scheme}",
      configuration: "Release",
      archive_path: "build/\${scheme}.xcarchive",
      derived_data_path: "build",
      destination: "generic/platform=iOS",
      export_method: "app-store",
      export_xcargs: "-allowProvisioningUpdates"
    )

    upload_to_app_store(
      app_identifier: "${bundleId}",
      skip_waiting_for_build_processing: true,
      force: true
    )
  end
end
`;
}

/**
 * Export all CI/CD tools
 */
export const cicdTools: ToolDefinition[] = [
  setupGithubActions,
  setupGitlabCi,
  setupFastlane,
  validateCiConfig,
];

export default cicdTools;
