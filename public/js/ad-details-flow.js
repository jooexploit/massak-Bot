// ========================================================================================
// NEW AD DETAILS FLOW - Click ad -> view details -> choose action
// ========================================================================================

let currentAdDetails = null;

// -------------------------
// Ad Details Modal
// -------------------------
async function openAdDetailsModal(id, ad) {
  currentAdDetails = ad;
  const modal = document.getElementById("ad-details-modal");
  if (!modal) return;

  const content = document.getElementById("ad-details-content");
  if (!content) return;

  // Build details view
  const hasEnhanced = ad.enhancedText && ad.enhancedText !== ad.text;
  
  // Build image section HTML
  const hasImage = ad.imageUrl && typeof ad.imageUrl === "object";
  let imageSectionHtml = "";
  
  if (hasImage) {
    // Use full-image API for better quality, with fallback to thumbnail
    const thumbnailSrc = ad.imageUrl.jpegThumbnail 
      ? `data:image/jpeg;base64,${ad.imageUrl.jpegThumbnail}`
      : "/images/no-image-placeholder.png";
    
    imageSectionHtml = `
      <div style="margin-bottom: 1.5rem; padding: 1rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px;">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
          <span style="font-size: 1.25rem;">🖼️</span>
          <strong style="color: white; font-size: 1.1rem;">Ad Image</strong>
        </div>
        <div style="background: white; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; align-items: center; gap: 1rem;">
          <div style="position: relative; max-width: 100%; overflow: hidden; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            <img 
              id="ad-image-thumbnail"
              src="/api/bot/ads/${id}/full-image" 
              alt="Ad Image" 
              style="max-width: 100%; max-height: 300px; display: block; cursor: pointer; transition: transform 0.2s;"
              onclick="openAdImageFullView('${id}')"
              onmouseover="this.style.transform='scale(1.02)'"
              onmouseout="this.style.transform='scale(1)'"
              onerror="this.src='${thumbnailSrc}'"
            />
          </div>
          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: center;">
            <button 
              onclick="openAdImageFullView('${id}')" 
              class="btn btn-primary btn-sm"
              style="display: flex; align-items: center; gap: 0.5rem;"
            >
              <i class="fas fa-expand"></i> View Full Image
            </button>
            <button 
              onclick="removeAdImage('${id}')" 
              class="btn btn-danger btn-sm"
              style="display: flex; align-items: center; gap: 0.5rem;"
            >
              <i class="fas fa-trash"></i> Remove Image
            </button>
          </div>
          <small style="color: #666; text-align: center;">
            ${ad.imageUrl.mimetype || 'image/jpeg'} • ${ad.imageUrl.width || '?'}x${ad.imageUrl.height || '?'} px
          </small>
        </div>
      </div>
    `;
  }

  content.innerHTML = `
    <div style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
      <div style="margin-bottom: 1rem;">
        <strong>From Group:</strong> ${ad.fromGroupName || ad.fromGroup}
        <br/>
        <small style="color: #666;">${ad.fromGroup}</small>
      </div>
      
      ${imageSectionHtml}
      
      ${
        hasEnhanced
          ? `
        <div style="margin-bottom: 1rem;">
          <strong>📄 Ad Content</strong>
          <div style="background: #e8f5e9; padding: 0.75rem; margin-top: 0.5rem; border-radius: 4px; border-left: 4px solid #4CAF50;">
            <small style="color: #388E3C; font-weight: 500;">✨ Enhanced Version:</small>
          </div>
          <div style="background: #fff; padding: 1rem; margin-top: 0.25rem; border-radius: 4px; white-space: pre-wrap;">
${escapeHtml(ad.enhancedText)}</div>
        </div>
        
        <div style="margin-bottom: 1rem;">
          <div style="background: #f5f5f5; padding: 1rem; margin-top: 0.5rem; border-radius: 4px; white-space: pre-wrap;">
            <small style="color: #666; display: block; margin-bottom: 0.5rem;">📝 Original Message:</small>
${escapeHtml(ad.text)}</div>
        </div>
      `
          : `
        <div style="margin-bottom: 1rem;">
          <strong>📄 Ad Content</strong>
          <div style="background: #fff; padding: 1rem; margin-top: 0.5rem; border-radius: 4px; white-space: pre-wrap;">
${escapeHtml(ad.text)}</div>
        </div>
      `
      }
      
      ${ad.wpData ? `
        <div style="margin-bottom: 1rem; padding: 1rem; background: #e3f2fd; border-radius: 8px; border-left: 4px solid #2196F3;">
          <strong style="color: #1565C0;">🌐 Auto-Generated WordPress Data</strong>
          <div style="margin-top: 0.75rem; font-size: 0.9rem;">
            <div><strong>Title:</strong> ${escapeHtml(ad.wpData.title || 'N/A')}</div>
            ${ad.wpData.meta?.parent_catt ? `<div><strong>Category:</strong> ${escapeHtml(ad.wpData.meta.parent_catt)}</div>` : ''}
            ${ad.wpData.meta?.City ? `<div><strong>City:</strong> ${escapeHtml(ad.wpData.meta.City)}</div>` : ''}
            ${ad.wpData.meta?.price_amount ? `<div><strong>Price:</strong> ${escapeHtml(ad.wpData.meta.price_amount)} ريال</div>` : ''}
          </div>
        </div>
      ` : ''}
      
      <div style="margin-top: 1rem;">
        <strong>Status:</strong> <span style="padding: 4px 12px; background: #6c757d; color: white; border-radius: 12px;">${
          ad.status
        }</span>
        ${ad.category ? `<br/><strong>Category:</strong> ${ad.category}` : ""}
      </div>
    </div>
  `;

  modal.dataset.adId = id;
  modal.style.display = "block";

  // Wire buttons
  document.getElementById("ad-details-groups-only").onclick = () =>
    handleAdDetailsGroupsOnly(id, ad);
  document.getElementById("ad-details-wp-only").onclick = () =>
    handleAdDetailsWpOnly(id, ad);
  document.getElementById("ad-details-both").onclick = () =>
    handleAdDetailsBoth(id, ad);
  document.getElementById("ad-details-cancel").onclick = closeAdDetailsModal;
  document.getElementById("close-ad-details-modal").onclick =
    closeAdDetailsModal;
}

// -------------------------
// Ad Image Functions
// -------------------------
async function openAdImageFullView(adId) {
  // Open a loading window first
  const imgWindow = window.open('', '_blank');
  if (!imgWindow) {
    alert("Please allow popups to view the full image");
    return;
  }
  
  imgWindow.document.write(`
    <html>
      <head><title>Ad Image - ${adId}</title></head>
      <body style="margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #1a1a1a;">
        <div style="color: white; font-family: Arial, sans-serif; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 20px;">⏳</div>
          <div>Loading full-quality image...</div>
        </div>
      </body>
    </html>
  `);
  
  // Use the full-image API endpoint - it handles everything server-side
  const fullImageUrl = `/api/bot/ads/${adId}/full-image`;
  
  // Create an image element to test if the image loads
  const testImg = new Image();
  testImg.onload = function() {
    // Image loaded successfully, display it
    imgWindow.document.open();
    imgWindow.document.write(`
      <html>
        <head><title>Ad Image - ${adId}</title></head>
        <body style="margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #1a1a1a;">
          <img src="${fullImageUrl}" style="max-width: 100%; max-height: 100vh;" />
        </body>
      </html>
    `);
    imgWindow.document.close();
  };
  testImg.onerror = function() {
    // Show error message
    console.warn("Failed to load full image for ad:", adId);
    imgWindow.document.open();
    imgWindow.document.write(`
      <html>
        <head><title>Ad Image - ${adId}</title></head>
        <body style="margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #1a1a1a;">
          <div style="color: #ff6b6b; font-family: Arial, sans-serif; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
            <div>Failed to load image</div>
            <div style="margin-top: 10px; font-size: 14px; color: #888;">The image may have expired or WhatsApp is not connected</div>
          </div>
        </body>
      </html>
    `);
    imgWindow.document.close();
  };
  testImg.src = fullImageUrl;
}

