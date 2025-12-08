/**
 * Admin Command Service
 * Handles admin-only commands via WhatsApp
 * Timezone: Asia/Riyadh (KSA Time - UTC+3)
 */

const fs = require("fs").promises;
const path = require("path");
const waseetDetector = require("./waseetDetector");
const interestGroupService = require("./interestGroupService");

// KSA Timezone configuration
const KSA_TIMEZONE = "Asia/Riyadh";

// Admin phone numbers (without @s.whatsapp.net)
const ADMIN_NUMBERS = ["966508007053", "201090952790"];

// Store lid_mapping for WhatsApp Business accounts
let lidMapping = {};

// Reminders storage
const REMINDERS_FILE = path.join(__dirname, "../data/reminders.json");
let reminders = [];

// Load admins from file
const ADMINS_FILE = path.join(__dirname, "../data/admins.json");

// Pending waseet confirmations: { [adminJid]: { entries: [...], createdAt } }
const pendingWaseetConfirmations = {};
// Pending admin confirmations: { [adminJid]: { entries: [...], createdAt } }
const pendingAdminConfirmations = {};
// Pending interest group confirmations: { [adminJid]: { interest, entries, groupId?, createdAt } }
const pendingInterestConfirmations = {};

/**
 * Normalize phone number to standard format
 * - Removes all spaces
 * - Removes + prefix
 * - Converts local formats (0xxxxxxxxx) to international (966xxxxxxxxx for Saudi)
 * - Removes @s.whatsapp.net suffix
 * @param {string} phone - Phone number to normalize
 * @returns {string} Normalized phone number
 */
function normalizePhoneNumber(phone) {
  if (!phone) return "";

  // Remove all spaces and common separators
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, "");

  // Remove + prefix
  cleaned = cleaned.replace(/^\+/, "");

  // Remove @s.whatsapp.net suffix
  cleaned = cleaned.replace(/@s\.whatsapp\.net$/, "");

  // Convert Egyptian local format 01xxxxxxxxx to 201xxxxxxxxx
  if (cleaned.startsWith("01") && cleaned.length === 11) {
    cleaned = "20" + cleaned.substring(1);
  }

  // Convert Saudi local format 05xxxxxxxx to 9665xxxxxxxx
  if (cleaned.startsWith("05") && cleaned.length === 10) {
    cleaned = "966" + cleaned.substring(1);
  }

  // Convert 5xxxxxxxx (Saudi without 0) to 9665xxxxxxxx
  if (cleaned.startsWith("5") && cleaned.length === 9) {
    cleaned = "966" + cleaned;
  }

  return cleaned;
}

/**
 * Parse flexible entries from message text
 * Supports multiple formats:
 * - "اسم,رقم" (name comma number)
 * - "رقم,اسم" (number comma name)
 * - Just numbers on separate lines
 * - Number with name on same line separated by space
 * @param {string} text - Message text after command
 * @param {boolean} requireName - Whether name is required (true for waseet, false for admin)
 * @returns {Array} Array of { phone, name } objects
 */
function parseFlexibleEntries(text, requireName = true) {
  const entries = [];
  
  // Split by newlines and filter empty lines
  const lines = text.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  
  for (const line of lines) {
    // Skip the command itself if it's on the first line
    if (line === "وسيط" || line === "أدمن" || line === "ادمن") continue;
    
    // Try different parsing patterns
    let phone = null;
    let name = null;
    
    // Pattern 1: "name,number" or "number,name"
    if (line.includes(",")) {
      const parts = line.split(",").map(p => p.trim());
      for (const part of parts) {
        // Check if this part looks like a phone number
        const cleanedPart = part.replace(/[\s\-\(\)\+\.]/g, "");
        if (/^\d{9,15}$/.test(cleanedPart)) {
          phone = part;
        } else if (part.length > 0) {
          name = part;
        }
      }
    }
    // Pattern 2: "+number name" or "number name" or just "number"
    else {
      const parts = line.split(/\s+/);
      for (const part of parts) {
        const cleanedPart = part.replace(/[\s\-\(\)\+\.]/g, "");
        if (/^\d{9,15}$/.test(cleanedPart) || part.startsWith("+")) {
          phone = part;
        } else if (part.length > 0 && !phone) {
          // This might be a name before the number
          name = name ? name + " " + part : part;
        } else if (part.length > 0 && phone) {
          // This is name after the number
          name = name ? name + " " + part : part;
        }
      }
    }
    
    // If we found a phone number, add the entry
    if (phone) {
      const normalizedPhone = normalizePhoneNumber(phone);
      if (normalizedPhone) {
        entries.push({
          phone: normalizedPhone,
          name: name || null,
          originalPhone: phone
        });
      }
    }
  }
  
  return entries;
}

/**
 * Load admins from file and update ADMIN_NUMBERS array
 */
async function loadAdminsFromFile() {
  try {
    const adminData = await fs.readFile(ADMINS_FILE, "utf8");
    const parsed = JSON.parse(adminData);
    if (parsed.admins && Array.isArray(parsed.admins)) {
      // Clear and reload
      ADMIN_NUMBERS.length = 0;
      ADMIN_NUMBERS.push(...parsed.admins);
      console.log(
        `✅ Loaded ${ADMIN_NUMBERS.length} admins from file:`,
        ADMIN_NUMBERS
      );

      // Also load lid_mapping for WhatsApp Business accounts
      if (parsed.lid_mapping) {
        lidMapping = parsed.lid_mapping;
        console.log(`✅ Loaded lid_mapping:`, lidMapping);
      }

      return true;
    }
  } catch (err) {
    // File doesn't exist or error reading - save current admins
    console.log("⚠️ No admins file found, creating with default admins");
    try {
      await fs.writeFile(
        ADMINS_FILE,
        JSON.stringify({ admins: ADMIN_NUMBERS, lid_mapping: {} }, null, 2),
        "utf8"
      );
      console.log(`✅ Created admins file with ${ADMIN_NUMBERS.length} admins`);
    } catch (writeErr) {
      console.error("❌ Error creating admins file:", writeErr);
    }
  }
  return false;
}

/**
 * Save admins to file
 */
async function saveAdminsToFile() {
  try {
    await fs.writeFile(
      ADMINS_FILE,
      JSON.stringify({ admins: ADMIN_NUMBERS }, null, 2),
      "utf8"
    );
    console.log(
      `✅ Saved ${ADMIN_NUMBERS.length} admins to file:`,
      ADMIN_NUMBERS
    );
    return true;
  } catch (err) {
    console.error("❌ Error saving admins:", err);
    return false;
  }
}

// Initial load of admins
(async () => {
  await loadAdminsFromFile();
})();

// Message queue for reliable delivery
let isProcessingQueue = false;

/**
 * Process message queue - sends queued messages when connection is stable
 * This runs in background and automatically retries on connection issues
 */
