FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Named (not just "the second stage") so a deploy platform's build-stage
# picker shows something unambiguous instead of defaulting to "build",
# which has no runtime app in it.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
# node:22-slim ships a built-in non-root "node" user — run as that instead
# of root, so a future RCE in this process can't write outside its own files.
USER node
EXPOSE 8787
# Required runtime env vars — see .env.example for the full list
# (DATABASE_URL, HACKCLUB_AUTH_*, AIRTABLE_*, FRONTEND_URL/FRONTEND_ORIGINS).
# Migrations are NOT run automatically — run `node dist/db/migrate.js`
# (or `npm run db:migrate` from source) against the target DB before/during
# a deploy that changes the schema.
CMD ["node", "dist/index.js"]
