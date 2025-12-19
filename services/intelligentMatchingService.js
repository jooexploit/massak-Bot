/**
 * Intelligent Property Matching Service
 * Production-grade matching engine with weighted scoring, graceful degradation,
 * and explainable match reasoning.
 * 
 * Features:
 * - Configurable weights for each matching dimension
 * - Graceful handling of missing fields (neutral scores, not penalties)
 * - Fuzzy location matching with geo-distance fallback
 * - Explainable match scores with human-readable reasons
 * - Feedback tracking for adaptive learning
 * 
 * Scoring Weights (default, configurable):
 * - Property Type: 30% (what)
 * - Purpose: 20% (buy/rent)
 * - Location: 25% (where)
 * - Area: 10% (size)
 * - Price: 10% (budget)
 * - Features: 5% (extras)
 */

const areaNormalizer = require("./areaNormalizer");

// ============================================
// CONFIGURATION
// ============================================

/**
 * Default scoring weights (sum = 100)
 * These can be dynamically adjusted based on feedback
 */
const DEFAULT_WEIGHTS = {
  propertyType: 30,  // Property type match (بيت, شقة, مزرعة, etc.)
  purpose: 20,       // Transaction type (شراء/بيع or إيجار)
  location: 25,      // Neighborhood/geo proximity
  area: 10,          // Size similarity
  price: 10,         // Budget compatibility
  features: 5,       // Extra features (electricity, water, etc.)
};

/**
 * Score thresholds for match quality labels
 */
const QUALITY_THRESHOLDS = {
  excellent: 85,    // 🟢 ممتاز
  veryGood: 75,     // 🟢 جيد جداً
  good: 65,         // 🟡 جيد
  acceptable: 55,   // 🟡 مقبول
  weak: 0,          // ⚪ ضعيف
};

/**
 * Default minimum score to include in results
 */
const DEFAULT_MIN_SCORE = 70;

/**
 * Neutral score for missing fields (does not penalize but doesn't reward)
 */
const NEUTRAL_SCORE = 50;

// ============================================
// NEIGHBORHOOD COORDINATES (Al-Ahsa Region)
// ============================================

/**
 * Approximate center coordinates for neighborhoods
 * Used for geo-distance fallback when exact match fails
 */
const NEIGHBORHOOD_COORDS = {
  // المبرز neighborhoods
  "الخالدية": { lat: 25.4150, lng: 49.5650 },
  "المحمدية": { lat: 25.4050, lng: 49.5700 },
  "الفيصلية": { lat: 25.4200, lng: 49.5800 },
  "الناصرية": { lat: 25.4100, lng: 49.5750 },
  "العزيزية": { lat: 25.4000, lng: 49.5600 },
  "الراشدية": { lat: 25.4250, lng: 49.5550 },
  "الصالحية": { lat: 25.4300, lng: 49.5700 },
  "المنصورة": { lat: 25.3950, lng: 49.5650 },
  "الجامعية": { lat: 25.3900, lng: 49.5850 },
  "التعاونية": { lat: 25.4050, lng: 49.5550 },
  "الروضة": { lat: 25.4150, lng: 49.5500 },
  "البستانية": { lat: 25.4200, lng: 49.5450 },
  "محاسن": { lat: 25.3800, lng: 49.5900 },
  
  // الهفوف neighborhoods
  "الكوت": { lat: 25.3650, lng: 49.5850 },
  "الحزم": { lat: 25.3700, lng: 49.5950 },
  "البندرية": { lat: 25.3550, lng: 49.5800 },
  "العيون": { lat: 25.3600, lng: 49.6050 },
  "النعاثل": { lat: 25.3750, lng: 49.6000 },
  "السلمانية": { lat: 25.3500, lng: 49.5750 },
  "المثلث": { lat: 25.3600, lng: 49.5700 },
  "الملك فهد": { lat: 25.3450, lng: 49.5900 },
  
  // الأحساء general areas
  "عين موسى": { lat: 25.4500, lng: 49.6200 },
  "البطالية": { lat: 25.4600, lng: 49.6100 },
  "الطرف": { lat: 25.4700, lng: 49.5900 },
  "الجفر": { lat: 25.4400, lng: 49.6300 },
  "القارة": { lat: 25.4550, lng: 49.5800 },
  "الشعبة": { lat: 25.4300, lng: 49.6250 },
  "الحليلة": { lat: 25.4800, lng: 49.6000 },
  "الخدود": { lat: 25.4650, lng: 49.6150 },
  "شارع الحيات": { lat: 25.4580, lng: 49.6080 },
  "عين باهلة": { lat: 25.4520, lng: 49.6180 },
  
  // Cities (center points)
  "المبرز": { lat: 25.4100, lng: 49.5700 },
  "الهفوف": { lat: 25.3600, lng: 49.5850 },
  "الأحساء": { lat: 25.4000, lng: 49.6000 },
};

