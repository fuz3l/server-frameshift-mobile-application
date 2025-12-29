import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import logger from './utils/logger.js';
import errorHandler from './middleware/errorHandler.js';
import securityHeaders from './middleware/securityHeaders.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import { setupWebSocket } from './websocket/wsServer.js';

// Load environment variables
dotenv.config();

// Create Express app and HTTP server
const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true,
}));
app.use(securityHeaders);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use(generalLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'FrameShift API is running',
    timestamp: new Date().toISOString(),
  });
});

// Import routes
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import projectRoutes from './routes/project.routes.js';
import githubRoutes from './routes/github.routes.js';
import conversionRoutes from './routes/conversion.routes.js';

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/conversions', conversionRoutes);

// Setup WebSocket server
setupWebSocket(wss);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Route not found',
    },
  });
});

// Global error handler
app.use(errorHandler);

// Start server
server.listen(PORT, () => {
  logger.info(`🚀 FrameShift server is running on port ${PORT}`);
  logger.info(`📡 WebSocket server is running on ws://localhost:${PORT}/ws`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  try {
    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Cancel all active conversion processes
    const ConversionService = (await import('./services/conversion.service.js')).default;
    await ConversionService.cancelAllConversions();

    // Stop WebSocket periodic cleanup
    const { stopPeriodicCleanup } = await import('./services/websocket.service.js');
    stopPeriodicCleanup();

    // Close WebSocket server
    wss.close(() => {
      logger.info('WebSocket server closed');
    });

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

export default app;
