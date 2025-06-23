/**
 * MCP Server Configuration Adapter
 * Bridges Workers environment to claude-code-action MCP server setup
 */

import { promises as fs } from 'fs';
import { join } from 'path';

export interface McpConfigParams {
  githubToken: string;
  owner: string;
  repo: string;
  branch: string;
  workspaceDir: string;
  claudeCommentId?: string;
  allowedTools?: string[];
  additionalMcpConfig?: string;
}

export interface McpServerConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env: Record<string, string>;
  }>;
}

/**
 * Prepare MCP server configuration for container environment
 * Based on claude-code-action's prepareMcpConfig but adapted for containers
 */
export async function prepareMcpConfigForContainer(
  params: McpConfigParams
): Promise<string> {
  const {
    githubToken,
    owner,
    repo,
    branch,
    workspaceDir,
    claudeCommentId,
    allowedTools = [],
    additionalMcpConfig
  } = params;

  // Path to claude-code-action's MCP server in the container
  const claudeActionPath = '/app/claude-action';
  
  const hasGitHubMcpTools = allowedTools.some((tool) =>
    tool.startsWith("mcp__github__")
  );

  const baseMcpConfig: McpServerConfig = {
    mcpServers: {
      github_file_ops: {
        command: "bun",
        args: [
          "run",
          `${claudeActionPath}/src/mcp/github-file-ops-server.ts`,
        ],
        env: {
          GITHUB_TOKEN: githubToken,
          REPO_OWNER: owner,
          REPO_NAME: repo,
          BRANCH_NAME: branch,
          REPO_DIR: workspaceDir,
          ...(claudeCommentId && { CLAUDE_COMMENT_ID: claudeCommentId }),
          GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME || "issues",
          IS_PR: process.env.IS_PR || "false",
          GITHUB_API_URL: "https://api.github.com",
        },
      },
    },
  };

  // Add GitHub MCP server if needed
  if (hasGitHubMcpTools) {
    baseMcpConfig.mcpServers.github = {
      command: "docker",
      args: [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server:sha-6d69797",
      ],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: githubToken,
      },
    };
  }

  // Merge with additional MCP config if provided
  if (additionalMcpConfig && additionalMcpConfig.trim()) {
    try {
      const additionalConfig = JSON.parse(additionalMcpConfig);

      if (typeof additionalConfig !== "object" || additionalConfig === null) {
        throw new Error("MCP config must be a valid JSON object");
      }

      console.log("Merging additional MCP server configuration");

      const mergedConfig = {
        ...baseMcpConfig,
        ...additionalConfig,
        mcpServers: {
          ...baseMcpConfig.mcpServers,
          ...additionalConfig.mcpServers,
        },
      };

      return JSON.stringify(mergedConfig, null, 2);
    } catch (parseError) {
      console.warn(
        `Failed to parse additional MCP config: ${parseError}. Using base config only.`
      );
    }
  }

  return JSON.stringify(baseMcpConfig, null, 2);
}

/**
 * Write MCP configuration to Claude Code config directory
 */
export async function writeMcpConfig(
  configContent: string,
  workspaceDir: string
): Promise<string> {
  const claudeConfigDir = join(workspaceDir, '.claude');
  const configPath = join(claudeConfigDir, 'claude_desktop_config.json');

  // Ensure .claude directory exists
  await fs.mkdir(claudeConfigDir, { recursive: true });

  // Write the MCP configuration
  await fs.writeFile(configPath, configContent, 'utf8');

  console.log(`MCP configuration written to: ${configPath}`);
  return configPath;
}

/**
 * Setup MCP server environment for claude-code execution
 */
export async function setupMcpEnvironment(params: McpConfigParams): Promise<string> {
  const configContent = await prepareMcpConfigForContainer(params);
  const configPath = await writeMcpConfig(configContent, params.workspaceDir);
  
  // Set environment variable for Claude Code to use this config
  process.env.CLAUDE_DESKTOP_CONFIG = configPath;
  
  return configPath;
}