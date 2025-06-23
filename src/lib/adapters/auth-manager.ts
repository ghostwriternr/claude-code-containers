/**
 * Authentication manager adapter for Workers
 * Bridges Durable Objects token storage with claude-code-action
 */

import type { Env, GitHubAppConfigDO } from './types';

export class WorkersAuthManager {
  private env: Env;
  
  constructor(env: Env) {
    this.env = env;
  }
  
  /**
   * Get installation token for a specific repository
   */
  async getInstallationToken(repoOwner: string, repoName: string): Promise<string | null> {
    try {
      if (!this.env.GITHUB_APP_CONFIG) {
        throw new Error('GITHUB_APP_CONFIG binding not available');
      }
      
      const configId = this.env.GITHUB_APP_CONFIG.idFromName('global');
      const config = this.env.GITHUB_APP_CONFIG.get(configId);
      
      // Cast to our interface
      const configDO = config as unknown as GitHubAppConfigDO;
      
      // Use existing method from GitHubAppConfigDO
      return await configDO.getInstallationToken(repoOwner, repoName);
    } catch (error) {
      console.error('Error getting installation token:', error);
      return null;
    }
  }
  
  /**
   * Check if GitHub App is properly configured
   */
  async isConfigured(): Promise<boolean> {
    try {
      if (!this.env.GITHUB_APP_CONFIG) {
        return false;
      }
      
      const configId = this.env.GITHUB_APP_CONFIG.idFromName('global');
      const config = this.env.GITHUB_APP_CONFIG.get(configId);
      
      // Cast to our interface
      const configDO = config as unknown as GitHubAppConfigDO;
      
      // Check if configuration exists (this would call existing method)
      const status = await configDO.getStatus();
      return status.configured;
    } catch (error) {
      console.error('Error checking GitHub App configuration:', error);
      return false;
    }
  }
  
  /**
   * Get repository installation ID if available
   */
  async getInstallationId(repoOwner: string, repoName: string): Promise<number | null> {
    try {
      if (!this.env.GITHUB_APP_CONFIG) {
        return null;
      }
      
      const configId = this.env.GITHUB_APP_CONFIG.idFromName('global');
      const config = this.env.GITHUB_APP_CONFIG.get(configId);
      
      // Cast to our interface
      const configDO = config as unknown as GitHubAppConfigDO;
      
      // This would need to be implemented in GitHubAppConfigDO if not already available
      return await configDO.getInstallationId(repoOwner, repoName);
    } catch (error) {
      console.error('Error getting installation ID:', error);
      return null;
    }
  }
}