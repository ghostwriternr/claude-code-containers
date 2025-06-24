/**
 * Repository configuration API endpoints
 * Manage repository-specific settings for Claude Code processing
 */

import { logWithContext } from '../../log';
import { jsonResponse, errorResponse } from '../../router';

export interface RepositoryConfig {
  owner: string;
  repo: string;
  enabled: boolean;
  customInstructions?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  autoCreatePR?: boolean;
  progressComments?: boolean;
  triggerPhrases?: string[];
  maxExecutionTime?: number; // minutes
  excludeLabels?: string[];
  includeLabels?: string[];
  assignedUsersOnly?: boolean;
  createdAt: string;
  updatedAt: string;
}

// Repository configurations are now stored in Durable Objects

/**
 * Get repository configuration
 * GET /api/v1/repositories/{owner}/{repo}/config
 */
export async function getRepositoryConfig(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const { owner, repo } = params;

  if (!owner || !repo) {
    return errorResponse('Owner and repo are required', 400);
  }

  try {
    // Get configuration from Durable Object
    const configId = env.GITHUB_APP_CONFIG.idFromName('claude-config');
    const configDO = env.GITHUB_APP_CONFIG.get(configId);

    const response = await configDO.fetch(new Request('http://internal/repo-config/get', {
      method: 'POST',
      body: JSON.stringify({ owner, repo })
    }));

    const data = await response.json() as { config: RepositoryConfig | null };
    const config = data.config;

    if (!config) {
      // Return default configuration
      const defaultConfig: RepositoryConfig = {
        owner,
        repo,
        enabled: true,
        autoCreatePR: true,
        progressComments: true,
        triggerPhrases: ['@claude', '/claude'],
        maxExecutionTime: 10,
        assignedUsersOnly: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      logWithContext('REPO_CONFIG', 'Returning default repository configuration', {
        owner,
        repo
      });

      return jsonResponse(defaultConfig);
    }

    logWithContext('REPO_CONFIG', 'Repository configuration retrieved', {
      owner,
      repo,
      enabled: config.enabled
    });

    return jsonResponse(config);

  } catch (error) {
    logWithContext('REPO_CONFIG', 'Failed to get repository configuration', {
      owner,
      repo,
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to get repository configuration', 500);
  }
}

/**
 * Update repository configuration
 * PUT /api/v1/repositories/{owner}/{repo}/config
 */
export async function setRepositoryConfig(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'PUT') {
    return errorResponse('Method not allowed', 405);
  }

  const { owner, repo } = params;

  if (!owner || !repo) {
    return errorResponse('Owner and repo are required', 400);
  }

  try {
    const configUpdate = await request.json() as Partial<RepositoryConfig>;

    // Validate configuration
    const validationError = validateRepositoryConfig(configUpdate);
    if (validationError) {
      return errorResponse(validationError, 400);
    }

    // Get existing configuration from Durable Object
    const configId = env.GITHUB_APP_CONFIG.idFromName('claude-config');
    const configDO = env.GITHUB_APP_CONFIG.get(configId);

    const getResponse = await configDO.fetch(new Request('http://internal/repo-config/get', {
      method: 'POST',
      body: JSON.stringify({ owner, repo })
    }));

    const getData = await getResponse.json() as { config: RepositoryConfig | null };
    const existingConfig = getData.config;

    const updatedConfig: RepositoryConfig = {
      owner,
      repo,
      enabled: configUpdate.enabled ?? existingConfig?.enabled ?? true,
      customInstructions: configUpdate.customInstructions ?? existingConfig?.customInstructions,
      allowedTools: configUpdate.allowedTools ?? existingConfig?.allowedTools,
      disallowedTools: configUpdate.disallowedTools ?? existingConfig?.disallowedTools,
      autoCreatePR: configUpdate.autoCreatePR ?? existingConfig?.autoCreatePR ?? true,
      progressComments: configUpdate.progressComments ?? existingConfig?.progressComments ?? true,
      triggerPhrases: configUpdate.triggerPhrases ?? existingConfig?.triggerPhrases ?? ['@claude', '/claude'],
      maxExecutionTime: configUpdate.maxExecutionTime ?? existingConfig?.maxExecutionTime ?? 10,
      excludeLabels: configUpdate.excludeLabels ?? existingConfig?.excludeLabels,
      includeLabels: configUpdate.includeLabels ?? existingConfig?.includeLabels,
      assignedUsersOnly: configUpdate.assignedUsersOnly ?? existingConfig?.assignedUsersOnly ?? false,
      createdAt: existingConfig?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Store configuration in Durable Object
    await configDO.fetch(new Request('http://internal/repo-config/set', {
      method: 'POST',
      body: JSON.stringify({ owner, repo, config: updatedConfig })
    }));

    logWithContext('REPO_CONFIG', 'Repository configuration updated', {
      owner,
      repo,
      enabled: updatedConfig.enabled,
      changedFields: Object.keys(configUpdate)
    });

    return jsonResponse({
      success: true,
      message: 'Repository configuration updated',
      config: updatedConfig
    });

  } catch (error) {
    logWithContext('REPO_CONFIG', 'Failed to update repository configuration', {
      owner,
      repo,
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to update repository configuration', 500);
  }
}

/**
 * Get repository processing status
 * GET /api/v1/repositories/{owner}/{repo}/status
 */
export async function getRepositoryStatus(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const { owner, repo } = params;

  if (!owner || !repo) {
    return errorResponse('Owner and repo are required', 400);
  }

  try {
    // Get configuration from Durable Object
    const configId = env.GITHUB_APP_CONFIG.idFromName('claude-config');
    const configDO = env.GITHUB_APP_CONFIG.get(configId);

    const response = await configDO.fetch(new Request('http://internal/repo-config/get', {
      method: 'POST',
      body: JSON.stringify({ owner, repo })
    }));

    const data = await response.json() as { config: RepositoryConfig | null };
    const config = data.config;

    // TODO: Get actual processing statistics from storage
    const status = {
      owner,
      repo,
      enabled: config?.enabled ?? true,
      statistics: {
        totalIssuesProcessed: 0,
        successfulProcessings: 0,
        failedProcessings: 0,
        pullRequestsCreated: 0,
        averageProcessingTime: 0, // seconds
        lastProcessedAt: null,
        lastSuccessAt: null
      },
      health: {
        containerStatus: 'healthy',
        lastHealthCheck: new Date().toISOString(),
        mcpServerReady: true,
        githubTokenValid: true
      },
      currentExecutions: [], // List of currently running executions
      recentExecutions: [] // List of recent executions
    };

    logWithContext('REPO_STATUS', 'Repository status retrieved', {
      owner,
      repo,
      enabled: status.enabled
    });

    return jsonResponse(status);

  } catch (error) {
    logWithContext('REPO_STATUS', 'Failed to get repository status', {
      owner,
      repo,
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to get repository status', 500);
  }
}

/**
 * Validate repository configuration
 */
function validateRepositoryConfig(config: Partial<RepositoryConfig>): string | null {
  if (config.maxExecutionTime !== undefined) {
    if (typeof config.maxExecutionTime !== 'number' || config.maxExecutionTime < 1 || config.maxExecutionTime > 30) {
      return 'maxExecutionTime must be between 1 and 30 minutes';
    }
  }

  if (config.triggerPhrases !== undefined) {
    if (!Array.isArray(config.triggerPhrases) || config.triggerPhrases.length === 0) {
      return 'triggerPhrases must be a non-empty array';
    }
    if (config.triggerPhrases.some(phrase => typeof phrase !== 'string' || phrase.trim().length === 0)) {
      return 'All trigger phrases must be non-empty strings';
    }
  }

  if (config.allowedTools !== undefined) {
    if (!Array.isArray(config.allowedTools)) {
      return 'allowedTools must be an array';
    }
  }

  if (config.disallowedTools !== undefined) {
    if (!Array.isArray(config.disallowedTools)) {
      return 'disallowedTools must be an array';
    }
  }

  if (config.customInstructions !== undefined) {
    if (typeof config.customInstructions !== 'string') {
      return 'customInstructions must be a string';
    }
    if (config.customInstructions.length > 10000) {
      return 'customInstructions must be less than 10,000 characters';
    }
  }

  return null;
}