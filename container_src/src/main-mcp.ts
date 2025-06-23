/**
 * Container Main with MCP Server Integration
 * Uses claude-code-action's MCP server directly for GitHub operations
 */

import * as http from 'http';
import { promises as fs } from 'fs';
import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import simpleGit from 'simple-git';
import * as path from 'path';
import { spawn } from 'child_process';
import { setupMcpEnvironment, type McpConfigParams } from './adapters/mcp-config.js';
import { 
  convertIssuePayloadToContext, 
  createOctokitClient, 
  createInitialComment, 
  updateComment,
  createPullRequest,
  type IssuePayload,
  type GitHubContext 
} from './adapters/github-data.js';
import { ProgressReporter } from './adapters/progress-reporter.js';

const PORT = 8080;

// Environment variables
const MESSAGE = process.env.MESSAGE || 'Hello from Claude Code Container with MCP';
const INSTANCE_ID = process.env.CLOUDFLARE_DEPLOYMENT_ID || 'unknown';

interface ContainerResponse {
  success: boolean;
  message: string;
  error?: string;
  pullRequestUrl?: string;
  commentId?: number;
}

interface HealthStatus {
  status: string;
  message: string;
  instanceId: string;
  timestamp: string;
  claudeCodeAvailable: boolean;
  githubTokenAvailable: boolean;
  mcpServerReady: boolean;
}

// Enhanced logging utility
function logWithContext(context: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [MCP-${context}] ${message}`;

  if (data) {
    console.log(logMessage, JSON.stringify(data, null, 2));
  } else {
    console.log(logMessage);
  }
}

// Health check handler with MCP status
async function healthHandler(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  logWithContext('HEALTH', 'Health check requested');

  const response: HealthStatus = {
    status: 'healthy',
    message: MESSAGE,
    instanceId: INSTANCE_ID,
    timestamp: new Date().toISOString(),
    claudeCodeAvailable: !!process.env.ANTHROPIC_API_KEY,
    githubTokenAvailable: !!process.env.GITHUB_TOKEN,
    mcpServerReady: await checkMcpServerHealth()
  };

  logWithContext('HEALTH', 'Health check response', {
    status: response.status,
    mcpServerReady: response.mcpServerReady,
    claudeCodeAvailable: response.claudeCodeAvailable,
    githubTokenAvailable: response.githubTokenAvailable
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

// Check if MCP server dependencies are available
async function checkMcpServerHealth(): Promise<boolean> {
  try {
    // Check if claude-code-action directory exists
    const claudeActionPath = '/app/claude-action';
    await fs.access(claudeActionPath);
    
    // Check if MCP server file exists
    const mcpServerPath = path.join(claudeActionPath, 'src/mcp/github-file-ops-server.ts');
    await fs.access(mcpServerPath);
    
    return true;
  } catch (error) {
    logWithContext('MCP_HEALTH', 'MCP server health check failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

// Setup workspace with git clone (similar to original but with MCP integration)
async function setupWorkspace(repositoryUrl: string, issueNumber: string): Promise<string> {
  const workspaceDir = `/tmp/workspace/issue-${issueNumber}`;

  logWithContext('WORKSPACE', 'Setting up workspace for MCP server', {
    workspaceDir,
    repositoryUrl,
    issueNumber
  });

  try {
    await fs.mkdir(path.dirname(workspaceDir), { recursive: true });

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      throw new Error('GitHub token not available for cloning');
    }

    // Construct authenticated clone URL
    const authenticatedUrl = repositoryUrl.replace(
      'https://github.com/',
      `https://x-access-token:${githubToken}@github.com/`
    );

    logWithContext('WORKSPACE', 'Starting git clone for MCP workspace');

    // Clone repository
    await new Promise<void>((resolve, reject) => {
      const gitProcess = spawn('git', ['clone', authenticatedUrl, workspaceDir], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      gitProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      gitProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      gitProcess.on('close', (code: number) => {
        if (code === 0) {
          logWithContext('WORKSPACE', 'Git clone completed for MCP workspace');
          resolve();
        } else {
          logWithContext('WORKSPACE', 'Git clone failed', { code, stderr });
          reject(new Error(`Git clone failed with code ${code}: ${stderr}`));
        }
      });
    });

    // Initialize git workspace
    await initializeGitWorkspace(workspaceDir);

    return workspaceDir;
  } catch (error) {
    logWithContext('WORKSPACE', 'Error setting up MCP workspace', {
      error: (error as Error).message
    });
    throw error;
  }
}

