import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import ConversionJobModel from '../models/conversionJob.model.js';
import ReportModel from '../models/report.model.js';
import UserModel from '../models/user.model.js';
import storageService from './storage.service.js';
import emailService from './email.service.js';
import DiffService from './diff.service.js';
import logger from '../utils/logger.js';

/**
 * Map to track active Python conversion processes
 * Key: jobId, Value: ChildProcess
 */
const activeProcesses = new Map();

/**
 * Conversion service - Node-Python bridge
 * Manages Python child processes for Django-to-Flask conversion
 */
export class ConversionService {
  /**
   * Start conversion process
   * @param {string} jobId - Conversion job ID
   * @param {string} projectPath - Path to Django project
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Conversion result
   */
  static async startConversion(jobId, projectPath, userId, useAI = true) {
    logger.info(`Starting conversion job ${jobId} (AI: ${useAI ? 'enabled' : 'disabled'})`);

    try {
      // Create output directory
      const outputPath = await storageService.createConvertedDirectory(userId, jobId);

      // Mark job as started
      await ConversionJobModel.markAsStarted(jobId);

      // Spawn Python process with AI flag
      const result = await this.runPythonConversion(jobId, projectPath, outputPath, useAI);

      // Mark job as completed
      await ConversionJobModel.markAsCompleted(jobId, outputPath);

      // Save report to database
      await this.saveReport(jobId, result.report);

      // Generate diffs for code preview
      try {
        await this.generateDiffs(jobId, projectPath, outputPath, result.report);
      } catch (diffError) {
        logger.error(`Failed to generate diffs for job ${jobId}:`, diffError);
        // Don't fail the conversion if diff generation fails
      }

      // Send success email
      try {
        const user = await UserModel.findById(userId);
        const job = await ConversionJobModel.findById(jobId);
        await emailService.sendConversionCompleteEmail(user, job, result.report);
      } catch (emailError) {
        logger.error(`Failed to send completion email for job ${jobId}:`, emailError);
        // Don't fail the conversion if email fails
      }

      logger.info(`Conversion job ${jobId} completed successfully`);

      return {
        success: true,
        jobId,
        outputPath,
        report: result.report
      };
    } catch (error) {
      logger.error(`Conversion job ${jobId} failed:`, error);

      // Mark job as failed
      await ConversionJobModel.markAsFailed(jobId, error.message);

      // Send failure email
      try {
        const user = await UserModel.findById(userId);
        const job = await ConversionJobModel.findById(jobId);
        await emailService.sendConversionFailedEmail(user, job, error.message);
      } catch (emailError) {
        logger.error(`Failed to send failure email for job ${jobId}:`, emailError);
        // Don't fail further if email fails
      }

      throw error;
    }
  }

  /**
   * Detect Python executable on the system
   * @returns {string} Python executable path
   */
  static detectPython() {
    // If explicitly set in env, use it
    if (process.env.PYTHON_PATH) {
      return process.env.PYTHON_PATH;
    }

    // On Windows, prefer 'python' over 'python3' (python3 is often the MS Store stub)
    if (process.platform === 'win32') {
      return 'python';
    }

    // On Unix-like systems, prefer python3
    return 'python3';
  }

