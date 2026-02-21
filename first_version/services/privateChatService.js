/**
 * Private Chat Service
 * Handles all private chat conversations with clients
 * Based on the flowchart requirements
 */

const privateClient = require("../models/privateClient");
const { processMessage, validateUserInput } = require("./aiService");
const {
  extractSearchIntent,
  calculateMatchScore,
  getRelevanceLabel,
  expandSearchTerms,
} = require("./semanticSearchHelper");
const masaakSearchService = require("./masaakSearchService");
const deepSearchService = require("./deepSearchService");
const propertyMatchingService = require("./propertyMatchingService");
const path = require("path");
const fs = require("fs");
const https = require("https");
const areaNormalizer = require("./areaNormalizer");

// Request deduplication cache: Map<hash, timestamp>
const recentRequestsCache = new Map();
const CACHE_TTL = 5000; // 5 seconds
const AUTO_POST_FIXED_CATEGORY_IDS = [131];

function normalizeGroupJids(groupIds) {
  if (!Array.isArray(groupIds)) return [];

  return [...new Set(
    groupIds
      .filter((groupId) => typeof groupId === "string")
      .map((groupId) => groupId.trim())
      .filter(Boolean),
  )];
}

function isAutoPostAllowedForGroup(settings, sourceGroupJid) {
  const selectedGroups = normalizeGroupJids(
    settings?.autoApproveWordPressGroups || [],
  );

  // Backwards compatibility: if no groups selected, keep old behavior (allow all)
  if (selectedGroups.length === 0) {
    return true;
  }

  return (
    typeof sourceGroupJid === "string" && selectedGroups.includes(sourceGroupJid)
  );
}

function hasAutoPostGroupSelection(settings) {
  return normalizeGroupJids(settings?.autoApproveWordPressGroups || []).length > 0;
}

function isAutoPostEnabled(settings) {
  return settings?.autoApproveWordPress === true;
}

/**
 * Search WordPress for ads using new custom API
 * @deprecated - Use masaakSearchService.searchWithRequirements instead
 * This function is kept for backward compatibility
 * @param {string} searchQuery - The search term
 * @param {number} page - Page number
 * @param {number} perPage - Results per page (IGNORED)
 * @param {boolean} excludeCategory83 - Whether to exclude category 83 (IGNORED - طلبات excluded by default)
 * @returns {Promise<Array>} Array of matching posts
 */
async function searchWordPress(
  searchQuery,
  page = 1,
  perPage = 20,
  excludeCategory83 = true
) {
  console.log(
    `⚠️ searchWordPress is deprecated. Using new custom API instead.`
  );
  console.log(`🔍 Legacy search called with: "${searchQuery}", page: ${page}`);

  // Use the new API with minimal parameters
  const results = await masaakSearchService.searchMasaak({
    property_type: searchQuery,
    page: page,
  });

  return results.posts.map(masaakSearchService.formatApiResult);
}

/**
 * Deep search using new custom API
 * @deprecated - Use masaakSearchService.searchWithRequirements instead
 * This function is kept for backward compatibility
 * @param {string} searchQuery - The search term
 * @param {Object} requirements - User requirements for term expansion
 * @param {number} maxPages - Maximum pages to search (IGNORED - new API returns all results)
 * @returns {Promise<Array>} Combined array of all matching posts
 */
async function deepSearchWordPress(
  searchQuery,
  requirements = {},
  maxPages = 1500
) {
  console.log(
    `⚠️ deepSearchWordPress is deprecated. Using new custom API instead.`
  );
  console.log(`🔎 Legacy deep search called for: "${searchQuery}"`);

  // Use the new API with requirements
  const results = await masaakSearchService.searchWithRequirements(
    requirements
  );

  return results;
}

/**
 * ENHANCED AI-POWERED PROPERTY SEARCH
 * Search WordPress based on user requirements with intelligent AI scoring
 * Features:
 * - Multi-term expansion with synonyms
 * - Hybrid scoring system (property type 30%, location 25%, price 20%, area 15%, recency 10%)
 * - Dynamic threshold (strict when >10 matches, relaxed when <5)
 * - Guarantees minimum 5 results
 * - Excludes category 83 (طلبات)
 * - Relevance labeling (🟢🟡⚪)
 *
 * @param {object} requirements - User requirements from registration flow
 * @returns {Promise<Array>} Array of top 5 matching WordPress posts with relevance scores
 */
/**
 * ENHANCED AI-POWERED PROPERTY SEARCH using NEW CUSTOM API
 * Search WordPress based on user requirements with intelligent AI scoring
 * Features:
 * - Uses new custom search API (https://masaak.com/wp-content/search.php)
 * - Direct parameter-based search (city, district, type, purpose, price range, area range)
 * - Excludes طلبات by default
 * - AI-powered relevance scoring
 *
 * @param {object} requirements - User requirements from registration flow
 * @returns {Promise<Array>} Array of top 5 matching WordPress posts with relevance scores
 */
async function searchWordPressByRequirements(requirements) {
  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🔍 AI-POWERED DEEP SEARCH WITH NEW CUSTOM API`);
    console.log(`${"=".repeat(60)}`);
    console.log(`📋 User Requirements:`, JSON.stringify(requirements, null, 2));

    // Use deep search with multiple variations
    const results = await deepSearchService.performDeepSearch(requirements, {
      maxResults: 20,
      includeVariations: true,
    });

    // Sort by date (latest first) if date is available
    results.sort((a, b) => {
      const dateA = a.meta?.post_date
        ? new Date(a.meta.post_date)
        : new Date(0);
      const dateB = b.meta?.post_date
        ? new Date(b.meta.post_date)
        : new Date(0);
      return dateB - dateA;
    });

    console.log(`\n✅ Deep search returned ${results.length} unique results`);

    if (results.length === 0) {
      console.log(`⚠️ NO PROPERTIES found!`);
      return [];
    }

    // SCORE AND FILTER RESULTS using similarity scoring
    console.log(`\n📊 SCORING ${results.length} PROPERTIES...`);
    const scoredResults = [];
    const { calculateSimilarityScore } = require("./similarityScoreService");

    for (const post of results) {
      // Calculate match score using the similarity service
      const similarity = calculateSimilarityScore(requirements, post);

      // Build match reasons
      const reasons = [];
      if (similarity.breakdown.price >= 80) {
        reasons.push(`السعر يناسب ميزانيتك (${similarity.breakdown.price}%)`);
      }
      if (similarity.breakdown.area >= 80) {
        reasons.push(`المساحة مثالية (${similarity.breakdown.area}%)`);
      }
      if (similarity.breakdown.location >= 80) {
        reasons.push(
          `الموقع في منطقتك المفضلة (${similarity.breakdown.location}%)`
        );
      }

      scoredResults.push({
        post,
        score: similarity.score,
        reasons,
        relevance:
          similarity.matchQuality || getRelevanceLabel(similarity.score),
      });
    }

    // Sort by score
    scoredResults.sort((a, b) => b.score - a.score);

    // Take top 10
    const topResults = scoredResults.slice(0, 10);

    // LOG FINAL RESULTS
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🏆 TOP ${topResults.length} RESULTS`);
    console.log(`${"=".repeat(60)}`);

    topResults.forEach((item, index) => {
      const apiData = item.post.apiData || {};
      console.log(`\n${index + 1}. ${item.relevance} Score: ${item.score}%`);
      console.log(`   العنوان: ${apiData.title || "غير محدد"}`);
      console.log(`   النوع: ${apiData.type || "غير محدد"}`);
      console.log(`   الموقع: ${apiData.city || ""} ${apiData.district || ""}`);
      console.log(`   السعر: ${apiData.price?.text || "غير محدد"}`);
      console.log(`   المساحة: ${apiData.area?.text || "غير محدد"}`);
      console.log(`   أسباب التطابق: ${item.reasons.join(" | ") || "N/A"}`);
    });

    console.log(`\n${"=".repeat(60)}`);
    console.log(
      `✅ SEARCH COMPLETE - Returning ${topResults.length} properties`
    );
    console.log(`${"=".repeat(60)}\n`);

    // Return posts with their scores and relevance
    return topResults.map((item) => ({
      ...item.post,
      matchScore: item.score,
      matchReasons: item.reasons,
      relevance: item.relevance,
    }));
  } catch (error) {
    console.error("❌ Error in AI-powered search:", error);
    return [];
  }
}

/**
 * Format WordPress post as WhatsApp message
  locationText.includes(neighborhood.toLowerCase())
);
/**
 * Format WordPress post as WhatsApp message
 * @param {object} post - WordPress post object
 * @returns {string} Formatted message
 */
/**
 * Format WordPress post as WhatsApp message with AI-enhanced relevance info
 * @param {object} post - WordPress post object (includes matchScore, matchReasons, relevance)
 * @param {number} index - Result index (1-based)
 * @returns {string} Formatted message
 */
function formatPostAsMessage(post, index = null) {
  const meta = post.meta || {};
  const title = post.title?.rendered || "عقار";
  const category = meta.arc_category || meta.parent_catt || "عقار";
  const subcategory = meta.sub_catt || meta.arc_subcategory || "";

  let categoryDisplay = category;
  if (subcategory && subcategory !== category) {
    categoryDisplay = `${category} (${subcategory})`;
  }

  // Use original text from API (price_text, area_text) for display
  // Fall back to price_amount/arc_space only if text not available
  const price =
    meta.price_text || meta.price || meta.price_amount || "السعر عند التواصل";
  const area =
    meta.area_text || meta.arc_space || meta.order_space || "غير محدد";

  const location =
    meta.location || meta.City || meta.before_City || "الموقع غير محدد";
  const link = post.link || `https://masaak.com/?p=${post.id}`;

  // Build message
  let message = `━━━━━━━━━━━━━━\n`;

  // Add index number if provided
  if (index !== null) {
    message += `*${index}.* `;
  }

  message += `🏠 *${categoryDisplay}* - ${title}\n\n`;
  message += `💰 *السعر:* ${price}\n`;

  // Check if area already includes unit (م²), if not add "متر"
  const areaDisplay =
    area.includes("م²") || area.includes("متر") || area === "غير محدد"
      ? area
      : `${area} متر`;
  message += `📏 *المساحة:* ${areaDisplay}\n`;

  message += `📍 *الموقع:* ${location}\n`;

  message += `\n🔗 *التفاصيل:* ${link}`;

  // Add relative date if available
  if (meta.post_date) {
    try {
      const postDate = new Date(meta.post_date);
      const now = new Date();
      const diffTime = Math.abs(now - postDate);
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      let relativeTime = "";
      if (diffDays === 0) {
        relativeTime = "اليوم";
      } else if (diffDays === 1) {
        relativeTime = "أمس";
      } else if (diffDays === 2) {
        relativeTime = "قبل يومين";
      } else if (diffDays <= 10) {
        relativeTime = `قبل ${diffDays} أيام`;
      } else {
        relativeTime = `قبل ${diffDays} يوم`;
      }

      message += `\n📅 *نشر:* ${relativeTime}`;
    } catch (e) {
      console.error("Error calculating relative date:", e);
    }
  }

  return message;
}