// Initialize git workspace for MCP server
async function initializeGitWorkspace(workspaceDir: string): Promise<void> {
  logWithContext('GIT_WORKSPACE', 'Configuring git workspace for MCP operations', { workspaceDir });

  const git = simpleGit(workspaceDir);

  try {
    await git.addConfig('user.name', 'Claude Code Bot');
    await git.addConfig('user.email', 'claude-code@anthropic.com');
    await git.fetch('origin');

    const status = await git.status();
    logWithContext('GIT_WORKSPACE', 'Git workspace configured for MCP', {
      currentBranch: status.current,
      isClean: status.isClean()
    });

    if (status.behind > 0) {
      await git.pull('origin', status.current || 'main');
    }
  } catch (error) {
    logWithContext('GIT_WORKSPACE', 'Error configuring git workspace for MCP', {
      error: (error as Error).message
    });
    throw error;
  }
}

// Create feature branch for MCP-generated changes
async function createFeatureBranch(workspaceDir: string, branchName: string): Promise<void> {
  const git = simpleGit(workspaceDir);
  
  try {
    await git.checkoutLocalBranch(branchName);
    await git.push('origin', branchName, ['--set-upstream']);
    
    logWithContext('GIT_WORKSPACE', 'Feature branch created for MCP changes', { branchName });
  } catch (error) {
    logWithContext('GIT_WORKSPACE', 'Error creating feature branch', {
      error: (error as Error).message,
      branchName
    });
    throw error;
  }
}

// Generate Claude prompt for issue processing with MCP context
function generateClaudePrompt(issuePayload: IssuePayload, workspaceDir: string): string {
  return `
You are working on GitHub issue #${issuePayload.issueNumber}: "${issuePayload.title}"

Issue Description:
${issuePayload.description}

Labels: ${issuePayload.labels.join(', ')}
Author: ${issuePayload.author}

**IMPORTANT MCP INSTRUCTIONS:**

You have access to powerful GitHub operations through MCP tools:
- \`commit_files\`: Commit multiple files atomically to the repository
- \`delete_files\`: Delete files from the repository  
- \`update_claude_comment\`: Update your progress comment with status

The repository has been cloned to: ${workspaceDir}

Please:
1. Explore the codebase to understand the structure and identify relevant files
2. Analyze the issue requirements thoroughly
3. Implement a solution that addresses the issue completely
4. Use the \`commit_files\` tool to commit your changes with descriptive messages
5. Use \`update_claude_comment\` to provide progress updates as you work
6. Ensure code quality and consistency with existing patterns

**WORKFLOW:**
- Start by updating the comment with your analysis plan
- Explore the codebase and understand the issue context
- Implement the solution step by step
- Commit changes using the MCP tools (don't use git commands directly)
- Update the comment with final results

Work methodically and provide clear explanations of your approach. Use the MCP tools to make actual changes to the repository.
`;
}

