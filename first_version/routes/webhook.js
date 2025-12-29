/**
 * Webhook Routes
 * Handles incoming webhooks from WordPress when new ads are posted
 */

const express = require("express");
const router = express.Router();
const propertyMatchingService = require("../services/propertyMatchingService");

/**
 * Webhook endpoint for new property ads
 * WordPress should POST to this endpoint when a new ad is published
 *
 * Expected payload:
 * {
 *   "post_id": 12345,
 *   "title": "...",
 *   "link": "...",
 *   "meta": { ... },
 *   "status": "publish",
 *   "category": "عروض"
 * }
 */
router.post("/new-ad", async (req, res) => {
  try {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`🔔 WEBHOOK RECEIVED: New Ad Posted`);
    console.log(`${"=".repeat(70)}`);
    console.log(`Payload:`, JSON.stringify(req.body, null, 2));
    console.log(`${"=".repeat(70)}\n`);

    const adData = req.body;

    // Validate payload
    if (!adData || !adData.post_id) {
      console.error("❌ Invalid webhook payload - missing post_id");
      return res.status(400).json({
        success: false,
        error: "Invalid payload - post_id required",
      });
    }

    // Only process published ads that are عروض (offers), not طلبات (requests)
    const isPublished = adData.status === "publish";
    const isOffer =
      !adData.category?.includes("طلب") &&
      !adData.title?.includes("مطلوب") &&
      !adData.title?.includes("طلب");

    if (!isPublished) {
      console.log("ℹ️  Ad not published yet - skipping");
      return res.json({
        success: true,
        message: "Ad not published - skipping matching",
      });
    }

    if (!isOffer) {
      console.log("ℹ️  Ad is a request (طلب), not an offer (عرض) - skipping");
      return res.json({
        success: true,
        message: "Request (طلب) detected - only offers (عرض) are matched",
      });
    }

    // Format ad data to match expected structure
    const formattedOffer = {
      id: adData.post_id,
      title: {
        rendered: adData.title || "",
      },
      link: adData.link || `https://masaak.com/?p=${adData.post_id}`,
      meta: adData.meta || {},
    };

    // Check against active requests
    const matches =
      propertyMatchingService.checkOfferAgainstRequests(formattedOffer);

    if (matches.length === 0) {
      console.log("✅ No matches found for this offer");
      return res.json({
        success: true,
        message: "No matches found",
        matchCount: 0,
      });
    }

    // Send notifications to matched users
    console.log(`📨 Sending notifications to ${matches.length} user(s)...`);

    const sock = req.app.get("whatsappSock");
    if (!sock) {
      console.error("❌ WhatsApp connection not available");
      return res.status(503).json({
        success: false,
        error: "WhatsApp connection not available",
        matches: matches.length,
      });
    }

    let successCount = 0;
    let failCount = 0;

    for (const match of matches) {
      try {
        const jid = `${match.phoneNumber}@s.whatsapp.net`;
        const message = propertyMatchingService.formatMatchNotification(
          match,
          match.name
        );

        await sock.sendMessage(jid, { text: message });

        // Record that this match was sent
        propertyMatchingService.recordMatchSent(
          match.phoneNumber,
          formattedOffer,
          match.similarity
        );

        // Mark that we're awaiting "still looking?" response
        const privateClient = require("../models/privateClient");
        privateClient.updateClient(match.phoneNumber, {
          awaitingStillLookingResponse: true,
          lastMatchSentAt: Date.now(),
        });

        successCount++;
        console.log(`   ✅ Sent to ${match.name} (${match.phoneNumber})`);

        // Add small delay between messages to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        failCount++;
        console.error(
          `   ❌ Failed to send to ${match.phoneNumber}:`,
          error.message
        );
      }
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(
      `✅ WEBHOOK PROCESSED: ${successCount} sent, ${failCount} failed`
    );
    console.log(`${"=".repeat(70)}\n`);

    res.json({
      success: true,
      matchCount: matches.length,
      successCount,
      failCount,
      message: `Notifications sent to ${successCount} user(s)`,
    });
  } catch (error) {
    console.error("❌ Error processing webhook:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Test endpoint to manually trigger matching for a specific ad
 * POST /api/webhook/test-match
 * Body: { "post_id": 12345 }
 */
router.post("/test-match", async (req, res) => {
  try {
    const { post_id } = req.body;

    if (!post_id) {
      return res.status(400).json({
        success: false,
        error: "post_id required",
      });
    }

    // Fetch ad data from WordPress (you'll need to implement this)
    // For now, return mock data
    res.json({
      success: true,
      message: "Test matching endpoint - implement WordPress API fetch",
      post_id,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get matching statistics
 * GET /api/webhook/stats
 */
router.get("/stats", (req, res) => {
  try {
    const stats = propertyMatchingService.getMatchingStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Get active requests
 * GET /api/webhook/active-requests
 */
router.get("/active-requests", (req, res) => {
  try {
    const requests = propertyMatchingService.getActiveRequests();

    // Remove sensitive details for security
    const sanitized = requests.map((r) => ({
      phoneNumber: r.phoneNumber.substring(0, 4) + "****", // Mask phone
      name: r.name,
      propertyType: r.requirements.propertyType,
      purpose: r.requirements.purpose,
      neighborhoods: r.requirements.neighborhoods,
      createdAt: r.createdAt,
      matchCount: r.matchHistory.length,
    }));

    res.json({
      success: true,
      count: sanitized.length,
      requests: sanitized,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