async function removeAdImage(adId) {
  if (!confirm("Are you sure you want to remove this image from the ad? This action cannot be undone.")) {
    return;
  }
  
  try {
    showLoadingOverlay("Removing image...");
    
    const response = await fetch(`/api/bot/ads/${adId}/image`, {
      method: "DELETE",
      credentials: "include",
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to remove image");
    }
    
    hideLoadingOverlay();
    
    // Update current ad details
    if (currentAdDetails) {
      currentAdDetails.imageUrl = null;
    }
    
    // Refresh the modal content
    closeAdDetailsModal();
    
    // Refresh ads list
    if (typeof fetchAndRenderAds === 'function') {
      fetchAndRenderAds();
    }
    
    showSuccessStatus("✅ Image removed successfully!");
  } catch (err) {
    hideLoadingOverlay();
    console.error("Error removing image:", err);
    alert("Failed to remove image: " + err.message);
  }
}

function closeAdDetailsModal() {
  const modal = document.getElementById("ad-details-modal");
  if (modal) modal.style.display = "none";
  currentAdDetails = null;
}

// -------------------------
// Flow 1: Groups Only (no WP, just formatted WhatsApp message)
// -------------------------
async function handleAdDetailsGroupsOnly(id, ad) {
  closeAdDetailsModal();

  // Use pre-generated WhatsApp message if available, otherwise build one
  let message;
  if (ad.whatsappMessage) {
    console.log("✅ Using pre-generated WhatsApp message from ad");
    message = ad.whatsappMessage;
  } else {  
    // Generate formatted WhatsApp message (no link, emojis only)
    message = buildWhatsAppMessageNoLink(ad);
  }

  // Open groups preview modal
  await openGroupsPreviewModal(id, message);
}

function buildWhatsAppMessageNoLink(ad) {
  const text = ad.enhancedText || ad.text;

  // Simple formatted message with emojis
  let message = `✨ *عقار جديد للإعلان* ✨\n\n`;
  message += `${text}\n\n`;
  message += `┈┉━━🔰 *مسعاك العقارية* 🔰━━┅┄\n`;
  message += `⭕ إبراء للذمة التواصل فقط مع مسعاك عند الشراء أو إذا عندك مشتري\n`;
  message += `✅ نتعاون مع جميع الوسطاء`;

  return message;
}

async function openGroupsPreviewModal(adId, message) {
  const modal = document.getElementById("groups-preview-modal");
  if (!modal) return;

  const textarea = document.getElementById("groups-preview-message");
  if (textarea) textarea.value = message;

  modal.dataset.adId = adId;

  // Reset custom numbers selection
  if (typeof selectedCustomNumbers !== "undefined") {
    selectedCustomNumbers = [];
  }

  // Show modal immediately for better UX
  modal.style.display = "block";

  // Show loading state in groups list
  const groupsList = document.getElementById("groups-preview-list");
  if (groupsList) {
    groupsList.innerHTML =
      '<p style="padding: 20px; text-align: center; color: #666;">⏳ Loading groups...</p>';
  }

  console.log("🎬 Opening Groups Preview Modal for ad:", adId);
  console.log("📊 Current allGroups count:", allGroups ? allGroups.length : 0);

  // Load data in background
  try {
    // Load saved custom numbers first (before loading groups)
    if (typeof loadSavedCustomNumbers === "function") {
      await loadSavedCustomNumbers();
      console.log(
        "📱 Loaded saved custom numbers:",
        window.savedCustomNumbers?.length || 0
      );
    }

    // Load groups and collections (this will render everything including saved numbers)
    await loadGroupsAndCollections();

    // Render empty custom numbers list for manually added numbers
    if (typeof renderGroupsPreviewCustomNumbersList === "function") {
      renderGroupsPreviewCustomNumbersList();
    }
    
    // Load private clients and interest groups for the new sections
    await loadPrivateClientsForPreview();
    await loadInterestGroupsForPreview();
  } catch (error) {
    console.error("Error loading groups:", error);
    if (groupsList) {
      groupsList.innerHTML =
        '<p style="padding: 20px; text-align: center; color: red;">❌ Failed to load groups. Please try again.</p>';
    }
  }

  // Wire buttons
  document.getElementById("groups-preview-send").onclick =
    handleGroupsPreviewSend;
  document.getElementById("groups-preview-cancel").onclick =
    closeGroupsPreviewModal;
  document.getElementById("close-groups-preview-modal").onclick =
    closeGroupsPreviewModal;

  // Wire refresh groups button
  const refreshBtn = document.getElementById("refresh-groups-modal-btn");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
      await loadGroupsAndCollections(true); // Force refresh
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
    };
  }

  // Wire manage collections button
  const manageBtn = document.getElementById("manage-collections-modal-btn");
  if (manageBtn) {
    manageBtn.onclick = () => {
      closeGroupsPreviewModal();
      switchView("settings"); // Switch to settings where collections are managed
    };
  }
}

// Helper function to load groups and collections
async function loadGroupsAndCollections(forceRefresh = false) {
  try {
    console.log(
      `🔄 loadGroupsAndCollections called with forceRefresh=${forceRefresh}`
    );

    // Fetch groups and collections separately
    let groupsResponse;
    if (forceRefresh) {
      // Use POST /api/bot/groups/refresh for force refresh
      console.log("🔄 Using refresh endpoint...");
      groupsResponse = await fetch("/api/bot/groups/refresh", {
        method: "POST",
        credentials: "include",
      });
    } else {
      // Use GET /api/bot/groups for normal fetch
      console.log("📋 Using normal groups endpoint...");
      groupsResponse = await fetch("/api/bot/groups", {
        credentials: "include",
      });
    }

    const collectionsResponse = await fetch("/api/bot/collections", {
      credentials: "include",
    });

    if (groupsResponse.ok) {
      const groupsData = await groupsResponse.json();
      allGroups = groupsData.groups || [];
      console.log(`✅ Fetched ${allGroups.length} groups from server`);
      console.log("📊 First 3 groups:", allGroups.slice(0, 3));
    } else {
      console.error("❌ Groups response not OK:", groupsResponse.status);
    }

    if (collectionsResponse.ok) {
      const collectionsData = await collectionsResponse.json();
      allCollections = collectionsData.collections || [];
      console.log(`✅ Fetched ${allCollections.length} collections`);
    } else {
      console.error(
        "❌ Collections response not OK:",
        collectionsResponse.status
      );
    }

    // Render groups and collections in both modals
    console.log("🎨 Rendering groups in modals...");
    renderGroupsCheckboxesInPreview("groups-preview-list");
    renderGroupsCheckboxesInPreview("wp-groups-preview-list");

    console.log(
      `✅ Loaded ${allGroups.length} groups and ${allCollections.length} collections`
    );
  } catch (err) {
    console.error("❌ Error loading groups:", err);
  }
}

