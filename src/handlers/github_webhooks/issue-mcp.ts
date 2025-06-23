/**
 * GitHub Issues Event Handler with MCP Integration
 * Updated to use new container orchestration API with MCP-enabled containers
 */

import { GitHubAPI } from "../../github_client";
import { logWithContext } from "../../log";
import { type ContainerExecutionRequest } from "../api/containers";

/**
 * Route GitHub issue to MCP-enabled Claude Code container
 */
async function routeToMcpContainer(
  issue: any, 
  repository: any, 
  env: any, 
  configDO: any
): Promise<void> {
  const contextId = `issue-${repository.full_name}-${issue.number}-${Date.now()}`;

  logWithContext('MCP_ROUTING', 'Routing issue to MCP-enabled container', {
    issueNumber: issue.number,
    issueId: issue.id,
    contextId,
    repository: repository.full_name
  });

  try {
    // Get installation token for GitHub API access
    const tokenResponse = await configDO.fetch(new Request('http://internal/get-installation-token'));
    const tokenData = await tokenResponse.json() as { token: string };

    // Get Claude API key from secure storage
    const claudeConfigId = env.GITHUB_APP_CONFIG.idFromName('claude-config');
    const claudeConfigDO = env.GITHUB_APP_CONFIG.get(claudeConfigId);
    const claudeKeyResponse = await claudeConfigDO.fetch(new Request('http://internal/get-claude-key'));
    const claudeKeyData = await claudeKeyResponse.json() as { anthropicApiKey: string | null };

    if (!claudeKeyData.anthropicApiKey) {
      throw new Error('Claude API key not configured. Please visit /setup/claude first.');
    }

    logWithContext('MCP_ROUTING', 'Credentials retrieved for MCP container', {
      hasGithubToken: !!tokenData.token,
      hasClaudeKey: !!claudeKeyData.anthropicApiKey
    });

    // Prepare container execution request for MCP integration
    const executionRequest: ContainerExecutionRequest = {
      contextId,
      issueData: {
        issueId: issue.id.toString(),
        issueNumber: issue.number.toString(),
        title: issue.title,
        description: issue.body || '',
        labels: issue.labels?.map((label: any) => label.name) || [],
        repositoryUrl: repository.html_url,
        repositoryName: repository.full_name,
        author: issue.user.login
      },
      credentials: {
        githubToken: tokenData.token,
        anthropicApiKey: claudeKeyData.anthropicApiKey
      },
      configuration: {
        allowedTools: [
          'mcp__github__commit_files',
          'mcp__github__delete_files',
          'mcp__github__update_claude_comment'
        ],
        maxExecutionTime: 10 // minutes
      }
    };

    // Execute in MCP-enabled container directly
    logWithContext('MCP_ROUTING', 'Executing issue in MCP container', {
      contextId,
      issueNumber: issue.number
    });

    // Get container instance using the contextId
    const containerId = env.MY_CONTAINER.idFromName(contextId);
    const container = env.MY_CONTAINER.get(containerId);

    // Prepare MCP container payload (matching the new main-mcp.ts format)
    const mcpPayload = {
      // Issue context
      ISSUE_ID: executionRequest.issueData.issueId,
      ISSUE_NUMBER: executionRequest.issueData.issueNumber,
      ISSUE_TITLE: executionRequest.issueData.title,
      ISSUE_BODY: executionRequest.issueData.description,
      ISSUE_LABELS: JSON.stringify(executionRequest.issueData.labels),
      REPOSITORY_URL: executionRequest.issueData.repositoryUrl,
      REPOSITORY_NAME: executionRequest.issueData.repositoryName,
      ISSUE_AUTHOR: executionRequest.issueData.author,

      // Credentials
      GITHUB_TOKEN: executionRequest.credentials.githubToken,
      ANTHROPIC_API_KEY: executionRequest.credentials.anthropicApiKey,

      // MCP configuration
      ALLOWED_TOOLS: JSON.stringify(executionRequest.configuration?.allowedTools || []),
      CUSTOM_INSTRUCTIONS: executionRequest.configuration?.customInstructions || '',
      MAX_EXECUTION_TIME: (executionRequest.configuration?.maxExecutionTime || 10) * 60 * 1000,

      // Container communication
      CONTEXT_ID: contextId,
      
      // GitHub event context
      GITHUB_EVENT_NAME: 'issues',
      IS_PR: 'false'
    };

    // Execute in MCP-enabled container
    const executionResponse = await container.fetch(new Request('http://container/process-issue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mcpPayload)
    }));

    if (!executionResponse.ok) {
      const errorText = await executionResponse.text();
      throw new Error(`MCP container execution failed: ${errorText}`);
    }

    const executionResult = await executionResponse.json();

    logWithContext('MCP_ROUTING', 'MCP container execution started', {
      success: executionResult.success,
      contextId: executionResult.contextId,
      containerId: executionResult.containerId
    });

  } catch (error) {
    logWithContext('MCP_ROUTING', 'Failed to route to MCP container', {
      error: error instanceof Error ? error.message : String(error),
      contextId
    });
    throw error;
  }
}

