FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The platform passes runtime env vars (incl. NODE_ENV=production) in as build args, which
# would make a plain `npm ci` skip devDependencies needed to build.
RUN npm ci --include=dev
COPY . .
# Astro bakes PUBLIC_* vars into the shipped client JS at build time, not at
# container start — so this must come in as a build ARG (set it in your
# build system's "build-time variables", not just its runtime env vars) or
# every browser-side API call/login link breaks silently.
ARG PUBLIC_BACKEND_URL
ENV PUBLIC_BACKEND_URL=$PUBLIC_BACKEND_URL
RUN npm run build

# Named (not just "the second stage") so a deploy platform's build-stage
# picker shows something unambiguous instead of defaulting to "build",
# which has no runtime app in it.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# node:22-slim ships a built-in non-root "node" user — run as that instead
# of root, so a future RCE in this process can't write outside its own files.
USER node
EXPOSE 4321
# BACKEND_URL (server-side SSR calls) must be set at runtime — unlike
# PUBLIC_BACKEND_URL above, it's read from the environment per request (src/lib/api.ts),
# not baked in.
CMD ["node", "./dist/server/entry.mjs"]
