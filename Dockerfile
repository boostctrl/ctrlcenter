FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Docker auto-sets HOSTNAME to the container ID; without this the Next.js
# standalone server binds to that hostname's private IP instead of all
# interfaces, so the published port and the healthcheck can't reach it.
ENV HOSTNAME=0.0.0.0
ENV CONFIG_PATH=/config/config.yaml

# su-exec lets the entrypoint drop from root to the app user after fixing
# permissions on the bind-mounted /config volume.
RUN apk add --no-cache su-exec \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /config \
  && chown nextjs:nodejs /config

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
VOLUME ["/config"]

# Start as root so the entrypoint can chown /config, then it drops to `nextjs`.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
