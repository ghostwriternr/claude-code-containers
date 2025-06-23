/**
 * Production-ready router for Cloudflare Workers
 * Clean, RESTful API structure with proper separation of concerns
 */

import { logWithContext } from '../log';

export interface RouteHandler {
  (request: Request, env: Env, params: Record<string, string>): Promise<Response>;
}

export interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  /**
   * Add a route to the router
   */
  add(method: string, path: string, handler: RouteHandler): void {
    this.routes.push({ method, path, handler });
  }

  /**
   * GET route helper
   */
  get(path: string, handler: RouteHandler): void {
    this.add('GET', path, handler);
  }

  /**
   * POST route helper
   */
  post(path: string, handler: RouteHandler): void {
    this.add('POST', path, handler);
  }

  /**
   * PUT route helper
   */
  put(path: string, handler: RouteHandler): void {
    this.add('PUT', path, handler);
  }

  /**
   * DELETE route helper
   */
  delete(path: string, handler: RouteHandler): void {
    this.add('DELETE', path, handler);
  }

  /**
   * Handle incoming request by matching route
   */
  async handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    logWithContext('ROUTER', 'Routing request', {
      method,
      pathname,
      userAgent: request.headers.get('user-agent')?.substring(0, 50)
    });

    // Find matching route
    for (const route of this.routes) {
      if (route.method !== method) continue;

      const params = this.matchPath(route.path, pathname);
      if (params !== null) {
        logWithContext('ROUTER', 'Route matched', {
          method,
          path: route.path,
          pathname,
          params
        });

        try {
          return await route.handler(request, env, params);
        } catch (error) {
          logWithContext('ROUTER', 'Route handler error', {
            method,
            path: route.path,
            error: error instanceof Error ? error.message : String(error)
          });

          return new Response(JSON.stringify({
            error: 'Internal server error',
            timestamp: new Date().toISOString()
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    }

    // No route found
    logWithContext('ROUTER', 'No route found', {
      method,
      pathname,
      availableRoutes: this.routes.map(r => `${r.method} ${r.path}`)
    });

    return new Response(JSON.stringify({
      error: 'Not found',
      method,
      pathname,
      timestamp: new Date().toISOString()
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Match path pattern against actual pathname
   * Returns null if no match, or object with extracted parameters
   */
  private matchPath(pattern: string, pathname: string): Record<string, string> | null {
    // Convert pattern like "/api/v1/repositories/{owner}/{repo}/config" 
    // to regex that captures parameters
    const paramNames: string[] = [];
    const regexPattern = pattern
      .replace(/\{([^}]+)\}/g, (_, paramName) => {
        paramNames.push(paramName);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/');

    const regex = new RegExp(`^${regexPattern}$`);
    const match = pathname.match(regex);

    if (!match) return null;

    // Extract parameters
    const params: Record<string, string> = {};
    paramNames.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1]);
    });

    return params;
  }

  /**
   * Get all registered routes (for debugging/admin)
   */
  getRoutes(): Route[] {
    return [...this.routes];
  }
}

/**
 * CORS helper for API endpoints
 */
export function corsHeaders(origin?: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

/**
 * Handle preflight CORS requests
 */
export function handleCors(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request.headers.get('Origin') || undefined)
    });
  }
  return null;
}

/**
 * JSON response helper
 */
export function jsonResponse(
  data: any, 
  status: number = 200, 
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...headers
    }
  });
}

/**
 * Error response helper
 */
export function errorResponse(
  message: string, 
  status: number = 500, 
  details?: any
): Response {
  const errorData = {
    error: message,
    timestamp: new Date().toISOString(),
    ...(details && { details })
  };

  return jsonResponse(errorData, status);
}