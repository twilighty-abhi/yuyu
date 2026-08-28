# Stage 1: Install dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
# `npm ci` runs the Prisma postinstall hook, which needs the schema available.
COPY prisma/schema.prisma ./prisma/schema.prisma
# Temporary workaround for npm nested-lockfile inconsistencies (for example
# magicast, picomatch, and yaml). Restore `npm ci` once that issue is resolved.
RUN npm install

# A small, purpose-built target for CI/CD or Helm pre-upgrade migration Jobs.
# Build and publish this target separately from the application runtime image.
FROM deps AS migrator
WORKDIR /app
COPY prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]

# Stage 2: Rebuild the source code
FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate
# The key is consumed by Next.js while compiling Server Actions. Every image
# replica must be built with one stable key and receive that same key at runtime.
RUN test -n "$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY" && \
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY" npm run build

# Stage 3: Production runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Sharp renders ticket and certificate SVGs on the server. Alpine has no
# system fonts by default, which otherwise turns every text glyph into a box.
RUN apk add --no-cache font-dejavu && fc-cache -f

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

# Leverage Next.js standalone tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Next's standalone trace may include dotenv files when a build is performed
# from a developer checkout. Secrets belong only in the runtime environment.
RUN rm -f .env .env.local .env.production .env.development

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
