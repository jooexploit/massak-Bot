const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  generateWAMessageFromContent,
  proto,
} = require("@whiskeysockets/baileys");
const P = require("pino");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

// ============================================
// 🔌 CENTRALIZED SOCKET MANAGER
// Single source of truth for socket state
// Fixes zombie connections caused by stale references
// ============================================
const socketManager = require("./socketManager");

// ============================================
// 🛠️ SESSION REPAIR SYSTEM
// Detects "Bad MAC" errors in real-time and triggers recovery
// This is critical for handling WhatsApp's LID (Link ID) migration
// ============================================
let badMacDetectionCount = 0;
let lastBadMacAt = 0;
let sessionResetScheduled = false;
let softRepairAttempted = false; // Track if we've already tried a soft repair

// ============================================
// 🔌 ZOMBIE CONNECTION DETECTION SYSTEM
// Tracks WebSocket state and detects mismatches between
// connectionStatus and actual WebSocket state
// ============================================
const PENDING_NOTIFICATIONS_FILE = path.join(
  __dirname,
  "..",
  "data",
  "pending_notifications.json"
);
let lastWebSocketState = null;
let webSocketCloseCode = null;
let webSocketCloseReason = null;
let lastWebSocketError = null;
let zombieDetectionCount = 0;
let lastZombieCheckAt = 0;
let lastReconnectAttempt = 0; // Track last reconnect time for cooldown
const MIN_RECONNECT_INTERVAL_MS = 120000; // 2 minutes minimum between reconnects

// ============================================
// STATE MACHINE - Connection Lifecycle
// ============================================
const ConnectionPhase = {
  INIT: "init", // Before any connection attempt
  CONNECTING: "connecting", // Connection in progress
  WARMING: "warming", // Connected but warming up Signal/Crypto (5-10s)
  STABLE: "stable", // Fully ready for sends
};

let currentPhase = ConnectionPhase.INIT; // Current connection phase
let phaseStartedAt = 0; // When current phase started
const SESSION_WARMUP_DURATION_MS = 8000; // 8 seconds for Signal ratchet stabilization

/**
 * Transition to new connection phase
 * INIT → CONNECTING → WARMING → STABLE
 */
function setConnectionPhase(newPhase) {
  const oldPhase = currentPhase;
  currentPhase = newPhase;
  phaseStartedAt = Date.now();

  console.log(
    `\n🎭 [PHASE] ${oldPhase.toUpperCase()} → ${newPhase.toUpperCase()}`
  );

  if (newPhase === ConnectionPhase.WARMING) {
    console.log(`   ⏳ Session warmup for ${SESSION_WARMUP_DURATION_MS}ms...`);
    console.log(`   🚫 Schedulers & queue PAUSED`);
  } else if (newPhase === ConnectionPhase.STABLE) {
    console.log(`   ✅ Session stable - Schedulers & queue RESUMED`);
  }

  logConnectionState(`PHASE_${newPhase}`, { oldPhase });
}

/**
 * Check if system is in a sending-ready state
 * Returns true only when STABLE (not INIT, CONNECTING, or WARMING)
 */
function isReadyToSend() {
  if (currentPhase !== ConnectionPhase.STABLE) {
    return false;
  }
  return socketManager.isConnected();
}

// Connection state machine
const ConnectionState = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  QR_PENDING: "qr_pending",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
  ZOMBIE: "zombie", // Connected status but dead socket
};

/**
 * Get human-readable WebSocket state
 * @returns {string} WebSocket state name
 */
function getWebSocketState() {
  if (!sock || !sock.ws) return "NO_SOCKET";
  const states = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
  return states[sock.ws.readyState] || "UNKNOWN";
}

/**
 * Get WebSocket readyState number
 * @returns {number} WebSocket readyState (0-3) or -1 if no socket/ws not accessible
 */
function getWebSocketReadyState() {
  if (!sock) return -1;
  // Some Baileys versions don't expose sock.ws directly
  if (!sock.ws) return -1;
  return sock.ws.readyState;
}

/**
 * Check if the connection is in a zombie state
 * (connectionStatus says connected but WebSocket is ACTUALLY dead)
 *
 * NOTE: Only triggers if we can CONFIRM the WebSocket is dead (state 2 or 3).
 * If sock.ws is not accessible (returns -1), we can't determine zombie state
 * and should NOT trigger false positives.
 *
 * @returns {boolean}
 */
function isZombieConnection() {
  if (connectionStatus !== "connected") return false;

  const wsState = getWebSocketReadyState();

  // WebSocket states: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
  // -1 means sock.ws is not accessible (not a zombie, just Baileys internal structure)

  // DON'T trigger zombie if we can't access the WebSocket
  if (wsState === -1) {
    return false; // Can't determine state - NOT a zombie indicator
  }

  // Only trigger zombie if WebSocket is CLOSING (2) or CLOSED (3)
  const isZombie = wsState >= 2;

  if (isZombie) {
    zombieDetectionCount++;
    console.error(
      `🧟 [ZOMBIE] Detected! connectionStatus='connected' but WS state=${getWebSocketState()} (${wsState})`
    );
  }

  return isZombie;
}

/**
 * Queue an admin notification for delivery after reconnection
 * This ensures notifications aren't lost when the connection dies
 * @param {string} message - The notification message
 * @param {string} jid - Target JID (defaults to ADMIN_NOTIFICATION_JID)
 */
