/**
 * Search Scoring Service
 * Calculates relevance scores for search results based on user requirements.
 */

/**
 * Calculate the relevance score for a single result (0-100)
 * @param {Object} result - The formatted API result
 * @param {Object} req - The user requirements
 * @returns {number} Score from 0 to 100
 */
function calculateRelevanceScore(result, req) {
  let score = 0;
  const meta = result.meta || {};

  // 1. Territory Match (Max 40 pts)
  if (!result.isFallback) {
    score += 40; // Exact/Requested district match
  } else {
    score += 10; // City-wide fallback match
  }

  // 2. Sub-category Match (Max 20 pts)
  if (req.subCategory && meta.sub_catt) {
    const reqSub = req.subCategory.toLowerCase();
    const metaSub = meta.sub_catt.toLowerCase();
    
    if (metaSub === reqSub) {
      score += 20;
    } else if (metaSub.includes(reqSub) || reqSub.includes(metaSub)) {
      score += 10;
    }
  } else if (!req.subCategory) {
    score += 10; // Neutral if not requested
  }

  // 3. Price Proximity (Max 15 pts)
  if (req.priceMax && meta.price_amount > 0) {
    const price = meta.price_amount;
    if (price >= req.priceMin && price <= req.priceMax) {
      score += 15;
    } else {
      // Partial score for being close (within 20%)
      const minBound = req.priceMin * 0.8;
      const maxBound = req.priceMax * 1.2;
      if (price >= minBound && price <= maxBound) {
        score += 7;
      }
    }
  } else {
    score += 7; // Neutral
  }

  // 4. Area Proximity (Max 15 pts)
  if (req.areaMax && meta.arc_space > 0) {
    const area = meta.arc_space;
    if (area >= req.areaMin && area <= req.areaMax) {
      score += 15;
    } else {
      // Partial score for being close (within 20%)
      const minBound = req.areaMin * 0.8;
      const maxBound = req.areaMax * 1.2;
      if (area >= minBound && area <= maxBound) {
        score += 7;
      }
    }
  } else {
    score += 7; // Neutral
  }

  // 5. Keyword Match in Title (Max 10 pts)
  if (req.propertyType && result.title?.rendered) {
    if (result.title.rendered.toLowerCase().includes(req.propertyType.toLowerCase())) {
      score += 10;
    }
  }
  
  if (req.subCategory && result.title?.rendered) {
     if (result.title.rendered.toLowerCase().includes(req.subCategory.toLowerCase())) {
      score += 5; // Bonus for subcategory in title
    }
  }

  return Math.min(Math.round(score), 100);
}

/**
 * Score and sort a list of results
 * @param {Array} results - List of formatted results
 * @param {Object} requirements - User requirements
 * @returns {Array} Scored and sorted results
 */
function scoreAndSortResults(results, requirements) {
  if (!Array.isArray(results)) return [];

  return results
    .map(result => ({
      ...result,
      relevanceScore: calculateRelevanceScore(result, requirements)
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

module.exports = {
  calculateRelevanceScore,
  scoreAndSortResults
};
