/**
 * Claude API key setup handler
 * Secure storage of Anthropic API keys in Durable Objects
 */

import { logWithContext } from '../../log';
import { jsonResponse, errorResponse } from '../../router';
import { encrypt } from '../../crypto';

/**
 * Handle Claude API key configuration
 * POST /setup/claude
 */
export async function handleClaudeSetup(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    // Handle form submission only
    const formData = await request.formData();
    const apiKey = (formData.get('anthropic_api_key') as string || '').trim();
    
    if (!apiKey) {
      return getSetupFormResponse('Please enter your Anthropic API key', true);
    }
    
    // Basic validation
    if (!apiKey.startsWith('sk-ant-')) {
      return getSetupFormResponse('Invalid Anthropic API key format. Must start with "sk-ant-"', true);
    }

    logWithContext('CLAUDE_SETUP', 'Storing Claude API key', {
      keyPrefix: apiKey.substring(0, 10) + '...'
    });

    // Store encrypted API key in Durable Objects
    const configId = env.GITHUB_APP_CONFIG.idFromName('claude-config');
    const configDO = env.GITHUB_APP_CONFIG.get(configId);
    
    // Encrypt the API key before storing
    const encryptedApiKey = await encrypt(apiKey);
    
    const storeResponse = await configDO.fetch(new Request('http://internal/store-claude-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        anthropicApiKey: encryptedApiKey,
        claudeSetupAt: new Date().toISOString()
      })
    }));

    if (!storeResponse.ok) {
      const error = await storeResponse.text();
      logWithContext('CLAUDE_SETUP', 'Failed to store API key', { error });
      return getSetupFormResponse('Failed to store API key securely. Please try again.', true);
    }

    logWithContext('CLAUDE_SETUP', 'Claude API key stored successfully');

    return getSuccessResponse();

  } catch (error) {
    logWithContext('CLAUDE_SETUP', 'Claude setup error', {
      error: error instanceof Error ? error.message : String(error)
    });

    return getSetupFormResponse('An unexpected error occurred. Please try again.', true);
  }
}

/**
 * Show Claude setup form UI
 * GET /setup/claude
 */
export async function getClaudeSetupStatus(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const configId = env.GITHUB_APP_CONFIG.idFromName('claude-config');
    const configDO = env.GITHUB_APP_CONFIG.get(configId);
    
    const statusResponse = await configDO.fetch(new Request('http://internal/get-claude-key'));
    const statusData = await statusResponse.json() as { anthropicApiKey: string | null };

    const isConfigured = !!statusData.anthropicApiKey;

    logWithContext('CLAUDE_SETUP', 'Showing Claude setup UI', { isConfigured });

    // Always return HTML - this endpoint is UI-only
    if (isConfigured) {
      return getAlreadyConfiguredResponse();
    } else {
      return getSetupFormResponse();
    }

  } catch (error) {
    logWithContext('CLAUDE_SETUP', 'Claude setup UI error', {
      error: error instanceof Error ? error.message : String(error)
    });

    return getSetupFormResponse('Failed to check current configuration. Please try setting up your API key.', true);
  }
}

/**
 * HTML response functions
 */

