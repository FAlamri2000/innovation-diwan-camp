# Innovation Diwan camp operations — one container: the Node server (which also
# runs the SoWork sync every minute) against a managed PostgreSQL.
#
#   build:  docker build -t diwan-camp .
#   run:    docker run -p 3000:3000 -e DATABASE_URL=... -e SOWORK_API_KEY=... diwan-camp
#
# On start, scripts/migrate.ts applies db/migrations and (once) creates the
# first admin from ADMIN_EMAIL / ADMIN_PASSWORD.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
# Only `pg` is a runtime dependency (for the migrator); the server bundle in
# .output is self-contained.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/.output ./.output
COPY db ./db
COPY scripts/start.sh scripts/migrate.ts scripts/create-admin.ts ./scripts/
COPY src/lib/auth/password.server.ts ./src/lib/auth/password.server.ts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "scripts/start.sh"]