// Process issue with MCP server integration
async function processIssueWithMcp(issuePayload: IssuePayload, githubToken: string, contextId?: string, workerBaseUrl?: string): Promise<ContainerResponse> {
  logWithContext('ISSUE_PROCESSOR', 'Starting issue processing with MCP server', {
    issueNumber: issuePayload.issueNumber,
    title: issuePayload.title,
    contextId
  });

  // Initialize progress reporter
  const progressReporter = new ProgressReporter(
    contextId || `issue-${issuePayload.issueNumber}-${Date.now()}`,
    workerBaseUrl
  );

  const results: SDKMessage[] = [];
  let turnCount = 0;

  try {
    // Report start of processing
    await progressReporter.reportProgress('started', '🚀 Starting Claude Code analysis with MCP tools...');

    // 1. Setup workspace
    await progressReporter.reportStage('analyzing', 'Setting up workspace and cloning repository...');
    const workspaceDir = await setupWorkspace(issuePayload.repositoryUrl, issuePayload.issueNumber);
    
    // 2. Convert to GitHub context format
    await progressReporter.reportStage('exploring', 'Converting issue data to GitHub context format...');
    const context = convertIssuePayloadToContext(issuePayload);
    
    // 3. Create GitHub client and initial comment
    await progressReporter.reportStage('planning', 'Creating GitHub client and posting initial comment...');
    const octokit = createOctokitClient(githubToken);
    const comment = await createInitialComment(
      octokit, 
      context, 
      "🔧 Claude is analyzing this issue with advanced GitHub tools and will implement a solution..."
    );

    logWithContext('ISSUE_PROCESSOR', 'Initial comment created', {
      commentId: comment.id,
      commentUrl: comment.html_url
    });

    // 4. Setup MCP environment
    await progressReporter.reportStage('implementing', 'Setting up MCP environment for advanced GitHub operations...', 25);
    const mcpConfigParams: McpConfigParams = {
      githubToken,
      owner: context.repository.owner,
      repo: context.repository.repo,
      branch: 'main', // TODO: Get actual default branch
      workspaceDir,
      claudeCommentId: comment.id.toString(),
      allowedTools: [
        'mcp__github__commit_files',
        'mcp__github__delete_files', 
        'mcp__github__update_claude_comment'
      ]
    };

    const mcpConfigPath = await setupMcpEnvironment(mcpConfigParams);
    logWithContext('ISSUE_PROCESSOR', 'MCP environment configured', {
      configPath: mcpConfigPath
    });

    // 5. Generate prompt for Claude with MCP context
    await progressReporter.reportStage('implementing', 'Generating context-aware prompt for Claude Code...', 30);
    const prompt = generateClaudePrompt(issuePayload, workspaceDir);

    // 6. Change to workspace directory and execute Claude Code with MCP
    const originalCwd = process.cwd();
    process.chdir(workspaceDir);

    logWithContext('CLAUDE_CODE', 'Starting Claude Code execution with MCP server', {
      workspaceDir,
      mcpConfigPath
    });

    await progressReporter.reportStage('implementing', 'Executing Claude Code with MCP tools enabled...', 40);

    try {
      for await (const message of query({
        prompt,
        options: { 
          permissionMode: 'bypassPermissions',
          // Claude Code will automatically use the MCP config from CLAUDE_DESKTOP_CONFIG
        }
      })) {
        turnCount++;
        results.push(message);

        // Report progress based on turn count
        const progress = Math.min(40 + (turnCount * 10), 80); // Progress from 40% to 80%
        await progressReporter.reportProgress(
          'in_progress', 
          `🤖 Claude Code turn ${turnCount} completed - processing with MCP tools...`,
          progress,
          { turnCount, messageType: message.type }
        );

        logWithContext('CLAUDE_CODE', `MCP Turn ${turnCount} completed`, {
          type: message.type,
          turnCount
        });
      }

      const claudeDuration = Date.now();
      logWithContext('ISSUE_PROCESSOR', 'Claude Code with MCP completed', {
        totalTurns: turnCount,
        resultsCount: results.length
      });

      await progressReporter.reportStage('testing', 'Analyzing Claude Code results and checking for changes...', 85);

      // 7. Get solution summary from last result
      let solution = '';
      if (results.length > 0) {
        const lastResult = results[results.length - 1];
        solution = getMessageText(lastResult);
      }

      // 8. Check if changes were made (MCP tools should have handled commits)
      await progressReporter.reportStage('testing', 'Checking repository status for changes...', 90);
      const git = simpleGit(workspaceDir);
      const status = await git.status();
      const hasUncommittedChanges = !status.isClean();

      // 9. Create pull request if there are committed changes
      // (MCP tools should have committed changes, but check branches)
      const branches = await git.branch(['--all']);
      const hasNewBranches = branches.all.some(branch => 
        branch.includes('claude') || branch !== status.current
      );

      if (hasNewBranches || hasUncommittedChanges) {
        await progressReporter.reportStage('creating-pr', 'Changes detected, preparing pull request...', 95);
        
        // Create a feature branch if MCP didn't already
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/g, '-').split('.')[0];
        const branchName = `claude-code/issue-${issuePayload.issueNumber}-${timestamp}`;
        
        if (hasUncommittedChanges) {
          // Fallback: commit any remaining changes
          await progressReporter.reportProgress('in_progress', 'Committing remaining changes...', 96);
          await git.checkoutLocalBranch(branchName);
          await git.add('.');
          await git.commit(`Fix issue #${issuePayload.issueNumber}: ${issuePayload.title}`);
          await git.push('origin', branchName, ['--set-upstream']);
        }

        // Create pull request
        try {
          await progressReporter.reportProgress('in_progress', 'Creating pull request...', 98);
          const pullRequest = await createPullRequest(
            octokit,
            context,
            `Fix issue #${issuePayload.issueNumber}: ${issuePayload.title}`,
            `${solution}\n\n---\nFixes #${issuePayload.issueNumber}\n\n🤖 This pull request was generated automatically by [Claude Code](https://claude.ai/code) using MCP tools.`,
            branchName,
            'main' // TODO: Get actual default branch
          );

          logWithContext('ISSUE_PROCESSOR', 'Pull request created via MCP workflow', {
            prNumber: pullRequest.number,
            prUrl: pullRequest.html_url
          });

          // Update the original comment with PR link
          await updateComment(
            octokit,
            context,
            comment.id,
            `🔧 I've implemented a solution using advanced GitHub tools.\n\n**Pull Request Created:** ${pullRequest.html_url}\n\n${solution}\n\n---\n🤖 Generated with [Claude Code](https://claude.ai/code) using MCP server`
          );

          await progressReporter.reportSuccess(
            `✅ Pull request created successfully: ${pullRequest.html_url}`,
            pullRequest.html_url,
            comment.id
          );

          return {
            success: true,
            message: `Pull request created successfully: ${pullRequest.html_url}`,
            pullRequestUrl: pullRequest.html_url,
            commentId: comment.id
          };
        } catch (prError) {
          await progressReporter.reportError(prError as Error, 'creating-pr');
          
          logWithContext('ISSUE_PROCESSOR', 'Failed to create pull request', {
            error: (prError as Error).message
          });

          // Update comment with solution but note PR creation failed
          await updateComment(
            octokit,
            context,
            comment.id,
            `${solution}\n\n---\n⚠️ **Note:** I implemented changes using MCP tools, but encountered an error creating the pull request: ${(prError as Error).message}\n\n🤖 Generated with [Claude Code](https://claude.ai/code) using MCP server`
          );

          await progressReporter.reportCompletion(
            true, 
            'Solution implemented but PR creation failed', 
            { error: (prError as Error).message, commentId: comment.id }
          );

          return {
            success: true,
            message: 'Solution implemented but PR creation failed',
            commentId: comment.id
          };
        }
      } else {
        // No changes, just update comment with analysis
        await progressReporter.reportStage('finalizing', 'No code changes needed, providing analysis...', 100);
        
        await updateComment(
          octokit,
          context,
          comment.id,
          `${solution}\n\n---\n🤖 Generated with [Claude Code](https://claude.ai/code) using MCP server`
        );

        await progressReporter.reportSuccess(
          '✅ Analysis completed - no code changes required',
          undefined,
          comment.id
        );

        return {
          success: true,
          message: 'Solution provided as analysis (no code changes needed)',
          commentId: comment.id
        };
      }

    } finally {
      // Always restore original working directory
      process.chdir(originalCwd);
    }

  } catch (error) {
    await progressReporter.reportError(error as Error, 'general-processing');
    
    logWithContext('ISSUE_PROCESSOR', 'Error in MCP issue processing', {
      error: (error as Error).message,
      turnCount,
      resultsCount: results.length
    });

    await progressReporter.reportFailure(
      (error as Error).message,
      'general-processing'
    );

    return {
      success: false,
      message: 'Failed to process issue with MCP server',
      error: (error as Error).message
    };
  }
}

