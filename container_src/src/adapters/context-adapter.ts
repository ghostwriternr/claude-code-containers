/**
 * Context Adapter for claude-code-action integration
 * Converts Worker payload to ParsedGitHubContext format
 */

import type { 
  IssuesEvent, 
  IssueCommentEvent, 
  PullRequestEvent 
} from "@octokit/webhooks-types";

export interface ParsedGitHubContext {
  runId: string;
  eventName: string;
  eventAction?: string;
  repository: {
    owner: string;
    repo: string;
    full_name: string;
  };
  actor: string;
  payload: IssuesEvent | IssueCommentEvent | PullRequestEvent;
  entityNumber: number;
  isPR: boolean;
  inputs: {
    triggerPhrase: string;
    assigneeTrigger: string;
    allowedTools: string[];
    disallowedTools: string[];
    customInstructions: string;
    directPrompt: string;
    baseBranch?: string;
  };
}

export interface WorkerPayload {
  // Issue context
  ISSUE_ID: string;
  ISSUE_NUMBER: string;
  ISSUE_TITLE: string;
  ISSUE_BODY: string;
  ISSUE_LABELS: string; // JSON string
  REPOSITORY_URL: string;
  REPOSITORY_NAME: string;
  ISSUE_AUTHOR: string;

  // Credentials
  GITHUB_TOKEN: string;
  ANTHROPIC_API_KEY: string;

  // MCP configuration
  ALLOWED_TOOLS: string; // JSON string
  CUSTOM_INSTRUCTIONS?: string;
  MAX_EXECUTION_TIME?: string;

  // Container communication
  CONTEXT_ID: string;
  WORKER_BASE_URL?: string;
  
  // GitHub event context
  GITHUB_EVENT_NAME: string;
  IS_PR: string;
}

/**
 * Convert Worker payload to ParsedGitHubContext format
 */
