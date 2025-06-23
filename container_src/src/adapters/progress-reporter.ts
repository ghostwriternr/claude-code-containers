/**
 * Progress Reporter for Container → Worker Communication
 * Reports progress updates back to Worker for GitHub comment updates
 */

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

export class ProgressReporter {
  private contextId: string;
  private workerBaseUrl: string;
  private progressUpdates: ProgressUpdate[] = [];

  constructor(contextId: string, workerBaseUrl?: string) {
    this.contextId = contextId;
    this.workerBaseUrl = workerBaseUrl || 'http://worker'; // Default for internal communication
  }

  /**
   * Send progress update to Worker
   */
  async reportProgress(
    status: ProgressUpdate['status'],
    message: string,
    progress?: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    const progressUpdate: ProgressUpdate = {
      contextId: this.contextId,
      status,
      message,
      progress,
      metadata,
      timestamp: new Date().toISOString()
    };

    this.progressUpdates.push(progressUpdate);

    console.log(`[PROGRESS_REPORTER] ${status.toUpperCase()}: ${message}`, {
      contextId: this.contextId,
      progress,
      metadata
    });

    try {
      // Send to Worker's internal progress API
      const response = await fetch(`${this.workerBaseUrl}/api/v1/internal/progress/${this.contextId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(progressUpdate)
      });

      if (!response.ok) {
        console.warn(`[PROGRESS_REPORTER] Failed to send progress update: ${response.status}`);
      } else {
        console.log(`[PROGRESS_REPORTER] Progress update sent successfully`);
      }
    } catch (error) {
      console.warn(`[PROGRESS_REPORTER] Error sending progress update:`, error);
      // Don't throw error - progress reporting should not fail the main task
    }
  }

  /**
   * Send completion notification to Worker
   */
  async reportCompletion(
    success: boolean,
    message: string,
    options?: {
      pullRequestUrl?: string;
      commentId?: number;
      error?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const completion: CompletionNotification = {
      contextId: this.contextId,
      success,
      message,
      pullRequestUrl: options?.pullRequestUrl,
      commentId: options?.commentId,
      error: options?.error,
      metadata: options?.metadata,
      timestamp: new Date().toISOString()
    };

    console.log(`[PROGRESS_REPORTER] COMPLETION: ${success ? 'SUCCESS' : 'FAILED'} - ${message}`, {
      contextId: this.contextId,
      pullRequestUrl: options?.pullRequestUrl,
      error: options?.error
    });

    try {
      // Send to Worker's internal completion API
      const response = await fetch(`${this.workerBaseUrl}/api/v1/internal/completion/${this.contextId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(completion)
      });

      if (!response.ok) {
        console.warn(`[PROGRESS_REPORTER] Failed to send completion notification: ${response.status}`);
      } else {
        console.log(`[PROGRESS_REPORTER] Completion notification sent successfully`);
      }
    } catch (error) {
      console.warn(`[PROGRESS_REPORTER] Error sending completion notification:`, error);
      // Don't throw error - completion reporting should not fail the main task
    }
  }

  /**
   * Get all progress updates for this context
   */
  getProgressHistory(): ProgressUpdate[] {
    return [...this.progressUpdates];
  }

  /**
   * Helper method to report common progress stages
   */
  async reportStage(stage: string, details?: string, progress?: number): Promise<void> {
    const stageMessages: Record<string, string> = {
      'analyzing': '🔍 Analyzing the issue and codebase structure...',
      'exploring': '📂 Exploring repository files and understanding the codebase...',
      'planning': '📋 Planning the solution approach...',
      'implementing': '⚙️ Implementing code changes...',
      'testing': '🧪 Running tests and validating changes...',
      'committing': '📝 Committing changes to repository...',
      'creating-pr': '🚀 Creating pull request...',
      'finalizing': '✅ Finalizing solution and updating status...'
    };

    const message = stageMessages[stage] || `Working on: ${stage}`;
    const fullMessage = details ? `${message}\n${details}` : message;

    await this.reportProgress('in_progress', fullMessage, progress, { stage });
  }

  /**
   * Helper method to report errors with context
   */
  async reportError(error: Error | string, stage?: string): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    const fullMessage = stage 
      ? `❌ Error during ${stage}: ${errorMessage}`
      : `❌ Error: ${errorMessage}`;

    await this.reportProgress('failed', fullMessage, undefined, { 
      stage,
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Helper method to report successful completion
   */
  async reportSuccess(message: string, pullRequestUrl?: string, commentId?: number): Promise<void> {
    await this.reportCompletion(true, message, {
      pullRequestUrl,
      commentId,
      metadata: {
        totalProgressUpdates: this.progressUpdates.length,
        duration: this.calculateDuration()
      }
    });
  }

  /**
   * Helper method to report failed completion
   */
  async reportFailure(error: string, stage?: string): Promise<void> {
    await this.reportCompletion(false, `Failed to complete issue processing: ${error}`, {
      error,
      metadata: {
        stage,
        totalProgressUpdates: this.progressUpdates.length,
        duration: this.calculateDuration()
      }
    });
  }

  /**
   * Calculate duration since first progress update
   */
  private calculateDuration(): number {
    if (this.progressUpdates.length === 0) return 0;
    
    const start = new Date(this.progressUpdates[0].timestamp).getTime();
    const end = new Date().getTime();
    return Math.round((end - start) / 1000); // Duration in seconds
  }
}