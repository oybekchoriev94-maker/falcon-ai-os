import pino from 'pino';
import { correlationIdMiddleware } from '../middleware/correlation.js';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  transport: isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
  redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.password_hash'],
});

export function pinoHttpMiddleware() {
  return (req, res, next) => {
    req.log = logger.child({
      correlationId: req.id || req.correlationId,
      path: req.path,
      method: req.method,
    });
    const start = Date.now();
    res.on('finish', () => {
      req.log.info({
        statusCode: res.statusCode,
        duration: Date.now() - start,
        contentLength: res.getHeader('content-length'),
      }, `${req.method} ${req.path} ${res.statusCode}`);
    });
    next();
  };
}

export default logger;
