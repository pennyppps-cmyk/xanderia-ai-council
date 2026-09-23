# Build context: repository root.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci -w web --include-workspace-root=false --ignore-scripts
COPY web web
RUN npm run build -w web

FROM caddy:2-alpine
COPY web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/web/dist /srv
