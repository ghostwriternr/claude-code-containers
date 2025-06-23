/**
 * Data fetcher adapter for Cloudflare Workers
 * Bridges claude-code-action's data fetching with R2 storage and Workers environment
 */

import { fetchGitHubData } from '@claude-action';
import type { Octokits, ParsedGitHubContext, FetchDataResult } from '@claude-action';
import type { Env } from './types';

export class WorkersDataFetcher {
  private env: Env;
  
  constructor(env: Env) {
    this.env = env;
  }
  
  /**
   * Fetch GitHub data for webhook processing
   * Integrates R2 storage for image caching
   */
  async fetchForWebhook(
    context: ParsedGitHubContext,
    octokits: Octokits,
    triggerUsername?: string
  ): Promise<FetchDataResult> {
    try {
      // Use claude-code-action's data fetcher with custom image handler
      const result = await fetchGitHubData({
        octokits,
        repository: context.repository.full_name,
        prNumber: context.entityNumber.toString(),
        isPR: context.isPR,
        triggerUsername,
      });
      
      // Process images with R2 storage if available
      if (this.env.R2_BUCKET && result.imageUrlMap.size > 0) {
        await this.cacheImagesToR2(result.imageUrlMap);
      }
      
      return result;
    } catch (error) {
      console.error('Error fetching GitHub data:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch GitHub data: ${errorMessage}`);
    }
  }
  
  /**
   * Cache downloaded images to R2 storage
   */
  private async cacheImagesToR2(imageUrlMap: Map<string, string>): Promise<void> {
    const r2Bucket = this.env.R2_BUCKET;
    if (!r2Bucket) {
      console.warn('R2_BUCKET not available, skipping image caching');
      return;
    }
    
    const cachePromises = Array.from(imageUrlMap.entries()).map(async ([originalUrl, localPath]) => {
      try {
        // Read the local file (downloaded by claude-code-action)
        const imageData = await this.readLocalImage(localPath);
        if (!imageData) return;
        
        // Generate R2 key
        const r2Key = this.generateR2Key(originalUrl);
        
        // Store in R2
        await r2Bucket.put(r2Key, imageData, {
          httpMetadata: {
            contentType: this.getContentTypeFromUrl(originalUrl),
            cacheControl: 'public, max-age=86400', // 24 hours
          },
          customMetadata: {
            originalUrl,
            cachedAt: new Date().toISOString(),
          },
        });
        
        console.log(`Cached image to R2: ${r2Key}`);
      } catch (error) {
        console.error(`Failed to cache image ${originalUrl}:`, error);
      }
    });
    
    await Promise.allSettled(cachePromises);
  }
  
  /**
   * Read local image file (placeholder - claude-code-action handles the actual download)
   */
  private async readLocalImage(localPath: string): Promise<ArrayBuffer | null> {
    try {
      // In the actual implementation, claude-code-action downloads images to local filesystem
      // This is a placeholder that would integrate with their image downloading logic
      // For now, return null since we can't actually read from local filesystem in Workers
      console.log(`Would read image from: ${localPath}`);
      return null;
    } catch (error) {
      console.error(`Error reading local image ${localPath}:`, error);
      return null;
    }
  }
  
  /**
   * Generate R2 key for image storage
   */
  private generateR2Key(originalUrl: string): string {
    const url = new URL(originalUrl);
    const hash = btoa(originalUrl).replace(/[+/=]/g, '').substring(0, 16);
    const extension = url.pathname.split('.').pop() || 'png';
    return `images/${hash}.${extension}`;
  }
  
  /**
   * Get content type from URL
   */
  private getContentTypeFromUrl(url: string): string {
    const extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'gif': return 'image/gif';
      case 'webp': return 'image/webp';
      case 'svg': return 'image/svg+xml';
      default: return 'application/octet-stream';
    }
  }
  
  /**
   * Get cached image from R2 if available
   */
  async getCachedImage(originalUrl: string): Promise<ArrayBuffer | null> {
    const r2Bucket = this.env.R2_BUCKET;
    if (!r2Bucket) return null;
    
    try {
      const r2Key = this.generateR2Key(originalUrl);
      const object = await r2Bucket.get(r2Key);
      
      if (object) {
        return await object.arrayBuffer();
      }
    } catch (error) {
      console.error(`Error retrieving cached image ${originalUrl}:`, error);
    }
    
    return null;
  }
  
  /**
   * Create a custom image handler that integrates with R2
   */
  createR2ImageHandler() {
    return {
      downloadImage: async (url: string): Promise<string> => {
        // Check if image is already cached in R2
        const cached = await this.getCachedImage(url);
        if (cached) {
          // Return R2 URL or local path
          const r2Key = this.generateR2Key(url);
          return `r2://${r2Key}`;
        }
        
        // Fallback to claude-code-action's default image downloading
        // This would integrate with their downloadCommentImages function
        return url;
      },
    };
  }
}

/**
 * R2 Image handler for claude-code-action integration
 */
export class R2ImageHandler {
  constructor(private r2Bucket: R2Bucket) {}
  
  async downloadAndCache(url: string, localPath: string): Promise<string> {
    try {
      // This would be called by claude-code-action's image downloader
      // We can intercept and also cache to R2
      const r2Key = this.generateR2Key(url);
      
      // The image would be downloaded by claude-code-action to localPath
      // We would then read it and cache to R2
      
      return localPath; // Return the local path for claude-code-action
    } catch (error) {
      console.error(`R2 image handler error for ${url}:`, error);
      throw error;
    }
  }
  
  private generateR2Key(url: string): string {
    const hash = btoa(url).replace(/[+/=]/g, '').substring(0, 16);
    const extension = new URL(url).pathname.split('.').pop() || 'png';
    return `images/${hash}.${extension}`;
  }
}

