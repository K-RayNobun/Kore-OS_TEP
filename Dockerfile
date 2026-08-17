# ==========================================
# STEP 1: Build & Dependency Isolation Stage
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install build dependencies required for native node modules if any
RUN apk add --no-cache python3 make g++ 

COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source files and compile TypeScript
COPY ./src ./src
RUN npm run build

# ==========================================
# STEP 2: Secure Production Runtime Stage
# ==========================================
FROM node:20-alpine AS runner

# Set production environment variables
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/home/elo/.cache/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install minimal OS utilities, FFmpeg for assets, and Chromium dependencies
RUN apk add --no-cache \
    ffmpeg \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    curl

# Create the dedicated, non-root operational user and group
RUN addgroup -g 1001 elo && \
    adduser -u 1001 -G elo -s /bin/sh -D elo

# Build the foundational directory architecture required by the TEP Security Policy
RUN mkdir -p /home/elo/workspace \
             /home/elo/data \
             /home/elo/.cache/ms-playwright \
             /home/elo/.local/share/browser-context \
             /usr/src/app/pwa \
             /tmp

WORKDIR /usr/src/app

# Pull dependencies and compiled JS from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY package*.json ./

# ---------------------------------------------------------
# DEFENSE: Lock Down Directory Boundaries & Permissions
# ---------------------------------------------------------
# Set absolute boundaries so that the low-privilege user can read/write 
# inside its own spaces, while explicitly sealing off session storage (chmod 700).
RUN chown -R elo:elo /home/elo && \
    chown -R elo:elo /usr/src/app && \
    chown -R elo:elo /tmp && \
    chmod 755 /home/elo/workspace && \
    chmod 755 /home/elo/data && \
    chmod 700 /home/elo/.local/share/browser-context

# Drop down to the secure user space permanently.
# No tool execution or subprocess spawned by the LLM can escape this context.
USER elo

# Ensure required Playwright hermetic browser binaries are ready inside the user space
RUN npx playwright install chromium

# Expose any internal port used by your JSON-RPC or MCP server communication layer
EXPOSE 3000

# Production runtime notes (apply at docker run / compose level):
#   --read-only
#   --tmpfs /tmp:size=512m
#   --security-opt no-new-privileges:true
#   --cap-drop ALL --cap-add NET_BIND_SERVICE
#   --security-opt seccomp=./docker/seccomp-profile.json
#   --healthcheck CMD ["/docker/healthcheck.sh"]
#   -v kore-marketing-metrics:/home/elo/data
CMD ["node", "dist/index.js"]
