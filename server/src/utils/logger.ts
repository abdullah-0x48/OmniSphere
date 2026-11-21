type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  time: string;
  message: string;
  requestId?: string;
  [key: string]: unknown;
}

function writeLog(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'test' && level === 'debug') {
    return;
  }
  const entry: LogEntry = {
    level,
    time: new Date().toISOString(),
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => writeLog('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => writeLog('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => writeLog('error', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => writeLog('debug', message, meta),
};
