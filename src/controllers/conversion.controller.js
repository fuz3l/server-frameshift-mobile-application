import ConversionJobModel from '../models/conversionJob.model.js';
import ReportModel from '../models/report.model.js';
import ProjectModel from '../models/project.model.js';
import ConversionService from '../services/conversion.service.js';
import storageService from '../services/storage.service.js';
import { broadcastConversionComplete, broadcastConversionFailed } from '../services/websocket.service.js';
import asyncHandler from '../utils/asyncHandler.js';
import logger from '../utils/logger.js';
import path from 'path';
import fs from 'fs/promises';

/**
 * Start new conversion
 * POST /api/conversions
 */
export const startConversion = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { projectId, use_ai = true } = req.body; // Extract use_ai from request

  if (!projectId) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Project ID is required'
      }
    });
  }

  // Verify project exists and belongs to user
  const project = await ProjectModel.findByIdAndUserId(projectId, userId);

  if (!project) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Project not found'
      }
    });
  }

  // Check if project has a file path
  if (!project.file_path) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Project does not have files to convert'
      }
    });
  }

  // Create conversion job with AI flag
  const job = await ConversionJobModel.create({
    project_id: projectId,
    user_id: userId,
    status: 'pending',
    progress_percentage: 0,
    use_ai: use_ai
  });

  logger.info(`Conversion job created: ${job.id} for project ${projectId} (AI: ${use_ai ? 'enabled' : 'disabled'})`);

  // Start conversion asynchronously with AI flag
  ConversionService.startConversion(job.id, project.file_path, userId, use_ai)
    .then(result => {
      // Broadcast completion
      broadcastConversionComplete(userId, job.id, result);
      logger.info(`Conversion job ${job.id} completed and broadcasted`);
    })
    .catch(error => {
      // Broadcast failure
      broadcastConversionFailed(userId, job.id, error.message);
      logger.error(`Conversion job ${job.id} failed:`, error);
    });

  // Return job immediately (conversion runs in background)
  res.status(202).json({
    success: true,
    data: {
      job: {
        id: job.id,
        projectId: job.project_id,
        status: job.status,
        progress: job.progress_percentage,
        createdAt: job.created_at
      }
    },
    message: 'Conversion started. Connect to WebSocket for real-time updates.'
  });
});

/**
 * Get conversion job status
 * GET /api/conversions/:id
 */
export const getConversionStatus = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  const job = await ConversionJobModel.findByIdAndUserId(id, userId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Conversion job not found'
      }
    });
  }

  res.json({
    success: true,
    data: {
      job: {
        id: job.id,
        projectId: job.project_id,
        status: job.status,
        progress: job.progress_percentage,
        currentStep: job.current_step,
        error: job.error_message,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        createdAt: job.created_at
      }
    }
  });
});

/**
 * Get all conversion jobs for user
 * GET /api/conversions
 */
export const getUserConversions = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const status = req.query.status || null;

  const offset = (page - 1) * pageSize;

  const jobs = await ConversionJobModel.findByUserId(userId, {
    limit: pageSize,
    offset,
    status
  });

  const total = await ConversionJobModel.countByUserId(userId, status);

  res.json({
    success: true,
    data: {
      jobs,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    }
  });
});

/**
 * Download converted project
 * GET /api/conversions/:id/download
 */
