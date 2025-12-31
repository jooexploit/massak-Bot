/**
 * 🔌 CENTRALIZED SOCKET MANAGER
 *
 * This module provides a single source of truth for the WhatsApp socket.
 * All services MUST use getSocket() at EXECUTION TIME (not closure capture).
 *
 * CRITICAL: This fixes the zombie connection issue caused by stale socket references
 * in background jobs (cron, setTimeout, setInterval).
 *
 * @module socketManager
 */

// Singleton socket reference
let _socket = null;

// Connection status
let _connectionStatus = "disconnected";

// Send functions (for services that need them)
let _sendMessage = null;
let _sendImage = null;

// Registry of all scheduled jobs for cleanup
const _scheduledJobs = {
  timeouts: new Map(), // id -> timeoutId
  intervals: new Map(), // id -> intervalId
  cronJobs: new Map(), // id -> cronTask
};

// Listeners for connection events
const _connectionListeners = new Set();

/**
 * Set the current socket instance
 * Called by bot.js when creating new connection
 * @param {Object} socket - Baileys socket instance
 */
function setSocket(socket) {
  _socket = socket;
  console.log(`🔌 [SocketManager] Socket ${socket ? "SET" : "CLEARED"}`);
}

/**
 * Get the current LIVE socket instance
 * ALWAYS use this at execution time, never capture in closures
 * @returns {Object|null} Current socket or null if not connected
 */
function getSocket() {
  return _socket;
}

/**
 * Set connection status
 * @param {string} status - Connection status
 */
function setConnectionStatus(status) {
  const oldStatus = _connectionStatus;
  _connectionStatus = status;

  // Notify listeners
  if (oldStatus !== status) {
    console.log(`🔌 [SocketManager] Status: ${oldStatus} → ${status}`);
    _connectionListeners.forEach((listener) => {
      try {
        listener(status, oldStatus);
      } catch (e) {
        console.error(`[SocketManager] Listener error:`, e.message);
      }
    });
  }
}

/**
 * Get current connection status
 * @returns {string} Current status
 */
function getConnectionStatus() {
  return _connectionStatus;
}

/**
 * Check if currently connected and socket is valid
 * @returns {boolean} True if connected with valid socket
 */
function isConnected() {
  return _connectionStatus === "connected" && _socket !== null;
}

/**
 * Set send functions for services to use
 * @param {Function} sendMessage - Send text message function
 * @param {Function} sendImage - Send image function
 */
function setSendFunctions(sendMessage, sendImage) {
  _sendMessage = sendMessage;
  _sendImage = sendImage;
  console.log(
    `🔌 [SocketManager] Send functions ${sendMessage ? "SET" : "CLEARED"}`
  );
}

/**
 * Get send message function
 * @returns {Function|null}
 */
function getSendMessage() {
  return _sendMessage;
}

/**
 * Get send image function
 * @returns {Function|null}
 */
function getSendImage() {
  return _sendImage;
}

/**
 * Add a connection status listener
 * @param {Function} listener - Callback(newStatus, oldStatus)
 */
function addConnectionListener(listener) {
  _connectionListeners.add(listener);
}

/**
 * Remove a connection status listener
 * @param {Function} listener
 */
function removeConnectionListener(listener) {
  _connectionListeners.delete(listener);
}

// ============================================
// SCHEDULED JOB MANAGEMENT
// Centralized tracking for proper cleanup
// ============================================

/**
 * Register a setTimeout for tracking
 * @param {string} id - Unique identifier
 * @param {number} timeoutId - setTimeout return value
 */
function registerTimeout(id, timeoutId) {
  _scheduledJobs.timeouts.set(id, timeoutId);
}

/**
 * Unregister a timeout
 * @param {string} id
 */
function unregisterTimeout(id) {
  const timeoutId = _scheduledJobs.timeouts.get(id);
  if (timeoutId) {
    clearTimeout(timeoutId);
    _scheduledJobs.timeouts.delete(id);
  }
}

/**
 * Register a setInterval for tracking
 * @param {string} id - Unique identifier
 * @param {number} intervalId - setInterval return value
 */
function registerInterval(id, intervalId) {
  _scheduledJobs.intervals.set(id, intervalId);
}

/**
 * Unregister an interval
 * @param {string} id
 */
function unregisterInterval(id) {
  const intervalId = _scheduledJobs.intervals.get(id);
  if (intervalId) {
    clearInterval(intervalId);
    _scheduledJobs.intervals.delete(id);
  }
}

/**
 * Register a cron job for tracking
 * @param {string} id - Unique identifier
 * @param {Object} task - node-cron task
 */
function registerCronJob(id, task) {
  _scheduledJobs.cronJobs.set(id, task);
}

/**
 * Unregister a cron job
 * @param {string} id
 */
function unregisterCronJob(id) {
  const task = _scheduledJobs.cronJobs.get(id);
  if (task) {
    try {
      task.stop();
    } catch (e) {
      // Ignore stop errors
    }
    _scheduledJobs.cronJobs.delete(id);
  }
}

/**
 * Cancel ALL scheduled jobs
 * CRITICAL: Must be called on disconnect/reconnect
 */
function cancelAllScheduledJobs() {
  console.log(`🧹 [SocketManager] Cancelling all scheduled jobs...`);

  // Clear all timeouts
  let timeoutCount = 0;
  for (const [id, timeoutId] of _scheduledJobs.timeouts) {
    clearTimeout(timeoutId);
    timeoutCount++;
  }
  _scheduledJobs.timeouts.clear();
  console.log(`   ✅ Cleared ${timeoutCount} timeouts`);

  // Clear all intervals
  let intervalCount = 0;
  for (const [id, intervalId] of _scheduledJobs.intervals) {
    clearInterval(intervalId);
    intervalCount++;
  }
  _scheduledJobs.intervals.clear();
  console.log(`   ✅ Cleared ${intervalCount} intervals`);

  // Stop all cron jobs
  let cronCount = 0;
  for (const [id, task] of _scheduledJobs.cronJobs) {
    try {
      task.stop();
      cronCount++;
    } catch (e) {
      // Ignore stop errors
    }
  }
  _scheduledJobs.cronJobs.clear();
  console.log(`   ✅ Stopped ${cronCount} cron jobs`);

  console.log(`✅ [SocketManager] All scheduled jobs cancelled`);
}

/**
 * Get scheduled jobs stats
 * @returns {Object}
 */
function getScheduledJobsStats() {
  return {
    timeouts: _scheduledJobs.timeouts.size,
    intervals: _scheduledJobs.intervals.size,
    cronJobs: _scheduledJobs.cronJobs.size,
  };
}

/**
 * Reset the socket manager (for clean restart)
 */
function reset() {
  cancelAllScheduledJobs();
  _socket = null;
  _connectionStatus = "disconnected";
  _sendMessage = null;
  _sendImage = null;
  _connectionListeners.clear();
  console.log(`🔄 [SocketManager] Reset complete`);
}

module.exports = {
  // Socket management
  setSocket,
  getSocket,
  setConnectionStatus,
  getConnectionStatus,
  isConnected,

  // Send functions
  setSendFunctions,
  getSendMessage,
  getSendImage,

  // Connection listeners
  addConnectionListener,
  removeConnectionListener,

  // Job management
  registerTimeout,
  unregisterTimeout,
  registerInterval,
  unregisterInterval,
  registerCronJob,
  unregisterCronJob,
  cancelAllScheduledJobs,
  getScheduledJobsStats,

  // Reset
  reset,
};