function queueAdminNotification(message, jid = null) {
  try {
    let pending = [];
    if (fs.existsSync(PENDING_NOTIFICATIONS_FILE)) {
      try {
        pending = JSON.parse(
          fs.readFileSync(PENDING_NOTIFICATIONS_FILE, "utf8") || "[]"
        );
      } catch (e) {
        pending = [];
      }
    }

    pending.push({
      id: `notif_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      message,
      jid: jid || ADMIN_NOTIFICATION_JID,
      queuedAt: Date.now(),
      queuedAtISO: new Date().toISOString(),
    });

    // Keep only last 20 notifications
    if (pending.length > 20) {
      pending = pending.slice(-20);
    }

    fs.writeFileSync(
      PENDING_NOTIFICATIONS_FILE,
      JSON.stringify(pending, null, 2)
    );
    console.log(
      `📝 [QUEUE] Admin notification queued for delivery after reconnection`
    );
  } catch (e) {
    console.error(`❌ [QUEUE] Failed to queue notification: ${e.message}`);
  }
}

/**
 * 🌡️ Send WhatsApp alerts to admin on critical events
 * Events: Disconnect, Reconnect, Phase transitions, Bad MAC storms
 */
function sendAdminAlert(event, details = {}) {
  try {
    const timestamp = new Date().toLocaleString("ar-SA", {
      timeZone: "Asia/Riyadh",
    });

    let alertMessage = "";

    if (event === "DISCONNECT") {
      // When bot disconnects - log queue status and last activity
      const messageQueue = require("../services/messageQueue");
      const queueStats = messageQueue ? messageQueue.getStats() : {};

      alertMessage =
        `🔌 *[تنبيه قطع الاتصال]*\n\n` +
        `⏰ الوقت: ${timestamp}\n` +
        `❌ الحالة: تم قطع اتصال البوت\n` +
        `📊 السبب: ${details.reason || "غير معروف"}\n` +
        `🔄 رقم المحاولة: ${details.attempts || 0}\n` +
        `📨 الرسائل المعالجة: ${totalMessagesProcessed}\n` +
        `📬 الرسائل المتبقية في الطابور: ${
          queueStats.currentQueueSize || 0
        }\n` +
        `🌡️ الحالة الحالية: ${currentPhase.toUpperCase()}\n` +
        `📝 ملاحظات: سيتم إعادة الاتصال تلقائياً`;

      queueAdminNotification(alertMessage);
    } else if (event === "RECONNECT") {
      // When bot reconnects successfully
      alertMessage =
        `✅ *[تنبيه إعادة الاتصال]*\n\n` +
        `⏰ الوقت: ${timestamp}\n` +
        `✅ الحالة: تم إعادة الاتصال بنجاح\n` +
        `🔢 محاولات: ${details.attempts || 0}\n` +
        `📱 المستخدم: ${details.userId || "غير معروف"}\n` +
        `🌡️ الحالة الحالية: ${currentPhase.toUpperCase()}\n` +
        `📬 سيتم معالجة الرسائل المعلقة تلقائياً`;

      queueAdminNotification(alertMessage);
    } else if (event === "PHASE_WARMING") {
      // During warmup phase - optional logging
      console.log(
        `🌡️ [ALERT] Entering WARMING phase for session stabilization`
      );
    } else if (event === "PHASE_STABLE") {
      // When bot becomes stable and ready
      console.log(`✅ [ALERT] Bot is now STABLE and ready to send messages`);
    } else if (event === "BAD_MAC_STORM") {
      // Too many Bad MAC errors - critical
      alertMessage =
        `⚠️ *[تنبيه عاصفة Bad MAC]*\n\n` +
        `⏰ الوقت: ${timestamp}\n` +
        `⚠️ تم اكتشاف ${details.count || 5} أخطاء Bad MAC متتالية\n` +
        `🌡️ الحالة الحالية: ${currentPhase.toUpperCase()}\n` +
        `📊 يشير هذا إلى مشكلة في تشفير الجلسة\n` +
        `🔄 سيتم إعادة تهيئة الاتصال`;

      queueAdminNotification(alertMessage);
    }
  } catch (e) {
    console.error(`❌ Error sending admin alert: ${e.message}`);
  }
}

/**
 * Deliver all pending notifications after successful reconnection
 * 🌡️ CRITICAL: Waits for STABLE phase before sending to avoid Bad MAC errors
 */
async function deliverPendingNotifications() {
  try {
    if (!fs.existsSync(PENDING_NOTIFICATIONS_FILE)) return;

    const pending = JSON.parse(
      fs.readFileSync(PENDING_NOTIFICATIONS_FILE, "utf8") || "[]"
    );
    if (pending.length === 0) return;

    console.log(
      `📬 [QUEUE] Waiting for STABLE phase before delivering ${pending.length} notification(s)...`
    );

    // 🌡️ CRITICAL: Wait for STABLE phase before sending
    // This prevents Bad MAC errors from Signal ratchet instability
    let waitAttempts = 0;
    const maxWaitAttempts = 120; // Max 120 attempts = 60 seconds
    while (
      currentPhase !== ConnectionPhase.STABLE &&
      waitAttempts < maxWaitAttempts
    ) {
      console.log(
        `   ⏳ Waiting for STABLE phase (current: ${currentPhase})...`
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      waitAttempts++;
    }

    if (currentPhase !== ConnectionPhase.STABLE) {
      console.error(
        `❌ [QUEUE] Timeout waiting for STABLE phase. Current phase: ${currentPhase}`
      );
      return; // Don't send if not stable - try again on next reconnect
    }

    console.log(
      `✅ [QUEUE] Phase is STABLE. Delivering ${pending.length} pending notification(s)...`
    );

    for (const notification of pending) {
      try {
        // Add prefix to show it was queued
        const prefixedMessage = `📬 *[إشعار معلق]*\n⏰ ${new Date(
          notification.queuedAt
        ).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}\n\n${
          notification.message
        }`;
        await sendMessage(notification.jid, prefixedMessage);
        console.log(`  ✅ Delivered notification ${notification.id}`);

        // Small delay between notifications
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (e) {
        console.error(
          `  ❌ Failed to deliver notification ${notification.id}: ${e.message}`
        );
      }
    }

    // Clear the queue
    fs.writeFileSync(PENDING_NOTIFICATIONS_FILE, "[]");
    console.log(`✅ [QUEUE] All pending notifications delivered`);
  } catch (e) {
    console.error(
      `❌ [QUEUE] Error delivering pending notifications: ${e.message}`
    );
  }
}

/**
 * Log connection state with full details for debugging
 * @param {string} event - Event name
 * @param {object} details - Additional details
 */
function logConnectionState(event, details = {}) {
  const timestamp = new Date().toISOString();
  const wsState = getWebSocketState();
  const wsReadyState = getWebSocketReadyState();

  console.log(
    `\n╔═══════════════════════════════════════════════════════════╗`
  );
  console.log(`║ 🔌 CONNECTION STATE LOG                                   ║`);
  console.log(`╠═══════════════════════════════════════════════════════════╣`);
  console.log(`║ Time: ${timestamp}`);
  console.log(`║ Event: ${event}`);
  console.log(`║ Status: ${connectionStatus}`);
  console.log(`║ WebSocket: ${wsState} (readyState=${wsReadyState})`);
  console.log(
    `║ Reconnect Attempts: ${reconnectAttempts}/${maxReconnectAttempts}`
  );
  console.log(`║ Is Reconnecting: ${isReconnecting}`);
  console.log(`║ Init In Progress: ${initInProgress}`);
  console.log(`║ Messages Processed: ${totalMessagesProcessed}`);
  console.log(
    `║ Ping Failures: ${consecutivePingFailures}/${MAX_PING_FAILURES}`
  );

  if (details && Object.keys(details).length > 0) {
    console.log(`║ Details: ${JSON.stringify(details)}`);
  }

  console.log(
    `╚═══════════════════════════════════════════════════════════╝\n`
  );
}

const createDiagnosticLogger = (level = "silent") => {
  const baseLogger = P({ level });

  // Create a wrapper that scans logs for the "Bad MAC" error string
  const wrapper = {
    level: baseLogger.level,
    silent: (...args) => baseLogger.silent(...args),
    trace: (...args) => baseLogger.trace(...args),
    debug: (...args) => baseLogger.debug(...args),
    info: (...args) => baseLogger.info(...args),
    warn: (...args) => baseLogger.warn(...args),
    error: (...args) => {
      const msg = args[0];
      const errorStr =
        typeof msg === "string" ? msg : msg?.msg || JSON.stringify(msg);

      if (
        errorStr &&
        (errorStr.includes("Bad MAC") || errorStr.includes("Failed to decrypt"))
      ) {
        badMacDetectionCount++;
        lastBadMacAt = Date.now();
        console.error(
          `🚨 [SESSION ISSUE] Decryption error detected! Count: ${badMacDetectionCount}`
        );

        // If we see too many Bad MACs, schedule a session repair/reset
        if (badMacDetectionCount >= 5 && !sessionResetScheduled) {
          sessionResetScheduled = true;
          console.error(
            "🚨 [SESSION ISSUE] Persistent decryption errors detected."
          );
          console.error(
            `🔄 [SESSION ISSUE] Will auto-${
              softRepairAttempted ? "RESET" : "REPAIR"
            } session on next health check...`
          );
        }
      }
      return baseLogger.error(...args);
    },
    fatal: (...args) => baseLogger.fatal(...args),
    child: (...args) => baseLogger.child(...args),
  };

  return wrapper;
};

// ============================================
// 📦 MESSAGE CACHE FOR RETRY HANDLING
// Simple in-memory cache for message retry operations
// ============================================
const MESSAGE_CACHE_MAX_SIZE = 1000;
const messageCache = new Map();
// Store file path (used for clearing corrupted data during session repair)
const STORE_FILE = path.join(__dirname, "..", "data", "baileys_store.json");

/**
 * Cache a message for potential retry operations
 * @param {object} key - Message key with remoteJid and id
 * @param {object} message - The message object
 */
function cacheMessage(key, message) {
  const cacheKey = `${key.remoteJid}:${key.id}`;
  messageCache.set(cacheKey, message);

  // Limit cache size
  if (messageCache.size > MESSAGE_CACHE_MAX_SIZE) {
    const keysToDelete = Array.from(messageCache.keys()).slice(0, 100);
    keysToDelete.forEach((k) => messageCache.delete(k));
  }
}

/**
 * Get a cached message for retry operations
 * @param {object} key - Message key with remoteJid and id
 * @returns {object|undefined} The cached message or undefined
 */
function getCachedMessage(key) {
  const cacheKey = `${key.remoteJid}:${key.id}`;
  return messageCache.get(cacheKey);
}

const { processMessage } = require("../services/aiService");
const messageQueue = require("../services/messageQueue");
const privateChatService = require("../services/privateChatService");
const linkPreviewService = require("../services/linkPreviewService");
const adminCommandService = require("../services/adminCommandService");
const reminderScheduler = require("../services/reminderScheduler");
const waseetDetector = require("../services/waseetDetector");
const websiteConfig = require("../config/website.config");

let sock;
let qrCodeData = null;
let connectionStatus = "disconnected";
let currentQR = null;

// Reconnection tracking
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let reconnectTimeout = null;
let isReconnecting = false;
// Guard: prevent concurrent initializeBot calls that can create duplicate sessions
let initInProgress = false;
// Cross-process init lock (prevents two Node processes from opening the same Baileys session)
const AUTH_DIR = path.join(__dirname, "..", "auth_info_baileys");
const INIT_LOCK_FILE = path.join(AUTH_DIR, ".init.lock");

function acquireInitLock() {
  try {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
    const fd = fs.openSync(INIT_LOCK_FILE, "wx"); // atomic create
    const payload = JSON.stringify({ pid: process.pid, ts: Date.now() });
    fs.writeFileSync(fd, payload);
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === "EEXIST") {
      try {
        const raw = fs.readFileSync(INIT_LOCK_FILE, "utf8");
        const { pid, ts } = JSON.parse(raw || "{}");
        let ownerAlive = false;
        if (pid) {
          try {
            process.kill(pid, 0);
            ownerAlive = true;
          } catch {
            ownerAlive = false;
          }
        }
        const stale = !ts || Date.now() - ts > 120000; // 2 min
        if (!ownerAlive || stale) {
          fs.rmSync(INIT_LOCK_FILE, { force: true });
          return acquireInitLock();
        }
      } catch {
        try {
          fs.rmSync(INIT_LOCK_FILE, { force: true });
        } catch {}
        return acquireInitLock();
      }
    }
    return false;
  }
}

function releaseInitLock() {
  try {
    fs.rmSync(INIT_LOCK_FILE, { force: true });
  } catch {}
}

// ============================================
// 🧹 CENTRALIZED CLEANUP & SOCKET UPDATE
// These functions ensure all services get proper cleanup/updates
// when the connection changes state
// ============================================

/**
 * Clean up all schedulers and intervals when connection closes.
 * This prevents stale socket references from causing zombie connections.
 *
 * CRITICAL FIX: Now uses socketManager to cancel ALL tracked jobs
 * including cron jobs, timeouts, and intervals across all services.
 */
function cleanupAllSchedulers() {
  console.log("🧹 Cleaning up all schedulers and intervals...");

  // CRITICAL: Cancel ALL tracked scheduled jobs via socket manager
  // This catches any jobs that services may have registered
  try {
    socketManager.cancelAllScheduledJobs();
    console.log("  ✅ Socket manager cleared all tracked jobs");
  } catch (e) {
    console.warn("  ⚠️ Error in socket manager cleanup:", e.message);
  }

  // Stop reminder scheduler (also clears its internal jobs)
  try {
    reminderScheduler.stopScheduler();
    console.log("  ✅ Reminder scheduler stopped");
  } catch (e) {
    console.warn("  ⚠️ Error stopping reminder scheduler:", e.message);
  }

  // Stop message scheduler (also clears its internal jobs)
  try {
    const messageSchedulerService = require("../services/messageSchedulerService");
    messageSchedulerService.stopScheduler();
    console.log("  ✅ Message scheduler stopped");
  } catch (e) {
    console.warn("  ⚠️ Error stopping message scheduler:", e.message);
  }

  // Stop scheduled WhatsApp service
  try {
    const scheduledWhatsappService = require("../services/scheduledWhatsappService");
    if (scheduledWhatsappService.stopScheduler) {
      scheduledWhatsappService.stopScheduler();
    }
    console.log("  ✅ Scheduled WhatsApp service stopped");
  } catch (e) {
    console.warn("  ⚠️ Error stopping scheduled WhatsApp service:", e.message);
  }

  // Clear keepalive ping interval
  if (keepalivePingInterval) {
    clearInterval(keepalivePingInterval);
    keepalivePingInterval = null;
    console.log("  ✅ Keepalive ping interval cleared");
  }

  // Clear health check interval
  if (messageHandlerHealthCheckInterval) {
    clearInterval(messageHandlerHealthCheckInterval);
    messageHandlerHealthCheckInterval = null;
    console.log("  ✅ Health check interval cleared");
  }

  console.log("✅ All schedulers and intervals cleaned up");
}

function updateAllServicesSocket(newSock) {
  console.log("🔄 Updating socket in all services...");

  // CRITICAL: Update centralized socket manager FIRST
  socketManager.setSocket(newSock);
  socketManager.setConnectionStatus(connectionStatus);
  socketManager.setSendFunctions(sendMessage, sendImage);
  console.log("  ✅ Socket manager updated with socket and send functions");

  // Update reminder scheduler
  try {
    reminderScheduler.updateSocket(newSock);
    console.log("  ✅ Reminder scheduler socket updated");
  } catch (e) {
    console.warn("  ⚠️ Error updating reminder scheduler socket:", e.message);
  }

  // Update message scheduler
  try {
    const messageSchedulerService = require("../services/messageSchedulerService");
    messageSchedulerService.updateSocket(newSock, sendMessage, sendImage);
    console.log("  ✅ Message scheduler socket updated");
  } catch (e) {
    console.warn("  ⚠️ Error updating message scheduler socket:", e.message);
  }

  // Update scheduled WhatsApp messages service
  try {
    const scheduledWhatsappService = require("../services/scheduledWhatsappService");
    scheduledWhatsappService.updateSocket(newSock, sendMessage, sendImage);
    console.log("  ✅ Scheduled WhatsApp messages service socket updated");
  } catch (e) {
    console.warn(
      "  ⚠️ Error updating scheduled WhatsApp service socket:",
      e.message
    );
  }

  console.log("✅ All services updated with new socket");
}

/**
 * Perform a "Soft Repair" of sessions.
 * Deletes individual session and sender-key files but preserves creds.json.
 * This fixes most decryption errors without losing the login (QR scan).
 */
function softRepairSessions() {
  console.log("🛠️ [SOFT REPAIR] Attempting to repair corrupted sessions...");
  try {
    const authPath = path.join(__dirname, "..", "auth_info_baileys");
    if (!fs.existsSync(authPath)) return;

    const files = fs.readdirSync(authPath);
    let deletedCount = 0;

    for (const file of files) {
      // Delete session files and sender key files
      // Preserving creds.json, app-state-sync tags, and pre-keys
      if (file.startsWith("session-") || file.startsWith("sender-key-")) {
        fs.rmSync(path.join(authPath, file), { force: true });
        deletedCount++;
      }
    }

    // Also clear the store file as it might contain corrupted message data
    if (fs.existsSync(STORE_FILE)) {
      fs.rmSync(STORE_FILE, { force: true });
      console.log("  ✅ Message store cleared");
    }

    console.log(
      `✅ [SOFT REPAIR] Deleted ${deletedCount} corrupted session/key files.`
    );
    console.log(
      "📋 Primary credentials preserved. No QR scan should be required."
    );
    softRepairAttempted = true;
    return true;
  } catch (error) {
    console.error("❌ [SOFT REPAIR] Failed:", error.message);
    return false;
  }
}

// Ads storage (simple JSON file)
const ADS_FILE = path.join(__dirname, "..", "data", "ads.json");
const COLLECTIONS_FILE = path.join(__dirname, "..", "data", "collections.json");
const CATEGORIES_FILE = path.join(__dirname, "..", "data", "categories.json");
const RECYCLE_BIN_FILE = path.join(__dirname, "..", "data", "recycle_bin.json");
const SETTINGS_FILE = path.join(__dirname, "..", "data", "settings.json");
let ads = [];
let recycleBin = []; // Messages rejected by AI
let settings = {
  recycleBinDays: 7,
  excludedGroups: [],
  // Default WhatsApp message footers
  hasakFooter: `┈┉━🔰 *منصة 🌴حساك* 🔰━┅┄
*✅إنضم في منصة حساك* 
https://chat.whatsapp.com/Ge3nhVs0MFT0ILuqDmuGYd?mode=ems_copy_t
 *✅للإعلانات في منصة حساك* 
0507667103`,
  masaakFooter: `┈┉━━🔰 *مسعاك العقارية* 🔰━━┅┄
⭕ إبراء للذمة التواصل فقط مع مسعاك عند الشراء أو إذا عندك مشتري ✅ نتعاون مع جميع الوسطاء`,
};
let seenGroups = new Set();
let groupsMetadata = {}; // Store group metadata (jid -> {name, jid})
let collections = []; // Store group collections
let categories = []; // Store custom categories
// Pending admin actions waiting for confirmation: { [adminJid]: { type: 'stop'|'start'|'waseet', phones: ["9665..."], createdAt } }
const pendingActions = {};

// ============================================
// 🔍 MESSAGE HANDLER HEALTH MONITORING
// Tracks if the message handler is still active
// ============================================
let lastMessageReceivedAt = Date.now();
let messageHandlerHealthCheckInterval = null;
let totalMessagesProcessed = 0;
let messageHandlerErrors = 0;
const ADMIN_NOTIFICATION_JID = "201090952790@s.whatsapp.net"; // Admin for error notifications

// ============================================
// 🏓 KEEPALIVE PING TRACKING
// Tracks ping failures to detect zombie connections
// ============================================
let keepalivePingInterval = null;
let lastSuccessfulPing = Date.now();
let consecutivePingFailures = 0;
const MAX_PING_FAILURES = 3;

function loadAds() {
  try {
    if (!fs.existsSync(path.join(__dirname, "..", "data"))) {
      fs.mkdirSync(path.join(__dirname, "..", "data"));
    }

    if (!fs.existsSync(ADS_FILE)) {
      fs.writeFileSync(ADS_FILE, JSON.stringify([]));
    }

    if (!fs.existsSync(COLLECTIONS_FILE)) {
      fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify([]));
    }

    if (!fs.existsSync(CATEGORIES_FILE)) {
      fs.writeFileSync(
        CATEGORIES_FILE,
        JSON.stringify([
          // Property Types (matching AI detection)
          { id: "cat_default_1", name: "أرض", color: "#8B4513" },
          { id: "cat_default_2", name: "بيت", color: "#FF6347" },
          { id: "cat_default_3", name: "دبلكس", color: "#4682B4" },
          { id: "cat_default_4", name: "شقة دبلكسية", color: "#9370DB" },
          { id: "cat_default_5", name: "شقة", color: "#3498db" },
          { id: "cat_default_6", name: "عمارة", color: "#DC143C" },
          { id: "cat_default_7", name: "فيلا", color: "#FFD700" },
          { id: "cat_default_8", name: "محطة بنزين", color: "#FF4500" },
          { id: "cat_default_9", name: "محل تجاري", color: "#32CD32" },
          { id: "cat_default_10", name: "مزرعة", color: "#228B22" },
          { id: "cat_default_11", name: "مستودع", color: "#696969" },
          { id: "cat_default_12", name: "شالية", color: "#00CED1" },
          { id: "cat_default_13", name: "استراحة", color: "#20B2AA" },
          // Special Categories
          { id: "cat_default_14", name: "إيجار", color: "#FF1493" }, // Rentals category
          { id: "cat_default_15", name: "طلبات", color: "#00BFFF" }, // Requests/Offers
          // Additional Categories
          { id: "cat_default_16", name: "وظائف", color: "#2ecc71" },
          { id: "cat_default_17", name: "فعاليات", color: "#e74c3c" },
          { id: "cat_default_18", name: "خدمات", color: "#f39c12" },
          { id: "cat_default_19", name: "أخرى", color: "#95a5a6" },
        ])
      );
    }

    const raw = fs.readFileSync(ADS_FILE, "utf8");
    ads = JSON.parse(raw || "[]");
    ads.forEach((a) => seenGroups.add(a.fromGroup));

    const collectionsRaw = fs.readFileSync(COLLECTIONS_FILE, "utf8");
    collections = JSON.parse(collectionsRaw || "[]");
    console.log(`✅ Loaded ${collections.length} collections from file`);

    const categoriesRaw = fs.readFileSync(CATEGORIES_FILE, "utf8");
    categories = JSON.parse(categoriesRaw || "[]");

    // Load recycle bin
    if (!fs.existsSync(RECYCLE_BIN_FILE)) {
      fs.writeFileSync(RECYCLE_BIN_FILE, JSON.stringify([]));
    }
    const recycleBinRaw = fs.readFileSync(RECYCLE_BIN_FILE, "utf8");
    recycleBin = JSON.parse(recycleBinRaw || "[]");

    // Load settings
    if (!fs.existsSync(SETTINGS_FILE)) {
      fs.writeFileSync(
        SETTINGS_FILE,
        JSON.stringify({ recycleBinDays: 7, excludedGroups: [] })
      );
    }
    const settingsRaw = fs.readFileSync(SETTINGS_FILE, "utf8");
    settings = JSON.parse(
      settingsRaw || '{ "recycleBinDays": 7, "excludedGroups": [] }'
    );

    // Ensure excludedGroups exists in settings (for backwards compatibility)
    if (!settings.excludedGroups) {
      settings.excludedGroups = [];
    }

    // Clean old recycle bin items
    cleanRecycleBin();
  } catch (err) {
    console.error("Failed to load ads:", err);
    ads = [];
    collections = [];
    categories = [];
    recycleBin = [];
  }
}

// Helper: extract phone-like tokens and normalize to '9665xxxxxxxx' (no plus)
function extractAndNormalizePhoneNumbers(text) {
  if (!text) return [];

  // Broad pattern: match sequences that look like a phone including +, digits, spaces, dashes, parentheses
  const loosePattern = /(?:\+?\d[\d\s\-()]{6,}\d)/g;
  const matches = text.match(loosePattern) || [];

  const normalized = matches
    .map((raw) => {
      // Remove all non-digit characters
      let digits = raw.replace(/[^\d]/g, "");

      // If it starts with country code like 966..., keep it
      if (digits.startsWith("966") && digits.length >= 11) {
        // ensure Saudi mobile format: 966 + 9 digits => 12 digits total
        return digits;
      }

      // If starts with leading 0 (e.g., 05xxxxxxxx)
      if (digits.startsWith("0") && digits.length >= 9) {
        // drop leading 0 and add 966
        return "966" + digits.replace(/^0+/, "");
      }

      // If starts with 5 and length 9 (5xxxxxxxx)
      if (digits.startsWith("5") && digits.length === 9) {
        return "966" + digits;
      }

      // If starts with 9 and looks like 9xxxxxxxxx (rare), try to add country
      if (digits.length === 9) {
        return "966" + digits;
      }

      // If it's full international with leading country but not 966, keep raw digits
      if (digits.length >= 10) return digits;

      return null;
    })
    .filter((v) => v)
    .map((v) => v.replace(/^\+/, ""))
    // Deduplicate and normalize length to remove obvious invalids
    .filter(
      (v, i, a) => a.indexOf(v) === i && v.length >= 11 && v.length <= 15
    );

  return normalized;
}

function formatPhoneForDisplay(normalized) {
  if (!normalized) return normalized;
  // Ensure starts with country code
  if (!normalized.startsWith("+") && normalized.startsWith("966")) {
    return "+" + normalized;
  }
  if (!normalized.startsWith("+")) return "+" + normalized;
  return normalized;
}

/**
 * Check if two ads are duplicates based on property details
 * (category, price, area, neighborhood) instead of text style
 */
function isDuplicateByDetails(ad1, ad2) {
  if (!ad1 || !ad2) return false;

  // Extract details from both ads
  const details1 = {
    category:
      ad1.category ||
      ad1.wpData?.meta?.parent_catt ||
      ad1.wpData?.meta?.arc_category ||
      "",
    subcategory:
      ad1.wpData?.meta?.sub_catt || ad1.wpData?.meta?.arc_subcategory || "",
    price: ad1.wpData?.meta?.price_amount || "",
    area: ad1.wpData?.meta?.arc_space || ad1.wpData?.meta?.area || "",
    neighborhood:
      ad1.wpData?.meta?.location || ad1.wpData?.meta?.neighborhood || "",
    city: ad1.wpData?.meta?.City || ad1.wpData?.meta?.subcity || "",
  };

  const details2 = {
    category:
      ad2.category ||
      ad2.wpData?.meta?.parent_catt ||
      ad2.wpData?.meta?.arc_category ||
      "",
    subcategory:
      ad2.wpData?.meta?.sub_catt || ad2.wpData?.meta?.arc_subcategory || "",
    price: ad2.wpData?.meta?.price_amount || "",
    area: ad2.wpData?.meta?.arc_space || ad2.wpData?.meta?.area || "",
    neighborhood:
      ad2.wpData?.meta?.location || ad2.wpData?.meta?.neighborhood || "",
    city: ad2.wpData?.meta?.City || ad2.wpData?.meta?.subcity || "",
  };

  // Normalize values for comparison
  const normalize = (str) =>
    String(str || "")
      .toLowerCase()
      .trim();

  const category1 = normalize(details1.category);
  const category2 = normalize(details2.category);
  const price1 = normalize(details1.price);
  const price2 = normalize(details2.price);
  const area1 = normalize(details1.area);
  const area2 = normalize(details2.area);
  const neighborhood1 = normalize(details1.neighborhood);
  const neighborhood2 = normalize(details2.neighborhood);

  // Must match: category, area, and neighborhood
  const categoryMatches = category1 && category2 && category1 === category2;
  const areaMatches = area1 && area2 && area1 === area2;
  const neighborhoodMatches =
    neighborhood1 && neighborhood2 && neighborhood1 === neighborhood2;

  // Price can be similar (within 10% range) or exact match
  let priceMatches = false;
  if (price1 && price2) {
    const priceNum1 = parseFloat(price1);
    const priceNum2 = parseFloat(price2);
    if (!isNaN(priceNum1) && !isNaN(priceNum2)) {
      const priceDiff = Math.abs(priceNum1 - priceNum2);
      const priceAvg = (priceNum1 + priceNum2) / 2;
      priceMatches = priceDiff <= priceAvg * 0.1; // Within 10%
    } else {
      priceMatches = price1 === price2; // Exact match for non-numeric
    }
  } else {
    priceMatches = true; // If one or both missing price, ignore this check
  }

  // Consider duplicate if:
  // - Same category AND same area AND same neighborhood AND similar price
  const isDuplicate =
    categoryMatches && areaMatches && neighborhoodMatches && priceMatches;

  if (isDuplicate) {
    console.log("🔍 Duplicate detected by details:");
    console.log(`   Category: ${category1} = ${category2}`);
    console.log(`   Area: ${area1} = ${area2}`);
    console.log(`   Neighborhood: ${neighborhood1} = ${neighborhood2}`);
    console.log(`   Price: ${price1} ≈ ${price2}`);
  }

  return isDuplicate;
}

// Quick keyword-based category detection (before AI)
// This saves AI tokens by checking category limits early
function quickDetectCategory(text) {
  const lowerText = text.toLowerCase();

  // Define keyword patterns for each category
  const categoryKeywords = {
    // Masaak Categories (Real Estate)
    أرض: ["أرض", "ارض", "قطعة", "قطعه", "بطن", "ركنية", "زاوية"],
    شقة: ["شقة", "شقه", "apartment"],
    فيلا: ["فيلا", "فيله", "villa"],
    بيت: ["بيت", "منزل", "house"],
    عمارة: ["عمارة", "عماره", "building"],
    دبلكس: ["دبلكس", "duplex"],
    استراحة: ["استراحة", "استراحه"],
    مزرعة: ["مزرعة", "مزرعه", "farm"],
    محل: ["محل", "محل تجاري", "shop"],
    مستودع: ["مستودع"],

    // Hasak Categories (Events & Marketplace)
    "فعاليات و أنشطة": [
      "فعالية",
      "فعاليات",
      "معرض",
      "مؤتمر",
      "ورشة",
      "دورة",
      "نشاط",
      "أنشطة",
      "احتفال",
      "مهرجان",
    ],
    "حراج الحسا": ["حراج", "حراجات", "مستعمل", "مستعملة", "used"],
    "كوفيهات أو مطاعم": [
      "كوفي",
      "كوفيه",
      "مطعم",
      "مطاعم",
      "مقهى",
      "كافيه",
      "cafe",
      "coffee",
      "restaurant",
    ],
    "محلات تجارية": ["محلات", "متجر", "متاجر", "معرض تجاري"],
    "أسر منتجة": ["أسرة منتجة", "اسرة منتجة", "أسر منتجة", "منتجات يدوية"],
    "برامج ووظائف": [
      "وظيفة",
      "وظائف",
      "توظيف",
      "برنامج",
      "تدريب",
      "دورة تدريبية",
    ],
    "مركز ترفيهي": ["ترفيهي", "ترفيه", "ملاهي", "العاب"],
    "منتجعات وإستراحات": ["منتجع", "منتجعات"],
    "توصيل سيارات": ["توصيل"],
  };

  // Check each category
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        return category;
      }
    }
  }

  return null; // No category detected
}

// Check if category has reached its daily limit
function isCategoryLimitReached(category) {
  if (!category) return false;

  const categoryLimits = settings.categoryLimits || [];
  const limitConfig = categoryLimits.find(
    (limit) => limit.category === category && limit.enabled
  );

  if (!limitConfig) return false;

  // Get start of today (00:00:00)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();

  // Count ads from TODAY in this category (excluding rejected/deleted)
  const todayCount = ads.filter(
    (ad) =>
      ad.category === category &&
      ad.status !== "rejected" &&
      ad.timestamp >= todayTimestamp
  ).length;

  console.log(
    `📊 Category "${category}" TODAY: ${todayCount}/${limitConfig.maxAds} ads (limit per day)`
  );

  return todayCount >= limitConfig.maxAds;
}

function saveAds() {
  try {
    fs.writeFileSync(ADS_FILE, JSON.stringify(ads, null, 2));
  } catch (err) {
    console.error("Failed to save ads:", err);
  }
}

function saveRecycleBin() {
  try {
    fs.writeFileSync(RECYCLE_BIN_FILE, JSON.stringify(recycleBin, null, 2));
  } catch (err) {
    console.error("Failed to save recycle bin:", err);
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
}

function cleanRecycleBin() {
  try {
    const daysMs = settings.recycleBinDays * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - daysMs;
    const beforeCount = recycleBin.length;

    console.log("\n♻️ Cleaning Recycle Bin...");
    console.log("Current time:", new Date().toISOString());
    console.log("Cutoff time:", new Date(cutoffTime).toISOString());
    console.log("Retention days:", settings.recycleBinDays);
    console.log("Items before cleanup:", beforeCount);

    // Log each item's age
    recycleBin.forEach((item, index) => {
      const ageMs = Date.now() - item.rejectedAt;
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      console.log(
        `  Item ${index + 1}: ${ageDays} days old, rejected at ${new Date(
          item.rejectedAt
        ).toISOString()}, will ${
          item.rejectedAt > cutoffTime ? "KEEP" : "DELETE"
        }`
      );
    });

    recycleBin = recycleBin.filter((item) => item.rejectedAt > cutoffTime);

    console.log("Items after cleanup:", recycleBin.length);

    if (beforeCount !== recycleBin.length) {
      saveRecycleBin();
      console.log(
        `♻️ Cleaned ${
          beforeCount - recycleBin.length
        } old items from recycle bin\n`
      );
    } else {
      console.log("♻️ No items removed\n");
    }
  } catch (err) {
    console.error("Failed to clean recycle bin:", err);
  }
}

function saveCollections() {
  try {
    fs.writeFileSync(COLLECTIONS_FILE, JSON.stringify(collections, null, 2));
  } catch (err) {
    console.error("Failed to save collections:", err);
  }
}

function saveCategories() {
  try {
    fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(categories, null, 2));
  } catch (err) {
    console.error("Failed to save categories:", err);
  }
}

function normalizeText(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Process a message from the queue
 * This function is called by the message queue for each queued message
 */
async function processMessageFromQueue(messageData) {
  const {
    messageText,
    from,
    groupSubject,
    senderName,
    senderPhone,
    imageUrl,
    participant,
    remoteJid,
  } = messageData;

  console.log(`⚙️ Processing queued message from: ${groupSubject}`);

  // ✅ CHECK FOR DUPLICATES FIRST (before using AI tokens!)
  const normalized = normalizeText(messageText);
  const isDuplicate = ads.some(
    (a) => a.fromGroup === from && normalizeText(a.text) === normalized
  );

  if (isDuplicate) {
    console.log(`⚠️ Duplicate ad detected, skipping AI processing...`);
    return { success: false, reason: "duplicate" };
  }

  // ✅ CHECK CATEGORY LIMITS BEFORE USING AI TOKENS!
  // Quick keyword-based category detection to check if limit is reached
  const quickCategory = quickDetectCategory(messageText);
  if (quickCategory && isCategoryLimitReached(quickCategory)) {
    console.log(
      `🚫 Category "${quickCategory}" has reached its limit. Blocking BEFORE AI processing.`
    );

    // Move to recycle bin without using AI
    const recycleBinItem = {
      id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      text: messageText,
      fromGroup: from,
      fromGroupName: groupSubject,
      author: participant || remoteJid || null,
      senderName: senderName,
      senderPhone: senderPhone,
      rejectedAt: Date.now(),
      aiConfidence: null,
      aiReason: `Category limit reached: ${quickCategory}`,
      category: quickCategory,
      blockReason: "category_limit_reached_pre_check",
      imageUrl: imageUrl || null, // Save image for later use
    };

    recycleBin.unshift(recycleBinItem);
    if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500);
    saveRecycleBin();

    console.log(
      `🗑️ Moved to recycle bin (category limit - no AI used): ${recycleBinItem.id}`
    );
    return {
      success: false,
      reason: "category_limit_reached",
      category: quickCategory,
    };
  }

  // AI-powered ad detection and enhancement
  try {
    const aiResult = await processMessage(messageText);

    console.log(
      `🔍 AI Result: isAd=${aiResult.isAd}, confidence=${aiResult.confidence}%`
    );

    // If not detected as an ad, move to recycle bin
    if (!aiResult.isAd) {
      console.log(
        `❌ Not an ad (confidence: ${aiResult.confidence}%): ${aiResult.reason}`
      );

      // Add to recycle bin - include image for later use
      const recycleBinItem = {
        id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        text: messageText,
        fromGroup: from,
        fromGroupName: groupSubject,
        author: participant || remoteJid || null,
        senderName: senderName,
        senderPhone: senderPhone,
        rejectedAt: Date.now(),
        aiConfidence: aiResult.confidence,
        aiReason: aiResult.reason,
        imageUrl: imageUrl || null, // Save image for later use
      };

      recycleBin.unshift(recycleBinItem);
      if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500); // Keep max 500
      saveRecycleBin();

      console.log(`🗑️ Moved to recycle bin: ${recycleBinItem.id}`);
      return { success: false, reason: "not_an_ad" };
    }

    console.log(
      `✅ Ad detected (confidence: ${aiResult.confidence}%): ${aiResult.reason}`
    );

    // Check if category limit is reached
    if (aiResult.category && isCategoryLimitReached(aiResult.category)) {
      console.log(
        `🚫 Category "${aiResult.category}" has reached its limit. Ad blocked and moved to recycle bin.`
      );

      // Move to recycle bin instead of saving - include image for later use
      const recycleBinItem = {
        id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        text: messageText,
        fromGroup: from,
        fromGroupName: groupSubject,
        author: participant || remoteJid || null,
        senderName: senderName,
        senderPhone: senderPhone,
        rejectedAt: Date.now(),
        aiConfidence: aiResult.confidence,
        aiReason: `Category limit reached: ${aiResult.category}`,
        category: aiResult.category,
        blockReason: "category_limit_reached",
        imageUrl: imageUrl || null, // Save image for later use
      };

      recycleBin.unshift(recycleBinItem);
      if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500);
      saveRecycleBin();

      console.log(
        `🗑️ Moved to recycle bin (category limit): ${recycleBinItem.id}`
      );
      return {
        success: false,
        reason: "category_limit_reached",
        category: aiResult.category,
      };
    }

    // Log extracted phone number if available
    if (aiResult.meta && aiResult.meta.phone_number) {
      console.log(
        `📞 Phone number extracted from message: ${aiResult.meta.phone_number}`
      );
    }

    // Log WordPress data generation
    if (aiResult.wpData) {
      console.log("✅ WordPress data automatically generated");
    }

    // Log WhatsApp message generation
    if (aiResult.whatsappMessage) {
      console.log("✅ WhatsApp message automatically generated");
    }

    // ✅ CHECK FOR DUPLICATE BY PROPERTY DETAILS (after AI processing)
    // This prevents duplicate properties even if message text is different
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    const detailsDuplicate = ads.find((a) => {
      if (a.timestamp < thirtyMinutesAgo) return false;
      return isDuplicateByDetails(aiResult, a);
    });

    if (detailsDuplicate) {
      console.log(
        `⚠️ Duplicate property detected! Ad ${detailsDuplicate.id} has same details`
      );
      console.log(
        `   Same category, area, neighborhood, and price - Skipping save`
      );
      return { success: false, reason: "duplicate_by_details" };
    }

    // Detect target website based on category
    const websiteConfig = require("../config/website.config");
    let targetWebsite = null;

    if (aiResult.wpData && aiResult.wpData.meta) {
      const meta = aiResult.wpData.meta;
      const effectiveCategory =
        meta.arc_category ||
        meta.parent_catt ||
        meta.category ||
        aiResult.category ||
        "";

      // Check if it's a Hasak category
      if (
        effectiveCategory &&
        websiteConfig.hasak.categories[effectiveCategory]
      ) {
        targetWebsite = "hasak";
        console.log(
          `🌐 Detected Hasak category "${effectiveCategory}" → Target: Hasak`
        );
      } else {
        // Use detectWebsite for other cases
        targetWebsite = websiteConfig.detectWebsite(
          messageText,
          effectiveCategory,
          meta
        );
        console.log(
          `🌐 Auto-detected target website: ${targetWebsite} (category: ${effectiveCategory})`
        );
      }
    }

    // Create the ad (duplicate already checked before AI)
    const ad = {
      id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      text: messageText, // Original text
      enhancedText: aiResult.enhancedText, // Same as original (no emojis)
      normalizedText: normalized, // Already calculated above
      fromGroup: from,
      fromGroupName: groupSubject,
      author: participant || remoteJid || null,
      senderName: senderName, // WhatsApp sender name (pushName)
      senderPhone: senderPhone, // WhatsApp sender ID (for reference)
      imageUrl: imageUrl, // Image data if present
      messageKey: messageData.messageKey || null, // Store message key for full image download
      timestamp: Date.now(),
      status: "new", // new | accepted | rejected | posted
      category: aiResult.category || null, // AI-detected category
      aiConfidence: aiResult.confidence,
      aiReason: aiResult.reason,
      improvements: aiResult.improvements || [],
      isEdited: false, // Track if manually edited
      meta: aiResult.meta || {}, // AI-extracted metadata (includes phone_number from message text)
      wpData: aiResult.wpData || null, // Auto-generated WordPress data
      whatsappMessage: aiResult.whatsappMessage || null, // Auto-generated WhatsApp message
      targetWebsite: targetWebsite, // Set target website from detection
    };

    ads.unshift(ad); // newest first
    // Keep size reasonable
    if (ads.length > 1000) ads = ads.slice(0, 1000);
    saveAds();

    console.log(
      `✨ Ad saved successfully! ID: ${ad.id}, Group: ${ad.fromGroupName}`
    );

    // Check if auto-approve is enabled and auto-post to WordPress
    const settings = getSettings();
    if (settings.autoApproveWordPress === true && ad.wpData) {
      console.log(
        "🚀 Auto-approve enabled, posting new ad to WordPress automatically..."
      );

      // Auto-post to WordPress using the SAME function as manual posting
      (async () => {
        try {
          // Import the WordPress posting function from routes
          const { postAdToWordPress } = require("../routes/bot");

          console.log(
            "🔵 Starting WordPress auto-post using manual posting function..."
          );
          console.log("🔵 Ad ID:", ad.id);

          // Call the same function used for manual posting
          const result = await postAdToWordPress(ad, sock, ad.wpData, false);

          if (result.success) {
            console.log(
              "✅ ✅ ✅ Auto-posted to WordPress successfully! ✅ ✅ ✅"
            );
            console.log("📌 Post ID:", result.wordpressPost.id);
            console.log("📌 Short Link:", result.wordpressPost.link);
            console.log("🌐 Website:", result.targetWebsite);

            // Update ad status to "accepted" (not "posted")
            ad.status = "accepted";
            ad.wordpressPostId = result.wordpressPost.id;
            ad.wordpressUrl = result.wordpressPost.link;
            ad.wordpressFullUrl = result.wordpressPost.fullLink;
            ad.whatsappMessage = result.whatsappMessage;
            ad.wpData = result.extractedData;
            ad.targetWebsite = result.targetWebsite;

            // Save updated ad
            saveAds();
            console.log(
              "✅ Ad updated with WordPress info and marked as accepted"
            );

            // Send WhatsApp message to the group with the ad details
            if (result.whatsappMessage && ad.fromGroup) {
              try {
                await sock.sendMessage(ad.fromGroup, {
                  text: result.whatsappMessage,
                });
                console.log("✅ WhatsApp message sent to group:", ad.fromGroup);
              } catch (msgError) {
                console.error(
                  "❌ Failed to send WhatsApp message to group:",
                  msgError
                );
              }
            }
          } else {
            console.error("❌ WordPress posting returned unsuccessful result");
          }
        } catch (error) {
          console.error(
            "❌ ❌ ❌ Error during auto-post to WordPress ❌ ❌ ❌"
          );
          console.error("Error message:", error.message);
          console.error("Error details:", error.response?.data || error);
        }
      })();
    } else if (settings.autoApproveWordPress === true && !ad.wpData) {
      console.log(
        "⚠️ Auto-approve enabled but ad has no wpData, skipping auto-post"
      );
    }

    return { success: true, adId: ad.id };
  } catch (error) {
    console.error("❌ Error processing message with AI:", error);

    // Check if it's an overload/rate limit error
    const errorMessage = error.message || error.toString();
    const isOverloadError =
      error.status === 503 ||
      errorMessage.includes("overloaded") ||
      errorMessage.includes("503");
    const isRateLimitError =
      error.status === 429 ||
      errorMessage.includes("429") ||
      errorMessage.includes("rate limit");

    if (isOverloadError || isRateLimitError) {
      console.log(
        "⚠️ All API keys failed due to overload/rate limit. Ad will be saved for retry."
      );

      // Fallback: save with retry flag
      const normalized = normalizeText(messageText);
      const isDuplicate = ads.some(
        (a) => a.fromGroup === from && normalizeText(a.text) === normalized
      );

      if (!isDuplicate) {
        const ad = {
          id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          text: messageText,
          enhancedText: null,
          normalizedText: normalized,
          fromGroup: from,
          fromGroupName: groupSubject,
          author: participant || remoteJid || null,
          senderName: senderName,
          senderPhone: senderPhone,
          imageUrl: imageUrl,
          messageKey: messageData.messageKey || null,
          timestamp: Date.now(),
          status: "pending_retry", // Special status for retry
          category: null,
          aiConfidence: 0,
          aiReason: "Pending AI retry - API overloaded",
          improvements: [],
          isEdited: false,
          meta: {},
          wpData: null,
          whatsappMessage: null,
          retryCount: 0,
          lastRetryAt: null,
        };

        ads.unshift(ad);
        if (ads.length > 1000) ads = ads.slice(0, 1000);
        saveAds();

        console.log(`📝 Ad saved with retry flag: ${ad.id}`);

        // Schedule a retry after 5 minutes
        setTimeout(() => retryFailedAd(ad.id), 5 * 60 * 1000);

        return { success: true, adId: ad.id, needsRetry: true };
      }

      return { success: false, reason: "duplicate" };
    }

    // For other errors, fallback: save without AI processing
    const normalized = normalizeText(messageText);
    const isDuplicate = ads.some(
      (a) => a.fromGroup === from && normalizeText(a.text) === normalized
    );

    if (!isDuplicate) {
      const ad = {
        id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        text: messageText,
        enhancedText: null,
        normalizedText: normalized,
        fromGroup: from,
        fromGroupName: groupSubject,
        author: participant || remoteJid || null,
        senderName: senderName,
        senderPhone: senderPhone,
        imageUrl: imageUrl,
        messageKey: messageData.messageKey || null,
        timestamp: Date.now(),
        status: "new",
        category: null,
        aiConfidence: 0,
        aiReason: "AI processing failed",
        improvements: [],
        isEdited: false,
      };

      ads.unshift(ad);
      if (ads.length > 1000) ads = ads.slice(0, 1000);
      saveAds();

      console.log(`⚠️ Ad saved without AI processing: ${ad.id}`);
      return { success: true, adId: ad.id, aiProcessed: false };
    }

    return { success: false, reason: "duplicate_after_error" };
  }
}

async function initializeBot() {
  // Strong guards to prevent duplicate sessions/sockets
  if (sock && connectionStatus === "connected") {
    console.log("⚠️ Bot already connected, skipping reinitialization");
    return sock;
  }
  if (initInProgress) {
    console.log(
      "⚠️ Bot initialization already in progress, skipping new attempt"
    );
    return null;
  }
  // Allow initialize during reconnect timer as long as lock isn't held
  initInProgress = true;
  const haveLock = acquireInitLock();
  if (!haveLock) {
    console.log(
      "🛡️ Init lock held by another process/instance. Skipping initializeBot."
    );
    initInProgress = false;
    return null;
  }

  try {
    // Prevent multiple simultaneous initializations
    if (isReconnecting && connectionStatus === "reconnecting") {
      console.log("⚠️ Already reconnecting, skipping duplicate initialization");
      return null;
    }

    // Check if we're already connected
    if (connectionStatus === "connected" && sock) {
      console.log("ℹ️ Bot already connected, skipping initialization");
      return sock;
    }

    // CRITICAL: Close and cleanup old socket before creating new one
    if (sock) {
      console.log("🧹 Cleaning up old socket before reinitializing...");
      try {
        // CRITICAL FIX: Remove ALL listeners at once to prevent ghost handlers
        sock.ev.removeAllListeners();

        // Close websocket if still open
        if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
          sock.ws.close();
        }
      } catch (cleanupError) {
        console.warn("⚠️ Error during socket cleanup:", cleanupError.message);
      }
      sock = null;
      console.log("✅ Old socket cleaned up");
    }

    // CRITICAL: Add delay to allow old socket to be fully garbage collected
    // This prevents race conditions where old handlers fire alongside new ones
    if (reconnectAttempts > 0) {
      console.log(
        "⏳ Waiting 1 second for socket cleanup before creating new one..."
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("🚀 Starting bot initialization...");
    loadAds();

    // Check if auth folder exists and has creds.json
    const authPath = path.join(__dirname, "..", "auth_info_baileys");
    const credsPath = path.join(authPath, "creds.json");

    if (fs.existsSync(authPath) && fs.existsSync(credsPath)) {
      console.log("✅ Found existing session credentials");
      try {
        const creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
        if (!creds || !creds.me || !creds.me.id) {
          console.log("⚠️ Session credentials are invalid, clearing...");
          fs.rmSync(authPath, { recursive: true, force: true });
        }
      } catch (error) {
        console.log("⚠️ Failed to read session credentials, clearing...");
        fs.rmSync(authPath, { recursive: true, force: true });
      }
    } else {
      console.log("ℹ️ No existing session found, will generate QR code");
    }

    const { state, saveCreds } = await useMultiFileAuthState(
      "auth_info_baileys"
    );
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      logger: createDiagnosticLogger("silent"),
      auth: state,
      printQRInTerminal: false, // We handle QR display via web dashboard
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      retryRequestDelayMs: 2000,
      connectTimeoutMs: 60000,
      qrTimeout: 60000,
      emitOwnEvents: false,
      // FIX: Ignore newsletter and certain JIDs that cause "xml-not-well-formed" Stream Errors
      // This is a known Baileys bug where newsletter messages corrupt the connection
      // See: https://github.com/WhiskeySockets/Baileys/issues/794
      shouldIgnoreJid: (jid) => {
        // Ignore newsletter channels - they cause xml-not-well-formed errors
        if (jid.endsWith("@newsletter")) {
          return true;
        }
        // Ignore broadcast/status updates
        if (jid === "status@broadcast") {
          return true;
        }
        return false;
      },
      // Provide getMessage for message retry operations (CRITICAL for E2E decryption)
      // This is the "healing" mechanism for "Bad MAC" errors
      getMessage: async (key) => {
        // Use in-memory cache for message retry
        const cached = getCachedMessage(key);
        return cached?.message || undefined;
      },
    });

    console.log("✅ WhatsApp socket created successfully");

    // ============================================
    // 🔍 DIAGNOSTIC EVENT LISTENERS
    // Monitor all message-related events for debugging
    // ============================================

    // Track messages.update events (message status changes)
    sock.ev.on("messages.update", (updates) => {
      console.log(`📝 [EVENT] messages.update - ${updates.length} update(s)`);
    });

    // Track message reactions
    sock.ev.on("messages.reaction", (reactions) => {
      console.log(
        `👍 [EVENT] messages.reaction - ${reactions.length} reaction(s)`
      );
    });

    // Track presence updates (typing indicators, online status)
    sock.ev.on("presence.update", (presence) => {
      // Only log if it's from a group (reduces noise)
      if (presence.id?.includes("@g.us")) {
        console.log(`👁️ [EVENT] presence.update - ${presence.id}`);
      }
    });

    // Track group updates
    sock.ev.on("groups.update", (updates) => {
      console.log(
        `👥 [EVENT] groups.update - ${updates.length} group(s) updated`
      );
    });

    // Track group participant updates
    sock.ev.on("group-participants.update", (update) => {
      console.log(
        `👥 [EVENT] group-participants.update - ${update.action} in ${update.id}`
      );
    });

    // ============================================
    // 🏓 WEBSOCKET KEEPALIVE PING
    // Actively validates connection with timeout and failure tracking
    // Enhanced with WebSocket state validation and zombie detection
    // ============================================
    const startKeepalivePing = () => {
      if (keepalivePingInterval) clearInterval(keepalivePingInterval);
      consecutivePingFailures = 0;
      lastSuccessfulPing = Date.now();

      console.log(
        `🏓 [KEEPALIVE] Starting ping monitor (interval: 90s, timeout: 5s)`
      );

      keepalivePingInterval = setInterval(async () => {
        if (connectionStatus === "connected" && sock) {
          // ============================================
          // 🔍 STEP 1: Check WebSocket state BEFORE pinging
          // Only if sock.ws is accessible
          // ============================================
          const wsState = getWebSocketReadyState();
          const wsStateName = getWebSocketState();

          // ONLY trigger zombie if WebSocket is DEFINITELY dead (CLOSING=2 or CLOSED=3)
          // If wsState is -1, sock.ws is not accessible - we can't determine state
          // If wsState is 0 or 1, connection is fine (CONNECTING or OPEN)
          if (wsState >= 2) {
            // CLOSING or CLOSED
            console.error(
              `🧟 [KEEPALIVE] ZOMBIE DETECTED! WS state: ${wsStateName} (${wsState}) but status: ${connectionStatus}`
            );
            logConnectionState("ZOMBIE_DETECTED_PRE_PING", {
              wsState: wsStateName,
              wsReadyState: wsState,
            });

            // Queue notification for after reconnection
            queueAdminNotification(
              `🧟 *اتصال ميت (Zombie)*\n\n` +
                `⚠️ حالة WebSocket: ${wsStateName}\n` +
                `📊 الرسائل المعالجة: ${totalMessagesProcessed}\n` +
                `🔄 جاري إعادة الاتصال تلقائياً...`
            );

            // Clear interval and trigger reconnection
            if (keepalivePingInterval) {
              clearInterval(keepalivePingInterval);
              keepalivePingInterval = null;
            }

            // Force reconnection
            await forceReconnect("ZOMBIE_WS_STATE");
            return;
          }

          // ============================================
          // 🔍 STEP 2: Active ping with short timeout
          // ============================================
          try {
            const pingStart = Date.now();

            // Use presenceSubscribe with SHORT timeout (5 seconds)
            await Promise.race([
              sock.presenceSubscribe(sock.user?.id),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Ping timeout (5s)")), 5000)
              ),
            ]);

            const pingLatency = Date.now() - pingStart;
            console.log(
              `🏓 [KEEPALIVE] Ping OK (${pingLatency}ms) | WS: ${wsStateName} | Messages: ${totalMessagesProcessed}`
            );
            lastSuccessfulPing = Date.now();
            consecutivePingFailures = 0;
          } catch (pingError) {
            consecutivePingFailures++;
            const wsStateAfterFail = getWebSocketState();

            console.warn(
              `⚠️ [KEEPALIVE] Ping FAILED (${consecutivePingFailures}/${MAX_PING_FAILURES}): ${pingError.message} | WS: ${wsStateAfterFail}`
            );
            logConnectionState("PING_FAILED", {
              error: pingError.message,
              consecutiveFailures: consecutivePingFailures,
              wsStateAfterFail,
            });

            if (consecutivePingFailures >= MAX_PING_FAILURES) {
              console.error(
                `🚨 [KEEPALIVE] ${MAX_PING_FAILURES} consecutive ping failures - TRIGGERING RECONNECT!`
              );

              // Queue notification for after reconnection (don't try to send now - might be dead)
              queueAdminNotification(
                `🚨 *فشل الـ Ping (${MAX_PING_FAILURES}x)*\n\n` +
                  `⚠️ فشل التحقق من الاتصال ${MAX_PING_FAILURES} مرات\n` +
                  `📊 الرسائل المعالجة: ${totalMessagesProcessed}\n` +
                  `🔌 حالة WebSocket: ${wsStateAfterFail}\n` +
                  `🔄 تم إعادة الاتصال تلقائياً`
              );

              // Clear interval
              if (keepalivePingInterval) {
                clearInterval(keepalivePingInterval);
                keepalivePingInterval = null;
              }

              // Force reconnection
              await forceReconnect("PING_FAILURES");
            }
          }
        }
      }, 90 * 1000); // Ping every 90 seconds (more frequent than before)
    };

    // ============================================
    // 🔄 FORCE RECONNECT FUNCTION
    // Centralizes reconnection logic for consistent handling
    // ============================================
    async function forceReconnect(reason = "UNKNOWN") {
      console.log(`\n🔌 [FORCE_RECONNECT] Initiating forced reconnection...`);
      console.log(`   Reason: ${reason}`);
      logConnectionState("FORCE_RECONNECT_START", { reason });

      // ============================================
      // 🛡️ RECONNECT COOLDOWN - Prevent reconnect storms
      // ============================================
      const timeSinceLastReconnect = Date.now() - lastReconnectAttempt;
      if (
        timeSinceLastReconnect < MIN_RECONNECT_INTERVAL_MS &&
        lastReconnectAttempt > 0
      ) {
        const waitSeconds = Math.ceil(
          (MIN_RECONNECT_INTERVAL_MS - timeSinceLastReconnect) / 1000
        );
        console.warn(
          `⏸️ [FORCE_RECONNECT] Cooldown active - last reconnect ${Math.floor(
            timeSinceLastReconnect / 1000
          )}s ago`
        );
        console.warn(
          `   ⏳ Must wait ${waitSeconds}s more (cooldown: ${
            MIN_RECONNECT_INTERVAL_MS / 1000
          }s)`
        );
        console.warn("   ⚠️ Skipping reconnect to prevent storm");
        return;
      }
      lastReconnectAttempt = Date.now();

      // CRITICAL: Update socket manager FIRST - prevents ANY traffic
      socketManager.setConnectionStatus("reconnecting");
      socketManager.setSocket(null);
      socketManager.setSendFunctions(null, null); // Clear send functions to prevent any sends

      // Clean up socket
      try {
        if (sock) {
          sock.ev.removeAllListeners();
          if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
            sock.ws.close();
          }
          sock = null;
        }
      } catch (closeError) {
        console.warn(`   ⚠️ Socket cleanup warning: ${closeError.message}`);
      }

      // Clean up all schedulers - this cancels all jobs with stale socket refs
      cleanupAllSchedulers();

      // Release locks
      releaseInitLock();
      initInProgress = false;
      isReconnecting = false;
      reconnectAttempts = 0;
      connectionStatus = "reconnecting";
      totalMessagesProcessed = 0;
      lastMessageReceivedAt = Date.now();
      consecutivePingFailures = 0;

      // Wait then reinitialize
      console.log(`   ⏳ Waiting 3 seconds before reinitializing...`);
      setTimeout(async () => {
        console.log(`🚀 [FORCE_RECONNECT] Reinitializing bot...`);
        try {
          await initializeBot();
          console.log(`✅ [FORCE_RECONNECT] Reconnection completed!`);
        } catch (reinitError) {
          console.error(
            `❌ [FORCE_RECONNECT] Reconnection failed: ${reinitError.message}`
          );
          // Try again after 10 seconds
          setTimeout(() => forceReconnect("RETRY_AFTER_FAILURE"), 10000);
        }
      }, 3000);
    }

    // CRITICAL: Register creds.update BEFORE connection.update
    // This ensures credentials are saved immediately when they change
    sock.ev.on("creds.update", saveCreds);

    // ============================================
    // 🌡️ CONNECTION PHASE STATE MACHINE
    // ============================================
    /**
     * Transitions connection to a new phase and handles phase-specific logic
     * Phases: INIT → CONNECTING → WARMING → STABLE
     *
     * INIT: No socket connection
     * CONNECTING: Connection in progress (waiting for "open" event)
     * WARMING: Connection open, Signal ratchet stabilizing (5-10s) - queue/schedulers paused
     * STABLE: Ready for sends, queue/schedulers can execute
     */
    function setConnectionPhase(newPhase) {
      const oldPhase = currentPhase;
      currentPhase = newPhase;
      phaseStartedAt = Date.now();

      console.log(
        `\n🌡️ [PHASE] ${oldPhase.toUpperCase()} → ${newPhase.toUpperCase()}`
      );

      if (newPhase === ConnectionPhase.INIT) {
        console.log(`   └─ Clearing connection state...`);
        // Pause queue when disconnected
        const messageQueue = require("../services/messageQueue");
        if (messageQueue && messageQueue.pauseQueue) {
          messageQueue.pauseQueue();
        }
      } else if (newPhase === ConnectionPhase.CONNECTING) {
        console.log(`   └─ Attempting to establish connection...`);
        // Queue stays paused
      } else if (newPhase === ConnectionPhase.WARMING) {
        console.log(
          `   └─ Signal protocol stabilizing (${SESSION_WARMUP_DURATION_MS}ms)...`
        );
        console.log(`   └─ Queue/Schedulers PAUSED during warmup`);

        // Pause queue during warmup - Signal ratchet needs to stabilize
        const messageQueue = require("../services/messageQueue");
        if (messageQueue && messageQueue.pauseQueue) {
          messageQueue.pauseQueue();
        }

        // Auto-transition to STABLE after warmup duration
        // This is the key: give Signal ratchet time to settle
        setTimeout(() => {
          if (currentPhase === ConnectionPhase.WARMING) {
            console.log(`\n✅ Session warmup complete!`);
            setConnectionPhase(ConnectionPhase.STABLE);
          }
        }, SESSION_WARMUP_DURATION_MS);
      } else if (newPhase === ConnectionPhase.STABLE) {
        console.log(`   └─ Ready for sends. Queue/Schedulers RESUMED.`);

        // Trigger any pending messages that were queued
        const messageQueue = require("../services/messageQueue");
        if (messageQueue && messageQueue.resumeQueue) {
          messageQueue.resumeQueue();
        }
      }
    }

    /**
     * Checks if the bot is ready to send messages
     * Returns true ONLY when in STABLE phase AND socket is connected
     */
    function isReadyToSend() {
      const isPhaseReady = currentPhase === ConnectionPhase.STABLE;
      const isSocketReady = socketManager && socketManager.isConnected();
      return isPhaseReady && isSocketReady;
    }

    // Initialize to INIT phase
    setConnectionPhase(ConnectionPhase.INIT);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // ============================================
      // 📊 LOG ALL CONNECTION UPDATES
      // ============================================
      logConnectionState("connection.update", {
        connection,
        hasQR: !!qr,
        lastDisconnectCode: lastDisconnect?.error?.output?.statusCode,
        lastDisconnectMsg: lastDisconnect?.error?.message?.substring(0, 50),
      });

      if (qr) {
        currentQR = qr;
        // Generate QR code as data URL
        try {
          qrCodeData = await QRCode.toDataURL(qr);
          connectionStatus = "qr";
          // Update socket manager status
          socketManager.setConnectionStatus("qr");
          console.log("📱 QR Code generated - Scan with WhatsApp");
        } catch (err) {
          console.error("Error generating QR code:", err);
        }
      }

      if (connection === "close") {
        // ============================================
        // 🔌 CONNECTION CLOSED - DETAILED LOGGING
        // ============================================
        setConnectionPhase(ConnectionPhase.INIT);

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || "Unknown error";

        // 📢 Send admin alert about disconnection
        sendAdminAlert("DISCONNECT", {
          reason: errorMessage,
          statusCode: statusCode,
          attempts: reconnectAttempts,
        });

        // CRITICAL: Update socket manager FIRST - mark as disconnected
        // This MUST happen BEFORE any other operations to prevent traffic
        socketManager.setConnectionStatus("disconnected");
        socketManager.setSocket(null);
        socketManager.setSendFunctions(null, null); // Clear send functions to prevent any sends

        // CRITICAL: Clean up all schedulers immediately when connection closes
        // This prevents stale socket references from causing zombie connections
        cleanupAllSchedulers();

        console.log(`\n${"=".repeat(60)}`);
        console.log(`🔌 CONNECTION CLOSED`);
        console.log(`${"=".repeat(60)}`);
        console.log(`   📊 Status Code: ${statusCode}`);
        console.log(`   ❌ Error: ${errorMessage}`);
        console.log(`   🔌 WebSocket State: ${getWebSocketState()}`);
        console.log(`   📨 Messages Processed: ${totalMessagesProcessed}`);
        console.log(
          `   🔄 Reconnect Attempts: ${reconnectAttempts}/${maxReconnectAttempts}`
        );
        console.log(`${"=".repeat(60)}\n`);
        console.log("🔍 Reconnect attempts:", reconnectAttempts);

        // Clear any pending reconnect timeout
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }

        // Check if this is a conflict error (401 with "conflict" message)
        const isConflict =
          (statusCode === DisconnectReason.loggedOut || statusCode === 401) &&
          errorMessage.toLowerCase().includes("conflict");

        // Check if session is corrupted and needs clearing
        // 405 = Connection Failure, 408 = Timeout, 440 = Connection Lost
        // RELAXED: Don't clear on transient errors like 440 or 515
        const sessionCorrupted =
          statusCode === DisconnectReason.badSession ||
          statusCode === 428 || // reconnect required
          statusCode === 401; // unauthorized (will be handled by isConflict/logout too)

        // Determine if we should reconnect
        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut &&
          reconnectAttempts < maxReconnectAttempts &&
          !isReconnecting &&
          !initInProgress;

        console.log("🔄 Should reconnect:", shouldReconnect);

        if (isConflict) {
          console.log("⚠️ CONFLICT DETECTED: Another session is active!");
          console.log("💡 This usually means:");
          console.log("   1. The bot is running in another process");
          console.log("   2. WhatsApp Web is open in a browser");
          console.log(
            "   3. Multiple reconnection attempts happened simultaneously"
          );
          console.log("   4. Old socket handlers weren't cleaned up properly");
          console.log(
            "🛑 Clearing session and stopping reconnection attempts..."
          );

          // Clear the corrupted session
          const authPath = path.join(__dirname, "..", "auth_info_baileys");
          try {
            if (fs.existsSync(authPath)) {
              fs.rmSync(authPath, { recursive: true, force: true });
              console.log("✅ Session cleared successfully");
            }
          } catch (error) {
            console.error("❌ Error clearing session:", error);
          }

          connectionStatus = "disconnected";
          qrCodeData = null;
          isReconnecting = false;
          reconnectAttempts = 0;

          // CRITICAL: Release the init lock before retrying
          releaseInitLock();
          initInProgress = false;

          // Try one more time with fresh QR after clearing
          // IMPORTANT: Longer delay to ensure old socket is fully cleaned up
          console.log("🔄 Will generate fresh QR code in 5 seconds...");
          setTimeout(() => {
            initializeBot();
          }, 5000);

          return;
        }

        // Auto-clear corrupted session
        if (sessionCorrupted && reconnectAttempts > 0) {
          console.log("🔥 SESSION CORRUPTION DETECTED!");
          console.log("📊 Error Code:", statusCode);
          console.log("💡 Likely causes:");
          console.log("   - Session became invalid/expired");
          console.log("   - WhatsApp servers can't validate credentials");
          console.log("   - Network issues during authentication");
          console.log("🗑️ Auto-clearing session to allow fresh QR login...");

          // Delete auth folder
          const authPath = path.join(__dirname, "..", "auth_info_baileys");
          try {
            if (fs.existsSync(authPath)) {
              fs.rmSync(authPath, { recursive: true, force: true });
              console.log("✅ Session cleared successfully");
            }
          } catch (error) {
            console.error("❌ Error clearing session:", error);
          }

          // Reset and try one more time with fresh session
          reconnectAttempts = 0;
          isReconnecting = false;
          connectionStatus = "disconnected";

          // CRITICAL: Release the init lock before retrying
          releaseInitLock();
          initInProgress = false;

          // IMPORTANT: Longer delay to ensure old socket is fully cleaned up
          console.log(
            "🔄 Attempting fresh connection with QR code in 5 seconds..."
          );
          setTimeout(() => {
            initializeBot();
          }, 5000);

          return;
        }

        if (shouldReconnect) {
          // Immediate attempt for first failure (fast path), then backoff
          reconnectAttempts++;
          let delay;
          if (reconnectAttempts === 1) {
            delay = 2000; // 2s first retry
          } else {
            delay = Math.min(5000 * Math.pow(2, reconnectAttempts - 2), 60000);
          }

          console.log(
            `⏳ Scheduling reconnect in ${
              delay / 1000
            }s (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`
          );

          isReconnecting = true;
          connectionStatus = "reconnecting";

          // CRITICAL: Remove ALL event listeners before reconnect to prevent ghost handlers
          reconnectTimeout = setTimeout(async () => {
            console.log(
              `🔄 Attempting reconnection #${reconnectAttempts} (statusCode=${statusCode})`
            );

            // Clean up old socket completely
            if (sock) {
              try {
                sock.ev.removeAllListeners();
                if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
                  sock.ws.close();
                }
              } catch (e) {
                console.warn("Socket cleanup warning:", e.message);
              }
              sock = null;
            }

            // CRITICAL: Release the init lock before reinitializing
            releaseInitLock();
            initInProgress = false;
            isReconnecting = false;

            // Now reinitialize (this will create fresh event handlers)
            await initializeBot();
          }, delay);
        } else {
          connectionStatus = "disconnected";
          // CRITICAL: Update socket manager status
          socketManager.setConnectionStatus("disconnected");
          socketManager.setSocket(null);

          qrCodeData = null;
          isReconnecting = false;

          if (reconnectAttempts >= maxReconnectAttempts) {
            console.log("❌ Max reconnection attempts reached. Stopping.");
          } else {
            console.log("❌ Bot disconnected. Reason:", errorMessage);
          }

          reconnectAttempts = 0;
        }
      } else if (connection === "open") {
        // ============================================
        // ✅ CONNECTION OPENED SUCCESSFULLY
        // ============================================
        // SET PHASE TO WARMING - Signal protocol needs 5-10 seconds to stabilize
        setConnectionPhase(ConnectionPhase.WARMING);

        console.log(`\n${"=".repeat(60)}`);
        console.log(`✅ WHATSAPP CONNECTION OPENED SUCCESSFULLY!`);
        console.log(`${"=".repeat(60)}`);
        console.log(`   🔌 WebSocket State: ${getWebSocketState()}`);
        console.log(`   📱 User: ${sock?.user?.id || "unknown"}`);
        console.log(`   🔄 Previous Reconnect Attempts: ${reconnectAttempts}`);
        console.log(`   🌡️ Phase: WARMING (Signal ratchet stabilizing...)`);
        console.log(`${"=".repeat(60)}\n`);

        logConnectionState("CONNECTION_OPEN", { userId: sock?.user?.id });

        // CRITICAL: Update socket manager FIRST before setting connectionStatus
        // This prevents race condition where jobs check connectionStatus but socketManager is stale
        socketManager.setConnectionStatus("connected");
        socketManager.setSocket(sock);
        socketManager.setSendFunctions(sendMessage, sendImage);

        // NOW safe to set connectionStatus - socketManager is already updated
        connectionStatus = "connected";

        qrCodeData = null;
        currentQR = null;

        // Reset reconnection tracking on successful connection
        reconnectAttempts = 0;
        isReconnecting = false;
        zombieDetectionCount = 0;
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }

        // 📢 Send admin alert about successful reconnection
        sendAdminAlert("RECONNECT", {
          attempts: reconnectAttempts,
          userId: sock?.user?.id,
        });

        // ============================================
        // 🌡️ SESSION WARMUP - Signal Ratchet Stabilization
        // ============================================
        // After Baileys opens the connection, the Signal protocol session ratchet
        // needs 5-10 seconds to stabilize. During this WARMING phase:
        // - Queue is paused (no sends)
        // - Schedulers don't execute (waits for STABLE phase)
        // - Bad MAC errors during this period are expected and harmless
        // After SESSION_WARMUP_DURATION_MS, phase auto-transitions to STABLE
        console.log(
          `⏳ Starting ${SESSION_WARMUP_DURATION_MS}ms session warmup...`
        );

        // ============================================
        if (sock && sock.ws) {
          console.log(`🔌 [WS] Setting up WebSocket event monitors...`);

          // Monitor WebSocket close event
          sock.ws.on("close", (code, reason) => {
            const reasonStr = reason?.toString() || "unknown";
            webSocketCloseCode = code;
            webSocketCloseReason = reasonStr;
            console.error(`\n🔌 [WS] ⚠️ WebSocket CLOSED!`);
            console.error(`   Code: ${code}`);
            console.error(`   Reason: ${reasonStr}`);
            console.error(`   Connection Status: ${connectionStatus}`);

            // If we still think we're connected, this is a zombie situation
            if (connectionStatus === "connected") {
              console.error(
                `   🧟 ZOMBIE CONDITION: Status='connected' but WS closed!`
              );
              // Queue notification about unexpected close
              queueAdminNotification(
                `🔌 *WebSocket مغلق بشكل غير متوقع*\n\n` +
                  `📊 Code: ${code}\n` +
                  `📝 السبب: ${reasonStr}\n` +
                  `📨 الرسائل المعالجة: ${totalMessagesProcessed}`
              );
            }
          });

          // Monitor WebSocket error event
          sock.ws.on("error", (error) => {
            lastWebSocketError = error.message;
            console.error(`\n🔌 [WS] ⚠️ WebSocket ERROR!`);
            console.error(`   Error: ${error.message}`);
            console.error(`   Connection Status: ${connectionStatus}`);
          });

          // Monitor WebSocket pong (response to ping)
          sock.ws.on("pong", () => {
            console.log(`🏓 [WS] Pong received from server`);
          });

          console.log(`✅ [WS] WebSocket event monitors active`);
        }

        // CRITICAL: Update all services with new socket reference first
        // This ensures all services have the current live socket before initialization
        updateAllServicesSocket(sock);

        // Initialize reminder scheduler
        reminderScheduler.initScheduler(sock);

        // Initialize custom message scheduler
        const messageSchedulerService = require("../services/messageSchedulerService");
        messageSchedulerService.initScheduler(sock, sendMessage, sendImage);
        console.log("✅ Custom message scheduler initialized");

        // Initialize scheduled WhatsApp messages service
        const scheduledWhatsappService = require("../services/scheduledWhatsappService");
        scheduledWhatsappService.initScheduledMessages(
          sock,
          sendMessage,
          sendImage
        );
        console.log("✅ Scheduled WhatsApp messages service initialized");

        // Start message queue processor for reliable delivery
        const adminCommandService = require("../services/adminCommandService");
        adminCommandService.startQueueProcessor();
        console.log("✅ Message queue processor initialized");

        // Start keepalive ping to prevent WebSocket from going stale
        startKeepalivePing();
        console.log("✅ WebSocket keepalive ping started");

        // ============================================
        // 📬 DELIVER PENDING NOTIFICATIONS
        // 🌡️ CRITICAL: Now waits internally for STABLE phase
        // This prevents Bad MAC errors during Signal stabilization
        // ============================================
        deliverPendingNotifications().catch((e) => {
          console.error(
            "❌ Error delivering pending notifications:",
            e.message
          );
        });

        // Fetch all groups when connected
        setTimeout(async () => {
          try {
            const groups = await sock.groupFetchAllParticipating();
            console.log(`Found ${Object.keys(groups).length} groups`);

            Object.values(groups).forEach((group) => {
              const jid = group.id;
              seenGroups.add(jid);
              groupsMetadata[jid] = {
                jid: jid,
                name: group.subject || jid,
              };
            });

            console.log("All groups loaded successfully");
          } catch (err) {
            console.error("Failed to fetch groups:", err);
          }
        }, 2000);

        // ============================================
        // 🔄 AUTO-RECONNECT FOR STALE CONNECTIONS
        // Automatically reconnects when message handler stops receiving events
        // This fixes the "zombie connection" issue in Baileys
        // ENHANCED: Now also checks WebSocket state directly
        // ============================================
        if (messageHandlerHealthCheckInterval) {
          clearInterval(messageHandlerHealthCheckInterval);
        }

        // Track that we successfully connected - used to determine if we should auto-reconnect
        const connectionStartTime = Date.now();
        let hasReceivedFirstMessage = false;

        messageHandlerHealthCheckInterval = setInterval(async () => {
          if (connectionStatus !== "connected" || !sock) return;

          const timeSinceLastMessage = Date.now() - lastMessageReceivedAt;
          const minutesSinceLastMessage = Math.floor(
            timeSinceLastMessage / 60000
          );
          const minutesSinceConnectionStart = Math.floor(
            (Date.now() - connectionStartTime) / 60000
          );
          const wsState = getWebSocketState();
          const wsReadyState = getWebSocketReadyState();

          // Log health status every check (enhanced with WS state)
          console.log(
            `📊 [HEALTH CHECK] Last msg: ${minutesSinceLastMessage}min ago | Processed: ${totalMessagesProcessed} | Age: ${minutesSinceConnectionStart}min | WS: ${wsState}`
          );

          // ============================================
          // 🔍 ZOMBIE DETECTION: Check WebSocket state
          // Only trigger if WebSocket is DEFINITELY dead (CLOSING=2 or CLOSED=3)
          // wsReadyState -1 means sock.ws not accessible - NOT a zombie indicator
          // ============================================
          if (wsReadyState >= 2) {
            // CLOSING or CLOSED
            console.error(
              `🧟 [HEALTH CHECK] ZOMBIE DETECTED! WS: ${wsState} (${wsReadyState}) but status: ${connectionStatus}`
            );
            logConnectionState("HEALTH_CHECK_ZOMBIE", {
              wsState,
              wsReadyState,
            });

            // Queue notification for after reconnection
            queueAdminNotification(
              `🧟 *اتصال ميت (Zombie)*\n\n` +
                `⚠️ فحص الصحة كشف مشكلة\n` +
                `🔌 WebSocket: ${wsState}\n` +
                `📊 الرسائل: ${totalMessagesProcessed}\n` +
                `⏱️ عمر الاتصال: ${minutesSinceConnectionStart} دقيقة\n` +
                `🔄 جاري إعادة الاتصال...`
            );

            // Clear interval
            if (messageHandlerHealthCheckInterval) {
              clearInterval(messageHandlerHealthCheckInterval);
              messageHandlerHealthCheckInterval = null;
            }

            // Force reconnect
            await forceReconnect("HEALTH_CHECK_ZOMBIE");
            return;
          }

          // Update flag if we received any messages
          if (totalMessagesProcessed > 0) {
            hasReceivedFirstMessage = true;
          }

          // ============================================
          // 🎯 PRODUCTION RECONNECT LOGIC (Multi-Signal)
          // ============================================
          // WhatsApp Web can be idle for HOURS - silence alone is NOT a failure signal.
          // Only reconnect when MULTIPLE failure indicators are present:
          //   1. Zombie WebSocket (already handled above)
          //   2. Ping failures (handled by keepalive monitor)
          //   3. Bad MAC storm (session corruption)
          //   4. NEVER received messages after 30 min (initial connection failure)
          //
          // REMOVED: 8-minute message silence check (caused false positives)
          // ============================================

          const INITIAL_CONNECTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes for first message

          // Scenario A: Persistent Bad MAC errors (session corruption)
          const scenarioA_PersistentBadMac = badMacDetectionCount >= 5;

          // Scenario B: Initial connection NEVER received any messages for 30 minutes
          // (This catches actual connection failures, not normal idle periods)
          const scenarioB_InitialConnectionFailure =
            !hasReceivedFirstMessage &&
            totalMessagesProcessed === 0 &&
            Date.now() - connectionStartTime > INITIAL_CONNECTION_TIMEOUT_MS;

          const shouldAutoReconnect =
            scenarioA_PersistentBadMac || scenarioB_InitialConnectionFailure;

          if (shouldAutoReconnect) {
            let reason = "UNKNOWN";
            if (scenarioA_PersistentBadMac) reason = "BAD_MAC";
            else if (scenarioB_InitialConnectionFailure)
              reason = "INITIAL_CONNECTION_TIMEOUT";

            console.warn(`\n🚨 ============================================`);
            console.warn(`🚨 STALE/BROKEN CONNECTION DETECTED`);
            console.warn(`🚨 Reason: ${reason}`);
            console.warn(
              `🚨 Last message: ${minutesSinceLastMessage} minutes ago`
            );
            console.warn(`🚨 Total processed: ${totalMessagesProcessed}`);
            console.warn(`🚨 WebSocket: ${wsState}`);
            console.warn(`🚨 ============================================\n`);

            logConnectionState("AUTO_RECONNECT_TRIGGERED", {
              reason,
              minutesSinceLastMessage,
              wsState,
            });

            // Queue notification for after reconnection (don't try to send now)
            let alertMsg = `🔄 *إعادة اتصال تلقائية*\n\n`;
            if (scenarioA_PersistentBadMac) {
              alertMsg += `⚠️ مشاكل في فك تشفير الرسائل (Bad MAC)\n`;
            } else if (scenarioB_InitialConnectionFailure) {
              alertMsg += `⚠️ فشل الاتصال الأولي (30 دقيقة بدون رسائل)\n`;
            }
            alertMsg += `📊 الرسائل المعالجة: ${totalMessagesProcessed}\n`;
            alertMsg += `🔌 WebSocket: ${wsState}\n`;
            alertMsg += `🔄 تم إعادة الاتصال تلقائياً`;

            queueAdminNotification(alertMsg);

            // Reset Bad MAC counter
            badMacDetectionCount = 0;
            sessionResetScheduled = false;

            // ============================================
            // 🔄 SESSION REPAIR/RESET (LID Migration Fix)
            // Fixes corrupted sessions using soft repair or full reset
            // ============================================
            if (scenarioA_PersistentBadMac) {
              if (!softRepairAttempted) {
                // FIRST ATTEMPT: Soft Repair (preserves QR)
                softRepairSessions();
              } else {
                // SECOND ATTEMPT: Full Reset (requires QR)
                console.log(
                  "🗑️ [FULL RESET] Soft repair failed to fix errors. Clearing everything..."
                );
                try {
                  const authPath = path.join(
                    __dirname,
                    "..",
                    "auth_info_baileys"
                  );
                  if (fs.existsSync(authPath)) {
                    fs.rmSync(authPath, { recursive: true, force: true });
                    console.log("✅ Session files cleared successfully");
                    console.log("📱 You will need to scan a new QR code");
                  }

                  if (fs.existsSync(STORE_FILE)) {
                    fs.rmSync(STORE_FILE, { force: true });
                    console.log("✅ Message store cleared");
                  }

                  // Reset repair flag for future
                  softRepairAttempted = false;
                } catch (clearError) {
                  console.error(
                    "❌ Error during full reset:",
                    clearError.message
                  );
                }
              }
            }

            // Clear the interval to prevent multiple reconnect attempts
            if (messageHandlerHealthCheckInterval) {
              clearInterval(messageHandlerHealthCheckInterval);
              messageHandlerHealthCheckInterval = null;
            }

            // Use centralized forceReconnect function
            await forceReconnect(reason);
            return; // Exit this interval callback
          }

          // No warning needed - WhatsApp Web can be idle for hours in production
        }, 2 * 60 * 1000); // Check every 2 minutes

        console.log(
          "✅ Auto-reconnect health monitor initialized (triggers on: Bad MAC storm, initial connection timeout)"
        );
      }
    });

    // Message handler: fetch messages from groups and store as 'ads'
    console.log("🎧 Setting up messages.upsert event listener...");
    sock.ev.on("messages.upsert", async ({ messages }) => {
      // ============================================
      // 🔍 HEALTH TRACKING - Update activity timestamp
      // ============================================
      lastMessageReceivedAt = Date.now();
      totalMessagesProcessed++;

      console.log(
        `🔔 [${new Date().toISOString()}] messages.upsert #${totalMessagesProcessed} - Messages count: ${
          messages.length
        }`
      );

      // ============================================
      // 📦 CACHE MESSAGES FOR RETRY HANDLING
      // ============================================
      for (const msg of messages) {
        if (msg.key && msg.message) {
          cacheMessage(msg.key, msg);
        }
      }

      // ============================================
      // 🛡️ CONNECTION VALIDATION - Check before processing
      // ============================================
      if (connectionStatus !== "connected") {
        console.warn(
          `⚠️ [HEALTH] Ignoring message - connection status: ${connectionStatus}`
        );
        return;
      }

      if (!sock) {
        console.warn(`⚠️ [HEALTH] Ignoring message - sock is null`);
        return;
      }

      // Process ALL messages, not just the first one
      // (Baileys may batch multiple messages in a single upsert event)
      for (const msg of messages) {
        try {
          // Log all incoming messages for debugging
          console.log(
            `📨 Message received - fromMe: ${
              msg.key.fromMe
            }, hasMessage: ${!!msg.message}, remoteJid: ${msg.key.remoteJid}`
          );

          // Skip messages without content
          if (!msg.message) {
            console.log(`⏩ Skipping message - no message content`);
            continue;
          }

          const messageText =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            null;

          // Check if it's media without text (voice, image without caption, video without caption, sticker, document, etc.)
          const isMediaOnly =
            !messageText &&
            (msg.message?.audioMessage ||
              msg.message?.imageMessage ||
              msg.message?.videoMessage ||
              msg.message?.documentMessage ||
              msg.message?.stickerMessage ||
              msg.message?.contactMessage ||
              msg.message?.locationMessage);

          const from = msg.key.remoteJid;

          // Extract sender name (pushName) from WhatsApp
          const senderName = msg.pushName || msg.verifiedBisName || "Unknown";

          // Extract sender phone number
          const senderJid = msg.key.participant || msg.key.remoteJid || null;
          // Extract actual phone number from JID (e.g., "240917902585982@lid" -> "240917902585982")
          const senderPhone = senderJid ? senderJid.split("@")[0] : null;

          // Extract image URL if present
          let imageUrl = null;
          if (msg.message?.imageMessage) {
            imageUrl = msg.message.imageMessage;
          }

          // Accept messages from groups (@g.us) and communities (@broadcast)
          if (!from) continue;

          const isGroup = from.endsWith("@g.us");
          const isCommunity = from.includes("@broadcast");
          // Handle regular WhatsApp IDs (@s.whatsapp.net) and @lid (WhatsApp Business/linked devices)
          const isPrivate =
            from.endsWith("@s.whatsapp.net") || from.endsWith("@lid");
          const isLid = from.endsWith("@lid");

          // ============================================
          // 🚫 IGNORE STATUS & UNWANTED BROADCASTS
          // ============================================
          // Filter out status@broadcast (WhatsApp statuses)
          if (from === "status@broadcast" || from.startsWith("status@")) {
            console.log(`⏭️ Ignoring status broadcast message`);
            continue; // Completely ignore WhatsApp status messages
          }

          // Filter out ALL broadcast channels except groups and private chats
          // You can whitelist specific broadcast channels here if needed
          if (isCommunity && !isGroup && !isPrivate) {
            console.log(`⏭️ Ignoring broadcast channel: ${from}`);
            continue; // Ignore all broadcast channels (communities) - only process groups and private chats
          }

          // ============================================
          // PRIVATE CHAT SYSTEM - Handle all private messages
          // ============================================
          if (isPrivate && (messageText || isMediaOnly)) {
            console.log(
              `💬 Private message from: ${senderName} (${senderPhone}), JID: ${from}`
            );

            try {
              const phoneNumber = privateChatService.extractPhoneNumber(from);
              console.log(`📱 Extracted phone number: ${phoneNumber}`);

              // ============================================
              // 🔒 ADMIN-ONLY MODE - Only respond to admins
              // ============================================
              // NOTE: The bot cannot see messages sent from its own WhatsApp account
              // So we use admin numbers from adminCommandService instead
              const isAdmin = adminCommandService.isAdmin(from);

              // ✋ If not an admin, ignore silently (don't respond to non-admins)
              if (!isAdmin) {
                if (isLid) {
                  console.log(`🔗 Unregistered LID message ignored: ${from}`);
                } else {
                  console.log(
                    `🚫 Message ignored - sender is not an admin: ${senderName} (${senderPhone})`
                  );
                }
                continue; // Don't respond to non-admins
              }

              console.log(
                `✅ Admin message detected from: ${senderName} (${senderPhone})`
              );

              // Admin commands to control bot responses (with confirmation)
              if (messageText) {
                const command = messageText.trim();
                const commandParts = command.split(/\s+/);
                const rawMain = commandParts[0] || "";
                const mainCommand = rawMain.replace(
                  /[^\u0600-\u06FFa-zA-Z]/g,
                  ""
                );

                // First check if admin is confirming or cancelling a pending action
                const bare = command
                  .replace(/[^\u0600-\u06FFa-zA-Z]/g, "")
                  .toLowerCase();
                const confirmWords = [
                  "تأكيد",
                  "تأكيداً",
                  "نعم",
                  "confirm",
                  "yes",
                  "موافق",
                  "ok",
                ];
                const cancelWords = [
                  "الغاء",
                  "الغاءً",
                  "إلغاء",
                  "لا",
                  "cancel",
                ];

                if (pendingActions[from]) {
                  if (confirmWords.includes(bare)) {
                    const action = pendingActions[from];
                    delete pendingActions[from];

                    // Perform the pending action now
                    if (action.type === "stop") {
                      let successCount = 0;
                      let alreadyBlockedCount = 0;
                      const blockedList = [];
                      for (const targetPhone of action.phones) {
                        const client =
                          privateClientModel.getClient(targetPhone);
                        if (client.botBlocked) {
                          alreadyBlockedCount++;
                        } else {
                          privateClientModel.updateClient(targetPhone, {
                            botBlocked: true,
                            botBlockedAt: Date.now(),
                            botBlockedBy: from,
                          });
                          successCount++;
                          blockedList.push(`📱 +${targetPhone}`);
                        }
                      }
                      let responseMsg = "";
                      if (successCount > 0) {
                        responseMsg += `✅ تم إيقاف البوت عن الرد مع ${successCount} عميل:\n\n`;
                        responseMsg += blockedList.join("\n");
                        responseMsg += `\n\n💬 الآن يمكنك التحدث مباشرة مع العملاء\n\nلإعادة التشغيل، أرسل: تشغيل`;
                      }
                      if (alreadyBlockedCount > 0) {
                        if (responseMsg) responseMsg += "\n\n";
                        responseMsg += `⚠️ ${alreadyBlockedCount} عميل كان موقوفاً بالفعل`;
                      }
                      await sendMessage(
                        from,
                        responseMsg || "✅ لا تغييرات مطلوبة"
                      );
                      return;
                    } else if (action.type === "start") {
                      let successCount = 0;
                      let notBlockedCount = 0;
                      const unblockedList = [];
                      for (const targetPhone of action.phones) {
                        const targetClient =
                          privateClientModel.getClient(targetPhone);
                        if (targetClient.botBlocked) {
                          privateClientModel.updateClient(targetPhone, {
                            botBlocked: false,
                            botBlockedAt: null,
                            botBlockedBy: null,
                          });
                          successCount++;
                          unblockedList.push(
                            `📱 +${targetPhone} (${
                              targetClient.name || "غير محدد"
                            })`
                          );
                        } else {
                          notBlockedCount++;
                        }
                      }
                      let responseMsg = "";
                      if (successCount > 0) {
                        responseMsg += `✅ تم تشغيل البوت مع ${successCount} عميل:\n\n`;
                        responseMsg += unblockedList.join("\n");
                        responseMsg += `\n\n🤖 البوت سيستأنف الردود التلقائية الآن`;
                      }
                      if (notBlockedCount > 0) {
                        if (responseMsg) responseMsg += "\n\n";
                        responseMsg += `⚠️ ${notBlockedCount} عميل لم يكن موقوفاً`;
                      }
                      await sendMessage(
                        from,
                        responseMsg || "✅ لا تغييرات مطلوبة"
                      );
                      return;
                    } else if (action.type === "waseet") {
                      let successCount = 0;
                      let alreadyWaseetCount = 0;
                      const waseetList = [];
                      for (const targetPhone of action.phones) {
                        const client =
                          privateClientModel.getClient(targetPhone);
                        if (client.isWaseet) {
                          alreadyWaseetCount++;
                        } else {
                          privateClientModel.updateClient(targetPhone, {
                            isWaseet: true,
                            waseetAddedAt: Date.now(),
                            waseetAddedBy: from,
                          });
                          successCount++;
                          waseetList.push(
                            `📱 +${targetPhone} (${client.name || "غير محدد"})`
                          );
                        }
                      }
                      let responseMsg = "";
                      if (successCount > 0) {
                        responseMsg += `✅ تم إضافة ${successCount} وسيط جديد:\n\n`;
                        responseMsg += waseetList.join("\n");
                      }
                      if (alreadyWaseetCount > 0) {
                        if (responseMsg) responseMsg += "\n\n";
                        responseMsg += `⚠️ ${alreadyWaseetCount} عميل كان وسيطاً بالفعل`;
                      }
                      await sendMessage(
                        from,
                        responseMsg || "✅ لا تغييرات مطلوبة"
                      );
                      return;
                    }
                  }

                  if (cancelWords.includes(bare)) {
                    delete pendingActions[from];
                    await sendMessage(from, "❌ تم إلغاء العملية.");
                    return;
                  }
                }

                // If no pending action or not a confirmation, parse the admin command and prepare an action
                // Extract phone numbers more flexibly (supports spaces/dashes/parentheses)
                const targetPhones = extractAndNormalizePhoneNumbers(command);

                console.log(
                  `🔍 DEBUG - Admin command: ${mainCommand}, extracted phones: ${targetPhones.join(
                    ", "
                  )}`
                );

                if (mainCommand === "ايقاف" || mainCommand === "توقف") {
                  if (targetPhones.length === 0) {
                    await sendMessage(
                      from,
                      `❌ يرجى تحديد أرقام الهواتف\n\nمثال:\nتوقف +966508007053\n\nأو عدة أرقام:\nتوقف\n+966508007053\n+966508007054\n+966508007055`
                    );
                    return;
                  }

                  // Ask for confirmation before applying
                  pendingActions[from] = {
                    type: "stop",
                    phones: targetPhones,
                    createdAt: Date.now(),
                  };
                  const display = targetPhones
                    .map(formatPhoneForDisplay)
                    .join("\n");
                  await sendMessage(
                    from,
                    `🛑 طلب إيقاف البوت للأرقام التالية:\n\n${display}\n\nللمتابعة أرسل: تأكيد\nللإلغاء أرسل: إلغاء`
                  );
                  return;
                } else if (mainCommand === "تشغيل" || mainCommand === "تفعيل") {
                  if (targetPhones.length === 0) {
                    await sendMessage(
                      from,
                      `❌ يرجى تحديد أرقام الهواتف\n\nمثال:\nتشغيل +966508007053\n\nأو عدة أرقام:\nتشغيل\n+966508007053\n+966508007054\n+966508007055`
                    );
                    return;
                  }
                  pendingActions[from] = {
                    type: "start",
                    phones: targetPhones,
                    createdAt: Date.now(),
                  };
                  const display = targetPhones
                    .map(formatPhoneForDisplay)
                    .join("\n");
                  await sendMessage(
                    from,
                    `✅ طلب تشغيل البوت للأرقام التالية:\n\n${display}\n\nللمتابعة أرسل: تأكيد\nللإلغاء أرسل: إلغاء`
                  );
                  return;
                } else if (mainCommand === "وسيط" || mainCommand === "وسطاء") {
                  if (targetPhones.length === 0) {
                    await sendMessage(
                      from,
                      `❌ يرجى تحديد أرقام الهواتف\n\nمثال:\nوسيط +966508007053\n\nأو عدة أرقام:\nوسيط\n+966508007053\n+966508007054\n+966508007055`
                    );
                    return;
                  }
                  pendingActions[from] = {
                    type: "waseet",
                    phones: targetPhones,
                    createdAt: Date.now(),
                  };
                  const display = targetPhones
                    .map(formatPhoneForDisplay)
                    .join("\n");
                  await sendMessage(
                    from,
                    `🤝 طلب إضافة وسطاء للأرقام التالية:\n\n${display}\n\nللمتابعة أرسل: تأكيد\nللإلغاء أرسل: إلغاء`
                  );
                  return;
                }
              }

              // ============================================
              // ADMIN COMMANDS - Check if other admin commands
              // ============================================
              const adminResponse =
                await adminCommandService.handleAdminCommand(
                  sock,
                  messageText,
                  from
                );

              // If it's an admin command, send response and return
              if (adminResponse) {
                await sendMessage(from, adminResponse);
                console.log(`✅ Admin command executed by ${senderName}`);
                return;
              }

              // ============================================
              // WASEET (وسيط) DETECTION - Filter messages before dashboard
              // ============================================
              if (waseetDetector.isWaseet(from)) {
                console.log(`🔍 Message from waseet: ${senderName}`);

                // Skip media-only messages
                if (isMediaOnly && !messageText) {
                  console.log(
                    `⏭️ Ignoring media-only message from waseet ${senderName}`
                  );
                  return;
                }

                // Stage 1: Quick local check (FREE - no tokens)
                if (!waseetDetector.isLikelyAd(messageText)) {
                  console.log(
                    `❌ Not likely an ad from waseet ${senderName}, ignoring...`
                  );
                  return; // Don't send to dashboard or AI
                }

                // Stage 2: Only use AI if it passes basic check
                console.log(
                  `✅ Potential ad from waseet ${senderName}, processing with AI...`
                );

                // Process through AI
                const aiResult = await processMessage(messageText);

                console.log(
                  `🔍 AI Result for waseet: isAd=${aiResult.isAd}, confidence=${aiResult.confidence}%`
                );

                // If not confirmed as ad, ignore
                if (!aiResult.isAd) {
                  console.log(
                    `❌ AI confirmed not an ad from waseet ${senderName} (confidence: ${aiResult.confidence}%)`
                  );
                  return;
                }

                // ✅ Confirmed ad from waseet - Add to dashboard
                console.log(
                  `✅ Confirmed ad from waseet ${senderName}, adding to dashboard...`
                );

                // Create ad object (similar to group ads)
                const normalized = normalizeText(messageText);
                const ad = {
                  id: `${Date.now()}_${Math.floor(Math.random() * 10000)}`,
                  text: messageText,
                  enhancedText: aiResult.enhancedText,
                  normalizedText: normalized,
                  fromGroup: from,
                  fromGroupName: `وسيط: ${senderName}`,
                  author: from,
                  senderName: senderName,
                  senderPhone: senderPhone,
                  imageUrl: imageUrl,
                  messageKey: msg.key,
                  timestamp: Date.now(),
                  status: "new",
                  category: aiResult.category || null,
                  aiConfidence: aiResult.confidence,
                  aiReason: aiResult.reason,
                  improvements: aiResult.improvements || [],
                  isEdited: false,
                  meta: aiResult.meta || {},
                  wpData: aiResult.wpData || null,
                  whatsappMessage: aiResult.whatsappMessage || null,
                  source: "waseet", // Mark as waseet ad
                };

                ads.unshift(ad);
                if (ads.length > 1000) ads = ads.slice(0, 1000);
                saveAds();

                // Increment ad counter for this waseet
                waseetDetector.incrementAdCount(from);

                console.log(
                  `✨ Waseet ad saved successfully! ID: ${ad.id}, From: ${senderName}`
                );

                // Check if auto-approve is enabled and auto-post to WordPress
                const settings = getSettings();
                if (settings.autoApproveWordPress === true && ad.wpData) {
                  console.log(
                    "🚀 Auto-approve enabled, posting waseet ad to WordPress automatically..."
                  );

                  // Auto-post to WordPress using the SAME function as manual posting
                  (async () => {
                    try {
                      // Import the WordPress posting function from routes
                      const { postAdToWordPress } = require("../routes/bot");

                      console.log(
                        "🔵 Starting WordPress auto-post for waseet ad using manual function..."
                      );
                      console.log("🔵 Ad ID:", ad.id);

                      // Call the same function used for manual posting
                      const result = await postAdToWordPress(
                        ad,
                        sock,
                        ad.wpData,
                        false
                      );

                      if (result.success) {
                        console.log(
                          "✅ ✅ ✅ Waseet ad auto-posted to WordPress successfully! ✅ ✅ ✅"
                        );
                        console.log("📌 Post ID:", result.wordpressPost.id);
                        console.log(
                          "📌 Short Link:",
                          result.wordpressPost.link
                        );

                        // Update ad status to "accepted" (not "posted")
                        ad.status = "accepted";
                        ad.wordpressPostId = result.wordpressPost.id;
                        ad.wordpressUrl = result.wordpressPost.link;
                        ad.wordpressFullUrl = result.wordpressPost.fullLink;
                        ad.whatsappMessage = result.whatsappMessage;
                        ad.wpData = result.extractedData;

                        // Save updated ad
                        saveAds();
                        console.log(
                          "✅ Waseet ad updated with WordPress info and marked as accepted"
                        );
                      } else {
                        console.error(
                          "❌ WordPress posting returned unsuccessful result"
                        );
                      }
                    } catch (error) {
                      console.error(
                        "❌ ❌ ❌ Error during waseet auto-post to WordPress ❌ ❌ ❌"
                      );
                      console.error("Error message:", error.message);
                      console.error(
                        "Error details:",
                        error.response?.data || error
                      );
                    }
                  })();
                }

                // Send confirmation to waseet
                await sendMessage(
                  from,
                  `✅ تم استلام إعلانك بنجاح وإضافته إلى قائمة الانتظار.\n\n📊 التصنيف: ${
                    aiResult.category || "غير محدد"
                  }\n🎯 الدقة: ${aiResult.confidence}%\n\nشكراً لك! 🙏`
                );

                return; // Don't process through regular private chat system
              }

              // ============================================
              // REGULAR PRIVATE CHAT - For admins only
              // ============================================
              const privateClientModel = require("../models/privateClient");

              // Get client to check state
              const clientData = privateClientModel.getClient(phoneNumber);

              // If it's media only without text, handle based on state
              if (isMediaOnly && !messageText) {
                console.log(
                  `📎 Media-only message detected from: ${senderName}`
                );

                // Only warn if waiting for name or awaiting_requirements (when text is needed)
                const needsTextInput =
                  clientData.state === "awaiting_name" ||
                  clientData.state === "awaiting_requirements";

                if (needsTextInput) {
                  // Check if we already warned this user about media (use a flag in client object)
                  if (!clientData.mediaWarningShown) {
                    await sendMessage(
                      from,
                      "عذراً، لا أستطيع معالجة الرسائل الصوتية أو الوسائط بدون نص حالياً. 📎\n\nمن فضلك اكتب رسالة نصية، أو تواصل معنا مباشرة:\n📱 *0508001475*"
                    );
                    // Mark that we've shown the warning
                    privateClientModel.updateClient(phoneNumber, {
                      mediaWarningShown: true,
                    });
                  } else {
                    console.log(
                      `⏭️ Already warned about media, ignoring subsequent media from ${senderName}`
                    );
                  }
                } else {
                  // In other states (completed, awaiting_role, etc.), just ignore media silently
                  console.log(`⏭️ Media ignored in state: ${clientData.state}`);
                }
                return;
              }

              // Reset media warning flag when user sends text (they're following instructions now)
              if (messageText && clientData.mediaWarningShown) {
                privateClientModel.updateClient(phoneNumber, {
                  mediaWarningShown: false,
                });
              }

              // Create sendReply function that uses sendMessage
              const sendReply = async (message) => {
                await sendMessage(from, message);
              };

              // Create sendImageReply function that uses sendImage
              const sendImageReply = async (imageData, caption) => {
                await sendImage(from, imageData, caption);
              };

              // Handle the private message with the conversation system
              await privateChatService.handlePrivateMessage(
                phoneNumber,
                messageText,
                sendReply,
                sendImageReply
              );

              console.log(`✅ Private chat response sent to ${senderName}`);
              continue; // Don't process through regular private chat system
            } catch (error) {
              console.error("❌ Private chat system error:", error);
              await sendMessage(
                from,
                "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى لاحقاً. 🙏"
              );
            }
          }

          // ============================================
          // ORIGINAL AD PROCESSING - Only for groups
          // ============================================
          if (!isGroup) continue; // Only process groups (@g.us) for ads, ignore everything else

          // ============================================
          // CHECK EXCLUDED GROUPS - Skip if excluded
          // ============================================
          if (
            settings.excludedGroups &&
            settings.excludedGroups.includes(from)
          ) {
            console.log(`⏭️ Skipping excluded group: ${from}`);
            // Still save the group metadata but don't process messages
            seenGroups.add(from);

            // Try to get group/community subject (best-effort)
            try {
              const metadata = await sock.groupMetadata(from).catch(() => null);
              if (metadata && metadata.subject) {
                groupsMetadata[from] = {
                  jid: from,
                  name: metadata.subject,
                  type: isCommunity ? "Community" : "Group",
                  isCommunity: isCommunity,
                };
              }
            } catch (e) {
              // ignore
            }
            continue; // Don't process messages from this group
          }

          // Save ALL groups/communities for receiving messages
          seenGroups.add(from);

          // Try to get group/community subject (best-effort)
          let groupSubject = from;
          try {
            const metadata = await sock.groupMetadata(from).catch(() => null);
            if (metadata && metadata.subject) {
              groupSubject = metadata.subject;
              // Cache metadata for ALL groups (even if bot can't send)
              groupsMetadata[from] = {
                jid: from,
                name: groupSubject,
                type: isCommunity ? "Community" : "Group",
                isCommunity: isCommunity,
              };
            }
          } catch (e) {
            // ignore
          }

          if (!messageText) return;

          console.log(`📨 New message received from Group:`, groupSubject);

          // Add message to queue for processing
          messageQueue
            .add(
              {
                messageText,
                from,
                groupSubject,
                senderName,
                senderPhone,
                imageUrl,
                participant: msg.key.participant,
                remoteJid: msg.key.remoteJid,
                messageKey: msg.key,
              },
              processMessageFromQueue
            )
            .catch((error) => {
              console.error("❌ Failed to process message from queue:", error);
            });
        } catch (error) {
          messageHandlerErrors++;
          console.error("❌ ============================================");
          console.error(
            `❌ CRITICAL ERROR in message handler (error #${messageHandlerErrors})`
          );
          console.error(`❌ Time: ${new Date().toISOString()}`);
          console.error(`❌ Error:`, error.message || error);
          console.error(`❌ Stack:`, error.stack);
          console.error("❌ ============================================");

          // Try to notify admin about critical failures (every 5th error to avoid spam)
          if (
            messageHandlerErrors % 5 === 1 &&
            sock &&
            connectionStatus === "connected"
          ) {
            try {
              await sock.sendMessage(ADMIN_NOTIFICATION_JID, {
                text: `⚠️ *تنبيه: خطأ في البوت*\n\n🕐 الوقت: ${new Date().toLocaleString(
                  "ar-EG",
                  { timeZone: "Africa/Cairo" }
                )}\n❌ الخطأ: ${
                  error.message?.substring(0, 100) || "Unknown"
                }\n📊 إجمالي الأخطاء: ${messageHandlerErrors}\n\nيرجى مراجعة سجلات الخادم.`,
              });
              console.log("📧 Admin notified about message handler error");
            } catch (notifyError) {
              console.error("❌ Failed to notify admin:", notifyError.message);
            }
          }
        }
      } // End for loop over messages
    });

    // Retry any pending ads from previous runs
    console.log("🔍 Checking for pending ads to retry...");
    setTimeout(() => retryPendingAds(), 30000); // Wait 30 seconds after startup

    // Return sock instance for use in routes
    return sock;
  } catch (error) {
    console.error("Error initializing bot:", error);
    connectionStatus = "error";
    return null;
  } finally {
    // Release cross-process lock
    try {
      releaseInitLock();
    } catch {}
    initInProgress = false;
  }
}

