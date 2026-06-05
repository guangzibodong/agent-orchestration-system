FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY . .
RUN npm run build

FROM base AS api

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=4000

EXPOSE 4000

CMD ["sh", "-c", "npm run start -w @mawo/api"]

FROM base AS web

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_PUBLIC_API_URL=http://127.0.0.1:4000

EXPOSE 3000

CMD ["sh", "-c", "npm run start -w @mawo/web"]