/**
 * Calculate text similarity (Levenshtein-based)
 * Returns 0-1 (0 = completely different, 1 = identical)
 */
function calculateSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  if (text1 === text2) return 1;

  const len1 = text1.length;
  const len2 = text2.length;

  // Quick length-based check
  const lengthDiff = Math.abs(len1 - len2);
  if (lengthDiff > Math.max(len1, len2) * 0.3) return 0; // >30% length diff = not similar

  // Simplified similarity: count matching words
  const words1 = text1
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const words2 = text2
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (words1.length === 0 || words2.length === 0) return 0;

  const set1 = new Set(words1);
  const set2 = new Set(words2);

  let matches = 0;
  for (const word of set1) {
    if (set2.has(word)) matches++;
  }

  const similarity = (2 * matches) / (set1.size + set2.size);
  return similarity;
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
      ad1.meta?.arc_category ||
      ad1.meta?.parent_catt ||
      ad1.wpData?.meta?.parent_catt ||
      ad1.wpData?.meta?.arc_category ||
      "",
    subcategory:
      ad1.meta?.sub_catt ||
      ad1.meta?.arc_subcategory ||
      ad1.wpData?.meta?.sub_catt ||
      ad1.wpData?.meta?.arc_subcategory ||
      "",
    price: ad1.meta?.price_amount || ad1.wpData?.meta?.price_amount || "",
    area:
      ad1.meta?.arc_space ||
      ad1.wpData?.meta?.arc_space ||
      ad1.wpData?.meta?.area ||
      "",
    neighborhood:
      ad1.meta?.location ||
      ad1.meta?.neighborhood ||
      ad1.wpData?.meta?.location ||
      ad1.wpData?.meta?.neighborhood ||
      "",
    city:
      ad1.meta?.City ||
      ad1.wpData?.meta?.City ||
      ad1.wpData?.meta?.subcity ||
      "",
  };

  const details2 = {
    category:
      ad2.category ||
      ad2.meta?.arc_category ||
      ad2.meta?.parent_catt ||
      ad2.wpData?.meta?.parent_catt ||
      ad2.wpData?.meta?.arc_category ||
      "",
    subcategory:
      ad2.meta?.sub_catt ||
      ad2.meta?.arc_subcategory ||
      ad2.wpData?.meta?.sub_catt ||
      ad2.wpData?.meta?.arc_subcategory ||
      "",
    price: ad2.meta?.price_amount || ad2.wpData?.meta?.price_amount || "",
    area:
      ad2.meta?.arc_space ||
      ad2.wpData?.meta?.arc_space ||
      ad2.wpData?.meta?.area ||
      "",
    neighborhood:
      ad2.meta?.location ||
      ad2.meta?.neighborhood ||
      ad2.wpData?.meta?.location ||
      ad2.wpData?.meta?.neighborhood ||
      "",
    city:
      ad2.meta?.City ||
      ad2.wpData?.meta?.City ||
      ad2.wpData?.meta?.subcity ||
      "",
  };

  // Normalize values for comparison
  const normalize = (str) =>
    String(str || "")
      .toLowerCase()
      .trim();

  const category1 = normalize(details1.category);
  const category2 = normalize(details2.category);
  const subcategory1 = normalize(details1.subcategory);
  const subcategory2 = normalize(details2.subcategory);
  const price1 = normalize(details1.price);
  const price2 = normalize(details2.price);
  const area1 = normalize(details1.area);
  const area2 = normalize(details2.area);
  const neighborhood1 = normalize(details1.neighborhood);
  const neighborhood2 = normalize(details2.neighborhood);
  const city1 = normalize(details1.city);
  const city2 = normalize(details2.city);

  // Must match: category, area, and neighborhood
  const categoryMatches = category1 && category2 && category1 === category2;
  const areaMatches = area1 && area2 && area1 === area2;
  const neighborhoodMatches =
    neighborhood1 && neighborhood2 && neighborhood1 === neighborhood2;
  const subcategoryMatches =
    !subcategory1 || !subcategory2 || subcategory1 === subcategory2;

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
  // - AND matching subcategory (if both present)
  const isDuplicate =
    categoryMatches &&
    areaMatches &&
    neighborhoodMatches &&
    priceMatches &&
    subcategoryMatches;

  if (isDuplicate) {
    console.log("🔍 Duplicate detected by details:");
    console.log(`   Category: ${category1} = ${category2}`);
    console.log(`   Subcategory: ${subcategory1} = ${subcategory2}`);
    console.log(`   Area: ${area1} = ${area2}`);
    console.log(`   Neighborhood: ${neighborhood1} = ${neighborhood2}`);
    console.log(`   Price: ${price1} ≈ ${price2}`);
  }

  return isDuplicate;
}

// Message Templates
const MESSAGES = {
  INITIAL_GREETING: `*حياك الله في 🔰مسعاك العقارية*

معك أخوك عبدالرحمن السليم.. 
شرفني بأسمك الثنائي لأن المحادثات انحذفت.`,

  ROLE_SELECTION: (name) => `*تشرفنا فيك ${name}* ..معك أخوك عبدالرحمن السليم
إذا تكرمت، هل أنت:

1️⃣ *تبحث عن عقار*
2️⃣ *مالك عقار*
3️⃣ *مستثمر*
4️⃣ *وسيط عقاري*

اختر الرقم أو اكتب الدور اللي يناسبك`,

  // Role 1: باحث عن عقار
  SEARCHER_REQUIREMENTS: (name) => {
    const instructionMessage = `*تشرفنا فيك ${name}* ..معك أخوك عبدالرحمن السليم

📝 *طريقة الإرسال:*
بتلقى رسالة ثانية فيها كل التفاصيل المطلوبة
اضغط على الرسالة واختار نسخ ✂️
بعدها املأ التفاصيل وأرسلها

💡 *مثال كامل على طريقة التعبئة:*

نوع العقار المطلوب: بيت دور كامل
الغرض: شراء
حدود السعر: من 500 ألف إلى مليون
المساحة المطلوبة: من 300 إلى 500
الأحياء المفضلة: الربوة، النرجس
رقم التواصل: 0501234567
مواصفات إضافية: مجلس رجال منفصل، حوش كبير

🔰 *مسعاك العقارية*
عبدالرحمن السليم`;

    const templateMessage = `نوع العقار المطلوب: 
الغرض: 
حدود السعر: 
المساحة المطلوبة: 
الأحياء المفضلة: 
رقم التواصل: 
مواصفات إضافية: `;

    return { instruction: instructionMessage, template: templateMessage };
  },

  SEARCHER_CONFIRM: (name, requirements) => `لقد قمت بطلب البحث عن 
${requirements}

هل هذه المعلومات صحيحة؟ (نعم/تعديل)`,

  SEARCHER_RESULTS: (name, count) => {
    if (count === 0) {
      return `*${name}*، للأسف لم أجد عروض مطابقة حالياً.
يمكنك تصفح المزيد من العروض على موقعنا:
https://masaak.com/`;
    }
    return `👍تمام *${name}* أرسلت لك العروض المتاحة واذا ناسبك شي خبرني اشيك إذا لازال متاح ورتب لك موعد للمعاينة`;
  },

  SEARCHER_CLOSING: `✅وهذا رابط قروب مسعاك ..حياك إنضم 
https://chat.whatsapp.com/EVTKr3deoeC1zBMlVFglyn?mode=ems_copy_t

 👌وهذا رابط منصة مسعاك .. أخذ جولة..منصة منظمه و فيها معظم عقارات الأحساء وأنا معك
https://masaak.com/`,

  // Role 2: مالك
  OWNER_REQUIREMENTS: (
    name
  ) => `*تشرفنا فيك ${name}* ..معك أخوك عبدالرحمن السليم إذا ممكن ترسل لي تفاصيل العقار أو تكتب في نفس الرسالة وترسلها لي وابشر بالخير

*نوع العقار:*
*الغرض:* (بيع / إيجار)
*السعر:*
*المساحة:*
*الحي:*
*رقم التواصل:*
*مواصفات إضافية إن وجدت:*

 *🔰مسعاك العقارية*
عبدالرحمن السليم`,

  OWNER_CONFIRM: `تمام براجع العرض وبتواصل معك ان شاءالله`,

  // Role 3: مستثمر
  INVESTOR_REQUIREMENTS: (
    name
  ) => `*تشرفنا فيك ${name}* ..معك أخوك عبدالرحمن السليم..عندنا فرص كثيرة للاستثمار إذا ممكن تكتب في نفس الرسالة عن ماذا تبحث وترسلها لي وابشر بالخير

*نوع العقار المطلوب:*
*الغرض:* (شراء / إيجار)
*حدود كم السعر:*
*المساحة المطلوبة:*
*الأحياء المفضلة:*
*رقم التواصل:*
*مواصفات إضافية إن وجدت:*

 *🔰مسعاك العقارية*
عبدالرحمن السليم`,

  // Role 4: وسيط
  BROKER_SELECTION: (name) => `*تشرفنا فيك ${name}* ..معك أخوك عبدالرحمن السليم 
هل عندك 
   1. عروض 
   2. طلب حق زبون
 *🔰مسعاك العقارية*
عبدالرحمن السليم`,

  BROKER_OFFERS: (name) => `*تشرفنا فيك ${name}* ..معك أخوك عبدالرحمن السليم 
أرسل لي العروض اللي معك ونتشرف بالتعاون معك 

 *🔰مسعاك العقارية*
عبدالرحمن السليم`,

  BROKER_CLIENT_REQUEST: (
    name
  ) => `*تشرفنا فيك ${name}* ..معك أخوك عبدالرحمن السليم إذا ممكن تكتب في نفس الرسالة عن ماذا تبحث وترسلها لي وابشر بالخير

*نوع العقار المطلوب:*
*الغرض:* (شراء / إيجار)
*حدود كم السعر:*
*المساحة المطلوبة:*
*الأحياء المفضلة:*
*رقم التواصل:*
*مواصفات إضافية إن وجدت:*

 *🔰مسعاك العقارية*
عبدالرحمن السليم`,
};

