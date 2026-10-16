import { describe, it, expect, vi } from 'vitest';
import { Writable } from 'stream';
import type {
  parseStackFrame as ParseStackFrameFn,
  getCallerInfo as GetCallerInfoFn,
  resolveTransport as ResolveTransportFn,
  createLogger as CreateLoggerFn,
} from '../../src/lib/logger.js';

type LoggerModuleExports = {
  parseStackFrame: typeof ParseStackFrameFn;
  getCallerInfo: typeof GetCallerInfoFn;
  resolveTransport: typeof ResolveTransportFn;
  createLogger: typeof CreateLoggerFn;
};

const actualLoggerModule: LoggerModuleExports = await vi.importActual<LoggerModuleExports>('../../src/lib/logger.js');

const { parseStackFrame, getCallerInfo, resolveTransport, createLogger } = actualLoggerModule;

describe('Feature: Structured Logger with ISO-8601 Date-Time, Caller File/Function Metadata, and Secret Redaction', () => {
  describe('Scenario: Extracting caller file name, function name, and line number from V8 stack frames', () => {
    it('Given a named function stack frame When parseStackFrame is called Then it extracts the basename file, function name, and line number', () => {
      const frame: string =
        '    at loginUser (/Users/siddhero97/tap-hop/services/api/src/auth/auth.service.ts:210:15)';
      expect(parseStackFrame(frame)).toEqual({
        file: 'auth.service.ts',
        func: 'loginUser',
        line: 210,
      });
    });

    it('Given an async Object/Module method stack frame with file:// URL When parseStackFrame is called Then it strips the Object prefix and file:// protocol', () => {
      const frame: string =
        '    at async Object.updatePlatformSettings (file:///Users/siddhero97/tap-hop/services/api/src/admin/admin.service.ts:95:5)';
      expect(parseStackFrame(frame)).toEqual({
        file: 'admin.service.ts',
        func: 'updatePlatformSettings',
        line: 95,
      });
    });

    it('Given an anonymous stack frame without a function name When parseStackFrame is called Then it sets func to anonymous', () => {
      const frame: string =
        '    at file:///Users/siddhero97/tap-hop/services/api/src/middleware/request-id.ts:22:7';
      expect(parseStackFrame(frame)).toEqual({
        file: 'request-id.ts',
        func: 'anonymous',
        line: 22,
      });
    });

    it('Given a non-stack string When parseStackFrame is called Then it returns null', () => {
      expect(parseStackFrame('Error: something went wrong')).toBeNull();
    });

    it('Given a multi-line stack trace containing logger.ts and node_modules frames When getCallerInfo is called Then it skips internal frames and returns the first application frame', () => {
      const sampleStack: string = [
        'Error',
        '    at getCallerInfo (/Users/siddhero97/tap-hop/services/api/src/lib/logger.ts:44:27)',
        '    at Object.mixin (/Users/siddhero97/tap-hop/services/api/src/lib/logger.ts:81:16)',
        '    at Pino.write (/Users/siddhero97/tap-hop/node_modules/pino/lib/proto.js:206:33)',
        '    at node:internal/process/task_queues:95:5',
        '    at createOrderWithItems (/Users/siddhero97/tap-hop/services/api/src/orders/orders.service.ts:204:10)',
      ].join('\n');

      expect(getCallerInfo(sampleStack)).toEqual({
        file: 'orders.service.ts',
        func: 'createOrderWithItems',
        line: 204,
      });
    });

    it('Given an empty or unparseable stack trace When getCallerInfo is called Then it falls back to unknown file and func with line 0', () => {
      expect(getCallerInfo('Error\n    at unparseable line')).toEqual({
        file: 'unknown',
        func: 'unknown',
        line: 0,
      });
    });
  });

  describe('Scenario: Emitting JSON logs with ISO-8601 timestamp, file/func/line caller context, and redacted secrets', () => {
    it('Given a named domain function logging an order event When logger.info is invoked Then the JSON log includes an ISO-8601 time, file, func, line, and redacted credentials', () => {
      interface CapturedLogEntry {
        level: number;
        time: string;
        file: string;
        func: string;
        line: number;
        msg: string;
        orderId?: string;
        venueId?: string;
        password?: string;
        token?: string;
        req?: {
          headers: {
            authorization: string;
            cookie: string;
          };
        };
        patronUser: {
          email: string;
          password: string;
          token: string;
        };
      }
      const capturedLogs: CapturedLogEntry[] = [];
      const memoryDestination: Writable = new Writable({
        write(chunk, _encoding, callback) {
          capturedLogs.push(JSON.parse(chunk.toString()));
          callback();
        },
      });

      const testLogger: ReturnType<typeof createLogger> = createLogger({
        level: 'info',
        nodeEnv: 'test',
        destination: memoryDestination,
      });

      function auditPatronElenaOrderCheckout() {
        testLogger.info(
          {
            orderId: 'order-anchor-taproom-table-12',
            patronUser: {
              email: 'elena.patron@example.com',
              password: 'PlaintextSecretPassword123!',
              token: 'raw-session-token-secret',
            },
          },
          'Patron Elena completed order checkout'
        );
      }

      auditPatronElenaOrderCheckout();

      expect(capturedLogs).toHaveLength(1);
      const entry: CapturedLogEntry = capturedLogs[0];

      // ISO-8601 timestamp check (e.g. "2026-10-16T00:25:00.123Z")
      expect(typeof entry.time).toBe('string');
      expect(entry.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Caller file, function, and line number check
      expect(entry.file).toBe('logger.test.ts');
      expect(entry.func).toBe('auditPatronElenaOrderCheckout');
      expect(entry.line).toBeGreaterThan(0);

      // Message and payload check with automatic secret redaction
      expect(entry.msg).toBe('Patron Elena completed order checkout');
      expect(entry.orderId).toBe('order-anchor-taproom-table-12');
      expect(entry.patronUser.email).toBe('elena.patron@example.com');
      expect(entry.patronUser.password).toBe('[REDACTED]');
      expect(entry.patronUser.token).toBe('[REDACTED]');
    });

    it('Given development vs production nodeEnv When resolveTransport and createLogger are called Then pino-pretty is used only in development without a custom destination', () => {
      expect(resolveTransport('development', false)).toEqual({ target: 'pino-pretty' });
      expect(resolveTransport('development', true)).toBeUndefined();
      expect(resolveTransport('production', false)).toBeUndefined();

      const prodLogger: ReturnType<typeof createLogger> = createLogger({ level: 'info', nodeEnv: 'production' });
      expect(prodLogger.level).toBe('info');
    });
  });
});
