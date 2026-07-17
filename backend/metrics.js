import promClient from 'prom-client';

const register = new promClient.Registry();

promClient.collectDefaultMetrics({ register });

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const dbQueryDuration = new promClient.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

const activeTenants = new promClient.Gauge({
  name: 'active_tenants_total',
  help: 'Number of active tenants',
  registers: [register],
});

const aiRequestsTotal = new promClient.Counter({
  name: 'ai_requests_total',
  help: 'Total number of AI requests',
  labelNames: ['agent', 'tenant_id'],
  registers: [register],
});

export function metricsMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    httpRequestDuration.observe({ method: req.method, route, status_code: res.statusCode }, duration);
    httpRequestsTotal.inc({ method: req.method, route, status_code: res.statusCode });
  });
  next();
}

export function trackDbQuery(operation, startTime) {
  const duration = (Date.now() - startTime) / 1000;
  dbQueryDuration.observe({ operation }, duration);
}

export function trackAiRequest(agent, tenantId) {
  aiRequestsTotal.inc({ agent, tenant_id: tenantId || 'default' });
}

export function setActiveTenants(count) {
  activeTenants.set(count);
}

export async function metricsEndpoint(req, res) {
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
}

export default register;
