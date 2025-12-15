/**
 * Custom Message Service
 * Handles custom message templates with dynamic word replacement and variable substitution
 * Timezone: Asia/Riyadh (KSA Time - UTC+3)
 */

const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

// File paths
const CUSTOM_MESSAGES_FILE = path.join(__dirname, "..", "data", "custom_messages.json");
const SCHEDULED_MESSAGES_FILE = path.join(__dirname, "..", "data", "scheduled_messages.json");

// KSA Timezone
const KSA_TIMEZONE = "Asia/Riyadh";

// In-memory storage
let customMessages = [];
let scheduledMessages = [];

// ========================================
// DATA INITIALIZATION
// ========================================

/**
 * Initialize data files if they don't exist
 */
async function initDataFiles() {
  try {
    // Initialize custom_messages.json
    try {
      const data = await fs.readFile(CUSTOM_MESSAGES_FILE, "utf8");
      customMessages = JSON.parse(data).messages || [];
    } catch (error) {
      // File doesn't exist, create it
      await fs.writeFile(
        CUSTOM_MESSAGES_FILE,
        JSON.stringify({ messages: [] }, null, 2)
      );
      customMessages = [];
    }

    // Initialize scheduled_messages.json
    try {
      const data = await fs.readFile(SCHEDULED_MESSAGES_FILE, "utf8");
      scheduledMessages = JSON.parse(data).schedules || [];
    } catch (error) {
      // File doesn't exist, create it
      await fs.writeFile(
        SCHEDULED_MESSAGES_FILE,
        JSON.stringify({ schedules: [] }, null, 2)
      );
      scheduledMessages = [];
    }

    console.log(
      `📦 Custom Messages: Loaded ${customMessages.length} messages, ${scheduledMessages.length} schedules`
    );
  } catch (error) {
    console.error("❌ Error initializing custom message data files:", error);
  }
}

/**
 * Save custom messages to file
 */
async function saveCustomMessages() {
  try {
    await fs.writeFile(
      CUSTOM_MESSAGES_FILE,
      JSON.stringify({ messages: customMessages }, null, 2)
    );
  } catch (error) {
    console.error("❌ Error saving custom messages:", error);
  }
}

/**
 * Save scheduled messages to file
 */
async function saveScheduledMessages() {
  try {
    await fs.writeFile(
      SCHEDULED_MESSAGES_FILE,
      JSON.stringify({ schedules: scheduledMessages }, null, 2)
    );
  } catch (error) {
    console.error("❌ Error saving scheduled messages:", error);
  }
}

// ========================================
// CUSTOM MESSAGE CRUD
// ========================================

/**
 * Get all custom messages
 */
function getAllMessages() {
  return customMessages;
}

/**
 * Get message by ID
 */
function getMessageById(id) {
  return customMessages.find((msg) => msg.id === id);
}

/**
 * Create a new custom message
 * @param {object} data - Message data
 * @param {string} createdBy - Username of creator
 */
async function createMessage(data, createdBy = "admin") {
  const message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    name: data.name || "رسالة جديدة",
    content: data.content || "",
    imagePath: data.imagePath || null, // Image path for sending with message
    dynamicWords: data.dynamicWords || {},
    variables: extractVariables(data.content || ""),
    createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  customMessages.push(message);
  await saveCustomMessages();

  console.log(`✅ Created custom message: ${message.id} - ${message.name}`);
  return message;
}

/**
 * Update a custom message
 */
async function updateMessage(id, data) {
  const index = customMessages.findIndex((msg) => msg.id === id);
  if (index === -1) {
    throw new Error("Message not found");
  }

  customMessages[index] = {
    ...customMessages[index],
    name: data.name !== undefined ? data.name : customMessages[index].name,
    content:
      data.content !== undefined ? data.content : customMessages[index].content,
    imagePath:
      data.imagePath !== undefined
        ? data.imagePath
        : customMessages[index].imagePath,
    dynamicWords:
      data.dynamicWords !== undefined
        ? data.dynamicWords
        : customMessages[index].dynamicWords,
    variables: extractVariables(
      data.content !== undefined ? data.content : customMessages[index].content
    ),
    updatedAt: new Date().toISOString(),
  };

  await saveCustomMessages();
  console.log(`✅ Updated custom message: ${id}`);
  return customMessages[index];
}

/**
 * Delete a custom message
 */
