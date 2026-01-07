const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const { getDataPath } = require("../config/dataPath");
const apiKeyManager = require("./apiKeyManager");

const SETTINGS_FILE = getDataPath("settings.json");

// Re-export from apiKeyManager for backward compatibility
const {
  PROVIDERS,
  MODEL_CONFIG,
  loadSettings,
  saveSettings,
  getApiKeysStatus,
  getActiveApiKey: getActiveApiKeyInternal,
  switchToNextKey,
  updateKeyStats: updateKeyStatsInternal,
  retryWithKeyRotation,
  selectProvider,
  getModelConfig,
} = apiKeyManager;

// Backward-compatible wrapper for getActiveApiKey (defaults to Gemini)
function getActiveApiKey() {
  return getActiveApiKeyInternal(PROVIDERS.GEMINI);
}

// Backward-compatible wrapper for switchToNextApiKey (defaults to Gemini)
function switchToNextApiKey() {
  return switchToNextKey(PROVIDERS.GEMINI);
}

// Backward-compatible wrapper for updateKeyStats (defaults to Gemini)
function updateKeyStats(keyIndex, error = null, enabledKeys = null) {
  if (enabledKeys && enabledKeys[keyIndex]) {
    updateKeyStatsInternal(PROVIDERS.GEMINI, enabledKeys[keyIndex].id, error);
  }
}

/**
 * Execute a prompt with the appropriate AI provider
 * @param {string} apiKey - The API key to use
 * @param {string} provider - The provider type ('gemini' or 'gpt')
 * @param {string} prompt - The prompt to send
 * @param {Object} options - Optional configuration (model, temperature, maxTokens)
 * @returns {Promise<string>} The AI response text
 */
