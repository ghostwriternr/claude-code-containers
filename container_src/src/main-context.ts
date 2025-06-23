/**
 * Container Main with ParsedGitHubContext Integration
 * Uses claude-code-action's structured context format for better integration
 */

import * as http from 'http';
import { promises as fs } from 'fs';
import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import simpleGit from 'simple-git';
import * as path from 'path';
import { spawn } from 'child_process';
import { setupMcpEnvironment, type McpConfigParams } from './adapters/mcp-config.js';
import { ProgressReporter } from './adapters/progress-reporter.js';
import { 
  convertWorkerPayloadToContext,
  extractCredentials,
  extractConfiguration,
  isIssuesEvent,
  type ParsedGitHubContext,
  type WorkerPayload,
  type ContainerCredentials,
  type ContainerConfiguration
} from './adapters/context-adapter.js';

const PORT = 8080;

// Environment variables
const MESSAGE = process.env.MESSAGE || 'Hello from Claude Code Container with ParsedGitHubContext';
const INSTANCE_ID = process.env.CLOUDFLARE_DEPLOYMENT_ID || 'unknown';

interface ContainerResponse {
  success: boolean;
  message: string;
  error?: string;
  pullRequestUrl?: string;
  commentId?: number;
  contextId?: string;
}

interface HealthStatus {
  status: string;
  message: string;
  instanceId: string;
  timestamp: string;
  claudeCodeAvailable: boolean;
  githubTokenAvailable: boolean;
  mcpServerReady: boolean;
  contextFormatSupported: boolean;
}

// Enhanced logging utility
function logWithContext(context: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [CONTEXT-${context}] ${message}`;

  if (data) {
    console.log(logMessage, JSON.stringify(data, null, 2));
  } else {
    console.log(logMessage);
  }
}

// Health check handler with context format support
async function healthHandler(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  logWithContext('HEALTH', 'Health check requested');

  const response: HealthStatus = {
    status: 'healthy',
    message: MESSAGE,
    instanceId: INSTANCE_ID,
    timestamp: new Date().toISOString(),
    claudeCodeAvailable: !!process.env.ANTHROPIC_API_KEY,
    githubTokenAvailable: !!process.env.GITHUB_TOKEN,
    mcpServerReady: await checkMcpServerHealth(),
    contextFormatSupported: true
  };

  logWithContext('HEALTH', 'Health check response', {
    status: response.status,
    contextFormatSupported: response.contextFormatSupported,
    mcpServerReady: response.mcpServerReady
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

// Check if MCP server dependencies are available
async function checkMcpServerHealth(): Promise<boolean> {
  try {
    const claudeActionPath = '/app/claude-action';
    await fs.access(claudeActionPath);
    
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

// Setup workspace with git clone (compatible with ParsedGitHubContext)
async function setupWorkspace(context: ParsedGitHubContext): Promise<string> {
  const workspaceDir = `/tmp/workspace/context-${context.runId}`;

  logWithContext('WORKSPACE', 'Setting up workspace for ParsedGitHubContext', {
    workspaceDir,
    repositoryName: context.repository.full_name,
    entityNumber: context.entityNumber,
    eventName: context.eventName
  });

  try {
    await fs.mkdir(path.dirname(workspaceDir), { recursive: true });

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      throw new Error('GitHub token not available for cloning');
    }

    // Construct repository URL from context
    const repositoryUrl = `https://github.com/${context.repository.full_name}`;
    const authenticatedUrl = repositoryUrl.replace(
      'https://github.com/',
      `https://x-access-token:${githubToken}@github.com/`
    );

    logWithContext('WORKSPACE', 'Starting git clone for ParsedGitHubContext workspace');

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
          logWithContext('WORKSPACE', 'Git clone completed for ParsedGitHubContext workspace');
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
    logWithContext('WORKSPACE', 'Error setting up ParsedGitHubContext workspace', {
      error: (error as Error).message
    });
    throw error;
  }
}