function getQRCode() {
  return qrCodeData;
}

function getConnectionStatus() {
  return connectionStatus;
}

/**
 * Get message handler health status
 * @returns {Object} Health status including last message time, total processed, errors, WebSocket state
 */
function getMessageHandlerHealth() {
  const timeSinceLastMessage = Date.now() - lastMessageReceivedAt;
  const minutesSinceLastMessage = Math.floor(timeSinceLastMessage / 60000);

  // WebSocket state info
  const wsState = getWebSocketState();
  const wsReadyState = getWebSocketReadyState();
  const isZombie = isZombieConnection();

  // Auto-reconnect timing info (thresholds: 8 min stale, 15 min no messages)
  const hasReceivedAnyMessages = totalMessagesProcessed > 0;
  let autoReconnectStatus;
  let minutesUntilAutoReconnect;

  if (isZombie) {
    autoReconnectStatus = "🧟 ZOMBIE CONNECTION - Reconnection pending!";
    minutesUntilAutoReconnect = 0;
  } else if (hasReceivedAnyMessages) {
    // Scenario A: Stale after working - triggers at 8 min
    minutesUntilAutoReconnect = Math.max(0, 8 - minutesSinceLastMessage);
    autoReconnectStatus =
      minutesUntilAutoReconnect > 0
        ? `${minutesUntilAutoReconnect} min until auto-reconnect (stale threshold: 8 min)`
        : "🚨 Auto-reconnect should trigger soon!";
  } else {
    // Scenario B: Never received - triggers at 15 min of connection
    autoReconnectStatus =
      "Waiting for first message (auto-reconnect at 15 min if no messages)";
    minutesUntilAutoReconnect = null;
  }

  return {
    lastMessageReceivedAt: lastMessageReceivedAt,
    minutesSinceLastMessage: minutesSinceLastMessage,
    totalMessagesProcessed: totalMessagesProcessed,
    messageHandlerErrors: messageHandlerErrors,
    hasReceivedAnyMessages: hasReceivedAnyMessages,
    autoReconnectStatus: autoReconnectStatus,
    minutesUntilAutoReconnect: minutesUntilAutoReconnect,
    // Enhanced health check with WS state
    isHealthy:
      !isZombie &&
      wsReadyState === 1 &&
      ((hasReceivedAnyMessages && minutesSinceLastMessage < 8) ||
        !hasReceivedAnyMessages),
    connectionStatus: connectionStatus,
    socketActive: !!sock,
    // NEW: WebSocket state info
    webSocket: {
      state: wsState,
      readyState: wsReadyState,
      isZombie: isZombie,
      zombieDetectionCount: zombieDetectionCount,
      lastCloseCode: webSocketCloseCode,
      lastCloseReason: webSocketCloseReason,
      lastError: lastWebSocketError,
    },
    // Ping info
    ping: {
      consecutiveFailures: consecutivePingFailures,
      maxFailures: MAX_PING_FAILURES,
      lastSuccessfulPing: lastSuccessfulPing,
      secondsSinceLastPing: Math.floor(
        (Date.now() - lastSuccessfulPing) / 1000
      ),
    },
  };
}