/**
 * Handle issues events with MCP integration
 */
export async function handleIssuesEventMcp(data: any, env: any, configDO: any): Promise<Response> {
  const action = data.action;
  const issue = data.issue;
  const repository = data.repository;

  logWithContext('ISSUES_EVENT_MCP', 'Processing issue event with MCP integration', {
    action,
    issueNumber: issue.number,
    issueTitle: issue.title,
    repository: repository.full_name,
    author: issue.user?.login,
    labels: issue.labels?.map((label: any) => label.name) || []
  });

  // Create GitHub API client for authenticated requests
  const githubAPI = new GitHubAPI(configDO);

  // Handle new issue creation with MCP-enabled Claude Code
  if (action === 'opened') {
    logWithContext('ISSUES_EVENT_MCP', 'Handling new issue with MCP container');

    try {
      // Post initial acknowledgment comment with MCP capabilities
      await githubAPI.createComment(
        repository.owner.login,
        repository.name,
        issue.number,
        `🔧 **Claude Code Assistant with Advanced Tools**

I've received this issue and I'm analyzing it with my advanced GitHub integration tools. I can:

- 📝 Read and understand your codebase structure
- 🛠️ Make code changes directly to files
- 🔄 Create commits and manage branches
- 📋 Update this comment with my progress in real-time
- 🚀 Create pull requests when ready

I'll start working on a solution now!

---
⚡ Powered by [Claude Code](https://claude.ai/code) with MCP Integration`
      );

      // Route to MCP-enabled Claude Code container
      await routeToMcpContainer(issue, repository, env, configDO);

      logWithContext('ISSUES_EVENT_MCP', 'Issue successfully routed to MCP container');

    } catch (error) {
      logWithContext('ISSUES_EVENT_MCP', 'Failed to process issue with MCP container', {
        error: error instanceof Error ? error.message : String(error),
        issueNumber: issue.number
      });

      // Post error comment
      try {
        await githubAPI.createComment(
          repository.owner.login,
          repository.name,
          issue.number,
          `❌ **Error Starting Claude Code Analysis**

I encountered an error while setting up to work on this issue:

\`\`\`
${(error as Error).message}
\`\`\`

Please check the configuration and try again. You may need to:
- Verify Claude API key is configured at \`/setup/claude\`
- Ensure GitHub app has proper permissions
- Check that the repository is accessible

---
🔧 Claude Code Assistant`
        );
      } catch (commentError) {
        logWithContext('ISSUES_EVENT_MCP', 'Failed to post error comment', {
          commentError: commentError instanceof Error ? commentError.message : String(commentError)
        });
      }
    }
  }

  // Handle issue assignment or labeling that might trigger Claude
  else if (action === 'assigned' || action === 'labeled') {
    logWithContext('ISSUES_EVENT_MCP', 'Checking if issue assignment/labeling should trigger Claude');

    // Check if issue was assigned to Claude or has Claude-trigger labels
    const shouldTrigger = (
      // Check if assigned to a Claude bot user (if configured)
      (action === 'assigned' && data.assignee?.login?.includes('claude')) ||
      // Check for trigger labels
      (action === 'labeled' && (
        data.label?.name?.toLowerCase().includes('claude') ||
        data.label?.name?.toLowerCase().includes('ai-assist')
      ))
    );

    if (shouldTrigger) {
      logWithContext('ISSUES_EVENT_MCP', 'Issue assignment/labeling triggered Claude processing');

      try {
        await githubAPI.createComment(
          repository.owner.login,
          repository.name,
          issue.number,
          `🎯 **Claude Code Triggered**

I've been assigned to work on this issue or it's been labeled for AI assistance. Let me analyze this now!

---
⚡ Powered by [Claude Code](https://claude.ai/code) with MCP Integration`
        );

        await routeToMcpContainer(issue, repository, env, configDO);

      } catch (error) {
        logWithContext('ISSUES_EVENT_MCP', 'Failed to process triggered issue', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  // Handle comment events that might contain Claude triggers
  else if (action === 'comment' && data.comment) {
    const commentBody = data.comment.body?.toLowerCase() || '';
    const triggerPhrases = ['@claude', '/claude', 'claude help', 'claude fix'];
    
    const isTriggered = triggerPhrases.some(phrase => commentBody.includes(phrase));

    if (isTriggered) {
      logWithContext('ISSUES_EVENT_MCP', 'Comment triggered Claude processing', {
        commentAuthor: data.comment.user?.login,
        commentBody: data.comment.body?.substring(0, 100)
      });

      try {
        await githubAPI.createComment(
          repository.owner.login,
          repository.name,
          issue.number,
          `👋 **Claude Code Activated**

I see you've mentioned me! I'm analyzing this issue and will provide assistance.

---
⚡ Powered by [Claude Code](https://claude.ai/code) with MCP Integration`
        );

        await routeToMcpContainer(issue, repository, env, configDO);

      } catch (error) {
        logWithContext('ISSUES_EVENT_MCP', 'Failed to process comment trigger', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return new Response('Issues event processed with MCP integration', { status: 200 });
}