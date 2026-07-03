# --- Stage 1: build ---
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json* bun.lock* ./
RUN npm install

COPY . .
RUN npm run build

# --- Stage 2: run ---
FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production

# Ieșirea Nitro (preset node-server) e auto-conținută — nu are nevoie de node_modules.
COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