/**
 * Process private chat message
 * @param {string} phoneNumber - Client's phone number
 * @param {string} message - Incoming message
 * @param {function} sendReply - Function to send reply (async)
 * @param {function} sendImageReply - Function to send image with caption (async)
 */
async function handlePrivateMessage(
  phoneNumber,
  message,
  sendReply,
  sendImageReply
) {
  try {
    // Get or create client session
    const client = privateClient.getClient(phoneNumber);

    // Add to conversation history
    privateClient.addToHistory(phoneNumber, "client", message);

    console.log(
      `📱 Private chat from ${phoneNumber} [${
        client.state
      }]: ${message.substring(0, 50)}...`
    );

    // State machine
    switch (client.state) {
      case "initial":
        await handleInitialState(client, phoneNumber, message, sendReply);
        break;

      case "awaiting_name":
        await handleNameCollection(client, phoneNumber, message, sendReply);
        break;

      case "awaiting_role":
        await handleRoleSelection(client, phoneNumber, message, sendReply);
        break;

      case "awaiting_broker_choice":
        await handleBrokerChoice(client, phoneNumber, message, sendReply);
        break;

      case "awaiting_requirements":
        await handleRequirements(client, phoneNumber, message, sendReply);
        break;

      case "awaiting_confirmation":
        await handleConfirmation(
          client,
          phoneNumber,
          message,
          sendReply,
          sendImageReply
        );
        break;

      case "awaiting_offer":
        await handleOfferSubmission(client, phoneNumber, message, sendReply);
        break;

      case "completed":
        await handleCompletedState(client, phoneNumber, message, sendReply);
        break;

      default:
        console.log(`❌ Unknown state: ${client.state}`);
        break;
    }
  } catch (error) {
    console.error("❌ Error in handlePrivateMessage:", error);
  }
}

/**
 * Handle initial state - send greeting
 */
async function handleInitialState(client, phoneNumber, message, sendReply) {
  const reply = MESSAGES.INITIAL_GREETING;
  await sendReply(reply);
  privateClient.addToHistory(phoneNumber, "bot", reply);

  // Update state
  privateClient.updateClient(phoneNumber, {
    state: "awaiting_name",
  });
}

/**
 * Handle name collection with AI validation
 */
async function handleNameCollection(client, phoneNumber, message, sendReply) {
  const name = message.trim();

  // Basic validation first
  if (!name || name.length < 2) {
    // Don't warn if already warned
    if (client.nameValidationWarned) {
      console.log(`⏭️ Already warned, ignoring invalid input`);
      return;
    }
    const reply = "من فضلك اكتب اسمك الثنائي";
    await sendReply(reply);
    privateClient.addToHistory(phoneNumber, "bot", reply);
    privateClient.updateClient(phoneNumber, { nameValidationWarned: true });
    return;
  }

  // Smart pre-validation before wasting AI tokens
  // 1. Check if message is too long (likely not a name)
  if (name.length > 100) {
    console.log(
      `❌ Name too long (${name.length} chars), rejecting without AI`
    );
    if (client.nameValidationWarned) {
      console.log(`⏭️ Already warned, ignoring invalid input`);
      return;
    }
    const reply = "الاسم طويل جداً 😅\n\nمن فضلك اكتب اسمك الثنائي فقط";
    await sendReply(reply);
    privateClient.addToHistory(phoneNumber, "bot", reply);
    privateClient.updateClient(phoneNumber, { nameValidationWarned: true });
    return;
  }

  // 2. Check if message contains multiple lines (likely a form/message, not a name)
  const lineCount = (name.match(/\n/g) || []).length;
  if (lineCount > 2) {
    console.log(`❌ Too many lines (${lineCount}), rejecting without AI`);
    if (client.nameValidationWarned) {
      console.log(`⏭️ Already warned, ignoring invalid input`);
      return;
    }
    const reply =
      "يبدو أنك أرسلت رسالة طويلة 📝\n\nمن فضلك اكتب *اسمك الثنائي فقط*";
    await sendReply(reply);
    privateClient.addToHistory(phoneNumber, "bot", reply);
    privateClient.updateClient(phoneNumber, { nameValidationWarned: true });
    return;
  }

  // 3. Check if message contains form-like patterns (multiple colons/asterisks)
  const colonCount = (name.match(/:/g) || []).length;
  const asteriskCount = (name.match(/\*/g) || []).length;
  if (colonCount > 2 || asteriskCount > 4) {
    console.log(
      `❌ Form-like structure detected (colons: ${colonCount}, asterisks: ${asteriskCount}), rejecting without AI`
    );
    if (client.nameValidationWarned) {
      console.log(`⏭️ Already warned, ignoring invalid input`);
      return;
    }
    const reply =
      "يبدو أنك أرسلت نموذج أو رسالة 📋\n\nمن فضلك اكتب *اسمك الثنائي فقط*\nمثال: محمد أحمد";
    await sendReply(reply);
    privateClient.addToHistory(phoneNumber, "bot", reply);
    privateClient.updateClient(phoneNumber, { nameValidationWarned: true });
    return;
  }

  // 4. Check if message contains typical greeting phrases (likely a reply, not a name)
  const lowerName = name.toLowerCase();
  const greetingPatterns = [
    // Greetings & Welcomes
    "السلام عليكم",
    "وعليكم السلام",
    "مرحبا",
    "أهلا",
    "اهلين",
    "يا هلا",
    "ياهلا والله",
    "حياك الله",
    "الله يحييك",
    "أسعد الله صباحك",
    "أسعد الله مسائك",
    "صباح الخير",
    "مساء الخير",
    "صباح النور",
    "مساء النور",

    // Politeness & Introduction Phrases
    "تشرفنا",
    "الشرف لي",
    "معك",
    "أخوك",
    "أختك",
    "الله يسعدك",
    "الله يعطيك العافية",
    "تسلم",
    "الله يسلمك",

    // Conversational Fillers & Affirmations
    "ابشر",
    "ابشري",
    "تفضل",
    "تفضلي",
    "سم",
    "سمي",
    "آمر",
    "آمري",
    "إن شاء الله",
    "تمام",
    "طيب",
    "حاضر",
    "أكيد",
    "نعم",
    "اي نعم",

    // "How are you?" and its variations
    "كيف حالك",
    "شخبارك",
    "علومك",
    "كيفك",
    "عساك طيب",
    "إن شاء الله بخير",
    "بخير الحمد لله",

    // Context-specific (Real Estate, etc.)
    "تفاصيل العقار",
    "نوع العقار",
    "بخصوص الإعلان",
    "عندي استفسار",
    "استفسار",
    "بكم",
    "كم السعر",
  ];

  const containsGreeting = greetingPatterns.some((pattern) =>
    lowerName.includes(pattern)
  );
  if (containsGreeting) {
    console.log(
      `❌ Message contains greeting/form phrases, rejecting without AI`
    );
    if (client.nameValidationWarned) {
      console.log(`⏭️ Already warned, ignoring invalid input`);
      return;
    }
    const reply =
      "شكراً على ردك! 😊\n\nلكن أحتاج *اسمك الثنائي فقط* عشان نبدأ\nمثال: يوسف تامر";
    await sendReply(reply);
    privateClient.addToHistory(phoneNumber, "bot", reply);
    privateClient.updateClient(phoneNumber, { nameValidationWarned: true });
    return;
  }

  // 5. Check if name contains only valid characters (Arabic, English letters, spaces, and common name chars)
  const validNamePattern =
    /^[a-zA-Zء-ي\s\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+$/;
  if (!validNamePattern.test(name)) {
    console.log(`❌ Name contains invalid characters, rejecting without AI`);
    if (client.nameValidationWarned) {
      console.log(`⏭️ Already warned, ignoring invalid input`);
      return;
    }
    const reply =
      "من فضلك اكتب اسمك بأحرف عربية أو إنجليزية فقط\nبدون رموز أو أرقام";
    await sendReply(reply);
    privateClient.addToHistory(phoneNumber, "bot", reply);
    privateClient.updateClient(phoneNumber, { nameValidationWarned: true });
    return;
  }

  // 6. Check word count (name should be 2-4 words typically)
  const wordCount = name.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount > 6) {
    console.log(`❌ Too many words (${wordCount}), rejecting without AI`);
    if (client.nameValidationWarned) {
      console.log(`⏭️ Already warned, ignoring invalid input`);
      return;
    }
    const reply =
      "الاسم يحتوي على كلمات كثيرة 😅\n\nمن فضلك اكتب *اسمك الثنائي فقط*";
    await sendReply(reply);
    privateClient.addToHistory(phoneNumber, "bot", reply);
    privateClient.updateClient(phoneNumber, { nameValidationWarned: true });
    return;
  }

  // AI validation for name (only if passed all pre-checks)
  try {
    console.log(`🤖 Validating name with AI: "${name}"`);
    const validation = await validateUserInput(name, "name");

    if (!validation.isValid) {
      console.log(
        `❌ AI rejected name: ${validation.reason} - ${validation.suggestion}`
      );

      // Check if user already tried once (to avoid infinite loop)
      // Use a flag in client object instead of history (since history is no longer stored)
      if (client.nameValidationWarned) {
        console.log(
          `⚠️ User already warned about name, accepting anyway: "${name}"`
        );
        // Accept the name and continue (reset flag)
        privateClient.updateClient(phoneNumber, {
          nameValidationWarned: false,
        });
      } else {
        // Send AI's suggestion to user (only once)
        const reply =
          validation.suggestion || "من فضلك اكتب اسمك الثنائي بشكل صحيح";
        await sendReply(reply);
        privateClient.addToHistory(phoneNumber, "bot", reply);
        // Mark that we've warned the user
        privateClient.updateClient(phoneNumber, { nameValidationWarned: true });
        return;
      }
    } else {
      console.log(`✅ AI approved name: "${name}"`);
    }
  } catch (aiError) {
    console.error("❌ AI validation failed, proceeding anyway:", aiError);
    // Continue without AI validation if it fails
  }

  // Save name and proceed
  privateClient.updateClient(phoneNumber, {
    name: name,
    state: "awaiting_role",
    nameValidationWarned: false, // Reset flag when successfully moving to next state
  });

  // Ask for role
  const reply = MESSAGES.ROLE_SELECTION(name);
  await sendReply(reply);
  privateClient.addToHistory(phoneNumber, "bot", reply);
}

