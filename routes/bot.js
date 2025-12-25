const express = require("express");
const { authenticateToken, authorizeRole } = require("../middleware/auth");
const websiteConfig = require("../config/website.config");
const {
  getQRCode,
  getConnectionStatus,
  getMessageHandlerHealth, // NEW: Health monitoring
  disconnectBot,
  sendMessage,
  sendImage, // For sending images with custom messages
  getRecycleBin,
  restoreFromRecycleBin,
  deleteFromRecycleBin,
  emptyRecycleBin,
  getSettings,
  updateSettings,
  updateAdWordPressData,
  getFetchedAds,
  reloadAds,
  updateAdStatus,
  updateAdCategory,
  updateAdText,
  updateAdEnhancedText,
  getAdById,
  resendAd,
  removeAdImage,
  moveAdToRecycleBin,
  getSeenGroups,
  getGroupsWithMetadata,
  getCollections,
  saveCollection,
  updateCollection,
  deleteCollection,
  getCategories,
  saveCategory,
  updateCategory,
  deleteCategory,
} = require("../whatsapp/bot");
const {
  enhanceAd,
  extractWordPressData,
  generateWhatsAppMessage,
  getApiKeysStatus,
} = require("../services/aiService");
const messageQueue = require("../services/messageQueue");
const scheduledWhatsappService = require("../services/scheduledWhatsappService");
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure multer for custom message images
const customMessageImagesDir = path.join(__dirname, "..", "data", "custom_message_images");
if (!fs.existsSync(customMessageImagesDir)) {
  fs.mkdirSync(customMessageImagesDir, { recursive: true });
}

const customMessageImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, customMessageImagesDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}${ext}`;
    cb(null, filename);
  }
});

const uploadCustomMessageImage = multer({
  storage: customMessageImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

const router = express.Router();

// ========== AXIOS RETRY HELPER ==========
/**
 * Check if an error is retryable (network issues)
 */
function isRetryableError(error) {
  const retryableCodes = ["ETIMEDOUT", "ENETUNREACH", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"];
  return retryableCodes.includes(error.code) || 
         (error.cause && retryableCodes.includes(error.cause.code));
}

/**
 * Perform an axios request with retry logic
 * @param {Function} requestFn - Function that returns an axios promise
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {string} operationName - Name of the operation for logging
 */
async function axiosWithRetry(requestFn, maxRetries = 3, operationName = "request") {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const isRetryable = isRetryableError(error);
      
      console.log(`⚠️ ${operationName} attempt ${attempt}/${maxRetries} failed: ${error.code || error.message}`);
      
      if (isLastAttempt || !isRetryable) {
        throw error;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      console.log(`🔄 Retrying ${operationName} in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// Default axios timeout for WordPress requests (30 seconds)
const WP_AXIOS_TIMEOUT = 30000;

// ========== REUSABLE WORDPRESS POSTING FUNCTION ==========
/**
 * Posts an ad to WordPress with image handling
 * Supports multiple websites (Masaak and Hasak)
 * @param {Object} ad - The ad object with all details
 * @param {Object} sock - WhatsApp socket instance (optional, for image download)
 * @param {Object} wpData - WordPress data (optional, will be generated if not provided)
 * @param {boolean} previewOnly - If true, only returns preview without posting
 * @param {string} targetWebsite - Target website: 'masaak' or 'hasak' (auto-detected if not provided)
 * @returns {Object} Result with success, wordpressPost, extractedData, and whatsappMessage
 */
async function postAdToWordPress(
  ad,
  sock = null,
  wpData = null,
  previewOnly = false,
  targetWebsite = null
) {
  const fs = require("fs");
  const path = require("path");

  try {
    // Extract WordPress data using AI or use provided data
    if (!wpData) {
      if (ad.wpData) {
        console.log("✅ Using pre-generated WordPress data from ad");
        wpData = ad.wpData;
      } else {
        console.log("🤖 Generating WordPress data from ad text");
        wpData = await extractWordPressData(
          ad.enhancedText || ad.enhanced_text || ad.text
        );
      }
    }

    // Detect target website if not specified, or adjust based on Hasak categories
    const meta = wpData.meta || {};
    const effectiveCategory =
      meta.arc_category || meta.parent_catt || meta.category || "";

    console.log("🔍 Category detection for routing:");
    console.log("   meta.arc_category:", meta.arc_category);
    console.log("   meta.parent_catt:", meta.parent_catt);
    console.log("   meta.category:", meta.category);
    console.log("   effectiveCategory:", effectiveCategory);
    console.log(
      "   Is in Hasak categories?",
      websiteConfig.hasak.categories[effectiveCategory] !== undefined
    );

    // If category is one of Hasak categories, always force Hasak
    if (
      effectiveCategory &&
      websiteConfig.hasak.categories[effectiveCategory]
    ) {
      targetWebsite = "hasak";
      console.log(
        `🌐 Forcing target website to Hasak because category is "${effectiveCategory}"`
      );
    } else if (!targetWebsite) {
      // If not Hasak category, respect existing wpData.targetWebsite or auto-detect
      if (wpData.targetWebsite) {
        targetWebsite = wpData.targetWebsite;
        console.log(`🌐 Using target website from wpData: ${targetWebsite}`);
      } else {
        const category = meta.parent_catt || meta.category || "";
        targetWebsite = websiteConfig.detectWebsite(
          ad.enhancedText || ad.enhanced_text || ad.text,
          category,
          meta // Pass meta object to check order_type
        );
        console.log(`🌐 Auto-detected target website: ${targetWebsite}`);
      }
    }

    // Store the target website in wpData for future reference
    wpData.targetWebsite = targetWebsite;

    // Get website configuration
    const website = websiteConfig.getWebsite(targetWebsite);
    console.log(`📡 Posting to ${website.name} (${website.url})`);

    // Override owner_name with WhatsApp sender name if available
    if (ad.senderName && wpData.meta) {
      wpData.meta.owner_name = ad.senderName;
      console.log("✅ Using WhatsApp sender name:", ad.senderName);
    }

    // Use extracted phone numbers from ad text
    if (
      wpData.meta &&
      wpData.meta.contact &&
      Array.isArray(wpData.meta.contact) &&
      wpData.meta.contact.length > 0
    ) {
      const firstContact = wpData.meta.contact[0];
      if (firstContact.value) {
        wpData.meta.phone_number = firstContact.value;
        wpData.meta.phone = firstContact.value;
        console.log(
          "✅ Using extracted phone from ad text:",
          firstContact.value
        );
      }
    }

    // Get WordPress credentials
    const wpUrl = website.url;
    const wpUsername = website.username;
    const wpPassword = website.password;

    console.log(`🔐 Using credentials for ${website.name}`);

    // If preview only, return early
    if (previewOnly) {
      const settings = getSettings();
      const whatsappMessage = generateWhatsAppMessage(
        wpData,
        null,
        targetWebsite,
        settings
      );
      return {
        success: true,
        wordpressPost: null,
        extractedData: wpData,
        whatsappMessage: whatsappMessage,
        targetWebsite: targetWebsite,
      };
    }

    // Post to WordPress REST API
    const wpApiUrl = `${wpUrl}/wp-json/wp/v2/posts`;
    const auth = Buffer.from(`${wpUsername}:${wpPassword}`).toString("base64");

    // Upload image to WordPress if present
    let featuredMediaId = null;
    let imageBuffer = null;
    let imageContentType = "image/jpeg";
    let imageFilename = `ad-${ad.id}.jpg`;

    console.log("\n========== IMAGE UPLOAD CHECK ==========");
    console.log("Ad ID:", ad.id);
    console.log("Ad has imageUrl?", !!ad.imageUrl);
    console.log("imageUrl type:", typeof ad.imageUrl);
    console.log("Socket available?", !!sock);
    console.log("========================================\n");

    // First, try to get image from WhatsApp
    if (ad.imageUrl && typeof ad.imageUrl === "object" && sock) {
      try {
        console.log("\n🖼️ Uploading image from WhatsApp...");

        // Download image from WhatsApp
        const { downloadMediaMessage } = require("@whiskeysockets/baileys");

        imageBuffer = await downloadMediaMessage(
          { message: { imageMessage: ad.imageUrl } },
          "buffer",
          {},
          {
            logger: console,
            reuploadRequest: sock.updateMediaMessage,
          }
        );
        imageContentType = ad.imageUrl.mimetype || "image/jpeg";
        console.log("✅ WhatsApp image downloaded successfully");
      } catch (imageError) {
        console.error(
          "⚠️ Failed to download WhatsApp image:",
          imageError.message
        );
      }
    }

    // If no WhatsApp image, check if we should use a normal image from ad_images_normal
    if (!imageBuffer) {
      console.log(
        "\n========== NO WHATSAPP IMAGE - CHECKING NORMAL IMAGES =========="
      );

      // Only add normal images for "عروض" (offers), NOT for "طلبات" (requests)
      const adType =
        wpData.meta?.ad_type ||
        wpData.meta?.order_type ||
        wpData.meta?.offer_type ||
        "";
      const isRequest =
        adType.includes("طلب") ||
        wpData.meta?.category === "طلبات" ||
        wpData.meta?.parent_catt === "طلبات" ||
        wpData.meta?.category_id === 83;

      console.log("Ad Type:", adType);
      console.log("Is Request (طلبات)?", isRequest);

      if (!isRequest) {
        console.log(
          "\n🖼️ No WhatsApp image found. Checking for normal image..."
        );

        // Map property types to image filenames
        const imageMapping = {
          أرض: "ارض_زراعيه.png",
          ارض: "ارض_زراعيه.png",
          بيت: "بيت.png",
          دبلكس: "دبلكس.png",
          شقة: "شقه.png",
          شقه: "شقه.png",
          "شقة دبلكسية": "شقه_دبلكسيه.png",
          "شقه دبلكسيه": "شقه_دبلكسيه.png",
          فيلا: "فيلا.png",
          فيله: "فيلا.png",
          مزرعة: "مزرعه.png",
          مزرعه: "مزرعه.png",
          استراحة: "استراحه.png",
          استراحه: "استراحه.png",
          شالية: "شاليه.png",
          شاليه: "شاليه.png",
        };

        const propertyType =
          wpData.meta?.parent_catt ||
          wpData.meta?.arc_category ||
          wpData.meta?.category ||
          wpData.meta?.sub_catt ||
          "";

        // Check if this is a rental (إيجار)
        const isRental =
          wpData.meta?.category === "إيجار" ||
          wpData.meta?.parent_catt === "إيجار" ||
          wpData.meta?.category_id === 66;

        let normalImageFilename = imageMapping[propertyType];

        // Skip images for rentals since they show "للبيع" (for sale) text
        if (isRental) {
          if (propertyType === "شقة" || propertyType === "شقه") {
            console.log(
              `⚠️ Skipping "شقه.png" for rental apartment - image is for sale only`
            );
            normalImageFilename = null;
          } else if (propertyType === "فيلا" || propertyType === "فيله") {
            console.log(
              `⚠️ Skipping "فيلا.png" for rental villa - image is for sale only`
            );
            normalImageFilename = null;
          } else if (propertyType === "دبلكس") {
            console.log(
              `⚠️ Skipping "دبلكس.png" for rental duplex - image is for sale only`
            );
            normalImageFilename = null;
          }
        }

        if (!normalImageFilename) {
          console.log(
            `⚠️ No specific image mapping for "${propertyType}", skipping image upload`
          );
        } else {
          console.log(
            `✅ Found image mapping for "${propertyType}": ${normalImageFilename}`
          );

          const normalImagePath = path.join(
            __dirname,
            "..",
            "ad_images_normal",
            normalImageFilename
          );

          try {
            if (fs.existsSync(normalImagePath)) {
              imageBuffer = fs.readFileSync(normalImagePath);
              imageContentType = "image/png";
              imageFilename = normalImageFilename;
              console.log(`✅ Loaded normal image: ${normalImageFilename}`);
            } else {
              console.log(`⚠️ Normal image not found at: ${normalImagePath}`);
              console.log(`⚠️ Skipping image upload for this ad`);
            }
          } catch (readError) {
            console.error("⚠️ Error reading normal image:", readError.message);
            console.log("⚠️ Skipping image upload due to error");
          }
        }
      } else {
        console.log(
          "⚠️ This is a request (طلبات), skipping normal image upload"
        );
      }
    }

    // =====================================================
    // APPLY WATERMARK BASED ON TARGET WEBSITE
    // =====================================================
    if (imageBuffer) {
      try {
        const { processImage } = require("../services/watermarkService");
        console.log(`\n🎨 Applying watermark for ${targetWebsite}...`);
        imageBuffer = await processImage(imageBuffer, targetWebsite);
      } catch (watermarkError) {
        console.error("⚠️ Watermark processing failed:", watermarkError.message);
        console.log("⚠️ Continuing with original image without watermark");
      }
    }

    // Upload the image to WordPress if we have one
    if (imageBuffer) {
      try {
        const mediaUrl = `${wpUrl}/wp-json/wp/v2/media`;

        const safeFilename =
          Buffer.from(imageFilename)
            .toString("base64")
            .replace(/[^a-zA-Z0-9]/g, "") + ".png";

        console.log(
          `📤 Uploading image: ${imageFilename} (as ${safeFilename})`
        );

        // Use retry logic with timeout for image upload
        const uploadResponse = await axiosWithRetry(
          () => axios.post(mediaUrl, imageBuffer, {
            timeout: WP_AXIOS_TIMEOUT,
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": imageContentType,
              "Content-Disposition": `attachment; filename="${safeFilename}"`,
            },
          }),
          3,
          "WordPress image upload"
        );

        featuredMediaId = uploadResponse.data.id;
        console.log(
          "✅ Image uploaded to WordPress! Media ID:",
          featuredMediaId
        );
      } catch (imageError) {
        console.error(
          "⚠️ Failed to upload image to WordPress:",
          imageError.message
        );
        console.error("Full error:", imageError.response?.data || imageError);
      }
    }

    // ============================================
    // CATEGORY MAPPING USING WEBSITE CONFIG
    // ============================================

    console.log("\n========== CATEGORY MAPPING ==========");
    console.log("Target Website:", targetWebsite);
    console.log("Website Config:", website.name);

    let parentCatt =
      wpData.meta?.parent_catt ||
      wpData.meta?.arc_category ||
      wpData.meta?.category ||
      "";
    let subCatt =
      wpData.meta?.sub_catt ||
      wpData.meta?.arc_subcategory ||
      wpData.meta?.subcategory ||
      "";
    let orderType =
      wpData.meta?.order_type ||
      wpData.meta?.offer_type ||
      wpData.meta?.ad_type ||
      "بيع";

    console.log("Initial Category:", parentCatt);
    console.log("Initial Subcategory:", subCatt);

    // For Masaak: Check if it's a request category
    const isRequestCategory =
      targetWebsite === "masaak" &&
      (wpData.meta?.category_id === 83 ||
        wpData.meta?.category === "طلبات" ||
        parentCatt === "طلبات" ||
        wpData.meta?.order_status?.includes("طلب") ||
        wpData.meta?.offer_status?.includes("طلب"));

    if (isRequestCategory) {
      console.log("\n⚠️ Detected طلبات category - forcing category_id = 83");
      parentCatt = "طلبات";
      wpData.meta.category_id = 83;
      wpData.meta.category = "طلبات";
      wpData.meta.parent_catt = "طلبات";
    }

    // Auto-detect category from text if not found
    if (!parentCatt && targetWebsite === "masaak") {
      const textToCheck = `${wpData.title} ${wpData.content}`.toLowerCase();
      if (textToCheck.includes("أرض") || textToCheck.includes("ارض"))
        parentCatt = "أرض";
      else if (textToCheck.includes("شقة") || textToCheck.includes("شقه"))
        parentCatt = "شقة";
      else if (textToCheck.includes("فيلا") || textToCheck.includes("فيله"))
        parentCatt = "فيلا";
      else if (textToCheck.includes("بيت")) parentCatt = "بيت";
      else if (textToCheck.includes("عمارة") || textToCheck.includes("عماره"))
        parentCatt = "عمارة";
      else if (textToCheck.includes("مزرعة") || textToCheck.includes("مزرعه"))
        parentCatt = "مزرعة";
      else if (textToCheck.includes("محل")) parentCatt = "محل تجاري";
      else if (textToCheck.includes("مستودع")) parentCatt = "مستودع";
    }

    // Set default subcategory if missing (Masaak only)
    if (!subCatt && parentCatt && targetWebsite === "masaak") {
      const commonDefaults = {
        أرض: "سكنية",
        شقة: "دور أول",
        فيلا: "دورين",
        بيت: "دور",
        عمارة: "سكنية",
        مزرعة: "صك",
        مستودع: "كبير",
        "محطة بنزين": "بدون محلات",
        "محل تجاري": "محل تجاري",
      };
      subCatt = commonDefaults[parentCatt] || "";
    }

    // Get category IDs using website configuration
    let categoryId = websiteConfig.getCategoryId(targetWebsite, parentCatt);
    let subcategoryId = websiteConfig.getSubcategoryId(
      targetWebsite,
      parentCatt,
      subCatt
    );

    // ============================================
    // CATEGORY ID CONSISTENCY FIX
    // If AI already detected a valid category_id in meta, prefer that
    // This ensures consistency between meta.category_id and categories array
    // ============================================
    const aiDetectedCategoryId = wpData.meta?.category_id;
    if (aiDetectedCategoryId && aiDetectedCategoryId !== 1 && typeof aiDetectedCategoryId === 'number') {
      console.log("🔧 AI detected category_id:", aiDetectedCategoryId);
      console.log("🔧 Computed category_id:", categoryId);
      
      // If computed categoryId is default (1) but AI has a valid one, use AI's
      if (categoryId === 1 || categoryId === website.categories?.default) {
        categoryId = aiDetectedCategoryId;
        console.log("✅ Using AI-detected category_id instead of default:", categoryId);
      }
    }
    
    // Ensure meta.category_id matches the final categoryId for consistency
    wpData.meta.category_id = categoryId;

    console.log("Final Category ID:", categoryId);
    console.log("Final Subcategory ID:", subcategoryId);
    console.log("======================================\n");

    // Update wpData meta
    wpData.meta.parent_catt = parentCatt;
    wpData.meta.sub_catt = subCatt;

    // For Masaak real estate: use arc_category and arc_subcategory
    if (targetWebsite === "masaak" && parentCatt !== "طلبات") {
      wpData.meta.arc_category = parentCatt;
      wpData.meta.arc_subcategory = subCatt;
    } else if (targetWebsite === "masaak" && parentCatt === "طلبات") {
      delete wpData.meta.arc_category;
      delete wpData.meta.arc_subcategory;
    }

    wpData.meta.order_type = orderType;
    wpData.meta.offer_type = orderType;

    if (!wpData.meta.offer_status) {
      const statusMap = {
        بيع: "عرض جديد",
        ايجار: "متاح للإيجار",
        استثمار: "فرصة استثمارية",
        للتقبيل: "متاح للتقبيل",
        "اعلان تجاري": "إعلان نشط",
      };
      wpData.meta.offer_status = statusMap[orderType] || "عرض جديد";
    }

    const wpPayload = {
      title: wpData.title || "عقار جديد",
      content: wpData.content || wpData.description || "",
      status: "publish",
      categories: subcategoryId ? [categoryId, subcategoryId] : [categoryId],
      meta: wpData.meta || {},
    };

    if (featuredMediaId) {
      wpPayload.featured_media = featuredMediaId;
      console.log("✅ Featured media ID added to post:", featuredMediaId);
    }

    console.log("\n=== Sending to WordPress ===");
    console.log("Payload:", JSON.stringify(wpPayload, null, 2));
    console.log("============================\n");

    // Use retry logic with timeout for WordPress post creation
    const response = await axiosWithRetry(
      () => axios.post(wpApiUrl, wpPayload, {
        timeout: WP_AXIOS_TIMEOUT,
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
      }),
      3,
      "WordPress post creation"
    );

    // Create SHORT link
    const postId = response.data.id;
    const shortLink = `${wpUrl}/?p=${postId}`;
    const fullLink = response.data.link || response.data.guid?.rendered || "";

    console.log("\n=== WordPress Post Created ===");
    console.log("Post ID:", postId);
    console.log("Short Link:", shortLink);
    console.log("==============================\n");

    // Handle phone number based on target website
    if (wpData.meta) {
      if (targetWebsite === "masaak") {
        // For Massak: Always override with website default phone
        wpData.meta.phone_number = website.defaultPhone;
        wpData.meta.phone = website.defaultPhone;
        console.log(
          `✅ Using ${website.name} default phone:`,
          website.defaultPhone
        );
      } else if (targetWebsite === "hasak") {
        // For Hassak: Use phone from message if available, otherwise don't add any
        if (!wpData.meta.phone_number && !wpData.meta.phone) {
          // No phone number found in message, remove phone fields
          delete wpData.meta.phone_number;
          delete wpData.meta.phone;
          console.log(
            `✅ Hassak: No phone number in message, not adding any contact`
          );
        } else {
          // Phone number exists from message extraction, keep it
          console.log(
            `✅ Hassak: Using phone number from message:`,
            wpData.meta.phone_number || wpData.meta.phone
          );
        }
      }
    }

    // Generate WhatsApp message with website parameter
    console.log("\n🔵 GENERATING WHATSAPP MESSAGE 🔵");
    console.log("  - wpData exists:", !!wpData);
    console.log("  - shortLink:", shortLink);
    console.log("  - targetWebsite:", targetWebsite);

    const settings = getSettings();
    const whatsappMessage = generateWhatsAppMessage(
      wpData,
      shortLink,
      targetWebsite,
      settings
    );

    console.log("  - whatsappMessage generated:", !!whatsappMessage);
    console.log("  - whatsappMessage length:", whatsappMessage?.length || 0);
    console.log(
      "  - whatsappMessage preview:",
      whatsappMessage?.substring(0, 100) || "NULL"
    );
    console.log("🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵\n");

    // Update ad with WordPress data using the shared function
    // This updates the in-memory array AND saves to file
    console.log("\n💾 SAVING AD DATA 💾");
    console.log("  - Ad ID:", ad.id);
    console.log(
      "  - WhatsApp message to save:",
      whatsappMessage?.substring(0, 50) || "NULL"
    );

    // First, use the updateAdWordPressData function to save wpData and whatsappMessage
    const updated = updateAdWordPressData(ad.id, wpData, whatsappMessage);

    if (updated) {
      console.log("✅ Updated wpData and whatsappMessage in memory");

      // Now update the additional WordPress fields directly in the in-memory array
      const ads = getFetchedAds();
      const adToUpdate = ads.find((a) => a.id === ad.id);

      if (adToUpdate) {
        adToUpdate.wordpressPostId = response.data.id;
        adToUpdate.wordpressUrl = shortLink;
        adToUpdate.wordpressFullUrl = fullLink;
        adToUpdate.wordpressPostedAt = new Date().toISOString();
        adToUpdate.targetWebsite = targetWebsite;

        console.log(
          "  - Saving whatsappMessage:",
          !!adToUpdate.whatsappMessage
        );
        console.log("  - Saving targetWebsite:", adToUpdate.targetWebsite);

        // Save again to persist the WordPress post details
        const fs = require("fs");
        const path = require("path");
        const adsFilePath = path.join(__dirname, "..", "data", "ads.json");
        fs.writeFileSync(adsFilePath, JSON.stringify(ads, null, 2));

        console.log(
          `✅ Ad ${ad.id} updated with ${website.name} WordPress data`
        );
        console.log("💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾\n");
      } else {
        console.log("❌ Ad not found in memory array!");
        console.log("💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾\n");
      }
    } else {
      console.log("❌ Failed to update ad in memory, cannot save!");
      console.log("💾💾💾💾💾💾💾💾💾💾💾💾💾💾💾\n");
    }

    return {
      success: true,
      wordpressPost: {
        id: response.data.id,
        link: shortLink,
        fullLink: fullLink,
        title: response.data.title?.rendered || wpPayload.title,
        categories: response.data.categories || [],
        website: website.name,
        websiteUrl: website.url,
      },
      extractedData: wpData,
      whatsappMessage: whatsappMessage,
      targetWebsite: targetWebsite,
    };
  } catch (err) {
    console.error("Error posting to WordPress:", err);
    if (err.response) {
      console.error("WordPress API Error Response:");
      console.error("Status:", err.response.status);
      console.error("Data:", JSON.stringify(err.response.data, null, 2));
    }
    throw err;
  }
}

