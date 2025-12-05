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
    // First normalize the area names
    requirements.neighborhoods = areaNormalizer.normalizeAreaNames(
      requirements.neighborhoods
    );
    console.log(
      `📍 Normalized neighborhoods:`,
      requirements.neighborhoods.join(", ")
    );

    // Then check if any are cities and expand them
    const expandedNeighborhoods = [];
    for (const area of requirements.neighborhoods) {
      const expanded = areaNormalizer.expandCityToNeighborhoods(area);
      expandedNeighborhoods.push(...expanded);
    }

    // Remove duplicates
    requirements.neighborhoods = [...new Set(expandedNeighborhoods)];

    if (expandedNeighborhoods.length > requirements.neighborhoods.length) {
      console.log(
        `📍 After city expansion: ${requirements.neighborhoods.join(", ")}`
      );
    }
  }

  // Normalize location if present AND expand if it's a city
  if (requirements.location) {
    const original = requirements.location;
    requirements.location = areaNormalizer.normalizeAreaName(
      requirements.location
    );
    if (original !== requirements.location) {
      console.log(
        `📍 Normalized location: "${original}" → "${requirements.location}"`
      );
    }

    // If location is a city, expand it to neighborhoods
    if (areaNormalizer.isCity(requirements.location)) {
      const cityNeighborhoods = areaNormalizer.expandCityToNeighborhoods(
        requirements.location
      );
      console.log(
        `🏙️  Location "${requirements.location}" is a city - will search in ${cityNeighborhoods.length} neighborhoods`
      );
      // Convert location to neighborhoods array
      if (!requirements.neighborhoods) {
        requirements.neighborhoods = cityNeighborhoods;
      } else {
        // Merge with existing neighborhoods
        requirements.neighborhoods = [
          ...new Set([...requirements.neighborhoods, ...cityNeighborhoods]),
        ];
      }
      // Clear location since we're now using neighborhoods
      delete requirements.location;
    }
  }

  // Check if there are multiple neighborhoods
  const hasMultipleNeighborhoods =
    requirements.neighborhoods &&
    Array.isArray(requirements.neighborhoods) &&
    requirements.neighborhoods.length > 1;

  if (hasMultipleNeighborhoods) {
    console.log(
      `🏘️  Multiple neighborhoods detected: ${requirements.neighborhoods.join(
        ", "
      )}`
    );
    console.log(
      `🔍 Will perform ${requirements.neighborhoods.length} separate searches...`
    );

    const neighborhoodResults = []; // Array to store results per neighborhood with metadata

    // Search for each neighborhood separately
    for (const neighborhood of requirements.neighborhoods) {
      console.log(`\n  📍 Searching in neighborhood: ${neighborhood}`);

      // Create a copy of requirements with single neighborhood
      const singleNeighborhoodReq = {
        ...requirements,
        neighborhoods: [neighborhood],
      };

      const params = mapRequirementsToApiParams(singleNeighborhoodReq);
      const response = await searchWithMultiWordSplit(params);

      console.log(`    ✓ Found ${response.count} results in ${neighborhood}`);

      // When searching by neighborhood explicitly via API, trust the API results
      // The API already filtered by preferred_area, so no need for strict filtering
      // Just use the results directly
      const filteredPosts = response.posts || [];

      // Store results for this neighborhood
      if (
        filteredPosts &&
        Array.isArray(filteredPosts) &&
        filteredPosts.length > 0
      ) {
        neighborhoodResults.push({
          neighborhood: neighborhood,
          results: filteredPosts,
          count: filteredPosts.length,
        });
        console.log(
          `    ✅ Stored ${filteredPosts.length} results for ${neighborhood}`
        );
      } else {
        console.log(`    ⚠️  No results to store for ${neighborhood}`);
      }
    }

    // Smart balancing: distribute fairly based on what's available
    // Give each neighborhood a fair chance to show results
    const numNeighborhoods = neighborhoodResults.length;
    const balancedResults = new Map(); // Use Map to deduplicate by ID

    console.log(
      `\n⚖️  Smart balancing: distributing results fairly from ${numNeighborhoods} neighborhoods`
    );

    // Calculate how many results to take from each based on availability
    neighborhoodResults.forEach((neighborhoodData) => {
      // Take up to 5 results per neighborhood (or all if less than 5)
      // This ensures fair distribution without forcing a total number
      const take = Math.min(5, neighborhoodData.results.length);

      console.log(
        `   📍 ${neighborhoodData.neighborhood}: taking ${take} out of ${neighborhoodData.count} results`
      );

      for (let i = 0; i < take; i++) {
        const post = neighborhoodData.results[i];
        if (post.ID && !balancedResults.has(post.ID)) {
          balancedResults.set(post.ID, post);
        }
      }
    });

    const uniqueResults = Array.from(balancedResults.values());
    console.log(
      `\n✅ Total balanced results from all neighborhoods: ${uniqueResults.length}`
    );

    // Format results to match expected format
    const formattedResults = uniqueResults.map(formatApiResult);
    return formattedResults;
  } else {
    // Single or no neighborhood - use standard search
    const params = mapRequirementsToApiParams(requirements);
    const response = await searchWithMultiWordSplit(params);

    console.log(`✅ Found ${response.count} results`);

    // Get the requested area for filtering
    const requestedArea =
      requirements.location ||
      (requirements.neighborhoods && requirements.neighborhoods[0]);

    // Filter results to match the requested area
    let filteredPosts = response.posts;
    if (requestedArea) {
      filteredPosts = areaNormalizer.filterResultsByArea(
        response.posts,
        requestedArea
      );

      // If no results after filtering, return empty array with message
      if (filteredPosts.length === 0 && response.posts.length > 0) {
        console.log(
          `⚠️ No results found in "${requestedArea}" (${response.posts.length} results found in other areas were excluded)`
        );
      }
    }

    // Format results to match expected format
    const formattedResults = filteredPosts.map(formatApiResult);
    return formattedResults;
  }
}

module.exports = {
  searchMasaak,
  searchWithMultiWordSplit,
  mapRequirementsToApiParams,
  formatApiResult,
  searchWithRequirements,
};
