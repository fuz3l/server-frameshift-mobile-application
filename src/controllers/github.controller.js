import GitHubService from '../services/github.service.js';
import UserModel from '../models/user.model.js';
import ProjectModel from '../models/project.model.js';
import storageService from '../services/storage.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import logger from '../utils/logger.js';
import path from 'path';

/**
 * Initiate GitHub OAuth flow
 * GET /api/auth/github
 */
export const initiateGithubAuth = asyncHandler(async (req, res) => {
  const githubConfig = (await import('../config/github.js')).default;
  const { redirectUri } = req.query;

  const state = redirectUri ? Buffer.from(JSON.stringify({ redirectUri })).toString('base64') : '';
  const authUrl = `${githubConfig.authorizationURL}?client_id=${githubConfig.clientId}&scope=${githubConfig.scope.join(' ')}&redirect_uri=${encodeURIComponent(githubConfig.callbackURL)}` + (state ? `&state=${encodeURIComponent(state)}` : '');

  res.json({
    success: true,
    data: {
      authUrl
    }
  });
});

/**
 * GitHub OAuth callback
 * GET /api/auth/github/callback
 */
export const githubCallback = asyncHandler(async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Authorization code is required'
      }
    });
  }

  try {
    // Exchange code for access token
    const accessToken = await GitHubService.exchangeCodeForToken(code);

    // Get user profile
    const githubService = new GitHubService(accessToken);
    const profile = await githubService.getUserProfile();
    const primaryEmail = await githubService.getPrimaryEmail();

    // Login or create user
    const AuthService = (await import('../services/auth.service.js')).default;
    const result = await AuthService.githubAuth({
      id: profile.id.toString(),
      username: profile.login,
      email: primaryEmail || profile.email,
      name: profile.name,
      avatar_url: profile.avatar_url,
      accessToken
    });

    if (state) {
      try {
        // Express decodes '+' into spaces in query params, so we must replace them back for valid base64
        const safeState = state.replace(/ /g, '+');
        const decodedState = JSON.parse(Buffer.from(safeState, 'base64').toString('utf8'));
        if (decodedState.redirectUri) {
          // If a redirect URI was provided (like from the mobile app), redirect explicitly back to it
          // Wait to ensure frontend has completely initialized processing
          return res.redirect(`${decodedState.redirectUri}?token=${result.token}`);
        }
      } catch (e) {
        logger.error('Failed to parse state:', e);
      }
    }

    // Redirect to frontend with token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    res.redirect(`${frontendUrl}/auth/callback?token=${result.token}`);
  } catch (error) {
    logger.error('GitHub OAuth callback failed:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent(error.message)}`);
  }
});

/**
 * List user's GitHub repositories
 * GET /api/github/repos
 */
export const listUserRepos = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const page = parseInt(req.query.page) || 1;
  const perPage = parseInt(req.query.perPage) || 30;

  // Get user's GitHub access token
  const user = await UserModel.findById(userId);

  if (!user || !user.github_access_token) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'GitHub account not connected. Please authenticate with GitHub first.'
      }
    });
  }

  const githubService = new GitHubService(user.github_access_token);
  
  try {
    const repos = await githubService.listUserRepos({ page, perPage });

    res.json({
      success: true,
      data: {
        repos: repos.map(repo => ({
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description,
          url: repo.html_url,
          clone_url: repo.clone_url,
          private: repo.private,
          language: repo.language,
          updated_at: repo.updated_at
        }))
      }
    });
  } catch (error) {
    if (error.message === 'GITHUB_AUTH_REQUIRED' || (error.response && error.response.status === 401)) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'GitHub token is invalid or expired. Please reconnect your GitHub account.',
          code: 'GITHUB_AUTH_EXPIRED'
        }
      });
    }
    throw error;
  }
});

/**
 * Clone repository and create project
 * POST /api/github/clone
 */
