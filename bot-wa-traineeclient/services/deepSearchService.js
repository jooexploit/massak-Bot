/**
 * Deep Search Service
 * Performs intelligent deep search with multiple API call variations
 * to maximize property discovery for user requirements
 */

const masaakSearchService = require("./masaakSearchService");
const searchScoringService = require("./searchScoringService");

/**
 * Generate price range variations (expand ±20%, ±30%)
 * @param {number} minPrice - Original min price
 * @param {number} maxPrice - Original max price
 * @returns {Array<Object>} Array of price range variations
 */
function generatePriceVariations(minPrice, maxPrice) {
  const variations = [];

  // Original range
  variations.push({ min: minPrice, max: maxPrice, label: "exact" });

  // Expand by 20%
  const range20 = (maxPrice - minPrice) * 0.2;
  variations.push({
    min: Math.max(0, minPrice - range20),
    max: maxPrice + range20,
    label: "+20%",
  });

  // Expand by 30%
  const range30 = (maxPrice - minPrice) * 0.3;
  variations.push({
    min: Math.max(0, minPrice - range30),
    max: maxPrice + range30,
    label: "+30%",
  });

  // Budget-conscious (lower 80% of budget)
  if (minPrice > 0) {
    variations.push({
      min: minPrice * 0.8,
      max: maxPrice * 0.8,
      label: "-20% budget",
    });
  }

  return variations;
}

/**
 * Generate area range variations (expand ±15%, ±25%)
 * @param {number} minArea - Original min area
 * @param {number} maxArea - Original max area
 * @returns {Array<Object>} Array of area range variations
 */
function generateAreaVariations(minArea, maxArea) {
  const variations = [];

  // Original range
  variations.push({ min: minArea, max: maxArea, label: "exact" });

  // Expand by 15%
  const range15 = (maxArea - minArea) * 0.15;
  variations.push({
    min: Math.max(0, minArea - range15),
    max: maxArea + range15,
    label: "+15%",
  });

  // Expand by 25%
  const range25 = (maxArea - minArea) * 0.25;
  variations.push({
    min: Math.max(0, minArea - range25),
    max: maxArea + range25,
    label: "+25%",
  });

  return variations;
}

/**
 * Generate property type variations and synonyms
 * @param {string} propertyType - Original property type
 * @returns {Array<string>} Array of property type variations
 */
function generatePropertyTypeVariations(propertyType) {
  if (!propertyType) return [""];

  const synonymMap = {
    بيت: ["بيت", "منزل", "دور", "فيلا"],
    منزل: ["بيت", "منزل", "دور", "فيلا"],
    فيلا: ["فيلا", "بيت", "منزل"],
    شقة: ["شقة", "شقة سكنية"],
    دبلكس: ["دبلكس", "شقة دبلكسية", "شقة دبلكس"],
    أرض: ["أرض", "ارض"],
    ارض: ["أرض", "ارض"],
    عمارة: ["عمارة", "بناية"],
    استراحة: ["استراحة", "شاليه"],
    محل: ["محل", "محل تجاري"],
  };

  const lowerType = propertyType.toLowerCase().trim();

  // Find synonyms
  for (const [key, synonyms] of Object.entries(synonymMap)) {
    if (lowerType.includes(key) || key.includes(lowerType)) {
      return synonyms;
    }
  }

  // If no synonyms found, return original
  return [propertyType];
}

/**
 * Perform deep search with multiple variations
 * @param {Object} requirements - User requirements
 * @param {Object} options - Search options
 * @param {number} options.maxResults - Maximum results to return (default: 20)
 * @param {boolean} options.includeVariations - Include search variations (default: true)
 * @returns {Promise<Array>} Array of unique formatted results
 */
