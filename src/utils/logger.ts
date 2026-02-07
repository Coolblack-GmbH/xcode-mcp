import { stderr } from 'process';

/**
 * Log levels for the logger
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * Logger interface
 */
interface ILogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  setLevel(level: LogLevel): void;
}

/**
 * Stderr-based logger that preserves stdout for JSON-RPC communication
 */
class Logger implements ILogger {
  private currentLevel: LogLevel = LogLevel.INFO;
  private readonly levelOrder: Record<LogLevel, number> = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3,
  };

  /**
   * Format a log message with timestamp and level
   */
  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
  }

  /**
   * Write log to stderr
   */
  private writeLog(level: LogLevel, message: string, data?: unknown): void {
    if (this.levelOrder[level] < this.levelOrder[this.currentLevel]) {
      return;
    }

    const formattedMessage = this.formatMessage(level, message);
    const logLine = data !== undefined ? `${formattedMessage} ${JSON.stringify(data)}` : formattedMessage;

    stderr.write(`${logLine}\n`);
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: unknown): void {
    this.writeLog(LogLevel.DEBUG, message, data);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: unknown): void {
    this.writeLog(LogLevel.INFO, message, data);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: unknown): void {
    this.writeLog(LogLevel.WARN, message, data);
  }

  /**
   * Log an error message
   */
  error(message: string, data?: unknown): void {
    this.writeLog(LogLevel.ERROR, message, data);
  }

  /**
   * Set the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }
}

/**
 * Singleton logger instance
 */
export const logger = new Logger();

export default logger;
