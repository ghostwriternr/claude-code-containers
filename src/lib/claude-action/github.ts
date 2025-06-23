/**
 * GitHub-specific utilities barrel export
 * Focused exports for GitHub API, data fetching, and operations
 */

// API client and configuration
export { createOctokit } from '@claude-action/github/api/client';
export type { Octokits } from '@claude-action/github/api/client';

// Context parsing and data operations
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

// Comment management
export { createInitialComment } from '@claude-action/github/operations/comments/create-initial';
export { updateClaudeComment } from '@claude-action/github/operations/comments/update-claude-comment';
export { updateTrackingComment } from '@claude-action/github/operations/comments/update-with-branch';

// Validation and security
export { sanitizeContent } from '@claude-action/github/utils/sanitizer';

// Image handling
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