/**
 * Deep Search Service
 * Performs intelligent deep search with multiple API call variations
 * to maximize property discovery for user requirements
 */

const masaakSearchService = require("./masaakSearchService");

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
  console.log(`🔎 DEEP SEARCH ENGINE ACTIVATED`);
  console.log(`${"=".repeat(70)}`);
  console.log(`📋 Requirements:`, JSON.stringify(requirements, null, 2));
  console.log(`⚙️  Options:`, { maxResults, includeVariations });
  console.log(`${"=".repeat(70)}\n`);

  const allResults = new Map(); // Deduplicate by ID
  const searchVariations = [];

  // 1. BASE SEARCH - Exact requirements
  console.log(`🎯 [1/4] BASE SEARCH - Exact match...`);
  searchVariations.push({
    label: "BASE (Exact)",
    requirements: { ...requirements },
  });

  if (includeVariations) {
    // 2. PRICE VARIATIONS
    if (requirements.priceMin !== null && requirements.priceMax !== null) {
      console.log(`💰 [2/4] PRICE VARIATIONS - Expanding price range...`);
      const priceVars = generatePriceVariations(
        requirements.priceMin,
        requirements.priceMax
      );

      // Add expanded price searches (skip exact as it's in base)
      priceVars.slice(1, 3).forEach((priceVar) => {
        searchVariations.push({
          label: `PRICE ${priceVar.label}`,
          requirements: {
            ...requirements,
            priceMin: Math.round(priceVar.min),
            priceMax: Math.round(priceVar.max),
          },
        });
      });
    }

    // 3. AREA VARIATIONS
    if (requirements.areaMin !== null && requirements.areaMax !== null) {
      console.log(`📏 [3/4] AREA VARIATIONS - Expanding area range...`);
      const areaVars = generateAreaVariations(
        requirements.areaMin,
        requirements.areaMax
      );

      // Add expanded area searches (skip exact)
      areaVars.slice(1, 3).forEach((areaVar) => {
        searchVariations.push({
          label: `AREA ${areaVar.label}`,
          requirements: {
            ...requirements,
            areaMin: Math.round(areaVar.min),
            areaMax: Math.round(areaVar.max),
          },
        });
      });
    }

    // 4. PROPERTY TYPE VARIATIONS
    if (requirements.propertyType) {
      console.log(`🏠 [4/4] PROPERTY TYPE VARIATIONS - Trying synonyms...`);
      const typeVars = generatePropertyTypeVariations(
        requirements.propertyType
      );

      // Add type variations (skip first as it's likely in base)
      typeVars.slice(1, 3).forEach((typeVar) => {
        searchVariations.push({
          label: `TYPE: ${typeVar}`,
          requirements: {
            ...requirements,
            propertyType: typeVar,
          },
        });
      });
    }
  }

  console.log(`\n📊 EXECUTING ${searchVariations.length} SEARCH VARIATIONS:\n`);

  // Execute all search variations
  let searchCount = 0;
  for (const variation of searchVariations) {
    searchCount++;
    console.log(
      `  [${searchCount}/${searchVariations.length}] ${variation.label}...`
    );

    try {
      const results = await masaakSearchService.searchWithRequirements(
        variation.requirements
      );

      // Add to map (deduplicates by ID)
      results.forEach((result) => {
        if (result.id && !allResults.has(result.id)) {
          allResults.set(result.id, result);
        }
      });

      console.log(
        `    ✓ Found ${results.length} results (Total unique: ${allResults.size})`
      );

      // Small delay between searches to keep connection alive
      await new Promise((resolve) => setTimeout(resolve, 300));

      // If no results found and neighborhoods exist, try city-only search
      if (
        results.length === 0 &&
        variation.requirements.neighborhoods &&
        variation.requirements.neighborhoods.length > 0
      ) {
        console.log(
          `    🔄 No results with district/neighborhood, trying city-only search...`
        );

        // Create variation without neighborhoods (city only)
        const cityOnlyReq = {
          ...variation.requirements,
          neighborhoods: [], // Empty array = search entire city
        };

        try {
          const cityResults = await masaakSearchService.searchWithRequirements(
            cityOnlyReq
          );

          // Add city-wide results
          cityResults.forEach((result) => {
            if (result.id && !allResults.has(result.id)) {
              allResults.set(result.id, result);
            }
          });

          console.log(
            `    ✓ City-wide search found ${cityResults.length} results (Total unique: ${allResults.size})`
          );

          // Small delay after city-wide search
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch (cityError) {
          console.error(`    ⚠️  City-wide search failed:`, cityError.message);
        }
      }

      // Stop if we have enough results
      if (allResults.size >= maxResults * 2) {
        console.log(
          `    ⏸️  Reached ${allResults.size} results, stopping variations early`
        );
        break;
      }
    } catch (error) {
      console.error(
        `    ❌ Error in variation "${variation.label}":`,
        error.message
      );
    }
  }

  const uniqueResults = Array.from(allResults.values());

  console.log(`\n${"=".repeat(70)}`);
  console.log(`✅ DEEP SEARCH COMPLETE`);
  console.log(`   Total searches executed: ${searchCount}`);
  console.log(`   Unique properties found: ${uniqueResults.length}`);
  console.log(
    `   Returning top: ${Math.min(maxResults, uniqueResults.length)}`
  );
  console.log(`${"=".repeat(70)}\n`);

  // Return top results (will be scored later)
  return uniqueResults.slice(0, maxResults);
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
