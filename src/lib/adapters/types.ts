/**
 * Type definitions for adapter layer
 * Provides proper typing for Workers-specific functionality
 */

import type { ParsedGitHubContext } from '@claude-action';

// GitHub webhook payload types (basic structure)
export interface GitHubWebhookPayload {
  action?: string;
  repository: {
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
  };
  sender: {
    login: string;
  };
}

export interface IssueWebhookPayload extends GitHubWebhookPayload {
  issue: {
    number: number;
    title: string;
    body: string | null;
  };
}

export interface IssueCommentWebhookPayload extends GitHubWebhookPayload {
  issue: {
    number: number;
    pull_request?: unknown;
  };
  comment: {
    body: string;
  };
}

export interface PullRequestWebhookPayload extends GitHubWebhookPayload {
  pull_request: {
    number: number;
    title: string;
    body: string | null;
  };
}

export interface PullRequestReviewWebhookPayload extends GitHubWebhookPayload {
  pull_request: {
    number: number;
  };
  review: {
    body: string | null;
  };
}

export interface PullRequestReviewCommentWebhookPayload extends GitHubWebhookPayload {
  pull_request: {
    number: number;
  };
  comment: {
    body: string;
  };
}

// Union type for all webhook payloads
export type WebhookPayload = 
  | IssueWebhookPayload
  | IssueCommentWebhookPayload
  | PullRequestWebhookPayload
  | PullRequestReviewWebhookPayload
  | PullRequestReviewCommentWebhookPayload;

// Configuration types
export interface WorkersClaudeConfig {
  triggerPhrase: string;
  assigneeTrigger: string;
  allowedTools: string[];
  disallowedTools: string[];
  customInstructions: string;
  directPrompt: string;
  baseBranch?: string;
}

// Durable Object interfaces (mock until real implementation)
export interface GitHubAppConfigDO {
  getInstallationToken(owner: string, repo: string): Promise<string | null>;
  getStatus(): Promise<{ configured: boolean }>;
  getConfig(): Promise<Partial<WorkersClaudeConfig>>;
  getInstallationId(owner: string, repo: string): Promise<number | null>;
}

// Extended Env interface
export interface Env {
  GITHUB_APP_CONFIG?: DurableObjectNamespace;
  R2_BUCKET?: R2Bucket;
}

// Type guards for webhook payloads
export function isIssueWebhook(payload: GitHubWebhookPayload): payload is IssueWebhookPayload {
  return 'issue' in payload && typeof (payload as IssueWebhookPayload).issue.number === 'number';
}

export function isIssueCommentWebhook(payload: GitHubWebhookPayload): payload is IssueCommentWebhookPayload {
  return 'issue' in payload && 'comment' in payload && 
         typeof (payload as IssueCommentWebhookPayload).comment.body === 'string';
}

export function isPullRequestWebhook(payload: GitHubWebhookPayload): payload is PullRequestWebhookPayload {
  return 'pull_request' in payload && 
         typeof (payload as PullRequestWebhookPayload).pull_request.number === 'number';
}

export function isPullRequestReviewWebhook(payload: GitHubWebhookPayload): payload is PullRequestReviewWebhookPayload {
  return 'pull_request' in payload && 'review' in payload;
}

export function isPullRequestReviewCommentWebhook(payload: GitHubWebhookPayload): payload is PullRequestReviewCommentWebhookPayload {
  return 'pull_request' in payload && 'comment' in payload && 
         typeof (payload as PullRequestReviewCommentWebhookPayload).comment.body === 'string';
}