async function disconnectBot() {
  console.log("🛑 Disconnecting bot and clearing session...");
  if (sock) {
    try {
      // Send a final logout signal to WhatsApp servers
      await sock.logout();
      console.log("✅ Successfully logged out from WhatsApp");
    } catch (error) {
      console.warn(
        "⚠️ Error during logout (connection likely already closed):",
        error.message
      );
    } finally {
      // Ensure all listeners are removed to prevent memory leaks
      sock.ev.removeAllListeners();
      sock = null;
    }
  }

  connectionStatus = "disconnected";
  qrCodeData = null;
  currentQR = null;
  reconnectAttempts = 0; // Reset reconnect counter
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Delete auth_info_baileys folder to force a new QR on next startup
  const authPath = path.join(__dirname, "..", "auth_info_baileys");
  try {
    if (fs.existsSync(authPath)) {
      console.log("🗑️ Deleting auth_info_baileys folder for a clean start...");
      fs.rmSync(authPath, { recursive: true, force: true });
      console.log("✅ auth_info_baileys folder deleted successfully");
    } else {
      console.log(
        "ℹ️ auth_info_baileys folder does not exist, nothing to clear."
      );
    }
  } catch (error) {
    console.error("❌ Error deleting auth_info_baileys folder:", error);
    throw error; // Propagate error to the API caller
  }
}
async function sendMessage(numberOrJid, message) {
  // Helper function to wait for connection to be restored
  const waitForConnection = async (maxWaitMs = 15000) => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      // CRITICAL: Use socketManager to check connection, not stale variables
      if (socketManager.isConnected() && socketManager.getSocket()) {
        return true;
      }
      console.log(
        `⏳ Waiting for connection... (${socketManager.getConnectionStatus()})`
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return socketManager.isConnected() && socketManager.getSocket();
  };

  // Helper function to send with retry for Stream Errors
  const sendWithRetry = async (jid, messageContent, maxRetries = 3) => {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // CRITICAL: Check connection via socketManager, get FRESH socket
      if (!socketManager.isConnected()) {
        console.log(`⏸️ Not connected before attempt ${attempt}, waiting...`);
        const connected = await waitForConnection();
        if (!connected) {
          throw new Error("Bot is not connected after waiting");
        }
      }

      // CRITICAL: Get FRESH socket from manager, not stale module variable
      const currentSock = socketManager.getSocket();
      if (!currentSock) {
        throw new Error("No socket available");
      }

      try {
        await currentSock.sendMessage(jid, messageContent);
        return; // Success!
      } catch (sendError) {
        lastError = sendError;
        const errorMsg = sendError.message || String(sendError);

        console.warn(
          `⚠️ Send attempt ${attempt}/${maxRetries} failed: ${errorMsg}`
        );

        // Check if it's a retriable error
        const isStreamError =
          errorMsg.includes("Stream Errored") ||
          errorMsg.includes("xml-not-well-formed");
        const isConnectionError =
          errorMsg.includes("Connection") ||
          errorMsg.includes("closed") ||
          errorMsg.includes("Timed Out") ||
          errorMsg.includes("timeout");
        const isRetriableError = isStreamError || isConnectionError;

        if (isRetriableError && attempt < maxRetries) {
          // Wait for connection to stabilize
          const delayMs = attempt * 3000; // 3s, 6s, 9s
          console.log(`⏳ Waiting ${delayMs}ms for connection to stabilize...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));

          // Wait for reconnection if needed
          if (!socketManager.isConnected()) {
            console.log(`🔄 Waiting for reconnection before retry...`);
            const connected = await waitForConnection(20000);
            if (!connected) {
              console.error(
                `❌ Connection not restored after ${attempt} attempts`
              );
              continue; // Try again anyway
            }
            console.log(`✅ Connection restored, retrying...`);
          }
        } else if (attempt === maxRetries) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error("Send failed after all retries");
  };

  // CRITICAL: Initial connection check using socketManager, not stale variables
  if (!socketManager.isConnected()) {
    console.log(`⏸️ Not connected, waiting up to 15s...`);
    const connected = await waitForConnection();
    if (!connected) {
      throw new Error("Bot is not connected");
    }
  }

  let jid = numberOrJid;
  // If it's a plain number, convert to s.whatsapp.net
  if (!jid.includes("@")) {
    jid = `${jid}@s.whatsapp.net`;
  }

  // Check if message contains URLs and generate link preview
  const urls = linkPreviewService.extractUrls(message);

  if (urls.length > 0) {
    console.log(
      `🔗 Message contains ${urls.length} URL(s), generating link preview...`
    );

    try {
      // Generate link preview for the first URL
      const linkPreview = await linkPreviewService.generateLinkPreview(message);

      if (linkPreview) {
        console.log(`✅ Link preview generated successfully`);
        console.log(`📋 Preview data:`, {
          canonicalUrl: linkPreview.canonicalUrl,
          title: linkPreview.title,
          hasImage: !!linkPreview.jpegThumbnail,
        });

        // Send message with link preview using Baileys v6 contextInfo format
        const messageContent = {
          text: message,
        };

        // Add link preview with thumbnail
        if (linkPreview.jpegThumbnail) {
          messageContent.contextInfo = {
            externalAdReply: {
              title: linkPreview.title,
              body: linkPreview.description || "",
              thumbnailUrl: linkPreview.canonicalUrl,
              sourceUrl: linkPreview.canonicalUrl,
              mediaType: 1, // 1 = Image/link preview
              thumbnail: linkPreview.jpegThumbnail,
              renderLargerThumbnail: true, // Display larger thumbnail
              showAdAttribution: false,
            },
          };
          console.log(
            `📎 Added thumbnail to link preview (${linkPreview.jpegThumbnail.length} bytes)`
          );
        } else {
          // Fallback: Add link preview without thumbnail
          messageContent.contextInfo = {
            externalAdReply: {
              title: linkPreview.title,
              body: linkPreview.description || "",
              sourceUrl: linkPreview.canonicalUrl,
              mediaType: 1,
              renderLargerThumbnail: true,
              showAdAttribution: false,
            },
          };
          console.log(`📎 Added link preview without thumbnail`);
        }

        // Send with retry logic
        try {
          await sendWithRetry(jid, messageContent);
          console.log(`✅ Message sent with link preview to ${jid}`);
          return; // Exit after successful send
        } catch (sendError) {
          console.warn(
            `⚠️ Failed to send with link preview after retries: ${sendError.message}`
          );
          console.warn(`⚠️ Falling back to plain text send...`);
          // Fall through to plain text send
        }
      } else {
        console.warn(`⚠️ Failed to generate link preview, sending without it`);
      }
    } catch (error) {
      console.error(`❌ Error generating link preview:`, error.message);
      // Fall through to send without link preview
    }
  }

  // Send message without link preview (no URLs or preview generation failed)
  // Now with retry logic for Stream Errors
  await sendWithRetry(jid, { text: message });
  console.log(`✅ Message sent (plain text) to ${jid}`);
}

/**
 * Send image with caption
 * @param {string} numberOrJid - Recipient number or JID
 * @param {Buffer|string} imageData - Image buffer or URL
 * @param {string} caption - Image caption
 */
async function sendImage(numberOrJid, imageData, caption = "") {
  // CRITICAL: Use socketManager to check connection and get socket
  if (!socketManager.isConnected()) {
    throw new Error("Bot is not connected");
  }

  const currentSock = socketManager.getSocket();
  if (!currentSock) {
    throw new Error("No socket available");
  }

  let jid = numberOrJid;
  // If it's a plain number, convert to s.whatsapp.net
  if (!jid.includes("@")) {
    jid = `${jid}@s.whatsapp.net`;
  }

  try {
    await currentSock.sendMessage(jid, {
      image: imageData,
      caption: caption,
    });
    console.log(`📸 Image sent to ${jid}`);
  } catch (error) {
    console.error(`❌ Error sending image to ${jid}:`, error);
    throw error;
  }
}

function getFetchedAds() {
  return ads;
}

function updateAdStatus(id, status, rejectionReason = null) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;

  // If status is "rejected", keep in ads but mark as rejected with reason
  if (status === "rejected") {
    ads[idx].status = "rejected";
    ads[idx].rejectionReason = rejectionReason || "مرفوض من قبل المستخدم";
    ads[idx].rejectedAt = Date.now();
    saveAds();
    console.log(
      `❌ Ad marked as rejected: ${id} - Reason: ${
        rejectionReason || "Not specified"
      }`
    );
    return true;
  }

  ads[idx].status = status;
  saveAds();
  return true;
}

// Move rejected ad to recycle bin (second step after rejection)
function moveAdToRecycleBin(id) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;

  const ad = ads[idx];

  // Only allow moving rejected ads to recycle bin
  if (ad.status !== "rejected") {
    console.log(`⚠️ Cannot move non-rejected ad to recycle bin: ${id}`);
    return false;
  }

  // Save ALL ad data for complete restoration
  const recycleBinItem = {
    id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    // Basic info
    text: ad.text,
    originalText: ad.originalText,
    enhancedText: ad.enhancedText,
    fromGroup: ad.fromGroup,
    fromGroupName: ad.fromGroupName,
    author: ad.author,
    senderName: ad.senderName,
    senderPhone: ad.senderPhone,
    // Rejection info
    rejectedAt: ad.rejectedAt || Date.now(),
    rejectionReason: ad.rejectionReason,
    aiConfidence: ad.aiConfidence,
    aiReason: ad.rejectionReason || "مرفوض من قبل المستخدم",
    originalAdId: ad.id,
    originalTimestamp: ad.timestamp,
    // AI-generated data
    wpData: ad.wpData,
    whatsappMessage: ad.whatsappMessage,
    category: ad.category,
    meta: ad.meta,
    improvements: ad.improvements,
    // WordPress data
    wordpressPostId: ad.wordpressPostId,
    wordpressUrl: ad.wordpressUrl,
    wordpressFullUrl: ad.wordpressFullUrl,
    wordpressPostedAt: ad.wordpressPostedAt,
    targetWebsite: ad.targetWebsite,
    // Image data
    imageUrl: ad.imageUrl,
  };

  recycleBin.unshift(recycleBinItem);
  if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500);
  saveRecycleBin();

  // Remove from ads
  ads.splice(idx, 1);
  saveAds();

  console.log(`🗑️ Ad moved to recycle bin: ${id}`);
  return true;
}

function updateAdCategory(id, category) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  ads[idx].category = category;
  saveAds();
  return true;
}

function updateAdText(id, text) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  ads[idx].enhancedText = text;
  ads[idx].isEdited = true;
  saveAds();
  return true;
}

function updateAdEnhancedText(id, enhancedText, improvements) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  ads[idx].enhancedText = enhancedText;
  ads[idx].improvements = improvements || [];
  ads[idx].isEdited = false; // Reset edited flag when regenerated
  saveAds();
  return true;
}

function updateAdWordPressData(id, wpData, whatsappMessage) {
  const idx = ads.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  ads[idx].wpData = wpData;
  ads[idx].whatsappMessage = whatsappMessage;
  ads[idx].isEdited = false; // Reset edited flag when regenerated
  saveAds();
  return true;
}

// Retry failed ad processing
async function retryFailedAd(adId) {
  const ad = ads.find((a) => a.id === adId);
  if (!ad || ad.status !== "pending_retry") {
    console.log(`⚠️ Ad ${adId} not found or not in retry status`);
    return;
  }

  // Check retry limit (max 3 retries)
  if (ad.retryCount >= 3) {
    console.log(`❌ Ad ${adId} exceeded retry limit (3 attempts)`);
    ad.status = "failed";
    ad.aiReason = "Failed after 3 retry attempts";
    saveAds();
    return;
  }

  console.log(
    `🔄 Retrying AI processing for ad ${adId} (attempt ${ad.retryCount + 1}/3)`
  );

  try {
    const aiResult = await processMessage(ad.text);

    if (aiResult.isAd) {
      // Update ad with AI results
      ad.enhancedText = aiResult.enhancedText;
      ad.aiConfidence = aiResult.confidence;
      ad.aiReason = aiResult.reason;
      ad.improvements = aiResult.improvements || [];
      ad.category = aiResult.category || null;
      ad.meta = aiResult.meta || {};
      ad.wpData = aiResult.wpData || null;
      ad.whatsappMessage = aiResult.whatsappMessage || null;
      ad.status = "new"; // Change status to new
      ad.retryCount = (ad.retryCount || 0) + 1;
      ad.lastRetryAt = Date.now();

      saveAds();
      console.log(`✅ Ad ${adId} processed successfully after retry`);
    } else {
      // Not an ad, move to recycle bin
      const idx = ads.findIndex((a) => a.id === adId);
      if (idx !== -1) {
        const recycleBinItem = {
          id: `rb_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          text: ad.text,
          enhancedText: ad.enhancedText,
          fromGroup: ad.fromGroup,
          fromGroupName: ad.fromGroupName,
          author: ad.author,
          rejectedAt: Date.now(),
          aiConfidence: aiResult.confidence,
          aiReason: aiResult.reason,
          originalAdId: ad.id,
        };

        recycleBin.unshift(recycleBinItem);
        if (recycleBin.length > 500) recycleBin = recycleBin.slice(0, 500);
        saveRecycleBin();

        ads.splice(idx, 1);
        saveAds();

        console.log(
          `🗑️ Ad ${adId} moved to recycle bin after retry (not an ad)`
        );
      }
    }
  } catch (error) {
    console.error(`❌ Retry failed for ad ${adId}:`, error);

    ad.retryCount = (ad.retryCount || 0) + 1;
    ad.lastRetryAt = Date.now();

    const errorMessage = error.message || error.toString();
    const isOverloadError =
      error.status === 503 ||
      errorMessage.includes("overloaded") ||
      errorMessage.includes("503");

    if (isOverloadError && ad.retryCount < 3) {
      // Schedule another retry after longer delay (exponential backoff)
      const delayMinutes = Math.pow(2, ad.retryCount) * 5; // 10, 20, 40 minutes
      console.log(
        `⏳ Scheduling retry ${ad.retryCount + 1} after ${delayMinutes} minutes`
      );
      setTimeout(() => retryFailedAd(adId), delayMinutes * 60 * 1000);
    } else {
      ad.status = "failed";
      ad.aiReason = `Failed after ${ad.retryCount} retry attempts`;
    }

    saveAds();
  }
}

