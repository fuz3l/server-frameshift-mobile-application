import logger from '../utils/logger.js';

// Store WebSocket clients: userId -> WebSocket connection
const clients = new Map();

// Store message queues for disconnected clients: userId -> Array of messages
// Messages are kept for 5 minutes, max 50 messages per user
const messageQueues = new Map();
const MAX_QUEUE_SIZE = 50;
const QUEUE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000; // Run cleanup every 2 minutes

/**
 * Clean up old messages from queue
 * @param {string} userId - User ID
 */
const cleanupOldMessages = (userId) => {
  const queue = messageQueues.get(userId);
  if (!queue) return;

  const now = Date.now();
  const validMessages = queue.filter(item => (now - item.timestamp) < QUEUE_EXPIRY_MS);

  if (validMessages.length === 0) {
    messageQueues.delete(userId);
  } else {
    messageQueues.set(userId, validMessages);
  }
};

/**
 * Clean up all expired message queues
 * Runs periodically to prevent memory leaks
 */
const cleanupAllExpiredQueues = () => {
  const now = Date.now();
  const userIds = Array.from(messageQueues.keys());
  let removedCount = 0;

  for (const userId of userIds) {
    const queue = messageQueues.get(userId);
    if (!queue || queue.length === 0) {
      messageQueues.delete(userId);
      removedCount++;
      continue;
    }

    // Check if oldest message has expired
    const oldestMessage = queue[0];
    if ((now - oldestMessage.timestamp) > QUEUE_EXPIRY_MS) {
      // Clean up expired messages for this user
      cleanupOldMessages(userId);

      // If queue is now empty, it was already deleted
      if (!messageQueues.has(userId)) {
        removedCount++;
      }
    }
  }

  if (removedCount > 0) {
    logger.info(`Cleaned up ${removedCount} expired message queues`);
  }

  // Log queue stats
  const stats = getQueueStats();
  logger.debug(`WebSocket queue stats: ${stats.totalQueues} queues, ${stats.totalMessages} messages, ${stats.oldestQueueAge}ms oldest`);
};

/**
 * Start periodic cleanup of expired message queues
 * @returns {NodeJS.Timeout} Cleanup interval
 */
const startPeriodicCleanup = () => {
  logger.info(`Starting WebSocket message queue cleanup (every ${CLEANUP_INTERVAL_MS / 1000}s)`);
  return setInterval(cleanupAllExpiredQueues, CLEANUP_INTERVAL_MS);
};

/**
 * Get queue statistics for monitoring
 * @returns {Object} Queue stats
 */
const getQueueStats = () => {
  const now = Date.now();
  const queues = Array.from(messageQueues.entries());

  let totalMessages = 0;
  let oldestAge = 0;

  for (const [userId, queue] of queues) {
    totalMessages += queue.length;

    if (queue.length > 0) {
      const age = now - queue[0].timestamp;
      if (age > oldestAge) {
        oldestAge = age;
      }
    }
  }

  return {
    totalQueues: messageQueues.size,
    totalMessages,
    oldestQueueAge: oldestAge
  };
};

// Start periodic cleanup automatically
const cleanupInterval = startPeriodicCleanup();

/**
 * Add message to queue for disconnected client
 * @param {string} userId - User ID
 * @param {Object} message - Message to queue
 */
const queueMessage = (userId, message) => {
  if (!messageQueues.has(userId)) {
    messageQueues.set(userId, []);
  }

  const queue = messageQueues.get(userId);
  queue.push({
    message,
    timestamp: Date.now()
  });

  // Keep only last MAX_QUEUE_SIZE messages
  if (queue.length > MAX_QUEUE_SIZE) {
    queue.shift();
  }

  logger.debug(`Message queued for user ${userId}: ${message.type} (queue size: ${queue.length})`);
};

/**
 * Send all queued messages to user
 * @param {string} userId - User ID
 * @param {WebSocket} ws - WebSocket connection
 */
const sendQueuedMessages = (userId, ws) => {
  cleanupOldMessages(userId);
  const queue = messageQueues.get(userId);

  if (!queue || queue.length === 0) return;

  logger.info(`Sending ${queue.length} queued messages to user ${userId}`);

  queue.forEach(item => {
    try {
      ws.send(JSON.stringify(item.message));
    } catch (error) {
      logger.error(`Failed to send queued message to user ${userId}:`, error);
    }
  });

  // Clear the queue after sending
  messageQueues.delete(userId);
};