async function performDeepSearch(requirements, options = {}) {
  const maxResults = options.maxResults || 20;
  const includeVariations = options.includeVariations !== false;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`🔎 OPTIMIZED SEARCH ENGINE ACTIVATED`);
  console.log(`${"=".repeat(70)}`);

  const allResults = new Map(); // Deduplicate by ID

  // --- BUCKET 1: Precise Search (Exact match) ---
  console.log(`🎯 [1/3] PRECISE SEARCH...`);
  try {
    const baseResults = await masaakSearchService.searchWithRequirements(requirements);
    baseResults.forEach(r => { if (!allResults.has(r.id)) allResults.set(r.id, r); });
    console.log(`   ✓ Found ${baseResults.length} exact matches.`);
  } catch (e) {
    console.error(`   ❌ Precise search failed:`, e.message);
  }

  // --- BUCKET 2: Relaxed Search (Merged Variations) ---
  // If we don't have enough results or includeVariations is true
  if (includeVariations && allResults.size < maxResults) {
    console.log(`💰 [2/3] RELAXED SEARCH (Merged variations)...`);
    
    // Create relaxed requirements (Price ±30%, Area ±25%, synonyms)
    const relaxedReq = { ...requirements };
    
    // Relax Price
    if (requirements.priceMin !== null && requirements.priceMax !== null) {
      const pRange = (requirements.priceMax - requirements.priceMin) * 0.3;
      relaxedReq.priceMin = Math.max(0, Math.round(requirements.priceMin - pRange));
      relaxedReq.priceMax = Math.round(requirements.priceMax + pRange);
    }
    
    // Relax Area
    if (requirements.areaMin !== null && requirements.areaMax !== null) {
      const aRange = (requirements.areaMax - requirements.areaMin) * 0.25;
      relaxedReq.areaMin = Math.max(0, Math.round(requirements.areaMin - aRange));
      relaxedReq.areaMax = Math.round(requirements.areaMax + aRange);
    }
    
    // Property Type variations are handled by the synonyms logic inside searchWithRequirements (if updated)
    // or we can pick a common synonym here.
    const synonyms = generatePropertyTypeVariations(requirements.propertyType);
    if (synonyms.length > 1) {
      relaxedReq.propertyType = synonyms[1]; // Try the first major synonym
    }

    try {
      const relaxedResults = await masaakSearchService.searchWithRequirements(relaxedReq);
      relaxedResults.forEach(r => { if (!allResults.has(r.id)) allResults.set(r.id, r); });
      console.log(`   ✓ Found ${relaxedResults.length} relaxed matches.`);
    } catch (e) {
      console.error(`   ❌ Relaxed search failed:`, e.message);
    }
  }

  // --- BUCKET 3: City-wide Fallback (Only if desperate) ---
  if (includeVariations && allResults.size === 0 && (requirements.neighborhoods?.length > 0 || requirements.location)) {
    console.log(`🏙️  [3/3] TERRITORY FALLBACK (City-wide)...`);
    const fallbackReq = { ...requirements, neighborhoods: [], location: null };
    
    try {
      const fallbackResults = await masaakSearchService.searchWithRequirements(fallbackReq);
      fallbackResults.forEach(r => { if (!allResults.has(r.id)) allResults.set(r.id, r); });
      console.log(`   ✓ Found ${fallbackResults.length} city-wide matches.`);
    } catch (e) {
      console.error(`   ❌ Fallback search failed:`, e.message);
    }
  }

  let results = Array.from(allResults.values());

  // --- Post-Processing: Scoring & Ranking ---
  console.log(`\n⚖️  Scoring and ranking ${results.length} results...`);
  results = searchScoringService.scoreAndSortResults(results, requirements);

  console.log(`\n✅ SEARCH COMPLETE. Total unique properties: ${results.length}`);
  return results.slice(0, maxResults);
}

/**
 * Quick search wrapper (no variations, just exact match)
 * @param {Object} requirements - User requirements
 * @returns {Promise<Array>} Array of results
 */
async function performQuickSearch(requirements) {
  return performDeepSearch(requirements, {
    maxResults: 5,
    includeVariations: false,
  });
}

module.exports = {
  performDeepSearch,
  performQuickSearch,
  generatePriceVariations,
  generateAreaVariations,
  generatePropertyTypeVariations,
};