function getSetupFormResponse(errorMessage?: string, isError?: boolean): Response {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Claude Code Setup - Anthropic API Key</title>
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
        .setup-form {
            background: #f5f5f5;
            padding: 30px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            font-weight: 600;
            margin-bottom: 8px;
        }
        input[type="password"] {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-family: monospace;
            font-size: 14px;
            box-sizing: border-box;
        }
        .submit-btn {
            background: #28a745;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            font-size: 14px;
            width: 100%;
        }
        .submit-btn:hover {
            background: #218838;
        }
        .info-box {
            background: #e3f2fd;
            padding: 20px;
            border-radius: 6px;
            border-left: 4px solid #2196f3;
            margin: 20px 0;
        }
        .error-box {
            background: #ffebee;
            padding: 20px;
            border-radius: 6px;
            border-left: 4px solid #f44336;
            margin: 20px 0;
            color: #c62828;
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
        .security-note {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            border-left: 4px solid #28a745;
            margin: 20px 0;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Claude Code Setup</h1>
        <p>Configure your Anthropic API key to enable AI-powered GitHub issue processing</p>
    </div>

    ${errorMessage ? `
    <div class="error-box">
        <strong>Error:</strong> ${errorMessage}
    </div>
    ` : ''}

    <div class="info-box">
        <h3>What you'll need</h3>
        <p>An Anthropic API key with access to Claude. You can get one from the <a href="https://console.anthropic.com/" target="_blank">Anthropic Console</a>.</p>
    </div>

    <div class="steps">
        <h3>Quick Setup Steps</h3>

        <div class="step">
            <div class="step-number">1</div>
            <strong>Get your API Key</strong><br>
            Visit <a href="https://console.anthropic.com/" target="_blank">console.anthropic.com</a> and create an API key (starts with "sk-ant-").
        </div>

        <div class="step">
            <div class="step-number">2</div>
            <strong>Enter API Key</strong><br>
            Paste your API key in the form below. It will be encrypted and stored securely.
        </div>

        <div class="step">
            <div class="step-number">3</div>
            <strong>Setup GitHub Integration</strong><br>
            After saving your key, configure GitHub to send webhooks for automatic issue processing.
        </div>
    </div>

    <form method="POST" class="setup-form">
        <div class="form-group">
            <label for="anthropic_api_key">Anthropic API Key</label>
            <input
                type="password"
                id="anthropic_api_key"
                name="anthropic_api_key"
                placeholder="sk-ant-api03-..."
                required
                pattern="sk-ant-.*"
                title="API key must start with 'sk-ant-'"
            >
        </div>

        <button type="submit" class="submit-btn">
            Save API Key Securely
        </button>
    </form>

    <div class="security-note">
        <strong>Security:</strong> Your API key is encrypted using AES-256-GCM before storage.
        Only your worker deployment can decrypt and use it. It's never logged or exposed.
    </div>

    <p><strong>Already configured?</strong> <a href="/setup/github/create">Continue to GitHub Setup</a></p>

    <hr style="margin: 40px 0;">
    <p style="text-align: center;"><a href="/">Back to Home</a></p>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

function getSuccessResponse(): Response {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Claude Code Setup Complete</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 40px auto;
            padding: 20px;
            text-align: center;
        }
        .success { color: #28a745; }
        .next-btn {
            display: inline-block;
            background: #0969da;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            margin: 20px 0;
        }
        .status-btn {
            display: inline-block;
            background: #6c757d;
            color: white;
            padding: 8px 16px;
            text-decoration: none;
            border-radius: 4px;
            font-weight: 500;
            margin: 10px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <h1 class="success">Claude Code API Key Configured!</h1>
    <p>Your Anthropic API key has been securely stored and encrypted.</p>
    <p>Claude Code is now ready to process GitHub issues automatically!</p>

    <a href="/setup/github/create" class="next-btn">
        Setup GitHub Integration
    </a>

    <div style="margin-top: 30px;">
        <a href="/api/v1/status" class="status-btn">View Status</a>
        <a href="/" class="status-btn">Back to Home</a>
    </div>

    <p style="margin-top: 30px;"><small>Your API key is encrypted and stored securely in Cloudflare's Durable Objects.</small></p>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

function getAlreadyConfiguredResponse(): Response {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Claude Code - Already Configured</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 40px auto;
            padding: 20px;
            text-align: center;
        }
        .success { color: #28a745; }
        .next-btn {
            display: inline-block;
            background: #0969da;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            margin: 20px 0;
        }
        .status-btn {
            display: inline-block;
            background: #6c757d;
            color: white;
            padding: 8px 16px;
            text-decoration: none;
            border-radius: 4px;
            font-weight: 500;
            margin: 10px;
            font-size: 14px;
        }
        .warning {
            background: #fff3cd;
            padding: 15px;
            border-radius: 6px;
            border-left: 4px solid #ffc107;
            margin: 20px 0;
            color: #856404;
        }
    </style>
</head>
<body>
    <h1 class="success">Claude Code Already Configured</h1>
    <p>Your Anthropic API key is already set up and ready to use!</p>

    <div class="warning">
        <strong>Want to update your API key?</strong> You'll need to redeploy or contact your administrator to change the stored key.
    </div>

    <a href="/setup/github/create" class="next-btn">
        Setup GitHub Integration
    </a>

    <div style="margin-top: 30px;">
        <a href="/api/v1/status" class="status-btn">View Status</a>
        <a href="/" class="status-btn">Back to Home</a>
    </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}