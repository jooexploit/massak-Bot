/**
 * Masaak Custom Search Service
 * Uses the new custom search API at https://masaak.com/wp-content/search.php
 */

const https = require("https");
const areaNormalizer = require("./areaNormalizer");

/**
 * Search using the custom Masaak API
 * @param {Object} params - Search parameters
 * @param {string} params.property_type - Property type (e.g., "بيت", "شقة", "أرض")
 * @param {string} params.preferred_area - Preferred area/neighborhood (e.g., "الخالدية")
 * @param {string} params.purpose - Purpose: "بيع" or "إيجار" (optional)
 * @param {number} params.min_price - Minimum price (optional)
 * @param {number} params.max_price - Maximum price (optional)
 * @param {number} params.min_area - Minimum area in m² (optional)
 * @param {number} params.max_area - Maximum area in m² (optional)
 * @param {number} params.page - Page number for pagination (default: 1)
 * @returns {Promise<Object>} Search results with filters, total, count, and posts array
 */
async function searchMasaak(params) {
  return new Promise((resolve, reject) => {
    // Build query parameters - only include defined values
    const searchParams = {};

    if (params.property_type) searchParams.property_type = params.property_type;
    if (params.preferred_area)
      searchParams.preferred_area = params.preferred_area;
    if (params.purpose) searchParams.purpose = params.purpose;
    if (params.min_price !== undefined)
      searchParams.min_price = params.min_price;
    if (params.max_price !== undefined)
      searchParams.max_price = params.max_price;
    if (params.min_area !== undefined) searchParams.min_area = params.min_area;
    if (params.max_area !== undefined) searchParams.max_area = params.max_area;
    if (params.page) searchParams.page = params.page;

    // Build URL with encoded parameters
    const queryString = Object.entries(searchParams)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");

    const url = `https://masaak.com/wp-content/search.php?${queryString}`;

    console.log(`🔍 Calling Masaak Custom API: ${url}`);
    console.log(`📋 Search params:`, JSON.stringify(searchParams, null, 2));

    https
      .get(url, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            const response = JSON.parse(data);

            // Validate new response structure
            if (!response.posts || !Array.isArray(response.posts)) {
              console.error("⚠️ Invalid API response structure:", response);
              resolve({
                filters: searchParams,
                total: 0,
                count: 0,
                posts: [],
              });
              return;
            }

            console.log(
              `✅ API returned ${response.count} results out of ${
                response.total
              } total (page ${searchParams.page || 1})`
            );

            resolve(response);
          } catch (error) {
            console.error("❌ Error parsing API response:", error);
            console.error("Raw response:", data.substring(0, 500));
            resolve({
              filters: searchParams,
              total: 0,
              count: 0,
              posts: [],
            });
          }
        });
      })
      .on("error", (error) => {
        console.error("❌ Error calling Masaak API:", error);
        resolve({
          filters: searchParams,
          total: 0,
          count: 0,
          posts: [],
        });
      });
  });
}

/**
 * Map user requirements to API parameters
 * @param {Object} requirements - User requirements object
 * @returns {Object} API parameters
 */
