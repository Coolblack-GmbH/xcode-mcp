import { ToolResult, ToolHandler, Platform, Language } from '../types.js';
import { execCommand, execXcode } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { findProjectPath, getXcodePath, registerProject, ensureSafeProjectPath, DEFAULT_PROJECTS_DIR } from '../utils/paths.js';
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';

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
 * Create-project tool
 * Create a new Xcode project using XcodeGen
 */
const createProject: ToolDefinition = {
  name: 'create-project',
  description: 'Create a new Xcode project with specified configuration. Uses XcodeGen to generate the project structure with initial Swift/SwiftUI files.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Project name',
      },
      platform: {
        type: 'string',
        enum: ['iOS', 'macOS', 'watchOS', 'tvOS', 'visionOS'],
        description: 'Target platform',
      },
      language: {
        type: 'string',
        enum: ['swift', 'objc', 'swiftui'],
        description: 'Programming language',
      },
      bundleId: {
        type: 'string',
        description: 'Bundle identifier (e.g., com.company.app)',
      },
      organizationName: {
        type: 'string',
        description: 'Organization name for copyright notice',
      },
      outputPath: {
        type: 'string',
        description: `Directory to create project in. Defaults to ~/Developer/. Paths in /tmp are automatically redirected to ~/Developer/ to prevent data loss on reboot.`,
      },
    },
    required: ['name', 'platform', 'language', 'bundleId'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const name = args.name as string;
      const platform = args.platform as Platform;
      const language = args.language as Language;
      const bundleId = args.bundleId as string;
      const organizationName = (args.organizationName as string) || 'coolblack';
      const rawOutputPath = (args.outputPath as string) || DEFAULT_PROJECTS_DIR;

      logger.info(`Creating project: ${name} for ${platform}`);

      // Ensure the project path is safe (not in /tmp or other volatile directories)
      const { path: safeOutputPath, wasRedirected, warning } = ensureSafeProjectPath(rawOutputPath, name);

      // Ensure output directory exists
      const projectDir = resolve(safeOutputPath, safeOutputPath.endsWith(name) ? '' : name);
      if (!existsSync(projectDir)) {
        mkdirSync(projectDir, { recursive: true });
      }

      // Create project.yml for XcodeGen
      const projectYml = generateProjectYml(name, platform, language, bundleId, organizationName);
      const projectYmlPath = join(projectDir, 'project.yml');

      writeFileSync(projectYmlPath, projectYml);
      logger.info(`Created project.yml at ${projectYmlPath}`);

      // Create source directory structure
      const srcDir = join(projectDir, name);
      mkdirSync(srcDir, { recursive: true });

      // Create initial Swift files based on language
      if (language === 'swiftui') {
        createSwiftUIProject(srcDir, name);
      } else if (language === 'swift') {
        createSwiftProject(srcDir, name);
      } else if (language === 'objc') {
        createObjCProject(srcDir, name);
      }

      logger.info(`Created source files in ${srcDir}`);

      // Generate project using XcodeGen
      logger.info(`Running XcodeGen in ${projectDir}`);
      const generateResult = await execCommand('xcodegen', ['generate', '--spec', projectYmlPath], {
        cwd: projectDir,
      });

      if (generateResult.exitCode !== 0) {
        logger.error('XcodeGen generation failed:', generateResult.stderr);
        return {
          success: false,
          error: `XcodeGen generation failed: ${generateResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Project created successfully at ${projectDir}`);

      // Register project in the project registry
      const projectFile = join(projectDir, `${name}.xcodeproj`);
      registerProject(name, {
        path: projectDir,
        projectFile,
        bundleId,
        platform,
        scheme: name,
      });

      return {
        success: true,
        data: {
          projectPath: projectDir,
          name,
          platform,
          language,
          bundleId,
          sourceDir: srcDir,
          projectYmlPath,
          message: `Project '${name}' created successfully`,
          ...(wasRedirected ? { warning, redirectedFrom: rawOutputPath } : {}),
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in create-project:', error);

      return {
        success: false,
        error: `Failed to create project: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Get-project-info tool
 * Get project metadata and build information
 */
const getProjectInfo: ToolDefinition = {
  name: 'get-project-info',
  description: 'Get project metadata including targets, schemes, configurations, and SDK information.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to .xcodeproj or .xcworkspace. Defaults to auto-detected project.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      let projectPath = args.projectPath as string | undefined;

      // Auto-detect project if not provided
      if (!projectPath) {
        const detected = await findProjectPath();
        if (!detected) {
          return {
            success: false,
            error: 'No Xcode project found. Please specify projectPath.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
        projectPath = detected;
      }

      logger.info(`Getting project info for: ${projectPath}`);

      // Get list of schemes and targets
      const projectType = projectPath.endsWith('.xcworkspace') ? 'workspace' : 'project';
      const listResult = await execXcode('xcodebuild', [
        `-${projectType}`,
        projectPath,
        '-list',
      ]);

      if (listResult.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to list project contents: ${listResult.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Get build settings
      const settingsResult = await execXcode('xcodebuild', [
        `-${projectType}`,
        projectPath,
        '-showBuildSettings',
      ]);

      const projectInfo = {
        projectPath,
        projectType,
        listOutput: listResult.stdout,
        buildSettings: parseBuildSettings(settingsResult.stdout),
      };

      logger.info(`Retrieved project info for ${projectPath}`);

      return {
        success: true,
        data: projectInfo,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in get-project-info:', error);

      return {
        success: false,
        error: `Failed to get project info: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * List-schemes tool
 * List all build schemes in the project
 */
const listSchemes: ToolDefinition = {
  name: 'list-schemes',
  description: 'List all available build schemes in the Xcode project.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to .xcodeproj or .xcworkspace. Defaults to auto-detected project.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      let projectPath = args.projectPath as string | undefined;

      // Auto-detect project if not provided
      if (!projectPath) {
        const detected = await findProjectPath();
        if (!detected) {
          return {
            success: false,
            error: 'No Xcode project found. Please specify projectPath.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
        projectPath = detected;
      }

      logger.info(`Listing schemes for: ${projectPath}`);

      const projectType = projectPath.endsWith('.xcworkspace') ? 'workspace' : 'project';
      const result = await execXcode('xcodebuild', [
        `-${projectType}`,
        projectPath,
        '-list',
        '-json',
      ]);

      if (result.exitCode !== 0) {
        logger.error('Failed to list schemes:', result.stderr);
        return {
          success: false,
          error: `Failed to list schemes: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      try {
        const parsedData = JSON.parse(result.stdout);
        const schemes = parsedData.project?.schemes || parsedData.workspace?.schemes || [];

        logger.info(`Found ${schemes.length} schemes`);

        return {
          success: true,
          data: {
            projectPath,
            schemes,
            count: schemes.length,
          },
          executionTime: Date.now() - startTime,
        };
      } catch (parseError) {
        logger.error('Failed to parse schemes JSON:', parseError);
        return {
          success: false,
          error: 'Failed to parse project schemes',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in list-schemes:', error);

      return {
        success: false,
        error: `Failed to list schemes: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Modify-project tool
 * Modify build settings for a project or target
 */
const modifyProject: ToolDefinition = {
  name: 'modify-project',
  description: 'Modify build settings for a project or specific target. Allows setting build configuration values.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to .xcodeproj or .xcworkspace. Defaults to auto-detected project.',
      },
      setting: {
        type: 'string',
        description: 'Build setting name to modify (e.g., IPHONEOS_DEPLOYMENT_TARGET)',
      },
      value: {
        type: 'string',
        description: 'Value to set for the build setting',
      },
      target: {
        type: 'string',
        description: 'Optional target name. If not specified, applies to all targets.',
      },
    },
    required: ['setting', 'value'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      let projectPath = args.projectPath as string | undefined;
      const setting = args.setting as string;
      const value = args.value as string;
      const target = args.target as string | undefined;

      // Auto-detect project if not provided
      if (!projectPath) {
        const detected = await findProjectPath();
        if (!detected) {
          return {
            success: false,
            error: 'No Xcode project found. Please specify projectPath.',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
        projectPath = detected;
      }

      logger.info(`Modifying project ${projectPath}: setting ${setting}=${value}`);

      const projectType = projectPath.endsWith('.xcworkspace') ? 'workspace' : 'project';
      const buildArgs = [
        `-${projectType}`,
        projectPath,
        ...(target ? ['-target', target] : []),
        `${setting}=${value}`,
      ];

      const result = await execXcode('xcodebuild', buildArgs);

      if (result.exitCode !== 0) {
        logger.error('Failed to modify project settings:', result.stderr);
        return {
          success: false,
          error: `Failed to modify project: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Successfully modified ${setting} to ${value}`);

      return {
        success: true,
        data: {
          projectPath,
          setting,
          value,
          target: target || 'all',
          message: `Successfully set ${setting}=${value}`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in modify-project:', error);

      return {
        success: false,
        error: `Failed to modify project: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Generate-from-yaml tool
 * Generate an Xcode project from an XcodeGen YAML specification
 */
const generateFromYaml: ToolDefinition = {
  name: 'generate-from-yaml',
  description: 'Generate an Xcode project from an XcodeGen YAML specification file.',
  inputSchema: {
    type: 'object',
    properties: {
      specPath: {
        type: 'string',
        description: 'Path to the XcodeGen project.yml specification file',
      },
      projectPath: {
        type: 'string',
        description: 'Optional output directory for generated project. Defaults to spec directory.',
      },
    },
    required: ['specPath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const specPath = args.specPath as string;
      const projectPath = args.projectPath as string | undefined;

      logger.info(`Generating project from spec: ${specPath}`);

      // Determine working directory
      const workingDir = projectPath || dirname(specPath);

      // Run xcodegen generate
      const result = await execCommand('xcodegen', ['generate', '--spec', specPath], {
        cwd: workingDir,
      });

      if (result.exitCode !== 0) {
        logger.error('XcodeGen generation failed:', result.stderr);
        return {
          success: false,
          error: `XcodeGen generation failed: ${result.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Project generated successfully from ${specPath}`);

      return {
        success: true,
        data: {
          specPath,
          workingDir,
          message: 'Project generated successfully from YAML specification',
          output: result.stdout,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in generate-from-yaml:', error);

      return {
        success: false,
        error: `Failed to generate project from YAML: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Helper function to parse build settings from xcodebuild output
 */
function parseBuildSettings(output: string): Record<string, string> {
  const settings: Record<string, string> = {};
  const lines = output.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      settings[key.trim()] = value.trim();
    }
  }

  return settings;
}

/**
 * Helper function to generate project.yml for XcodeGen
 */
function generateProjectYml(
  name: string,
  platform: Platform,
  language: Language,
  bundleId: string,
  organizationName: string,
): string {
  const platformMap: Record<Platform, string> = {
    iOS: 'iOS',
    macOS: 'macOS',
    watchOS: 'watchOS',
    tvOS: 'tvOS',
    visionOS: 'visionOS',
  };

  const minDeploymentTargets: Record<Platform, string> = {
    iOS: '16.0',
    macOS: '13.0',
    watchOS: '9.0',
    tvOS: '16.0',
    visionOS: '1.0',
  };

  const deploymentTarget = minDeploymentTargets[platform];
  const platformYaml = platformMap[platform];

  // Map platform to supportedDestinations format
  const destinationMap: Record<Platform, string> = {
    iOS: 'iOS',
    macOS: 'macOS',
    watchOS: 'watchOS',
    tvOS: 'tvOS',
    visionOS: 'visionOS',
  };

  const destination = destinationMap[platform];

  // Platform-specific Info.plist properties
  const infoPlistProps = platform === 'iOS' ? `
      UILaunchScreen: {}
      UISupportedInterfaceOrientations:
        - UIInterfaceOrientationPortrait
        - UIInterfaceOrientationLandscapeLeft
        - UIInterfaceOrientationLandscapeRight
      UISupportedInterfaceOrientations~ipad:
        - UIInterfaceOrientationPortrait
        - UIInterfaceOrientationPortraitUpsideDown
        - UIInterfaceOrientationLandscapeLeft
        - UIInterfaceOrientationLandscapeRight
      UIApplicationSupportsIndirectInputEvents: true
      UIApplicationSceneManifest:
        UIApplicationSupportsMultipleScenes: false
        UISceneConfigurations: {}` : '';

  return `name: ${name}
options:
  bundleIdPrefix: ${bundleId.substring(0, bundleId.lastIndexOf('.'))}
  organizationName: ${organizationName}
  deploymentTarget:
    ${platformYaml}: "${deploymentTarget}"
  generateEmptyDirectories: true

settings:
  base:
    SWIFT_VERSION: "5.9"

targets:
  ${name}:
    type: application
    supportedDestinations: [${destination}]
    deploymentTarget:
      ${platformYaml}: "${deploymentTarget}"
    sources:
      - ${name}
    settings:
      PRODUCT_NAME: ${name}
      PRODUCT_BUNDLE_IDENTIFIER: ${bundleId}
    info:
      path: ${name}/Info.plist
      properties:
        CFBundleName: ${name}
        CFBundleDisplayName: ${name}
        CFBundleShortVersionString: "1.0"
        CFBundleVersion: "1"${infoPlistProps}
    scheme:
      testTargets: []
      gatherCoverageData: false
`;
}

/**
 * Helper function to create SwiftUI project files
 */
function createSwiftUIProject(srcDir: string, projectName: string): void {
  const mainSwiftUI = `import SwiftUI

@main
struct ${projectName}App: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`;

  const contentView = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            Image(systemName: "globe")
                .imageScale(.large)
                .foregroundStyle(.tint)
            Text("Hello, World!")
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
`;

  writeFileSync(join(srcDir, `${projectName}App.swift`), mainSwiftUI);
  writeFileSync(join(srcDir, 'ContentView.swift'), contentView);

  logger.debug(`Created SwiftUI files for ${projectName}`);
}

/**
 * Helper function to create Swift project files
 */
function createSwiftProject(srcDir: string, projectName: string): void {
  const mainSwift = `import Foundation

@main
class ${projectName}App {
    static func main() {
        print("Hello from ${projectName}!")
    }
}
`;

  writeFileSync(join(srcDir, 'main.swift'), mainSwift);

  logger.debug(`Created Swift files for ${projectName}`);
}

/**
 * Helper function to create Objective-C project files
 */
function createObjCProject(srcDir: string, projectName: string): void {
  const main = `#import <Foundation/Foundation.h>

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSLog(@"Hello from ${projectName}!");
    }
    return 0;
}
`;

  writeFileSync(join(srcDir, 'main.m'), main);

  logger.debug(`Created Objective-C files for ${projectName}`);
}

/**
 * add-target — Add a new target (Widget, Watch, App Clip, etc.) via XcodeGen
 */
const addTarget: ToolDefinition = {
  name: 'add-target',
  description: 'Add a new target (Widget Extension, Watch App, App Clip, etc.) to an existing project via XcodeGen YAML modification and regeneration.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: { type: 'string', description: 'Path to the project directory containing project.yml' },
      targetName: { type: 'string', description: 'Name of the new target' },
      targetType: {
        type: 'string',
        enum: ['widget-extension', 'watch-app', 'app-clip', 'framework', 'test', 'intent-extension', 'notification-extension'],
        description: 'Type of target to add',
      },
      bundleId: { type: 'string', description: 'Bundle ID for the new target' },
      platform: { type: 'string', enum: ['iOS', 'macOS', 'watchOS', 'tvOS', 'visionOS'], description: 'Target platform (default: iOS)' },
    },
    required: ['projectPath', 'targetName', 'targetType', 'bundleId'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const projectPath = args.projectPath as string;
      const targetName = args.targetName as string;
      const targetType = args.targetType as string;
      const bundleId = args.bundleId as string;
      const platform = (args.platform as string) || 'iOS';
      const projectYmlPath = join(projectPath, 'project.yml');

      if (!existsSync(projectYmlPath)) {
        return { success: false, error: `project.yml nicht gefunden in ${projectPath}`, data: null, executionTime: Date.now() - startTime };
      }

      logger.info(`Adding target ${targetName} (${targetType}) to ${projectPath}`);

      const existingYml = readFileSync(projectYmlPath, 'utf-8');
      const typeMap: Record<string, { type: string; sdk?: string }> = {
        'widget-extension': { type: 'app-extension' }, 'watch-app': { type: 'application', sdk: 'watchOS' },
        'app-clip': { type: 'application' }, 'framework': { type: 'framework' }, 'test': { type: 'bundle.unit-test' },
        'intent-extension': { type: 'app-extension' }, 'notification-extension': { type: 'app-extension' },
      };
      const targetConfig = typeMap[targetType] || { type: 'app-extension' };

      const targetSrcDir = join(projectPath, targetName);
      if (!existsSync(targetSrcDir)) { mkdirSync(targetSrcDir, { recursive: true }); }
      writeFileSync(join(targetSrcDir, `${targetName}.swift`), `import Foundation\n\n// ${targetName} target\n`);

      const targetYml = `\n  ${targetName}:\n    type: ${targetConfig.type}\n    supportedDestinations: [${targetConfig.sdk || platform}]\n    sources:\n      - ${targetName}\n    settings:\n      PRODUCT_NAME: ${targetName}\n      PRODUCT_BUNDLE_IDENTIFIER: ${bundleId}\n    info:\n      path: ${targetName}/Info.plist\n      properties:\n        CFBundleName: ${targetName}\n        CFBundleDisplayName: ${targetName}\n        CFBundleShortVersionString: "1.0"\n        CFBundleVersion: "1"\n`;
      writeFileSync(projectYmlPath, existingYml + targetYml);

      const genResult = await execCommand('xcodegen', ['generate', '--spec', projectYmlPath], { cwd: projectPath });
      if (genResult.exitCode !== 0) {
        return { success: false, error: `XcodeGen-Regenerierung fehlgeschlagen: ${genResult.stderr}`, data: null, executionTime: Date.now() - startTime };
      }

      return { success: true, data: { targetName, targetType, bundleId, platform: targetConfig.sdk || platform, sourceDir: targetSrcDir, message: `Target "${targetName}" erfolgreich hinzugefuegt` }, executionTime: Date.now() - startTime };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in add-target:', error);
      return { success: false, error: `Fehler beim Hinzufuegen des Targets: ${errorMsg}`, data: null, executionTime: Date.now() - startTime };
    }
  },
};

/**
 * manage-scheme — List, create, or delete shared schemes
 */
const manageScheme: ToolDefinition = {
  name: 'manage-scheme',
  description: 'List, create, or delete shared Xcode schemes in xcshareddata/xcschemes/.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: { type: 'string', description: 'Path to .xcodeproj directory' },
      action: { type: 'string', enum: ['list', 'create', 'delete', 'show'], description: 'Action to perform' },
      schemeName: { type: 'string', description: 'Name of the scheme (for create/delete/show)' },
      targetName: { type: 'string', description: 'Target to associate with the scheme (for create action)' },
    },
    required: ['projectPath', 'action'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const projectPath = args.projectPath as string;
      const action = args.action as string;
      const schemeName = args.schemeName as string | undefined;
      const targetName = args.targetName as string | undefined;
      const schemesDir = join(projectPath, 'xcshareddata', 'xcschemes');

      if (action === 'list') {
        if (!existsSync(schemesDir)) {
          return { success: true, data: { schemes: [], count: 0 }, executionTime: Date.now() - startTime };
        }
        const schemes = readdirSync(schemesDir).filter((f) => f.endsWith('.xcscheme')).map((f) => f.replace('.xcscheme', ''));
        return { success: true, data: { schemes, count: schemes.length, schemesDir }, executionTime: Date.now() - startTime };
      }

      if (!schemeName) {
        return { success: false, error: 'schemeName ist erforderlich', data: null, executionTime: Date.now() - startTime };
      }
      const schemeFile = join(schemesDir, `${schemeName}.xcscheme`);

      if (action === 'show') {
        if (!existsSync(schemeFile)) return { success: false, error: `Scheme "${schemeName}" nicht gefunden`, data: null, executionTime: Date.now() - startTime };
        return { success: true, data: { schemeName, content: readFileSync(schemeFile, 'utf-8') }, executionTime: Date.now() - startTime };
      }

      if (action === 'delete') {
        if (!existsSync(schemeFile)) return { success: false, error: `Scheme "${schemeName}" nicht gefunden`, data: null, executionTime: Date.now() - startTime };
        unlinkSync(schemeFile);
        return { success: true, data: { schemeName, message: `Scheme "${schemeName}" geloescht` }, executionTime: Date.now() - startTime };
      }

      if (action === 'create') {
        const target = targetName || schemeName;
        if (!existsSync(schemesDir)) mkdirSync(schemesDir, { recursive: true });
        const schemeXml = `<?xml version="1.0" encoding="UTF-8"?>\n<Scheme LastUpgradeVersion="1500" version="1.7">\n   <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES">\n      <BuildActionEntries>\n         <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">\n            <BuildableReference BuildableIdentifier="primary" BlueprintName="${target}" ReferencedContainer="container:${basename(projectPath)}" />\n         </BuildActionEntry>\n      </BuildActionEntries>\n   </BuildAction>\n   <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES" />\n   <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES" />\n   <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES" />\n   <AnalyzeAction buildConfiguration="Debug" />\n   <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES" />\n</Scheme>`;
        writeFileSync(schemeFile, schemeXml);
        return { success: true, data: { schemeName, targetName: target, path: schemeFile, message: `Scheme "${schemeName}" erstellt` }, executionTime: Date.now() - startTime };
      }

      return { success: false, error: `Unbekannte Aktion: ${action}`, data: null, executionTime: Date.now() - startTime };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in manage-scheme:', error);
      return { success: false, error: `Fehler bei Scheme-Operation: ${errorMsg}`, data: null, executionTime: Date.now() - startTime };
    }
  },
};

/**
 * Export all project tools
 */
export const tools: ToolDefinition[] = [
  createProject,
  getProjectInfo,
  listSchemes,
  modifyProject,
  generateFromYaml,
  addTarget,
  manageScheme,
];

export default tools;