// ============================================
// PROPERTY TYPE SYNONYMS
// ============================================

/**
 * Groups of property types that are considered equivalent or similar
 */
const PROPERTY_TYPE_GROUPS = [
  { types: ["بيت", "منزل", "فيلا", "دور"], similarity: 100 },
  { types: ["شقة", "شقة سكنية"], similarity: 100 },
  { types: ["دبلكس", "شقة دبلكسية", "شقة دبلكس"], similarity: 100 },
  { types: ["أرض", "ارض", "قطعة أرض"], similarity: 100 },
  { types: ["عمارة", "بناية", "مبنى"], similarity: 100 },
  { types: ["استراحة", "شاليه"], similarity: 100 },
  { types: ["محل", "محل تجاري", "معرض"], similarity: 100 },
  { types: ["مزرعة", "مزارع"], similarity: 100 },
  { types: ["مستودع", "مخزن"], similarity: 100 },
];

/**
 * Related property types (lower similarity)
 */
const RELATED_PROPERTY_TYPES = {
  "بيت": ["شقة", "دبلكس"],
  "فيلا": ["بيت", "دبلكس"],
  "شقة": ["دبلكس", "بيت"],
  "أرض": ["مزرعة"],
  "مزرعة": ["أرض", "استراحة"],
};

// ============================================
// CORE SCORING FUNCTIONS
// ============================================

/**
 * Calculate property type similarity score (0-100)
 * @param {string} requestedType - Requested property type
 * @param {string} offerType - Offer property type
 * @returns {{score: number, detail: string}} Score and explanation
 */
function scorePropertyType(requestedType, offerType) {
  // Handle missing data
  if (!requestedType || !offerType) {
    return {
      score: NEUTRAL_SCORE,
      detail: !requestedType ? "نوع العقار غير محدد في الطلب" : "نوع العقار غير محدد في العرض",
    };
  }

  const reqType = requestedType.toLowerCase().trim();
  const offType = offerType.toLowerCase().trim();

  // Exact match
  if (reqType === offType) {
    return { score: 100, detail: `${requestedType} = ${offerType}` };
  }

  // Check synonym groups (100% similar)
  for (const group of PROPERTY_TYPE_GROUPS) {
    const reqInGroup = group.types.some(t => reqType.includes(t) || t.includes(reqType));
    const offInGroup = group.types.some(t => offType.includes(t) || t.includes(offType));
    
    if (reqInGroup && offInGroup) {
      return { score: 95, detail: `${requestedType} ≈ ${offerType} (نفس الفئة)` };
    }
  }

  // Check related types (partial similarity)
  for (const [baseType, relatedTypes] of Object.entries(RELATED_PROPERTY_TYPES)) {
    if (reqType.includes(baseType) || baseType.includes(reqType)) {
      if (relatedTypes.some(rt => offType.includes(rt) || rt.includes(offType))) {
        return { score: 60, detail: `${requestedType} مرتبط بـ ${offerType}` };
      }
    }
  }

  // Partial text match
  if (reqType.includes(offType) || offType.includes(reqType)) {
    return { score: 70, detail: `تطابق جزئي: ${requestedType} ↔ ${offerType}` };
  }

  // No match
  return { score: 0, detail: `نوع مختلف: ${requestedType} ≠ ${offerType}` };
}

