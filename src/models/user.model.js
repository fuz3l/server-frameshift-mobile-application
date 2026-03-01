import { query } from '../config/database.js';

/**
 * User model for database operations
 */
// Whitelist of columns that can be updated
const VALID_UPDATE_COLUMNS = [
  'email', 'password_hash', 'full_name', 'github_id', 'github_username',
  'github_access_token', 'avatar_url', 'email_verified', 'auth_provider',
  'role', 'last_login'
];

export class UserModel {
  /**
   * Create a new user
   * @param {Object} userData - User data
   * @returns {Promise<Object>} Created user
   */
  static async create(userData) {
    const { email, password_hash, full_name, github_id, github_username, github_access_token, avatar_url, auth_provider = 'email' } = userData;

    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, github_id, github_username, github_access_token, avatar_url, auth_provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, email, full_name, github_id, github_username, avatar_url, email_verified, auth_provider, created_at`,
      [email, password_hash, full_name, github_id, github_username, github_access_token, avatar_url, auth_provider]
    );

    return result.rows[0];
  }

  /**
   * Find user by email
   * @param {string} email - User email
   * @returns {Promise<Object|null>} User object or null
   */
  static async findByEmail(email) {
    const result = await query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    return result.rows[0] || null;
  }

  /**
   * Find user by ID
   * @param {string} id - User ID
   * @returns {Promise<Object|null>} User object or null
   */
  static async findById(id) {
    const result = await query(
      'SELECT id, email, full_name, role, github_id, github_username, github_access_token, avatar_url, email_verified, auth_provider, created_at, updated_at, last_login FROM users WHERE id = $1',
      [id]
    );

    return result.rows[0] || null;
  }

  /**
   * Find user by GitHub ID
   * @param {string} githubId - GitHub user ID
   * @returns {Promise<Object|null>} User object or null
   */
  static async findByGithubId(githubId) {
    const result = await query(
      'SELECT * FROM users WHERE github_id = $1',
      [githubId]
    );

    return result.rows[0] || null;
  }

  /**
   * Update user
   * @param {string} id - User ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated user
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
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, email, full_name, github_id, github_username, avatar_url, email_verified, auth_provider, created_at, updated_at`,
      values
    );

    return result.rows[0];
  }

  /**
   * Update last login timestamp
   * @param {string} id - User ID
   * @returns {Promise<void>}
   */
  static async updateLastLogin(id) {
    await query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );
  }

  /**
   * Link GitHub account to existing user
   * @param {string} userId - User ID
   * @param {Object} githubProfile - GitHub profile data
   * @returns {Promise<Object>} Updated user
   */
  static async linkGithubAccount(userId, githubProfile) {
    const { id: githubId, username, accessToken, avatarUrl } = githubProfile;

    // Check if GitHub ID is already linked to another account
    const existingGithubUser = await this.findByGithubId(githubId);
    if (existingGithubUser && existingGithubUser.id !== userId) {
      const error = new Error('GitHub account already linked to another user');
      error.statusCode = 400;
      throw error;
    }

    // Update user with GitHub info
    const result = await query(
      `UPDATE users
       SET github_id = $1,
           github_username = $2,
           github_access_token = $3,
           avatar_url = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, email, full_name, github_id, github_username, avatar_url, email_verified, created_at, updated_at`,
      [githubId, username, accessToken, avatarUrl, userId]
    );

    return result.rows[0];
  }

  /**
   * Unlink GitHub account from user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Updated user
   */
  static async unlinkGithubAccount(userId) {
    const result = await query(
      `UPDATE users
       SET github_id = NULL,
           github_username = NULL,
           github_access_token = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, full_name, github_id, github_username, avatar_url, email_verified, created_at, updated_at`,
      [userId]
    );

    return result.rows[0];
  }

  /**
   * Check if user has GitHub linked
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if GitHub is linked
   */
  static async hasGithubLinked(userId) {
    const result = await query(
      'SELECT github_id FROM users WHERE id = $1',
      [userId]
    );

    return result.rows[0]?.github_id !== null && result.rows[0]?.github_id !== undefined;
  }

  /**
   * Delete user
   * @param {string} id - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async delete(id) {
    const result = await query(
      'DELETE FROM users WHERE id = $1',
      [id]
    );

    return result.rowCount > 0;
  }
}

export default UserModel;
