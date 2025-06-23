import type { ParsedGitHubContext } from '@adapters/types';
import type { Octokits } from '@adapters/github-client';
// Use the global Env type from worker-configuration.d.ts

export interface CommentProgress {
  stage: 'analyzing' | 'processing' | 'implementing' | 'testing' | 'completing';
  message: string;
  details?: string;
  filesProcessed?: number;
  totalFiles?: number;
  timestamp: number;
}

export interface InitialCommentData {
  id: number;
  url: string;
  body: string;
}

export class WorkersCommentManager {
  constructor(private env: Env) {}

  /**
   * Create initial comment in Worker (fast GitHub operation)
   * This lets users know Claude is working immediately
   */
  async createInitialComment(
    octokits: Octokits,
    context: ParsedGitHubContext
  ): Promise<InitialCommentData> {
    const body = this.buildInitialCommentBody(context);
    
    const response = await octokits.rest.issues.createComment({
      owner: context.repository.owner,
      repo: context.repository.repo,
      issue_number: context.entityNumber,
      body
    });

    return {
      id: response.data.id,
      url: response.data.html_url,
      body: response.data.body
    };
  }

  /**
   * Update comment with progress (called from Container via Worker)
   * This creates a clear separation: Container reports progress, Worker updates GitHub
   */
  async updateCommentProgress(
    octokits: Octokits,
    context: ParsedGitHubContext,
    commentId: number,
    progress: CommentProgress
  ): Promise<void> {
    const body = this.buildProgressCommentBody(context, progress);
    
    await octokits.rest.issues.updateComment({
      owner: context.repository.owner,
      repo: context.repository.repo,
      comment_id: commentId,
      body
    });
  }

  /**
   * Create final completion comment (called from Container via Worker)
   */
  async createCompletionComment(
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
    const body = this.buildCompletionCommentBody(context, result);
    
    await octokits.rest.issues.createComment({
      owner: context.repository.owner,
      repo: context.repository.repo,
      issue_number: context.entityNumber,
      body
    });
  }

  /**
   * Build initial comment body using claude-code-action style
   */
  private buildInitialCommentBody(context: ParsedGitHubContext): string {
    const eventType = context.isPR ? 'pull request' : 'issue';
    const entityUrl = `https://github.com/${context.repository?.full_name || 'unknown'}/${context.isPR ? 'pull' : 'issues'}/${context.entityNumber}`;
    
    return `## 🤖 Claude Code is analyzing this ${eventType}

I'm starting to work on this ${eventType}. I'll analyze the requirements and begin implementation.

**Status:** 🔍 Analyzing requirements and codebase structure

---

*Powered by [Claude Code](https://claude.ai/code) running on Cloudflare Workers*`;
  }

  /**
   * Build progress update comment body
   */
  private buildProgressCommentBody(context: ParsedGitHubContext, progress: CommentProgress): string {
    const stageEmoji = this.getStageEmoji(progress.stage);
    const progressBar = this.buildProgressBar(progress);
    const timestamp = new Date(progress.timestamp).toLocaleTimeString();
    
    let body = `## 🤖 Claude Code is working on this ${context.isPR ? 'pull request' : 'issue'}

**Current Status:** ${stageEmoji} ${this.getStageDescription(progress.stage)}

${progress.message}`;

    if (progress.details) {
      body += `\n\n### Details\n${progress.details}`;
    }

    if (progressBar) {
      body += `\n\n### Progress\n${progressBar}`;
    }

    body += `\n\n*Last updated: ${timestamp}*`;
    body += `\n\n---\n*Powered by [Claude Code](https://claude.ai/code) running on Cloudflare Workers*`;

    return body;
  }

  /**
   * Build completion comment body
   */
  private buildCompletionCommentBody(
    context: ParsedGitHubContext,
    result: {
      success: boolean;
      pullRequestUrl?: string;
      summary: string;
      filesModified?: string[];
      error?: string;
    }
  ): string {
    const emoji = result.success ? '✅' : '❌';
    const status = result.success ? 'completed' : 'encountered an error';
    
    let body = `## ${emoji} Claude Code has ${status}

${result.summary}`;

    if (result.success && result.pullRequestUrl) {
      body += `\n\n### 🔗 Solution Available\nI've created a pull request with the implementation: ${result.pullRequestUrl}`;
    }

    if (result.filesModified && result.filesModified.length > 0) {
      body += `\n\n### 📝 Files Modified\n`;
      result.filesModified.forEach(file => {
        body += `- \`${file}\`\n`;
      });
    }

    if (!result.success && result.error) {
      body += `\n\n### ❌ Error Details\n\`\`\`\n${result.error}\n\`\`\``;
    }

    body += `\n\n---\n*Powered by [Claude Code](https://claude.ai/code) running on Cloudflare Workers*`;

    return body;
  }

  /**
   * Get emoji for progress stage
   */
  private getStageEmoji(stage: CommentProgress['stage']): string {
    const emojis = {
      analyzing: '🔍',
      processing: '⚙️',
      implementing: '💻',
      testing: '🧪',
      completing: '✨'
    };
    return emojis[stage];
  }

  /**
   * Get human-readable stage description
   */
  private getStageDescription(stage: CommentProgress['stage']): string {
    const descriptions = {
      analyzing: 'Analyzing requirements and codebase',
      processing: 'Processing repository data',
      implementing: 'Implementing solution',
      testing: 'Running tests and validation',
      completing: 'Finalizing changes'
    };
    return descriptions[stage];
  }

  /**
   * Build progress bar if file processing info is available
   */
  private buildProgressBar(progress: CommentProgress): string | null {
    if (!progress.filesProcessed || !progress.totalFiles) {
      return null;
    }

    const percentage = Math.round((progress.filesProcessed / progress.totalFiles) * 100);
    const filled = Math.round(percentage / 5); // 20 character bar
    const empty = 20 - filled;
    
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    
    return `\`${bar}\` ${percentage}% (${progress.filesProcessed}/${progress.totalFiles} files)`;
  }

  /**
   * Create progress callback for Container to use
   * This function will be passed to the Container for real-time updates
   */
  createProgressCallback(
    octokits: Octokits,
    context: ParsedGitHubContext,
    commentId: number
  ): (progress: CommentProgress) => Promise<void> {
    return async (progress: CommentProgress) => {
      try {
        await this.updateCommentProgress(octokits, context, commentId, progress);
      } catch (error) {
        console.error('Failed to update comment progress:', error);
        // Don't throw - progress update failures shouldn't stop the main process
      }
    };
  }
}