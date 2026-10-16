import path from 'path';
import pino from 'pino';
import { env } from '../config/env.js';

export interface CallerInfo {
  file: string;
  func: string;
  line: number;
}

const NAMED_FRAME_REGEX: RegExp = /^\s*at\s+(?:async\s+)?([^\s(]+)\s+\((.+):(\d+):\d+\)$/;
const ANON_FRAME_REGEX: RegExp = /^\s*at\s+(?:async\s+)?(.+):(\d+):\d+$/;

/**
 * Parse a single V8 stack frame line into { file, func, line }.
 */
export function parseStackFrame(frameLine: string): CallerInfo | null {
  let result: CallerInfo | null = null;
  const namedMatch: RegExpExecArray | null = NAMED_FRAME_REGEX.exec(frameLine);
  if (namedMatch) {
    const rawFunc: string = namedMatch[1].replace(/^(?:Object|Module|Function)\./, '');
    const rawPath: string = namedMatch[2].replace(/^file:\/\//, '');
    result = {
      file: path.basename(rawPath),
      func: rawFunc,
      line: parseInt(namedMatch[3], 10),
    };
  } else {
    const anonMatch: RegExpExecArray | null = ANON_FRAME_REGEX.exec(frameLine);
    if (anonMatch) {
      const rawPath: string = anonMatch[1].replace(/^file:\/\//, '');
      result = {
        file: path.basename(rawPath),
        func: 'anonymous',
        line: parseInt(anonMatch[2], 10),
      };
    }
  }

  return result;
}

/**
 * Extract the calling file name, function name, and line number from a V8 stack trace.
 */
export function getCallerInfo(stack: string = String(new Error().stack)): CallerInfo {
  const lines: string[] = stack.split('\n').slice(1);
  let caller: CallerInfo = {
    file: 'unknown',
    func: 'unknown',
    line: 0,
  };

  for (const rawLine of lines) {
    if (
      rawLine.includes('node_modules') ||
      rawLine.includes('node:') ||
      rawLine.includes('/lib/logger.') ||
      rawLine.includes('\\lib\\logger.')
    ) {
      continue;
    }

    const parsed: CallerInfo | null = parseStackFrame(rawLine);
    if (parsed) {
      caller = parsed;
      break;
    }
  }

  return caller;
}

/**
 * Resolve Pino transport configuration based on environment and destination stream.
 */
export function resolveTransport(
  nodeEnv: string,
  hasDestination: boolean
): pino.TransportSingleOptions | undefined {
  const transport: pino.TransportSingleOptions | undefined =
    !hasDestination && nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined;
  return transport;
}

/**
 * Create a configured Pino logger instance with:
 * - ISO-8601 date-time timestamps ("time": "2026-10-16T00:13:00.000Z")
 * - Automatic caller metadata ({ file, func, line }) via mixin
 * - Automatic PII / credential redaction
 */
export function createLogger(options?: {
  level?: string;
  nodeEnv?: string;
  destination?: pino.DestinationStream;
}) {
  const level: string = options?.level ?? env.LOG_LEVEL;
  const nodeEnv: string = options?.nodeEnv ?? env.NODE_ENV;

  return pino(
    {
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
      mixin() {
        return getCallerInfo();
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.passwordHash',
          '*.token',
          '*.sessionToken',
        ],
        censor: '[REDACTED]',
      },
      transport: resolveTransport(nodeEnv, Boolean(options?.destination)),
    },
    options?.destination
  );
}

export const logger: pino.Logger = createLogger();