/**
 * Handle role selection
 */
/**
 * Handle role selection
 */
async function handleRoleSelection(client, phoneNumber, message, sendReply) {
  // Convert Arabic numerals to Western numerals
  const arabicToWestern = (str) => {
    const arabicNumerals = "٠١٢٣٤٥٦٧٨٩";
    const westernNumerals = "0123456789";
    let result = str;
    for (let i = 0; i < arabicNumerals.length; i++) {
      result = result.replace(
        new RegExp(arabicNumerals[i], "g"),
        westernNumerals[i]
      );
    }
    return result;
  };

  const msg = arabicToWestern(message.trim());
  let role = null;
  let reply = "";

  // Detect role from message
  if (msg === "1" || msg.includes("باحث") || msg.includes("بحث")) {
    role = "باحث";
    const messages = MESSAGES.SEARCHER_REQUIREMENTS(client.name);

    // Send instruction message first
    await sendReply(messages.instruction);
    privateClient.addToHistory(phoneNumber, "bot", messages.instruction);

    // Wait a moment
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Send template message for easy copying
    await sendReply(messages.template);
    privateClient.addToHistory(phoneNumber, "bot", messages.template);

    privateClient.updateClient(phoneNumber, {
      role: role,
      state: "awaiting_requirements",
      roleValidationWarned: false,
    });
    return; // Don't send reply again below
  } else if (msg === "2" || msg.includes("مالك")) {
    role = "مالك";
    reply = MESSAGES.OWNER_REQUIREMENTS(client.name);
    privateClient.updateClient(phoneNumber, {
      role: role,
      state: "awaiting_offer",
      roleValidationWarned: false, // Reset warning flag
    });
  } else if (msg === "3" || msg.includes("مستثمر")) {
    role = "مستثمر";
    reply = MESSAGES.INVESTOR_REQUIREMENTS(client.name);
    privateClient.updateClient(phoneNumber, {
      role: role,
      state: "awaiting_requirements",
      roleValidationWarned: false, // Reset warning flag
    });
  } else if (msg === "4" || msg.includes("وسيط")) {
    role = "وسيط";
    reply = MESSAGES.BROKER_SELECTION(client.name);
    privateClient.updateClient(phoneNumber, {
      role: role,
      state: "awaiting_broker_choice",
      roleValidationWarned: false, // Reset warning flag
    });
  } else {
    // Invalid input - warn only once
    if (client.roleValidationWarned) {
      console.log(`⏭️ Already warned about invalid role, ignoring`);
      return;
    }
    reply = "من فضلك اختر رقم من 1 إلى 4";
    await sendReply(reply);
    privateClient.addToHistory(phoneNumber, "bot", reply);
    privateClient.updateClient(phoneNumber, { roleValidationWarned: true });
    return;
  }

  await sendReply(reply);
  privateClient.addToHistory(phoneNumber, "bot", reply);
}

/**
 * Handle broker sub-choice (offers or client request)
 */
async function handleBrokerChoice(client, phoneNumber, message, sendReply) {
  // Convert Arabic numerals to Western numerals
  const arabicToWestern = (str) => {
    const arabicNumerals = "٠١٢٣٤٥٦٧٨٩";
    const westernNumerals = "0123456789";
    let result = str;
    for (let i = 0; i < arabicNumerals.length; i++) {
      result = result.replace(
        new RegExp(arabicNumerals[i], "g"),
        westernNumerals[i]
      );
    }
    return result;
  };

  const msg = arabicToWestern(message.trim());
  let reply = "";

  if (msg === "1" || msg.includes("عروض")) {
    reply = MESSAGES.BROKER_OFFERS(client.name);
    privateClient.updateClient(phoneNumber, {
      state: "awaiting_offer",
      brokerValidationWarned: false, // Reset warning flag
    });
  } else if (msg === "2" || msg.includes("طلب")) {
    reply = MESSAGES.BROKER_CLIENT_REQUEST(client.name);
    privateClient.updateClient(phoneNumber, {
      state: "awaiting_requirements",
      brokerValidationWarned: false, // Reset warning flag
    });
  } else {
    // Invalid input - warn only once
    if (client.brokerValidationWarned) {
      console.log(`⏭️ Already warned about invalid broker choice, ignoring`);
      return;
    }
    reply = "من فضلك اختر 1 للعروض أو 2 لطلب زبون";
    await sendReply(reply);
    privateClient.addToHistory(phoneNumber, "bot", reply);
    privateClient.updateClient(phoneNumber, { brokerValidationWarned: true });
    return;
  }

  await sendReply(reply);
  privateClient.addToHistory(phoneNumber, "bot", reply);
}

/**
 * Handle requirements collection
 */
async function handleRequirements(client, phoneNumber, message, sendReply) {
  // Parse requirements from message
  const requirements = parseRequirements(message);

  // Save requirements
  privateClient.updateClient(phoneNumber, {
    requirements: requirements,
    state: "awaiting_confirmation",
  });

  // Show confirmation
  const summary = formatRequirementsSummary(requirements);
  const reply = MESSAGES.SEARCHER_CONFIRM(client.name, summary);
  await sendReply(reply);
  privateClient.addToHistory(phoneNumber, "bot", reply);
}

/**
 * Handle confirmation
 */
async function handleConfirmation(
  client,
  phoneNumber,
  message,
  sendReply,
  sendImageReply
) {
  const msg = message.trim().toLowerCase();

  if (msg.includes("تعديل")) {
    // Ask for requirements again
    if (client.role === "باحث") {
      const messages = MESSAGES.SEARCHER_REQUIREMENTS(client.name);
      await sendReply(messages.instruction);
      privateClient.addToHistory(phoneNumber, "bot", messages.instruction);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await sendReply(messages.template);
      privateClient.addToHistory(phoneNumber, "bot", messages.template);
    } else if (client.role === "مستثمر") {
      const reply = MESSAGES.INVESTOR_REQUIREMENTS(client.name);
      await sendReply(reply);
      privateClient.addToHistory(phoneNumber, "bot", reply);
    } else {
      const reply = MESSAGES.BROKER_CLIENT_REQUEST(client.name);
      await sendReply(reply);
      privateClient.addToHistory(phoneNumber, "bot", reply);
    }

    privateClient.updateClient(phoneNumber, {
      state: "awaiting_requirements",
    });

    return;
  }

  // Confirmed - search WordPress for properties
  console.log(`🔍 Starting WordPress search for ${phoneNumber}`);
  await sendReply("🔍 جاري البحث في قاعدة بياناتنا...");

  const results = await searchWordPressByRequirements(client.requirements);

  // Send results
  if (results.length > 0) {
    // Combine ALL results in ONE message
    let combinedMessage = `✨ *${client.name}*، وجدت *${results.length}* عقار يطابق متطلباتك!\n\n`;
    combinedMessage += `هذي أفضل النتائج:\n\n`;

    // Add each property to the combined message (limit to 10)
    for (let i = 0; i < Math.min(results.length, 10); i++) {
      combinedMessage += formatPostAsMessage(results[i], i + 1);
      if (i < Math.min(results.length, 10) - 1) {
        combinedMessage += "\n\n";
      }
    }

    // Send the combined message
    await sendReply(combinedMessage);
    privateClient.addToHistory(phoneNumber, "bot", combinedMessage);

    // Wait a moment before final message
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Send final closing message WITH IMAGE
    const finalMsg = `�تمام *${client.name}* أرسلت لك العروض المتاحة واذا ناسبك شي خبرني اشيك إذا لازال متاح ورتب لك موعد للمعاينة

✅وهذا رابط قروب مسعاك ..حياك إنضم 
https://chat.whatsapp.com/EVTKr3deoeC1zBMlVFglyn?mode=ems_copy_t

�وهذا رابط منصة مسعاك .. أخذ جولة..منصة منظمه و فيها معظم عقارات الأحساء وأنا معك
https://masaak.com/`;

    // Send image with caption (read file as buffer)
    const imagePath = path.join(__dirname, "..", "image.png");
    if (fs.existsSync(imagePath)) {
      const imageBuffer = fs.readFileSync(imagePath);
      await sendImageReply(imageBuffer, finalMsg);
    } else {
      // Fallback to text only if image not found
      await sendReply(finalMsg);
    }
    privateClient.addToHistory(phoneNumber, "bot", finalMsg);
  } else {
    // No results found
    const noResultMsg = `😔 *${client.name}*، للأسف ما لقيت عقارات تطابق متطلباتك بالضبط.

لكن لا تشيل هم! تقدر:
📞 تتواصل معنا مباشرة: *0508001475*
🔄 تعدل متطلباتك (اكتب "تعديل")
🔍 تبحث بكلمات مختلفة (اكتب "بحث جديد")`;
    await sendReply(noResultMsg);
    privateClient.addToHistory(phoneNumber, "bot", noResultMsg);
  }

  // Mark as completed
  privateClient.updateClient(phoneNumber, {
    state: "completed",
  });
}

