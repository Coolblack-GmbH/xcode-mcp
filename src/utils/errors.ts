import { logger } from './logger.js';

/**
 * Parsed Xcode build error
 */
export interface ParsedError {
  type: ErrorType;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  suggestions: string[];
}

/**
 * Types of Xcode build errors
 */
export enum ErrorType {
  CODE_SIGNING = 'CODE_SIGNING',
  MISSING_FRAMEWORK = 'MISSING_FRAMEWORK',
  MISSING_PROFILE = 'MISSING_PROFILE',
  SWIFT_COMPILATION = 'SWIFT_COMPILATION',
  LINKER = 'LINKER',
  MISSING_RUNTIME = 'MISSING_RUNTIME',
  GENERIC = 'GENERIC',
}

/**
 * Error pattern matcher
 */
interface ErrorPattern {
  regex: RegExp;
  type: ErrorType;
  extractor?: (match: RegExpMatchArray) => Partial<ParsedError>;
}

/**
 * Collection of error patterns to match against
 */
const errorPatterns: ErrorPattern[] = [
  {
    regex: /error:.*Code Signing Error.*identity.*(?:required|not found)/i,
    type: ErrorType.CODE_SIGNING,
    extractor: (match) => ({
      message: match[0],
      suggestions: [
        'Check your code signing identity in Build Settings',
        'Verify your provisioning profile is installed',
        'Run: xcode-select --install',
        'Update your Apple Developer account credentials in Xcode',
      ],
    }),
  },
  {
    regex: /error:.*no team id set/i,
    type: ErrorType.CODE_SIGNING,
    extractor: (match) => ({
      message: match[0],
      suggestions: [
        'Select a team in the target signing settings',
        'Go to: Project > Build Settings > Signing > Team ID',
        'Ensure you have a valid Apple Developer account linked',
      ],
    }),
  },
  {
    regex: /error: (.*\.(?:h|swift):\d+:\d+:.*missing).*framework/i,
    type: ErrorType.MISSING_FRAMEWORK,
    extractor: (match) => {
      const fileParts = match[1].match(/^(.*):(\d+):(\d+):/);
      return {
        file: fileParts?.[1],
        line: fileParts ? parseInt(fileParts[2], 10) : undefined,
        column: fileParts ? parseInt(fileParts[3], 10) : undefined,
        message: match[0],
        suggestions: [
          'Add the missing framework to Link Binary With Libraries in Build Phases',
          'Check the framework name spelling',
          'Verify the framework is available for your deployment target',
        ],
      };
    },
  },
  {
    regex: /error: ld:.*symbol(s) not found.*framework|undefined reference/i,
    type: ErrorType.LINKER,
    extractor: (match) => ({
      message: match[0],
      suggestions: [
        'Ensure all required frameworks are linked in Build Phases > Link Binary With Libraries',
        'Check for missing library dependencies',
        'Verify framework search paths in Build Settings',
        'Clean build folder and rebuild',
      ],
    }),
  },
  {
    regex: /error: (.*\.swift:\d+:\d+:.*)'(?:[^']+)' is not defined|error: use of undeclared/i,
    type: ErrorType.SWIFT_COMPILATION,
    extractor: (match) => {
      const fileParts = match[1].match(/^(.*):(\d+):(\d+):/);
      return {
        file: fileParts?.[1],
        line: fileParts ? parseInt(fileParts[2], 10) : undefined,
        column: fileParts ? parseInt(fileParts[3], 10) : undefined,
        message: match[0],
        suggestions: [
          'Check for typos in variable or function names',
          'Ensure the file is included in the target membership',
          'Import required modules or classes',
          'Check compilation conditions and availability annotations',
        ],
      };
    },
  },
  {
    regex: /error:.*provisioning profile.*not found|no provisioning profile/i,
    type: ErrorType.MISSING_PROFILE,
    extractor: (match) => ({
      message: match[0],
      suggestions: [
        'Install the required provisioning profile from Apple Developer',
        'Refresh signing certificates: Xcode > Preferences > Accounts',
        'Verify the bundle identifier matches your provisioning profile',
        'Check: Project > Signing & Capabilities',
      ],
    }),
  },
  {
    regex: /error:.*provisioning profile.*doesn't include.*capability/i,
    type: ErrorType.MISSING_PROFILE,
    extractor: (match) => ({
      message: match[0],
      suggestions: [
        'Update your provisioning profile to include required capabilities',
        'Visit Apple Developer to modify the provisioning profile',
        'Re-download and install the updated profile',
        'Clean build folder and rebuild',
      ],
    }),
  },
  {
    regex: /error: [^:]*Xcode iOS Simulator runtime (\S+) not found/i,
    type: ErrorType.MISSING_RUNTIME,
    extractor: (match) => {
      const runtimeVersion = match[1];
      return {
        message: match[0],
        suggestions: [
          `Install iOS ${runtimeVersion} Simulator in Xcode`,
          'Open Xcode > Settings > Platforms > Download simulator runtimes',
          `Or from command line: xcode-select --install`,
          'Ensure you have sufficient disk space for simulator runtime',
        ],
      };
    },
  },
  {
    regex: /error:.*tvOS Simulator runtime.*not found/i,
    type: ErrorType.MISSING_RUNTIME,
    extractor: (match) => ({
      message: match[0],
      suggestions: [
        'Download tvOS Simulator runtime via Xcode settings',
        'Xcode > Settings > Platforms > tvOS > Download',
        'Ensure sufficient disk space is available',
      ],
    }),
  },
  {
    regex: /error:.*watchOS Simulator runtime.*not found/i,
    type: ErrorType.MISSING_RUNTIME,
    extractor: (match) => ({
      message: match[0],
      suggestions: [
        'Download watchOS Simulator runtime via Xcode settings',
        'Xcode > Settings > Platforms > watchOS > Download',
        'Check available disk space',
      ],
    }),
  },
];

