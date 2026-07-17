import pino from 'pino';
import pinoHttp from 'pino-http';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_PROD = process.env.NODE_ENV === 'production';
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const ERROR_FILE = path.join(LOG_DIR, 'error.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Pretty print for development, JSON for production
const transport = IS_PROD
  ? undefined
  : {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        singleLine: false
      }
    };

// Base logger configuration
const baseLogger = pino({
  level: process.env.LOG_LEVEL || (IS_PROD ? 'info' : 'debug'),
  transport,
  base: {
    service: 'falcon-ai-os',
    version: process.env.npm_package_version || '2.0.0',
    env: process.env.NODE_ENV || 'development',
    pid: process.pid
  },
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      ...bindings,
      timestamp: new Date().toISOString()
    })
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.token',
      'req.body.secret',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
      '*.api_key'
    ],
    censor: '[REDACTED]'
  }
});

// HTTP request logger (replaces morgan)
export const httpLogger = pinoHttp({
  logger: baseLogger,
  genReqId: (req) => req.id || req.correlationId,
  customLogLevel: (res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err?.message}`;
  },
  customProps: (req, res) => ({
    correlationId: req.id,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.connection?.remoteAddress
  }),
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      query: req.query,
      params: req.params,
      headers: req.headers,
      body: req.body,
      ip: req.ip
    }),
    res: (res) => ({
      statusCode: res.statusCode,
      headers: res.getHeaders()
    })
  },
  quietReqLogger: true // we log via customSuccessMessage/customErrorMessage
});

// Named loggers for different subsystems
export const loggers = {
  // Core application
  app: baseLogger.child({ subsystem: 'app' }),
  
  // AI subsystem
  ai: baseLogger.child({ subsystem: 'ai' }),
  llm: baseLogger.child({ subsystem: 'ai', component: 'llm' }),
  stt: baseLogger.child({ subsystem: 'ai', component: 'stt' }),
  tts: baseLogger.child({ subsystem: 'ai', component: 'tts' }),
  orchestrator: baseLogger.child({ subsystem: 'ai', component: 'orchestrator' }),
  
  // Database
  db: baseLogger.child({ subsystem: 'database' }),
  migration: baseLogger.child({ subsystem: 'database', component: 'migration' }),
  
  // Auth & Security
  auth: baseLogger.child({ subsystem: 'auth' }),
  security: baseLogger.child({ subsystem: 'security' }),
  
  // Business logic
  billing: baseLogger.child({ subsystem: 'billing' }),
  inventory: baseLogger.child({ subsystem: 'inventory' }),
  referral: baseLogger.child({ subsystem: 'referral' }),
  appointments: baseLogger.child({ subsystem: 'appointments' }),
  faceId: baseLogger.child({ subsystem: 'faceId' }),
  
  // External integrations
  telegram: baseLogger.child({ subsystem: 'external', service: 'telegram' }),
  groq: baseLogger.child({ subsystem: 'external', service: 'groq' }),
  openai: baseLogger.child({ subsystem: 'external', service: 'openai' }),
  
  // Cron/background jobs
  cron: baseLogger.child({ subsystem: 'cron' }),
  
  // WebSocket/Realtime
  ws: baseLogger.child({ subsystem: 'realtime' })
};

// Helper to create child logger with context
export function createContextLogger(subsystem, context = {}) {
  return baseLogger.child({ subsystem, ...context });
}

// Helper for structured error logging
export function logError(logger, error, context = {}) {
  logger.error({
    err: {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
      code: error?.code,
      status: error?.status,
      statusCode: error?.statusCode
    },
    ...context
  }, error?.message || 'Unknown error');
}

// Helper for audit logging (security-sensitive events)
export function logAudit(event, details = {}) {
  loggers.security.info({
    audit: true,
    event,
    ...details,
    timestamp: new Date().toISOString()
  }, `AUDIT: ${event}`);
}

// Helper for performance logging
export function logPerformance(operation, durationMs, context = {}) {
  const level = durationMs > 1000 ? 'warn' : durationMs > 500 ? 'info' : 'debug';
  loggers.app[level]({
    performance: true,
    operation,
    durationMs,
    ...context
  }, `PERF: ${operation} took ${durationMs}ms`);
}

// Export base logger for direct use
export const logger = baseLogger;

export default baseLogger;