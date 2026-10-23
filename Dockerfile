# piano-steps — one image: API + built web app on one port (9300).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=9300 \
    HOST=0.0.0.0 \
    SERVE_WEB=1
COPY --from=build /app /app
EXPOSE 9300
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:9300/api/health >/dev/null || exit 1
CMD ["node_modules/.bin/tsx", "apps/server/src/main.ts"]
