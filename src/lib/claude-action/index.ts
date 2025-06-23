/**
 * Main barrel export for claude-code-action utilities
 * Provides clean imports for commonly used functions and types
 */

// GitHub API utilities
export { createOctokit } from '@claude-action/github/api/client';
export type { Octokits } from '@claude-action/github/api/client';

// Context and data fetching
export { 
  parseGitHubContext,
  isIssuesEvent,
  isIssueCommentEvent,
  isPullRequestEvent,
  isPullRequestReviewEvent,
  isPullRequestReviewCommentEvent
} from '@claude-action/github/context';
export { fetchGitHubData } from '@claude-action/github/data/fetcher';
export { 
  formatContext,
  formatBody,
  formatComments,
  formatReviewComments,
  formatChangedFilesWithSHA
} from '@claude-action/github/data/formatter';

// Prompt generation
export { 
  buildAllowedToolsString,
  buildDisallowedToolsString
} from '@claude-action/create-prompt';

// Comment operations
export { createInitialComment } from '@claude-action/github/operations/comments/create-initial';
export { updateClaudeComment } from '@claude-action/github/operations/comments/update-claude-comment';
export { updateTrackingComment } from '@claude-action/github/operations/comments/update-with-branch';

// Utility functions
export { sanitizeContent } from '@claude-action/github/utils/sanitizer';
export { downloadCommentImages } from '@claude-action/github/utils/image-downloader';

// Types
export type { 
  ParsedGitHubContext
} from '@claude-action/github/context';

export type { 
  GitHubIssue,
  GitHubPullRequest,
  GitHubComment,
  GitHubFile,
  GitHubAuthor
} from '@claude-action/github/types';

export type {
  FetchDataResult,
  GitHubFileWithSHA
} from '@claude-action/github/data/fetcher';

export type {
  CommonFields,
  PreparedContext
} from '@claude-action/create-prompt';