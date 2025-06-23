import { logWithContext } from "../../log";
import { containerFetch } from "../../fetch";
// Use the global Env type from worker-configuration.d.ts
import { 
  WebhookContextAdapter,
  WorkersGitHubClient,
  WorkersCommentManager,
  WorkersPromptGenerator,
  WorkersDataFetcher,
  ConfigManager,
  ProgressBridge,
  WorkersErrorHandler
} from '@adapters';
import type { ParsedGitHubContext, IssueWebhookPayload } from '@adapters/types';

// Enhanced container response interface
interface EnhancedContainerResponse {
  success: boolean;
  message: string;
  pullRequestUrl?: string;
  filesModified?: string[];
  error?: string;
  contextId?: string;
}

/**
 * Enhanced issue handler using Worker/Container separation pattern
 * Worker handles: Initial comments, configuration, authentication
 * Container handles: Data fetching, code analysis, solution implementation
 */
export async function handleIssuesEventEnhanced(
  request: Request,
  env: Env,
  configDO: any
): Promise<Response> {
  const errorHandler = new WorkersErrorHandler(env);
  
  try {
    // Parse webhook payload using adapter  
    const webhookPayload = await request.json();
    const event = request.headers.get('x-github-event') || '';
    const context = WebhookContextAdapter.fromWebhookPayload(webhookPayload, event);
    
    logWithContext('ISSUES_EVENT_ENHANCED', 'Processing issue event with adapters', {
      action: context.eventAction,
      issueNumber: context.entityNumber,
      repository: context.repository.full_name,
      actor: context.actor
    });

    const payload = context.payload as IssueWebhookPayload;
    const issue = payload.issue;
    const repository = payload.repository;

    // Handle new issue creation with enhanced Claude Code processing
    if (context.eventAction === 'opened') {
      return await handleNewIssueWithAdapters(context, issue, repository, env, configDO);
    }
    
    // For other actions, use standard container routing
    return await handleOtherIssueActions(context, env);

  } catch (error) {
    logWithContext('ISSUES_EVENT_ENHANCED', 'Failed to process issue event', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return errorHandler.handleError(error, 'Issue processing failed');
  }
}

/**
 * Handle new issue creation with Worker/Container separation
 */
async function handleNewIssueWithAdapters(
  context: ParsedGitHubContext,
  issue: any,
  repository: any,
  env: Env,
  configDO: any
): Promise<Response> {
  const progressBridge = new ProgressBridge(env);
  const configManager = new ConfigManager(env);
  const commentManager = new WorkersCommentManager(env);
  const promptGenerator = new WorkersPromptGenerator(env);
  const dataFetcher = new WorkersDataFetcher(env);
  
  logWithContext('ISSUES_EVENT_ENHANCED', 'Handling new issue with adapters', {
    issueNumber: issue.number,
    issueTitle: issue.title
  });

  try {
    // Step 1: Create GitHub client for Worker operations
    const octokits = await WorkersGitHubClient.create(env, context.repository.owner, context.repository.repo);
    
    // Step 2: Create initial comment (Worker responsibility - fast GitHub operation)
    logWithContext('ISSUES_EVENT_ENHANCED', 'Creating initial comment via Worker');
    const initialComment = await commentManager.createInitialComment(octokits, context);
    
    logWithContext('ISSUES_EVENT_ENHANCED', 'Initial comment created', {
      commentId: initialComment.id,
      commentUrl: initialComment.url
    });

    // Step 3: Get repository configuration
    const repoConfig = await configManager.getConfig(context.repository.full_name);
    const promptConfig = configManager.toPromptConfig(repoConfig, context);
    
    // Step 4: Fetch GitHub data (Container responsibility - heavy operation)
    // But we need basic data for prompt generation, so fetch minimal data in Worker
    logWithContext('ISSUES_EVENT_ENHANCED', 'Fetching basic GitHub data for prompt');
    const githubData = await dataFetcher.fetchBasicData(octokits, context);
    
    // Step 5: Generate prompt using claude-code-action utilities
    logWithContext('ISSUES_EVENT_ENHANCED', 'Generating prompt using claude-code-action');
    const prompt = await promptGenerator.generateForContext(
      context,
      githubData,
      initialComment.id.toString(),
      promptConfig
    );
    
    // Step 6: Initialize progress tracking
    const containerName = `claude-issue-${issue.id}`;
    const contextId = await progressBridge.initializeProgress(context, initialComment.id, containerName);
    
    // Step 7: Create container payload for execution
    const githubToken = await getInstallationToken(configDO);
    const containerPayload = promptGenerator.createContainerPayload(
      prompt,
      context,
      promptConfig,
      githubToken
    );
    
    // Step 8: Execute in Container (Container responsibility - complex operations)
    await executeInEnhancedContainer(
      containerName,
      containerPayload,
      contextId,
      env,
      progressBridge,
      octokits,
      context
    );
    
    logWithContext('ISSUES_EVENT_ENHANCED', 'Issue processing initiated successfully', {
      contextId,
      containerName
    });
    
    return new Response('Issue processing initiated', { status: 200 });

  } catch (error) {
    logWithContext('ISSUES_EVENT_ENHANCED', 'Failed to process new issue', {
      error: error instanceof Error ? error.message : String(error),
      issueNumber: issue.number
    });

    // Post error comment using adapter
    try {
      const octokits = await WorkersGitHubClient.create(env, context.repository.owner, context.repository.repo);
      await commentManager.createCompletionComment(octokits, context, {
        success: false,
        summary: 'Failed to initialize issue processing',
        error: error instanceof Error ? error.message : String(error)
      });
    } catch (commentError) {
      logWithContext('ISSUES_EVENT_ENHANCED', 'Failed to post error comment', {
        commentError: commentError instanceof Error ? commentError.message : String(commentError)
      });
    }

    throw error;
  }
}

/**
 * Execute Container with enhanced error handling and progress tracking
 */
async function executeInEnhancedContainer(
  containerName: string,
  containerPayload: any,
  contextId: string,
  env: Env,
  progressBridge: ProgressBridge,
  octokits: any,
  context: ParsedGitHubContext
): Promise<void> {
  // Create container
  const id = env.MY_CONTAINER.idFromName(containerName);
  const container = env.MY_CONTAINER.get(id);
  
  logWithContext('ENHANCED_CONTAINER', 'Starting enhanced container execution', {
    containerName,
    contextId
  });

  try {
    // Add progress environment to container payload
    const workerUrl = env.WORKER_URL || 'https://your-worker.workers.dev'; // Should be configured
    const progressEnv = progressBridge.createContainerEnvironment(contextId, workerUrl);
    
    const enhancedPayload = {
      ...containerPayload,
      progressEnvironment: progressEnv,
      contextId
    };

    // Execute container with enhanced payload
    const response = await containerFetch(container, new Request('http://internal/process-issue-enhanced', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(enhancedPayload)
    }), {
      containerName,
      route: '/process-issue-enhanced',
      env
    });

    logWithContext('ENHANCED_CONTAINER', 'Container response received', {
      status: response.status,
      statusText: response.statusText
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      throw new Error(`Container returned status ${response.status}: ${errorText}`);
    }

    // Parse enhanced container response
    const containerResponse: EnhancedContainerResponse = await response.json();
    
    logWithContext('ENHANCED_CONTAINER', 'Container response parsed', {
      success: containerResponse.success,
      message: containerResponse.message,
      hasError: !!containerResponse.error,
      hasPullRequest: !!containerResponse.pullRequestUrl
    });

    // Handle completion via progress bridge
    await progressBridge.handleContainerCompletion(contextId, octokits, context, {
      success: containerResponse.success,
      pullRequestUrl: containerResponse.pullRequestUrl,
      summary: containerResponse.message,
      filesModified: containerResponse.filesModified,
      error: containerResponse.error
    });

  } catch (error) {
    logWithContext('ENHANCED_CONTAINER', 'Container execution failed', {
      error: error instanceof Error ? error.message : String(error),
      containerName,
      contextId
    });

    // Handle error completion
    await progressBridge.handleContainerCompletion(contextId, octokits, context, {
      success: false,
      summary: 'Container execution failed',
      error: error instanceof Error ? error.message : String(error)
    });

    throw error;
  }
}

/**
 * Handle other issue actions with standard container routing
 */
async function handleOtherIssueActions(
  context: ParsedGitHubContext,
  env: Env
): Promise<Response> {
  const payload = context.payload as IssueWebhookPayload;
  const repository = payload.repository;
  const issue = payload.issue;
  
  logWithContext('ISSUES_EVENT_ENHANCED', 'Handling other issue action', {
    action: context.eventAction,
    issueNumber: issue.number
  });

  const containerName = `repo-${repository.id}`;
  const id = env.MY_CONTAINER.idFromName(containerName);
  const container = env.MY_CONTAINER.get(id);

  const webhookPayload = {
    event: 'issues',
    action: context.eventAction,
    repository: repository.full_name,
    issue_number: issue.number,
    issue_title: issue.title,
    issue_author: issue.user.login,
    context: JSON.stringify(context) // Pass parsed context
  };

  await containerFetch(container, new Request('http://internal/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(webhookPayload)
  }), {
    containerName,
    route: '/webhook',
    env
  });

  return new Response('Other issue action processed', { status: 200 });
}

/**
 * Get installation token (helper function)
 */
async function getInstallationToken(configDO: any): Promise<string> {
  const tokenResponse = await configDO.fetch(new Request('http://internal/get-installation-token'));
  const tokenData = await tokenResponse.json() as { token: string };
  
  if (!tokenData.token) {
    throw new Error('GitHub installation token not available');
  }
  
  return tokenData.token;
}