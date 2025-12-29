/**
 * Reminder Scheduler Service
 * Checks and sends pending reminders
 * Timezone: Asia/Riyadh (KSA Time - UTC+3)
 */

const {
  getPendingReminders,
  markReminderSent,
} = require("./adminCommandService");

// KSA Timezone
const KSA_TIMEZONE = "Asia/Riyadh";

let sock = null;
let checkInterval = null;

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
 * Initialize reminder scheduler
 * @param {object} sockInstance - WhatsApp socket instance
 */
function initScheduler(sockInstance) {
  sock = sockInstance;

  // Check every minute
  checkInterval = setInterval(checkAndSendReminders, 60000);

  console.log("✅ Reminder scheduler started");

  // Initial check
  checkAndSendReminders();
}

/**
 * Check and send pending reminders
 */
async function checkAndSendReminders() {
  if (!sock) return;

  try {
    const pendingReminders = getPendingReminders();

    if (pendingReminders.length > 0) {
      console.log(`📬 Found ${pendingReminders.length} pending reminders`);
    }

    for (const reminder of pendingReminders) {
      try {
        const targetJid = `${reminder.targetNumber}@s.whatsapp.net`;

        // Format date in KSA timezone
        const ksaDateStr = formatKSADate(reminder.scheduledDateTime, {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        // Send the reminder message
        const messageText = `⏰ *تذكير*\n\n${reminder.message}\n\n━━━━━━━━━━━━━━━━━━━━\n📅 ${ksaDateStr}\n⏰ KSA Time (UTC+3)`;

        await sock.sendMessage(targetJid, { text: messageText });

        // Mark as sent
        await markReminderSent(reminder.id, true);

        console.log(
          `✅ Reminder sent to +${reminder.targetNumber} (KSA Time: ${ksaDateStr})`
        );

        // Notify the admin who created it
        const adminJid = `${reminder.createdBy}@s.whatsapp.net`;
        await sock.sendMessage(adminJid, {
          text: `✅ *تم إرسال التذكير*\n\nإلى: +${reminder.targetNumber}\nالرسالة: ${reminder.message}\n📅 ${ksaDateStr}`,
        });
      } catch (error) {
        console.error(`❌ Error sending reminder ${reminder.id}:`, error);
        await markReminderSent(reminder.id, false);
      }
    }
  } catch (error) {
    console.error("❌ Error checking reminders:", error);
  }
}

/**
 * Stop the scheduler
 */
function stopScheduler() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    console.log("⏹️ Reminder scheduler stopped");
  }
}

module.exports = {
  initScheduler,
  stopScheduler,
};
