import express from 'express';
import {
  startConversion,
  getConversionStatus,
  getUserConversions,
  downloadConversion,
  cancelConversion,
  getConversionReport,
  retryConversion
} from '../controllers/conversion.controller.js';
import {
  getAllDiffs,
  getFileDiff,
  getFileContent,
  getDiffSummary,
} from '../controllers/diff.controller.js';
import { authenticateToken } from '../middleware/auth.js';
import { conversionLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Start new conversion (with rate limiting)
router.post('/', conversionLimiter, startConversion);

// Get all user's conversions
router.get('/', getUserConversions);

// Get specific conversion status
router.get('/:id', getConversionStatus);

// Get conversion report
router.get('/:id/report', getConversionReport);

// Download converted project
router.get('/:id/download', downloadConversion);

// Retry failed conversion
router.post('/:id/retry', conversionLimiter, retryConversion);

// Cancel conversion
router.delete('/:id', cancelConversion);

// Get all diffs for a conversion
router.get('/:id/diffs', getAllDiffs);

// Get diff summary statistics
router.get('/:id/diffs/summary', getDiffSummary);

// Get specific file diff
router.get('/:id/diffs/:fileId', getFileDiff);

// Get file content (original/converted)
router.get('/:id/files/:fileId/content', getFileContent);

export default router;
