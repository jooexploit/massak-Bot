/**
 * Property Matching Service
 * Automatically matches new property offers (عرض) against active user requests (طلب)
 * and sends notifications to users when good matches are found (≥80% similarity)
 */

const privateClient = require("../models/privateClient");
const {
  calculateSimilarityScore,
  findMatchingOffers,
} = require("./similarityScoreService");

/**
 * Get all active requests (طلب) from users with role "باحث"
 * Now supports multiple requests per client
 * @returns {Array<Object>} Array of active requests with user info
 */
function getActiveRequests() {
  // Use the new getAllActiveRequests function which handles multi-request properly
  const allActiveRequests = privateClient.getAllActiveRequests();
  
  // Transform to expected format (for compatibility with existing code)
  const activeRequests = allActiveRequests.map(item => ({
    phoneNumber: item.phoneNumber,
    name: item.name,
    requirements: item.request, // The individual request object
    requestId: item.requestId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    matchHistory: item.matchHistory || [],
    lastNotificationAt: item.lastNotificationAt || null,
  }));

  console.log(`📋 Found ${activeRequests.length} active property requests (from ${new Set(activeRequests.map(r => r.phoneNumber)).size} clients)`);
  return activeRequests;
}

/**
 * Check if a property offer matches any active requests
 * Returns array of matches with similarity scores ≥ 80%
 * @param {Object} offer - Property offer (عرض) to check
 * @returns {Array<Object>} Array of matches with user info and scores
 */
