FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json knexfile.js ./
RUN npm ci --production

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tini curl postgresql16-client gzip
COPY --from=builder /app/node_modules ./node_modules
COPY server.js package.json knexfile.js ./
COPY backend/ ./backend/
COPY middleware/ ./middleware/
COPY public/ ./public/
COPY ai/ ./ai/
COPY migrations/ ./migrations/
COPY scripts/ ./scripts/
RUN mkdir -p /backup /logs && \
    addgroup -S app && adduser -S app -G app && \
    chown -R app:app /app /backup /logs
USER app
ENV NODE_ENV=production PORT=3000
VOLUME ["/backup"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node scripts/healthcheck.cjs || exit 1
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
