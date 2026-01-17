/**
 * Private Client Model
 * Stores client information and conversation state for private chats
 */

const fs = require("fs");
const path = require("path");
const { getDataPath, SHARED_DATA_DIR } = require("../config/dataPath");

const CLIENTS_FILE = getDataPath("private_clients.json");
let clients = {};
// Track clients deleted in this session to avoid re-adding from disk
let deletedInSession = new Set();

// Load clients from file
function loadClients() {
  try {
    // Ensure shared data directory exists
    if (!fs.existsSync(SHARED_DATA_DIR)) {
      fs.mkdirSync(SHARED_DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(CLIENTS_FILE)) {
      fs.writeFileSync(CLIENTS_FILE, JSON.stringify({}));
    }

    // Always read fresh from disk to ensure sync between bots
    const raw = fs.readFileSync(CLIENTS_FILE, "utf8");
    clients = JSON.parse(raw || "{}");
    console.log(`✅ Loaded ${Object.keys(clients).length} private clients`);
  } catch (err) {
    console.error("Failed to load clients:", err);
    clients = {};
  }
}

// Save clients to file with merge to prevent data loss from concurrent bots
function saveClients() {
  try {
    // Read fresh data from disk to get changes from other bots
    let diskClients = {};
    if (fs.existsSync(CLIENTS_FILE)) {
      try {
        const raw = fs.readFileSync(CLIENTS_FILE, "utf8");
        diskClients = JSON.parse(raw || "{}");
      } catch (parseErr) {
        console.error(
          "Failed to parse disk clients, using memory data:",
          parseErr,
        );
        diskClients = {};
      }
    }

    // Merge: disk data as base, then apply our in-memory changes
    // This preserves clients added by other bots while keeping our updates
    const mergedClients = {};

    // First, add all disk clients EXCEPT those we deleted in this session
    for (const phoneNumber in diskClients) {
      if (!deletedInSession.has(phoneNumber)) {
        mergedClients[phoneNumber] = diskClients[phoneNumber];
      }
    }

    // Then apply all our in-memory client changes (overwrite/add)
    for (const phoneNumber in clients) {
      mergedClients[phoneNumber] = clients[phoneNumber];
    }

    // Update our in-memory cache with merged data
    clients = mergedClients;

    // Write merged data to file
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(mergedClients, null, 2));
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
  // First check our in-memory cache
  if (!clients[phoneNumber]) {
    // Before creating new client, refresh from disk to check if another bot added it
    try {
      if (fs.existsSync(CLIENTS_FILE)) {
        const raw = fs.readFileSync(CLIENTS_FILE, "utf8");
        const diskClients = JSON.parse(raw || "{}");
        // Merge disk data into memory (don't overwrite existing memory data, skip deleted)
        for (const phone in diskClients) {
          if (!clients[phone] && !deletedInSession.has(phone)) {
            clients[phone] = diskClients[phone];
          }
        }
      }
    } catch (err) {
      console.error("Failed to refresh clients from disk:", err);
    }
  }

  // Check again after refresh
  if (!clients[phoneNumber]) {
    // If creating a new client, remove from deletedInSession (user wants to re-add)
    deletedInSession.delete(phoneNumber);
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

      // Protection flags - ALL clients are protected by default
      isProtected: true, // Prevent auto-deletion
      manuallyAdded: true, // Mark as important client

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
  // Refresh from disk first to ensure we have latest data
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const raw = fs.readFileSync(CLIENTS_FILE, "utf8");
      const diskClients = JSON.parse(raw || "{}");
      for (const phone in diskClients) {
        if (!clients[phone] && !deletedInSession.has(phone)) {
          clients[phone] = diskClients[phone];
        }
      }
    }
  } catch (err) {
    console.error("Failed to refresh before clear:", err);
  }

  if (clients[phoneNumber]) {
    delete clients[phoneNumber];
    deletedInSession.add(phoneNumber); // Track deletion to prevent re-adding from disk
    saveClients();
  }
}

/**
 * Get all clients
 * @returns {object} All client data
 */
function getAllClients() {
  // Refresh from disk to get latest data from all bots
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const raw = fs.readFileSync(CLIENTS_FILE, "utf8");
      const diskClients = JSON.parse(raw || "{}");
      // Merge: keep memory changes but add any new clients from disk (except deleted ones)
      for (const phone in diskClients) {
        if (!clients[phone] && !deletedInSession.has(phone)) {
          clients[phone] = diskClients[phone];
        }
      }
    }
  } catch (err) {
    console.error("Failed to refresh clients:", err);
  }
  return clients;
}