  /**
   * Run Python conversion process
   * @param {string} jobId - Conversion job ID
   * @param {string} projectPath - Input Django project path
   * @param {string} outputPath - Output Flask project path
   * @param {boolean} useAI - Whether to use AI enhancement
   * @returns {Promise<Object>} Conversion result from Python
   */
  static runPythonConversion(jobId, projectPath, outputPath, useAI = true) {
    return new Promise((resolve, reject) => {
      const pythonPath = this.detectPython();
      const scriptPath = path.join(process.cwd(), 'python', 'main.py');

      const args = [
        scriptPath,
        '--job-id', jobId,
        '--project-path', projectPath,
        '--output-path', outputPath,
        '--use-ai', useAI.toString() // Pass AI flag to Python
      ];

      // Add Gemini API key if available
      if (process.env.GEMINI_API_KEY) {
        args.push('--gemini-api-key', process.env.GEMINI_API_KEY);
      }

      logger.info(`Spawning Python process: ${pythonPath} ${args.join(' ')}`);

      const pythonProcess = spawn(pythonPath, args, {
        cwd: process.cwd()
      });

      // Store process in activeProcesses map for cancellation support
      activeProcesses.set(jobId, pythonProcess);
      logger.info(`Stored active process for job ${jobId} (PID: ${pythonProcess.pid})`);

      let result = null;
      let errorOutput = '';
      let isResolved = false;

      // Handle stdout (progress updates and result)
      pythonProcess.stdout.on('data', async (data) => {
        const lines = data.toString().split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const message = JSON.parse(line);

            if (message.type === 'progress') {
              // Update database with progress
              await this.handleProgressUpdate(jobId, message);
            } else if (message.type === 'result') {
              // Store final result
              result = message.data;
              logger.info(`Conversion result received for job ${jobId}`);
            } else if (message.type === 'error') {
              errorOutput = message.error;
              logger.error(`Python error for job ${jobId}: ${message.error}`);
            }
          } catch (parseError) {
            // Not JSON, could be regular log output
            logger.debug(`Python output: ${line}`);
          }
        }
      });

      // Handle stderr
      pythonProcess.stderr.on('data', (data) => {
        const errorText = data.toString();
        errorOutput += errorText;
        logger.error(`Python stderr: ${errorText}`);
      });

      // Handle process exit
      pythonProcess.on('close', (code) => {
        // Remove from active processes
        activeProcesses.delete(jobId);
        logger.info(`Removed process for job ${jobId} from active processes (exit code: ${code})`);

        // Prevent multiple resolve/reject calls
        if (isResolved) return;

        // Give a small delay to ensure all stdout has been processed
        setTimeout(() => {
          if (isResolved) return;
          isResolved = true;

          if (code === 0) {
            if (result) {
              logger.info(`Python process exited successfully for job ${jobId}`);
              resolve(result);
            } else {
              const error = new Error('Python process completed but no result was received');
              logger.error(`Python process failed for job ${jobId}: ${error.message}`);
              reject(error);
            }
          } else {
            const error = new Error(errorOutput || `Python process exited with code ${code}`);
            logger.error(`Python process failed for job ${jobId}: ${error.message}`);
            reject(error);
          }
        }, 100);
      });

      // Handle process error
      pythonProcess.on('error', (error) => {
        if (isResolved) return;
        isResolved = true;
        logger.error(`Failed to spawn Python process for job ${jobId}:`, error);
        reject(new Error(`Failed to start Python conversion: ${error.message}`));
      });
    });
  }

  /**
   * Handle progress update from Python
   * @param {string} jobId - Conversion job ID
   * @param {Object} message - Progress message
   */
  static async handleProgressUpdate(jobId, message) {
    try {
      // Update database
      await ConversionJobModel.updateProgress(
        jobId,
        message.progress,
        message.step
      );

      // Broadcast via WebSocket (imported dynamically to avoid circular dependency)
      const { broadcastProgress } = await import('./websocket.service.js');
      broadcastProgress(jobId, message);

      logger.debug(`Progress updated for job ${jobId}: ${message.progress}% - ${message.step}`);
    } catch (error) {
      logger.error(`Failed to handle progress update for job ${jobId}:`, error);
    }
  }

  /**
   * Save conversion report to database
   * @param {string} jobId - Conversion job ID
   * @param {Object} report - Report data from Python
   * @returns {Promise<Object>} Saved report
   */
  static async saveReport(jobId, report) {
    try {
      const reportData = {
        conversion_job_id: jobId,
        accuracy_score: report.accuracy_score || 0,
        total_files_converted: report.total_files_converted || 0,
        models_converted: report.models_converted || 0,
        views_converted: report.views_converted || 0,
        urls_converted: report.urls_converted || 0,
        forms_converted: report.forms_converted || 0,
        templates_converted: report.templates_converted || 0,
        issues: report.issues || [],
        warnings: report.warnings || [],
        suggestions: report.suggestions || [],
        gemini_verification: report.gemini_verification || null,
        summary: report.summary || ''
      };

      const savedReport = await ReportModel.create(reportData);
      logger.info(`Report saved for job ${jobId}`);

      return savedReport;
    } catch (error) {
      logger.error(`Failed to save report for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Generate diffs for converted files
   * @param {string} jobId - Conversion job ID
   * @param {string} projectPath - Path to original Django project
   * @param {string} outputPath - Path to converted Flask project
   * @param {Object} report - Conversion report
   * @returns {Promise<void>}
   */
  static async generateDiffs(jobId, projectPath, outputPath, report) {
    try {
      logger.info(`Generating diffs for job ${jobId}`);

      const fileDiffs = [];

      // Find actual project directory inside the upload directory
      // The upload path may contain a single project directory (e.g., "Job Portal")
      let projectName;
      try {
        const entries = await fs.readdir(projectPath, { withFileTypes: true });
        const subdirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);

        // Use the first subdirectory as project name, or fall back to the directory name
        projectName = subdirs.length > 0 ? subdirs[0] : path.basename(projectPath);
        logger.info(`Using project name for diffs: ${projectName}`);
      } catch (err) {
        logger.warn(`Error reading project directory ${projectPath}, using basename:`, err.message);
        projectName = path.basename(projectPath);
      }

      const convertedProjectPath = path.join(outputPath, projectName);

      // Recursively find all Python files in converted directory
      const findPythonFiles = async (dir, baseDir) => {
        const files = [];
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
              // Skip common directories
              if (!['venv', 'node_modules', '__pycache__', '.git', 'migrations', 'instance', 'logs'].includes(entry.name)) {
                const subFiles = await findPythonFiles(fullPath, baseDir);
                files.push(...subFiles);
              }
            } else if (entry.isFile() && entry.name.endsWith('.py')) {
              const relativePath = path.relative(baseDir, fullPath);
              files.push(relativePath);
            }
          }
        } catch (err) {
          logger.warn(`Error reading directory ${dir}:`, err.message);
        }

        return files;
      };

      // Find all Python files in the converted project
      const convertedFiles = await findPythonFiles(convertedProjectPath, convertedProjectPath);

      logger.info(`Found ${convertedFiles.length} Python files in converted project`);

      // Original project path includes the project directory
      const originalProjectPath = path.join(projectPath, projectName);

      // Generate diff for each file
      for (const relativeFilePath of convertedFiles) {
        try {
          const convertedFile = path.join(convertedProjectPath, relativeFilePath);
          const originalFile = path.join(originalProjectPath, relativeFilePath);

          // Check if original file exists
          const originalExists = await fs.access(originalFile).then(() => true).catch(() => false);

          if (!originalExists) {
            logger.debug(`Skipping diff for ${relativeFilePath}: original file not found (new file)`);
            continue;
          }

          // Determine category from file path
          const category = relativeFilePath.includes('models') ? 'models' :
                          relativeFilePath.includes('views') ? 'views' :
                          relativeFilePath.includes('urls') || relativeFilePath.includes('routes') ? 'urls' :
                          relativeFilePath.includes('forms') ? 'forms' :
                          'other';

          // Generate diff
          const diffData = await DiffService.generateFileDiff(originalFile, convertedFile, {
            originalPath: relativeFilePath,
            convertedPath: relativeFilePath,
            category: category,
            confidence: null
          });

          // Add unique ID
          diffData.id = `${jobId}-${Buffer.from(relativeFilePath).toString('base64').replace(/=/g, '')}`;

          fileDiffs.push(diffData);
          logger.debug(`Generated diff for ${relativeFilePath}`);
        } catch (fileError) {
          logger.warn(`Failed to generate diff for ${relativeFilePath}:`, fileError.message);
        }
      }

      // Update report with file_diffs
      await ReportModel.updateByConversionId(jobId, {
        file_diffs: fileDiffs
      });

      logger.info(`Generated ${fileDiffs.length} file diffs for job ${jobId}`);
    } catch (error) {
      logger.error(`Error generating diffs for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get conversion status
   * @param {string} jobId - Conversion job ID
   * @returns {Promise<Object>} Job status
   */
  static async getStatus(jobId) {
    const job = await ConversionJobModel.findById(jobId);

    if (!job) {
      throw new Error('Conversion job not found');
    }

    return {
      id: job.id,
      status: job.status,
      progress: job.progress_percentage,
      currentStep: job.current_step,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      error: job.error_message
    };
  }

  /**
   * Cancel conversion job
   * @param {string} jobId - Conversion job ID
   * @returns {Promise<boolean>} Success status
   */
  static async cancelConversion(jobId) {
    logger.info(`Attempting to cancel conversion job ${jobId}`);

    try {
      // Get the active process
      const pythonProcess = activeProcesses.get(jobId);

      if (pythonProcess && !pythonProcess.killed) {
        logger.info(`Found active process for job ${jobId} (PID: ${pythonProcess.pid}), terminating...`);

        // Send SIGTERM for graceful shutdown
        pythonProcess.kill('SIGTERM');

        // Force kill after 5 seconds if still running
        const forceKillTimeout = setTimeout(() => {
          if (!pythonProcess.killed) {
            logger.warn(`Force killing process for job ${jobId} after 5 second timeout`);
            pythonProcess.kill('SIGKILL');
          }
        }, 5000);

        // Wait for process to exit
        await new Promise((resolve) => {
          pythonProcess.once('close', () => {
            clearTimeout(forceKillTimeout);
            resolve();
          });

          // Ensure we don't wait forever
          setTimeout(resolve, 6000);
        });

        logger.info(`Process for job ${jobId} terminated successfully`);
      } else {
        logger.info(`No active process found for job ${jobId}, marking as cancelled in database`);
      }

      // Mark as cancelled in database
      await ConversionJobModel.markAsFailed(jobId, 'Cancelled by user');

      // Remove from active processes if still there
      activeProcesses.delete(jobId);

      // Broadcast cancellation via WebSocket
      try {
        const { broadcastConversionCancelled } = await import('./websocket.service.js');
        const job = await ConversionJobModel.findById(jobId);
        if (job) {
          broadcastConversionCancelled(job.user_id, jobId);
        }
      } catch (wsError) {
        logger.error(`Failed to broadcast cancellation for job ${jobId}:`, wsError);
        // Don't fail the cancellation if WebSocket broadcast fails
      }

      logger.info(`Conversion job ${jobId} cancelled successfully`);
      return true;
    } catch (error) {
      logger.error(`Error cancelling conversion job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get all active conversion processes
   * @returns {Array} Array of job IDs with active processes
   */
  static getActiveProcesses() {
    return Array.from(activeProcesses.keys());
  }

  /**
   * Cancel all active conversions (for graceful shutdown)
   * @returns {Promise<void>}
   */
  static async cancelAllConversions() {
    logger.info(`Cancelling all active conversions (${activeProcesses.size} processes)`);

    const cancellationPromises = [];

    for (const jobId of activeProcesses.keys()) {
      cancellationPromises.push(
        this.cancelConversion(jobId).catch((error) => {
          logger.error(`Failed to cancel job ${jobId} during shutdown:`, error);
        })
      );
    }

    await Promise.all(cancellationPromises);
    logger.info('All active conversions cancelled');
  }
}

export default ConversionService;