// Auto-retry all pending ads on startup
function retryPendingAds() {
  const pendingAds = ads.filter((a) => a.status === "pending_retry");

  if (pendingAds.length > 0) {
    console.log(
      `🔄 Found ${pendingAds.length} ads pending retry. Starting retry process...`
    );

    // Stagger retries to avoid overwhelming the API
    pendingAds.forEach((ad, index) => {
      setTimeout(() => {
        retryFailedAd(ad.id);
      }, index * 10000); // 10 seconds apart
    });
  }
}

function getAdById(id) {
  return ads.find((a) => a.id === id);
}

async function resendAd(id, targetGroups = []) {
  const ad = ads.find((a) => a.id === id);
  if (!ad) throw new Error("Ad not found");

  // Use enhanced text if available, otherwise use original
  const textToSend = ad.enhancedText || ad.text;

  // Build message template
  const message = `📢 *Repost from ${
    ad.fromGroupName || ad.fromGroup
  }*\n\n${textToSend}`;

  const results = [];
  for (const groupJid of targetGroups) {
    try {
      // ensure jid format for groups (they usually already end with @g.us)
      const jid = groupJid.includes("@") ? groupJid : `${groupJid}@g.us`;
      await sendMessage(jid, message);
      results.push({ group: jid, ok: true });
    } catch (err) {
      results.push({ group: groupJid, ok: false, error: err.message });
    }
  }

  // Optionally mark as posted
  ad.status = "posted";
  saveAds();

  return results;
}

