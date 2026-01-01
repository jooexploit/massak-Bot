/**
 * Scheduled WhatsApp Messages Service
 * Handles scheduling and execution of WhatsApp messages for specific dates/times
 * Timezone: Asia/Riyadh (KSA Time - UTC+3)
 *
 * CRITICAL FIX: Uses socketManager.getSocket() at execution time
 * to prevent zombie connections from stale socket closures.
 */

const fs = require("fs");
const path = require("path");

// CRITICAL: Import socket manager for live socket access
const socketManager = require("../whatsapp/socketManager");

// KSA Timezone
const KSA_TIMEZONE = "Asia/Riyadh";

// File path for scheduled messages
const SCHEDULED_MESSAGES_FILE = path.join(
  __dirname,
  "..",
  "data",
  "scheduled_whatsapp_messages.json"
);

// Store scheduled timeouts by message ID
const scheduledTimeouts = new Map();

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Format date in KSA timezone
 */
function formatKSADate(timestamp, options = {}) {
  return new Date(timestamp).toLocaleString("ar-SA", {
    timeZone: KSA_TIMEZONE,
    ...options,
  });
}

/**
 * Get current KSA time as Date object
 */
function getKSANow() {
  const ksaString = new Date().toLocaleString("en-US", {
    timeZone: KSA_TIMEZONE,
  });
  return new Date(ksaString);
}

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
  const dataDir = path.dirname(SCHEDULED_MESSAGES_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Load scheduled messages from file
 */
function loadScheduledMessages() {
  try {
    ensureDataDir();
    if (fs.existsSync(SCHEDULED_MESSAGES_FILE)) {
      const data = fs.readFileSync(SCHEDULED_MESSAGES_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Error loading scheduled messages:", err.message);
  }
  return [];
}

/**
 * Save scheduled messages to file
 */
function saveScheduledMessages(messages) {
  try {
    ensureDataDir();
    fs.writeFileSync(
      SCHEDULED_MESSAGES_FILE,
      JSON.stringify(messages, null, 2)
    );
    return true;
  } catch (err) {
    console.error("Error saving scheduled messages:", err.message);
    return false;
  }
}

// ========================================
// SCHEDULED MESSAGE MANAGEMENT
// ========================================

/**
 * Create a new scheduled message
 * @param {Object} params - Schedule parameters
 * @param {string} params.adId - Associated ad ID (optional)
 * @param {string} params.message - WhatsApp message content
 * @param {string[]} params.groups - Array of group IDs to send to
 * @param {Object[]} params.customNumbers - Array of custom number objects {name, phone}
 * @param {string} params.scheduledDate - ISO date string for when to send
 * @param {number} params.delaySeconds - Delay between messages (default 3)
 * @param {string} params.createdBy - Username who created the schedule
 * @returns {Object} The created scheduled message
 */
function createScheduledMessage(params) {
  const {
    adId,
    message,
    groups = [],
    customNumbers = [],
    scheduledDate,
    delaySeconds = 3,
    createdBy = "system",
  } = params;

  if (!message) {
    throw new Error("Message content is required");
  }

  if (!scheduledDate) {
    throw new Error("Scheduled date is required");
  }

  if (groups.length === 0 && customNumbers.length === 0) {
    throw new Error("At least one recipient (group or number) is required");
  }

  const scheduledTime = new Date(scheduledDate).getTime();
  const now = Date.now();

  if (scheduledTime <= now) {
    throw new Error("Scheduled date must be in the future");
  }

  const id = `sched-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const scheduledMessage = {
    id,
    adId: adId || null,
    message,
    groups,
    customNumbers,
    scheduledDate,
    scheduledTimestamp: scheduledTime,
    delaySeconds,
    createdBy,
    createdAt: new Date().toISOString(),
    status: "pending", // pending, completed, failed, cancelled
    result: null,
  };

  // Add to storage
  const messages = loadScheduledMessages();
  messages.push(scheduledMessage);
  saveScheduledMessages(messages);

  // Set up timeout for execution
  scheduleExecution(scheduledMessage);

  console.log(`📅 [SCHEDULED] Created scheduled message ${id}`);
  console.log(`   📆 Scheduled for: ${formatKSADate(scheduledTime)}`);
  console.log(`   📢 Groups: ${groups.length}`);
  console.log(`   📱 Numbers: ${customNumbers.length}`);

  return scheduledMessage;
}

/**
 * Get all scheduled messages
 */
function getAllScheduledMessages() {
  return loadScheduledMessages();
}

/**
 * Get scheduled message by ID
 */
function getScheduledMessageById(id) {
  const messages = loadScheduledMessages();
  return messages.find((m) => m.id === id);
}

/**
 * Get pending scheduled messages
 */
function getPendingScheduledMessages() {
  const messages = loadScheduledMessages();
  return messages.filter((m) => m.status === "pending");
}

/**
 * Cancel a scheduled message
 */
function cancelScheduledMessage(id) {
  const messages = loadScheduledMessages();
  const message = messages.find((m) => m.id === id);

  if (!message) {
    throw new Error("Scheduled message not found");
  }

  if (message.status !== "pending") {
    throw new Error("Can only cancel pending messages");
  }

  // Clear the timeout
  if (scheduledTimeouts.has(id)) {
    clearTimeout(scheduledTimeouts.get(id));
    scheduledTimeouts.delete(id);
  }

  // Update status
  message.status = "cancelled";
  message.cancelledAt = new Date().toISOString();
  saveScheduledMessages(messages);

  console.log(`🚫 [SCHEDULED] Cancelled scheduled message ${id}`);

  return message;
}

/**
 * Delete a scheduled message
 */
function deleteScheduledMessage(id) {
  let messages = loadScheduledMessages();
  const message = messages.find((m) => m.id === id);

  if (!message) {
    throw new Error("Scheduled message not found");
  }

  // Clear the timeout if pending
  if (scheduledTimeouts.has(id)) {
    clearTimeout(scheduledTimeouts.get(id));
    scheduledTimeouts.delete(id);
  }

  // Remove from storage
  messages = messages.filter((m) => m.id !== id);
  saveScheduledMessages(messages);

  console.log(`🗑️ [SCHEDULED] Deleted scheduled message ${id}`);

  return true;
}

// ========================================
// EXECUTION
// ========================================

/**
 * Schedule execution of a message
 * CRITICAL FIX: Registers timeout with socketManager for cleanup
 */
function scheduleExecution(scheduledMessage) {
  const { id, scheduledTimestamp } = scheduledMessage;
  const now = Date.now();
  const timeUntilMs = scheduledTimestamp - now;

  if (timeUntilMs <= 0) {
    console.log(`⏰ [SCHEDULED] Message ${id} is past due, executing now...`);
    executeScheduledMessage(id);
    return;
  }

  console.log(
    `⏳ [SCHEDULED] Setting timer for ${id} (${Math.round(
      timeUntilMs / 60000
    )} minutes)`
  );

  const timeoutId = setTimeout(() => {
    // CRITICAL: Check connection BEFORE executing
    if (!socketManager.isConnected()) {
      console.log(
        `⏸️ Scheduled message ${id} triggered but not connected, skipping`
      );
      scheduledTimeouts.delete(id);
      socketManager.unregisterTimeout(`scheduled_wa_${id}`);
      return;
    }
    executeScheduledMessage(id);
    scheduledTimeouts.delete(id);
    socketManager.unregisterTimeout(`scheduled_wa_${id}`);
  }, timeUntilMs);

  scheduledTimeouts.set(id, timeoutId);
  // CRITICAL: Register with socket manager for cleanup on disconnect
  socketManager.registerTimeout(`scheduled_wa_${id}`, timeoutId);
}

/**
 * Execute a scheduled message
 * CRITICAL FIX: Gets socket from socketManager at execution time
 */
async function executeScheduledMessage(id) {
  const messages = loadScheduledMessages();
  const message = messages.find((m) => m.id === id);

  if (!message) {
    console.error(`❌ [SCHEDULED] Message ${id} not found`);
    return;
  }

  if (message.status !== "pending") {
    console.log(`⏸️ [SCHEDULED] Message ${id} is not pending, skipping`);
    return;
  }

  console.log(`\n🚀 [SCHEDULED] Executing scheduled message ${id}`);
  console.log(`   📝 Message preview: ${message.message.substring(0, 50)}...`);
  console.log(
    `   📆 Scheduled for: ${formatKSADate(message.scheduledTimestamp)}`
  );
  console.log(`   🕐 Current time: ${formatKSADate(Date.now())}`);

  // CRITICAL: Get LIVE socket and send functions from manager
  const sock = socketManager.getSocket();
  const sendMessageFunc = socketManager.getSendMessage();

  // Check if we have a socket
  if (!sock && !sendMessageFunc) {
    console.error(`❌ [SCHEDULED] No socket available, marking as failed`);
    message.status = "failed";
    message.result = { error: "No WhatsApp connection available" };
    message.executedAt = new Date().toISOString();
    saveScheduledMessages(messages);
    return;
  }

  // Check connection status via socket manager
  if (!socketManager.isConnected()) {
    console.error(
      `❌ [SCHEDULED] Connection status is "${socketManager.getConnectionStatus()}", marking as failed`
    );
    message.status = "failed";
    message.result = {
      error: `WhatsApp not connected (status: ${socketManager.getConnectionStatus()})`,
    };
    message.executedAt = new Date().toISOString();
    saveScheduledMessages(messages);
    return;
  }

  const { groups, customNumbers, delaySeconds } = message;
  const delayMs = (delaySeconds || 3) * 1000;

  let successCount = 0;
  let failCount = 0;
  const failedRecipients = [];

  // Send to groups
  for (let i = 0; i < groups.length; i++) {
    const groupId = groups[i];
    try {
      console.log(
        `📢 [${i + 1}/${
          groups.length + customNumbers.length
        }] Sending to group: ${groupId}`
      );

      if (sendMessageFunc) {
        await sendMessageFunc(groupId, message.message);
      } else if (sock) {
        await sock.sendMessage(groupId, { text: message.message });
      }

      successCount++;
      console.log(`   ✅ Success`);
    } catch (err) {
      console.error(`   ❌ Failed:`, err.message);
      failCount++;
      failedRecipients.push({ type: "group", id: groupId, error: err.message });
    }

    // Delay between messages
    if (i < groups.length - 1 || customNumbers.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Send to custom numbers
  for (let i = 0; i < customNumbers.length; i++) {
    const number = customNumbers[i];

    // Normalize phone number
    let cleanPhone = (number.phone || "").replace(/\D/g, "");

    if (cleanPhone.startsWith("0")) {
      cleanPhone = "2" + cleanPhone;
    } else if (
      !cleanPhone.startsWith("2") &&
      !cleanPhone.startsWith("966") &&
      !cleanPhone.startsWith("971")
    ) {
      if (cleanPhone.startsWith("5")) {
        cleanPhone = "966" + cleanPhone;
      } else {
        cleanPhone = "20" + cleanPhone;
      }
    }

    const jid = `${cleanPhone}@s.whatsapp.net`;

    try {
      console.log(
        `📱 [${groups.length + i + 1}/${
          groups.length + customNumbers.length
        }] Sending to: ${number.name || cleanPhone}`
      );

      if (sendMessageFunc) {
        await sendMessageFunc(jid, message.message);
      } else if (sock) {
        await sock.sendMessage(jid, { text: message.message });
      }

      successCount++;
      console.log(`   ✅ Success`);
    } catch (err) {
      console.error(`   ❌ Failed:`, err.message);
      failCount++;
      failedRecipients.push({
        type: "private",
        id: cleanPhone,
        name: number.name,
        error: err.message,
      });
    }

    // Delay between messages (except for the last one)
    if (i < customNumbers.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Update message status
  message.status =
    failCount === 0 ? "completed" : successCount === 0 ? "failed" : "completed";
  message.executedAt = new Date().toISOString();
  message.result = {
    totalRecipients: groups.length + customNumbers.length,
    successCount,
    failCount,
    failedRecipients,
  };

  saveScheduledMessages(messages);

  // Clean up timeout
  scheduledTimeouts.delete(id);

  console.log(`\n✅ [SCHEDULED] Message ${id} execution completed`);
  console.log(
    `   📊 Success: ${successCount}/${groups.length + customNumbers.length}`
  );
  console.log(`   ❌ Failed: ${failCount}`);

  // Notify admin
  try {
    const ADMIN_PHONE = "966508007053@s.whatsapp.net";
    const notifyText = `✅ *رسالة مجدولة تم إرسالها*

📅 كان موعدها: ${formatKSADate(message.scheduledTimestamp)}
🕐 وقت الإرسال: ${formatKSADate(Date.now())}
📊 الإجمالي: ${groups.length + customNumbers.length}
✅ نجح: ${successCount}
❌ فشل: ${failCount}

${message.message.substring(0, 100)}${
      message.message.length > 100 ? "..." : ""
    }`;

    if (sendMessageFunc) {
      await sendMessageFunc(ADMIN_PHONE, notifyText);
    } else if (sock) {
      await sock.sendMessage(ADMIN_PHONE, { text: notifyText });
    }
  } catch (notifyErr) {
    console.error("Failed to notify admin:", notifyErr.message);
  }
}

// ========================================
// INITIALIZATION
// ========================================

/**
 * Initialize the scheduled messages service
 * @param {Object} sockInstance - WhatsApp socket instance (kept for backward compat, not stored)
 * @param {Function} sendMessage - sendMessage function from bot.js
 * @param {Function} sendImage - sendImage function from bot.js (optional)
 *
 * CRITICAL FIX: Socket instance is NOT stored - we use socketManager.getSocket() at execution time
 */
function initScheduledMessages(
  sockInstance,
  sendMessage = null,
  sendImage = null
) {
  // NOTE: We no longer store sockInstance - this was the root cause of zombie connections
  // Store send functions in socket manager for centralized access
  if (sendMessage || sendImage) {
    socketManager.setSendFunctions(sendMessage, sendImage);
  }

  console.log(
    "✅ Initializing scheduled WhatsApp messages service (using socketManager)..."
  );

  // Load pending messages and set up timeouts
  const pendingMessages = getPendingScheduledMessages();
  console.log(`📅 Found ${pendingMessages.length} pending scheduled messages`);

  for (const msg of pendingMessages) {
    scheduleExecution(msg);
  }

  console.log(`🕐 Current KSA time: ${formatKSADate(Date.now())}`);
  console.log(`📊 Active scheduled timeouts: ${scheduledTimeouts.size}`);
  console.log("✅ Scheduled WhatsApp messages service started");
}

/**
 * Update socket instance (call when reconnecting)
 *
 * DEPRECATED: This function is kept for backward compatibility but does nothing for socket.
 * The socket is now always fetched fresh from socketManager.getSocket()
 */
function updateSocket(sockInstance, sendMessage = null, sendImage = null) {
  // INTENTIONALLY NOT storing sockInstance - it's fetched from socketManager at execution time
  // Only update send functions if provided
  if (sendMessage || sendImage) {
    socketManager.setSendFunctions(sendMessage, sendImage);
  }
  console.log(
    "🔄 Scheduled WhatsApp messages service: updateSocket called (using socketManager)"
  );
}

/**
 * Stop the scheduled messages service
 * CRITICAL FIX: Also unregisters from socket manager
 */
function stopScheduledMessages() {
  // Clear all timeouts
  for (const [id, timeoutId] of scheduledTimeouts) {
    clearTimeout(timeoutId);
    socketManager.unregisterTimeout(`scheduled_wa_${id}`);
  }
  scheduledTimeouts.clear();
  console.log("⏹️ Scheduled WhatsApp messages service stopped");
}

// Alias for consistency with other services
const stopScheduler = stopScheduledMessages;

/**
 * Get service status
 */
function getServiceStatus() {
  const pending = getPendingScheduledMessages();
  return {
    running: socketManager.isConnected(),
    activeTimeouts: scheduledTimeouts.size,
    pendingMessages: pending.length,
    currentKSATime: formatKSADate(Date.now()),
  };
}

// ========================================
// MODULE EXPORTS
// ========================================

module.exports = {
  // Initialization
  initScheduledMessages,
  updateSocket,
  stopScheduledMessages,
  stopScheduler, // Alias for consistency
  getServiceStatus,

  // Message management
  createScheduledMessage,
  getAllScheduledMessages,
  getScheduledMessageById,
  getPendingScheduledMessages,
  cancelScheduledMessage,
  deleteScheduledMessage,

  // Execution
  executeScheduledMessage,
};