// Export the function so it can be used elsewhere
router.postAdToWordPress = postAdToWordPress;

// Get QR code (accessible to all authenticated users)
router.get("/qr", authenticateToken, (req, res) => {
  try {
    const qrCode = getQRCode();
    const status = getConnectionStatus();

    res.json({
      success: true,
      qrCode,
      status,
    });
  } catch (error) {
    console.error("Error getting QR code:", error);
    res.status(500).json({ error: "Failed to get QR code" });
  }
});

// Get bot status (accessible to all authenticated users)
router.get("/status", authenticateToken, (req, res) => {
  try {
    const status = getConnectionStatus();
    const queueStats = messageQueue.getStats();

    res.json({
      success: true,
      status,
      queue: queueStats,
    });
  } catch (error) {
    console.error("Error getting status:", error);
    res.status(500).json({ error: "Failed to get status" });
  }
});

// Get message handler health status (accessible to all authenticated users)
// NEW: Helps diagnose issues where bot appears connected but doesn't respond
router.get("/health", authenticateToken, (req, res) => {
  try {
    const health = getMessageHandlerHealth();
    const status = getConnectionStatus();
    const queueStats = messageQueue.getStats();

    res.json({
      success: true,
      connectionStatus: status,
      messageHandler: health,
      queue: queueStats,
      serverTime: new Date().toISOString(),
      recommendation: !health.isHealthy 
        ? "⚠️ Message handler may be stale. Consider restarting the bot."
        : "✅ Message handler is healthy"
    });
  } catch (error) {
    console.error("Error getting health status:", error);
    res.status(500).json({ error: "Failed to get health status" });
  }
});

// Get queue statistics (accessible to all authenticated users)
router.get("/queue/stats", authenticateToken, (req, res) => {
  try {
    const stats = messageQueue.getStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("Error getting queue stats:", error);
    res.status(500).json({ error: "Failed to get queue stats" });
  }
});

// Configure queue settings (admin only)
router.post(
  "/queue/config",
  authenticateToken,
  authorizeRole("admin"),
  (req, res) => {
    try {
      const { maxConcurrent, delayBetweenMessages } = req.body;

      messageQueue.setConfig({
        maxConcurrent,
        delayBetweenMessages,
      });

      res.json({
        success: true,
        message: "Queue configuration updated",
        config: {
          maxConcurrent,
          delayBetweenMessages,
        },
      });
    } catch (error) {
      console.error("Error configuring queue:", error);
      res.status(500).json({ error: "Failed to configure queue" });
    }
  }
);

// Disconnect bot (admin only)
router.post(
  "/disconnect",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      await disconnectBot();
      res.json({
        success: true,
        message: "Bot disconnected successfully",
      });
    } catch (error) {
      console.error("Error disconnecting bot:", error);
      res.status(500).json({ error: "Failed to disconnect bot" });
    }
  }
);

// Send message (admin and author)
router.post(
  "/send-message",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  async (req, res) => {
    try {
      const { number, message } = req.body;

      if (!number || !message) {
        return res
          .status(400)
          .json({ error: "Number and message are required" });
      }

      await sendMessage(number, message);
      res.json({
        success: true,
        message: "Message sent successfully",
      });
    } catch (error) {
      console.error("Error sending message:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to send message" });
    }
  }
);

// ========================================================
// BACKGROUND BULK MESSAGE SENDING
// Continues processing even if user closes the browser
// Sends completion notification to admin phone
// ========================================================

// Track active bulk sending jobs
const activeBulkJobs = new Map();

