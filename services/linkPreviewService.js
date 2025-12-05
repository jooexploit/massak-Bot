const axios = require("axios");

/**
 * Extract URLs from text
 * @param {string} text - The text to search for URLs
 * @returns {string[]} Array of URLs found in the text
 */
function extractUrls(text) {
  if (!text) return [];

  // Enhanced URL regex that matches http, https, and www URLs
  const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/gi;
  const matches = text.match(urlRegex);

  if (!matches) return [];

  // Clean and normalize URLs
  return matches.map((url) => {
    // Remove trailing punctuation that might be captured
    url = url.replace(/[.,;!?)]+$/, "");

    // Add https:// if URL starts with www.
    if (url.startsWith("www.")) {
      url = `https://${url}`;
    }

    return url;
  });
}

/**
 * Fetch link preview metadata from a URL
 * @param {string} url - The URL to fetch metadata from
 * @returns {Promise<Object>} Link preview data
 */
async function fetchLinkPreview(url) {
  try {
    console.log(`🔗 Fetching link preview for: ${url}`);

    // Fetch the HTML content
    const response = await axios.get(url, {
      timeout: 10000, // 10 second timeout
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
      },
      maxRedirects: 5,
    });

    const html = response.data;

    // Helper to decode HTML entities
    const decodeHtmlEntities = (text) => {
      if (!text) return text;
      return text
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ");
    };

    // Extract metadata from HTML
    const metadata = {
      title:
        decodeHtmlEntities(
          extractMetaTag(html, "title") || extractTitle(html)
        ) || url,
      description: decodeHtmlEntities(
        extractMetaTag(html, "description") || ""
      ),
      image: extractMetaTag(html, "image") || null,
      url: url,
    };

    console.log(`📋 Extracted metadata:`, {
      title: metadata.title?.substring(0, 50),
      description: metadata.description?.substring(0, 50),
      imageUrl: metadata.image,
    });

    // If we found an image, fetch and convert it to base64
    if (metadata.image) {
      console.log(`🖼️ Attempting to fetch image: ${metadata.image}`);
      try {
        // Handle relative URLs
        if (metadata.image.startsWith("/")) {
          const urlObj = new URL(url);
          metadata.image = `${urlObj.protocol}//${urlObj.host}${metadata.image}`;
        }

        const imageResponse = await axios.get(metadata.image, {
          responseType: "arraybuffer",
          timeout: 10000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        // Convert to base64
        const base64Image = Buffer.from(imageResponse.data).toString("base64");
        metadata.jpegThumbnail = base64Image;

        console.log(
          `✅ Successfully fetched image: ${metadata.image.substring(
            0,
            60
          )}... (${imageResponse.data.length} bytes)`
        );
      } catch (imageError) {
        console.warn(
          `⚠️ Failed to fetch image for ${url}:`,
          imageError.message
        );
        console.warn(`   Image URL was: ${metadata.image}`);

        // Try to fetch favicon as fallback
        try {
          const urlObj = new URL(url);
          const faviconUrl = `${urlObj.protocol}//${urlObj.host}/favicon.ico`;
          console.log(`🔄 Attempting to fetch favicon: ${faviconUrl}`);

          const faviconResponse = await axios.get(faviconUrl, {
            responseType: "arraybuffer",
            timeout: 5000,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });

          metadata.jpegThumbnail = Buffer.from(faviconResponse.data).toString(
            "base64"
          );
          console.log(
            `✅ Using favicon as fallback (${faviconResponse.data.length} bytes)`
          );
        } catch (faviconError) {
          console.warn(`⚠️ Failed to fetch favicon:`, faviconError.message);
          metadata.jpegThumbnail = null;
        }
      }
    } else {
      // No og:image found, try to get favicon
      console.log(`⚠️ No og:image found in metadata, trying favicon...`);
      try {
        const urlObj = new URL(url);
        const faviconUrl = `${urlObj.protocol}//${urlObj.host}/favicon.ico`;
        console.log(`🔄 Fetching favicon: ${faviconUrl}`);

        const faviconResponse = await axios.get(faviconUrl, {
          responseType: "arraybuffer",
          timeout: 5000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        metadata.jpegThumbnail = Buffer.from(faviconResponse.data).toString(
          "base64"
        );
        metadata.image = faviconUrl;
        console.log(`✅ Using favicon (${faviconResponse.data.length} bytes)`);
      } catch (faviconError) {
        console.warn(`⚠️ Failed to fetch favicon:`, faviconError.message);
        metadata.jpegThumbnail = null;
      }
    }

    return metadata;
  } catch (error) {
    console.error(`❌ Failed to fetch link preview for ${url}:`, error.message);
    return null;
  }
}

/**
 * Extract meta tag content from HTML
 * @param {string} html - HTML content
 * @param {string} property - Meta tag property/name
 * @returns {string|null}
 */
function extractMetaTag(html, property) {
  // Try og: property
  const ogRegex = new RegExp(
    `<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["']`,
    "i"
  );
  let match = html.match(ogRegex);
  if (match && match[1]) return match[1];

  // Try twitter: property
  const twitterRegex = new RegExp(
    `<meta[^>]*property=["']twitter:${property}["'][^>]*content=["']([^"']*)["']`,
    "i"
  );
  match = html.match(twitterRegex);
  if (match && match[1]) return match[1];

  // Try name attribute
  const nameRegex = new RegExp(
    `<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`,
    "i"
  );
  match = html.match(nameRegex);
  if (match && match[1]) return match[1];

  // Try content first
  const contentFirstRegex = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["'](?:og:)?${property}["']`,
    "i"
  );
  match = html.match(contentFirstRegex);
  if (match && match[1]) return match[1];

  return null;
}

/**
 * Extract title from HTML
 * @param {string} html - HTML content
 * @returns {string|null}
 */
function extractTitle(html) {
  const titleRegex = /<title[^>]*>([^<]+)<\/title>/i;
  const match = html.match(titleRegex);
  return match && match[1] ? match[1].trim() : null;
}

/**
 * Generate link preview for a message
 * @param {string} message - Message text
 * @returns {Promise<Object|null>} Link preview object or null
 */
async function generateLinkPreview(message) {
  try {
    // Extract URLs from message
    const urls = extractUrls(message);

    if (urls.length === 0) {
      return null; // No URLs found
    }

    // Use the first URL found
    const url = urls[0];

    // Fetch metadata
    const metadata = await fetchLinkPreview(url);

    if (!metadata) {
      return null; // Failed to fetch metadata
    }

    // Build link preview object for Baileys
    const linkPreview = {
      canonicalUrl: url,
      matchedText: url,
      title: metadata.title || "Link Preview",
      description: metadata.description || "",
    };

    // Add thumbnail if available
    if (metadata.jpegThumbnail) {
      linkPreview.jpegThumbnail = Buffer.from(metadata.jpegThumbnail, "base64");
      console.log(
        `✅ Thumbnail added to preview (${linkPreview.jpegThumbnail.length} bytes)`
      );
    } else {
      console.log(`⚠️ No thumbnail available for preview`);
    }

    console.log(`✅ Link preview object created:`, {
      url: linkPreview.canonicalUrl,
      title: linkPreview.title,
      descriptionLength: linkPreview.description.length,
      hasThumbnail: !!linkPreview.jpegThumbnail,
    });

    return linkPreview;
  } catch (error) {
    console.error("❌ Error generating link preview:", error.message);
    return null;
  }
}

module.exports = {
  extractUrls,
  fetchLinkPreview,
  generateLinkPreview,
};
