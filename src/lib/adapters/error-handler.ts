/**
 * Error handler adapter for Cloudflare Workers
 * Provides Workers-specific error handling and logging
 */

export class WorkersErrorHandler {
  /**
   * Handle GitHub API errors with Workers-specific logging
   */
  static handleGitHubApiError(error: any, context?: string): Error {
    const contextStr = context ? ` in ${context}` : '';
    
    if (error.status) {
      // GitHub API error
      switch (error.status) {
        case 401:
          return new Error(`GitHub API authentication failed${contextStr}. Check installation token.`);
        case 403:
          return new Error(`GitHub API access forbidden${contextStr}. Check app permissions.`);
        case 404:
          return new Error(`GitHub resource not found${contextStr}. Check repository access.`);
        case 429:
          return new Error(`GitHub API rate limit exceeded${contextStr}. Retry later.`);
        default:
          return new Error(`GitHub API error ${error.status}${contextStr}: ${error.message}`);
      }
    }
    
    // Network or other errors
    return new Error(`GitHub API error${contextStr}: ${error.message || 'Unknown error'}`);
  }
  
  /**
   * Handle webhook processing errors
   */
  static handleWebhookError(error: any, eventType?: string): Error {
    const eventStr = eventType ? ` for ${eventType} event` : '';
    
    if (error.name === 'SyntaxError') {
      return new Error(`Invalid webhook payload${eventStr}: ${error.message}`);
    }
    
    return new Error(`Webhook processing error${eventStr}: ${error.message || 'Unknown error'}`);
  }
  
  /**
   * Handle container execution errors
   */
  static handleContainerError(error: any, containerId?: string): Error {
    const containerStr = containerId ? ` in container ${containerId}` : '';
    
    if (error.code === 'TIMEOUT') {
      return new Error(`Container execution timeout${containerStr}`);
    }
    
    if (error.code === 'OUT_OF_MEMORY') {
      return new Error(`Container out of memory${containerStr}`);
    }
    
    return new Error(`Container execution error${containerStr}: ${error.message || 'Unknown error'}`);
  }
  
  /**
   * Handle claude-code-action integration errors
   */
  static handleClaudeActionError(error: any, operation?: string): Error {
    const opStr = operation ? ` during ${operation}` : '';
    
    return new Error(`Claude Code Action error${opStr}: ${error.message || 'Unknown error'}`);
  }
  
  /**
   * Create standardized error response for Workers
   */
  static createErrorResponse(error: Error, status: number = 500): Response {
    const errorResponse = {
      error: error.message,
      timestamp: new Date().toISOString(),
    };
    
    console.error('Worker error:', error);
    
    return new Response(JSON.stringify(errorResponse), {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
  
  /**
   * Safe async wrapper with error handling
   */
  static async withErrorHandling<T>(
    operation: () => Promise<T>,
    errorHandler?: (error: any) => Error
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (errorHandler) {
        throw errorHandler(error);
      }
      throw error;
    }
  }
  
  /**
   * Log error with structured data for Workers analytics
   */
  static logError(error: Error, context: Record<string, any> = {}): void {
    const errorData = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      ...context,
    };
    
    console.error('Structured error log:', JSON.stringify(errorData));
  }
}