/**
 * Calculate purpose/transaction type similarity (0-100)
 * @param {string} requestedPurpose - Requested purpose (شراء/بيع or إيجار)
 * @param {string} offerPurpose - Offer purpose
 * @returns {{score: number, detail: string}} Score and explanation
 */
function scorePurpose(requestedPurpose, offerPurpose) {
  // Handle missing data with neutral score
  if (!requestedPurpose) {
    return { score: NEUTRAL_SCORE, detail: "الغرض غير محدد في الطلب" };
  }
  if (!offerPurpose) {
    return { score: NEUTRAL_SCORE, detail: "الغرض غير محدد في العرض" };
  }

  const reqPurpose = requestedPurpose.toLowerCase().trim();
  const offPurpose = offerPurpose.toLowerCase().trim();

  // Normalize to standard terms
  const isBuyRequest = reqPurpose.includes("شراء") || reqPurpose.includes("بيع");
  const isRentRequest = reqPurpose.includes("إيجار") || reqPurpose.includes("ايجار");
  const isBuyOffer = offPurpose.includes("شراء") || offPurpose.includes("بيع");
  const isRentOffer = offPurpose.includes("إيجار") || offPurpose.includes("ايجار");

  // Perfect match
  if ((isBuyRequest && isBuyOffer) || (isRentRequest && isRentOffer)) {
    return { score: 100, detail: `الغرض متطابق: ${requestedPurpose}` };
  }

  // Mismatch
  if ((isBuyRequest && isRentOffer) || (isRentRequest && isBuyOffer)) {
    return { score: 0, detail: `الغرض مختلف: ${requestedPurpose} ≠ ${offerPurpose}` };
  }

  // Unknown purpose in one side
  return { score: NEUTRAL_SCORE, detail: "تعذر تحديد الغرض بدقة" };
}

/**
 * Calculate Haversine distance between two coordinates (in km)
 * @param {number} lat1 - Latitude 1
 * @param {number} lng1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lng2 - Longitude 2
 * @returns {number} Distance in kilometers
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate location similarity score (0-100)
 * Uses exact match, fuzzy match, and geo-distance fallback
 * @param {string[]} requestedNeighborhoods - Requested neighborhoods
 * @param {string} offerNeighborhood - Offer neighborhood
 * @param {string} offerCity - Offer city
 * @returns {{score: number, detail: string}} Score and explanation
 */
