/**
 * WordPress Post Management Service
 * Handles fetching, editing, and deleting WordPress posts via REST API
 * Supports both Masaak (masaak.com) and Hasak (hsaak.com)
 */

const axios = require("axios");
const websiteConfig = require("../config/website.config");

// Axios timeout for WordPress requests (30 seconds)
const WP_AXIOS_TIMEOUT = 30000;

/**
 * Parse WordPress URL to extract website and slug
 * @param {string} url - WordPress post URL
 * @returns {Object|null} { website: 'masaak'|'hasak', slug: string } or null if invalid
 */
function parseWordPressUrl(url) {
  if (!url) return null;

  try {
    // Clean the URL
    const cleanUrl = url.trim();

    // Check for Masaak
    if (cleanUrl.includes("masaak.com")) {
      const match = cleanUrl.match(/masaak\.com\/([^\/\s?#]+)/);
      if (match && match[1]) {
        // Decode the slug if it's URL encoded
        const slug = decodeURIComponent(match[1]);
        return { website: "masaak", slug };
      }
    }

    // Check for Hasak
    if (cleanUrl.includes("hsaak.com")) {
      const match = cleanUrl.match(/hsaak\.com\/([^\/\s?#]+)/);
      if (match && match[1]) {
        const slug = decodeURIComponent(match[1]);
        return { website: "hasak", slug };
      }
    }

    return null;
  } catch (error) {
    console.error("❌ Error parsing WordPress URL:", error.message);
    return null;
  }
}

/**
 * Detect if a message contains a WordPress URL
 * @param {string} message - Message text
 * @returns {Object|null} Parsed URL info or null
 */
function detectWordPressUrl(message) {
  if (!message) return null;

  // Look for URLs in the message
  const urlPattern = /https?:\/\/(?:www\.)?(?:masaak\.com|hsaak\.com)\/[^\s]+/i;
  const match = message.match(urlPattern);

  if (match) {
    return parseWordPressUrl(match[0]);
  }

  return null;
}

/**
 * Get WordPress post by slug
 * @param {string} website - 'masaak' or 'hasak'
 * @param {string} slug - Post slug (URL-encoded Arabic text)
 * @returns {Object|null} Post data or null if not found
 */
async function getPostBySlug(website, slug) {
  const config = websiteConfig.getWebsite(website);
  if (!config) {
    throw new Error(`Unknown website: ${website}`);
  }

  try {
    // URL encode the slug for the API request
    const encodedSlug = encodeURIComponent(slug);
    const apiUrl = `${config.url}/wp-json/wp/v2/posts?slug=${encodedSlug}`;

    console.log(`📡 Fetching post from ${website}: ${apiUrl}`);

    const response = await axios.get(apiUrl, {
      timeout: WP_AXIOS_TIMEOUT,
      headers: {
        "Accept": "application/json",
      },
    });

    if (response.data && response.data.length > 0) {
      const post = response.data[0];
      console.log(`✅ Found post: ${post.title.rendered} (ID: ${post.id})`);
      return post;
    }

    console.log(`⚠️ No post found with slug: ${slug}`);
    return null;
  } catch (error) {
    console.error(`❌ Error fetching post from ${website}:`, error.message);
    throw error;
  }
}

/**
 * Delete a WordPress post
 * @param {string} website - 'masaak' or 'hasak'
 * @param {number} postId - Post ID to delete
 * @returns {boolean} True if deleted successfully
 */
async function deletePost(website, postId) {
  const config = websiteConfig.getWebsite(website);
  if (!config) {
    throw new Error(`Unknown website: ${website}`);
  }

  try {
    const apiUrl = `${config.url}/wp-json/wp/v2/posts/${postId}?force=true`;
    const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");

    console.log(`🗑️ Deleting post ${postId} from ${website}...`);

    const response = await axios.delete(apiUrl, {
      timeout: WP_AXIOS_TIMEOUT,
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/json",
      },
    });

    if (response.status === 200) {
      console.log(`✅ Post ${postId} deleted successfully from ${website}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`❌ Error deleting post ${postId} from ${website}:`, error.message);
    throw error;
  }
}

/**
 * Update a WordPress post
 * @param {string} website - 'masaak' or 'hasak'
 * @param {number} postId - Post ID to update
 * @param {Object} updateData - Fields to update { title?, content? }
 * @returns {Object} Updated post data
 */
async function updatePost(website, postId, updateData) {
  const config = websiteConfig.getWebsite(website);
  if (!config) {
    throw new Error(`Unknown website: ${website}`);
  }

  try {
    const apiUrl = `${config.url}/wp-json/wp/v2/posts/${postId}`;
    const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");

    console.log(`📝 Updating post ${postId} on ${website}...`);

    const response = await axios.post(apiUrl, updateData, {
      timeout: WP_AXIOS_TIMEOUT,
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    });

    if (response.status === 200) {
      console.log(`✅ Post ${postId} updated successfully on ${website}`);
      return response.data;
    }

    throw new Error(`Unexpected response: ${response.status}`);
  } catch (error) {
    console.error(`❌ Error updating post ${postId} on ${website}:`, error.message);
    throw error;
  }
}

/**
 * Strip HTML tags from content
 * @param {string} html - HTML content
 * @returns {string} Plain text
 */
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, "-")
    .replace(/&#8217;/g, "'")
    .replace(/&hellip;/g, "...")
    .trim();
}

/**
 * Format post summary for WhatsApp display
 * @param {Object} post - WordPress post object
 * @param {string} website - 'masaak' or 'hasak'
 * @returns {string} Formatted message
 */
function formatPostSummary(post, website) {
  const config = websiteConfig.getWebsite(website);
  const siteName = config.name || website;
  
  const title = stripHtml(post.title?.rendered || "بدون عنوان");
  const date = new Date(post.date).toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  
  return `📄 *المقال الموجود:*

📌 *العنوان:* ${title}
🌐 *الموقع:* ${siteName}
📅 *تاريخ النشر:* ${date}
🔗 *الرابط:* ${post.link}

━━━━━━━━━━━━━━━━━━━━

⚙️ *الإجراءات المتاحة:*
1️⃣ حذف المقال - ارسل *"1"* أو *"حذف"*
2️⃣ تعديل المقال - ارسل *"2"* أو *"تعديل"*
3️⃣ إلغاء - ارسل *"3"* أو *"إلغاء"*`;
}

/**
 * Get editable fields configuration based on website
 * @param {string} website - 'masaak' or 'hasak'
 * @returns {Array} Array of editable field definitions
 */
function getEditableFields(website) {
  // Common fields for both websites
  const commonFields = [
    { key: "title", label: "العنوان", type: "post", required: true },
    { key: "content", label: "المحتوى", type: "post", required: false },
    { key: "phone_number", label: "رقم الهاتف", type: "meta", required: true },
    { key: "City", label: "المدينة", type: "meta", required: false },
    { key: "location", label: "الموقع/الحي", type: "meta", required: false },
    { key: "youtube_link", label: "رابط يوتيوب", type: "meta", required: false },
  ];

  // Masaak-specific fields (real estate)
  if (website === "masaak") {
    return [
      ...commonFields,
      { key: "owner_name", label: "اسم المالك", type: "meta", required: false },
      { key: "price_amount", label: "السعر", type: "meta", required: true },
      { key: "price_method", label: "طريقة الدفع", type: "meta", required: false },
      { key: "arc_space", label: "المساحة", type: "meta", required: true },
      { key: "order_type", label: "نوع العرض", type: "meta", required: false },
      { key: "parent_catt", label: "التصنيف الرئيسي", type: "meta", required: false },
      { key: "sub_catt", label: "التصنيف الفرعي", type: "meta", required: false },
      { key: "google_location", label: "موقع قوقل", type: "meta", required: false },
    ];
  }

  // Hasak-specific fields (events/marketplace)
  if (website === "hasak") {
    return [
      ...commonFields,
      { key: "whatsapp_number", label: "رقم الواتساب", type: "meta", required: false },
      { key: "Price", label: "السعر", type: "meta", required: false },
      { key: "google_url", label: "رابط قوقل", type: "meta", required: false },
    ];
  }

  return commonFields;
}

/**
 * Format post content for editing (copyable format) - Enhanced version
 * Shows all metadata organized by sections
 * @param {Object} post - WordPress post object
 * @param {string} website - 'masaak' or 'hasak'
 * @returns {Array} Array of messages to send
 */
function formatPostForEditing(post, website = "masaak") {
  const meta = post.meta || {};
  const messages = [];
  
  // Header message with instructions
  messages.push(`✏️ *تعديل المقال*

📋 *البيانات الحالية معروضة أدناه*
انسخ الحقل المطلوب تعديله، عدّله، ثم أرسله.

💡 *ملاحظة:* يمكنك تعديل أكثر من حقل

━━━━━━━━━━━━━━━━━━━━`);

  // Section 1: Basic Info
  const title = stripHtml(post.title?.rendered || "");
  const content = stripHtml(post.content?.rendered || "");
  
  let basicInfo = `📌 *البيانات الأساسية:*

▫️ *العنوان:*`;
  messages.push(basicInfo);
  
  messages.push(`عنوان:
${title}`);

  // Section 2: Property/Item Details (Masaak specific)
  if (website === "masaak") {
    const priceAmount = meta.price_amount || "";
    const priceMethod = meta.price_method || "";
    const area = meta.arc_space || "";
    const orderType = meta.order_type || meta.offer_type || "";
    const parentCat = meta.parent_catt || meta.arc_category || "";
    const subCat = meta.sub_catt || meta.arc_subcategory || "";
    
    let propertyDetails = `
━━━━━━━━━━━━━━━━━━━━

🏠 *تفاصيل العقار:*`;
    messages.push(propertyDetails);
    
    if (priceAmount) {
      messages.push(`سعر:
${priceAmount}`);
    }
    
    if (area) {
      messages.push(`مساحة:
${area}`);
    }
    
    if (orderType) {
      messages.push(`نوع_العرض:
${orderType}`);
    }
    
    if (priceMethod) {
      messages.push(`طريقة_الدفع:
${priceMethod}`);
    }
    
    if (parentCat) {
      messages.push(`التصنيف:
${parentCat}${subCat ? ` - ${subCat}` : ""}`);
    }
  }

  // Section 3: Location Info
  const city = meta.City || meta.before_City || "";
  const location = meta.location || "";
  const googleLocation = meta.google_location || meta.google_url || "";
  
  if (city || location || googleLocation) {
    let locationInfo = `
━━━━━━━━━━━━━━━━━━━━

📍 *معلومات الموقع:*`;
    messages.push(locationInfo);
    
    if (city) {
      messages.push(`مدينة:
${city}`);
    }
    
    if (location && location !== "لم يذكر") {
      messages.push(`موقع:
${location}`);
    }
    
    if (googleLocation) {
      messages.push(`رابط_قوقل:
${googleLocation}`);
    }
  }

  // Section 4: Contact Info
  const ownerName = meta.owner_name || "";
  const phoneNumber = meta.phone_number || "";
  const whatsappNumber = meta.whatsapp_number || "";
  
  let contactInfo = `
━━━━━━━━━━━━━━━━━━━━

📞 *معلومات التواصل:*`;
  messages.push(contactInfo);
  
  if (ownerName) {
    messages.push(`اسم_المالك:
${ownerName}`);
  }
  
  if (phoneNumber) {
    messages.push(`هاتف:
${phoneNumber}`);
  }
  
  if (whatsappNumber) {
    messages.push(`واتساب:
${whatsappNumber}`);
  }

  // Section 5: Content (if not too long)
  if (content && content.length < 2000) {
    messages.push(`
━━━━━━━━━━━━━━━━━━━━

📝 *المحتوى:*`);
    
    messages.push(`محتوى:
${content}`);
  } else if (content) {
    messages.push(`
━━━━━━━━━━━━━━━━━━━━

📝 *المحتوى:* (طويل جداً - ${content.length} حرف)
لتعديل المحتوى، ارسل "محتوى:" متبوعاً بالمحتوى الجديد`);
  }

  // Section 6: YouTube link
  const youtubeLink = meta.youtube_link || "";
  if (youtubeLink) {
    messages.push(`
━━━━━━━━━━━━━━━━━━━━

🎥 *رابط يوتيوب:*`);
    messages.push(`يوتيوب:
${youtubeLink}`);
  }

  // Final instructions
  messages.push(`
━━━━━━━━━━━━━━━━━━━━

⚙️ *التعليمات:*
1️⃣ انسخ الحقل المطلوب تعديله
2️⃣ عدّل القيمة بعد النقطتين
3️⃣ أرسل الحقل المعدّل

✅ للإنهاء ارسل *"تم"*
❌ للإلغاء ارسل *"إلغاء"*`);

  return messages;
}

/**
 * Parse edit message from user - Enhanced version
 * Supports multiple field types
 * @param {string} message - User message with edit
 * @returns {Object|null} { field: string, metaKey: string|null, value: string, type: 'post'|'meta' } or null
 */
function parseEditMessage(message) {
  if (!message) return null;
  
  const text = message.trim();
  
  // Field mappings: Arabic label -> { metaKey, type }
  const fieldMappings = {
    "عنوان": { metaKey: null, type: "post", postField: "title" },
    "محتوى": { metaKey: null, type: "post", postField: "content" },
    "هاتف": { metaKey: "phone_number", type: "meta" },
    "واتساب": { metaKey: "whatsapp_number", type: "meta" },
    "سعر": { metaKey: "price_amount", type: "meta" },
    "مساحة": { metaKey: "arc_space", type: "meta" },
    "مدينة": { metaKey: "City", type: "meta" },
    "موقع": { metaKey: "location", type: "meta" },
    "اسم_المالك": { metaKey: "owner_name", type: "meta" },
    "نوع_العرض": { metaKey: "order_type", type: "meta" },
    "طريقة_الدفع": { metaKey: "price_method", type: "meta" },
    "رابط_قوقل": { metaKey: "google_location", type: "meta" },
    "يوتيوب": { metaKey: "youtube_link", type: "meta" },
    "التصنيف": { metaKey: "parent_catt", type: "meta" },
  };
  
  // Try to match each field
  for (const [label, mapping] of Object.entries(fieldMappings)) {
    if (text.startsWith(`${label}:`)) {
      const value = text.replace(new RegExp(`^${label}:\\s*`, "i"), "").trim();
      if (value) {
        return {
          field: label,
          metaKey: mapping.metaKey,
          postField: mapping.postField || null,
          value: value,
          type: mapping.type,
        };
      }
    }
  }
  
  return null;
}

module.exports = {
  parseWordPressUrl,
  detectWordPressUrl,
  getPostBySlug,
  deletePost,
  updatePost,
  formatPostSummary,
  formatPostForEditing,
  parseEditMessage,
  getEditableFields,
  stripHtml,
};
