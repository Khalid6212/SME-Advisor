# Builds the SPA to static files. Caddy serves them — nothing Node runs in
# production for the front end.
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY web/package.json ./web/
RUN npm ci --workspace @sme/web --include-workspace-root

COPY web ./web

# Relative, so the SPA calls the same origin it was served from and Caddy
# proxies /api to the API. Same-origin means no CORS and no cookie surprises.
ENV VITE_API_URL=/api
RUN npm run build --workspace @sme/web

# Only the built assets survive into the final image.
FROM alpine:3.20
COPY --from=build /app/web/dist /srv