export const downloadConversion = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  const job = await ConversionJobModel.findByIdAndUserId(id, userId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Conversion job not found'
      }
    });
  }

  if (job.status !== 'completed') {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Conversion is not completed yet'
      }
    });
  }

  if (!job.converted_file_path) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Converted files not found'
      }
    });
  }

  try {
    // Get project directory (the actual project folder inside converted_file_path)
    // converted_file_path = storage/converted/{userId}/{jobId}
    // We need to ZIP storage/converted/{userId}/{jobId}/{ProjectName}

    // Find the project directory (first subdirectory in converted_file_path)
    const files = await fs.readdir(job.converted_file_path);
    const projectDirs = [];

    for (const file of files) {
      const filePath = path.join(job.converted_file_path, file);
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        projectDirs.push(file);
      }
    }

    // Use the first project directory found, or fall back to entire directory
    const projectPath = projectDirs.length > 0
      ? path.join(job.converted_file_path, projectDirs[0])
      : job.converted_file_path;

    // Create ZIP of converted project
    const zipFilename = `converted-${id}.zip`;
    const zipPath = await storageService.createZip(
      projectPath,
      zipFilename,
      userId
    );

    // Send file for download
    res.download(zipPath, zipFilename, (err) => {
      if (err) {
        logger.error(`Download failed for job ${id}:`, err);
      }
      // Optionally delete ZIP after download
      // storageService.deleteFile(zipPath);
    });
  } catch (error) {
    logger.error(`Failed to create ZIP for job ${id}:`, error);
    throw error;
  }
});

/**
 * Cancel conversion
 * DELETE /api/conversions/:id
 */
export const cancelConversion = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  const job = await ConversionJobModel.findByIdAndUserId(id, userId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Conversion job not found'
      }
    });
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return res.status(400).json({
      success: false,
      error: {
        message: `Cannot cancel ${job.status} conversion`
      }
    });
  }

  await ConversionService.cancelConversion(id);

  logger.info(`Conversion job ${id} cancelled by user ${userId}`);

  res.json({
    success: true,
    message: 'Conversion cancelled successfully'
  });
});

/**
 * Retry failed conversion
 * POST /api/conversions/:id/retry
 */
export const retryConversion = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  // Verify job belongs to user
  const job = await ConversionJobModel.findByIdAndUserId(id, userId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Conversion job not found'
      }
    });
  }

  // Only failed conversions can be retried
  if (job.status !== 'failed') {
    return res.status(400).json({
      success: false,
      error: {
        message: `Cannot retry ${job.status} conversion. Only failed conversions can be retried.`
      }
    });
  }

  // Check retry limit (max 3 retries)
  const MAX_RETRIES = 3;
  if (job.retry_count >= MAX_RETRIES) {
    return res.status(400).json({
      success: false,
      error: {
        message: `Maximum retry limit (${MAX_RETRIES}) reached for this conversion.`
      }
    });
  }

  // Get project to verify it still exists
  const project = await ProjectModel.findById(job.project_id);

  if (!project || !project.file_path) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Original project files not found. Cannot retry conversion.'
      }
    });
  }

  // Update job for retry
  const updatedJob = await ConversionJobModel.update(id, {
    status: 'pending',
    progress_percentage: 0,
    current_step: null,
    error_message: null,
    retry_count: job.retry_count + 1,
    last_retry_at: new Date()
  });

  logger.info(`Retrying conversion job ${id} (attempt ${updatedJob.retry_count})`);

  // Start conversion asynchronously
  ConversionService.startConversion(id, project.file_path, userId)
    .then(result => {
      broadcastConversionComplete(userId, id, result);
      logger.info(`Retry conversion job ${id} completed successfully`);
    })
    .catch(error => {
      broadcastConversionFailed(userId, id, error.message);
      logger.error(`Retry conversion job ${id} failed:`, error);
    });

  // Return updated job immediately
  res.json({
    success: true,
    data: {
      job: updatedJob
    },
    message: `Conversion retry started (attempt ${updatedJob.retry_count}/${MAX_RETRIES})`
  });
});

/**
 * Get conversion report
 * GET /api/conversions/:id/report
 */
export const getConversionReport = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  // Verify job belongs to user
  const job = await ConversionJobModel.findByIdAndUserId(id, userId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Conversion job not found'
      }
    });
  }

  // Get report
  const report = await ReportModel.findByConversionJobId(id);

  if (!report) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Report not found'
      }
    });
  }

  res.json({
    success: true,
    data: {
      report
    }
  });
});