async function deleteMessage(id) {
  const index = customMessages.findIndex((msg) => msg.id === id);
  if (index === -1) {
    throw new Error("Message not found");
  }

  // Check if message is used in any schedule
  const usedInSchedule = scheduledMessages.find((s) => s.messageId === id);
  if (usedInSchedule) {
    throw new Error(
      `Cannot delete: message is used in schedule "${usedInSchedule.name || usedInSchedule.id}"`
    );
  }

  customMessages.splice(index, 1);
  await saveCustomMessages();

  console.log(`🗑️ Deleted custom message: ${id}`);
  return true;
}

// ========================================
// SCHEDULED MESSAGE CRUD
// ========================================

/**
 * Get all scheduled messages
 */
function getAllSchedules() {
  return scheduledMessages;
}

/**
 * Get schedule by ID
 */
function getScheduleById(id) {
  return scheduledMessages.find((s) => s.id === id);
}

/**
 * Create a new schedule
 */
async function createSchedule(data, createdBy = "admin") {
  // Validate message exists
  const message = getMessageById(data.messageId);
  if (!message) {
    throw new Error("Message not found");
  }

  const schedule = {
    id: `sch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    name: data.name || message.name,
    messageId: data.messageId,
    enabled: data.enabled !== false,
    schedule: {
      type: data.schedule?.type || "daily",
      days: data.schedule?.days || [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
      ],
      startTime: data.schedule?.startTime || "09:00",
      endTime: data.schedule?.endTime || "17:00",
      timezone: KSA_TIMEZONE,
    },
    recipients: {
      groups: data.recipients?.groups || [],
      customNumbers: data.recipients?.customNumbers || [],
      privateClients: data.recipients?.privateClients || false,
      interestGroups: data.recipients?.interestGroups || [],
    },
    settings: {
      delaySeconds: data.settings?.delaySeconds || 60,
      randomizeOrder: data.settings?.randomizeOrder !== false,
    },
    lastRun: null,
    nextRun: calculateNextRun(data.schedule),
    runHistory: [],
    createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  scheduledMessages.push(schedule);
  await saveScheduledMessages();

  console.log(`✅ Created schedule: ${schedule.id} - ${schedule.name}`);
  return schedule;
}

/**
 * Update a schedule
 */
async function updateSchedule(id, data) {
  const index = scheduledMessages.findIndex((s) => s.id === id);
  if (index === -1) {
    throw new Error("Schedule not found");
  }

  const existingSchedule = scheduledMessages[index];

  scheduledMessages[index] = {
    ...existingSchedule,
    name: data.name !== undefined ? data.name : existingSchedule.name,
    messageId:
      data.messageId !== undefined
        ? data.messageId
        : existingSchedule.messageId,
    enabled:
      data.enabled !== undefined ? data.enabled : existingSchedule.enabled,
    schedule: {
      ...existingSchedule.schedule,
      ...(data.schedule || {}),
    },
    recipients: {
      ...existingSchedule.recipients,
      ...(data.recipients || {}),
    },
    settings: {
      ...existingSchedule.settings,
      ...(data.settings || {}),
    },
    nextRun: calculateNextRun(data.schedule || existingSchedule.schedule),
    updatedAt: new Date().toISOString(),
  };

  await saveScheduledMessages();
  console.log(`✅ Updated schedule: ${id}`);
  return scheduledMessages[index];
}

/**
 * Delete a schedule
 */
async function deleteSchedule(id) {
  const index = scheduledMessages.findIndex((s) => s.id === id);
  if (index === -1) {
    throw new Error("Schedule not found");
  }

  scheduledMessages.splice(index, 1);
  await saveScheduledMessages();

  console.log(`🗑️ Deleted schedule: ${id}`);
  return true;
}

/**
 * Toggle schedule enabled/disabled
 */
async function toggleSchedule(id) {
  const schedule = getScheduleById(id);
  if (!schedule) {
    throw new Error("Schedule not found");
  }

  schedule.enabled = !schedule.enabled;
  schedule.updatedAt = new Date().toISOString();

  if (schedule.enabled) {
    schedule.nextRun = calculateNextRun(schedule.schedule);
  }

  await saveScheduledMessages();
  console.log(
    `🔄 Schedule ${id} is now ${schedule.enabled ? "enabled" : "disabled"}`
  );
  return schedule;
}

/**
 * Record a schedule run in history
 */
async function recordScheduleRun(id, result) {
  const schedule = getScheduleById(id);
  if (!schedule) return;

  const runRecord = {
    timestamp: new Date().toISOString(),
    success: result.success,
    recipientCount: result.recipientCount || 0,
    successCount: result.successCount || 0,
    failCount: result.failCount || 0,
  };

  schedule.runHistory = schedule.runHistory || [];
  schedule.runHistory.unshift(runRecord);

  // Keep only last 50 runs
  if (schedule.runHistory.length > 50) {
    schedule.runHistory = schedule.runHistory.slice(0, 50);
  }

  schedule.lastRun = runRecord.timestamp;
  schedule.nextRun = calculateNextRun(schedule.schedule);

  await saveScheduledMessages();
}

// ========================================
// DYNAMIC WORD & VARIABLE PROCESSING
// ========================================

/**
 * Extract variables from message content
 * @param {string} content - Message content
 * @returns {string[]} Array of variable names found
 */
function extractVariables(content) {
  const regex = /\{\{([^}]+)\}\}/g;
  const variables = [];
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }

  return variables;
}

/**
 * Get list of available built-in variables
 */
function getAvailableVariables() {
  return [
    {
      name: "name",
      description: "اسم المستلم",
      example: "أحمد",
    },
    {
      name: "phone",
      description: "رقم الهاتف",
      example: "966501234567",
    },
    {
      name: "role",
      description: "الدور (وسيط/عميل)",
      example: "وسيط",
    },
    {
      name: "date",
      description: "التاريخ الحالي",
      example: formatKSADate(Date.now(), "date"),
    },
    {
      name: "time",
      description: "الوقت الحالي",
      example: formatKSADate(Date.now(), "time"),
    },
    {
      name: "day",
      description: "اسم اليوم",
      example: formatKSADate(Date.now(), "day"),
    },
  ];
}

/**
 * Format date in KSA timezone
 */
function formatKSADate(timestamp, format = "full") {
  const options = { timeZone: KSA_TIMEZONE };

  switch (format) {
    case "date":
      return new Date(timestamp).toLocaleDateString("ar-SA", {
        ...options,
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    case "time":
      return new Date(timestamp).toLocaleTimeString("ar-SA", {
        ...options,
        hour: "2-digit",
        minute: "2-digit",
      });
    case "day":
      return new Date(timestamp).toLocaleDateString("ar-SA", {
        ...options,
        weekday: "long",
      });
    default:
      return new Date(timestamp).toLocaleString("ar-SA", options);
  }
}

/**
 * Process message content - replace variables and dynamic words
 * @param {object} message - The message template
 * @param {object} recipientData - Data about the recipient
 * @returns {string} Processed message content
 */
function processMessageContent(message, recipientData = {}) {
  let content = message.content;
  const dynamicWords = message.dynamicWords || {};

  // 1. Replace dynamic words (random selection)
  for (const [key, options] of Object.entries(dynamicWords)) {
    if (Array.isArray(options) && options.length > 0) {
      const randomOption = options[Math.floor(Math.random() * options.length)];
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      content = content.replace(regex, randomOption);
    }
  }

  // 2. Replace built-in variables
  const now = Date.now();
  const builtInVariables = {
    name: recipientData.name || "",
    phone: recipientData.phone || "",
    role: recipientData.role || "",
    date: formatKSADate(now, "date"),
    time: formatKSADate(now, "time"),
    day: formatKSADate(now, "day"),
  };

  for (const [key, value] of Object.entries(builtInVariables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    content = content.replace(regex, value);
  }

  // 3. Replace any custom variables from recipientData
  for (const [key, value] of Object.entries(recipientData)) {
    if (!builtInVariables.hasOwnProperty(key)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      content = content.replace(regex, value || "");
    }
  }

  return content;
}

/**
 * Preview a message with sample data
 */
function previewMessage(messageId, sampleData = {}) {
  const message = getMessageById(messageId);
  if (!message) {
    throw new Error("Message not found");
  }

  // Use sample data or defaults
  const defaultSample = {
    name: "أحمد محمد",
    phone: "966501234567",
    role: "عميل",
  };

  const recipientData = { ...defaultSample, ...sampleData };
  return processMessageContent(message, recipientData);
}

/**
 * Validate message content syntax
 */
function validateMessage(content) {
  const errors = [];

  // Check for unclosed variables
  const openBrackets = (content.match(/\{\{/g) || []).length;
  const closeBrackets = (content.match(/\}\}/g) || []).length;

  if (openBrackets !== closeBrackets) {
    errors.push("عدد الأقواس غير متطابق - تأكد من إغلاق جميع المتغيرات {{...}}");
  }

  // Check for empty variables
  if (/\{\{\s*\}\}/.test(content)) {
    errors.push("يوجد متغير فارغ {{}}");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Calculate next run time for a schedule
 * Supports: daily, weekly, monthly, yearly repeat types
 */
function calculateNextRun(scheduleConfig) {
  if (!scheduleConfig) return null;

  const now = new Date();
  const ksaNow = new Date(
    now.toLocaleString("en-US", { timeZone: KSA_TIMEZONE })
  );

  // Parse start time
  const [startHour, startMinute] = (scheduleConfig.startTime || "09:00")
    .split(":")
    .map(Number);

  const repeatType = scheduleConfig.repeatType || "daily";

  // Get day names mapping
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  // Handle different repeat types
  switch (repeatType) {
    case "monthly": {
      // Monthly: run on specific day of month
      const dayOfMonth = scheduleConfig.dayOfMonth || 1;
      
      // Check up to 13 months ahead
      for (let monthOffset = 0; monthOffset <= 13; monthOffset++) {
        const checkDate = new Date(ksaNow);
        checkDate.setMonth(checkDate.getMonth() + monthOffset);
        checkDate.setDate(dayOfMonth);
        checkDate.setHours(startHour, startMinute, 0, 0);
        
        // Handle months with fewer days (e.g., Feb 30 -> Feb 28)
        if (checkDate.getDate() !== dayOfMonth) {
          // Day doesn't exist in this month, try next month
          continue;
        }
        
        if (checkDate > ksaNow) {
          return checkDate.toISOString();
        }
      }
      return null;
    }
    
    case "yearly": {
      // Yearly: run on specific day and month
      const dayOfMonth = scheduleConfig.dayOfMonth || 1;
      const month = (scheduleConfig.month || 1) - 1; // JS months are 0-indexed
      
      // Check this year and next few years
      for (let yearOffset = 0; yearOffset <= 5; yearOffset++) {
        const checkDate = new Date(ksaNow);
        checkDate.setFullYear(checkDate.getFullYear() + yearOffset);
        checkDate.setMonth(month);
        checkDate.setDate(dayOfMonth);
        checkDate.setHours(startHour, startMinute, 0, 0);
        
        // Validate date (handle Feb 29 on non-leap years)
        if (checkDate.getMonth() !== month || checkDate.getDate() !== dayOfMonth) {
          continue;
        }
        
        if (checkDate > ksaNow) {
          return checkDate.toISOString();
        }
      }
      return null;
    }
    
    case "weekly":
    case "daily":
    default: {
      // Daily/Weekly: run on specific days of week
      const allowedDays = scheduleConfig.days || dayNames.slice(0, 5); // Default: Sun-Thu
      
      // Look ahead up to 14 days to ensure we find the next occurrence
      // (14 days ensures we cover 2 full weeks for any day selection)
      for (let i = 0; i < 14; i++) {
        const checkDate = new Date(ksaNow);
        checkDate.setDate(checkDate.getDate() + i);
        const dayName = dayNames[checkDate.getDay()];

        if (allowedDays.includes(dayName)) {
          const runTime = new Date(checkDate);
          runTime.setHours(startHour, startMinute, 0, 0);

          // If it's today but already passed the start time, continue to next day
          if (i === 0 && runTime <= ksaNow) {
            continue;
          }

          return runTime.toISOString();
        }
      }
      return null;
    }
  }
}

// ========================================
// MODULE EXPORTS
// ========================================

// Initialize on module load
initDataFiles();

module.exports = {
  // Custom Messages
  getAllMessages,
  getMessageById,
  createMessage,
  updateMessage,
  deleteMessage,

  // Scheduled Messages
  getAllSchedules,
  getScheduleById,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  toggleSchedule,
  recordScheduleRun,

  // Processing
  processMessageContent,
  previewMessage,
  validateMessage,
  extractVariables,
  getAvailableVariables,

  // Initialization
  initDataFiles,
};
