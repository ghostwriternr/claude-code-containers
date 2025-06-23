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
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          min-height: 100vh;
        }
        .container { 
          max-width: 800px; 
          margin: 0 auto; 
          background: rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          padding: 40px;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px rgba(31, 38, 135, 0.37);
        }
        h1 { 
          font-size: 3em; 
          margin: 0 0 20px 0; 
          text-align: center;
          background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .subtitle { 
          text-align: center; 
          font-size: 1.2em; 
          margin-bottom: 40px; 
          opacity: 0.9;
        }
        .button { 
          background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
          color: white; 
          padding: 15px 30px; 
          text-decoration: none; 
          border-radius: 50px; 
          display: inline-block; 
          margin: 10px; 
          transition: transform 0.2s, box-shadow 0.2s;
          font-weight: 600;
          border: none;
          cursor: pointer;
        }
        .button:hover { 
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(255, 107, 107, 0.3);
        }
        .button.secondary {
          background: rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(10px);
        }
        .setup-section { 
          margin: 40px 0; 
          padding: 30px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 15px;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .step { 
          margin: 20px 0; 
          padding: 20px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          border-left: 4px solid #4ecdc4;
        }
        .feature-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin: 30px 0;
        }
        .feature {
          background: rgba(255, 255, 255, 0.1);
          padding: 25px;
          border-radius: 15px;
          text-align: center;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .feature-icon {
          font-size: 2.5em;
          margin-bottom: 15px;
        }
        .status-indicator {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #4ecdc4;
          margin-right: 8px;
        }
        code {
          background: rgba(0, 0, 0, 0.3);
          padding: 4px 8px;
          border-radius: 6px;
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        }
        .endpoint-list {
          background: rgba(0, 0, 0, 0.2);
          padding: 20px;
          border-radius: 10px;
          margin: 20px 0;
        }
        .endpoint {
          margin: 8px 0;
          font-family: monospace;
        }
        .method {
          background: #4ecdc4;
          color: white;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.8em;
          margin-right: 10px;
        }
        @media (max-width: 600px) {
          body { padding: 20px; }
          h1 { font-size: 2em; }
          .button { display: block; text-align: center; margin: 10px 0; }
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

        <div class="setup-section">
          <h2>🔗 API Endpoints</h2>
          <div class="endpoint-list">
            <div class="endpoint">
              <span class="method">GET</span>
              <code>/api/v1/status</code> - System status and configuration
            </div>
            <div class="endpoint">
              <span class="method">POST</span>
              <code>/setup/claude</code> - Configure Anthropic API key
            </div>
            <div class="endpoint">
              <span class="method">GET</span>
              <code>/setup/github/create</code> - Create GitHub App
            </div>
            <div class="endpoint">
              <span class="method">POST</span>
              <code>/webhooks/github</code> - GitHub webhook processor
            </div>
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