/**
 * Handle offer submission (from مالك or وسيط with offers)
 * Process through AI and save to ads database like group messages
 */
async function handleOfferSubmission(client, phoneNumber, message, sendReply) {
  try {
    console.log(`📝 Processing offer from ${client.name} (${phoneNumber})`);

    // Save the offer to client data
    privateClient.updateClient(phoneNumber, {
      propertyOffer: message,
      state: "completed",
    });

    // Send confirmation message FIRST
    const reply = MESSAGES.OWNER_CONFIRM;
    await sendReply(reply);
    privateClient.addToHistory(phoneNumber, "bot", reply);

    // ========================================
    // CHECK FOR DUPLICATES BEFORE AI PROCESSING
    // (Save AI tokens by checking exact duplicates first!)
    // ========================================

    const { getDataPath } = require("../config/dataPath");
    const ADS_FILE = getDataPath("ads.json");
    let ads = [];

    if (fs.existsSync(ADS_FILE)) {
      const adsData = fs.readFileSync(ADS_FILE, "utf8");
      ads = JSON.parse(adsData || "[]");
    }

    const normalizedText = message.replace(/\s+/g, " ").trim().toLowerCase();
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;

    // Check 1: Exact text match from same phone number (any source)
    // This is a quick check to save AI tokens on obvious duplicates
    const exactMatch = ads.find(
      (a) =>
        (a.senderPhone === phoneNumber || a.author === phoneNumber) &&
        a.timestamp > thirtyMinutesAgo &&
        a.normalizedText === normalizedText
    );

    if (exactMatch) {
      console.log(
        `⚠️ Exact duplicate detected! Ad ${exactMatch.id} already exists from this phone number`
      );
      console.log(
        `   Source: ${
          exactMatch.source || "group"
        } | Skipping AI processing & save`
      );
      console.log(`   ✅ Saved AI tokens by detecting duplicate early`);
      return; // Don't process with AI or save duplicate
    }

    // ========================================
    // NO EXACT DUPLICATE - NOW PROCESS WITH AI
    // ========================================

    console.log(`✅ No exact duplicate found - proceeding with AI analysis`);
    console.log(`🤖 Analyzing offer with AI...`);
    const aiResult = await processMessage(message);

    console.log(
      `✅ AI processing complete: IsAd=${aiResult?.IsItAd}, Category=${aiResult?.category}`
    );

    // ========================================
    // CHECK FOR DUPLICATES BY PROPERTY DETAILS
    // (After AI processing to compare actual property data)
    // ========================================

    if (aiResult && aiResult.IsItAd) {
      // Check 2: Duplicate based on property details (category, price, area, neighborhood)
      // This prevents duplicate properties even if the message text is different
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
        console.log(`   ✅ Prevented duplicate property listing`);
        return; // Don't save duplicate property
      }

      console.log(`✅ No duplicate property found - saving new ad`);
    }

    console.log(
      `✅ AI Result: isAd=${aiResult.isAd}, confidence=${aiResult.confidence}%`
    );

    if (!aiResult.isAd) {
      console.log(
        `⚠️ Offer not classified as ad by AI, but saving anyway (from private chat)`
      );
    }

    // Create ad object (similar to group message processing)
    const ad = {
      id: `private_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      text: message,
      enhancedText: aiResult.enhancedText || message,
      normalizedText: normalizedText, // Use already calculated normalizedText
      fromGroup: `private_${phoneNumber}`,
      fromGroupName: `خاص - ${client.name}`,
      author: phoneNumber,
      senderName: client.name,
      senderPhone: phoneNumber,
      imageUrl: null, // Private messages don't have images in this flow
      timestamp: Date.now(),
      status: "new", // Will appear in dashboard for admin review
      category: aiResult.category || null,
      aiConfidence: aiResult.confidence,
      aiReason: aiResult.reason,
      improvements: aiResult.improvements || [],
      isEdited: false,
      meta: aiResult.meta || {},
      wpData: aiResult.wpData || null,
      whatsappMessage: aiResult.whatsappMessage || null,
      // Mark as private chat submission
      source: "private_chat",
      clientRole: client.role,
    };

    // Add to beginning of ads array (already loaded earlier)
    ads.unshift(ad);
    if (ads.length > 1000) ads = ads.slice(0, 1000); // Keep max 1000

    fs.writeFileSync(ADS_FILE, JSON.stringify(ads, null, 2));

    // Reload ads in memory so it appears immediately in dashboard
    try {
      const { reloadAds, getSettings } = require("../whatsapp/bot");
      reloadAds();
      console.log(`🔄 Ads reloaded in memory - ad will appear immediately`);

      // Check if auto-approve is enabled and auto-post to WordPress
      const settings = getSettings();
      const isGroupAllowedForAutoPost = isAutoPostAllowedForGroup(
        settings,
        ad.fromGroup,
      );
      const autoPostEnabled = isAutoPostEnabled(settings);
      const shouldUseFixedAutoPostCategory =
        hasAutoPostGroupSelection(settings);

      if (
        autoPostEnabled &&
        ad.wpData &&
        isGroupAllowedForAutoPost
      ) {
        console.log(
          "🚀 Auto-approve enabled, posting private chat ad to WordPress automatically..."
        );

        // Auto-post to WordPress in background
        (async () => {
          try {
            const axios = require("axios");
            const wpUrl = settings.wordpressUrl || "https://masaak.com";
            const wpUsername = settings.wordpressUsername;
            const wpPassword = settings.wordpressPassword;

            if (!wpUsername || !wpPassword) {
              console.error("❌ WordPress credentials not configured");
              return;
            }

            console.log(
              "🔵 Starting WordPress auto-post for private chat ad..."
            );
            console.log("🔵 Ad ID:", ad.id);

            const wpApiUrl = `${wpUrl}/wp-json/wp/v2/posts`;
            const auth = Buffer.from(`${wpUsername}:${wpPassword}`).toString(
              "base64"
            );

            // Prepare WordPress data
            let wpData = {
              ...(ad.wpData || {}),
              meta: ad.wpData?.meta ? { ...ad.wpData.meta } : {},
            };

            if (shouldUseFixedAutoPostCategory) {
              wpData.categories = [...AUTO_POST_FIXED_CATEGORY_IDS];
              wpData.fixedCategoryIds = [...AUTO_POST_FIXED_CATEGORY_IDS];
            }

            if (ad.senderName && wpData.meta) {
              wpData.meta.owner_name = ad.senderName;
            }

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

            const postData = {
              title: wpData.title || "Untitled Ad",
              content: wpData.content || "",
              status: "publish",
              categories: shouldUseFixedAutoPostCategory
                ? wpData.categories || [...AUTO_POST_FIXED_CATEGORY_IDS]
                : wpData.categories || [],
              meta: wpData.meta || {},
            };

            console.log("📤 Posting private chat ad to WordPress...");
            const wpResponse = await axios.post(wpApiUrl, postData, {
              headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/json",
              },
            });

            console.log(
              "✅ ✅ ✅ Private chat ad auto-posted successfully! ✅ ✅ ✅"
            );
            console.log("📌 Post ID:", wpResponse.data.id);

            // Create SHORT link using post ID
            const postId = wpResponse.data.id;
            const shortLink = `${wpUrl}/?p=${postId}`;
            const fullLink = wpResponse.data.link;

            console.log("📌 Short Link:", shortLink);
            console.log("📌 Full Link:", fullLink);

            const {
              generateWhatsAppMessage,
            } = require("../services/aiService");
            const whatsappMessage = generateWhatsAppMessage(wpData, shortLink);

            ad.status = "accepted";
            ad.wordpressPostId = wpResponse.data.id;
            ad.wordpressPostUrl = shortLink;
            ad.wordpressFullUrl = fullLink;
            ad.whatsappMessage = whatsappMessage;
            ad.wpData = wpData;

            fs.writeFileSync(ADS_FILE, JSON.stringify(ads, null, 2));
            reloadAds();
            console.log("✅ Private chat ad updated with WordPress info");
          } catch (error) {
            console.error(
              "❌ Error during private chat ad auto-post:",
              error.message
            );
            console.error("Error details:", error.response?.data || error);
          }
        })();
      } else if (
        autoPostEnabled &&
        ad.wpData &&
        !isGroupAllowedForAutoPost
      ) {
        console.log(
          `⏭️ Auto-post skipped: source "${ad.fromGroup}" is not in selected auto-post groups`,
        );
      }
    } catch (reloadErr) {
      console.error("⚠️ Failed to reload ads in memory:", reloadErr);
    }

    console.log(`✅ Offer saved to dashboard: ${ad.id}`);
    console.log(`   From: ${client.name} (${client.role})`);
    console.log(`   Category: ${ad.category || "N/A"}`);
    console.log(`   Confidence: ${ad.aiConfidence}%`);
  } catch (error) {
    console.error("❌ Error processing offer submission:", error);
    // Still mark as completed even if processing fails
    privateClient.updateClient(phoneNumber, {
      state: "completed",
    });
  }
}

/**
 * Handle completed state - allow new searches or questions
 * Also handles interest confirmation when user is asked if still looking
 */
async function handleCompletedState(client, phoneNumber, message, sendReply) {
  const msg = message.trim().toLowerCase();

  // Check if user is responding to "still looking?" question
  const isRespondingToStillLooking =
    client.awaitingStillLookingResponse === true;

  if (isRespondingToStillLooking) {
    // User is responding to our "هل مازلت تبحث عن عقار؟" question
    if (
      msg.includes("نعم") ||
      msg.includes("ايوه") ||
      msg.includes("أيوة") ||
      msg.includes("اكيد") ||
      msg.includes("طبعا") ||
      msg.includes("مازلت") ||
      msg.includes("لازال") ||
      msg.includes("مازلت أبحث") ||
      msg === "نعم" ||
      msg === "yes"
    ) {
      // User is still looking - keep request active
      const reply =
        "تمام! راح نخبرك عن أي عقار جديد يناسب طلبك إن شاء الله 👍\n\nإذا احتجت أي شي، أنا موجود";
      await sendReply(reply);
      privateClient.addToHistory(phoneNumber, "bot", reply);

      // Mark as responded (clear the flag)
      privateClient.updateClient(phoneNumber, {
        awaitingStillLookingResponse: false,
        lastResponseToStillLooking: "yes",
        lastResponseToStillLookingAt: Date.now(),
      });

      console.log(`✅ User ${phoneNumber} confirmed still looking`);
      return;
    } else if (
      msg.includes("لا") ||
      msg.includes("لأ") ||
      msg.includes("ما عد") ||
      msg.includes("ماعد") ||
      msg.includes("وجدت") ||
      msg.includes("لقيت") ||
      msg.includes("حصلت") ||
      msg.includes("اشتريت") ||
      msg.includes("استأجرت") ||
      msg === "لا" ||
      msg === "no"
    ) {
      // User is no longer looking - mark request as inactive
      propertyMatchingService.markRequestAsInactive(
        phoneNumber,
        "user_found_property"
      );

      const reply =
        "مبروك! 🎉\n\nنشكرك على ثقتك في مسعاك العقارية\nراح نوقف إرسال الإشعارات.\n\nإذا احتجت خدماتنا مستقبلاً، أنا موجود دايماً 🙏";
      await sendReply(reply);
      privateClient.addToHistory(phoneNumber, "bot", reply);

      // Mark as responded
      privateClient.updateClient(phoneNumber, {
        awaitingStillLookingResponse: false,
        lastResponseToStillLooking: "no",
        lastResponseToStillLookingAt: Date.now(),
      });

      console.log(`🚫 User ${phoneNumber} no longer looking - marked inactive`);
      return;
    } else {
      // Unclear response - ask again with clearer options
      const reply =
        "من فضلك اختر:\n• *نعم* - مازلت أبحث\n• *لا* - وجدت عقار مناسب";
      await sendReply(reply);
      privateClient.addToHistory(phoneNumber, "bot", reply);
      return;
    }
  }

  // Check if user wants to start a new detailed search (go through registration flow)
  if (
    msg.includes("بحث جديد") ||
    msg.includes("بحث تفصيلي") ||
    msg.includes("ابحث عن عقار") ||
    msg.includes("بداية")
  ) {
    // If client already has a role, skip role selection and go directly to requirements
    if (client.role) {
      if (client.role === "باحث") {
        const messages = MESSAGES.SEARCHER_REQUIREMENTS(client.name);
        await sendReply(messages.instruction);
        privateClient.addToHistory(phoneNumber, "bot", messages.instruction);
        await new Promise((resolve) => setTimeout(resolve, 500));
        await sendReply(messages.template);
        privateClient.addToHistory(phoneNumber, "bot", messages.template);
      } else if (client.role === "مستثمر") {
        const reply = MESSAGES.INVESTOR_REQUIREMENTS(client.name);
        await sendReply(reply);
        privateClient.addToHistory(phoneNumber, "bot", reply);
      } else if (client.role === "مالك") {
        const reply = MESSAGES.OWNER_REQUIREMENTS(client.name);
        await sendReply(reply);
        privateClient.addToHistory(phoneNumber, "bot", reply);
      } else if (client.role === "وسيط") {
        const reply = MESSAGES.BROKER_SELECTION(client.name);
        await sendReply(reply);
        privateClient.addToHistory(phoneNumber, "bot", reply);
      } else {
        // Unknown role, ask again
        const reply = MESSAGES.ROLE_SELECTION(client.name);
        await sendReply(reply);
        privateClient.addToHistory(phoneNumber, "bot", reply);
      }

      privateClient.updateClient(phoneNumber, {
        state:
          client.role === "مالك" ? "awaiting_offer" : "awaiting_requirements",
        requirements: {},
      });
    } else {
      // No role yet, ask for role selection
      const reply = MESSAGES.ROLE_SELECTION(client.name);
      privateClient.updateClient(phoneNumber, {
        state: "awaiting_role",
        requirements: {},
      });

      await sendReply(reply);
      privateClient.addToHistory(phoneNumber, "bot", reply);
    }
    return;
  }

  // Quick search using keywords (direct WordPress search)
  if (
    msg.includes("بحث") ||
    msg.includes("ابحث") ||
    msg.includes("عقار") ||
    msg.includes("شقة") ||
    msg.includes("بيت") ||
    msg.includes("أرض") ||
    msg.includes("فيلا") ||
    msg.includes("دبلكس") ||
    msg.includes("استراحة")
  ) {
    // Search WordPress
    await sendReply("🔍 جاري البحث عن العقارات المناسبة...");

    try {
      const results = await searchWordPress(message);

      if (results.length === 0) {
        const reply = `😔 للأسف، لم أجد عقارات تطابق بحثك.


لكن لا تشيل هم! تقدر:
📞 تتواصل معنا مباشرة: *0508001475*
🔄 تعدل متطلباتك (اكتب "تعديل")
🔍 تبحث بكلمات مختلفة (اكتب "بحث جديد")`;
        await sendReply(reply);
        privateClient.addToHistory(phoneNumber, "bot", reply);
        return;
      }

      // Send results in one message
      let resultsMessage = `✨ *وجدت ${results.length} عقار متطابق مع بحثك:*\n\n`;

      results.forEach((post, index) => {
        resultsMessage += formatPostAsMessage(post);
        if (index < results.length - 1) {
          resultsMessage += "\n\n";
        }
      });

      resultsMessage += `\n\n━━━━━━━━━━━━━━
🔰 *مسعاك العقارية*
📲 للاستفسار: *0508001475*

💡 بحث تفصيلي؟ اكتب: *"بحث جديد"*`;

      await sendReply(resultsMessage);
      privateClient.addToHistory(phoneNumber, "bot", resultsMessage);
    } catch (error) {
      console.error("Error searching WordPress:", error);
      const reply = `❌ عذراً، حدث خطأ في البحث. 

جرب مرة ثانية أو تواصل معنا:
📱 *0508001475*`;
      await sendReply(reply);
      privateClient.addToHistory(phoneNumber, "bot", reply);
    }
  }
  // If message doesn't match any pattern, let human handle it (no automatic response)
}

/**
 * Parse requirements from user message
 * Enhanced version with better pattern matching and debugging
 */
/**
 * Parse requirements from user message
 */
function parseRequirements(message) {
  // --- Deduplication Layer ---
  const requestHash = Buffer.from(message).toString("base64").substring(0, 100);
  const now = Date.now();
  if (recentRequestsCache.has(requestHash)) {
    const lastTime = recentRequestsCache.get(requestHash);
    if (now - lastTime < CACHE_TTL) {
      console.log(
        `🚫 [DEDUPE] Skipping identical request received within ${CACHE_TTL}ms`
      );
      return null;
    }
  }
  recentRequestsCache.set(requestHash, now);
  // Cleanup old cache entries occasionally
  if (recentRequestsCache.size > 100) {
    for (const [hash, time] of recentRequestsCache.entries()) {
      if (now - time > CACHE_TTL) recentRequestsCache.delete(hash);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📝 PARSING USER REQUIREMENTS`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Original message:\n${message}`);
  console.log(`${"=".repeat(60)}\n`);

  // Convert Arabic numerals to Western numerals for processing
  const arabicToWestern = (str) => {
    const arabicNumerals = "٠١٢٣٤٥٦٧٨٩";
    const westernNumerals = "0123456789";
    let result = str;
    for (let i = 0; i < arabicNumerals.length; i++) {
      result = result.replace(
        new RegExp(arabicNumerals[i], "g"),
        westernNumerals[i]
      );
    }
    return result;
  };

  // Convert Arabic words to numbers (ألف = 1000, مليون = 1000000)
  const convertArabicWordsToNumbers = (text) => {
    let result = text;

    // Handle "نصف مليون" = 500000 (before other patterns)
    result = result.replace(/نصف\s*مليون/gi, "500000");

    // Handle "ربع مليون" = 250000
    result = result.replace(/ربع\s*مليون/gi, "250000");

    // Pattern: number + مليون (e.g., "2 مليون" -> 2000000)
    // Do this BEFORE ألف to handle cases like "2.5 مليون"
    result = result.replace(/(\d+\.?\d*)\s*(?:مليون|ملیون)/gi, (match, num) => {
      return String(parseFloat(num) * 1000000);
    });

    // Handle standalone "مليون" without number (means 1 million)
    // This must come AFTER "number + مليون" pattern
    result = result.replace(/(?:^|\s)(?:مليون|ملیون)(?:\s|$)/gi, " 1000000 ");

    // Pattern: number + ألف/الف (e.g., "500 ألف" -> 500000)
    result = result.replace(
      /(\d+\.?\d*)\s*(?:ألف|الف|آلاف|الاف)/gi,
      (match, num) => {
        return String(parseFloat(num) * 1000);
      }
    );

    return result;
  };

  // Normalize the message - convert Arabic numerals to Western
  let normalizedMessage = arabicToWestern(message);

  // Convert Arabic words to numbers
  normalizedMessage = convertArabicWordsToNumbers(normalizedMessage);

  console.log(`🔄 After number conversion:\n${normalizedMessage}\n`);

  // Debug: Check if مليون was converted
  if (message.includes("مليون") && !normalizedMessage.includes("1000000")) {
    console.log(
      `⚠️  WARNING: 'مليون' found in original but not converted to 1000000!`
    );
    console.log(
      `   Original: ${message.substring(
        message.indexOf("مليون") - 20,
        message.indexOf("مليون") + 20
      )}`
    );
    console.log(
      `   After: ${normalizedMessage.substring(
        normalizedMessage.indexOf("مليون") - 20,
        normalizedMessage.indexOf("مليون") + 20
      )}`
    );
  }

  const requirements = {
    clientName: null,
    propertyType: null,
    purpose: null,
    priceMin: null,
    priceMax: null,
    areaMin: null,
    areaMax: null,
    neighborhoods: [],
    contactNumber: null,
    subCategory: null,
    additionalSpecs: null,
  };

  const lowerMsg = normalizedMessage.toLowerCase();

  // Extract client name - Look for name in the second line after "طلب"
  // Pattern: طلب\n[Name]\nنوع العقار...
  const nameMatch = message.match(/^طلب\s*\n\s*([^\n]+)\n/i);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    // Validate it's a name (not a property field)
    if (name && !name.includes(":") && name.length > 2 && name.length < 50) {
      requirements.clientName = name;
      console.log(`✅ Detected client name: ${name}`);
    }
  }

  // Property type detection (prioritize specific types)
  const propertyTypes = [
    "شقة دبلكسية",
    "شقة دبلكس",
    "دبلكس",
    "استراحة",
    "شالية",
    "محطة بنزين",
    "محطة",
    "محل تجاري",
    "محل",
    "مستودع",
    "مزرعة",
    "عمارة",
    "فيلا",
    "بيت",
    "منزل",
    "شقة",
    "أرض",
    "ارض",
  ];

  for (const type of propertyTypes) {
    if (lowerMsg.includes(type)) {
      requirements.propertyType = type;
      console.log(`✅ Detected property type: ${type}`);
      break;
    }
  }

  // Sub-category detection (e.g., "صك")
  // First look for explicit label
  const subCatMatch = normalizedMessage.match(
    /(?:التصنيف الفرعي|التصنيف فرعي|تصنيف فرعي)[:*\s]*([^\n]+)/i
  );
  if (subCatMatch) {
    requirements.subCategory = subCatMatch[1].trim();
    console.log(
      `✅ Detected explicit sub-category: ${requirements.subCategory}`
    );
  } else {
    // Then look for keywords
    const subCategories = ["صك", "*صك"];
    for (const sc of subCategories) {
      if (lowerMsg.includes(sc.toLowerCase())) {
        requirements.subCategory = "صك";
        console.log(`✅ Detected sub-category keyword: صك`);
        break;
      }
    }
  }

  // Purpose (شراء/إيجار or بيع/إيجار) - Enhanced patterns
  if (
    lowerMsg.includes("شراء") ||
    lowerMsg.includes("بيع") ||
    lowerMsg.includes("للبيع")
  ) {
    requirements.purpose = lowerMsg.includes("شراء") ? "شراء" : "بيع";
    console.log(`✅ Detected purpose: ${requirements.purpose}`);
  } else if (
    lowerMsg.includes("إيجار") ||
    lowerMsg.includes("ايجار") ||
    lowerMsg.includes("للإيجار") ||
    lowerMsg.includes(" للإيجار")
  ) {
    requirements.purpose = "إيجار";
    console.log(`✅ Detected purpose: إيجار`);
  }

  // Extract phone number FIRST (before parsing other numbers)
  const phoneMatch = normalizedMessage.match(/(\+?\d{10,13}|05\d{8})/);
  if (phoneMatch) {
    requirements.contactNumber = phoneMatch[0];
    console.log(`✅ Detected contact: ${phoneMatch[0]}`);
  }

  // Extract price range - Enhanced with number extraction
  let priceLineMatch = normalizedMessage.match(
    /(?:السعر|حدود السعر|السعر المطلوب|حدود كم السعر)[:\s*]*([^\n]+)/i
  );

  // If not found, try alternative pattern
  if (!priceLineMatch) {
    priceLineMatch = normalizedMessage.match(/(?:من|السعر)\s*(\d+[^\n]*)/i);
  }

  if (priceLineMatch) {
    const priceLine = priceLineMatch[1].trim();
    console.log(`📊 Price line found: "${priceLine}"`);

    // Extract min and max prices from patterns like:
    // "من 500000 إلى 1000000"
    // "500000 - 1000000"
    // "500000"
    const rangeMatch = priceLine.match(/(\d+)\s*(?:إلى|الى|-|حتى)\s*(\d+)/);
    if (rangeMatch) {
      requirements.priceMin = parseInt(rangeMatch[1]);
      requirements.priceMax = parseInt(rangeMatch[2]);
      console.log(
        `✅ Detected price range: ${requirements.priceMin} - ${requirements.priceMax}`
      );
    } else {
      // Single price - try to extract it
      const singlePriceMatch = priceLine.match(/(\d+)/);
      if (singlePriceMatch) {
        const price = parseInt(singlePriceMatch[1]);
        // If it's a single price, treat it as max
        requirements.priceMin = 0;
        requirements.priceMax = price;
        console.log(`✅ Detected max price: ${price}`);
      }
    }
  } else {
    console.log(`⚠️  No price detected`);
  }

  // Extract area - Enhanced patterns with range support
  let areaMatch = normalizedMessage.match(
    /(?:المساحة|المساحه)[^:]*:[*\s]*(\d+(?:\s*(?:إلى|الى|-|حتى)\s*\d+)?)/i
  );

  // Try to match area in parentheses
  if (!areaMatch) {
    areaMatch = normalizedMessage.match(
      /(?:المساحة|المساحه)[^(]*\((\d+(?:\s*(?:إلى|الى|-|حتى)\s*\d+)?)/i
    );
  }

  // Try to find numbers near "المساحة" keyword (more flexible)
  if (!areaMatch) {
    const areaSection = normalizedMessage.match(
      /(?:المساحة|المساحه)[^\n]*?(\d{2,4}(?:\s*(?:إلى|الى|-|حتى)\s*\d{2,4})?)/i
    );
    if (areaSection) {
      areaMatch = areaSection;
    }
  }

  // Alternative pattern: just numbers followed by متر (as last resort)
  if (!areaMatch) {
    areaMatch = normalizedMessage.match(/(\d{2,4})\s*(?:متر|م²|م)/);
  }

  if (areaMatch) {
    const areaText = areaMatch[1];
    console.log(`📊 Area text found: "${areaText}"`);

    // Check for range pattern
    const areaRangeMatch = areaText.match(/(\d+)\s*(?:إلى|الى|-|حتى)\s*(\d+)/);
    if (areaRangeMatch) {
      const min = parseInt(areaRangeMatch[1]);
      const max = parseInt(areaRangeMatch[2]);
      // Validate they're reasonable area values (10-50000 m²)
      if (min >= 10 && min <= 50000 && max >= 10 && max <= 50000 && min < max) {
        requirements.areaMin = min;
        requirements.areaMax = max;
        console.log(`✅ Detected area range: ${min} - ${max} m²`);
      } else {
        console.log(
          `⚠️  Invalid area range: ${min} - ${max} (out of bounds or min >= max)`
        );
      }
    } else {
      // Single area value
      const areaSingleMatch = areaText.match(/(\d+)/);
      if (areaSingleMatch) {
        const area = parseInt(areaSingleMatch[1]);
        // Make sure it's a reasonable area (not phone number: 10-10000 m²)
        // Make sure it's a reasonable area (not phone number: 10-10000 m²)
        if (area >= 10 && area <= 10000) {
          // Reverting to legacy behavior: 0 -> target, as per user request to follow the "old way"
          requirements.areaMin = 0;
          requirements.areaMax = area;
          console.log(`✅ Detected max area (legacy): ${area}m²`);
        } else {
          console.log(
            `⚠️  Invalid area value: ${area} (out of reasonable bounds)`
          );
        }
      }
    }
  } else {
    console.log(`⚠️  No area detected`);
  }

  // Extract neighborhoods - Dynamic extraction from user input
  // Look for the "الأحياء المفضلة:" or "الحي:" or "الأحياء:" section
  const neighborhoodMatch = normalizedMessage.match(
    /(?:الأحياء المفضلة|الأحياء المفضله|الأحياء|الحي)[:*\s]*([^\n]+)/i
  );

  if (neighborhoodMatch) {
    const neighborhoods = areaNormalizer.extractNeighborhoods(
      neighborhoodMatch[1]
    );

    if (neighborhoods.length > 0) {
      requirements.neighborhoods = neighborhoods;
      console.log(
        `✅ Detected ${neighborhoods.length} neighborhood(s) via areaNormalizer:`
      );
      neighborhoods.forEach((n, idx) => console.log(`   ${idx + 1}. ${n}`));
    } else {
      console.log(
        `⚠️  Found neighborhood section but couldn't extract valid names`
      );
    }
  } else {
    console.log(`⚠️  No neighborhoods detected`);
  }

  // Store full message as additional specs
  requirements.additionalSpecs = normalizedMessage;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 PARSING SUMMARY:`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Client Name: ${requirements.clientName || "❌ Not detected"}`);
  console.log(
    `Property Type: ${requirements.propertyType || "❌ Not detected"}`
  );
  console.log(`Purpose: ${requirements.purpose || "❌ Not detected"}`);
  console.log(
    `Price Range: ${
      requirements.priceMin !== null && requirements.priceMax !== null
        ? `${requirements.priceMin.toLocaleString()} - ${requirements.priceMax.toLocaleString()} SAR`
        : "❌ Not detected"
    }`
  );
  console.log(
    `Area Range: ${
      requirements.areaMin !== null && requirements.areaMax !== null
        ? `${requirements.areaMin} - ${requirements.areaMax} m²`
        : "❌ Not detected"
    }`
  );
  console.log(
    `Neighborhoods: ${
      requirements.neighborhoods.length > 0
        ? requirements.neighborhoods.join(", ")
        : "❌ Not detected"
    }`
  );
  console.log(`Contact: ${requirements.contactNumber || "❌ Not detected"}`);
  console.log(`${"=".repeat(60)}\n`);

  return requirements;
}