function getSeenGroups() {
  // return as array
  return Array.from(seenGroups);
}

async function getGroupsWithMetadata(forceRefresh = false) {
  // Return ALL groups with type information (Group vs Community)
  const groupsList = [];

  // If force refresh, fetch all groups directly from WhatsApp
  if (forceRefresh && sock && connectionStatus === "connected") {
    try {
      console.log("🔄 Force refreshing groups from WhatsApp...");

      // Fetch all groups the bot is part of
      const groups = await sock.groupFetchAllParticipating();

      console.log(`📊 Raw groups fetched: ${Object.keys(groups).length}`);

      // Clear and rebuild metadata for ALL groups (no filtering)
      groupsMetadata = {};
      // Clear seenGroups and rebuild from fresh data
      seenGroups.clear();

      for (const groupId in groups) {
        const group = groups[groupId];

        // Determine if it's a group or community
        const isCommunity =
          groupId.includes("@broadcast") || group.isCommunity || false;
        const groupType = isCommunity ? "Community" : "Group";

        // Add ALL groups to metadata (no filtering by send permission)
        groupsMetadata[groupId] = {
          jid: groupId,
          name: group.subject || groupId,
          type: groupType,
          isCommunity: isCommunity,
        };

        // IMPORTANT: Add to seenGroups so they persist
        seenGroups.add(groupId);

        groupsList.push(groupsMetadata[groupId]);
      }

      console.log(
        `✅ Found and saved ${groupsList.length} groups/communities total`
      );
      console.log(`✅ seenGroups now has ${seenGroups.size} groups`);
      console.log(
        `✅ groupsMetadata now has ${Object.keys(groupsMetadata).length} groups`
      );

      return groupsList;
    } catch (err) {
      console.error("❌ Error fetching groups from WhatsApp:", err);
      // Fall through to normal logic if refresh fails
    }
  }

  // Normal logic: use cached data, return ALL groups
  console.log(
    `📋 Normal fetch - seenGroups size: ${
      seenGroups.size
    }, groupsMetadata keys: ${Object.keys(groupsMetadata).length}`
  );

  for (const jid of seenGroups) {
    if (groupsMetadata[jid]) {
      groupsList.push(groupsMetadata[jid]);
    } else {
      // Try to fetch metadata if not cached
      console.log(`🔍 Fetching metadata for uncached group: ${jid}`);
      try {
        if (sock && connectionStatus === "connected") {
          const metadata = await sock.groupMetadata(jid).catch(() => null);
          if (metadata && metadata.subject) {
            const isCommunity =
              jid.includes("@broadcast") || metadata.isCommunity || false;
            groupsMetadata[jid] = {
              jid,
              name: metadata.subject,
              type: isCommunity ? "Community" : "Group",
              isCommunity: isCommunity,
            };
            groupsList.push(groupsMetadata[jid]);
            console.log(`✅ Fetched metadata for ${jid}: ${metadata.subject}`);
          } else {
            // Fallback if can't get metadata
            console.log(`⚠️ No metadata available for ${jid}, using fallback`);
            groupsList.push({
              jid,
              name: jid,
              type: "Group",
              isCommunity: false,
            });
          }
        } else {
          console.log(`⚠️ Bot not connected, using fallback for ${jid}`);
          groupsList.push({
            jid,
            name: jid,
            type: "Group",
            isCommunity: false,
          });
        }
      } catch (e) {
        console.error(`❌ Error fetching metadata for ${jid}:`, e.message);
        groupsList.push({ jid, name: jid, type: "Group", isCommunity: false });
      }
    }
  }

  console.log(`✅ Returning ${groupsList.length} groups from cache`);
  return groupsList;
}

