import ProjectModel from '../models/project.model.js';
import storageService from '../services/storage.service.js';
import FileValidator from '../utils/fileValidator.js';
import asyncHandler from '../utils/asyncHandler.js';
import path from 'path';
import logger from '../utils/logger.js';

/**
 * Upload project (ZIP file)
 * POST /api/projects/upload
 */
export const uploadProject = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const file = req.file;
  const { name } = req.body;

  if (!file) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'No file uploaded'
      }
    });
  }

  // Additional validation
  const validation = FileValidator.validate(file);
  if (!validation.valid) {
    // Delete uploaded file
    await storageService.deleteFile(file.path);

    return res.status(400).json({
      success: false,
      error: {
        message: validation.error
      }
    });
  }

  // Create project directory
  const projectPath = await storageService.createProjectDirectory(userId);

  // Extract ZIP file
  try {
    await storageService.extractZip(file.path, projectPath);

    // Get project size
    const size_bytes = await storageService.getDirectorySize(projectPath);

    // Create project record
    const project = await ProjectModel.create({
      user_id: userId,
      name: name || path.parse(file.originalname).name,
      source_type: 'upload',
      file_path: projectPath,
      size_bytes
    });

    // Delete uploaded ZIP file
    await storageService.deleteFile(file.path);

    logger.info(`Project uploaded: ${project.id} by user ${userId}`);

    res.status(201).json({
      success: true,
      data: {
        project
      }
    });
  } catch (error) {
    // Cleanup on error
    await storageService.deleteFile(file.path);
    await storageService.deleteDirectory(projectPath);

    logger.error('Project upload failed:', error);
    throw error;
  }
});

/**
 * Import project from GitHub
 * POST /api/projects/github
 */
export const importFromGithub = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { repoUrl, name, description } = req.body;

  if (!repoUrl) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Repository URL is required'
      }
    });
  }

  // Create project record
  const project = await ProjectModel.create({
    user_id: userId,
    name: name || path.basename(repoUrl, '.git'),
    description,
    source_type: 'github',
    source_url: repoUrl
  });

  logger.info(`GitHub project created: ${project.id} by user ${userId}`);

  res.status(201).json({
    success: true,
    data: {
      project
    },
    message: 'Project created. Use GitHub service to clone the repository.'
  });
});

/**
 * Get all projects for current user
 * GET /api/projects
 */
export const getUserProjects = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;

  const result = await ProjectModel.getPaginated(userId, page, pageSize);

  res.json({
    success: true,
    data: result
  });
});

/**
 * Get project by ID
 * GET /api/projects/:id
 */
export const getProjectById = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  const project = await ProjectModel.findByIdAndUserId(id, userId);

  if (!project) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Project not found'
      }
    });
  }

  res.json({
    success: true,
    data: {
      project
    }
  });
});

/**
 * Update project
 * PATCH /api/projects/:id
 */
export const updateProject = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;
  const { name, description } = req.body;

  // Check if project exists and belongs to user
  const existingProject = await ProjectModel.findByIdAndUserId(id, userId);

  if (!existingProject) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Project not found'
      }
    });
  }

  // Update project
  const updateData = {};
  if (name) updateData.name = name;
  if (description !== undefined) updateData.description = description;

  const project = await ProjectModel.update(id, updateData);

  logger.info(`Project updated: ${id} by user ${userId}`);

  res.json({
    success: true,
    data: {
      project
    }
  });
});

/**
 * Delete project
 * DELETE /api/projects/:id
 */
export const deleteProject = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;
  console.log(id);
  console.log(userId);
  // Check if project exists and belongs to user
  const project = await ProjectModel.findByIdAndUserId(id, userId);
  console.log(project);
  if (!project) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Project not found'
      }
    });
  }

  // Delete project files
  if (project.file_path) {
    await storageService.deleteDirectory(project.file_path);
  }

  // Delete project record
  await ProjectModel.delete(id);

  logger.info(`Project deleted: ${id} by user ${userId}`);

  res.json({
    success: true,
    message: 'Project deleted successfully'
  });
});

/**
 * Analyze project structure
 * GET /api/projects/:id/analyze
 */
export const analyzeProject = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  // Check if project exists and belongs to user
  const project = await ProjectModel.findByIdAndUserId(id, userId);

  if (!project) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Project not found'
      }
    });
  }

  // TODO: Implement Django structure analysis using Python
  // This will be implemented in Phase 4 when we build the Python conversion engine

  res.json({
    success: true,
    message: 'Project analysis will be implemented in conversion phase',
    data: {
      projectId: id,
      projectPath: project.file_path
    }
  });
});