// Send bulk messages in background (admin and author)
router.post(
  "/send-bulk-messages",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  async (req, res) => {
    try {
      const { 
        adId, 
        message, 
        groups = [], 
        customNumbers = [], 
        delaySeconds = 3 
      } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const allRecipients = [...groups, ...customNumbers.map(n => ({ ...n, isPrivate: true }))];
      
      if (allRecipients.length === 0) {
        return res.status(400).json({ error: "At least one recipient is required" });
      }

      // Generate a unique job ID
      const jobId = `bulk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Store job info
      const jobInfo = {
        id: jobId,
        adId,
        message,
        groups,
        customNumbers,
        delaySeconds,
        totalRecipients: allRecipients.length,
        startedAt: new Date().toISOString(),
        status: "processing",
        successCount: 0,
        failCount: 0,
        currentIndex: 0,
      };
      
      activeBulkJobs.set(jobId, jobInfo);

      console.log(`🚀 [BULK SEND] Started job ${jobId}`);
      console.log(`   📊 Total recipients: ${allRecipients.length}`);
      console.log(`   ⏱️ Delay: ${delaySeconds}s between messages`);
      console.log(`   📢 Groups: ${groups.length}`);
      console.log(`   📱 Custom numbers: ${customNumbers.length}`);

      // Return immediately - processing happens in background
      res.json({
        success: true,
        jobId,
        message: "Bulk sending started in background",
        totalRecipients: allRecipients.length,
      });

      // Process messages in background (async, non-blocking)
      processBulkMessagesInBackground(jobInfo).catch(err => {
        console.error(`❌ [BULK SEND] Job ${jobId} failed:`, err);
        jobInfo.status = "failed";
        jobInfo.error = err.message;
      });

    } catch (error) {
      console.error("Error starting bulk send:", error);
      res.status(500).json({ error: error.message || "Failed to start bulk send" });
    }
  }
);

// Get bulk job status
router.get(
  "/bulk-job/:jobId",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    const { jobId } = req.params;
    const job = activeBulkJobs.get(jobId);
    
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    
    res.json({ success: true, job });
  }
);

/**
 * Process bulk messages in the background
 * This function runs independently of the HTTP request
 */
async function processBulkMessagesInBackground(jobInfo) {
  const { id: jobId, adId, message, groups, customNumbers, delaySeconds } = jobInfo;
  const delayMs = delaySeconds * 1000;
  
  console.log(`\n📦 [BULK SEND] Processing job ${jobId}...`);
  
  // First send to groups
  for (let i = 0; i < groups.length; i++) {
    const groupId = groups[i];
    jobInfo.currentIndex = i + 1;
    
    try {
      console.log(`📢 [${jobInfo.currentIndex}/${jobInfo.totalRecipients}] Sending to group: ${groupId}`);
      await sendMessage(groupId, message);
      jobInfo.successCount++;
      console.log(`   ✅ Success`);
    } catch (err) {
      console.error(`   ❌ Failed:`, err.message);
      jobInfo.failCount++;
    }
    
    // Delay between messages
    if (i < groups.length - 1 || customNumbers.length > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  // Then send to custom numbers (private messages)
  for (let i = 0; i < customNumbers.length; i++) {
    const number = customNumbers[i];
    jobInfo.currentIndex = groups.length + i + 1;
    
    // Normalize phone number
    let cleanPhone = number.phone.replace(/\D/g, "");
    
    // Handle Egyptian numbers (starting with 0)
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "2" + cleanPhone;
    }
    // Handle Saudi numbers
    else if (!cleanPhone.startsWith("2") && !cleanPhone.startsWith("966") && !cleanPhone.startsWith("971")) {
      if (cleanPhone.startsWith("5")) {
        cleanPhone = "966" + cleanPhone;
      } else {
        cleanPhone = "20" + cleanPhone;
      }
    }
    
    const whatsappNumber = cleanPhone.includes("@") ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;
    
    try {
      console.log(`📱 [${jobInfo.currentIndex}/${jobInfo.totalRecipients}] Sending to: ${number.name || cleanPhone}`);
      await sendMessage(whatsappNumber, message);
      jobInfo.successCount++;
      console.log(`   ✅ Success`);
    } catch (err) {
      console.error(`   ❌ Failed:`, err.message);
      jobInfo.failCount++;
    }
    
    // Delay between messages (except for the last one)
    if (i < customNumbers.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  // Mark as completed
  jobInfo.status = "completed";
  jobInfo.completedAt = new Date().toISOString();
  
  console.log(`\n✅ [BULK SEND] Job ${jobId} completed!`);
  console.log(`   📊 Success: ${jobInfo.successCount}/${jobInfo.totalRecipients}`);
  console.log(`   ❌ Failed: ${jobInfo.failCount}`);
  
  // Update ad status and mark as sent
  if (adId) {
    try {
      const ok = updateAdStatus(adId, "accepted");
      if (ok) {
        console.log(`   📝 Updated ad ${adId} status to accepted`);
      }
    } catch (err) {
      console.error(`   ⚠️ Failed to update ad status:`, err.message);
    }
  }
  
  // Send completion notification to admin
  const ADMIN_PHONE = "966508001475@s.whatsapp.net";
  const completionMessage = `✅ *إرسال جماعي مكتمل*

📦 رقم المهمة: ${jobId}
📊 الإجمالي: ${jobInfo.totalRecipients}
✅ نجح: ${jobInfo.successCount}
❌ فشل: ${jobInfo.failCount}
⏱️ التأخير: ${delaySeconds} ثانية
🕐 وقت الإنتهاء: ${new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}

${jobInfo.failCount === 0 ? "🎉 تم الإرسال بنجاح للجميع!" : "⚠️ بعض الرسائل فشلت في الإرسال"}`;

  try {
    console.log(`📤 Sending completion notification to admin...`);
    await sendMessage(ADMIN_PHONE, completionMessage);
    console.log(`   ✅ Admin notified`);
  } catch (err) {
    console.error(`   ❌ Failed to notify admin:`, err.message);
  }
  
  // Clean up old jobs after 1 hour
  setTimeout(() => {
    activeBulkJobs.delete(jobId);
    console.log(`🧹 Cleaned up job ${jobId}`);
  }, 60 * 60 * 1000);
}

// --- Ads endpoints ---

// List fetched ads with pagination (admin and author)
router.get(
  "/ads",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { page = 1, limit = 20, status, category, website, group } = req.query;

      let fetched = getFetchedAds();

      // Collect unique groups from ALL ads (before filtering)
      const groupsMap = new Map();
      getFetchedAds().forEach((ad) => {
        if (ad.fromGroupName && ad.fromGroup) {
          groupsMap.set(ad.fromGroup, { id: ad.fromGroup, name: ad.fromGroupName });
        }
      });
      const allGroups = Array.from(groupsMap.values());

      // Apply filters
      if (status && status !== "all") {
        fetched = fetched.filter((a) => a.status === status);
      }

      if (category && category !== "all") {
        if (category === "uncategorized") {
          fetched = fetched.filter((a) => !a.category);
        } else {
          fetched = fetched.filter((a) => a.category === category);
        }
      }

      // Website filter (based on targetWebsite or wpData)
      if (website && website !== "all") {
        fetched = fetched.filter((a) => {
          // Check targetWebsite first
          if (a.targetWebsite) {
            return a.targetWebsite === website;
          }
          // Check wpData.targetWebsite
          if (a.wpData && a.wpData.targetWebsite) {
            return a.wpData.targetWebsite === website;
          }
          return false;
        });
      }

      // Group filter (based on fromGroup or fromGroupName)
      if (group && group !== "all") {
        fetched = fetched.filter((a) => {
          return a.fromGroup === group || a.fromGroupName === group;
        });
      }

      // Calculate pagination
      const totalAds = fetched.length;
      const totalPages = Math.ceil(totalAds / limit);
      const currentPage = Math.max(1, Math.min(page, totalPages || 1));
      const startIndex = (currentPage - 1) * limit;
      const endIndex = startIndex + parseInt(limit);

      // Get paginated results
      const paginatedAds = fetched.slice(startIndex, endIndex);

      res.json({
        success: true,
        ads: paginatedAds,
        allGroups: allGroups,
        pagination: {
          currentPage: parseInt(currentPage),
          totalPages,
          totalAds,
          limit: parseInt(limit),
          hasMore: currentPage < totalPages,
        },
      });
    } catch (err) {
      console.error("Error listing ads:", err);
      res.status(500).json({ error: "Failed to list ads" });
    }
  }
);

// Get WhatsApp messages - optimized endpoint (admin and author)
// Pre-filters to only accepted ads with WhatsApp messages for performance
router.get(
  "/ads/whatsapp-messages",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { page = 1, limit = 12, website, group, category, status } = req.query;

      let ads = getFetchedAds();

      // Collect unique groups and categories from ALL matching ads (before pagination)
      const groupsMap = new Map();
      const categoriesSet = new Set();

      // Pre-filter: only accepted ads with whatsappMessage
      ads = ads.filter((ad) => {
        const hasWhatsApp = ad.whatsappMessage && ad.whatsappMessage.trim();
        
        // Check if message was sent using any of the three indicators
        // This matches the client-side logic in app.js
        const wasSent = 
          ad.postedToGroups || 
          ad.sentToGroups || 
          (ad.selectedGroups && ad.selectedGroups.length > 0);
        
        // For status filter - default to 'pending' (not sent)
        if (status === 'sent') {
          return ad.status === 'accepted' && hasWhatsApp && wasSent;
        } else if (status === 'pending') {
          return ad.status === 'accepted' && hasWhatsApp && !wasSent;
        } else {
          // 'all' - any accepted with whatsapp message
          return ad.status === 'accepted' && hasWhatsApp;
        }
      });

      // Collect groups and categories
      ads.forEach((ad) => {
        if (ad.fromGroupName && ad.fromGroup) {
          groupsMap.set(ad.fromGroup, { id: ad.fromGroup, name: ad.fromGroupName });
        }
        const meta = ad.wpData && ad.wpData.meta ? ad.wpData.meta : {};
        const effectiveCategory = meta.arc_category || meta.parent_catt || ad.category;
        if (effectiveCategory) {
          categoriesSet.add(effectiveCategory);
        }
      });

      const allGroups = Array.from(groupsMap.values());
      const allCategories = Array.from(categoriesSet).sort();

      // Apply additional filters
      if (website && website !== "all") {
        ads = ads.filter((a) => {
          if (a.targetWebsite) return a.targetWebsite === website;
          if (a.wpData && a.wpData.targetWebsite) return a.wpData.targetWebsite === website;
          return false;
        });
      }

      if (group && group !== "all") {
        ads = ads.filter((a) => a.fromGroup === group || a.fromGroupName === group);
      }

      if (category && category !== "all") {
        ads = ads.filter((a) => {
          const meta = a.wpData && a.wpData.meta ? a.wpData.meta : {};
          const effectiveCategory = meta.arc_category || meta.parent_catt || a.category;
          return effectiveCategory === category;
        });
      }

      // Sort by timestamp descending (newest first)
      ads.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      // Calculate pagination
      const totalAds = ads.length;
      const totalPages = Math.ceil(totalAds / limit) || 1;
      const currentPage = Math.max(1, Math.min(parseInt(page), totalPages));
      const startIndex = (currentPage - 1) * parseInt(limit);
      const endIndex = startIndex + parseInt(limit);

      // Get paginated results
      const paginatedAds = ads.slice(startIndex, endIndex);

      res.json({
        success: true,
        ads: paginatedAds,
        allGroups,
        allCategories,
        pagination: {
          currentPage,
          totalPages,
          totalAds,
          limit: parseInt(limit),
          hasMore: currentPage < totalPages,
        },
      });
    } catch (err) {
      console.error("Error listing WhatsApp messages:", err);
      res.status(500).json({ error: "Failed to list WhatsApp messages" });
    }
  }
);

// Get ad by ID with generated data (admin and author)
router.get(
  "/ads/:id",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const ad = getAdById(id);

      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      res.json({ success: true, ad });
    } catch (err) {
      console.error("Error getting ad:", err);
      res.status(500).json({ error: "Failed to get ad" });
    }
  }
);

// Delete ad image (admin and author)
router.delete(
  "/ads/:id/image",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { id } = req.params;
      
      const result = removeAdImage(id);
      
      if (!result) {
        return res.status(404).json({ error: "Ad not found" });
      }
      
      res.json({ 
        success: true, 
        message: "Image removed successfully" 
      });
    } catch (err) {
      console.error("Error removing ad image:", err);
      res.status(500).json({ error: "Failed to remove image" });
    }
  }
);

// Get full-quality ad image from WhatsApp (admin and author)
router.get(
  "/ads/:id/full-image",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const ad = getAdById(id);

      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      if (!ad.imageUrl || typeof ad.imageUrl !== "object") {
        return res.status(404).json({ error: "No image available for this ad" });
      }

      // Get WhatsApp socket
      const sock = req.app.get("whatsappSock");
      if (!sock) {
        // Fallback to thumbnail if socket not available
        if (ad.imageUrl.jpegThumbnail) {
          const thumbnailBuffer = Buffer.from(ad.imageUrl.jpegThumbnail, "base64");
          res.set("Content-Type", "image/jpeg");
          res.set("Content-Disposition", `inline; filename="ad-${id}-thumbnail.jpg"`);
          return res.send(thumbnailBuffer);
        }
        return res.status(503).json({ error: "WhatsApp connection not available" });
      }

      console.log(`🖼️ Downloading full-quality image for ad: ${id}`);

      // Baileys requires a key for reuploadRequest to work
      const messageKey = ad.messageKey || { 
        id: id.includes("_") ? id.split("_")[1] : id, 
        remoteJid: ad.fromGroup, 
        fromMe: false 
      };

      const { downloadMediaMessage } = require("@whiskeysockets/baileys");
      
      let imageBuffer;
      try {
        imageBuffer = await downloadMediaMessage(
          { 
            key: messageKey,
            message: { imageMessage: ad.imageUrl } 
          },
          "buffer",
          {},
          {
            logger: console,
            reuploadRequest: sock.updateMediaMessage,
          }
        );
      } catch (downloadErr) {
        console.warn("⚠️ Full image download failed, trying without reupload request...");
        imageBuffer = await downloadMediaMessage(
          { message: { imageMessage: ad.imageUrl } },
          "buffer",
          {},
          { logger: console }
        );
      }

      const contentType = ad.imageUrl.mimetype || "image/jpeg";
      const extension = contentType.includes("png") ? "png" : "jpg";

      console.log(`✅ Full image downloaded: ${imageBuffer.length} bytes`);

      res.set("Content-Type", contentType);
      res.set("Content-Disposition", `inline; filename="ad-${id}.${extension}"`);
      res.set("Cache-Control", "public, max-age=3600"); // Cache for 1 hour
      res.send(imageBuffer);
    } catch (err) {
      console.error("Error getting full ad image:", err);
      
      // Try to fallback to thumbnail
      const ad = getAdById(req.params.id);
      if (ad && ad.imageUrl && ad.imageUrl.jpegThumbnail) {
        console.log("⚠️ Falling back to thumbnail due to error");
        const thumbnailBuffer = Buffer.from(ad.imageUrl.jpegThumbnail, "base64");
        res.set("Content-Type", "image/jpeg");
        res.set("Content-Disposition", `inline; filename="ad-${req.params.id}-thumbnail.jpg"`);
        return res.send(thumbnailBuffer);
      }
      console.log("⚠️ Falling back to placeholder image");
      res.sendFile(path.join(__dirname, "../public/images/no-image-placeholder.png"));
    }
  }
);

// Update ad status (accept/reject) (admin and author)
router.post(
  "/ads/:id/status",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;
      if (!["new", "accepted", "rejected", "posted"].includes(status))
        return res.status(400).json({ error: "Invalid status" });

      // Pass rejection reason if status is rejected
      const ok = updateAdStatus(id, status, status === "rejected" ? reason : null);
      if (!ok) return res.status(404).json({ error: "Ad not found" });

      // Check if auto-approve is enabled and status is accepted
      const settings = getSettings();
      console.log("📋 Auto-approve setting:", settings.autoApproveWordPress);
      console.log("📋 Status being set:", status);

      if (status === "accepted" && settings.autoApproveWordPress === true) {
        console.log(
          "🚀 Auto-approve enabled, posting to WordPress automatically..."
        );

        // Capture the app reference before async
        const app = req.app;

        // Post to WordPress in the background (don't wait for it)
        // This prevents blocking the response
        (async () => {
          try {
            const fs = require("fs");
            const path = require("path");
            const adsFilePath = path.join(__dirname, "..", "data", "ads.json");
            const adsData = JSON.parse(fs.readFileSync(adsFilePath, "utf8"));
            const adsArray = Array.isArray(adsData)
              ? adsData
              : adsData.ads || [];
            const ad = adsArray.find((a) => a.id === id);

            if (!ad) {
              console.error("❌ Ad not found for auto-posting:", id);
              return;
            }

            console.log("📝 Ad found:", ad.id);
            console.log("📝 Ad has wpData:", !!ad.wpData);

            // Use pre-generated WordPress data if available
            let wpData = ad.wpData;
            if (!wpData) {
              console.log(
                "⚠️ No pre-generated WordPress data, skipping auto-post"
              );
              return;
            }

            // Override owner_name with WhatsApp sender name if available
            if (ad.senderName && wpData.meta) {
              wpData.meta.owner_name = ad.senderName;
            }

            // Use extracted phone numbers from ad text (not WhatsApp sender phone)
            if (
              wpData.meta &&
              wpData.meta.contact &&
              Array.isArray(wpData.meta.contact) &&
              wpData.meta.contact.length > 0
            ) {
              const firstContact = wpData.meta.contact[0];
              if (firstContact.value) {
                wpData.meta.phone_number = firstContact.value;
                wpData.meta.phone = firstContact.value;
              }
            }

            const wpUrl = settings.wordpressUrl || "https://masaak.com";
            const wpUsername = settings.wordpressUsername;
            const wpPassword = settings.wordpressPassword;

            if (!wpUsername || !wpPassword) {
              console.error("❌ WordPress credentials not configured");
              return;
            }

            console.log("🔵 Starting WordPress auto-post...");
            console.log("🔵 WordPress URL:", wpUrl);

            const wpApiUrl = `${wpUrl}/wp-json/wp/v2/posts`;
            const auth = Buffer.from(`${wpUsername}:${wpPassword}`).toString(
              "base64"
            );

            // Upload image to WordPress if present
            let featuredMediaId = null;
            if (ad.imageUrl && typeof ad.imageUrl === "object") {
              try {
                const sock = app.get("whatsappSock");
                if (sock) {
                  console.log("📸 Uploading image to WordPress...");
                  const {
                    downloadMediaMessage,
                  } = require("@whiskeysockets/baileys");
                  const imageBuffer = await downloadMediaMessage(
                    ad.imageUrl,
                    "buffer",
                    {},
                    {
                      logger: console,
                      reuploadRequest: sock.updateMediaMessage,
                    }
                  );

                  const mediaUrl = `${wpUrl}/wp-json/wp/v2/media`;
                  const safeFilename =
                    Buffer.from(`ad-${ad.id}`)
                      .toString("base64")
                      .replace(/[^a-zA-Z0-9]/g, "") + ".png";

                  const uploadResponse = await axios.post(
                    mediaUrl,
                    imageBuffer,
                    {
                      headers: {
                        Authorization: `Basic ${auth}`,
                        "Content-Type": "image/jpeg",
                        "Content-Disposition": `attachment; filename="${safeFilename}"`,
                      },
                    }
                  );

                  featuredMediaId = uploadResponse.data.id;
                  console.log(
                    "✅ Auto-posted image to WordPress! Media ID:",
                    featuredMediaId
                  );
                } else {
                  console.log(
                    "⚠️ WhatsApp socket not available, skipping image upload"
                  );
                }
              } catch (imageError) {
                console.error(
                  "⚠️ Failed to upload image during auto-post:",
                  imageError.message
                );
              }
            }

            // Post to WordPress
            const postData = {
              title: wpData.title || "Untitled Ad",
              content: wpData.content || "",
              status: "publish",
              categories: wpData.categories || [],
              meta: wpData.meta || {},
            };

            if (featuredMediaId) {
              postData.featured_media = featuredMediaId;
            }

            console.log("📤 Posting to WordPress API...");
            const wpResponse = await axios.post(wpApiUrl, postData, {
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json",
              },
            });

            console.log(
              "✅ ✅ ✅ Auto-posted to WordPress successfully! ✅ ✅ ✅"
            );
            console.log("📌 Post ID:", wpResponse.data.id);

            // Create SHORT link using post ID
            const postId = wpResponse.data.id;
            const shortLink = `${wpUrl}/?p=${postId}`;
            const fullLink = wpResponse.data.link;

            console.log("📌 Short Link:", shortLink);
            console.log("📌 Full Link:", fullLink);

            // Generate WhatsApp message with the SHORT link
            const {
              generateWhatsAppMessage,
            } = require("../services/aiService");
            const settings = getSettings();
            const whatsappMessage = generateWhatsAppMessage(wpData, shortLink, 'masaak', settings);

            // Update ad with WordPress info - keep as "accepted" not "posted"
            ad.status = "accepted";
            ad.wordpressPostId = wpResponse.data.id;
            ad.wordpressPostUrl = shortLink;
            ad.wordpressFullUrl = fullLink;
            ad.whatsappMessage = whatsappMessage;

            // Save updated ad
            fs.writeFileSync(
              adsFilePath,
              JSON.stringify(adsArray, null, 2),
              "utf8"
            );
            console.log(
              "✅ Ad updated with WordPress info and kept as accepted"
            );
          } catch (error) {
            console.error(
              "❌ ❌ ❌ Error during auto-post to WordPress ❌ ❌ ❌"
            );
            console.error("Error message:", error.message);
            console.error("Error details:", error.response?.data || error);
          }
        })();
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Error updating ad status:", err);
      res.status(500).json({ error: "Failed to update status" });
    }
  }
);

// Update ad category (admin and author)
router.post(
  "/ads/:id/category",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const { category } = req.body;

      const ok = updateAdCategory(id, category);
      if (!ok) return res.status(404).json({ error: "Ad not found" });

      res.json({ success: true });
    } catch (err) {
      console.error("Error updating ad category:", err);
      res.status(500).json({ error: "Failed to update category" });
    }
  }
);

// Update ad text (manual edit) (admin and author)
router.post(
  "/ads/:id/edit",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const { text } = req.body;

      if (!text) {
        return res.status(400).json({ error: "Text is required" });
      }

      const ok = updateAdText(id, text);
      if (!ok) return res.status(404).json({ error: "Ad not found" });

      res.json({ success: true });
    } catch (err) {
      console.error("Error updating ad text:", err);
      res.status(500).json({ error: "Failed to update ad text" });
    }
  }
);

// Move rejected ad to recycle bin (admin and author)
router.post(
  "/ads/:id/recycle-bin",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { id } = req.params;

      const ok = moveAdToRecycleBin(id);
      if (!ok) return res.status(404).json({ error: "Ad not found or not rejected" });

      res.json({ success: true, message: "Ad moved to recycle bin" });
    } catch (err) {
      console.error("Error moving ad to recycle bin:", err);
      res.status(500).json({ error: "Failed to move ad to recycle bin" });
    }
  }
);

// Regenerate ad with AI (admin and author)
router.post(
  "/ads/:id/regenerate",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const ad = getAdById(id);

      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      // Use original text for regeneration
      const textToEnhance = ad.text;

      // Generate WordPress data
      const wpData = await extractWordPressData(textToEnhance);

      // Generate WhatsApp message
      const settings = getSettings();
      const whatsappMessage = generateWhatsAppMessage(wpData, null, 'masaak', settings);

      // Update the ad with new WordPress data and WhatsApp message
      const ok = updateAdWordPressData(id, wpData, whatsappMessage);

      if (!ok) {
        return res.status(404).json({ error: "Failed to update ad" });
      }

      res.json({
        success: true,
        wpData: wpData,
        whatsappMessage: whatsappMessage,
        improvements: [
          "WordPress data regenerated",
          "WhatsApp message regenerated",
        ],
      });
    } catch (err) {
      console.error("Error regenerating ad:", err);
      res.status(500).json({ error: "Failed to regenerate ad" });
    }
  }
);

// Resend ad to selected groups (admin only)
router.post(
  "/ads/:id/resend",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { groups } = req.body; // array of group jids or raw ids
      if (!Array.isArray(groups) || groups.length === 0) {
        return res.status(400).json({ error: "Groups array required" });
      }

      const results = await resendAd(id, groups);
      res.json({ success: true, results });
    } catch (err) {
      console.error("Error resending ad:", err);
      res.status(500).json({ error: err.message || "Failed to resend ad" });
    }
  }
);

// Get known groups seen by the bot (admin/author)
router.get(
  "/groups",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  async (req, res) => {
    try {
      const groups = await getGroupsWithMetadata();
      res.json({ success: true, groups });
    } catch (err) {
      console.error("Error getting groups:", err);
      res.status(500).json({ error: "Failed to get groups" });
    }
  }
);

// Refresh groups list (admin/author)
router.post(
  "/groups/refresh",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  async (req, res) => {
    try {
      // Force refresh groups metadata from WhatsApp
      const groups = await getGroupsWithMetadata(true); // true = force refresh
      res.json({
        success: true,
        groups,
        message: "Groups refreshed successfully",
      });
    } catch (err) {
      console.error("Error refreshing groups:", err);
      res.status(500).json({ error: "Failed to refresh groups" });
    }
  }
);

// Get collections (admin/author)
router.get(
  "/collections",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const collections = getCollections();
      res.json({ success: true, collections });
    } catch (err) {
      console.error("Error getting collections:", err);
      res.status(500).json({ error: "Failed to get collections" });
    }
  }
);

// Save collection (admin/author)
router.post(
  "/collections",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { name, groups } = req.body;
      if (!name || !Array.isArray(groups)) {
        return res
          .status(400)
          .json({ error: "Name and groups array required" });
      }
      const collection = saveCollection(name, groups);
      const allCollections = getCollections();
      res.json({ success: true, collection, collections: allCollections });
    } catch (err) {
      console.error("Error saving collection:", err);
      res.status(500).json({ error: "Failed to save collection" });
    }
  }
);

// Update collection (admin/author)
router.put(
  "/collections",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { collectionId, name, groups } = req.body;
      if (!collectionId || !name || !Array.isArray(groups)) {
        return res
          .status(400)
          .json({ error: "Collection ID, name and groups array required" });
      }
      const collection = updateCollection(collectionId, name, groups);
      if (!collection) {
        return res.status(404).json({ error: "Collection not found" });
      }
      const allCollections = getCollections();
      res.json({ success: true, collection, collections: allCollections });
    } catch (err) {
      console.error("Error updating collection:", err);
      res.status(500).json({ error: "Failed to update collection" });
    }
  }
);

// Delete collection (admin/author)
router.delete(
  "/collections/:id",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const ok = deleteCollection(id);
      if (!ok) return res.status(404).json({ error: "Collection not found" });
      const allCollections = getCollections();
      res.json({ success: true, collections: allCollections });
    } catch (err) {
      console.error("Error deleting collection:", err);
      res.status(500).json({ error: "Failed to delete collection" });
    }
  }
);

// ========== CUSTOM PHONE NUMBERS ENDPOINTS ==========

// Get custom numbers (admin only)
router.get(
  "/custom-numbers",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const fs = require("fs");
      const path = require("path");
      const customNumbersFile = path.join(
        __dirname,
        "..",
        "data",
        "custom_numbers.json"
      );

      if (!fs.existsSync(customNumbersFile)) {
        fs.writeFileSync(customNumbersFile, JSON.stringify([]));
      }

      const data = JSON.parse(fs.readFileSync(customNumbersFile, "utf8"));
      res.json({ success: true, numbers: data });
    } catch (err) {
      console.error("Error getting custom numbers:", err);
      res.status(500).json({ error: "Failed to get custom numbers" });
    }
  }
);

// Save custom number (admin only)
router.post(
  "/custom-numbers",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { name, phone } = req.body;

      console.log("📥 Received custom number save request:", { name, phone });
      console.log("👤 User role:", req.user?.role);

      if (!name || !phone) {
        console.log("❌ Validation failed: Missing name or phone");
        return res.status(400).json({ error: "Name and phone are required" });
      }

      const fs = require("fs");
      const path = require("path");
      const customNumbersFile = path.join(
        __dirname,
        "..",
        "data",
        "custom_numbers.json"
      );

      if (!fs.existsSync(customNumbersFile)) {
        console.log("📁 Creating new custom_numbers.json file");
        fs.writeFileSync(customNumbersFile, JSON.stringify([]));
      }

      const data = JSON.parse(fs.readFileSync(customNumbersFile, "utf8"));
      console.log("📋 Current saved numbers:", data.length);

      // Check if phone already exists
      if (data.find((n) => n.phone === phone)) {
        console.log("⚠️ Phone number already exists:", phone);
        return res.status(400).json({ error: "Phone number already exists" });
      }

      data.push({ name, phone });
      fs.writeFileSync(customNumbersFile, JSON.stringify(data, null, 2));

      console.log("✅ Custom number saved successfully:", { name, phone });
      console.log("📊 Total saved numbers:", data.length);

      res.json({ success: true, numbers: data });
    } catch (err) {
      console.error("❌ Error saving custom number:", err);
      res.status(500).json({ error: "Failed to save custom number" });
    }
  }
);

// Delete custom number (admin only)
router.delete(
  "/custom-numbers",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { phone } = req.body;

      if (!phone) {
        return res.status(400).json({ error: "Phone is required" });
      }

      const fs = require("fs");
      const path = require("path");
      const customNumbersFile = path.join(
        __dirname,
        "..",
        "data",
        "custom_numbers.json"
      );

      if (!fs.existsSync(customNumbersFile)) {
        return res.status(404).json({ error: "No custom numbers found" });
      }

      let data = JSON.parse(fs.readFileSync(customNumbersFile, "utf8"));
      data = data.filter((n) => n.phone !== phone);
      fs.writeFileSync(customNumbersFile, JSON.stringify(data, null, 2));

      res.json({ success: true, numbers: data });
    } catch (err) {
      console.error("Error deleting custom number:", err);
      res.status(500).json({ error: "Failed to delete custom number" });
    }
  }
);

// ========== END CUSTOM PHONE NUMBERS ENDPOINTS ==========

// Get categories (admin/author)
router.get(
  "/categories",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const cats = getCategories();
      res.json({ success: true, categories: cats });
    } catch (err) {
      console.error("Error getting categories:", err);
      res.status(500).json({ error: "Failed to get categories" });
    }
  }
);

// Save category (admin/author)
router.post(
  "/categories",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { name, color } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Name required" });
      }
      const category = saveCategory(name, color);
      const allCategories = getCategories();
      res.json({ success: true, category, categories: allCategories });
    } catch (err) {
      console.error("Error saving category:", err);
      res.status(500).json({ error: "Failed to save category" });
    }
  }
);

// Update category (admin/author)
router.put(
  "/categories",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { categoryId, name, color } = req.body;
      if (!categoryId || !name) {
        return res.status(400).json({ error: "Category ID and name required" });
      }
      const category = updateCategory(categoryId, name, color);
      if (!category) {
        return res.status(404).json({ error: "Category not found" });
      }
      const allCategories = getCategories();
      res.json({ success: true, category, categories: allCategories });
    } catch (err) {
      console.error("Error updating category:", err);
      res.status(500).json({ error: "Failed to update category" });
    }
  }
);

// Delete category (admin/author)
router.delete(
  "/categories/:id",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const ok = deleteCategory(id);
      if (!ok) return res.status(404).json({ error: "Category not found" });
      const allCategories = getCategories();
      res.json({ success: true, categories: allCategories });
    } catch (err) {
      console.error("Error deleting category:", err);
      res.status(500).json({ error: "Failed to delete category" });
    }
  }
);

// ============ Recycle Bin Routes ============

// Get all recycle bin items
router.get(
  "/recycle-bin",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const items = getRecycleBin();
      res.json({ success: true, items });
    } catch (err) {
      console.error("Error getting recycle bin:", err);
      res.status(500).json({ error: "Failed to get recycle bin" });
    }
  }
);

// Restore item from recycle bin to ads
router.post(
  "/recycle-bin/:id/restore",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const result = restoreFromRecycleBin(id);
      if (!result.success) {
        return res.status(404).json({ error: result.error });
      }
      res.json({ success: true, ad: result.ad });
    } catch (err) {
      console.error("Error restoring from recycle bin:", err);
      res.status(500).json({ error: "Failed to restore item" });
    }
  }
);

// Delete item from recycle bin permanently
router.delete(
  "/recycle-bin/:id",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const ok = deleteFromRecycleBin(id);
      if (!ok) {
        return res.status(404).json({ error: "Item not found" });
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting from recycle bin:", err);
      res.status(500).json({ error: "Failed to delete item" });
    }
  }
);

// Empty entire recycle bin
router.delete(
  "/recycle-bin",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      emptyRecycleBin();
      res.json({ success: true });
    } catch (err) {
      console.error("Error emptying recycle bin:", err);
      res.status(500).json({ error: "Failed to empty recycle bin" });
    }
  }
);

// ============ Settings Routes ============

// Get settings
router.get("/settings", authenticateToken, (req, res) => {
  try {
    const settings = getSettings();
    res.json({ success: true, settings });
  } catch (err) {
    console.error("Error getting settings:", err);
    res.status(500).json({ error: "Failed to get settings" });
  }
});

// Get API keys status
router.get("/api-keys/status", authenticateToken, (req, res) => {
  try {
    const status = getApiKeysStatus();
    res.json({ success: true, status });
  } catch (err) {
    console.error("Error getting API keys status:", err);
    res.status(500).json({ error: "Failed to get API keys status" });
  }
});

// Update settings (admin and author)
router.put(
  "/settings",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const {
        recycleBinDays,
        geminiApiKeys,
        wordpressUrl,
        wordpressUsername,
        wordpressPassword,
        autoApproveWordPress,
        categoryLimits,
        excludedGroups,
        hasakFooter,
        masaakFooter,
      } = req.body;
      const updates = {};

      if (recycleBinDays !== undefined) {
        const days = parseInt(recycleBinDays, 10);
        if (isNaN(days) || days < 1 || days > 365) {
          return res.status(400).json({
            error: "recycleBinDays must be between 1 and 365",
          });
        }
        updates.recycleBinDays = days;
      }

      if (wordpressUrl !== undefined) {
        updates.wordpressUrl = wordpressUrl;
      }

      if (wordpressUsername !== undefined) {
        updates.wordpressUsername = wordpressUsername;
      }

      if (wordpressPassword !== undefined) {
        updates.wordpressPassword = wordpressPassword;
      }

      if (autoApproveWordPress !== undefined) {
        if (typeof autoApproveWordPress !== "boolean") {
          return res.status(400).json({
            error: "autoApproveWordPress must be a boolean",
          });
        }
        updates.autoApproveWordPress = autoApproveWordPress;
      }

      if (geminiApiKeys !== undefined) {
        // Validate API keys array
        if (!Array.isArray(geminiApiKeys)) {
          return res
            .status(400)
            .json({ error: "geminiApiKeys must be an array" });
        }
        updates.geminiApiKeys = geminiApiKeys;
      }

      if (excludedGroups !== undefined) {
        // Validate excluded groups array
        if (!Array.isArray(excludedGroups)) {
          return res
            .status(400)
            .json({ error: "excludedGroups must be an array" });
        }
        updates.excludedGroups = excludedGroups;
      }

      // Validate and update footer settings
      if (hasakFooter !== undefined) {
        if (typeof hasakFooter !== "string") {
          return res.status(400).json({ error: "hasakFooter must be a string" });
        }
        updates.hasakFooter = hasakFooter;
      }

      if (masaakFooter !== undefined) {
        if (typeof masaakFooter !== "string") {
          return res.status(400).json({ error: "masaakFooter must be a string" });
        }
        updates.masaakFooter = masaakFooter;
      }

      if (categoryLimits !== undefined) {
        // Validate category limits array
        if (!Array.isArray(categoryLimits)) {
          return res
            .status(400)
            .json({ error: "categoryLimits must be an array" });
        }
        // Validate each limit object
        for (const limit of categoryLimits) {
          if (!limit.category || typeof limit.category !== "string") {
            return res
              .status(400)
              .json({ error: "Each category limit must have a category name" });
          }
          if (
            !limit.maxAds ||
            typeof limit.maxAds !== "number" ||
            limit.maxAds < 1
          ) {
            return res.status(400).json({
              error: "Each category limit must have a valid maxAds number",
            });
          }
          if (
            limit.enabled !== undefined &&
            typeof limit.enabled !== "boolean"
          ) {
            return res.status(400).json({ error: "enabled must be a boolean" });
          }
        }
        updates.categoryLimits = categoryLimits;
      }

      updateSettings(updates);
      res.json({ success: true, settings: getSettings() });
    } catch (err) {
      console.error("Error updating settings:", err);
      res.status(500).json({ error: "Failed to update settings" });
    }
  }
);

// Post ad to WordPress
router.post(
  "/ads/:id/post-to-wordpress",
  authenticateToken,
  async (req, res) => {
    try {
      const { id } = req.params;
      const fs = require("fs");
      const path = require("path");
      const adsFilePath = path.join(__dirname, "..", "data", "ads.json");

      // Read fresh data from file
      const adsData = JSON.parse(fs.readFileSync(adsFilePath, "utf8"));
      const adsArray = Array.isArray(adsData) ? adsData : adsData.ads || [];
      const ad = adsArray.find((a) => a.id === id);

      if (!ad) {
        return res.status(404).json({ error: "Ad not found" });
      }

      // Get WordPress data and preview flag from request
      let wpData = req.body && req.body.wpData ? req.body.wpData : null;
      const previewOnly = req.body && req.body.preview === true;

      // Get WhatsApp socket for image download
      const sock = req.app.get("whatsappSock");

      console.log("\n🔵🔵🔵 WORDPRESS POSTING STARTED 🔵🔵🔵");
      console.log("Ad ID:", ad.id);
      console.log("Preview Only:", previewOnly);
      console.log("🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵🔵\n");

      // Use the reusable function
      const result = await postAdToWordPress(ad, sock, wpData, previewOnly);

      // After successfully posting (not preview), check for matches with client requests
      if (!previewOnly && result.success && result.wordpressPost) {
        console.log("\n🔍 CHECKING FOR CLIENT MATCHES 🔍");

        try {
          const propertyMatchingService = require("../services/propertyMatchingService");

          // Format the offer for matching
          const formattedOffer = {
            id: result.wordpressPost.id,
            title: {
              rendered:
                result.wordpressPost.title || ad.wpData?.title?.rendered || "",
            },
            link: result.wordpressPost.link || "",
            meta: ad.wpData?.meta || {},
          };

          // Check against active client requests
          const matches =
            propertyMatchingService.checkOfferAgainstRequests(formattedOffer);

          if (matches.length > 0) {
            console.log(
              `📨 Found ${matches.length} matching client(s)! Sending notifications...`
            );

            // Send notifications to matched clients (Background with 300s delay)
            propertyMatchingService.processMatchesInBackground(sock, matches);

            console.log(
              `✅ Matching complete: ${matches.length} notification(s) queued for background delivery`
            );
          } else {
            console.log("ℹ️  No matching clients found for this offer");
          }
        } catch (matchError) {
          console.error("❌ Error during matching:", matchError.message);
          // Don't fail the whole request if matching fails
        }

        console.log("🔍🔍🔍🔍🔍🔍🔍🔍🔍🔍🔍🔍🔍🔍🔍\n");
      }

      res.json(result);
    } catch (err) {
      console.error("Error posting to WordPress:", err);
      res.status(500).json({
        error: "Failed to post to WordPress",
        details: err.response?.data?.message || err.message,
      });
    }
  }
);

// Get analytics data (accessible to all authenticated users)
// Analytics cache (5 seconds TTL)
let analyticsCache = null;
let analyticsCacheTime = 0;
const ANALYTICS_CACHE_TTL = 5000; // 5 seconds

router.get("/analytics", authenticateToken, async (req, res) => {
  try {
    // Return cached data if still valid
    const now = Date.now();
    if (analyticsCache && now - analyticsCacheTime < ANALYTICS_CACHE_TTL) {
      return res.json(analyticsCache);
    }

    const ads = getFetchedAds();
    const recycleBin = getRecycleBin();
    const groups = await getGroupsWithMetadata(); // await the async function
    const categories = getCategories();
    const queueStats = messageQueue.getStats();

    // Ensure groups is an array
    const groupsArray = Array.isArray(groups) ? groups : [];

    // Calculate statistics (optimized with single pass)
    let totalAds = 0;
    let newAds = 0;
    let acceptedAds = 0;
    let rejectedAds = 0;
    let postedAds = 0;
    const propertyTypes = {};
    const groupStats = {};
    const dailyStats = {};

    // Initialize daily stats for last 7 days
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split("T")[0];
      dailyStats[dateKey] = {
        date: dateKey,
        total: 0,
        accepted: 0,
        rejected: 0,
        posted: 0,
      };
    }

    // Single pass through ads for all calculations
    ads.forEach((ad) => {
      totalAds++;

      // Count by status
      if (ad.status === "new") newAds++;
      else if (ad.status === "accepted") acceptedAds++;
      else if (ad.status === "rejected") rejectedAds++;
      else if (ad.status === "posted") postedAds++;

      // Property type distribution
      const type = ad.category || "غير محدد";
      propertyTypes[type] = (propertyTypes[type] || 0) + 1;

      // Group statistics
      const group = ad.fromGroupName || ad.fromGroup || "Unknown";
      if (!groupStats[group]) {
        groupStats[group] = {
          name: group,
          total: 0,
          accepted: 0,
          rejected: 0,
          posted: 0,
        };
      }
      groupStats[group].total++;
      if (ad.status === "accepted") groupStats[group].accepted++;
      if (ad.status === "rejected") groupStats[group].rejected++;
      if (ad.status === "posted") groupStats[group].posted++;

      // Daily statistics
      if (ad.receivedAt) {
        const adDate = new Date(ad.receivedAt).toISOString().split("T")[0];
        if (dailyStats[adDate]) {
          dailyStats[adDate].total++;
          if (ad.status === "accepted") dailyStats[adDate].accepted++;
          if (ad.status === "rejected") dailyStats[adDate].rejected++;
          if (ad.status === "posted") dailyStats[adDate].posted++;
        }
      }
    });

    // Category statistics (optimized)
    const categoryStats = {};
    categories.forEach((cat) => {
      categoryStats[cat.name] = {
        name: cat.name,
        color: cat.color,
        count: 0,
        accepted: 0,
        posted: 0,
      };
    });

    // Count ads by category in single pass
    ads.forEach((ad) => {
      if (ad.category && categoryStats[ad.category]) {
        categoryStats[ad.category].count++;
        if (ad.status === "accepted") categoryStats[ad.category].accepted++;
        if (ad.status === "posted") categoryStats[ad.category].posted++;
      }
    });

    // Recent activity (last 10 ads) - optimized sort
    const recentAds = ads
      .slice(0, 100) // Only check recent 100 ads for performance
      .sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0))
      .slice(0, 10)
      .map((ad) => ({
        id: ad.id,
        category: ad.category,
        status: ad.status,
        fromGroup: ad.fromGroupName || ad.fromGroup,
        receivedAt: ad.receivedAt,
        preview: ad.text ? ad.text.substring(0, 100) : "",
      }));

    const responseData = {
      success: true,
      analytics: {
        summary: {
          totalAds,
          newAds,
          acceptedAds,
          rejectedAds,
          postedAds,
          totalGroups: groupsArray.length,
          activeGroups: groupsArray.filter((g) => g.enabled).length,
          recycleBinCount: recycleBin.length,
        },
        propertyTypes,
        groupStats: Object.values(groupStats).sort((a, b) => b.total - a.total),
        dailyStats: Object.values(dailyStats),
        categoryStats: Object.values(categoryStats),
        recentAds,
        queueStats,
      },
    };

    // Cache the response
    analyticsCache = responseData;
    analyticsCacheTime = now;

    res.json(responseData);
  } catch (error) {
    console.error("Error getting analytics:", error);
    res.status(500).json({ error: "Failed to get analytics" });
  }
});

// ============================================
// MARKETING SYSTEM ENDPOINTS
// ============================================
const userSession = require("../models/userSession");
const marketingService = require("../services/marketingService");

// Get all active marketing sessions
router.get("/marketing/sessions", authenticateToken, (req, res) => {
  try {
    const sessions = userSession.getAllSessions();
    const sessionList = Object.values(sessions);

    // Calculate statistics
    const stats = {
      totalSessions: sessionList.length,
      activeSessions: sessionList.filter((s) => s.state === "collecting")
        .length,
      completedSessions: sessionList.filter((s) => s.state === "completed")
        .length,
      idleSessions: sessionList.filter((s) => s.state === "idle").length,
    };

    res.json({
      success: true,
      sessions: sessionList,
      stats,
    });
  } catch (error) {
    console.error("Error getting marketing sessions:", error);
    res.status(500).json({ error: "Failed to get marketing sessions" });
  }
});

// Get specific user session
router.get("/marketing/sessions/:userId", authenticateToken, (req, res) => {
  try {
    const { userId } = req.params;
    const session = userSession.getSession(userId);

    res.json({
      success: true,
      session,
    });
  } catch (error) {
    console.error("Error getting user session:", error);
    res.status(500).json({ error: "Failed to get user session" });
  }
});

// Clear a specific user session
router.delete("/marketing/sessions/:userId", authenticateToken, (req, res) => {
  try {
    const { userId } = req.params;
    userSession.clearSession(userId);

    res.json({
      success: true,
      message: "Session cleared successfully",
    });
  } catch (error) {
    console.error("Error clearing session:", error);
    res.status(500).json({ error: "Failed to clear session" });
  }
});

// Mark ad as sent to groups
router.post("/ads/:id/mark-sent", authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    const { selectedGroups } = req.body;
    const fs = require("fs");
    const path = require("path");
    const adsFilePath = path.join(__dirname, "..", "data", "ads.json");

    // Read and update ads data
    const adsData = JSON.parse(fs.readFileSync(adsFilePath, "utf8"));
    const adsArray = Array.isArray(adsData) ? adsData : adsData.ads || [];
    const adIndex = adsArray.findIndex((a) => a.id === id);

    if (adIndex === -1) {
      return res.status(404).json({ error: "Ad not found" });
    }

    // Update the ad with sent status
    adsArray[adIndex].selectedGroups = selectedGroups || [];
    adsArray[adIndex].postedToGroups = true;
    adsArray[adIndex].sentAt = new Date().toISOString();

    // Save back to file
    fs.writeFileSync(
      adsFilePath,
      JSON.stringify(
        Array.isArray(adsData) ? adsArray : { ads: adsArray },
        null,
        2
      )
    );

    // IMPORTANT: Also update the in-memory ads array
    const inMemoryAds = getFetchedAds();
    const inMemoryIndex = inMemoryAds.findIndex((a) => a.id === id);
    if (inMemoryIndex !== -1) {
      inMemoryAds[inMemoryIndex].selectedGroups = selectedGroups || [];
      inMemoryAds[inMemoryIndex].postedToGroups = true;
      inMemoryAds[inMemoryIndex].sentAt = new Date().toISOString();
      console.log("✅ Updated in-memory ad:", id);
    }

    res.json({
      success: true,
      message: "Ad marked as sent successfully",
    });
  } catch (error) {
    console.error("Error marking ad as sent:", error);
    res.status(500).json({ error: "Failed to mark ad as sent" });
  }
});

// Test marketing search with custom data
router.post("/marketing/search", authenticateToken, (req, res) => {
  try {
    const searchData = req.body;
    const results = marketingService.searchAds(searchData);
    const message = marketingService.generateResultsMessage(
      results,
      searchData
    );

    res.json({
      success: true,
      results,
      message,
      count: results.length,
    });
  } catch (error) {
    console.error("Error testing marketing search:", error);
    res.status(500).json({ error: "Failed to test marketing search" });
  }
});

// Get marketing analytics
router.get("/marketing/analytics", authenticateToken, (req, res) => {
  try {
    const sessions = userSession.getAllSessions();
    const sessionList = Object.values(sessions);

    // Calculate detailed analytics
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const last7d = now - 7 * 24 * 60 * 60 * 1000;

    const analytics = {
      overview: {
        totalSessions: sessionList.length,
        activeSessions: sessionList.filter((s) => s.state === "collecting")
          .length,
        completedToday: sessionList.filter(
          (s) => s.state === "completed" && s.updatedAt >= last24h
        ).length,
        completedWeek: sessionList.filter(
          (s) => s.state === "completed" && s.updatedAt >= last7d
        ).length,
      },
      propertyTypes: {},
      locations: {},
      priceRanges: {
        "0-500k": 0,
        "500k-1m": 0,
        "1m-2m": 0,
        "2m+": 0,
      },
      conversionRate: 0,
    };

    // Analyze property types
    sessionList.forEach((session) => {
      if (session.data.propertyType) {
        analytics.propertyTypes[session.data.propertyType] =
          (analytics.propertyTypes[session.data.propertyType] || 0) + 1;
      }

      if (session.data.location) {
        analytics.locations[session.data.location] =
          (analytics.locations[session.data.location] || 0) + 1;
      }

      // Price ranges
      if (session.data.priceMax) {
        if (session.data.priceMax <= 500000) {
          analytics.priceRanges["0-500k"]++;
        } else if (session.data.priceMax <= 1000000) {
          analytics.priceRanges["500k-1m"]++;
        } else if (session.data.priceMax <= 2000000) {
          analytics.priceRanges["1m-2m"]++;
        } else {
          analytics.priceRanges["2m+"]++;
        }
      }
    });

    // Calculate conversion rate
    const totalStarted = sessionList.length;
    const totalCompleted = sessionList.filter(
      (s) => s.state === "completed"
    ).length;
    analytics.conversionRate =
      totalStarted > 0 ? ((totalCompleted / totalStarted) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      analytics,
    });
  } catch (error) {
    console.error("Error getting marketing analytics:", error);
    res.status(500).json({ error: "Failed to get marketing analytics" });
  }
});

// Clean old sessions manually
router.post("/marketing/cleanup", authenticateToken, (req, res) => {
  try {
    userSession.cleanOldSessions();

    res.json({
      success: true,
      message: "Old sessions cleaned successfully",
    });
  } catch (error) {
    console.error("Error cleaning sessions:", error);
    res.status(500).json({ error: "Failed to clean sessions" });
  }
});

// ============================================
// PRIVATE CLIENTS ENDPOINTS
// ============================================
const privateClient = require("../models/privateClient");

// Get all private clients with filtering and sorting
router.get(
  "/private-clients",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { role, sortBy, search } = req.query;

      let clients = privateClient.getAllClients();

      // Convert object to array
      let clientsArray = Object.entries(clients).map(([phone, data]) => ({
        phoneNumber: phone,
        ...data,
      }));

      // Filter by role if specified
      if (role && role !== "all") {
        clientsArray = clientsArray.filter((c) => c.role === role);
      }

      // Search by name or phone
      if (search && search.trim()) {
        const searchLower = search.toLowerCase().trim();
        clientsArray = clientsArray.filter(
          (c) =>
            c.name?.toLowerCase().includes(searchLower) ||
            c.phoneNumber?.includes(searchLower)
        );
      }

      // Sort
      switch (sortBy) {
        case "name":
          clientsArray.sort((a, b) =>
            (a.name || "").localeCompare(b.name || "")
          );
          break;
        case "recent":
          clientsArray.sort(
            (a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)
          );
          break;
        case "oldest":
          clientsArray.sort(
            (a, b) => (a.lastActivity || 0) - (b.lastActivity || 0)
          );
          break;
        default:
          clientsArray.sort(
            (a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)
          );
      }

      // Calculate statistics
      const stats = {
        total: clientsArray.length,
        byRole: {
          باحث: clientsArray.filter((c) => c.role === "باحث").length,
          مالك: clientsArray.filter((c) => c.role === "مالك").length,
          مستثمر: clientsArray.filter((c) => c.role === "مستثمر").length,
          وسيط: clientsArray.filter((c) => c.role === "وسيط").length,
        },
        byState: {
          initial: clientsArray.filter((c) => c.state === "initial").length,
          awaiting_name: clientsArray.filter((c) => c.state === "awaiting_name")
            .length,
          awaiting_role: clientsArray.filter((c) => c.state === "awaiting_role")
            .length,
          completed: clientsArray.filter((c) => c.state === "completed").length,
        },
        recentActivity: clientsArray.filter((c) => {
          const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
          return c.lastActivity && c.lastActivity > oneDayAgo;
        }).length,
      };

      res.json({
        success: true,
        clients: clientsArray,
        stats,
      });
    } catch (error) {
      console.error("Error getting private clients:", error);
      res.status(500).json({ error: "Failed to get private clients" });
    }
  }
);

// Get specific client details
router.get(
  "/private-clients/:phoneNumber",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { phoneNumber } = req.params;
      const client = privateClient.getClient(phoneNumber);

      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      res.json({
        success: true,
        client: {
          phoneNumber,
          ...client,
        },
      });
    } catch (error) {
      console.error("Error getting client details:", error);
      res.status(500).json({ error: "Failed to get client details" });
    }
  }
);

// Delete a client
router.delete(
  "/private-clients/:phoneNumber",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { phoneNumber } = req.params;
      privateClient.clearClient(phoneNumber);

      res.json({
        success: true,
        message: "Client deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting client:", error);
      res.status(500).json({ error: "Failed to delete client" });
    }
  }
);

// Update a client
router.put(
  "/private-clients/:phoneNumber",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { phoneNumber } = req.params;
      const { name, role, state, requirements, propertyOffer, newPhoneNumber, requests } = req.body;

      // Get existing client
      const existingClient = privateClient.getClient(phoneNumber);
      if (!existingClient) {
        return res.status(404).json({ error: "Client not found" });
      }

      let targetPhone = phoneNumber;

      // Handle phone number change
      if (newPhoneNumber && newPhoneNumber !== phoneNumber) {
        // Normalize the new phone number (remove non-digits except leading +)
        const normalizedNewPhone = newPhoneNumber.replace(/[^\d]/g, "");
        
        if (!normalizedNewPhone || normalizedNewPhone.length < 10) {
          return res.status(400).json({ error: "Invalid phone number format" });
        }

        const result = privateClient.changeClientPhone(phoneNumber, normalizedNewPhone);
        if (!result) {
          // Check if it's because new phone exists
          const existingNew = privateClient.getClient(normalizedNewPhone);
          if (existingNew && existingNew.createdAt) {
            return res.status(400).json({ error: "Phone number already exists for another client" });
          }
          return res.status(400).json({ error: "Failed to change phone number" });
        }
        targetPhone = normalizedNewPhone;
      }

      // Build update object
      const updateData = {
        lastUpdated: Date.now(),
      };

      if (name !== undefined) updateData.name = name;
      if (role !== undefined) updateData.role = role;
      if (state !== undefined) updateData.state = state;
      if (requirements !== undefined) updateData.requirements = requirements;
      if (propertyOffer !== undefined) updateData.propertyOffer = propertyOffer;
      
      // NEW: Support for multiple requests array
      if (requests !== undefined && Array.isArray(requests)) {
        updateData.requests = requests;
        console.log(`📋 Updating ${requests.length} requests for client ${targetPhone}`);
      }

      // Update client
      privateClient.updateClient(targetPhone, updateData);

      res.json({
        success: true,
        message: newPhoneNumber && newPhoneNumber !== phoneNumber 
          ? "Client updated and phone number changed successfully" 
          : "Client updated successfully",
        client: privateClient.getClient(targetPhone),
        phoneChanged: newPhoneNumber && newPhoneNumber !== phoneNumber,
        newPhoneNumber: targetPhone,
      });
    } catch (error) {
      console.error("Error updating client:", error);
      res.status(500).json({ error: "Failed to update client" });
    }
  }
);

// ========================================
// 📊 DAILY SUMMARY ENDPOINTS
// ========================================

// Get daily summaries
router.get("/daily-summaries", authenticateToken, (req, res) => {
  try {
    const {
      getSummaries,
      getSummaryByDate,
      getSummaryStats,
    } = require("../services/dailySummaryService");

    const { date } = req.query;

    if (date) {
      const summaries = getSummaryByDate(date);
      res.json({ success: true, summaries, date });
    } else {
      const summaries = getSummaries();
      const stats = getSummaryStats();
      res.json({ success: true, summaries, stats });
    }
  } catch (error) {
    console.error("Error getting daily summaries:", error);
    res.status(500).json({ error: "Failed to get daily summaries" });
  }
});

// Manually trigger daily summary
router.post("/daily-summaries/trigger", authenticateToken, async (req, res) => {
  try {
    const {
      generateDailySummaries,
      getSummaries,
      saveSummaries,
    } = require("../services/dailySummaryService");

    // Support filtering by website and/or category
    const { website, category } = req.body;
    const filters = {};
    if (website) filters.website = website;
    if (category) filters.category = category;

    // Generate summaries with optional filters
    const newSummaries = generateDailySummaries(filters);

    if (newSummaries.length === 0) {
      return res.json({
        success: true,
        message: "No ads found for the specified criteria",
        count: 0,
        filters,
      });
    }

    console.log(`📊 Generated ${newSummaries.length} daily summaries`);

    const results = newSummaries.map((s) => ({
      category: s.categoryName,
      website: s.website,
      adsCount: s.adsCount,
    }));

    // Save summaries to file
    const allSummaries = getSummaries();
    allSummaries.unshift(...newSummaries);

    // Keep only last 5 days - group by date and keep only 5 unique dates
    const uniqueDates = [...new Set(allSummaries.map((s) => s.date))];
    const last5Dates = uniqueDates.slice(0, 5);
    const filtered = allSummaries.filter((s) => last5Dates.includes(s.date));

    saveSummaries(filtered);
    console.log(`💾 Saved ${filtered.length} summaries (last 5 days)`);

    res.json({
      success: true,
      count: newSummaries.length,
      summaries: results,
      filters,
    });
  } catch (error) {
    console.error("Error triggering daily summary:", error);
    res.status(500).json({ error: "Failed to trigger daily summary" });
  }
});

// Get scheduler status
router.get(
  "/daily-summaries/scheduler-status",
  authenticateToken,
  (req, res) => {
    try {
      const {
        getSchedulerStatus,
      } = require("../services/dailySummaryScheduler");
      const status = getSchedulerStatus();
      res.json({ success: true, status });
    } catch (error) {
      console.error("Error getting scheduler status:", error);
      res.status(500).json({ error: "Failed to get scheduler status" });
    }
  }
);

// =====================================
// SMART SUMMARY ENDPOINTS
// =====================================

// Get available filter options for smart summary
router.get("/daily-summaries/available-filters", authenticateToken, (req, res) => {
  try {
    const { getAvailableFilters } = require("../services/dailySummaryService");
    const filters = getAvailableFilters();
    res.json({ success: true, filters });
  } catch (error) {
    console.error("Error getting available filters:", error);
    res.status(500).json({ error: "Failed to get available filters" });
  }
});

// Preview custom summary (get count and sample before generating)
router.post("/daily-summaries/preview", authenticateToken, (req, res) => {
  try {
    const { previewCustomSummary } = require("../services/dailySummaryService");
    const filters = req.body;
    const preview = previewCustomSummary(filters);
    res.json({ success: true, preview });
  } catch (error) {
    console.error("Error previewing custom summary:", error);
    res.status(500).json({ error: "Failed to preview summary" });
  }
});

// Generate custom summary with advanced filters
router.post("/daily-summaries/generate-custom", authenticateToken, async (req, res) => {
  try {
    const {
      generateCustomSummary,
      getSummaries,
      saveSummaries,
    } = require("../services/dailySummaryService");

    const filters = req.body;
    console.log("📊 Generating custom summary with filters:", JSON.stringify(filters, null, 2));

    const result = generateCustomSummary(filters);

    if (!result.success || !result.summary) {
      return res.json({
        success: true,
        count: 0,
        message: result.message || "No ads found matching the selected filters",
      });
    }

    // Save the generated summary
    const allSummaries = getSummaries();
    allSummaries.unshift(result.summary);

    // Keep only last 10 days of summaries
    const uniqueDates = [...new Set(allSummaries.map((s) => s.date))];
    const recentDates = uniqueDates.slice(0, 10);
    const filtered = allSummaries.filter((s) => recentDates.includes(s.date));

    saveSummaries(filtered);
    console.log(`💾 Saved custom summary. Total summaries: ${filtered.length}`);

    res.json({
      success: true,
      count: result.count,
      message: result.message,
      summary: {
        id: result.summary.id,
        website: result.summary.website,
        categoryName: result.summary.categoryName,
        adsCount: result.summary.adsCount,
        createdAt: result.summary.createdAt,
        filters: result.summary.filters,
      },
    });
  } catch (error) {
    console.error("Error generating custom summary:", error);
    res.status(500).json({ error: "Failed to generate custom summary" });
  }
});

// Get subcategories for selected main categories
router.post("/daily-summaries/subcategories", authenticateToken, (req, res) => {
  try {
    const {
      getSubcategoriesForCategories,
    } = require("../services/smartSummaryFilters");

    const { mainCategories, website } = req.body;
    const subcategories = getSubcategoriesForCategories(mainCategories || [], website);

    res.json({ success: true, subcategories });
  } catch (error) {
    console.error("Error getting subcategories:", error);
    res.status(500).json({ error: "Failed to get subcategories" });
  }
});

// Send specific summary to groups
router.post(
  "/daily-summaries/:id/send",
  authenticateToken,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { selectedGroups, customNumbers, delay, customMessage } = req.body;
      const sock = req.app.get("whatsappSock");

      // Check if socket exists
      if (!sock) {
        return res.status(503).json({
          error: "WhatsApp bot not connected",
          message: "Please wait for the bot to connect",
        });
      }

      // Get connection status from bot module
      const { getConnectionStatus } = require("../whatsapp/bot");
      const connStatus = getConnectionStatus();

      // Only check logical connection status, not WebSocket state
      // (WebSocket can temporarily close during session updates)
      if (connStatus !== "connected") {
        return res.status(503).json({
          error: "WhatsApp connection is not ready",
          message: `Current status: ${connStatus}. Please wait for the connection to be established.`,
        });
      }

      const groups = selectedGroups || [];
      const numbers = customNumbers || [];

      if (groups.length === 0 && numbers.length === 0) {
        return res.status(400).json({ error: "No groups or numbers selected" });
      }

      // Get the summary
      const { getSummaries } = require("../services/dailySummaryService");
      const fs = require("fs");
      const path = require("path");

      const summaries = getSummaries();
      const summary = summaries.find((s) => s.id === id);

      if (!summary) {
        return res.status(404).json({ error: "Summary not found" });
      }

      // Allow resending - users may want to send to different groups or resend if failed
      // Removed the check: if (summary.sent) { return res.status(400).json({ error: "Summary already sent" }); }

      // Use custom message if provided, otherwise use the original summary message
      const messageToSend = customMessage || summary.message;

      const delayMs = (delay || 3) * 1000; // Convert seconds to milliseconds
      let sentCount = 0;
      let failedCount = 0;
      const failedRecipients = [];

      // Helper function to send with retry logic
      async function sendWithRetry(recipientId, recipientType, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            // Use bot's sendMessage function instead of sock.sendMessage directly
            // This ensures proper connection validation before sending
            await sendMessage(recipientId, messageToSend);
            return { success: true };
          } catch (error) {
            const errorMsg = error.message || String(error);
            console.log(
              `⚠️ Attempt ${attempt}/${maxRetries} failed for ${recipientType} ${recipientId}: ${errorMsg}`
            );

            // If it's a connection issue and we have retries left, wait and try again
            if (
              attempt < maxRetries &&
              (errorMsg.includes("Connection Closed") ||
                errorMsg.includes("connection") ||
                errorMsg.includes("session"))
            ) {
              // Wait before retry (exponential backoff)
              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * attempt)
              );
              continue;
            }

            // Last attempt failed or non-retryable error
            return { success: false, error: errorMsg };
          }
        }
      }

      // Send to selected groups
      for (const groupId of groups) {
        const result = await sendWithRetry(groupId, "group");

        if (result.success) {
          sentCount++;
          console.log(`✅ Sent summary to group: ${groupId}`);
        } else {
          failedCount++;
          failedRecipients.push({
            type: "group",
            id: groupId,
            error: result.error,
          });
          console.error(
            `❌ Failed to send to group ${groupId} after retries: ${result.error}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      // Send to custom numbers
      for (const phone of numbers) {
        const formattedPhone = phone.replace(/\D/g, ""); // Remove non-digits
        const jid = `${formattedPhone}@s.whatsapp.net`;

        const result = await sendWithRetry(jid, "number");

        if (result.success) {
          sentCount++;
          console.log(`✅ Sent summary to number: ${phone}`);
        } else {
          failedCount++;
          failedRecipients.push({
            type: "number",
            id: phone,
            error: result.error,
          });
          console.error(
            `❌ Failed to send to number ${phone} after retries: ${result.error}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      // Update summary as sent (if at least one recipient received it)
      const summaryIndex = summaries.findIndex((s) => s.id === id);
      if (summaryIndex !== -1 && sentCount > 0) {
        summaries[summaryIndex].sent = true;
        summaries[summaryIndex].sentAt = new Date().toISOString();
        summaries[summaryIndex].sentToGroups = groups;
        summaries[summaryIndex].sentToNumbers = numbers;
        summaries[summaryIndex].sendStats = {
          sentCount,
          failedCount,
          totalRecipients: groups.length + numbers.length,
        };

        // Save back to file
        const SUMMARY_FILE = path.join(
          __dirname,
          "..",
          "data",
          "daily_summaries.json"
        );
        fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summaries, null, 2));
      }

      const totalRecipients = groups.length + numbers.length;
      let message = `Summary sent to ${sentCount} of ${totalRecipients} recipient(s)`;

      if (failedCount > 0) {
        message += ` (${failedCount} failed)`;

        // Log detailed failure information
        console.log("\n📊 Failed Recipients Summary:");
        failedRecipients.forEach(({ type, id, error }) => {
          console.log(`   ❌ ${type}: ${id} - ${error}`);
        });
      }

      res.json({
        success: sentCount > 0, // Success if at least one message was sent
        message,
        sentCount,
        failedCount,
        totalRecipients,
        failedRecipients: failedCount > 0 ? failedRecipients : undefined,
      });
    } catch (error) {
      console.error("Error sending summary:", error);
      res.status(500).json({
        error: "Failed to send summary",
        details: error.message || String(error),
      });
    }
  }
);

// ============================================
// INTEREST GROUPS ENDPOINTS
// ============================================
const interestGroupService = require("../services/interestGroupService");

// Get all interest groups
router.get(
  "/interest-groups",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const groups = interestGroupService.getAllGroups();
      res.json({
        success: true,
        groups,
        count: groups.length,
      });
    } catch (error) {
      console.error("Error getting interest groups:", error);
      res.status(500).json({ error: "Failed to get interest groups" });
    }
  }
);

// Get specific interest group
router.get(
  "/interest-groups/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const group = interestGroupService.getGroup(id);

      if (!group) {
        return res.status(404).json({ error: "Interest group not found" });
      }

      res.json({
        success: true,
        group,
      });
    } catch (error) {
      console.error("Error getting interest group:", error);
      res.status(500).json({ error: "Failed to get interest group" });
    }
  }
);

// Delete interest group
router.delete(
  "/interest-groups/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await interestGroupService.deleteGroup(id);

      if (!deleted) {
        return res.status(404).json({ error: "Interest group not found" });
      }

      res.json({
        success: true,
        message: "Interest group deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting interest group:", error);
      res.status(500).json({ error: "Failed to delete interest group" });
    }
  }
);

// ========== REMINDER MANAGEMENT API ==========
const reminderService = require("../services/adminCommandService");

// Get all reminders (with optional filtering)
router.get(
  "/reminders",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { status, page = 1, limit = 20 } = req.query;
      let reminders = reminderService.getAllReminders();

      // Filter by status if provided
      if (status && status !== "all") {
        reminders = reminders.filter((r) => r.status === status);
      }

      // Sort by scheduledDateTime (most recent first)
      reminders.sort((a, b) => b.scheduledDateTime - a.scheduledDateTime);

      // Calculate stats
      const stats = {
        total: reminderService.getAllReminders().length,
        pending: reminderService.getAllReminders().filter((r) => r.status === "pending").length,
        sent: reminderService.getAllReminders().filter((r) => r.status === "sent").length,
        failed: reminderService.getAllReminders().filter((r) => r.status === "failed").length,
      };

      // Pagination
      const totalItems = reminders.length;
      const totalPages = Math.ceil(totalItems / limit);
      const currentPage = parseInt(page);
      const startIndex = (currentPage - 1) * limit;
      const paginatedReminders = reminders.slice(startIndex, startIndex + parseInt(limit));

      res.json({
        success: true,
        reminders: paginatedReminders,
        stats,
        pagination: {
          currentPage,
          totalPages,
          totalItems,
          limit: parseInt(limit),
          hasMore: currentPage < totalPages,
        },
      });
    } catch (error) {
      console.error("Error getting reminders:", error);
      res.status(500).json({ error: "Failed to get reminders" });
    }
  }
);

// Get single reminder by ID
router.get(
  "/reminders/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const reminder = reminderService.getReminderById(id);

      if (!reminder) {
        return res.status(404).json({ error: "Reminder not found" });
      }

      res.json({
        success: true,
        reminder,
      });
    } catch (error) {
      console.error("Error getting reminder:", error);
      res.status(500).json({ error: "Failed to get reminder" });
    }
  }
);

// Create new reminder
router.post(
  "/reminders",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { targetNumber, name, scheduledDateTime, message } = req.body;

      if (!targetNumber || !scheduledDateTime || !message) {
        return res.status(400).json({
          error: "Missing required fields: targetNumber, scheduledDateTime, message",
        });
      }

      // Validate scheduledDateTime is in the future
      const scheduledTime = new Date(scheduledDateTime).getTime();
      if (scheduledTime <= Date.now()) {
        return res.status(400).json({
          error: "Scheduled time must be in the future",
        });
      }

      // Clean up the phone number
      const cleanNumber = targetNumber.replace(/^\+/, "").replace(/\s/g, "");

      // Create reminder using the service
      const reminder = await reminderService.createReminder(
        req.user.username, // Use authenticated user as creator
        {
          targetNumber: cleanNumber,
          name: name || null, // Optional name field
          scheduledDateTime: scheduledTime,
          message,
          createdAt: Date.now(),
        }
      );

      res.json({
        success: true,
        reminder,
        message: "Reminder created successfully",
      });
    } catch (error) {
      console.error("Error creating reminder:", error);
      res.status(500).json({ error: "Failed to create reminder" });
    }
  }
);

// Update reminder
router.put(
  "/reminders/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { targetNumber, name, scheduledDateTime, message, status } = req.body;

      // Check if reminder exists
      const existing = reminderService.getReminderById(id);
      if (!existing) {
        return res.status(404).json({ error: "Reminder not found" });
      }

      // Prepare updates
      const updates = {};
      if (targetNumber) {
        updates.targetNumber = targetNumber.replace(/^\+/, "").replace(/\s/g, "");
      }
      // Handle name - allow setting to null or a value
      if (name !== undefined) {
        updates.name = name || null;
      }
      if (scheduledDateTime) {
        const scheduledTime = new Date(scheduledDateTime).getTime();
        if (scheduledTime <= Date.now() && status !== "sent" && status !== "failed") {
          return res.status(400).json({
            error: "Scheduled time must be in the future for pending reminders",
          });
        }
        updates.scheduledDateTime = scheduledTime;
      }
      if (message) {
        updates.message = message;
      }
      if (status && ["pending", "sent", "failed"].includes(status)) {
        updates.status = status;
      }

      const updated = await reminderService.updateReminder(id, updates);

      res.json({
        success: true,
        reminder: updated,
        message: "Reminder updated successfully",
      });
    } catch (error) {
      console.error("Error updating reminder:", error);
      res.status(500).json({ error: "Failed to update reminder" });
    }
  }
);

// Delete reminder
router.delete(
  "/reminders/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const deleted = await reminderService.deleteReminder(id);

      if (!deleted) {
        return res.status(404).json({ error: "Reminder not found" });
      }

      res.json({
        success: true,
        message: "Reminder deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting reminder:", error);
      res.status(500).json({ error: "Failed to delete reminder" });
    }
  }
);

// Send follow-up message for a reminder
router.post(
  "/reminders/:id/followup",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { confirm } = req.body; // If true, send even with missing links

      // Get the reminder
      const reminder = reminderService.getReminderById(id);
      if (!reminder) {
        return res.status(404).json({ error: "Reminder not found" });
      }

      // Extract links from the reminder message
      const mapsLinkRegex = /(https?:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps|maps\.google\.com)[^\s]+)/i;
      const websiteLinkRegex = /(https?:\/\/(www\.)?(masaak|hasak)\.com[^\s]+)/i;

      const mapsMatch = reminder.message.match(mapsLinkRegex);
      const websiteMatch = reminder.message.match(websiteLinkRegex);

      const mapsLink = mapsMatch ? mapsMatch[0] : null;
      const websiteLink = websiteMatch ? websiteMatch[0] : null;

      // Determine which site for footer
      const isHasak = websiteLink && websiteLink.includes("hasak.com");
      
      // Client name
      const clientName = reminder.name || "العميل";

      // Generate follow-up message
      let followUpMessage = `السلام عليكم 
${clientName}
بخصوص العقار هذا هل تمت معاينته و بشر هل مناسب لك

`;

      if (websiteLink) {
        followUpMessage += `*✅رابط الاعلان* 
${websiteLink}
`;
      }

      if (mapsLink) {
        followUpMessage += `*📍اللوكيشن للعقار* 
${mapsLink}
`;
      }

      // Add footer based on website
      if (isHasak) {
        followUpMessage += `┈┉🌴 *حساك العقارية* 🌴┅┄
للتواصل عبدالرحمن السليم 0508001475`;
      } else {
        followUpMessage += `┈┉🔰 *مسعاك العقارية* 🔰┅┄
للتواصل عبدالرحمن السليم 0508001475`;
      }

      // Check if links are missing
      const missingLinks = [];
      if (!websiteLink) missingLinks.push("رابط الموقع (masaak/hasak)");
      if (!mapsLink) missingLinks.push("رابط الخريطة (Maps)");

      // If links are missing and not confirmed, return preview
      if (missingLinks.length > 0 && !confirm) {
        return res.json({
          success: true,
          needsConfirmation: true,
          preview: {
            message: followUpMessage,
            missingLinks,
            targetNumber: reminder.targetNumber,
            clientName,
            warning: `⚠️ الروابط التالية غير موجودة في رسالة التذكير الأصلية: ${missingLinks.join("، ")}`,
          },
        });
      }

      // Send the follow-up message
      const targetJid = `${reminder.targetNumber}@s.whatsapp.net`;
      
      // Use custom message if provided (from the edit dialog), otherwise use generated message
      const { customMessage } = req.body;
      const messageToSend = customMessage || followUpMessage;
      
      try {
        await sendMessage(targetJid, messageToSend);

        // Log the follow-up
        console.log(`✅ Follow-up sent for reminder ${id} to +${reminder.targetNumber}`);

        res.json({
          success: true,
          message: "تم إرسال رسالة المتابعة بنجاح",
          sentTo: reminder.targetNumber,
          clientName,
        });
      } catch (sendError) {
        console.error(`❌ Failed to send follow-up for reminder ${id}:`, sendError);
        res.status(500).json({
          error: "فشل إرسال رسالة المتابعة",
          details: sendError.message,
        });
      }
    } catch (error) {
      console.error("Error processing follow-up:", error);
      res.status(500).json({ error: "Failed to process follow-up request" });
    }
  }
);

// ========================================
// CUSTOM MESSAGES AND SCHEDULES (ADMIN ONLY)
// ========================================

const customMessageService = require("../services/customMessageService");
const messageSchedulerService = require("../services/messageSchedulerService");

// --- Custom Messages ---

// List all custom messages
router.get(
  "/custom-messages",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const messages = customMessageService.getAllMessages();
      const variables = customMessageService.getAvailableVariables();

      res.json({
        success: true,
        messages,
        availableVariables: variables,
      });
    } catch (error) {
      console.error("Error fetching custom messages:", error);
      res.status(500).json({ error: "Failed to fetch custom messages" });
    }
  }
);

// Get single custom message
router.get(
  "/custom-messages/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const message = customMessageService.getMessageById(id);

      if (!message) {
        return res.status(404).json({ error: "Message not found" });
      }

      res.json({
        success: true,
        message,
      });
    } catch (error) {
      console.error("Error fetching custom message:", error);
      res.status(500).json({ error: "Failed to fetch custom message" });
    }
  }
);

// Create custom message
router.post(
  "/custom-messages",
  authenticateToken,
  authorizeRole(["admin"]),
  uploadCustomMessageImage.single("image"),
  async (req, res) => {
    try {
      const { name, content, dynamicWords } = req.body;

      if (!name || !content) {
        return res.status(400).json({ error: "Name and content are required" });
      }

      // Validate content
      const validation = customMessageService.validateMessage(content);
      if (!validation.valid) {
        return res.status(400).json({
          error: "Invalid message format",
          details: validation.errors,
        });
      }

      // Parse dynamicWords if it's a string (from FormData)
      let parsedDynamicWords = dynamicWords;
      if (typeof dynamicWords === "string") {
        try {
          parsedDynamicWords = JSON.parse(dynamicWords);
        } catch (e) {
          parsedDynamicWords = {};
        }
      }

      // Get image path if uploaded
      const imagePath = req.file ? req.file.path : null;

      const message = await customMessageService.createMessage(
        { name, content, dynamicWords: parsedDynamicWords, imagePath },
        req.user.username
      );

      res.json({
        success: true,
        message,
      });
    } catch (error) {
      console.error("Error creating custom message:", error);
      res.status(500).json({ error: "Failed to create custom message" });
    }
  }
);

// Update custom message
router.put(
  "/custom-messages/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  uploadCustomMessageImage.single("image"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, content, dynamicWords, removeImage } = req.body;

      // Validate content if provided
      if (content) {
        const validation = customMessageService.validateMessage(content);
        if (!validation.valid) {
          return res.status(400).json({
            error: "Invalid message format",
            details: validation.errors,
          });
        }
      }

      // Parse dynamicWords if it's a string (from FormData)
      let parsedDynamicWords = dynamicWords;
      if (typeof dynamicWords === "string") {
        try {
          parsedDynamicWords = JSON.parse(dynamicWords);
        } catch (e) {
          parsedDynamicWords = undefined;
        }
      }

      // Handle image: new upload, removal, or keep existing
      let imagePath = undefined;
      if (req.file) {
        // New image uploaded
        imagePath = req.file.path;
        
        // Delete old image if exists
        const existingMessage = customMessageService.getMessageById(id);
        if (existingMessage?.imagePath && fs.existsSync(existingMessage.imagePath)) {
          try {
            fs.unlinkSync(existingMessage.imagePath);
          } catch (e) {
            console.warn("Could not delete old image:", e.message);
          }
        }
      } else if (removeImage === "true" || removeImage === true) {
        // Remove existing image
        imagePath = null;
        const existingMessage = customMessageService.getMessageById(id);
        if (existingMessage?.imagePath && fs.existsSync(existingMessage.imagePath)) {
          try {
            fs.unlinkSync(existingMessage.imagePath);
          } catch (e) {
            console.warn("Could not delete old image:", e.message);
          }
        }
      }

      const message = await customMessageService.updateMessage(id, {
        name,
        content,
        dynamicWords: parsedDynamicWords,
        imagePath,
      });

      res.json({
        success: true,
        message,
      });
    } catch (error) {
      console.error("Error updating custom message:", error);
      res.status(500).json({ error: error.message || "Failed to update custom message" });
    }
  }
);

// Delete custom message
router.delete(
  "/custom-messages/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      await customMessageService.deleteMessage(id);

      res.json({
        success: true,
        message: "Message deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting custom message:", error);
      res.status(500).json({ error: error.message || "Failed to delete custom message" });
    }
  }
);

// Serve custom message images
router.get(
  "/custom-messages/image/:filename",
  authenticateToken,
  (req, res) => {
    try {
      const { filename } = req.params;
      
      // Security: Only allow alphanumeric, underscore, dash, and dot in filename
      if (!/^[a-zA-Z0-9_\-\.]+$/.test(filename)) {
        return res.status(400).json({ error: "Invalid filename" });
      }
      
      const imagePath = path.join(customMessageImagesDir, filename);
      
      // Check if file exists
      if (!fs.existsSync(imagePath)) {
        return res.status(404).json({ error: "Image not found" });
      }
      
      // Determine content type
      const ext = path.extname(filename).toLowerCase();
      const contentTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';
      
      res.setHeader('Content-Type', contentType);
      res.sendFile(imagePath);
    } catch (error) {
      console.error("Error serving custom message image:", error);
      res.status(500).json({ error: "Failed to serve image" });
    }
  }
);

// Preview custom message with sample data
router.post(
  "/custom-messages/:id/preview",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const sampleData = req.body.sampleData || {};

      const preview = customMessageService.previewMessage(id, sampleData);

      res.json({
        success: true,
        preview,
      });
    } catch (error) {
      console.error("Error previewing message:", error);
      res.status(500).json({ error: error.message || "Failed to preview message" });
    }
  }
);

// Send custom message immediately (manual send)
router.post(
  "/custom-messages/:id/send",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { groups, customNumbers, delaySeconds = 60 } = req.body;

      const message = customMessageService.getMessageById(id);
      if (!message) {
        return res.status(404).json({ error: "Message not found" });
      }

      // Create a temporary schedule-like object for sending
      const tempSchedule = {
        id: `temp_${Date.now()}`,
        messageId: id,
        enabled: true,
        recipients: {
          groups: groups || [],
          customNumbers: customNumbers || [],
        },
        settings: {
          delaySeconds,
          randomizeOrder: false,
        },
      };

      // Use the scheduler service to send
      const result = await messageSchedulerService.executeScheduleNow(tempSchedule.id) || 
        { success: true, message: "Message sending started" };

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error("Error sending custom message:", error);
      res.status(500).json({ error: error.message || "Failed to send custom message" });
    }
  }
);

// --- Schedules ---

// List all schedules
router.get(
  "/schedules",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const schedules = customMessageService.getAllSchedules();
      const schedulerStatus = messageSchedulerService.getSchedulerStatus();

      res.json({
        success: true,
        schedules,
        schedulerStatus,
      });
    } catch (error) {
      console.error("Error fetching schedules:", error);
      res.status(500).json({ error: "Failed to fetch schedules" });
    }
  }
);

// Get single schedule
router.get(
  "/schedules/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const schedule = customMessageService.getScheduleById(id);

      if (!schedule) {
        return res.status(404).json({ error: "Schedule not found" });
      }

      res.json({
        success: true,
        schedule,
      });
    } catch (error) {
      console.error("Error fetching schedule:", error);
      res.status(500).json({ error: "Failed to fetch schedule" });
    }
  }
);

// Create schedule
router.post(
  "/schedules",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { messageId, name, schedule, recipients, settings, enabled } = req.body;

      if (!messageId) {
        return res.status(400).json({ error: "Message ID is required" });
      }

      const newSchedule = await customMessageService.createSchedule(
        { messageId, name, schedule, recipients, settings, enabled },
        req.user.username
      );

      // Register with scheduler
      messageSchedulerService.scheduleMessage(newSchedule);

      res.json({
        success: true,
        schedule: newSchedule,
      });
    } catch (error) {
      console.error("Error creating schedule:", error);
      res.status(500).json({ error: error.message || "Failed to create schedule" });
    }
  }
);

// Update schedule
router.put(
  "/schedules/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { messageId, name, schedule, recipients, settings, enabled } = req.body;

      const updatedSchedule = await customMessageService.updateSchedule(id, {
        messageId,
        name,
        schedule,
        recipients,
        settings,
        enabled,
      });

      // Update scheduler
      messageSchedulerService.reschedule(id);

      res.json({
        success: true,
        schedule: updatedSchedule,
      });
    } catch (error) {
      console.error("Error updating schedule:", error);
      res.status(500).json({ error: error.message || "Failed to update schedule" });
    }
  }
);

// Delete schedule
router.delete(
  "/schedules/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Cancel from scheduler first
      messageSchedulerService.cancelScheduledMessage(id);

      await customMessageService.deleteSchedule(id);

      res.json({
        success: true,
        message: "Schedule deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting schedule:", error);
      res.status(500).json({ error: error.message || "Failed to delete schedule" });
    }
  }
);

// Toggle schedule enabled/disabled
router.post(
  "/schedules/:id/toggle",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const schedule = await customMessageService.toggleSchedule(id);

      // Update scheduler
      messageSchedulerService.reschedule(id);

      res.json({
        success: true,
        schedule,
        message: `Schedule ${schedule.enabled ? "enabled" : "disabled"} successfully`,
      });
    } catch (error) {
      console.error("Error toggling schedule:", error);
      res.status(500).json({ error: error.message || "Failed to toggle schedule" });
    }
  }
);

// Execute schedule immediately
router.post(
  "/schedules/:id/run-now",
  authenticateToken,
  authorizeRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Execute in background
      messageSchedulerService.executeScheduleNow(id).catch((err) => {
        console.error(`Background execution failed for ${id}:`, err);
      });

      res.json({
        success: true,
        message: "Schedule execution started in background",
      });
    } catch (error) {
      console.error("Error executing schedule:", error);
      res.status(500).json({ error: error.message || "Failed to execute schedule" });
    }
  }
);

// Get schedule run history
router.get(
  "/schedules/:id/history",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const schedule = customMessageService.getScheduleById(id);

      if (!schedule) {
        return res.status(404).json({ error: "Schedule not found" });
      }

      res.json({
        success: true,
        history: schedule.runHistory || [],
        lastRun: schedule.lastRun,
        nextRun: schedule.nextRun,
      });
    } catch (error) {
      console.error("Error fetching schedule history:", error);
      res.status(500).json({ error: "Failed to fetch schedule history" });
    }
  }
);

// ========================================================
// SCHEDULED WHATSAPP MESSAGES ENDPOINTS
// Schedule messages for specific date/time
// ========================================================

// Get all scheduled WhatsApp messages
router.get(
  "/scheduled-whatsapp",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const messages = scheduledWhatsappService.getAllScheduledMessages();
      const status = scheduledWhatsappService.getServiceStatus();
      
      res.json({
        success: true,
        messages,
        status,
      });
    } catch (error) {
      console.error("Error getting scheduled messages:", error);
      res.status(500).json({ error: "Failed to get scheduled messages" });
    }
  }
);

// Get pending scheduled WhatsApp messages only
router.get(
  "/scheduled-whatsapp/pending",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const messages = scheduledWhatsappService.getPendingScheduledMessages();
      
      res.json({
        success: true,
        messages,
      });
    } catch (error) {
      console.error("Error getting pending scheduled messages:", error);
      res.status(500).json({ error: "Failed to get pending scheduled messages" });
    }
  }
);

// Get a single scheduled WhatsApp message by ID
router.get(
  "/scheduled-whatsapp/:id",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const message = scheduledWhatsappService.getScheduledMessageById(id);
      
      if (!message) {
        return res.status(404).json({ error: "Scheduled message not found" });
      }
      
      res.json({
        success: true,
        message,
      });
    } catch (error) {
      console.error("Error getting scheduled message:", error);
      res.status(500).json({ error: "Failed to get scheduled message" });
    }
  }
);

// Create a new scheduled WhatsApp message
router.post(
  "/scheduled-whatsapp",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { adId, message, groups, customNumbers, scheduledDate, delaySeconds } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Message content is required" });
      }
      
      if (!scheduledDate) {
        return res.status(400).json({ error: "Scheduled date is required" });
      }
      
      if ((!groups || groups.length === 0) && (!customNumbers || customNumbers.length === 0)) {
        return res.status(400).json({ error: "At least one recipient is required" });
      }
      
      const scheduledMessage = scheduledWhatsappService.createScheduledMessage({
        adId,
        message,
        groups: groups || [],
        customNumbers: customNumbers || [],
        scheduledDate,
        delaySeconds: delaySeconds || 3,
        createdBy: req.user?.username || "unknown",
      });
      
      res.json({
        success: true,
        message: "Message scheduled successfully",
        scheduledMessage,
      });
    } catch (error) {
      console.error("Error creating scheduled message:", error);
      res.status(400).json({ error: error.message || "Failed to schedule message" });
    }
  }
);

// Cancel a scheduled WhatsApp message
router.post(
  "/scheduled-whatsapp/:id/cancel",
  authenticateToken,
  authorizeRole(["admin", "author"]),
  (req, res) => {
    try {
      const { id } = req.params;
      const message = scheduledWhatsappService.cancelScheduledMessage(id);
      
      res.json({
        success: true,
        message: "Scheduled message cancelled",
        scheduledMessage: message,
      });
    } catch (error) {
      console.error("Error cancelling scheduled message:", error);
      res.status(400).json({ error: error.message || "Failed to cancel scheduled message" });
    }
  }
);

// Delete a scheduled WhatsApp message
router.delete(
  "/scheduled-whatsapp/:id",
  authenticateToken,
  authorizeRole(["admin"]),
  (req, res) => {
    try {
      const { id } = req.params;
      scheduledWhatsappService.deleteScheduledMessage(id);
      
      res.json({
        success: true,
        message: "Scheduled message deleted",
      });
    } catch (error) {
      console.error("Error deleting scheduled message:", error);
      res.status(400).json({ error: error.message || "Failed to delete scheduled message" });
    }
  }
);

// Export both the router and the reusable WordPress posting function
module.exports = router;
module.exports.postAdToWordPress = postAdToWordPress;
