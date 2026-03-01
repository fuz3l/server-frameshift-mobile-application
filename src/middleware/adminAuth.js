import UserModel from '../models/user.model.js';
import logger from '../utils/logger.js';

/**
 * Middleware to verify the authenticated user has admin role.
 * Must be used AFTER the authenticateToken middleware.
 */
export const requireAdmin = async (req, res, next) => {
    try {
        const { userId } = req.user;

        const user = await UserModel.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: { message: 'User not found' },
            });
        }

        if (user.role !== 'admin') {
            logger.warn(`Non-admin user ${userId} attempted to access admin route: ${req.originalUrl}`);
            return res.status(403).json({
                success: false,
                error: { message: 'Admin access required' },
            });
        }

        // Attach full user to request for admin controllers
        req.adminUser = user;
        next();
    } catch (error) {
        logger.error('Admin auth check failed:', error);
        return res.status(500).json({
            success: false,
            error: { message: 'Authorization check failed' },
        });
    }
};

export default requireAdmin;
