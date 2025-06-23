/**
 * Durable Objects implementations for GitHub App configuration and container management
 */

import { Container } from '@cloudflare/containers';
import { decrypt, generateInstallationToken } from './crypto';
import { logWithContext } from './log';

/**
 * GitHub App Configuration Durable Object
 * Stores encrypted GitHub app credentials and manages installation tokens
 */
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

    return new Response('Not Found', { status: 404 });
  }

  private async storeAppConfig(config: GitHubAppConfig): Promise<void> {
    const now = new Date().toISOString();
    
    this.storage.sql.exec(
      `INSERT OR REPLACE INTO github_app_config 
       (id, app_id, private_key, webhook_secret, installation_id, owner_login, owner_type, owner_id, permissions, events, repositories, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      config.appId,
      config.privateKey,
      config.webhookSecret,
      config.installationId,
      config.owner.login,
      config.owner.type,
      config.owner.id,
      JSON.stringify(config.permissions),
      JSON.stringify(config.events),
      JSON.stringify(config.repositories),
      now,
      now
    );
  }

  private async getAppConfig(): Promise<GitHubAppConfig | null> {
    const result = this.storage.sql.exec(
      `SELECT * FROM github_app_config WHERE id = 1`
    ).one();

    if (!result) return null;

    return {
      appId: result.app_id as string,
      privateKey: result.private_key as string,
      webhookSecret: result.webhook_secret as string,
      installationId: result.installation_id as string,
      owner: {
        login: result.owner_login as string,
        type: result.owner_type as string,
        id: result.owner_id as number,
      },
      permissions: JSON.parse(result.permissions as string),
      events: JSON.parse(result.events as string),
      repositories: JSON.parse(result.repositories as string),
    };
  }

  private async getDecryptedCredentials(): Promise<{ privateKey: string; webhookSecret: string } | null> {
    const config = await this.getAppConfig();
    if (!config) return null;

    try {
      const privateKey = await decrypt(config.privateKey);
      const webhookSecret = await decrypt(config.webhookSecret);
      return { privateKey, webhookSecret };
    } catch (error) {
      logWithContext('DURABLE_OBJECT', 'Failed to decrypt credentials', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async logWebhook(_event: string): Promise<void> {
    const now = new Date().toISOString();
    
    this.storage.sql.exec(
      `UPDATE github_app_config SET last_webhook_at = ?, webhook_count = webhook_count + 1, updated_at = ? WHERE id = 1`,
      now, now
    );
  }

  private async updateInstallation(installationId: string, repositories: Repository[]): Promise<void> {
    const now = new Date().toISOString();
    
    this.storage.sql.exec(
      `UPDATE github_app_config SET installation_id = ?, repositories = ?, updated_at = ? WHERE id = 1`,
      installationId,
      JSON.stringify(repositories),
      now
    );
  }

  private async addRepository(repo: Repository): Promise<void> {
    const config = await this.getAppConfig();
    if (!config) return;

    const repositories = [...config.repositories, repo];
    await this.updateInstallation(config.installationId, repositories);
  }

  private async removeRepository(repoId: number): Promise<void> {
    const config = await this.getAppConfig();
    if (!config) return;

    const repositories = config.repositories.filter(repo => repo.id !== repoId);
    await this.updateInstallation(config.installationId, repositories);
  }

  private async getInstallationToken(): Promise<string | null> {
    // Check for cached token first
    const cachedResult = this.storage.sql.exec(
      `SELECT token, expires_at FROM installation_tokens ORDER BY created_at DESC LIMIT 1`
    ).one();

    if (cachedResult) {
      const expiresAt = new Date(cachedResult.expires_at as string);
      const now = new Date();
      
      // If token expires in more than 5 minutes, use cached token
      if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
        return cachedResult.token as string;
      }
    }

    // Generate new token
    const credentials = await this.getDecryptedCredentials();
    if (!credentials) return null;

    const config = await this.getAppConfig();
    if (!config?.installationId) return null;

    try {
      const tokenResponse = await generateInstallationToken(
        config.appId,
        credentials.privateKey,
        config.installationId
      );

      if (!tokenResponse) return null;

      // Cache the token
      const now = new Date().toISOString();

      this.storage.sql.exec(
        `INSERT INTO installation_tokens (token, expires_at, created_at) VALUES (?, ?, ?)`,
        tokenResponse.token, tokenResponse.expires_at, now
      );

      return tokenResponse.token;
    } catch (error) {
      logWithContext('DURABLE_OBJECT', 'Failed to generate installation token', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async storeClaudeApiKey(apiKey: string, setupAt: string): Promise<void> {
    const now = new Date().toISOString();
    
    this.storage.sql.exec(
      `INSERT OR REPLACE INTO claude_config 
       (id, anthropic_api_key, claude_setup_at, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?)`,
      apiKey, setupAt, now, now
    );
  }

  private async getDecryptedClaudeApiKey(): Promise<string | null> {
    const result = this.storage.sql.exec(
      `SELECT anthropic_api_key FROM claude_config WHERE id = 1`
    ).one();

    if (!result) return null;

    try {
      return await decrypt(result.anthropic_api_key as string);
    } catch (error) {
      logWithContext('DURABLE_OBJECT', 'Failed to decrypt Claude API key', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}

/**
 * Container Durable Object
 * Extends Container class with claude-code-action integration
 */
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

// Type definitions
interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  installationId: string;
  owner: {
    login: string;
    type: string;
    id: number;
  };
  permissions: Record<string, string>;
  events: string[];
  repositories: Repository[];
}

interface Repository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  clone_url: string;
}