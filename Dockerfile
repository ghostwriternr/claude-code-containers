# syntax=docker/dockerfile:1

FROM node:22-slim AS base

# Update package lists and install dependencies
RUN apt-get update && \
    apt-get install -y \
        python3 \
        python3-pip \
        git \
        build-essential \
        python3-dev \
        ca-certificates \
        curl \
        unzip && \
    rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Set destination for COPY
WORKDIR /app

# Copy and setup claude-code-action submodule first
COPY lib/claude-code-action/ ./claude-action/
WORKDIR /app/claude-action
RUN bun install

# Copy and setup claude-code-base-action submodule
COPY lib/claude-code-base-action/ ./claude-base-action/
WORKDIR /app/claude-base-action
RUN bun install

# Switch back to main app directory
WORKDIR /app

# Copy container package files
COPY container_src/package.json ./

# Install container dependencies with Bun
RUN bun install

# Copy TypeScript configuration
COPY container_src/tsconfig.json ./

# Copy source code
COPY container_src/src/ ./src/

# Build TypeScript with Bun
RUN bun run build

# Create directory for Claude Code config
RUN mkdir -p /tmp/workspace

# Set environment variables for MCP server
ENV CLAUDE_ACTION_PATH=/app/claude-action
ENV NODE_ENV=production

EXPOSE 8080

# Run the ParsedGitHubContext-enabled container with MCP
CMD ["bun", "dist/main-context.js"]