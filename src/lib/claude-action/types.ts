/**
 * Shared types barrel export
 * Re-exports all important types from claude-code-action
 */

// GitHub context types
export type {
  ParsedGitHubContext
} from '@claude-action/github/context';

// GitHub data types
export type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubComment,
  GitHubFile,
  GitHubAuthor,
  GitHubReview
} from '@claude-action/github/types';

// Data fetcher types
export type {
  FetchDataResult,
  GitHubFileWithSHA
} from '@claude-action/github/data/fetcher';

// Prompt types
export type {
  CommonFields,
  PreparedContext
} from '@claude-action/create-prompt/types';

// API types
export type { 
  Octokits 
} from '@claude-action/github/api/client';