/**
 * Register WebSocket client
 * @param {string} userId - User ID
 * @param {WebSocket} ws - WebSocket connection
 */
export const registerClient = (userId, ws) => {
  clients.set(userId, ws);
  logger.info(`WebSocket client registered: ${userId}`);

  // Send any queued messages from when client was disconnected
  sendQueuedMessages(userId, ws);
};

/**
 * Unregister WebSocket client
 * @param {string} userId - User ID
 */
export const unregisterClient = (userId) => {
  clients.delete(userId);
  logger.info(`WebSocket client unregistered: ${userId}`);
};

/**
 * Broadcast message to specific user
 * @param {string} userId - User ID
 * @param {Object} message - Message to send
 */
export const broadcastToUser = (userId, message) => {
  const client = clients.get(userId);

  if (client && client.readyState === 1) { // WebSocket.OPEN
    try {
      client.send(JSON.stringify(message));
      logger.debug(`Message sent to user ${userId}: ${message.type}`);
    } catch (error) {
      logger.error(`Failed to send message to user ${userId}:`, error);
      // Queue message if send fails
      queueMessage(userId, message);
    }
  } else {
    // Client not connected - queue the message for later delivery
    // Only log at debug level since this is expected behavior
    logger.debug(`Client not connected, queueing message for user ${userId}: ${message.type}`);
    queueMessage(userId, message);
  }
};

/**
 * Broadcast conversion progress to user
 * @param {string} jobId - Conversion job ID
 * @param {Object} progressData - Progress data from Python
 */
export const broadcastProgress = async (jobId, progressData) => {
  try {
    // Get conversion job to find user ID
    const ConversionJobModel = (await import('../models/conversionJob.model.js')).default;
    const job = await ConversionJobModel.findById(jobId);

    if (!job) {
      logger.warn(`Job not found for progress broadcast: ${jobId}`);
      return;
    }

    const userId = job.user_id;

    const message = {
      type: 'conversion:progress',
      jobId,
      progress: progressData.progress,
      step: progressData.step,
      message: progressData.message,
      timestamp: Date.now()
    };

    broadcastToUser(userId, message);
  } catch (error) {
    logger.error(`Failed to broadcast progress for job ${jobId}:`, error);
  }
};

/**
 * Broadcast conversion completion to user
 * @param {string} userId - User ID
 * @param {string} jobId - Conversion job ID
 * @param {Object} result - Conversion result
 */
export const broadcastConversionComplete = (userId, jobId, result) => {
  const message = {
    type: 'conversion:completed',
    jobId,
    result,
    timestamp: Date.now()
  };

  broadcastToUser(userId, message);
};

/**
 * Broadcast conversion failure to user
 * @param {string} userId - User ID
 * @param {string} jobId - Conversion job ID
 * @param {string} error - Error message
 */
export const broadcastConversionFailed = (userId, jobId, error) => {
  const message = {
    type: 'conversion:failed',
    jobId,
    error,
    timestamp: Date.now()
  };

  broadcastToUser(userId, message);
};

/**
 * Broadcast conversion cancellation to user
 * @param {string} userId - User ID
 * @param {string} jobId - Conversion job ID
 */
export const broadcastConversionCancelled = (userId, jobId) => {
  const message = {
    type: 'conversion:cancelled',
    jobId,
    message: 'Conversion cancelled by user',
    timestamp: Date.now()
  };

  broadcastToUser(userId, message);
};

/**
 * Get connected clients count
 * @returns {number} Number of connected clients
 */
export const getConnectedClientsCount = () => {
  return clients.size;
};

/**
 * Stop periodic cleanup (for graceful shutdown)
 */
export const stopPeriodicCleanup = () => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    logger.info('WebSocket periodic cleanup stopped');
  }
};

/**
 * Get WebSocket service statistics
 * @returns {Object} Service statistics
 */
export const getServiceStats = () => {
  return {
    connectedClients: clients.size,
    ...getQueueStats()
  };
};

export default {
  registerClient,
  unregisterClient,
  broadcastToUser,
  broadcastProgress,
  broadcastConversionComplete,
  broadcastConversionFailed,
  broadcastConversionCancelled,
  getConnectedClientsCount,
  stopPeriodicCleanup,
  getServiceStats
};
