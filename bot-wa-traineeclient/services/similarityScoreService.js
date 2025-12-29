/**
 * Property Matching & Similarity Scoring Service
 * Calculates weighted similarity scores between property requests (طلب) and offers (عرض)
 * Scoring weights: Price 40%, Area 30%, Location 30%
 */

/**
 * Calculate price similarity score (0-100)
 * Returns how well the offer price matches the requested price range
 * @param {number} requestMinPrice - Requested minimum price
 * @param {number} requestMaxPrice - Requested maximum price
 * @param {number} offerPrice - Offer price
 * @returns {number} Similarity score (0-100)
 */
function calculatePriceSimilarity(
  requestMinPrice,
  requestMaxPrice,
  offerPrice
) {
  // Handle missing or invalid data
  if (!offerPrice || offerPrice <= 0) return 0;
  if (!requestMinPrice && !requestMaxPrice) return 100; // No price preference

  const minPrice = requestMinPrice || 0;
  const maxPrice = requestMaxPrice || Infinity;

  // Perfect match: within range
  if (offerPrice >= minPrice && offerPrice <= maxPrice) {
    return 100;
  }

  // Outside range: calculate distance penalty
  const rangeSize = maxPrice - minPrice;

  if (offerPrice < minPrice) {
    // Below minimum: check how far below
    const distance = minPrice - offerPrice;
    const allowedVariance = rangeSize * 0.25; // 25% below is acceptable (increased from 20%)

    if (distance <= allowedVariance) {
      // Close enough: 75-99 points (increased minimum from 70)
      return Math.max(75, 100 - (distance / allowedVariance) * 25);
    } else {
      // Too far below: 0-74 points
      const excessDistance = distance - allowedVariance;
      return Math.max(0, 75 - (excessDistance / minPrice) * 75);
    }
  } else {
    // Above maximum: check how far above
    const distance = offerPrice - maxPrice;
    const allowedVariance = rangeSize * 0.25; // 25% above is acceptable (increased from 20%)

    if (distance <= allowedVariance) {
      // Close enough: 75-99 points (increased minimum from 70)
      return Math.max(75, 100 - (distance / allowedVariance) * 25);
    } else {
      // Too far above: 0-74 points
      const excessDistance = distance - allowedVariance;
      return Math.max(0, 75 - (excessDistance / maxPrice) * 75);
    }
  }
}

/**
 * Calculate area similarity score (0-100)
 * Returns how well the offer area matches the requested area range
 * @param {number} requestMinArea - Requested minimum area
 * @param {number} requestMaxArea - Requested maximum area
 * @param {number} offerArea - Offer area
 * @returns {number} Similarity score (0-100)
 */
function calculateAreaSimilarity(requestMinArea, requestMaxArea, offerArea) {
  // Handle missing or invalid data
  if (!offerArea || offerArea <= 0) return 0;
  if (!requestMinArea && !requestMaxArea) return 100; // No area preference

  const minArea = requestMinArea || 0;
  const maxArea = requestMaxArea || Infinity;

  // Perfect match: within range
  if (offerArea >= minArea && offerArea <= maxArea) {
    return 100;
  }

  // Outside range: calculate distance penalty
  const rangeSize = maxArea - minArea;

  if (offerArea < minArea) {
    // Below minimum: check how far below
    const distance = minArea - offerArea;
    const allowedVariance = rangeSize * 0.4; // 40% below is acceptable (more flexible)

    if (distance <= allowedVariance) {
      // Close enough: 70-99 points
      return Math.max(70, 100 - (distance / allowedVariance) * 30);
    } else {
      // Too far below but still reasonable: gradual penalty
      const excessDistance = distance - allowedVariance;
      const penalty = (excessDistance / maxArea) * 60;
      return Math.max(10, 70 - penalty);
    }
  } else {
    // Above maximum: check how far above
    const distance = offerArea - maxArea;
    const allowedVariance = rangeSize * 0.25; // 25% above is acceptable

    if (distance <= allowedVariance) {
      // Close enough: 70-99 points
      return Math.max(70, 100 - (distance / allowedVariance) * 30);
    } else {
      // Too far above: gradual penalty
      const excessDistance = distance - allowedVariance;
      const penalty = (excessDistance / maxArea) * 50;
      return Math.max(10, 70 - penalty);
    }
  }
}