function mapRequirementsToApiParams(requirements) {
  const params = {};

  // Map property type
  if (requirements.propertyType) {
    params.property_type = requirements.propertyType;
  }

  // Map sub-category if present
  if (requirements.subCategory) {
    params.sub_catt = requirements.subCategory;
    params.arc_subcategory = requirements.subCategory;
  }

  // Map preferred area (neighborhoods/location) with normalization
  if (requirements.location) {
    params.preferred_area = areaNormalizer.normalizeAreaName(
      requirements.location
    );
  } else if (
    requirements.neighborhoods &&
    Array.isArray(requirements.neighborhoods) &&
    requirements.neighborhoods.length > 0
  ) {
    // Use first neighborhood if multiple provided, and normalize it
    params.preferred_area = areaNormalizer.normalizeAreaName(
      requirements.neighborhoods[0]
    );
  }

  // Map purpose (transaction type)
  // NOTE: The purpose filter might be strict - consider omitting if flexibility is needed
  if (requirements.purpose) {
    if (
      requirements.purpose.includes("شراء") ||
      requirements.purpose.includes("بيع")
    ) {
      // Uncomment to enable purpose filtering (may reduce results significantly)
      // params.purpose = "بيع";
    } else if (requirements.purpose.includes("إيجار")) {
      params.purpose = "إيجار";
    }
  } else if (requirements.transactionType) {
    if (
      requirements.transactionType.includes("شراء") ||
      requirements.transactionType.includes("بيع")
    ) {
      // Uncomment to enable purpose filtering (may reduce results significantly)
      // params.purpose = "بيع";
    } else if (requirements.transactionType.includes("إيجار")) {
      params.purpose = "إيجار";
    }
  }

  // Map price range
  if (requirements.priceMin !== undefined && requirements.priceMin > 0) {
    params.min_price = requirements.priceMin;
  }
  if (requirements.priceMax !== undefined && requirements.priceMax > 0) {
    params.max_price = requirements.priceMax;
  }

  // Map area range
  if (requirements.areaMin !== undefined && requirements.areaMin > 0) {
    params.min_area = requirements.areaMin;
  }
  if (requirements.areaMax !== undefined && requirements.areaMax > 0) {
    params.max_area = requirements.areaMax;
  }

  // Default page to 1
  params.page = requirements.page || 1;

  return params;
}

/**
 * Convert API result to the format expected by the bot
 * @param {Object} post - API post item from the new response format
 * @returns {Object} Formatted post object
 */
function formatApiResult(post) {
  return {
    id: post.ID,
    title: {
      rendered: post.title,
    },
    link: post.link,
    excerpt: {
      rendered: "", // Not provided in new API
    },
    content: {
      rendered: "", // Not provided in new API
    },
    // Extract featured media from thumbnail
    _embedded: post.thumbnail
      ? {
          "wp:featuredmedia": [
            {
              source_url: post.thumbnail,
              media_details: {
                sizes: {
                  full: { source_url: post.thumbnail },
                  medium: { source_url: post.thumbnail },
                },
              },
            },
          ],
        }
      : undefined,
    // Store metadata in the format expected by the bot
    meta: {
      // Price - parse the price_amount field
      price_amount: parseFloat(post.price_amount) || 0,
      price_text: post.price_amount || "غير محدد",

      // Area - parse the space field
      arc_space: parseFloat(post.space) || 0,
      area_text: post.space || "غير محدد",

      // Location details
      City: post.city || "",
      neighborhood: post.location || "",
      location: post.location || "",

      // Property type
      arc_category: post.property_type || "",
      parent_catt: post.property_type || "",

      // Purpose/offer type
      offer_type: post.purpose || "",
      order_type: post.purpose || "",

      // Sub-category fields
      sub_catt: post.sub_catt || "",
      arc_subcategory: post.arc_subcategory || "",

      // Date field
      post_date: post.date || "",
    },
    // Store raw API data for reference
    apiData: post,
  };
}

/**
 * Search with multi-word split support
 * Handles cases like "عين موسى" by searching for "عين" and "موسى" separately
 * @param {Object} params - Search parameters
 * @returns {Promise<Object>} Combined and deduplicated search results
 */
async function searchWithMultiWordSplit(params) {
  const results = new Map(); // Use Map to deduplicate by ID
  const searchTerms = [];

  // Check which fields have spaces and need splitting
  const fieldsToSplit = ["preferred_area", "property_type"];

  for (const field of fieldsToSplit) {
    if (params[field] && params[field].trim().includes(" ")) {
      const words = params[field].trim().split(/\s+/);
      console.log(
        `🔀 Splitting ${field} "${params[field]}" into: ${words.join(", ")}`
      );

      // Search for each word separately
      for (const word of words) {
        if (word.length > 0) {
          const modifiedParams = { ...params };
          modifiedParams[field] = word;
          searchTerms.push({ field, word, params: modifiedParams });
        }
      }

      // Also keep the original full phrase search
      searchTerms.push({ field, word: params[field], params: { ...params } });
    }
  }

  // If no multi-word fields found, just do a single search
  if (searchTerms.length === 0) {
    return await searchMasaak(params);
  }

  console.log(
    `🔍 Performing ${searchTerms.length} searches for multi-word terms...`
  );

  // Execute all searches
  for (const searchTerm of searchTerms) {
    console.log(`  → Searching with ${searchTerm.field}="${searchTerm.word}"`);
    const response = await searchMasaak(searchTerm.params);

    // Add results to map (automatically deduplicates by ID)
    if (response.posts && Array.isArray(response.posts)) {
      response.posts.forEach((post) => {
        if (post.ID && !results.has(post.ID)) {
          results.set(post.ID, post);
        }
      });
    }
  }

  const uniqueResults = Array.from(results.values());
  console.log(`✅ Combined results: ${uniqueResults.length} unique properties`);

  return {
    filters: params,
    total: uniqueResults.length,
    count: uniqueResults.length,
    posts: uniqueResults,
  };
}

