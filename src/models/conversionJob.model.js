import { query } from '../config/database.js';

/**
 * ConversionJob model for database operations
 */
export class ConversionJobModel {
  /**
   * Create a new conversion job
   * @param {Object} jobData - Conversion job data
   * @returns {Promise<Object>} Created conversion job
   */
  static async create(jobData) {
    const {
      project_id,
      user_id,
      status = 'pending',
      progress_percentage = 0,
      current_step = null,
      converted_file_path = null,
      error_message = null,
      use_ai = true,
      ai_enhancements = []
    } = jobData;

    const result = await query(
      `INSERT INTO conversion_jobs (project_id, user_id, status, progress_percentage, current_step, converted_file_path, error_message, use_ai, ai_enhancements)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [project_id, user_id, status, progress_percentage, current_step, converted_file_path, error_message, use_ai, ai_enhancements]
    );

    return result.rows[0];
  }

  /**
   * Find conversion job by ID
   * @param {string} id - Conversion job ID
   * @returns {Promise<Object|null>} Conversion job or null
   */
  static async findById(id) {
    const result = await query(
      'SELECT * FROM conversion_jobs WHERE id = $1',
      [id]
    );

    return result.rows[0] || null;
  }

  /**
   * Find conversion job by ID and user ID (for authorization)
   * @param {string} id - Conversion job ID
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Conversion job or null
   */
  static async findByIdAndUserId(id, userId) {
    const result = await query(
      'SELECT * FROM conversion_jobs WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Find all conversion jobs for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of conversion jobs with project details
   */
  static async findByUserId(userId, options = {}) {
    const { limit = 10, offset = 0, status = null } = options;

    let queryText = `
      SELECT
        cj.*,
        p.name as project_name,
        p.source_type,
        p.source_url
      FROM conversion_jobs cj
      LEFT JOIN projects p ON cj.project_id = p.id
      WHERE cj.user_id = $1
    `;
    const params = [userId];

    if (status) {
      queryText += ' AND cj.status = $2';
      params.push(status);
    }

    queryText += ' ORDER BY cj.created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await query(queryText, params);
    return result.rows;
  }

  /**
   * Update conversion job
   * @param {string} id - Conversion job ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated conversion job
   */
  static async update(id, updateData) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.entries(updateData).forEach(([key, value]) => {
      fields.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    });

    values.push(id);

    const result = await query(
      `UPDATE conversion_jobs SET ${fields.join(', ')} WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    return result.rows[0];
  }

  /**
   * Update progress
   * @param {string} id - Conversion job ID
   * @param {number} percentage - Progress percentage (0-100)
   * @param {string} step - Current step
   * @returns {Promise<Object>} Updated conversion job
   */
  static async updateProgress(id, percentage, step) {
    const result = await query(
      `UPDATE conversion_jobs
       SET progress_percentage = $1, current_step = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [percentage, step, id]
    );

    return result.rows[0];
  }

  /**
   * Mark job as started
   * @param {string} id - Conversion job ID
   * @returns {Promise<Object>} Updated conversion job
   */
  static async markAsStarted(id) {
    const result = await query(
      `UPDATE conversion_jobs
       SET status = 'analyzing', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    return result.rows[0];
  }

  /**
   * Mark job as completed
   * @param {string} id - Conversion job ID
   * @param {string} convertedFilePath - Path to converted project
   * @returns {Promise<Object>} Updated conversion job
   */
  static async markAsCompleted(id, convertedFilePath) {
    const result = await query(
      `UPDATE conversion_jobs
       SET status = 'completed',
           converted_file_path = $1,
           progress_percentage = 100,
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [convertedFilePath, id]
    );

    return result.rows[0];
  }

  /**
   * Mark job as failed
   * @param {string} id - Conversion job ID
   * @param {string} errorMessage - Error message
   * @returns {Promise<Object>} Updated conversion job
   */
  static async markAsFailed(id, errorMessage) {
    const result = await query(
      `UPDATE conversion_jobs
       SET status = 'failed',
           error_message = $1,
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [errorMessage, id]
    );

    return result.rows[0];
  }

  /**
   * Delete conversion job
   * @param {string} id - Conversion job ID
   * @returns {Promise<boolean>} Success status
   */
  static async delete(id) {
    const result = await query(
      'DELETE FROM conversion_jobs WHERE id = $1',
      [id]
    );

    return result.rowCount > 0;
  }

  /**
   * Count conversion jobs by user and status
   * @param {string} userId - User ID
   * @param {string} status - Job status (optional)
   * @returns {Promise<number>} Count
   */
  static async countByUserId(userId, status = null) {
    let queryText = 'SELECT COUNT(*) FROM conversion_jobs WHERE user_id = $1';
    const params = [userId];

    if (status) {
      queryText += ' AND status = $2';
      params.push(status);
    }

    const result = await query(queryText, params);
    return parseInt(result.rows[0].count);
  }
}

export default ConversionJobModel;
