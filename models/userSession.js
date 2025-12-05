/**
 * User Session Model
 * Tracks conversation state for marketing conversations
 */

const fs = require("fs");
const path = require("path");

const SESSIONS_FILE = path.join(__dirname, "..", "data", "user_sessions.json");
let sessions = {};

// Load sessions from file
function loadSessions() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}));
    }
    const raw = fs.readFileSync(SESSIONS_FILE, "utf8");
    sessions = JSON.parse(raw || "{}");
    console.log(`✅ Loaded ${Object.keys(sessions).length} user sessions`);
  } catch (err) {
    console.error("Failed to load sessions:", err);
    sessions = {};
  }
}

// Save sessions to file
function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch (err) {
    console.error("Failed to save sessions:", err);
  }
}

// Get or create session for a user
function getSession(userId) {
  if (!sessions[userId]) {
    sessions[userId] = {
      userId,
      state: "idle", // idle, collecting, completed
      data: {},
      currentQuestion: null,
      questionsAsked: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveSessions();
  }
  return sessions[userId];
}

// Update session
function updateSession(userId, updates) {
  if (!sessions[userId]) {
    sessions[userId] = getSession(userId);
  }

  sessions[userId] = {
    ...sessions[userId],
    ...updates,
    updatedAt: Date.now(),
  };

  saveSessions();
  return sessions[userId];
}

// Clear session (after completing or timeout)
function clearSession(userId) {
  if (sessions[userId]) {
    delete sessions[userId];
    saveSessions();
  }
}

// Clean old sessions (older than 24 hours)
function cleanOldSessions() {
  const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
  let cleaned = 0;

  for (const userId in sessions) {
    if (sessions[userId].updatedAt < cutoffTime) {
      delete sessions[userId];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    saveSessions();
    console.log(`🧹 Cleaned ${cleaned} old sessions`);
  }
}

// Check if user is in marketing conversation
function isInMarketingConversation(userId) {
  return sessions[userId] && sessions[userId].state === "collecting";
}

// Get all active sessions
function getAllSessions() {
  return sessions;
}

// Initialize
loadSessions();

// Clean old sessions every hour
setInterval(cleanOldSessions, 60 * 60 * 1000);

module.exports = {
  getSession,
  updateSession,
  clearSession,
  isInMarketingConversation,
  getAllSessions,
  cleanOldSessions,
};
