/**
 * GitHub App setup handlers
 * Handles GitHub App creation, OAuth flow, and installation
 */

import { logWithContext } from '../../log';
import { jsonResponse, errorResponse } from '../../router';
import { encrypt } from '../../crypto';

// Type definitions
interface GitHubAppConfig {
  appId: string;
  appName: string;
  slug: string;
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

interface GitHubAppManifestResponse {
  id: number;
  slug: string;
  name: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string;
  pem: string;
}

/**
 * Initiate GitHub App creation
 * GET /setup/github/create
 */
export async function handleGitHubAppCreation(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const workerUrl = getWorkerUrl(request);
    
    logWithContext('GITHUB_SETUP', 'Creating GitHub App', { workerUrl });

    // Generate GitHub App manifest
    const manifest = {
      name: `Claude Code Assistant (${generateUniqueId()})`,
      description: 'AI-powered code assistant that automatically processes GitHub issues and creates pull requests',
      url: 'https://claude.ai/code',
      setup_url: `${workerUrl}/`,
      hook_attributes: {
        url: `${workerUrl}/webhooks/github`,
        active: true
      },
      redirect_url: `${workerUrl}/setup/github/callback`,
      callback_urls: [`${workerUrl}/setup/github/callback`],
      public: false,
      default_events: ['issues', 'issue_comment', 'pull_request', 'pull_request_review'],
      default_permissions: {
        issues: 'write',
        pull_requests: 'write',
        contents: 'write',
        metadata: 'read',
        repository_projects: 'read'
      }
    };

    // GitHub App creation URL
    const githubUrl = 'https://github.com/settings/apps/new?' + 
      new URLSearchParams({ manifest: JSON.stringify(manifest) }).toString();

    logWithContext('GITHUB_SETUP', 'GitHub App manifest generated', {
      appName: manifest.name,
      webhookUrl: manifest.hook_attributes.url
    });

    // Return redirect or JSON based on Accept header
    const acceptHeader = request.headers.get('Accept') || '';
    
    if (acceptHeader.includes('application/json')) {
      return jsonResponse({
        success: true,
        message: 'GitHub App manifest generated',
        githubUrl,
        manifest,
        nextStep: {
          description: 'Visit the GitHub URL to create your app',
          url: githubUrl
        }
      });
    } else {
      // HTML form for browser - GitHub requires POST with manifest in form data
      const manifestJson = JSON.stringify(manifest);
      
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>GitHub App Setup - Claude Code Assistant</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              max-width: 800px;
              margin: 40px auto;
              padding: 20px;
              line-height: 1.6;
              color: #333;
            }
            .header {
              text-align: center;
              margin-bottom: 40px;
            }
            .webhook-info {
              background: #f5f5f5;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .webhook-url {
              font-family: monospace;
              background: #fff;
              padding: 10px;
              border: 1px solid #ddd;
              border-radius: 4px;
              word-break: break-all;
            }
            .create-app-btn {
              background: #238636;
              color: white;
              padding: 12px 24px;
              border: none;
              border-radius: 6px;
              font-weight: 600;
              margin: 20px 0;
              cursor: pointer;
              font-size: 14px;
              width: 100%;
              max-width: 300px;
            }
            .create-app-btn:hover {
              background: #2ea043;
            }
            .steps {
              margin: 30px 0;
            }
            .step {
              margin: 15px 0;
              padding-left: 30px;
              position: relative;
            }
            .step-number {
              position: absolute;
              left: 0;
              top: 0;
              background: #0969da;
              color: white;
              width: 20px;
              height: 20px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 12px;
              font-weight: bold;
            }
            .form-container {
              text-align: center;
              margin: 40px 0;
            }
            details {
              margin: 20px 0;
              text-align: left;
            }
            pre {
              background: #f8f8f8;
              padding: 15px;
              border-radius: 4px;
              overflow-x: auto;
              font-size: 12px;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>GitHub App Setup</h1>
            <p>Configure GitHub webhook integration for Claude Code Assistant</p>
          </div>

          <div class="webhook-info">
            <h3>Your Webhook URL</h3>
            <div class="webhook-url">${manifest.hook_attributes.url}</div>
            <p>This URL will receive GitHub webhook events once setup is complete.</p>
          </div>

          <div class="steps">
            <h3>Setup Steps</h3>

            <div class="step">
              <div class="step-number">1</div>
              <strong>Create GitHub App</strong><br>
              Click the button below to create a pre-configured GitHub App with all necessary permissions and webhook settings.
            </div>

            <div class="step">
              <div class="step-number">2</div>
              <strong>Choose Account</strong><br>
              Select which GitHub account or organization should own the app.
            </div>

            <div class="step">
              <div class="step-number">3</div>
              <strong>Install App</strong><br>
              After creation, you'll be guided to install the app on your repositories.
            </div>
          </div>

          <div class="form-container">
            <form action="https://github.com/settings/apps/new" method="post" id="github-app-form">
              <input type="hidden" name="manifest" id="manifest" value="">
              <button type="submit" class="create-app-btn">
                Create GitHub App
              </button>
            </form>
          </div>

          <details>
            <summary>App Configuration Details</summary>
            <pre>
App Name: ${manifest.name}
Webhook URL: ${manifest.hook_attributes.url}
Callback URL: ${manifest.redirect_url}

Permissions:
- Repository contents: write
- Repository metadata: read  
- Pull requests: write
- Issues: write
- Repository projects: read

Webhook Events:
- issues
- issue_comment
- pull_request
- pull_request_review
            </pre>
            
            <details>
              <summary>Full Manifest JSON</summary>
              <pre>${JSON.stringify(manifest, null, 2)}</pre>
            </details>
          </details>

          <script>
            // Set the manifest data when the page loads
            document.getElementById('manifest').value = ${JSON.stringify(manifestJson)};
          </script>
        </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

  } catch (error) {
    logWithContext('GITHUB_SETUP', 'GitHub App creation error', {
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to create GitHub App manifest', 500);
  }
}

/**
 * Handle GitHub OAuth callback
 * GET /setup/github/callback
 */
export async function handleGitHubCallback(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');

    if (!code) {
      logWithContext('GITHUB_SETUP', 'GitHub callback missing code');
      return errorResponse('Missing authorization code', 400);
    }

    logWithContext('GITHUB_SETUP', 'Processing GitHub callback', {
      codePrefix: code.substring(0, 10) + '...'
    });

    // Exchange code for app credentials
    const response = await fetch('https://api.github.com/app-manifests/' + code + '/conversions', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Claude-Code-Assistant'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      logWithContext('GITHUB_SETUP', 'GitHub API error', { error, status: response.status });
      return errorResponse('Failed to exchange authorization code', 500);
    }

    const appData = await response.json() as GitHubAppManifestResponse;

    logWithContext('GITHUB_SETUP', 'GitHub App created successfully', {
      appId: appData.id,
      appName: appData.name,
      slug: appData.slug
    });

    // Store app credentials in Durable Objects
    const configId = env.GITHUB_APP_CONFIG.idFromName('claude-config');
    const configDO = env.GITHUB_APP_CONFIG.get(configId);

    // Encrypt sensitive data before storage
    const encryptedPrivateKey = await encrypt(appData.pem);
    const encryptedWebhookSecret = await encrypt(appData.webhook_secret);

    // Format data to match the GitHubAppConfig interface expected by the Durable Object
    const appConfig = {
      appId: appData.id.toString(),
      appName: appData.name,
      slug: appData.slug,
      privateKey: encryptedPrivateKey,
      webhookSecret: encryptedWebhookSecret,
      installationId: '', // Will be set later during installation
      owner: {
        login: '', // Will be set during installation
        type: '',
        id: 0
      },
      permissions: {
        issues: 'write',
        pull_requests: 'write',
        contents: 'write',
        metadata: 'read',
        repository_projects: 'read'
      },
      events: ['issues', 'issue_comment', 'pull_request', 'pull_request_review'],
      repositories: [] // Will be populated during installation
    };

    const storeResponse = await configDO.fetch(new Request('http://internal/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appConfig)
    }));

    if (!storeResponse.ok) {
      const error = await storeResponse.text();
      logWithContext('GITHUB_SETUP', 'Failed to store app credentials', { error });
      return errorResponse('Failed to store app credentials', 500);
    }

    // Redirect to installation page
    const installUrl = `/setup/github/install?app_id=${appData.id}`;
    
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>GitHub App Created!</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; text-align: center; }
          .container { max-width: 600px; margin: 0 auto; }
          .success { color: #1a7f37; }
          .button { background: #0969da; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 20px 0; }
          .button:hover { background: #0860ca; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1 class="success">✅ GitHub App Created!</h1>
          <p><strong>${appData.name}</strong> has been created successfully.</p>
          <p>Now let's install it to your repositories.</p>
          <a href="${installUrl}" class="button">Continue to Installation</a>
        </div>
      </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error) {
    logWithContext('GITHUB_SETUP', 'GitHub callback error', {
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to process GitHub callback', 500);
  }
}

/**
 * Show GitHub App installation page
 * GET /setup/github/install
 */
export async function handleGitHubInstall(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const url = new URL(request.url);
    const appId = url.searchParams.get('app_id');

    if (!appId) {
      return errorResponse('Missing app_id parameter', 400);
    }

    logWithContext('GITHUB_SETUP', 'Showing installation page', { appId });

    // Get app details from Durable Objects
    const configId = env.GITHUB_APP_CONFIG.idFromName('claude-config');
    const configDO = env.GITHUB_APP_CONFIG.get(configId);
    
    const appResponse = await configDO.fetch(new Request('http://internal/get'));
    
    if (!appResponse.ok) {
      return errorResponse('App configuration not found', 404);
    }

    const appInfo = await appResponse.json() as GitHubAppConfig;
    const workerUrl = getWorkerUrl(request);

    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Install GitHub App</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; text-align: center; }
          .container { max-width: 600px; margin: 0 auto; }
          .button { background: #0969da; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 20px 0; }
          .button:hover { background: #0860ca; }
          .info { background: #f6f8fa; padding: 16px; border-radius: 6px; margin: 20px 0; text-align: left; }
          .webhook-url { font-family: monospace; background: #f1f3f4; padding: 4px 8px; border-radius: 3px; word-break: break-all; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎉 Almost Done!</h1>
          <p>Your GitHub App <strong>${appInfo.appName}</strong> is ready.</p>
          <p>Install it to your repositories to start using Claude Code Assistant.</p>
          
          <a href="https://github.com/apps/${appInfo.slug}/installations/new" class="button">
            Install GitHub App
          </a>
          
          <div class="info">
            <h3>✅ Setup Complete</h3>
            <p><strong>Webhook URL:</strong><br>
            <code class="webhook-url">${workerUrl}/webhooks/github</code></p>
            
            <p><strong>What happens next:</strong></p>
            <ul style="text-align: left;">
              <li>Install the app to repositories you want Claude to help with</li>
              <li>Create issues in those repositories</li>
              <li>Claude will automatically analyze and work on them</li>
              <li>Watch for progress comments and pull requests!</li>
            </ul>
          </div>
          
          <p><small>You can always check your setup status at <a href="/api/v1/status">/api/v1/status</a></small></p>
        </div>
      </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error) {
    logWithContext('GITHUB_SETUP', 'GitHub install page error', {
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to show installation page', 500);
  }
}

/**
 * Extract worker URL from request
 */
function getWorkerUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Generate unique identifier for app name
 */
function generateUniqueId(): string {
  return Math.random().toString(36).substring(2, 8);
}