function checkOfferAgainstRequests(offer) {
  const activeRequests = getActiveRequests();
  const matches = [];

  console.log(`\n${"=".repeat(70)}`);
  console.log(
    `🔍 CHECKING NEW OFFER AGAINST ${activeRequests.length} ACTIVE REQUESTS`
  );
  console.log(`${"=".repeat(70)}`);
  console.log(`📦 Offer ID: ${offer.id}`);
  console.log(
    `   Type: ${
      offer.meta?.arc_category || offer.meta?.parent_catt || "Unknown"
    }`
  );
  console.log(
    `   Location: ${offer.meta?.location || offer.meta?.City || "Unknown"}`
  );
  console.log(`   Price: ${offer.meta?.price_amount || "N/A"}`);
  console.log(`   Area: ${offer.meta?.arc_space || "N/A"} m²`);
  console.log(`${"=".repeat(70)}\n`);

  for (const request of activeRequests) {
    const similarity = calculateSimilarityScore(request.requirements, offer);

    console.log(
      `👤 ${request.name} (${request.phoneNumber}): ${similarity.score}% ${
        similarity.matchQuality || ""
      }`
    );

    // Log detailed breakdown
    if (similarity.breakdown) {
      console.log(
        `   📊 Breakdown: Price=${similarity.breakdown.price}% (40% weight), Area=${similarity.breakdown.area}% (30% weight), Location=${similarity.breakdown.location}% (30% weight)`
      );
    }

    // Only include matches with ≥70% similarity (lowered for better flexibility)
    if (similarity.score >= 70) {
      // Check if this offer was already sent to this user
      const alreadySent = request.matchHistory?.some(
        (match) => match.offerId === offer.id
      );

      if (alreadySent) {
        console.log(`   ⚠️  Already sent to this user - skipping`);
        continue;
      }

      // Check rate limiting (don't spam users)
      const now = Date.now();
      const hoursSinceLastNotification = request.lastNotificationAt
        ? (now - request.lastNotificationAt) / (1000 * 60 * 60)
        : Infinity;

      if (hoursSinceLastNotification < 1) {
        console.log(
          `   ⏳ Rate limited (last notification ${Math.round(
            hoursSinceLastNotification * 60
          )} minutes ago)`
        );
        continue;
      }

      matches.push({
        phoneNumber: request.phoneNumber,
        name: request.name,
        requirements: request.requirements,
        offer,
        similarity,
      });

      console.log(`   ✅ MATCH! Adding to notification queue`);
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`📊 MATCHING SUMMARY: ${matches.length} notification(s) to send`);
  console.log(`${"=".repeat(70)}\n`);

  return matches;
}

/**
 * Record that a match was sent to a user
 * Updates match history and last notification timestamp
 * @param {string} phoneNumber - User's phone number
 * @param {Object} offer - The offer that was sent
 * @param {Object} similarity - Similarity score info
 */
function recordMatchSent(phoneNumber, offer, similarity) {
  const client = privateClient.getClient(phoneNumber);

  // Initialize match history if doesn't exist
  if (!client.matchHistory) {
    client.matchHistory = [];
  }

  // Add to history
  client.matchHistory.push({
    offerId: offer.id,
    offerTitle: offer.title?.rendered || "عقار",
    offerLink: offer.link,
    similarityScore: similarity.score,
    matchQuality: similarity.matchQuality,
    sentAt: Date.now(),
    userResponse: null, // Will be filled when user responds
  });

  // Update last notification timestamp
  privateClient.updateClient(phoneNumber, {
    matchHistory: client.matchHistory,
    lastNotificationAt: Date.now(),
  });

  console.log(
    `✅ Recorded match sent to ${phoneNumber} (Offer ID: ${offer.id})`
  );
}

/**
 * Mark a user's request as inactive (user no longer looking)
 * @param {string} phoneNumber - User's phone number
 * @param {string} reason - Reason for deactivation
 */
function markRequestAsInactive(phoneNumber, reason = "user_request") {
  privateClient.updateClient(phoneNumber, {
    requestStatus: "inactive",
    requestDeactivatedAt: Date.now(),
    requestDeactivationReason: reason,
  });

  console.log(
    `🚫 Marked request as inactive: ${phoneNumber} (Reason: ${reason})`
  );
}

/**
 * Reactivate a user's request
 * @param {string} phoneNumber - User's phone number
 */
function reactivateRequest(phoneNumber) {
  privateClient.updateClient(phoneNumber, {
    requestStatus: "active",
    requestDeactivatedAt: null,
    requestDeactivationReason: null,
  });

  console.log(`✅ Reactivated request: ${phoneNumber}`);
}

/**
 * Format match notification message for WhatsApp
 * @param {Object} match - Match object with offer and similarity
 * @param {string} userName - User's name
 * @returns {string} Formatted message
 */
function formatMatchNotification(match, userName) {
  const { offer, similarity } = match;
  const meta = offer.meta || {};

  const title = offer.title?.rendered || "عقار";
  const category = meta.arc_category || meta.parent_catt || "عقار";

  // Use original text from API (price_text, area_text) for display
  const price =
    meta.price_text || meta.price_amount || meta.price || "السعر عند التواصل";
  const area =
    meta.area_text || meta.arc_space || meta.order_space || "غير محدد";

  const location =
    meta.location || meta.City || meta.before_City || "الموقع غير محدد";
  const link = offer.link || `https://masaak.com/?p=${offer.id}`;

  let message = `*${userName}، وجدنا عقار يناسب طلبك!* ${similarity.matchQuality}\n\n`;
  message += `━━━━━━━━━━━━━━\n`;
  message += `🏠 *${category}* - ${title}\n\n`;
  message += `💰 *السعر:* ${price}\n`;

  // Check if area already includes unit (م²), if not add "متر"
  const areaDisplay =
    area.includes("م²") || area.includes("متر") || area === "غير محدد"
      ? area
      : `${area} متر`;
  message += `📏 *المساحة:* ${areaDisplay}\n`;

  message += `📍 *الموقع:* ${location}\n\n`;

  // Show why it matches
  message += `✨ *نسبة التطابق:* ${similarity.score}%\n`;

  if (similarity.breakdown) {
    const details = [];
    if (similarity.breakdown.price >= 90) details.push("السعر مناسب جداً");
    else if (similarity.breakdown.price >= 70)
      details.push("السعر قريب من ميزانيتك");

    if (similarity.breakdown.area >= 90) details.push("المساحة مثالية");
    else if (similarity.breakdown.area >= 70) details.push("المساحة مناسبة");

    if (similarity.breakdown.location >= 90) details.push("في حيك المفضل");
    else if (similarity.breakdown.location >= 70)
      details.push("في منطقة قريبة");

    if (details.length > 0) {
      message += `   • ${details.join("\n   • ")}\n\n`;
    }
  }

  message += `🔗 *التفاصيل:* ${link}\n\n`;
  message += `━━━━━━━━━━━━━━\n`;
  message += `💬 هل مازلت تبحث عن عقار؟ (نعم/لا)`;

  return message;
}

/**
 * Send match notification to a user via WhatsApp
 * @param {Object} sock - WhatsApp socket connection
 * @param {string} phoneNumber - User's phone number
 * @param {Object} match - Match object with offer, similarity, client info
 * @param {string} userName - User's name
 * @returns {Promise<void>}
 */
async function sendMatchNotification(sock, phoneNumber, match, userName) {
  if (!sock) {
    throw new Error("WhatsApp socket not available");
  }

  const jid = `${phoneNumber}@s.whatsapp.net`;
  const message = formatMatchNotification(match, userName);

  try {
    await sock.sendMessage(jid, { text: message });

    // Record that match was sent
    recordMatchSent(phoneNumber, match.offer, match.similarity);

    console.log(`✅ Match notification sent to ${phoneNumber}`);
  } catch (error) {
    console.error(
      `❌ Failed to send match notification to ${phoneNumber}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Get statistics about matching system
 * @returns {Object} Statistics object
 */
function getMatchingStats() {
  const allClients = privateClient.getAllClients();

  let totalRequests = 0;
  let activeRequests = 0;
  let inactiveRequests = 0;
  let totalMatches = 0;
  let matchesLast24h = 0;

  const now = Date.now();
  const last24h = now - 24 * 60 * 60 * 1000;

  for (const client of Object.values(allClients)) {
    if (client.role === "باحث" && client.state === "completed") {
      totalRequests++;

      if (client.requestStatus === "inactive") {
        inactiveRequests++;
      } else {
        activeRequests++;
      }

      if (client.matchHistory && Array.isArray(client.matchHistory)) {
        totalMatches += client.matchHistory.length;

        const recentMatches = client.matchHistory.filter(
          (m) => m.sentAt > last24h
        ).length;
        matchesLast24h += recentMatches;
      }
    }
  }

  return {
    totalRequests,
    activeRequests,
    inactiveRequests,
    totalMatches,
    matchesLast24h,
    activePercentage:
      totalRequests > 0
        ? Math.round((activeRequests / totalRequests) * 100)
        : 0,
  };
}

module.exports = {
  getActiveRequests,
  checkOfferAgainstRequests,
  recordMatchSent,
  markRequestAsInactive,
  reactivateRequest,
  formatMatchNotification,
  sendMatchNotification,
  getMatchingStats,
};
