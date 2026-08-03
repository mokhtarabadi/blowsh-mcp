# ---------- Stage 1: build the TypeScript project ----------
FROM node:22-slim AS builder
LABEL maintainer="Mohammad Reza Mokhtarabadi <mmokhtarabadi@gmail.com>"

WORKDIR /build

# Install deps (ignore scripts so `prepare` doesn't run before src is copied)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and compile
COPY . .
RUN npm run build

# Prune dev deps, keep only production node_modules (no scripts to avoid esbuild re-install)
RUN npm prune --omit=dev --ignore-scripts

# ---------- Stage 2: fat runtime image with everything bundled ----------
FROM node:22-slim
LABEL maintainer="Mohammad Reza Mokhtarabadi <mmokhtarabadi@gmail.com>"

ENV NODE_ENV=production
ENV BROWSH_FIREFOX_PATH=/usr/bin/firefox-esr
ENV HTML2MARKDOWN_PATH=html2markdown

# Install Firefox (Browsh backend), Browsh CLI, and the html2markdown CLI — a fat image
# includes every external binary the server needs, so no host-side deps are required.
RUN apt-get update && \
    apt-get install -y ca-certificates wget firefox-esr fonts-liberation poppler-utils && \
    wget -q -O /usr/local/bin/browsh https://github.com/browsh-org/browsh/releases/download/v1.8.0/browsh_1.8.0_linux_amd64 && \
    chmod +x /usr/local/bin/browsh && \
    wget -q -O /tmp/html2markdown.deb "https://github.com/JohannesKaufmann/html-to-markdown/releases/download/v2.5.2/html2markdown_2.5.2_linux_amd64.deb" && \
    apt-get install -y /tmp/html2markdown.deb && \
    rm -f /tmp/html2markdown.deb && \
    apt-get purge -y --auto-remove wget && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled app + production dependencies from the builder stage
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY package.json ./
COPY .env.example .env.example
COPY README.md ./

# No EXPOSE: Browsh's HTTP port is not configurable and must stay private.
# Run MCP server over stdio; Browsh binds 127.0.0.1:4333 inside the container.
CMD ["node", "dist/server.js"]