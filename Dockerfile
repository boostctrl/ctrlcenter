# Node 24 (active LTS), pinned by digest so rebuilding a release tag gives the
# same base image; Dependabot proposes digest bumps (.github/dependabot.yml).
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runner
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
# The production entry wraps Next's server.js to hand the app each request's
# real socket address (login throttling, #257); see the file for why.
COPY --chown=nextjs:nodejs scripts/server-entry.mjs ./server-entry.mjs
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
VOLUME ["/config"]

# Liveness for plain `docker run` and orchestrators, not just compose. Honors a
# PORT override; HOSTNAME=0.0.0.0 above means localhost reaches the server.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Start as root so the entrypoint can chown /config, then it drops to `nextjs`.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server-entry.mjs"]