async function processMessageQueue() {
  // Prevent multiple simultaneous processing
  if (isProcessingQueue) {
    console.log("⏭️ Queue processor already running, skipping...");
    return;
  }

  if (!global.messageQueue || global.messageQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;
  console.log(
    `\n🔄 Processing message queue (${global.messageQueue.length} items)...`
  );

  try {
    const botModule = require("../whatsapp/bot");

    // Process each queued item
    while (global.messageQueue.length > 0) {
      const item = global.messageQueue[0]; // Peek at first item

      // Check if item is too old (> 10 minutes)
      if (Date.now() - item.createdAt > 600000) {
        console.log(`⏰ Queue item ${item.id} expired, removing...`);
        global.messageQueue.shift();
        continue;
      }

      // Check connection
      const status = botModule.getConnectionStatus();
      if (status !== "connected") {
        console.log(
          `⏸️ Connection not ready (${status}), pausing queue processor...`
        );
        break; // Exit loop, will retry later
      }

      console.log(`📤 Processing queue item: ${item.id}`);

      try {
        // Send all messages in sequence
        for (let i = 0; i < item.messages.length; i++) {
          const msg = item.messages[i];

          // Wait for specified delay
          if (msg.delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, msg.delay));
          }

          // Send message
          console.log(
            `  → Sending message ${i + 1}/${item.messages.length}...`
          );
          await botModule.sendMessage(item.to, msg.text);
          console.log(`  ✅ Message ${i + 1} sent`);
        }

        console.log(`✅ Queue item ${item.id} completed successfully`);

        // Remove from queue
        global.messageQueue.shift();

        // Wait a bit before next item
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(
          `❌ Failed to process queue item ${item.id}:`,
          error.message
        );

        // Check if connection is lost
        const currentStatus = botModule.getConnectionStatus();
        if (currentStatus !== "connected") {
          console.log(`🔌 Connection lost, stopping queue processor`);
          break; // Stop processing, will retry when connection restored
        }

        // If connection is OK but message failed, retry later
        item.retryCount = (item.retryCount || 0) + 1;
        if (item.retryCount >= 3) {
          console.log(
            `❌ Max retries reached for ${item.id}, removing from queue`
          );
          global.messageQueue.shift();
        } else {
          console.log(
            `⏳ Will retry ${item.id} later (attempt ${item.retryCount}/3)`
          );
          // Move to end of queue
          global.messageQueue.push(global.messageQueue.shift());
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    console.log(
      `✅ Queue processing complete (${global.messageQueue.length} remaining)\n`
    );
  } catch (error) {
    console.error("❌ Queue processor error:", error);
  } finally {
    isProcessingQueue = false;

    // If there are still items, schedule next run
    if (global.messageQueue && global.messageQueue.length > 0) {
      console.log("⏰ Scheduling next queue check in 10 seconds...");
      setTimeout(() => processMessageQueue(), 10000);
    }
  }
}

/**
 * Start queue processor - call this when bot connects
 */
function startQueueProcessor() {
  console.log("🚀 Message queue processor started");

  // Process immediately
  processMessageQueue();

  // Then check every 30 seconds
  setInterval(() => {
    if (global.messageQueue && global.messageQueue.length > 0) {
      processMessageQueue();
    }
  }, 30000);
}

/**
 * Get current date/time in KSA timezone
 * KSA is always UTC+3 (no daylight saving time)
 * @returns {Date} Date object with KSA time
 */
function getKSADate() {
  const now = new Date();
  // Get UTC time
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  // Add KSA offset (UTC+3 = 3 hours = 3 * 60 * 60 * 1000 ms)
  const ksaTime = utcTime + (3 * 60 * 60 * 1000);
  return new Date(ksaTime);
}

/**
 * Format date in KSA timezone
 * @param {number} timestamp - Unix timestamp
 * @param {object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string
 */
function formatKSADate(timestamp, options = {}) {
  return new Date(timestamp).toLocaleString("ar-EG", {
    timeZone: KSA_TIMEZONE,
    ...options,
  });
}

/**
 * Load reminders from file
 */
async function loadReminders() {
  try {
    const data = await fs.readFile(REMINDERS_FILE, "utf8");
    reminders = JSON.parse(data);
  } catch (error) {
    reminders = [];
  }
}

/**
 * Save reminders to file
 */
async function saveReminders() {
  try {
    await fs.writeFile(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
  } catch (error) {
    console.error("❌ Error saving reminders:", error);
  }
}

/**
 * Check if user is admin
 * @param {string} phoneNumber - Phone number (with or without @s.whatsapp.net or @lid)
 * @returns {boolean}
 */
function isAdmin(phoneNumber) {
  // Check if it's a @lid format (WhatsApp Business)
  const isLid = phoneNumber.endsWith("@lid");

  // Clean phone number: remove @s.whatsapp.net, @lid and + prefix
  let cleanNumber = phoneNumber
    .replace("@s.whatsapp.net", "")
    .replace("@lid", "")
    .replace(/^\+/, "");

  // If it's a @lid, check if there's a mapping to a real admin number
  let mappedNumber = null;
  if (isLid && lidMapping[cleanNumber]) {
    mappedNumber = lidMapping[cleanNumber];
    console.log(`🔗 LID ${cleanNumber} mapped to admin: ${mappedNumber}`);
  }

  // Check if the number (or mapped number) is in admin list
  const isAdminUser =
    ADMIN_NUMBERS.includes(cleanNumber) ||
    (mappedNumber && ADMIN_NUMBERS.includes(mappedNumber));

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔐 ADMIN CHECK`);
  console.log(`📱 Original: ${phoneNumber}`);
  console.log(`🧹 Cleaned: ${cleanNumber}`);
  if (isLid) {
    console.log(`📲 Type: WhatsApp Business (@lid)`);
    console.log(`🔗 Mapped to: ${mappedNumber || "NOT MAPPED"}`);
  }
  console.log(`📋 Admin List (${ADMIN_NUMBERS.length} admins):`, ADMIN_NUMBERS);
  console.log(`✅ Result: ${isAdminUser ? "✅ IS ADMIN" : "❌ NOT ADMIN"}`);
  console.log(`${"=".repeat(60)}\n`);

  return isAdminUser;
}

/**
 * Parse reminder command
 * Format: تذكير +201155719115 يوم/تاريخ ساعة رسالة
 * Examples:
 * - تذكير +201155719115 غدا 3:00م اتصل بالعميل
 * - تذكير +201155719115 2025-11-10 14:30 موعد مع العميل
 * - تذكير +201155719115 يوم 5:00م متابعة الطلب
 */
function parseReminderCommand(message) {
  const parts = message.trim().split(/\s+/);

  if (parts.length < 5) {
    return {
      success: false,
      error:
        "❌ صيغة الأمر غير صحيحة\n\n✅ الصيغة الصحيحة:\nتذكير +966xxxxxxxxx يوم/تاريخ ساعة رسالة\n\nمثال:\nتذكير +201155719115 غدا 3:00م اتصل بالعميل",
    };
  }

  const command = parts[0]; // تذكير
  const targetNumber = parts[1]; // +201155719115
  const dateInput = parts[2]; // يوم/غدا/تاريخ
  const timeInput = parts[3]; // 3:00م
  const messageText = parts.slice(4).join(" "); // باقي الرسالة

  // Validate phone number
  if (!targetNumber.startsWith("+") || targetNumber.length < 10) {
    return {
      success: false,
      error:
        "❌ رقم الهاتف غير صحيح\nيجب أن يبدأ بـ + ويكون بصيغة دولية\n\nمثال: +966508007053",
    };
  }

  // Parse date
  const scheduledDate = parseDate(dateInput);
  if (!scheduledDate.success) {
    return {
      success: false,
      error: scheduledDate.error,
    };
  }

  // Parse time
  const scheduledTime = parseTime(timeInput);
  if (!scheduledTime.success) {
    return {
      success: false,
      error: scheduledTime.error,
    };
  }

  // Combine date and time (in KSA timezone)
  // IMPORTANT: Create date in KSA timezone to avoid timezone offset issues
  const year = scheduledDate.date.getFullYear();
  const month = scheduledDate.date.getMonth();
  const day = scheduledDate.date.getDate();

  // Create date string in format that will be interpreted in KSA timezone
  const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(
    day
  ).padStart(2, "0")}T${String(scheduledTime.hours).padStart(2, "0")}:${String(
    scheduledTime.minutes
  ).padStart(2, "0")}:00`;

  // Parse as KSA time by using the timezone offset
  const reminderDateTime = new Date(dateString);
  const ksaOffset = 3 * 60; // KSA is UTC+3
  const localOffset = reminderDateTime.getTimezoneOffset(); // Local offset in minutes (negative for east of UTC)
  const offsetDiff = ksaOffset + localOffset; // Difference between KSA and local time

  // Adjust the time to compensate for timezone difference
  reminderDateTime.setMinutes(reminderDateTime.getMinutes() - offsetDiff);

  // Check if date is in the past (compare actual timestamps)
  // reminderDateTime is already adjusted to be a real timestamp
  if (reminderDateTime.getTime() < Date.now()) {
    return {
      success: false,
      error:
        "❌ لا يمكن جدولة تذكير في الماضي\nالرجاء اختيار تاريخ ووقت مستقبلي\n⏰ الوقت الحالي (KSA): " +
        formatKSADate(Date.now(), {
          hour: "2-digit",
          minute: "2-digit",
        }),
    };
  }

  return {
    success: true,
    data: {
      targetNumber: targetNumber.replace("+", ""),
      scheduledDateTime: reminderDateTime.getTime(),
      message: messageText,
      createdAt: Date.now(),
    },
  };
}

/**
 * Parse date input (يوم، غدا، تاريخ محدد)
 * Uses KSA timezone
 */
function parseDate(dateInput) {
  // Get today in KSA timezone
  const today = getKSADate();
  today.setHours(0, 0, 0, 0);

  // اليوم
  if (dateInput === "اليوم" || dateInput === "يوم") {
    return { success: true, date: today };
  }

  // غدا
  if (dateInput === "غدا" || dateInput === "غداً") {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { success: true, date: tomorrow };
  }

  // بعد غد
  if (dateInput === "بعدغد" || dateInput === "بعد_غد") {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return { success: true, date: dayAfter };
  }

  // تاريخ محدد (YYYY-MM-DD أو DD/MM/YYYY)
  let parsedDate;

  if (dateInput.includes("-")) {
    // Format: YYYY-MM-DD
    parsedDate = new Date(dateInput);
  } else if (dateInput.includes("/")) {
    // Format: DD/MM/YYYY
    const [day, month, year] = dateInput.split("/");
    parsedDate = new Date(year, month - 1, day);
  } else {
    return {
      success: false,
      error:
        "❌ صيغة التاريخ غير صحيحة\n\nالصيغ المدعومة:\n- اليوم\n- غدا\n- بعدغد\n- 2025-11-10\n- 10/11/2025",
    };
  }

  if (isNaN(parsedDate.getTime())) {
    return {
      success: false,
      error: "❌ التاريخ غير صحيح\nالرجاء التحقق من التاريخ المدخل",
    };
  }

  return { success: true, date: parsedDate };
}

/**
 * Parse time input (3:00م، 15:30، 3م)
 */
function parseTime(timeInput) {
  let hours,
    minutes = 0;
  let isPM = false;

  // Check for PM indicator
  if (timeInput.includes("م")) {
    isPM = true;
    timeInput = timeInput.replace("م", "");
  } else if (timeInput.includes("ص")) {
    isPM = false;
    timeInput = timeInput.replace("ص", "");
  }

  // Parse time
  if (timeInput.includes(":")) {
    const [h, m] = timeInput.split(":");
    hours = parseInt(h);
    minutes = parseInt(m);
  } else {
    hours = parseInt(timeInput);
  }

  // Validate
  if (isNaN(hours) || isNaN(minutes)) {
    return {
      success: false,
      error:
        "❌ صيغة الوقت غير صحيحة\n\nالصيغ المدعومة:\n- 3:00م\n- 15:30\n- 3م\n- 14:00",
    };
  }

  // Convert 12-hour to 24-hour
  if (isPM && hours < 12) {
    hours += 12;
  } else if (!isPM && hours === 12) {
    hours = 0;
  }

  // Validate range
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return {
      success: false,
      error: "❌ الوقت غير صحيح\nالساعات: 0-23، الدقائق: 0-59",
    };
  }

  return { success: true, hours, minutes };
}

/**
 * Create a new reminder
 */
async function createReminder(adminNumber, reminderData) {
  const reminder = {
    id: Date.now().toString(),
    createdBy: adminNumber.replace("@s.whatsapp.net", ""),
    targetNumber: reminderData.targetNumber,
    scheduledDateTime: reminderData.scheduledDateTime,
    message: reminderData.message,
    status: "pending", // pending, sent, failed
    createdAt: reminderData.createdAt,
    sentAt: null,
  };

  reminders.push(reminder);
  await saveReminders();

  // Schedule the reminder with the cron scheduler
  try {
    const { scheduleReminder } = require("./reminderScheduler");
    scheduleReminder(reminder);
    console.log(`📅 Scheduled reminder ${reminder.id} for cron execution`);
  } catch (error) {
    console.error(`⚠️ Could not schedule reminder ${reminder.id}:`, error.message);
  }

  return reminder;
}

/**
 * Get all pending reminders
 */
function getPendingReminders() {
  return reminders.filter(
    (r) => r.status === "pending" && r.scheduledDateTime <= Date.now()
  );
}

/**
 * Mark reminder as sent
 */
async function markReminderSent(reminderId, success = true) {
  const reminder = reminders.find((r) => r.id === reminderId);
  if (reminder) {
    reminder.status = success ? "sent" : "failed";
    reminder.sentAt = Date.now();
    await saveReminders();
  }
}

/**
 * Get admin's reminders
 */
function getAdminReminders(adminNumber, limit = 10) {
  const cleanNumber = adminNumber.replace("@s.whatsapp.net", "");
  return reminders
    .filter((r) => r.createdBy === cleanNumber)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/**
 * Delete reminder
 */
async function deleteReminder(reminderId) {
  const index = reminders.findIndex((r) => r.id === reminderId);
  if (index !== -1) {
    // Cancel the scheduled cron job
    try {
      const { cancelScheduledReminder } = require("./reminderScheduler");
      cancelScheduledReminder(reminderId);
    } catch (error) {
      console.error(`⚠️ Could not cancel scheduled job for reminder ${reminderId}:`, error.message);
    }

    reminders.splice(index, 1);
    await saveReminders();
    return true;
  }
  return false;
}

/**
 * Generate admin help message
 */
function getAdminHelpMessage() {
  return `
🔧 *أوامر المسؤول*

━━━━━━━━━━━━━━━━━━━━

*1️⃣ تسجيل طلب عميل*
📝 *الأمر:* طلب
📋 *الصيغة:*
طلب
اسم العميل (اختياري - سطر ثاني)
نوع العقار المطلوب: بيت
الغرض: شراء
حدود السعر: من 500 ألف إلى مليون
المساحة المطلوبة: 450
الأحياء المفضلة: عين موسى
رقم التواصل: 0501234567
مواصفات إضافية: مجلس رجال منفصل

*مثال مع الاسم:*
طلب
يوسف تامر يوسف
نوع العقار المطلوب: دبلكس
الغرض: شراء
حدود السعر: 100000
المساحة المطلوبة: 300
الأحياء المفضلة: النزهه
رقم التواصل: +966508007053

*المميزات:*
• يبحث تلقائياً عن العقارات المطابقة
• يعرض النتائج للإدارة للمراجعة
• يطلب التأكيد قبل الإرسال للعميل
• يحفظ الطلب للتنبيهات المستقبلية
• يفعّل الإشعارات التلقائية

━━━━━━━━━━━━━━━━━━━━

*2️⃣ تأكيد إرسال النتائج للعميل*
📝 *الأمر:* نعم
📋 يتم استخدامه بعد مراجعة نتائج البحث

━━━━━━━━━━━━━━━━━━━━

*3️⃣ إلغاء إرسال النتائج*
📝 *الأمر:* لا
📋 لإلغاء الإرسال والاحتفاظ بالطلب فقط

━━━━━━━━━━━━━━━━━━━━

*4️⃣ إنشاء تذكير*
📝 *الأمر:* تذكير
📋 *الصيغة:* تذكير +رقم تاريخ وقت رسالة

*أمثلة:*
• تذكير +201155719115 اليوم 3:00م اتصل بالعميل
• تذكير +966508007053 غدا 14:30 موعد مهم
• تذكير +201155719115 2025-11-10 9:00ص متابعة الطلب

*صيغ التاريخ:*
- اليوم / يوم
- غدا / غداً
- بعدغد
- 2025-11-10 (YYYY-MM-DD)
- 10/11/2025 (DD/MM/YYYY)

*صيغ الوقت:*
- 3:00م (12-hour with م/ص)
- 15:30 (24-hour)
- 3م (hour only)

━━━━━━━━━━━━━━━━━━━━

*3️⃣ عرض التذكيرات*
📝 *الأمر:* التذكيرات
📋 عرض آخر 10 تذكيرات

━━━━━━━━━━━━━━━━━━━━

*4️⃣ حذف تذكير*
📝 *الأمر:* حذف_تذكير ID
📋 *مثال:* حذف_تذكير 1234567890

━━━━━━━━━━━━━━━━━━━━

*5️⃣ إحصائيات النظام*
📝 *الأمر:* احصائيات
📋 عرض إحصائيات شاملة

━━━━━━━━━━━━━━━━━━━━

*6️⃣ إدارة الإعلانات*
📝 *الأوامر:*
• عدد_الإعلانات - عرض العدد الإجمالي
• آخر_الإعلانات - عرض آخر 5 إعلانات
• حذف_إعلان ID - حذف إعلان محدد

━━━━━━━━━━━━━━━━━━━━

*7️⃣ إدارة العملاء*
📝 *الأوامر:*
• عدد_العملاء - عرض العدد الإجمالي
• العملاء - قائمة بالعملاء
• تفاصيل_عميل +رقم - تفاصيل عميل محدد
• حذف_عميل +رقم - حذف عميل

━━━━━━━━━━━━━━━━━━━━

*8️⃣ إدارة الوسطاء*
📝 *الأوامر:*
• *وسيط* رقم اسم - تعيين وسيط واحد
• *وسيط* ثم قائمة (اسم,رقم) - تعيين وسطاء متعددين
• حذف_وسيط رقم - إزالة وسيط
• قائمة_الوسطاء - عرض جميع الوسطاء
• تفاصيل_وسيط رقم - معلومات وسيط

*أمثلة:*
وسيط 0508007053 أحمد

وسيط
أحمد,0508007053
محمد,0501234567

━━━━━━━━━━━━━━━━━━━━

*9️⃣ إدارة المسؤولين (Admins)*
📝 *الأوامر:*
• *أدمن* رقم - إضافة مسؤول واحد
• *أدمن* ثم قائمة أرقام - إضافة مسؤولين متعددين
• حذف_أدمن رقم - حذف مسؤول
• قائمة_الأدمنز - عرض جميع المسؤولين

*أمثلة:*
أدمن 0508007053

أدمن
0508007053
0501234567

━━━━━━━━━━━━━━━━━━━━

*🔟 إدارة المهتمين*
📝 *الأوامر:*
• *مهتم* [الاهتمام] ثم قائمة (اسم,رقم) - إنشاء مجموعة
• *مهتم* IG001 ثم قائمة (اسم,رقم) - إضافة لمجموعة موجودة
• مجموعات_المهتمين - عرض جميع المجموعات
• تفاصيل_مجموعة IG001 - عرض تفاصيل مجموعة
• حذف_مجموعة IG001 - حذف مجموعة

*مثال إنشاء:*
مهتم فيلا بحي النزهة
أحمد,0508007053
محمد,0501234567

━━━━━━━━━━━━━━━━━━━━

*1️⃣1️⃣ التحكم في البوت*
📝 *الأوامر:* (تدعم رقم واحد أو أكثر)
• توقف رقم - إيقاف البوت عن الرد
• تشغيل رقم - تشغيل البوت
• وسيط رقم - تعيين كوسيط

━━━━━━━━━━━━━━━━━━━━

*1️⃣1️⃣ المساعدة*
📝 *الأمر:* مساعدة / help / أوامر
📋 عرض هذه الرسالة

━━━━━━━━━━━━━━━━━━━━

⏰ *المنطقة الزمنية:* KSA (UTC+3)
📅 جميع التواريخ والأوقات تستخدم توقيت السعودية

💡 *ملاحظة:* لا حاجة لعلامة + قبل الأرقام
  `.trim();
}

/**
 * Handle admin command
 */
async function handleAdminCommand(sock, message, phoneNumber) {
  if (!isAdmin(phoneNumber)) {
    return null; // Not an admin, ignore
  }

  // Check if message is null or empty (media without text)
  if (!message || typeof message !== "string") {
    return null; // No text message, ignore
  }

  const text = message.trim();
  if (!text) {
    return null; // Empty message, ignore
  }

  const command = text.split(/\s+/)[0];

  try {
    // Client request registration command (طلب)
    if (command === "طلب" || text.startsWith("طلب\n")) {
      try {
        const privateChatService = require("./privateChatService");
        const deepSearchService = require("./deepSearchService");

        console.log("\n🔷 ADMIN REGISTERING CLIENT REQUEST 🔷");

        // Parse the request details from admin's message
        const requirements = privateChatService.parseRequirements(text);

        if (!requirements) {
          return "❌ *خطأ في تحليل الطلب*\n\nالرجاء التأكد من صيغة الرسالة:\n\nطلب\nنوع العقار المطلوب: بيت\nالغرض: شراء\nحدود السعر: من 500 ألف إلى مليون\nالمساحة المطلوبة: 450\nالأحياء المفضلة: عين موسى\nرقم التواصل: 0501234567\nمواصفات إضافية: ...";
        }

        // Extract client phone number from requirements
        const clientPhone = requirements.contactNumber?.replace(/\D/g, "");
        if (!clientPhone || clientPhone.length < 9) {
          return "❌ *رقم التواصل غير صحيح*\n\nالرجاء التأكد من وجود رقم هاتف صحيح في حقل (رقم التواصل)";
        }

        // Normalize phone number
        const normalizedPhone = clientPhone.startsWith("966")
          ? clientPhone
          : `966${clientPhone.replace(/^0+/, "")}`;

        // Save client FIRST before searching (so data is saved even if search fails)
        const privateClient = require("../models/privateClient");
        const client = privateClient.getClient(normalizedPhone);

        // Use the parsed client name if available, otherwise keep existing or use default
        const clientName =
          requirements.clientName || client.name || "عميل جديد";

        privateClient.updateClient(normalizedPhone, {
          name: clientName,
          role: "باحث",
          state: "completed",
          requirements: {
            ...requirements,
            additionalSpecs: text,
          },
          propertyOffer: null,
          requestStatus: "active",
          matchHistory: client.matchHistory || [],
          lastNotificationAt: client.lastNotificationAt || null,
          awaitingStillLookingResponse: false,
          registeredByAdmin: true,
          adminPhone: phoneNumber,
        });

        console.log(
          `✅ Client ${normalizedPhone} saved to private_clients.json`
        );

        // Perform deep search immediately
        console.log("🔍 Starting deep search...");
        let results = [];

        try {
          results = await Promise.race([
            deepSearchService.performDeepSearch(requirements, {
              maxResults: 10,
              includeVariations: true,
            }),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Search timeout after 30s")),
                30000
              )
            ),
          ]);
          console.log(
            `📊 Deep search completed: Found ${results.length} properties`
          );
        } catch (searchError) {
          console.error("❌ Deep search failed:", searchError.message);
          return `✅ *تم حفظ الطلب بنجاح*\n\n❌ فشل البحث: ${searchError.message}\n\n📱 رقم العميل: +${normalizedPhone}\n🔔 سيتم إرسال التنبيهات التلقائية عند توفر عقارات جديدة`;
        }

        // Build response with results
        if (results.length === 0) {
          return `✅ *تم حفظ الطلب بنجاح*\n\n⚠️ *لم يتم العثور على عقارات مطابقة حالياً*\n\n📋 *تفاصيل الطلب:*\n• نوع العقار: ${
            requirements.propertyType || "غير محدد"
          }\n• الغرض: ${
            requirements.purpose || "غير محدد"
          }\n• السعر: ${requirements.priceMin?.toLocaleString()} - ${requirements.priceMax?.toLocaleString()} ريال\n• المساحة: ${
            requirements.areaMin
          } - ${requirements.areaMax} م²\n• الأحياء: ${
            requirements.neighborhoods?.join("، ") || "غير محدد"
          }\n\n📱 رقم العميل: +${normalizedPhone}\n🔔 سيتم إرسال التنبيهات التلقائية للعميل`;
        }

        // Send results to admin for review
        let adminMsg = `✅ *تم حفظ الطلب وإيجاد ${results.length} عقار مطابق*\n\n`;
        adminMsg += `👤 *اسم العميل:* ${clientName}\n`;
        adminMsg += `📱 *رقم العميل:* +${normalizedPhone}\n\n`;
        adminMsg += `📋 *تفاصيل الطلب:*\n`;
        adminMsg += `• نوع العقار: ${
          requirements.propertyType || "غير محدد"
        }\n`;
        adminMsg += `• الغرض: ${requirements.purpose || "غير محدد"}\n`;

        // Display price range if available
        if (requirements.priceMin !== null && requirements.priceMax !== null) {
          adminMsg += `• السعر: ${requirements.priceMin.toLocaleString()} - ${requirements.priceMax.toLocaleString()} ريال\n`;
        } else if (requirements.priceMax !== null) {
          adminMsg += `• السعر: حتى ${requirements.priceMax.toLocaleString()} ريال\n`;
        } else if (requirements.priceMin !== null) {
          adminMsg += `• السعر: من ${requirements.priceMin.toLocaleString()} ريال\n`;
        }

        // Display area range if available
        if (requirements.areaMin !== null && requirements.areaMax !== null) {
          adminMsg += `• المساحة: ${requirements.areaMin} - ${requirements.areaMax} م²\n`;
        } else if (requirements.areaMax !== null) {
          adminMsg += `• المساحة: حتى ${requirements.areaMax} م²\n`;
        } else if (requirements.areaMin !== null) {
          adminMsg += `• المساحة: من ${requirements.areaMin} م²\n`;
        }

        if (requirements.neighborhoods?.length > 0) {
          adminMsg += `• الأحياء: ${requirements.neighborhoods.join("، ")}\n`;
        }

        adminMsg += `\n━━━━━━━━━━━━━━━━\n`;
        adminMsg += `📊 *النتائج (${results.length} عقار):*\n`;

        // Store pending request FIRST (before trying to send anything)
        if (!global.pendingClientRequests) {
          global.pendingClientRequests = {};
        }

        global.pendingClientRequests[phoneNumber] = {
          clientPhone: normalizedPhone,
          results: results, // Store all results
          adminPhone: phoneNumber,
          createdAt: Date.now(),
          adminMsg: adminMsg, // Store admin message
          requirements: requirements, // Store requirements
        };
        console.log(`✅ Pending request stored for admin ${phoneNumber}`);

        // NEW APPROACH: Queue messages instead of trying to send immediately
        // This avoids connection stability issues completely
        console.log("📋 Queueing messages for delayed sending...");

        // Build consolidated properties message (show all results)
        let propertiesMsg = "";
        for (let i = 0; i < results.length; i++) {
          const privateChatService = require("./privateChatService");
          const post = results[i];
          const formattedMsg = privateChatService.formatPostAsMessage(
            post,
            i + 1
          );
          propertiesMsg += formattedMsg + "\n\n━━━━━━━━━━━━━━━━\n\n";
        }

        const confirmMsg = `\n━━━━━━━━━━━━━━━━\n\n❓ *هل تريد إرسال هذه العقارات للعميل (+${normalizedPhone})?*\n\n✅ للإرسال: *نعم*\n❌ للإلغاء: *لا*`;

        // Queue messages with timestamps
        if (!global.messageQueue) {
          global.messageQueue = [];
        }

        const queueId = `${phoneNumber}_${Date.now()}`;
        global.messageQueue.push({
          id: queueId,
          to: `${phoneNumber}@s.whatsapp.net`,
          messages: [
            { text: adminMsg, delay: 0 },
            { text: propertiesMsg.trim(), delay: 2000 },
            { text: confirmMsg, delay: 2000 },
          ],
          createdAt: Date.now(),
          status: "pending",
        });

        console.log(`✅ Messages queued with ID: ${queueId}`);
        console.log(`📤 Message queue will be processed by background worker`);

        // Trigger queue processing (non-blocking)
        setTimeout(() => processMessageQueue(), 1000);

        // Return immediately - messages will be sent in background
        return null; // Messages will be sent by queue processor
      } catch (adminCommandError) {
        console.error("❌ Error in admin طلب command:", adminCommandError);
        return `❌ *حدث خطأ في معالجة الطلب*\n\n${adminCommandError.message}\n\nالرجاء المحاولة مرة أخرى`;
      }
    }

    // Handle send confirmation (نعم) for client requests
    // Skip if there are other pending confirmations that should handle this
    if (command === "نعم" || text.trim() === "نعم") {
      // Check if other confirmations should handle this first
      if (pendingWaseetConfirmations[phoneNumber] || 
          pendingAdminConfirmations[phoneNumber] || 
          pendingInterestConfirmations[phoneNumber]) {
        // Let other handlers process this - don't return here
        // Continue to the specific handlers below
      } else {
        try {
          if (
            !global.pendingClientRequests ||
            !global.pendingClientRequests[phoneNumber]
          ) {
            return "❌ *لا يوجد طلب معلق*\n\nالرجاء إنشاء طلب جديد باستخدام الأمر: طلب";
          }

        const request = global.pendingClientRequests[phoneNumber];
        const { clientPhone, results } = request;

        console.log(`✅ Admin confirmed sending to client: ${clientPhone}`);

        // Import bot module to use its sendMessage (current socket)
        const botModule = require("../whatsapp/bot");
        const privateChatService = require("./privateChatService");

        // Send to client - ALL IN ONE MESSAGE
        const clientJid = `${clientPhone}@s.whatsapp.net`;
        let clientMessage = `*السلام عليكم ورحمة الله وبركاته* 👋\n\nوجدنا لك ${results.length} عقار يطابق مواصفاتك:\n\n━━━━━━━━━━━━━━━━\n\n`;

        // Consolidate all properties in one message
        for (let i = 0; i < results.length; i++) {
          const post = results[i];
          const formattedMsg = privateChatService.formatPostAsMessage(
            post,
            i + 1
          );
          clientMessage += formattedMsg + "\n\n━━━━━━━━━━━━━━━━\n\n";
        }

        clientMessage += `✅ *تم حفظ طلبك*\n\n🔔 سنرسل لك تلقائياً أي عقارات جديدة تطابق مواصفاتك 🏠`;

        // Send everything in one message
        await botModule.sendMessage(clientJid, clientMessage);

        // Clean up
        delete global.pendingClientRequests[phoneNumber];

        return `✅ *تم إرسال ${results.length} عقار للعميل بنجاح*\n\n📱 رقم العميل: +${clientPhone}\n🔔 التنبيهات التلقائية مفعّلة`;
      } catch (sendError) {
        console.error("❌ Error sending to client:", sendError);
        return `❌ *فشل الإرسال للعميل*\n\n${sendError.message}`;
      }
      }  // Close the else block
    }  // Close the if (command === "نعم")

    // Handle cancel confirmation (لا)
    if (command === "لا" || text.trim() === "لا") {
      try {
        if (
          !global.pendingClientRequests ||
          !global.pendingClientRequests[phoneNumber]
        ) {
          return "❌ *لا يوجد طلب معلق*";
        }

        const request = global.pendingClientRequests[phoneNumber];
        delete global.pendingClientRequests[phoneNumber];

        return `✅ *تم إلغاء الإرسال*\n\n📱 رقم العميل: +${request.clientPhone}\n\n💡 الطلب محفوظ وسيتم إرسال التنبيهات التلقائية`;
      } catch (cancelError) {
        return `❌ خطأ في الإلغاء: ${cancelError.message}`;
      }
    }

    // Help command
    if (
      command === "مساعدة" ||
      command === "help" ||
      command === "أوامر" ||
      command === "اوامر" ||
      command === "Help"
    ) {
      return getAdminHelpMessage();
    }

    // Reminder command
    if (command === "تذكير") {
      const parsed = parseReminderCommand(text);
      if (!parsed.success) {
        return parsed.error;
      }

      const reminder = await createReminder(phoneNumber, parsed.data);

      return `✅ *تم إنشاء التذكير بنجاح*

📱 *رقم المستلم:* +${reminder.targetNumber}
📅 *التاريخ:* ${formatKSADate(reminder.scheduledDateTime, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}
🕐 *الوقت:* ${formatKSADate(reminder.scheduledDateTime, {
        hour: "2-digit",
        minute: "2-digit",
      })}
💬 *الرسالة:* ${reminder.message}
⏰ *المنطقة الزمنية:* KSA (UTC+3)

🆔 *رقم التذكير:* ${reminder.id}`;
    }

    // List reminders
    if (command === "التذكيرات" || command === "قائمة_التذكيرات") {
      const adminReminders = getAdminReminders(phoneNumber);

      if (adminReminders.length === 0) {
        return "📭 لا توجد تذكيرات";
      }

      let response = "*📋 التذكيرات (آخر 10)*\n";
      response += "*⏰ المنطقة الزمنية: KSA (UTC+3)*\n\n";
      adminReminders.forEach((r, i) => {
        const statusEmoji =
          r.status === "pending" ? "⏳" : r.status === "sent" ? "✅" : "❌";
        response += `${i + 1}. ${statusEmoji} *+${r.targetNumber}*\n`;
        response += `   📅 ${formatKSADate(r.scheduledDateTime, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}\n`;
        response += `   💬 ${r.message.substring(0, 40)}${
          r.message.length > 40 ? "..." : ""
        }\n`;
        response += `   🆔 ${r.id}\n\n`;
      });

      return response;
    }

    // Delete reminder
    if (command === "حذف_تذكير") {
      const reminderId = text.split(/\s+/)[1];
      if (!reminderId) {
        return "❌ الرجاء تحديد رقم التذكير\nمثال: حذف_تذكير 1234567890";
      }

      const deleted = await deleteReminder(reminderId);
      return deleted
        ? "✅ تم حذف التذكير بنجاح"
        : "❌ لم يتم العثور على التذكير";
    }

    // Stats command
    if (command === "احصائيات" || command === "stats") {
      return await getSystemStats();
    }

    // Ads management
    if (command === "عدد_الإعلانات") {
      const botModule = require("../whatsapp/bot");
      const ads = botModule.getFetchedAds();
      return `📊 *عدد الإعلانات الإجمالي:* ${ads.length}`;
    }

    if (command === "آخر_الإعلانات") {
      const botModule = require("../whatsapp/bot");
      const ads = botModule.getFetchedAds();
      const latest = ads.slice(-5).reverse();

      if (latest.length === 0) {
        return "📭 لا توجد إعلانات";
      }

      let response = "*📋 آخر 5 إعلانات*\n\n";
      latest.forEach((ad, i) => {
        // Extract data from wpData.meta if available, otherwise use root level
        const category =
          ad.category || ad.wpData?.meta?.arc_category || "غير محدد";
        const neighborhood =
          ad.wpData?.meta?.neighborhood ||
          ad.wpData?.meta?.location ||
          "غير محدد";
        const price =
          ad.wpData?.meta?.price_amount || ad.wpData?.meta?.price || "غير محدد";
        const status = ad.status || "جديد";
        const source = ad.source === "private_chat" ? "📱 خاص" : "👥 مجموعة";

        response += `${i + 1}. *${category}*\n`;
        response += `   📍 ${neighborhood}\n`;
        response += `   💰 ${price}\n`;
        response += `   � ${status}\n`;
        response += `   ${source}\n`;
        response += `   🆔 ${ad.id}\n\n`;
      });

      return response;
    }

    // Client management
    if (command === "عدد_العملاء") {
      const privateClient = require("../models/privateClient");
      const clients = privateClient.getAllClients() || {};
      return `📊 *عدد العملاء الإجمالي:* ${Object.keys(clients).length}`;
    }

    if (command === "العملاء") {
      const privateClient = require("../models/privateClient");
      const clients = privateClient.getAllClients() || {};
      const clientsArray = Object.values(clients).slice(0, 10);

      if (clientsArray.length === 0) {
        return "📭 لا يوجد عملاء";
      }

      let response = "*📋 العملاء (أول 10)*\n\n";
      clientsArray.forEach((c, i) => {
        response += `${i + 1}. *${c.name || "بدون اسم"}*\n`;
        response += `   📱 +${c.phoneNumber}\n`;
        response += `   🎭 ${c.role || "غير محدد"}\n`;
        response += `   📊 ${getStateText(c.state)}\n\n`;
      });

      return response;
    }

    // Client details
    if (command === "تفاصيل_عميل") {
      const phoneNumber = text.split(/\s+/)[1];
      if (!phoneNumber) {
        return "❌ الرجاء تحديد رقم الهاتف\nمثال: تفاصيل_عميل +201090952790";
      }

      const privateClient = require("../models/privateClient");
      const cleanNumber = phoneNumber.replace(/^\+/, "");
      const client = privateClient.getClient(cleanNumber);

      if (!client) {
        return `❌ لم يتم العثور على عميل برقم ${phoneNumber}`;
      }

      let response = `📋 *تفاصيل العميل*\n\n`;
      response += `👤 *الاسم:* ${client.name || "غير محدد"}\n`;
      response += `📱 *الهاتف:* +${client.phoneNumber}\n`;
      response += `🎭 *الدور:* ${client.role || "غير محدد"}\n`;
      response += `📊 *الحالة:* ${getStateText(client.state)}\n`;
      response += `📅 *تاريخ الإنشاء:* ${formatKSADate(client.createdAt, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}\n`;
      response += `🕐 *آخر تحديث:* ${formatKSADate(
        client.updatedAt || client.createdAt,
        {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }
      )}\n\n`;

      // Show requirements or property offer
      if (client.role === "باحث" && client.requirements) {
        const req =
          typeof client.requirements === "string"
            ? client.requirements
            : JSON.stringify(client.requirements, null, 2);
        response += `📝 *المتطلبات:*\n${req}\n\n`;
      } else if (client.role === "مالك" && client.propertyOffer) {
        const offer =
          typeof client.propertyOffer === "string"
            ? client.propertyOffer
            : JSON.stringify(client.propertyOffer, null, 2);
        response += `🏠 *عرض العقار:*\n${offer}\n\n`;
      }

      return response;
    }

    // Delete client
    if (command === "حذف_عميل") {
      const phoneNumber = text.split(/\s+/)[1];
      if (!phoneNumber) {
        return "❌ الرجاء تحديد رقم الهاتف\nمثال: حذف_عميل +201090952790";
      }

      const privateClient = require("../models/privateClient");
      const cleanNumber = phoneNumber.replace(/^\+/, "");

      // Check if client exists
      const client = privateClient.getClient(cleanNumber);
      if (!client) {
        return `❌ لم يتم العثور على عميل برقم ${phoneNumber}`;
      }

      // Delete the client
      const deleted = privateClient.deleteClient(cleanNumber);

      if (deleted) {
        return `✅ *تم حذف العميل بنجاح*\n\n👤 ${
          client.name || "غير محدد"
        }\n📱 +${client.phoneNumber}`;
      } else {
        return "❌ فشل حذف العميل";
      }
    }

    // ============================================
    // WASEET MANAGEMENT COMMANDS
    // ============================================

    // Handle waseet confirmation (تأكيد or نعم_وسيط)
    if (command === "تأكيد_وسيط" || (command === "نعم" && pendingWaseetConfirmations[phoneNumber])) {
      if (!pendingWaseetConfirmations[phoneNumber]) {
        return "❌ لا توجد قائمة وسطاء معلقة للتأكيد";
      }

      const pending = pendingWaseetConfirmations[phoneNumber];
      const entries = pending.entries;
      let addedCount = 0;

      for (const entry of entries) {
        waseetDetector.markAsWaseet(entry.phone, entry.name);
        addedCount++;
      }

      delete pendingWaseetConfirmations[phoneNumber];

      let response = `✅ *تم إضافة ${addedCount} وسيط بنجاح*\n\n`;
      entries.forEach((e, i) => {
        response += `${i + 1}. 👤 ${e.name || "غير محدد"} - 📱 +${e.phone}\n`;
      });
      response += `\n💡 سيتم فحص رسائلهم تلقائياً للإعلانات`;

      return response;
    }

    // Handle waseet cancellation
    if (command === "إلغاء_وسيط" || (command === "لا" && pendingWaseetConfirmations[phoneNumber])) {
      if (pendingWaseetConfirmations[phoneNumber]) {
        delete pendingWaseetConfirmations[phoneNumber];
        return "✅ تم إلغاء إضافة الوسطاء";
      }
    }

    // Add waseet - NEW simplified "وسيط" command with multiple entry support
    if (command === "وسيط") {
      // Get remaining text after command
      const remainingText = text.substring(command.length).trim();

      // Check if it's a single-line format: وسيط +966508007053 أحمد
      const singleLineMatch = remainingText.match(/^(\+?\d[\d\s\-\(\)]+)(.*)$/);
      
      if (singleLineMatch) {
        // Single entry mode
        const phoneRaw = singleLineMatch[1].trim();
        const name = singleLineMatch[2].trim() || null;
        const normalizedPhone = normalizePhoneNumber(phoneRaw);

        if (!normalizedPhone) {
          return "❌ الرجاء تحديد رقم هاتف صحيح\nمثال: وسيط 0508007053 أحمد";
        }

        // Check if already exists
        if (waseetDetector.isWaseet(normalizedPhone)) {
          return `⚠️ +${normalizedPhone} مسجل بالفعل كوسيط`;
        }

        waseetDetector.markAsWaseet(normalizedPhone, name);
        return `✅ *تم إضافة وسيط جديد*\n\n📱 *الرقم:* +${normalizedPhone}\n👤 *الاسم:* ${name || "غير محدد"}\n\n💡 سيتم فحص رسائله تلقائياً للإعلانات`;
      }

      // Multi-line format - parse all entries
      const entries = parseFlexibleEntries(text, true);

      if (entries.length === 0) {
        return `❌ *لم يتم العثور على أرقام صحيحة*\n\n📝 *الصيغ المدعومة:*\n\n*رقم واحد:*\nوسيط 0508007053 أحمد\n\n*عدة أرقام:*\nوسيط\nأحمد,0508007053\nمحمد,0501234567\n\n*أو:*\nوسيط\n0508007053 أحمد\n0501234567 محمد`;
      }

      // Filter out already existing waseets
      const newEntries = entries.filter(e => !waseetDetector.isWaseet(e.phone));
      const existingCount = entries.length - newEntries.length;

      if (newEntries.length === 0) {
        return `⚠️ جميع الأرقام (${entries.length}) مسجلة بالفعل كوسطاء`;
      }

      // Store for confirmation
      pendingWaseetConfirmations[phoneNumber] = {
        entries: newEntries,
        createdAt: Date.now()
      };

      let response = `📋 *تأكيد إضافة ${newEntries.length} وسيط*\n\n`;
      newEntries.forEach((e, i) => {
        response += `${i + 1}. 👤 ${e.name || "غير محدد"} - 📱 +${e.phone}\n`;
      });

      if (existingCount > 0) {
        response += `\n⚠️ تم تجاهل ${existingCount} رقم مسجل مسبقاً\n`;
      }

      response += `\n━━━━━━━━━━━━━━━━━━━━\n`;
      response += `✅ أرسل *نعم* للتأكيد\n`;
      response += `❌ أرسل *لا* للإلغاء`;

      return response;
    }

    // Keep old command for backwards compatibility (will be removed later)
    if (
      command === "إضافة_وسيط" ||
      command === "اضافة_وسيط" ||
      command === "اضافه_وسيط"
    ) {
      const parts = text.split(/\s+/);
      let phoneNumber = parts[1];

      let nameStartIndex = 2;
      for (let i = 2; i < parts.length; i++) {
        if (/^[\d+]+$/.test(parts[i])) {
          phoneNumber += parts[i];
          nameStartIndex = i + 1;
        } else {
          break;
        }
      }

      const name = parts.slice(nameStartIndex).join(" ");

      if (!phoneNumber) {
        return "❌ الرجاء تحديد رقم الهاتف\nمثال: وسيط 0508007053 أحمد";
      }

      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      waseetDetector.markAsWaseet(normalizedPhone, name || null);
      return `✅ *تم إضافة وسيط جديد*\n\n📱 *الرقم:* +${normalizedPhone}\n👤 *الاسم:* ${name || "غير محدد"}\n\n💡 استخدم الأمر الجديد: *وسيط*`;
    }


    // Remove waseet
    if (command === "حذف_وسيط") {
      const phoneRaw = text.split(/\s+/)[1];
      if (!phoneRaw) {
        return "❌ الرجاء تحديد رقم الهاتف\nمثال: حذف_وسيط 0508007053";
      }

      const normalizedPhone = normalizePhoneNumber(phoneRaw);
      const waseetInfo = waseetDetector.getWaseetInfo(normalizedPhone);
      if (!waseetInfo) {
        return `❌ +${normalizedPhone} ليس مسجلاً كوسيط`;
      }

      waseetDetector.unmarkAsWaseet(normalizedPhone);
      return `✅ تم إزالة ${waseetInfo.name || "+" + normalizedPhone} من قائمة الوسطاء`;
    }

    // List waseet
    if (command === "قائمة_الوسطاء" || command === "الوسطاء") {
      const waseetList = waseetDetector.listAllWaseet();

      if (waseetList.length === 0) {
        return "📭 لا يوجد وسطاء مسجلين\n\nلإضافة وسيط:\nوسيط 0508007053 الاسم";
      }

      let response = `📋 *قائمة الوسطاء (${waseetList.length})*\n\n`;
      waseetList.forEach((w, i) => {
        response += `${i + 1}. *${w.name || "غير محدد"}*\n`;
        response += `   📱 +${w.phone}\n`;
        response += `   📊 إعلانات مستلمة: ${w.totalAdsReceived || 0}\n`;
        response += `   📅 تاريخ الإضافة: ${formatKSADate(w.addedAt, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}\n`;
        if (w.lastAdAt) {
          response += `   📤 آخر إعلان: ${formatKSADate(w.lastAdAt, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}\n`;
        }
        response += `\n`;
      });

      return response;
    }

    // Waseet details
    if (command === "تفاصيل_وسيط") {
      const phoneRaw = text.split(/\s+/)[1];
      if (!phoneRaw) {
        return "❌ الرجاء تحديد رقم الهاتف\nمثال: تفاصيل_وسيط 0508007053";
      }

      const normalizedPhone = normalizePhoneNumber(phoneRaw);
      const waseetInfo = waseetDetector.getWaseetInfo(normalizedPhone);
      if (!waseetInfo) {
        return `❌ +${normalizedPhone} ليس مسجلاً كوسيط`;
      }

      let response = `📋 *تفاصيل الوسيط*\n\n`;
      response += `👤 *الاسم:* ${waseetInfo.name || "غير محدد"}\n`;
      response += `📱 *الهاتف:* +${normalizedPhone}\n`;
      response += `📊 *إعلانات مستلمة:* ${waseetInfo.totalAdsReceived || 0}\n`;
      response += `📅 *تاريخ الإضافة:* ${formatKSADate(waseetInfo.addedAt, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}\n`;

      if (waseetInfo.lastAdAt) {
        response += `📤 *آخر إعلان:* ${formatKSADate(waseetInfo.lastAdAt, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}\n`;
      }

      return response;
    }

    // ============================================
    // ADMIN MANAGEMENT COMMANDS
    // ============================================

    // Handle admin confirmation (تأكيد_أدمن or نعم when pending)
    if (command === "تأكيد_أدمن" || (command === "نعم" && pendingAdminConfirmations[phoneNumber])) {
      if (!pendingAdminConfirmations[phoneNumber]) {
        return "❌ لا توجد قائمة أدمنز معلقة للتأكيد";
      }

      const pending = pendingAdminConfirmations[phoneNumber];
      const entries = pending.entries;
      let addedCount = 0;
      const addedPhones = [];

      for (const entry of entries) {
        if (!ADMIN_NUMBERS.includes(entry.phone)) {
          ADMIN_NUMBERS.push(entry.phone);
          addedPhones.push(entry.phone);
          addedCount++;
        }
      }

      delete pendingAdminConfirmations[phoneNumber];

      if (addedCount > 0) {
        await saveAdminsToFile();
      }

      let response = `✅ *تم إضافة ${addedCount} أدمن بنجاح*\n\n`;
      addedPhones.forEach((phone, i) => {
        response += `${i + 1}. 📱 +${phone}\n`;
      });
      response += `\n✨ عدد الأدمنز الحالي: ${ADMIN_NUMBERS.length}`;

      return response;
    }

    // Handle admin cancellation
    if (command === "إلغاء_أدمن" || (command === "لا" && pendingAdminConfirmations[phoneNumber])) {
      if (pendingAdminConfirmations[phoneNumber]) {
        delete pendingAdminConfirmations[phoneNumber];
        return "✅ تم إلغاء إضافة الأدمنز";
      }
    }

    // Add admin - NEW simplified "أدمن" command with multiple number support
    if (command === "أدمن" || command === "ادمن") {
      // Get remaining text after command
      const remainingText = text.substring(command.length).trim();

      // Check if it's a single-line format: أدمن +966508007053
      const singleLineMatch = remainingText.match(/^(\+?\d[\d\s\-\(\)]+)$/);
      
      if (singleLineMatch) {
        // Single entry mode
        const phoneRaw = singleLineMatch[1].trim();
        const normalizedPhone = normalizePhoneNumber(phoneRaw);

        if (!normalizedPhone) {
          return "❌ الرجاء تحديد رقم هاتف صحيح\nمثال: أدمن 0508007053";
        }

        // Check if already exists
        if (ADMIN_NUMBERS.includes(normalizedPhone)) {
          return `⚠️ +${normalizedPhone} مسجل بالفعل كأدمن`;
        }

        ADMIN_NUMBERS.push(normalizedPhone);
        const saved = await saveAdminsToFile();

        if (!saved) {
          ADMIN_NUMBERS.pop();
          return "❌ فشل حفظ الأدمن الجديد";
        }

        return `✅ *تم إضافة أدمن جديد*\n\n📱 *الرقم:* +${normalizedPhone}\n\n🔐 *الصلاحيات:*\n• الوصول لجميع أوامر البوت\n• إدارة العملاء والإعلانات\n\n✨ عدد الأدمنز الحالي: ${ADMIN_NUMBERS.length}`;
      }

      // Multi-line format - parse all entries (just numbers, no names needed)
      const entries = parseFlexibleEntries(text, false);

      if (entries.length === 0) {
        return `❌ *لم يتم العثور على أرقام صحيحة*\n\n📝 *الصيغ المدعومة:*\n\n*رقم واحد:*\nأدمن 0508007053\n\n*عدة أرقام:*\nأدمن\n0508007053\n0501234567`;
      }

      // Filter out already existing admins
      const newEntries = entries.filter(e => !ADMIN_NUMBERS.includes(e.phone));
      const existingCount = entries.length - newEntries.length;

      if (newEntries.length === 0) {
        return `⚠️ جميع الأرقام (${entries.length}) مسجلة بالفعل كأدمنز`;
      }

      // Store for confirmation
      pendingAdminConfirmations[phoneNumber] = {
        entries: newEntries,
        createdAt: Date.now()
      };

      let response = `📋 *تأكيد إضافة ${newEntries.length} أدمن*\n\n`;
      newEntries.forEach((e, i) => {
        response += `${i + 1}. 📱 +${e.phone}\n`;
      });

      if (existingCount > 0) {
        response += `\n⚠️ تم تجاهل ${existingCount} رقم مسجل مسبقاً\n`;
      }

      response += `\n━━━━━━━━━━━━━━━━━━━━\n`;
      response += `✅ أرسل *نعم* للتأكيد\n`;
      response += `❌ أرسل *لا* للإلغاء`;

      return response;
    }

    // Keep old command for backwards compatibility
    if (
      command === "إضافة_أدمن" ||
      command === "اضافة_ادمن" ||
      command === "اضافه_ادمن"
    ) {
      const parts = text.split(/\s+/);
      let phoneNumber = parts[1];

      let nameStartIndex = 2;
      for (let i = 2; i < parts.length; i++) {
        if (/^[\d+]+$/.test(parts[i])) {
          phoneNumber += parts[i];
          nameStartIndex = i + 1;
        } else {
          break;
        }
      }

      const name = parts.slice(nameStartIndex).join(" ");

      if (!phoneNumber) {
        return "❌ الرجاء تحديد رقم الهاتف\nمثال: أدمن 0508007053";
      }

      const normalizedPhone = normalizePhoneNumber(phoneNumber);

      if (ADMIN_NUMBERS.includes(normalizedPhone)) {
        return `⚠️ +${normalizedPhone} مسجل بالفعل كأدمن`;
      }

      ADMIN_NUMBERS.push(normalizedPhone);
      const saved = await saveAdminsToFile();

      if (!saved) {
        ADMIN_NUMBERS.pop();
        return "❌ فشل حفظ الأدمن الجديد";
      }

      return `✅ *تم إضافة أدمن جديد*\n\n📱 *الرقم:* +${normalizedPhone}\n👤 *الاسم:* ${name || "غير محدد"}\n\n💡 استخدم الأمر الجديد: *أدمن*\n\n✨ عدد الأدمنز الحالي: ${ADMIN_NUMBERS.length}`;
    }


    // Remove admin
    if (command === "حذف_أدمن" || command === "حذف_ادمن") {
      const phoneRaw = text.split(/\s+/)[1];
      if (!phoneRaw) {
        return "❌ الرجاء تحديد رقم الهاتف\nمثال: حذف_أدمن 0508007053";
      }

      // Normalize phone number
      const normalizedPhone = normalizePhoneNumber(phoneRaw);

      console.log(`➖ Removing admin: ${phoneRaw} -> normalized: ${normalizedPhone}`);
      console.log(`📋 Current admins before remove:`, ADMIN_NUMBERS);

      // Check if admin exists
      const adminIndex = ADMIN_NUMBERS.indexOf(normalizedPhone);
      if (adminIndex === -1) {
        return `❌ +${normalizedPhone} ليس مسجلاً كأدمن`;
      }

      // Prevent removing the last admin
      if (ADMIN_NUMBERS.length === 1) {
        return "❌ لا يمكن حذف آخر أدمن في النظام";
      }

      // Remove from list
      ADMIN_NUMBERS.splice(adminIndex, 1);
      console.log(`📋 Current admins after remove:`, ADMIN_NUMBERS);

      // Save to file using helper function
      const saved = await saveAdminsToFile();

      if (!saved) {
        // Rollback if save failed
        ADMIN_NUMBERS.splice(adminIndex, 0, normalizedPhone);
        return "❌ فشل حذف الأدمن، الرجاء المحاولة مرة أخرى";
      }

      return `✅ تم حذف +${normalizedPhone} من قائمة الأدمنز\n\n✨ عدد الأدمنز المتبقي: ${ADMIN_NUMBERS.length}`;
    }

    // List admins
    if (
      command === "قائمة_الأدمنز" ||
      command === "الأدمنز" ||
      command === "قائمة_الادمنز"
    ) {
      let response = `👥 *قائمة الأدمنز (${ADMIN_NUMBERS.length})*\n\n`;

      ADMIN_NUMBERS.forEach((admin, index) => {
        response += `${index + 1}. 📱 +${admin}\n`;
      });

      response += `\n💡 *الأوامر المتاحة:*\n`;
      response += `• أدمن رقم - إضافة أدمن\n`;
      response += `• حذف_أدمن رقم - حذف أدمن\n`;

      return response;
    }

    // Admin help command
    if (command === "مساعدة" || command === "الأوامر" || command === "help") {
      let response = `🤖 *أوامر الأدمن المتاحة*\n\n`;

      response += `👥 *إدارة الأدمنز:*\n`;
      response += `• أدمن رقم - إضافة أدمن\n`;
      response += `• حذف_أدمن رقم\n`;
      response += `• قائمة_الأدمنز\n\n`;

      response += `👤 *إدارة العملاء:*\n`;
      response += `• طلب (تسجيل طلب عميل)\n`;
      response += `• تفاصيل_عميل رقم\n`;
      response += `• حذف_عميل رقم\n\n`;

      response += `🤝 *إدارة الوسطاء:*\n`;
      response += `• وسيط رقم اسم - إضافة وسيط\n`;
      response += `• حذف_وسيط رقم\n`;
      response += `• قائمة_الوسطاء\n`;
      response += `• تفاصيل_وسيط رقم\n\n`;

      response += `📊 *معلومات النظام:*\n`;
      response += `• احصائيات (عرض إحصائيات النظام)\n\n`;


      response += `⏰ *التذكيرات:*\n`;
      response += `• تذكير +966xxx تاريخ وقت الرسالة\n`;
      response += `• قائمة_التذكيرات\n`;
      response += `• حذف_تذكير [رقم]\n\n`;

      response += `💡 *نصيحة:* يمكنك كتابة أي أمر للحصول على مزيد من التفاصيل`;

      return response;
    }

    // ============================================
    // INTEREST GROUPS COMMANDS (مهتم)
    // ============================================

    // Handle interest confirmation
    if (command === "نعم" && pendingInterestConfirmations[phoneNumber]) {
      const pending = pendingInterestConfirmations[phoneNumber];
      const entries = pending.entries;
      
      let result;
      if (pending.groupId) {
        // Adding to existing group
        result = await interestGroupService.addToGroup(pending.groupId, entries);
        delete pendingInterestConfirmations[phoneNumber];
        
        if (!result) {
          return `❌ المجموعة ${pending.groupId} غير موجودة`;
        }
        
        let response = `✅ *تم إضافة ${result.addedCount} عضو إلى ${pending.groupId}*\n\n`;
        response += `📋 *الاهتمام:* ${result.group.interest}\n`;
        response += `👥 *إجمالي الأعضاء:* ${result.group.members.length}\n`;
        if (result.skippedCount > 0) {
          response += `⚠️ تم تجاهل ${result.skippedCount} رقم موجود مسبقاً`;
        }
        return response;
      } else {
        // Creating new group
        const group = await interestGroupService.createGroup(pending.interest, entries, phoneNumber);
        delete pendingInterestConfirmations[phoneNumber];
        
        let response = `✅ *تم إنشاء مجموعة مهتمين جديدة*\n\n`;
        response += `🆔 *رقم المجموعة:* ${group.id}\n`;
        response += `📋 *الاهتمام:* ${group.interest}\n`;
        response += `👥 *عدد الأعضاء:* ${group.members.length}\n\n`;
        response += `💡 لإضافة أعضاء لاحقاً:\nمهتم ${group.id}\nاسم,رقم`;
        return response;
      }
    }

    // Handle interest cancellation
    if (command === "لا" && pendingInterestConfirmations[phoneNumber]) {
      delete pendingInterestConfirmations[phoneNumber];
      return "✅ تم إلغاء العملية";
    }

    // مهتم command - create new group or add to existing
    if (command === "مهتم") {
      const lines = text.split("\n").map(l => l.trim()).filter(l => l);
      
      if (lines.length < 2) {
        return `❌ *صيغة غير صحيحة*\n\n📝 *لإنشاء مجموعة جديدة:*\nمهتم [الاهتمام]\nاسم,رقم\nاسم,رقم\n\n📝 *لإضافة لمجموعة موجودة:*\nمهتم IG001\nاسم,رقم`;
      }

      const firstArg = lines[0].replace("مهتم", "").trim();
      
      // Check if first arg is a group ID
      if (interestGroupService.isGroupId(firstArg)) {
        const groupId = firstArg.toUpperCase();
        const group = interestGroupService.getGroup(groupId);
        
        if (!group) {
          return `❌ المجموعة ${groupId} غير موجودة\n\n💡 لعرض المجموعات: مجموعات_المهتمين`;
        }

        // Parse members from remaining lines
        const entries = parseFlexibleEntries(lines.slice(1).join("\n"), true);
        
        if (entries.length === 0) {
          return `❌ لم يتم العثور على أرقام صحيحة\n\nالصيغة المطلوبة:\nمهتم ${groupId}\nاسم,رقم`;
        }

        // Store for confirmation
        pendingInterestConfirmations[phoneNumber] = {
          groupId,
          entries,
          createdAt: Date.now()
        };

        let response = `📋 *تأكيد إضافة ${entries.length} عضو إلى ${groupId}*\n\n`;
        response += `📌 *الاهتمام:* ${group.interest}\n\n`;
        entries.forEach((e, i) => {
          response += `${i + 1}. ${e.name || "غير محدد"} - +${e.phone}\n`;
        });
        response += `\n━━━━━━━━━━━━━━━━━━━━\n`;
        response += `✅ أرسل *نعم* للتأكيد\n❌ أرسل *لا* للإلغاء`;
        return response;

      } else {
        // Creating new group - firstArg is the interest text
        if (!firstArg) {
          return `❌ الرجاء تحديد نص الاهتمام\n\nمثال:\nمهتم فيلا بحي النزهة\nأحمد,0508007053`;
        }

        // Parse members from remaining lines
        const entries = parseFlexibleEntries(lines.slice(1).join("\n"), true);
        
        if (entries.length === 0) {
          return `❌ لم يتم العثور على أرقام صحيحة\n\nالصيغة المطلوبة:\nمهتم ${firstArg}\nاسم,رقم`;
        }

        // Store for confirmation
        pendingInterestConfirmations[phoneNumber] = {
          interest: firstArg,
          entries,
          createdAt: Date.now()
        };

        let response = `📋 *تأكيد إنشاء مجموعة مهتمين*\n\n`;
        response += `📌 *الاهتمام:* ${firstArg}\n`;
        response += `👥 *الأعضاء (${entries.length}):*\n\n`;
        entries.forEach((e, i) => {
          response += `${i + 1}. ${e.name || "غير محدد"} - +${e.phone}\n`;
        });
        response += `\n━━━━━━━━━━━━━━━━━━━━\n`;
        response += `✅ أرسل *نعم* للتأكيد\n❌ أرسل *لا* للإلغاء`;
        return response;
      }
    }

    // List interest groups
    if (command === "مجموعات_المهتمين" || command === "المهتمين") {
      const groups = interestGroupService.getAllGroups();
      
      if (groups.length === 0) {
        return `📭 لا توجد مجموعات مهتمين\n\n💡 لإنشاء مجموعة:\nمهتم [الاهتمام]\nاسم,رقم`;
      }

      let response = `📋 *مجموعات المهتمين (${groups.length})*\n\n`;
      groups.forEach(g => {
        response += `🆔 *${g.id}*\n`;
        response += `📌 ${g.interest}\n`;
        response += `👥 ${g.members.length} عضو\n`;
        response += `📅 ${formatKSADate(g.createdAt, { month: "short", day: "numeric" })}\n\n`;
      });
      
      response += `\n💡 لعرض تفاصيل:\nتفاصيل_مجموعة IG001`;
      return response;
    }

    // Group details
    if (command === "تفاصيل_مجموعة") {
      const groupId = text.split(/\s+/)[1];
      if (!groupId) {
        return "❌ الرجاء تحديد رقم المجموعة\nمثال: تفاصيل_مجموعة IG001";
      }

      const group = interestGroupService.getGroup(groupId);
      if (!group) {
        return `❌ المجموعة ${groupId} غير موجودة`;
      }

      let response = `📋 *تفاصيل المجموعة ${group.id}*\n\n`;
      response += `📌 *الاهتمام:* ${group.interest}\n`;
      response += `📅 *تاريخ الإنشاء:* ${formatKSADate(group.createdAt)}\n\n`;
      response += `👥 *الأعضاء (${group.members.length}):*\n`;
      group.members.forEach((m, i) => {
        response += `${i + 1}. ${m.name || "غير محدد"} - +${m.phone}\n`;
      });
      return response;
    }

    // Delete interest group
    if (command === "حذف_مجموعة") {
      const groupId = text.split(/\s+/)[1];
      if (!groupId) {
        return "❌ الرجاء تحديد رقم المجموعة\nمثال: حذف_مجموعة IG001";
      }

      const deleted = await interestGroupService.deleteGroup(groupId);
      if (!deleted) {
        return `❌ المجموعة ${groupId} غير موجودة`;
      }
      return `✅ تم حذف المجموعة ${groupId.toUpperCase()}`;
    }

    return null; // Unknown command
  } catch (error) {
    console.error("❌ Error handling admin command:", error);
    return "❌ حدث خطأ أثناء تنفيذ الأمر";
  }
}

/**
 * Get system statistics
 */
async function getSystemStats() {
  try {
    const botModule = require("../whatsapp/bot");
    const ads = botModule.getFetchedAds();
    const privateClient = require("../models/privateClient");
    const clients = privateClient.getAllClients() || {};
    const clientsArray = Object.values(clients);

    const stats = {
      totalAds: ads.length,
      totalClients: clientsArray.length,
      clientsByRole: {},
      clientsByState: {},
      pendingReminders: reminders.filter((r) => r.status === "pending").length,
      totalReminders: reminders.length,
    };

    // Count by role
    clientsArray.forEach((c) => {
      if (c.role) {
        stats.clientsByRole[c.role] = (stats.clientsByRole[c.role] || 0) + 1;
      }
    });

    // Count by state
    clientsArray.forEach((c) => {
      if (c.state) {
        stats.clientsByState[c.state] =
          (stats.clientsByState[c.state] || 0) + 1;
      }
    });

    let response = `📊 *إحصائيات النظام*\n\n`;
    response += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `🏠 *الإعلانات:* ${stats.totalAds}\n\n`;
    response += `👥 *العملاء:* ${stats.totalClients}\n`;

    if (Object.keys(stats.clientsByRole).length > 0) {
      response += `\n*توزيع العملاء حسب الدور:*\n`;
      for (const [role, count] of Object.entries(stats.clientsByRole)) {
        response += `  • ${role}: ${count}\n`;
      }
    }

    response += `\n⏰ *التذكيرات:*\n`;
    response += `  • المعلقة: ${stats.pendingReminders}\n`;
    response += `  • الإجمالي: ${stats.totalReminders}\n\n`;
    response += `━━━━━━━━━━━━━━━━━━━━\n`;
    response += `🕐 *المنطقة الزمنية:* KSA (UTC+3)\n`;
    response += `📅 *الوقت الحالي:* ${formatKSADate(Date.now(), {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}\n`;

    return response;
  } catch (error) {
    console.error("Error getting stats:", error);
    return "❌ حدث خطأ أثناء جمع الإحصائيات";
  }
}

/**
 * Get state text in Arabic
 */
function getStateText(state) {
  const stateMap = {
    initial: "مبدئي",
    awaiting_name: "بانتظار الاسم",
    awaiting_role: "بانتظار الدور",
    awaiting_requirements: "بانتظار المتطلبات",
    completed: "مكتمل",
  };
  return stateMap[state] || state;
}

// Load reminders on startup
loadReminders();

module.exports = {
  isAdmin,
  handleAdminCommand,
  getPendingReminders,
  markReminderSent,
  getAdminHelpMessage,
  processMessageQueue,
  startQueueProcessor,
  loadAdminsFromFile,
  saveAdminsToFile,
  ADMIN_NUMBERS, // Export for direct access if needed
  // Reminder functions for API
  loadReminders,
  saveReminders,
  createReminder,
  deleteReminder,
  getAdminReminders,
  getAllReminders: () => reminders, // Export getter for all reminders
  updateReminder: async (id, updates) => {
    const index = reminders.findIndex(r => r.id === id);
    if (index === -1) return null;
    reminders[index] = { ...reminders[index], ...updates };
    await saveReminders();

    // Reschedule if the reminder is still pending
    if (reminders[index].status === "pending") {
      try {
        const { scheduleReminder } = require("./reminderScheduler");
        scheduleReminder(reminders[index]);
        console.log(`📅 Rescheduled reminder ${id} after update`);
      } catch (error) {
        console.error(`⚠️ Could not reschedule reminder ${id}:`, error.message);
      }
    }

    return reminders[index];
  },
  getReminderById: (id) => reminders.find(r => r.id === id),
};
