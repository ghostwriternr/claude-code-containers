/**
 * New production-ready Cloudflare Worker
 * Clean architecture with proper routing and error handling
 */

import { Router, handleCors } from './router';
import { handleRoot } from './handlers/root';
import { handleClaudeSetup, getClaudeSetupStatus } from './handlers/setup/claude';
import { 
  handleGitHubAppCreation, 
  handleGitHubCallback, 
  handleGitHubInstall 
} from './handlers/setup/github';
import { handleGitHubWebhook } from './handlers/webhooks/github';
import { getSystemStatus } from './handlers/api/status';
import { logWithContext } from './log';

// Re-export Durable Objects from the old index for now
export { MyContainer, GitHubAppConfigDO } from './index-old';

/**
 * Main Worker export with clean routing
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight requests
    const corsResponse = handleCors(request);
    if (corsResponse) return corsResponse;

    const startTime = Date.now();
    const url = new URL(request.url);
    
    logWithContext('WORKER', 'Request received', {
      method: request.method,
      pathname: url.pathname,
      userAgent: request.headers.get('user-agent')?.substring(0, 50)
    });

    try {
      // Create router and register all routes
      const router = new Router();

      // Root endpoint
      router.get('/', handleRoot);

      // Setup endpoints
      router.get('/setup/claude', getClaudeSetupStatus);
      router.post('/setup/claude', handleClaudeSetup);
      router.get('/setup/github/create', handleGitHubAppCreation);
      router.get('/setup/github/callback', handleGitHubCallback);
      router.get('/setup/github/install', handleGitHubInstall);

      // Webhook endpoints
      router.post('/webhooks/github', handleGitHubWebhook);

      // API v1 endpoints
      router.get('/api/v1/status', getSystemStatus);

      // TODO: Additional API endpoints
      // router.get('/api/v1/repositories/{owner}/{repo}/config', getRepositoryConfig);
      // router.put('/api/v1/repositories/{owner}/{repo}/config', setRepositoryConfig);
      // router.get('/api/v1/executions/{id}', getExecution);
      // router.get('/api/v1/executions/{id}/logs', getExecutionLogs);
      // router.post('/api/v1/internal/progress/{contextId}', handleProgressUpdate);
      // router.post('/api/v1/internal/completion/{contextId}', handleCompletion);

      // Handle the request
      const response = await router.handle(request, env);

      const processingTime = Date.now() - startTime;
      logWithContext('WORKER', 'Request completed', {
        method: request.method,
        pathname: url.pathname,
        status: response.status,
        processingTimeMs: processingTime
      });

      return response;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logWithContext('WORKER', 'Request failed', {
        method: request.method,
        pathname: url.pathname,
        error: error instanceof Error ? error.message : String(error),
        processingTimeMs: processingTime
      });

      return new Response(JSON.stringify({
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
} satisfies ExportedHandler<Env>;