/**
 * Clean inactive clients (older than 7 days with no activity)
 */
function cleanInactiveClients() {
  // First refresh from disk to get latest activity timestamps from other bots
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const raw = fs.readFileSync(CLIENTS_FILE, "utf8");
      const diskClients = JSON.parse(raw || "{}");
      // Merge disk data - use disk timestamps if more recent
      for (const phone in diskClients) {
        if (deletedInSession.has(phone)) continue; // Skip deleted clients
        if (clients[phone]) {
          // Keep the more recent lastMessageAt
          if (diskClients[phone].lastMessageAt > clients[phone].lastMessageAt) {
            clients[phone].lastMessageAt = diskClients[phone].lastMessageAt;
          }
        } else {
          clients[phone] = diskClients[phone];
        }
      }
    }
  } catch (err) {
    console.error("Failed to refresh before cleaning:", err);
  }

  const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
  let cleaned = 0;

  for (const phoneNumber in clients) {
    const client = clients[phoneNumber];

    // Skip protected clients (manually added or marked as important)
    if (client.isProtected || client.manuallyAdded) {
      continue;
    }

    if (client.lastMessageAt < cutoffTime) {
      delete clients[phoneNumber];
      deletedInSession.add(phoneNumber); // Track deletion
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
  // Refresh from disk first to ensure we have latest data
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const raw = fs.readFileSync(CLIENTS_FILE, "utf8");
      const diskClients = JSON.parse(raw || "{}");
      for (const phone in diskClients) {
        if (!clients[phone] && !deletedInSession.has(phone)) {
          clients[phone] = diskClients[phone];
        }
      }
    }
  } catch (err) {
    console.error("Failed to refresh before delete:", err);
  }

  if (clients[phoneNumber]) {
    delete clients[phoneNumber];
    deletedInSession.add(phoneNumber); // Track deletion to prevent re-adding from disk
    saveClients();
    console.log(`🗑️ Deleted client: ${phoneNumber}`);
    return true;
  }
  return false;
}

/**
 * Change client's phone number (move data to new phone key)
 * @param {string} oldPhoneNumber - Current phone number
 * @param {string} newPhoneNumber - New phone number
 * @returns {object|null} Updated client data or null if old phone not found or new phone exists
 */
function changeClientPhone(oldPhoneNumber, newPhoneNumber) {
  // Check if old phone exists
  if (!clients[oldPhoneNumber]) {
    console.log(`❌ Client not found: ${oldPhoneNumber}`);
    return null;
  }

  // Check if new phone already exists
  if (clients[newPhoneNumber]) {
    console.log(`❌ Phone number already exists: ${newPhoneNumber}`);
    return null;
  }

  // Move data to new phone number
  const clientData = { ...clients[oldPhoneNumber] };
  clientData.phoneNumber = newPhoneNumber;
  clientData.updatedAt = Date.now();
  clientData.lastMessageAt = Date.now();

  // Create new entry and delete old
  clients[newPhoneNumber] = clientData;
  delete clients[oldPhoneNumber];

  saveClients();
  console.log(`📱 Changed client phone: ${oldPhoneNumber} → ${newPhoneNumber}`);

  return clients[newPhoneNumber];
}

// Initialize
loadClients();

// Clean inactive clients daily - DISABLED to preserve all client data
// Automatic cleanup is disabled to keep all manually added client data
// setInterval(cleanInactiveClients, 24 * 60 * 60 * 1000);

/**
 * Normalize property type for comparison
 * Groups synonyms together (e.g., بيت = منزل = فيلا = دور)
 * @param {string} propertyType - Property type to normalize
 * @returns {string} Normalized property type
 */
function normalizePropertyType(propertyType) {
  if (!propertyType) return "";

  const type = propertyType.toLowerCase().trim();

  // Define synonym groups - items in same group are considered same type
  const synonymGroups = [
    ["بيت", "منزل", "فيلا", "دور"],
    ["شقة", "شقة سكنية"],
    ["دبلكس", "شقة دبلكسية", "شقة دبلكس"],
    ["أرض", "ارض"],
    ["عمارة", "بناية"],
    ["استراحة", "شاليه"],
    ["محل", "محل تجاري"],
    ["مزرعة"],
  ];

  for (const group of synonymGroups) {
    if (group.some((s) => type.includes(s) || s.includes(type))) {
      return group[0]; // Return first item as canonical name
    }
  }

  return type; // Return as-is if not found in any group
}