// Initialize git workspace for MCP server
async function initializeGitWorkspace(workspaceDir: string): Promise<void> {
  logWithContext('GIT_WORKSPACE', 'Configuring git workspace for ParsedGitHubContext operations', { workspaceDir });

  const git = simpleGit(workspaceDir);

  try {
    await git.addConfig('user.name', 'Claude Code Bot');
    await git.addConfig('user.email', 'claude-code@anthropic.com');
    await git.fetch('origin');

    const status = await git.status();
    logWithContext('GIT_WORKSPACE', 'Git workspace configured for ParsedGitHubContext', {
      currentBranch: status.current,
      isClean: status.isClean()
    });

    if (status.behind > 0) {
      await git.pull('origin', status.current || 'main');
    }
  } catch (error) {
    logWithContext('GIT_WORKSPACE', 'Error configuring git workspace for ParsedGitHubContext', {
      error: (error as Error).message
    });
    throw error;
  }
}

// Generate Claude prompt using ParsedGitHubContext
function generateClaudePromptFromContext(context: ParsedGitHubContext, workspaceDir: string): string {
  const isIssue = isIssuesEvent(context);
  const entityType = context.isPR ? 'pull request' : 'issue';
  const entityTitle = isIssue ? context.payload.issue.title : 'Unknown';
  const entityBody = isIssue ? context.payload.issue.body : '';
  const entityLabels = isIssue ? (context.payload.issue.labels?.map(l => l.name) || []) : [];

  return `
You are working on GitHub ${entityType} #${context.entityNumber}: "${entityTitle}"

**Repository**: ${context.repository.full_name}
**Actor**: ${context.actor}
**Event**: ${context.eventName}${context.eventAction ? ` (${context.eventAction})` : ''}

**${entityType} Description**:
${entityBody || 'No description provided'}

**Labels**: ${entityLabels.join(', ') || 'None'}

**Custom Instructions**: ${context.inputs.customInstructions || 'None'}

**Available MCP Tools**: ${context.inputs.allowedTools.join(', ') || 'Default tools'}

The repository has been cloned to: ${workspaceDir}

**Your Task**: Please analyze this ${entityType} and implement a comprehensive solution using your advanced MCP tools.

**MCP Tools Available**:
- \`commit_files\`: Commit multiple files atomically to the repository
- \`delete_files\`: Delete files from the repository with proper commit messages
- \`update_claude_comment\`: Update your progress comment with real-time status

**Workflow Instructions**:
1. **Explore**: Use file reading tools to understand the codebase structure
2. **Analyze**: Thoroughly analyze the ${entityType} requirements
3. **Plan**: Create a comprehensive implementation plan
4. **Implement**: Make the necessary code changes using MCP tools
5. **Test**: Verify your changes work correctly
6. **Commit**: Use \`commit_files\` to commit your changes with descriptive messages
7. **Report**: Use \`update_claude_comment\` to provide progress updates

**Important**: 
- Work step by step and provide clear explanations
- Use the MCP tools for all file operations and commits
- Update the comment regularly with your progress
- Ensure code quality and consistency with existing patterns
- If you create a solution that requires multiple commits, make logical, atomic commits

Begin your analysis and implementation now!
`;
}