/**
 * Calculate location similarity score (0-100)
 * Returns how well the offer location matches the requested neighborhoods
 * @param {Array<string>} requestedNeighborhoods - Array of requested neighborhoods
 * @param {string} offerNeighborhood - Offer neighborhood/location
 * @param {string} offerCity - Offer city
 * @returns {number} Similarity score (0-100)
 */
function calculateLocationSimilarity(
  requestedNeighborhoods,
  offerNeighborhood,
  offerCity
) {
  // Handle missing data
  if (!offerNeighborhood && !offerCity) return 0;
  if (!requestedNeighborhoods || requestedNeighborhoods.length === 0) {
    return 100; // No location preference specified
  }

  const offerLocation = `${offerNeighborhood || ""} ${offerCity || ""}`
    .toLowerCase()
    .trim();

  // Check for exact match
  for (const neighborhood of requestedNeighborhoods) {
    const requestedNeighborhood = neighborhood.toLowerCase().trim();

    // Exact match
    if (
      offerLocation.includes(requestedNeighborhood) ||
      requestedNeighborhood.includes(offerLocation)
    ) {
      return 100;
    }
  }

  // Check for partial match (shared words)
  const offerWords = offerLocation.split(/\s+/).filter((w) => w.length > 2);
  const requestWords = requestedNeighborhoods
    .flatMap((n) => n.toLowerCase().split(/\s+/))
    .filter((w) => w.length > 2);

  let matchingWords = 0;
  for (const offerWord of offerWords) {
    if (
      requestWords.some(
        (rw) => rw.includes(offerWord) || offerWord.includes(rw)
      )
    ) {
      matchingWords++;
    }
  }

  if (matchingWords > 0 && offerWords.length > 0) {
    // Partial match: 50-90 points based on overlap
    const overlapRatio = matchingWords / offerWords.length;
    return Math.round(50 + overlapRatio * 40);
  }

  // Check if same city at least
  const sameCity = requestedNeighborhoods.some((n) => {
    const nLower = n.toLowerCase();
    return (
      (nLower.includes("الهفوف") && offerCity?.includes("الهفوف")) ||
      (nLower.includes("المبرز") && offerCity?.includes("المبرز")) ||
      (nLower.includes("العمران") && offerCity?.includes("العمران"))
    );
  });

  if (sameCity) {
    return 40; // Same city but different neighborhood
  }

  return 0; // No match at all
}

/**
 * Calculate property type similarity (0-100)
 * @param {string} requestedType - Requested property type
 * @param {string} offerType - Offer property type
 * @returns {number} Similarity score (0-100)
 */
function calculatePropertyTypeSimilarity(requestedType, offerType) {
  if (!requestedType || !offerType) return 100; // No type specified

  const reqType = requestedType.toLowerCase().trim();
  const offType = offerType.toLowerCase().trim();

  // Exact match
  if (reqType === offType) return 100;

  // Synonyms and related types
  const synonymGroups = [
    ["بيت", "منزل", "دور", "فيلا"],
    ["شقة", "شقة سكنية"],
    ["دبلكس", "شقة دبلكسية", "شقة دبلكس"],
    ["أرض", "ارض"],
    ["عمارة", "بناية"],
    ["استراحة", "شاليه"],
    ["محل", "محل تجاري"],
  ];

  for (const group of synonymGroups) {
    const reqInGroup = group.some(
      (s) => reqType.includes(s) || s.includes(reqType)
    );
    const offInGroup = group.some(
      (s) => offType.includes(s) || s.includes(offType)
    );

    if (reqInGroup && offInGroup) {
      return 90; // Related type
    }
  }

  // Partial match
  if (reqType.includes(offType) || offType.includes(reqType)) {
    return 70;
  }

  return 0; // Different types
}

/**
 * Calculate purpose similarity (بيع/إيجار)
 * @param {string} requestedPurpose - Requested purpose
 * @param {string} offerPurpose - Offer purpose
 * @returns {number} Similarity score (0-100)
 */
function calculatePurposeSimilarity(requestedPurpose, offerPurpose) {
  if (!requestedPurpose || !offerPurpose) return 100;

  const reqPurpose = requestedPurpose.toLowerCase().trim();
  const offPurpose = offerPurpose.toLowerCase().trim();

  // Normalize to بيع/إيجار
  const normReq =
    reqPurpose.includes("شراء") || reqPurpose.includes("بيع") ? "بيع" : "إيجار";
  const normOff =
    offPurpose.includes("شراء") || offPurpose.includes("بيع") ? "بيع" : "إيجار";

  return normReq === normOff ? 100 : 0;
}

