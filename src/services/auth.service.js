import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import UserModel from '../models/user.model.js';
import VerificationTokenModel from '../models/verificationToken.model.js';
import emailService from './email.service.js';
import logger from '../utils/logger.js';

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required. Set it in your .env file.');
}

/**
 * Authentication service
 */
export class AuthService {
  /**
   * Hash password
   * @param {string} password - Plain text password
   * @returns {Promise<string>} Hashed password
   */
  static async hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Compare password with hash
   * @param {string} password - Plain text password
   * @param {string} hash - Hashed password
   * @returns {Promise<boolean>} Match result
   */
  static async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate JWT token
   * @param {Object} payload - Token payload
   * @returns {string} JWT token
   */
  static generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token
   * @returns {Object} Decoded token
   */
  static verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Register new user with email/password
   * @param {Object} userData - User registration data
   * @returns {Promise<Object>} User and token
   */
  static async register(userData) {
    const { email, password, full_name } = userData;

    // Check if user already exists
    const existingUser = await UserModel.findByEmail(email);
    if (existingUser) {
      const error = new Error('User with this email already exists');
      error.statusCode = 400;
      throw error;
    }

    // Hash password
    const password_hash = await this.hashPassword(password);

    // Create user with email auth provider
    const user = await UserModel.create({
      email,
      password_hash,
      full_name,
      auth_provider: 'email'
    });

    // Generate token
    const token = this.generateToken({
      userId: user.id,
      email: user.email,
    });

    logger.info(`New user registered: ${email}`);

    return {
      user,
      token,
    };
  }

  /**
   * Login user with email/password
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} User and token
   */
  static async login(email, password) {
    // Find user
    const user = await UserModel.findByEmail(email);
    if (!user) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    // Check if user has password (not OAuth-only user)
    if (!user.password_hash) {
      const error = new Error('Please login using GitHub OAuth');
      error.statusCode = 401;
      throw error;
    }

    // Verify password
    const isPasswordValid = await this.comparePassword(password, user.password_hash);
    if (!isPasswordValid) {
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      throw error;
    }

    // Update last login
    await UserModel.updateLastLogin(user.id);

    // Generate token
    const token = this.generateToken({
      userId: user.id,
      email: user.email,
    });

    // Remove password_hash from response
    delete user.password_hash;

    logger.info(`User logged in: ${email}`);

    return {
      user,
      token,
    };
  }

  /**
   * Login or create user with GitHub OAuth
   * @param {Object} githubProfile - GitHub profile data
   * @returns {Promise<Object>} User and token
   */
  static async githubAuth(githubProfile) {
    const { id: github_id, username: github_username, email, name, avatar_url, accessToken } = githubProfile;

    // Check if user exists
    let user = await UserModel.findByGithubId(github_id);

    if (user) {
      // Update GitHub access token
      user = await UserModel.update(user.id, {
        github_access_token: accessToken,
        avatar_url,
      });
      await UserModel.updateLastLogin(user.id);
    } else {
      // Create new user with GitHub auth provider
      user = await UserModel.create({
        email: email || `${github_username}@github.com`,
        full_name: name || github_username,
        github_id,
        github_username,
        github_access_token: accessToken,
        avatar_url,
        email_verified: true, // GitHub emails are verified
        auth_provider: 'github'
      });
    }

    // Generate token
    const token = this.generateToken({
      userId: user.id,
      email: user.email,
    });

    logger.info(`GitHub OAuth login: ${github_username}`);

    return {
      user,
      token,
    };
  }

  /**
   * Register with email verification
   * @param {Object} userData - User registration data
   * @returns {Promise<Object>} User and token
   */
  static async registerWithVerification(userData) {
    const { email, password, full_name } = userData;

    // Check if user already exists
    const existingUser = await UserModel.findByEmail(email);
    if (existingUser) {
      const error = new Error('User with this email already exists');
      error.statusCode = 400;
      throw error;
    }

    // Hash password
    const password_hash = await this.hashPassword(password);

    // Create user (email_verified = false by default)
    const user = await UserModel.create({
      email,
      password_hash,
      full_name,
    });

    // Generate verification token (24 hours)
    const verificationToken = await VerificationTokenModel.create(
      user.id,
      'email_verification',
      60 * 24 // 24 hours
    );

    // Send welcome + verification email
    await emailService.sendWelcomeEmail(user, verificationToken.token);

    // Generate JWT token
    const token = this.generateToken({
      userId: user.id,
      email: user.email,
    });

    logger.info(`New user registered with verification: ${email}`);

    return {
      user,
      token,
    };
  }