function scoreLocation(requestedNeighborhoods, offerNeighborhood, offerCity) {
  // Handle missing data
  if (!requestedNeighborhoods || requestedNeighborhoods.length === 0) {
    return { score: NEUTRAL_SCORE, detail: "الموقع غير محدد في الطلب" };
  }
  if (!offerNeighborhood && !offerCity) {
    return { score: NEUTRAL_SCORE, detail: "الموقع غير محدد في العرض" };
  }

  const offerLocation = `${offerNeighborhood || ""} ${offerCity || ""}`.toLowerCase().trim();
  const normalizedOfferLoc = areaNormalizer.normalizeAreaName(offerLocation);

  let bestScore = 0;
  let bestDetail = "";

  for (const neighborhood of requestedNeighborhoods) {
    const normalizedReq = areaNormalizer.normalizeAreaName(neighborhood);
    const reqLower = normalizedReq.toLowerCase();

    // 1. Exact match (100%)
    if (offerLocation.includes(reqLower) || reqLower.includes(offerLocation)) {
      return { score: 100, detail: `الموقع متطابق: ${neighborhood}` };
    }

    // 2. Fuzzy string match (word overlap)
    const reqWords = reqLower.split(/\s+/).filter(w => w.length > 2);
    const offWords = offerLocation.split(/\s+/).filter(w => w.length > 2);
    const matchingWords = reqWords.filter(rw => 
      offWords.some(ow => ow.includes(rw) || rw.includes(ow))
    ).length;
    
    if (matchingWords > 0 && reqWords.length > 0) {
      const wordScore = 60 + (matchingWords / reqWords.length) * 30;
      if (wordScore > bestScore) {
        bestScore = wordScore;
        bestDetail = `تطابق جزئي: ${neighborhood} ↔ ${offerNeighborhood || offerCity}`;
      }
    }

    // 3. Geo-distance fallback
    const reqCoords = NEIGHBORHOOD_COORDS[normalizedReq] || NEIGHBORHOOD_COORDS[neighborhood];
    const offCoords = NEIGHBORHOOD_COORDS[normalizedOfferLoc] || 
                      NEIGHBORHOOD_COORDS[offerNeighborhood] ||
                      NEIGHBORHOOD_COORDS[offerCity];

    if (reqCoords && offCoords) {
      const distance = calculateDistance(reqCoords.lat, reqCoords.lng, offCoords.lat, offCoords.lng);
      
      let distanceScore = 0;
      let distanceDetail = "";
      
      if (distance <= 3) {
        distanceScore = 75;
        distanceDetail = `قريب جداً (${distance.toFixed(1)} كم من ${neighborhood})`;
      } else if (distance <= 10) {
        distanceScore = 50;
        distanceDetail = `قريب (${distance.toFixed(1)} كم من ${neighborhood})`;
      } else if (distance <= 20) {
        distanceScore = 25;
        distanceDetail = `متوسط البعد (${distance.toFixed(1)} كم من ${neighborhood})`;
      }

      if (distanceScore > bestScore) {
        bestScore = distanceScore;
        bestDetail = distanceDetail;
      }
    }
  }

  // 4. Same city fallback
  if (bestScore === 0 && offerCity) {
    const sameCity = requestedNeighborhoods.some(n => {
      const nLower = n.toLowerCase();
      return offerCity.toLowerCase().includes(nLower) || 
             nLower.includes(offerCity.toLowerCase()) ||
             (nLower.includes("المبرز") && offerCity.includes("المبرز")) ||
             (nLower.includes("الهفوف") && offerCity.includes("الهفوف")) ||
             (nLower.includes("الأحساء") && offerCity.includes("الأحساء"));
    });
    
    if (sameCity) {
      return { score: 40, detail: `نفس المدينة: ${offerCity}` };
    }
  }

  if (bestScore > 0) {
    return { score: Math.round(bestScore), detail: bestDetail };
  }

  return { score: 0, detail: `موقع مختلف: ${offerNeighborhood || offerCity}` };
}

/**
 * Calculate area/size similarity score (0-100)
 * @param {number} requestedMin - Requested minimum area
 * @param {number} requestedMax - Requested maximum area
 * @param {number} offerArea - Offer area
 * @returns {{score: number, detail: string}} Score and explanation
 */
function scoreArea(requestedMin, requestedMax, offerArea) {
  // Handle missing data
  if ((!requestedMin && !requestedMax) || requestedMin === null && requestedMax === null) {
    return { score: NEUTRAL_SCORE, detail: "المساحة غير محددة في الطلب" };
  }
  if (!offerArea || offerArea <= 0) {
    return { score: NEUTRAL_SCORE, detail: "المساحة غير محددة في العرض" };
  }

  const minArea = requestedMin || 0;
  const maxArea = requestedMax || Infinity;
  const midpoint = minArea === 0 ? maxArea : (maxArea === Infinity ? minArea : (minArea + maxArea) / 2);

  // Perfect match: within range
  if (offerArea >= minArea && offerArea <= maxArea) {
    return { score: 100, detail: `المساحة متطابقة: ${offerArea}م² (المطلوب ${minArea}-${maxArea}م²)` };
  }

  // Calculate deviation
  let deviation;
  if (offerArea < minArea) {
    deviation = (minArea - offerArea) / minArea;
  } else {
    deviation = (offerArea - maxArea) / maxArea;
  }

  // Score based on deviation
  let score;
  if (deviation <= 0.1) {
    score = 90; // ≤10% difference
  } else if (deviation <= 0.2) {
    score = 75; // ≤20% difference
  } else if (deviation <= 0.3) {
    score = 60; // ≤30% difference
  } else if (deviation <= 0.5) {
    score = 40; // ≤50% difference
  } else {
    score = Math.max(10, 40 - (deviation - 0.5) * 60);
  }

  const deviationPercent = Math.round(deviation * 100);
  const direction = offerArea < minArea ? "أصغر" : "أكبر";
  
  return {
    score: Math.round(score),
    detail: `${offerArea}م² (${direction} بـ ${deviationPercent}% من المطلوب)`,
  };
}

