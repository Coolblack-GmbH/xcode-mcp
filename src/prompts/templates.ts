import { TextContent } from '@modelcontextprotocol/sdk/types.js';

/**
 * Prompt template definition
 */
export interface PromptTemplate {
  name: string;
  description: string;
  arguments: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
  getMessages: (args: Record<string, string>) => Array<{
    role: 'user' | 'assistant';
    content: TextContent;
  }>;
}

/**
 * Available prompt templates for Xcode workflows
 */
export const promptTemplates: PromptTemplate[] = [
  {
    name: 'create-ios-app',
    description: 'Step-by-step guide to create a new iOS app',
    arguments: [
      {
        name: 'appName',
        description: 'Name of the app to create',
        required: true,
      },
      {
        name: 'bundleId',
        description: 'Bundle identifier (e.g., com.company.app)',
        required: true,
      },
      {
        name: 'language',
        description: 'Programming language: swift, swiftui, or objc',
        required: false,
      },
    ],
    getMessages: (args: Record<string, string>) => [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Create a new iOS app called "${args.appName}" with bundle ID "${args.bundleId}" using ${args.language || 'swiftui'}. Use the create-project tool to set up the project, then verify it builds successfully with the build-project tool.`,
        },
      },
    ],
  },
  {
    name: 'fix-build-errors',
    description: 'Diagnose and fix Xcode build errors',
    arguments: [
      {
        name: 'errorMessage',
        description: 'The build error message (optional)',
        required: false,
      },
    ],
    getMessages: (args: Record<string, string>) => [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `I'm getting build errors in my Xcode project. ${args.errorMessage ? `The error is: "${args.errorMessage}". ` : ''}Please use the parse-build-logs tool to analyze the errors, then use the suggest-build-fixes tool for each error. Finally, help me fix the issues.`,
        },
      },
    ],
  },
  {
    name: 'prepare-app-store',
    description: 'Prepare app for App Store submission',
    arguments: [
      {
        name: 'version',
        description: 'App version number',
        required: true,
      },
    ],
    getMessages: (args: Record<string, string>) => [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Prepare my app version ${args.version} for App Store submission. Steps: 1) verify the environment is properly configured, 2) list certificates to verify code signing is set up, 3) build with Release configuration, 4) archive the project, 5) export the IPA for app-store distribution. Guide me through each step.`,
        },
      },
    ],
  },
  {
    name: 'setup-ci-cd',
    description: 'Set up CI/CD pipeline for Xcode project',
    arguments: [
      {
        name: 'platform',
        description: 'CI platform: github or gitlab',
        required: true,
      },
      {
        name: 'includeTestFlight',
        description: 'Include TestFlight deployment (true/false)',
        required: false,
      },
    ],
    getMessages: (args: Record<string, string>) => [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Set up a ${args.platform} CI/CD pipeline for my Xcode project${args.includeTestFlight === 'true' ? ' with TestFlight deployment' : ''}. Use the appropriate setup tool (setup-github-actions or setup-gitlab-ci) and validate the generated configuration files.`,
        },
      },
    ],
  },
  {
    name: 'optimize-performance',
    description: 'Analyze and optimize app performance',
    arguments: [
      {
        name: 'focusArea',
        description: 'Focus area: memory, cpu, startup-time, or battery',
        required: false,
      },
    ],
    getMessages: (args: Record<string, string>) => [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me optimize my app's performance${args.focusArea ? ` focusing on ${args.focusArea}` : ''}. Profile the app using Instruments to identify bottlenecks, then provide recommendations for improvement and help implement the optimizations.`,
        },
      },
    ],
  },
  {
    name: 'add-unit-tests',
    description: 'Add and configure unit testing in Xcode project',
    arguments: [
      {
        name: 'framework',
        description: 'Testing framework: xctest or quick (default: xctest)',
        required: false,
      },
    ],
    getMessages: (args: Record<string, string>) => [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Help me add unit tests to my Xcode project using ${args.framework || 'XCTest'}. Create a test target, set up the testing environment, write example tests for the main components, and configure test coverage reporting.`,
        },
      },
    ],
  },
];
