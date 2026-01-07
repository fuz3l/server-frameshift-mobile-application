import { diffLines, structuredPatch } from 'diff';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';

/**
 * DiffService - Generates diffs between original and converted files
 *
 * Features:
 * - Unified diff format (standard diff output)
 * - Structured diff format (for frontend rendering)
 * - Statistics (additions, deletions, total changes)
 * - Supports both file paths and string content
 */
class DiffService {
  /**
   * Generate diff between two files
   * @param {string} originalPath - Path to original file
   * @param {string} convertedPath - Path to converted file
   * @param {Object} metadata - File metadata (name, category, etc.)
   * @returns {Promise<Object>} Diff data with stats and hunks
   */
  async generateFileDiff(originalPath, convertedPath, metadata = {}) {
    try {
      // Read file contents
      const originalContent = await fs.readFile(originalPath, 'utf-8');
      const convertedContent = await fs.readFile(convertedPath, 'utf-8');

      return this.generateDiffFromContent(
        originalContent,
        convertedContent,
        metadata.originalPath || path.basename(originalPath),
        metadata.convertedPath || path.basename(convertedPath),
        metadata
      );
    } catch (error) {
      logger.error(`Error generating file diff: ${error.message}`);
      throw new Error(`Failed to generate diff: ${error.message}`);
    }
  }

  /**
   * Generate diff from string content
   * @param {string} originalContent - Original file content
   * @param {string} convertedContent - Converted file content
   * @param {string} originalFileName - Original file name
   * @param {string} convertedFileName - Converted file name
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Diff data with stats and hunks
   */
  generateDiffFromContent(originalContent, convertedContent, originalFileName, convertedFileName, metadata = {}) {
    try {
      // Generate structured patch
      const patch = structuredPatch(
        originalFileName,
        convertedFileName,
        originalContent,
        convertedContent,
        '', // oldHeader
        ''  // newHeader
      );

      // Generate line-by-line diff for detailed view
      const lineDiff = diffLines(originalContent, convertedContent);

      // Calculate statistics
      const stats = this.calculateStats(lineDiff);

      // Convert to frontend-friendly format
      const hunks = this.convertHunksToFrontendFormat(patch.hunks);

      return {
        file: {
          originalPath: originalFileName,
          convertedPath: convertedFileName,
          category: metadata.category || 'unknown',
          confidence: metadata.confidence || null,
        },
        diff: {
          unified: this.generateUnifiedDiff(patch),
          hunks: hunks,
        },
        stats: stats,
        content: {
          original: originalContent,
          converted: convertedContent,
        },
      };
    } catch (error) {
      logger.error(`Error generating diff from content: ${error.message}`);
      throw new Error(`Failed to generate diff: ${error.message}`);
    }
  }

  /**
   * Convert hunks to frontend-friendly format
   * @param {Array} hunks - Structured patch hunks
   * @returns {Array} Frontend-formatted hunks
   */
  convertHunksToFrontendFormat(hunks) {
    return hunks.map((hunk) => {
      const lines = hunk.lines.map((line) => {
        const firstChar = line[0];
        let type = 'normal';
        let content = line.substring(1);

        if (firstChar === '+') {
          type = 'add';
        } else if (firstChar === '-') {
          type = 'delete';
        }

        return { type, content };
      });

      return {
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: lines,
      };
    });
  }

  /**
   * Generate unified diff string
   * @param {Object} patch - Structured patch
   * @returns {string} Unified diff string
   */
  generateUnifiedDiff(patch) {
    let unified = `--- ${patch.oldFileName}\n`;
    unified += `+++ ${patch.newFileName}\n`;

    patch.hunks.forEach((hunk) => {
      unified += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
      unified += hunk.lines.join('\n') + '\n';
    });

    return unified;
  }

  /**
   * Calculate diff statistics
   * @param {Array} lineDiff - Line-by-line diff
   * @returns {Object} Statistics object
   */
  calculateStats(lineDiff) {
    let additions = 0;
    let deletions = 0;

    lineDiff.forEach((part) => {
      const lineCount = part.count || 0;

      if (part.added) {
        additions += lineCount;
      } else if (part.removed) {
        deletions += lineCount;
      }
    });

    return {
      additions,
      deletions,
      total: additions + deletions,
    };
  }

  /**
   * Generate diffs for all files in a conversion
   * @param {string} originalDir - Original project directory
   * @param {string} convertedDir - Converted project directory
   * @param {Array} fileMapping - Array of {original, converted, category, confidence}
   * @returns {Promise<Array>} Array of file diffs
   */
  async generateProjectDiffs(originalDir, convertedDir, fileMapping) {
    try {
      const diffs = [];

      for (const mapping of fileMapping) {
        const originalPath = path.join(originalDir, mapping.original);
        const convertedPath = path.join(convertedDir, mapping.converted);

        try {
          const diff = await this.generateFileDiff(originalPath, convertedPath, {
            originalPath: mapping.original,
            convertedPath: mapping.converted,
            category: mapping.category,
            confidence: mapping.confidence,
          });

          diffs.push({
            id: `file_${diffs.length + 1}`,
            ...diff,
            status: mapping.status || 'modified',
          });
        } catch (error) {
          logger.warn(`Skipping file diff for ${mapping.original}: ${error.message}`);
        }
      }

      return diffs;
    } catch (error) {
      logger.error(`Error generating project diffs: ${error.message}`);
      throw new Error(`Failed to generate project diffs: ${error.message}`);
    }
  }

  /**
   * Generate summary statistics for all diffs
   * @param {Array} diffs - Array of file diffs
   * @returns {Object} Summary statistics
   */
  generateSummary(diffs) {
    const summary = {
      totalFiles: diffs.length,
      modified: 0,
      added: 0,
      deleted: 0,
      totalAdditions: 0,
      totalDeletions: 0,
      totalChanges: 0,
    };

    diffs.forEach((diff) => {
      if (diff.status === 'modified') summary.modified++;
      if (diff.status === 'added') summary.added++;
      if (diff.status === 'deleted') summary.deleted++;

      summary.totalAdditions += diff.stats.additions;
      summary.totalDeletions += diff.stats.deletions;
      summary.totalChanges += diff.stats.total;
    });

    return summary;
  }

  /**
   * Categorize files by type
   * @param {Array} diffs - Array of file diffs
   * @returns {Object} Files grouped by category
   */
  categorizeFiles(diffs) {
    const categories = {
      models: [],
      views: [],
      urls: [],
      templates: [],
      config: [],
      tests: [],
      other: [],
    };

    diffs.forEach((diff) => {
      const category = diff.file.category || 'other';
      if (categories[category]) {
        categories[category].push(diff);
      } else {
        categories.other.push(diff);
      }
    });

    return categories;
  }
}

export default new DiffService();