/**
 * Calculate overall similarity score with weighted components
 * Weights: Price 40%, Area 30%, Location 30%
 * Property type and purpose are filters (must match to even calculate score)
 *
 * @param {Object} request - User request (طلب)
 * @param {Object} offer - Property offer (عرض)
 * @returns {Object} Similarity result with score and breakdown
 */
function calculateSimilarityScore(request, offer) {
  // Extract offer data
  const offerPrice = offer.meta?.price_amount || offer.meta?.price || 0;
  const offerArea = offer.meta?.arc_space || offer.meta?.area || 0;
  const offerNeighborhood =
    offer.meta?.location ||
    offer.meta?.neighborhood ||
    offer.meta?.district ||
    "";
  const offerCity = offer.meta?.City || offer.meta?.city || "";
  const offerType = offer.meta?.arc_category || offer.meta?.parent_catt || "";
  const offerPurpose =
    offer.meta?.offer_type ||
    offer.meta?.order_type ||
    offer.meta?.purpose ||
    "";

  // 1. Check property type (must match or be similar)
  const typeSimilarity = calculatePropertyTypeSimilarity(
    request.propertyType,
    offerType
  );

  // 2. Check purpose (must match)
  const purposeSimilarity = calculatePurposeSimilarity(
    request.purpose,
    offerPurpose
  );

  // If type or purpose don't match well enough, reject early
  if (typeSimilarity < 70 || purposeSimilarity < 100) {
    return {
      score: 0,
      matched: false,
      reason:
        typeSimilarity < 70
          ? "Property type mismatch"
          : "Purpose mismatch (بيع/إيجار)",
      breakdown: {
        type: Math.round(typeSimilarity),
        purpose: Math.round(purposeSimilarity),
        price: 0,
        area: 0,
        location: 0,
      },
    };
  }

  // 3. Calculate weighted scores for matching offers
  const priceScore = calculatePriceSimilarity(
    request.priceMin,
    request.priceMax,
    offerPrice
  );

  const areaScore = calculateAreaSimilarity(
    request.areaMin,
    request.areaMax,
    offerArea
  );

  const locationScore = calculateLocationSimilarity(
    request.neighborhoods,
    offerNeighborhood,
    offerCity
  );

  // Calculate weighted total score
  // Price: 40%, Area: 30%, Location: 30%
  const totalScore = Math.round(
    priceScore * 0.4 + areaScore * 0.3 + locationScore * 0.3
  );

  // Build detailed breakdown
  const breakdown = {
    type: Math.round(typeSimilarity),
    purpose: Math.round(purposeSimilarity),
    price: Math.round(priceScore),
    area: Math.round(areaScore),
    location: Math.round(locationScore),
  };

  // Determine match quality
  let matchQuality = "";
  if (totalScore >= 90) {
    matchQuality = "🟢 ممتاز"; // Excellent
  } else if (totalScore >= 80) {
    matchQuality = "🟢 جيد جداً"; // Very Good
  } else if (totalScore >= 70) {
    matchQuality = "🟡 جيد"; // Good
  } else if (totalScore >= 60) {
    matchQuality = "🟡 مقبول"; // Acceptable
  } else {
    matchQuality = "⚪ ضعيف"; // Weak
  }

  return {
    score: totalScore,
    matched: totalScore >= 80, // 80% threshold for auto-notification
    matchQuality,
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
 * Find matching offers for a user request
 * @param {Object} request - User request object
 * @param {Array<Object>} offers - Array of property offers
 * @param {number} minScore - Minimum similarity score (default: 80)
 * @returns {Array<Object>} Array of matched offers with scores
 */
function findMatchingOffers(request, offers, minScore = 80) {
  const matches = [];

  for (const offer of offers) {
    const similarity = calculateSimilarityScore(request, offer);

    if (similarity.score >= minScore) {
      matches.push({
        offer,
        similarity,
      });
    }
  }

  // Sort by score (highest first)
  matches.sort((a, b) => b.similarity.score - a.similarity.score);

  return matches;
}

module.exports = {
  calculatePriceSimilarity,
  calculateAreaSimilarity,
  calculateLocationSimilarity,
  calculatePropertyTypeSimilarity,
  calculatePurposeSimilarity,
  calculateSimilarityScore,
  findMatchingOffers,
};