function closeGroupsPreviewModal() {
  const modal = document.getElementById("groups-preview-modal");
  if (modal) modal.style.display = "none";
}

function renderGroupsCheckboxesInPreview(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";

  // First, render saved custom numbers as checkboxes
  const savedNumbers = window.savedCustomNumbers || [];
  console.log(
    `📋 Rendering ${containerId} with ${savedNumbers.length} saved numbers`
  );

  if (savedNumbers.length > 0) {
    console.log("📱 Saved numbers:", savedNumbers);
    const numbersSection = document.createElement("div");
    numbersSection.className = "custom-numbers-section";
    numbersSection.innerHTML =
      '<div class="section-header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px; border-radius: 8px; margin-bottom: 10px; font-weight: bold;"><i class="fas fa-phone"></i> 📱 Saved Phone Numbers</div>';

    savedNumbers.forEach((number) => {
      const item = document.createElement("div");
      item.className = "group-item custom-number-item";
      item.style.cssText =
        "background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 6px; margin-bottom: 8px; transition: transform 0.2s;";

      const numberId = `custom-${escapeHtml(number.phone)}`;

      item.innerHTML = `
        <input type="checkbox" 
               class="custom-number-checkbox"
               id="${numberId}" 
               value="${escapeHtml(number.phone)}"
               data-name="${escapeHtml(number.name)}">
        <label for="${numberId}" style="color: white; font-weight: 500; padding: 12px; cursor: pointer; display: flex; align-items: center; gap: 10px;">
          <i class="fas fa-user-circle" style="font-size: 20px;"></i>
          <div>
            <div style="font-weight: 600;">${escapeHtml(number.name)}</div>
            <div style="font-size: 0.85em; opacity: 0.9;"><i class="fas fa-phone"></i> ${escapeHtml(
              number.phone
            )}</div>
          </div>
        </label>
      `;
      numbersSection.appendChild(item);
    });

    container.appendChild(numbersSection);

    // Add divider
    const divider = document.createElement("div");
    divider.className = "section-divider";
    divider.style.cssText =
      "height: 2px; background: linear-gradient(90deg, transparent, #ddd, transparent); margin: 20px 0;";
    container.appendChild(divider);
  }

  // Check if groups are available
  console.log(`🎨 Rendering container: ${containerId}`);
  console.log(`📊 allGroups.length: ${allGroups.length}`);
  console.log(
    `📊 allCollections.length: ${allCollections ? allCollections.length : 0}`
  );
  console.log(`📊 savedNumbers.length: ${savedNumbers.length}`);

  if (allGroups.length === 0 && savedNumbers.length === 0) {
    container.innerHTML =
      '<div class="info-text" style="padding: 20px; text-align: center; color: #999;">⚠️ No groups or saved numbers available. Click "Refresh" to load groups from WhatsApp.</div>';
    console.log("⚠️ No groups or saved numbers to display");
    return;
  }

  // Then, render collections as expandable checkboxes
  if (allCollections && allCollections.length > 0) {
    console.log(`📁 Rendering ${allCollections.length} collections`);
    const collectionsSection = document.createElement("div");
    collectionsSection.className = "collections-section";
    collectionsSection.innerHTML =
      '<div class="section-header">📁 Collections</div>';

    allCollections.forEach((collection) => {
      const collectionItem = document.createElement("div");
      collectionItem.className = "collection-checkbox-item";

      const collectionId = `col-${escapeHtml(collection.id)}`;
      const groupCount = collection.groups ? collection.groups.length : 0;

      collectionItem.innerHTML = `
        <input type="checkbox" 
               id="${collectionId}" 
               class="collection-checkbox" 
               data-groups='${JSON.stringify(collection.groups || [])}'>
        <label for="${collectionId}">
          <span class="collection-name">📁 ${escapeHtml(collection.name)}</span>
          <span class="collection-count">${groupCount} groups</span>
        </label>
      `;
      collectionsSection.appendChild(collectionItem);
    });

    container.appendChild(collectionsSection);

    // Add divider
    const divider = document.createElement("div");
    divider.className = "section-divider";
    container.appendChild(divider);
  }

  // Then render all groups
  if (allGroups.length > 0) {
    console.log(`👥 Rendering ${allGroups.length} groups`);
    const groupsSection = document.createElement("div");
    groupsSection.className = "groups-section";
    groupsSection.innerHTML =
      '<div class="section-header">👥 All Groups & Communities</div>';

    allGroups.forEach((group, index) => {
      if (index < 3) {
        console.log(`  - Group ${index + 1}: ${group.name} (${group.jid})`);
      }
      const item = document.createElement("div");
      item.className = "group-item";

      // Determine group type icon
      const isCommunity = group.isCommunity || group.type === "Community";
      const typeIcon = isCommunity ? "📢" : "👥";
      const typeLabel = isCommunity ? "Community" : "Group";

      item.innerHTML = `
      <input type="checkbox" 
             class="group-checkbox"
             id="gp-${escapeHtml(group.jid)}" 
             value="${escapeHtml(group.jid)}"
             data-jid="${escapeHtml(group.jid)}">
      <label for="gp-${escapeHtml(group.jid)}">
        <span class="group-name">${typeIcon} ${escapeHtml(group.name)}</span>
        <span class="group-id">${escapeHtml(
          group.jid
        )} <span class="group-type-badge">${typeLabel}</span></span>
      </label>
    `;
      groupsSection.appendChild(item);
    });

    container.appendChild(groupsSection);
  }

  // Wire collection checkbox logic - when checked, select all groups in that collection
  container.querySelectorAll(".collection-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      const groupJids = JSON.parse(this.dataset.groups || "[]");
      const isChecked = this.checked;

      groupJids.forEach((jid) => {
        const groupCheckbox = container.querySelector(
          `.group-checkbox[data-jid="${jid}"]`
        );
        if (groupCheckbox) {
          groupCheckbox.checked = isChecked;
        }
      });
    });
  });

  // Wire group checkbox logic - update collection checkboxes when groups change
  container.querySelectorAll(".group-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      updateCollectionCheckboxStates(container);
    });
  });

  // Initial state update
  updateCollectionCheckboxStates(container);
}

function updateCollectionCheckboxStates(container) {
  // Update collection checkboxes based on their groups' states
  container
    .querySelectorAll(".collection-checkbox")
    .forEach((collectionCheckbox) => {
      const groupJids = JSON.parse(collectionCheckbox.dataset.groups || "[]");

      let allChecked = true;
      let someChecked = false;

      groupJids.forEach((jid) => {
        const groupCheckbox = container.querySelector(
          `.group-checkbox[data-jid="${jid}"]`
        );
        if (groupCheckbox) {
          if (groupCheckbox.checked) {
            someChecked = true;
          } else {
            allChecked = false;
          }
        }
      });

      collectionCheckbox.checked = allChecked && groupJids.length > 0;
      collectionCheckbox.indeterminate = someChecked && !allChecked;
    });
}