/**
 * Get all requests for a client
 * Handles migration from old single-request format to new multi-request format
 * @param {string} phoneNumber - Client's phone number
 * @returns {Array} Array of requests
 */
function getClientRequests(phoneNumber) {
  const client = getClient(phoneNumber);

  // If client has new `requests` array, use it
  if (client.requests && Array.isArray(client.requests)) {
    return client.requests;
  }

  // Migration: if client has old `requirements` object with propertyType, convert it
  if (client.requirements && client.requirements.propertyType) {
    const legacyRequest = {
      id: `req_legacy_${phoneNumber}`,
      ...client.requirements,
      createdAt: client.createdAt || Date.now(),
      updatedAt: client.updatedAt || Date.now(),
      status: client.requestStatus || "active",
    };
    return [legacyRequest];
  }

  return [];
}

/**
 * Add or update a client request based on property type
 * - If same property type exists: UPDATE the existing request
 * - If different property type: ADD as new request
 * @param {string} phoneNumber - Client's phone number
 * @param {Object} requirements - New requirements object
 * @returns {Object} { isUpdate: boolean, request: Object, totalRequests: number, message: string }
 */
function addOrUpdateClientRequest(phoneNumber, requirements) {
  const client = getClient(phoneNumber);

  // Get existing requests (handles migration)
  let existingRequests = getClientRequests(phoneNumber);

  // Normalize the new property type for comparison
  const newPropertyTypeNormalized = normalizePropertyType(
    requirements.propertyType,
  );

  // Check if same property type exists
  const existingIndex = existingRequests.findIndex(
    (req) =>
      normalizePropertyType(req.propertyType) === newPropertyTypeNormalized,
  );

  let isUpdate = false;
  let request;
  let message;

  if (existingIndex >= 0) {
    // UPDATE existing request with same property type
    isUpdate = true;
    request = {
      ...existingRequests[existingIndex],
      ...requirements,
      updatedAt: Date.now(),
    };
    existingRequests[existingIndex] = request;
    message = `تم تحديث الطلب الحالي (${requirements.propertyType})`;
  } else {
    // ADD new request (different property type)
    request = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      ...requirements,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "active",
    };
    existingRequests.push(request);

    if (existingRequests.length > 1) {
      message = `تم إضافة طلب جديد. العميل لديه الآن ${existingRequests.length} طلبات`;
    } else {
      message = `تم تسجيل الطلب بنجاح`;
    }
  }

  // Save all requests
  updateClient(phoneNumber, {
    requests: existingRequests,
    // Keep requirements for backward compatibility (first active request)
    requirements: existingRequests[0],
  });

  return {
    isUpdate,
    request,
    totalRequests: existingRequests.length,
    allRequests: existingRequests,
    message,
  };
}

/**
 * Get all active requests across all clients
 * Used by property matching service
 * @returns {Array} Array of { phoneNumber, name, request, requestId }
 */
function getAllActiveRequests() {
  const allClients = getAllClients();
  const activeRequests = [];

  for (const [phoneNumber, client] of Object.entries(allClients)) {
    // Only include باحث (searchers) with completed state
    if (client.role !== "باحث" || client.state !== "completed") {
      continue;
    }

    // Get all requests for this client
    const clientRequests =
      client.requests && Array.isArray(client.requests)
        ? client.requests
        : client.requirements?.propertyType
          ? [client.requirements]
          : [];

    for (const request of clientRequests) {
      // Skip inactive requests or requests without property type
      if (!request.propertyType || request.status === "inactive") {
        continue;
      }

      // Check overall client request status
      if (client.requestStatus === "inactive") {
        continue;
      }

      activeRequests.push({
        phoneNumber,
        name: client.name,
        request,
        requestId: request.id || `legacy_${phoneNumber}`,
        createdAt: request.createdAt || client.createdAt,
        updatedAt: request.updatedAt || client.updatedAt,
        matchHistory: client.matchHistory || [],
        lastNotificationAt: client.lastNotificationAt || null,
      });
    }
  }

  return activeRequests;
}

/**
 * Record user interaction with a matched offer
 * Used for adaptive learning / learning-to-rank
 * @param {string} phoneNumber - Client's phone number
 * @param {string} offerId - The offer ID
 * @param {string} interactionType - Type: 'opened', 'clicked', 'contacted', 'rejected', 'ignored'
 * @returns {boolean} Success status
 */
