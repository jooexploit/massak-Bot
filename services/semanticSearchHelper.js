/**
 * Semantic Search Helper
 * AI-powered utilities for intelligent property matching and search expansion
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Property type synonyms and related terms (Arabic)
 */
const PROPERTY_SYNONYMS = {
  // بيت variations
  بيت: ["بيت", "منزل", "دار", "مسكن", "سكن"],
  منزل: ["بيت", "منزل", "دار", "مسكn", "سكن"],
  دار: ["بيت", "منزل", "دار", "مسكن"],

  // شقة variations
  شقة: ["شقة", "شقق", "سكن", "وحدة سكنية"],
  شقق: ["شقة", "شقق", "سكن", "وحدة سكنية"],

  // فيلا variations
  فيلا: ["فيلا", "فلل", "قصر", "فله"],
  فلل: ["فيلا", "فلل", "قصر"],
  فله: ["فيلا", "فلل", "فله"],

  // أرض variations
  أرض: ["أرض", "ارض", "قطعة", "قطعة أرض"],
  ارض: ["أرض", "ارض", "قطعة", "قطعة أرض"],

  // عمارة variations
  عمارة: ["عمارة", "عمائر", "بناية", "مبنى"],
  عمائر: ["عمارة", "عمائر", "بناية"],

  // محل variations
  محل: ["محل", "محلات", "متجر", "دكان"],
  محلات: ["محل", "محلات", "متجر", "دكان"],

  // استراحة variations
  استراحة: ["استراحة", "استراحات", "مخيم", "مزرعة"],
  استراحات: ["استراحة", "استراحات"],

  // مكتب variations
  مكتب: ["مكتب", "مكاتب", "مقر"],
  مكاتب: ["مكتب", "مكاتب"],
};

/**
 * City/Location synonyms and related areas
 */
const LOCATION_SYNONYMS = {
  الهفوف: ["الهفوف", "هفوف", "الأحساء", "احساء"],
  المبرز: ["المبرز", "مبرز", "الأحساء", "احساء"],
  الأحساء: ["الأحساء", "احساء", "الهفوف", "المبرز"],

  الدمام: ["الدمام", "دمام", "الشرقية"],
  الخبر: ["الخبر", "خبر", "الشرقية"],
  الظهران: ["الظهران", "ظهران", "الشرقية"],

  الرياض: ["الرياض", "رياض"],
  جدة: ["جدة", "جده"],
  مكة: ["مكة", "مكه"],
  المدينة: ["المدينة", "المدينة المنورة"],
};

/**
 * Purpose/Action synonyms
 */
const PURPOSE_SYNONYMS = {
  بيع: ["بيع", "للبيع", "شراء", "للشراء"],
  شراء: ["بيع", "للبيع", "شراء", "للشراء"],
  إيجار: ["إيجار", "ايجار", "للإيجار", " للإيجار", "تأجير"],
  ايجار: ["إيجار", "ايجار", "للإيجار", " للإيجار", "تأجير"],
};

/**
 * Expand search query with synonyms and related terms
 * @param {string} searchTerm - Original search term
 * @param {string} type - Type of term (property, location, purpose)
 * @returns {Array<string>} Array of related search terms
 */
function expandSearchTerms(searchTerm, type = "property") {
  const normalized = searchTerm.trim().toLowerCase();
  let synonyms = [];

  switch (type) {
    case "property":
      synonyms = PROPERTY_SYNONYMS[normalized] || [normalized];
      break;
    case "location":
      synonyms = LOCATION_SYNONYMS[normalized] || [normalized];
      break;
    case "purpose":
      synonyms = PURPOSE_SYNONYMS[normalized] || [normalized];
      break;
    default:
      synonyms = [normalized];
  }

  // Return unique terms
  return [...new Set(synonyms)];
}

/**
 * Use AI to extract search intent and expand query
 * @param {string} userQuery - User's search query
 * @returns {Promise<Object>} Extracted search parameters
 */