async function handleGroupsPreviewSend() {
  const modal = document.getElementById("groups-preview-modal");
  const adId = modal.dataset.adId;
  const message = document.getElementById("groups-preview-message").value;

  // Get selected groups
  const selectedGroups = [];
  document
    .querySelectorAll("#groups-preview-list input.group-checkbox:checked")
    .forEach((cb) => {
      selectedGroups.push(cb.value);
    });

  // Get selected custom numbers from saved numbers (checkboxes in groups list)
  const selectedCustomNumbersFromSaved = [];
  document
    .querySelectorAll(
      "#groups-preview-list input.custom-number-checkbox:checked"
    )
    .forEach((cb) => {
      selectedCustomNumbersFromSaved.push({
        name: cb.dataset.name,
        phone: cb.value,
      });
    });

  // Get custom numbers from manually added section (checkboxes in custom numbers list)
  const selectedCustomNumbersFromManual = [];
  document
    .querySelectorAll(
      "#groups-preview-custom-numbers-list input.custom-number-checkbox:checked"
    )
    .forEach((cb) => {
      selectedCustomNumbersFromManual.push({
        name: cb.dataset.name,
        phone: cb.value,
      });
    });

  // Get selected private clients (new)
  const selectedPrivateClients = getSelectedPrivateClients();
  
  // Get selected interest group members (new - expands groups to individual members)
  const selectedInterestGroupMembers = getSelectedInterestGroupMembers();

  // Combine all custom numbers sources
  const allCustomNumbers = [
    ...selectedCustomNumbersFromSaved,
    ...selectedCustomNumbersFromManual,
    ...selectedPrivateClients.map(c => ({ name: c.name, phone: c.phone, source: "Private Client" })),
    ...selectedInterestGroupMembers.map(m => ({ name: m.name, phone: m.phone, source: m.source })),
  ];

  // Remove duplicates based on phone number
  const customNumbers = allCustomNumbers.filter(
    (num, index, self) => index === self.findIndex((n) => n.phone === num.phone)
  );

  // Debug logging
  console.log("📊 Send Debug Info:");
  console.log("Selected Groups:", selectedGroups.length, selectedGroups);
  console.log("Private Clients:", selectedPrivateClients.length);
  console.log("Interest Group Members:", selectedInterestGroupMembers.length);
  console.log("Total Custom Numbers (deduplicated):", customNumbers.length);

  // Require at least one recipient (group OR custom number)
  if (selectedGroups.length === 0 && customNumbers.length === 0) {
    alert("⚠️ Please select at least one group, private client, interest group, or custom phone number");
    return;
  }

  // Calculate total recipients
  const totalRecipients = selectedGroups.length + customNumbers.length;

  // Get delay value (in seconds)
  const delayInput = document.getElementById("send-delay");
  const delaySeconds = delayInput ? parseInt(delayInput.value) || 3 : 3;

  showLoadingOverlay(
    `📱 Starting background send to ${totalRecipients} recipient(s)...`
  );

  try {
    // Send request to backend - it will process in background
    const response = await fetch("/api/bot/send-bulk-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        adId,
        message,
        groups: selectedGroups,
        customNumbers,
        delaySeconds,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    
    console.log("✅ Bulk send started:", result);

    // Mark the ad as sent (stores groups/numbers info)
    if (adId) {
      try {
        await fetch(`/api/bot/ads/${adId}/mark-sent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            selectedGroups,
            customNumbers,
          }),
        });
      } catch (markErr) {
        console.error("❌ Failed to mark as sent:", markErr);
      }
    }

    // Show success message
    let resultMessage = `🚀 تم بدء الإرسال في الخلفية!

📊 الإجمالي: ${totalRecipients} مستلم
📢 المجموعات: ${selectedGroups.length}
📱 الأرقام الخاصة: ${customNumbers.length}
⏱️ التأخير: ${delaySeconds} ثانية

✅ يمكنك إغلاق الصفحة - الإرسال سيستمر
📲 سيتم إرسال إشعار على واتساب عند الإنتهاء`;

    hideLoadingOverlay();
    showSuccessStatus(resultMessage);

    closeGroupsPreviewModal();

    // Reload the appropriate view
    if (window.location.hash === "#whatsapp-messages") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await loadWhatsAppMessagesView();
    } else {
      fetchAndRenderAds();
    }
  } catch (err) {
    hideLoadingOverlay();
    console.error("Error starting bulk send:", err);
    alert("❌ Failed to start sending: " + err.message);
  }
}


// -------------------------
// Direct Post to WordPress (without opening preview modal)
// -------------------------
async function handleDirectPostToWordPress(id, ad) {
  closeAdDetailsModal();

  // Show loading overlay
  showLoadingOverlay("📤 Posting to WordPress...");

  try {
    // Use pre-generated WP data if available
    let wpData = ad.wpData;

    // Post to WordPress
    const response = await fetch(`/api/bot/ads/${id}/post-to-wordpress`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wpData: wpData || undefined }),
    });

    if (!response.ok) {
      hideLoadingOverlay();
      const error = await response.json();
      alert("Failed to post to WordPress: " + (error.error || "Unknown error"));
      return;
    }

    const data = await response.json();

    // Update ad status to accepted
    await updateAdStatus(id, "accepted");

    // Show success message with the link
    const shortLink = data.wordpressPost.link;

    hideLoadingOverlay();
    showSuccessStatus(
      `✅ Posted to WordPress successfully!\n\nLink: ${shortLink}`
    );

    // Copy link to clipboard for easy sharing
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shortLink).catch((err) => {
        console.log("Could not copy to clipboard:", err);
      });
    }

    // Refresh the ads list
    fetchAndRenderAds();
  } catch (err) {
    hideLoadingOverlay();
    console.error("Error posting to WordPress:", err);
    alert("Failed to post to WordPress");
  }
}

// -------------------------
// Flow 2: WordPress Only (generate WP data, preview, post - no groups)
// -------------------------
async function handleAdDetailsWpOnly(id, ad) {
  closeAdDetailsModal();

  // Show loading overlay
  showLoadingOverlay("🤖 Loading WordPress data...");

  // Use pre-generated WP data if available, otherwise generate it
  try {
    let wpData = ad.wpData; // Try to use pre-generated data

    if (!wpData) {
      // If not available, generate it via API
      const response = await fetch(`/api/bot/ads/${id}/post-to-wordpress`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true }),
      });

      hideLoadingOverlay();

      if (!response.ok) {
        const error = await response.json();
        alert(
          "Failed to generate WordPress preview: " +
            (error.error || "Unknown error")
        );
        return;
      }

      const data = await response.json();
      wpData = data.extractedData;
    } else {
      hideLoadingOverlay();
      console.log("✅ Using pre-generated WordPress data from ad");
    }

    await openWpPreviewModal(id, wpData, "wp-only");
  } catch (err) {
    hideLoadingOverlay();
    console.error("Error generating WP preview:", err);
    alert("Failed to generate WordPress preview");
  }
}

// -------------------------
// Flow 3: Both (generate WP data, preview, post, THEN send to groups with encoded link)
// -------------------------
async function handleAdDetailsBoth(id, ad) {
  closeAdDetailsModal();

  // Show loading overlay
  showLoadingOverlay("🤖 Loading WordPress data...");

  // Use pre-generated WP data if available, otherwise generate it
  try {
    let wpData = ad.wpData; // Try to use pre-generated data

    if (!wpData) {
      // If not available, generate it via API
      const response = await fetch(`/api/bot/ads/${id}/post-to-wordpress`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true }),
      });

      hideLoadingOverlay();

      if (!response.ok) {
        const error = await response.json();
        alert(
          "Failed to generate WordPress preview: " +
            (error.error || "Unknown error")
        );
        return;
      }

      const data = await response.json();
      wpData = data.extractedData;
    } else {
      hideLoadingOverlay();
      console.log("✅ Using pre-generated WordPress data from ad");
    }

    await openWpPreviewModal(id, wpData, "both");
  } catch (err) {
    hideLoadingOverlay();
    console.error("Error generating WP preview:", err);
    alert("Failed to generate WordPress preview");
  }
}

async function openWpPreviewModal(adId, extractedData, mode) {
  const modal = document.getElementById("wp-preview-modal");
  if (!modal) return;

  const ed = extractedData || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };

  // Populate WP fields - ALL CUSTOM FIELDS
  setVal("wp-preview-title", ed.title || "");
  setVal("wp-preview-content", ed.content || ed.description || "");

  // Price & Space
  setVal("wp-preview-price", (ed.meta && ed.meta.price) || "");
  setVal("wp-preview-price-amount", (ed.meta && ed.meta.price_amount) || "");
  setVal("wp-preview-price-method", (ed.meta && ed.meta.price_method) || "");
  setVal("wp-preview-arc-space", (ed.meta && ed.meta.arc_space) || "");
  setVal("wp-preview-order-space", (ed.meta && ed.meta.order_space) || "");

  // Location
  setVal("wp-preview-location", (ed.meta && ed.meta.location) || "");
  setVal("wp-preview-before-city", (ed.meta && ed.meta.before_City) || "");
  setVal("wp-preview-city", (ed.meta && ed.meta.City) || "");
  setVal(
    "wp-preview-google-location",
    (ed.meta && ed.meta.google_location) || ""
  );

  // Categories - Handle dropdowns specially
  const parentCattSelect = document.getElementById("wp-preview-parent-catt");
  if (parentCattSelect) {
    parentCattSelect.value = (ed.meta && ed.meta.parent_catt) || "";

    // Trigger subcategory loading
    if (typeof updateWpSubcategories === "function") {
      updateWpSubcategories();
    }

    // Set subcategory after brief delay to allow subcategories to load
    setTimeout(() => {
      const subCattSelect = document.getElementById("wp-preview-sub-catt");
      if (subCattSelect) {
        subCattSelect.value = (ed.meta && ed.meta.sub_catt) || "";
      }
    }, 50);
  }

  // arc_category and arc_subcategory are readonly and auto-sync, so just set them
  setVal("wp-preview-arc-category", (ed.meta && ed.meta.arc_category) || "");
  setVal(
    "wp-preview-arc-subcategory",
    (ed.meta && ed.meta.arc_subcategory) || ""
  );

  // Contact & Owner
  setVal("wp-preview-owner-name", (ed.meta && ed.meta.owner_name) || "");
  setVal("wp-preview-phone", (ed.meta && ed.meta.phone_number) || "");

  // Order Details
  setVal("wp-preview-order-status", (ed.meta && ed.meta.order_status) || "");
  setVal("wp-preview-order-owner", (ed.meta && ed.meta.order_owner) || "");

  // order_type is now a dropdown
  const orderTypeSelect = document.getElementById("wp-preview-order-type");
  if (orderTypeSelect) {
    orderTypeSelect.value = (ed.meta && ed.meta.order_type) || "";
  }

  // Set target website (auto-detected or from existing data)
  const targetWebsiteSelect = document.getElementById(
    "wp-preview-target-website"
  );
  if (targetWebsiteSelect) {
    const targetWebsite = ed.targetWebsite || "masaak"; // Default to masaak
    targetWebsiteSelect.value = targetWebsite;
    console.log(`🌐 Target website set to: ${targetWebsite}`);
  }

  // Offer Details
  setVal("wp-preview-offer-status", (ed.meta && ed.meta.offer_status) || "");
  setVal("wp-preview-offer-owner", (ed.meta && ed.meta.offer_owner) || "");
  setVal("wp-preview-offer-type", (ed.meta && ed.meta.offer_type) || "");

  // Additional Fields
  setVal("wp-preview-main-ad", (ed.meta && ed.meta.main_ad) || "");
  setVal(
    "wp-preview-payment-method",
    (ed.meta && ed.meta.payment_method) || ""
  );
  setVal("wp-preview-youtube-link", (ed.meta && ed.meta.youtube_link) || "");
  setVal("wp-preview-tags", (ed.meta && ed.meta.tags) || "");

  modal.dataset.adId = adId;
  modal.dataset.mode = mode;

  // Show/hide sections based on mode
  document.getElementById("wp-preview-link-section").style.display = "none";
  document.getElementById("wp-preview-message-section").style.display =
    mode === "both" ? "block" : "none";
  document.getElementById("wp-preview-post-only").style.display =
    mode === "wp-only" ? "block" : "none";
  document.getElementById("wp-preview-post-and-send").style.display =
    mode === "both" ? "block" : "none";

  if (mode === "both") {
    // Load groups for "both" mode
    await loadGroupsAndCollections();

    // Generate preview message (will be updated after posting with real link)
    const previewMsg = buildWpWhatsAppMessage(
      "(سيتم إضافة الرابط بعد النشر)",
      ed
    );
    setVal("wp-preview-message", previewMsg);
  }

  modal.style.display = "block";

  // Wire buttons
  document.getElementById("wp-preview-post-only").onclick =
    handleWpPreviewPostOnly;
  document.getElementById("wp-preview-post-and-send").onclick =
    handleWpPreviewPostAndSend;
  document.getElementById("wp-preview-cancel").onclick = closeWpPreviewModal;
  document.getElementById("close-wp-preview-modal").onclick =
    closeWpPreviewModal;

  // Wire refresh groups button for WordPress modal
  if (mode === "both") {
    const refreshWpBtn = document.getElementById("refresh-wp-groups-modal-btn");
    if (refreshWpBtn) {
      refreshWpBtn.onclick = async () => {
        refreshWpBtn.disabled = true;
        refreshWpBtn.innerHTML =
          '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
        await loadGroupsAndCollections(true); // Force refresh
        refreshWpBtn.disabled = false;
        refreshWpBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
      };
    }
  }
}

function closeWpPreviewModal() {
  const modal = document.getElementById("wp-preview-modal");
  if (modal) modal.style.display = "none";
}

function buildWpWhatsAppMessage(link, extractedData) {
  const meta = extractedData.meta || {};

  let message = `*${extractedData.title || "عقار جديد"}*\n`;

  // Handle price with special cases
  const priceType = (meta.price_type || "").toLowerCase();
  const isContactPrice = priceType.includes("عند التواصل");
  const isNegotiable =
    priceType.includes("على السوم") || priceType.includes("السوم وصل");

  if (meta.price_amount || isContactPrice || isNegotiable) {
    message += `💰 *السعر:* `;

    if (isContactPrice && !meta.price_amount) {
      message += `عند التواصل`;
    } else if (isNegotiable && !meta.price_amount) {
      message += meta.price_type;
    } else if (meta.price_amount) {
      message += `${meta.price_amount}`;
    }

    message += `\n`;
  }

  if (meta.arc_space) {
    message += `📏 *المساحة:* ${meta.arc_space} متر\n`;
  }

  if (meta.location) {
    message += `📍 *الموقع:* ${meta.location}\n`;
  }

  if (meta.phone) {
    message += `📲 *للتواصل:* ${meta.phone}\n`;
  }

  // Put link on its own line with spacing for WhatsApp rich preview
  message += `\n👈 *للتفاصيل الكاملة:*\n\n`;
  message += `${link}\n\n`; // Link alone for WhatsApp to generate preview

  message += `┈┉━━🔰 *مسعاك العقارية* 🔰━━┅┄\n`;
  message += `⭕ إبراء للذمة التواصل فقط مع مسعاك عند الشراء أو إذا عندك مشتري\n`;
  message += `✅ نتعاون مع جميع الوسطاء`;

  return message;
}

function getEditedWpDataFromWpModal() {
  const getVal = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  };

  const targetWebsite = getVal("wp-preview-target-website") || "masaak";

  return {
    title: getVal("wp-preview-title"),
    content: getVal("wp-preview-content"),
    targetWebsite: targetWebsite, // Include target website
    meta: {
      // Price & Space
      price: getVal("wp-preview-price"),
      price_amount: getVal("wp-preview-price-amount"),
      price_method: getVal("wp-preview-price-method"),
      arc_space: getVal("wp-preview-arc-space"),
      order_space: getVal("wp-preview-order-space"),

      // Location
      location: getVal("wp-preview-location"),
      before_City: getVal("wp-preview-before-city"),
      City: getVal("wp-preview-city"),
      google_location: getVal("wp-preview-google-location"),

      // Categories
      parent_catt: getVal("wp-preview-parent-catt"),
      sub_catt: getVal("wp-preview-sub-catt"),
      arc_category: getVal("wp-preview-arc-category"),
      arc_subcategory: getVal("wp-preview-arc-subcategory"),

      // Contact & Owner
      owner_name: getVal("wp-preview-owner-name"),
      phone_number: getVal("wp-preview-phone"),

      // Order Details
      order_status: getVal("wp-preview-order-status"),
      order_owner: getVal("wp-preview-order-owner"),
      order_type: getVal("wp-preview-order-type"),

      // Offer Details
      offer_status: getVal("wp-preview-offer-status"),
      offer_owner: getVal("wp-preview-offer-owner"),
      offer_type: getVal("wp-preview-offer-type"),

      // Additional Fields
      main_ad: getVal("wp-preview-main-ad"),
      payment_method: getVal("wp-preview-payment-method"),
      youtube_link: getVal("wp-preview-youtube-link"),
      tags: getVal("wp-preview-tags"),
    },
  };
}

async function handleWpPreviewPostOnly() {
  const modal = document.getElementById("wp-preview-modal");
  const adId = modal.dataset.adId;
  const wpData = getEditedWpDataFromWpModal();

  showLoadingOverlay("📤 Posting to WordPress...");

  try {
    const response = await fetch(`/api/bot/ads/${adId}/post-to-wordpress`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wpData }),
    });

    if (!response.ok) {
      hideLoadingOverlay();
      const error = await response.json();
      alert("Failed to post to WordPress: " + (error.error || "Unknown error"));
      return;
    }

    const data = await response.json();

    // Update ad status to accepted
    await updateAdStatus(adId, "accepted");

    // Show short link primarily (cleaner), full link as reference
    const shortLink = data.wordpressPost.link;
    const fullLink = data.wordpressPost.fullLink;

    showSuccessStatus(`✅ Posted to WordPress successfully!`);

    // Copy link to clipboard for easy sharing (if clipboard API is available)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shortLink).catch((err) => {
        console.log("Could not copy to clipboard:", err);
      });
    }

    closeWpPreviewModal();
    fetchAndRenderAds();
  } catch (err) {
    hideLoadingOverlay();
    console.error("Error posting to WordPress:", err);
    alert("Failed to post to WordPress");
  }
}

async function handleWpPreviewPostAndSend() {
  const modal = document.getElementById("wp-preview-modal");
  const adId = modal.dataset.adId;
  const wpData = getEditedWpDataFromWpModal();

  // Get selected groups
  const selectedGroups = [];
  document
    .querySelectorAll('#wp-groups-preview-list input[type="checkbox"]:checked')
    .forEach((cb) => {
      selectedGroups.push(cb.value);
    });

  if (selectedGroups.length === 0) {
    alert("Please select at least one group");
    return;
  }

  showLoadingOverlay("📤 Posting to WordPress...");

  try {
    // First, post to WordPress
    const response = await fetch(`/api/bot/ads/${adId}/post-to-wordpress`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wpData }),
    });

    if (!response.ok) {
      hideLoadingOverlay();
      const error = await response.json();
      alert("Failed to post to WordPress: " + (error.error || "Unknown error"));
      return;
    }

    const data = await response.json();

    // Use SHORT link (/?p=123) - WhatsApp will still generate preview via redirect
    const wpLink = data.wordpressPost.link; // Short link
    const wpFullLink = data.wordpressPost.fullLink; // Full link for reference

    console.log("=== WordPress Post Data ===");
    console.log("Short Link (wpLink):", wpLink);
    console.log("Full Link (wpFullLink):", wpFullLink);
    console.log("===========================");

    // Use pre-generated WhatsApp message from API if available, otherwise build one
    let finalMessage;
    if (data.whatsappMessage) {
      console.log("✅ Using pre-generated WhatsApp message from API");
      finalMessage = data.whatsappMessage;
    } else {
      // Build message with the short WP link (preview will still work)
      finalMessage = buildWpWhatsAppMessage(
        wpLink,
        data.extractedData || wpData
      );
    }

    // Update the message textarea to show what will be sent
    const messageTextarea = document.getElementById("wp-preview-message");
    if (messageTextarea) {
      messageTextarea.value = finalMessage;
    }

    // Update the UI to show the link
    const linkInput = document.getElementById("wp-preview-link");
    if (linkInput) {
      linkInput.value = wpLink;
    }
    document.getElementById("wp-preview-link-section").style.display = "block";

    // Get delay value (in seconds)
    const delayInput = document.getElementById("wp-send-delay");
    const delaySeconds = delayInput ? parseInt(delayInput.value) || 3 : 3;
    const delayMs = delaySeconds * 1000;

    // Update loading message
    showLoadingOverlay(
      `📱 Sending to ${selectedGroups.length} group(s) with ${delaySeconds}s delay...`
    );

    // Send messages with delay between each
    let successCount = 0;
    for (let i = 0; i < selectedGroups.length; i++) {
      const groupId = selectedGroups[i];

      try {
        await fetch("/api/bot/send-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ number: groupId, message: finalMessage }),
        });
        successCount++;

        // Update loading message with progress
        showLoadingOverlay(
          `📱 Sent ${successCount}/${selectedGroups.length} messages... (${delaySeconds}s delay)`
        );

        // Wait before sending next message (except for the last one)
        if (i < selectedGroups.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (err) {
        console.error(`Failed to send to group ${groupId}:`, err);
        // Continue with next group even if one fails
      }
    }

    // Update ad status to accepted
    await updateAdStatus(adId, "accepted");

    showSuccessStatus(
      `✅ Posted to WordPress and sent to ${successCount}/${selectedGroups.length} group(s) successfully!`
    );

    closeWpPreviewModal();
    fetchAndRenderAds();
  } catch (err) {
    hideLoadingOverlay();
    console.error("Error posting and sending:", err);
    alert("Failed to complete operation");
  }
}

// -------------------------
// AI Status Panel Helper Functions
// -------------------------
function showLoadingOverlay(message) {
  let panel = document.getElementById("ai-status-panel");

  if (!panel) {
    // Create AI status panel if it doesn't exist
    panel = document.createElement("div");
    panel.id = "ai-status-panel";
    panel.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      max-width: 400px;
      width: 90%;
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      z-index: 10000;
      padding: 20px;
      display: none;
      animation: slideInRight 0.3s ease-out;
    `;

    panel.innerHTML = `
      <style>
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOutRight {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .ai-status-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 15px;
          padding-bottom: 15px;
          border-bottom: 2px solid #e0e0e0;
        }
        .ai-status-icon {
          font-size: 2rem;
          animation: pulse 2s ease-in-out infinite;
        }
        .ai-status-title {
          font-weight: bold;
          font-size: 1.1rem;
          color: #333;
        }
        .ai-status-message {
          color: #666;
          font-size: 0.95rem;
          line-height: 1.5;
          margin-bottom: 15px;
        }
        .ai-status-progress {
          height: 4px;
          background: #e0e0e0;
          border-radius: 2px;
          overflow: hidden;
          position: relative;
        }
        .ai-status-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #667eea, #764ba2);
          animation: progressMove 1.5s ease-in-out infinite;
        }
        @keyframes progressMove {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .ai-status-success {
          background: #d4edda !important;
          border-left: 4px solid #28a745;
        }
        .ai-status-success .ai-status-icon {
          animation: none;
        }
        .ai-status-success .ai-status-progress {
          display: none;
        }
        @media (max-width: 768px) {
          #ai-status-panel {
            right: 10px;
            top: 10px;
            max-width: calc(100% - 20px);
          }
        }
      </style>
      <div class="ai-status-header">
        <div class="ai-status-icon" id="ai-status-icon">🤖</div>
        <div class="ai-status-title" id="ai-status-title">AI Processing</div>
      </div>
      <div class="ai-status-message" id="ai-status-message"></div>
      <div class="ai-status-progress" id="ai-status-progress">
        <div class="ai-status-progress-bar"></div>
      </div>
    `;

    document.body.appendChild(panel);
  }

  // Update content
  const messageEl = document.getElementById("ai-status-message");
  const iconEl = document.getElementById("ai-status-icon");
  const titleEl = document.getElementById("ai-status-title");

  if (messageEl) messageEl.textContent = message || "Processing...";
  if (iconEl) iconEl.textContent = "🤖";
  if (titleEl) titleEl.textContent = "AI Processing";

  // Remove success class if present
  panel.classList.remove("ai-status-success");

  // Show with animation
  panel.style.display = "block";
  panel.style.animation = "slideInRight 0.3s ease-out";
}

function hideLoadingOverlay() {
  const panel = document.getElementById("ai-status-panel");
  if (panel) {
    // Animate out
    panel.style.animation = "slideOutRight 0.3s ease-out";
    setTimeout(() => {
      panel.style.display = "none";
    }, 300);
  }
}

function showSuccessStatus(message, autoHide = true) {
  const panel = document.getElementById("ai-status-panel");
  if (!panel) return;

  const messageEl = document.getElementById("ai-status-message");
  const iconEl = document.getElementById("ai-status-icon");
  const titleEl = document.getElementById("ai-status-title");

  // Update to success state
  panel.classList.add("ai-status-success");
  if (iconEl) iconEl.textContent = "✅";
  if (titleEl) titleEl.textContent = "Success!";
  if (messageEl)
    messageEl.textContent = message || "Operation completed successfully!";

  // Auto-hide after 3 seconds
  if (autoHide) {
    setTimeout(() => {
      hideLoadingOverlay();
    }, 3000);
  }
}

// ========================================================================================
// PRIVATE CLIENTS AND INTEREST GROUPS SELECTION
// ========================================================================================

// Cache for private clients and interest groups
let cachedPrivateClients = [];
let cachedInterestGroups = [];

/**
 * Toggle Private Clients section visibility
 */
function togglePrivateClientsSection() {
  const container = document.getElementById("private-clients-preview-container");
  const icon = document.getElementById("private-clients-toggle-icon");
  
  if (container) {
    const isHidden = container.style.display === "none";
    container.style.display = isHidden ? "block" : "none";
    if (icon) {
      icon.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
    }
  }
}

/**
 * Toggle Interest Groups section visibility (in preview modal)
 */
function toggleInterestGroupsPreviewSection() {
  const container = document.getElementById("interest-groups-preview-container");
  const icon = document.getElementById("interest-groups-preview-toggle-icon");
  
  if (container) {
    const isHidden = container.style.display === "none";
    container.style.display = isHidden ? "block" : "none";
    if (icon) {
      icon.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
    }
  }
}

/**
 * Load private clients from the API
 */
async function loadPrivateClientsForPreview() {
  try {
    const response = await fetch("/api/bot/private-clients", {
      credentials: "include"
    });
    
    if (!response.ok) {
      throw new Error("Failed to fetch private clients");
    }
    
    const data = await response.json();
    cachedPrivateClients = data.clients || [];
    console.log(`✅ Loaded ${cachedPrivateClients.length} private clients for preview`);
    
    // Update count badge
    const countEl = document.getElementById("private-clients-preview-count");
    if (countEl) {
      countEl.textContent = cachedPrivateClients.length;
    }
    
    // Render the list
    renderPrivateClientsPreview();
    
    return cachedPrivateClients;
  } catch (error) {
    console.error("Error loading private clients:", error);
    cachedPrivateClients = [];
    return [];
  }
}

/**
 * Load interest groups from the API
 */
async function loadInterestGroupsForPreview() {
  try {
    const response = await fetch("/api/bot/interest-groups", {
      credentials: "include"
    });
    
    if (!response.ok) {
      throw new Error("Failed to fetch interest groups");
    }
    
    const data = await response.json();
    cachedInterestGroups = data.groups || [];
    console.log(`✅ Loaded ${cachedInterestGroups.length} interest groups for preview`);
    
    // Update count badge
    const countEl = document.getElementById("interest-groups-preview-count");
    if (countEl) {
      countEl.textContent = cachedInterestGroups.length;
    }
    
    // Render the list
    renderInterestGroupsPreview();
    
    return cachedInterestGroups;
  } catch (error) {
    console.error("Error loading interest groups:", error);
    cachedInterestGroups = [];
    return [];
  }
}

/**
 * Render private clients as checkboxes with role-based filtering
 */
function renderPrivateClientsPreview() {
  const container = document.getElementById("private-clients-preview-list");
  if (!container) return;
  
  if (cachedPrivateClients.length === 0) {
    container.innerHTML = `
      <p style="text-align: center; color: #999; padding: 15px;">
        <i class="fas fa-info-circle"></i> No private clients available
      </p>
    `;
    return;
  }
  
  // Define available roles
  const roles = [
    { key: "باحث", label: "باحث (Seeker)", emoji: "🔍", color: "#4CAF50" },
    { key: "مالك", label: "مالك (Owner)", emoji: "🏠", color: "#2196F3" },
    { key: "مستثمر", label: "مستثمر (Investor)", emoji: "💰", color: "#FF9800" },
    { key: "وسيط", label: "وسيط (Broker)", emoji: "🤝", color: "#9C27B0" }
  ];
  
  // Count clients per role
  const roleCounts = {};
  roles.forEach(r => roleCounts[r.key] = 0);
  cachedPrivateClients.forEach(client => {
    const role = client.role || "";
    if (roleCounts.hasOwnProperty(role)) {
      roleCounts[role]++;
    }
  });
  
  let html = "";
  
  // Role selection header
  html += `
    <div class="role-filters-section" style="margin-bottom: 15px; padding: 12px; background: linear-gradient(135deg, #f5f5f5 0%, #eeeeee 100%); border-radius: 8px;">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
        <i class="fas fa-filter" style="color: #666;"></i>
        <span style="font-weight: 600; color: #333;">Select by Role:</span>
      </div>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
  `;
  
  roles.forEach(role => {
    const count = roleCounts[role.key] || 0;
    if (count > 0) {
      html += `
        <label class="role-filter-item" style="display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: white; border: 2px solid ${role.color}; border-radius: 20px; cursor: pointer; transition: all 0.2s;">
          <input type="checkbox" 
                 class="role-filter-checkbox"
                 data-role="${escapeHtml(role.key)}"
                 style="width: 16px; height: 16px; cursor: pointer; accent-color: ${role.color};">
          <span style="font-weight: 500; color: ${role.color};">${role.emoji} ${role.label}</span>
          <span style="background: ${role.color}; color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.8em;">${count}</span>
        </label>
      `;
    }
  });
  
  html += `
      </div>
      <small style="display: block; margin-top: 8px; color: #888;">
        <i class="fas fa-info-circle"></i> Select a role to select all clients with that role. You can still individually toggle clients below.
      </small>
    </div>
  `;
  
  // Divider
  html += `<div style="height: 1px; background: linear-gradient(90deg, transparent, #ccc, transparent); margin: 10px 0;"></div>`;
  
  // Individual clients section
  html += `<div class="clients-list-section">`;
  
  cachedPrivateClients.forEach((client) => {
    const phone = client.phoneNumber || client.phone || "";
    const name = client.name || "Unknown";
    const role = client.role || "";
    const roleEmoji = getRoleEmoji(role);
    const roleInfo = roles.find(r => r.key === role);
    const roleColor = roleInfo ? roleInfo.color : "#666";
    
    html += `
      <div class="private-client-item" style="display: flex; align-items: center; gap: 10px; padding: 10px; border-bottom: 1px solid #e8f5e9; transition: background 0.2s;" data-role="${escapeHtml(role)}">
        <input type="checkbox" 
               class="private-client-checkbox"
               id="pc-${escapeHtml(phone)}"
               value="${escapeHtml(phone)}"
               data-name="${escapeHtml(name)}"
               data-role="${escapeHtml(role)}"
               style="width: 18px; height: 18px; cursor: pointer; accent-color: ${roleColor};">
        <label for="pc-${escapeHtml(phone)}" style="flex: 1; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; color: #2e7d32;">${escapeHtml(name)}</div>
            <div style="font-size: 0.85em; color: #666;">
              <i class="fas fa-phone" style="font-size: 11px;"></i> ${escapeHtml(phone)}
            </div>
          </div>
          <div style="text-align: right;">
            <span style="background: ${roleColor}20; padding: 3px 8px; border-radius: 12px; font-size: 0.8em; color: ${roleColor}; border: 1px solid ${roleColor};">
              ${roleEmoji} ${escapeHtml(role) || "N/A"}
            </span>
          </div>
        </label>
      </div>
    `;
  });
  
  html += `</div>`;
  
  container.innerHTML = html;
  
  // Wire up role filter checkboxes
  container.querySelectorAll(".role-filter-checkbox").forEach(roleCheckbox => {
    roleCheckbox.addEventListener("change", function() {
      const role = this.dataset.role;
      const isChecked = this.checked;
      
      // Select/deselect all clients with this role
      container.querySelectorAll(`.private-client-checkbox[data-role="${role}"]`).forEach(clientCb => {
        clientCb.checked = isChecked;
      });
    });
  });
  
  // Wire up individual client checkboxes to update role filter state
  container.querySelectorAll(".private-client-checkbox").forEach(clientCb => {
    clientCb.addEventListener("change", function() {
      updateRoleFilterCheckboxStates(container);
    });
  });
}

/**
 * Update role filter checkbox states based on individual selections
 */
function updateRoleFilterCheckboxStates(container) {
  container.querySelectorAll(".role-filter-checkbox").forEach(roleCheckbox => {
    const role = roleCheckbox.dataset.role;
    const clientsWithRole = container.querySelectorAll(`.private-client-checkbox[data-role="${role}"]`);
    const checkedClientsWithRole = container.querySelectorAll(`.private-client-checkbox[data-role="${role}"]:checked`);
    
    if (clientsWithRole.length === 0) {
      roleCheckbox.checked = false;
      roleCheckbox.indeterminate = false;
    } else if (checkedClientsWithRole.length === clientsWithRole.length) {
      roleCheckbox.checked = true;
      roleCheckbox.indeterminate = false;
    } else if (checkedClientsWithRole.length > 0) {
      roleCheckbox.checked = false;
      roleCheckbox.indeterminate = true;
    } else {
      roleCheckbox.checked = false;
      roleCheckbox.indeterminate = false;
    }
  });
}

/**
 * Render interest groups as checkboxes
 */
function renderInterestGroupsPreview() {
  const container = document.getElementById("interest-groups-preview-list");
  if (!container) return;
  
  if (cachedInterestGroups.length === 0) {
    container.innerHTML = `
      <p style="text-align: center; color: #999; padding: 15px;">
        <i class="fas fa-info-circle"></i> No interest groups available
      </p>
    `;
    return;
  }
  
  let html = "";
  cachedInterestGroups.forEach((group) => {
    const id = group.id || "";
    const interest = group.interest || "Unknown";
    const memberCount = group.members ? group.members.length : 0;
    
    html += `
      <div class="interest-group-item" style="display: flex; align-items: center; gap: 10px; padding: 10px; border-bottom: 1px solid #bbdefb; transition: background 0.2s;">
        <input type="checkbox" 
               class="interest-group-checkbox"
               id="ig-${escapeHtml(id)}"
               value="${escapeHtml(id)}"
               data-interest="${escapeHtml(interest)}"
               data-members='${JSON.stringify(group.members || [])}'
               style="width: 18px; height: 18px; cursor: pointer;">
        <label for="ig-${escapeHtml(id)}" style="flex: 1; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600; color: #1565c0;">
              <i class="fas fa-tag" style="font-size: 12px;"></i> ${escapeHtml(interest)}
            </div>
            <div style="font-size: 0.85em; color: #666;">
              Group ID: ${escapeHtml(id)}
            </div>
          </div>
          <div style="text-align: right;">
            <span style="background: #e3f2fd; padding: 3px 8px; border-radius: 12px; font-size: 0.8em; color: #1565c0;">
              <i class="fas fa-users"></i> ${memberCount} members
            </span>
          </div>
        </label>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

/**
 * Get emoji for role type
 */
function getRoleEmoji(role) {
  switch (role) {
    case "باحث": return "🔍";
    case "مالك": return "🏠";
    case "مستثمر": return "💰";
    case "وسيط": return "🤝";
    default: return "👤";
  }
}

/**
 * Get selected private clients
 */
function getSelectedPrivateClients() {
  const selected = [];
  document.querySelectorAll("#private-clients-preview-list .private-client-checkbox:checked")
    .forEach((cb) => {
      selected.push({
        phone: cb.value,
        name: cb.dataset.name || "Unknown",
        role: cb.dataset.role || ""
      });
    });
  return selected;
}

/**
 * Get selected interest groups and expand to member phones
 */
function getSelectedInterestGroupMembers() {
  const allMembers = [];
  const seenPhones = new Set();
  
  document.querySelectorAll("#interest-groups-preview-list .interest-group-checkbox:checked")
    .forEach((cb) => {
      try {
        const members = JSON.parse(cb.dataset.members || "[]");
        const groupInterest = cb.dataset.interest || "Interest Group";
        
        members.forEach((member) => {
          const phone = member.phone || "";
          if (phone && !seenPhones.has(phone)) {
            seenPhones.add(phone);
            allMembers.push({
              phone: phone,
              name: member.name || "Member",
              source: `Interest Group: ${groupInterest}`
            });
          }
        });
      } catch (e) {
        console.error("Error parsing interest group members:", e);
      }
    });
  
  return allMembers;
}
