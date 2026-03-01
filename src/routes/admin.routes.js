import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import {
    listUsers,
    getUserById,
    updateUser,
    deleteUser,
    listProjects,
    deleteProject,
    listConversions,
    getSystemStats,
    listMigrationRules,
} from '../controllers/admin.controller.js';

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticateToken);
router.use(requireAdmin);

// System stats
router.get('/stats', getSystemStats);

// User management
router.get('/users', listUsers);
router.get('/users/:id', getUserById);
router.patch('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// Project management
router.get('/projects', listProjects);
router.delete('/projects/:id', deleteProject);

// Conversion management
router.get('/conversions', listConversions);

// Migration rules (master data)
router.get('/migration-rules', listMigrationRules);

export default router;