export function convertWorkerPayloadToContext(payload: WorkerPayload): ParsedGitHubContext {
  const [owner, repo] = payload.REPOSITORY_NAME.split('/');
  const labels = JSON.parse(payload.ISSUE_LABELS || '[]');
  const allowedTools = JSON.parse(payload.ALLOWED_TOOLS || '[]');
  
  // Create GitHub Issues event payload
  const issuesPayload: IssuesEvent = {
    action: 'opened', // Default action for issue processing
    issue: {
      id: parseInt(payload.ISSUE_ID),
      number: parseInt(payload.ISSUE_NUMBER),
      title: payload.ISSUE_TITLE,
      body: payload.ISSUE_BODY,
      labels: labels.map((label: string) => ({
        id: 0, // We don't have label IDs from Worker
        name: label,
        color: '',
        default: false,
        description: null,
        node_id: '',
        url: ''
      })),
      user: {
        login: payload.ISSUE_AUTHOR,
        id: 0, // We don't have user ID from Worker
        node_id: '',
        avatar_url: '',
        gravatar_id: '',
        url: '',
        html_url: '',
        followers_url: '',
        following_url: '',
        gists_url: '',
        starred_url: '',
        subscriptions_url: '',
        organizations_url: '',
        repos_url: '',
        events_url: '',
        received_events_url: '',
        type: 'User',
        site_admin: false
      },
      state: 'open',
      locked: false,
      assignee: null,
      assignees: [],
      milestone: null,
      comments: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      closed_at: null,
      author_association: 'NONE',
      active_lock_reason: null,
      draft: false,
      pull_request: undefined,
      reactions: {
        url: '',
        total_count: 0,
        '+1': 0,
        '-1': 0,
        laugh: 0,
        hooray: 0,
        confused: 0,
        heart: 0,
        rocket: 0,
        eyes: 0
      },
      timeline_url: '',
      performed_via_github_app: null,
      state_reason: null,
      node_id: '',
      url: '',
      repository_url: '',
      labels_url: '',
      comments_url: '',
      events_url: '',
      html_url: `${payload.REPOSITORY_URL}/issues/${payload.ISSUE_NUMBER}`
    },
    repository: {
      id: 0,
      node_id: '',
      name: repo,
      full_name: payload.REPOSITORY_NAME,
      private: false,
      owner: {
        login: owner,
        id: 0,
        node_id: '',
        avatar_url: '',
        gravatar_id: '',
        url: '',
        html_url: '',
        followers_url: '',
        following_url: '',
        gists_url: '',
        starred_url: '',
        subscriptions_url: '',
        organizations_url: '',
        repos_url: '',
        events_url: '',
        received_events_url: '',
        type: 'User',
        site_admin: false
      },
      html_url: payload.REPOSITORY_URL,
      description: null,
      fork: false,
      url: '',
      forks_url: '',
      keys_url: '',
      collaborators_url: '',
      teams_url: '',
      hooks_url: '',
      issue_events_url: '',
      events_url: '',
      assignees_url: '',
      branches_url: '',
      tags_url: '',
      blobs_url: '',
      git_tags_url: '',
      git_refs_url: '',
      trees_url: '',
      statuses_url: '',
      languages_url: '',
      stargazers_url: '',
      contributors_url: '',
      subscribers_url: '',
      subscription_url: '',
      commits_url: '',
      git_commits_url: '',
      comments_url: '',
      issue_comment_url: '',
      contents_url: '',
      compare_url: '',
      merges_url: '',
      archive_url: '',
      downloads_url: '',
      issues_url: '',
      pulls_url: '',
      milestones_url: '',
      notifications_url: '',
      labels_url: '',
      releases_url: '',
      deployments_url: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      pushed_at: new Date().toISOString(),
      git_url: '',
      ssh_url: '',
      clone_url: `${payload.REPOSITORY_URL}.git`,
      svn_url: '',
      homepage: null,
      size: 0,
      stargazers_count: 0,
      watchers_count: 0,
      language: null,
      has_issues: true,
      has_projects: true,
      has_wiki: true,
      has_pages: false,
      has_downloads: true,
      archived: false,
      disabled: false,
      open_issues_count: 0,
      license: null,
      allow_forking: true,
      is_template: false,
      web_commit_signoff_required: false,
      topics: [],
      visibility: 'public',
      forks: 0,
      open_issues: 0,
      watchers: 0,
      default_branch: 'main',
      temp_clone_token: null,
      allow_squash_merge: true,
      allow_merge_commit: true,
      allow_rebase_merge: true,
      allow_auto_merge: false,
      delete_branch_on_merge: false,
      allow_update_branch: false,
      use_squash_pr_title_as_default: false,
      squash_merge_commit_title: 'COMMIT_OR_PR_TITLE',
      squash_merge_commit_message: 'COMMIT_MESSAGES',
      merge_commit_title: 'MERGE_MESSAGE',
      merge_commit_message: 'PR_TITLE',
      permissions: {
        admin: false,
        maintain: false,
        push: false,
        triage: false,
        pull: true
      }
    } as any,
    sender: {
      login: payload.ISSUE_AUTHOR,
      id: 0,
      node_id: '',
      avatar_url: '',
      gravatar_id: '',
      url: '',
      html_url: '',
      followers_url: '',
      following_url: '',
      gists_url: '',
      starred_url: '',
      subscriptions_url: '',
      organizations_url: '',
      repos_url: '',
      events_url: '',
      received_events_url: '',
      type: 'User',
      site_admin: false
    },
    installation: {
      id: 0, // We'll need to get this from the Worker
      node_id: ''
    }
  };

  // Create ParsedGitHubContext
  const context: ParsedGitHubContext = {
    runId: payload.CONTEXT_ID, // Use contextId as runId
    eventName: payload.GITHUB_EVENT_NAME || 'issues',
    eventAction: 'opened', // Default action
    repository: {
      owner,
      repo,
      full_name: payload.REPOSITORY_NAME
    },
    actor: payload.ISSUE_AUTHOR,
    payload: issuesPayload,
    entityNumber: parseInt(payload.ISSUE_NUMBER),
    isPR: payload.IS_PR === 'true',
    inputs: {
      triggerPhrase: '@claude',
      assigneeTrigger: '',
      allowedTools,
      disallowedTools: [],
      customInstructions: payload.CUSTOM_INSTRUCTIONS || '',
      directPrompt: '',
      baseBranch: 'main' // Default branch
    }
  };

  return context;
}

/**
 * Parse multiline input (from claude-code-action)
 */
export function parseMultilineInput(s: string): string[] {
  return s
    .split(/,|[\n\r]+/)
    .map((tool) => tool.replace(/#.+$/, ""))
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
}

/**
 * Type guards for different event types
 */
export function isIssuesEvent(
  context: ParsedGitHubContext,
): context is ParsedGitHubContext & { payload: IssuesEvent } {
  return context.eventName === 'issues';
}

export function isIssueCommentEvent(
  context: ParsedGitHubContext,
): context is ParsedGitHubContext & { payload: IssueCommentEvent } {
  return context.eventName === 'issue_comment';
}

export function isPullRequestEvent(
  context: ParsedGitHubContext,
): context is ParsedGitHubContext & { payload: PullRequestEvent } {
  return context.eventName === 'pull_request';
}

/**
 * Extract credentials from Worker payload
 */
export interface ContainerCredentials {
  githubToken: string;
  anthropicApiKey: string;
}

export function extractCredentials(payload: WorkerPayload): ContainerCredentials {
  return {
    githubToken: payload.GITHUB_TOKEN,
    anthropicApiKey: payload.ANTHROPIC_API_KEY
  };
}

/**
 * Extract container configuration from Worker payload
 */
export interface ContainerConfiguration {
  maxExecutionTime: number; // milliseconds
  workerBaseUrl?: string;
  contextId: string;
}

export function extractConfiguration(payload: WorkerPayload): ContainerConfiguration {
  return {
    maxExecutionTime: payload.MAX_EXECUTION_TIME ? parseInt(payload.MAX_EXECUTION_TIME) : 600000, // 10 minutes default
    workerBaseUrl: payload.WORKER_BASE_URL,
    contextId: payload.CONTEXT_ID
  };
}