# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
bun run dev          # Start local development server (http://localhost:8787)
bun run deploy       # Deploy to Cloudflare Workers
bun run cf-typegen   # Generate TypeScript types after wrangler config changes
bun run typecheck    # Run TypeScript type checking
bun run format       # Format code with Prettier
```

**⚠️ Important:** Always run `bun run cf-typegen` after making changes to `wrangler.jsonc`. This regenerates the TypeScript types and updates `worker-configuration.d.ts` to match your bindings and configuration.

### Package Management & Runtime

This project uses **Bun** as the package manager and JavaScript runtime for better performance and compatibility with the claude-code-action submodule.

```bash
bun install                         # Install dependencies
bun run dev                         # Start local development
bun run typecheck                   # Type checking
```

### Wrangler CLI Commands

```bash
npx wrangler dev                    # Start local development (same as bun run dev)
npx wrangler dev --remote          # Use remote Cloudflare resources
npx wrangler deploy                 # Deploy to production (same as bun run deploy)
npx wrangler login                  # Authenticate with Cloudflare
npx wrangler versions upload        # Upload new version with preview URL
```

## Tech Stack & Architecture

This is a **Cloudflare Workers Container project** that integrates **Claude Code** with **GitHub** for automated issue processing. It combines:
- **TypeScript Worker** (`src/index.ts`) - Main request router and GitHub integration
- **Node.js Container** (`container_src/src/main.ts`) - Containerized Claude Code environment running on port 8080
- **Durable Objects** - Two DO classes: `GitHubAppConfigDO` for encrypted credential storage and `MyContainer` for container management

### Key Architecture Points

**Request Flow:**
1. Worker receives requests and routes based on path
2. GitHub webhooks trigger issue processing in Claude Code containers
3. Container routes (`/container`, `/lb`, `/singleton`, `/error`) for testing and load balancing
4. Setup routes (`/claude-setup`, `/gh-setup/*`) handle API key configuration and GitHub app OAuth

**Container Management:**
- Extends `cf-containers` library's `Container` class
- Default port 8080, 45-second sleep timeout
- Lifecycle hooks: `onStart()`, `onStop()`, `onError()`
- Load balancing support across multiple container instances
- Contains Claude Code SDK (`@anthropic-ai/claude-code`) and GitHub API client (`@octokit/rest`)

**GitHub Integration:**
- Uses GitHub App Manifests for one-click app creation
- Each deployment gets isolated GitHub app with dynamic webhook URLs
- OAuth flow: `/gh-setup` → GitHub → `/gh-setup/callback` → `/gh-setup/install`
- Webhook processing: `/webhooks/github` handles push, pull_request, issues, installation events
- Encrypted credential storage using AES-256-GCM in Durable Objects

## Configuration Files

- **`wrangler.jsonc`** - Workers configuration with container bindings and Durable Objects
- **`Dockerfile`** - Multi-stage build with Node.js, Python, Git, and Claude Code CLI
- **`worker-configuration.d.ts`** - Auto-generated types (run `npm run cf-typegen` after config changes)
- **`.dev.vars`** - Local environment variables (not committed to git)
- **`container_src/package.json`** - Container dependencies including Claude Code SDK

### Key Wrangler Configuration Patterns

```jsonc
{
  "compatibility_date": "2025-05-23",  // Controls API behavior and features
  "nodejs_compat": true,               // Enable Node.js API compatibility
  "vars": {                           // Environment variables
    "ENVIRONMENT": "development"
  },
  "durable_objects": {                // Durable Object bindings
    "bindings": [
      { "name": "MY_CONTAINER", "class_name": "MyContainer" },
      { "name": "GITHUB_APP_CONFIG", "class_name": "GitHubAppConfigDO" }
    ]
  }
}
```

**After modifying bindings or vars in wrangler.jsonc:**
1. Run `npm run cf-typegen` to update TypeScript types
2. Check that `worker-configuration.d.ts` reflects your changes
3. Update your `Env` interface in TypeScript code if needed

## Development Patterns

**Key Endpoints:**
- `/claude-setup` - Configure Claude API key
- `/gh-setup` - GitHub app creation and setup
- `/gh-status` - Check configuration status
- `/webhooks/github` - GitHub webhook processor
- `/container/*` - Basic container functionality
- `/lb/*` - Load balancing across 3 containers
- `/singleton/*` - Single container instance
- `/error/*` - Test container error handling

**Environment Variables:**
- Container receives issue context and GitHub credentials from Worker
- Configure base environment in `wrangler.jsonc` vars section
- Sensitive data (API keys, tokens) stored encrypted in Durable Objects

## Cloudflare Workers Best Practices

### Worker Code Structure
```typescript
export interface Env {
  MY_CONTAINER: DurableObjectNamespace;
  GITHUB_APP_CONFIG: DurableObjectNamespace;
  // Add other bindings here
  ENVIRONMENT?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Worker logic here
    return new Response("Hello World");
  },
} satisfies ExportedHandler<Env>;
```

### Resource Bindings
- **Durable Objects**: Access via `env.MY_CONTAINER.get(id)`
- **Environment Variables**: Access via `env.VARIABLE_NAME`
- **KV/D1/R2**: Configure in wrangler.jsonc, access via env bindings

### Development Tips
- Use `console.log()` for debugging - visible in `wrangler dev` and deployed logs
- Workers must start within 400ms - keep imports and initialization lightweight
- Use `.dev.vars` for local secrets (never commit this file)
- Test with `--remote` flag to use actual Cloudflare resources during development

### TypeScript Code Quality Rules
- **NEVER use `any` type** - Always provide proper type annotations
- Use `unknown` for truly unknown data, then narrow with type guards
- Prefer type assertions with `as` only when you can guarantee the type
- Use union types and optional properties instead of `any`
- Create proper interfaces for all data structures

## Current Implementation Status

**✅ Completed:**
- GitHub App Manifest setup and OAuth flow
- Secure credential storage in Durable Objects with AES-256-GCM encryption
- Basic webhook processing infrastructure with signature verification
- Container enhancement with Claude Code SDK and GitHub API integration
- Issue detection and routing to Claude Code containers

**🔧 In Progress:**
- End-to-end issue processing with Claude Code analysis and solutions
- Pull request creation from Claude's code modifications
- Enhanced error handling and progress monitoring

**Important:** Containers are a Beta feature - API may change. The `cf-containers` library version is pinned to 0.0.7.

## Project Architecture Summary

This project creates an automated GitHub issue processor powered by Claude Code:

1. **Setup Phase**: Configure Claude API key and GitHub app via web interface
2. **Issue Processing**: GitHub webhooks trigger containerized Claude Code analysis
3. **Solution Implementation**: Claude Code analyzes repositories and implements solutions
4. **Result Delivery**: Solutions are delivered as GitHub comments or pull requests

**Key Integration Points:**
- `src/handlers/github_webhook.ts` - Main webhook entry point
- `src/handlers/github_webhooks/issues.ts` - Issue-specific processing
- `container_src/src/main.ts` - Claude Code execution environment
- Durable Objects for persistent, encrypted storage of credentials and state