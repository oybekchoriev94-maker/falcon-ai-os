import crypto from 'crypto';

// Correlation ID middleware — adds req.id to every request for tracing
// Works with: pino logger, Prometheus metrics, distributed tracing

const CORRELATION_HEADER = 'x-correlation-id';
const RESPONSE_HEADER = 'x-correlation-id';

export function correlationIdMiddleware(options = {}) {
  const {
    headerName = CORRELATION_HEADER,
    responseHeader = RESPONSE_HEADER,
    generator = () => crypto.randomUUID(),
    propagate = true // add to outgoing requests context
  } = options;

  return function correlationId(req, res, next) {
    // Extract or generate correlation ID
    const incomingId = req.headers[headerName.toLowerCase()];
    const correlationId = incomingId && typeof incomingId === 'string' && incomingId.length <= 64
      ? incomingId
      : generator();

    // Attach to request for downstream use
    req.id = correlationId;
    req.correlationId = correlationId; // alias

    // Set response header for client tracing
    if (responseHeader) {
      res.setHeader(responseHeader, correlationId);
    }

    // Make available to logger context
    if (req.log) {
      req.log = req.log.child({ correlationId });
    }

    // Optional: propagate to outgoing fetch/axios calls via global context
    if (propagate && typeof globalThis !== 'undefined') {
      // Store in AsyncLocalStorage if available (Node 14+)
      // For now, just attach to req for manual propagation
      req._correlationId = correlationId;
    }

    next();
  };
}

// Helper to get correlation ID from request (for services not receiving req)
export function getCorrelationId(req) {
  return req?.id || req?.correlationId || req?._correlationId;
}

// Helper to create child logger with correlation ID
export function withCorrelation(logger, correlationId) {
  return logger.child({ correlationId });
}