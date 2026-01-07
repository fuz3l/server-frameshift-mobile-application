import asyncHandler from 'express-async-handler';
import ConversionJobModel from '../models/conversionJob.model.js';
import ReportModel from '../models/report.model.js';
import DiffService from '../services/diff.service.js';
import logger from '../utils/logger.js';

/**
 * @route GET /api/conversions/:id/diffs
 * @desc Get all diffs for a conversion
 * @access Private
 */
export const getAllDiffs = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  // Verify user owns this conversion
  const job = await ConversionJobModel.findByIdAndUserId(id, userId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: { message: 'Conversion job not found' },
    });
  }

  // Only completed conversions have diffs
  if (job.status !== 'completed') {
    return res.status(400).json({
      success: false,
      error: { message: `Cannot view diffs for ${job.status} conversion. Conversion must be completed.` },
    });
  }

  // Get report which contains diff data
  const report = await ReportModel.findByConversionId(id);

  if (!report || !report.file_diffs) {
    return res.status(404).json({
      success: false,
      error: { message: 'Diffs not found for this conversion' },
    });
  }

  // Generate summary
  const summary = DiffService.generateSummary(report.file_diffs);

  res.json({
    success: true,
    data: {
      files: report.file_diffs,
      summary: summary,
      categories: DiffService.categorizeFiles(report.file_diffs),
    },
  });
});

/**
 * @route GET /api/conversions/:id/diffs/:fileId
 * @desc Get diff for a specific file
 * @access Private
 */
export const getFileDiff = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id, fileId } = req.params;

  // Verify user owns this conversion
  const job = await ConversionJobModel.findByIdAndUserId(id, userId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: { message: 'Conversion job not found' },
    });
  }

  // Only completed conversions have diffs
  if (job.status !== 'completed') {
    return res.status(400).json({
      success: false,
      error: { message: `Cannot view diffs for ${job.status} conversion. Conversion must be completed.` },
    });
  }

  // Get report which contains diff data
  const report = await ReportModel.findByConversionId(id);

  if (!report || !report.file_diffs) {
    return res.status(404).json({
      success: false,
      error: { message: 'Diffs not found for this conversion' },
    });
  }

  // Find specific file diff
  const fileDiff = report.file_diffs.find((diff) => diff.id === fileId);

  if (!fileDiff) {
    return res.status(404).json({
      success: false,
      error: { message: 'File diff not found' },
    });
  }

  res.json({
    success: true,
    data: fileDiff,
  });
});

/**
 * @route GET /api/conversions/:id/files/:fileId/content
 * @desc Get original and converted file content
 * @access Private
 */
export const getFileContent = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id, fileId } = req.params;
  const { version } = req.query; // 'original' or 'converted'

  // Verify user owns this conversion
  const job = await ConversionJobModel.findByIdAndUserId(id, userId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: { message: 'Conversion job not found' },
    });
  }

  // Only completed conversions have file content
  if (job.status !== 'completed') {
    return res.status(400).json({
      success: false,
      error: { message: `Cannot view file content for ${job.status} conversion. Conversion must be completed.` },
    });
  }

  // Get report which contains diff data
  const report = await ReportModel.findByConversionId(id);

  if (!report || !report.file_diffs) {
    return res.status(404).json({
      success: false,
      error: { message: 'File content not found for this conversion' },
    });
  }

  // Find specific file diff
  const fileDiff = report.file_diffs.find((diff) => diff.id === fileId);

  if (!fileDiff) {
    return res.status(404).json({
      success: false,
      error: { message: 'File not found' },
    });
  }

  // Return content based on version
  let content = fileDiff.content;

  if (version === 'original') {
    content = { content: fileDiff.content.original };
  } else if (version === 'converted') {
    content = { content: fileDiff.content.converted };
  }

  res.json({
    success: true,
    data: {
      file: fileDiff.file,
      content: content,
    },
  });
});

/**
 * @route GET /api/conversions/:id/diffs/summary
 * @desc Get summary statistics for all diffs
 * @access Private
 */
export const getDiffSummary = asyncHandler(async (req, res) => {
  const { userId } = req.user;
  const { id } = req.params;

  // Verify user owns this conversion
  const job = await ConversionJobModel.findByIdAndUserId(id, userId);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: { message: 'Conversion job not found' },
    });
  }

  // Only completed conversions have diffs
  if (job.status !== 'completed') {
    return res.status(400).json({
      success: false,
      error: { message: `Cannot view diffs for ${job.status} conversion. Conversion must be completed.` },
    });
  }

  // Get report which contains diff data
  const report = await ReportModel.findByConversionId(id);

  if (!report || !report.file_diffs) {
    return res.status(404).json({
      success: false,
      error: { message: 'Diffs not found for this conversion' },
    });
  }

  // Generate summary
  const summary = DiffService.generateSummary(report.file_diffs);
  const categories = DiffService.categorizeFiles(report.file_diffs);

  res.json({
    success: true,
    data: {
      summary: summary,
      categories: Object.keys(categories).reduce((acc, key) => {
        acc[key] = {
          count: categories[key].length,
          files: categories[key].map((diff) => ({
            id: diff.id,
            originalPath: diff.file.originalPath,
            convertedPath: diff.file.convertedPath,
            confidence: diff.file.confidence,
            stats: diff.stats,
          })),
        };
        return acc;
      }, {}),
    },
  });
});
