// Use the global Env type from worker-configuration.d.ts
import type { WorkersPromptConfig } from './prompt-generator';
import type { ParsedGitHubContext } from '@adapters/types';

export interface RepositoryConfig {
  // Core configuration matching claude-code-action schema
  customInstructions?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  
  // Workers-specific configuration
  containerTimeout?: number;
  progressUpdateInterval?: number;
  branchPrefix?: string;
  
  // Advanced settings
  enableProgressComments?: boolean;
  enablePullRequestCreation?: boolean;
  maxFilesProcessed?: number;
}

export interface ConfigDurableObject {
  get(key: string): Promise<RepositoryConfig | null>;
  put(key: string, config: RepositoryConfig): Promise<void>;
  delete(key: string): Promise<void>;
}

export class ConfigManager {
  constructor(private env: Env) {}

  /**
   * Get configuration for a specific repository
   * Falls back to sensible defaults if no config exists
   */
  async getConfig(repoFullName: string): Promise<RepositoryConfig> {
    const configDO = this.getConfigDO();
    const storedConfig = await configDO.get(repoFullName);
    
    return {
      ...this.getDefaultConfig(),
      ...storedConfig
    };
  }

  /**
   * Update configuration for a repository
   */
  async setConfig(repoFullName: string, config: Partial<RepositoryConfig>): Promise<void> {
    const configDO = this.getConfigDO();
    const existingConfig = await this.getConfig(repoFullName);
    
    const updatedConfig: RepositoryConfig = {
      ...existingConfig,
      ...config
    };

    // Validate configuration before saving
    this.validateConfig(updatedConfig);
    
    await configDO.put(repoFullName, updatedConfig);
  }

  /**
   * Delete configuration for a repository (revert to defaults)
   */
  async deleteConfig(repoFullName: string): Promise<void> {
    const configDO = this.getConfigDO();
    await configDO.delete(repoFullName);
  }

  /**
   * Convert repository config to prompt config for prompt generation
   */
  toPromptConfig(repoConfig: RepositoryConfig, context: ParsedGitHubContext): WorkersPromptConfig {
    return {
      customInstructions: repoConfig.customInstructions,
      allowedTools: repoConfig.allowedTools,
      disallowedTools: repoConfig.disallowedTools,
      baseBranch: this.getBaseBranch(context),
      claudeBranch: this.generateClaudeBranch(context, repoConfig.branchPrefix)
    };
  }

  /**
   * Get default configuration that matches claude-code-action expectations
   */
  private getDefaultConfig(): RepositoryConfig {
    return {
      // Default allowed tools (subset of claude-code-action defaults)
      allowedTools: [
        'bash',
        'edit_file', 
        'read_file',
        'list_files',
        'github_create_comment',
        'github_create_pull_request'
      ],
      
      // Default disallowed tools (security-focused)
      disallowedTools: [
        'web_search',
        'computer'
      ],
      
      // Workers-specific defaults
      containerTimeout: 300000, // 5 minutes
      progressUpdateInterval: 30000, // 30 seconds
      branchPrefix: 'claude-code',
      
      // Feature flags
      enableProgressComments: true,
      enablePullRequestCreation: true,
      maxFilesProcessed: 50
    };
  }

  /**
   * Validate configuration before storing
   */
  private validateConfig(config: RepositoryConfig): void {
    if (config.containerTimeout && config.containerTimeout > 600000) {
      throw new Error('Container timeout cannot exceed 10 minutes');
    }
    
    if (config.progressUpdateInterval && config.progressUpdateInterval < 10000) {
      throw new Error('Progress update interval must be at least 10 seconds');
    }
    
    if (config.maxFilesProcessed && config.maxFilesProcessed > 100) {
      throw new Error('Maximum files processed cannot exceed 100');
    }
    
    if (config.allowedTools && config.allowedTools.length === 0) {
      throw new Error('At least one tool must be allowed');
    }
  }

  /**
   * Get base branch from context (usually main/master)
   */
  private getBaseBranch(context: ParsedGitHubContext): string {
    if ('pull_request' in context.payload) {
      return context.payload.pull_request.base.ref;
    }
    
    // Default to main for issues
    return 'main';
  }

  /**
   * Generate unique branch name for Claude's work
   */
  private generateClaudeBranch(context: ParsedGitHubContext, prefix = 'claude-code'): string {
    const timestamp = Date.now();
    const entityNumber = context.entityNumber;
    const eventType = context.isPR ? 'pr' : 'issue';
    
    return `${prefix}/${eventType}-${entityNumber}-${timestamp}`;
  }

  /**
   * Get configuration Durable Object instance
   */
  private getConfigDO(): ConfigDurableObject {
    const id = this.env.GITHUB_APP_CONFIG.idFromName('config');
    return this.env.GITHUB_APP_CONFIG.get(id) as unknown as ConfigDurableObject;
  }

  /**
   * Get global configuration that applies to all repositories
   */
  async getGlobalConfig(): Promise<Partial<RepositoryConfig>> {
    const configDO = this.getConfigDO();
    return await configDO.get('__global__') || {};
  }

  /**
   * Set global configuration that applies to all repositories
   */
  async setGlobalConfig(config: Partial<RepositoryConfig>): Promise<void> {
    const configDO = this.getConfigDO();
    await configDO.put('__global__', config);
  }
}