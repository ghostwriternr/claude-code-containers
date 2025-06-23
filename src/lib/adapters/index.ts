/**
 * Adapters barrel export
 * All Workers-specific adapter layers for claude-code-action integration
 */

export { WorkersGitHubClient } from './github-client';
export { WorkersAuthManager } from './auth-manager';
export { WebhookContextAdapter } from './webhook-context';
export { WorkersDataFetcher, R2ImageHandler } from './data-fetcher';
export { WorkersErrorHandler } from './error-handler';

// Phase 2 exports - Core Integration
export { WorkersPromptGenerator } from './prompt-generator';
export { ConfigManager } from './config-bridge';
export { WorkersCommentManager } from './comment-manager';
export { ProgressBridge, ProgressMiddleware } from './progress-bridge';

// Export types
export type * from './types';
export type { WorkersPromptConfig } from './prompt-generator';
export type { RepositoryConfig } from './config-bridge';
export type { CommentProgress, InitialCommentData } from './comment-manager';
export type { ProgressState, ContainerProgressRequest } from './progress-bridge';