import express from 'express';
import { authenticateToken } from '../middleware/auth.middleware.js';
import {
  getAllDiffs,
  getFileDiff,
  getFileContent,
  getDiffSummary,
} from '../controllers/diff.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

/**
 * @route GET /api/conversions/:id/diffs
 * @desc Get all diffs for a conversion
 * @access Private
 */
router.get('/:id/diffs', getAllDiffs);

/**
 * @route GET /api/conversions/:id/diffs/summary
 * @desc Get summary statistics for all diffs
 * @access Private
 */
router.get('/:id/diffs/summary', getDiffSummary);

/**
 * @route GET /api/conversions/:id/diffs/:fileId
 * @desc Get diff for a specific file
 * @access Private
 */
router.get('/:id/diffs/:fileId', getFileDiff);

/**
 * @route GET /api/conversions/:id/files/:fileId/content
 * @desc Get original and converted file content
 * @access Private
 * @query version - 'original' or 'converted' (optional, returns both if not specified)
 */
router.get('/:id/files/:fileId/content', getFileContent);

export default router;
