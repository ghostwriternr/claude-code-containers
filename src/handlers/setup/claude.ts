/**
 * Claude API key setup handler
 * Secure storage of Anthropic API keys in Durable Objects
 */

import { logWithContext } from '../../log';
import { jsonResponse, errorResponse } from '../../router';

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
    // Parse request body
    const body = await request.json() as { apiKey?: string };
    
    if (!body.apiKey || typeof body.apiKey !== 'string') {
      return errorResponse('Missing or invalid apiKey', 400);
    }

    const apiKey = body.apiKey.trim();
    
    // Basic validation
    if (!apiKey.startsWith('sk-ant-')) {
      return errorResponse('Invalid Anthropic API key format', 400);
    }

    logWithContext('CLAUDE_SETUP', 'Storing Claude API key', {
      keyPrefix: apiKey.substring(0, 10) + '...'
    });

    // Store encrypted API key in Durable Objects
    const configId = env.GITHUB_APP_CONFIG.idFromName('claude-config');
    const configDO = env.GITHUB_APP_CONFIG.get(configId);
    
    const storeResponse = await configDO.fetch(new Request('http://internal/store-claude-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anthropicApiKey: apiKey })
    }));

    if (!storeResponse.ok) {
      const error = await storeResponse.text();
      logWithContext('CLAUDE_SETUP', 'Failed to store API key', { error });
      return errorResponse('Failed to store API key', 500);
    }

    logWithContext('CLAUDE_SETUP', 'Claude API key stored successfully');

    return jsonResponse({
      success: true,
      message: 'Claude API key configured successfully',
      nextStep: {
        description: 'Configure GitHub integration',
        url: '/setup/github/create'
      }
    });

  } catch (error) {
    logWithContext('CLAUDE_SETUP', 'Claude setup error', {
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to process Claude setup', 500);
  }
}

/**
 * Get Claude configuration status
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

    logWithContext('CLAUDE_SETUP', 'Claude status check', { isConfigured });

    return jsonResponse({
      configured: isConfigured,
      message: isConfigured 
        ? 'Claude API key is configured' 
        : 'Claude API key not configured',
      nextStep: isConfigured 
        ? {
            description: 'Configure GitHub integration',
            url: '/setup/github/create'
          }
        : {
            description: 'Configure Claude API key',
            method: 'POST',
            url: '/setup/claude',
            body: { apiKey: 'sk-ant-...' }
          }
    });

  } catch (error) {
    logWithContext('CLAUDE_SETUP', 'Claude status check error', {
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to check Claude status', 500);
  }
}