// Main issue processing handler (updated for MCP)
async function processIssueHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  logWithContext('ISSUE_HANDLER', 'Processing issue request with MCP integration');

  // Read request body
  let requestBody = '';
  for await (const chunk of req) {
    requestBody += chunk;
  }

  let issueData: any = {};
  if (requestBody) {
    try {
      issueData = JSON.parse(requestBody);
      
      // Set environment variables from request
      if (issueData.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = issueData.ANTHROPIC_API_KEY;
      }
      if (issueData.GITHUB_TOKEN) {
        process.env.GITHUB_TOKEN = issueData.GITHUB_TOKEN;
      }

    } catch (error) {
      logWithContext('ISSUE_HANDLER', 'Error parsing request body', {
        error: (error as Error).message
      });
    }
  }

  // Validate required environment variables
  if (!process.env.ANTHROPIC_API_KEY) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not provided' }));
    return;
  }

  if (!process.env.GITHUB_TOKEN) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'GITHUB_TOKEN not provided' }));
    return;
  }

  // Extract issue payload
  const issuePayload: IssuePayload = {
    issueId: issueData.ISSUE_ID || process.env.ISSUE_ID!,
    issueNumber: issueData.ISSUE_NUMBER || process.env.ISSUE_NUMBER!,
    title: issueData.ISSUE_TITLE || process.env.ISSUE_TITLE!,
    description: issueData.ISSUE_BODY || process.env.ISSUE_BODY!,
    labels: issueData.ISSUE_LABELS ? JSON.parse(issueData.ISSUE_LABELS) : [],
    repositoryUrl: issueData.REPOSITORY_URL || process.env.REPOSITORY_URL!,
    repositoryName: issueData.REPOSITORY_NAME || process.env.REPOSITORY_NAME!,
    author: issueData.ISSUE_AUTHOR || process.env.ISSUE_AUTHOR!
  };

  logWithContext('ISSUE_HANDLER', 'Issue payload prepared for MCP processing', {
    issueNumber: issuePayload.issueNumber,
    repository: issuePayload.repositoryName
  });

  // Process issue with MCP integration
  try {
    const contextId = issueData.CONTEXT_ID;
    const workerBaseUrl = issueData.WORKER_BASE_URL;
    
    const result = await processIssueWithMcp(
      issuePayload, 
      process.env.GITHUB_TOKEN!,
      contextId,
      workerBaseUrl
    );

    logWithContext('ISSUE_HANDLER', 'MCP issue processing completed', {
      success: result.success,
      hasPullRequest: !!result.pullRequestUrl,
      contextId
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    logWithContext('ISSUE_HANDLER', 'MCP issue processing failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    const errorResponse: ContainerResponse = {
      success: false,
      message: 'Failed to process issue with MCP server',
      error: error instanceof Error ? error.message : String(error)
    };

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorResponse));
  }
}

