import { query } from "../config/database.js";

/**
 * Project model for database operations
 */
// Whitelist of columns that can be updated
const VALID_UPDATE_COLUMNS = [
  'name', 'description', 'source_type', 'source_url', 'file_path',
  'size_bytes', 'django_version', 'structure_detected'
];

export class ProjectModel {
  /**
   * Create a new project
   * @param {Object} projectData - Project data
   * @returns {Promise<Object>} Created project
   */
  static async create(projectData) {
    const {
      user_id,
      name,
      description,
      source_type,
      source_url,
      file_path,
      size_bytes,
      django_version,
      structure_detected,
    } = projectData;

    const result = await query(
      `INSERT INTO projects (user_id, name, description, source_type, source_url, file_path, size_bytes, django_version, structure_detected)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        user_id,
        name,
        description,
        source_type,
        source_url,
        file_path,
        size_bytes,
        django_version,
        structure_detected,
      ]
    );

    return result.rows[0];
  }

  /**
   * Find project by ID
   * @param {string} id - Project ID
   * @returns {Promise<Object|null>} Project object or null
   */
  static async findById(id) {
    const result = await query("SELECT * FROM projects WHERE id = $1", [id]);

    return result.rows[0] || null;
  }

  /**
   * Find all projects for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options (limit, offset)
   * @returns {Promise<Array>} List of projects
   */
  static async findByUserId(userId, options = {}) {
    const { limit = 10, offset = 0 } = options;

    const result = await query(
      `SELECT * FROM projects
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return result.rows;
  }

  /**
   * Count total projects for a user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Total count
   */
  static async countByUserId(userId) {
    const result = await query(
      "SELECT COUNT(*) FROM projects WHERE user_id = $1",
      [userId]
    );

    return parseInt(result.rows[0].count);
  }

  /**
   * Update project
   * @param {string} id - Project ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated project
   */
  static async update(id, updateData) {
    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.entries(updateData).forEach(([key, value]) => {
      if (!VALID_UPDATE_COLUMNS.includes(key)) {
        throw new Error(`Invalid update column: ${key}`);
      }
      fields.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    });

    values.push(id);

    const result = await query(
      `UPDATE projects SET ${fields.join(", ")} WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    return result.rows[0];
  }

  /**
   * Delete project
   * @param {string} id - Project ID
   * @returns {Promise<boolean>} Success status
   */
  static async delete(id) {
    const result = await query("DELETE FROM projects WHERE id = $1", [id]);

    return result.rowCount > 0;
  }

  /**
   * Find project by ID and user ID (for authorization)
   * @param {string} id - Project ID
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Project object or null
   */
  static async findByIdAndUserId(id, userId) {
    const result = await query(
      "SELECT * FROM projects WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    return result.rows[0] || null;
  }

  /**
   * Get projects with pagination
   * @param {string} userId - User ID
   * @param {number} page - Page number (1-indexed)
   * @param {number} pageSize - Items per page
   * @returns {Promise<Object>} Paginated results
   */
  static async getPaginated(userId, page = 1, pageSize = 10) {
    const offset = (page - 1) * pageSize;

    const [projects, total] = await Promise.all([
      this.findByUserId(userId, { limit: pageSize, offset }),
      this.countByUserId(userId),
    ]);

    return {
      projects,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
}

export default ProjectModel;