export const cloneRepository = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { repo_url, repoUrl, name, description, github_token } = req.body;

  // Support both repo_url (frontend) and repoUrl (legacy)
  const repositoryUrl = repo_url || repoUrl;

  if (!repositoryUrl) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Repository URL is required'
      }
    });
  }

  // Get user's GitHub access token
  const user = await UserModel.findById(userId);

  // Allow custom PAT or OAuth token
  const hasAuth = user?.github_access_token || github_token;

  if (!hasAuth) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'GitHub authentication required. Please connect your GitHub account or provide a Personal Access Token.',
        code: 'GITHUB_AUTH_REQUIRED'
      }
    });
  }

  const githubService = new GitHubService(user?.github_access_token);

  // Create project directory
  const projectPath = await storageService.createProjectDirectory(userId);

  try {
    // Clone repository (use custom PAT if provided, otherwise OAuth token)
    await githubService.cloneRepo(repositoryUrl, projectPath, github_token);

    // Get directory size
    const size_bytes = await storageService.getDirectorySize(projectPath);
    const requestedName = name || path.basename(repositoryUrl, '.git');
    const uniqueName = await ProjectModel.generateUniqueActiveName(userId, requestedName);

    // Create project record
    const project = await ProjectModel.create({
      user_id: userId,
      name: uniqueName,
      description,
      source_type: 'github',
      source_url: repositoryUrl,
      file_path: projectPath,
      size_bytes
    });

    logger.info(`Repository cloned: ${repositoryUrl} for user ${userId}${github_token ? ' (using custom PAT)' : ''}`);

    res.status(201).json({
      success: true,
      data: {
        project
      }
    });
  } catch (error) {
    // Cleanup on error
    await storageService.deleteDirectory(projectPath);
    logger.error('Failed to clone repository:', error);
    throw error;
  }
});

/**
 * Create new GitHub repository
 * POST /api/github/create-repo
 */
export const createRepository = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { name, description, isPrivate } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Repository name is required'
      }
    });
  }

  // Get user's GitHub access token
  const user = await UserModel.findById(userId);

  if (!user || !user.github_access_token) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'GitHub account not connected. Please authenticate with GitHub first.'
      }
    });
  }

  const githubService = new GitHubService(user.github_access_token);

  const repo = await githubService.createRepo({
    name,
    description,
    isPrivate: isPrivate !== false // Default to private
  });

  logger.info(`Repository created: ${repo.full_name} by user ${userId}`);

  res.status(201).json({
    success: true,
    data: {
      repo: {
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        url: repo.html_url,
        clone_url: repo.clone_url,
        private: repo.private
      }
    }
  });
});

/**
 * Push converted project to GitHub
 * POST /api/github/push/:conversionId
 */
