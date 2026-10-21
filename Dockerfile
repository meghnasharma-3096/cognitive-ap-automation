# Hosted demo image. Defaults to replay mode (no API key, no network needed).
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production LLM_PROVIDER=fixture PORT=3000
EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
