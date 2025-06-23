# 🤖 Claude Code on Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ghostwriternr/claude-code-containers)

This template provides a containerized environment on Cloudflare workers for Claude Code to process GitHub issues. It listens to new issues created from your connected repositories, and creates a Pull Request to solve them.

## ✨ Features

- **🔌 Leading coding agent**: Leverage the same [Claude Code](https://claude.ai/code) that you already use for coding tasks
- **⚡ Lightning Fast**: Cloudflare Containers provide instant scaling and sub-millisecond response times so Claude Code can work on any number of issues concurrently
- **🔧 Zero Configuration**: One-click deployment with guided setup process
- **🛡️ Installation Token Management**: Secure, auto-refreshing GitHub App tokens
- **🔒 Secure**: Deploys to your own Cloudflare account

## 🚀 Quickstart

### 1️⃣ Deploy to Cloudflare

Click the deploy button above to instantly deploy to your Cloudflare account. The deployment includes:
- Cloudflare Worker with Container support
- Durable Objects for secure storage
- All necessary bindings and configurations

### 2️⃣ Set Up Anthropic API

After deployment, you'll need to configure your Claude AI integration:

1. **Get your Anthropic API key**:
   - Visit [Anthropic Console](https://console.anthropic.com/)
   - Create an API key with appropriate permissions

2. **Configure the API key**:
   - Navigate to your deployed worker's `/claude-setup` endpoint
   - Enter your Anthropic API key
   - The system will securely encrypt and store your credentials

### 3️⃣ Install GitHub App

Once you complete the Anthropic API setup, you'll be redirected to the `/gh-setup` endpoint (or you can access it manually), which will guide you through installing the GitHub App and configuring access to your repositories. The system will automatically capture installation details.

## 🔧 Environment Variables (THIS SHOULD GO AWAY)

Set these in your Cloudflare Worker environment, or locally using `.dev.vars`:

```bash
# Development mode - until the issue with the containers package is resolved, manually run the container and get the worker to connect to it.
WRANGLER_CONTAINERS_ISSUE_HACK=true
```

## 📋 Usage

Once configured, the system works automatically:

1. **Issue Creation**: When someone creates an issue in your repository, Claude receives a webhook
2. **AI Analysis**: Claude analyzes the issue content and begins processing
3. **Progress Updates**: Real-time progress comments appear as Claude works
4. **Solution Delivery**: Claude provides comprehensive solutions with code examples
5. **Task Completion**: Final completion comment marks the end of processing

## 💻 Local development

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Run type checking
bun run typecheck
```

## 📄 License

This project is open source and available under the MIT License.