async function executePromptWithProvider(
  apiKey,
  provider,
  prompt,
  options = {}
) {
  if (provider === PROVIDERS.GPT) {
    // Use OpenAI API
    const modelConfig = getModelConfig(
      PROVIDERS.GPT,
      options.modelType || "efficient"
    );

    const response = await axios.post(
      `${modelConfig.endpoint}/chat/completions`,
      {
        model: options.model || modelConfig.model,
        messages: [
          {
            role: "system",
            content:
              options.systemPrompt ||
              "You are a helpful assistant specialized in analyzing Arabic real estate advertisements. Always respond in the exact format requested.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: options.maxTokens || 4000,
        temperature: options.temperature || 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    return response.data.choices[0].message.content;
  } else {
    // Use Gemini API (default)
    const modelConfig = getModelConfig(
      PROVIDERS.GEMINI,
      options.modelType || "efficient"
    );
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: options.model || modelConfig.model,
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }
}

/**
 * Execute AI request with GPT provider
 * @param {string} prompt - The prompt to send
 * @param {Object} options - Optional configuration
 */
async function executeWithGPT(prompt, options = {}) {
  const axios = require("axios");

  return retryWithKeyRotation(
    PROVIDERS.GPT,
    async (apiKey, keyData, keyIndex) => {
      const modelConfig = getModelConfig(
        PROVIDERS.GPT,
        options.modelType || "efficient"
      );

      const response = await axios.post(
        `${modelConfig.endpoint}/chat/completions`,
        {
          model: modelConfig.model,
          messages: [
            {
              role: "system",
              content:
                options.systemPrompt ||
                "You are a helpful assistant specialized in analyzing Arabic real estate advertisements.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          max_tokens: options.maxTokens || 2000,
          temperature: options.temperature || 0.3,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );

      return response.data.choices[0].message.content;
    },
    options.operationName || "GPT Request",
    options.maxRetries
  );
}

/**
 * Execute AI request with Gemini provider
 * @param {string} prompt - The prompt to send
 * @param {Object} options - Optional configuration
 */
async function executeWithGemini(prompt, options = {}) {
  return retryWithKeyRotation(
    PROVIDERS.GEMINI,
    async (apiKey, keyData, keyIndex) => {
      const modelConfig = getModelConfig(
        PROVIDERS.GEMINI,
        options.modelType || "efficient"
      );
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelConfig.model });

      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    },
    options.operationName || "Gemini Request",
    options.maxRetries
  );
}

/**
 * Execute AI request with automatic provider selection
 * @param {string} prompt - The prompt to send
 * @param {Object} options - Optional configuration including preferredProvider
 */
async function executeAIRequest(prompt, options = {}) {
  const provider = selectProvider(options.preferredProvider);

  if (!provider) {
    throw new Error("No AI providers available. Please add API keys.");
  }

  console.log(`🤖 Using ${provider.toUpperCase()} provider for AI request`);

  if (provider === PROVIDERS.GPT) {
    return executeWithGPT(prompt, options);
  } else {
    return executeWithGemini(prompt, options);
  }
}

// -------------------------
// Retry Mechanism with API Key Rotation (Legacy - for backward compatibility)
// Uses the new apiKeyManager under the hood
// Now with automatic fallback to GPT when Gemini fails
// -------------------------
async function retryWithApiKeyRotation(
  operation,
  operationName = "AI operation",
  maxRetries = null
) {
  const { getEnabledKeysByProvider } = require("./apiKeyManager");

  // Get available keys for each provider
  const geminiKeys = getEnabledKeysByProvider(PROVIDERS.GEMINI);
  const gptKeys = getEnabledKeysByProvider(PROVIDERS.GPT);

  console.log(
    `🔍 Available API keys - Gemini: ${geminiKeys.length}, GPT: ${gptKeys.length}`
  );

  // Determine which providers to try
  const providersToTry = [];
  if (geminiKeys.length > 0) providersToTry.push(PROVIDERS.GEMINI);
  if (gptKeys.length > 0) providersToTry.push(PROVIDERS.GPT);

  if (providersToTry.length === 0) {
    throw new Error(
      "❌ No enabled API keys available for any provider. Please add API keys in the dashboard."
    );
  }

  let lastError = null;

  // Try each provider in order
  for (const provider of providersToTry) {
    try {
      console.log(
        `🔄 Trying ${provider.toUpperCase()} provider for ${operationName}...`
      );

      const result = await retryWithKeyRotation(
        provider,
        async (apiKey, keyData, keyIndex) => {
          // Call the original operation with apiKey, keyIndex, AND provider for proper API selection
          return operation(apiKey, keyIndex, provider);
        },
        operationName,
        maxRetries
      );

      return result;
    } catch (error) {
      console.warn(
        `⚠️ ${provider.toUpperCase()} failed for ${operationName}: ${
          error.message
        }`
      );
      lastError = error;

      // Continue to next provider if available
      if (providersToTry.indexOf(provider) < providersToTry.length - 1) {
        console.log(`🔄 Falling back to next provider...`);
      }
    }
  }

  // All providers failed
  throw new Error(
    `❌ All AI providers failed for ${operationName}. Last error: ${
      lastError?.message || "Unknown error"
    }`
  );
}

// -------------------------
// Smart Phone Number Extraction
// -------------------------
function extractPhoneNumbers(text) {
  const phoneNumbers = [];

  // Remove all non-digit characters except + for initial cleaning
  const cleanText = text.replace(/[^\d+\s]/g, " ");

  // Pattern 1: Saudi numbers starting with 05 (10 digits)
  const pattern1 = /\b(05\d{8})\b/g;
  let matches = cleanText.matchAll(pattern1);
  for (const match of matches) {
    const number = match[1];
    phoneNumbers.push({
      original: number,
      normalized: "966" + number.substring(1), // Convert 05xxxxxxxx to 9665xxxxxxxx
      confidence: 1.0,
      type: "saudi_mobile",
    });
  }

  // Pattern 2: Saudi numbers starting with 966 (12 digits)
  const pattern2 = /\b(9665\d{8})\b/g;
  matches = cleanText.matchAll(pattern2);
  for (const match of matches) {
    const number = match[1];
    // Check if not already added
    if (!phoneNumbers.find((p) => p.normalized === number)) {
      phoneNumbers.push({
        original: number,
        normalized: number,
        confidence: 1.0,
        type: "saudi_mobile_intl",
      });
    }
  }

  // Pattern 3: Numbers with + prefix (+9665xxxxxxxx)
  const pattern3 = /\+?(9665\d{8})\b/g;
  matches = text.matchAll(pattern3);
  for (const match of matches) {
    const number = match[1];
    // Check if not already added
    if (!phoneNumbers.find((p) => p.normalized === number)) {
      phoneNumbers.push({
        original: match[0],
        normalized: number,
        confidence: 1.0,
        type: "saudi_mobile_plus",
      });
    }
  }

  // Pattern 4: Numbers with spaces or dashes (055 123 4567 or 055-123-4567)
  const pattern4 = /\b(05\d)\s*[\s-]?\s*(\d{3})\s*[\s-]?\s*(\d{4})\b/g;
  matches = text.matchAll(pattern4);
  for (const match of matches) {
    const number = match[1] + match[2] + match[3];
    const normalized = "966" + number.substring(1);
    // Check if not already added
    if (!phoneNumbers.find((p) => p.normalized === normalized)) {
      phoneNumbers.push({
        original: match[0],
        normalized: normalized,
        confidence: 0.95,
        type: "saudi_mobile_formatted",
      });
    }
  }

  // Pattern 5: Landline numbers (013xxxxxxx - 9 digits)
  const pattern5 = /\b(01[0-9]\d{7})\b/g;
  matches = cleanText.matchAll(pattern5);
  for (const match of matches) {
    const number = match[1];
    const normalized = "966" + number.substring(1);
    // Check if not already added
    if (!phoneNumbers.find((p) => p.normalized === normalized)) {
      phoneNumbers.push({
        original: number,
        normalized: normalized,
        confidence: 0.9,
        type: "saudi_landline",
      });
    }
  }

  // Sort by confidence and return
  return phoneNumbers.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Fallback keyword-based ad detection when AI is unavailable
 * @param {string} text - The message text to analyze
 * @returns {{isAd: boolean, confidence: number, reason: string}}
 */
function useFallbackDetection(text) {
  console.log("🔧 Using fallback keyword detection...");

  const keywords = [
    // Real estate - primary
    "للبيع",
    "للإيجار",
    "للتقبيل",
    "شقة",
    "شقه",
    "فيلا",
    "عقار",
    "أرض",
    "ارض",
    "محل",
    "مزرعة",
    "مزرعه",
    "بيت",
    "عمارة",
    "عماره",
    "دبلكس",
    "استراحة",
    "استراحه",
    "شاليه",
    "كومباوند",
    // Price indicators
    "ج.م",
    "جنيه",
    "ريال",
    "ألف",
    "مليون",
    "مقدم",
    "اقساط",
    "أقساط",
    "تقسيط",
    "دفعة",
    "السعر",
    "سعر",
    "بسعر",
    // Requests/Offers keywords
    "ابغى ابيع",
    "ابغا ابيع",
    "ابي ابيع",
    "مطلوب",
    "ابحث عن",
    "من عنده",
    "مين عنده",
    "ودي ابيع",
    "ودي اشتري",
    "احتاج",
    "محتاج",
    "دور على",
    "ادور",
    "عايز",
    "حد عنده",
    "تكفون",
    // Services & Business
    "مطعم",
    "كوفيه",
    "كافيه",
    "منتجع",
    "فعالية",
    "فعاليه",
    "نشاط",
    "ترفيه",
    "توصيل",
    "حراج",
    "أسر منتجة",
    "وظيفة",
    // Locations
    "الأحساء",
    "الحسا",
    "التجمع",
    "القاهرة",
    "الرياض",
    "جدة",
    // General ad indicators
    "متوفر",
    "متوفره",
    "يوجد",
    "للاستفسار",
    "للتواصل",
    "عرض",
    "خصم",
  ];

  const textLower = text.toLowerCase();
  let confidence = 0;

  // Check for keywords
  const matchedKeywords = keywords.filter((keyword) =>
    textLower.includes(keyword.toLowerCase())
  );

  if (matchedKeywords.length > 0) {
    confidence += matchedKeywords.length * 15;
  }

  // Check for price patterns (strong indicator)
  const pricePatterns = [
    /\d+[\s,]*\d*[\s,]*\d*\s*(ج\.م|جنيه|ريال|ألف|مليون)/,
    /السعر[\s:]+\d+/,
    /\d+\s*(مقدم|اقساط|دفعة)/,
  ];

  const hasPrice = pricePatterns.some((pattern) => pattern.test(text));
  if (hasPrice) {
    confidence += 30;
  }

  // Check for property + action combination
  const hasProperty = /(شقة|فيلا|بيت|عمارة|أرض|محل|مزرعة)/.test(text);
  const hasAction = /(للبيع|للإيجار|للتقبيل|متوفر|يوجد)/.test(text);

  if (hasProperty && hasAction) {
    confidence += 25;
  }

  confidence = Math.min(95, confidence);
  const isAd = confidence >= 40;

  const reason = isAd
    ? `كشف تلقائي - ${matchedKeywords.length} كلمة مفتاحية ${
        hasPrice ? "+ سعر" : ""
      }`
    : "لا توجد مؤشرات كافية للإعلان";

  return { isAd, confidence, reason };
}

/**
 * Detect if a message is an advertisement
 * @param {string} text - The message text to analyze
 * @param {number} maxRetries - Maximum number of API key retries (default: total enabled keys)
 * @param {number} currentRetry - Current retry attempt (used internally)
 * @returns {Promise<{isAd: boolean, confidence: number, reason: string}>}
 */
async function detectAd(text, maxRetries = null, currentRetry = 0) {
  const settings = loadSettings();
  const enabledKeys = (settings.geminiApiKeys || []).filter((k) => k.enabled);

  if (enabledKeys.length === 0) {
    console.error("❌ No API key available. Using fallback keyword detection.");
    return useFallbackDetection(text);
  }

  try {
    return await retryWithApiKeyRotation(
      async (apiKey, keyIndex, provider) => {
        const prompt = `You are an expert at detecting real estate and business advertisements. Analyze if the following text is an advertisement.

Text: "${text}"

🎯 CRITICAL: Be SMART and PRACTICAL in your analysis!

✅ THIS IS DEFINITELY AN AD if it contains:
1. **PRICE with property details** (e.g., "14,280,000 ج.م شقة" = clearly selling apartment)
2. **Payment terms** (مقدم، اقساط، تقسيط، كاش، سعر)
3. **Property + Action** (شقة للبيع، فيلا للإيجار، محل للتقبيل)
4. **Specific location + property type** (شقة في التجمع، فيلا بالأحساء)
5. **Compound/Project names** (كومباوند، هايد بارك، القاهرة الجديدة)
6. **Area/Size + property** (150 متر شقة، 500 متر أرض)
7. **Contact info + offer** (للتواصل + متوفر شقة)
8. **Restaurant/Service with location** (مطعم في الأحساء، توصيل متاح)
9. **Job posting with salary** (وظيفة براتب)
10. **Event announcement** (فعالية، معرض، حفل)

✅ IMPORTANT: These ARE considered ads (Requests/Offers) - SAUDI DIALECT:
- Someone wanting to SELL: "ابغى ابيع شقة"، "ابي ابيع مكيف"، "ودي ابيع سيارة" → THESE ARE ADS!
- Someone wanting to BUY: "ابغى اشتري فيلا"، "ابي اشتري أرض"، "ودي اشتري بيت"
- Someone requesting/looking for property: "مطلوب شقة"، "ابحث عن فيلا"، "محتاج أرض"، "من عنده بيت"
- Someone asking if anyone has: "حد عنده شقة؟"، "في حد عنده فيلا؟"، "مين عنده أرض؟"، "تكفون حد عنده؟"
- Request keywords: مطلوب، ابحث، احتاج، ابغى، أبغى، ابغا، محتاج، دور على، من عنده، ابي، ودي، تكفون، ياخوان

🚫 BE CAREFUL - These are NOT ads:
- Pure questions: "كم سعر الشقة؟" "أين الموقع؟"
- Greetings only: "السلام عليكم" "صباح الخير"
- General chat: "كيف حالك؟" "شكراً"

🧠 SMART EXAMPLES:

Example 1: "14,280,000 ج.م مقدم 1,428,000 ج.م للبيع شقة استلام سنة بالسعر القديم"
✅ CLEARLY AN AD! Has: price, payment terms (مقدم), property type (شقة), للبيع
Confidence: 95%

Example 2: "شقة 3 غرف في الأحساء 200 ألف"
✅ CLEARLY AN AD! Has: property details, location, price
Confidence: 90%

Example 3: "مطعم جديد افتتح في الأحساء تعالوا جربوا"
✅ CLEARLY AN AD! Has: service type, location, invitation
Confidence: 85%

Example 4: "كم سعر الشقة في التجمع؟"
❌ NOT AN AD - Just asking, not selling
Confidence: 20%

Example 5: "أبحث عن شقة للإيجار"
✅ THIS IS AN AD (Request/Offer type) - Someone actively looking = ad for our system
Confidence: 80%

Example 6: "مطلوب فيلا في الأحساء"
✅ THIS IS AN AD (Request/Offer type) - Request for property
Confidence: 85%

Example 7: "ابغى ابيع هذا المكيف نفس سعر الفاتورة"
✅ THIS IS AN AD (Request/Offer - Saudi dialect) - Someone wants to sell AC
Confidence: 90%

Example 8: "تكفون حد عنده شقة للبيع؟"
✅ THIS IS AN AD (Request/Offer - Saudi dialect) - Asking if anyone has
Confidence: 85%

⚡ PRICE PATTERNS (STRONG AD INDICATORS):
- Numbers with currency: "14,280,000 ج.م", "200 ألف", "500,000 ريال"
- Payment plans: "مقدم", "اقساط", "تقسيط على", "دفعة أولى"
- Price phrases: "السعر", "بسعر", "سعر مغري", "سعر مميز"

🏢 REAL ESTATE KEYWORDS:
شقة، فيلا، بيت، عمارة، أرض، محل، مزرعة، استراحة، شاليه، دبلكس، للبيع، للإيجار، للتقبيل، كومباوند

🍽️ SERVICES KEYWORDS:
مطعم، كوفيه، توصيل، فعالية، منتجع، وظيفة، خدمة

📍 LOCATION KEYWORDS:
الأحساء، الحسا، التجمع، القاهرة الجديدة، الرياض، جدة

Respond ONLY in this exact JSON format:
{"isAd": true/false, "confidence": 0-100, "reason": "brief explanation in Arabic"}
`;

        const responseText = (
          await executePromptWithProvider(apiKey, provider, prompt)
        ).trim();

        // Try to extract JSON from response
        let jsonText = responseText;
        if (responseText.includes("```json")) {
          jsonText =
            responseText.match(/```json\n([\s\S]*?)\n```/)?.[1] || responseText;
        } else if (responseText.includes("```")) {
          jsonText =
            responseText.match(/```\n([\s\S]*?)\n```/)?.[1] || responseText;
        }

        const detection = JSON.parse(jsonText);

        return {
          isAd: detection.isAd || false,
          confidence: detection.confidence || 0,
          reason: detection.reason || "No reason provided",
        };
      },
      "Ad Detection",
      maxRetries
    );
  } catch (error) {
    console.error("Error detecting ad:", error);
    // If all retries failed, use fallback
    console.error(
      `❌ All API key attempts failed. Using fallback keyword detection.`
    );
    return useFallbackDetection(text);
  }
}

/**
 * Enhance/regenerate an advertisement using AI
 * @param {string} originalText - The original ad text
 * @param {number} maxRetries - Maximum number of API key retries (default: total enabled keys)
 * @param {number} currentRetry - Current retry attempt (used internally)
 * @returns {Promise<{enhanced: string, improvements: string[]}>}
 */
async function enhanceAd(originalText, maxRetries = null, currentRetry = 0) {
  const settings = loadSettings();
  const enabledKeys = (settings.geminiApiKeys || []).filter((k) => k.enabled);

  if (enabledKeys.length === 0) {
    console.error("❌ No API key available for enhancement. Using fallback.");
    return enhanceWithSmartEmojis(originalText);
  }

  try {
    return await retryWithApiKeyRotation(
      async (apiKey, keyIndex, provider) => {
        const prompt = `أنت خبير في كتابة إعلانات وسائل التواصل الاجتماعي بأسلوب عصري وجذاب. قم بتحسين وإعادة صياغة الإعلان التالي بشكل إبداعي:

النص الأصلي:
"${originalText}"

⚠️ قواعد مهمة جداً:
1. ❌ لا تستخدم قوالب جاهزة أو تنسيقات ثابتة
2. ❌ لا تضع الإيموجي في أماكن محددة فقط (البداية/النهاية)
3. ✅ وزع الإيموجي بشكل طبيعي في كل أنحاء النص
4. ✅ أعد كتابة الإعلان بالكامل بأسلوب إبداعي وحيوي
5. ✅ استخدم إيموجي متنوعة ومناسبة للسياق في كل جملة تقريباً

📝 التعليمات:
- احتفظ بكل المعلومات المهمة: (الأسعار 💰، الأرقام 📱، المواقع 📍، المساحات 📏، التفاصيل)
- اكتب بأسلوب حماسي وجذاب يناسب السوشيال ميديا
- استخدم اللغة العربية الواضحة والسهلة
- أضف إيموجي ملونة ومتنوعة بين الكلمات والجمل
- اجعل النص يبدو طبيعياً وليس آلياً
- نوّع في الأسلوب حسب نوع الإعلان (عقار، مطعم، خدمة، وظيفة، فعالية، منتج...)

🎨 أمثلة على التنوع المطلوب:
بدلاً من: "شقة للبيع 🏠 3 غرف 💰 السعر"
اكتب مثل: "فرصة رائعة ✨ شقة مميزة 🏠 تتكون من 3 غرف واسعة 🛏️ بسعر مغري 💰"

بدلاً من: "📍 الموقع: الأحساء"  
اكتب مثل: "تقع في قلب الأحساء 📍 في موقع استراتيجي مميز 🌟"

بدلاً من: "☕ مطعم جديد"
اكتب مثل: "افتتاح مطعم جديد 🎉 أطباق شهية 🍽️ ونكهات لا تُقاوم ☕"

أرجع النتيجة بصيغة JSON فقط:
{
  "enhanced": "النص المحسّن مع الإيموجي موزعة طبيعياً في كل أجزاء النص",
  "improvements": ["قائمة بالتحسينات التي أضفتها"]
}`;

        const responseText = (
          await executePromptWithProvider(apiKey, provider, prompt)
        ).trim();

        // Try to extract JSON from response
        let jsonText = responseText;
        if (responseText.includes("```json")) {
          jsonText =
            responseText.match(/```json\n([\s\S]*?)\n```/)?.[1] || responseText;
        } else if (responseText.includes("```")) {
          jsonText =
            responseText.match(/```\n([\s\S]*?)\n```/)?.[1] || responseText;
        }

        const enhancement = JSON.parse(jsonText);

        return {
          enhanced: enhancement.enhanced || originalText,
          improvements: enhancement.improvements || [],
        };
      },
      "Ad Enhancement",
      maxRetries
    );
  } catch (error) {
    console.error("Error enhancing ad:", error);
    // If all retries failed, use fallback
    console.error(
      `❌ All API key attempts failed for enhancement. Using fallback.`
    );
    return enhanceWithSmartEmojis(originalText);
  }
}

/**
 * Smart emoji enhancement fallback when AI fails
 * Adds emojis naturally throughout the text based on keywords
 */
function enhanceWithSmartEmojis(text) {
  let enhanced = text;

  // Keywords and their emoji replacements (add emoji after keyword)
  const emojiMap = {
    // Real estate
    للبيع: "للبيع 🏠",
    للإيجار: "للإيجار 🏡",
    للتقبيل: "للتقبيل 🏪",
    شقة: "شقة 🏢",
    شقه: "شقه 🏢",
    فيلا: "فيلا 🏰",
    بيت: "بيت 🏠",
    عمارة: "عمارة 🏢",
    عماره: "عماره 🏢",
    أرض: "أرض 🌳",
    ارض: "ارض 🌳",
    مزرعة: "مزرعة 🌾",
    مزرعه: "مزرعه 🌾",
    محل: "محل 🏪",
    استراحة: "استراحة 🏖️",
    استراحه: "استراحه 🏖️",
    شاليه: "شاليه 🏝️",
    دبلكس: "دبلكس 🏘️",

    // Location & area
    الموقع: "الموقع 📍",
    موقع: "موقع 📍",
    المساحة: "المساحة 📏",
    مساحة: "مساحة 📏",
    الأحساء: "الأحساء 🌴",
    الحسا: "الحسا 🌴",
    حساك: "حساك 🌟",

    // Price & money
    السعر: "السعر 💰",
    سعر: "سعر 💰",
    ريال: "ريال 💵",
    ألف: "ألف 💸",
    مليون: "مليون 💎",

    // Rooms & features
    غرف: "غرف 🛏️",
    غرفة: "غرفة 🛏️",
    صالة: "صالة 🛋️",
    صاله: "صاله 🛋️",
    مطبخ: "مطبخ 🍳",
    حمام: "حمام 🚿",
    "دورات مياه": "دورات مياه 🚽",
    مسبح: "مسبح 🏊",
    حديقة: "حديقة 🌳",
    حديقه: "حديقه 🌳",
    مواقف: "مواقف 🚗",
    موقف: "موقف 🚗",

    // Food & restaurants
    مطعم: "مطعم 🍽️",
    كوفيه: "كوفيه ☕",
    كافيه: "كافيه ☕",
    كافية: "كافية ☕",
    قهوة: "قهوة ☕",
    طعام: "طعام 🍲",
    أكل: "أكل 🍴",
    وجبات: "وجبات 🍱",
    افتتاح: "افتتاح 🎉",

    // Services
    خدمة: "خدمة ✅",
    خدمات: "خدمات ✅",
    توصيل: "توصيل 🚗",
    فعالية: "فعالية 🎊",
    فعاليه: "فعاليه 🎊",
    نشاط: "نشاط 🎯",
    منتجع: "منتجع 🏖️",
    ترفيه: "ترفيه 🎪",
    ترفيهي: "ترفيهي 🎪",

    // Business & jobs
    وظيفة: "وظيفة 💼",
    وظيفه: "وظيفه 💼",
    عمل: "عمل 👔",
    راتب: "راتب 💵",
    "أسر منتجة": "أسر منتجة 🏺",
    "أسر منتجه": "أسر منتجه 🏺",
    منتج: "منتج 📦",
    منتجات: "منتجات 🛍️",

    // General positive
    جديد: "جديد ✨",
    جديده: "جديده ✨",
    مميز: "مميز ⭐",
    مميزة: "مميزة ⭐",
    مميزه: "مميزه ⭐",
    فاخر: "فاخر 👑",
    فاخرة: "فاخرة 👑",
    فاخره: "فاخره 👑",
    فرصة: "فرصة 🎯",
    فرصه: "فرصه 🎯",
    عرض: "عرض 🔥",
    خصم: "خصم �",
    متوفر: "متوفر ✅",
    يوجد: "يوجد ✔️",
    للاستفسار: "للاستفسار 📞",
    للتواصل: "للتواصل 📱",
    واتساب: "واتساب 💬",
    واتس: "واتس 💬",
  };

  // Apply emoji replacements (only once per keyword to avoid duplicates)
  Object.keys(emojiMap).forEach((keyword) => {
    const regex = new RegExp(`\\b${keyword}\\b`, "g");
    let replaced = false;
    enhanced = enhanced.replace(regex, (match) => {
      if (!replaced && !enhanced.includes(emojiMap[keyword])) {
        replaced = true;
        return emojiMap[keyword];
      }
      return match;
    });
  });

  // If no emojis were added, add a sparkle at the beginning
  if (enhanced === text) {
    enhanced = `✨ ${enhanced}`;
  }

  return {
    enhanced: enhanced,
    improvements: ["تمت إضافة رموز تعبيرية بذكاء حسب المحتوى"],
  };
}

/**
 * Detect property category from text using AI
 * @param {string} text - The message text
 * @returns {Promise<string|null>} - The detected category or null
 */
async function detectCategory(text) {
  try {
    console.log("🤖 Using AI to detect category...");

    const settings = loadSettings();
    const enabledKeys = (settings.geminiApiKeys || []).filter((k) => k.enabled);

    if (enabledKeys.length === 0) {
      console.log("🏷️ No API key available, using fallback detection...");
      return detectCategoryFallback(text);
    }

    return await retryWithApiKeyRotation(
      async (apiKey, keyIndex, provider) => {
        const prompt = `أنت نظام ذكي لتصنيف الإعلانات العقارية وإعلانات منصة حساك (فعاليات، حراج، أسر منتجة، محلات...). قم بتحليل النص التالي وأرجع فقط اسم التصنيف المناسب من القائمة التالية:

  التصنيفات المتاحة (اختر منها فقط حرفيًا):
  - شقة دبلكسية
  - دبلكس
  - محطة بنزين
  - محل تجاري
  - عمارة
  - فيلا
  - بيت
  - شقة
  - مزرعة
  - استراحة
  - شالية
  - مستودع
  - أرض
  - إيجار (لأي عقار للإيجار)
  - طلبات (لأي شخص يطلب أو يبحث عن شيء)
  - وظائف
  - فعاليات
  - خدمات
  - أسر منتجة
  - إعلان تجاري ربحي مميز
  - الفعاليات والانشطة
  - برامج ووظائف
  - توصيل سيارات
  - حراج الحسا
  - فعاليات و أنشطة
  - فعالية مجانية مميزة
  - كوفيهات أو مطاعم
  - مجتمع حساك
  - محلات تجارية
  - مركز ترفيهي
  - منتجعات وإستراحات

النص للتحليل:
"""
${text}
"""

قواعد التصنيف (الأولوية من الأعلى للأسفل):

⚠️ القاعدة الأولى - حراج الحسا (أعلى أولوية للسيارات والمستعمل - تذهب لموقع حساك):
- إذا كان النص يعلن عن بيع أو عرض سيارات/حراج/مستعمل ويحتوي على كلمات مثل: "سيارة"، "سيارات"، "حراج"، "معرض سيارات"، "جمس"، "جيب"، "كامري"، "النترا"، "سوناتا"، "للبيع سيارة"
  → أرجع "حراج الحسا" (وليس "طلبات" أو "خدمات")
- ⚠️ مهم: حتى لو احتوى على كلمات الطلب مثل "للبيع" مع سيارة، يظل "حراج الحسا"
- ✅ مثال: "سيارة كامري 2020 للبيع" → "حراج الحسا" (وليس "طلبات")
- ✅ مثال: "سيارة النترا موديل 2013 للبيع في الأحساء" → "حراج الحسا"

⚠️ القاعدة الثانية - الطلبات (لأي شخص يطلب أو يبحث عن شيء - عقار أو سلعة):
- إذا كان النص يحتوي على: "مطلوب"، "ابحث عن"، "من عنده"، "انا ابي"، "طالب"، "طلبي"، "ابغى"، "أبغى"، "ابغا"، "أبغا"، "ودي"، "احتاج"، "يا ليت"، "سحب طلب"، "أريد"، "عندي طلب"، "محتاج"، "دور على"، "ادور" → أرجع "طلبات"
- ⭐ لهجة سعودية: "ابغى ابيع"، "ابي ابيع"، "ابغا اشتري"، "ودي ابيع"، "حد عنده"، "مين عنده"، "تكفون"، "ياخوان" → أرجع "طلبات"
- ⚠️ استثناء مهم: إذا كان النص يحتوي على "سيارة" + كلمات طلب → أرجع "حراج الحسا" (وليس طلبات) لأن حراج السيارات يذهب لحساك

⚠️ القاعدة الثالثة - الإيجار (أولوية عالية للعقار فقط):
- إذا كان النص يحتوي على: "للإيجار"، "للأجار"، "ايجار"، "اجار"، "rent"، "rental" → أرجع "إيجار"
- ملاحظة: حتى لو كان النص يحتوي على "شقة للإيجار" أو "فيلا للإيجار"، التصنيف هو "إيجار" وليس "شقة" أو "فيلا"

قواعد خاصة بمنصة حساك (غير عقارية) - تأخذ أولوية على العقارات:
1. حراج الحسا: سيارات، مستعمل، حراج → "حراج الحسا" (حتى لو فيها كلمات طلب)
2. أسر منتجة: أكل بيت، طبخ منزلي، منتجات منزلية، حلويات منزلية → "أسر منتجة"
3. كوفيهات أو مطاعم: مطعم، كوفي، كافيه، قهوة، وجبات، برجر، بيتزا → "كوفيهات أو مطاعم"
4. منتجعات وإستراحات: منتجع، شاليه، مسبح، أماكن استجمام → "منتجعات وإستراحات"
5. الفعاليات والانشطة: فعالية، مهرجان، حدث، نشاط مجتمعي → "الفعاليات والانشطة"
6. محلات تجارية: متجر، سوق، مول، بازار → "محلات تجارية"
7. مركز ترفيهي: ألعاب، ملاهي → "مركز ترفيهي"

القواعد الأخرى (للعقارات للبيع - موقع مسعاك):
1. إذا كان النص يحتوي على "بيت" أو "منزل" → أرجع "بيت"
2. إذا كان النص يحتوي على "شقة" (بدون للإيجار) → أرجع "شقة"
3. إذا كان النص يحتوي على "فيلا" أو "فيللا" → أرجع "فيلا"
4. إذا كان النص يحتوي على "عمارة" → أرجع "عمارة"
5. إذا كان النص يحتوي على "أرض" أو "قطعة أرض" → أرجع "أرض"
6. إذا كان النص يحتوي على "مزرعة" → أرجع "مزرعة"
7. إذا كان النص يحتوي على "استراحة" → أرجع "استراحة"
8. إذا كان النص يحتوي على "وظيفة" أو "مطلوب موظف" → أرجع "برامج ووظائف"

مهم جداً:
- لا تستخدم "خدمات" إلا إذا كان النص فعلاً يقدم خدمة عامة (مثل صيانة، تركيب، نقل عفش) وليس حراج سيارات أو مطعم أو فعالية.
- إذا كان إعلان سيارة → اختر دائماً "حراج الحسا" (حتى لو فيه كلمات طلب)

أمثلة توضيحية:
1) "سيارة كامري 2020 للبيع" → "حراج الحسا" ✅ (وليس "طلبات")
2) "سيارة النترا موديل 2013 للبيع في الأحساء" → "حراج الحسا" ✅ (وليس "طلبات" أو "خدمات")
3) "ابغى ابيع سيارتي" → "حراج الحسا" ✅ (سيارة تذهب لحساك)
4) "شقة للإيجار 3 غرف" → "إيجار"
5) "مطلوب شقة للبيع" → "طلبات" (طلب عقار يذهب لمسعاك)
6) "شقة للبيع 200 ألف" → "شقة"
7) "ابحث عن فيلا" → "طلبات"
8) "ابغى ابيع هذا المكيف" → "حراج الحسا" (مستعمل يذهب لحساك)
9) "مطعم جديد في الأحساء يقدم برجر" → "كوفيهات أو مطاعم"
10) "أطباق منزلية من أسر منتجة" → "أسر منتجة"

أرجع فقط اسم التصنيف (واحد فقط) بدون أي نص إضافي أو تفسير.`;

        const rawCategory = (
          await executePromptWithProvider(apiKey, provider, prompt, {
            model:
              provider === PROVIDERS.GPT ? "gpt-4o-mini" : "gemini-2.5-flash",
          })
        ).trim();
        console.log("🏷️ Raw AI category response:", rawCategory);

        // Normalize and clean category (remove quotes or markdown formatting)
        let category = rawCategory
          .replace(/^"+|"+$/g, "")
          .replace(/^'+|'+$/g, "")
          .replace(/```/g, "")
          .trim();

        // Validate the category is in our list
        const validCategories = [
          // Masaak (real estate) categories
          "شقة دبلكسية",
          "دبلكس",
          "محطة بنزين",
          "محل تجاري",
          "عمارة",
          "فيلا",
          "بيت",
          "شقة",
          "مزرعة",
          "استراحة",
          "شالية",
          "مستودع",
          "أرض",
          "إيجار",
          "طلبات",
          "وظائف",
          "فعاليات",
          "خدمات",
          // Hasak categories
          "أسر منتجة",
          "إعلان تجاري ربحي مميز",
          "الفعاليات والانشطة",
          "برامج ووظائف",
          "توصيل سيارات",
          "فريق حساك",
          "فعاليات و أنشطة",
          "فعالية مجانية مميزة",
          "كوفيهات أو مطاعم",
          "مجتمع حساك",
          "محلات تجارية",
          "مركز ترفيهي",
          "منتجعات وإستراحات",
          "حراج الحسا",
        ];

        if (validCategories.includes(category)) {
          console.log(`🏷️ AI detected category (validated): ${category}`);
          return category;
        }

        // Fallback to keyword-based detection
        console.log(
          "🏷️ AI result not in valid list, using fallback detection...",
          "raw=",
          rawCategory,
          "normalized=",
          category
        );
        const fallbackCategory = detectCategoryFallback(text);
        console.log("🏷️ Fallback detected category:", fallbackCategory);
        return fallbackCategory;
      },
      "Category Detection",
      null
    );
  } catch (error) {
    console.error("❌ AI category detection error:", error);
    // Fallback to keyword-based detection
    return detectCategoryFallback(text);
  }
}

/**
 * Fallback keyword-based category detection
 * @param {string} text - The message text
 * @returns {string|null} - The detected category or null
 */
function detectCategoryFallback(text) {
  const textLower = text.toLowerCase();

  // Category keywords mapping (matching WordPress parent_catt values)
  // ⚠️ IMPORTANT: Order matters! More specific/priority categories should come FIRST
  const categoryKeywords = {
    // 🔵 HASAK-SPECIFIC CATEGORIES (for events, used items, car market, etc.)
    "حراج الحسا": [
      "حراج الحسا",
      "حراج الأحساء",
      "حراج الحساء",
      "سيارة",
      "سيارات",
      "جمس",
      "جيب",
      "صالون",
      "كورولا",
      "النترا",
      "كامري",
      "سوناتا",
      "بانوراما",
      "معرض سيارات",
      "سيارات مستعملة",
      "بيع سيارة",
      "للبيع سيارة",
      "حراج",
    ],
    "أسر منتجة": [
      "أسر منتجة",
      "اسر منتجة",
      "أسر منتجه",
      "اسر منتجه",
      "منزلية",
      "منزليه",
      "معجنات",
      "حلويات منزلية",
      "أكل بيت",
      "اكل بيت",
      "منتجات منزلية",
      "سفرة",
      "سفره",
    ],
    "كوفيهات أو مطاعم": [
      "كوفي",
      "كوفيه",
      "كافيه",
      "قهوة",
      "مطعم",
      "مطاعم",
      "وجبات",
      "برجر",
      "بيتزا",
      "مشويات",
    ],
    "منتجعات وإستراحات": [
      "منتجع",
      "منتجعات",
      "استراحة",
      "استراحه",
      "شالية",
      "شاليه",
      "مسبح",
      "مناسبات",
    ],
    "الفعاليات والانشطة": [
      "فعالية",
      "فعاليات",
      "فعاليه",
      "نشاط",
      "أنشطة",
      "انشطة",
      "مهرجان",
      "احتفال",
      "معرض",
      "event",
    ],
    "برامج ووظائف": [
      "برنامج",
      "برامج",
      "وظيفة",
      "وظائف",
      "توظيف",
      "دوام",
      "فرصة عمل",
    ],
    "محلات تجارية": ["محل", "محلات", "متجر", "سوق", "مول", "بازار"],
    "مركز ترفيهي": [
      "ترفيهي",
      "ترفيه",
      "العاب",
      "ألعاب",
      "ملاهي",
      "سنتر ترفيهي",
    ],
    // 🔴 HIGHEST PRIORITY: Requests/Offers - Check FIRST before anything else
    طلبات: [
      // ✅ Saudi Dialect - Someone wanting to sell/buy something
      "ابغى ابيع",
      "ابغا ابيع",
      "ابي ابيع",
      "أبغى أبيع",
      "أبغا أبيع",
      "أبي أبيع",
      "ابغى اشتري",
      "ابغا اشتري",
      "ابي اشتري",
      "أبغى أشتري",
      "أبغا أشتري",
      "أبي أشتري",
      "ودي ابيع",
      "ودي اشتري",
      "ابغى",
      "ابغا",
      "أبغى",
      "أبغا",
      "ابي",
      "أبي",
      "انا ابي",
      "انا ابغى",
      "انا ابغا",
      "ودي",
      "اودي",
      "أودي",

      // ✅ Looking for / Searching
      "مطلوب",
      "ابحث عن",
      "ابحث",
      "بحث عن",
      "ادور على",
      "ادور",
      "بدور",
      "دور على",
      "looking for",
      "search for",

      // ✅ Asking if someone has
      "من عنده",
      "مين عنده",
      "حد عنده",
      "في حد عنده",
      "فيه احد عنده",
      "احد عنده",
      "اي احد عنده",
      "فيه احد",
      "في احد",
      "اللي عنده",
      "من لديه",
      "عندك",
      "عندكم",
      "فيه واحد عنده",

      // ✅ Needing / Wanting
      "طالب",
      "طلبي",
      "احتاج",
      "محتاج",
      "اطلب",
      "يا ليت",
      "سحب طلب",
      "سحب الطلب",
      "أريد",
      "اريد",
      "عندي طلب",
      "عايز",
      "need",
      "want",
      "i need",
      "i want",

      // ✅ Saudi specific phrases
      "ياخوان",
      "يا جماعة مين عنده",
      "الله يجزاكم خير",
      "ياريت",
      "يا ريت",
      "لو سمحتو",
      "لو سمحتوا",
      "تكفون",
      "الله يخليكم",
    ],

    // 🟠 HIGH PRIORITY: Rentals - Check SECOND (Masaak)
    إيجار: [
      "للإيجار",
      " للإيجار",
      "للأجار",
      "للاجار",
      "ايجار",
      "اجار",
      "إيجار",
      "تأجير",
      "rent",
      "rental",
      "for rent",
      "مؤجر",
      "موجر",
      "يوجر",
      "مستأجر",
    ],

    // 🔵 NORMAL PRIORITY: Property types (check after طلبات and إيجار)
    "شقة دبلكسية": ["شقة دبلكسية", "شقه دبلكسيه", "شقة دوبلكس", "شقه دوبلكس"],
    دبلكس: ["دبلكس", "دوبلكس", "duplex"],
    "محطة بنزين": ["محطة بنزين", "محطه بنزين", "محطة وقود", "gas station"],
    "محل تجاري": [
      "محل تجاري",
      "محل",
      "shop",
      "مطعم",
      "كوفي",
      "مغسلة",
      "صالون",
      "بقالة",
      "سوبر ماركت",
      "مول",
    ],
    عمارة: ["عمارة", "عماره", "عماره سكنية", "عمارة سكنية", "بناية"],
    فيلا: ["فيلا", "فيللا", "فله", "villa"],
    بيت: ["بيت", "منزل", "بيوت", "منازل", "بيت مسلح", "بيت شعبي"],
    شقة: ["شقة", "شقه", "apartment"],
    مزرعة: ["مزرعة", "مزرعه", "farm", "مزارع"],
    استراحة: ["استراحة", "استراحه", "rest house"],
    شالية: ["شالية", "شاليه", "chalet"],
    مستودع: ["مستودع", "مخزن", "warehouse"],
    أرض: ["أرض", "ارض", "قطعة أرض", "قطعة ارض", "قطعه ارض", "قطع"],
    وظائف: ["وظيفة", "وظائف", "مطلوب موظف", "توظيف", "عمل"],
    فعاليات: ["فعالية", "فعاليات", "حدث", "مناسبة", "احتفال"],
    خدمات: ["خدمة", "خدمات", "صيانة", "تصليح", "نقل", "توصيل"],
  };

  // Check each category in order - PRIORITY MATTERS!
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      // Create a regex pattern that's more flexible
      // Check if keyword exists anywhere in text (not just word boundaries)
      const pattern = new RegExp(keyword, "i");

      if (pattern.test(text)) {
        console.log(
          `🏷️ Fallback detected category: ${category} (matched: ${keyword})`
        );
        return category;
      }
    }
  }

  console.log("🏷️ No category detected from text");
  return null;
}

/**
 * Generate WhatsApp message from WordPress data
 * @param {object} wpData - WordPress data
 * @param {string} wpLink - WordPress post link
 * @param {string} website - Target website ('masaak' or 'hasak')
 * @param {object} settings - Optional settings object with custom footers
 * @returns {string} - Formatted WhatsApp message
 */
function generateWhatsAppMessage(
  wpData,
  wpLink = null,
  website = "masaak",
  settings = null
) {
  const meta = wpData.meta || {};
  let message = "";

  // Default footers (used if settings not provided)
  const defaultHasakFooter = `┈┉━🔰 *منصة 🌴حساك* 🔰━┅┄
*✅إنضم في منصة حساك* 
https://chat.whatsapp.com/Ge3nhVs0MFT0ILuqDmuGYd?mode=ems_copy_t
 *✅للإعلانات في منصة حساك* 
0507667103`;

  const defaultMasaakFooter = `┈┉━━🔰 *مسعاك العقارية* 🔰━━┅┄
⭕ إبراء للذمة التواصل فقط مع مسعاك عند الشراء أو إذا عندك مشتري ✅ نتعاون مع جميع الوسطاء`;

  // Different format for Hasak vs Masaak
  if (website === "hasak") {
    // Hasak format: Title, Link, Footer
    // Add title
    if (wpData.title) {
      message += `*${wpData.title}*\n`;
    }

    // Add link if available
    if (wpLink) {
      message += `\n👈 *للتفاصيل اضغط على الرابط👇*\n${wpLink}`;
    }

    // Add Hasak footer (from settings or default)
    const hasakFooter =
      settings && settings.hasakFooter
        ? settings.hasakFooter
        : defaultHasakFooter;
    message += `\n${hasakFooter}`;
  } else {
    // Masaak format: Title, Price, Space, Location, Contact, Link, Footer
    // Add title
    if (wpData.title) {
      message += `*${wpData.title}*\n\n`;
    }

    // Add price if available
    if (meta.price_amount || meta.price || meta.price_type) {
      // Check for special price types that don't need numeric amounts
      const priceType = (meta.price_type || "").toLowerCase();
      const isContactPrice = priceType.includes("عند التواصل");
      const isNegotiable =
        priceType.includes("على السوم") || priceType.includes("السوم وصل");

      // Only show price line if there's a numeric value OR if it's a special type
      const hasNumericPrice = meta.price_amount || meta.price;

      if (hasNumericPrice || isContactPrice || isNegotiable) {
        message += `💰 *السعر:* `;

        // Handle special cases first
        if (isContactPrice && !hasNumericPrice) {
          message += `عند التواصل`;
        } else if (isNegotiable && !hasNumericPrice) {
          message += meta.price_type; // "على السوم" or "السوم وصل"
        } else if (hasNumericPrice) {
          // Check if it's a per-meter price or total price
          if (meta.price_type) {
            if (priceType.includes("متر") || priceType.includes("meter")) {
              // Per meter price
              message += `${meta.price_amount || meta.price} ريال للمتر`;
            } else if (
              priceType.includes("صافي") ||
              priceType.includes("total") ||
              priceType.includes("إجمالي")
            ) {
              // Total price
              message += `${meta.price_amount || meta.price} ريال`;
            } else if (isContactPrice || isNegotiable) {
              // If there's a price amount but type says contact/negotiable, show both
              message += `${meta.price_amount || meta.price} ريال (${
                meta.price_type
              })`;
            } else {
              // Other price types (show as is)
              message += `${meta.price_amount || meta.price} ريال (${
                meta.price_type
              })`;
            }
          } else if (meta.from_price && meta.to_price) {
            // Price range
            message += `من ${meta.from_price} إلى ${meta.to_price} ريال`;
          } else {
            // Just the amount
            message += `${meta.price_amount || meta.price} ريال`;
          }
        }

        message += `\n`;
      }
    }

    // Add space if available
    if (meta.arc_space || meta.order_space) {
      message += `📏 *المساحة:* ${meta.arc_space || meta.order_space} متر\n`;
    }

    // Add location if available
    if (meta.location || meta.City || meta.before_City) {
      const location = [meta.location, meta.City, meta.before_City]
        .filter(Boolean)
        .join(" - ");
      message += `📍 *الموقع:* ${location}\n`;
    }

    // Add fixed contact phone number (always 0508001475)
    message += `📲 *للتواصل:* 0508001475\n`;

    // Add link if available
    if (wpLink) {
      message += `\n👈 *للتفاصيل اضغط على الرابط👇*\n${wpLink}`;
    }

    // Add Masaak footer (from settings or default)
    const masaakFooter =
      settings && settings.masaakFooter
        ? settings.masaakFooter
        : defaultMasaakFooter;
    message += `\n${masaakFooter}`;
  }

  return message.trim();
}

/**
 * Process a message: detect if it's an ad and generate WordPress & WhatsApp data if it is
 * @param {string} text - The message text
 * @returns {Promise<{isAd: boolean, originalText: string, enhancedText: string, confidence: number, reason: string, improvements: string[], category: string|null, wpData: object|null, whatsappMessage: string|null}>}
 */
async function processMessage(text) {
  try {
    // First, detect if it's an ad
    const detection = await detectAd(text);

    if (!detection.isAd || detection.confidence < 40) {
      return {
        isAd: false,
        originalText: text,
        enhancedText: null,
        confidence: detection.confidence,
        reason: detection.reason,
        improvements: [],
        category: null,
        wpData: null,
        whatsappMessage: null,
      };
    }

    // Detect category from the text using AI
    const detectedCategory = await detectCategory(text);

    // Generate WordPress data automatically
    let wpData = null;
    let whatsappMessage = null;

    try {
      console.log("🤖 Automatically generating WordPress data...");
      wpData = await extractWordPressData(text);

      // Note: WhatsApp message will be generated AFTER posting to WordPress
      // so it can include the WordPress link
      console.log("✅ WordPress data generated successfully");
    } catch (wpError) {
      console.error("⚠️ Failed to generate WordPress data:", wpError.message);
      // Continue without WordPress data
    }

    return {
      isAd: true,
      originalText: text,
      enhancedText: text, // Keep original text without emojis
      confidence: detection.confidence,
      reason: detection.reason,
      improvements: [],
      category: detectedCategory,
      wpData: wpData,
      whatsappMessage: null, // Will be generated after WordPress posting
    };
  } catch (error) {
    console.error("Error processing message:", error);
    // Fallback: treat as non-ad
    return {
      isAd: false,
      originalText: text,
      enhancedText: null,
      confidence: 0,
      reason: "خطأ في المعالجة",
      improvements: [],
      category: null,
      wpData: null,
      whatsappMessage: null,
    };
  }
}

module.exports = {
  detectAd,
  enhanceAd,
  processMessage,
  extractWordPressData,
  generateWhatsAppMessage,
  validateUserInput,
  getApiKeysStatus,
  // New exports for multi-provider support
  PROVIDERS,
  MODEL_CONFIG,
  executeWithGPT,
  executeWithGemini,
  executeAIRequest,
  selectProvider,
  getModelConfig,
};

async function extractWordPressData(adText) {
  // Extract phone numbers first using smart extraction
  const extractedPhones = extractPhoneNumbers(adText);
  console.log("📞 Extracted phone numbers:", extractedPhones);

  // Build contact array for AI
  const contactHint =
    extractedPhones.length > 0
      ? `\n\nأرقام الهاتف المكتشفة في النص:\n${extractedPhones
          .map((p) => `- ${p.original} → ${p.normalized} (${p.type})`)
          .join(
            "\n"
          )}\n\nيجب استخدام هذه الأرقام في حقول phone_number و contact.`
      : "";

  const prompt = `أنت مساعد ذكاء اصطناعي مخصّص وخبير في تحليل إعلانات العقارات باللغة العربية. مهمتك الأساسية هي قراءة النص الوارد بدقة واستخلاص جميع الحقول المطلوبة وتحويلها إلى كائن JSON واحد صالح تماماً.

نص الإعلان:
${adText}${contactHint}

⚠️ قواعد التنظيف الإجبارية - يجب تطبيقها قبل أي شيء:

❌ ممنوع إدراج أو ذكر هذه المعلومات في أي حقل من حقول WordPress:
1. أسماء المكاتب العقارية (مثال: مكتب العقارات، شركة الإسكان، إلخ) - استثناء: فقط "مسعاك" أو "حساك" مسموح
2. أرقام ترخيص المكاتب (مثال: ترخيص رقم 12345، رخصة 98765)
3. أسماء القروبات (مثال: قروب العقارات، مجموعة واتساب، إلخ)
4. أسماء الوسطاء أو الأشخاص (إلا إذا كان المالك الفعلي للعقار)
5. أرقام هواتف الوسطاء أو المكاتب ()
6. أي إشارات لمصادر النص (مثال: "من قروب كذا"، "نشر في مجموعة كذا")

✅ المسموح فقط:
- "مسعاك" أو "حساك" - هذه الأسماء فقط يمكن ذكرها
- معلومات العقار الفعلية (السعر، المساحة، الموقع، إلخ)

🧹 كيفية التنظيف:
- احذف تماماً أي جمل أو عبارات تحتوي على أسماء مكاتب، تراخيص، قروبات
- لا تستبدلها بنقاط أو "..."، احذفها بالكامل
- أعد صياغة النص ليكون نظيفاً ومهنياً بدون أي إشارات لمصادر
- في حقل owner_name: استخدم "المالك" أو "معلن" بدلاً من أسماء مكاتب

قواعد التحليل الأساسية:

1. التحقق الأولي:
   ⚠️ هام: قبول أي نص يحتوي على:
   - إعلان عقاري (بيع/شراء/إيجار عقار)
   - طلب شراء أو بيع أي سلعة (عقار، أثاث، إلكترونيات، سيارات، إلخ)
   - عرض بيع أو شراء أي منتج أو خدمة
   - 🎪 فعالية أو نشاط أو حدث (معرض، ورشة، دورة، مؤتمر، احتفال، إلخ)
   - 🎪 إعلان عن افتتاح محل أو خدمة جديدة (كوفي، مطعم، صالون، إلخ)
   - 🎪 وظيفة أو فرصة عمل أو برنامج تدريبي
   - 🎪 خدمة أو عرض تجاري (توصيل، تنظيف، صيانة، إلخ)
   
   ✅ قبول بدون تردد:
   - أي فعالية أو حدث (معرض، ورشة، نشاط، إلخ) → IsItAd = true
   - أي إعلان عن افتتاح أو خدمة → IsItAd = true
   - أي وظيفة أو برنامج → IsItAd = true
   
   ❌ رفض فقط إذا كان:
   - نص عادي بدون أي نية تجارية أو إعلانية
   - محادثة عامة أو سؤال شخصي بدون قصد إعلاني
   - مجرد سلام أو تحية أو دردشة
   
   إذا لم يكن إعلان أو طلب أو عرض أو فعالية واضح، أعد: {"IsItAd": false, "parse_error": "السبب", "confidence_overall": 0.3}

2. تحديد نوع الإعلان (ad_type) - مهم جداً:
   
   🎪 للفعاليات والأنشطة (أولوية عالية):
   - "فعالية" أو "معرض" أو "مؤتمر" أو "ورشة" أو "دورة" → ad_type = "فعالية"
   - "نشاط" أو "حدث" أو "احتفال" أو "مهرجان" → ad_type = "فعالية"
   - "افتتاح" أو "يفتح" أو "جديد" (محل/كوفي/مطعم) → ad_type = "إعلان تجاري"
   
   ⭐ للطلبات (أولوية عالية):
   - "مطلوب" أو "أبحث عن" أو "ابحث" → ad_type = "طلب"
   - "ابغى ابيع" أو "ابي ابيع" أو "ودي ابيع" → ad_type = "طلب" (شخص يطلب مشتري)
   - "من عنده" أو "مين عنده" أو "حد عنده" → ad_type = "طلب"
   - "ابغى اشتري" أو "ابي اشتري" أو "ودي اشتري" → ad_type = "طلب"
   - "تكفون" أو "ياخوان" + أي كلمة طلب → ad_type = "طلب"
   - "احتاج" أو "محتاج" أو "دور على" → ad_type = "طلب"
   
   💼 للوظائف والبرامج:
   - "وظيفة" أو "وظائف" أو "توظيف" → ad_type = "وظيفة"
   - "برنامج" أو "تدريب" أو "دورة تدريبية" → ad_type = "برنامج"
   
   للعروض (أولوية عادية):
   - "للبيع" أو "للإيجار" أو "للبيع فورية" → ad_type = "عرض"
   - "متوفر" أو "يوجد" → ad_type = "عرض"
   
   في حالة الغموض → "عرض" (القيمة الافتراضية) مع confidence: 0.5

3. الفئات والفئات الفرعية:
   
   ⚠️ هام جداً: تحديد نوع الإعلان أولاً:

   🏢 إذا كان الإعلان عن عقار (أرض، بيت، فيلا، شقة، محل، مزرعة، إلخ):
   - استخدم الفئات الخاصة بموقع مسعاك (Masaak)
   
   🎪 إذا كان الإعلان عن فعالية، نشاط، حدث، أو خدمة:
   - استخدم الفئات الخاصة بموقع حساك (Hasak)

   🧩 للســلع المستعملة أو الحراج (غير عقارية):
   - انتبه جيداً للتفريق بين:
     1) "طلب" (شخص يبحث عن شيء) → ad_type = "طلب"
     2) "عرض بيع" (شخص يعرض سيارة/سلعة للبيع) → ad_type = "عرض"

   - اعتبره "طلب" فقط إذا كان النص يحتوي بوضوح على عبارات مثل:
     - "مطلوب", "أبحث عن", "ابحث عن", "مين عنده", "من عنده", "ابي اشتري", "ابغى اشتري", "احتاج", "محتاج"..

   - اعتبره "عرض بيع" (وليس طلبات) إذا كان فيه:
     - عبارات مثل: "للبيع", "سيارة للبيع", "أبيع", "ابغى ابيع", "عرض", "سعر", "القير والمكينة على الشرط", "فحص واستمارة جديدة"..
     - مثال مهم: إعلان عن *سيارة للبيع* مثل:
       "سيارة النترا 2013، القير والمكينة على الشرط، فحص واستمارة جديدة" → هذا *عرض بيع سيارة* وليس طلب

   - أمثلة كلمات دالة على أن السلعة *مستعملة/حراج* (سواء طلب أو عرض):
     - "مستعمل", "مستعملة", "حراج", "حراج الحسا", "حراج الأحساء"
     - وجود سلع مثل: "غسالة", "غسالات", "ثلاجة", "ثلاجات", "مكيف", "مكيفات", "سرير", "أسرة", "كنب", "أثاث", "أثاث مستعمل", "فرن", "غاز", "طاولة", "كراسي", "كمبيوتر", "لاب توب", "جوال", "سيارة" إلخ

   - إذا كان النص يصف *عرض بيع* لسلعة (خصوصاً سيارة) وليس "طلب" واضح:
     - اجعل ad_type = "عرض"
     - لا تجعل category = "طلبات" في هذه الحالة
     - اختر فئة مناسبة حسب إعدادات النظام (مثلاً يمكن اعتباره ضمن قسم حراج السلع أو قسم السيارات حسب الإعدادات)

   - إذا كان النص يصف *طلب شراء* (مطلوب سيارة، مطلوب غسالة مستعملة، إلخ):
     - ad_type = "طلب"
     - category = "طلبات"
     - category_id = 83
     - parent_catt = "طلبات" (ثابت)
     - sub_catt = نوع السلعة (مثال: "غسالة مستعملة", "أثاث مستعمل", "أجهزة كهربائية مستعملة", "سيارة")

   - إذا ذكر المعلن أنه يبيع عدة أغراض مستعملة مختلفة بدون نوع واضح (مثال: "حراج على أثاث البيت كامل"):
     - sub_catt = "حراج سلع مستعملة"
   
   🏢 للعقارات - الفئات الرئيسية (مسعاك):
   
   ⚠️ قاعدة الإيجار (أولوية قصوى - يجب تطبيقها أولاً):
   
   إذا كان العقار للإيجار (يحتوي على "للإيجار" أو " للإيجار" أو "ايجار" أو "إيجار"):
   → parent_catt = " للإيجار"
   → sub_catt = نوع العقار (شقة، دبلكس، فيلا، بيت، شقة دبلكسية، عمارة، استراحة، شالية، محل تجاري، مزرعة، مستودع)
   → category = " للإيجار"
   → category_id = 66
   → subcategory = نوع العقار
   → arc_category = " للإيجار"
   → arc_subcategory = نوع العقار
   → offer_type = "ايجار"
   → order_type = "ايجار"
   
   أمثلة للإيجار:
   - "شقة للإيجار في الهفوف" → parent_catt = " للإيجار", sub_catt = "شقة"
   - "فيلا  للإيجار" → parent_catt = " للإيجار", sub_catt = "فيلا"
   - "دبلكس للإيجار" → parent_catt = " للإيجار", sub_catt = "دبلكس"
   - "محل تجاري  للإيجار" → parent_catt = " للإيجار", sub_catt = "محل تجاري"
   
   الفئات الأساسية للعقارات للبيع/التملك مع القيم الافتراضية (* تشير للقيمة الافتراضية):
   - أرض (39): سكنية*(بطن) (45), تجارية(بطن) (46), تجارية(ركنية), سكنية(ركنية), زراعية (44)
   - دبلكس (38): *متصل (84), زاوية (85)
   - عمارة (37): *سكنية (71), تجارية (72), سكنية تجارية (73)
   - شقة (35): *دور أول (56), دور أرضي (55), دور ثاني (57), دور ثالث (58)
   - بيت (34): *دورين (51), دور (48), دور وشقق (49), دور وملحق (50), عربي (47)
   - فيلا (33): *دورين (52), دور (53), دور وشقق (54)
   - مزرعة (32): *صك (40), عرق (41), مشاع (42), وقف (43)
   - شقة دبلكسية (36): *دور أول (60), دور أرضي (59), دور ثاني (61), دور ثالث (62)
   - محطة بنزين (80): *محطة (81), بدون محلات (82)
   - مستودع (77): *كبير (79), صغير (78)
   - تجاري (74): محل تجاري (113), سوبر ماركت (94), بقالة (93), مطعم (97), كوفي (99), صيدلية (104), حلاق (90), مغسلة سيارات (91), مغسلة ملابس (92), مشغل نسائي (100), حلويات (101), بوفية (98), أدوات صحية (103), قطع سيارات (106), جوالات (111), فود ترك (112)
   - استراحة (115): *صك (116), عرق (117), مشاع (118), وقف (119)
   - شالية (114): *صك (120), عرق (121), مشاع (122), وقف (123)
   - للاستثمار (87), للتقبيل (88)
   
  🎪 للفعاليات والأنشطة والخدمات - فئات حساك (Hasak):
   - الفعاليات والانشطة (19): فعاليات منظمة ورسمية
   - فعالية مجانية مميزة (17): فعاليات مجانية
   - حراج الحسا (18): بيع سلع مستعملة أو حراج
   - كوفيهات أو مطاعم (21): كوفي، مطعم، كافيه، مقهى
   - محلات تجارية (23): محلات، متاجر، معارض تجارية
   - مركز ترفيهي (20): ملاهي، ترفيه، العاب
   - منتجعات وإستراحات (22): منتجعات، استراحات سياحية
   - أسر منتجة (10): منتجات أسر منتجة، يدوية
   - برامج ووظائف (30): وظائف، برامج تدريبية، فرص عمل
   - توصيل سيارات (25): خدمات توصيل
   - مجتمع حساك (28): أخبار المجتمع
   
   🏷️ للسلع المستعملة غير العقارية (مكيف، أثاث، إلكترونيات، سيارات، إلخ) - مسعاك:
   - category: "طلبات" (القيمة الثابتة)
   - category_id: 83 (القيمة الثابتة)
   - subcategory: اسم نوع السلعة بالعربية (مثال: "مكيف", "ثلاجة", "غسالة", "أثاث منزلي", "جهاز كمبيوتر", "سيارة")
   
   ⚠️ هام: لـ "طلبات" - استخدم parent_catt و sub_catt فقط في meta (لا تستخدم arc_category و arc_subcategory):
   - parent_catt: "طلبات" (ثابت)
   - sub_catt: نوع السلعة (مثال: "مكيف", "ثلاجة", "غسالة")
   - ملاحظة: قسم الطلبات هو تصنيف واحد في WordPress، لذلك نحدد القسم والقسم الفرعي باستخدام data meta (parent_catt و sub_catt) بدلاً من إنشاء كل الأقسام من جديد
   
   للسلع غير العقارية - الموقع:
   - before_city: "الأحساء" (أو المحافظة المذكورة)
   - city: المدينة المحددة (مثال: "الهفوف", "المبرز", "القرى")
   - location: الحي (مثال: "الرابية", "المحدود") أو "لم يذكر" إذا لم يُذكر

   قواعد إضافية للأراضي:
   - "أرض" أو "بطن" أو "سكنية" → سكنية(بطن) (45)
   - "زاوية" أو "ركنية" + سكنية → سكنية(ركنية)
   - "تجارية" → تجارية(بطن) (46)
   - "تجارية" + "زاوية/ركنية" → تجارية(ركنية)
   - إذا لا يوجد → *سكنية (45)

4. قواعد السعر الدقيقة:
   استخراج price_amount: أي رقم في النص (بدون فواصل). إذا قصير منطقياً (500 = 500000 للعقار)
   
   تحديد price_type:
   - "نهائي" أو "صافي" → "صافي السعر"
   - "سوم" + رقم → "السوم وصل"
   - "سوم" بدون رقم → "على السوم"
   - "للمتر" أو "/م" → "السعر للمتر"
   - "شهري" أو "في الشهر" → "السعر الشهر"
   - "سنوياً" → "السعر للسنة"
   - رقم بدون سياق → "عند التواصل"
   - لا يوجد سعر → "عند التواصل"
   
   إذا "عند التواصل" أو "على السوم" → price_amount = ""
   
   النطاق السعري:
   - رقم واحد → from_price = to_price = الرقم
   - "من X إلى Y" → from_price = الأقل, to_price = الأعلى
   - "من X فأعلى" → from_price = X, to_price = ""
   - "حتى X" → from_price = "", to_price = X

5. الموقع (المدن والأحياء):
   
   🏢 للعقارات:
   - city: دائماً "الأحساء" (confidence: 1.0)
   - before_City: دائماً "الأحساء" (confidence: 1.0)
   - subcity: استنتج من الحي أو النص الصريح (الهفوف، المبرز، القرى)
   - City: نفس قيمة subcity
   - neighborhood: اسم الحي بالضبط من المصفوفات (بدون كلمة "حي")
     * إذا لم يُذكر → "لم يذكر" (للعرض) أو "جميع الاحياء" (للطلب)
     * إذا ذُكر وغير موجود في المصفوفات → "لا يوجد"
     * تجاهل الأرقام بعد اسم الحي (ما عدا القرى)
     * إذا ذُكرت مدينة + حي مختلف → المدينة في subcity، الحي في neighborhood
   - location: نفس قيمة neighborhood
   
   🏷️ للسلع غير العقارية (مكيف، أثاث، إلكترونيات، إلخ):
   - city: "الأحساء" أو المدينة المذكورة في النص (إن وُجدت)
   - before_City: نفس قيمة city
   - subcity: المدينة/المنطقة المحددة (إن وُجدت) أو "لم يذكر"
   - City: نفس قيمة subcity
   - neighborhood: الحي (إن وُجد) أو "لم يذكر"
   - location: نفس قيمة neighborhood
   
   مصفوفات الأحياء:
   
   المبرز: ["الأمراء", "محاسن", "عين نجم", "عين مرجان", "بو سحبل", "اليمامة", "اليرموك", "الياسمين", "النزهة", "المطيرفي", "المسعودي", "القادسية", "الفيصل", "الفنار", "الفتح", "الضباب", "الصناعية", "الشعبة", "الشروفية", "الشراع", "السلام", "السحيمية", "الراشدية", "الديوان", "الأكاديمي", "الحزم", "الحزام الذهبي", "البستان", "البساتين", "الإتصالات", "الأندلس", "الأمانة", "أم سبعة", "أحد", "البصرة", "الناصرية", "الحوراء", "الدوائر الحكومية", "العليا", "المثلث", "الرفعة", "الفيصلية", "الرفعة الجنوبية", "الطالعية", "ام خريسان", "المزروعية", "الشغيبية", "الوسيطة", "السنيدية", "منيفة", "السيفة", "المحمدية", "الجوهرة", "الربوة", "المجيدية", "غرناطة", "المهندسين", "محاسن ارامكو", "وسط المبرز", "المقابل", "اشبيلية", "الندى", "مشرفة", "المحيرس", "مدينة الملك", "الوزية", "جوهرة الهادي", "الجابرية", "الرفاع", "الحمادية", "النجاح", "الخرس", "المجابل", "الغسانية"]
   
   القرى: ["المنيزلة", "الفضول", "الجشة", "الطرف", "المركز", "الشهارين", "المنصورة", "المزاوي", "العرامية", "القارة", "التويثير", "الرميلة", "العقار", "الساباط", "غمسي", "التهيمية", "السيايرة", "الجبيل", "الطريبيل", "الدالوة", "أبوالحصا", "الرمل", "الحوطة", "أبو ثور", "السبايخ", "الديوية", "الشويكية", "الأسلة", "جواثا", "الدويكية", "العلية", "واسط", "صويدره", "بني معن", "جليجلة", "بلدة المراح", "الصفا", "القرن", "الشقيق", "العقير", "الشروق", "الوادي", "مثلث الشرقية", "الثريا", "ابوحريف", "الجرن", "القرين", "الشعبة", "المطيرفي", "المقدام", "الكلابية", "الحليلة", "البطالية", "البريد", "الخزامى", "النور", "السعدون", "العدوة", "ضاحية هجر ١", "ضاحية هجر ٢", "ضاحية هجر ٣", "ضاحية هجر ٤", "ضاحية هجر ٥", "ضاحية هجر ٦", "ضاحية هجر ٧", "ضاحية هجر ٨", "ضاحية هجر ٩", "ضاحية هجر ١٠", "ضاحية هجر ١١", "ضاحية هجر ١٢", "الضاحية (التعاون)", "النخيل", "العمران"]
   
   الهفوف: ["الشهابية", "البصيرة", "الملك فهد", "السنيدية", "المربدية", "السلام", "المباركية", "المزروع", "الروضة", "المثلث", "الخالدية", "البندرية", "العزيزية", "الزهرة", "الجامعين", "الإسكان", "الحوراء", "الرابية", "جوبا", "المرقاب", "المحمدية", "الصيهد", "المعلمين", "السلمانية", "الحفيرة", "النايفية", "المهندسين", "الهدى", "الفيصلية", "النسيم", "الكوت", "الصالحية", "الرفعة", "عين موسى", "المزروعية", "عين علي", "الثليثية", "العسيلة", "العويمرية", "الرقيقة", "الفاضلية", "الصقور", "الربوة", "قرناطة", "القدس", "البدور", "الصحافة", "الرياض", "الربيع", "الجبل", "النخيل", "الريان", "الحزام الأخضر", "الدوحة", "الواحة", "المدينة الرياضية", "الدانة", "الورود", "منسوبي التعليم", "ام خريسان", "الرفعة الشمالية", "عين مرجان", "الطالعية", "الشغيبية", "منيفة", "الجوهرة", "العاصمة", "الامراء", "عين نجم", "الحمراء", "الأمانة", "المطار", "الزهراء", "التعاون", "الفردوس", "العليا", "المنار", "الرويضة", "المحدود", "المزرع", "المنيعية", "الشرق", "شرق الحديقة", "السبطين", "المنح", "النسيج", "الحماديه"]
   
   في حالة الطلب مع أكثر من حي: استخدم neighborhood, neighborhood1, neighborhood2, neighborhood3

6. العنوان (title):
   ⭐ للعقارات - عرض (ad_type = "عرض"):
   - جملة تسويقية جذابة: (أيقونة + نوع العقار + الموقع)
   - إضافة كلمات تسويقية: "فرصة، مميزة، على زاوية، موقع استراتيجي، واجهة شرقية"
   - إذا استثماري مع دخل سنوي/شهري → أضفه في العنوان
   - ممنوع ذكر: السعر، المساحة، عمر العقار
   
   ⭐ للعقارات - طلب (ad_type = "طلب"):
   - ابدأ بـ "مطلوب" أو "طلب" أو "محتاج"
   - أمثلة: "مطلوب شقة في الهفوف", "طلب شراء أرض في المبرز", "محتاج فيلا للشراء"
   - إذا كان "ابغى ابيع" → "طلب بيع [نوع العقار]"
   - إذا كان "ابغى اشتري" → "مطلوب [نوع العقار] للشراء"
   
   🏷️ للسلع غير العقارية (أثاث، إلكترونيات، سيارات، إلخ):
   - عرض بيع: "[نوع السلعة] للبيع - [حالة أو مميزات]"
     أمثلة: "مكيف سبليت للبيع - بحالة ممتازة", "ثلاجة سامسونج - نظيفة جداً"
   - طلب شراء: "مطلوب [نوع السلعة] للشراء"
     أمثلة: "مطلوب مكيف صحراوي", "ابحث عن غسالة ملابس"
   - طلب بيع: "طلب بيع [نوع السلعة]"
     أمثلة: "ابغى ابيع مكيف", "للبيع سريع - جهاز كمبيوتر"

7. حالة العرض/الطلب (offer_status & order_status):
   للعرض (ad_type = "عرض"):
   - offer_status: "عرض جديد", "تم البيع", "تم الحجز"
   - order_status: "عرض جديد"
   
   للطلب (ad_type = "طلب"):
   - offer_status: "طلب جديد"
   - order_status: "طلب جديد", "تم الشراء", "طلب جاد", "تم إلغاء الطلب"

8. الكلمات المفتاحية (tags):
   من 5 إلى 8 عبارات تجمع تفاصيل العقار مع مواضيع عامة:
   ["الوسيط العقاري", "وكيل عقاري", "البيع على الخارطة", "شبكة إيجار", "التسويق العقاري", "الاستثمار العقاري", "التطوير العقاري", "السوق العقاري", "عقارات", "العقارات السكنية", "العقارات التجارية", "الاستدامة", "التحليل العقاري", ...]

9. المحتوى (content.rendered):
   🏢 للعقارات:
   - وصف HTML (<h1>, <p>, <h2>, <ul>, <li>) صالح
   - عرض: العنوان، فقرة افتتاحية، أقسام المواصفات والمميزات والسعر والموقع
   - ممنوع: أرقام اتصال، أسماء وسطاء، أسماء مكاتب، تراخيص، أسماء قروبات، روابط، ملاحظات، شروحات، استنتاجات
   - ⚠️ تذكر: نظف المحتوى من أي إشارة لمكاتب أو قروبات (إلا مسعاك وحساك)
   - اذكر كل الميزات: الدخل السنوي للعمارة، هل العقار مرهون، إلخ
   
   🏷️ للسلع غير العقارية (أثاث، إلكترونيات، سيارات، إلخ):
   - وصف HTML بسيط: <h1>عنوان السلعة</h1><p>وصف تفصيلي للسلعة مع المميزات والحالة</p>
   - عرض بيع: اذكر الحالة، المميزات، السعر، سبب البيع (إن وُجد)
   - طلب شراء: اذكر المواصفات المطلوبة، الميزانية، الاستخدام المقصود
   - طلب بيع: اذكر السلعة، حالتها، السعر المطلوب أو القابل للتفاوض
   - أمثلة:
     * "<h1>مكيف سبليت 24 وحدة للبيع</h1><p>مكيف نظيف وبحالة ممتازة، تم الاستخدام لمدة سنتين فقط. السعر حسب الفاتورة المرفقة. السبب: الانتقال لمنزل جديد.</p>"
     * "<h1>مطلوب غسالة ملابس مستعملة</h1><p>أبحث عن غسالة ملابس مستعملة بحالة جيدة، ماركة سامسونج أو LG. الميزانية: حتى 500 ريال.</p>"

10. حقول إضافية (meta - جميع الحقول مطلوبة):
    - owner_name: اسم المالك أو الوكالة
    - phone_number: رقم الهاتف بصيغة 966... (بدون + أو مسافات)
    - contact: أرقام الاتصال بصيغة [{"value": "966...", "type": "phone|whatsapp", "confidence": 0-1}]
    - price: وصف السعر النصي
    - price_amount: السعر بالأرقام فقط (بدون فواصل)
    - from_price: السعر من (للنطاق السعري)
    - to_price: السعر إلى (للنطاق السعري)
    - price_method: طريقة الدفع (كاش، تقسيط، إلخ)
    - payment_method: تفاصيل طريقة الدفع
    - arc_space: 🏢 للعقارات: المساحة (رقم فقط) | 🏷️ للسلع: "" (فارغ)
    - order_space: 🏢 للعقارات: المساحة مع الوحدة (مثال: "600 متر مربع") | 🏷️ للسلع: "" (فارغ)
    - area: 🏢 للعقارات: المساحة (رقم فقط) | 🏷️ للسلع: "" (فارغ)
    - parent_catt: 🏢 للعقارات: نوع العقار (أرض، بيت، شقة، فيلا، إلخ) | 🏷️ للسلع/طلبات: "طلبات" (ثابت)
    - sub_catt: 🏢 للعقارات: النوع الفرعي (سكنية، تجارية، دورين، إلخ) | 🏷️ للسلع/طلبات: نوع السلعة (مكيف، ثلاجة، غسالة، إلخ)
    
    ⚠️ ملاحظة هامة عن arc_category و arc_subcategory:
    - 🏢 للعقارات فقط: استخدم arc_category و arc_subcategory (تحديد القسم والقسم الفرعي)
      * arc_category: نوع العقار (أرض، فيلا، بيت، شقة، دبلكس، عمارة، محل)
      * arc_subcategory: النوع الفرعي (سكنية، تجارية، زراعية، استثمارية، دورين، دور، إلخ)
    - 🏷️ للسلع/طلبات: لا تستخدم arc_category و arc_subcategory، استخدم parent_catt و sub_catt فقط
      * السبب: قسم الطلبات هو تصنيف واحد في WordPress، نحدد القسم والقسم الفرعي باستخدام data meta بدلاً من إنشاء كل الأقسام
    
    - before_city: المنطقة أو المحافظة (مثال: "الأحساء")
    - city: المدينة (مثال: "الهفوف", "المبرز", "القرى")
    - location: الحي أو الموقع المحدد (مثال: "الرابية", "المحدود", "العزيزية")
    - age: عمر العقار (مثال: "10 سنوات") أو ""
    - order_status: حالة الطلب
    - offer_status: حالة العرض
    - order_owner: نوع المعلن في الطلب
    - offer_owner: نوع المالك (مالك، وسيط، وكالة عقارية)
    - owner_type: نوع المالك (نسخة بديلة)
    - order_type: نوع الطلب
    - offer_type: نوع العملية (بيع، إيجار، تقبيل، استثمار)
    - main_ad: ⚠️ للـ "عرض" (ad_type = "عرض"): اتركه فارغاً "" (سيتم ملؤه تلقائياً بالنص الأصلي) | للـ "طلب": ملخص الإعلان الرئيسي
      * السبب: حقل main_ad للعروض يحتوي على النص الأصلي للإعلان ويمكن تعديله يدوياً لاحقاً
    - google_location: رابط خرائط جوجل أو null
    - youtube_link: رابط يوتيوب أو null

11. الاستدلال الذكي:
    - استنتج المعلومات المفقودة من السياق
    - أضف confidence للقيم المستنتجة (< 1.0)
    - القيم المباشرة من النص → confidence = 1.0
    - سجل الاستنتاجات في parse_error

12. الناتج النهائي:
    JSON صالح فقط، لا نصوص أخرى

مثال الناتج للعرض (يجب تضمين جميع الحقول):
{
  "IsItAd": true,
  "missing_fields": [],
  "status": "publish",
  "title": {"rendered": "string"},
  "content": {"rendered": "string"},
  "excerpt": {"rendered": "string"},
  "featured_media": null,
  "category_id": {"value": 56, "confidence": 1.0},
  "category": {"value": "شقة", "confidence": 1.0},
  "subcategory": {"value": "دور أول", "confidence": 1.0},
  "tags": ["string"],
  "meta": {
    "ad_type": {"value": "عرض", "confidence": 1.0},
    "owner_name": {"value": "string", "confidence": 1.0},
    "phone_number": {"value": "966...", "confidence": 1.0},
    "contact": [{"value": "966...", "type": "phone", "confidence": 1.0}],
    "price": {"value": "صافي السعر", "confidence": 1.0},
    "price_type": {"value": "صافي السعر", "confidence": 1.0},
    "price_amount": {"value": "880000", "confidence": 1.0},
    "from_price": {"value": "", "confidence": 1.0},
    "to_price": {"value": "", "confidence": 1.0},
    "price_method": {"value": "كاش", "confidence": 1.0},
    "payment_method": {"value": "كاش", "confidence": 1.0},
    "arc_space": {"value": "600", "confidence": 1.0},
    "order_space": {"value": "600 متر مربع", "confidence": 1.0},
    "area": {"value": "600", "confidence": 1.0},
    "parent_catt": {"value": "أرض", "confidence": 1.0},
    "sub_catt": {"value": "سكنية", "confidence": 1.0},
    "arc_category": {"value": "أرض", "confidence": 1.0},
    "arc_subcategory": {"value": "سكنية", "confidence": 1.0},
    "before_City": {"value": "الأحساء", "confidence": 1.0},
    "City": {"value": "الهفوف", "confidence": 1.0},
    "location": {"value": "الرابية", "confidence": 1.0},
    "city": {"value": "الأحساء", "confidence": 1.0},
    "subcity": {"value": "الهفوف", "confidence": 1.0},
    "neighborhood": {"value": "الرابية", "confidence": 1.0},
    "age": {"value": "", "confidence": 1.0},
    "order_status": {"value": "عرض جديد", "confidence": 1.0},
    "offer_status": {"value": "عرض جديد", "confidence": 1.0},
    "order_owner": {"value": "مالك", "confidence": 1.0},
    "offer_owner": {"value": "مالك", "confidence": 1.0},
    "owner_type": {"value": "مالك", "confidence": 1.0},
    "order_type": {"value": "بيع", "confidence": 1.0},
    "offer_type": {"value": "بيع", "confidence": 1.0},
    "main_ad": {"value": "", "confidence": 1.0},
    "google_location": {"value": null, "confidence": 1.0},
    "youtube_link": {"value": null, "confidence": 1.0}
  },
  "confidence_overall": 0.95,
  "parse_error": null
}

مثال الناتج للطلب عقاري (عندما ad_type = "طلب"):
{
  "IsItAd": true,
  "status": "publish",
  "title": {"rendered": "مطلوب شقة للشراء في الهفوف"},
  "content": {"rendered": "<p>شخص يبحث عن شقة للشراء في مدينة الهفوف بالأحساء. للتواصل: 966567946331</p>"},
  "category_id": {"value": 56, "confidence": 1.0},
  "category": {"value": "شقة", "confidence": 1.0},
  "subcategory": {"value": "دور أول", "confidence": 0.7},
  "meta": {
    "ad_type": {"value": "طلب", "confidence": 1.0},
    "parent_catt": {"value": "شقة", "confidence": 1.0},
    "sub_catt": {"value": "دور أول", "confidence": 0.7},
    "arc_category": {"value": "شقة", "confidence": 1.0},
    "arc_subcategory": {"value": "دور أول", "confidence": 0.7},
    "before_city": {"value": "الأحساء", "confidence": 1.0},
    "city": {"value": "الهفوف", "confidence": 1.0},
    "location": {"value": "لم يذكر", "confidence": 0.5},
    "order_status": {"value": "طلب جديد", "confidence": 1.0},
    "offer_status": {"value": "طلب جديد", "confidence": 1.0},
    "order_owner": {"value": "مشتري", "confidence": 1.0},
    "order_type": {"value": "شراء", "confidence": 1.0},
    "offer_type": {"value": "شراء", "confidence": 1.0},
    "main_ad": {"value": "طلب شراء شقة في الهفوف", "confidence": 1.0},
    ...
  }
}

⚠️ ملاحظة: للطلبات العقارية، استخدم arc_category و arc_subcategory بشكل طبيعي. main_ad يُملأ للطلبات فقط.

🏷️ مثال الناتج للسلع غير العقارية (مكيف، أثاث، إلكترونيات):
مثال 1 - طلب بيع مكيف (ابغى ابيع):
{
  "IsItAd": true,
  "status": "publish",
  "title": {"rendered": "طلب بيع مكيف سبليت 24 وحدة"},
  "content": {"rendered": "<h1>مكيف سبليت للبيع</h1><p>مكيف سبليت 24 وحدة بحالة ممتازة، نظيف ويعمل بكفاءة عالية. السعر حسب الفاتورة المرفقة في الصورة. سبب البيع: الانتقال لمنزل جديد.</p>"},
  "category_id": {"value": 83, "confidence": 1.0},
  "category": {"value": "طلبات", "confidence": 1.0},
  "subcategory": {"value": "مكيف", "confidence": 1.0},
  "meta": {
    "ad_type": {"value": "طلب", "confidence": 1.0},
    "phone_number": {"value": "966567946331", "confidence": 1.0},
    "contact": [{"value": "966567946331", "type": "phone", "confidence": 1.0}],
    "price": {"value": "حسب الفاتورة", "confidence": 0.8},
    "price_type": {"value": "عند التواصل", "confidence": 0.8},
    "price_amount": {"value": "", "confidence": 0.5},
    "arc_space": {"value": "", "confidence": 1.0},
    "order_space": {"value": "", "confidence": 1.0},
    "area": {"value": "", "confidence": 1.0},
    "parent_catt": {"value": "طلبات", "confidence": 1.0},
    "sub_catt": {"value": "مكيف", "confidence": 1.0},
    "before_city": {"value": "الأحساء", "confidence": 1.0},
    "city": {"value": "الهفوف", "confidence": 0.8},
    "location": {"value": "الرابية", "confidence": 0.8},
    "order_status": {"value": "طلب جديد", "confidence": 1.0},
    "offer_status": {"value": "طلب جديد", "confidence": 1.0},
    "order_owner": {"value": "بائع", "confidence": 1.0},
    "offer_owner": {"value": "مالك", "confidence": 1.0},
    "order_type": {"value": "بيع", "confidence": 1.0},
    "offer_type": {"value": "بيع", "confidence": 1.0}
  }
}

مثال 2 - مطلوب شراء (ابغى اشتري):
{
  "IsItAd": true,
  "title": {"rendered": "مطلوب غسالة ملابس للشراء"},
  "content": {"rendered": "<h1>أبحث عن غسالة ملابس</h1><p>أبحث عن غسالة ملابس مستعملة بحالة جيدة، يفضل ماركة سامسونج أو LG. الميزانية حتى 500 ريال.</p>"},
  "category_id": {"value": 83, "confidence": 1.0},
  "category": {"value": "طلبات", "confidence": 1.0},
  "subcategory": {"value": "غسالة ملابس", "confidence": 1.0},
  "meta": {
    "ad_type": {"value": "طلب", "confidence": 1.0},
    "parent_catt": {"value": "طلبات", "confidence": 1.0},
    "sub_catt": {"value": "غسالة ملابس", "confidence": 1.0},
    "before_city": {"value": "الأحساء", "confidence": 1.0},
    "city": {"value": "لم يذكر", "confidence": 0.5},
    "location": {"value": "لم يذكر", "confidence": 0.5},
    "order_owner": {"value": "مشتري", "confidence": 1.0},
    "order_type": {"value": "شراء", "confidence": 1.0},
    "offer_type": {"value": "شراء", "confidence": 1.0},
    "price_amount": {"value": "500", "confidence": 0.8},
    "to_price": {"value": "500", "confidence": 0.8}
  }
}

⚠️ ملاحظة مهمة: لاحظ أن أمثلة "طلبات" لا تحتوي على arc_category و arc_subcategory، فقط parent_catt و sub_catt

مهم جداً: يجب إرجاع جميع الحقول في meta، حتى لو كانت فارغة (""). لا تحذف أي حقل.

أرجع JSON صالح فقط بدون markdown أو شروحات.`;

  // Use retry mechanism with API key rotation
  return await retryWithApiKeyRotation(async (apiKey, keyIndex, provider) => {
    const responseText = await executePromptWithProvider(
      apiKey,
      provider,
      prompt
    );

    console.log("🤖 =========================");
    console.log("🤖 RAW AI RESPONSE (first 500 chars):");
    console.log(responseText.substring(0, 500));
    console.log("🤖 =========================");

    // Clean the response - remove markdown code blocks if present
    let cleanedText = responseText.trim();
    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText
        .replace(/^```json\s*/, "")
        .replace(/```\s*$/, "");
    } else if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```\s*/, "").replace(/```\s*$/, "");
    }

    console.log("🧹 CLEANED TEXT (first 500 chars):");
    console.log(cleanedText.substring(0, 500));
    console.log("🧹 =========================");

    const data = JSON.parse(cleanedText);

    console.log("✅ PARSED DATA:");
    console.log("   - IsItAd:", data.IsItAd);
    console.log("   - title:", data.title);
    console.log("   - content:", data.content ? "EXISTS" : "MISSING");
    console.log("   - ad_type:", data.meta?.ad_type);
    console.log("✅ =========================");

    // Check if AI returned valid ad data
    if (!data.IsItAd || data.IsItAd === false) {
      console.log("⚠️ AI determined this is NOT an ad");
      throw new Error("AI determined this is not an advertisement");
    }

    // Ensure status is set
    data.status = "publish";

    // Transform the enhanced structure to match WordPress API format
    const wpData = {
      title:
        data.title?.rendered || data.title?.value || data.title || "عقار للبيع",
      content:
        data.content?.rendered || data.content?.value || data.content || "",
      excerpt:
        data.excerpt?.rendered || data.excerpt?.value || data.excerpt || "",
      status: "publish",
      meta: {},
    };

    // Warning if using fallback title
    if (wpData.title === "عقار للبيع") {
      console.log(
        "⚠️ WARNING: Using fallback title! AI did not provide proper title"
      );
      console.log("⚠️ data.title structure:", JSON.stringify(data.title));
    }

    // Extract meta fields with confidence values
    if (data.meta) {
      Object.keys(data.meta).forEach((key) => {
        const field = data.meta[key];
        // Handle both formats: {value, confidence} and direct values
        wpData.meta[key] =
          field && typeof field === "object" && "value" in field
            ? field.value
            : field;
      });
    }

    // 🔧 Clean up price fields to prevent duplication
    if (wpData.meta.price_type) {
      const priceType = wpData.meta.price_type.toLowerCase();

      // If price_type is "عند التواصل" or "على السوم", ensure price_amount is empty
      if (
        priceType.includes("عند التواصل") ||
        priceType.includes("على السوم")
      ) {
        wpData.meta.price_amount = "";
        wpData.meta.from_price = "";
        wpData.meta.to_price = "";
      }

      // Clean up price field if it duplicates price_type
      if (
        wpData.meta.price &&
        (wpData.meta.price.includes(wpData.meta.price_type) ||
          wpData.meta.price === wpData.meta.price_type)
      ) {
        wpData.meta.price = "";
      }
    }

    // If price_amount exists but is the same as price_type, clear it
    if (
      wpData.meta.price_amount &&
      wpData.meta.price_type &&
      wpData.meta.price_amount === wpData.meta.price_type
    ) {
      wpData.meta.price_amount = "";
    }

    // Add category information
    if (data.category_id) {
      wpData.meta.category_id = data.category_id.value || data.category_id;
    }
    if (data.category) {
      const categoryValue = data.category.value || data.category;
      wpData.meta.category = categoryValue;

      // Default mapping: keep both meta fields in sync
      // NOTE: Hasak themes use arc_category/arc_subcategory.
      //       Masaak requests ("طلبات") will be normalized later.
      wpData.meta.parent_catt = wpData.meta.parent_catt || categoryValue;
      wpData.meta.arc_category = wpData.meta.arc_category || categoryValue;

      // ⚠️ CRITICAL: If category is "طلبات", force category_id to 83
      if (categoryValue === "طلبات" || categoryValue === "طلب") {
        wpData.meta.category_id = 83;
        wpData.meta.parent_catt = "طلبات";
        console.log("✅ Auto-set category_id to 83 for طلبات category");
      }
    }
    if (data.subcategory) {
      wpData.meta.subcategory = data.subcategory.value || data.subcategory;
      // Default mapping: keep both meta fields in sync
      wpData.meta.sub_catt =
        wpData.meta.sub_catt || data.subcategory.value || data.subcategory;
      wpData.meta.arc_subcategory =
        wpData.meta.arc_subcategory ||
        data.subcategory.value ||
        data.subcategory;
    }

    // Add tags
    if (data.tags && Array.isArray(data.tags)) {
      wpData.meta.tags = data.tags.join(", ");
    }

    // Fallback: Use smart-extracted phone numbers if AI didn't extract them properly
    if (
      (!wpData.meta.phone_number || wpData.meta.phone_number === "") &&
      extractedPhones.length > 0
    ) {
      console.log(
        "⚠️ AI did not extract phone number, using smart extraction fallback"
      );
      wpData.meta.phone_number = extractedPhones[0].normalized;
      wpData.meta.phone = extractedPhones[0].normalized;

      // Build contact array
      wpData.meta.contact = extractedPhones.map((p) => ({
        value: p.normalized,
        type: "phone",
        confidence: p.confidence,
      }));
    }

    // Ensure all required WordPress custom fields exist (even if empty)
    const requiredFields = {
      owner_name: wpData.meta.owner_name || "",
      phone_number: wpData.meta.phone_number || wpData.meta.phone || "",
      phone: wpData.meta.phone || wpData.meta.phone_number || "",
      // Don't set price to price_type - only use actual price values
      price: wpData.meta.price || "",
      price_amount: wpData.meta.price_amount || "",
      price_method:
        wpData.meta.price_method || wpData.meta.payment_method || "",
      payment_method:
        wpData.meta.payment_method || wpData.meta.price_method || "",
      arc_space: wpData.meta.arc_space || wpData.meta.area || "",
      order_space:
        wpData.meta.order_space ||
        (wpData.meta.arc_space ? `${wpData.meta.arc_space} متر مربع` : ""),
      parent_catt:
        wpData.meta.parent_catt ||
        wpData.meta.arc_category ||
        wpData.meta.category ||
        "",
      sub_catt:
        wpData.meta.sub_catt ||
        wpData.meta.arc_subcategory ||
        wpData.meta.subcategory ||
        "",
      arc_category:
        wpData.meta.arc_category ||
        wpData.meta.parent_catt ||
        wpData.meta.category ||
        "",
      arc_subcategory:
        wpData.meta.arc_subcategory ||
        wpData.meta.sub_catt ||
        wpData.meta.subcategory ||
        "",
      before_City:
        wpData.meta.before_City ||
        wpData.meta.before_city ||
        wpData.meta.city ||
        "الأحساء",
      before_city:
        wpData.meta.before_city ||
        wpData.meta.before_City ||
        wpData.meta.city ||
        "الأحساء",
      City: wpData.meta.City || wpData.meta.city || wpData.meta.subcity || "",
      city: wpData.meta.city || wpData.meta.City || wpData.meta.subcity || "",
      location: wpData.meta.location || wpData.meta.neighborhood || "",
      order_status: wpData.meta.order_status || wpData.meta.offer_status || "",
      offer_status:
        wpData.meta.offer_status || wpData.meta.order_status || "عرض جديد",
      order_owner:
        wpData.meta.order_owner ||
        wpData.meta.offer_owner ||
        wpData.meta.owner_type ||
        "",
      offer_owner:
        wpData.meta.offer_owner ||
        wpData.meta.order_owner ||
        wpData.meta.owner_type ||
        "",
      owner_type:
        wpData.meta.owner_type ||
        wpData.meta.offer_owner ||
        wpData.meta.order_owner ||
        "",
      order_type:
        wpData.meta.order_type ||
        wpData.meta.offer_type ||
        wpData.meta.ad_type ||
        "",
      offer_type: wpData.meta.offer_type || wpData.meta.order_type || "",
      main_ad: wpData.meta.main_ad || "",
      google_location: wpData.meta.google_location || null,
      youtube_link: wpData.meta.youtube_link || null,
    };

    // Merge required fields into meta (only if not already set)
    Object.keys(requiredFields).forEach((key) => {
      if (!(key in wpData.meta)) {
        wpData.meta[key] = requiredFields[key];
      }
    });

    // ⚠️ Special handling for "طلبات" category - use parent_catt/sub_catt only (for Masaak requests)
    // IMPORTANT: Do NOT apply this normalization for Hasak categories like "حراج الحسا" etc.
    const hasakCategories = [
      "أسر منتجة",
      "إعلان تجاري ربحي مميز",
      "الفعاليات والانشطة",
      "برامج ووظائف",
      "توصيل سيارات",
      "حراج الحسا",
      "شركاء حساك",
      "عن حساك",
      "فريق حساك",
      "فعاليات و أنشطة",
      "فعالية مجانية مميزة",
      "كوفيهات أو مطاعم",
      "مجتمع حساك",
      "محلات تجارية",
      "مركز ترفيهي",
      "منتجعات وإستراحات",
    ];

    const currentCategory = wpData.meta.category || data.category || "";
    const isHasakCategory = hasakCategories.includes(currentCategory);

    const isRequestCategory =
      !isHasakCategory &&
      (data.category === "طلبات" ||
        wpData.meta.category === "طلبات" ||
        wpData.meta.parent_catt === "طلبات" ||
        wpData.meta.order_status?.includes("طلب") ||
        wpData.meta.offer_status?.includes("طلب") ||
        (data.category_id &&
          (data.category_id.value === 83 || data.category_id === 83)));

    if (isRequestCategory) {
      console.log(
        "\n⚠️ Detected 'طلبات' category - removing arc_category and arc_subcategory"
      );

      // ⚠️ CRITICAL: Force category_id to 83 for طلبات
      wpData.meta.category_id = 83;
      wpData.meta.category = "طلبات";

      // For طلبات, we only use parent_catt and sub_catt
      // Remove arc_category and arc_subcategory as they are not used for this category
      delete wpData.meta.arc_category;
      delete wpData.meta.arc_subcategory;

      // Ensure parent_catt is "طلبات" (override the property type that was set)
      wpData.meta.parent_catt = "طلبات";

      console.log("✅ Using parent_catt:", wpData.meta.parent_catt);
      console.log("✅ Using category_id:", wpData.meta.category_id);
      console.log("✅ Using sub_catt:", wpData.meta.sub_catt);
    }

    // ⚠️ Special handling for "عرض" (offer) - use original ad text as main_ad
    const isOffer =
      wpData.meta.ad_type === "عرض" ||
      (data.meta && data.meta.ad_type && data.meta.ad_type.value === "عرض");

    if (isOffer) {
      console.log(
        "\n⚠️ Detected 'عرض' (offer) - using original ad text as main_ad"
      );
      // Store the original ad text in main_ad so it can be manually edited later
      wpData.meta.main_ad = adText || "";
      console.log(
        "✅ main_ad set with",
        adText ? adText.length : 0,
        "characters"
      );
    }

    // Add confidence and error info for debugging
    wpData.meta.confidence_overall = data.confidence_overall || 1.0;
    if (data.parse_error) {
      wpData.meta.parse_notes = data.parse_error;
    }

    console.log("\n✅ Enhanced AI Extraction Complete");
    console.log("Confidence:", data.confidence_overall || "N/A");
    console.log("Total meta fields:", Object.keys(wpData.meta).length);
    if (data.parse_error) {
      console.log("Notes:", data.parse_error);
    }

    return wpData;
  }, "Extract WordPress Data");
}

/**
 * Validate user input using AI
 * @param {string} input - User's input
 * @param {string} fieldName - Name of the field being validated (e.g., "name", "phone", "price")
 * @param {string} context - Additional context for validation
 * @returns {object} - { isValid: boolean, reason: string, suggestion: string }
 */
async function validateUserInput(input, fieldName = "name", context = "") {
  return retryWithApiKeyRotation(async (apiKey, currentIndex, provider) => {
    let prompt = "";

    // Different validation prompts based on field type
    if (fieldName === "name") {
      prompt = `أنت مساعد ذكي صارم للتحقق من صحة الأسماء. مهمتك الأساسية هي التأكد من أن المدخل هو اسم شخص فقط.

المستخدم أدخل: "${input}"

⚠️ **قواعد صارمة جداً - REJECT أي شيء ليس اسم شخص:**

❌ **REJECT إذا احتوى على:**
- كلمات ترحيبية (تشرفنا، معك، أخوك، مرحباً، أهلاً، السلام عليكم)
- معلومات عقارية (بيت، شقة، فيلا، أرض، عقار، للبيع، للإيجار، السعر، المساحة)
- أسماء شركات (مسعاك، العقارية، شركة)
- عبارات وظيفية (الموظف، المسؤول، المدير)
- نماذج أو قوائم (نوع العقار، حدود السعر، رقم التواصل)
- أكثر من 4 كلمات
- رموز خاصة (* : - / . + = [ ] { })
- أرقام
- نقاط أو علامات ترقيم كثيرة

✅ **ACCEPT فقط إذا:**
- اسم شخص واضح (2-4 كلمات فقط)
- أحرف عربية أو إنجليزية فقط
- يبدو كاسم حقيقي لشخص (مثل: محمد أحمد، يوسف تامر، سارة علي)
- لا يحتوي على أي معلومات إضافية

**أمثلة:**
✅ "محمد أحمد" → VALID
✅ "يوسف تامر" → VALID
✅ "عبدالرحمن السليم" → VALID
❌ "تشرفنا فيك يوسف تامر" → INVALID (يحتوي ترحيب)
❌ "معك أخوك عبدالرحمن" → INVALID (يحتوي عبارات وظيفية)
❌ "محمد - مسعاك العقارية" → INVALID (يحتوي اسم شركة)
❌ "*محمد أحمد* 0505050505" → INVALID (يحتوي رموز ورقم)
❌ "نوع العقار: فيلا" → INVALID (نموذج عقاري)
❌ "محمد" → INVALID (اسم واحد فقط، نحتاج اسم ثنائي)

أرجع JSON فقط:
{
  "isValid": true/false,
  "reason": "سبب قصير جداً (جملة واحدة)",
  "suggestion": "اقتراح للمستخدم إذا كان غير صحيح، أو فارغ إذا كان صحيحاً"
}`;
    } else if (fieldName === "phone") {
      prompt = `تحقق من رقم الهاتف: "${input}"
هل هو رقم هاتف سعودي صحيح؟ (يبدأ بـ 05 أو 9665 أو +9665)

أرجع JSON:
{
  "isValid": true/false,
  "reason": "سبب",
  "suggestion": "اقتراح أو فارغ"
}`;
    } else if (fieldName === "price") {
      prompt = `تحقق من السعر: "${input}"
هل هو نطاق سعر منطقي؟ (مثال: "من 500 ألف إلى مليون" أو "800000")

أرجع JSON:
{
  "isValid": true/false,
  "reason": "سبب",
  "suggestion": "اقتراح أو فارغ"
}`;
    } else {
      // Generic validation
      prompt = `تحقق من هذا الإدخال للحقل "${fieldName}": "${input}"
${context}

هل هذا إدخال صحيح ومنطقي؟

أرجع JSON:
{
  "isValid": true/false,
  "reason": "سبب قصير",
  "suggestion": "اقتراح أو فارغ"
}`;
    }

    console.log(`🤖 AI validating ${fieldName}: "${input}"`);

    const responseText = await executePromptWithProvider(
      apiKey,
      provider,
      prompt
    );

    console.log(`📝 AI response: ${responseText}`);

    // Parse JSON response
    try {
      // Extract JSON from markdown code blocks if present
      let jsonText = responseText.trim();
      if (jsonText.includes("```json")) {
        jsonText = jsonText.split("```json")[1].split("```")[0].trim();
      } else if (jsonText.includes("```")) {
        jsonText = jsonText.split("```")[1].split("```")[0].trim();
      }

      const validation = JSON.parse(jsonText);

      console.log(
        `✅ Validation result: ${validation.isValid ? "VALID ✓" : "INVALID ✗"}`
      );
      if (!validation.isValid) {
        console.log(`   Reason: ${validation.reason}`);
      }

      return validation;
    } catch (parseError) {
      console.error("❌ Failed to parse AI validation response:", parseError);
      // Fallback - assume valid if can't parse
      return {
        isValid: true,
        reason: "تعذر التحقق",
        suggestion: "",
      };
    }
  }, `Validate ${fieldName}`);
}
