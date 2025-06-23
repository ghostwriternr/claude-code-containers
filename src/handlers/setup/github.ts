/**
 * GitHub App setup handlers
 * Handles GitHub App creation, OAuth flow, and installation
 */

import { logWithContext } from '../../log';
import { jsonResponse, errorResponse } from '../../router';

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
      // HTML redirect for browser
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Creating GitHub App...</title>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; text-align: center; }
            .container { max-width: 600px; margin: 0 auto; }
            .button { background: #0969da; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 20px 0; }
            .button:hover { background: #0860ca; }
            pre { background: #f6f8fa; padding: 16px; border-radius: 6px; text-align: left; overflow-x: auto; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🤖 Claude Code Assistant Setup</h1>
            <p>Step 2: Create your GitHub App</p>
            <p>Click the button below to create a GitHub App for your Claude Code Assistant.</p>
            <a href="${githubUrl}" class="button">Create GitHub App</a>
            <p><small>This will redirect you to GitHub to create and configure your app automatically.</small></p>
            
            <details>
              <summary>App Configuration</summary>
              <pre>${JSON.stringify(manifest, null, 2)}</pre>
            </details>
          </div>
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

    const appData = await response.json() as {
      id: number;
      slug: string;
      name: string;
      client_id: string;
      client_secret: string;
      webhook_secret: string;
      pem: string;
    };

    logWithContext('GITHUB_SETUP', 'GitHub App created successfully', {
      appId: appData.id,
      appName: appData.name,
      slug: appData.slug
    });

    // Store app credentials in Durable Objects
    const configId = env.GITHUB_APP_CONFIG.idFromName(appData.id.toString());
    const configDO = env.GITHUB_APP_CONFIG.get(configId);

    const storeResponse = await configDO.fetch(new Request('http://internal/store-credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: appData.id.toString(),
        clientId: appData.client_id,
        clientSecret: appData.client_secret,
        webhookSecret: appData.webhook_secret,
        privateKey: appData.pem,
        appName: appData.name,
        slug: appData.slug
      })
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
    const configId = env.GITHUB_APP_CONFIG.idFromName(appId);
    const configDO = env.GITHUB_APP_CONFIG.get(configId);
    
    const appResponse = await configDO.fetch(new Request('http://internal/get-app-info'));
    
    if (!appResponse.ok) {
      return errorResponse('App configuration not found', 404);
    }

    const appInfo = await appResponse.json() as { appName: string; slug: string };
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
          
          <a href="https://github.com/apps/${appInfo.slug}/installations/new" class="button" target="_blank">
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