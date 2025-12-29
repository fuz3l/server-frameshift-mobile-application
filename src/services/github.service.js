import { Octokit } from "@octokit/rest";
import axios from "axios";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import githubConfig from "../config/github.js";
import logger from "../utils/logger.js";

const execAsync = promisify(exec);

/**
 * GitHub service for OAuth and repository operations
 */
export class GitHubService {
  constructor(accessToken = null) {
    this.accessToken = accessToken;
    this.octokit = accessToken ? new Octokit({ auth: accessToken }) : null;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from GitHub callback
   * @returns {Promise<string>} Access token
   */
  static async exchangeCodeForToken(code) {
    try {
      const response = await axios.post(
        githubConfig.tokenURL,
        {
          client_id: githubConfig.clientId,
          client_secret: githubConfig.clientSecret,
          code,
        },
        {
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (response.data.error) {
        throw new Error(
          response.data.error_description || "Failed to exchange code for token"
        );
      }

      return response.data.access_token;
    } catch (error) {
      logger.error("Failed to exchange code for token:", error);
      throw error;
    }
  }

  /**
   * Get authenticated user profile
   * @returns {Promise<Object>} User profile
   */
  async getUserProfile() {
    try {
      const { data } = await this.octokit.users.getAuthenticated();
      return data;
    } catch (error) {
      logger.error("Failed to get user profile:", error);
      throw error;
    }
  }

  /**
   * Get user's email addresses
   * @returns {Promise<Array>} Email addresses
   */
  async getUserEmails() {
    try {
      const { data } =
        await this.octokit.users.listEmailsForAuthenticatedUser();
      return data;
    } catch (error) {
      logger.error("Failed to get user emails:", error);
      return [];
    }
  }

  /**
   * Get primary email for user
   * @returns {Promise<string>} Primary email
   */
  async getPrimaryEmail() {
    try {
      const emails = await this.getUserEmails();
      const primaryEmail = emails.find(
        (email) => email.primary && email.verified
      );
      return primaryEmail ? primaryEmail.email : null;
    } catch (error) {
      logger.error("Failed to get primary email:", error);
      return null;
    }
  }

  /**
   * List user's repositories
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of repositories
   */
  async listUserRepos(options = {}) {
    try {
      const { data } = await this.octokit.repos.listForAuthenticatedUser({
        sort: options.sort || "updated",
        per_page: options.perPage || 100,
        page: options.page || 1,
      });
      return data;
    } catch (error) {
      logger.error("Failed to list repositories:", error);
      throw error;
    }
  }

  /**
   * Get repository information
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<Object>} Repository information
   */
  async getRepository(owner, repo) {
    try {
      const { data } = await this.octokit.repos.get({ owner, repo });
      return data;
    } catch (error) {
      logger.error("Failed to get repository:", error);
      throw error;
    }
  }

  /**
   * Clone repository to local directory
   * @param {string} repoUrl - Repository URL
   * @param {string} destinationPath - Local destination path
   * @param {string} customToken - Optional custom token (PAT) to use instead of OAuth token
   * @returns {Promise<string>} Destination path
   */
  async cloneRepo(repoUrl, destinationPath, customToken = null) {
    try {
      // Ensure destination directory exists
      await fs.mkdir(destinationPath, { recursive: true });

      // Use custom token if provided, otherwise fall back to OAuth token
      const token = customToken || this.accessToken;

      // Insert access token into clone URL for private repos
      const cloneUrl = token
        ? repoUrl.replace("https://", `https://${token}@`)
        : repoUrl;

      // Clone repository
      const command = `git clone "${cloneUrl}" "${destinationPath}"`;
      await execAsync(command);

      logger.info(`Cloned repository to: ${destinationPath}${customToken ? ' (using custom PAT)' : ''}`);
      return destinationPath;
    } catch (error) {
      logger.error("Failed to clone repository:", error);

      // Check if it's an authentication error
      if (error.message.includes('Authentication failed') || error.message.includes('could not read Username')) {
        throw new Error('GITHUB_AUTH_REQUIRED');
      }

      throw new Error(`Failed to clone repository: ${error.message}`);
    }
  }

  /**
   * Create a new repository
   * @param {Object} options - Repository options
   * @returns {Promise<Object>} Created repository
   */
  async createRepo(options) {
    try {
      const { data } = await this.octokit.repos.createForAuthenticatedUser({
        name: options.name,
        description: options.description || "",
        private: options.isPrivate !== false, // Default to private
        auto_init: options.autoInit || false,
      });

      logger.info(`Created repository: ${data.full_name}`);
      return data;
    } catch (error) {
      logger.error("Failed to create repository:", error);
      throw error;
    }
  }

  /**
   * Push local directory to GitHub repository
   * @param {string} localPath - Local directory path
   * @param {string} repoUrl - Repository URL
   * @param {string} branch - Branch name (default: main)
   * @returns {Promise<void>}
   */
  async pushToRepo(localPath, repoUrl, branch = "main") {
    try {
      // Insert access token into repo URL
      const authRepoUrl = this.accessToken
        ? repoUrl.replace("https://", `https://${this.accessToken}@`)
        : repoUrl;

      // Remove any existing .git directory to ensure fresh repository
      const gitDir = path.join(localPath, ".git");
      if (fsSync.existsSync(gitDir)) {
        fsSync.rmSync(gitDir, { recursive: true, force: true });
        logger.info("Removed existing git repository");
      }

      // Initialize a completely fresh git repository
      // Use GIT_CEILING_DIRECTORIES to prevent Git from looking at parent directories
      const gitEnv = {
        ...process.env,
        GIT_CEILING_DIRECTORIES: path.dirname(localPath),
      };

      await execAsync("git init --initial-branch=main", {
        cwd: localPath,
        env: gitEnv,
      });
      logger.info("Initialized fresh git repository");

      // Configure git user (use GitHub's noreply email)
      await execAsync(
        'git config user.email "frameshift@users.noreply.github.com"',
        { cwd: localPath }
      );
      await execAsync('git config user.name "FrameShift"', { cwd: localPath });

      // Add all files in the converted project directory ONLY
      await execAsync("git add -A", { cwd: localPath });

      // Commit changes
      const commitMessage =
        "Initial commit: Django to Flask conversion by FrameShift";
      await execAsync(`git commit -m "${commitMessage}"`, { cwd: localPath });

      // Set branch name
      await execAsync(`git branch -M ${branch}`, { cwd: localPath });

      // Add remote
      try {
        await execAsync(`git remote add origin "${authRepoUrl}"`, {
          cwd: localPath,
        });
      } catch {
        // Remote might already exist, set URL instead
        await execAsync(`git remote set-url origin "${authRepoUrl}"`, {
          cwd: localPath,
        });
      }

      // Push to remote
      await execAsync(`git push -u origin ${branch}`, { cwd: localPath });

      logger.info(`Pushed to repository: ${repoUrl}`);
    } catch (error) {
      logger.error("Failed to push to repository:", error);
      throw new Error(`Failed to push to repository: ${error.message}`);
    }
  }

  /**
   * Parse GitHub repository URL
   * @param {string} url - Repository URL
   * @returns {Object} Parsed repository info { owner, repo }
   */
  static parseRepoUrl(url) {
    try {
      // Handle different GitHub URL formats
      const patterns = [
        /github\.com\/([^\/]+)\/([^\/\.]+)(\.git)?$/,
        /github\.com:([^\/]+)\/([^\/\.]+)(\.git)?$/,
      ];

      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
          return {
            owner: match[1],
            repo: match[2],
          };
        }
      }

      throw new Error("Invalid GitHub repository URL");
    } catch (error) {
      logger.error("Failed to parse repository URL:", error);
      throw error;
    }
  }

  /**
   * Check if repository exists
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<boolean>} Exists status
   */
  async repoExists(owner, repo) {
    try {
      await this.octokit.repos.get({ owner, repo });
      return true;
    } catch (error) {
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Delete repository
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<void>}
   */
  async deleteRepo(owner, repo) {
    try {
      await this.octokit.repos.delete({ owner, repo });
      logger.info(`Deleted repository: ${owner}/${repo}`);
    } catch (error) {
      logger.error("Failed to delete repository:", error);
      throw error;
    }
  }
}

export default GitHubService;
