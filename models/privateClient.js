/**
 * Private Client Model
 * Stores client information and conversation state for private chats
 */

const fs = require("fs");
const path = require("path");

const CLIENTS_FILE = path.join(__dirname, "..", "data", "private_clients.json");
let clients = {};

// Load clients from file
function loadClients() {
  try {
    if (!fs.existsSync(path.join(__dirname, "..", "data"))) {
      fs.mkdirSync(path.join(__dirname, "..", "data"));
    }

    if (!fs.existsSync(CLIENTS_FILE)) {
      fs.writeFileSync(CLIENTS_FILE, JSON.stringify({}));
    }

    const raw = fs.readFileSync(CLIENTS_FILE, "utf8");
    clients = JSON.parse(raw || "{}");
    console.log(`✅ Loaded ${Object.keys(clients).length} private clients`);
  } catch (err) {
    console.error("Failed to load clients:", err);
    clients = {};
  }
}

// Save clients to file
function saveClients() {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
  } catch (err) {
    console.error("Failed to save clients:", err);
  }
}

/**
 * Get or create client session
 * @param {string} phoneNumber - Client's phone number (without @s.whatsapp.net)
 * @returns {object} Client session data
 */
function getClient(phoneNumber) {
  if (!clients[phoneNumber]) {
    clients[phoneNumber] = {
      phoneNumber,
      name: null,
      role: null, // 'باحث', 'مالك', 'مستثمر', 'وسيط'
      state: "initial", // initial, awaiting_name, awaiting_role, awaiting_requirements, completed
      requirements: {
        propertyType: null,
        purpose: null, // شراء or إيجار
        priceRange: null,
        area: null,
        neighborhoods: [],
        contactNumber: null,
        additionalSpecs: null,
      },
      propertyOffer: null, // For 'مالك' role

      // New matching system fields
      requestStatus: "active", // active or inactive
      matchHistory: [], // Array of {offerId, offerTitle, offerLink, similarityScore, matchQuality, sentAt, userResponse}
      lastNotificationAt: null, // Timestamp of last match notification
      awaitingStillLookingResponse: false, // Flag for interest confirmation flow
      lastResponseToStillLooking: null, // "yes" or "no"
      lastResponseToStillLookingAt: null, // Timestamp
      requestDeactivatedAt: null, // When request was marked inactive
      requestDeactivationReason: null, // Why it was deactivated

      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastMessageAt: Date.now(),
    };
    saveClients();
  }
  return clients[phoneNumber];
}

/**
 * Update client data
 * @param {string} phoneNumber - Client's phone number
 * @param {object} updates - Data to update
 * @returns {object} Updated client data
 */
function updateClient(phoneNumber, updates) {
  if (!clients[phoneNumber]) {
    clients[phoneNumber] = getClient(phoneNumber);
  }

  clients[phoneNumber] = {
    ...clients[phoneNumber],
    ...updates,
    updatedAt: Date.now(),
    lastMessageAt: Date.now(),
  };

  saveClients();
  return clients[phoneNumber];
}

/**
 * Add message to conversation history (DEPRECATED - No longer saves history)
 * @param {string} phoneNumber - Client's phone number
 * @param {string} sender - 'client' or 'bot'
 * @param {string} message - Message text
 */
function addToHistory(phoneNumber, sender, message) {
  // Update last message timestamp only
  const client = getClient(phoneNumber);
  client.lastMessageAt = Date.now();
  saveClients();
}

/**
 * Get conversation history (STUB - Returns empty array as history is no longer stored)
 * @param {string} phoneNumber - Client's phone number
 * @returns {Array} Empty array (history not stored)
 */
function getHistory(phoneNumber) {
  // History is no longer stored, return empty array
  // This is kept for backwards compatibility with existing code
  return [];
}

/**
 * Clear client session (reset conversation)
 * @param {string} phoneNumber - Client's phone number
 */
function clearClient(phoneNumber) {
  if (clients[phoneNumber]) {
    delete clients[phoneNumber];
    saveClients();
  }
}

/**
 * Get all clients
 * @returns {object} All client data
 */
function getAllClients() {
  return clients;
}

/**
 * Clean inactive clients (older than 7 days with no activity)
 */
function cleanInactiveClients() {
  const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
  let cleaned = 0;

  for (const phoneNumber in clients) {
    if (clients[phoneNumber].lastMessageAt < cutoffTime) {
      delete clients[phoneNumber];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    saveClients();
    console.log(`🧹 Cleaned ${cleaned} inactive clients`);
  }
}

/**
 * Delete a specific client
 * @param {string} phoneNumber - Client's phone number
 * @returns {boolean} True if deleted, false if not found
 */
function deleteClient(phoneNumber) {
  if (clients[phoneNumber]) {
    delete clients[phoneNumber];
    saveClients();
    console.log(`🗑️ Deleted client: ${phoneNumber}`);
    return true;
  }
  return false;
}

// Initialize
loadClients();

// Clean inactive clients daily
setInterval(cleanInactiveClients, 24 * 60 * 60 * 1000);

module.exports = {
  getClient,
  updateClient,
  addToHistory,
  getHistory,
  clearClient,
  getAllClients,
  cleanInactiveClients,
  deleteClient,
};