// Process issue with ParsedGitHubContext integration
async function processWithParsedContext(
  context: ParsedGitHubContext,
  credentials: ContainerCredentials,
  configuration: ContainerConfiguration,
  progressReporter: ProgressReporter
): Promise<ContainerResponse> {
  logWithContext('CONTEXT_PROCESSOR', 'Starting processing with ParsedGitHubContext', {
    runId: context.runId,
    eventName: context.eventName,
    repository: context.repository.full_name,
    entityNumber: context.entityNumber,
    isPR: context.isPR
  });

  const results: SDKMessage[] = [];
  let turnCount = 0;

  try {
    // Report start of processing
    await progressReporter.reportProgress('started', '🚀 Starting Claude Code analysis with ParsedGitHubContext and MCP tools...');

    // 1. Setup workspace
    await progressReporter.reportStage('analyzing', 'Setting up workspace from ParsedGitHubContext...', 10);
    const workspaceDir = await setupWorkspace(context);
    
    // 2. Setup MCP environment with context
    await progressReporter.reportStage('planning', 'Configuring MCP environment with structured context...', 20);
    const mcpConfigParams: McpConfigParams = {
      githubToken: credentials.githubToken,
      owner: context.repository.owner,
      repo: context.repository.repo,
      branch: context.inputs.baseBranch || 'main',
      workspaceDir,
      allowedTools: context.inputs.allowedTools
    };

    const mcpConfigPath = await setupMcpEnvironment(mcpConfigParams);
    logWithContext('CONTEXT_PROCESSOR', 'MCP environment configured with ParsedGitHubContext', {
      configPath: mcpConfigPath,
      allowedTools: context.inputs.allowedTools
    });

    // 3. Generate context-aware prompt
    await progressReporter.reportStage('implementing', 'Generating context-aware prompt for Claude Code...', 30);
    const prompt = generateClaudePromptFromContext(context, workspaceDir);

    // 4. Execute Claude Code with MCP and context
    const originalCwd = process.cwd();
    process.chdir(workspaceDir);

    logWithContext('CLAUDE_CODE', 'Starting Claude Code execution with ParsedGitHubContext and MCP', {
      workspaceDir,
      mcpConfigPath,
      contextRunId: context.runId
    });

    await progressReporter.reportStage('implementing', 'Executing Claude Code with structured context and MCP tools...', 40);

    try {
      for await (const message of query({
        prompt,
        options: { 
          permissionMode: 'bypassPermissions'
        }
      })) {
        turnCount++;
        results.push(message);

        // Report progress based on turn count
        const progress = Math.min(40 + (turnCount * 8), 85); // Progress from 40% to 85%
        await progressReporter.reportProgress(
          'in_progress', 
          `🤖 Claude Code turn ${turnCount} completed with ParsedGitHubContext...`,
          progress,
          { 
            turnCount, 
            messageType: message.type,
            contextEventName: context.eventName,
            entityNumber: context.entityNumber
          }
        );

        logWithContext('CLAUDE_CODE', `ParsedGitHubContext Turn ${turnCount} completed`, {
          type: message.type,
          turnCount,
          contextRunId: context.runId
        });
      }

      logWithContext('CONTEXT_PROCESSOR', 'Claude Code with ParsedGitHubContext completed', {
        totalTurns: turnCount,
        resultsCount: results.length,
        contextRunId: context.runId
      });

      await progressReporter.reportStage('finalizing', 'Analyzing results and completing processing...', 90);

      // 5. Get solution summary from last result
      let solution = '';
      if (results.length > 0) {
        const lastResult = results[results.length - 1];
        solution = getMessageText(lastResult);
      }

      // 6. Check for changes (MCP tools should have handled commits)
      const git = simpleGit(workspaceDir);
      const status = await git.status();
      const branches = await git.branch(['--all']);
      
      // Look for evidence of MCP tool usage
      const hasCommits = !status.isClean() || branches.all.some(branch => 
        branch.includes('claude') || branch !== status.current
      );

      logWithContext('CONTEXT_PROCESSOR', 'ParsedGitHubContext processing analysis', {
        hasCommits,
        statusClean: status.isClean(),
        branchCount: branches.all.length,
        contextRunId: context.runId
      });

      if (hasCommits) {
        await progressReporter.reportSuccess(
          `✅ ParsedGitHubContext processing completed successfully - changes made using MCP tools`,
          undefined, // PR URL will be provided by MCP tools if created
          undefined  // Comment ID will be managed by MCP tools
        );

        return {
          success: true,
          message: `ParsedGitHubContext processing completed successfully with ${turnCount} turns`,
          contextId: context.runId
        };
      } else {
        await progressReporter.reportSuccess(
          '✅ ParsedGitHubContext analysis completed - no code changes required',
          undefined,
          undefined
        );

        return {
          success: true,
          message: 'ParsedGitHubContext analysis completed (no code changes needed)',
          contextId: context.runId
        };
      }

    } finally {
      // Always restore original working directory
      process.chdir(originalCwd);
    }

  } catch (error) {
    await progressReporter.reportError(error as Error, 'context-processing');
    
    logWithContext('CONTEXT_PROCESSOR', 'Error in ParsedGitHubContext processing', {
      error: (error as Error).message,
      contextRunId: context.runId,
      turnCount,
      resultsCount: results.length
    });

    await progressReporter.reportFailure(
      (error as Error).message,
      'context-processing'
    );

    return {
      success: false,
      message: 'Failed to process with ParsedGitHubContext',
      error: (error as Error).message,
      contextId: context.runId
    };
  }
}