/**
 * Format requirements summary for confirmation
 * Enhanced to show what was detected and provide helpful feedback
 */
function formatRequirementsSummary(requirements) {
  let summary = [];
  let missingFields = [];

  if (requirements.propertyType) {
    summary.push(`🏠 نوع العقار: ${requirements.propertyType}`);
  } else {
    summary.push(`🏠 نوع العقار: ❌ لم يتم تحديده`);
    missingFields.push("نوع العقار");
  }

  if (requirements.purpose) {
    summary.push(`📋 الغرض: ${requirements.purpose}`);
  } else {
    summary.push(`📋 الغرض: ❌ لم يتم تحديده`);
    missingFields.push("الغرض");
  }

  if (requirements.priceMin !== null && requirements.priceMax !== null) {
    summary.push(
      `💰 السعر: من ${requirements.priceMin.toLocaleString()} إلى ${requirements.priceMax.toLocaleString()} ريال`
    );
  } else {
    summary.push(`💰 السعر: لم يتم تحديده (يمكن إضافته)`);
  }

  if (requirements.areaMin !== null && requirements.areaMax !== null) {
    summary.push(
      `📏 المساحة: من ${requirements.areaMin} إلى ${requirements.areaMax} متر مربع`
    );
  } else {
    summary.push(`📏 المساحة: لم يتم تحديدها (يمكن إضافتها)`);
  }

  if (requirements.neighborhoods && requirements.neighborhoods.length > 0) {
    summary.push(`📍 الأحياء: ${requirements.neighborhoods.join("، ")}`);
  } else {
    summary.push(`📍 الأحياء: لم يتم تحديدها (يمكن إضافتها)`);
  }

  if (requirements.contactNumber) {
    summary.push(`📞 رقم التواصل: ${requirements.contactNumber}`);
  }

  // Add helpful note if critical fields are missing
  if (missingFields.length > 0) {
    summary.push(`\n⚠️ ملاحظة: بعض المعلومات لم يتم اكتشافها تلقائياً`);
    summary.push(`يمكنك الموافقة على البحث أو إعادة إدخال البيانات بشكل أوضح`);
  }

  return summary.join("\n") || "المعلومات المدخلة";
}

