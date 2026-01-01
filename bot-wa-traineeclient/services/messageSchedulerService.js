/**
 * Message Scheduler Service
 * Handles scheduling and execution of custom messages using node-cron
 * Timezone: Asia/Riyadh (KSA Time - UTC+3)
 *
 * CRITICAL FIX: Uses socketManager.getSocket() at execution time
 * to prevent zombie connections from stale socket closures.
 */

const cron = require("node-cron");
const fs = require("fs");
const customMessageService = require("./customMessageService");

// CRITICAL: Import socket manager for live socket access
const socketManager = require("../whatsapp/socketManager");

// KSA Timezone
const KSA_TIMEZONE = "Asia/Riyadh";

// Store scheduled cron jobs by schedule ID
const scheduledJobs = new Map();

// Backup check interval
let backupCheckInterval = null;

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
 * Check if current day matches scheduled days
 */
function isDayAllowed(allowedDays) {
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const currentDay = dayNames[getKSANow().getDay()];
  return allowedDays.includes(currentDay);
}

/**
 * Check if current time is within allowed time range
 */
function isTimeInRange(startTime, endTime) {
  const now = getKSANow();
  const [startHour, startMin] = startTime.split(":").map(Number);
  const [endHour, endMin] = endTime.split(":").map(Number);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

/**
 * Get random time within a time range
 */
function getRandomTimeInRange(startTime, endTime) {
  const [startHour, startMin] = startTime.split(":").map(Number);
  const [endHour, endMin] = endTime.split(":").map(Number);

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  const randomMinutes =
    Math.floor(Math.random() * (endMinutes - startMinutes + 1)) + startMinutes;

  const hour = Math.floor(randomMinutes / 60);
  const minute = randomMinutes % 60;

  return {
    hour,
    minute,
    cronExpression: `${minute} ${hour} * * *`,
  };
}

// ========================================
// MESSAGE SENDING
// ========================================

/**
 * Send message to all recipients with delay
 *
 * CRITICAL FIX: Gets socket from socketManager at execution time
 */
async function sendToRecipients(schedule, processedMessage) {
  // CRITICAL: Validate connection via socket manager, not stale references
  if (!socketManager.isConnected()) {
    console.log(
      `⚠️ Connection status is "${socketManager.getConnectionStatus()}", skipping scheduled message send`
    );
    return { sent: 0, failed: 0, failedRecipients: [], skipped: true };
  }

  // CRITICAL: Get LIVE socket and send functions from manager
  const sock = socketManager.getSocket();
  const sendMessageFunc = socketManager.getSendMessage();
  const sendImageFunc = socketManager.getSendImage();

  if (!sock && !sendMessageFunc) {
    console.log(
      "⚠️ No socket or sendMessage function available, skipping scheduled message"
    );
    return { sent: 0, failed: 0, failedRecipients: [], skipped: true };
  }

  const { recipients, settings } = schedule;
  const delayMs = (settings.delaySeconds || 60) * 1000;

  let allRecipients = [];

  // 1. Add groups
  if (recipients.groups && recipients.groups.length > 0) {
    recipients.groups.forEach((groupId) => {
      allRecipients.push({
        type: "group",
        id: groupId,
        name: groupId,
      });
    });
  }

  // 2. Add saved numbers (from pre-saved custom numbers)
  if (recipients.savedNumbers && recipients.savedNumbers.length > 0) {
    recipients.savedNumbers.forEach((num) => {
      allRecipients.push({
        type: "private",
        id: num.phone,
        name: num.name || num.phone,
        phone: num.phone,
      });
    });
  }

  // 3. Add custom numbers (manually added)
  if (recipients.customNumbers && recipients.customNumbers.length > 0) {
    recipients.customNumbers.forEach((num) => {
      allRecipients.push({
        type: "private",
        id: num.phone,
        name: num.name || num.phone,
        phone: num.phone,
      });
    });
  }

  // 4. Add selected private clients (now an array of selected clients)
  if (
    recipients.privateClients &&
    Array.isArray(recipients.privateClients) &&
    recipients.privateClients.length > 0
  ) {
    recipients.privateClients.forEach((client) => {
      allRecipients.push({
        type: "private",
        id: client.phone,
        name: client.name || client.phone,
        phone: client.phone,
        role: client.role || "عميل",
      });
    });
  } else if (recipients.privateClients === true) {
    // Legacy support: if privateClients is boolean true, load all active clients
    try {
      const privateClientModule = require("../models/privateClient");
      const clients = privateClientModule.getAllClients();

      Object.entries(clients).forEach(([phone, client]) => {
        // Treat undefined/missing requestStatus as active (only explicitly inactive is filtered)
        if (client.requestStatus !== "inactive") {
          allRecipients.push({
            type: "private",
            id: phone,
            name: client.name || phone,
            phone: phone,
            role: client.role || "عميل",
          });
        }
      });
    } catch (error) {
      console.error("⚠️ Could not load private clients:", error.message);
    }
  }

  // 5. Add interest group members
  if (recipients.interestGroups && recipients.interestGroups.length > 0) {
    try {
      const fs = require("fs");
      const path = require("path");
      const interestGroupsFile = path.join(
        __dirname,
        "..",
        "data",
        "interest_groups.json"
      );

      if (fs.existsSync(interestGroupsFile)) {
        const data = JSON.parse(fs.readFileSync(interestGroupsFile, "utf8"));
        // groups can be an object or an array - handle both
        const groupsData = data.groups || {};
        const groups = Array.isArray(groupsData)
          ? groupsData
          : Object.values(groupsData);

        recipients.interestGroups.forEach((groupId) => {
          const group = groups.find((g) => g.id === groupId);
          if (group && group.members) {
            group.members.forEach((member) => {
              allRecipients.push({
                type: "private",
                id: member.phone,
                name: member.name,
                phone: member.phone,
                role: "عميل مهتم",
                source: group.interest,
              });
            });
          }
        });
      }
    } catch (error) {
      console.error("⚠️ Could not load interest groups:", error.message);
    }
  }

  // Remove duplicates based on ID
  allRecipients = allRecipients.filter(
    (r, index, self) => index === self.findIndex((t) => t.id === r.id)
  );

  // Randomize order if enabled
  if (settings.randomizeOrder) {
    allRecipients = allRecipients.sort(() => Math.random() - 0.5);
  }

  console.log(
    `📤 [SCHEDULED] Sending to ${allRecipients.length} recipients...`
  );

  const result = {
    recipientCount: allRecipients.length,
    successCount: 0,
    failCount: 0,
  };

  // Send to each recipient
  for (let i = 0; i < allRecipients.length; i++) {
    // Check if schedule was disabled while sending
    if (!schedule.enabled) {
      console.log(
        `⏹️ Schedule ${schedule.id} was disabled during execution, stopping...`
      );
      break;
    }
    const recipient = allRecipients[i];

    try {
      // Process message with recipient-specific data
      const message = customMessageService.getMessageById(schedule.messageId);
      const personalizedMessage = customMessageService.processMessageContent(
        message,
        {
          name: recipient.name,
          phone: recipient.phone || recipient.id,
          role: recipient.role || "",
        }
      );

      // Determine JID
      let jid;
      if (recipient.type === "group") {
        jid = recipient.id;
      } else {
        // Clean phone number
        let cleanPhone = (recipient.phone || recipient.id).replace(/\D/g, "");
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
        jid = `${cleanPhone}@s.whatsapp.net`;
      }

      // Check if message has an image
      const hasImage = message.imagePath && fs.existsSync(message.imagePath);

      // Send message with or without image
      if (hasImage) {
        // Read image buffer
        const imageBuffer = fs.readFileSync(message.imagePath);

        if (sendImageFunc) {
          await sendImageFunc(jid, imageBuffer, personalizedMessage);
        } else if (sock) {
          await sock.sendMessage(jid, {
            image: imageBuffer,
            caption: personalizedMessage,
          });
        } else {
          throw new Error("No socket available");
        }
        console.log(`   📸 Sent with image to ${recipient.name}`);
      } else {
        // Send text only
        if (sendMessageFunc) {
          await sendMessageFunc(jid, personalizedMessage);
        } else if (sock) {
          await sock.sendMessage(jid, { text: personalizedMessage });
        } else {
          throw new Error("No socket available");
        }
      }

      result.successCount++;
      console.log(
        `   ✅ [${i + 1}/${allRecipients.length}] Sent to ${recipient.name}`
      );
    } catch (error) {
      result.failCount++;
      console.error(
        `   ❌ [${i + 1}/${allRecipients.length}] Failed: ${recipient.name} - ${
          error.message
        }`
      );
    }

    // Delay between messages (except for last one)
    if (i < allRecipients.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  result.success = result.failCount === 0;
  return result;
}

/**
 * Execute a scheduled message
 */
async function executeSchedule(scheduleId) {
  const schedule = customMessageService.getScheduleById(scheduleId);

  if (!schedule) {
    console.error(`❌ Schedule ${scheduleId} not found`);
    return;
  }

  if (!schedule.enabled) {
    console.log(`⏸️ Schedule ${scheduleId} is disabled, skipping`);
    return;
  }

  const message = customMessageService.getMessageById(schedule.messageId);
  if (!message) {
    console.error(`❌ Message ${schedule.messageId} not found for schedule`);
    return;
  }

  console.log(
    `\n⏰ [SCHEDULED] Executing schedule: ${schedule.name || schedule.id}`
  );
  console.log(`   📝 Message: ${message.name}`);
  console.log(`   📅 Time: ${formatKSADate(Date.now())}`);

  try {
    const result = await sendToRecipients(schedule, message.content);

    // Record the run
    await customMessageService.recordScheduleRun(scheduleId, result);

    console.log(
      `✅ Schedule ${scheduleId} completed: ${result.successCount}/${result.recipientCount} successful`
    );

    // Notify admin
    try {
      const adminJid = "966508007053@s.whatsapp.net";
      const notifyText = `✅ *إرسال مجدول مكتمل*

📝 الرسالة: ${message.name}
📊 الإجمالي: ${result.recipientCount}
✅ نجح: ${result.successCount}
❌ فشل: ${result.failCount}
🕐 الوقت: ${formatKSADate(Date.now())}`;

      if (sendMessageFunc) {
        await sendMessageFunc(adminJid, notifyText);
      } else if (sock) {
        await sock.sendMessage(adminJid, { text: notifyText });
      }
    } catch (notifyErr) {
      // Ignore notification errors
    }
  } catch (error) {
    console.error(`❌ Schedule ${scheduleId} failed:`, error.message);
    await customMessageService.recordScheduleRun(scheduleId, {
      success: false,
      recipientCount: 0,
      successCount: 0,
      failCount: 0,
      error: error.message,
    });
  }
}

/**
 * Execute a schedule immediately (manual trigger)
 */
async function executeScheduleNow(scheduleId) {
  console.log(`🚀 Manual execution of schedule ${scheduleId}`);
  return executeSchedule(scheduleId);
}

// ========================================
// CRON SCHEDULING
// ========================================

/**
 * Schedule a message using node-cron
 * Supports: once, daily, weekly, monthly, yearly repeat types
 */
function scheduleMessage(schedule) {
  if (!schedule || !schedule.enabled) {
    return;
  }

  // Cancel any existing job
  cancelScheduledMessage(schedule.id);

  const {
    startTime,
    endTime,
    days,
    repeatType,
    dayOfMonth,
    month,
    specificDate,
  } = schedule.schedule;

  // For all schedules, pick a random time within the range
  const randomTime = getRandomTimeInRange(startTime, endTime);

  // Day name to number mapping
  const dayNumbers = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  let cronExpression;
  let scheduleDescription;

  const scheduleRepeatType = repeatType || "daily";

  switch (scheduleRepeatType) {
    case "once": {
      // ONE-TIME: Run only once on a specific date, then disable
      // Use setTimeout instead of cron for precision
      let targetDate;

      if (specificDate) {
        // If a specific date is provided, use it
        targetDate = new Date(specificDate);
      } else if (dayOfMonth && month) {
        // Use dayOfMonth and month
        const now = getKSANow();
        targetDate = new Date(
          now.getFullYear(),
          month - 1,
          dayOfMonth,
          randomTime.hour,
          randomTime.minute
        );
        // If date has passed this year, schedule for next year
        if (targetDate < now) {
          targetDate.setFullYear(targetDate.getFullYear() + 1);
        }
      } else if (days && days.length > 0) {
        // Use the first selected day of this week
        const now = getKSANow();
        const targetDayNum = dayNumbers[days[0]];
        const currentDayNum = now.getDay();
        let daysUntil = targetDayNum - currentDayNum;
        if (daysUntil < 0) daysUntil += 7;
        if (daysUntil === 0) {
          // Same day - check if time has passed
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          const targetMinutes = randomTime.hour * 60 + randomTime.minute;
          if (nowMinutes >= targetMinutes) {
            daysUntil = 7; // Next week
          }
        }
        targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + daysUntil);
        targetDate.setHours(randomTime.hour, randomTime.minute, 0, 0);
      } else {
        console.error(
          `❌ No date specified for one-time schedule ${schedule.id}`
        );
        return;
      }

      // Set the time
      targetDate.setHours(randomTime.hour, randomTime.minute, 0, 0);

      const timeUntilMs = targetDate.getTime() - Date.now();

      if (timeUntilMs <= 0) {
        console.log(
          `⚠️ One-time schedule ${schedule.id} date has passed, executing now and disabling...`
        );
        executeSchedule(schedule.id).then(() => {
          // Auto-disable after execution
          customMessageService.updateSchedule(schedule.id, { enabled: false });
          console.log(
            `✅ One-time schedule ${schedule.id} completed and disabled`
          );
        });
        return;
      }

      scheduleDescription = `One-time on ${formatKSADate(
        targetDate.getTime()
      )}`;

      console.log(
        `📅 Scheduling ONE-TIME ${
          schedule.id
        }: ${scheduleDescription} (in ${Math.round(
          timeUntilMs / 60000
        )} minutes)`
      );

      const timeoutId = setTimeout(async () => {
        console.log(`⏰ One-time schedule ${schedule.id} triggered!`);
        await executeSchedule(schedule.id);

        // Auto-disable after execution
        customMessageService.updateSchedule(schedule.id, { enabled: false });
        console.log(
          `✅ One-time schedule ${schedule.id} completed and auto-disabled`
        );
        scheduledJobs.delete(schedule.id);
        socketManager.unregisterTimeout(`msgscheduler_${schedule.id}`);
      }, timeUntilMs);

      scheduledJobs.set(schedule.id, { type: "timeout", id: timeoutId });
      // CRITICAL: Register with socket manager for cleanup on disconnect
      socketManager.registerTimeout(`msgscheduler_${schedule.id}`, timeoutId);
      console.log(`✅ One-time schedule ${schedule.id} registered (timeout)`);
      return; // Exit early - don't use cron for one-time
    }

    case "monthly": {
      // Monthly: run on specific day of month
      // Cron: minute hour dayOfMonth * *
      const targetDay = dayOfMonth || 1;
      cronExpression = `${randomTime.minute} ${randomTime.hour} ${targetDay} * *`;
      scheduleDescription = `Monthly on day ${targetDay} at ${
        randomTime.hour
      }:${String(randomTime.minute).padStart(2, "0")}`;
      break;
    }

    case "yearly": {
      // Yearly: run on specific day and month
      // Cron: minute hour dayOfMonth month *
      const targetDay = dayOfMonth || 1;
      const targetMonth = month || 1;
      cronExpression = `${randomTime.minute} ${randomTime.hour} ${targetDay} ${targetMonth} *`;
      const monthNames = [
        "",
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      scheduleDescription = `Yearly on ${
        monthNames[targetMonth]
      } ${targetDay} at ${randomTime.hour}:${String(randomTime.minute).padStart(
        2,
        "0"
      )}`;
      break;
    }

    case "weekly":
    case "daily":
    default: {
      // Daily/Weekly: run on specific days of week
      let allowedDayNumbers;

      if (scheduleRepeatType === "daily" && (!days || days.length === 0)) {
        // Daily with no days specified = run every day
        allowedDayNumbers = "0,1,2,3,4,5,6";
      } else {
        allowedDayNumbers = (days || []).map((d) => dayNumbers[d]).join(",");
      }

      if (!allowedDayNumbers) {
        console.error(`❌ No days specified for schedule ${schedule.id}`);
        return;
      }

      // Cron: minute hour * * dayOfWeek
      cronExpression = `${randomTime.minute} ${randomTime.hour} * * ${allowedDayNumbers}`;
      scheduleDescription = `${
        scheduleRepeatType === "weekly" ? "Weekly" : "Daily"
      } at ${randomTime.hour}:${String(randomTime.minute).padStart(
        2,
        "0"
      )} on ${(days || ["every day"]).join(", ")}`;
      break;
    }
  }

  console.log(
    `📅 Scheduling ${schedule.id}: ${cronExpression} (${scheduleDescription})`
  );

  try {
    const task = cron.schedule(
      cronExpression,
      async () => {
        // CRITICAL: Check connection BEFORE executing
        if (!socketManager.isConnected()) {
          console.log(
            `⏸️ Schedule ${schedule.id} triggered but not connected, skipping`
          );
          return;
        }
        console.log(`⏰ Cron triggered for schedule ${schedule.id}`);
        await executeSchedule(schedule.id);
      },
      {
        timezone: KSA_TIMEZONE,
        scheduled: true,
      }
    );

    scheduledJobs.set(schedule.id, { type: "cron", task });
    // CRITICAL: Register with socket manager for cleanup on disconnect
    socketManager.registerCronJob(`msgscheduler_${schedule.id}`, task);
    console.log(`✅ Schedule ${schedule.id} registered with cron`);
  } catch (error) {
    console.error(
      `❌ Error scheduling cron for ${schedule.id}:`,
      error.message
    );
  }
}

/**
 * Cancel a scheduled message
 * CRITICAL FIX: Also unregisters from socket manager
 */
function cancelScheduledMessage(scheduleId) {
  const job = scheduledJobs.get(scheduleId);
  if (job) {
    if (job.type === "cron" && job.task) {
      job.task.stop();
      socketManager.unregisterCronJob(`msgscheduler_${scheduleId}`);
    } else if (job.type === "timeout") {
      clearTimeout(job.id);
      socketManager.unregisterTimeout(`msgscheduler_${scheduleId}`);
    }
    scheduledJobs.delete(scheduleId);
    console.log(`🗑️ Cancelled scheduled job for ${scheduleId}`);
  }
}

/**
 * Schedule all enabled schedules
 */
function scheduleAllEnabled() {
  const schedules = customMessageService.getAllSchedules();

  // 1. Stop any jobs that are no longer enabled
  const enabledIds = new Set(
    schedules.filter((s) => s.enabled).map((s) => s.id)
  );
  for (const scheduleId of scheduledJobs.keys()) {
    if (!enabledIds.has(scheduleId)) {
      console.log(
        `📋 Schedule ${scheduleId} is no longer enabled, cancelling...`
      );
      cancelScheduledMessage(scheduleId);
    }
  }

  // 2. Schedule enabled ones if not already scheduled (or if they need update)
  const enabledSchedules = schedules.filter((s) => s.enabled);
  console.log(`📋 Found ${enabledSchedules.length} enabled schedules`);

  for (const schedule of enabledSchedules) {
    // Only schedule if not already in the jobs map
    if (!scheduledJobs.has(schedule.id)) {
      scheduleMessage(schedule);
    }
  }
}

/**
 * Reschedule a specific schedule (call after updates)
 */
function reschedule(scheduleId) {
  const schedule = customMessageService.getScheduleById(scheduleId);
  if (schedule && schedule.enabled) {
    scheduleMessage(schedule);
  } else {
    cancelScheduledMessage(scheduleId);
  }
}

// ========================================
// SCHEDULER MANAGEMENT
// ========================================

/**
 * Initialize the message scheduler
 * @param {object} sockInstance - WhatsApp socket instance (kept for backward compat, not stored)
 * @param {function} sendMessage - sendMessage function from bot.js
 * @param {function} sendImage - sendImage function from bot.js (optional)
 *
 * CRITICAL FIX: Socket instance is NOT stored - we use socketManager.getSocket() at execution time
 */
function initScheduler(sockInstance, sendMessage = null, sendImage = null) {
  // NOTE: We no longer store sockInstance - this was the root cause of zombie connections
  // Instead, store send functions in socket manager for centralized access
  if (sendMessage || sendImage) {
    socketManager.setSendFunctions(sendMessage, sendImage);
  }

  console.log(
    "✅ Initializing custom message scheduler (using socketManager)..."
  );

  // Schedule all enabled schedules
  scheduleAllEnabled();

  // Backup check every 15 minutes
  if (backupCheckInterval) {
    clearInterval(backupCheckInterval);
  }
  backupCheckInterval = setInterval(() => {
    // Re-check schedules in case they were updated
    scheduleAllEnabled();
  }, 15 * 60 * 1000);
  // Register with socket manager for cleanup
  socketManager.registerInterval(
    "message_scheduler_backup",
    backupCheckInterval
  );

  const ksaTimeDisplay = formatKSADate(Date.now());
  console.log(`🕐 Current KSA time: ${ksaTimeDisplay}`);
  console.log(`📊 Active scheduled jobs: ${scheduledJobs.size}`);
  console.log("✅ Custom message scheduler started");
}

/**
 * Stop the scheduler
 * CRITICAL FIX: Also unregisters from socket manager
 */
function stopScheduler() {
  // Clear all scheduled jobs
  for (const [scheduleId, job] of scheduledJobs) {
    if (job.type === "cron" && job.task) {
      job.task.stop();
      socketManager.unregisterCronJob(`msgscheduler_${scheduleId}`);
    } else if (job.type === "timeout") {
      clearTimeout(job.id);
      socketManager.unregisterTimeout(`msgscheduler_${scheduleId}`);
    }
  }
  scheduledJobs.clear();

  // Clear backup check interval
  if (backupCheckInterval) {
    clearInterval(backupCheckInterval);
    socketManager.unregisterInterval("message_scheduler_backup");
    backupCheckInterval = null;
  }

  console.log("⏹️ Custom message scheduler stopped");
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
    "🔄 Custom message scheduler: updateSocket called (using socketManager, send functions updated)"
  );
}

/**
 * Get scheduler status
 */
function getSchedulerStatus() {
  return {
    running: socketManager.isConnected(),
    activeJobs: scheduledJobs.size,
    currentKSATime: formatKSADate(Date.now()),
    scheduledItems: Array.from(scheduledJobs.keys()),
  };
}

// ========================================
// MODULE EXPORTS
// ========================================

module.exports = {
  // Initialization
  initScheduler,
  stopScheduler,
  updateSocket,
  getSchedulerStatus,

  // Scheduling
  scheduleMessage,
  cancelScheduledMessage,
  reschedule,
  scheduleAllEnabled,

  // Execution
  executeSchedule,
  executeScheduleNow,
};