/**
 * Parse xcodebuild stderr output and extract structured errors
 * @param output The stderr output from xcodebuild
 * @returns Array of parsed errors
 */
export function parseXcodeBuildErrors(output: string): ParsedError[] {
  logger.debug('Parsing Xcode build errors');

  const errors: ParsedError[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    if (!line.includes('error:')) {
      continue;
    }

    let matched = false;

    for (const pattern of errorPatterns) {
      const match = line.match(pattern.regex);

      if (match) {
        const baseError: ParsedError = {
          type: pattern.type,
          message: line.trim(),
          suggestions: [],
        };

        const extracted = pattern.extractor ? pattern.extractor(match) : {};
        const parsedError: ParsedError = { ...baseError, ...extracted };

        errors.push(parsedError);
        matched = true;
        logger.debug(`Matched error pattern: ${pattern.type}`);
        break;
      }
    }

    // If no pattern matched, create generic error
    if (!matched) {
      const fileMatch = line.match(/^(.*):(\d+):(\d+):.*error:\s*(.*)$/);

      const genericError: ParsedError = {
        type: ErrorType.GENERIC,
        message: line.trim(),
        suggestions: ['Check the error message for more details', 'Review the Xcode build log'],
      };

      if (fileMatch) {
        genericError.file = fileMatch[1];
        genericError.line = parseInt(fileMatch[2], 10);
        genericError.column = parseInt(fileMatch[3], 10);
        genericError.message = fileMatch[4];
      }

      errors.push(genericError);
    }
  }

  logger.debug(`Parsed ${errors.length} errors from build output`);
  return errors;
}

/**
 * Suggest fixes for a parsed error
 * @param error The parsed error
 * @returns Array of suggested fixes
 */
export function suggestFix(error: ParsedError): string[] {
  const suggestions: string[] = [...error.suggestions];

  // Add context-specific suggestions based on error type
  switch (error.type) {
    case ErrorType.CODE_SIGNING:
      if (!suggestions.some((s) => s.includes('provisioning profile'))) {
        suggestions.push('Ensure your provisioning profile is valid and not expired');
      }
      if (!suggestions.some((s) => s.includes('development team'))) {
        suggestions.push('Verify your development team is correctly set in Build Settings');
      }
      break;

    case ErrorType.MISSING_FRAMEWORK:
      if (!suggestions.some((s) => s.includes('framework search'))) {
        suggestions.push('Verify framework search paths are correctly configured in Build Settings');
      }
      break;

    case ErrorType.LINKER:
      if (!suggestions.some((s) => s.includes('clean build'))) {
        suggestions.push('Try cleaning the build folder: Cmd+Shift+K');
      }
      break;

    case ErrorType.SWIFT_COMPILATION:
      if (!suggestions.some((s) => s.includes('target membership'))) {
        suggestions.push('Verify the file is included in the correct target');
      }
      break;

    case ErrorType.MISSING_RUNTIME:
      if (!suggestions.some((s) => s.includes('disk space'))) {
        suggestions.push('Check that you have at least 10GB of free disk space for simulator runtimes');
      }
      break;
  }

  // Add generic suggestions if we only have pattern-based ones
  if (suggestions.length === 0) {
    suggestions.push('Review the full build log for context', 'Check Apple Developer documentation');
  }

  return suggestions;
}

/**
 * Format parsed errors for display
 * @param errors Array of parsed errors
 * @returns Formatted error string
 */
export function formatErrors(errors: ParsedError[]): string {
  if (errors.length === 0) {
    return 'No errors found';
  }

  const formatted = errors
    .map((error, index) => {
      let errorText = `Error ${index + 1}: [${error.type}] ${error.message}`;

      if (error.file) {
        errorText += `\n  Location: ${error.file}:${error.line}:${error.column}`;
      }

      if (error.suggestions.length > 0) {
        errorText += '\n  Suggestions:';
        error.suggestions.forEach((suggestion) => {
          errorText += `\n    - ${suggestion}`;
        });
      }

      return errorText;
    })
    .join('\n\n');

  return formatted;
}