/**
 * Calculate price similarity score (0-100)
 * @param {number} requestedMin - Requested minimum price
 * @param {number} requestedMax - Requested maximum price
 * @param {number} offerPrice - Offer price
 * @returns {{score: number, detail: string}} Score and explanation
 */
function scorePrice(requestedMin, requestedMax, offerPrice) {
  // Handle missing data with neutral score (price often not specified)
  if ((!requestedMin && !requestedMax) || (requestedMin === null && requestedMax === null)) {
    return { score: NEUTRAL_SCORE, detail: "السعر غير محدد في الطلب" };
  }
  if (!offerPrice || offerPrice <= 0) {
    return { score: NEUTRAL_SCORE, detail: "السعر غير محدد في العرض" };
  }

  const minPrice = requestedMin || 0;
  const maxPrice = requestedMax || Infinity;

  // Perfect match: within range
  if (offerPrice >= minPrice && offerPrice <= maxPrice) {
    const priceFormatted = formatPrice(offerPrice);
    return { score: 100, detail: `السعر مناسب: ${priceFormatted}` };
  }

  // Calculate how far outside range
  let deviation;
  if (offerPrice < minPrice) {
    deviation = (minPrice - offerPrice) / minPrice;
  } else {
    deviation = (offerPrice - maxPrice) / maxPrice;
  }

  // Score based on deviation (more forgiving than area)
  let score;
  if (deviation <= 0.15) {
    score = 85; // ≤15% outside range
  } else if (deviation <= 0.25) {
    score = 70; // ≤25% outside range
  } else if (deviation <= 0.40) {
    score = 50; // ≤40% outside range
  } else if (deviation <= 0.60) {
    score = 30; // ≤60% outside range
  } else {
    score = Math.max(5, 30 - (deviation - 0.6) * 50);
  }

  const priceFormatted = formatPrice(offerPrice);
  const direction = offerPrice < minPrice ? "أقل" : "أعلى";
  const deviationPercent = Math.round(deviation * 100);

  return {
    score: Math.round(score),
    detail: `${priceFormatted} (${direction} بـ ${deviationPercent}% من الميزانية)`,
  };
}

/**
 * Format price for display
 * @param {number} price - Price value
 * @returns {string} Formatted price string
 */
function formatPrice(price) {
  if (price >= 1000000) {
    return `${(price / 1000000).toFixed(1)} مليون`;
  } else if (price >= 1000) {
    return `${(price / 1000).toFixed(0)} ألف`;
  }
  return `${price} ريال`;
}

/**
 * Calculate extra features similarity score (0-100)
 * @param {string} requestedSpecs - Requested additional specifications
 * @param {Object} offerMeta - Offer metadata
 * @returns {{score: number, detail: string}} Score and explanation
 */
function scoreFeatures(requestedSpecs, offerMeta) {
  // Handle missing data
  if (!requestedSpecs || requestedSpecs.length < 5) {
    return { score: NEUTRAL_SCORE, detail: "لا توجد مواصفات إضافية محددة" };
  }

  const specLower = requestedSpecs.toLowerCase();
  const matchedFeatures = [];
  const missingFeatures = [];

  // Check common features
  const featureChecks = [
    { keywords: ["كهرباء", "كهربا"], metaKey: "electricity", label: "كهرباء" },
    { keywords: ["ماء", "مياه"], metaKey: "water", label: "ماء" },
    { keywords: ["شارع", "طريق", "سفلت"], metaKey: "road", label: "طريق" },
    { keywords: ["مجلس", "صالة"], metaKey: "hall", label: "مجلس" },
    { keywords: ["حوش", "فناء"], metaKey: "yard", label: "حوش" },
    { keywords: ["مسبح", "بركة"], metaKey: "pool", label: "مسبح" },
    { keywords: ["موقف", "جراج", "كراج"], metaKey: "parking", label: "موقف" },
  ];

  for (const check of featureChecks) {
    const requested = check.keywords.some(kw => specLower.includes(kw));
    if (requested) {
      // Check if offer has this feature (in meta or content)
      const offerHas = offerMeta?.[check.metaKey] || 
                       (offerMeta?.description || "").toLowerCase().includes(check.keywords[0]);
      
      if (offerHas) {
        matchedFeatures.push(check.label);
      } else {
        missingFeatures.push(check.label);
      }
    }
  }

  if (matchedFeatures.length === 0 && missingFeatures.length === 0) {
    return { score: NEUTRAL_SCORE, detail: "لم يتم التحقق من المواصفات الإضافية" };
  }

  const totalChecked = matchedFeatures.length + missingFeatures.length;
  const score = Math.round((matchedFeatures.length / totalChecked) * 100);

  let detail = "";
  if (matchedFeatures.length > 0) {
    detail = matchedFeatures.map(f => `${f} ✓`).join(", ");
  }
  if (missingFeatures.length > 0) {
    detail += (detail ? " | " : "") + missingFeatures.map(f => `${f} ✗`).join(", ");
  }

  return { score, detail };
}