/**
 * Search with requirements object (convenience function)
 * Handles multiple neighborhoods by searching each separately
 * @param {Object} requirements - User requirements
 * @returns {Promise<Array>} Array of formatted results
 */
async function searchWithRequirements(requirements) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🚀 MASAAK CUSTOM API SEARCH`);
  console.log(`${"=".repeat(60)}`);
  console.log(`📋 User Requirements:`, JSON.stringify(requirements, null, 2));

  // Normalize neighborhoods if present AND expand cities to neighborhoods
  if (requirements.neighborhoods && Array.isArray(requirements.neighborhoods)) {
    requirements.neighborhoods = areaNormalizer.normalizeAreaNames(
      requirements.neighborhoods
    );
    
    const expandedNeighborhoods = [];
    for (const area of requirements.neighborhoods) {
      const expanded = areaNormalizer.expandCityToNeighborhoods(area);
      expandedNeighborhoods.push(...expanded);
    }
    requirements.neighborhoods = [...new Set(expandedNeighborhoods)];
  }

  // Normalize location if present AND expand if it's a city
  if (requirements.location) {
    requirements.location = areaNormalizer.normalizeAreaName(requirements.location);
    if (areaNormalizer.isCity(requirements.location)) {
      const cityNeighborhoods = areaNormalizer.expandCityToNeighborhoods(requirements.location);
      if (!requirements.neighborhoods) {
        requirements.neighborhoods = cityNeighborhoods;
      } else {
        requirements.neighborhoods = [...new Set([...requirements.neighborhoods, ...cityNeighborhoods])];
      }
      delete requirements.location;
    }
  }

  // Check if there are multiple neighborhoods
  const neighborhoods = requirements.neighborhoods || [];
  const hasMultipleNeighborhoods = neighborhoods.length > 1;

  if (hasMultipleNeighborhoods) {
    const balancedResults = new Map();
    for (const neighborhood of neighborhoods) {
      const singleReq = { ...requirements, neighborhoods: [neighborhood] };
      const params = mapRequirementsToApiParams(singleReq);
      const response = await searchWithMultiWordSplit(params);
      
      if (response.posts && response.posts.length > 0) {
        // Take top 5 from each neighborhood for balance
        response.posts.slice(0, 5).forEach(post => {
          if (!balancedResults.has(post.ID)) {
            balancedResults.set(post.ID, formatApiResult(post));
          }
        });
      }
    }
    return Array.from(balancedResults.values());
  } else {
    // Single or no neighborhood
    const params = mapRequirementsToApiParams(requirements);
    const response = await searchWithMultiWordSplit(params);
    
    // Check for city-wide fallback
    const isFallback = !params.preferred_area && neighborhoods.length > 0;
    
    let results = response.posts.map(post => {
      const formatted = formatApiResult(post);
      if (isFallback) {
        formatted.isFallback = true;
        formatted.fallbackReason = "بحث عام على مستوى المدينة";
      }
      return formatted;
    });

    // Final filtering if a specific area was requested but API didn't support it strictly
    const requestedArea = requirements.location || neighborhoods[0];
    if (requestedArea && !isFallback) {
      results = areaNormalizer.filterResultsByArea(results, requestedArea);
    }

    return results;
  }
}

module.exports = {
  searchMasaak,
  searchWithMultiWordSplit,
  mapRequirementsToApiParams,
  formatApiResult,
  searchWithRequirements,
};
