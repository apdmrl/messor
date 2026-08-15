# Messor frontend production image.
#
# Multi-stage build: the Node build stage compiles the React application and
# the runtime stage copies the static build output into the Nginx image that
# serves it. The Nginx configuration is mounted by compose (see compose.yaml)
# so the same files validated by `nginx -t` are used at runtime.

# ---- Build stage ----
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first so they are cached across builds.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