// ============================================
// MAIN MATCHING FUNCTION
// ============================================

/**
 * Calculate intelligent match score with weighted components
 * @param {Object} request - User request (طلب)
 * @param {Object} offer - Property offer (عرض)
 * @param {Object} weights - Custom weights (optional, uses DEFAULT_WEIGHTS if not provided)
 * @returns {Object} Complete match result with score, breakdown, and explanation
 */
function calculateIntelligentMatch(request, offer, weights = DEFAULT_WEIGHTS) {
  // Extract offer data
  const offerMeta = offer.meta || {};
  const offerPrice = offerMeta.price_amount || offerMeta.price || 0;
  const offerArea = offerMeta.arc_space || offerMeta.area || 0;
  const offerNeighborhood = offerMeta.location || offerMeta.neighborhood || offerMeta.district || "";
  const offerCity = offerMeta.City || offerMeta.city || "";
  const offerType = offerMeta.arc_category || offerMeta.parent_catt || "";
  const offerPurpose = offerMeta.offer_type || offerMeta.order_type || offerMeta.purpose || "";

  // Calculate individual scores
  const typeResult = scorePropertyType(request.propertyType, offerType);
  const purposeResult = scorePurpose(request.purpose, offerPurpose);
  const locationResult = scoreLocation(request.neighborhoods, offerNeighborhood, offerCity);
  const areaResult = scoreArea(request.areaMin, request.areaMax, offerArea);
  const priceResult = scorePrice(request.priceMin, request.priceMax, offerPrice);
  const featuresResult = scoreFeatures(request.additionalSpecs, offerMeta);

  // Calculate weighted total score
  const totalWeight = weights.propertyType + weights.purpose + weights.location + 
                      weights.area + weights.price + weights.features;
  
  const weightedScore = (
    (typeResult.score * weights.propertyType) +
    (purposeResult.score * weights.purpose) +
    (locationResult.score * weights.location) +
    (areaResult.score * weights.area) +
    (priceResult.score * weights.price) +
    (featuresResult.score * weights.features)
  ) / totalWeight;

  const finalScore = Math.round(weightedScore);

  // Determine match quality label
  let matchQuality;
  if (finalScore >= QUALITY_THRESHOLDS.excellent) {
    matchQuality = "🟢 ممتاز";
  } else if (finalScore >= QUALITY_THRESHOLDS.veryGood) {
    matchQuality = "🟢 جيد جداً";
  } else if (finalScore >= QUALITY_THRESHOLDS.good) {
    matchQuality = "🟡 جيد";
  } else if (finalScore >= QUALITY_THRESHOLDS.acceptable) {
    matchQuality = "🟡 مقبول";
  } else {
    matchQuality = "⚪ ضعيف";
  }

  // Build human-readable explanation
  const explanation = buildExplanation(typeResult, purposeResult, locationResult, areaResult, priceResult, finalScore);

  // Build detailed breakdown
  const breakdown = {
    propertyType: { score: typeResult.score, weight: weights.propertyType, detail: typeResult.detail },
    purpose: { score: purposeResult.score, weight: weights.purpose, detail: purposeResult.detail },
    location: { score: locationResult.score, weight: weights.location, detail: locationResult.detail },
    area: { score: areaResult.score, weight: weights.area, detail: areaResult.detail },
    price: { score: priceResult.score, weight: weights.price, detail: priceResult.detail },
    features: { score: featuresResult.score, weight: weights.features, detail: featuresResult.detail },
  };

  return {
    score: finalScore,
    matched: finalScore >= DEFAULT_MIN_SCORE,
    matchQuality,
    explanation,
    breakdown,
    offerDetails: {
      price: offerPrice,
      area: offerArea,
      location: `${offerNeighborhood} ${offerCity}`.trim(),
      type: offerType,
      purpose: offerPurpose,
    },
  };
}