// Helper function to check if bot can send messages in a group// Helper function to check if bot can send messages in a group
async function canSendInGroup(groupId, groupMetadata = null) {
  try {
    if (!sock || connectionStatus !== "connected") {
      return true; // Default to true if not connected
    }

    // Get full metadata if not provided
    let metadata = groupMetadata;
    if (!metadata || !metadata.participants) {
      metadata = await sock.groupMetadata(groupId).catch(() => null);
    }

    if (!metadata) {
      return true; // If we can't get metadata, assume we can send
    }

    // Get bot's phone number
    const botNumber = sock.user?.id?.split(":")[0] || sock.user?.id;
    if (!botNumber) {
      return true;
    }

    // Find bot in participants
    const botParticipant = metadata.participants?.find(
      (p) => p.id.includes(botNumber) || p.id.split("@")[0] === botNumber
    );

    if (!botParticipant) {
      return false; // Bot is not a participant
    }

    // Check group settings
    const announce = metadata.announce; // true = only admins can send messages

    if (!announce) {
      // Group is open, anyone can send
      return true;
    }

    // Group is announcement-only, check if bot is admin
    const isAdmin =
      botParticipant.admin === "admin" || botParticipant.admin === "superadmin";

    return isAdmin;
  } catch (err) {
    console.error(`Error checking send permission for group ${groupId}:`, err);
    return true; // Default to true on error
  }
}

