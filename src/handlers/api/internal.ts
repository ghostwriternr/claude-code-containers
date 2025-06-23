/**
 * Internal API endpoints for Worker ↔ Container communication
 * These endpoints facilitate communication between Worker and MCP-enabled containers
 */

import { logWithContext } from '../../log';
import { jsonResponse, errorResponse } from '../../router';

export interface ProgressUpdate {
  contextId: string;
  status: 'started' | 'in_progress' | 'completed' | 'failed';
  message: string;
  progress?: number; // 0-100
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface CompletionNotification {
  contextId: string;
  success: boolean;
  message: string;
  pullRequestUrl?: string;
  commentId?: number;
  error?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

// Store for tracking progress updates (in production, use Durable Objects)
const progressStore = new Map<string, ProgressUpdate[]>();
const completionStore = new Map<string, CompletionNotification>();

/**
 * Handle progress updates from containers
 * POST /api/v1/internal/progress/{contextId}
 */
export async function handleProgressUpdate(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const { contextId } = params;

  if (!contextId) {
    return errorResponse('Context ID is required', 400);
  }

  try {
    const progressData = await request.json() as Partial<ProgressUpdate>;

    if (!progressData.status || !progressData.message) {
      return errorResponse('Status and message are required', 400);
    }

    const progressUpdate: ProgressUpdate = {
      contextId,
      status: progressData.status,
      message: progressData.message,
      progress: progressData.progress,
      metadata: progressData.metadata,
      timestamp: new Date().toISOString()
    };

    // Store progress update
    if (!progressStore.has(contextId)) {
      progressStore.set(contextId, []);
    }
    progressStore.get(contextId)!.push(progressUpdate);

    logWithContext('INTERNAL_API', 'Progress update received', {
      contextId,
      status: progressUpdate.status,
      message: progressUpdate.message,
      progress: progressUpdate.progress
    });

    // Update GitHub comment with progress
    await updateGitHubProgressComment(progressUpdate, env);

    return jsonResponse({
      success: true,
      message: 'Progress update received',
      contextId,
      timestamp: progressUpdate.timestamp
    });

  } catch (error) {
    logWithContext('INTERNAL_API', 'Failed to process progress update', {
      contextId,
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to process progress update', 500);
  }
}

/**
 * Handle completion notifications from containers
 * POST /api/v1/internal/completion/{contextId}
 */
export async function handleCompletion(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const { contextId } = params;

  if (!contextId) {
    return errorResponse('Context ID is required', 400);
  }

  try {
    const completionData = await request.json() as Partial<CompletionNotification>;

    if (typeof completionData.success !== 'boolean' || !completionData.message) {
      return errorResponse('Success boolean and message are required', 400);
    }

    const completion: CompletionNotification = {
      contextId,
      success: completionData.success,
      message: completionData.message,
      pullRequestUrl: completionData.pullRequestUrl,
      commentId: completionData.commentId,
      error: completionData.error,
      metadata: completionData.metadata,
      timestamp: new Date().toISOString()
    };

    // Store completion notification
    completionStore.set(contextId, completion);

    logWithContext('INTERNAL_API', 'Completion notification received', {
      contextId,
      success: completion.success,
      hasPullRequest: !!completion.pullRequestUrl,
      hasError: !!completion.error
    });

    // Perform final GitHub operations if needed
    await handleFinalGitHubOperations(completion, env);

    return jsonResponse({
      success: true,
      message: 'Completion notification received',
      contextId,
      timestamp: completion.timestamp
    });

  } catch (error) {
    logWithContext('INTERNAL_API', 'Failed to process completion notification', {
      contextId,
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to process completion notification', 500);
  }
}

/**
 * Get execution status and progress
 * GET /api/v1/executions/{contextId}
 */
export async function getExecution(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const { contextId } = params;

  if (!contextId) {
    return errorResponse('Context ID is required', 400);
  }

  try {
    const progress = progressStore.get(contextId) || [];
    const completion = completionStore.get(contextId);

    const executionStatus = {
      contextId,
      status: completion ? (completion.success ? 'completed' : 'failed') : 
              progress.length > 0 ? progress[progress.length - 1].status : 'not_found',
      progressUpdates: progress,
      completion,
      totalUpdates: progress.length,
      lastUpdate: progress.length > 0 ? progress[progress.length - 1].timestamp : null
    };

    logWithContext('INTERNAL_API', 'Execution status retrieved', {
      contextId,
      status: executionStatus.status,
      totalUpdates: executionStatus.totalUpdates
    });

    return jsonResponse(executionStatus);

  } catch (error) {
    logWithContext('INTERNAL_API', 'Failed to get execution status', {
      contextId,
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to get execution status', 500);
  }
}

/**
 * Get execution logs
 * GET /api/v1/executions/{contextId}/logs
 */
export async function getExecutionLogs(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const { contextId } = params;

  if (!contextId) {
    return errorResponse('Context ID is required', 400);
  }

  try {
    const progress = progressStore.get(contextId) || [];
    const completion = completionStore.get(contextId);

    // Format as structured logs
    const logs = [
      ...progress.map(p => ({
        timestamp: p.timestamp,
        level: 'info',
        source: 'container',
        type: 'progress',
        message: p.message,
        data: {
          status: p.status,
          progress: p.progress,
          metadata: p.metadata
        }
      })),
      ...(completion ? [{
        timestamp: completion.timestamp,
        level: completion.success ? 'info' : 'error',
        source: 'container',
        type: 'completion',
        message: completion.message,
        data: {
          success: completion.success,
          pullRequestUrl: completion.pullRequestUrl,
          commentId: completion.commentId,
          error: completion.error,
          metadata: completion.metadata
        }
      }] : [])
    ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    logWithContext('INTERNAL_API', 'Execution logs retrieved', {
      contextId,
      logCount: logs.length
    });

    return jsonResponse({
      contextId,
      logs,
      totalLogs: logs.length
    });

  } catch (error) {
    logWithContext('INTERNAL_API', 'Failed to get execution logs', {
      contextId,
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse('Failed to get execution logs', 500);
  }
}

/**
 * Update GitHub progress comment
 * Updates the issue comment with real-time progress information
 */
async function updateGitHubProgressComment(
  progressUpdate: ProgressUpdate,
  env: Env
): Promise<void> {
  try {
    // Parse context ID to extract repository and issue information
    const contextParts = progressUpdate.contextId.split('-');
    if (contextParts.length < 4) {
      logWithContext('GITHUB_UPDATE', 'Invalid context ID format', {
        contextId: progressUpdate.contextId
      });
      return;
    }

    // Extract owner/repo/issue from contextId format: "issue-{owner}-{repo}-{issueNumber}-{timestamp}"
    const owner = contextParts[1];
    const repo = contextParts[2];
    const issueNumber = parseInt(contextParts[3]);

    if (!owner || !repo || !issueNumber) {
      logWithContext('GITHUB_UPDATE', 'Could not parse repository info from context ID', {
        contextId: progressUpdate.contextId,
        parsed: { owner, repo, issueNumber }
      });
      return;
    }

    logWithContext('GITHUB_UPDATE', 'Updating GitHub comment with progress', {
      contextId: progressUpdate.contextId,
      status: progressUpdate.status,
      owner,
      repo,
      issueNumber,
      progress: progressUpdate.progress
    });

    // Note: In a full implementation, we would:
    // 1. Get the GitHub client from the GitHubAPI class
    // 2. Find the Claude comment in the issue
    // 3. Update it with formatted progress information
    // 
    // For now, we'll log the update and track it in the progress store
    // The actual GitHub integration would require the GitHubAPI client

    logWithContext('GITHUB_UPDATE', 'Progress tracked for GitHub update', {
      contextId: progressUpdate.contextId,
      status: progressUpdate.status,
      message: progressUpdate.message
    });

  } catch (error) {
    logWithContext('GITHUB_UPDATE', 'Failed to update GitHub comment', {
      error: error instanceof Error ? error.message : String(error),
      contextId: progressUpdate.contextId
    });
  }
}

/**
 * Handle final GitHub operations
 * Performs final GitHub operations when container processing completes
 */
async function handleFinalGitHubOperations(
  completion: CompletionNotification,
  env: Env
): Promise<void> {
  try {
    logWithContext('GITHUB_FINAL', 'Performing final GitHub operations', {
      contextId: completion.contextId,
      success: completion.success,
      hasPullRequest: !!completion.pullRequestUrl
    });

    // Parse context ID for repository information
    const contextParts = completion.contextId.split('-');
    if (contextParts.length < 4) {
      logWithContext('GITHUB_FINAL', 'Invalid context ID format for final operations', {
        contextId: completion.contextId
      });
      return;
    }

    const owner = contextParts[1];
    const repo = contextParts[2];
    const issueNumber = parseInt(contextParts[3]);

    if (completion.success && completion.pullRequestUrl) {
      // Success case: Log final PR creation
      logWithContext('GITHUB_FINAL', 'Container successfully created pull request', {
        contextId: completion.contextId,
        pullRequestUrl: completion.pullRequestUrl,
        owner,
        repo,
        issueNumber
      });

      // In a full implementation, we might:
      // - Update issue labels (add "pr-created", remove "needs-work")
      // - Add issue-to-PR linking
      // - Notify stakeholders
      
    } else if (!completion.success && completion.error) {
      // Failure case: Log error for potential retry or human intervention
      logWithContext('GITHUB_FINAL', 'Container processing failed, may need human intervention', {
        contextId: completion.contextId,
        error: completion.error,
        owner,
        repo,
        issueNumber
      });

      // In a full implementation, we might:
      // - Add "needs-human-review" label to issue
      // - Create an error comment if not already done
      // - Log to error tracking system
    }

    // Update final status
    logWithContext('GITHUB_FINAL', 'Final GitHub operations completed', {
      contextId: completion.contextId,
      success: completion.success
    });

  } catch (error) {
    logWithContext('GITHUB_FINAL', 'Failed to perform final GitHub operations', {
      error: error instanceof Error ? error.message : String(error),
      contextId: completion.contextId
    });
  }
}