  /**
   * Verify email with token
   * @param {string} token - Verification token
   * @returns {Promise<Object>} User
   */
  static async verifyEmail(token) {
    const verificationToken = await VerificationTokenModel.findByToken(
      token,
      'email_verification'
    );

    if (!verificationToken) {
      const error = new Error('Invalid or expired verification token');
      error.statusCode = 400;
      throw error;
    }

    // Mark email as verified
    const user = await UserModel.update(verificationToken.user_id, {
      email_verified: true,
    });

    // Mark token as used
    await VerificationTokenModel.markAsUsed(verificationToken.id);

    logger.info(`Email verified for user: ${user.email}`);

    return user;
  }

  /**
   * Resend verification email
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async resendVerification(userId) {
    const user = await UserModel.findById(userId);

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    if (user.email_verified) {
      const error = new Error('Email already verified');
      error.statusCode = 400;
      throw error;
    }

    // Delete old verification tokens
    await VerificationTokenModel.deleteAllForUser(userId, 'email_verification');

    // Generate new token (24 hours)
    const verificationToken = await VerificationTokenModel.create(
      userId,
      'email_verification',
      60 * 24
    );

    // Send verification email
    await emailService.sendVerificationEmail(user, verificationToken.token);

    logger.info(`Verification email resent to: ${user.email}`);

    return true;
  }

  /**
   * Request password reset
   * @param {string} email - User email
   * @returns {Promise<boolean>} Success status
   */
  static async requestPasswordReset(email) {
    const user = await UserModel.findByEmail(email);

    if (!user) {
      // Don't reveal if email exists (security best practice)
      logger.info(`Password reset requested for non-existent email: ${email}`);
      return true;
    }

    // Check if user has password (not OAuth-only)
    if (!user.password_hash) {
      logger.info(`Password reset requested for OAuth-only user: ${email}`);
      return true; // Still return success to not reveal account type
    }

    // Delete old reset tokens
    await VerificationTokenModel.deleteAllForUser(user.id, 'password_reset');

    // Generate reset token (15 minutes)
    const resetToken = await VerificationTokenModel.create(
      user.id,
      'password_reset',
      15
    );

    // Send reset email
    await emailService.sendPasswordResetEmail(user, resetToken.token);

    logger.info(`Password reset email sent to: ${email}`);

    return true;
  }

  /**
   * Reset password with token
   * @param {string} token - Reset token
   * @param {string} newPassword - New password
   * @returns {Promise<Object>} User
   */
  static async resetPassword(token, newPassword) {
    const resetToken = await VerificationTokenModel.findByToken(
      token,
      'password_reset'
    );

    if (!resetToken) {
      const error = new Error('Invalid or expired reset token');
      error.statusCode = 400;
      throw error;
    }

    // Hash new password
    const password_hash = await this.hashPassword(newPassword);

    // Update password
    const user = await UserModel.update(resetToken.user_id, {
      password_hash,
    });

    // Mark token as used
    await VerificationTokenModel.markAsUsed(resetToken.id);

    // Delete all other reset tokens for this user
    await VerificationTokenModel.deleteAllForUser(user.id, 'password_reset');

    logger.info(`Password reset successful for user: ${user.email}`);

    return user;
  }

  /**
   * Change password (when logged in)
   * @param {string} userId - User ID
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<Object>} User
   */
  static async changePassword(userId, currentPassword, newPassword) {
    const user = await UserModel.findById(userId);

    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    // Check if user has password (not OAuth-only)
    if (!user.password_hash) {
      const error = new Error('Cannot change password for OAuth-only accounts');
      error.statusCode = 400;
      throw error;
    }

    // Verify current password
    const isPasswordValid = await this.comparePassword(currentPassword, user.password_hash);
    if (!isPasswordValid) {
      const error = new Error('Current password is incorrect');
      error.statusCode = 401;
      throw error;
    }

    // Hash new password
    const password_hash = await this.hashPassword(newPassword);

    // Update password
    const updatedUser = await UserModel.update(userId, {
      password_hash,
    });

    logger.info(`Password changed for user: ${user.email}`);

    return updatedUser;
  }
}

export default AuthService;
