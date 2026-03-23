FROM node:20-slim

# Install Python + Screener dependencies via apt (clean, no Nix issues)
RUN apt-get update && \
    apt-get install -y python3 python3-requests python3-bs4 --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY agents/package*.json ./
RUN npm ci

# Copy agent scripts
COPY agents/ .

CMD ["node", "index.js"]
