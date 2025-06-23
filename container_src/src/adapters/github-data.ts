/**
 * GitHub Data Adapter
 * Bridges container environment to claude-code-action's data fetching
 */

import { Octokit } from '@octokit/rest';

export interface GitHubContext {
  eventName: string;
  repository: {
    owner: string;
    repo: string;
    full_name: string;
  };
  actor: string;
  payload: any;
}

export interface IssuePayload {
  issueId: string;
  issueNumber: string;
  title: string;
  description: string;
  labels: string[];
  repositoryUrl: string;
  repositoryName: string;
  author: string;
}

/**
 * Convert container issue payload to claude-code-action GitHubContext format
 */
export function convertIssuePayloadToContext(issuePayload: IssuePayload): GitHubContext {
  const [owner, repo] = issuePayload.repositoryName.split('/');
  
  return {
    eventName: 'issues',
    repository: {
      owner,
      repo,
      full_name: issuePayload.repositoryName
    },
    actor: issuePayload.author,
    payload: {
      action: 'opened',
      issue: {
        id: parseInt(issuePayload.issueId),
        number: parseInt(issuePayload.issueNumber),
        title: issuePayload.title,
        body: issuePayload.description,
        labels: issuePayload.labels.map(label => ({ name: label })),
        user: {
          login: issuePayload.author
        },
        html_url: `${issuePayload.repositoryUrl}/issues/${issuePayload.issueNumber}`
      },
      repository: {
        name: repo,
        owner: {
          login: owner
        },
        full_name: issuePayload.repositoryName,
        html_url: issuePayload.repositoryUrl,
        clone_url: `${issuePayload.repositoryUrl}.git`
      },
      sender: {
        login: issuePayload.author
      }
    }
  };
}

/**
 * Create Octokit client for GitHub API operations
 */
export function createOctokitClient(githubToken: string): Octokit {
  return new Octokit({
    auth: githubToken,
    baseUrl: 'https://api.github.com'
  });
}

/**
 * Create installation comment on the issue
 */
export async function createInitialComment(
  octokit: Octokit,
  context: GitHubContext,
  message: string = "🔧 Claude is analyzing this issue and will provide a solution..."
): Promise<{ id: number; html_url: string }> {
  const { owner, repo } = context.repository;
  const issueNumber = context.payload.issue.number;

  const response = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: message
  });

  return {
    id: response.data.id,
    html_url: response.data.html_url
  };
}

/**
 * Update an existing comment
 */
export async function updateComment(
  octokit: Octokit,
  context: GitHubContext,
  commentId: number,
  body: string
): Promise<void> {
  const { owner, repo } = context.repository;

  await octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body
  });
}

/**
 * Create a pull request
 */
export async function createPullRequest(
  octokit: Octokit,
  context: GitHubContext,
  title: string,
  body: string,
  head: string,
  base: string = 'main'
): Promise<{ number: number; html_url: string }> {
  const { owner, repo } = context.repository;

  const response = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head,
    base
  });

  return {
    number: response.data.number,
    html_url: response.data.html_url
  };
}