# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_SITE_URL=https://yogimangchi.com
ARG NEXT_PUBLIC_CONTENT_SERVER_URL=https://yogimangchi.com
ARG NEXT_PUBLIC_TRADING_SERVER_URL=https://yogimangchi.com

ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_CONTENT_SERVER_URL=$NEXT_PUBLIC_CONTENT_SERVER_URL \
    NEXT_PUBLIC_TRADING_SERVER_URL=$NEXT_PUBLIC_TRADING_SERVER_URL \
    NEXT_OUTPUT_STANDALONE=true \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p public \
    && npm run build

FROM node:24-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache curl tzdata \
    && addgroup -S nodejs \
    && adduser -S nextjs -G nodejs

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    TZ=Asia/Seoul \
    NODE_OPTIONS="--max-old-space-size=192"

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/ >/dev/null || exit 1

CMD ["node", "server.js"]
