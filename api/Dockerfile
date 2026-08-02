# Node 24 runs TypeScript directly via type stripping — no build step, no
# bundler, no dist/ to keep in sync with source.
FROM node:24-alpine

WORKDIR /app

# Manifests first so npm ci is cached across source changes.
COPY package.json package-lock.json ./
COPY api/package.json ./api/
RUN npm ci --omit=dev --workspace @sme/api --include-workspace-root

# The API imports the shared core from src/, so both trees are needed.
COPY src ./src
COPY api ./api

ENV NODE_ENV=production
EXPOSE 3001

# Runs unprivileged. The node image ships a `node` user for exactly this.
USER node

CMD ["node", "api/src/server.ts"]