// Main issue processing handler with ParsedGitHubContext
async function processContextHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  logWithContext('CONTEXT_HANDLER', 'Processing request with ParsedGitHubContext integration');

  // Read request body
  let requestBody = '';
  for await (const chunk of req) {
    requestBody += chunk;
  }

  let workerPayload: WorkerPayload;
  try {
    workerPayload = JSON.parse(requestBody) as WorkerPayload;
    
    logWithContext('CONTEXT_HANDLER', 'Worker payload received', {
      contextId: workerPayload.CONTEXT_ID,
      eventName: workerPayload.GITHUB_EVENT_NAME,
      repository: workerPayload.REPOSITORY_NAME,
      issueNumber: workerPayload.ISSUE_NUMBER
    });

  } catch (error) {
    logWithContext('CONTEXT_HANDLER', 'Error parsing Worker payload', {
      error: (error as Error).message
    });

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid Worker payload format' }));
    return;
  }

  // Set environment variables from payload
  process.env.ANTHROPIC_API_KEY = workerPayload.ANTHROPIC_API_KEY;
  process.env.GITHUB_TOKEN = workerPayload.GITHUB_TOKEN;

  // Validate required environment variables
  if (!process.env.ANTHROPIC_API_KEY || !process.env.GITHUB_TOKEN) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing required credentials' }));
    return;
  }

  try {
    // Convert Worker payload to ParsedGitHubContext
    const context = convertWorkerPayloadToContext(workerPayload);
    const credentials = extractCredentials(workerPayload);
    const configuration = extractConfiguration(workerPayload);

    // Initialize progress reporter
    const progressReporter = new ProgressReporter(
      configuration.contextId,
      configuration.workerBaseUrl
    );

    logWithContext('CONTEXT_HANDLER', 'ParsedGitHubContext prepared for processing', {
      runId: context.runId,
      eventName: context.eventName,
      repository: context.repository.full_name,
      entityNumber: context.entityNumber,
      allowedToolsCount: context.inputs.allowedTools.length
    });

    // Process with ParsedGitHubContext
    const result = await processWithParsedContext(
      context,
      credentials,
      configuration,
      progressReporter
    );

    logWithContext('CONTEXT_HANDLER', 'ParsedGitHubContext processing completed', {
      success: result.success,
      contextId: result.contextId
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));

  } catch (error) {
    logWithContext('CONTEXT_HANDLER', 'ParsedGitHubContext processing failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    const errorResponse: ContainerResponse = {
      success: false,
      message: 'Failed to process with ParsedGitHubContext',
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

  logWithContext('REQUEST_HANDLER', 'Incoming request to ParsedGitHubContext container', {
    method,
    url
  });

  try {
    if (url === '/' || url === '/container') {
      await healthHandler(req, res);
    } else if (url === '/process-issue') {
      await processContextHandler(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }

    const processingTime = Date.now() - startTime;
    logWithContext('REQUEST_HANDLER', 'ParsedGitHubContext container request completed', {
      method,
      url,
      processingTimeMs: processingTime
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logWithContext('REQUEST_HANDLER', 'ParsedGitHubContext container request error', {
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

// Start ParsedGitHubContext-enabled server
const server = http.createServer(requestHandler);

server.listen(PORT, '0.0.0.0', () => {
  logWithContext('SERVER', 'Claude Code container with ParsedGitHubContext started', {
    port: PORT,
    host: '0.0.0.0',
    pid: process.pid,
    nodeVersion: process.version,
    contextSupport: 'ParsedGitHubContext'
  });

  logWithContext('SERVER', 'ParsedGitHubContext server configuration check', {
    claudeCodeAvailable: !!process.env.ANTHROPIC_API_KEY,
    githubTokenAvailable: !!process.env.GITHUB_TOKEN,
    mcpServerPath: '/app/claude-action/src/mcp/github-file-ops-server.ts',
    contextFormat: 'ParsedGitHubContext'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logWithContext('SERVER', 'Received SIGTERM, shutting down ParsedGitHubContext container gracefully');
  server.close(() => {
    logWithContext('SERVER', 'ParsedGitHubContext container closed successfully');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logWithContext('SERVER', 'Received SIGINT, shutting down ParsedGitHubContext container gracefully');
  server.close(() => {
    logWithContext('SERVER', 'ParsedGitHubContext container closed successfully');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logWithContext('SERVER', 'Uncaught exception in ParsedGitHubContext container', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logWithContext('SERVER', 'Unhandled promise rejection in ParsedGitHubContext container', {
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: String(promise)
  });
});