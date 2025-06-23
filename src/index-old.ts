import { Container, loadBalance, getContainer } from '@cloudflare/containers';
import { decrypt, generateInstallationToken } from './crypto';
import { containerFetch, getRouteFromRequest } from './fetch';
import { handleOAuthCallback } from './handlers/oauth_callback';
import { handleClaudeSetup } from './handlers/claude_setup';
import { handleGitHubSetup } from './handlers/github_setup';
import { handleGitHubStatus } from './handlers/github_status';
import { handleGitHubWebhook } from './handlers/github_webhook';
import { logWithContext } from './log';

export class GitHubAppConfigDO {
  private storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.storage = state.storage;
    this.initializeTables();
    logWithContext('DURABLE_OBJECT', 'GitHubAppConfigDO initialized with SQLite');
  }

  private initializeTables(): void {
    logWithContext('DURABLE_OBJECT', 'Initializing SQLite tables');

    // Create github_app_config table
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS github_app_config (
        id INTEGER PRIMARY KEY,
        app_id TEXT NOT NULL,
        private_key TEXT NOT NULL,
        webhook_secret TEXT NOT NULL,
        installation_id TEXT,
        owner_login TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        owner_id INTEGER NOT NULL,
        permissions TEXT NOT NULL,
        events TEXT NOT NULL,
        repositories TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_webhook_at TEXT,
        webhook_count INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `);

    // Create installation_tokens table
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS installation_tokens (
        id INTEGER PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    // Create claude_config table
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS claude_config (
        id INTEGER PRIMARY KEY,
        anthropic_api_key TEXT NOT NULL,
        claude_setup_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    logWithContext('DURABLE_OBJECT', 'SQLite tables initialized successfully');
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    logWithContext('DURABLE_OBJECT', 'Processing request', {
      method: request.method,
      pathname: url.pathname
    });

    if (url.pathname === '/store' && request.method === 'POST') {
      logWithContext('DURABLE_OBJECT', 'Storing app config');

      const config = await request.json() as GitHubAppConfig;

      logWithContext('DURABLE_OBJECT', 'App config received', {
        appId: config.appId,
        repositoryCount: config.repositories.length,
        owner: config.owner.login
      });

      await this.storeAppConfig(config);

      logWithContext('DURABLE_OBJECT', 'App config stored successfully');
      return new Response('OK');
    }

    if (url.pathname === '/get' && request.method === 'GET') {
      logWithContext('DURABLE_OBJECT', 'Retrieving app config');

      const config = await this.getAppConfig();

      logWithContext('DURABLE_OBJECT', 'App config retrieved', {
        hasConfig: !!config,
        appId: config?.appId,
        repositoryCount: config?.repositories.length
      });

      return new Response(JSON.stringify(config));
    }

    if (url.pathname === '/get-credentials' && request.method === 'GET') {
      logWithContext('DURABLE_OBJECT', 'Retrieving and decrypting credentials');

      const credentials = await this.getDecryptedCredentials();

      logWithContext('DURABLE_OBJECT', 'Credentials retrieved', {
        hasPrivateKey: !!credentials?.privateKey,
        hasWebhookSecret: !!credentials?.webhookSecret
      });

      return new Response(JSON.stringify(credentials));
    }

    if (url.pathname === '/log-webhook' && request.method === 'POST') {
      const webhookData = await request.json() as { event: string; delivery: string; timestamp: string };

      logWithContext('DURABLE_OBJECT', 'Logging webhook event', {
        event: webhookData.event,
        delivery: webhookData.delivery
      });

      await this.logWebhook(webhookData.event);
      return new Response('OK');
    }

    if (url.pathname === '/update-installation' && request.method === 'POST') {
      const installationData = await request.json() as { installationId: string; repositories: Repository[]; owner: any };

      logWithContext('DURABLE_OBJECT', 'Updating installation', {
        installationId: installationData.installationId,
        repositoryCount: installationData.repositories.length,
        owner: installationData.owner.login
      });

      await this.updateInstallation(installationData.installationId, installationData.repositories);

      // Also update owner information
      const config = await this.getAppConfig();
      if (config) {
        config.owner = installationData.owner;
        await this.storeAppConfig(config);

        logWithContext('DURABLE_OBJECT', 'Installation updated successfully');
      }

      return new Response('OK');
    }

    if (url.pathname === '/add-repository' && request.method === 'POST') {
      const repo = await request.json() as Repository;
      await this.addRepository(repo);
      return new Response('OK');
    }

    if (url.pathname.startsWith('/remove-repository/') && request.method === 'DELETE') {
      const repoId = parseInt(url.pathname.split('/').pop() || '0');
      await this.removeRepository(repoId);
      return new Response('OK');
    }

    if (url.pathname === '/get-installation-token' && request.method === 'GET') {
      logWithContext('DURABLE_OBJECT', 'Generating installation token');

      const token = await this.getInstallationToken();

      logWithContext('DURABLE_OBJECT', 'Installation token generated', {
        hasToken: !!token
      });

      return new Response(JSON.stringify({ token }));
    }

    if (url.pathname === '/store-claude-key' && request.method === 'POST') {
      logWithContext('DURABLE_OBJECT', 'Storing Claude API key');

      const claudeData = await request.json() as { anthropicApiKey: string; claudeSetupAt: string };

      await this.storeClaudeApiKey(claudeData.anthropicApiKey, claudeData.claudeSetupAt);

      logWithContext('DURABLE_OBJECT', 'Claude API key stored successfully');
      return new Response('OK');
    }

    if (url.pathname === '/get-claude-key' && request.method === 'GET') {
      logWithContext('DURABLE_OBJECT', 'Retrieving Claude API key');

      const apiKey = await this.getDecryptedClaudeApiKey();

      logWithContext('DURABLE_OBJECT', 'Claude API key retrieved', {
        hasApiKey: !!apiKey
      });

      return new Response(JSON.stringify({ anthropicApiKey: apiKey }));
    }

    logWithContext('DURABLE_OBJECT', 'Unknown endpoint requested', {
      method: request.method,
      pathname: url.pathname
    });

    return new Response('Not Found', { status: 404 });
  }

  async storeAppConfig(config: GitHubAppConfig): Promise<void> {
    await this.storeAppConfigSQLite(config);
  }

  private async storeAppConfigSQLite(config: GitHubAppConfig): Promise<void> {
    logWithContext('DURABLE_OBJECT', 'Writing app config to SQLite storage', {
      appId: config.appId,
      dataSize: JSON.stringify(config).length
    });

    const now = new Date().toISOString();

    this.storage.sql.exec(
      `INSERT OR REPLACE INTO github_app_config (
        id, app_id, private_key, webhook_secret, installation_id,
        owner_login, owner_type, owner_id, permissions, events,
        repositories, created_at, last_webhook_at, webhook_count, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      config.appId,
      config.privateKey,
      config.webhookSecret,
      config.installationId || null,
      config.owner.login,
      config.owner.type,
      config.owner.id,
      JSON.stringify(config.permissions),
      JSON.stringify(config.events),
      JSON.stringify(config.repositories),
      config.createdAt,
      config.lastWebhookAt || null,
      config.webhookCount || 0,
      now
    );

    logWithContext('DURABLE_OBJECT', 'App config stored successfully in SQLite');
  }

  async getAppConfig(): Promise<GitHubAppConfig | null> {
    logWithContext('DURABLE_OBJECT', 'Reading app config from SQLite storage');

    const cursor = this.storage.sql.exec('SELECT * FROM github_app_config WHERE id = 1 LIMIT 1');
    const results = cursor.toArray();

    if (results.length === 0) {
      logWithContext('DURABLE_OBJECT', 'No app config found in SQLite storage');
      return null;
    }

    const row = results[0];

    const config: GitHubAppConfig = {
      appId: row.app_id as string,
      privateKey: row.private_key as string,
      webhookSecret: row.webhook_secret as string,
      installationId: row.installation_id as string || undefined,
      owner: {
        login: row.owner_login as string,
        type: row.owner_type as "User" | "Organization",
        id: row.owner_id as number
      },
      permissions: JSON.parse(row.permissions as string),
      events: JSON.parse(row.events as string),
      repositories: JSON.parse(row.repositories as string),
      createdAt: row.created_at as string,
      lastWebhookAt: row.last_webhook_at as string || undefined,
      webhookCount: row.webhook_count as number || 0
    };

    logWithContext('DURABLE_OBJECT', 'App config retrieved from SQLite storage', {
      hasConfig: true,
      appId: config.appId,
      repositoryCount: config.repositories.length
    });

    return config;
  }

  async updateInstallation(installationId: string, repositories: Repository[]): Promise<void> {
    const config = await this.getAppConfig();
    if (config) {
      config.installationId = installationId;
      config.repositories = repositories;
      await this.storeAppConfig(config);
    }
  }

  async logWebhook(_event: string): Promise<void> {
    const config = await this.getAppConfig();
    if (config) {
      config.lastWebhookAt = new Date().toISOString();
      config.webhookCount = (config.webhookCount || 0) + 1;
      await this.storeAppConfig(config);
    }
  }

  async addRepository(repo: Repository): Promise<void> {
    const config = await this.getAppConfig();
    if (config) {
      // Check if repository already exists
      const exists = config.repositories.some(r => r.id === repo.id);
      if (!exists) {
        config.repositories.push(repo);
        await this.storeAppConfig(config);
      }
    }
  }

  async removeRepository(repoId: number): Promise<void> {
    const config = await this.getAppConfig();
    if (config) {
      config.repositories = config.repositories.filter(r => r.id !== repoId);
      await this.storeAppConfig(config);
    }
  }

  async getDecryptedCredentials(): Promise<{ privateKey: string; webhookSecret: string } | null> {
    const config = await this.getAppConfig();
    if (!config) {
      logWithContext('DURABLE_OBJECT', 'Cannot decrypt credentials - no config found');
      return null;
    }

    try {
      logWithContext('DURABLE_OBJECT', 'Decrypting credentials');

      const privateKey = await decrypt(config.privateKey);
      const webhookSecret = await decrypt(config.webhookSecret);

      logWithContext('DURABLE_OBJECT', 'Credentials decrypted successfully');
      return { privateKey, webhookSecret };
    } catch (error) {
      logWithContext('DURABLE_OBJECT', 'Failed to decrypt credentials', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async getInstallationToken(): Promise<string | null> {
    const config = await this.getAppConfig();
    if (!config || !config.installationId) {
      logWithContext('DURABLE_OBJECT', 'Cannot generate token - missing config or installation ID', {
        hasConfig: !!config,
        hasInstallationId: !!config?.installationId
      });
      return null;
    }

    try {
      // Check if we have a cached token that's still valid in SQLite
      const cachedToken = await this.getCachedInstallationToken();

      if (cachedToken) {
        const expiresAt = new Date(cachedToken.expires_at);
        const now = new Date();
        const timeUntilExpiry = expiresAt.getTime() - now.getTime();

        logWithContext('DURABLE_OBJECT', 'Checking cached token from SQLite', {
          expiresAt: cachedToken.expires_at,
          timeUntilExpiryMs: timeUntilExpiry
        });

        // Check if token expires in more than 5 minutes
        if (timeUntilExpiry > 5 * 60 * 1000) {
          logWithContext('DURABLE_OBJECT', 'Using cached installation token from SQLite');
          return cachedToken.token;
        } else {
          logWithContext('DURABLE_OBJECT', 'Cached token expired or expiring soon');
        }
      } else {
        logWithContext('DURABLE_OBJECT', 'No cached token found in SQLite');
      }

      // Generate new token
      logWithContext('DURABLE_OBJECT', 'Generating new installation token');

      const credentials = await this.getDecryptedCredentials();
      if (!credentials) {
        logWithContext('DURABLE_OBJECT', 'Cannot generate token - missing credentials');
        return null;
      }

      const tokenData = await generateInstallationToken(
        config.appId,
        credentials.privateKey,
        config.installationId
      );

      if (tokenData) {
        // Cache the token in SQLite
        logWithContext('DURABLE_OBJECT', 'Caching new installation token in SQLite', {
          expiresAt: tokenData.expires_at
        });

        await this.storeInstallationTokenSQLite(tokenData.token, tokenData.expires_at);
        return tokenData.token;
      }

      logWithContext('DURABLE_OBJECT', 'Failed to generate installation token');
      return null;
    } catch (error) {
      logWithContext('DURABLE_OBJECT', 'Error generating installation token', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async getCachedInstallationToken(): Promise<{ token: string; expires_at: string } | null> {
    const cursor = this.storage.sql.exec('SELECT * FROM installation_tokens ORDER BY created_at DESC LIMIT 1');
    const results = cursor.toArray();

    if (results.length === 0) {
      return null;
    }

    const row = results[0];
    return {
      token: row.token as string,
      expires_at: row.expires_at as string
    };
  }

  private async storeInstallationTokenSQLite(token: string, expiresAt: string): Promise<void> {
    const now = new Date().toISOString();

    // Clean up old tokens first
    this.storage.sql.exec('DELETE FROM installation_tokens WHERE expires_at < ?', now);

    // Store new token
    this.storage.sql.exec(
      'INSERT INTO installation_tokens (token, expires_at, created_at) VALUES (?, ?, ?)',
      token,
      expiresAt,
      now
    );
  }

  // Claude Code API key management
  async storeClaudeApiKey(encryptedApiKey: string, setupTimestamp: string): Promise<void> {
    await this.storeClaudeApiKeySQLite(encryptedApiKey, setupTimestamp);
  }

  private async storeClaudeApiKeySQLite(encryptedApiKey: string, setupTimestamp: string): Promise<void> {
    const now = new Date().toISOString();

    this.storage.sql.exec(
      `INSERT OR REPLACE INTO claude_config (
        id, anthropic_api_key, claude_setup_at, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?)`,
      encryptedApiKey,
      setupTimestamp,
      now,
      now
    );
  }

  async getDecryptedClaudeApiKey(): Promise<string | null> {
    try {
      const cursor = this.storage.sql.exec('SELECT * FROM claude_config WHERE id = 1 LIMIT 1');
      const results = cursor.toArray();

      if (results.length === 0) {
        logWithContext('DURABLE_OBJECT', 'No Claude config found in SQLite storage');
        return null;
      }

      const row = results[0];

      logWithContext('DURABLE_OBJECT', 'Decrypting Claude API key from SQLite', {
        setupAt: row.claude_setup_at
      });

      const decryptedKey = await decrypt(row.anthropic_api_key as string);

      logWithContext('DURABLE_OBJECT', 'Claude API key decrypted successfully');
      return decryptedKey;
    } catch (error) {
      logWithContext('DURABLE_OBJECT', 'Failed to decrypt Claude API key from SQLite', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  // SQLite-specific enhancement methods
  async getWebhookStats(): Promise<{ totalWebhooks: number; lastWebhookAt: string | null }> {
    const cursor = this.storage.sql.exec(`
      SELECT webhook_count, last_webhook_at
      FROM github_app_config
      WHERE id = 1
      LIMIT 1
    `);
    const results = cursor.toArray();

    if (results.length === 0) {
      return { totalWebhooks: 0, lastWebhookAt: null };
    }

    const row = results[0];
    return {
      totalWebhooks: row.webhook_count as number || 0,
      lastWebhookAt: row.last_webhook_at as string || null
    };
  }

  async cleanupExpiredTokens(): Promise<number> {
    const now = new Date().toISOString();
    const cursor = this.storage.sql.exec(
      'DELETE FROM installation_tokens WHERE expires_at < ?',
      now
    );

    const deletedCount = cursor.rowsWritten || 0;
    logWithContext('DURABLE_OBJECT', 'Cleaned up expired tokens', {
      deletedCount,
      timestamp: now
    });

    return deletedCount;
  }

  async getAllRepositories(): Promise<Repository[]> {
    const config = await this.getAppConfig();
    return config?.repositories || [];
  }

  async getInstallationStats(): Promise<{
    appId: string | null;
    repositoryCount: number;
    hasClaudeConfig: boolean;
    installationId: string | null;
    createdAt: string | null;
  }> {
    const config = await this.getAppConfig();
    const claudeCursor = this.storage.sql.exec('SELECT COUNT(*) as count FROM claude_config');
    const claudeResults = claudeCursor.toArray();
    const hasClaudeConfig = claudeResults.length > 0 && (claudeResults[0].count as number) > 0;

    return {
      appId: config?.appId || null,
      repositoryCount: config?.repositories.length || 0,
      hasClaudeConfig,
      installationId: config?.installationId || null,
      createdAt: config?.createdAt || null
    };
  }
}

export class MyContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = '45s'; // Extended timeout for Claude Code processing
  envVars: Record<string, string> = {
    MESSAGE: 'I was passed in via the container class!',
  };

  // Override fetch to handle environment variable setting for specific requests
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    logWithContext('CONTAINER', 'Container request received', {
      method: request.method,
      pathname: url.pathname,
      headers: Object.fromEntries(request.headers.entries())
    });

    // Handle process-issue requests by setting environment variables
    if (url.pathname === '/process-issue' && request.method === 'POST') {
      logWithContext('CONTAINER', 'Processing issue request');

      try {
        const issueContext = await request.json() as Record<string, any>;

        logWithContext('CONTAINER', 'Issue context received', {
          issueId: issueContext.ISSUE_ID,
          repository: issueContext.REPOSITORY_NAME,
          envVarCount: Object.keys(issueContext).length
        });

        // Set environment variables for this container instance
        let envVarsSet = 0;
        Object.entries(issueContext).forEach(([key, value]) => {
          if (typeof value === 'string') {
            this.envVars[key] = value;
            envVarsSet++;
          }
        });

        logWithContext('CONTAINER', 'Environment variables set', {
          envVarsSet,
          totalEnvVars: Object.keys(issueContext).length
        });

        logWithContext('CONTAINER', 'Forwarding request to container');

        // Create a new request with the JSON data to avoid ReadableStream being disturbed
        const newRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: JSON.stringify(issueContext)
        });

        const response = await super.fetch(newRequest);

        logWithContext('CONTAINER', 'Container response received', {
          status: response.status,
          statusText: response.statusText
        });

        return response;
      } catch (error) {
        logWithContext('CONTAINER', 'Error processing issue request', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });

        return new Response(JSON.stringify({
          error: 'Failed to process issue context',
          message: (error as Error).message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // For all other requests, use default behavior
    logWithContext('CONTAINER', 'Using default container behavior');
    return super.fetch(request);
  }

  override onStart() {
    logWithContext('CONTAINER_LIFECYCLE', 'Container started successfully', {
      port: this.defaultPort,
      sleepAfter: this.sleepAfter
    });
  }

  override onStop() {
    logWithContext('CONTAINER_LIFECYCLE', 'Container shut down successfully');
  }

  override onError(error: unknown) {
    logWithContext('CONTAINER_LIFECYCLE', 'Container error occurred', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default {
  async fetch(
    request: Request,
    env: { MY_CONTAINER: DurableObjectNamespace<Container<unknown>> }
  ): Promise<Response> {
    const startTime = Date.now();
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Log all incoming requests
    logWithContext('MAIN_HANDLER', 'Incoming request', {
      method: request.method,
      pathname,
      origin: url.origin,
      userAgent: request.headers.get('user-agent'),
      contentType: request.headers.get('content-type'),
      referer: request.headers.get('referer'),
      cfRay: request.headers.get('cf-ray'),
      cfCountry: request.headers.get('cf-ipcountry')
    });

    let response: Response;
    let routeMatched = false;

    try {
      // Claude Code Setup Route
      if (pathname === '/claude-setup') {
        logWithContext('MAIN_HANDLER', 'Routing to Claude setup');
        routeMatched = true;
        response = await handleClaudeSetup(request, url.origin, env);
      }

      // GitHub App Setup Routes
      else if (pathname === '/gh-setup') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub setup');
        routeMatched = true;
        response = await handleGitHubSetup(request, url.origin);
      }

      else if (pathname === '/gh-setup/callback') {
        logWithContext('MAIN_HANDLER', 'Routing to OAuth callback');
        routeMatched = true;
        response = await handleOAuthCallback(request, url, env);
      }

      // Status endpoint to check stored configurations
      else if (pathname === '/gh-status') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub status');
        routeMatched = true;
        response = await handleGitHubStatus(request, env);
      }

      // GitHub webhook endpoint
      else if (pathname === '/webhooks/github') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub webhook handler');
        routeMatched = true;
        response = await handleGitHubWebhook(request, env);
      }

      // Container routes
      else if (pathname.startsWith('/container')) {
        logWithContext('MAIN_HANDLER', 'Routing to basic container');
        routeMatched = true;
        let id = env.MY_CONTAINER.idFromName('container');
        let container = env.MY_CONTAINER.get(id);
        response = await containerFetch(container, request, {
          containerName: 'container',
          route: getRouteFromRequest(request),
          env
        });
      }

      else if (pathname.startsWith('/error')) {
        logWithContext('MAIN_HANDLER', 'Routing to error test container');
        routeMatched = true;
        let id = env.MY_CONTAINER.idFromName('error-test');
        let container = env.MY_CONTAINER.get(id);
        response = await containerFetch(container, request, {
          containerName: 'error-test',
          route: getRouteFromRequest(request),
          env
        });
      }

      else if (pathname.startsWith('/lb')) {
        logWithContext('MAIN_HANDLER', 'Routing to load balanced containers');
        routeMatched = true;
        let container = await loadBalance(env.MY_CONTAINER, 3);
        response = await containerFetch(container, request, {
          containerName: 'load-balanced',
          route: getRouteFromRequest(request),
          env
        });
      }

      else if (pathname.startsWith('/singleton')) {
        logWithContext('MAIN_HANDLER', 'Routing to singleton container');
        routeMatched = true;
        const container: DurableObjectStub<Container<unknown>> = getContainer(env.MY_CONTAINER);
        response = await containerFetch(container, request, {
          containerName: 'singleton',
          route: getRouteFromRequest(request),
          env
        });
      }

      // Default home page
      else {
        logWithContext('MAIN_HANDLER', 'Serving home page');
        routeMatched = true;
        response = new Response(`
🤖 Claude Code Container Integration

Setup Instructions:
1. Configure Claude Code: /claude-setup
2. Setup GitHub Integration: /gh-setup

Container Testing Routes:
- /container - Basic container health check
- /lb - Load balancing over multiple containers
- /error - Test error handling
- /singleton - Single container instance

Once both setups are complete, create GitHub issues to trigger automatic Claude Code processing!
        `);
      }

      const processingTime = Date.now() - startTime;

      logWithContext('MAIN_HANDLER', 'Request completed successfully', {
        pathname,
        method: request.method,
        status: response.status,
        statusText: response.statusText,
        processingTimeMs: processingTime,
        routeMatched
      });

      return response;

    } catch (error) {
      const processingTime = Date.now() - startTime;

      logWithContext('MAIN_HANDLER', 'Request failed with error', {
        pathname,
        method: request.method,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs: processingTime,
        routeMatched
      });

      return new Response(JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
};
