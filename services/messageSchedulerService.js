/**
 * Message Scheduler Service
 * Handles scheduling and execution of custom messages using node-cron
 * Timezone: Asia/Riyadh (KSA Time - UTC+3)
 */

const cron = require("node-cron");
const fs = require("fs");
const customMessageService = require("./customMessageService");

// KSA Timezone
const KSA_TIMEZONE = "Asia/Riyadh";

// Store scheduled cron jobs by schedule ID
const scheduledJobs = new Map();

// WhatsApp socket instance
let sock = null;

// Backup check interval
let backupCheckInterval = null;

// Reference to sendMessage and sendImage functions from bot.js
let sendMessageFunc = null;
let sendImageFunc = null;

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
 */
async function sendToRecipients(schedule, processedMessage) {
  // CRITICAL: Validate connection is actually connected before sending
  // This prevents sending on stale socket references after reconnection
  try {
    const { getConnectionStatus } = require("../whatsapp/bot");
    const connectionStatus = getConnectionStatus();
    if (connectionStatus !== "connected") {
      console.log(`⚠️ Connection status is "${connectionStatus}", skipping scheduled message send`);
      return { sent: 0, failed: 0, failedRecipients: [], skipped: true };
    }
  } catch (e) {
    console.warn("⚠️ Could not check connection status:", e.message);
  }

  if (!sock && !sendMessageFunc) {
    console.log("⚠️ No socket or sendMessage function available, skipping scheduled message");
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
  if (recipients.privateClients && Array.isArray(recipients.privateClients) && recipients.privateClients.length > 0) {
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
            caption: personalizedMessage 
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
        `   ❌ [${i + 1}/${allRecipients.length}] Failed: ${recipient.name} - ${error.message}`
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
      const adminJid = "966508001475@s.whatsapp.net";
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
 * Supports: daily, weekly, monthly, yearly repeat types
 */
function scheduleMessage(schedule) {
  if (!schedule || !schedule.enabled) {
    return;
  }

  // Cancel any existing job
  cancelScheduledMessage(schedule.id);

  const { startTime, endTime, days, repeatType, dayOfMonth, month } = schedule.schedule;

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
    case "monthly": {
      // Monthly: run on specific day of month
      // Cron: minute hour dayOfMonth * *
      const targetDay = dayOfMonth || 1;
      cronExpression = `${randomTime.minute} ${randomTime.hour} ${targetDay} * *`;
      scheduleDescription = `Monthly on day ${targetDay} at ${randomTime.hour}:${String(randomTime.minute).padStart(2, "0")}`;
      break;
    }

    case "yearly": {
      // Yearly: run on specific day and month
      // Cron: minute hour dayOfMonth month *
      const targetDay = dayOfMonth || 1;
      const targetMonth = month || 1;
      cronExpression = `${randomTime.minute} ${randomTime.hour} ${targetDay} ${targetMonth} *`;
      const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      scheduleDescription = `Yearly on ${monthNames[targetMonth]} ${targetDay} at ${randomTime.hour}:${String(randomTime.minute).padStart(2, "0")}`;
      break;
    }

    case "weekly":
    case "daily":
    default: {
      // Daily/Weekly: run on specific days of week
      const allowedDayNumbers = (days || []).map((d) => dayNumbers[d]).join(",");
      
      if (!allowedDayNumbers) {
        console.error(`❌ No days specified for schedule ${schedule.id}`);
        return;
      }

      // Cron: minute hour * * dayOfWeek
      cronExpression = `${randomTime.minute} ${randomTime.hour} * * ${allowedDayNumbers}`;
      scheduleDescription = `${scheduleRepeatType === "weekly" ? "Weekly" : "Daily"} at ${randomTime.hour}:${String(randomTime.minute).padStart(2, "0")} on ${(days || []).join(", ")}`;
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
        console.log(`⏰ Cron triggered for schedule ${schedule.id}`);
        await executeSchedule(schedule.id);
      },
      {
        timezone: KSA_TIMEZONE,
        scheduled: true,
      }
    );

    scheduledJobs.set(schedule.id, { type: "cron", task });
    console.log(`✅ Schedule ${schedule.id} registered with cron`);
  } catch (error) {
    console.error(`❌ Error scheduling cron for ${schedule.id}:`, error.message);
  }
}

/**
 * Cancel a scheduled message
 */
function cancelScheduledMessage(scheduleId) {
  const job = scheduledJobs.get(scheduleId);
  if (job) {
    if (job.type === "cron" && job.task) {
      job.task.stop();
    } else if (job.type === "timeout") {
      clearTimeout(job.id);
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
  const enabledSchedules = schedules.filter((s) => s.enabled);

  console.log(`📋 Found ${enabledSchedules.length} enabled schedules`);

  for (const schedule of enabledSchedules) {
    scheduleMessage(schedule);
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
 * @param {object} sockInstance - WhatsApp socket instance
 * @param {function} sendMessage - sendMessage function from bot.js
 * @param {function} sendImage - sendImage function from bot.js (optional)
 */
function initScheduler(sockInstance, sendMessage = null, sendImage = null) {
  sock = sockInstance;
  sendMessageFunc = sendMessage;
  sendImageFunc = sendImage;

  console.log("✅ Initializing custom message scheduler...");

  // Schedule all enabled schedules
  scheduleAllEnabled();

  // Backup check every 15 minutes
  backupCheckInterval = setInterval(() => {
    // Re-check schedules in case they were updated
    scheduleAllEnabled();
  }, 15 * 60 * 1000);

  const ksaTimeDisplay = formatKSADate(Date.now());
  console.log(`🕐 Current KSA time: ${ksaTimeDisplay}`);
  console.log(`📊 Active scheduled jobs: ${scheduledJobs.size}`);
  console.log("✅ Custom message scheduler started");
}

/**
 * Stop the scheduler
 */
function stopScheduler() {
  // Clear all scheduled jobs
  for (const [scheduleId, job] of scheduledJobs) {
    if (job.type === "cron" && job.task) {
      job.task.stop();
    } else if (job.type === "timeout") {
      clearTimeout(job.id);
    }
  }
  scheduledJobs.clear();

  // Clear backup check interval
  if (backupCheckInterval) {
    clearInterval(backupCheckInterval);
    backupCheckInterval = null;
  }

  console.log("⏹️ Custom message scheduler stopped");
}

/**
 * Update socket instance (call when reconnecting)
 */
function updateSocket(sockInstance, sendMessage = null, sendImage = null) {
  sock = sockInstance;
  if (sendMessage) {
    sendMessageFunc = sendMessage;
  }
  if (sendImage) {
    sendImageFunc = sendImage;
  }
  console.log("🔄 Custom message scheduler socket updated");
}

/**
 * Get scheduler status
 */
function getSchedulerStatus() {
  return {
    running: sock !== null,
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
