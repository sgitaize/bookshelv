# ---- Build ----
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

# ---- Laufzeit: nur das gebündelte server.js + Frontend, keine node_modules ----
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    BOOKSHELV_DATA_DIR=/data \
    NODE_NO_WARNINGS=1
WORKDIR /app
COPY --from=build /src/dist/ ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/status >/dev/null || exit 1
CMD ["node", "server.js"]