// Route handler
async function requestHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const { method, url } = req;
  const startTime = Date.now();

  logWithContext('REQUEST_HANDLER', 'Incoming request to MCP container', {
    method,
    url
  });

  try {
    if (url === '/' || url === '/container') {
      await healthHandler(req, res);
    } else if (url === '/process-issue') {
      await processIssueHandler(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }

    const processingTime = Date.now() - startTime;
    logWithContext('REQUEST_HANDLER', 'MCP container request completed', {
      method,
      url,
      processingTimeMs: processingTime
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logWithContext('REQUEST_HANDLER', 'MCP container request error', {
      error: error instanceof Error ? error.message : String(error),
      processingTimeMs: processingTime
    });

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Internal server error',
      message: (error as Error).message
    }));
  }
}

// Helper function to extract text from SDK message
function getMessageText(message: SDKMessage): string {
  if ('content' in message && typeof message.content === 'string') {
    return message.content;
  }
  if ('text' in message && typeof message.text === 'string') {
    return message.text;
  }
  if ('content' in message && Array.isArray(message.content)) {
    const textContent = message.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n\n');

    if (textContent.trim()) {
      return textContent;
    }
  }
  if ('message' in message && message.message && typeof message.message === 'object') {
    const msg = message.message as any;
    if ('content' in msg && Array.isArray(msg.content)) {
      const textContent = msg.content
        .filter((item: any) => item.type === 'text')
        .map((item: any) => item.text)
        .join('\n\n');

      if (textContent.trim()) {
        return textContent;
      }
    }
  }
  return JSON.stringify(message);
}

// Start MCP-enabled server
const server = http.createServer(requestHandler);

server.listen(PORT, '0.0.0.0', () => {
  logWithContext('SERVER', 'Claude Code container with MCP server started', {
    port: PORT,
    host: '0.0.0.0',
    pid: process.pid,
    nodeVersion: process.version
  });

  logWithContext('SERVER', 'MCP server configuration check', {
    claudeCodeAvailable: !!process.env.ANTHROPIC_API_KEY,
    githubTokenAvailable: !!process.env.GITHUB_TOKEN,
    mcpServerPath: '/app/claude-action/src/mcp/github-file-ops-server.ts'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logWithContext('SERVER', 'Received SIGTERM, shutting down MCP container gracefully');
  server.close(() => {
    logWithContext('SERVER', 'MCP container closed successfully');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logWithContext('SERVER', 'Received SIGINT, shutting down MCP container gracefully');
  server.close(() => {
    logWithContext('SERVER', 'MCP container closed successfully');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logWithContext('SERVER', 'Uncaught exception in MCP container', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logWithContext('SERVER', 'Unhandled promise rejection in MCP container', {
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: String(promise)
  });
});