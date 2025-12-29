import UserModel from '../models/user.model.js';
import ProjectModel from '../models/project.model.js';
import asyncHandler from '../utils/asyncHandler.js';
import logger from '../utils/logger.js';

/**
 * Get current user profile
 * GET /api/users/me
 */
export const getCurrentUser = asyncHandler(async (req, res) => {
  const { userId } = req.user;

  const user = await UserModel.findById(userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      error: {
        message: 'User not found'
      }
    });
  }

  res.json({
    success: true,
    data: {
      user
    }
  });
});

/**
 * Update user profile
 * PATCH /api/users/me
 */
export const updateUserProfile = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { full_name, email } = req.body;

  const updateData = {};
  if (full_name !== undefined) updateData.full_name = full_name;
  if (email) {
    // Check if email is already taken by another user
    const existingUser = await UserModel.findByEmail(email);
    if (existingUser && existingUser.id !== userId) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Email already in use'
        }
      });
    }
    updateData.email = email;
    updateData.email_verified = false; // Reset verification if email changes
  }

  const user = await UserModel.update(userId, updateData);

  logger.info(`User profile updated: ${userId}`);

  res.json({
    success: true,
    data: {
      user
    }
  });
});

/**
 * Delete user account
 * DELETE /api/users/me
 */
export const deleteUserAccount = asyncHandler(async (req, res) => {
  const { userId } = req.user;

  // Delete user (cascades to projects and conversion jobs)
  await UserModel.delete(userId);

  logger.info(`User account deleted: ${userId}`);

  res.json({
    success: true,
    message: 'User account deleted successfully'
  });
});

/**
 * Get user's projects
 * GET /api/users/me/projects
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
 * Get user's conversion history
 * GET /api/users/me/conversions
 */
export const getUserConversions = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const status = req.query.status || null;

  const offset = (page - 1) * pageSize;

  // Get conversions with project details
  const ConversionJobModel = (await import('../models/conversionJob.model.js')).default;
  const ReportModel = (await import('../models/report.model.js')).default;

  const jobs = await ConversionJobModel.findByUserId(userId, {
    limit: pageSize,
    offset,
    status
  });

  const total = await ConversionJobModel.countByUserId(userId, status);

  // Enrich with report data if available
  const conversions = await Promise.all(
    jobs.map(async (job) => {
      let report = null;
      if (job.status === 'completed') {
        try {
          report = await ReportModel.findByConversionJobId(job.id);
        } catch (error) {
          logger.error(`Failed to fetch report for job ${job.id}:`, error);
        }
      }

      return {
        id: job.id,
        projectId: job.project_id,
        status: job.status,
        progress: job.progress_percentage,
        currentStep: job.current_step,
        error: job.error_message,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        createdAt: job.created_at,
        report: report ? {
          accuracyScore: report.accuracy_score,
          totalFiles: report.total_files_converted,
          modelsConverted: report.models_converted,
          viewsConverted: report.views_converted,
          urlsConverted: report.urls_converted
        } : null
      };
    })
  );

  res.json({
    success: true,
    data: {
      conversions,
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
 * Get user statistics
 * GET /api/users/me/stats
 */
export const getUserStats = asyncHandler(async (req, res) => {
  const { userId } = req.user;

  const totalProjects = await ProjectModel.countByUserId(userId);

  // Get conversion statistics
  const ConversionJobModel = (await import('../models/conversionJob.model.js')).default;

  const totalConversions = await ConversionJobModel.countByUserId(userId);
  const completedConversions = await ConversionJobModel.countByUserId(userId, 'completed');
  const failedConversions = await ConversionJobModel.countByUserId(userId, 'failed');
  const inProgressConversions = await ConversionJobModel.countByUserId(userId, 'processing');

  res.json({
    success: true,
    data: {
      stats: {
        totalProjects,
        totalConversions,
        completedConversions,
        failedConversions,
        inProgressConversions
      }
    }
  });
});