async function extractSearchIntent(userQuery) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `أنت خبير في تحليل استفسارات البحث عن العقارات باللغة العربية.
قم بتحليل الاستفسار التالي واستخرج المعلومات:

استفسار المستخدم: "${userQuery}"

قم بإرجاع JSON فقط بالصيغة التالية:
{
  "propertyType": "نوع العقار (بيت، شقة، فيلا، أرض، الخ)",
  "propertyTypeVariations": ["مرادفات نوع العقار"],
  "purpose": "الغرض (بيع أو إيجار)",
  "location": "الموقع أو المدينة",
  "locationVariations": ["مرادفات الموقع"],
  "neighborhood": "الحي إن وجد",
  "priceRange": "نطاق السعر إن ذكر",
  "area": "المساحة إن ذكرت",
  "expandedQuery": "استفسار موسع يشمل المرادفات",
  "searchKeywords": ["كلمات مفتاحية للبحث"]
}

ملاحظات:
- إذا لم يُذكر عنصر، اتركه null
- كن ذكياً في استنتاج المعلومات من السياق
- أضف مرادفات شائعة للكلمات المفتاحية
- اجعل searchKeywords مرتبة حسب الأهمية`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]);
      console.log("🤖 AI extracted search intent:", extracted);
      return extracted;
    }

    return null;
  } catch (error) {
    console.error("❌ Error extracting search intent with AI:", error);
    return null;
  }
}

/**
 * Calculate semantic similarity between two texts using AI
 * @param {string} text1 - First text
 * @param {string} text2 - Second text
 * @returns {Promise<number>} Similarity score (0-100)
 */
