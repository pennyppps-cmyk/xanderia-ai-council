# Build context: repository root (npm workspaces share one lockfile).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci -w server --include-workspace-root=false --ignore-scripts
COPY server server
RUN npm run build -w server

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci -w server --include-workspace-root=false --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY server/migrations server/migrations
WORKDIR /app/server
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
