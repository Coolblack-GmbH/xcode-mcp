import { ToolResult, ToolHandler, TestSummary, TestResult, CoverageFormat } from '../types.js';
import { execXcode, execCommand, ExecResult, checkXcodebuild } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { parseXcodeBuildErrors, formatErrors } from '../utils/errors.js';
import { findProjectPath } from '../utils/paths.js';
import { existsSync } from 'fs';
import { join } from 'path';

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
 * Run-tests tool
 * Run unit and integration tests
 */
const runTests: ToolDefinition = {
  name: 'run-tests',
  description: 'Run unit and integration tests on specified destination. Parses test results and returns summary with pass/fail/skip counts.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Optional path to .xcodeproj or .xcworkspace.',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme to test. Optional.',
      },
      configuration: {
        type: 'string',
        description: 'Build configuration (Debug/Release). Defaults to Debug.',
      },
      simulator: {
        type: 'string',
        description: 'Simulator name for running tests. Defaults to first available iOS simulator.',
      },
      testPlan: {
        type: 'string',
        description: 'Specific test plan to run. Optional.',
      },
      filter: {
        type: 'string',
        description: 'Filter tests by name pattern. Optional.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      // Check if xcodebuild is functional
      const xcodeError = await checkXcodebuild();
      if (xcodeError) {
        return { success: false, error: xcodeError, data: null, executionTime: Date.now() - startTime };
      }

      let projectPath = args.projectPath as string | undefined;
      const scheme = args.scheme as string | undefined;
      const configuration = (args.configuration as string) || 'Debug';
      let simulator = args.simulator as string | undefined;
      const testPlan = args.testPlan as string | undefined;
      const filter = args.filter as string | undefined;

      // Find project if not provided
      if (!projectPath) {
        projectPath = await findProjectPath();
        if (!projectPath) {
          return {
            success: false,
            error: 'Could not find .xcodeproj or .xcworkspace in current directory',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
      }

      logger.info(`Running tests for project: ${projectPath}`);

      const isWorkspace = projectPath.endsWith('.xcworkspace');
      const testArgs: string[] = [
        isWorkspace ? '-workspace' : '-project',
        projectPath,
        'test',
        '-configuration',
        configuration,
      ];

      if (scheme) {
        testArgs.push('-scheme', scheme);
      }

      // Set default destination if not provided
      if (!simulator) {
        simulator = 'iPhone 15';
      }

      testArgs.push('-destination', `generic/platform=iOS Simulator,name=${simulator}`);

      if (testPlan) {
        testArgs.push('-testPlan', testPlan);
      }

      if (filter) {
        testArgs.push('-only-testing', filter);
      }

      const testResult = await execXcode('xcodebuild', testArgs);

      // Handle xcodebuild failure (e.g. build errors before tests can run)
      if (testResult.exitCode !== 0) {
        const combinedOutput = testResult.stderr + '\n' + testResult.stdout;
        const buildErrors = parseXcodeBuildErrors(combinedOutput);
        const errorDetail = formatErrors(buildErrors);

        // Check if tests actually ran but some failed
        const testSummary = parseTestOutput(testResult.stdout);
        if (testSummary.totalTests > 0) {
          // Tests ran but some failed - return test results
          return {
            success: false,
            data: {
              projectPath,
              scheme: scheme || 'default',
              configuration,
              simulator,
              testPlan: testPlan || 'default',
              totalTests: testSummary.totalTests,
              passed: testSummary.passed,
              failed: testSummary.failed,
              skipped: testSummary.skipped,
              duration: testResult.duration,
              results: testSummary.results.slice(0, 50),
            },
            warnings: [`${testSummary.failed} test(s) failed`],
            executionTime: Date.now() - startTime,
          };
        }

        // Build failed before tests could run
        const errorMessage = errorDetail
          ? `Test build failed: ${errorDetail}`
          : `Test build failed:\n${combinedOutput.trim().slice(-800)}`;
        return {
          success: false,
          error: errorMessage,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Parse test output for successful run
      const testSummary = parseTestOutput(testResult.stdout);

      logger.info(
        `Tests completed: ${testSummary.passed} passed, ${testSummary.failed} failed, ${testSummary.skipped} skipped`,
      );

      return {
        success: true,
        data: {
          projectPath,
          scheme: scheme || 'default',
          configuration,
          simulator,
          testPlan: testPlan || 'default',
          totalTests: testSummary.totalTests,
          passed: testSummary.passed,
          failed: testSummary.failed,
          skipped: testSummary.skipped,
          duration: testResult.duration,
          results: testSummary.results.slice(0, 50),
        },
        warnings: testSummary.failed > 0 ? [`${testSummary.failed} test(s) failed`] : undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in run-tests:', error);

      return {
        success: false,
        error: `Failed to run tests: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Run-ui-tests tool
 * Run UI tests
 */
const runUITests: ToolDefinition = {
  name: 'run-ui-tests',
  description: 'Run UI tests on specified simulator. Tests must be defined in a UITests target.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Optional path to .xcodeproj or .xcworkspace.',
      },
      scheme: {
        type: 'string',
        description: 'UI test scheme. Required.',
      },
      simulator: {
        type: 'string',
        description: 'Simulator name for running tests. Defaults to iPhone 15.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      // Check if xcodebuild is functional
      const xcodeError = await checkXcodebuild();
      if (xcodeError) {
        return { success: false, error: xcodeError, data: null, executionTime: Date.now() - startTime };
      }

      let projectPath = args.projectPath as string | undefined;
      const scheme = args.scheme as string | undefined;
      let simulator = args.simulator as string | undefined;

      if (!scheme) {
        return {
          success: false,
          error: 'Scheme is required for UI testing',
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Find project if not provided
      if (!projectPath) {
        projectPath = await findProjectPath();
        if (!projectPath) {
          return {
            success: false,
            error: 'Could not find .xcodeproj or .xcworkspace in current directory',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
      }

      logger.info(`Running UI tests: ${scheme}`);

      const isWorkspace = projectPath.endsWith('.xcworkspace');
      simulator = simulator || 'iPhone 15';

      const testArgs: string[] = [
        isWorkspace ? '-workspace' : '-project',
        projectPath,
        '-scheme',
        scheme,
        'test',
        '-configuration',
        'Debug',
        '-destination',
        `generic/platform=iOS Simulator,name=${simulator}`,
      ];

      const testResult = await execXcode('xcodebuild', testArgs);

      // Parse test output
      const testSummary = parseTestOutput(testResult.stdout);

      const success = testResult.exitCode === 0 && testSummary.failed === 0;

      logger.info(
        `UI tests completed: ${testSummary.passed} passed, ${testSummary.failed} failed, ${testSummary.skipped} skipped`,
      );

      return {
        success,
        data: {
          projectPath,
          scheme,
          simulator,
          totalTests: testSummary.totalTests,
          passed: testSummary.passed,
          failed: testSummary.failed,
          skipped: testSummary.skipped,
          duration: testResult.duration,
          results: testSummary.results,
        },
        warnings: testSummary.failed > 0 ? [`${testSummary.failed} UI test(s) failed`] : undefined,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in run-ui-tests:', error);

      return {
        success: false,
        error: `Failed to run UI tests: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Generate-coverage-report tool
 * Generate code coverage report
 */
const generateCoverageReport: ToolDefinition = {
  name: 'generate-coverage-report',
  description: 'Generate code coverage report in specified format (json, lcov, or html) using llvm-cov.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Optional path to .xcodeproj or .xcworkspace.',
      },
      scheme: {
        type: 'string',
        description: 'Build scheme to measure coverage for.',
      },
      outputFormat: {
        type: 'string',
        enum: ['json', 'lcov', 'html'],
        description: 'Output format for coverage report. Defaults to json.',
      },
      outputPath: {
        type: 'string',
        description: 'Output path for coverage report. Defaults to current directory.',
      },
    },
    required: [],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      // Check if xcodebuild is functional
      const xcodeError = await checkXcodebuild();
      if (xcodeError) {
        return { success: false, error: xcodeError, data: null, executionTime: Date.now() - startTime };
      }

      let projectPath = args.projectPath as string | undefined;
      const scheme = args.scheme as string | undefined;
      const outputFormat = (args.outputFormat as CoverageFormat) || 'json';
      let outputPath = args.outputPath as string | undefined;

      // Find project if not provided
      if (!projectPath) {
        projectPath = await findProjectPath();
        if (!projectPath) {
          return {
            success: false,
            error: 'Could not find .xcodeproj or .xcworkspace in current directory',
            data: null,
            executionTime: Date.now() - startTime,
          };
        }
      }

      outputPath = outputPath || process.cwd();

      logger.info(`Generating coverage report for scheme: ${scheme}`);

      const isWorkspace = projectPath.endsWith('.xcworkspace');
      const testArgs: string[] = [
        isWorkspace ? '-workspace' : '-project',
        projectPath,
        'test',
        '-configuration',
        'Debug',
        '-enableCodeCoverage',
        'YES',
      ];

      if (scheme) {
        testArgs.push('-scheme', scheme);
      }

      testArgs.push('-destination', 'generic/platform=iOS Simulator');

      const testResult = await execXcode('xcodebuild', testArgs);

      if (testResult.exitCode !== 0) {
        const errors = parseXcodeBuildErrors(testResult.stderr + '\n' + testResult.stdout);
        return {
          success: false,
          error: `Test run for coverage failed: ${formatErrors(errors)}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Extract profdata path from output
      let profdataPath = '';
      const profdataMatch = testResult.stdout.match(/Profdata path:\s*(.+)/);
      if (profdataMatch) {
        profdataPath = profdataMatch[1].trim();
      }

      // Generate coverage report using llvm-cov
      let reportPath = join(outputPath, `coverage.${outputFormat}`);

      if (profdataPath && existsSync(profdataPath)) {
        logger.info(`Generating ${outputFormat} coverage report`);

        const exportArgs: string[] = ['llvm-cov', 'export', '-format', outputFormat, profdataPath];

        if (outputFormat === 'html') {
          exportArgs.push('-output-dir', reportPath);
          reportPath = join(reportPath, 'index.html');
        }

        const coverageResult = await execCommand('xcrun', exportArgs);

        if (coverageResult.exitCode !== 0) {
          logger.warn(`Coverage report generation had issues: ${coverageResult.stderr}`);
        }
      }

      logger.info(`Coverage report generated: ${reportPath}`);

      return {
        success: true,
        data: {
          projectPath,
          scheme: scheme || 'default',
          format: outputFormat,
          reportPath,
          profdataPath,
          message: `Coverage report generated in ${outputFormat} format`,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in generate-coverage-report:', error);

      return {
        success: false,
        error: `Failed to generate coverage report: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Parse-test-results tool
 * Parse test result bundle from xcodebuild
 */
const parseTestResults: ToolDefinition = {
  name: 'parse-test-results',
  description: 'Parse test result bundle (*.xcresult) and extract structured test results and metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      resultBundlePath: {
        type: 'string',
        description: 'Path to .xcresult bundle directory.',
      },
    },
    required: ['resultBundlePath'],
  },
  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const startTime = Date.now();

    try {
      const resultBundlePath = args.resultBundlePath as string;

      if (!existsSync(resultBundlePath)) {
        return {
          success: false,
          error: `Result bundle not found: ${resultBundlePath}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      logger.info(`Parsing test results from: ${resultBundlePath}`);

      // Use xcresulttool to extract test results
      const getArgs: string[] = [
        'xcresulttool',
        'get',
        '--path',
        resultBundlePath,
        '--format',
        'json',
      ];

      const resultCommand = await execCommand('xcrun', getArgs);

      if (resultCommand.exitCode !== 0) {
        logger.warn(`xcresulttool failed: ${resultCommand.stderr}`);
        return {
          success: false,
          error: `Failed to parse test results: ${resultCommand.stderr}`,
          data: null,
          executionTime: Date.now() - startTime,
        };
      }

      // Parse the JSON output
      let testData: any = {};
      try {
        testData = JSON.parse(resultCommand.stdout);
      } catch (parseError) {
        logger.warn('Failed to parse xcresulttool output as JSON');
      }

      // Extract test summary
      const testSummary = extractTestSummaryFromBundle(testData);

      logger.info(
        `Parsed results: ${testSummary.passed} passed, ${testSummary.failed} failed, ${testSummary.skipped} skipped`,
      );

      return {
        success: true,
        data: {
          resultBundlePath,
          totalTests: testSummary.totalTests,
          passed: testSummary.passed,
          failed: testSummary.failed,
          skipped: testSummary.skipped,
          duration: testSummary.duration,
          results: testSummary.results,
          rawData: testData,
        },
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Error in parse-test-results:', error);

      return {
        success: false,
        error: `Failed to parse test results: ${errorMsg}`,
        data: null,
        executionTime: Date.now() - startTime,
      };
    }
  },
};

/**
 * Helper function to parse xcodebuild test output
 */
function parseTestOutput(output: string): TestSummary {
  const lines = output.split('\n');
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let totalTests = 0;
  let duration = 0;

  for (const line of lines) {
    // Match test result lines
    const testMatch = line.match(/Test Suite '([^']+)' (passed|failed)/);
    if (testMatch) {
      const status = testMatch[2] === 'passed' ? 'passed' : 'failed';
      // This is a suite-level result, skip for now
      continue;
    }

    // Match individual test results
    const testCaseMatch = line.match(/\s+(\w+\s+)?(\S+)\s+\(([^)]+)\)\s+(PASSED|FAILED|SKIPPED)/);
    if (testCaseMatch) {
      const testName = testCaseMatch[2];
      const testStatus = testCaseMatch[4].toLowerCase() as 'passed' | 'failed' | 'skipped';
      const className = testCaseMatch[3];

      totalTests++;

      if (testStatus === 'passed') {
        passed++;
      } else if (testStatus === 'failed') {
        failed++;
      } else if (testStatus === 'skipped') {
        skipped++;
      }

      results.push({
        testName,
        className,
        status: testStatus,
        duration: 0,
      });
    }

    // Match duration line
    const durationMatch = line.match(/Test Suite '.*' finished at ([^)]+), took ([\d.]+) seconds/);
    if (durationMatch) {
      const seconds = parseFloat(durationMatch[2]);
      duration = Math.max(duration, Math.round(seconds * 1000));
    }
  }

  return {
    totalTests,
    passed,
    failed,
    skipped,
    duration,
    results,
  };
}

/**
 * Helper function to extract test summary from xcresult bundle data
 */
function extractTestSummaryFromBundle(data: any): TestSummary {
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let totalTests = 0;
  let duration = 0;

  // Navigate through the xcresult structure
  if (data && data.TestResults && Array.isArray(data.TestResults)) {
    data.TestResults.forEach((testResult: any) => {
      if (testResult.Tests) {
        testResult.Tests.forEach((test: any) => {
          totalTests++;

          const status = determineTestStatus(test);

          if (status === 'passed') {
            passed++;
          } else if (status === 'failed') {
            failed++;
          } else if (status === 'skipped') {
            skipped++;
          }

          results.push({
            testName: test.Name || 'Unknown',
            className: test.ClassName || 'Unknown',
            status,
            duration: test.Duration || 0,
            failureMessage: test.FailureSummary,
          });
        });
      }
    });
  }

  return {
    totalTests,
    passed,
    failed,
    skipped,
    duration,
    results,
  };
}

/**
 * Determine test status from xcresult test object
 */
function determineTestStatus(test: any): 'passed' | 'failed' | 'skipped' {
  if (test.Status === 'Success') {
    return 'passed';
  } else if (test.Status === 'Failure') {
    return 'failed';
  } else if (test.Status === 'Skipped') {
    return 'skipped';
  }

  // Fallback: check for failure message
  if (test.FailureSummary) {
    return 'failed';
  }

  return 'passed';
}

/**
 * Export all test tools
 */
export const tools: ToolDefinition[] = [runTests, runUITests, generateCoverageReport, parseTestResults];

export default tools;