async function calculateSemanticSimilarity(text1, text2) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `قم بحساب درجة التشابه الدلالي بين النصين التاليين (من 0 إلى 100):

النص الأول: "${text1}"
النص الثاني: "${text2}"

قم بإرجاع رقم فقط (0-100) يمثل درجة التشابه:
- 100 = تطابق تام
- 80-99 = تشابه قوي جداً
- 60-79 = تشابه جيد
- 40-59 = تشابه متوسط
- 20-39 = تشابه ضعيف
- 0-19 = تشابه ضعيف جداً أو لا يوجد

أرجع رقم فقط بدون نص:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    const score = parseInt(text.trim());
    return isNaN(score) ? 0 : Math.min(100, Math.max(0, score));
  } catch (error) {
    console.error("❌ Error calculating semantic similarity:", error);
    return 0;
  }
}

/**
 * Generate AI-powered property description for better matching
 * @param {Object} property - Property object with metadata
 * @returns {Promise<string>} Generated searchable description
 */
async function generatePropertyDescription(property) {
  try {
    const meta = property.meta || {};
    const title = property.title?.rendered || "";
    const excerpt = property.excerpt?.rendered?.replace(/<[^>]*>/g, "") || "";

    const description = `${title} ${excerpt} ${meta.parent_catt || ""} ${
      meta.City || ""
    } ${meta.location || ""} ${meta.order_type || ""} ${
      meta.price || ""
    }`.trim();

    return description;
  } catch (error) {
    console.error("❌ Error generating property description:", error);
    return "";
  }
}

/**
 * Smart match scoring with AI assistance
 * @param {Object} requirements - User requirements
 * @param {Object} property - Property to match
 * @returns {Promise<Object>} Match score and reasons
 */
async function calculateMatchScore(requirements, property) {
  let score = 0;
  const reasons = [];
  const meta = property.meta || {};

  // 1. Property Type Matching (30 points max)
  if (requirements.propertyType) {
    const reqType = requirements.propertyType.toLowerCase();
    const propType = (
      meta.parent_catt ||
      meta.arc_category ||
      ""
    ).toLowerCase();
    const title = (property.title?.rendered || "").toLowerCase();
    const excerpt = (property.excerpt?.rendered || "").toLowerCase();

    const typeVariations = expandSearchTerms(reqType, "property");

    for (const variation of typeVariations) {
      if (propType.includes(variation)) {
        score += 30;
        reasons.push(`تطابق نوع العقار: ${variation}`);
        break;
      } else if (title.includes(variation) || excerpt.includes(variation)) {
        score += 25;
        reasons.push(`ذكر نوع العقار: ${variation}`);
        break;
      }
    }
  }

  // 2. Location Matching (25 points max)
  if (requirements.location || requirements.neighborhood) {
    const reqLocation = (requirements.location || "").toLowerCase();
    const reqNeighborhood = (requirements.neighborhood || "").toLowerCase();
    const propCity = (meta.City || "").toLowerCase();
    const propLocation = (meta.location || "").toLowerCase();
    const propBeforeCity = (meta.before_City || "").toLowerCase();
    const title = (property.title?.rendered || "").toLowerCase();

    // Neighborhood match (highest priority)
    if (reqNeighborhood && propLocation.includes(reqNeighborhood)) {
      score += 25;
      reasons.push(`تطابق الحي: ${reqNeighborhood}`);
    }
    // City match
    else if (reqLocation) {
      const locationVariations = expandSearchTerms(reqLocation, "location");
      for (const variation of locationVariations) {
        if (
          propCity.includes(variation) ||
          propLocation.includes(variation) ||
          propBeforeCity.includes(variation) ||
          title.includes(variation)
        ) {
          score += 20;
          reasons.push(`تطابق المدينة: ${variation}`);
          break;
        }
      }
    }
  }

  // 3. Price Proximity (20 points max)
  if (requirements.priceRange && meta.price_amount) {
    const reqPrice = parseInt(requirements.priceRange);
    const propPrice = parseInt(meta.price_amount);

    if (!isNaN(reqPrice) && !isNaN(propPrice)) {
      const ratio = propPrice / reqPrice;

      if (ratio >= 0.8 && ratio <= 1.2) {
        score += 20;
        reasons.push(`سعر قريب جداً (${propPrice})`);
      } else if (ratio >= 0.5 && ratio <= 2.0) {
        score += 15;
        reasons.push(`سعر في النطاق (${propPrice})`);
      } else if (ratio >= 0.3 && ratio <= 3.0) {
        score += 10;
        reasons.push(`سعر مقبول (${propPrice})`);
      }
    }
  }

  // 4. Area/Size Matching (15 points max)
  if (requirements.area && meta.arc_space) {
    const reqArea = parseInt(requirements.area);
    const propArea = parseInt(meta.arc_space);

    if (!isNaN(reqArea) && !isNaN(propArea)) {
      const ratio = propArea / reqArea;

      if (ratio >= 0.8 && ratio <= 1.2) {
        score += 15;
        reasons.push(`مساحة مطابقة (${propArea}م²)`);
      } else if (ratio >= 0.5 && ratio <= 2.0) {
        score += 10;
        reasons.push(`مساحة قريبة (${propArea}م²)`);
      } else if (ratio >= 0.3 && ratio <= 3.0) {
        score += 5;
        reasons.push(`مساحة في النطاق (${propArea}م²)`);
      }
    }
  }

  // 5. Purpose Matching (10 points max)
  if (requirements.purpose) {
    const reqPurpose = requirements.purpose.toLowerCase();
    const propOrderType = (
      meta.order_type ||
      meta.offer_type ||
      ""
    ).toLowerCase();
    const title = (property.title?.rendered || "").toLowerCase();
    const excerpt = (property.excerpt?.rendered || "").toLowerCase();

    const purposeVariations = expandSearchTerms(reqPurpose, "purpose");

    for (const variation of purposeVariations) {
      if (
        propOrderType.includes(variation) ||
        title.includes(variation) ||
        excerpt.includes(variation)
      ) {
        score += 10;
        reasons.push(`تطابق الغرض: ${variation}`);
        break;
      }
    }
  }

  return { score, reasons };
}

/**
 * Get relevance label based on score
 * @param {number} score - Match score
 * @returns {string} Emoji label
 */
function getRelevanceLabel(score) {
  if (score >= 80) return "🟢 تطابق ممتاز";
  if (score >= 50) return "🟡 تطابق جيد";
  return "⚪ تطابق عام";
}

module.exports = {
  expandSearchTerms,
  extractSearchIntent,
  calculateSemanticSimilarity,
  generatePropertyDescription,
  calculateMatchScore,
  getRelevanceLabel,
  PROPERTY_SYNONYMS,
  LOCATION_SYNONYMS,
  PURPOSE_SYNONYMS,
};
