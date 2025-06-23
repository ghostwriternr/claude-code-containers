/**
 * Webhook context adapter for Cloudflare Workers
 * Converts GitHub webhook payloads to claude-code-action's ParsedGitHubContext
 */

import type { ParsedGitHubContext } from '@claude-action';
import type {
  IssuesEvent,
  IssueCommentEvent,
  PullRequestEvent,
  PullRequestReviewEvent,
  PullRequestReviewCommentEvent,
} from '@octokit/webhooks-types';
import type { Env, GitHubWebhookPayload, WorkersClaudeConfig } from './types';
import {
  isIssueWebhook,
  isIssueCommentWebhook,
  isPullRequestWebhook,
  isPullRequestReviewWebhook,
  isPullRequestReviewCommentWebhook,
} from './types';

export class WebhookContextAdapter {
  /**
   * Convert GitHub webhook payload to ParsedGitHubContext
   */
  static async fromWorkerRequest(
    request: Request,
    env: Env,
    configOverrides?: Partial<ParsedGitHubContext['inputs']>
  ): Promise<ParsedGitHubContext> {
    const rawPayload = await request.json();
    
    // Type guard to ensure we have a proper webhook payload
    if (!this.isValidWebhookPayload(rawPayload)) {
      throw new Error('Invalid webhook payload structure');
    }
    
    const payload = rawPayload as GitHubWebhookPayload;
    const eventName = request.headers.get('X-GitHub-Event');
    const eventAction = payload.action;
    
    if (!eventName) {
      throw new Error('Missing X-GitHub-Event header');
    }
    
    // Get configuration from Durable Objects or use defaults
    const config = await this.getConfiguration(env, configOverrides);
    
    const commonFields = {
      runId: crypto.randomUUID(), // Generate unique run ID for Workers
      eventName,
      eventAction,
      repository: {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        full_name: payload.repository.full_name,
      },
      actor: payload.sender.login,
      inputs: config,
    };
    
    // Convert based on event type using type guards
    switch (eventName) {
      case 'issues': {
        if (!isIssueWebhook(payload)) {
          throw new Error('Invalid issues webhook payload');
        }
        return {
          ...commonFields,
          payload: payload as IssuesEvent,
          entityNumber: payload.issue.number,
          isPR: false,
        };
      }
      
      case 'issue_comment': {
        if (!isIssueCommentWebhook(payload)) {
          throw new Error('Invalid issue_comment webhook payload');
        }
        return {
          ...commonFields,
          payload: payload as IssueCommentEvent,
          entityNumber: payload.issue.number,
          isPR: Boolean(payload.issue.pull_request),
        };
      }
      
      case 'pull_request': {
        if (!isPullRequestWebhook(payload)) {
          throw new Error('Invalid pull_request webhook payload');
        }
        return {
          ...commonFields,
          payload: payload as PullRequestEvent,
          entityNumber: payload.pull_request.number,
          isPR: true,
        };
      }
      
      case 'pull_request_review': {
        if (!isPullRequestReviewWebhook(payload)) {
          throw new Error('Invalid pull_request_review webhook payload');
        }
        return {
          ...commonFields,
          payload: payload as PullRequestReviewEvent,
          entityNumber: payload.pull_request.number,
          isPR: true,
        };
      }
      
      case 'pull_request_review_comment': {
        if (!isPullRequestReviewCommentWebhook(payload)) {
          throw new Error('Invalid pull_request_review_comment webhook payload');
        }
        return {
          ...commonFields,
          payload: payload as PullRequestReviewCommentEvent,
          entityNumber: payload.pull_request.number,
          isPR: true,
        };
      }
      
      default:
        throw new Error(`Unsupported event type: ${eventName}`);
    }
  }
  
  /**
   * Type guard to validate webhook payload structure
   */
  private static isValidWebhookPayload(payload: unknown): payload is GitHubWebhookPayload {
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }
    
    const obj = payload as Record<string, unknown>;
    
    return (
      typeof obj.repository === 'object' &&
      obj.repository !== null &&
      typeof (obj.repository as Record<string, unknown>).name === 'string' &&
      typeof (obj.repository as Record<string, unknown>).full_name === 'string' &&
      typeof obj.sender === 'object' &&
      obj.sender !== null &&
      typeof (obj.sender as Record<string, unknown>).login === 'string'
    );
  }
  
  /**
   * Get configuration from Durable Objects with defaults
   */
  private static async getConfiguration(
    env: Env,
    overrides?: Partial<ParsedGitHubContext['inputs']>
  ): Promise<ParsedGitHubContext['inputs']> {
    // Default configuration
    const defaults = {
      triggerPhrase: '@claude',
      assigneeTrigger: '',
      allowedTools: [] as string[],
      disallowedTools: [] as string[],
      customInstructions: '',
      directPrompt: '',
      baseBranch: undefined,
    };
    
    try {
      // Try to get configuration from Durable Objects
      if (env.GITHUB_APP_CONFIG) {
        const configId = env.GITHUB_APP_CONFIG.idFromName('global');
        const config = env.GITHUB_APP_CONFIG.get(configId);
        
        // Cast to our interface (this would need to match your actual DO implementation)
        const configDO = config as unknown as { getConfig(): Promise<Partial<WorkersClaudeConfig>> };
        const storedConfig = await configDO.getConfig();
        
        return {
          ...defaults,
          ...storedConfig,
          ...overrides,
        };
      }
    } catch (error) {
      console.warn('Could not load configuration from Durable Objects:', error);
    }
    
    return {
      ...defaults,
      ...overrides,
    };
  }
  
  /**
   * Extract repository information from webhook payload
   */
  static extractRepositoryInfo(payload: any): {
    owner: string;
    repo: string;
    full_name: string;
  } {
    return {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      full_name: payload.repository.full_name,
    };
  }
  
  /**
   * Check if the webhook event should trigger Claude processing
   */
  static shouldProcess(
    context: ParsedGitHubContext,
    payload: GitHubWebhookPayload
  ): boolean {
    // Basic trigger detection logic
    const triggerPhrase = context.inputs.triggerPhrase.toLowerCase();
    
    switch (context.eventName) {
      case 'issues':
        if (isIssueWebhook(payload)) {
          return payload.issue.title.toLowerCase().includes(triggerPhrase) ||
                 payload.issue.body?.toLowerCase().includes(triggerPhrase) || false;
        }
        return false;
               
      case 'issue_comment':
        if (isIssueCommentWebhook(payload)) {
          return payload.comment.body.toLowerCase().includes(triggerPhrase);
        }
        return false;
        
      case 'pull_request':
        if (isPullRequestWebhook(payload)) {
          return payload.pull_request.title.toLowerCase().includes(triggerPhrase) ||
                 payload.pull_request.body?.toLowerCase().includes(triggerPhrase) || false;
        }
        return false;
               
      case 'pull_request_review':
        if (isPullRequestReviewWebhook(payload)) {
          return payload.review.body?.toLowerCase().includes(triggerPhrase) || false;
        }
        return false;
        
      case 'pull_request_review_comment':
        if (isPullRequestReviewCommentWebhook(payload)) {
          return payload.comment.body.toLowerCase().includes(triggerPhrase);
        }
        return false;
        
      default:
        return false;
    }
  }
}