/**
 * Search for properties based on requirements
 * This searches through the saved ads in the database
 * Smart search: prioritizes property type, then neighborhoods, then other criteria
 * Only returns OFFERS (عروض), not REQUESTS (طلب/مطلوب)
 */
async function searchProperties(requirements) {
  try {
    const { getDataPath } = require("../config/dataPath");
    const ADS_FILE = getDataPath("ads.json");

    if (!fs.existsSync(ADS_FILE)) {
      return [];
    }

    const adsData = fs.readFileSync(ADS_FILE, "utf8");
    let ads = JSON.parse(adsData || "[]");

    // Filter ads that are approved or accepted
    ads = ads.filter(
      (ad) =>
        ad.status === "approved" ||
        ad.status === "accepted" ||
        ad.status === "sent"
    );

    // IMPORTANT: Filter out REQUESTS (طلب/مطلوب) - only keep OFFERS (عروض)
    ads = ads.filter((ad) => {
      const text = (ad.text || "").toLowerCase();
      const category = (ad.category || "").toLowerCase();
      const wpData = ad.wpData || {};
      const wpMeta = wpData.meta || {};

      // Check if it's a request
      const isRequest =
        text.includes("مطلوب") ||
        text.includes("طلب") ||
        category.includes("طلب") ||
        (wpMeta.order_type &&
          wpMeta.order_type !== "بيع" &&
          wpMeta.order_type !== "إيجار") ||
        (wpMeta.offer_type && wpMeta.offer_type === "طلب");

      // Also must have WordPress URL to be included
      const hasWordPressUrl = ad.wordpressUrl && ad.wordpressUrl.length > 0;

      return !isRequest && hasWordPressUrl;
    });

    console.log(
      `🔍 Searching from ${ads.length} available OFFERS (عروض) with WordPress URLs`
    );
    console.log(`📋 Requirements:`, requirements);

    // Apply smart filtering with scoring
    let scoredAds = ads.map((ad) => {
      let score = 0;
      const text = (ad.text + " " + (ad.enhancedText || "")).toLowerCase();
      const category = (ad.category || "").toLowerCase();
      const meta = ad.meta || {};
      const wpData = ad.wpData || {};
      const wpMeta = wpData.meta || {};

      // 1. PRIORITY: Property type matching (MOST IMPORTANT)
      if (requirements.propertyType) {
        const type = requirements.propertyType.toLowerCase();

        // Check in category (highest priority)
        if (category.includes(type)) {
          score += 10;
          console.log(`  ✅ ${ad.id}: Category match "${category}" (+10)`);
        }
        // Check in text
        else if (text.includes(type)) {
          score += 8;
          console.log(`  ✅ ${ad.id}: Text match "${type}" (+8)`);
        }
        // Check in WordPress meta
        else if (
          wpMeta.parent_catt &&
          wpMeta.parent_catt.toLowerCase().includes(type)
        ) {
          score += 9;
          console.log(`  ✅ ${ad.id}: WP category match (+9)`);
        }
      }

      // 2. Purpose matching (بيع/شراء vs إيجار)
      if (requirements.purpose && score > 0) {
        const purpose = requirements.purpose.toLowerCase();

        if (purpose === "إيجار" || purpose === "ايجار") {
          if (
            text.includes("ايجار") ||
            text.includes("إيجار") ||
            text.includes("للإيجار")
          ) {
            score += 4;
            console.log(`  ✅ ${ad.id}: Rental match (+4)`);
          }
        } else if (purpose === "شراء" || purpose === "بيع") {
          if (
            text.includes("بيع") ||
            text.includes("للبيع") ||
            text.includes("شراء")
          ) {
            score += 4;
            console.log(`  ✅ ${ad.id}: Sale match (+4)`);
          }
        }
      }

      // 3. Neighborhood matching (if specified)
      if (
        requirements.neighborhoods &&
        requirements.neighborhoods.length > 0 &&
        score > 0
      ) {
        for (const neighborhood of requirements.neighborhoods) {
          if (text.includes(neighborhood.toLowerCase())) {
            score += 5;
            console.log(
              `  ✅ ${ad.id}: Neighborhood match "${neighborhood}" (+5)`
            );
            break;
          }
        }
      }

      // 4. Price range matching (flexible)
      if (requirements.priceRange && score > 0) {
        const reqPrice = parseInt(requirements.priceRange);

        // Try WordPress meta first
        if (wpMeta.price_amount) {
          const adPrice = parseInt(wpMeta.price_amount);
          const ratio = adPrice / reqPrice;

          // Very flexible price matching (0.3x to 3x range)
          if (ratio >= 0.3 && ratio <= 3) {
            score += 3;
            console.log(
              `  ✅ ${ad.id}: Price range match ${adPrice} (~${reqPrice}) (+3)`
            );
          }
        } else {
          // Fallback to text parsing
          const priceMatches = text.match(/\d+/g);
          if (priceMatches) {
            for (const match of priceMatches) {
              const adPrice = parseInt(match);
              // Very flexible range
              if (
                adPrice >= reqPrice * 0.3 &&
                adPrice <= reqPrice * 3 &&
                adPrice >= 10000
              ) {
                score += 2;
                console.log(`  ✅ ${ad.id}: Price in range ${adPrice} (+2)`);
                break;
              }
            }
          }
        }
      }

      // 5. Area matching (flexible)
      if (requirements.area && score > 0) {
        const reqArea = parseInt(requirements.area);

        // Try WordPress meta first
        if (wpMeta.arc_space) {
          const adArea = parseInt(wpMeta.arc_space);
          // Flexible area matching (0.5x to 2x range)
          if (adArea >= reqArea * 0.5 && adArea <= reqArea * 2) {
            score += 2;
            console.log(
              `  ✅ ${ad.id}: Area match ${adArea} (~${reqArea}m²) (+2)`
            );
          }
        } else {
          // Fallback to text parsing
          const areaMatch = text.match(/(\d+)\s*(متر|م)/);
          if (areaMatch) {
            const adArea = parseInt(areaMatch[1]);
            if (adArea >= reqArea * 0.5 && adArea <= reqArea * 2) {
              score += 2;
              console.log(`  ✅ ${ad.id}: Area in range ${adArea}m² (+2)`);
            }
          }
        }
      }

      return { ad, score };
    });

    // Filter: Keep ads with score >= 8 (must have property type match)
    // OR if no results with score >= 8, keep ads with score >= 5
    let results = scoredAds.filter((item) => item.score >= 8);

    if (results.length === 0) {
      console.log(`⚠️ No perfect matches, relaxing criteria...`);
      results = scoredAds.filter((item) => item.score >= 5);
    }

    // If still no results, just show recent ads of the same type
    if (results.length === 0 && requirements.propertyType) {
      console.log(
        `⚠️ No scored matches, showing recent ads of type "${requirements.propertyType}"...`
      );
      results = scoredAds.filter((item) => item.score > 0);
    }

    // Sort by score (highest first), then by timestamp (newest first)
    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.ad.timestamp - a.ad.timestamp;
    });

    // Extract ads from scored results
    const finalResults = results.slice(0, 10).map((item) => item.ad);

    console.log(`✅ Found ${finalResults.length} matching properties`);
    if (finalResults.length > 0) {
      console.log(`   Top result score: ${results[0].score}`);
    }

    return finalResults;
  } catch (error) {
    console.error("❌ Error searching properties:", error);
    return [];
  }
}

