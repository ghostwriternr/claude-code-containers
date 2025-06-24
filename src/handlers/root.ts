/**
 * Root endpoint handler
 * Provides welcome page and setup status
 */

import { logWithContext } from '../log';
import { jsonResponse } from '../router';

/**
 * Handle root endpoint
 * GET /
 */
export async function handleRoot(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const acceptHeader = request.headers.get('Accept') || '';
  const workerUrl = getWorkerUrl(request);

  logWithContext('ROOT', 'Root endpoint accessed', {
    userAgent: request.headers.get('user-agent')?.substring(0, 50),
    acceptsJson: acceptHeader.includes('application/json')
  });

  // Return JSON for API clients
  if (acceptHeader.includes('application/json')) {
    return jsonResponse({
      name: 'Claude Code Assistant',
      description: 'AI-powered code assistant running on Cloudflare Workers',
      version: '2.0.0',
      status: 'healthy',
      endpoints: {
        status: `${workerUrl}/api/v1/status`,
        setup: {
          claude: `${workerUrl}/setup/claude`,
          github: `${workerUrl}/setup/github/create`
        },
        webhooks: {
          github: `${workerUrl}/webhooks/github`
        }
      },
      documentation: 'https://docs.anthropic.com/en/docs/claude-code',
      repository: 'https://github.com/anthropics/claude-code-containers'
    });
  }

  // Return HTML for browsers
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Claude Code Assistant</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
          margin: 0; 
          padding: 40px; 
          background: #f8fafc;
          color: #1e293b;
          min-height: 100vh;
          line-height: 1.6;
        }
        .container { 
          max-width: 800px; 
          margin: 0 auto; 
          background: white;
          border-radius: 16px;
          padding: 48px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          border: 1px solid #e2e8f0;
        }
        h1 { 
          font-size: 2.5em; 
          margin: 0 0 16px 0; 
          text-align: center;
          color: #0f172a;
          font-weight: 700;
        }
        .subtitle { 
          text-align: center; 
          font-size: 1.1em; 
          margin-bottom: 48px; 
          color: #64748b;
        }
        .button { 
          background: #3b82f6;
          color: white; 
          padding: 12px 24px; 
          text-decoration: none; 
          border-radius: 8px; 
          display: inline-block; 
          margin: 8px; 
          transition: all 0.2s;
          font-weight: 500;
          border: none;
          cursor: pointer;
          font-size: 14px;
        }
        .button:hover { 
          background: #2563eb;
          transform: translateY(-1px);
        }
        .button.secondary {
          background: #f1f5f9;
          color: #475569;
          border: 1px solid #e2e8f0;
        }
        .button.secondary:hover {
          background: #e2e8f0;
          color: #334155;
        }
        .setup-section { 
          margin: 48px 0; 
          padding: 32px;
          background: #f8fafc;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
        }
        .step { 
          margin: 24px 0; 
          padding: 24px;
          background: white;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          border-left: 4px solid #3b82f6;
        }
        .step h3 {
          margin: 0 0 8px 0;
          color: #0f172a;
          font-size: 1.1em;
        }
        .step p {
          margin: 0 0 16px 0;
          color: #64748b;
        }
        .feature-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 24px;
          margin: 40px 0;
        }
        .feature {
          background: white;
          padding: 32px 24px;
          border-radius: 12px;
          text-align: center;
          border: 1px solid #e2e8f0;
          transition: all 0.2s;
        }
        .feature:hover {
          border-color: #cbd5e1;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .feature-icon {
          font-size: 2.5em;
          margin-bottom: 16px;
        }
        .feature h3 {
          margin: 0 0 8px 0;
          color: #0f172a;
          font-size: 1.1em;
        }
        .feature p {
          margin: 0;
          color: #64748b;
          font-size: 0.9em;
        }
        .status-indicator {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
          margin-right: 8px;
        }
        code {
          background: #f1f5f9;
          color: #475569;
          padding: 4px 6px;
          border-radius: 4px;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
          font-size: 0.85em;
        }
        .setup-section h2 {
          margin: 0 0 24px 0;
          color: #0f172a;
          display: flex;
          align-items: center;
        }
        @media (max-width: 600px) {
          body { padding: 20px; }
          .container { padding: 24px; }
          h1 { font-size: 2em; }
          .button { display: block; text-align: center; margin: 8px 0; }
          .feature-grid { grid-template-columns: 1fr; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Claude Code Assistant</h1>
        <p class="subtitle">AI-powered code assistant running on Cloudflare Workers</p>
        
        <div class="feature-grid">
          <div class="feature">
            <div class="feature-icon">⚡</div>
            <h3>Lightning Fast</h3>
            <p>Powered by Cloudflare's global edge network for instant responses</p>
          </div>
          <div class="feature">
            <div class="feature-icon">🔒</div>
            <h3>Secure</h3>
            <p>Your credentials stored safely in encrypted Durable Objects</p>
          </div>
          <div class="feature">
            <div class="feature-icon">🚀</div>
            <h3>Zero Config</h3>
            <p>One-click deployment and setup with automatic GitHub integration</p>
          </div>
        </div>

        <div class="setup-section">
          <h2><span class="status-indicator"></span>Quick Setup</h2>
          <div class="step">
            <h3>1. Configure Claude API</h3>
            <p>Store your Anthropic API key securely</p>
            <a href="${workerUrl}/setup/claude" class="button">Configure Claude</a>
          </div>
          <div class="step">
            <h3>2. Create GitHub App</h3>
            <p>One-click GitHub integration setup</p>
            <a href="${workerUrl}/setup/github/create" class="button">Setup GitHub</a>
          </div>
          <div class="step">
            <h3>3. Check Status</h3>
            <p>Verify your configuration and get next steps</p>
            <a href="${workerUrl}/api/v1/status" class="button secondary">View Status</a>
          </div>
        </div>

        <div style="text-align: center; margin-top: 40px;">
          <a href="https://docs.anthropic.com/en/docs/claude-code" class="button secondary" target="_blank">
            📚 Documentation
          </a>
          <a href="https://github.com/anthropics/claude-code-containers" class="button secondary" target="_blank">
            💻 GitHub Repository
          </a>
        </div>
      </div>
    </body>
    </html>
  `, {
    headers: { 
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

/**
 * Get worker URL from request
 */
function getWorkerUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}