export const pushConvertedProject = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { conversionId } = req.params;
  const {
    repoName,
    repo_name,
    create_new,
    description,
    isPrivate,
    repoUrl,
    repo_url,
    githubToken  // NEW: Accept personal access token
  } = req.body;

  // Get token from EITHER request body OR user's stored OAuth token
  let accessToken = githubToken;

  if (!accessToken) {
    const user = await UserModel.findById(userId);
    accessToken = user?.github_access_token;
  }

  // Check if we have ANY token (OAuth or manual)
  if (!accessToken) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'GitHub access required. Either link your GitHub account or provide a personal access token.'
      }
    });
  }

  // Get conversion job and verify ownership
  const ConversionJobModel = (await import('../models/conversionJob.model.js')).default;
  const conversionJob = await ConversionJobModel.findByIdAndUserId(conversionId, userId);

  if (!conversionJob) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Conversion job not found or you do not have permission to access it'
      }
    });
  }

  // Check if conversion is completed
  if (conversionJob.status !== 'completed') {
    return res.status(400).json({
      success: false,
      error: {
        message: `Cannot push incomplete conversion. Current status: ${conversionJob.status}`
      }
    });
  }

  // Check if converted files exist
  if (!conversionJob.converted_file_path) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Converted files not found. Please run conversion again.'
      }
    });
  }

  // Create GitHub service with the token (OAuth or manual)
  const githubService = new GitHubService(accessToken);

  // Validate token by trying to get user profile
  try {
    await githubService.getUserProfile();
  } catch (error) {
    logger.error('Invalid GitHub token:', error);
    return res.status(401).json({
      success: false,
      error: {
        message: 'Invalid GitHub token. Please check your credentials and try again.',
        details: githubToken ? 'Personal access token is invalid' : 'OAuth token is invalid. Try relinking your GitHub account.'
      }
    });
  }

  try {
    const normalizedRepoName = repoName || repo_name;
    const normalizedRepoUrl = repoUrl || repo_url;
    const shouldCreateNewRepo = create_new !== undefined
      ? ['1', 'true', 'yes', true].includes(
        typeof create_new === 'string' ? create_new.toLowerCase() : create_new
      )
      : !normalizedRepoUrl;

    let targetRepoUrl = normalizedRepoUrl;

    // If no existing repo URL provided, create a new repository
    if (shouldCreateNewRepo) {
      if (!normalizedRepoName) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Repository name is required when creating a new repository'
          }
        });
      }

      logger.info(`Creating new GitHub repository: ${normalizedRepoName} for user ${userId}`);

      const newRepo = await githubService.createRepo({
        name: normalizedRepoName,
        description: description || `Flask project converted from Django by FrameShift (Conversion ID: ${conversionId})`,
        isPrivate: isPrivate !== false // Default to private
      });

      targetRepoUrl = newRepo.clone_url;

      logger.info(`Repository created successfully: ${newRepo.full_name}`);
    } else {
      if (!targetRepoUrl) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Repository URL is required when pushing to an existing repository'
          }
        });
      }

      // Verify the repository exists and user has access
      const { owner, repo } = GitHubService.parseRepoUrl(targetRepoUrl);
      const exists = await githubService.repoExists(owner, repo);

      if (!exists) {
        return res.status(404).json({
          success: false,
          error: {
            message: 'Target repository not found or you do not have access to it'
          }
        });
      }
    }

    // Push converted project to GitHub
    logger.info(`Pushing converted project to: ${targetRepoUrl}`);

    await githubService.pushToRepo(
      conversionJob.converted_file_path,
      targetRepoUrl,
      'main'
    );

    logger.info(`Successfully pushed conversion ${conversionId} to GitHub`);

    res.json({
      success: true,
      message: 'Project successfully pushed to GitHub',
      data: {
        conversionId,
        repoUrl: targetRepoUrl,
        branch: 'main'
      }
    });
  } catch (error) {
    logger.error(`Failed to push conversion ${conversionId} to GitHub:`, error);

    // Return user-friendly error message
    let errorMessage = 'Failed to push to GitHub';

    if (error.message.includes('already exists')) {
      errorMessage = 'Repository name already exists. Please choose a different name.';
    } else if (error.message.includes('permission')) {
      errorMessage = 'You do not have permission to push to this repository.';
    } else if (error.message.includes('authentication')) {
      errorMessage = 'GitHub authentication failed. Please reconnect your GitHub account.';
    }

    return res.status(500).json({
      success: false,
      error: {
        message: errorMessage,
        details: error.message
      }
    });
  }
});

/**
 * Link GitHub account to existing user account
 * POST /api/github/link
 */
export const linkGithubAccount = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Authorization code is required'
      }
    });
  }

  // Exchange code for access token and get user profile
  const accessToken = await GitHubService.exchangeCodeForToken(code);
  const githubService = new GitHubService(accessToken);
  const profile = await githubService.getUserProfile();

  // Prepare GitHub profile data
  const githubProfile = {
    id: profile.id.toString(),
    username: profile.login,
    accessToken: accessToken,
    avatarUrl: profile.avatar_url
  };

  // Link GitHub account to user
  const user = await UserModel.linkGithubAccount(userId, githubProfile);

  res.json({
    success: true,
    data: {
      user
    },
    message: 'GitHub account linked successfully'
  });
});

/**
 * Unlink GitHub account from user
 * DELETE /api/github/unlink
 */
export const unlinkGithubAccount = asyncHandler(async (req, res) => {
  const { userId } = req.user;

  const user = await UserModel.unlinkGithubAccount(userId);

  res.json({
    success: true,
    data: {
      user
    },
    message: 'GitHub account unlinked successfully'
  });
});

/**
 * Get GitHub connection status
 * GET /api/github/status
 */
export const getGithubStatus = asyncHandler(async (req, res) => {
  const { userId } = req.user;

  const user = await UserModel.findById(userId);
  const hasOAuthToken = !!user.github_access_token;

  res.json({
    success: true,
    data: {
      isLinked: hasOAuthToken,  // Kept for backward compatibility
      hasOAuthToken,  // NEW: Explicitly shows if OAuth token exists
      github_username: user.github_username || null,
      avatar_url: user.avatar_url || null,
      canPushToGithub: true,  // NEW: Always true! Users can use personal tokens
      authProvider: user.auth_provider || 'email'  // NEW: How they signed up
    }
  });
});