/**
 * Send property offer as a message
 * Sends organized message with title and WordPress link only
 * @param {object} ad - The ad object from database
 * @param {function} sendReply - Function to send text message
 */
async function sendPropertyOffer(ad, sendReply) {
  try {
    // Get title from WordPress data or generate from text
    let title = "";

    if (ad.wpData && ad.wpData.title) {
      title = ad.wpData.title;
    } else {
      // Fallback: generate title from first line of text
      const firstLine = (ad.text || "")
        .split("\n")[0]
        .replace(/[*~#]/g, "")
        .trim();
      title = firstLine.substring(0, 100);
    }

    // Get WordPress URL (should always exist due to filter)
    const wpUrl = ad.wordpressUrl || ad.wordpressFullUrl || "";

    // Format organized message: Title + Link
    const message = `🏠 *${title}*\n\n🔗 ${wpUrl}`;

    await sendReply(message);
    console.log(`✅ Property sent: ${ad.id}`);
  } catch (error) {
    console.error("❌ Error sending property offer:", error);
  }
}

/**
 * Check if message is from private chat (not group)
 */
function isPrivateChat(remoteJid) {
  return remoteJid && remoteJid.endsWith("@s.whatsapp.net");
}

/**
 * Extract phone number from JID
 */
function extractPhoneNumber(jid) {
  return jid.split("@")[0];
}

module.exports = {
  handlePrivateMessage,
  isPrivateChat,
  extractPhoneNumber,
  parseRequirements,
  formatPostAsMessage,
  isDuplicateByDetails,
};
