/**
 * System status API
 * Provides health check and configuration status
 */

import { logWithContext } from '../../log';
import { jsonResponse, errorResponse } from '../../router';

/**
 * Get system status and configuration
 * GET /api/v1/status
 */
export async function getSystemStatus(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const workerUrl = getWorkerUrl(request);
    
    logWithContext('STATUS_CHECK', 'Checking system status');

    // Check Claude configuration
    const claudeStatus = await checkClaudeConfiguration(env);
    
    // Check GitHub configuration
    const githubStatus = await checkGitHubConfiguration(env);

    // System health
    const systemStatus = {
      healthy: true,
      timestamp: new Date().toISOString(),
      workerUrl,
      webhookUrl: `${workerUrl}/webhooks/github`
    };

    const status = {
      system: systemStatus,
      claude: claudeStatus,
      github: githubStatus,
      setup: {
        complete: claudeStatus.configured && githubStatus.appCreated,
        nextSteps: getNextSteps(claudeStatus, githubStatus, workerUrl)
      }
    };

    logWithContext('STATUS_CHECK', 'Status check completed', {
      claudeConfigured: claudeStatus.configured,
      githubAppCreated: githubStatus.appCreated,
      setupComplete: status.setup.complete
    });

    return jsonResponse(status);

  } catch (error) {
    logWithContext('STATUS_CHECK', 'Status check failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to check system status', 500);
  }
}

/**
 * Check Claude API configuration
 */
async function checkClaudeConfiguration(env: Env): Promise<{
  configured: boolean;
  message: string;
}> {
  try {
    const configId = env.GITHUB_APP_CONFIG.idFromName('claude-config');
    const configDO = env.GITHUB_APP_CONFIG.get(configId);
    
    const response = await configDO.fetch(new Request('http://internal/get-claude-key'));
    const data = await response.json() as { anthropicApiKey: string | null };

    const configured = !!data.anthropicApiKey;

    return {
      configured,
      message: configured 
        ? 'Claude API key is configured'
        : 'Claude API key not configured'
    };

  } catch (error) {
    return {
      configured: false,
      message: 'Failed to check Claude configuration'
    };
  }
}

/**
 * Check GitHub App configuration
 */
async function checkGitHubConfiguration(env: Env): Promise<{
  appCreated: boolean;
  installed: boolean;
  repositories: number;
  apps: Array<{
    id: string;
    name: string;
    slug: string;
    installations: number;
  }>;
  message: string;
}> {
  try {
    // This is a simplified check - in a real implementation,
    // we'd iterate through all possible app configurations
    // For now, let's check if we have any GitHub apps configured
    
    const apps: Array<{
      id: string;
      name: string;
      slug: string;
      installations: number;
    }> = [];

    let totalRepositories = 0;
    let hasAnyApp = false;

    // In a real implementation, we'd have a way to list all configured apps
    // For now, this is a placeholder structure
    
    return {
      appCreated: hasAnyApp,
      installed: hasAnyApp,
      repositories: totalRepositories,
      apps,
      message: hasAnyApp 
        ? `${apps.length} GitHub app(s) configured with ${totalRepositories} repositories`
        : 'No GitHub apps configured'
    };

  } catch (error) {
    return {
      appCreated: false,
      installed: false,
      repositories: 0,
      apps: [],
      message: 'Failed to check GitHub configuration'
    };
  }
}

/**
 * Get next setup steps based on current configuration
 */
function getNextSteps(
  claudeStatus: { configured: boolean },
  githubStatus: { appCreated: boolean },
  workerUrl: string
): Array<{
  step: number;
  title: string;
  description: string;
  url: string;
  method?: string;
  completed: boolean;
}> {
  const steps = [
    {
      step: 1,
      title: 'Configure Claude API Key',
      description: 'Store your Anthropic API key securely',
      url: `${workerUrl}/setup/claude`,
      method: 'POST',
      completed: claudeStatus.configured
    },
    {
      step: 2,
      title: 'Create GitHub App',
      description: 'Set up GitHub integration with automatic app creation',
      url: `${workerUrl}/setup/github/create`,
      completed: githubStatus.appCreated
    },
    {
      step: 3,
      title: 'Install GitHub App',
      description: 'Install the app to repositories you want Claude to help with',
      url: githubStatus.appCreated ? `${workerUrl}/setup/github/install` : '#',
      completed: false // We'd need to check actual installations
    }
  ];

  return steps;
}

/**
 * Get worker URL from request
 */
function getWorkerUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}