function getCollections() {
  console.log(
    `📦 getCollections() called - returning ${collections.length} collections`
  );
  return collections;
}

function saveCollection(name, groupIds) {
  const existing = collections.findIndex((c) => c.name === name);
  const collection = {
    id: existing >= 0 ? collections[existing].id : `col_${Date.now()}`,
    name,
    groups: groupIds,
    createdAt: existing >= 0 ? collections[existing].createdAt : Date.now(),
    updatedAt: Date.now(),
  };

  if (existing >= 0) {
    collections[existing] = collection;
  } else {
    collections.push(collection);
  }

  saveCollections();
  return collection;
}

function updateCollection(collectionId, name, groupIds) {
  const idx = collections.findIndex((c) => c.id === collectionId);
  if (idx === -1) return null;

  collections[idx] = {
    ...collections[idx],
    name,
    groups: groupIds,
    updatedAt: Date.now(),
  };

  saveCollections();
  return collections[idx];
}

function deleteCollection(id) {
  const idx = collections.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  collections.splice(idx, 1);
  saveCollections();
  return true;
}

function getCategories() {
  return categories;
}

function saveCategory(name, color) {
  const existing = categories.findIndex((c) => c.name === name);
  if (existing >= 0) {
    categories[existing].color = color || categories[existing].color;
    saveCategories();
    return categories[existing];
  }

  const category = {
    id: `cat_${Date.now()}`,
    name,
    color: color || "#9b59b6",
  };

  categories.push(category);
  saveCategories();
  return category;
}

function updateCategory(categoryId, name, color) {
  const idx = categories.findIndex((c) => c.id === categoryId);
  if (idx === -1) return null;

  categories[idx] = {
    ...categories[idx],
    name,
    color: color || categories[idx].color,
  };

  saveCategories();
  return categories[idx];
}

function deleteCategory(id) {
  const idx = categories.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  categories.splice(idx, 1);
  saveCategories();
  return true;
}

// ============ Recycle Bin Functions ============

function getRecycleBin() {
  console.log(
    "📋 getRecycleBin() called - returning",
    recycleBin.length,
    "items"
  );
  return recycleBin;
}

function restoreFromRecycleBin(id) {
  const idx = recycleBin.findIndex((item) => item.id === id);
  if (idx === -1) {
    return { success: false, error: "Item not found" };
  }

  const item = recycleBin[idx];

  // Restore ALL ad data that was saved
  const ad = {
    id:
      item.originalAdId ||
      `ad_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    // Basic info
    text: item.text,
    originalText: item.originalText || item.text,
    enhancedText: item.enhancedText,
    fromGroup: item.fromGroup,
    fromGroupName: item.fromGroupName,
    author: item.author,
    senderName: item.senderName,
    senderPhone: item.senderPhone,
    // Status
    status: "new", // Restore as new so it can be processed again
    timestamp: item.originalTimestamp || Date.now(),
    isEdited: false,
    // AI data
    aiConfidence: item.aiConfidence,
    aiReason: "تم استعادته من سلة المحذوفات / Restored from recycle bin",
    // AI-generated data (restore if available)
    wpData: item.wpData || null,
    whatsappMessage: item.whatsappMessage || null,
    category: item.category || null,
    meta: item.meta || {},
    improvements: item.improvements || [],
    // WordPress data
    wordpressPostId: item.wordpressPostId || null,
    wordpressUrl: item.wordpressUrl || null,
    wordpressFullUrl: item.wordpressFullUrl || null,
    wordpressPostedAt: item.wordpressPostedAt || null,
    targetWebsite: item.targetWebsite || null,
    // Image data
    imageUrl: item.imageUrl || null,
    messageKey: item.messageKey || null,
  };

  // Add to ads
  ads.unshift(ad);
  saveAds();

  // Remove from recycle bin
  recycleBin.splice(idx, 1);
  saveRecycleBin();

  console.log(
    `♻️ Ad restored from recycle bin: ${
      ad.id
    } with all data (wpData: ${!!item.wpData}, imageUrl: ${!!item.imageUrl})`
  );
  return { success: true, ad };
}

function deleteFromRecycleBin(id) {
  const idx = recycleBin.findIndex((item) => item.id === id);
  if (idx === -1) return false;

  recycleBin.splice(idx, 1);
  saveRecycleBin();
  return true;
}

function emptyRecycleBin() {
  recycleBin = [];
  saveRecycleBin();
}

// ============ Settings Functions ============

function getSettings() {
  return settings;
}

function updateSettings(newSettings) {
  Object.assign(settings, newSettings);
  saveSettings();
}

/**
 * Reload ads from file (for when ads are added externally)
 */
function reloadAds() {
  try {
    if (fs.existsSync(ADS_FILE)) {
      const raw = fs.readFileSync(ADS_FILE, "utf8");
      ads = JSON.parse(raw || "[]");
      console.log(`🔄 Reloaded ${ads.length} ads from file`);
      return true;
    }
    return false;
  } catch (err) {
    console.error("Failed to reload ads:", err);
    return false;
  }
}

/**
 * Remove image from an ad
 * @param {string} adId - The ad ID
 * @returns {boolean} - true if removed successfully
 */
function removeAdImage(adId) {
  const adIndex = ads.findIndex((a) => a.id === adId);
  if (adIndex === -1) {
    console.error(`❌ Ad not found: ${adId}`);
    return false;
  }

  ads[adIndex].imageUrl = null;
  saveAds();
  console.log(`✅ Removed image from ad: ${adId}`);
  return true;
}

module.exports = {
  initializeBot,
  getQRCode,
  getConnectionStatus,
  getMessageHandlerHealth, // Health monitoring
  disconnectBot,
  sendMessage,
  sendImage,
  // Connection stability functions
  cleanupAllSchedulers,
  updateAllServicesSocket,
  // ads API
  getFetchedAds,
  reloadAds,
  updateAdStatus,
  updateAdCategory,
  updateAdText,
  updateAdEnhancedText,
  updateAdWordPressData,
  getAdById,
  resendAd,
  removeAdImage,
  moveAdToRecycleBin,
  getSeenGroups,
  getGroupsWithMetadata,
  // collections API
  getCollections,
  saveCollection,
  updateCollection,
  deleteCollection,
  // categories API
  getCategories,
  saveCategory,
  updateCategory,
  deleteCategory,
  // recycle bin API
  getRecycleBin,
  restoreFromRecycleBin,
  deleteFromRecycleBin,
  emptyRecycleBin,
  // settings API
  getSettings,
  updateSettings,
  // Export ads for admin commands
  ads,
};
