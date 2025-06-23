/**
 * Adapters barrel export
 * All Workers-specific adapter layers for claude-code-action integration
 */

export { WorkersGitHubClient } from './github-client';
export { WorkersAuthManager } from './auth-manager';
export { WebhookContextAdapter } from './webhook-context';
export { WorkersDataFetcher, R2ImageHandler } from './data-fetcher';
export { WorkersErrorHandler } from './error-handler';

// Export types
export type * from './types';