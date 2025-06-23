import type { 
  ParsedGitHubContext, 
  FetchDataResult,
  CommonFields,
  PreparedContext,
  EventData 
} from '@adapters/types';
import { generatePrompt, prepareContext } from '@claude-action/create-prompt';
// Use the global Env type from worker-configuration.d.ts

export interface WorkersPromptConfig {
  customInstructions?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  baseBranch?: string;
  claudeBranch?: string;
}

export class WorkersPromptGenerator {
  constructor(private env: Env) {}

  /**
   * Generate a comprehensive prompt for Claude Code using claude-code-action's logic
   * This runs in the Worker and generates the prompt for Container execution
   */
  async generateForContext(
    context: ParsedGitHubContext,
    githubData: FetchDataResult,
    claudeCommentId: string,
    config: WorkersPromptConfig = {}
  ): Promise<string> {
    // Prepare context using claude-code-action's utilities
    const preparedContext = this.prepareContextForWorkers(
      context,
      claudeCommentId,
      config
    );

    // Generate prompt using their proven prompt generation logic
    const prompt = generatePrompt(preparedContext, githubData);

    return prompt;
  }

  /**
   * Prepare context for prompt generation, adapting Workers data to claude-code-action format
   */
  private prepareContextForWorkers(
    context: ParsedGitHubContext,
    claudeCommentId: string,
    config: WorkersPromptConfig
  ): PreparedContext {
    const commonFields: CommonFields = {
      repository: context.repository.full_name,
      claudeCommentId,
      triggerPhrase: this.getTriggerPhrase(context),
      triggerUsername: context.actor,
      customInstructions: config.customInstructions,
      allowedTools: config.allowedTools?.join(','),
      disallowedTools: config.disallowedTools?.join(','),
      directPrompt: undefined // Not used in our workflow
    };

    // Use claude-code-action's prepareContext with our common fields
    return prepareContext(
      context,
      claudeCommentId,
      config.baseBranch,
      config.claudeBranch
    );
  }

  /**
   * Extract trigger phrase from context based on event type
   */
  private getTriggerPhrase(context: ParsedGitHubContext): string {
    if (context.eventName === 'issues' && context.eventAction === 'opened') {
      return 'new issue created';
    }
    
    if (context.eventName === 'issue_comment') {
      return 'issue comment created';
    }
    
    if (context.eventName === 'pull_request') {
      return 'pull request opened';
    }
    
    return 'github event triggered';
  }

  /**
   * Build tool configuration strings for container execution
   */
  buildToolsConfig(config: WorkersPromptConfig): {
    allowedToolsString: string;
    disallowedToolsString: string;
  } {
    const allowedToolsString = config.allowedTools?.join(',') || '';
    const disallowedToolsString = config.disallowedTools?.join(',') || '';
    
    return {
      allowedToolsString,
      disallowedToolsString
    };
  }

  /**
   * Create container execution payload with prompt and configuration
   */
  createContainerPayload(
    prompt: string,
    context: ParsedGitHubContext,
    config: WorkersPromptConfig,
    githubToken: string
  ): {
    prompt: string;
    context: string;
    githubToken: string;
    allowedTools: string;
    disallowedTools: string;
    baseBranch?: string;
    claudeBranch?: string;
  } {
    const toolsConfig = this.buildToolsConfig(config);
    
    return {
      prompt,
      context: JSON.stringify(context),
      githubToken,
      allowedTools: toolsConfig.allowedToolsString,
      disallowedTools: toolsConfig.disallowedToolsString,
      baseBranch: config.baseBranch,
      claudeBranch: config.claudeBranch
    };
  }
}