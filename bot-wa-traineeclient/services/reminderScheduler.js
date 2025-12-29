/**
 * Reminder Scheduler Service
 * Smart cron-based scheduling for reminders
 * Timezone: Asia/Riyadh (KSA Time - UTC+3)
 *
 * CRITICAL FIX: Uses socketManager.getSocket() at execution time
 * to prevent zombie connections from stale socket closures.
 */

const cron = require("node-cron");
const {
  getPendingReminders,
  markReminderSent,
  getAllReminders,
} = require("./adminCommandService");

// CRITICAL: Import socket manager for live socket access
const socketManager = require("../whatsapp/socketManager");

// KSA Timezone
const KSA_TIMEZONE = "Asia/Riyadh";

// Store scheduled cron jobs by reminder ID
const scheduledJobs = new Map();

// Backup check interval
let backupCheckInterval = null;

/**
 * Format date in KSA timezone
 */
function formatKSADate(timestamp, options = {}) {
  return new Date(timestamp).toLocaleString("ar-EG", {
    timeZone: KSA_TIMEZONE,
    ...options,
  });
}

/**
 * Get KSA date object from timestamp
 */
function getKSADateFromTimestamp(timestamp) {
  // Create a date string in KSA timezone
  const ksaString = new Date(timestamp).toLocaleString("en-US", {
    timeZone: KSA_TIMEZONE,
  });
  return new Date(ksaString);
}

/**
 * Send reminder with retry logic
 * @param {object} reminder - The reminder to send
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {boolean} - Whether the send was successful
 *
 * CRITICAL FIX: Gets socket from socketManager at execution time
 */