/**
 * Build human-readable explanation for the match
 * @param {Object} typeResult - Property type score result
 * @param {Object} purposeResult - Purpose score result
 * @param {Object} locationResult - Location score result
 * @param {Object} areaResult - Area score result
 * @param {Object} priceResult - Price score result
 * @param {number} finalScore - Final weighted score
 * @returns {string} Human-readable explanation
 */
function buildExplanation(typeResult, purposeResult, locationResult, areaResult, priceResult, finalScore) {
  const parts = [];

  // Highlight strong matches
  if (typeResult.score >= 90) {
    parts.push("نوع العقار متطابق");
  }
  if (purposeResult.score >= 90) {
    parts.push("الغرض متطابق");
  }
  if (locationResult.score >= 75) {
    parts.push("الموقع مناسب");
  } else if (locationResult.score >= 50) {
    parts.push("الموقع قريب");
  }
  if (areaResult.score >= 80) {
    parts.push("المساحة مناسبة");
  }
  if (priceResult.score >= 80) {
    parts.push("السعر ضمن الميزانية");
  } else if (priceResult.score >= NEUTRAL_SCORE) {
    parts.push("السعر قريب من الميزانية");
  }

  if (parts.length === 0) {
    if (finalScore >= 50) {
      return "تطابق جزئي مع بعض المتطلبات";
    }
    return "تطابق محدود مع المتطلبات";
  }

  return parts.join("، ");
}

/**
 * Find and rank matching offers for a request
 * @param {Object} request - User request object
 * @param {Array} offers - Array of property offers
 * @param {Object} options - Options { minScore, maxResults, weights }
 * @returns {Array} Ranked array of matches with scores
 */
function findIntelligentMatches(request, offers, options = {}) {
  const minScore = options.minScore || DEFAULT_MIN_SCORE;
  const maxResults = options.maxResults || 10;
  const weights = options.weights || DEFAULT_WEIGHTS;

  const matches = [];

  for (const offer of offers) {
    const matchResult = calculateIntelligentMatch(request, offer, weights);

    if (matchResult.score >= minScore) {
      matches.push({
        offer,
        ...matchResult,
      });
    }
  }

  // Sort by score (highest first)
  matches.sort((a, b) => b.score - a.score);

  // Add rank and limit results
  return matches.slice(0, maxResults).map((match, index) => ({
    rank: index + 1,
    ...match,
  }));
}

/**
 * Get current weights (for display/debugging)
 * @returns {Object} Current weights configuration
 */
function getWeights() {
  return { ...DEFAULT_WEIGHTS };
}

/**
 * Get minimum score threshold
 * @returns {number} Minimum score threshold
 */
function getMinScoreThreshold() {
  return DEFAULT_MIN_SCORE;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Main functions
  calculateIntelligentMatch,
  findIntelligentMatches,
  
  // Individual scorers (for testing/debugging)
  scorePropertyType,
  scorePurpose,
  scoreLocation,
  scoreArea,
  scorePrice,
  scoreFeatures,
  
  // Utilities
  calculateDistance,
  formatPrice,
  getWeights,
  getMinScoreThreshold,
  
  // Constants (readonly)
  DEFAULT_WEIGHTS,
  QUALITY_THRESHOLDS,
  NEIGHBORHOOD_COORDS,
  PROPERTY_TYPE_GROUPS,
};