function recordUserInteraction(phoneNumber, offerId, interactionType) {
  const client = getClient(phoneNumber);

  if (!client.matchHistory || !Array.isArray(client.matchHistory)) {
    console.log(`⚠️ No match history found for ${phoneNumber}`);
    return false;
  }

  // Find the match in history
  const matchIndex = client.matchHistory.findIndex(
    (m) => m.offerId === offerId,
  );

  if (matchIndex === -1) {
    console.log(
      `⚠️ Offer ${offerId} not found in match history for ${phoneNumber}`,
    );
    return false;
  }

  // Update interaction
  const match = client.matchHistory[matchIndex];
  match.userResponse = interactionType;
  match.interactionAt = Date.now();

  // Track specific interactions
  switch (interactionType) {
    case "opened":
      match.opened = true;
      break;
    case "clicked":
      match.clicked = true;
      break;
    case "contacted":
      match.contacted = true;
      break;
    case "rejected":
      match.rejected = true;
      break;
    case "ignored":
      // No specific flag, just record timestamp
      break;
  }

  client.matchHistory[matchIndex] = match;
  saveClients();

  console.log(
    `📊 Recorded interaction: ${interactionType} for offer ${offerId} by ${phoneNumber}`,
  );
  return true;
}

/**
 * Get interaction statistics for adaptive learning
 * @returns {Object} Statistics about user interactions with matches
 */
function getInteractionStats() {
  const allClients = getAllClients();

  const stats = {
    totalMatches: 0,
    opened: 0,
    clicked: 0,
    contacted: 0,
    rejected: 0,
    ignored: 0,
    avgScoreOpened: 0,
    avgScoreContacted: 0,
    avgScoreRejected: 0,
  };

  const openedScores = [];
  const contactedScores = [];
  const rejectedScores = [];

  for (const client of Object.values(allClients)) {
    if (!client.matchHistory || !Array.isArray(client.matchHistory)) continue;

    for (const match of client.matchHistory) {
      stats.totalMatches++;

      if (match.opened) stats.opened++;
      if (match.clicked) stats.clicked++;
      if (match.contacted) {
        stats.contacted++;
        if (match.similarityScore) contactedScores.push(match.similarityScore);
      }
      if (match.rejected) {
        stats.rejected++;
        if (match.similarityScore) rejectedScores.push(match.similarityScore);
      }
      if (!match.userResponse && match.sentAt) {
        // Sent but no response after 24 hours = ignored
        const hoursSinceSent = (Date.now() - match.sentAt) / (1000 * 60 * 60);
        if (hoursSinceSent > 24) stats.ignored++;
      }

      if (match.opened && match.similarityScore) {
        openedScores.push(match.similarityScore);
      }
    }
  }

  // Calculate averages
  if (openedScores.length > 0) {
    stats.avgScoreOpened = Math.round(
      openedScores.reduce((a, b) => a + b, 0) / openedScores.length,
    );
  }
  if (contactedScores.length > 0) {
    stats.avgScoreContacted = Math.round(
      contactedScores.reduce((a, b) => a + b, 0) / contactedScores.length,
    );
  }
  if (rejectedScores.length > 0) {
    stats.avgScoreRejected = Math.round(
      rejectedScores.reduce((a, b) => a + b, 0) / rejectedScores.length,
    );
  }

  return stats;
}

/**
 * Protect a client from auto-deletion
 * @param {string} phoneNumber - Client's phone number
 * @returns {boolean} True if protected, false if not found
 */
function protectClient(phoneNumber) {
  const client = getClient(phoneNumber);
  if (client) {
    client.isProtected = true;
    client.manuallyAdded = true;
    updateClient(phoneNumber, { isProtected: true, manuallyAdded: true });
    console.log(`🛡️ Protected client: ${phoneNumber}`);
    return true;
  }
  return false;
}

/**
 * Unprotect a client (allow auto-deletion)
 * @param {string} phoneNumber - Client's phone number
 * @returns {boolean} True if unprotected, false if not found
 */
function unprotectClient(phoneNumber) {
  const client = getClient(phoneNumber);
  if (client) {
    client.isProtected = false;
    client.manuallyAdded = false;
    updateClient(phoneNumber, { isProtected: false, manuallyAdded: false });
    console.log(`🔓 Unprotected client: ${phoneNumber}`);
    return true;
  }
  return false;
}

module.exports = {
  getClient,
  updateClient,
  addToHistory,
  getHistory,
  clearClient,
  getAllClients,
  cleanInactiveClients,
  deleteClient,
  changeClientPhone,
  protectClient,
  unprotectClient,
  // New multi-request functions
  normalizePropertyType,
  getClientRequests,
  addOrUpdateClientRequest,
  getAllActiveRequests,
  // Feedback tracking functions
  recordUserInteraction,
  getInteractionStats,
};
