/**
 * Watermark Service
 * Adds watermarks to images before WordPress upload
 * 
 * - Masaak (مسعاك): Text Overlay
 * - Hasak (حساك): Logo Watermark
 */

const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

// =====================================================
// TODO: CUSTOMIZE - Watermark Configuration
// =====================================================

/**
 * Masaak Text Overlay Configuration
 * TODO: CUSTOMIZE - Change text, font size, color, position
 */
const MASAAK_CONFIG = {
  // Text split into 2 lines for better display
  textLines: [
    "حتى لاتضيع الحقوق وإبراء للذمة", // Line 1: Disclaimer message
    "إذا شاهدت الإعلان تواصل فقط مع منصة مسعاك 0508001475" // Line 2: Contact info with phone number
  ],
  baseFontSize: 32, // Base font size - will be scaled based on image width
  minFontSize: 16, // Minimum font size for very small images
  maxFontSize: 48, // Maximum font size for very large images
  fontFamily: "Cairo, Arial, sans-serif", // Cairo font with fallbacks
  fontWeight: "normal", // Normal weight as requested
  fontColor: "#000000", // Text color (black)
  backgroundColor: "#FFFFFF", // Background color (white)
  position: "bottom-center",
  padding: 10,
};

/**
 * Hasak Logo Watermark Configuration
 * TODO: CUSTOMIZE - Change logo path, opacity, size, position
 */
const HASAK_CONFIG = {
  logoPath: path.join(__dirname, "..", "assets", "hasak_logo.png"), // TODO: CUSTOMIZE - Path to logo
  opacity: 0.8, // TODO: CUSTOMIZE - Logo opacity (0.0 - 1.0)
  scale: 0.20, // TODO: CUSTOMIZE - Logo size as percentage of image width (0.15 = 15%)
  position: "top-left", // Changed to top-left as requested
  padding: 40, // TODO: CUSTOMIZE - Padding from edges
  circular: true, // Make logo circular with border radius
};

// =====================================================
// Watermark Functions
// =====================================================

/**
 * Calculate position coordinates for watermark placement
 * @param {number} imageWidth - Width of the main image
 * @param {number} imageHeight - Height of the main image
 * @param {number} overlayWidth - Width of the overlay/watermark
 * @param {number} overlayHeight - Height of the overlay/watermark
 * @param {string} position - Position name (top-left, top-right, bottom-left, bottom-right, center)
 * @param {number} padding - Padding from edges
 * @returns {{left: number, top: number}} - Position coordinates
 */
function calculatePosition(
  imageWidth,
  imageHeight,
  overlayWidth,
  overlayHeight,
  position,
  padding = 20
) {
  const positions = {
    "top-left": { left: padding, top: padding },
    "top-right": { left: imageWidth - overlayWidth - padding, top: padding },
    "bottom-left": {
      left: padding,
      top: imageHeight - overlayHeight - padding,
    },
    "bottom-right": {
      left: imageWidth - overlayWidth - padding,
      top: imageHeight - overlayHeight - padding,
    },
    center: {
      left: Math.floor((imageWidth - overlayWidth) / 2),
      top: Math.floor((imageHeight - overlayHeight) / 2),
    },
  };

  return positions[position] || positions["bottom-right"];
}

/**
 * Add text overlay to image (for Masaak)
 * Supports multi-line text using textLines array
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {Object} config - Text overlay configuration
 * @returns {Promise<Buffer>} - Image buffer with text overlay
 */
async function addTextOverlay(imageBuffer, config = MASAAK_CONFIG) {
  try {
    console.log("🖼️ Adding text overlay to image...");

    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;

    // Support both textLines array and legacy single text property
    const textLines = config.textLines || [config.text];
    const lineCount = textLines.length;
    
    // Calculate responsive font size based on image width
    // This ensures text fits properly on both horizontal and vertical images
    const baseFontSize = config.baseFontSize || config.fontSize || 32;
    const minFontSize = config.minFontSize || 14;
    const maxFontSize = config.maxFontSize || 48;
    
    // Scale font based on image width (reference: 1080px = base font size)
    const scaleFactor = width / 1080;
    let fontSize = Math.round(baseFontSize * scaleFactor);
    fontSize = Math.max(minFontSize, Math.min(maxFontSize, fontSize));
    
    // Get font settings
    const fontFamily = config.fontFamily || "Cairo, Arial, sans-serif";
    const fontWeight = config.fontWeight || "normal";
    
    // Calculate dimensions - make box span full width for better visibility
    const boxWidth = width; // Full image width
    const lineHeight = fontSize * 1.6; // Line height with spacing
    const boxHeight = (lineCount * lineHeight) + (config.padding * 2);
    
    // Position at the bottom of the image
    const pos = {
      left: 0,
      top: height - boxHeight
    };
    
    // Build text elements for each line (RTL Arabic text)
    const textElements = textLines.map((line, index) => {
      // Calculate Y position: start from top padding, add line height for each subsequent line
      const yPos = config.padding + (index * lineHeight) + (lineHeight / 2) + (fontSize * 0.35);
      
      return `
        <text x="${boxWidth / 2}" y="${yPos}" 
              font-family="${fontFamily}" 
              font-size="${fontSize}px" 
              font-weight="${fontWeight}"
              fill="${config.fontColor}" 
              text-anchor="middle" 
              dominant-baseline="middle"
              direction="rtl">${escapeXml(line)}</text>`;
    }).join('\n');

    // Create SVG text overlay with background
    // Include Google Fonts import for Cairo font
    const svgText = `
      <svg width="${boxWidth}" height="${boxHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&amp;display=swap');
          </style>
        </defs>
        <rect x="0" y="0" width="${boxWidth}" height="${boxHeight}" 
              fill="${config.backgroundColor}" fill-opacity="0.9"/>
        ${textElements}
      </svg>
    `;
    
    console.log(`📏 Image: ${width}x${height}, Box: ${boxWidth}x${boxHeight}, Font: ${fontSize}px`);
    console.log(`📝 Rendering ${lineCount} text line(s) with ${fontFamily}`);

    // Composite the text overlay onto the image
    const result = await sharp(imageBuffer)
      .composite([
        {
          input: Buffer.from(svgText),
          top: Math.max(0, Math.floor(pos.top)),
          left: Math.floor(pos.left),
        },
      ])
      .toBuffer();

    console.log("✅ Text overlay added successfully");
    return result;
  } catch (error) {
    console.error("❌ Error adding text overlay:", error.message);
    // Return original image if watermark fails
    return imageBuffer;
  }
}

