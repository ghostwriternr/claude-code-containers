/**
 * GitHub API client adapter for Cloudflare Workers
 * Bridges claude-code-action's GitHub client with Workers environment
 */

import { createOctokit } from '@claude-action';
import type { Octokits } from '@claude-action';
import type { Env, GitHubAppConfigDO } from './types';

export class WorkersGitHubClient {
  /**
   * Create GitHub API client using token from Durable Objects
   */
  static async create(env: Env, repoOwner: string, repoName: string): Promise<Octokits> {
    if (!env.GITHUB_APP_CONFIG) {
      throw new Error('GITHUB_APP_CONFIG binding not available');
    }
    
    // Get GitHub App configuration from Durable Objects
    const configId = env.GITHUB_APP_CONFIG.idFromName('global');
    const config = env.GITHUB_APP_CONFIG.get(configId);
    
    // Cast to our interface (this would need to match your actual DO implementation)
    const configDO = config as unknown as GitHubAppConfigDO;
    
    // Get installation token for the specific repository
    const token = await configDO.getInstallationToken(repoOwner, repoName);
    
    if (!token) {
      throw new Error(`No GitHub installation token available for ${repoOwner}/${repoName}`);
    }
    
    // Direct reuse of claude-code-action's client
    return createOctokit(token);
  }
  
  /**
   * Create GitHub API client using direct token (for testing/development)
   */
  static createWithToken(token: string): Octokits {
    return createOctokit(token);
  }
}

