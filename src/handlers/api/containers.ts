/**
 * Container orchestration API endpoints
 * Manages MCP-enabled containers for GitHub issue processing
 */

import { logWithContext } from '../../log';
import { jsonResponse, errorResponse } from '../../router';

export interface ContainerExecutionRequest {
  contextId: string;
  issueData: {
    issueId: string;
    issueNumber: string;
    title: string;
    description: string;
    labels: string[];
    repositoryUrl: string;
    repositoryName: string;
    author: string;
  };
  credentials: {
    githubToken: string;
    anthropicApiKey: string;
  };
  configuration?: {
    customInstructions?: string;
    allowedTools?: string[];
    maxExecutionTime?: number;
  };
}

export interface ContainerExecutionResponse {
  success: boolean;
  contextId: string;
  containerId?: string;
  message: string;
  executionStartedAt: string;
  estimatedDuration?: number;
  error?: string;
}

/**
 * Execute issue processing in MCP-enabled container
 * POST /api/v1/containers/execute
 */
export async function executeIssueInContainer(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const executionRequest = await request.json() as ContainerExecutionRequest;

    // Validate request
    const validationError = validateExecutionRequest(executionRequest);
    if (validationError) {
      return errorResponse(validationError, 400);
    }

    const { contextId, issueData, credentials, configuration } = executionRequest;

    logWithContext('CONTAINER_ORCHESTRATION', 'Starting container execution', {
      contextId,
      issueNumber: issueData.issueNumber,
      repository: issueData.repositoryName,
      hasCustomInstructions: !!configuration?.customInstructions
    });

    // Get container instance
    const containerId = env.MY_CONTAINER.idFromName(contextId);
    const container = env.MY_CONTAINER.get(containerId);

    // Prepare container payload with MCP configuration
    const containerPayload = {
      // Issue context
      ISSUE_ID: issueData.issueId,
      ISSUE_NUMBER: issueData.issueNumber,
      ISSUE_TITLE: issueData.title,
      ISSUE_BODY: issueData.description,
      ISSUE_LABELS: JSON.stringify(issueData.labels),
      REPOSITORY_URL: issueData.repositoryUrl,
      REPOSITORY_NAME: issueData.repositoryName,
      ISSUE_AUTHOR: issueData.author,

      // Credentials
      GITHUB_TOKEN: credentials.githubToken,
      ANTHROPIC_API_KEY: credentials.anthropicApiKey,

      // MCP configuration
      ALLOWED_TOOLS: JSON.stringify(configuration?.allowedTools || [
        'mcp__github__commit_files',
        'mcp__github__delete_files',
        'mcp__github__update_claude_comment'
      ]),
      CUSTOM_INSTRUCTIONS: configuration?.customInstructions || '',
      MAX_EXECUTION_TIME: (configuration?.maxExecutionTime || 10) * 60 * 1000, // Convert to milliseconds

      // Container communication
      CONTEXT_ID: contextId,
      WORKER_BASE_URL: getWorkerBaseUrl(request),
      
      // GitHub event context
      GITHUB_EVENT_NAME: 'issues',
      IS_PR: 'false'
    };

    const executionStartedAt = new Date().toISOString();

    // Execute in container
    const containerResponse = await container.fetch(new Request('http://container/process-issue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(containerPayload)
    }));

    if (!containerResponse.ok) {
      const errorText = await containerResponse.text();
      logWithContext('CONTAINER_ORCHESTRATION', 'Container execution failed', {
        contextId,
        status: containerResponse.status,
        error: errorText
      });

      return errorResponse(`Container execution failed: ${errorText}`, 500);
    }

    const containerResult = await containerResponse.json() as any;

    logWithContext('CONTAINER_ORCHESTRATION', 'Container execution started successfully', {
      contextId,
      containerId: containerId.toString(),
      success: containerResult.success
    });

    const response: ContainerExecutionResponse = {
      success: true,
      contextId,
      containerId: containerId.toString(),
      message: 'Container execution started successfully',
      executionStartedAt,
      estimatedDuration: (configuration?.maxExecutionTime || 10) * 60 // seconds
    };

    return jsonResponse(response);

  } catch (error) {
    logWithContext('CONTAINER_ORCHESTRATION', 'Failed to execute issue in container', {
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to execute issue in container', 500);
  }
}

/**
 * Get container execution status
 * GET /api/v1/containers/{containerId}/status
 */
export async function getContainerStatus(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const { containerId } = params;

  if (!containerId) {
    return errorResponse('Container ID is required', 400);
  }

  try {
    // Get container instance
    const containerDurableObject = env.MY_CONTAINER.idFromString(containerId);
    const container = env.MY_CONTAINER.get(containerDurableObject);

    // Get container health/status
    const statusResponse = await container.fetch(new Request('http://container/', {
      method: 'GET'
    }));

    if (!statusResponse.ok) {
      logWithContext('CONTAINER_STATUS', 'Failed to get container status', {
        containerId,
        status: statusResponse.status
      });

      return errorResponse('Container not available', 503);
    }

    const containerStatus = await statusResponse.json() as any;

    logWithContext('CONTAINER_STATUS', 'Container status retrieved', {
      containerId,
      status: containerStatus.status
    });

    return jsonResponse({
      containerId,
      status: containerStatus.status,
      message: containerStatus.message,
      instanceId: containerStatus.instanceId,
      timestamp: containerStatus.timestamp,
      claudeCodeAvailable: containerStatus.claudeCodeAvailable,
      githubTokenAvailable: containerStatus.githubTokenAvailable,
      mcpServerReady: containerStatus.mcpServerReady,
      retrievedAt: new Date().toISOString()
    });

  } catch (error) {
    logWithContext('CONTAINER_STATUS', 'Failed to get container status', {
      containerId,
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to get container status', 500);
  }
}

/**
 * List active containers
 * GET /api/v1/containers
 */
export async function listContainers(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    // TODO: Implement container listing
    // This would require tracking active containers in Durable Objects storage
    
    const containerList = {
      containers: [], // List of active containers
      totalContainers: 0,
      activeExecutions: 0,
      retrievedAt: new Date().toISOString()
    };

    logWithContext('CONTAINER_LIST', 'Container list retrieved', {
      totalContainers: containerList.totalContainers
    });

    return jsonResponse(containerList);

  } catch (error) {
    logWithContext('CONTAINER_LIST', 'Failed to list containers', {
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to list containers', 500);
  }
}

/**
 * Validate container execution request
 */
function validateExecutionRequest(request: ContainerExecutionRequest): string | null {
  if (!request.contextId || typeof request.contextId !== 'string') {
    return 'contextId is required and must be a string';
  }

  if (!request.issueData) {
    return 'issueData is required';
  }

  const { issueData } = request;
  if (!issueData.issueId || !issueData.issueNumber || !issueData.title || 
      !issueData.repositoryUrl || !issueData.repositoryName || !issueData.author) {
    return 'issueData must include issueId, issueNumber, title, repositoryUrl, repositoryName, and author';
  }

  if (!request.credentials) {
    return 'credentials are required';
  }

  const { credentials } = request;
  if (!credentials.githubToken || !credentials.anthropicApiKey) {
    return 'credentials must include githubToken and anthropicApiKey';
  }

  if (!credentials.anthropicApiKey.startsWith('sk-ant-')) {
    return 'Invalid Anthropic API key format';
  }

  if (request.configuration?.maxExecutionTime !== undefined) {
    if (typeof request.configuration.maxExecutionTime !== 'number' || 
        request.configuration.maxExecutionTime < 1 || 
        request.configuration.maxExecutionTime > 30) {
      return 'maxExecutionTime must be between 1 and 30 minutes';
    }
  }

  return null;
}

/**
 * Get worker base URL for container communication
 */
function getWorkerBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}