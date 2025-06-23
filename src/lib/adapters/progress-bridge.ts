import type { ParsedGitHubContext } from '@adapters/types';
import type { Octokits } from '@adapters/github-client';
import type { CommentProgress } from './comment-manager';
import { WorkersCommentManager } from './comment-manager';
// Use the global Env type from worker-configuration.d.ts

export interface ProgressState {
  contextId: string;
  commentId: number;
  currentStage: CommentProgress['stage'];
  startTime: number;
  lastUpdate: number;
  container: string;
}

export interface ContainerProgressRequest {
  contextId: string;
  progress: CommentProgress;
}

/**
 * Progress Bridge manages communication between Container and Worker for GitHub updates
 * Container → Progress Bridge → Worker → GitHub Comments
 */
export class ProgressBridge {
  private progressStates: Map<string, ProgressState> = new Map();
  private commentManager: WorkersCommentManager;

  constructor(private env: Env) {
    this.commentManager = new WorkersCommentManager(env);
  }

  /**
   * Initialize progress tracking for a new Container execution
   * Called by Worker when starting Container execution
   */
  async initializeProgress(
    context: ParsedGitHubContext,
    commentId: number,
    containerId: string
  ): Promise<string> {
    const contextId = this.generateContextId(context);
    
    const progressState: ProgressState = {
      contextId,
      commentId,
      currentStage: 'analyzing',
      startTime: Date.now(),
      lastUpdate: Date.now(),
      container: containerId
    };

    this.progressStates.set(contextId, progressState);
    return contextId;
  }

  /**
   * Handle progress update from Container
   * This is called via HTTP endpoint from Container to Worker
   */
  async handleContainerProgress(
    request: ContainerProgressRequest,
    octokits: Octokits,
    context: ParsedGitHubContext
  ): Promise<void> {
    const progressState = this.progressStates.get(request.contextId);
    if (!progressState) {
      throw new Error(`Progress state not found for context: ${request.contextId}`);
    }

    // Update progress state
    progressState.currentStage = request.progress.stage;
    progressState.lastUpdate = Date.now();

    // Update GitHub comment via Worker
    await this.commentManager.updateCommentProgress(
      octokits,
      context,
      progressState.commentId,
      request.progress
    );
  }

  /**
   * Create progress reporter function for Container
   * This creates a function that Container can call to report progress
   */
  createContainerProgressReporter(contextId: string): {
    reportProgress: (progress: Omit<CommentProgress, 'timestamp'>) => Promise<void>;
    getProgressEndpoint: () => string;
  } {
    const progressEndpoint = `/internal/progress/${contextId}`;
    
    return {
      reportProgress: async (progress: Omit<CommentProgress, 'timestamp'>) => {
        const fullProgress: CommentProgress = {
          ...progress,
          timestamp: Date.now()
        };

        // Container will POST to this endpoint
        const response = await fetch(progressEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contextId,
            progress: fullProgress
          })
        });

        if (!response.ok) {
          console.error('Failed to report progress:', await response.text());
        }
      },
      getProgressEndpoint: () => progressEndpoint
    };
  }

  /**
   * Handle completion notification from Container
   */
  async handleContainerCompletion(
    contextId: string,
    octokits: Octokits,
    context: ParsedGitHubContext,
    result: {
      success: boolean;
      pullRequestUrl?: string;
      summary: string;
      filesModified?: string[];
      error?: string;
    }
  ): Promise<void> {
    const progressState = this.progressStates.get(contextId);
    if (!progressState) {
      console.warn(`Progress state not found for completion: ${contextId}`);
      return;
    }

    // Create final completion comment
    await this.commentManager.createCompletionComment(
      octokits,
      context,
      result
    );

    // Clean up progress state
    this.progressStates.delete(contextId);
  }

  /**
   * Get current progress state for debugging/monitoring
   */
  getProgressState(contextId: string): ProgressState | undefined {
    return this.progressStates.get(contextId);
  }

  /**
   * Get all active progress states
   */
  getAllProgressStates(): ProgressState[] {
    return Array.from(this.progressStates.values());
  }

  /**
   * Clean up stale progress states (older than 1 hour)
   */
  cleanupStaleStates(): void {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    for (const [contextId, state] of this.progressStates.entries()) {
      if (state.lastUpdate < oneHourAgo) {
        console.log(`Cleaning up stale progress state: ${contextId}`);
        this.progressStates.delete(contextId);
      }
    }
  }

  /**
   * Generate unique context ID for progress tracking
   */
  private generateContextId(context: ParsedGitHubContext): string {
    return `${context.repository.full_name}/${context.entityNumber}/${Date.now()}`;
  }

  /**
   * Create Container environment variables for progress reporting
   */
  createContainerEnvironment(contextId: string, workerUrl: string): Record<string, string> {
    return {
      PROGRESS_CONTEXT_ID: contextId,
      PROGRESS_WEBHOOK_URL: `${workerUrl}/internal/progress/${contextId}`,
      COMPLETION_WEBHOOK_URL: `${workerUrl}/internal/completion/${contextId}`
    };
  }
}

/**
 * Progress middleware for handling Container progress requests in Worker
 */
export class ProgressMiddleware {
  constructor(
    private progressBridge: ProgressBridge,
    private env: Env
  ) {}

  /**
   * Handle progress update requests from Container
   */
  async handleProgressRequest(
    request: Request,
    contextId: string
  ): Promise<Response> {
    try {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      const progressRequest: ContainerProgressRequest = await request.json();
      
      // Need to reconstruct context and octokits from stored state
      const progressState = this.progressBridge.getProgressState(contextId);
      if (!progressState) {
        return new Response('Progress state not found', { status: 404 });
      }

      // This would need to be enhanced to properly reconstruct context/octokits
      // For now, return success to acknowledge the progress
      console.log(`Progress update for ${contextId}:`, progressRequest.progress);
      
      return new Response('Progress updated', { status: 200 });
    } catch (error) {
      console.error('Progress request error:', error);
      return new Response('Internal error', { status: 500 });
    }
  }

  /**
   * Handle completion requests from Container
   */
  async handleCompletionRequest(
    request: Request,
    contextId: string
  ): Promise<Response> {
    try {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      const completionData = await request.json();
      
      console.log(`Completion notification for ${contextId}:`, completionData);
      
      return new Response('Completion processed', { status: 200 });
    } catch (error) {
      console.error('Completion request error:', error);
      return new Response('Internal error', { status: 500 });
    }
  }
}