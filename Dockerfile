# Use official Node.js as base
FROM node:20-slim

LABEL maintainer="Mohammad Reza Mokhtarabadi <mmokhtarabadi@gmail.com>"
LABEL org.opencontainers.image.authors="Mohammad Reza Mokhtarabadi <mmokhtarabadi@gmail.com>"

# Browsh and Firefox dependencies
RUN apt-get update && \
    apt-get install -y wget ca-certificates firefox-esr && \
    wget -O /usr/local/bin/browsh https://github.com/browsh-org/browsh/releases/download/v1.8.0/browsh_1.8.0_linux_amd64 && \
    chmod +x /usr/local/bin/browsh

# Set working directory
WORKDIR /app

# Copy all files
COPY . .

# Install Node deps and build
RUN npm install && npm run build

# Set env for production
ENV NODE_ENV=production

# No EXPOSE! Browsh HTTP port is not configurable or externally exposed.
# If you need to specify a custom Firefox binary for Browsh, set:
#   BROWSH_FIREFOX_PATH=/custom/path/firefox

# Start MCP server by default (edit if using HTTP transport)
CMD ["node", "dist/server.js"]