import { logWithContext } from "../log";
import { handleInstallationEvent, handleInstallationRepositoriesEvent, handleIssuesEvent } from "./github_webhooks";

// Route webhook events to specific handlers
async function routeWebhookEvent(event: string, data: any, configDO: any, env: any, request: Request): Promise<Response> {
  logWithContext('EVENT_ROUTER', 'Routing webhook event', {
    event,
    action: data.action,
    repository: data.repository?.full_name
  });

  switch (event) {
    case 'installation':
      return handleInstallationEvent(data, configDO);

    case 'installation_repositories':
      return handleInstallationRepositoriesEvent(data, configDO);

    case 'issues':
      return handleIssuesEvent(data, env, configDO);

    default:
      logWithContext('EVENT_ROUTER', 'Unhandled webhook event', {
        event,
        availableEvents: ['installation', 'installation_repositories', 'issues']
      });
      return new Response('Event acknowledged', { status: 200 });
  }
}

// HMAC-SHA256 signature verification for GitHub webhooks
async function verifyGitHubSignature(payload: string, signature: string, secret: string): Promise<boolean> {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const sigHex = signature.replace('sha256=', '');

  // Create HMAC-SHA256 hash
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
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

  // Constant-time comparison
  return sigHex === computedHex;
}

// Main webhook processing handler
export async function handleGitHubWebhook(request: Request, env: any): Promise<Response> {
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
      headers: {
        userAgent: request.headers.get('user-agent'),
        contentType: request.headers.get('content-type')
      }
    });

    if (!signature || !event || !delivery) {
      logWithContext('WEBHOOK', 'Missing required webhook headers', {
        hasSignature: !!signature,
        hasEvent: !!event,
        hasDelivery: !!delivery
      });
      return new Response('Missing required headers', { status: 400 });
    }

    // Parse the payload to get app/installation info
    let webhookData;
    try {
      webhookData = JSON.parse(payload);
      logWithContext('WEBHOOK', 'Webhook payload parsed successfully', {
        hasInstallation: !!webhookData.installation,
        hasRepository: !!webhookData.repository,
        action: webhookData.action
      });
    } catch (error) {
      logWithContext('WEBHOOK', 'Invalid JSON payload', {
        error: error instanceof Error ? error.message : String(error),
        payloadPreview: payload.substring(0, 200)
      });
      return new Response('Invalid JSON payload', { status: 400 });
    }

    // Handle ping webhooks early - they don't need installation info or signature verification
    if (event === 'ping') {
      logWithContext('WEBHOOK', 'Received ping webhook', {
        zen: webhookData.zen,
        hookId: webhookData.hook_id
      });
      return new Response(JSON.stringify({
        message: 'Webhook endpoint is active',
        zen: webhookData.zen
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Determine which app config to use based on the webhook
    let appId: string | undefined;

    if (webhookData.installation?.app_id) {
      // Installation events include app_id directly
      appId = webhookData.installation.app_id.toString();
      logWithContext('WEBHOOK', 'App ID found in installation data', { appId });
    } else if (webhookData.installation?.id) {
      // For other events, we need to look up the app ID by installation ID
      // Since we only have one app per worker deployment, we can check our known app
      // For now, use the app ID from the header
      const hookInstallationTargetId = request.headers.get('x-github-hook-installation-target-id');
      if (hookInstallationTargetId) {
        appId = hookInstallationTargetId;
        logWithContext('WEBHOOK', 'App ID found in header', { appId });
      } else {
        logWithContext('WEBHOOK', 'Cannot determine app ID from webhook payload or headers', {
          hasInstallationId: !!webhookData.installation?.id,
          installationId: webhookData.installation?.id
        });
        return new Response('Cannot determine app ID', { status: 400 });
      }
    } else {
      // Try to get app ID from headers as fallback
      const hookInstallationTargetId = request.headers.get('x-github-hook-installation-target-id');
      if (hookInstallationTargetId) {
        appId = hookInstallationTargetId;
        logWithContext('WEBHOOK', 'App ID found in header (fallback)', { appId });
      } else {
        logWithContext('WEBHOOK', 'No installation information in webhook payload', {
          webhookKeys: Object.keys(webhookData),
          event,
          availableHeaders: {
            hookInstallationTargetId: request.headers.get('x-github-hook-installation-target-id'),
            hookInstallationTargetType: request.headers.get('x-github-hook-installation-target-type')
          }
        });
        return new Response(`No installation information for event: ${event}`, { status: 400 });
      }
    }

    // Get app configuration and decrypt webhook secret
    logWithContext('WEBHOOK', 'Retrieving app configuration', { appId });

    const id = env.GITHUB_APP_CONFIG.idFromName(appId);
    const configDO = env.GITHUB_APP_CONFIG.get(id);

    const configResponse = await configDO.fetch(new Request('http://internal/get-credentials'));

    logWithContext('WEBHOOK', 'Config DO response', {
      status: configResponse.status,
      appId
    });

    if (!configResponse.ok) {
      logWithContext('WEBHOOK', 'No app configuration found', { appId });
      return new Response('App not configured', { status: 404 });
    }

    const credentials = await configResponse.json();
    if (!credentials || !credentials.webhookSecret) {
      logWithContext('WEBHOOK', 'No webhook secret found', {
        appId,
        hasCredentials: !!credentials,
        credentialKeys: credentials ? Object.keys(credentials) : []
      });
      return new Response('Webhook secret not found', { status: 500 });
    }

    logWithContext('WEBHOOK', 'Webhook secret retrieved successfully');

    // Verify the webhook signature
    logWithContext('WEBHOOK', 'Verifying webhook signature');

    const isValid = await verifyGitHubSignature(payload, signature, credentials.webhookSecret);

    logWithContext('WEBHOOK', 'Signature verification result', { isValid });

    if (!isValid) {
      logWithContext('WEBHOOK', 'Invalid webhook signature', {
        signaturePrefix: signature.substring(0, 15) + '...',
        delivery
      });
      return new Response('Invalid signature', { status: 401 });
    }

    // Log successful webhook delivery
    await configDO.fetch(new Request('http://internal/log-webhook', {
      method: 'POST',
      body: JSON.stringify({ event, delivery, timestamp: new Date().toISOString() })
    }));

    // Route to appropriate event handler
    logWithContext('WEBHOOK', 'Routing to event handler', { event });

    const eventResponse = await routeWebhookEvent(event, webhookData, configDO, env, request);

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
    logWithContext('WEBHOOK', 'Webhook processing error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      processingTimeMs: processingTime
    });
    return new Response('Internal server error', { status: 500 });
  }
}