async function sendReminderWithRetry(reminder, maxRetries = 3) {
  // CRITICAL: Get LIVE socket from manager, not stale closure reference
  const sock = socketManager.getSocket();

  if (!sock) {
    console.log(`⚠️ No WhatsApp socket available for reminder ${reminder.id}`);
    return false;
  }

  // CRITICAL: Validate connection is actually connected before attempting to send
  if (!socketManager.isConnected()) {
    console.log(
      `⚠️ Connection status is "${socketManager.getConnectionStatus()}" for reminder ${
        reminder.id
      }, will retry later`
    );
    return false;
  }

  const targetJid = `${reminder.targetNumber}@s.whatsapp.net`;

  // Format date in KSA timezone
  const ksaDateStr = formatKSADate(reminder.scheduledDateTime, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const messageText = `⏰ *تذكير*\n\n${reminder.message}\n\n━━━━━━━━━━━━━━━━━━━━\n📅 ${ksaDateStr}\n⏰ KSA Time (UTC+3)`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `📤 Sending reminder ${reminder.id} to +${reminder.targetNumber} (attempt ${attempt}/${maxRetries})`
      );

      await sock.sendMessage(targetJid, { text: messageText });

      // Mark as sent
      await markReminderSent(reminder.id, true);

      console.log(
        `✅ Reminder ${reminder.id} sent successfully to +${reminder.targetNumber} (KSA Time: ${ksaDateStr})`
      );

      // Notify the admin who created it
      try {
        const adminJid = `${reminder.createdBy}@s.whatsapp.net`;
        await sock.sendMessage(adminJid, {
          text: `✅ *تم إرسال التذكير*\n\nإلى: +${reminder.targetNumber}\nالرسالة: ${reminder.message}\n📅 ${ksaDateStr}`,
        });
      } catch (adminNotifyError) {
        console.error(
          `⚠️ Could not notify admin about reminder ${reminder.id}:`,
          adminNotifyError.message
        );
      }

      return true;
    } catch (error) {
      console.error(
        `❌ Attempt ${attempt}/${maxRetries} failed for reminder ${reminder.id}:`,
        error.message
      );

      if (attempt < maxRetries) {
        // Exponential backoff: wait 2^attempt seconds
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`⏳ Waiting ${waitTime / 1000}s before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  // All retries failed
  console.error(
    `❌ All ${maxRetries} attempts failed for reminder ${reminder.id}`
  );
  await markReminderSent(reminder.id, false);

  // Try to notify admin about the failure
  try {
    const adminJid = `${reminder.createdBy}@s.whatsapp.net`;
    await sock.sendMessage(adminJid, {
      text: `❌ *فشل إرسال التذكير*\n\nإلى: +${reminder.targetNumber}\nالرسالة: ${reminder.message}\n📅 ${ksaDateStr}\n\nالرجاء إعادة المحاولة لاحقاً أو إعادة إنشاء التذكير.`,
    });
  } catch (e) {
    // Ignore admin notification errors
  }

  return false;
}

/**
 * Schedule a reminder using node-cron
 * @param {object} reminder - The reminder to schedule
 *
 * CRITICAL FIX: Registers jobs with socketManager for proper cleanup
 */
function scheduleReminder(reminder) {
  if (!reminder || reminder.status !== "pending") {
    return;
  }

  // Cancel any existing scheduled job for this reminder
  cancelScheduledReminder(reminder.id);

  const now = Date.now();
  const scheduledTime = reminder.scheduledDateTime;

  // If the scheduled time has already passed, send it immediately
  if (scheduledTime <= now) {
    console.log(
      `⏰ Reminder ${reminder.id} is past due, sending immediately...`
    );
    sendReminderWithRetry(reminder);
    return;
  }

  // Calculate time until reminder
  const timeUntil = scheduledTime - now;
  const ksaDate = getKSADateFromTimestamp(scheduledTime);

  console.log(
    `📅 Scheduling reminder ${reminder.id} for ${formatKSADate(scheduledTime, {
      dateStyle: "short",
      timeStyle: "short",
    })} KSA (in ${Math.round(timeUntil / 60000)} minutes)`
  );

  // For reminders less than 1 hour away, use setTimeout for precision
  if (timeUntil < 60 * 60 * 1000) {
    const timeoutId = setTimeout(async () => {
      // CRITICAL: Check connection BEFORE executing
      if (!socketManager.isConnected()) {
        console.log(
          `⏸️ Reminder ${reminder.id} triggered but not connected, skipping`
        );
        scheduledJobs.delete(reminder.id);
        socketManager.unregisterTimeout(`reminder_${reminder.id}`);
        return;
      }
      console.log(`⏰ Reminder ${reminder.id} triggered via setTimeout`);
      await sendReminderWithRetry(reminder);
      scheduledJobs.delete(reminder.id);
      socketManager.unregisterTimeout(`reminder_${reminder.id}`);
    }, timeUntil);

    scheduledJobs.set(reminder.id, { type: "timeout", id: timeoutId });
    // CRITICAL: Register with socket manager for cleanup on disconnect
    socketManager.registerTimeout(`reminder_${reminder.id}`, timeoutId);
  } else {
    // For reminders more than 1 hour away, use cron for efficiency
    // Create cron expression from KSA date
    const minute = ksaDate.getMinutes();
    const hour = ksaDate.getHours();
    const day = ksaDate.getDate();
    const month = ksaDate.getMonth() + 1;

    // Cron expression: minute hour day month *
    const cronExpression = `${minute} ${hour} ${day} ${month} *`;

    try {
      const task = cron.schedule(
        cronExpression,
        async () => {
          // CRITICAL: Check connection BEFORE executing
          if (!socketManager.isConnected()) {
            console.log(
              `⏸️ Reminder ${reminder.id} triggered but not connected, skipping`
            );
            return;
          }
          console.log(`⏰ Reminder ${reminder.id} triggered via cron job`);
          await sendReminderWithRetry(reminder);
          cancelScheduledReminder(reminder.id);
        },
        {
          timezone: KSA_TIMEZONE,
          scheduled: true,
        }
      );

      scheduledJobs.set(reminder.id, { type: "cron", task });
      // CRITICAL: Register with socket manager for cleanup on disconnect
      socketManager.registerCronJob(`reminder_${reminder.id}`, task);
    } catch (error) {
      console.error(
        `❌ Error scheduling cron for reminder ${reminder.id}:`,
        error.message
      );
      // Fall back to setTimeout
      const timeoutId = setTimeout(async () => {
        // CRITICAL: Check connection BEFORE executing
        if (!socketManager.isConnected()) {
          console.log(
            `⏸️ Reminder ${reminder.id} triggered but not connected, skipping`
          );
          scheduledJobs.delete(reminder.id);
          socketManager.unregisterTimeout(`reminder_${reminder.id}`);
          return;
        }
        console.log(
          `⏰ Reminder ${reminder.id} triggered via fallback setTimeout`
        );
        await sendReminderWithRetry(reminder);
        scheduledJobs.delete(reminder.id);
        socketManager.unregisterTimeout(`reminder_${reminder.id}`);
      }, timeUntil);

      scheduledJobs.set(reminder.id, { type: "timeout", id: timeoutId });
      socketManager.registerTimeout(`reminder_${reminder.id}`, timeoutId);
    }
  }
}

/**
 * Cancel a scheduled reminder
 * @param {string} reminderId - The ID of the reminder to cancel
 */
function cancelScheduledReminder(reminderId) {
  const job = scheduledJobs.get(reminderId);
  if (job) {
    if (job.type === "timeout") {
      clearTimeout(job.id);
      socketManager.unregisterTimeout(`reminder_${reminderId}`);
    } else if (job.type === "cron" && job.task) {
      job.task.stop();
      socketManager.unregisterCronJob(`reminder_${reminderId}`);
    }
    scheduledJobs.delete(reminderId);
    console.log(`🗑️ Cancelled scheduled job for reminder ${reminderId}`);
  }
}

/**
 * Check and send any missed reminders (backup check)
 * This catches any reminders that might have been missed
 */
async function checkMissedReminders() {
  // CRITICAL: Check connection via socket manager, not stale reference
  if (!socketManager.isConnected()) return;

  try {
    const allReminders = getAllReminders();
    const now = Date.now();

    // Find pending reminders that are past due
    const missedReminders = allReminders.filter(
      (r) => r.status === "pending" && r.scheduledDateTime <= now
    );

    if (missedReminders.length > 0) {
      console.log(
        `🔄 Found ${missedReminders.length} missed reminders, processing...`
      );

      for (const reminder of missedReminders) {
        // Check if it's already being processed
        if (!scheduledJobs.has(reminder.id)) {
          await sendReminderWithRetry(reminder);
        }
      }
    }
  } catch (error) {
    console.error("❌ Error checking missed reminders:", error);
  }
}

/**
 * Schedule all pending reminders
 */
function scheduleAllPendingReminders() {
  const allReminders = getAllReminders();
  const pendingReminders = allReminders.filter((r) => r.status === "pending");

  console.log(`📋 Found ${pendingReminders.length} pending reminders`);

  for (const reminder of pendingReminders) {
    scheduleReminder(reminder);
  }
}

/**
 * Initialize reminder scheduler
 * @param {object} sockInstance - WhatsApp socket instance (kept for backward compat, not stored)
 *
 * CRITICAL FIX: Socket instance is NOT stored - we use socketManager.getSocket() at execution time
 */
function initScheduler(sockInstance) {
  // NOTE: We no longer store sockInstance - this was the root cause of zombie connections
  // The sockInstance parameter is kept for backward compatibility but ignored
  console.log(
    "✅ Initializing smart reminder scheduler (using socketManager)..."
  );

  // Schedule all existing pending reminders
  scheduleAllPendingReminders();

  // Check for missed reminders immediately
  checkMissedReminders();

  // Backup check every 5 minutes to catch any missed reminders
  if (backupCheckInterval) {
    clearInterval(backupCheckInterval);
  }
  backupCheckInterval = setInterval(checkMissedReminders, 5 * 60 * 1000);
  // Register with socket manager for cleanup
  socketManager.registerInterval("reminder_backup_check", backupCheckInterval);

  const ksaTimeDisplay = new Date().toLocaleString("ar-SA", {
    timeZone: KSA_TIMEZONE,
  });
  console.log(`🕐 Current KSA time: ${ksaTimeDisplay}`);
  console.log(`📊 Active scheduled jobs: ${scheduledJobs.size}`);
  console.log("✅ Reminder scheduler started (cron-based with backup check)");
}

/**
 * Stop the scheduler
 * CRITICAL FIX: Also unregisters from socket manager
 */
function stopScheduler() {
  // Clear all scheduled jobs
  for (const [reminderId, job] of scheduledJobs) {
    if (job.type === "timeout") {
      clearTimeout(job.id);
      socketManager.unregisterTimeout(`reminder_${reminderId}`);
    } else if (job.type === "cron" && job.task) {
      job.task.stop();
      socketManager.unregisterCronJob(`reminder_${reminderId}`);
    }
  }
  scheduledJobs.clear();

  // Clear backup check interval
  if (backupCheckInterval) {
    clearInterval(backupCheckInterval);
    socketManager.unregisterInterval("reminder_backup_check");
    backupCheckInterval = null;
  }

  console.log("⏹️ Reminder scheduler stopped");
}

/**
 * Update socket instance (call when reconnecting)
 * @param {object} sockInstance - New WhatsApp socket instance
 *
 * DEPRECATED: This function is kept for backward compatibility but does nothing.
 * The socket is now always fetched fresh from socketManager.getSocket()
 */
function updateSocket(sockInstance) {
  // INTENTIONALLY EMPTY - socket is fetched from socketManager at execution time
  console.log(
    "🔄 Reminder scheduler: updateSocket called (using socketManager, no action needed)"
  );
}

/**
 * Get scheduler status
 */
function getSchedulerStatus() {
  const ksaTimeDisplay = new Date().toLocaleString("ar-SA", {
    timeZone: KSA_TIMEZONE,
  });

  return {
    running: socketManager.isConnected(),
    activeJobs: scheduledJobs.size,
    currentKSATime: ksaTimeDisplay,
    scheduledReminders: Array.from(scheduledJobs.keys()),
  };
}

module.exports = {
  initScheduler,
  stopScheduler,
  updateSocket,
  scheduleReminder,
  cancelScheduledReminder,
  getSchedulerStatus,
};
