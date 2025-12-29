const fs = require("fs");
const path = require("path");

const botJsPath = path.join(__dirname, "whatsapp", "bot.js");
let content = fs.readFileSync(botJsPath, "utf8");

// The clean auto-approve code for waseet (slightly different indentation)
const cleanAutoApproveWaseet = `            // Check if auto-approve is enabled and auto-post to WordPress
            const settings = getSettings();
            if (settings.autoApproveWordPress === true && ad.wpData) {
              console.log(
                "🚀 Auto-approve enabled, posting waseet ad to WordPress automatically..."
              );

              // Auto-post to WordPress using the SAME function as manual posting
              (async () => {
                try {
                  // Import the WordPress posting function from routes
                  const { postAdToWordPress } = require("../routes/bot");
                  
                  console.log("🔵 Starting WordPress auto-post for waseet ad using manual function...");
                  console.log("🔵 Ad ID:", ad.id);
                  
                  // Call the same function used for manual posting
                  const result = await postAdToWordPress(ad, sock, ad.wpData, false);
                  
                  if (result.success) {
                    console.log("✅ ✅ ✅ Waseet ad auto-posted to WordPress successfully! ✅ ✅ ✅");
                    console.log("📌 Post ID:", result.wordpressPost.id);
                    console.log("📌 Short Link:", result.wordpressPost.link);
                    
                    // Update ad status to "accepted" (not "posted")
                    ad.status = "accepted";
                    ad.wordpressPostId = result.wordpressPost.id;
                    ad.wordpressUrl = result.wordpressPost.link;
                    ad.wordpressFullUrl = result.wordpressPost.fullLink;
                    ad.whatsappMessage = result.whatsappMessage;
                    ad.wpData = result.extractedData;
                    
                    // Save updated ad
                    saveAds();
                    console.log("✅ Waseet ad updated with WordPress info and marked as accepted");
                  } else {
                    console.error("❌ WordPress posting returned unsuccessful result");
                  }
                } catch (error) {
                  console.error("❌ ❌ ❌ Error during waseet auto-post to WordPress ❌ ❌ ❌");
                  console.error("Error message:", error.message);
                  console.error("Error details:", error.response?.data || error);
                }
              })();
            } else if (settings.autoApproveWordPress === true && !ad.wpData) {
              console.log(
                "⚠️ Auto-approve enabled but waseet ad has no wpData, skipping auto-post"
              );
            }`;

// Find and replace the second occurrence (waseet ads) - with different indentation
const regex2 =
  /\/\/ Check if auto-approve is enabled and auto-post to WordPress[\s\S]*?console\.log\(\s*"🔵 Starting WordPress auto-post for waseet ad\.\.\."[\s\S]*?\.wordpressPostUrl = shortLink;[\s\S]*?saveAds\(\);[\s\S]*?console\.log\(\s*"✅ Waseet ad updated[\s\S]*?\);[\s\S]*?\}\s*catch.*?\{[\s\S]*?\}\s*\}\)\(\);[\s\S]*?\} else if \(settings\.autoApproveWordPress === true && !ad\.wpData\)[\s\S]*?\}/;

if (regex2.test(content)) {
  content = content.replace(regex2, cleanAutoApproveWaseet);
  console.log("✅ Fixed second auto-approve block (waseet ads)");
  fs.writeFileSync(botJsPath, content, "utf8");
  console.log("✅ File updated!");
} else {
  console.error("❌ Could not find second auto-approve block");

  // Try to find where it is
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    if (line.includes("Starting WordPress auto-post for waseet ad")) {
      console.log(`Found waseet auto-post at line ${i + 1}`);
    }
  });
}
