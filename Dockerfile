FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node assets ./assets
COPY --chown=node:node config/config.example.yaml ./config/config.example.yaml
USER node
EXPOSE 19900
CMD ["node", "src/server.js"]
