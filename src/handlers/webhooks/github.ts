/**
 * GitHub webhook processor
 * Clean, production-ready webhook handling with adapter integration
 */

import { logWithContext } from '../../log';
import { jsonResponse, errorResponse } from '../../router';
import { handleIssuesEventMcp } from '../github_webhooks/issue-mcp';
import { handleInstallationEvent, handleInstallationRepositoriesEvent } from '../github_webhooks';

/**
 * Main GitHub webhook processor
 * POST /webhooks/github
 */
export async function handleGitHubWebhook(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const startTime = Date.now();

  try {
    // Get webhook payload and headers
    const payload = await request.text();
    const signature = request.headers.get('x-hub-signature-256');
    const event = request.headers.get('x-github-event');
    const delivery = request.headers.get('x-github-delivery');

    logWithContext('WEBHOOK', 'Received GitHub webhook', {
      event,
      delivery,
      hasSignature: !!signature,
      payloadSize: payload.length,
      userAgent: request.headers.get('user-agent')
    });

    // Validate required headers
    if (!signature || !event || !delivery) {
      logWithContext('WEBHOOK', 'Missing required webhook headers', {
        hasSignature: !!signature,
        hasEvent: !!event,
        hasDelivery: !!delivery
      });
      return errorResponse('Missing required headers', 400);
    }

    // Parse the payload
    let webhookData: any;
    try {
      webhookData = JSON.parse(payload);
      logWithContext('WEBHOOK', 'Webhook payload parsed', {
        hasInstallation: !!webhookData.installation,
        hasRepository: !!webhookData.repository,
        action: webhookData.action
      });
    } catch (error) {
      logWithContext('WEBHOOK', 'Invalid JSON payload', {
        error: error instanceof Error ? error.message : String(error)
      });
      return errorResponse('Invalid JSON payload', 400);
    }

    // Handle ping webhooks early
    if (event === 'ping') {
      logWithContext('WEBHOOK', 'Received ping webhook', {
        zen: webhookData.zen
      });
      return jsonResponse({
        message: 'Webhook endpoint is active',
        zen: webhookData.zen,
        timestamp: new Date().toISOString()
      });
    }

    // Get app configuration for signature verification
    const { configDO, appId } = await getAppConfiguration(webhookData, request, env);
    
    if (!configDO) {
      logWithContext('WEBHOOK', 'No app configuration found', { appId });
      return errorResponse('App not configured', 404);
    }

    // Verify webhook signature
    const isValidSignature = await verifyWebhookSignature(payload, signature, configDO);
    
    if (!isValidSignature) {
      logWithContext('WEBHOOK', 'Invalid webhook signature', {
        delivery,
        appId
      });
      return errorResponse('Invalid signature', 401);
    }

    // Log successful webhook delivery
    await logWebhookDelivery(configDO, event, delivery);

    // Route to appropriate event handler
    const eventResponse = await routeWebhookEvent(event, request, env, configDO);

    const processingTime = Date.now() - startTime;
    logWithContext('WEBHOOK', 'Webhook processing completed', {
      event,
      delivery,
      processingTimeMs: processingTime,
      responseStatus: eventResponse.status
    });

    return eventResponse;

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logWithContext('WEBHOOK', 'Webhook processing failed', {
      error: error instanceof Error ? error.message : String(error),
      processingTimeMs: processingTime
    });

    return errorResponse('Webhook processing failed', 500);
  }
}

/**
 * Route webhook events to specific handlers
 */
async function routeWebhookEvent(
  event: string,
  request: Request,
  env: Env,
  configDO: any
): Promise<Response> {
  logWithContext('WEBHOOK_ROUTER', 'Routing webhook event', { event });

  switch (event) {
    case 'installation':
      const installationData = await request.json();
      return handleInstallationEvent(installationData, configDO);

    case 'installation_repositories':
      const repoData = await request.json();
      return handleInstallationRepositoriesEvent(repoData, configDO);

    case 'issues':
      const issuesData = await request.json();
      return handleIssuesEventMcp(issuesData, env, configDO);

    case 'issue_comment':
      // TODO: Implement issue comment handling with adapters
      logWithContext('WEBHOOK_ROUTER', 'Issue comment event not yet implemented');
      return jsonResponse({ message: 'Issue comment event acknowledged' });

    case 'pull_request':
      // TODO: Implement pull request handling with adapters  
      logWithContext('WEBHOOK_ROUTER', 'Pull request event not yet implemented');
      return jsonResponse({ message: 'Pull request event acknowledged' });

    case 'pull_request_review':
      // TODO: Implement PR review handling with adapters
      logWithContext('WEBHOOK_ROUTER', 'Pull request review event not yet implemented');
      return jsonResponse({ message: 'Pull request review event acknowledged' });

    default:
      logWithContext('WEBHOOK_ROUTER', 'Unhandled webhook event', {
        event,
        supportedEvents: ['installation', 'installation_repositories', 'issues']
      });
      return jsonResponse({ 
        message: 'Event acknowledged but not processed',
        event 
      });
  }
}

/**
 * Get app configuration from webhook data
 */
async function getAppConfiguration(
  webhookData: any,
  request: Request,
  env: Env
): Promise<{ configDO: any | null; appId: string | null }> {
  let appId: string | null = null;

  // Try to determine app ID from various sources
  if (webhookData.installation?.app_id) {
    appId = webhookData.installation.app_id.toString();
  } else {
    const hookTargetId = request.headers.get('x-github-hook-installation-target-id');
    if (hookTargetId) {
      appId = hookTargetId;
    }
  }

  if (!appId) {
    logWithContext('WEBHOOK', 'Cannot determine app ID', {
      hasInstallationAppId: !!webhookData.installation?.app_id,
      hasHeaderTargetId: !!request.headers.get('x-github-hook-installation-target-id')
    });
    return { configDO: null, appId: null };
  }

  const configId = env.GITHUB_APP_CONFIG.idFromName(appId);
  const configDO = env.GITHUB_APP_CONFIG.get(configId);

  return { configDO, appId };
}

/**
 * Verify webhook signature using HMAC-SHA256
 */
async function verifyWebhookSignature(
  payload: string,
  signature: string,
  configDO: any
): Promise<boolean> {
  try {
    if (!signature.startsWith('sha256=')) {
      return false;
    }

    // Get webhook secret from DO
    const credentialsResponse = await configDO.fetch(new Request('http://internal/get-credentials'));
    if (!credentialsResponse.ok) {
      return false;
    }

    const credentials = await credentialsResponse.json();
    if (!credentials.webhookSecret) {
      return false;
    }

    const sigHex = signature.replace('sha256=', '');

    // Create HMAC-SHA256 hash
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(credentials.webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const messageBuffer = new TextEncoder().encode(payload);
    const hashBuffer = await crypto.subtle.sign('HMAC', key, messageBuffer);
    const hashArray = new Uint8Array(hashBuffer);
    const computedHex = Array.from(hashArray)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');

    return sigHex === computedHex;

  } catch (error) {
    logWithContext('WEBHOOK', 'Signature verification error', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

/**
 * Log webhook delivery for analytics
 */
async function logWebhookDelivery(
  configDO: any,
  event: string,
  delivery: string
): Promise<void> {
  try {
    await configDO.fetch(new Request('http://internal/log-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        event, 
        delivery, 
        timestamp: new Date().toISOString() 
      })
    }));
  } catch (error) {
    // Log delivery errors shouldn't fail the webhook
    logWithContext('WEBHOOK', 'Failed to log webhook delivery', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}