/**
 * Escape special XML characters in text
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text safe for SVG
 */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Add logo watermark to image (for Hasak)
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {Object} config - Logo watermark configuration
 * @returns {Promise<Buffer>} - Image buffer with logo watermark
 */
async function addLogoWatermark(imageBuffer, config = HASAK_CONFIG) {
  try {
    console.log("🖼️ Adding logo watermark to image...");

    // Check if logo file exists
    if (!fs.existsSync(config.logoPath)) {
      console.warn(
        `⚠️ Logo file not found at: ${config.logoPath}. Skipping watermark.`
      );
      return imageBuffer;
    }

    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;

    // Calculate logo size based on scale
    const logoSize = Math.floor(width * config.scale);

    // Resize logo to square for circular crop
    let logoBuffer = await sharp(config.logoPath)
      .resize(logoSize, logoSize, { fit: 'cover' })
      .toBuffer();

    // Apply circular mask if circular option is enabled
    if (config.circular) {
      // Create a circular mask using SVG
      const circleMask = Buffer.from(`
        <svg width="${logoSize}" height="${logoSize}">
          <circle cx="${logoSize / 2}" cy="${logoSize / 2}" r="${logoSize / 2}" fill="white"/>
        </svg>
      `);

      // Apply the circular mask to the logo
      logoBuffer = await sharp(logoBuffer)
        .composite([{
          input: circleMask,
          blend: 'dest-in'
        }])
        .png()
        .toBuffer();
      
      console.log(`🔵 Applied circular mask to logo (${logoSize}x${logoSize})`);
    }

    // Apply opacity
    if (config.opacity < 1) {
      logoBuffer = await sharp(logoBuffer)
        .ensureAlpha(config.opacity)
        .toBuffer();
    }

    // Calculate position
    const pos = calculatePosition(
      width,
      height,
      logoSize,
      logoSize,
      config.position,
      config.padding
    );

    // Composite the logo onto the image
    const result = await sharp(imageBuffer)
      .composite([
        {
          input: logoBuffer,
          top: Math.floor(pos.top),
          left: Math.floor(pos.left),
          blend: "over",
        },
      ])
      .toBuffer();

    console.log(`✅ Logo watermark added at ${config.position} (circular: ${config.circular || false})`);
    return result;
  } catch (error) {
    console.error("❌ Error adding logo watermark:", error.message);
    // Return original image if watermark fails
    return imageBuffer;
  }
}

/**
 * Process image with appropriate watermark based on target website
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {string} targetWebsite - Target website: 'masaak' or 'hasak'
 * @returns {Promise<Buffer>} - Image buffer with watermark
 */
async function processImage(imageBuffer, targetWebsite) {
  try {
    console.log(`\n🎨 Processing image for watermark (${targetWebsite})...`);

    if (!imageBuffer) {
      console.warn("⚠️ No image buffer provided");
      return imageBuffer;
    }

    // Apply watermark based on target website
    switch (targetWebsite) {
      case "masaak":
        // Text overlay for Masaak (real estate)
        return await addTextOverlay(imageBuffer, MASAAK_CONFIG);

      case "hasak":
        // Logo watermark for Hasak (events)
        return await addLogoWatermark(imageBuffer, HASAK_CONFIG);

      default:
        console.log(
          `⚠️ Unknown website "${targetWebsite}", skipping watermark`
        );
        return imageBuffer;
    }
  } catch (error) {
    console.error("❌ Error processing image:", error.message);
    // Return original image if processing fails
    return imageBuffer;
  }
}

/**
 * Get current watermark configuration
 * @returns {Object} - Current configuration for both websites
 */
function getConfig() {
  return {
    masaak: { ...MASAAK_CONFIG },
    hasak: { ...HASAK_CONFIG },
  };
}

module.exports = {
  processImage,
  addTextOverlay,
  addLogoWatermark,
  getConfig,
  // Export configs for external modification
  MASAAK_CONFIG,
  HASAK_CONFIG,
};
