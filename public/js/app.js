// Global state
let currentUser = null;
let statusCheckInterval = null;
let currentAdIdForResend = null;
let currentSummaryForSend = null; // Store summary being sent
let allGroups = [];
let allCollections = [];
let allCategories = [];
let savedCustomNumbers = []; // Saved custom phone numbers with names
let selectedCustomNumbers = []; // Currently selected custom numbers for sending
let initialDataLoaded = false; // Track if initial data has been loaded

// DOM Elements
const loginPage = document.getElementById("login-page");
const dashboardPage = document.getElementById("dashboard-page");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const userInfo = document.getElementById("user-info");
const userInfoAds = document.getElementById("user-info-ads");
const statusBadge = document.getElementById("status-badge");
const refreshStatusBtn = document.getElementById("refresh-status-btn");
const qrCard = document.getElementById("qr-card");
const qrCode = document.getElementById("qr-code");
const qrLoading = document.getElementById("qr-loading");

// New Sidebar Elements
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const menuBtn = document.getElementById("menu-btn");
const closeSidebarBtn = document.getElementById("close-sidebar-btn");
const navItems = document.querySelectorAll(".nav-item");

// Legacy elements (keeping for compatibility)
const backToDashboardBtn = document.getElementById("back-to-dashboard-btn");
const adsPage = document.getElementById("ads-page");
const adsList = document.getElementById("ads-list");
const adsFilter = document.getElementById("ads-filter");
const categoryFilter = document.getElementById("category-filter");
const refreshAdsBtn = document.getElementById("refresh-ads-btn");
const adsInfo = document.getElementById("ads-info");
const adminControls = document.getElementById("admin-controls");
const disconnectBtn = document.getElementById("disconnect-btn");
const adminMessage = document.getElementById("admin-message");
const adsSearchInput = document.getElementById("ads-search-input");

// Modal elements
const resendModal = document.getElementById("resend-modal");
const closeModalBtn = document.getElementById("close-modal");
const cancelResendBtn = document.getElementById("cancel-resend-btn");
const confirmResendBtn = document.getElementById("confirm-resend-btn");
const groupsList = document.getElementById("groups-list");
const collectionSelect = document.getElementById("collection-select");
const loadCollectionBtn = document.getElementById("load-collection-btn");
const manageCollectionsBtn = document.getElementById("manage-collections-btn");
const saveCollectionBtn = document.getElementById("save-collection-btn");
const collectionNameInput = document.getElementById("collection-name");
const modalMessage = document.getElementById("modal-message");

// Collections modal
const collectionsModal = document.getElementById("collections-modal");
const closeCollectionsModalBtn = document.getElementById(
  "close-collections-modal"
);
const closeCollectionsBtn = document.getElementById("close-collections-btn");
const collectionsList = document.getElementById("collections-list");

// Categories modal
const categoriesModal = document.getElementById("categories-modal");
const closeCategoriesModalBtn = document.getElementById(
  "close-categories-modal"
);
const closeCategoriesBtn = document.getElementById("close-categories-btn");
const categoriesList = document.getElementById("categories-list");
// const manageCategoriesBtn = document.getElementById("manage-categories-btn");
const addCategoryBtn = document.getElementById("add-category-btn");
const newCategoryNameInput = document.getElementById("new-category-name");
const newCategoryColorInput = document.getElementById("new-category-color");
const categoriesMessage = document.getElementById("categories-message");

// Custom Numbers elements
const customNumbersList = document.getElementById("custom-numbers-list");
const customNumberNameInput = document.getElementById("custom-number-name");
const customNumberPhoneInput = document.getElementById("custom-number-phone");
const addCustomNumberBtn = document.getElementById("add-custom-number-btn");
const savedNumbersSelect = document.getElementById("saved-numbers-select");
const manageCustomNumbersBtn = document.getElementById(
  "manage-custom-numbers-btn"
);
const customNumbersModal = document.getElementById("custom-numbers-modal");
const closeCustomNumbersModalBtn = document.getElementById(
  "close-custom-numbers-modal"
);
const closeManageCustomNumbersBtn = document.getElementById(
  "close-manage-custom-numbers-btn"
);
const manageCustomNumberNameInput = document.getElementById(
  "manage-custom-number-name"
);
const manageCustomNumberPhoneInput = document.getElementById(
  "manage-custom-number-phone"
);
const saveCustomNumberBtn = document.getElementById("save-custom-number-btn");
const savedCustomNumbersList = document.getElementById(
  "saved-custom-numbers-list"
);
const customNumbersMessage = document.getElementById("custom-numbers-message");

// Groups Preview Modal custom numbers elements (simplified)
const groupsPreviewCustomNumbersList = document.getElementById(
  "groups-preview-custom-numbers-list"
);
const groupsPreviewCustomNumberNameInput = document.getElementById(
  "groups-preview-custom-number-name"
);
const groupsPreviewCustomNumberPhoneInput = document.getElementById(
  "groups-preview-custom-number-phone"
);
const groupsPreviewAddCustomNumberBtn = document.getElementById(
  "groups-preview-add-custom-number-btn"
);

// Edit Ad modal
const editAdModal = document.getElementById("edit-ad-modal");
const closeEditAdModalBtn = document.getElementById("close-edit-ad-modal");
const cancelEditAdBtn = document.getElementById("cancel-edit-ad-btn");
const saveEditAdBtn = document.getElementById("save-edit-ad-btn");
const editAdTextarea = document.getElementById("edit-ad-textarea");
const editAdMessage = document.getElementById("edit-ad-message");
let currentEditAdId = null;

// Accept Options modal
const acceptOptionsModal = document.getElementById("accept-options-modal");
const closeAcceptModalBtn = document.getElementById("close-accept-modal");
const cancelAcceptBtn = document.getElementById("cancel-accept-btn");
const acceptGroupsOnlyBtn = document.getElementById("accept-groups-only");
const acceptWpOnlyBtn = document.getElementById("accept-wp-only");
const acceptBothBtn = document.getElementById("accept-both");
const acceptOptionsMessage = document.getElementById("accept-options-message");
let currentAcceptAdId = null;

// Reject Reason modal
const rejectReasonModal = document.getElementById("reject-reason-modal");
const closeRejectModalBtn = document.getElementById("close-reject-modal");
const cancelRejectBtn = document.getElementById("cancel-reject-btn");
const confirmRejectBtn = document.getElementById("confirm-reject-btn");
const rejectReasonTextarea = document.getElementById("reject-reason-textarea");
const rejectReasonMessage = document.getElementById("reject-reason-message");
let currentRejectAdId = null;

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  checkAuth();
  setupEventListeners();
  bindLoginUI();

  // Check API keys status periodically (every 5 minutes)
  setInterval(checkAndShowApiKeysNotification, 5 * 60 * 1000);
  // Check immediately on load (after a short delay to ensure auth is done)
  setTimeout(checkAndShowApiKeysNotification, 3000);
});

// Event Listeners
function setupEventListeners() {
  loginForm.addEventListener("submit", handleLogin);
  logoutBtn.addEventListener("click", handleLogout);
  refreshStatusBtn.addEventListener("click", checkBotStatus);
  disconnectBtn.addEventListener("click", handleDisconnect);

  // Refresh groups button
  const refreshGroupsBtn = document.getElementById("refresh-groups-btn");
  if (refreshGroupsBtn) {
    refreshGroupsBtn.addEventListener("click", handleRefreshGroups);
  }

  // New Sidebar Navigation
  if (menuBtn) menuBtn.addEventListener("click", toggleSidebar);
  if (closeSidebarBtn) closeSidebarBtn.addEventListener("click", closeSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener("click", closeSidebar);

  // Navigation Items
  navItems.forEach((navItem) => {
    navItem.addEventListener("click", (e) => {
      e.preventDefault();
      const targetView = navItem.getAttribute("data-view");
      switchView(targetView);

      // Close sidebar on mobile after clicking
      if (window.innerWidth <= 768) {
        closeSidebar();
      }
    });
  });

  // Legacy support
  if (backToDashboardBtn)
    backToDashboardBtn.addEventListener("click", toggleAdsPage);
  if (refreshAdsBtn) refreshAdsBtn.addEventListener("click", fetchAndRenderAds);
  if (adsFilter) adsFilter.addEventListener("change", fetchAndRenderAds);
  if (categoryFilter)
    categoryFilter.addEventListener("change", fetchAndRenderAds);
  
  // Website and Group filters for Ads view
  const adsWebsiteFilter = document.getElementById("ads-website-filter");
  const adsGroupFilter = document.getElementById("ads-group-filter");
  if (adsWebsiteFilter) adsWebsiteFilter.addEventListener("change", fetchAndRenderAds);
  if (adsGroupFilter) adsGroupFilter.addEventListener("change", fetchAndRenderAds);

  // Live search functionality
  if (adsSearchInput) {
    adsSearchInput.addEventListener("input", (e) => {
      performLiveSearch(e.target.value);
    });
  }

  // View-specific buttons
  const manageCollectionsBtnView = document.getElementById(
    "manage-collections-btn-view"
  );
  if (manageCollectionsBtnView) {
    manageCollectionsBtnView.addEventListener("click", openCollectionsManager);
  }

  // WhatsApp Messages refresh button
  const refreshWhatsAppMessagesBtn = document.getElementById(
    "refresh-whatsapp-messages-btn"
  );
  if (refreshWhatsAppMessagesBtn) {
    refreshWhatsAppMessagesBtn.addEventListener(
      "click",
      loadWhatsAppMessagesView
    );
  }

  // WhatsApp Messages filters
  const whatsappSortBy = document.getElementById("whatsapp-sort-by");
  if (whatsappSortBy) {
    whatsappSortBy.addEventListener("change", (e) => {
      whatsappMessagesState.sortBy = e.target.value;
      whatsappMessagesState.currentPage = 1;
      loadWhatsAppMessagesView();
    });
  }

  const whatsappFilterStatus = document.getElementById(
    "whatsapp-filter-status"
  );
  if (whatsappFilterStatus) {
    whatsappFilterStatus.addEventListener("change", (e) => {
      whatsappMessagesState.filterStatus = e.target.value;
      whatsappMessagesState.currentPage = 1;
      loadWhatsAppMessagesView();
    });
  }

  const whatsappFilterWebsite = document.getElementById(
    "whatsapp-filter-website"
  );
  if (whatsappFilterWebsite) {
    whatsappFilterWebsite.addEventListener("change", (e) => {
      whatsappMessagesState.filterWebsite = e.target.value;
      whatsappMessagesState.currentPage = 1;
      loadWhatsAppMessagesView();
    });
  }

  const whatsappFilterCategory = document.getElementById(
    "whatsapp-filter-category"
  );
  if (whatsappFilterCategory) {
    whatsappFilterCategory.addEventListener("change", (e) => {
      whatsappMessagesState.filterCategory = e.target.value;
      whatsappMessagesState.currentPage = 1;
      loadWhatsAppMessagesView();
    });
  }

  const whatsappFilterGroup = document.getElementById(
    "whatsapp-filter-group"
  );
  if (whatsappFilterGroup) {
    whatsappFilterGroup.addEventListener("change", (e) => {
      whatsappMessagesState.filterGroup = e.target.value;
      whatsappMessagesState.currentPage = 1;
      loadWhatsAppMessagesView();
    });
  }

  // const manageCategoriesBtnView = document.getElementById(
  //   "manage-categories-btn"
  // );
  // if (manageCategoriesBtnView) {
  //   manageCategoriesBtnView.addEventListener("click", openCategoriesManager);
  // }

  const addCategoryBtnView = document.getElementById("add-category-btn-view");
  if (addCategoryBtnView) {
    addCategoryBtnView.addEventListener("click", handleAddCategoryFromView);
  }

  // User management buttons
  const addUserBtn = document.getElementById("add-user-btn");
  if (addUserBtn) {
    addUserBtn.addEventListener("click", handleAddUser);
  }

  // Recycle bin buttons
  const refreshRecycleBtn = document.getElementById("refresh-recycle-btn");
  if (refreshRecycleBtn) {
    refreshRecycleBtn.addEventListener("click", loadRecycleBinView);
  }

  const emptyRecycleBtn = document.getElementById("empty-recycle-btn");
  if (emptyRecycleBtn) {
    emptyRecycleBtn.addEventListener("click", handleEmptyRecycleBin);
  }

  // Settings buttons
  const saveAllSettingsBtn = document.getElementById("save-all-settings-btn");
  if (saveAllSettingsBtn) {
    saveAllSettingsBtn.addEventListener("click", handleSaveAllSettings);
  }

  const testWpConnectionBtn = document.getElementById("test-wp-connection-btn");
  if (testWpConnectionBtn) {
    testWpConnectionBtn.addEventListener("click", testWordPressConnection);
  }

  // Excluded Groups buttons
  const loadExcludedGroupsBtn = document.getElementById(
    "load-excluded-groups-btn"
  );
  if (loadExcludedGroupsBtn) {
    loadExcludedGroupsBtn.addEventListener("click", loadExcludedGroups);
  }

  const selectAllGroupsBtn = document.getElementById("select-all-groups-btn");
  if (selectAllGroupsBtn) {
    selectAllGroupsBtn.addEventListener("click", selectAllExcludedGroups);
  }

  const deselectAllGroupsBtn = document.getElementById(
    "deselect-all-groups-btn"
  );
  if (deselectAllGroupsBtn) {
    deselectAllGroupsBtn.addEventListener("click", deselectAllExcludedGroups);
  }

  const excludedGroupsSearch = document.getElementById(
    "excluded-groups-search"
  );
  if (excludedGroupsSearch) {
    excludedGroupsSearch.addEventListener("input", filterExcludedGroups);
  }

  const addApiKeyBtn = document.getElementById("add-api-key-btn");
  if (addApiKeyBtn) {
    addApiKeyBtn.addEventListener("click", () => {
      document.getElementById("api-key-form").style.display = "block";
    });
  }

  const saveApiKeyBtn = document.getElementById("save-api-key-btn");
  if (saveApiKeyBtn) {
    saveApiKeyBtn.addEventListener("click", handleSaveApiKey);
  }

  const cancelApiKeyBtn = document.getElementById("cancel-api-key-btn");
  if (cancelApiKeyBtn) {
    cancelApiKeyBtn.addEventListener("click", () => {
      document.getElementById("api-key-form").style.display = "none";
      document.getElementById("api-key-name").value = "";
      document.getElementById("api-key-value").value = "";
    });
  }

  // Modal events
  if (closeModalBtn) closeModalBtn.addEventListener("click", closeResendModal);
  if (cancelResendBtn)
    cancelResendBtn.addEventListener("click", closeResendModal);
  if (confirmResendBtn)
    confirmResendBtn.addEventListener("click", handleConfirmResend);
  if (loadCollectionBtn)
    loadCollectionBtn.addEventListener("click", handleLoadCollection);
  if (saveCollectionBtn)
    saveCollectionBtn.addEventListener("click", handleSaveCollection);
  if (manageCollectionsBtn)
    manageCollectionsBtn.addEventListener("click", openCollectionsManager);

  // Collections modal
  if (closeCollectionsModalBtn)
    closeCollectionsModalBtn.addEventListener("click", closeCollectionsManager);
  if (closeCollectionsBtn)
    closeCollectionsBtn.addEventListener("click", closeCollectionsManager);

  // Categories modal
  if (closeCategoriesModalBtn)
    closeCategoriesModalBtn.addEventListener("click", closeCategoriesManager);
  if (closeCategoriesBtn)
    closeCategoriesBtn.addEventListener("click", closeCategoriesManager);
  // if (manageCategoriesBtn)
  //   manageCategoriesBtn.addEventListener("click", openCategoriesManager);
  if (addCategoryBtn)
    addCategoryBtn.addEventListener("click", handleAddCategory);

  // Custom Numbers
  if (addCustomNumberBtn)
    addCustomNumberBtn.addEventListener("click", handleAddCustomNumberToList);
  if (manageCustomNumbersBtn)
    manageCustomNumbersBtn.addEventListener("click", openCustomNumbersManager);
  if (closeCustomNumbersModalBtn)
    closeCustomNumbersModalBtn.addEventListener(
      "click",
      closeCustomNumbersManager
    );
  if (closeManageCustomNumbersBtn)
    closeManageCustomNumbersBtn.addEventListener(
      "click",
      closeCustomNumbersManager
    );
  if (saveCustomNumberBtn)
    saveCustomNumberBtn.addEventListener("click", handleSaveCustomNumber);
  if (savedNumbersSelect)
    savedNumbersSelect.addEventListener("change", handleLoadSavedNumber);

  // Groups Preview Modal Custom Numbers
  if (groupsPreviewAddCustomNumberBtn)
    groupsPreviewAddCustomNumberBtn.addEventListener(
      "click",
      handleGroupsPreviewAddCustomNumber
    );

  // Allow Enter key to add number
  if (groupsPreviewCustomNumberPhoneInput) {
    groupsPreviewCustomNumberPhoneInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleGroupsPreviewAddCustomNumber();
      }
    });
  }

  // Edit Ad modal
  if (closeEditAdModalBtn)
    closeEditAdModalBtn.addEventListener("click", closeEditAdModal);
  if (cancelEditAdBtn)
    cancelEditAdBtn.addEventListener("click", closeEditAdModal);
  if (saveEditAdBtn) saveEditAdBtn.addEventListener("click", handleSaveEditAd);

  // Accept Options modal
  if (closeAcceptModalBtn)
    closeAcceptModalBtn.addEventListener("click", closeAcceptOptionsModal);
  if (cancelAcceptBtn)
    cancelAcceptBtn.addEventListener("click", closeAcceptOptionsModal);
  if (acceptGroupsOnlyBtn)
    acceptGroupsOnlyBtn.addEventListener("click", () =>
      handleAcceptOption("groups")
    );
  if (acceptWpOnlyBtn)
    acceptWpOnlyBtn.addEventListener("click", () =>
      handleAcceptOption("wordpress")
    );
  if (acceptBothBtn)
    acceptBothBtn.addEventListener("click", () => handleAcceptOption("both"));

  // Reject Reason modal
  if (closeRejectModalBtn)
    closeRejectModalBtn.addEventListener("click", closeRejectReasonModal);
  if (cancelRejectBtn)
    cancelRejectBtn.addEventListener("click", closeRejectReasonModal);
  if (confirmRejectBtn)
    confirmRejectBtn.addEventListener("click", handleConfirmReject);
  
  // Quick reject reason buttons
  document.querySelectorAll(".quick-reject-reason").forEach((btn) => {
    btn.addEventListener("click", () => {
      const reason = btn.getAttribute("data-reason");
      if (rejectReasonTextarea) {
        rejectReasonTextarea.value = reason;
      }
    });
  });

  // Close modals on outside click
  if (resendModal) {
    resendModal.addEventListener("click", (e) => {
      if (e.target === resendModal) closeResendModal();
    });
  }
  if (collectionsModal) {
    collectionsModal.addEventListener("click", (e) => {
      if (e.target === collectionsModal) closeCollectionsManager();
    });
  }
  if (categoriesModal) {
    categoriesModal.addEventListener("click", (e) => {
      if (e.target === categoriesModal) closeCategoriesManager();
    });
  }
  if (editAdModal) {
    editAdModal.addEventListener("click", (e) => {
      if (e.target === editAdModal) closeEditAdModal();
    });
  }
  if (acceptOptionsModal) {
    acceptOptionsModal.addEventListener("click", (e) => {
      if (e.target === acceptOptionsModal) closeAcceptOptionsModal();
    });
  }
  if (rejectReasonModal) {
    rejectReasonModal.addEventListener("click", (e) => {
      if (e.target === rejectReasonModal) closeRejectReasonModal();
    });
  }
}

function bindLoginUI() {
  const toggleBtn = document.getElementById("toggle-password");
  const pwdInput = document.getElementById("password");
  if (toggleBtn && pwdInput) {
    toggleBtn.addEventListener("click", () => {
      const isPw = pwdInput.getAttribute("type") === "password";
      pwdInput.setAttribute("type", isPw ? "text" : "password");
      const icon = toggleBtn.querySelector("i");
      if (icon) {
        icon.classList.toggle("fa-eye");
        icon.classList.toggle("fa-eye-slash");
      }
    });
  }
}

// Check authentication
async function checkAuth() {
  try {
    const response = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "include",
    });

    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
      showDashboard();
      startStatusChecking();
    } else {
      showLogin();
    }
  } catch (error) {
    console.error("Auth check failed:", error);
    showLogin();
  }
}

// Login handler
async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
      credentials: "include",
    });

    const data = await response.json();

    if (response.ok) {
      currentUser = data.user;
      showDashboard();
      startStatusChecking();
    } else {
      showError(loginError, data.error || "Login failed");
    }
  } catch (error) {
    console.error("Login error:", error);
    showError(loginError, "An error occurred. Please try again.");
  }
}

// Logout handler
async function handleLogout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });

    currentUser = null;
    stopStatusChecking();

    // Reset initial data flag so next login loads fresh data
    initialDataLoaded = false;
    allGroups = [];
    allCollections = [];
    allCategories = [];

    showLogin();
  } catch (error) {
    console.error("Logout error:", error);
  }
}

// Check bot status
async function checkBotStatus() {
  try {
    const response = await fetch("/api/bot/status", {
      method: "GET",
      credentials: "include",
    });

    if (response.ok) {
      const data = await response.json();
      updateStatus(data.status);

      // Update queue statistics if available
      if (data.queue) {
        updateQueueStats(data.queue);
      }

      // If status is 'qr' or 'disconnected', fetch QR code
      if (data.status === "qr" || data.status === "disconnected") {
        fetchQRCode();
      }
    }
  } catch (error) {
    console.error("Status check error:", error);
  }
}

// Update queue statistics display
function updateQueueStats(queueData) {
  const queueStatsDiv = document.getElementById("queue-stats");
  const queueCurrent = document.getElementById("queue-current");
  const queueActive = document.getElementById("queue-active");
  const queueProcessed = document.getElementById("queue-processed");
  const queueFailed = document.getElementById("queue-failed");

  if (queueStatsDiv && queueData) {
    // Show queue stats section
    queueStatsDiv.style.display = "block";

    // Update values
    if (queueCurrent)
      queueCurrent.textContent = queueData.currentQueueSize || 0;
    if (queueActive) queueActive.textContent = queueData.activeProcessing || 0;
    if (queueProcessed)
      queueProcessed.textContent = queueData.totalProcessed || 0;
    if (queueFailed) queueFailed.textContent = queueData.totalFailed || 0;

    // Update badge colors based on queue size
    if (queueCurrent) {
      const queueSize = queueData.currentQueueSize || 0;
      if (queueSize === 0) {
        queueCurrent.className = "badge badge-success";
      } else if (queueSize < 5) {
        queueCurrent.className = "badge badge-warning";
      } else {
        queueCurrent.className = "badge badge-danger";
      }
    }

    // Update active processing badge
    if (queueActive) {
      const activeCount = queueData.activeProcessing || 0;
      queueActive.className =
        activeCount > 0 ? "badge badge-primary" : "badge badge-secondary";
    }
  }
}

// Refresh groups list
async function handleRefreshGroups() {
  const btn = document.getElementById("refresh-groups-btn");
  const messageEl = document.getElementById("refresh-groups-message");
  const lastUpdateEl = document.getElementById("groups-last-update");

  if (!btn || !messageEl) return;

  // Disable button and show loading
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
  messageEl.style.display = "none";

  try {
    const response = await fetch("/api/bot/groups/refresh", {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Failed to refresh groups");
    }

    const data = await response.json();
    allGroups = data.groups || [];

    // Show success message
    messageEl.textContent = `✅ Successfully refreshed! Found ${allGroups.length} groups.`;
    messageEl.className = "info-message success";
    messageEl.style.display = "block";

    // Update last update time
    if (lastUpdateEl) {
      lastUpdateEl.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    }

    // Update stats
    const statGroups = document.getElementById("stat-groups");
    if (statGroups) {
      statGroups.textContent = allGroups.length;
    }

    // Hide success message after 3 seconds
    setTimeout(() => {
      messageEl.style.display = "none";
    }, 3000);
  } catch (error) {
    console.error("Error refreshing groups:", error);
    messageEl.textContent =
      "❌ Failed to refresh groups. Make sure the bot is connected.";
    messageEl.className = "info-message error";
    messageEl.style.display = "block";
  } finally {
    // Re-enable button
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Groups';
  }
}

// Fetch QR code
async function fetchQRCode() {
  try {
    qrLoading.style.display = "block";
    qrCode.style.display = "none";

    const response = await fetch("/api/bot/qr", {
      method: "GET",
      credentials: "include",
    });

    if (response.ok) {
      const data = await response.json();

      if (data.qrCode) {
        qrCode.src = data.qrCode;
        qrCode.style.display = "block";
        qrLoading.style.display = "none";
        qrCard.style.display = "block";
      } else {
        qrLoading.textContent = "No QR code available. Please wait...";
      }
    }
  } catch (error) {
    console.error("QR fetch error:", error);
    qrLoading.textContent = "Failed to load QR code";
  }
}

// Update status display
function updateStatus(status) {
  statusBadge.className = "badge";

  switch (status) {
    case "connected":
      statusBadge.classList.add("badge-connected");
      statusBadge.textContent = "✓ Connected";
      qrCard.style.display = "none";
      break;
    case "qr":
      statusBadge.classList.add("badge-qr");
      statusBadge.textContent = "⚠ Waiting for QR Scan";
      qrCard.style.display = "block";
      break;
    case "reconnecting":
      statusBadge.classList.add("badge-reconnecting");
      statusBadge.textContent = "🔄 Reconnecting...";
      break;
    default:
      statusBadge.classList.add("badge-disconnected");
      statusBadge.textContent = "✗ Disconnected";
      qrCard.style.display = "block";
  }
}

// ==================== NEW SIDEBAR NAVIGATION ====================

// Toggle Sidebar
function toggleSidebar() {
  if (sidebar) {
    sidebar.classList.toggle("open");
    if (sidebarOverlay) {
      sidebarOverlay.classList.toggle("active");
    }
  }
}

// Close Sidebar
function closeSidebar() {
  if (sidebar) sidebar.classList.remove("open");
  if (sidebarOverlay) sidebarOverlay.classList.remove("active");
}

// Switch View
function switchView(viewName) {
  // Hide all content views
  const allContentViews = document.querySelectorAll(".content-view");
  allContentViews.forEach((view) => view.classList.remove("active"));

  // Show target view
  const targetView = document.getElementById(`${viewName}-view`);
  if (targetView) {
    targetView.classList.add("active");
  }

  // Update active nav item
  navItems.forEach((item) => item.classList.remove("active"));
  const activeNavItem = document.querySelector(`[data-view="${viewName}"]`);
  if (activeNavItem) {
    activeNavItem.classList.add("active");
  }

  // Load data based on view
  if (viewName === "home") {
    updateDashboardStats();
    loadAnalytics(); // Load analytics when viewing home
  } else if (viewName === "whatsapp-messages") {
    loadWhatsAppMessagesView();
  } else if (viewName === "ads") {
    fetchAndRenderAds();
  } else if (viewName === "collections") {
    loadCollectionsView();
  } else if (viewName === "categories") {
    loadCategoriesView();
  } else if (viewName === "users") {
    loadUsersView();
  } else if (viewName === "recycle-bin") {
    loadRecycleBinView();
  } else if (viewName === "settings") {
    loadSettingsView();
  } else if (viewName === "private-clients") {
    loadPrivateClientsView();
  } else if (viewName === "daily-summaries") {
    loadDailySummariesView();
  }
}

// Update Dashboard Stats
async function updateDashboardStats() {
  try {
    // Fetch ads
    const response = await fetch("/api/bot/ads");
    if (!response.ok) throw new Error("Failed to fetch ads");

    const data = await response.json();

    // Handle both array and object responses
    const ads = Array.isArray(data) ? data : data.ads || [];

    // Count by status
    const totalAds = ads.length;
    const pendingAds = ads.filter((ad) => ad.status === "pending").length;
    const acceptedAds = ads.filter((ad) => ad.status === "accepted").length;
    const rejectedAds = ads.filter((ad) => ad.status === "rejected").length;

    // Update stat cards
    const totalStat = document.getElementById("total-ads-stat");
    const pendingStat = document.getElementById("pending-ads-stat");
    const acceptedStat = document.getElementById("accepted-ads-stat");
    const rejectedStat = document.getElementById("rejected-ads-stat");

    if (totalStat) totalStat.textContent = totalAds;
    if (pendingStat) pendingStat.textContent = pendingAds;
    if (acceptedStat) acceptedStat.textContent = acceptedAds;
    if (rejectedStat) rejectedStat.textContent = rejectedAds;
  } catch (error) {
    console.error("Error updating stats:", error);
    // Set stats to 0 on error
    const totalStat = document.getElementById("total-ads-stat");
    const pendingStat = document.getElementById("pending-ads-stat");
    const acceptedStat = document.getElementById("accepted-ads-stat");
    const rejectedStat = document.getElementById("rejected-ads-stat");

    if (totalStat) totalStat.textContent = "0";
    if (pendingStat) pendingStat.textContent = "0";
    if (acceptedStat) acceptedStat.textContent = "0";
    if (rejectedStat) rejectedStat.textContent = "0";
  }
}

// Load Collections View
async function loadCollectionsView() {
  try {
    const response = await fetch("/api/bot/collections");
    if (!response.ok) throw new Error("Failed to fetch collections");

    const data = await response.json();
    allCollections = data.collections || [];

    const listContainer = document.getElementById("collections-view-list");
    if (!listContainer) return;

    if (allCollections.length === 0) {
      listContainer.innerHTML =
        '<p class="info-text">No collections saved yet. Create one to organize your groups!</p>';
      return;
    }

    listContainer.innerHTML = allCollections
      .map(
        (collection) => `
      <div class="collection-item">
        <div class="collection-info">
          <div class="collection-name">${collection.name}</div>
          <div class="collection-count">${collection.groups.length} group(s)</div>
        </div>
        <div class="collection-actions">
          <button class="btn btn-sm btn-secondary" onclick="viewCollectionGroups('${collection.name}')">
            👁️ View
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteCollectionFromView('${collection.name}')">
            🗑️ Delete
          </button>
        </div>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Error loading collections:", error);
    const listContainer = document.getElementById("collections-view-list");
    if (listContainer) {
      listContainer.innerHTML =
        '<p class="error-message show">Failed to load collections.</p>';
    }
  }
}

// Load Categories View
async function loadCategoriesView() {
  try {
    const response = await fetch("/api/bot/categories");
    if (!response.ok) throw new Error("Failed to fetch categories");

    const data = await response.json();
    allCategories = data.categories || [];

    const listContainer = document.getElementById("categories-view-list");
    if (!listContainer) return;

    if (allCategories.length === 0) {
      listContainer.innerHTML =
        '<p class="info-text">No custom categories yet. Add one above!</p>';
      return;
    }

    listContainer.innerHTML = allCategories
      .map(
        (category) => `
      <div class="collection-item">
        <div class="collection-info">
          <div class="collection-name">
            <span style="display: inline-block; width: 20px; height: 20px; background-color: ${category.color}; border-radius: 3px; margin-right: 10px;"></span>
            ${category.name}
          </div>
        </div>
        <div class="collection-actions">
          <button class="btn btn-sm btn-danger" onclick="deleteCategoryFromView('${category.name}')">
            🗑️ Delete
          </button>
        </div>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Error loading categories:", error);
    const listContainer = document.getElementById("categories-view-list");
    if (listContainer) {
      listContainer.innerHTML =
        '<p class="error-message show">Failed to load categories.</p>';
    }
  }
}

// View Collection Groups
function viewCollectionGroups(collectionName) {
  const collection = allCollections.find((c) => c.name === collectionName);
  if (!collection) return;

  const groupNames = collection.groups
    .map((groupId) => {
      const group = allGroups.find((g) => g.id === groupId);
      return group ? group.subject : groupId;
    })
    .join("\n• ");

  alert(`Groups in "${collectionName}":\n\n• ${groupNames}`);
}

// Delete Collection from View
async function deleteCollectionFromView(collectionName) {
  if (
    !confirm(
      `Are you sure you want to delete the collection "${collectionName}"?`
    )
  )
    return;

  try {
    const response = await fetch(
      `/api/bot/collections/${encodeURIComponent(collectionName)}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) throw new Error("Failed to delete collection");

    await loadCollectionsView();
    showMessage(
      "categories-view-message",
      "Collection deleted successfully!",
      "success"
    );
  } catch (error) {
    console.error("Error deleting collection:", error);
    alert("Failed to delete collection");
  }
}

// Delete Category from View
async function deleteCategoryFromView(categoryName) {
  if (
    !confirm(`Are you sure you want to delete the category "${categoryName}"?`)
  )
    return;

  try {
    const response = await fetch(
      `/api/bot/categories/${encodeURIComponent(categoryName)}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) throw new Error("Failed to delete category");

    await loadCategoriesView();
    await loadCategories(); // Refresh the filter dropdown
    showMessage(
      "categories-view-message",
      "Category deleted successfully!",
      "success"
    );
  } catch (error) {
    console.error("Error deleting category:", error);
    alert("Failed to delete category");
  }
}

// ==================== USER MANAGEMENT ====================

// Load Users View
async function loadUsersView() {
  try {
    const response = await fetch("/api/auth/users");
    if (!response.ok) throw new Error("Failed to fetch users");

    const data = await response.json();
    const users = data.users || [];

    const listContainer = document.getElementById("users-list");
    if (!listContainer) return;

    if (users.length === 0) {
      listContainer.innerHTML = '<p class="info-text">No users found.</p>';
      return;
    }

    listContainer.innerHTML = users
      .map(
        (user) => `
      <div class="collection-item">
        <div class="collection-info">
          <div class="collection-name">
            <strong>${user.username}</strong>
            <span style="margin-left: 10px; padding: 4px 8px; background: ${
              user.role === "admin" ? "#dc3545" : "#6c757d"
            }; color: white; border-radius: 3px; font-size: 0.85rem;">
              ${user.role.toUpperCase()}
            </span>
          </div>
          <div class="collection-count">User ID: ${user.id}</div>
        </div>
        <div class="collection-actions">
          <button class="btn btn-sm btn-secondary" onclick="editUser(${
            user.id
          }, '${user.username}', '${user.role}')">
            ✏️ Edit
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteUser(${
            user.id
          }, '${user.username}')">
            🗑️ Delete
          </button>
        </div>
      </div>
    `
      )
      .join("");
  } catch (error) {
    console.error("Error loading users:", error);
    const listContainer = document.getElementById("users-list");
    if (listContainer) {
      listContainer.innerHTML =
        '<p class="error-message show">Failed to load users.</p>';
    }
  }
}

// Add User
async function handleAddUser() {
  const usernameInput = document.getElementById("new-user-username");
  const passwordInput = document.getElementById("new-user-password");
  const roleSelect = document.getElementById("new-user-role");

  if (!usernameInput || !passwordInput || !roleSelect) return;

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  const role = roleSelect.value;

  if (!username || !password) {
    showMessage("users-message", "Please enter username and password", "error");
    return;
  }

  if (password.length < 6) {
    showMessage(
      "users-message",
      "Password must be at least 6 characters",
      "error"
    );
    return;
  }

  try {
    const response = await fetch("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password, role }),
    });

    const data = await response.json();

    if (response.ok) {
      usernameInput.value = "";
      passwordInput.value = "";
      roleSelect.value = "author";
      await loadUsersView();
      showMessage("users-message", "User added successfully!", "success");
    } else {
      showMessage("users-message", data.error || "Failed to add user", "error");
    }
  } catch (error) {
    console.error("Error adding user:", error);
    showMessage("users-message", "Failed to add user", "error");
  }
}

// Edit User
async function editUser(id, currentUsername, currentRole) {
  const newUsername = prompt(
    "Enter new username (leave blank to keep current):",
    currentUsername
  );
  if (newUsername === null) return; // User cancelled

  const newPassword = prompt(
    "Enter new password (leave blank to keep current):"
  );
  if (newPassword === null) return; // User cancelled

  const newRole = prompt("Enter new role (admin/author):", currentRole);
  if (newRole === null) return; // User cancelled

  if (newRole && !["admin", "author"].includes(newRole.toLowerCase())) {
    alert("Invalid role. Must be 'admin' or 'author'");
    return;
  }

  const updateData = {};
  if (newUsername && newUsername !== currentUsername)
    updateData.username = newUsername;
  if (newPassword) updateData.password = newPassword;
  if (newRole && newRole.toLowerCase() !== currentRole)
    updateData.role = newRole.toLowerCase();

  if (Object.keys(updateData).length === 0) {
    alert("No changes made");
    return;
  }

  try {
    const response = await fetch(`/api/auth/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(updateData),
    });

    const data = await response.json();

    if (response.ok) {
      await loadUsersView();
      showMessage("users-message", "User updated successfully!", "success");
    } else {
      alert(data.error || "Failed to update user");
    }
  } catch (error) {
    console.error("Error updating user:", error);
    alert("Failed to update user");
  }
}

// Delete User
async function deleteUser(id, username) {
  if (!confirm(`Are you sure you want to delete user "${username}"?`)) return;

  try {
    const response = await fetch(`/api/auth/users/${id}`, {
      method: "DELETE",
      credentials: "include",
    });

    const data = await response.json();

    if (response.ok) {
      await loadUsersView();
      showMessage("users-message", "User deleted successfully!", "success");
    } else {
      alert(data.error || "Failed to delete user");
    }
  } catch (error) {
    console.error("Error deleting user:", error);
    alert("Failed to delete user");
  }
}

// ==================== LEGACY SUPPORT ====================

// Toggle Ads page (hamburger menu) - LEGACY
function toggleAdsPage() {
  if (adsPage && dashboardPage) {
    const isAdsVisible = adsPage.classList.contains("active");

    if (isAdsVisible) {
      // Switch back to dashboard
      adsPage.classList.remove("active");
      adsPage.style.display = "none";
      dashboardPage.classList.add("active");
      dashboardPage.style.display = "block";
    } else {
      // Switch to ads page
      dashboardPage.classList.remove("active");
      dashboardPage.style.display = "none";
      adsPage.classList.add("active");
      adsPage.style.display = "block";
      fetchAndRenderAds();
    }
  }
}

// Live search function
function performLiveSearch(searchTerm) {
  const cards = adsList.querySelectorAll(".card[data-ad-id]");
  const term = searchTerm.toLowerCase().trim();

  if (!term) {
    // Show all ads if search is empty
    cards.forEach((card) => (card.style.display = "block"));
    return;
  }

  cards.forEach((card) => {
    const adId = card.getAttribute("data-ad-id");
    const adIndex = card.getAttribute("data-ad-index");
    const cardText = card.textContent.toLowerCase();

    // Search in: ad number, ID, all text content (includes title, category, location, price, etc.)
    const matchesSearch =
      adIndex.includes(term) ||
      adId.toLowerCase().includes(term) ||
      cardText.includes(term);

    card.style.display = matchesSearch ? "block" : "none";
  });
}

// Focus on specific ad and expand it
function focusOnAd(adId) {
  const card = adsList.querySelector(`.card[data-ad-id="${adId}"]`);
  if (!card) return;

  // Scroll to the ad with smooth animation
  card.scrollIntoView({ behavior: "smooth", block: "center" });

  // Expand the ad if it's collapsed
  const content = card.querySelector(`.ad-faq-content[data-ad-id="${adId}"]`);
  const header = card.querySelector(`.ad-faq-header[data-ad-id="${adId}"]`);
  const icon = card.querySelector(`.ad-faq-icon[data-ad-id="${adId}"]`);

  if (content && content.style.display !== "block") {
    content.style.display = "block";
    if (icon) icon.style.transform = "rotate(90deg)";
  }

  // Highlight the ad temporarily
  card.style.boxShadow = "0 0 20px rgba(90, 103, 216, 0.6)";
  card.style.transition = "box-shadow 0.3s ease";

  setTimeout(() => {
    card.style.boxShadow = "";
  }, 2000);
}

// Fetch ads from server and render
// Pagination state
let currentAdsPage = 1;
let totalAdsPages = 1;
let isLoadingMoreAds = false;

async function fetchAndRenderAds(reset = true) {
  try {
    if (reset) {
      currentAdsPage = 1;
      adsList.innerHTML = '<div class="loading">Loading ads...</div>';
      hideMessage(adsInfo);
    } else {
      if (isLoadingMoreAds) return; // Prevent duplicate requests
      isLoadingMoreAds = true;
    }

    const statusFilter = adsFilter.value;
    const catFilter = categoryFilter.value;
    const websiteFilter = document.getElementById("ads-website-filter")?.value || "all";
    const groupFilter = document.getElementById("ads-group-filter")?.value || "all";

    // Build query params
    const params = new URLSearchParams({
      page: currentAdsPage,
      limit: 20,
    });

    if (statusFilter && statusFilter !== "all") {
      params.append("status", statusFilter);
    }

    if (catFilter && catFilter !== "all") {
      params.append("category", catFilter);
    }

    if (websiteFilter && websiteFilter !== "all") {
      params.append("website", websiteFilter);
    }

    if (groupFilter && groupFilter !== "all") {
      params.append("group", groupFilter);
    }

    const response = await fetch(`/api/bot/ads?${params.toString()}`, {
      credentials: "include",
    });

    // Handle authentication errors
    if (response.status === 401 || response.status === 403) {
      currentUser = null;
      showLogin();
      return;
    }

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    const list = data.ads || [];
    const pagination = data.pagination || {};

    totalAdsPages = pagination.totalPages || 1;

    // Populate group filter dropdown with unique groups from ads
    populateAdsGroupFilter(data.allGroups || []);

    renderAds(list, reset, pagination);

    isLoadingMoreAds = false;
  } catch (err) {
    console.error("Fetch ads error:", err);
    if (reset) {
      adsList.innerHTML = "";
      showInfo(adsInfo, "Failed to load ads. Please try again.");
    }
    isLoadingMoreAds = false;
  }
}

// Populate group filter dropdown for ads view
function populateAdsGroupFilter(groups) {
  const groupSelect = document.getElementById("ads-group-filter");
  if (!groupSelect) return;

  const currentValue = groupSelect.value;
  
  // Clear existing options except the first "All Groups"
  while (groupSelect.options.length > 1) {
    groupSelect.remove(1);
  }

  // Add unique groups
  groups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.id || group.name;
    option.textContent = group.name;
    groupSelect.appendChild(option);
  });

  // Restore previous selection if it exists
  if (currentValue && currentValue !== "all") {
    groupSelect.value = currentValue;
  }
}

function renderAds(list, reset = true, pagination = {}) {
  if (reset) {
    adsList.innerHTML = "";
  } else {
    // Remove "Load More" button if it exists
    const existingLoadMore = adsList.querySelector(".load-more-container");
    if (existingLoadMore) existingLoadMore.remove();
  }

  if (!list || list.length === 0) {
    if (reset) {
      adsList.innerHTML = `<div class="info-text">No ads found.</div>`;
    }
    return;
  }

  const startIndex = reset ? 0 : adsList.querySelectorAll(".card").length;

  list.forEach((ad, index) => {
    const globalIndex = startIndex + index;
    const el = document.createElement("div");
    el.className = "card";
    el.style.marginBottom = "12px";
    el.setAttribute("data-ad-id", ad.id); // For search and focus
    el.setAttribute("data-ad-index", index + 1); // Ad number

    // Find category for color
    const catObj = allCategories.find((c) => c.name === ad.category);
    const catColor = catObj ? catObj.color : "#95a5a6";

    // AI confidence badge
    const aiConfidenceBadge = ad.aiConfidence
      ? `<span style="background: ${
          ad.aiConfidence > 70
            ? "#28a745"
            : ad.aiConfidence > 40
            ? "#ffc107"
            : "#dc3545"
        }; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; margin-left: 8px;">
        AI: ${ad.aiConfidence}%
      </span>`
      : "";

    const hasEnhanced = ad.enhancedText && ad.enhancedText !== ad.text;

    // Determine target website with icon and styling
    const targetWebsite =
      ad.targetWebsite || ad.wpData?.targetWebsite || "masaak";
    const websiteBadge =
      targetWebsite === "hasak"
        ? `<span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 4px 10px; border-radius: 6px; font-size: 0.85rem; font-weight: bold; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 2px 4px rgba(102,126,234,0.3);">
            <i class="fas fa-calendar-alt"></i> حساك
          </span>`
        : `<span style="background: linear-gradient(135deg, #56ab2f 0%, #a8e063 100%); color: white; padding: 4px 10px; border-radius: 6px; font-size: 0.85rem; font-weight: bold; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 2px 4px rgba(86,171,47,0.3);">
            <i class="fas fa-home"></i> مسعاك
          </span>`;

    el.innerHTML = `
      <div class="card-body">
        <!-- FAQ-style Header (Clickable) -->
        <div class="ad-faq-header" data-ad-id="${
          ad.id
        }" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #5a67d8; color: white; border-radius: 8px; transition: all 0.3s ease;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px; flex-wrap: wrap;">
              <span style="background: rgba(255,255,255,0.3); padding: 4px 10px; border-radius: 6px; font-weight: bold; margin-right: 5px;">#${
                index + 1
              }</span>
              <i class="fas fa-chevron-right ad-faq-icon" data-ad-id="${
                ad.id
              }" style="transition: transform 0.3s ease; font-size: 14px;"></i>
              <strong style="font-size: 1.1rem;">${
                ad.wpData && ad.wpData.title
                  ? escapeHtml(ad.wpData.title)
                  : ad.fromGroupName || ad.fromGroup
              }</strong>
              ${aiConfidenceBadge}
              ${websiteBadge}
            </div>
            <div style="display: flex; gap: 15px; align-items: center; font-size: 0.9rem; opacity: 0.95; flex-wrap: wrap;">
              <span><i class="fas fa-users"></i> From: ${
                ad.fromGroupName || ad.fromGroup
              }</span>
              <span><i class="fas fa-clock"></i> ${new Date(
                ad.timestamp
              ).toLocaleString()}</span>
              <span><i class="fas fa-tag"></i> ${ad.status}</span>
              <span style="color: ${catColor}; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 12px;"><i class="fas fa-folder"></i> ${
      ad.category || "None"
    }</span>
            </div>
          </div>
        </div>

        <!-- FAQ-style Content (Collapsible) -->
        <div class="ad-faq-content" data-ad-id="${
          ad.id
        }" style="display: none; margin-top: 15px; padding: 15px; background: #f9f9f9; border-radius: 8px; border-left: 4px solid #667eea;">
          <div style="margin-bottom: 12px;">
            <small style="color: #666;">${ad.fromGroup}</small>
            ${
              ad.aiReason
                ? `<br/><small style="color: #666;">📊 ${ad.aiReason}</small>`
                : ""
            }
          </div>
          
          ${
            ad.imageUrl && typeof ad.imageUrl === "object"
              ? `
          <!-- Image Preview Section -->
          <div style="margin-bottom: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 8px 15px; border-radius: 6px 6px 0 0; font-weight: bold; display: flex; align-items: center; gap: 8px;">
              <i class="fas fa-image"></i>
              <span>🖼️ Ad Image</span>
            </div>
            <div style="padding: 15px; background: white; border: 2px solid #667eea; border-top: none; border-radius: 0 0 6px 6px; display: flex; flex-direction: column; align-items: center; gap: 10px;">
              <img 
                id="ad-preview-img-${ad.id}"
                src="/api/bot/ads/${ad.id}/full-image" 
                alt="Ad Image" 
                style="max-width: 100%; max-height: 250px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); cursor: pointer;"
                onclick="openAdImageFullView('${ad.id}')"
                onerror="this.src='${ad.imageUrl.jpegThumbnail ? `data:image/jpeg;base64,${ad.imageUrl.jpegThumbnail}` : '/images/no-image-placeholder.png'}'"
              />
              <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;">
                <button class="btn btn-sm btn-primary" onclick="openAdImageFullView('${ad.id}')" style="display: flex; align-items: center; gap: 5px;">
                  <i class="fas fa-expand"></i> View Full Image
                </button>
                <button class="btn btn-sm btn-danger" onclick="removeAdImage('${ad.id}')" style="display: flex; align-items: center; gap: 5px;">
                  <i class="fas fa-trash"></i> Remove Image
                </button>
              </div>
              <small style="color: #666;">${ad.imageUrl.mimetype || 'image/jpeg'} • ${ad.imageUrl.width || '?'}x${ad.imageUrl.height || '?'} px</small>
            </div>
          </div>
          `
              : ""
          }
          
          ${
            hasEnhanced
              ? `
          <!-- Enhanced Version Section -->
          <div style="margin-bottom: 20px;">
            <div style="background: #5a67d8; color: white; padding: 8px 15px; border-radius: 6px 6px 0 0; font-weight: bold; display: flex; align-items: center; gap: 8px;">
              <i class="fas fa-sparkles"></i>
              <span>✨ Enhanced Version</span>
            </div>
            <div style="white-space:pre-wrap; padding: 15px; background: #f0f8ff; border: 2px solid #5a67d8; border-top: none; border-radius: 0 0 6px 6px;">
              ${escapeHtml(ad.enhancedText)}
              ${
                ad.isEdited
                  ? '<div style="margin-top:8px;color:#666;font-size:0.85rem;">✏️ Manually edited</div>'
                  : ""
              }
              ${
                ad.improvements && ad.improvements.length > 0
                  ? `
                <div style="margin-top:10px;font-size:0.85rem;color:#555;">
                  <strong>🎯 Improvements:</strong>
                  <ul style="margin:5px 0 0 20px;">${ad.improvements
                    .map((imp) => `<li>${imp}</li>`)
                    .join("")}</ul>
                </div>
              `
                  : ""
              }
            </div>
          </div>
          
          <!-- Original Version Section -->
          <div style="margin-bottom: 20px;">
            <div style="background: #6c757d; color: white; padding: 8px 15px; border-radius: 6px 6px 0 0; font-weight: bold; display: flex; align-items: center; gap: 8px;">
              <i class="fas fa-file-alt"></i>
              <span>📄 Original Version</span>
            </div>
            <div style="white-space:pre-wrap; padding: 15px; background: #f5f5f5; border: 2px solid #6c757d; border-top: none; border-radius: 0 0 6px 6px;">
              ${escapeHtml(ad.text)}
            </div>
          </div>
          `
              : `
          <div style="margin-bottom: 20px;">
            <div style="background: #6c757d; color: white; padding: 8px 15px; border-radius: 6px 6px 0 0; font-weight: bold; display: flex; align-items: center; gap: 8px;">
              <i class="fas fa-file-alt"></i>
              <span>📄 Ad Content</span>
            </div>
            <div style="white-space:pre-wrap; padding: 15px; background: #f5f5f5; border: 2px solid #6c757d; border-top: none; border-radius: 0 0 6px 6px;">
              ${escapeHtml(ad.text)}
            </div>
          </div>
          `
          }

          <!-- WordPress Preview Section -->
          ${
            ad.wpData
              ? `
          <div style="margin-bottom: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px 15px; border-radius: 8px 8px 0 0; font-weight: bold; display: flex; align-items: center; justify-content: space-between;">
              <span><i class="fas fa-globe"></i> 🌐 Auto-Generated WordPress Data</span>
              <span style="font-size: 0.75rem; background: rgba(255,255,255,0.2); padding: 4px 8px; border-radius: 12px;">✅ Ready to Post</span>
            </div>
            <div style="padding: 15px; background: #f8f9fa; border: 2px solid #667eea; border-top: none; border-radius: 0 0 8px 8px;">
              
              <!-- Title -->
              <div style="margin-bottom: 12px;">
                <strong style="color: #667eea; font-size: 0.9rem;">📝 Title:</strong>
                <div style="padding: 8px; background: white; border-radius: 4px; margin-top: 4px; font-size: 0.95rem;">
                  ${escapeHtml(ad.wpData.title || "N/A")}
                </div>
              </div>

              <!-- Content Preview -->
              <div style="margin-bottom: 12px;">
                <strong style="color: #667eea; font-size: 0.9rem;">📄 Content Preview:</strong>
                <div style="padding: 10px; background: white; border-radius: 4px; margin-top: 4px; max-height: 150px; overflow-y: auto; font-size: 0.85rem; line-height: 1.5;">
                  ${
                    ad.wpData.content && typeof ad.wpData.content === "string"
                      ? ad.wpData.content
                          .substring(0, 300)
                          .replace(/<[^>]*>/g, "") + "..."
                      : "N/A"
                  }
                </div>
              </div>

              <!-- Meta Information Grid -->
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 12px;">
                ${
                  ad.wpData.meta
                    ? `
                  ${
                    ad.wpData.meta.parent_catt
                      ? `
                  <div style="background: white; padding: 8px; border-radius: 4px; border-left: 3px solid #667eea;">
                    <div style="font-size: 0.75rem; color: #666; margin-bottom: 2px;">📁 Category</div>
                    <div style="font-weight: bold; color: #333; font-size: 0.9rem;">${escapeHtml(
                      ad.wpData.meta.parent_catt
                    )}</div>
                    ${
                      ad.wpData.meta.sub_catt
                        ? `<div style=\"font-size: 0.8rem; color: #888;\">→ ${escapeHtml(
                            ad.wpData.meta.sub_catt
                          )}</div>`
                        : ""
                    }
                    ${
                      ad.wpData.meta.parent_catt === "طلبات"
                        ? `<div style=\"font-size: 0.75rem; color: #bc6c25; margin-top: 4px;\">🔎 تم تصنيفها كإعلان سلع مستعملة/حراج تلقائياً</div>`
                        : ""
                    }
                  </div>
                  `
                      : ""
                  }
                  
                  ${
                    ad.wpData.meta.price_amount
                      ? `
                  <div style="background: white; padding: 8px; border-radius: 4px; border-left: 3px solid #28a745;">
                    <div style="font-size: 0.75rem; color: #666; margin-bottom: 2px;">💰 Price</div>
                    <div style="font-weight: bold; color: #28a745; font-size: 0.9rem;">${escapeHtml(
                      ad.wpData.meta.price_amount
                    )}</div>
                    ${
                      ad.wpData.meta.price_type
                        ? `<div style="font-size: 0.8rem; color: #888;">${escapeHtml(
                            ad.wpData.meta.price_type
                          )}</div>`
                        : ""
                    }
                  </div>
                  `
                      : ""
                  }
                  
                  ${
                    ad.wpData.meta.arc_space
                      ? `
                  <div style="background: white; padding: 8px; border-radius: 4px; border-left: 3px solid #17a2b8;">
                    <div style="font-size: 0.75rem; color: #666; margin-bottom: 2px;">📏 Space</div>
                    <div style="font-weight: bold; color: #17a2b8; font-size: 0.9rem;">${escapeHtml(
                      ad.wpData.meta.arc_space
                    )} m²</div>
                  </div>
                  `
                      : ""
                  }
                  
                  ${
                    ad.wpData.meta.location || ad.wpData.meta.City
                      ? `
                  <div style="background: white; padding: 8px; border-radius: 4px; border-left: 3px solid #ffc107;">
                    <div style="font-size: 0.75rem; color: #666; margin-bottom: 2px;">📍 Location</div>
                    <div style="font-weight: bold; color: #333; font-size: 0.9rem;">${escapeHtml(
                      ad.wpData.meta.City || ad.wpData.meta.location || "N/A"
                    )}</div>
                    ${
                      ad.wpData.meta.location &&
                      ad.wpData.meta.location !== ad.wpData.meta.City
                        ? `<div style="font-size: 0.8rem; color: #888;">${escapeHtml(
                            ad.wpData.meta.location
                          )}</div>`
                        : ""
                    }
                  </div>
                  `
                      : ""
                  }
                  
                  ${
                    ad.wpData.meta.phone_number
                      ? `
                  <div style="background: white; padding: 8px; border-radius: 4px; border-left: 3px solid #6c757d;">
                    <div style="font-size: 0.75rem; color: #666; margin-bottom: 2px;">📞 Contact</div>
                    <div style="font-weight: bold; color: #333; font-size: 0.9rem;">${escapeHtml(
                      ad.wpData.meta.phone_number
                    )}</div>
                  </div>
                  `
                      : ""
                  }
                  
                  ${
                    ad.wpData.meta.offer_type || ad.wpData.meta.order_type
                      ? `
                  <div style="background: white; padding: 8px; border-radius: 4px; border-left: 3px solid #e83e8c;">
                    <div style="font-size: 0.75rem; color: #666; margin-bottom: 2px;">🏷️ Type</div>
                    <div style="font-weight: bold; color: #e83e8c; font-size: 0.9rem;">${escapeHtml(
                      ad.wpData.meta.offer_type ||
                        ad.wpData.meta.order_type ||
                        "N/A"
                    )}</div>
                  </div>
                  `
                      : ""
                  }
                `
                    : ""
                }
              </div>
            </div>
          </div>
          `
              : ""
          }
        
          ${
            ad.status === "rejected"
              ? `
          <!-- Rejected Ad Info and Actions -->
          <div style="background: #fff3cd; padding: 12px; border-radius: 8px; margin-top: 15px; border-left: 4px solid #ffc107;">
            <div style="margin-bottom: 10px;">
              <strong style="color: #856404;">❌ سبب الرفض / Rejection Reason:</strong>
              <div style="margin-top: 5px; padding: 8px; background: white; border-radius: 4px; color: #333; direction: rtl; text-align: right;">
                ${escapeHtml(ad.rejectionReason || "مرفوض من قبل المستخدم")}
              </div>
              <small style="color: #666; display: block; margin-top: 5px;">
                تم الرفض: ${ad.rejectedAt ? new Date(ad.rejectedAt).toLocaleString("ar-SA") : "N/A"}
              </small>
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <button class="btn btn-sm btn-danger" data-action="move-to-recycle-bin" data-id="${ad.id}" 
                style="background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); border: none;">
                🗑️ نقل إلى سلة المحذوفات / Send to Recycle Bin
              </button>
              <button class="btn btn-sm btn-secondary" data-action="edit-wp" data-id="${ad.id}">
                ✏️ Edit
              </button>
            </div>
          </div>
          `
              : `
          <!-- Normal Ad Actions -->
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:15px;align-items:center;padding-top:15px;border-top:2px solid #e0e0e0;">
            <select class="form-control" data-id="${ad.id}" style="max-width:150px;padding:6px;font-size:0.9rem;">
              <option value="">Set Category</option>
            </select>
            <button class="btn btn-sm btn-primary" data-action="wp-direct" data-id="${ad.id}">🌐 Post to WordPress</button>
            ${
              currentUser && currentUser.role === "admin"
                ? `<button class="btn btn-sm btn-warning" data-action="both" data-id="${ad.id}">🚀 Post & Send</button>`
                : ""
            }
            <button class="btn btn-sm btn-danger" data-action="reject" data-id="${ad.id}">✗ Reject</button>
            <button class="btn btn-sm btn-secondary" data-action="edit-wp" data-id="${ad.id}">✏️ Edit</button>
            <button class="btn btn-sm btn-secondary" data-action="regenerate" data-id="${ad.id}">🔄 Regenerate</button>
          </div>
          `
          }
        </div>
      </div>
    `;

    // Populate category dropdown (only exists for non-rejected ads)
    const catSelect = el.querySelector("select[data-id]");
    if (catSelect) {
      allCategories.forEach((cat) => {
        const opt = document.createElement("option");
        opt.value = cat.name;
        opt.textContent = cat.name;
        opt.style.color = cat.color;
        if (ad.category === cat.name) opt.selected = true;
        catSelect.appendChild(opt);
      });

      // Category change handler
      catSelect.addEventListener("change", async (e) => {
        const id = e.target.getAttribute("data-id");
        const category = e.target.value;
        await updateAdCategory(id, category);
      });
    }

    // FAQ-style dropdown toggle handler
    const faqHeader = el.querySelector(".ad-faq-header");
    const faqContent = el.querySelector(".ad-faq-content");
    const faqIcon = el.querySelector(".ad-faq-icon");

    if (faqHeader && faqContent && faqIcon) {
      faqHeader.addEventListener("click", (e) => {
        const isVisible = faqContent.style.display === "block";

        if (isVisible) {
          // Close
          faqContent.style.display = "none";
          faqIcon.style.transform = "rotate(0deg)";
          faqHeader.style.background = "#5a67d8";
        } else {
          // Open
          faqContent.style.display = "block";
          faqIcon.style.transform = "rotate(90deg)";
          faqHeader.style.background = "#4c51bf";
        }
      });
    }

    // Action buttons handlers
    el.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const action = btn.getAttribute("data-action");
        const id = btn.getAttribute("data-id");
        if (action === "groups-only") await handleAdDetailsGroupsOnly(id, ad);
        if (action === "wp-direct") await handleDirectPostToWordPress(id, ad);
        if (action === "wp-only") await handleAdDetailsWpOnly(id, ad);
        if (action === "edit-wp") await handleAdDetailsWpOnly(id, ad);
        if (action === "both") await handleAdDetailsBoth(id, ad);
        if (action === "reject") openRejectReasonModal(id);
        if (action === "move-to-recycle-bin") await handleMoveToRecycleBin(id);
        if (action === "edit") await handleEditAd(id, ad);
        if (action === "regenerate") await handleRegenerateAd(id);
      });
    });

    adsList.appendChild(el);
  });

  // Add "Load More" button if there are more pages
  if (pagination.hasMore) {
    const loadMoreContainer = document.createElement("div");
    loadMoreContainer.className = "load-more-container";
    loadMoreContainer.style.cssText =
      "text-align: center; padding: 20px; margin-top: 20px;";

    const loadMoreBtn = document.createElement("button");
    loadMoreBtn.className = "btn btn-primary";
    loadMoreBtn.innerHTML = `
      <i class="fas fa-chevron-down"></i> 
      Load More (${pagination.currentPage}/${pagination.totalPages} - Showing ${
      adsList.querySelectorAll(".card").length
    } of ${pagination.totalAds})
    `;
    loadMoreBtn.style.cssText =
      "padding: 12px 30px; font-size: 1rem; border-radius: 8px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; color: white; cursor: pointer; transition: all 0.3s;";

    loadMoreBtn.addEventListener("mouseover", () => {
      loadMoreBtn.style.transform = "translateY(-2px)";
      loadMoreBtn.style.boxShadow = "0 5px 15px rgba(102, 126, 234, 0.4)";
    });

    loadMoreBtn.addEventListener("mouseout", () => {
      loadMoreBtn.style.transform = "translateY(0)";
      loadMoreBtn.style.boxShadow = "none";
    });

    loadMoreBtn.addEventListener("click", async () => {
      loadMoreBtn.disabled = true;
      loadMoreBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Loading...';
      currentAdsPage++;
      await fetchAndRenderAds(false);
      loadMoreBtn.disabled = false;
    });

    loadMoreContainer.appendChild(loadMoreBtn);
    adsList.appendChild(loadMoreContainer);
  } else if (list.length > 0) {
    // Show "End of results" message
    const endMessage = document.createElement("div");
    endMessage.style.cssText =
      "text-align: center; padding: 20px; color: #666; font-style: italic;";
    endMessage.innerHTML = `<i class="fas fa-check-circle"></i> All ads loaded (${pagination.totalAds} total)`;
    adsList.appendChild(endMessage);
  }
}

function escapeHtml(text) {
  // Convert to string and handle null/undefined
  if (text === null || text === undefined) return "";
  // Convert to string if not already
  text = String(text);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Edit Ad Text
async function handleEditAd(id, ad) {
  currentEditAdId = id;
  const currentText = ad.enhancedText || ad.text;

  if (editAdTextarea) {
    editAdTextarea.value = currentText;
  }

  if (editAdModal) {
    editAdModal.style.display = "flex";
  }
}

function closeEditAdModal() {
  if (editAdModal) {
    editAdModal.style.display = "none";
  }
  if (editAdTextarea) {
    editAdTextarea.value = "";
  }
  if (editAdMessage) {
    editAdMessage.style.display = "none";
  }
  currentEditAdId = null;
}

async function handleSaveEditAd() {
  if (!currentEditAdId || !editAdTextarea) return;

  // Get the text without trimming to preserve line breaks and formatting
  const newText = editAdTextarea.value;

  // Only check if completely empty
  if (newText.replace(/\s/g, "") === "") {
    showEditAdMessage("Please enter ad text", "error");
    return;
  }

  try {
    const response = await fetch(`/api/bot/ads/${currentEditAdId}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text: newText }),
    });

    if (response.ok) {
      showEditAdMessage("✅ Ad updated successfully!", "success");
      setTimeout(() => {
        closeEditAdModal();
        fetchAndRenderAds();
      }, 1000);
    } else {
      const data = await response.json();
      showEditAdMessage(data.error || "Failed to update ad", "error");
    }
  } catch (err) {
    console.error("Edit ad error:", err);
    showEditAdMessage("Failed to update ad", "error");
  }
}

function showEditAdMessage(message, type) {
  if (!editAdMessage) return;
  editAdMessage.textContent = message;
  editAdMessage.className =
    type === "error" ? "error-message" : "success-message";
  editAdMessage.style.display = "block";
}

// Accept Options Modal Functions
async function openAcceptOptionsModal(id) {
  if (!acceptOptionsModal) return;
  currentAcceptAdId = id;
  acceptOptionsModal.style.display = "flex";
}

function closeAcceptOptionsModal() {
  if (!acceptOptionsModal) return;
  acceptOptionsModal.style.display = "none";
  currentAcceptAdId = null;
}

// Reject Reason Modal Functions
function openRejectReasonModal(id) {
  if (!rejectReasonModal) return;
  currentRejectAdId = id;
  if (rejectReasonTextarea) rejectReasonTextarea.value = "";
  if (rejectReasonMessage) rejectReasonMessage.style.display = "none";
  rejectReasonModal.style.display = "flex";
}

function closeRejectReasonModal() {
  if (!rejectReasonModal) return;
  rejectReasonModal.style.display = "none";
  currentRejectAdId = null;
  if (rejectReasonTextarea) rejectReasonTextarea.value = "";
}

async function handleConfirmReject() {
  if (!currentRejectAdId) return;
  
  const reason = rejectReasonTextarea ? rejectReasonTextarea.value.trim() : "";
  
  if (!reason) {
    if (rejectReasonMessage) {
      rejectReasonMessage.textContent = "⚠️ Please enter a rejection reason";
      rejectReasonMessage.className = "info-message error";
      rejectReasonMessage.style.display = "block";
    }
    return;
  }
  
  const adId = currentRejectAdId;
  closeRejectReasonModal();
  
  try {
    await updateAdStatus(adId, "rejected", reason);
    showInfo(adsInfo, "✅ Ad rejected successfully!");
    setTimeout(() => hideMessage(adsInfo), 3000);
  } catch (err) {
    console.error("Reject ad error:", err);
    alert("Failed to reject ad");
  }
}

// Move rejected ad to recycle bin
async function handleMoveToRecycleBin(id) {
  if (!confirm("هل أنت متأكد من نقل هذا الإعلان إلى سلة المحذوفات؟\n\nAre you sure you want to move this ad to the recycle bin?")) {
    return;
  }
  
  try {
    const response = await fetch(`/api/bot/ads/${id}/recycle-bin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    
    if (!response.ok) {
      throw new Error("Failed to move ad to recycle bin");
    }
    
    showInfo(adsInfo, "🗑️ تم نقل الإعلان إلى سلة المحذوفات / Ad moved to recycle bin");
    setTimeout(() => hideMessage(adsInfo), 3000);
    fetchAndRenderAds(); // Refresh the ads list
  } catch (err) {
    console.error("Move to recycle bin error:", err);
    alert("فشل نقل الإعلان إلى سلة المحذوفات / Failed to move ad to recycle bin");
  }
}

async function handleAcceptOption(option) {
  if (!currentAcceptAdId) return;

  const adId = currentAcceptAdId;
  closeAcceptOptionsModal();

  try {
    if (option === "groups" || option === "both") {
      // Open resend modal to choose groups
      await openResendModal(adId);

      // If "both", we'll handle WordPress after groups are selected
      // The resend modal's send button will need to know if we should also post to WP
      if (option === "both") {
        // Store flag that we need to post to WP after groups
        sessionStorage.setItem(`sendToWP_${adId}`, "true");
      }
    } else if (option === "wordpress") {
      // Post directly to WordPress
      await postToWordPress(adId);
      // Update ad status to accepted
      await updateAdStatus(adId, "accepted");
    }
  } catch (err) {
    console.error("Accept option error:", err);
    alert("Failed to process accept option");
  }
}

async function postToWordPress(adId) {
  try {
    const response = await fetch(`/api/bot/ads/${adId}/post-to-wordpress`, {
      method: "POST",
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response.json();
      const errorMessage = error.error || "Failed to post to WordPress";
      console.error("WordPress posting error:", errorMessage);
      alert(`❌ فشل نشر الإعلان على WordPress: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    const data = await response.json();

    // Show success message
    alert(
      `✅ تم نشر الإعلان على WordPress بنجاح!\n\nالرابط: ${data.wordpressPost.link}`
    );

    return data; // Return full data including extractedData
  } catch (err) {
    console.error("WordPress posting error:", err);
    // Don't show alert again if we already showed it above
    if (err.message && !err.message.includes("Failed to post to WordPress")) {
      alert(`❌ فشل نشر الإعلان على WordPress: ${err.message}`);
    }
    throw err;
  }
}

async function sendWordPressNotificationToGroups(groups, wpData) {
  try {
    const { wordpressPost, extractedData } = wpData;
    const meta = extractedData.meta || {};

    // Format the WhatsApp message with all available data
    let message = `*${wordpressPost.title}*\n`;

    // Add price if available
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
        // Only add extra price info if it's different and not a duplicate phrase
        if (
          meta.price &&
          meta.price !== meta.price_amount &&
          !meta.price.includes("عند التواصل") &&
          !meta.price.includes("على السوم")
        ) {
          message += ` (${meta.price})`;
        }
      }

      message += `\n`;
    }

    // Add space if available
    if (meta.arc_space || meta.order_space) {
      message += `📏 *المساحة:* ${meta.arc_space || meta.order_space} متر\n`;
    }

    // Add location if available
    if (meta.location || meta.City || meta.before_City) {
      const location = [meta.location, meta.City, meta.before_City]
        .filter(Boolean)
        .join(" - ");
      message += `📍 *الموقع:* ${location}\n`;
    }

    // Add fixed contact phone number (always 0508001475)
    message += `*📲للتواصل:* 0508001475\n`;

    // Add link
    message += `👈للتفاصيل اضغط ع الرابط: ${wordpressPost.link}\n\n`;

    // Add footer
    message += `┈┉━━🔰 *مسعاك العقارية*  🔰━━┅┄\n`;
    message += `⭕إبراء للذمة التواصل فقط مع مسعاك عند الشراء أو إذا عندك مشتري ✅نتعاون مع جميع الوسطاء`;

    // Send to each group individually
    const promises = groups.map((groupId) =>
      fetch("/api/bot/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          number: groupId,
          message: message,
        }),
      })
    );

    await Promise.all(promises);
    return { success: true };
  } catch (err) {
    console.error("Error sending WordPress notification:", err);
    throw err;
  }
}
// -------------------------
// Preview modal helpers
// -------------------------
function openPostPreviewModal(extractedData = {}, adId, selectedGroups = []) {
  const modal = document.getElementById("post-preview-modal");
  if (!modal) return;

  // Populate fields with extractedData (use sensible fallbacks)
  const ed = extractedData || {};
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };

  setVal("preview-wp-title", ed.title || "");
  setVal("preview-wp-content", ed.content || ed.description || "");
  setVal("preview-price-amount", (ed.meta && ed.meta.price_amount) || "");
  setVal("preview-arc-space", (ed.meta && ed.meta.arc_space) || "");
  setVal("preview-location", (ed.meta && ed.meta.location) || "");
  setVal("preview-phone", (ed.meta && ed.meta.phone) || "");
  setVal("preview-parent-catt", (ed.meta && ed.meta.parent_category) || "");
  setVal("preview-sub-catt", (ed.meta && ed.meta.sub_category) || "");

  // Build a preview group message from extracted data
  const groupMsgEl = document.getElementById("preview-group-message");
  if (groupMsgEl) {
    groupMsgEl.value = buildGroupMessageFromFields();
  }

  // store context on modal
  modal.dataset.adId = adId;
  modal.dataset.groups = JSON.stringify(selectedGroups || []);

  // Wire buttons (use onclick to avoid duplicate listeners)
  const postOnlyBtn = document.getElementById("preview-post-only");
  const sendGroupsBtn = document.getElementById("preview-send-groups");
  const postAndSendBtn = document.getElementById("preview-post-and-send");
  const cancelBtn = document.getElementById("preview-cancel");

  if (postOnlyBtn) postOnlyBtn.onclick = handlePreviewPostOnly;
  if (sendGroupsBtn) sendGroupsBtn.onclick = handlePreviewSendGroups;
  if (postAndSendBtn) postAndSendBtn.onclick = handlePreviewPostAndSend;
  if (cancelBtn) cancelBtn.onclick = closePostPreviewModal;

  // Show the modal
  modal.style.display = "block";
}

function closePostPreviewModal() {
  const modal = document.getElementById("post-preview-modal");
  if (!modal) return;
  modal.style.display = "none";
}

function getEditedWpDataFromModal() {
  const getVal = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  };

  const title = getVal("preview-wp-title");
  const content = getVal("preview-wp-content");
  const price_amount = getVal("preview-price-amount");
  const arc_space = getVal("preview-arc-space");
  const location = getVal("preview-location");
  const phone = getVal("preview-phone");
  const parent_category = getVal("preview-parent-catt");
  const sub_category = getVal("preview-sub-catt");
  const group_message = getVal("preview-group-message");

  return {
    title,
    content,
    meta: {
      price_amount,
      arc_space,
      location,
      phone,
      parent_category,
      sub_category,
    },
    _preview_group_message: group_message,
  };
}

function buildGroupMessageFromFields() {
  const title = document.getElementById("preview-wp-title")?.value || "";
  const price = document.getElementById("preview-price-amount")?.value || "";
  const space = document.getElementById("preview-arc-space")?.value || "";
  const location = document.getElementById("preview-location")?.value || "";
  const phone = document.getElementById("preview-phone")?.value || "";

  const parts = [];
  if (title) parts.push(`*${title}*`);
  if (price) parts.push(`💰 ${price}`);
  if (space) parts.push(`📐 ${space}`);
  if (location) parts.push(`📍 ${location}`);
  if (phone) parts.push(`📞 ${phone}`);

  return parts.join(" | ");
}

async function handlePreviewPostOnly() {
  const modal = document.getElementById("post-preview-modal");
  if (!modal) return;
  const adId = modal.dataset.adId;
  const wpData = getEditedWpDataFromModal();

  try {
    const resp = await fetch(`/api/bot/ads/${adId}/post-to-wordpress`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wpData }),
    });

    const json = await resp.json();
    if (!resp.ok) {
      alert(json.error || "Failed to post to WordPress");
      return;
    }

    alert("Posted to WordPress successfully.");
    closePostPreviewModal();
  } catch (err) {
    console.error(err);
    alert("Error posting to WordPress");
  }
}

async function handlePreviewSendGroups() {
  const modal = document.getElementById("post-preview-modal");
  if (!modal) return;
  const adId = modal.dataset.adId;
  const groups = JSON.parse(modal.dataset.groups || "[]");
  const wpData = getEditedWpDataFromModal();

  const extractedLike = {
    title: wpData.title,
    content: wpData.content,
    meta: wpData.meta,
    link: null,
    generated_slug: null,
  };

  try {
    console.log("🚀 [SEND] Starting to send messages to groups:", groups);
    await sendWordPressNotificationToGroups(groups, {
      wordpressPost: { title: extractedLike.title, link: extractedLike.link },
      extractedData: extractedLike,
    });
    console.log("✅ [SEND] Messages sent successfully");

    // Update the ad to mark it as sent
    if (adId) {
      console.log(
        "📝 [UPDATE] Marking ad as sent, adId:",
        adId,
        "groups:",
        groups
      );
      const markResponse = await fetch(`/api/bot/ads/${adId}/mark-sent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ selectedGroups: groups }),
      });
      const markResult = await markResponse.json();
      console.log("✅ [UPDATE] Mark-sent response:", markResult);
    } else {
      console.warn("⚠️ [UPDATE] No adId found, cannot mark as sent");
    }

    alert("Message(s) sent to selected groups.");
    closePostPreviewModal();

    // Reload WhatsApp messages to show updated status
    console.log("🔄 [RELOAD] Current hash:", window.location.hash);
    if (window.location.hash === "#whatsapp-messages") {
      console.log("🔄 [RELOAD] Reloading WhatsApp messages view...");
      await loadWhatsAppMessagesView();
      console.log("✅ [RELOAD] WhatsApp messages view reloaded");
    } else {
      console.log("⚠️ [RELOAD] Not on WhatsApp messages view, skipping reload");
    }
  } catch (err) {
    console.error(err);
    alert("Failed to send messages to groups.");
  }
}

async function handlePreviewPostAndSend() {
  const modal = document.getElementById("post-preview-modal");
  if (!modal) return;
  const adId = modal.dataset.adId;
  const groups = JSON.parse(modal.dataset.groups || "[]");
  const wpData = getEditedWpDataFromModal();

  try {
    const resp = await fetch(`/api/bot/ads/${adId}/post-to-wordpress`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wpData }),
    });

    const json = await resp.json();
    if (!resp.ok) {
      alert(json.error || "Failed to post to WordPress");
      return;
    }

    // Use extractedData returned by server when possible
    const extracted = json.extractedData || {
      title: wpData.title,
      content: wpData.content,
      meta: wpData.meta,
    };

    console.log("🚀 [POST&SEND] Sending messages to groups:", groups);
    await sendWordPressNotificationToGroups(groups, {
      wordpressPost: {
        title: extracted.title,
        link: json.wordpressPost ? json.wordpressPost.link : null,
      },
      extractedData: extracted,
    });
    console.log("✅ [POST&SEND] Messages sent successfully");

    // Update the ad to mark it as sent
    if (adId) {
      console.log(
        "📝 [UPDATE] Marking ad as sent, adId:",
        adId,
        "groups:",
        groups
      );
      const markResponse = await fetch(`/api/bot/ads/${adId}/mark-sent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ selectedGroups: groups }),
      });
      const markResult = await markResponse.json();
      console.log("✅ [UPDATE] Mark-sent response:", markResult);
    } else {
      console.warn("⚠️ [UPDATE] No adId found, cannot mark as sent");
    }

    alert("Posted to WordPress and notified groups successfully.");
    closePostPreviewModal();

    // Reload WhatsApp messages to show updated status
    console.log("🔄 [RELOAD] Current hash:", window.location.hash);
    if (window.location.hash === "#whatsapp-messages") {
      console.log("🔄 [RELOAD] Reloading WhatsApp messages view...");
      await loadWhatsAppMessagesView();
      console.log("✅ [RELOAD] WhatsApp messages view reloaded");
    } else {
      console.log("⚠️ [RELOAD] Not on WhatsApp messages view, skipping reload");
    }
  } catch (err) {
    console.error(err);
    alert("Failed to post and send notifications.");
  }
}

// Regenerate Ad with AI
async function handleRegenerateAd(id) {
  if (
    !confirm(
      "Regenerate this ad with AI? This will replace the current enhanced version."
    )
  )
    return;

  try {
    const response = await fetch(`/api/bot/ads/${id}/regenerate`, {
      method: "POST",
      credentials: "include",
    });

    if (response.ok) {
      const data = await response.json();
      await fetchAndRenderAds();
      alert(
        `✨ Ad regenerated successfully!\n\nImprovements:\n${data.improvements.join(
          "\n"
        )}`
      );
    } else {
      const data = await response.json();
      alert(data.error || "Failed to regenerate ad");
    }
  } catch (err) {
    console.error("Regenerate ad error:", err);
    alert("Failed to regenerate ad");
  }
}

async function updateAdStatus(id, status, reason = null) {
  try {
    const body = { status };
    if (reason) {
      body.reason = reason;
    }
    const response = await fetch(`/api/bot/ads/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Failed");
    fetchAndRenderAds();
  } catch (err) {
    console.error("Update status error:", err);
    showInfo(adsInfo, "Failed to update status");
  }
}

async function updateAdCategory(id, category) {
  try {
    const response = await fetch(`/api/bot/ads/${id}/category`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ category }),
    });
    if (!response.ok) throw new Error("Failed");
    showInfo(adsInfo, "Category updated");
    setTimeout(() => hideMessage(adsInfo), 2000);
  } catch (err) {
    console.error("Update category error:", err);
    showInfo(adsInfo, "Failed to update category");
  }
}

// Modal functions for resend
async function openResendModal(id) {
  currentAdIdForResend = id;
  currentSummaryForSend = null; // Clear any summary data
  hideMessage(modalMessage);
  selectedCustomNumbers = []; // Reset selected custom numbers

  // Fetch groups, collections, and custom numbers
  try {
    groupsList.innerHTML = '<div class="loading">Loading groups...</div>';
    resendModal.style.display = "flex";

    // Reset modal title for regular ad
    const modalTitle = document.querySelector("#resend-modal h2");
    if (modalTitle) {
      modalTitle.textContent = "Resend Ad to Groups";
    }

    const [groupsResp, collectionsResp] = await Promise.all([
      fetch("/api/bot/groups", { credentials: "include" }),
      fetch("/api/bot/collections", { credentials: "include" }),
    ]);

    if (groupsResp.ok) {
      const groupsData = await groupsResp.json();
      allGroups = groupsData.groups || [];
      renderGroupsCheckboxes();
    }

    if (collectionsResp.ok) {
      const collectionsData = await collectionsResp.json();
      allCollections = collectionsData.collections || [];
      renderCollectionsDropdown();
    }

    // Load saved custom numbers
    await loadSavedCustomNumbers();
    renderCustomNumbersList();

    // Reset button handler for regular ad resend
    const confirmBtn = document.getElementById("confirm-resend-btn");
    if (confirmBtn) {
      const newBtn = confirmBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
      newBtn.onclick = confirmResendAd;
    }
  } catch (err) {
    console.error("Error loading modal data:", err);
    groupsList.innerHTML =
      '<div class="error-message">Failed to load groups</div>';
  }
}

function renderGroupsCheckboxes() {
  if (allGroups.length === 0) {
    groupsList.innerHTML = '<div class="info-text">No groups available</div>';
    return;
  }

  groupsList.innerHTML = "";
  allGroups.forEach((group) => {
    const item = document.createElement("div");
    item.className = "group-item";
    item.innerHTML = `
      <input type="checkbox" id="group-${escapeHtml(
        group.jid
      )}" value="${escapeHtml(group.jid)}">
      <label for="group-${escapeHtml(group.jid)}">
        <span class="group-name">${escapeHtml(group.name)}</span>
        <span class="group-id">${escapeHtml(group.jid)}</span>
      </label>
    `;
    groupsList.appendChild(item);
  });
}

function renderCollectionsDropdown() {
  collectionSelect.innerHTML =
    '<option value="">-- Select Collection --</option>';
  allCollections.forEach((col) => {
    const option = document.createElement("option");
    option.value = col.id;
    option.textContent = `${col.name} (${col.groups.length} groups)`;
    collectionSelect.appendChild(option);
  });
}

function handleLoadCollection() {
  const selectedId = collectionSelect.value;
  if (!selectedId) return;

  const collection = allCollections.find((c) => c.id === selectedId);
  if (!collection) return;

  // Uncheck all groups
  groupsList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = false;
  });

  // Check groups in collection
  if (collection.groups && collection.groups.length > 0) {
    collection.groups.forEach((jid) => {
      const checkbox = groupsList.querySelector(`input[value="${jid}"]`);
      if (checkbox) checkbox.checked = true;
    });
  }

  // Load custom numbers from collection
  if (collection.customNumbers && collection.customNumbers.length > 0) {
    selectedCustomNumbers = [...collection.customNumbers];
    renderCustomNumbersList();
  } else {
    selectedCustomNumbers = [];
    renderCustomNumbersList();
  }

  showInfo(modalMessage, `Loaded collection: ${collection.name}`);
}

async function handleSaveCollection() {
  const name = collectionNameInput.value.trim();
  if (!name) {
    showInfo(modalMessage, "Please enter a collection name");
    return;
  }

  const selectedGroups = [];
  groupsList
    .querySelectorAll('input[type="checkbox"]:checked')
    .forEach((cb) => {
      selectedGroups.push(cb.value);
    });

  if (selectedGroups.length === 0 && selectedCustomNumbers.length === 0) {
    showInfo(
      modalMessage,
      "Please select at least one group or add a custom number"
    );
    return;
  }

  try {
    const response = await fetch("/api/bot/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        name,
        groups: selectedGroups,
        customNumbers: selectedCustomNumbers, // Include custom numbers in collection
      }),
    });

    if (response.ok) {
      const data = await response.json();
      allCollections.push(data.collection);
      renderCollectionsDropdown();
      collectionNameInput.value = "";
      showInfo(modalMessage, "Collection saved successfully!");
    } else {
      showInfo(modalMessage, "Failed to save collection");
    }
  } catch (err) {
    console.error("Save collection error:", err);
    showInfo(modalMessage, "Failed to save collection");
  }
}

async function handleConfirmResend() {
  const selectedGroups = [];
  groupsList
    .querySelectorAll('input[type="checkbox"]:checked')
    .forEach((cb) => {
      selectedGroups.push(cb.value);
    });

  if (selectedGroups.length === 0 && selectedCustomNumbers.length === 0) {
    showInfo(
      modalMessage,
      "Please select at least one group or add a custom number"
    );
    return;
  }

  try {
    confirmResendBtn.disabled = true;
    confirmResendBtn.textContent = "Sending...";

    // Prepare preview so user can edit WordPress data and the group message before sending
    try {
      showInfo(modalMessage, "Preparing preview...");
      const previewResp = await fetch(
        `/api/bot/ads/${currentAdIdForResend}/post-to-wordpress`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preview: true }),
        }
      );

      if (!previewResp.ok) {
        const err = await previewResp.json();
        showInfo(modalMessage, err.error || "Failed to prepare preview");
        confirmResendBtn.disabled = false;
        confirmResendBtn.textContent = "Resend to Selected Groups";
        return;
      }

      const previewData = await previewResp.json();
      // Open preview modal allowing the user to edit WP data and the message
      // Pass both groups and custom numbers
      openPostPreviewModal(
        previewData.extractedData,
        currentAdIdForResend,
        selectedGroups,
        selectedCustomNumbers
      );
      // Reset button state (the actual actions are handled from the preview modal)
      confirmResendBtn.disabled = false;
      confirmResendBtn.textContent = "Resend to Selected Groups";
      return;
    } catch (err) {
      console.error("Preview error:", err);
      showInfo(modalMessage, "Failed to prepare preview");
      confirmResendBtn.disabled = false;
      confirmResendBtn.textContent = "Resend to Selected Groups";
      return;
    }

    // Update ad status to accepted
    await updateAdStatus(currentAdIdForResend, "accepted");

    setTimeout(() => {
      closeResendModal();
      fetchAndRenderAds();
    }, 2000);
  } catch (err) {
    console.error("Resend error:", err);
    showInfo(modalMessage, "Failed to resend ad");
    confirmResendBtn.disabled = false;
    confirmResendBtn.textContent = "Resend to Selected Groups";
  }
}

function closeResendModal() {
  resendModal.style.display = "none";
  currentAdIdForResend = null;
  currentSummaryForSend = null; // Clear summary data
  confirmResendBtn.disabled = false;
  confirmResendBtn.textContent = "Resend to Selected Groups";
  hideMessage(modalMessage);

  // Reset modal title
  const modalTitle = document.querySelector("#resend-modal h2");
  if (modalTitle) {
    modalTitle.textContent = "Resend Ad to Groups";
  }
}

// Collections Manager
async function openCollectionsManager() {
  collectionsModal.style.display = "flex";

  try {
    const response = await fetch("/api/bot/collections", {
      credentials: "include",
    });
    if (response.ok) {
      const data = await response.json();
      allCollections = data.collections || [];
      renderCollectionsManager();
    }
  } catch (err) {
    console.error("Error loading collections:", err);
  }
}

function renderCollectionsManager() {
  // Render into modal-specific container so settings and modal do not collide
  const modalList = document.getElementById("collections-modal-list");
  if (!modalList) {
    console.warn("collections-modal-list not found in DOM");
    return;
  }

  if (allCollections.length === 0) {
    modalList.innerHTML =
      '<div class="info-text">No collections saved yet</div>';
    return;
  }

  modalList.innerHTML = "";
  allCollections.forEach((col) => {
    const item = document.createElement("div");
    item.className = "collection-item";
    item.innerHTML = `
      <div class="collection-info">
        <div class="collection-name">${escapeHtml(col.name)}</div>
        <div class="collection-count">${col.groups.length} groups</div>
      </div>
      <div class="collection-actions">
        <button class="btn btn-small btn-danger" data-action="delete" data-id="${
          col.id
        }">Delete</button>
      </div>
    `;

    item
      .querySelector('[data-action="delete"]')
      .addEventListener("click", async () => {
        if (!confirm(`Delete collection "${col.name}"?`)) return;

        try {
          const response = await fetch(`/api/bot/collections/${col.id}`, {
            method: "DELETE",
            credentials: "include",
          });

          if (response.ok) {
            allCollections = allCollections.filter((c) => c.id !== col.id);
            // re-render modal and settings list
            renderCollectionsManager();
            renderCollectionsDropdown();
            renderCollectionsInSettings();
          }
        } catch (err) {
          console.error("Delete collection error:", err);
        }
      });

    modalList.appendChild(item);
  });
}

function closeCollectionsManager() {
  collectionsModal.style.display = "none";
}

// Load categories
async function loadCategories() {
  try {
    const response = await fetch("/api/bot/categories", {
      credentials: "include",
    });
    if (response.ok) {
      const data = await response.json();
      allCategories = data.categories || [];
      updateCategoryFilter();
    }
  } catch (err) {
    console.error("Error loading categories:", err);
  }
}

function updateCategoryFilter() {
  categoryFilter.innerHTML =
    '<option value="all">All Categories</option><option value="uncategorized">Uncategorized</option>';
  allCategories.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat.name;
    opt.textContent = cat.name;
    opt.style.color = cat.color;
    categoryFilter.appendChild(opt);
  });
}

// Categories Manager
async function openCategoriesManager() {
  categoriesModal.style.display = "flex";
  hideMessage(categoriesMessage);

  try {
    const response = await fetch("/api/bot/categories", {
      credentials: "include",
    });
    if (response.ok) {
      const data = await response.json();
      allCategories = data.categories || [];
      renderCategoriesManager();
    }
  } catch (err) {
    console.error("Error loading categories:", err);
  }
}

function renderCategoriesManager() {
  if (allCategories.length === 0) {
    categoriesList.innerHTML = '<div class="info-text">No categories yet</div>';
    return;
  }

  categoriesList.innerHTML = "";
  allCategories.forEach((cat) => {
    const item = document.createElement("div");
    item.className = "collection-item";
    item.innerHTML = `
      <div class="collection-info">
        <div class="collection-name" style="color:${cat.color};">● ${escapeHtml(
      cat.name
    )}</div>
      </div>
      <div class="collection-actions">
        <button class="btn btn-small btn-danger" data-action="delete" data-id="${
          cat.id
        }">Delete</button>
      </div>
    `;

    item
      .querySelector('[data-action="delete"]')
      .addEventListener("click", async () => {
        if (!confirm(`Delete category "${cat.name}"?`)) return;

        try {
          const response = await fetch(`/api/bot/categories/${cat.id}`, {
            method: "DELETE",
            credentials: "include",
          });

          if (response.ok) {
            allCategories = allCategories.filter((c) => c.id !== cat.id);
            renderCategoriesManager();
            updateCategoryFilter();
            showInfo(categoriesMessage, "Category deleted");
          }
        } catch (err) {
          console.error("Delete category error:", err);
          showInfo(categoriesMessage, "Failed to delete");
        }
      });

    categoriesList.appendChild(item);
  });
}

async function handleAddCategory() {
  const name = newCategoryNameInput.value.trim();
  const color = newCategoryColorInput.value;

  if (!name) {
    showInfo(categoriesMessage, "Please enter a category name");
    return;
  }

  try {
    const response = await fetch("/api/bot/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, color }),
    });

    if (response.ok) {
      const data = await response.json();
      allCategories.push(data.category);
      renderCategoriesManager();
      updateCategoryFilter();
      newCategoryNameInput.value = "";
      newCategoryColorInput.value = "#9b59b6";
      showInfo(categoriesMessage, "Category added!");
    } else {
      showInfo(categoriesMessage, "Failed to add category");
    }
  } catch (err) {
    console.error("Add category error:", err);
    showInfo(categoriesMessage, "Failed to add category");
  }
}

// Add Category from View Page
async function handleAddCategoryFromView() {
  const nameInput = document.getElementById("new-category-name-view");
  const colorInput = document.getElementById("new-category-color-view");
  const messageEl = document.getElementById("categories-view-message");

  if (!nameInput || !colorInput) return;

  const name = nameInput.value.trim();
  const color = colorInput.value;

  if (!name) {
    showMessage(
      "categories-view-message",
      "Please enter a category name",
      "error"
    );
    return;
  }

  try {
    const response = await fetch("/api/bot/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, color }),
    });

    if (response.ok) {
      const data = await response.json();
      allCategories.push(data.category);
      await loadCategoriesView();
      await loadCategories(); // Update filter dropdown
      nameInput.value = "";
      colorInput.value = "#9b59b6";
      showMessage(
        "categories-view-message",
        "Category added successfully!",
        "success"
      );
    } else {
      showMessage("categories-view-message", "Failed to add category", "error");
    }
  } catch (err) {
    console.error("Add category error:", err);
    showMessage("categories-view-message", "Failed to add category", "error");
  }
}

function closeCategoriesManager() {
  categoriesModal.style.display = "none";
}

// ========== CUSTOM PHONE NUMBERS FUNCTIONS ==========

// Load saved custom numbers from server
async function loadSavedCustomNumbers() {
  console.log("🔄 Loading saved custom numbers from server...");
  try {
    const response = await fetch("/api/bot/custom-numbers", {
      credentials: "include",
    });
    console.log("📡 Load response status:", response.status);

    if (response.ok) {
      const data = await response.json();
      savedCustomNumbers = data.numbers || [];
      console.log(
        "✅ Loaded saved custom numbers:",
        savedCustomNumbers.length,
        savedCustomNumbers
      );
      window.savedCustomNumbers = savedCustomNumbers; // Ensure global access
      updateSavedNumbersDropdown();
    } else {
      console.warn("⚠️ Failed to load saved numbers, status:", response.status);
    }
  } catch (err) {
    console.error("❌ Load custom numbers error:", err);
  }
}

// Update the dropdown with saved numbers
function updateSavedNumbersDropdown() {
  if (!savedNumbersSelect) return;

  savedNumbersSelect.innerHTML =
    '<option value="">-- Select Saved Number --</option>';
  savedCustomNumbers.forEach((num) => {
    const option = document.createElement("option");
    option.value = JSON.stringify(num);
    option.textContent = `${num.name} (${num.phone})`;
    savedNumbersSelect.appendChild(option);
  });
}

// Handle loading a saved number into the list
function handleLoadSavedNumber(e) {
  const value = e.target.value;
  if (!value) return;

  try {
    const number = JSON.parse(value);
    // Add to selected list if not already there
    if (!selectedCustomNumbers.find((n) => n.phone === number.phone)) {
      selectedCustomNumbers.push(number);
      renderCustomNumbersList();
    }
    savedNumbersSelect.value = "";
  } catch (err) {
    console.error("Load saved number error:", err);
  }
}

// Handle adding custom number to current selection
function handleAddCustomNumberToList() {
  const name = customNumberNameInput.value.trim();
  const phone = customNumberPhoneInput.value.trim();

  if (!name || !phone) {
    alert("Please enter both name and phone number");
    return;
  }

  // Basic phone validation (numbers only, optionally starting with +)
  if (!/^\+?\d+$/.test(phone)) {
    alert(
      "Please enter a valid phone number (digits only, optionally starting with +)"
    );
    return;
  }

  // Add to selection
  const number = { name, phone };
  if (!selectedCustomNumbers.find((n) => n.phone === phone)) {
    selectedCustomNumbers.push(number);
    renderCustomNumbersList();
  }

  // Clear inputs
  customNumberNameInput.value = "";
  customNumberPhoneInput.value = "";
}

// Render the list of selected custom numbers
function renderCustomNumbersList() {
  if (!customNumbersList) return;

  if (selectedCustomNumbers.length === 0) {
    customNumbersList.innerHTML =
      '<div style="padding:10px;color:#666;">No custom numbers added yet</div>';
    return;
  }

  customNumbersList.innerHTML = "";
  selectedCustomNumbers.forEach((number, index) => {
    const item = document.createElement("label");
    item.className = "group-checkbox-label";
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.justifyContent = "space-between";
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <i class="fas fa-phone" style="color:#28a745;"></i>
        <span style="font-weight:500;">${escapeHtml(number.name)}</span>
        <span style="color:#666;font-size:0.9rem;">(${escapeHtml(
          number.phone
        )})</span>
      </div>
      <button class="btn btn-small btn-danger" onclick="removeCustomNumber(${index})" style="padding:4px 8px;">
        <i class="fas fa-times"></i>
      </button>
    `;
    customNumbersList.appendChild(item);
  });
}

// Remove custom number from selection
function removeCustomNumber(index) {
  selectedCustomNumbers.splice(index, 1);
  renderCustomNumbersList();
}

// Open manage custom numbers modal
function openCustomNumbersManager() {
  customNumbersModal.style.display = "flex";
  renderSavedCustomNumbersList();
}

// Close manage custom numbers modal
function closeCustomNumbersManager() {
  customNumbersModal.style.display = "none";
  manageCustomNumberNameInput.value = "";
  manageCustomNumberPhoneInput.value = "";
}

// Render saved custom numbers in manage modal
function renderSavedCustomNumbersList() {
  if (!savedCustomNumbersList) return;

  if (savedCustomNumbers.length === 0) {
    savedCustomNumbersList.innerHTML =
      '<div style="padding:15px;color:#666;text-align:center;">No saved custom numbers yet</div>';
    return;
  }

  savedCustomNumbersList.innerHTML = "";
  savedCustomNumbers.forEach((number) => {
    const item = document.createElement("div");
    item.className = "collection-item";
    item.style.display = "flex";
    item.style.justifyContent = "space-between";
    item.style.alignItems = "center";
    item.style.padding = "12px";
    item.style.marginBottom = "8px";
    item.style.background = "#f9f9f9";
    item.style.borderRadius = "6px";
    item.style.border = "1px solid #e0e0e0";

    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <i class="fas fa-phone" style="color:#28a745;font-size:1.2rem;"></i>
        <div>
          <div style="font-weight:600;color:#333;">${escapeHtml(
            number.name
          )}</div>
          <div style="color:#666;font-size:0.9rem;">${escapeHtml(
            number.phone
          )}</div>
        </div>
      </div>
      <button class="btn btn-small btn-danger" onclick="handleDeleteCustomNumber('${escapeHtml(
        number.phone
      )}')" style="padding:6px 12px;">
        <i class="fas fa-trash"></i> Delete
      </button>
    `;
    savedCustomNumbersList.appendChild(item);
  });
}

// Handle saving a new custom number permanently
async function handleSaveCustomNumber() {
  const name = manageCustomNumberNameInput.value.trim();
  const phone = manageCustomNumberPhoneInput.value.trim();

  if (!name || !phone) {
    showInfo(customNumbersMessage, "Please enter both name and phone number");
    return;
  }

  // Basic phone validation
  if (!/^\+?\d+$/.test(phone)) {
    showInfo(customNumbersMessage, "Please enter a valid phone number");
    return;
  }

  // Check if already exists
  if (savedCustomNumbers.find((n) => n.phone === phone)) {
    showInfo(customNumbersMessage, "This phone number is already saved");
    return;
  }

  try {
    const response = await fetch("/api/bot/custom-numbers", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone }),
    });

    if (response.ok) {
      const data = await response.json();
      savedCustomNumbers = data.numbers || [];
      updateSavedNumbersDropdown();
      renderSavedCustomNumbersList();
      manageCustomNumberNameInput.value = "";
      manageCustomNumberPhoneInput.value = "";
      showInfo(customNumbersMessage, "Custom number saved successfully");
    } else {
      const error = await response.json();
      showInfo(
        customNumbersMessage,
        error.error || "Failed to save custom number"
      );
    }
  } catch (err) {
    console.error("Save custom number error:", err);
    showInfo(customNumbersMessage, "Failed to save custom number");
  }
}

// Handle deleting a saved custom number
async function handleDeleteCustomNumber(phone) {
  if (!confirm("Are you sure you want to delete this custom number?")) {
    return;
  }

  try {
    const response = await fetch("/api/bot/custom-numbers", {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });

    if (response.ok) {
      const data = await response.json();
      savedCustomNumbers = data.numbers || [];
      updateSavedNumbersDropdown();
      renderSavedCustomNumbersList();
      showInfo(customNumbersMessage, "Custom number deleted successfully");
    } else {
      const error = await response.json();
      showInfo(
        customNumbersMessage,
        error.error || "Failed to delete custom number"
      );
    }
  } catch (err) {
    console.error("Delete custom number error:", err);
    showInfo(customNumbersMessage, "Failed to delete custom number");
  }
}

// ========== END CUSTOM PHONE NUMBERS FUNCTIONS ==========

// ========== GROUPS PREVIEW MODAL CUSTOM NUMBERS ==========

// Handle adding custom number in groups preview modal
async function handleGroupsPreviewAddCustomNumber() {
  const name = groupsPreviewCustomNumberNameInput.value.trim();
  const phone = groupsPreviewCustomNumberPhoneInput.value.trim();

  if (!name || !phone) {
    alert("⚠️ Please enter both name and phone number");
    return;
  }

  // Basic phone validation
  if (!/^\+?\d+$/.test(phone)) {
    alert(
      "⚠️ Please enter a valid phone number (digits only, optionally starting with +)"
    );
    return;
  }

  // Check if already exists in selection
  if (selectedCustomNumbers.find((n) => n.phone === phone)) {
    alert("⚠️ This phone number is already added");
    return;
  }

  // Add to selection
  const number = { name, phone };
  selectedCustomNumbers.push(number);

  // Auto-save to server for future use (silently, ignore if already exists)
  console.log("💾 Attempting to save custom number:", number);
  try {
    const response = await fetch("/api/bot/custom-numbers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(number),
    });

    console.log("📡 Save response status:", response.status);

    if (response.ok) {
      // Update saved numbers list
      await loadSavedCustomNumbers();
      renderGroupsPreviewCustomNumbersList();

      // Show success message briefly
      const successMsg = document.createElement("div");
      successMsg.style.cssText =
        "position:fixed;top:20px;right:20px;background:#4CAF50;color:white;padding:15px 25px;border-radius:8px;z-index:10000;font-weight:bold;box-shadow:0 4px 8px rgba(0,0,0,0.2);";
      successMsg.innerHTML =
        '<i class="fas fa-check-circle"></i> Number added & saved!';
      document.body.appendChild(successMsg);
      setTimeout(() => successMsg.remove(), 2000);
      console.log("✅ Number saved successfully");
    } else {
      // If 400 error (already exists), just render without showing error
      const errorData = await response.json().catch(() => ({}));
      console.log(
        "⚠️ Save failed with status",
        response.status,
        "Error:",
        errorData
      );

      if (
        response.status === 400 &&
        errorData.error &&
        errorData.error.includes("already exists")
      ) {
        // Number already saved, silently continue
        console.log("ℹ️ Number already exists in database, skipping save");
        await loadSavedCustomNumbers();
      } else if (response.status === 400) {
        console.warn("⚠️ Validation error:", errorData.error);
      }
      renderGroupsPreviewCustomNumbersList();
    }
  } catch (err) {
    console.error("❌ Auto-save custom number error:", err);
    // Still add to selection even if save fails
    renderGroupsPreviewCustomNumbersList();
  }

  // Clear inputs
  groupsPreviewCustomNumberNameInput.value = "";
  groupsPreviewCustomNumberPhoneInput.value = "";

  // Focus back on name input for easy multiple additions
  groupsPreviewCustomNumberNameInput.focus();
}

// Render custom numbers list in groups preview modal
function renderGroupsPreviewCustomNumbersList() {
  if (!groupsPreviewCustomNumbersList) return;

  if (selectedCustomNumbers.length === 0) {
    groupsPreviewCustomNumbersList.innerHTML =
      '<div style="padding:20px;color:#999;text-align:center;font-style:italic;"><i class="fas fa-phone-slash"></i> No custom numbers added yet</div>';
    return;
  }

  groupsPreviewCustomNumbersList.innerHTML = "";

  // Add a header for manually added numbers
  const header = document.createElement("div");
  header.style.cssText =
    "background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px; border-radius: 8px; margin-bottom: 10px; font-weight: bold;";
  header.innerHTML =
    '<i class="fas fa-user-plus"></i> 📝 Recently Added Numbers';
  groupsPreviewCustomNumbersList.appendChild(header);

  selectedCustomNumbers.forEach((number, index) => {
    const item = document.createElement("div");
    item.className = "group-item custom-number-item";
    item.style.cssText =
      "background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 6px; margin-bottom: 8px; transition: transform 0.2s;";

    const numberId = `manual-custom-${escapeHtml(number.phone)}-${index}`;

    item.innerHTML = `
      <input type="checkbox" 
             class="custom-number-checkbox"
             id="${numberId}" 
             value="${escapeHtml(number.phone)}"
             data-name="${escapeHtml(number.name)}"
             checked>
      <label for="${numberId}" style="color: white; font-weight: 500; padding: 12px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <i class="fas fa-user-circle" style="font-size: 20px;"></i>
          <div>
            <div style="font-weight: 600;">${escapeHtml(number.name)}</div>
            <div style="font-size: 0.85em; opacity: 0.9;"><i class="fas fa-phone"></i> ${escapeHtml(
              number.phone
            )}</div>
          </div>
        </div>
        <button class="btn btn-small" onclick="event.preventDefault(); event.stopPropagation(); removeGroupsPreviewCustomNumber(${index})" 
          style="background:rgba(255,255,255,0.2);border:2px solid white;color:white;padding:6px 12px;font-weight:bold;transition:all 0.2s;margin-left:10px;"
          onmouseover="this.style.background='rgba(255,255,255,0.3)'"
          onmouseout="this.style.background='rgba(255,255,255,0.2)'">
          <i class="fas fa-times"></i>
        </button>
      </label>
    `;
    groupsPreviewCustomNumbersList.appendChild(item);
  });
}

// Remove custom number from groups preview modal
function removeGroupsPreviewCustomNumber(index) {
  selectedCustomNumbers.splice(index, 1);
  renderGroupsPreviewCustomNumbersList();
}

// ========== END GROUPS PREVIEW MODAL CUSTOM NUMBERS ==========

// Expose global functions for inline onclick handlers
window.removeCustomNumber = removeCustomNumber;
window.handleDeleteCustomNumber = handleDeleteCustomNumber;
window.removeGroupsPreviewCustomNumber = removeGroupsPreviewCustomNumber;

// Disconnect bot handler (admin only)
async function handleDisconnect() {
  if (!confirm("Are you sure you want to disconnect the bot?")) {
    return;
  }

  try {
    const response = await fetch("/api/bot/disconnect", {
      method: "POST",
      credentials: "include",
    });

    const data = await response.json();

    if (response.ok) {
      showInfo(adminMessage, "Bot disconnected successfully");
      checkBotStatus();
    } else {
      showError(adminMessage, data.error || "Failed to disconnect bot");
    }
  } catch (error) {
    console.error("Disconnect error:", error);
    showError(adminMessage, "An error occurred. Please try again.");
  }
}

// UI Helper Functions
function showLogin() {
  loginPage.classList.add("active");
  dashboardPage.classList.remove("active");
  loginForm.reset();
  hideMessage(loginError);
}

function showDashboard() {
  loginPage.classList.remove("active");
  dashboardPage.classList.add("active");

  if (currentUser) {
    userInfo.textContent = `${currentUser.username} (${currentUser.role})`;
    if (userInfoAds) {
      userInfoAds.textContent = `${currentUser.username} (${currentUser.role})`;
    }

    // Show admin controls only for admin
    if (currentUser.role === "admin") {
      if (adminControls) adminControls.style.display = "block";

      // Show admin-only menu items
      const adminOnlyItems = document.querySelectorAll(".admin-only");
      adminOnlyItems.forEach((item) => {
        item.style.display = "flex";
      });
    } else {
      if (adminControls) adminControls.style.display = "none";

      // Hide admin-only menu items
      const adminOnlyItems = document.querySelectorAll(".admin-only");
      adminOnlyItems.forEach((item) => {
        item.style.display = "none";
      });
    }

    // Update user profile in sidebar
    const sidebarUserInfo = document.getElementById("sidebar-user-info");
    if (sidebarUserInfo) {
      sidebarUserInfo.textContent = `${currentUser.username} (${currentUser.role})`;
    }
  }

  checkBotStatus();
  loadCategories(); // Load categories for filters

  // Initialize with home view first (faster)
  switchView("home");

  // Load initial data only once
  if (!initialDataLoaded) {
    loadInitialData();
  }
}

// Load all initial data on first dashboard load
async function loadInitialData() {
  console.log("🔄 Loading initial data...");

  try {
    // Load analytics (non-blocking)
    setTimeout(() => {
      loadAnalytics();
    }, 100);

    // Load groups in the background
    setTimeout(async () => {
      try {
        console.log("📡 Fetching groups...");
        const response = await fetch("/api/bot/groups", {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          allGroups = data.groups || [];
          console.log(`✅ Loaded ${allGroups.length} groups`);

          // Update any group-related UI if needed
          if (typeof updateGroupsUI === "function") {
            updateGroupsUI();
          }
        }
      } catch (error) {
        console.error("Error loading groups:", error);
      }
    }, 500);

    // Load collections
    setTimeout(async () => {
      try {
        const response = await fetch("/api/bot/collections", {
          credentials: "include",
        });

        if (response.ok) {
          const data = await response.json();
          allCollections = data.collections || [];
          console.log(`✅ Loaded ${allCollections.length} collections`);
        }
      } catch (error) {
        console.error("Error loading collections:", error);
      }
    }, 700);

    // Mark as loaded to prevent re-loading
    initialDataLoaded = true;
    console.log("✅ Initial data loading complete");
  } catch (error) {
    console.error("Error in loadInitialData:", error);
  }
}

function startStatusChecking() {
  // Check status immediately
  checkBotStatus();

  // Then check every 5 seconds
  statusCheckInterval = setInterval(checkBotStatus, 5000);
}

function stopStatusChecking() {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
    statusCheckInterval = null;
  }
}

function showError(element, message) {
  element.textContent = message;
  element.classList.add("show");
}

function showSuccess(element, message) {
  element.textContent = message;
  element.classList.add("show");
}

function showInfo(element, message) {
  element.textContent = message;
  element.classList.add("show");
}

function hideMessage(element) {
  element.classList.remove("show");
  element.textContent = "";
}

// Show message by ID
function showMessage(elementId, message, type = "info") {
  const element = document.getElementById(elementId);
  if (!element) return;

  element.textContent = message;
  element.className =
    type === "success"
      ? "success-message show"
      : type === "error"
      ? "error-message show"
      : "info-message show";
  element.style.display = "block";

  setTimeout(() => {
    element.style.display = "none";
    element.classList.remove("show");
  }, 3000);
}

// ============ Recycle Bin Functions ============
// Global state for better UX
window.RECYCLE_BIN_SETTINGS = { recycleBinDays: 7 };
window.recycleBinState = {
  items: [],
  filtered: [],
  query: "",
  group: "all",
  conf: "all", // all | high | medium | low
  sort: "recent",
  compact: true,
  selected: new Set(),
  listenersBound: false,
};

async function loadRecycleBinView() {
  try {
    console.log("🗑️ Loading recycle bin...");

    // Fetch items and settings
    const [itemsRes, settingsRes] = await Promise.all([
      fetch("/api/bot/recycle-bin"),
      fetch("/api/bot/settings"),
    ]);

    console.log("🗑️ Recycle bin response status:", itemsRes.status);

    if (!itemsRes.ok) throw new Error("Failed to fetch recycle bin");

    const itemsData = await itemsRes.json();
    console.log("🗑️ Recycle bin data received:", itemsData);

    const items = itemsData.items || [];
    console.log("🗑️ Total items in recycle bin:", items.length);

    recycleBinState.items = items;

    if (settingsRes.ok) {
      const settingsData = await settingsRes.json();
      window.RECYCLE_BIN_SETTINGS.recycleBinDays =
        settingsData.settings.recycleBinDays || 7;
      const daysDisplay = document.getElementById("recycle-days-display");
      if (daysDisplay) {
        daysDisplay.textContent = window.RECYCLE_BIN_SETTINGS.recycleBinDays;
      }
    }

    // Populate group filter
    populateRecycleGroupFilter(items);
    // Apply filters and render
    applyRecycleFilters();
    // Bind listeners once
    bindRecycleToolbarListeners();
  } catch (error) {
    console.error("Error loading recycle bin:", error);
    showMessage("recycle-bin-message", "Failed to load recycle bin", "error");
  }
}

function renderRecycleBin(items) {
  console.log("🎨 Rendering recycle bin with", items.length, "items");

  const container = document.getElementById("recycle-bin-list");
  if (!container) {
    console.error("🎨 ❌ recycle-bin-list container not found!");
    return;
  }

  console.log("🎨 Container found:", container);

  container.classList.add("rb-list");
  container.classList.toggle("rb-compact", !!recycleBinState.compact);

  if (items.length === 0) {
    console.log("🎨 No items to display, showing empty state");
    container.innerHTML = `
      <div style="text-align: center; padding: 3rem; background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); border-radius: 12px; margin: 2rem 0;">
        <i class="fas fa-trash-alt" style="font-size: 4rem; color: #95a5a6; margin-bottom: 1rem;"></i>
        <h3 style="color: #7f8c8d; margin: 0;">Recycle Bin is Empty</h3>
        <p style="color: #95a5a6; margin: 0.5rem 0 0 0;">No rejected messages found</p>
      </div>
    `;
    return;
  }

  console.log("🎨 Generating HTML for items...");

  try {
    const htmlContent = items
      .map((item) => {
        try {
          const date = new Date(item.rejectedAt);
          const daysAgo = Math.max(
            0,
            Math.floor((Date.now() - item.rejectedAt) / (1000 * 60 * 60 * 24))
          );

          // Calculate urgency color based on days remaining using settings
          const daysRemaining =
            window.RECYCLE_BIN_SETTINGS.recycleBinDays - daysAgo;
          let urgencyColor = "#28a745"; // green
          let urgencyIcon = "fa-check-circle";
          if (daysRemaining <= 2) {
            urgencyColor = "#dc3545"; // red
            urgencyIcon = "fa-exclamation-triangle";
          } else if (daysRemaining <= 4) {
            urgencyColor = "#ffc107"; // yellow
            urgencyIcon = "fa-clock";
          }

          return `
        <div class="ad-card" data-id="${item.id}">
          <div class="ad-header">
            <div class="rb-meta" style="justify-content: space-between;">
              <div class="rb-meta">
                <label>
                  <input type="checkbox" class="recycle-select" data-id="${
                    item.id
                  }" ${recycleBinState.selected.has(item.id) ? "checked" : ""}>
                </label>
                <span style="font-weight:600;">
                  <i class="fas fa-users"></i> ${
                    item.fromGroupName || "Unknown Group"
                  }
                </span>
                <span style="opacity:0.9;font-size:0.9rem;">
                  <i class="fas fa-calendar-alt"></i> ${date.toLocaleDateString()} · ${timeAgo(
            date
          )}
                </span>
                <span style="opacity:0.9;font-size:0.9rem;">
                  <i class="fas fa-clock"></i> ${date.toLocaleTimeString()}
                </span>
              </div>
              <div class="ad-actions">
                <button class="btn btn-success btn-sm" onclick="handleRestoreFromRecycleBin('${
                  item.id
                }')" 
                        >
                  <i class="fas fa-undo"></i> Restore
                </button>
                <button class="btn btn-danger btn-sm" onclick="handleDeleteFromRecycleBin('${
                  item.id
                }')" 
                        >
                  <i class="fas fa-trash"></i> Delete
                </button>
              </div>
            </div>
          </div>
          
          <div class="ad-content">
            <div class="rb-badges" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
              <span class="badge" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
                <i class="fas fa-chart-line"></i> AI Confidence: ${
                  item.aiConfidence
                }%
              </span>
              <span class="badge" style="background: ${urgencyColor}; color: #fff;">
                <i class="fas ${urgencyIcon}"></i> ${daysAgo} days ago
              </span>
              <span class="badge" style="background: #eef2f7; color: #333;">
                <i class="fas fa-hourglass-half"></i> ${daysRemaining} days left
              </span>
            </div>
            
            <div class="rb-reason">
              <div style="color: #666; font-size: 0.85rem; margin-bottom: 0.5rem; font-weight: 600;">
                <i class="fas fa-info-circle"></i> Rejection Reason:
              </div>
              <div style="color: #495057; font-size: 0.95rem;">
                ${escapeHtml(item.aiReason)}
              </div>
            </div>
            
            <div class="rb-message">
              <div style="color:#6c757d;font-size:0.85rem;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">
                <i class="fas fa-align-left"></i> Original Message:
              </div>
              <div class="ad-text" style="color:#212529;line-height:1.55;white-space:pre-wrap;font-size:0.98rem;">
                ${escapeHtml(
                  recycleBinState.compact
                    ? truncateText(item.text, 220)
                    : item.text
                )}
              </div>
            </div>
            
            ${
              !recycleBinState.compact && item.enhancedText
                ? `
              <div class="rb-enhanced">
                <div style="color: #8b4513; font-size: 0.85rem; margin-bottom: 0.5rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                  <i class="fas fa-sparkles"></i> AI Enhanced Version:
                </div>
                <div class="ad-text" style="color: #5d4037; line-height: 1.6; white-space: pre-wrap; font-size: 1rem;">
                  ${escapeHtml(item.enhancedText)}
                </div>
              </div>
            `
                : ""
            }
          </div>
        </div>
      `;
        } catch (itemError) {
          console.error("🎨 ❌ Error rendering item:", item.id, itemError);
          return ""; // Skip this item
        }
      })
      .join("");

    container.innerHTML = htmlContent;

    console.log(
      "🎨 HTML generated, length:",
      container.innerHTML.length,
      "characters"
    );
    console.log(
      "🎨 Number of .ad-card elements:",
      container.querySelectorAll(".ad-card").length
    );
  } catch (error) {
    console.error("🎨 ❌ Fatal error during rendering:", error);
    container.innerHTML =
      '<div style="color: red; padding: 20px;">Error rendering recycle bin items. Check console for details.</div>';
    return;
  }

  // Bind selection checkboxes
  container.querySelectorAll(".recycle-select").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-id");
      toggleSelectItem(id, e.target.checked);
    });
  });

  console.log("🎨 ✅ Render complete! Checkboxes bound.");

  // Debug: Check if DOM is still intact after a short delay
  setTimeout(() => {
    console.log("🎨 🔍 DOM Check after 100ms:");
    console.log("🎨 Container innerHTML length:", container.innerHTML.length);
    console.log(
      "🎨 Container display:",
      window.getComputedStyle(container).display
    );
    console.log(
      "🎨 Container visibility:",
      window.getComputedStyle(container).visibility
    );
    console.log(
      "🎨 Number of .ad-card elements:",
      container.querySelectorAll(".ad-card").length
    );

    // Check if cards are visible
    const cards = container.querySelectorAll(".ad-card");
    cards.forEach((card, idx) => {
      const style = window.getComputedStyle(card);
      console.log(
        `🎨 Card ${idx} - display: ${style.display}, visibility: ${style.visibility}, height: ${style.height}`
      );
    });
  }, 100);
}

function populateRecycleGroupFilter(items) {
  const select = document.getElementById("recycle-group-filter");
  if (!select) return;
  const groups = Array.from(
    new Set(items.map((i) => i.fromGroupName || "Unknown Group"))
  ).sort((a, b) => a.localeCompare(b));
  const current = select.value;
  // Reset options
  select.innerHTML =
    '<option value="all">All Groups</option>' +
    groups
      .map(
        (g) => `<option value="${escapeHtmlAttr(g)}">${escapeHtml(g)}</option>`
      )
      .join("");
  // Restore previous selection if exists
  if (["all", ...groups].includes(current)) {
    select.value = current;
  }
}

function bindRecycleToolbarListeners() {
  if (recycleBinState.listenersBound) return;
  recycleBinState.listenersBound = true;
  const search = document.getElementById("recycle-search-input");
  const groupSel = document.getElementById("recycle-group-filter");
  const confSel = document.getElementById("recycle-conf-filter");
  const sortSel = document.getElementById("recycle-sort-select");
  const compactBtn = document.getElementById("recycle-compact-toggle");
  const selectAll = document.getElementById("recycle-select-all");
  const bulkRestore = document.getElementById("recycle-bulk-restore");
  const bulkDelete = document.getElementById("recycle-bulk-delete");

  if (search) search.addEventListener("input", handleRecycleSearchInput);
  if (groupSel) groupSel.addEventListener("change", handleRecycleFilterChange);
  if (confSel) confSel.addEventListener("change", handleRecycleFilterChange);
  if (sortSel) sortSel.addEventListener("change", handleRecycleSortChange);
  if (compactBtn)
    compactBtn.addEventListener("click", () => {
      recycleBinState.compact = !recycleBinState.compact;
      applyRecycleFilters();
    });
  if (selectAll)
    selectAll.addEventListener("change", (e) =>
      toggleSelectAll(e.target.checked)
    );
  if (bulkRestore) bulkRestore.addEventListener("click", bulkRestoreSelected);
  if (bulkDelete) bulkDelete.addEventListener("click", bulkDeleteSelected);
}

function handleRecycleSearchInput(e) {
  recycleBinState.query = (e.target.value || "").toLowerCase();
  applyRecycleFilters();
}

function handleRecycleFilterChange() {
  const groupSel = document.getElementById("recycle-group-filter");
  const confSel = document.getElementById("recycle-conf-filter");
  recycleBinState.group = groupSel ? groupSel.value : "all";
  recycleBinState.conf = confSel ? confSel.value : "all";
  applyRecycleFilters();
}

function handleRecycleSortChange() {
  const sortSel = document.getElementById("recycle-sort-select");
  recycleBinState.sort = sortSel ? sortSel.value : "recent";
  applyRecycleFilters();
}

function applyRecycleFilters() {
  const { items, query, group, conf, sort } = recycleBinState;
  console.log("🔍 Applying recycle filters to", items.length, "items");
  console.log("🔍 Filters:", { query, group, conf, sort });

  let list = items.slice();

  // Text search across text, reason, group
  if (query) {
    list = list.filter((i) => {
      const g = (i.fromGroupName || "Unknown Group").toLowerCase();
      return (
        (i.text || "").toLowerCase().includes(query) ||
        (i.aiReason || "").toLowerCase().includes(query) ||
        g.includes(query)
      );
    });
    console.log("🔍 After text search:", list.length, "items");
  }

  // Group filter
  if (group && group !== "all") {
    list = list.filter((i) => (i.fromGroupName || "Unknown Group") === group);
    console.log("🔍 After group filter:", list.length, "items");
  }

  // Confidence filter
  if (conf !== "all") {
    list = list.filter((i) => {
      const c = Number(i.aiConfidence || 0);
      if (conf === "high") return c >= 80;
      if (conf === "medium") return c >= 50 && c < 80;
      if (conf === "low") return c < 50;
      return true;
    });
    console.log("🔍 After confidence filter:", list.length, "items");
  }

  // Sort
  list.sort((a, b) => {
    if (sort === "recent") return (b.rejectedAt || 0) - (a.rejectedAt || 0);
    if (sort === "oldest") return (a.rejectedAt || 0) - (b.rejectedAt || 0);
    if (sort === "confidence-desc")
      return (b.aiConfidence || 0) - (a.aiConfidence || 0);
    if (sort === "confidence-asc")
      return (a.aiConfidence || 0) - (b.aiConfidence || 0);
    return 0;
  });

  console.log("🔍 Final filtered list:", list.length, "items");
  recycleBinState.filtered = list;
  renderRecycleBin(list);
  updateBulkButtons();
}

function toggleSelectItem(id, checked) {
  if (checked) recycleBinState.selected.add(id);
  else recycleBinState.selected.delete(id);
  updateBulkButtons();
}

function toggleSelectAll(checked) {
  if (checked) {
    recycleBinState.filtered.forEach((i) => recycleBinState.selected.add(i.id));
  } else {
    recycleBinState.selected.clear();
  }
  renderRecycleBin(recycleBinState.filtered);
  updateBulkButtons();
}

function updateBulkButtons() {
  const count = recycleBinState.selected.size;
  const bulkRestore = document.getElementById("recycle-bulk-restore");
  const bulkDelete = document.getElementById("recycle-bulk-delete");
  const selectedCount = document.getElementById("recycle-selected-count");
  const selectAll = document.getElementById("recycle-select-all");
  if (bulkRestore) bulkRestore.disabled = count === 0;
  if (bulkDelete) bulkDelete.disabled = count === 0;
  if (selectedCount) selectedCount.textContent = `${count} selected`;
  if (selectAll) {
    const allSelected =
      recycleBinState.filtered.length > 0 &&
      recycleBinState.filtered.every((i) => recycleBinState.selected.has(i.id));
    selectAll.checked = allSelected;
    selectAll.indeterminate = count > 0 && !allSelected;
  }
}

async function bulkRestoreSelected() {
  if (recycleBinState.selected.size === 0) return;
  if (!confirm(`Restore ${recycleBinState.selected.size} selected message(s)?`))
    return;
  const ids = Array.from(recycleBinState.selected);
  for (const id of ids) {
    try {
      const res = await fetch(`/api/bot/recycle-bin/${id}/restore`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("restore failed");
      recycleBinState.selected.delete(id);
    } catch (e) {
      console.error("Bulk restore error for", id, e);
    }
  }
  showMessage("recycle-bin-message", "Selected messages restored", "success");
  await loadRecycleBinView();
}

async function bulkDeleteSelected() {
  if (recycleBinState.selected.size === 0) return;
  if (
    !confirm(
      `Permanently delete ${recycleBinState.selected.size} selected message(s)? This cannot be undone!`
    )
  )
    return;
  const ids = Array.from(recycleBinState.selected);
  for (const id of ids) {
    try {
      const res = await fetch(`/api/bot/recycle-bin/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      recycleBinState.selected.delete(id);
    } catch (e) {
      console.error("Bulk delete error for", id, e);
    }
  }
  showMessage("recycle-bin-message", "Selected messages deleted", "success");
  await loadRecycleBinView();
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const intervals = [
    { unit: "year", secs: 31536000 },
    { unit: "month", secs: 2592000 },
    { unit: "week", secs: 604800 },
    { unit: "day", secs: 86400 },
    { unit: "hour", secs: 3600 },
    { unit: "minute", secs: 60 },
  ];
  for (const { unit, secs } of intervals) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) return rtf.format(-count, unit);
  }
  return rtf.format(0, "minute");
}

function truncateText(text, maxLen) {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

function escapeHtmlAttr(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function handleRestoreFromRecycleBin(id) {
  if (!confirm("Are you sure you want to restore this message to ads?")) return;

  try {
    const response = await fetch(`/api/bot/recycle-bin/${id}/restore`, {
      method: "POST",
    });

    if (!response.ok) throw new Error("Failed to restore item");

    showMessage(
      "recycle-bin-message",
      "Message restored successfully!",
      "success"
    );
    loadRecycleBinView(); // Refresh the list
  } catch (error) {
    console.error("Error restoring item:", error);
    showMessage("recycle-bin-message", "Failed to restore message", "error");
  }
}

async function handleDeleteFromRecycleBin(id) {
  if (!confirm("Are you sure you want to permanently delete this message?"))
    return;

  try {
    const response = await fetch(`/api/bot/recycle-bin/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) throw new Error("Failed to delete item");

    showMessage(
      "recycle-bin-message",
      "Message deleted permanently",
      "success"
    );
    loadRecycleBinView(); // Refresh the list
  } catch (error) {
    console.error("Error deleting item:", error);
    showMessage("recycle-bin-message", "Failed to delete message", "error");
  }
}

async function handleEmptyRecycleBin() {
  if (
    !confirm(
      "Are you sure you want to permanently delete ALL messages in the recycle bin? This cannot be undone!"
    )
  )
    return;

  try {
    const response = await fetch("/api/bot/recycle-bin", {
      method: "DELETE",
    });

    if (!response.ok) throw new Error("Failed to empty recycle bin");

    showMessage(
      "recycle-bin-message",
      "Recycle bin emptied successfully",
      "success"
    );
    loadRecycleBinView(); // Refresh the list
  } catch (error) {
    console.error("Error emptying recycle bin:", error);
    showMessage("recycle-bin-message", "Failed to empty recycle bin", "error");
  }
}

// ============ Settings Functions ============

async function loadSettingsView() {
  try {
    const response = await fetch("/api/bot/settings");
    if (!response.ok) throw new Error("Failed to fetch settings");

    const data = await response.json();
    const input = document.getElementById("recycle-bin-days-input");
    if (input) {
      input.value = data.settings.recycleBinDays || 7;
    }

    // Load excluded groups into global variable
    currentExcludedGroups = data.settings.excludedGroups || [];

    // Check API keys status and show alert if needed
    await checkApiKeysStatus();

    // Load WordPress settings
    const wpUrl = document.getElementById("wp-url");
    const wpUsername = document.getElementById("wp-username");
    const wpPassword = document.getElementById("wp-password");
    const autoApproveToggle = document.getElementById("auto-approve-wp-toggle");

    if (wpUrl) wpUrl.value = data.settings.wordpressUrl || "https://masaak.com";
    if (wpUsername) wpUsername.value = data.settings.wordpressUsername || "";
    if (wpPassword) wpPassword.value = data.settings.wordpressPassword || "";
    if (autoApproveToggle) {
      autoApproveToggle.checked = data.settings.autoApproveWordPress || false;
      // Add event listener for the toggle
      autoApproveToggle.addEventListener("change", async (e) => {
        await updateAutoApproveWordPress(e.target.checked);
      });
    }

    // Load API keys
    renderApiKeys(data.settings.geminiApiKeys || []);

    // Load category limits
    renderCategoryLimits(data.settings.categoryLimits || []);

    // Load WhatsApp message footers
    const hasakFooterInput = document.getElementById("hasak-footer");
    const masaakFooterInput = document.getElementById("masaak-footer");
    
    // Default footers
    const defaultHasakFooter = `┈┉━🔰 *منصة 🌴حساك* 🔰━┅┄
*✅إنضم في منصة حساك* 
https://chat.whatsapp.com/Ge3nhVs0MFT0ILuqDmuGYd?mode=ems_copy_t
 *✅للإعلانات في منصة حساك* 
0507667103`;
    
    const defaultMasaakFooter = `┈┉━━🔰 *مسعاك العقارية* 🔰━━┅┄
⭕ إبراء للذمة التواصل فقط مع مسعاك عند الشراء أو إذا عندك مشتري ✅ نتعاون مع جميع الوسطاء`;
    
    if (hasakFooterInput) {
      hasakFooterInput.value = data.settings.hasakFooter || defaultHasakFooter;
    }
    if (masaakFooterInput) {
      masaakFooterInput.value = data.settings.masaakFooter || defaultMasaakFooter;
    }
    
    // Add reset footers button handler
    const resetFootersBtn = document.getElementById("reset-footers-btn");
    if (resetFootersBtn) {
      resetFootersBtn.onclick = () => {
        if (confirm("Reset footers to default values?")) {
          if (hasakFooterInput) hasakFooterInput.value = defaultHasakFooter;
          if (masaakFooterInput) masaakFooterInput.value = defaultMasaakFooter;
          showMessage("settings-message", "Footers reset to defaults. Click 'Save All Settings' to apply.", "success");
        }
      };
    }

    // Fetch and load collections
    try {
      const collectionsResp = await fetch("/api/bot/collections", {
        credentials: "include",
      });
      if (collectionsResp.ok) {
        const collectionsData = await collectionsResp.json();
        allCollections = collectionsData.collections || [];
        console.log(
          `✅ Loaded ${allCollections.length} collections in Settings`
        );
      }
    } catch (err) {
      console.error("Error loading collections:", err);
    }

    // Load collections and categories
    renderCollectionsInSettings();
    renderCategoriesInSettings();

    // Wire up collection/category management buttons
    setupCollectionsManagementListeners();
    setupCategoriesManagementListeners();
  } catch (error) {
    console.error("Error loading settings:", error);
    showMessage("settings-message", "Failed to load settings", "error");
  }
}

async function checkApiKeysStatus() {
  try {
    const response = await fetch("/api/bot/api-keys/status");
    if (!response.ok) return;

    const data = await response.json();
    const alertBanner = document.getElementById("api-keys-alert");
    const alertMessage = document.getElementById("api-keys-alert-message");
    const statusDetails = document.getElementById("api-keys-status-details");

    if (!alertBanner) return;

    if (data.status.allExhausted && data.status.totalKeys > 0) {
      // All keys are exhausted - show critical alert
      alertMessage.innerHTML = `
        <strong>⚠️ Critical: All ${data.status.totalKeys} API keys have reached their quota limits!</strong><br>
        The system is now using fallback keyword detection with reduced accuracy. 
        Please add new API keys immediately to restore full functionality.
      `;

      statusDetails.innerHTML = data.status.details
        .map((key) => {
          const lastError = key.lastError
            ? new Date(key.lastError.timestamp).toLocaleString()
            : "N/A";
          return `<div style="padding: 0.25rem 0;"><strong>${escapeHtml(
            key.name
          )}:</strong> ${
            key.requestCount
          } requests, Last error: ${lastError}</div>`;
        })
        .join("");

      alertBanner.style.display = "block";
    } else if (data.status.exhaustedKeys > 0) {
      // Some keys exhausted - show warning
      alertMessage.innerHTML = `
        <strong>⚠️ Warning: ${data.status.exhaustedKeys} out of ${data.status.totalKeys} API keys have reached their limits.</strong><br>
        ${data.status.workingKeys} key(s) still working. Consider adding more API keys for better reliability.
      `;

      statusDetails.innerHTML = data.status.details
        .filter((k) => k.isExhausted)
        .map((key) => {
          const lastError = key.lastError
            ? new Date(key.lastError.timestamp).toLocaleString()
            : "N/A";
          return `<div style="padding: 0.25rem 0;"><strong>${escapeHtml(
            key.name
          )}:</strong> Exhausted at ${lastError}</div>`;
        })
        .join("");

      alertBanner.style.backgroundColor = "#fff3cd";
      alertBanner.style.borderColor = "#ffc107";
      alertBanner.querySelector(".fa-exclamation-triangle").style.color =
        "#ff9800";
      alertBanner.querySelector("h3").style.color = "#856404";
      alertBanner.style.display = "block";
    } else {
      // All keys working fine
      alertBanner.style.display = "none";
    }
  } catch (error) {
    console.error("Error checking API keys status:", error);
  }
}

async function checkAndShowApiKeysNotification() {
  try {
    const response = await fetch("/api/bot/api-keys/status");
    if (!response.ok) return;

    const data = await response.json();
    const settingsNavItem = document.querySelector(
      '.nav-item[data-view="settings"]'
    );

    if (!settingsNavItem) return;

    // Remove existing badge if any
    const existingBadge = settingsNavItem.querySelector(".api-alert-badge");
    if (existingBadge) {
      existingBadge.remove();
    }

    // Add badge if there are exhausted keys
    if (data.status.exhaustedKeys > 0) {
      const badge = document.createElement("span");
      badge.className = "api-alert-badge";
      badge.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background: ${data.status.allExhausted ? "#f44" : "#ff9800"};
        color: white;
        border-radius: 50%;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
      `;
      badge.textContent = "!";
      badge.title = data.status.allExhausted
        ? "All API keys exhausted!"
        : `${data.status.exhaustedKeys} API key(s) exhausted`;

      settingsNavItem.style.position = "relative";
      settingsNavItem.appendChild(badge);
    }
  } catch (error) {
    console.error("Error checking API keys notification:", error);
  }
}

// Add dismiss button handler
document.addEventListener("DOMContentLoaded", () => {
  const dismissBtn = document.getElementById("dismiss-api-alert");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      const alertBanner = document.getElementById("api-keys-alert");
      if (alertBanner) {
        alertBanner.style.display = "none";
      }
    });
  }
});

function renderApiKeys(apiKeys) {
  const container = document.getElementById("api-keys-list");
  if (!container) return;

  if (apiKeys.length === 0) {
    container.innerHTML =
      '<p style="color: #999;">No API keys configured yet.</p>';
    return;
  }

  container.innerHTML = apiKeys
    .sort((a, b) => a.priority - b.priority)
    .map(
      (key, index) => `
      <div class="api-key-item" draggable="true" data-key-id="${key.id}" 
           style="background: #f9f9f9; padding: 1rem; border-radius: 8px; margin-bottom: 0.5rem; cursor: move; border: 2px solid #ddd;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
              <span style="font-size: 1.2rem; cursor: grab;">☰</span>
              <strong>${escapeHtml(key.name)}</strong>
              <span class="badge" style="background: ${
                key.enabled ? "#28a745" : "#dc3545"
              };">
                ${key.enabled ? "Enabled" : "Disabled"}
              </span>
              <span class="badge" style="background: #17a2b8;">Priority: ${
                key.priority
              }</span>
            </div>
            <div style="font-family: monospace; font-size: 0.85rem; color: #666;">
              ${key.key.substring(0, 20)}...${key.key.substring(
        key.key.length - 4
      )}
            </div>
            <div style="font-size: 0.85rem; color: #999; margin-top: 0.5rem;">
              Requests: ${key.requestCount || 0}
              ${
                key.lastError
                  ? `| Last Error: ${new Date(
                      key.lastError.timestamp
                    ).toLocaleString()}`
                  : ""
              }
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-sm ${
              key.enabled ? "btn-secondary" : "btn-success"
            }" 
                    onclick="toggleApiKey('${key.id}', ${!key.enabled})">
              <i class="fas fa-${key.enabled ? "ban" : "check"}"></i>
              ${key.enabled ? "Disable" : "Enable"}
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteApiKey('${
              key.id
            }')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `
    )
    .join("");

  // Add drag and drop event listeners
  const items = container.querySelectorAll(".api-key-item");
  items.forEach((item) => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragend", handleDragEnd);
  });
}

let draggedElement = null;

function handleDragStart(e) {
  draggedElement = this;
  this.style.opacity = "0.5";
  e.dataTransfer.effectAllowed = "move";
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = "move";
  return false;
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  if (draggedElement !== this) {
    // Swap elements
    const allItems = [...document.querySelectorAll(".api-key-item")];
    const draggedIndex = allItems.indexOf(draggedElement);
    const targetIndex = allItems.indexOf(this);

    if (draggedIndex < targetIndex) {
      this.parentNode.insertBefore(draggedElement, this.nextSibling);
    } else {
      this.parentNode.insertBefore(draggedElement, this);
    }

    // Update priorities
    updateApiKeyPriorities();
  }

  return false;
}

function handleDragEnd(e) {
  this.style.opacity = "1";

  const items = document.querySelectorAll(".api-key-item");
  items.forEach((item) => {
    item.style.border = "2px solid #ddd";
  });
}

async function updateApiKeyPriorities() {
  const items = document.querySelectorAll(".api-key-item");
  const response = await fetch("/api/bot/settings");
  const data = await response.json();
  const apiKeys = data.settings.geminiApiKeys || [];

  items.forEach((item, index) => {
    const keyId = item.getAttribute("data-key-id");
    const key = apiKeys.find((k) => k.id === keyId);
    if (key) {
      key.priority = index + 1;
    }
  });

  // Save updated priorities
  await fetch("/api/bot/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geminiApiKeys: apiKeys }),
  });

  showMessage("settings-message", "Priorities updated!", "success");
}

async function handleSaveApiKey() {
  const nameInput = document.getElementById("api-key-name");
  const valueInput = document.getElementById("api-key-value");

  const name = nameInput.value.trim();
  const key = valueInput.value.trim();

  if (!name || !key) {
    showMessage(
      "settings-message",
      "Please provide both name and API key",
      "error"
    );
    return;
  }

  try {
    const response = await fetch("/api/bot/settings");
    const data = await response.json();
    const apiKeys = data.settings.geminiApiKeys || [];

    const newKey = {
      id: `key_${Date.now()}`,
      name: name,
      key: key,
      priority: apiKeys.length + 1,
      enabled: true,
      requestCount: 0,
      lastError: null,
    };

    apiKeys.push(newKey);

    const saveResponse = await fetch("/api/bot/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geminiApiKeys: apiKeys }),
    });

    if (!saveResponse.ok) throw new Error("Failed to save API key");

    showMessage("settings-message", "API key added successfully!", "success");
    nameInput.value = "";
    valueInput.value = "";
    document.getElementById("api-key-form").style.display = "none";

    loadSettingsView(); // Reload to show new key
  } catch (error) {
    console.error("Error saving API key:", error);
    showMessage("settings-message", "Failed to save API key", "error");
  }
}

async function toggleApiKey(keyId, enabled) {
  try {
    const response = await fetch("/api/bot/settings");
    const data = await response.json();
    const apiKeys = data.settings.geminiApiKeys || [];

    const key = apiKeys.find((k) => k.id === keyId);
    if (key) {
      key.enabled = enabled;
    }

    const saveResponse = await fetch("/api/bot/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geminiApiKeys: apiKeys }),
    });

    if (!saveResponse.ok) throw new Error("Failed to update API key");

    showMessage(
      "settings-message",
      `API key ${enabled ? "enabled" : "disabled"}!`,
      "success"
    );
    loadSettingsView(); // Reload
  } catch (error) {
    console.error("Error toggling API key:", error);
    showMessage("settings-message", "Failed to update API key", "error");
  }
}

async function deleteApiKey(keyId) {
  if (!confirm("Are you sure you want to delete this API key?")) return;

  try {
    const response = await fetch("/api/bot/settings");
    const data = await response.json();
    let apiKeys = data.settings.geminiApiKeys || [];

    apiKeys = apiKeys.filter((k) => k.id !== keyId);

    const saveResponse = await fetch("/api/bot/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geminiApiKeys: apiKeys }),
    });

    if (!saveResponse.ok) throw new Error("Failed to delete API key");

    showMessage("settings-message", "API key deleted successfully!", "success");
    loadSettingsView(); // Reload
  } catch (error) {
    console.error("Error deleting API key:", error);
    showMessage("settings-message", "Failed to delete API key", "error");
  }
}

// ============ Category Limits Management ============

function renderCategoryLimits(categoryLimits) {
  const container = document.getElementById("category-limits-list");
  if (!container) return;

  if (categoryLimits.length === 0) {
    container.innerHTML =
      '<p style="color: #999;">No category limits configured. Click "Add Category Limit" to add one.</p>';
  } else {
    container.innerHTML = categoryLimits
      .map(
        (limit, index) => `
        <div class="category-limit-item" style="background: #f9f9f9; padding: 1rem; border-radius: 8px; margin-bottom: 0.5rem; border: 2px solid ${
          limit.enabled ? "#28a745" : "#6c757d"
        };">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas fa-ban" style="color: ${
                  limit.enabled ? "#dc3545" : "#999"
                };"></i>
                <strong>${escapeHtml(limit.category)}</strong>
                <span class="badge" style="background: ${
                  limit.enabled ? "#dc3545" : "#6c757d"
                };">
                  Max: ${limit.maxAds} ads/day
                </span>
                <span class="badge" style="background: ${
                  limit.enabled ? "#28a745" : "#6c757d"
                };">
                  ${limit.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <label style="display: flex; align-items: center; gap: 0.3rem; margin: 0; cursor: pointer;">
                <input type="checkbox" ${limit.enabled ? "checked" : ""} 
                       onchange="toggleCategoryLimit(${index}, this.checked)"
                       style="cursor: pointer;">
                <span style="font-size: 0.85rem;">Enable</span>
              </label>
              <input type="number" value="${limit.maxAds}" min="1" 
                     onblur="updateCategoryLimitMax(${index}, this.value)"
                     onkeypress="if(event.key==='Enter') this.blur()"
                     style="width: 80px; padding: 0.3rem; border: 1px solid #ddd; border-radius: 4px;"
                     title="Press Enter or click away to save">
              <button class="btn btn-sm btn-danger" onclick="deleteCategoryLimit(${index})">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `
      )
      .join("");
  }

  // Setup "Add Category Limit" button
  const addBtn = document.getElementById("add-category-limit-btn");
  if (addBtn) {
    addBtn.onclick = showAddCategoryLimitModal;
  }
}

function showAddCategoryLimitModal() {
  const category = prompt("Enter category name (e.g., أرض, شقة, فيلا):");
  if (!category || !category.trim()) return;

  const maxAds = prompt(
    "Enter maximum number of ads per day for this category:",
    "50"
  );
  if (!maxAds || isNaN(maxAds) || parseInt(maxAds) < 1) {
    alert("Please enter a valid number greater than 0");
    return;
  }

  addCategoryLimit(category.trim(), parseInt(maxAds));
}

async function addCategoryLimit(category, maxAds) {
  try {
    const response = await fetch("/api/bot/settings");
    const data = await response.json();
    let categoryLimits = data.settings.categoryLimits || [];

    // Check if category already exists
    if (categoryLimits.some((limit) => limit.category === category)) {
      alert(`Category "${category}" already has a limit configured!`);
      return;
    }

    categoryLimits.push({
      category,
      maxAds,
      enabled: true,
    });

    const saveResponse = await fetch("/api/bot/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryLimits }),
      credentials: "include",
    });

    if (!saveResponse.ok) {
      const errorData = await saveResponse.json();
      throw new Error(errorData.error || "Failed to add category limit");
    }

    alert(
      `✅ Category limit added for "${category}" (Max: ${maxAds} ads/day)!`
    );
    await loadSettingsView(); // Reload to show new limit
  } catch (error) {
    console.error("Error adding category limit:", error);
    alert(`❌ Failed to add category limit: ${error.message}`);
  }
}

async function toggleCategoryLimit(index, enabled) {
  try {
    const response = await fetch("/api/bot/settings");
    const data = await response.json();
    let categoryLimits = data.settings.categoryLimits || [];

    if (categoryLimits[index]) {
      const category = categoryLimits[index].category;
      categoryLimits[index].enabled = enabled;

      const saveResponse = await fetch("/api/bot/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryLimits }),
        credentials: "include",
      });

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json();
        throw new Error(errorData.error || "Failed to update category limit");
      }

      alert(
        `✅ "${category}" limit ${enabled ? "✔️ enabled" : "❌ disabled"}!`
      );

      // Update the display inline without full reload
      const limitItems = document.querySelectorAll(".category-limit-item");
      if (limitItems[index]) {
        const item = limitItems[index];
        // Update border color
        item.style.border = `2px solid ${enabled ? "#28a745" : "#6c757d"}`;
        // Update icon color
        const icon = item.querySelector(".fa-ban");
        if (icon) icon.style.color = enabled ? "#dc3545" : "#999";
        // Update badges
        const badges = item.querySelectorAll(".badge");
        if (badges[0])
          badges[0].style.background = enabled ? "#dc3545" : "#6c757d";
        if (badges[1]) {
          badges[1].style.background = enabled ? "#28a745" : "#6c757d";
          badges[1].textContent = enabled ? "Enabled" : "Disabled";
        }
      }
    }
  } catch (error) {
    console.error("Error toggling category limit:", error);
    alert(`❌ Failed to update category limit: ${error.message}`);
    await loadSettingsView(); // Only reload on error
  }
}

async function updateCategoryLimitMax(index, maxAds) {
  const max = parseInt(maxAds);
  if (isNaN(max) || max < 1) {
    alert("⚠️ Please enter a valid number greater than 0");
    return;
  }

  try {
    const response = await fetch("/api/bot/settings");
    const data = await response.json();
    let categoryLimits = data.settings.categoryLimits || [];

    if (categoryLimits[index]) {
      const category = categoryLimits[index].category;
      const oldMax = categoryLimits[index].maxAds;

      // Don't update if value hasn't changed
      if (oldMax === max) return;

      categoryLimits[index].maxAds = max;

      const saveResponse = await fetch("/api/bot/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryLimits }),
        credentials: "include",
      });

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json();
        throw new Error(errorData.error || "Failed to update category limit");
      }

      alert(`✅ Updated "${category}" daily limit: ${oldMax} → ${max} ads/day`);

      // Update the badge display inline without reloading entire view
      const badges = document.querySelectorAll(".category-limit-item .badge");
      if (badges[index * 2]) {
        // First badge of this limit
        badges[index * 2].textContent = `Max: ${max} ads/day`;
      }
    }
  } catch (error) {
    console.error("Error updating category limit:", error);
    alert(`❌ Failed to update category limit: ${error.message}`);
    await loadSettingsView(); // Only reload on error to reset the value
  }
}

async function deleteCategoryLimit(index) {
  if (!confirm("Are you sure you want to delete this category limit?")) return;

  try {
    const response = await fetch("/api/bot/settings");
    const data = await response.json();
    let categoryLimits = data.settings.categoryLimits || [];

    const deletedCategory = categoryLimits[index].category;
    categoryLimits.splice(index, 1);

    const saveResponse = await fetch("/api/bot/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryLimits }),
      credentials: "include",
    });

    if (!saveResponse.ok) {
      const errorData = await saveResponse.json();
      throw new Error(errorData.error || "Failed to delete category limit");
    }

    alert(`✅ Category limit for "${deletedCategory}" deleted!`);
    await loadSettingsView(); // Reload to show updated list
  } catch (error) {
    console.error("Error deleting category limit:", error);
    alert(`❌ Failed to delete category limit: ${error.message}`);
  }
}

// ============ Collections Management in Settings ============

function renderCollectionsInSettings() {
  const container = document.getElementById("collections-list");
  if (!container) return;

  if (!allCollections || allCollections.length === 0) {
    container.innerHTML =
      '<p style="color: #999;">No collections created yet. Click "Create New Collection" to get started.</p>';
    return;
  }

  container.innerHTML = allCollections
    .map(
      (collection) => `
    <div class="collection-item" style="background: #f9f9f9; padding: 1rem; border-radius: 8px; margin-bottom: 0.5rem; border: 2px solid #ddd;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
            <i class="fas fa-folder" style="color: #667eea;"></i>
            <strong>${escapeHtml(collection.name)}</strong>
            <span class="badge" style="background: #17a2b8;">${
              collection.groups ? collection.groups.length : 0
            } groups</span>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-sm btn-primary" onclick="editCollectionInSettings('${
            collection.id
          }')">
            <i class="fas fa-edit"></i> Edit
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteCollectionFromSettings('${
            collection.id
          }')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  `
    )
    .join("");
}

async function editCollectionInSettings(collectionId) {
  const collection = allCollections.find((c) => c.id === collectionId);
  if (!collection) return;

  // Show collection form
  const form = document.getElementById("collection-form");
  const formTitle = document.getElementById("collection-form-title");
  const nameInput = document.getElementById("collection-name-input");

  if (form) form.style.display = "block";
  if (formTitle) formTitle.textContent = "Edit Collection";
  if (nameInput) nameInput.value = collection.name;

  // Load groups and pre-select the ones in this collection
  try {
    console.log("📝 Loading groups for editing collection:", collection.name);
    const response = await fetch("/api/bot/groups", { credentials: "include" });

    console.log("📝 Groups API response status:", response.status);

    if (response.ok) {
      const data = await response.json();
      allGroups = data.groups || [];

      console.log("📝 Loaded groups count:", allGroups.length);

      const groupsList = document.getElementById("collection-groups-list");
      if (groupsList) {
        if (allGroups.length === 0) {
          groupsList.innerHTML =
            '<p style="color: #999; padding: 15px; text-align: center;">No WhatsApp groups found. Please make sure your WhatsApp bot is connected and has joined some groups.</p>';
        } else {
          // Sort groups: most recent first (reverse order to match WhatsApp)
          const sortedGroups = [...allGroups].reverse();

          // Separate communities and groups
          const communities = sortedGroups.filter(
            (g) => g.isCommunity || g.type === "Community"
          );
          const regularGroups = sortedGroups.filter(
            (g) => !g.isCommunity && g.type !== "Community"
          );

          let groupsHTML = "";

          // Render communities first
          if (communities.length > 0) {
            groupsHTML +=
              '<div style="background: #f0f8ff; padding: 8px; margin-bottom: 5px; font-weight: bold; border-radius: 4px;">📢 Communities</div>';
            groupsHTML += communities
              .map(
                (group) => `
              <div class="group-item" style="padding: 8px; border-bottom: 1px solid #eee; padding-left: 20px;">
                <input type="checkbox" id="coll-group-${escapeHtml(
                  group.jid
                )}" value="${escapeHtml(group.jid)}"
                  ${
                    collection.groups && collection.groups.includes(group.jid)
                      ? "checked"
                      : ""
                  }>
                <label for="coll-group-${escapeHtml(
                  group.jid
                )}" style="margin-left: 8px; cursor: pointer;">
                  📢 ${escapeHtml(group.name)}
                </label>
              </div>
            `
              )
              .join("");
          }

          // Render regular groups
          if (regularGroups.length > 0) {
            groupsHTML +=
              '<div style="background: #f0fff0; padding: 8px; margin: 5px 0; font-weight: bold; border-radius: 4px;">👥 Groups</div>';
            groupsHTML += regularGroups
              .map(
                (group) => `
              <div class="group-item" style="padding: 8px; border-bottom: 1px solid #eee; padding-left: 20px;">
                <input type="checkbox" id="coll-group-${escapeHtml(
                  group.jid
                )}" value="${escapeHtml(group.jid)}"
                  ${
                    collection.groups && collection.groups.includes(group.jid)
                      ? "checked"
                      : ""
                  }>
                <label for="coll-group-${escapeHtml(
                  group.jid
                )}" style="margin-left: 8px; cursor: pointer;">
                  👥 ${escapeHtml(group.name)}
                </label>
              </div>
            `
              )
              .join("");
          }

          groupsList.innerHTML = groupsHTML;
          console.log("📝 ✅ Groups rendered successfully in edit form");
        }
      } else {
        console.error("📝 ❌ Element 'collection-groups-list' not found!");
      }
    } else {
      console.error("📝 ❌ Failed to load groups:", response.statusText);
      const groupsList = document.getElementById("collection-groups-list");
      if (groupsList) {
        groupsList.innerHTML =
          '<p style="color: red; padding: 15px;">Failed to load groups. Please try again.</p>';
      }
    }
  } catch (err) {
    console.error("📝 ❌ Error loading groups:", err);
    const groupsList = document.getElementById("collection-groups-list");
    if (groupsList) {
      groupsList.innerHTML =
        '<p style="color: red; padding: 15px;">Error loading groups. Please try again.</p>';
    }
  }

  // Set form to edit mode
  const saveBtn = document.getElementById("save-collection-btn");
  if (saveBtn) {
    saveBtn.onclick = () => saveEditedCollection(collectionId);
  }
}

async function saveEditedCollection(collectionId) {
  const nameInput = document.getElementById("collection-name-input");
  const name = nameInput ? nameInput.value.trim() : "";

  if (!name) {
    alert("Please enter a collection name");
    return;
  }

  // Get selected groups
  const selectedGroups = [];
  document
    .querySelectorAll('#collection-groups-list input[type="checkbox"]:checked')
    .forEach((cb) => selectedGroups.push(cb.value));

  try {
    const response = await fetch("/api/bot/collections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ collectionId, name, groups: selectedGroups }),
    });

    if (!response.ok) throw new Error("Failed to update collection");

    const data = await response.json();
    allCollections = data.collections || [];

    renderCollectionsInSettings();
    // Also update dropdowns/modal UI that rely on collections
    if (typeof renderCollectionsDropdown === "function")
      renderCollectionsDropdown();

    // Hide form
    const form = document.getElementById("collection-form");
    if (form) form.style.display = "none";

    showMessage(
      "settings-message",
      "Collection updated successfully!",
      "success"
    );
  } catch (error) {
    console.error("Error updating collection:", error);
    alert("Failed to update collection");
  }
}

async function deleteCollectionFromSettings(collectionId) {
  const collection = allCollections.find((c) => c.id === collectionId);
  if (!collection) return;

  if (
    !confirm(
      `Are you sure you want to delete the collection "${collection.name}"?`
    )
  )
    return;

  try {
    const response = await fetch(`/api/bot/collections/${collectionId}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!response.ok) throw new Error("Failed to delete collection");

    const data = await response.json();
    allCollections = data.collections || [];

    renderCollectionsInSettings();
    showMessage(
      "settings-message",
      "Collection deleted successfully!",
      "success"
    );
  } catch (error) {
    console.error("Error deleting collection:", error);
    alert("Failed to delete collection");
  }
}

function setupCollectionsManagementListeners() {
  const addBtn = document.getElementById("add-collection-btn");
  const saveBtn = document.getElementById("settings-save-collection-btn");
  const cancelBtn = document.getElementById("cancel-collection-btn");

  if (addBtn) {
    addBtn.onclick = async () => {
      const form = document.getElementById("collection-form");
      const formTitle = document.getElementById("collection-form-title");
      const nameInput = document.getElementById("collection-name-input");

      if (form) form.style.display = "block";
      if (formTitle) formTitle.textContent = "Create New Collection";
      if (nameInput) nameInput.value = "";

      // Load all groups
      try {
        console.log("📂 Loading groups for collections management...");
        const response = await fetch("/api/bot/groups", {
          credentials: "include",
        });

        console.log("📂 Groups API response status:", response.status);

        if (response.ok) {
          const data = await response.json();
          allGroups = data.groups || [];

          console.log("📂 Loaded groups count:", allGroups.length);

          const groupsList = document.getElementById("collection-groups-list");
          if (groupsList) {
            if (allGroups.length === 0) {
              groupsList.innerHTML =
                '<p style="color: #999; padding: 15px; text-align: center;">No WhatsApp groups found. Please make sure your WhatsApp bot is connected and has joined some groups.</p>';
            } else {
              // Sort groups: most recent first (reverse order to match WhatsApp)
              const sortedGroups = [...allGroups].reverse();

              // Separate communities and groups
              const communities = sortedGroups.filter(
                (g) => g.isCommunity || g.type === "Community"
              );
              const regularGroups = sortedGroups.filter(
                (g) => !g.isCommunity && g.type !== "Community"
              );

              let groupsHTML = "";

              // Render communities first
              if (communities.length > 0) {
                groupsHTML +=
                  '<div style="background: #f0f8ff; padding: 8px; margin-bottom: 5px; font-weight: bold; border-radius: 4px;">📢 Communities</div>';
                groupsHTML += communities
                  .map(
                    (group) => `
                  <div class="group-item" style="padding: 8px; border-bottom: 1px solid #eee; padding-left: 20px;">
                    <input type="checkbox" id="coll-group-${escapeHtml(
                      group.jid
                    )}" value="${escapeHtml(group.jid)}">
                    <label for="coll-group-${escapeHtml(
                      group.jid
                    )}" style="margin-left: 8px; cursor: pointer;">
                      📢 ${escapeHtml(group.name)}
                    </label>
                  </div>
                `
                  )
                  .join("");
              }

              // Render regular groups
              if (regularGroups.length > 0) {
                groupsHTML +=
                  '<div style="background: #f0fff0; padding: 8px; margin: 5px 0; font-weight: bold; border-radius: 4px;">👥 Groups</div>';
                groupsHTML += regularGroups
                  .map(
                    (group) => `
                  <div class="group-item" style="padding: 8px; border-bottom: 1px solid #eee; padding-left: 20px;">
                    <input type="checkbox" id="coll-group-${escapeHtml(
                      group.jid
                    )}" value="${escapeHtml(group.jid)}">
                    <label for="coll-group-${escapeHtml(
                      group.jid
                    )}" style="margin-left: 8px; cursor: pointer;">
                      👥 ${escapeHtml(group.name)}
                    </label>
                  </div>
                `
                  )
                  .join("");
              }

              groupsList.innerHTML = groupsHTML;
              console.log(
                "📂 ✅ Groups rendered successfully in collections form"
              );
            }
          } else {
            console.error("📂 ❌ Element 'collection-groups-list' not found!");
          }
        } else {
          console.error("📂 ❌ Failed to load groups:", response.statusText);
          const groupsList = document.getElementById("collection-groups-list");
          if (groupsList) {
            groupsList.innerHTML =
              '<p style="color: red; padding: 15px;">Failed to load groups. Please try again.</p>';
          }
        }
      } catch (err) {
        console.error("📂 ❌ Error loading groups:", err);
        const groupsList = document.getElementById("collection-groups-list");
        if (groupsList) {
          groupsList.innerHTML =
            '<p style="color: red; padding: 15px;">Error loading groups. Please try again.</p>';
        }
      }

      // Set form to create mode
      if (saveBtn) {
        saveBtn.onclick = saveNewCollection;
      }
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      const form = document.getElementById("collection-form");
      if (form) form.style.display = "none";
    };
  }
}

async function saveNewCollection() {
  const nameInput = document.getElementById("collection-name-input");
  const name = nameInput ? nameInput.value.trim() : "";

  if (!name) {
    alert("Please enter a collection name");
    return;
  }

  // Get selected groups
  const selectedGroups = [];
  document
    .querySelectorAll('#collection-groups-list input[type="checkbox"]:checked')
    .forEach((cb) => selectedGroups.push(cb.value));

  if (selectedGroups.length === 0) {
    alert("Please select at least one group");
    return;
  }

  try {
    const response = await fetch("/api/bot/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, groups: selectedGroups }),
    });

    if (!response.ok) throw new Error("Failed to create collection");

    const data = await response.json();
    allCollections = data.collections || [];

    renderCollectionsInSettings();

    // Hide form
    const form = document.getElementById("collection-form");
    if (form) form.style.display = "none";

    showMessage(
      "settings-message",
      "Collection created successfully!",
      "success"
    );
  } catch (error) {
    console.error("Error creating collection:", error);
    alert("Failed to create collection");
  }
}

// ============ Categories Management in Settings ============

function renderCategoriesInSettings() {
  const container = document.getElementById("categories-list");
  if (!container) return;

  if (!allCategories || allCategories.length === 0) {
    container.innerHTML = '<p style="color: #999;">No categories yet.</p>';
    return;
  }

  container.innerHTML = allCategories
    .map(
      (category) => `
    <div class="category-item" style="background: #f9f9f9; padding: 1rem; border-radius: 8px; margin-bottom: 0.5rem; border: 2px solid #ddd;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 30px; height: 30px; background: ${escapeHtml(
            category.color
          )}; border-radius: 4px;"></div>
          <strong>${escapeHtml(category.name)}</strong>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-sm btn-primary" onclick="editCategoryInSettings('${
            category.id
          }')">
            <i class="fas fa-edit"></i> Edit
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteCategoryFromSettings('${
            category.id
          }')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  `
    )
    .join("");
}

function editCategoryInSettings(categoryId) {
  const category = allCategories.find((c) => c.id === categoryId);
  if (!category) return;

  const form = document.getElementById("category-form");
  const formTitle = document.getElementById("category-form-title");
  const nameInput = document.getElementById("category-name-input");
  const colorInput = document.getElementById("category-color-input");

  if (form) form.style.display = "block";
  if (formTitle) formTitle.textContent = "Edit Category";
  if (nameInput) nameInput.value = category.name;
  if (colorInput) colorInput.value = category.color;

  const saveBtn = document.getElementById("save-category-btn");
  if (saveBtn) {
    saveBtn.onclick = () => saveEditedCategory(categoryId);
  }
}

async function saveEditedCategory(categoryId) {
  const nameInput = document.getElementById("category-name-input");
  const colorInput = document.getElementById("category-color-input");

  const name = nameInput ? nameInput.value.trim() : "";
  const color = colorInput ? colorInput.value : "#3498db";

  if (!name) {
    alert("Please enter a category name");
    return;
  }

  try {
    const response = await fetch("/api/bot/categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ categoryId, name, color }),
    });

    if (!response.ok) throw new Error("Failed to update category");

    const data = await response.json();
    allCategories = data.categories || [];

    renderCategoriesInSettings();

    const form = document.getElementById("category-form");
    if (form) form.style.display = "none";

    showMessage(
      "settings-message",
      "Category updated successfully!",
      "success"
    );
  } catch (error) {
    console.error("Error updating category:", error);
    alert("Failed to update category");
  }
}

async function deleteCategoryFromSettings(categoryId) {
  const category = allCategories.find((c) => c.id === categoryId);
  if (!category) return;

  if (
    !confirm(`Are you sure you want to delete the category "${category.name}"?`)
  )
    return;

  try {
    const response = await fetch(`/api/bot/categories/${categoryId}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!response.ok) throw new Error("Failed to delete category");

    const data = await response.json();
    allCategories = data.categories || [];

    renderCategoriesInSettings();
    showMessage(
      "settings-message",
      "Category deleted successfully!",
      "success"
    );
  } catch (error) {
    console.error("Error deleting category:", error);
    alert("Failed to delete category");
  }
}

function setupCategoriesManagementListeners() {
  const addBtn = document.getElementById("add-category-btn");
  const saveBtn = document.getElementById("save-category-btn");
  const cancelBtn = document.getElementById("cancel-category-btn");

  if (addBtn) {
    addBtn.onclick = () => {
      const form = document.getElementById("category-form");
      const formTitle = document.getElementById("category-form-title");
      const nameInput = document.getElementById("category-name-input");
      const colorInput = document.getElementById("category-color-input");

      if (form) form.style.display = "block";
      if (formTitle) formTitle.textContent = "Add New Category";
      if (nameInput) nameInput.value = "";
      if (colorInput) colorInput.value = "#3498db";

      if (saveBtn) {
        saveBtn.onclick = saveNewCategory;
      }
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      const form = document.getElementById("category-form");
      if (form) form.style.display = "none";
    };
  }
}

async function saveNewCategory() {
  const nameInput = document.getElementById("category-name-input");
  const colorInput = document.getElementById("category-color-input");

  const name = nameInput ? nameInput.value.trim() : "";
  const color = colorInput ? colorInput.value : "#3498db";

  if (!name) {
    alert("Please enter a category name");
    return;
  }

  try {
    const response = await fetch("/api/bot/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name, color }),
    });

    if (!response.ok) throw new Error("Failed to create category");

    const data = await response.json();
    allCategories = data.categories || [];

    renderCategoriesInSettings();

    const form = document.getElementById("category-form");
    if (form) form.style.display = "none";

    showMessage(
      "settings-message",
      "Category created successfully!",
      "success"
    );
  } catch (error) {
    console.error("Error creating category:", error);
    alert("Failed to create category");
  }
}

async function handleSaveAllSettings() {
  const input = document.getElementById("recycle-bin-days-input");
  if (!input) return;

  const days = parseInt(input.value, 10);
  if (isNaN(days) || days < 1 || days > 365) {
    showMessage(
      "settings-message",
      "Please enter a valid number between 1 and 365",
      "error"
    );
    return;
  }

  // Get WordPress settings
  const wpUrl = document.getElementById("wp-url");
  const wpUsername = document.getElementById("wp-username");
  const wpPassword = document.getElementById("wp-password");

  // Get footer settings
  const hasakFooterInput = document.getElementById("hasak-footer");
  const masaakFooterInput = document.getElementById("masaak-footer");

  try {
    const settings = {
      recycleBinDays: days,
      wordpressUrl: wpUrl ? wpUrl.value : "",
      wordpressUsername: wpUsername ? wpUsername.value : "",
      wordpressPassword: wpPassword ? wpPassword.value : "",
      excludedGroups: currentExcludedGroups, // Include excluded groups
      hasakFooter: hasakFooterInput ? hasakFooterInput.value : undefined,
      masaakFooter: masaakFooterInput ? masaakFooterInput.value : undefined,
    };

    const response = await fetch("/api/bot/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    if (!response.ok) throw new Error("Failed to save settings");

    showMessage("settings-message", "Settings saved successfully!", "success");
  } catch (error) {
    console.error("Error saving settings:", error);
    showMessage("settings-message", "Failed to save settings", "error");
  }
}

async function testWordPressConnection() {
  const wpUrl = document.getElementById("wp-url");
  const wpUsername = document.getElementById("wp-username");
  const wpPassword = document.getElementById("wp-password");
  const testBtn = document.getElementById("test-wp-connection-btn");

  if (!wpUrl.value || !wpUsername.value || !wpPassword.value) {
    alert("⚠️ Please fill in all WordPress credentials first");
    return;
  }

  try {
    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';

    // Try to fetch WordPress user info
    const wpApiUrl = `${wpUrl.value}/wp-json/wp/v2/users/me`;
    // Use btoa() for browser-compatible base64 encoding
    const auth = btoa(`${wpUsername.value}:${wpPassword.value}`);

    const response = await fetch(wpApiUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (response.ok) {
      const userData = await response.json();
      alert(
        `✅ Connection successful!\n\nLogged in as: ${
          userData.name
        }\nRole: ${userData.roles.join(", ")}`
      );
    } else {
      alert(
        `❌ Connection failed!\n\nStatus: ${response.status}\nMake sure the credentials are correct and WordPress REST API is enabled.`
      );
    }
  } catch (error) {
    console.error("WordPress test error:", error);
    alert(
      `❌ Connection failed!\n\nError: ${error.message}\n\nNote: Browser may block cross-origin requests. The connection will work from the server.`
    );
  } finally {
    testBtn.disabled = false;
    testBtn.innerHTML = '<i class="fas fa-vial"></i> Test Connection';
  }
}

async function updateAutoApproveWordPress(enabled) {
  try {
    const response = await fetch("/api/bot/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ autoApproveWordPress: enabled }),
    });

    if (!response.ok) throw new Error("Failed to update auto-approve setting");

    const statusText = enabled ? "enabled" : "disabled";
    showMessage(
      "settings-message",
      `Auto-approve & post to WordPress ${statusText} successfully!`,
      "success"
    );
    console.log(`✅ Auto-approve WordPress ${statusText}`);
  } catch (error) {
    console.error("Error updating auto-approve setting:", error);
    showMessage(
      "settings-message",
      "Failed to update auto-approve setting",
      "error"
    );
    // Revert the toggle on error
    const toggle = document.getElementById("auto-approve-wp-toggle");
    if (toggle) toggle.checked = !enabled;
  }
}

// ==================== ANALYTICS FUNCTIONS ====================

let analyticsLoading = false;

async function loadAnalytics() {
  // Prevent multiple simultaneous loads
  if (analyticsLoading) {
    console.log("Analytics already loading, skipping...");
    return;
  }

  try {
    analyticsLoading = true;

    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch("/api/bot/analytics", {
      method: "GET",
      credentials: "include",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401) {
        // Session expired
        currentUser = null;
        showLogin();
        return;
      }
      throw new Error(`Failed to load analytics: ${response.status}`);
    }

    const data = await response.json();
    if (data.success && data.analytics) {
      updateAnalyticsUI(data.analytics);
    } else {
      console.warn("Analytics data missing or invalid");
      // Set default values to prevent showing 0s
      updateAnalyticsUI({
        summary: {
          totalAds: 0,
          newAds: 0,
          acceptedAds: 0,
          rejectedAds: 0,
          postedAds: 0,
          totalGroups: 0,
          activeGroups: 0,
          recycleBinCount: 0,
        },
        propertyTypes: {},
        groupStats: [],
        dailyStats: [],
        categoryStats: [],
        recentAds: [],
        queueStats: {},
      });
    }
  } catch (error) {
    if (error.name === "AbortError") {
      console.error("Analytics request timed out");
    } else {
      console.error("Error loading analytics:", error);
    }
    // Don't show error to user, just log it
  } finally {
    analyticsLoading = false;
  }
}

function updateAnalyticsUI(analytics) {
  const {
    summary,
    propertyTypes,
    groupStats,
    dailyStats,
    categoryStats,
    recentAds,
    queueStats,
  } = analytics;

  // Helper function to safely update element
  const safeUpdate = (id, value) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    } else {
      console.warn(`Element with id '${id}' not found`);
    }
  };

  // Update summary cards
  safeUpdate("stat-total-ads", summary.totalAds || 0);
  safeUpdate("stat-new-ads", `${summary.newAds || 0} new`);

  safeUpdate("stat-accepted", summary.acceptedAds || 0);
  const acceptanceRate =
    summary.totalAds > 0
      ? Math.round((summary.acceptedAds / summary.totalAds) * 100)
      : 0;
  safeUpdate("stat-acceptance-rate", `${acceptanceRate}% rate`);

  safeUpdate("stat-posted", summary.postedAds || 0);
  const postedRate =
    summary.totalAds > 0
      ? Math.round((summary.postedAds / summary.totalAds) * 100)
      : 0;
  safeUpdate("stat-posted-rate", `${postedRate}% posted`);

  safeUpdate("stat-groups", summary.activeGroups || 0);
  safeUpdate("stat-total-groups", `of ${summary.totalGroups || 0} total`);

  safeUpdate("stat-rejected", summary.rejectedAds || 0);
  safeUpdate("stat-recycle-bin", `${summary.recycleBinCount || 0} in bin`);

  // Categories stat
  const categoriesCount = Object.keys(propertyTypes).length;
  safeUpdate("stat-categories", categoriesCount);

  // Find top category
  let topCategory = "None";
  let maxCount = 0;
  for (const [cat, count] of Object.entries(propertyTypes)) {
    if (count > maxCount) {
      maxCount = count;
      topCategory = cat;
    }
  }
  safeUpdate("stat-top-category", topCategory);

  // Update property types chart
  updatePropertyTypesChart(propertyTypes);

  // Update top groups chart
  updateTopGroupsChart(groupStats);

  // Update daily activity chart
  updateDailyActivityChart(dailyStats);

  // Update recent activity
  updateRecentActivity(recentAds);
}

function updatePropertyTypesChart(propertyTypes) {
  const container = document.getElementById("property-types-chart");
  if (!container) return;

  const entries = Object.entries(propertyTypes).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    container.innerHTML =
      '<p style="text-align: center; color: #999;">No data available</p>';
    return;
  }

  const maxValue = Math.max(...entries.map((e) => e[1]));
  const colors = [
    "#667eea",
    "#f093fb",
    "#4facfe",
    "#43e97b",
    "#fa709a",
    "#30cfd0",
    "#a8edea",
    "#fed6e3",
    "#c471f5",
    "#12c2e9",
  ];

  const html = entries
    .map(([name, count], index) => {
      const percentage = maxValue > 0 ? (count / maxValue) * 100 : 0;
      const color = colors[index % colors.length];

      return `
      <div class="chart-bar">
        <div class="chart-bar-label">${name}</div>
        <div class="chart-bar-container">
          <div class="chart-bar-fill" style="width: ${percentage}%; background: ${color};">
            ${count}
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  container.innerHTML = html;
}

function updateTopGroupsChart(groupStats) {
  const container = document.getElementById("top-groups-chart");
  if (!container) return;

  const topGroups = groupStats.slice(0, 5);

  if (topGroups.length === 0) {
    container.innerHTML =
      '<p style="text-align: center; color: #999;">No data available</p>';
    return;
  }

  const maxValue = Math.max(...topGroups.map((g) => g.total));
  const colors = ["#667eea", "#f093fb", "#4facfe", "#43e97b", "#fa709a"];

  const html = topGroups
    .map((group, index) => {
      const percentage = maxValue > 0 ? (group.total / maxValue) * 100 : 0;
      const color = colors[index];

      return `
      <div class="chart-bar">
        <div class="chart-bar-label" title="${group.name}">${truncateText(
        group.name,
        15
      )}</div>
        <div class="chart-bar-container">
          <div class="chart-bar-fill" style="width: ${percentage}%; background: ${color};">
            ${group.total}
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  container.innerHTML = html;
}

function updateDailyActivityChart(dailyStats) {
  const container = document.getElementById("daily-activity-chart");
  if (!container || dailyStats.length === 0) return;

  const maxValue = Math.max(...dailyStats.map((d) => d.total), 1);
  const chartHeight = 180;

  const html = `
    <div style="display: flex; align-items: flex-end; justify-content: space-around; height: ${chartHeight}px; padding: 10px; gap: 5px;">
      ${dailyStats
        .map((day) => {
          const height = (day.total / maxValue) * 100;
          const dateObj = new Date(day.date);
          const dayName = dateObj.toLocaleDateString("en-US", {
            weekday: "short",
          });

          return `
          <div style="flex: 1; display: flex; flex-direction: column; align-items: center;">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 2px; margin-bottom: 5px; font-size: 0.75rem; color: #666;">
              <span style="font-weight: bold;">${day.total}</span>
            </div>
            <div style="width: 100%; height: ${height}%; background: linear-gradient(180deg, #667eea 0%, #764ba2 100%); border-radius: 4px 4px 0 0; transition: all 0.3s;" 
                 title="${day.date}: ${day.total} ads">
            </div>
            <div style="margin-top: 5px; font-size: 0.75rem; color: #999;">${dayName}</div>
          </div>
        `;
        })
        .join("")}
    </div>
  `;

  container.innerHTML = html;
}

function updateRecentActivity(recentAds) {
  const container = document.getElementById("recent-activity-list");
  if (!container) return;

  if (!recentAds || recentAds.length === 0) {
    container.innerHTML =
      '<p style="text-align: center; color: #999; padding: 20px;">No recent activity</p>';
    return;
  }

  const statusColors = {
    new: "#2196F3",
    accepted: "#4CAF50",
    rejected: "#F44336",
    posted: "#9C27B0",
  };

  const statusIcons = {
    new: "fa-star",
    accepted: "fa-check-circle",
    rejected: "fa-times-circle",
    posted: "fa-share-square",
  };

  const html = recentAds
    .map((ad) => {
      const timeAgo = getTimeAgo(ad.receivedAt);
      const color = statusColors[ad.status] || "#999";
      const icon = statusIcons[ad.status] || "fa-file";

      return `
      <div class="recent-activity-item">
        <div class="activity-icon" style="background: ${color};">
          <i class="fas ${icon}"></i>
        </div>
        <div class="activity-info">
          <div class="activity-title">${ad.category || "غير محدد"}</div>
          <div class="activity-meta">
            <i class="fas fa-users"></i> ${truncateText(ad.fromGroup, 25)} • 
            <i class="fas fa-clock"></i> ${timeAgo}
          </div>
          <div class="activity-preview">${ad.preview}...</div>
        </div>
        <div class="activity-badge badge-${ad.status}">${getStatusText(
        ad.status
      )}</div>
      </div>
    `;
    })
    .join("");

  container.innerHTML = html;
}

function getStatusText(status) {
  const statusMap = {
    new: "جديد",
    accepted: "مقبول",
    rejected: "مرفوض",
    posted: "منشور",
  };
  return statusMap[status] || status;
}

function getTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "Just now";
}

function truncateText(text, maxLength) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

// Add refresh analytics button handler
document.addEventListener("DOMContentLoaded", () => {
  const refreshAnalyticsBtn = document.getElementById("refresh-analytics-btn");
  if (refreshAnalyticsBtn) {
    refreshAnalyticsBtn.addEventListener("click", () => {
      loadAnalytics();
    });
  }
});

// ==================== WHATSAPP MESSAGES VIEW ====================

// Pagination and filtering state
let whatsappMessagesState = {
  allMessages: [],
  currentPage: 1,
  itemsPerPage: 12, // Show 12 items per page
  sortBy: "time-desc",
  filterWebsite: "all",
  filterCategory: "all",
  filterGroup: "all",
  filterStatus: "pending", // Default to showing pending messages only
  searchQuery: "",
};

// Setup WhatsApp search functionality
function setupWhatsAppSearch() {
  const searchInput = document.getElementById("whatsapp-search-input");
  if (!searchInput) return;

  // Remove existing listener if any
  const newSearchInput = searchInput.cloneNode(true);
  searchInput.parentNode.replaceChild(newSearchInput, searchInput);

  // Add live search with debounce
  let searchTimeout;
  newSearchInput.addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      whatsappMessagesState.searchQuery = e.target.value;
      whatsappMessagesState.currentPage = 1;

      // Apply filters without full reload
      const listContainer = document.getElementById("whatsapp-messages-list");
      if (!listContainer || !whatsappMessagesState.allMessages.length) return;

      const filteredMessages = applyWhatsAppFilters(
        whatsappMessagesState.allMessages
      );
      updateWhatsAppMessagesCount(filteredMessages.length);

      const messagesToShow = filteredMessages.slice(
        0,
        whatsappMessagesState.itemsPerPage
      );
      listContainer.innerHTML = "";
      renderWhatsAppMessageCards(messagesToShow, listContainer);

      // Show no results message if needed
      if (filteredMessages.length === 0) {
        listContainer.innerHTML =
          '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;"><i class="fas fa-search" style="font-size: 3rem; margin-bottom: 15px; opacity: 0.3;"></i><p>No messages found matching your search.</p></div>';
      }
    }, 300); // 300ms debounce
  });
}

// Load WhatsApp Messages View
async function loadWhatsAppMessagesView(append = false) {
  try {
    const infoEl = document.getElementById("whatsapp-messages-info");
    const listContainer = document.getElementById("whatsapp-messages-list");

    if (infoEl) {
      infoEl.style.display = "none";
    }

    if (!append && listContainer) {
      listContainer.innerHTML =
        '<div style="grid-column: 1/-1; text-align: center; padding: 20px;">Loading messages...</div>';
    }

    // Setup search functionality
    setupWhatsAppSearch();

    // Build query params for the optimized endpoint
    const params = new URLSearchParams({
      page: whatsappMessagesState.currentPage,
      limit: whatsappMessagesState.itemsPerPage,
      status: whatsappMessagesState.filterStatus,
    });

    if (whatsappMessagesState.filterWebsite !== "all") {
      params.append("website", whatsappMessagesState.filterWebsite);
    }
    if (whatsappMessagesState.filterGroup !== "all") {
      params.append("group", whatsappMessagesState.filterGroup);
    }
    if (whatsappMessagesState.filterCategory !== "all") {
      params.append("category", whatsappMessagesState.filterCategory);
    }

    // Use the optimized endpoint that pre-filters server-side
    const response = await fetch(`/api/bot/ads/whatsapp-messages?${params.toString()}`, {
      credentials: "include",
      cache: "no-cache",
    });

    if (response.status === 401 || response.status === 403) {
      currentUser = null;
      showLogin();
      return;
    }

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    const ads = data.ads || [];
    const pagination = data.pagination || {};

    console.log(`📦 WhatsApp messages loaded: ${ads.length} (page ${pagination.currentPage}/${pagination.totalPages}, total: ${pagination.totalAds})`);

    // Store for search functionality
    if (!append) {
      whatsappMessagesState.allMessages = ads;
      whatsappMessagesState.totalMessages = pagination.totalAds;
      
      // Populate filter dropdowns from server data
      populateWhatsAppCategoryFilterFromData(data.allCategories || []);
      populateWhatsAppGroupFilterFromData(data.allGroups || []);
    } else {
      // Append new messages
      whatsappMessagesState.allMessages = [...whatsappMessagesState.allMessages, ...ads];
    }

    // Update count
    updateWhatsAppMessagesCount(pagination.totalAds);

    if (!listContainer) return;

    if (pagination.totalAds === 0) {
      listContainer.innerHTML =
        '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;"><i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 15px; opacity: 0.3;"></i><p>No accepted ads with WhatsApp messages yet. Messages will appear here after ads are accepted and posted to WordPress.</p></div>';
      return;
    }

    // Render messages
    if (!append) {
      listContainer.innerHTML = "";
    } else {
      // Remove load more button if it exists
      const loadMoreBtn = listContainer.querySelector(".load-more-whatsapp-container");
      if (loadMoreBtn) {
        loadMoreBtn.remove();
      }
    }

    // Apply local search if any (filters are server-side now)
    let messagesToRender = ads;
    if (whatsappMessagesState.searchQuery && whatsappMessagesState.searchQuery.trim()) {
      const query = whatsappMessagesState.searchQuery.toLowerCase().trim();
      messagesToRender = ads.filter((ad) => {
        const searchableText = [
          ad.text,
          ad.enhancedText,
          ad.whatsappMessage,
          ad.fromGroupName,
          ad.category,
          ad.wpData?.title?.rendered,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return searchableText.includes(query);
      });
    }

    renderWhatsAppMessageCards(messagesToRender, listContainer);

    // Add load more button if there are more messages
    if (pagination.hasMore) {
      console.log("✅ Adding Load More button");
      addLoadMoreWhatsAppButton(listContainer, pagination.totalAds);
    } else if (messagesToRender.length > 0) {
      console.log("✅ All messages loaded");
      addEndMessageWhatsApp(listContainer, pagination.totalAds);
    }
  } catch (err) {
    console.error("Error loading WhatsApp messages:", err);
    const listContainer = document.getElementById("whatsapp-messages-list");
    if (listContainer) {
      listContainer.innerHTML =
        '<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #dc3545;">Failed to load messages. Please try again.</div>';
    }
  }
}

// Populate category filter from server data
function populateWhatsAppCategoryFilterFromData(categories) {
  const categorySelect = document.getElementById("whatsapp-filter-category");
  if (!categorySelect) return;

  const currentValue = categorySelect.value;
  categorySelect.innerHTML = '<option value="all">📁 All Categories</option>';

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  });

  if (currentValue && currentValue !== "all") {
    categorySelect.value = currentValue;
  }
}

// Populate group filter from server data
function populateWhatsAppGroupFilterFromData(groups) {
  const groupSelect = document.getElementById("whatsapp-filter-group");
  if (!groupSelect) return;

  const currentValue = groupSelect.value;
  groupSelect.innerHTML = '<option value="all">👥 All Groups</option>';

  groups.sort((a, b) => a.name.localeCompare(b.name)).forEach((group) => {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.name;
    groupSelect.appendChild(option);
  });

  if (currentValue && currentValue !== "all") {
    groupSelect.value = currentValue;
  }
}

// Populate category filter dropdown
function populateWhatsAppCategoryFilter(ads) {
  const categorySelect = document.getElementById("whatsapp-filter-category");
  if (!categorySelect) return;

  // Get unique categories
  // Prefer WordPress meta categories (arc_category / parent_catt) when available,
  // so Hasak categories like "حراج الحسا" appear correctly instead of generic labels.
  const categories = [
    ...new Set(
      ads
        .map((ad) => {
          const meta = ad.wpData && ad.wpData.meta ? ad.wpData.meta : {};
          return meta.arc_category || meta.parent_catt || ad.category || null;
        })
        .filter(Boolean)
    ),
  ];
  categories.sort();

  // Clear existing options except "All"
  categorySelect.innerHTML = '<option value="all">📁 All Categories</option>';

  // Add category options
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  });
}

// Populate group filter dropdown for WhatsApp messages
function populateWhatsAppGroupFilter(ads) {
  const groupSelect = document.getElementById("whatsapp-filter-group");
  if (!groupSelect) return;

  const currentValue = groupSelect.value;

  // Get unique groups
  const groupsMap = new Map();
  ads.forEach((ad) => {
    if (ad.fromGroupName && ad.fromGroup) {
      groupsMap.set(ad.fromGroup, ad.fromGroupName);
    }
  });

  // Clear existing options except "All"
  groupSelect.innerHTML = '<option value="all">👥 All Groups</option>';

  // Add group options sorted alphabetically
  const sortedGroups = Array.from(groupsMap.entries()).sort((a, b) => 
    a[1].localeCompare(b[1])
  );

  sortedGroups.forEach(([id, name]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = name;
    groupSelect.appendChild(option);
  });

  // Restore previous selection if it exists
  if (currentValue && currentValue !== "all") {
    groupSelect.value = currentValue;
  }
}

// Apply filters and sorting
function applyWhatsAppFilters(messages) {
  let filtered = [...messages];

  // Filter by search query
  if (
    whatsappMessagesState.searchQuery &&
    whatsappMessagesState.searchQuery.trim()
  ) {
    const query = whatsappMessagesState.searchQuery.toLowerCase().trim();
    filtered = filtered.filter((ad) => {
      const category = (ad.category || "").toLowerCase();
      const groupName = (ad.fromGroupName || ad.fromGroup || "").toLowerCase();
      const messageText = (ad.whatsappMessage || "").toLowerCase();
      const meta = ad.wpData?.meta || {};
      const location = (meta.location || meta.City || "").toLowerCase();

      return (
        category.includes(query) ||
        groupName.includes(query) ||
        messageText.includes(query) ||
        location.includes(query)
      );
    });
  }

  // Filter by status (sent vs pending)
  if (whatsappMessagesState.filterStatus === "sent") {
    filtered = filtered.filter((ad) => {
      const isSent =
        ad.postedToGroups ||
        ad.sentToGroups ||
        (ad.selectedGroups && ad.selectedGroups.length > 0);
      console.log(`🔍 [FILTER-SENT] Ad ${ad.id} - isSent: ${isSent}`);
      return isSent;
    });
  } else if (whatsappMessagesState.filterStatus === "pending") {
    filtered = filtered.filter((ad) => {
      const isSent =
        ad.postedToGroups ||
        ad.sentToGroups ||
        (ad.selectedGroups && ad.selectedGroups.length > 0);
      const isPending = !isSent;
      console.log(`🔍 [FILTER-PENDING] Ad ${ad.id} - isPending: ${isPending}`);
      return isPending;
    });
  }
  console.log(
    `📊 [FILTER] Status: ${whatsappMessagesState.filterStatus}, Before: ${messages.length}, After: ${filtered.length}`
  );
  // "all" shows both sent and pending

  // Filter by website
  if (whatsappMessagesState.filterWebsite !== "all") {
    filtered = filtered.filter((ad) => {
      const targetWebsite =
        ad.targetWebsite || ad.wpData?.targetWebsite || "masaak";
      return targetWebsite === whatsappMessagesState.filterWebsite;
    });
  }

  // Filter by category
  if (whatsappMessagesState.filterCategory !== "all") {
    filtered = filtered.filter((ad) => {
      const meta = ad.wpData && ad.wpData.meta ? ad.wpData.meta : {};
      const effectiveCategory =
        meta.arc_category || meta.parent_catt || ad.category || null;
      return effectiveCategory === whatsappMessagesState.filterCategory;
    });
  }

  // Filter by group
  if (whatsappMessagesState.filterGroup !== "all") {
    filtered = filtered.filter((ad) => {
      return ad.fromGroup === whatsappMessagesState.filterGroup || 
             ad.fromGroupName === whatsappMessagesState.filterGroup;
    });
  }

  // Sort messages
  filtered.sort((a, b) => {
    switch (whatsappMessagesState.sortBy) {
      case "time-desc":
        return b.timestamp - a.timestamp;
      case "time-asc":
        return a.timestamp - b.timestamp;
      case "confidence-desc":
        return (b.aiConfidence || 0) - (a.aiConfidence || 0);
      case "confidence-asc":
        return (a.aiConfidence || 0) - (b.aiConfidence || 0);
      default:
        return b.timestamp - a.timestamp;
    }
  });

  return filtered;
}

// Update messages count display
function updateWhatsAppMessagesCount(count) {
  const countEl = document.getElementById("whatsapp-messages-count");
  if (countEl) {
    const total = whatsappMessagesState.allMessages.length;
    if (count === undefined) {
      count = total;
    }
    countEl.textContent = `${count} message${count !== 1 ? "s" : ""}`;
    if (count < total) {
      countEl.textContent += ` (of ${total})`;
    }
  }
}

// Add load more button
function addLoadMoreWhatsAppButton(container, totalCount) {
  const loadMoreContainer = document.createElement("div");
  loadMoreContainer.className = "load-more-whatsapp-container";
  loadMoreContainer.style.cssText =
    "grid-column: 1/-1; text-align: center; padding: 20px; margin-top: 20px;";

  const currentShowing =
    whatsappMessagesState.currentPage * whatsappMessagesState.itemsPerPage;
  const remainingCount = totalCount - currentShowing;

  const loadMoreBtn = document.createElement("button");
  loadMoreBtn.className = "btn btn-primary";
  loadMoreBtn.innerHTML = `
    <i class="fas fa-chevron-down"></i> 
    Load More (Showing ${currentShowing} of ${totalCount} - ${remainingCount} more)
  `;
  loadMoreBtn.style.cssText =
    "padding: 12px 30px; font-size: 1rem; border-radius: 8px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; color: white; cursor: pointer; transition: all 0.3s;";

  loadMoreBtn.addEventListener("mouseover", () => {
    loadMoreBtn.style.transform = "translateY(-2px)";
    loadMoreBtn.style.boxShadow = "0 5px 15px rgba(102, 126, 234, 0.4)";
  });

  loadMoreBtn.addEventListener("mouseout", () => {
    loadMoreBtn.style.transform = "translateY(0)";
    loadMoreBtn.style.boxShadow = "none";
  });

  loadMoreBtn.addEventListener("click", async () => {
    console.log(
      `🔄 Load More clicked! Current page: ${whatsappMessagesState.currentPage}`
    );
    loadMoreBtn.disabled = true;
    loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    whatsappMessagesState.currentPage++;
    console.log(
      `➡️ Incrementing to page: ${whatsappMessagesState.currentPage}`
    );
    await loadWhatsAppMessagesView(true);
    loadMoreBtn.disabled = false;
  });

  loadMoreContainer.appendChild(loadMoreBtn);
  container.appendChild(loadMoreContainer);

  console.log(
    `🔘 Load More button added (showing ${currentShowing} of ${totalCount})`
  );
}

// Add end message
function addEndMessageWhatsApp(container, totalCount) {
  const endMessage = document.createElement("div");
  endMessage.style.cssText =
    "grid-column: 1/-1; text-align: center; padding: 20px; color: #666; font-style: italic;";
  endMessage.innerHTML = `<i class="fas fa-check-circle"></i> All messages loaded (${totalCount} total)`;
  container.appendChild(endMessage);
}

// Render WhatsApp Message Cards
function renderWhatsAppMessageCards(ads, container) {
  // Don't clear container if appending
  // container.innerHTML = "";

  console.log(`🎨 Rendering ${ads.length} WhatsApp message cards`);

  ads.forEach((ad, index) => {
    console.log(
      `  ➡️ Card ${index + 1}: ${ad.id} - ${ad.category || "No category"}`
    );

    // Determine target website (must be before using it)
    const targetWebsite =
      ad.targetWebsite || ad.wpData?.targetWebsite || "masaak";

    const card = document.createElement("div");
    card.className = "whatsapp-message-card";
    const wasSent =
      ad.postedToGroups ||
      ad.sentToGroups ||
      (ad.selectedGroups && ad.selectedGroups.length > 0);
    console.log(
      `📊 [CARD] Ad ${ad.id} - postedToGroups: ${
        ad.postedToGroups
      }, sentToGroups: ${ad.sentToGroups}, selectedGroups: ${
        ad.selectedGroups?.length || 0
      }, wasSent: ${wasSent}`
    );
    card.dataset.adId = ad.id;
    card.dataset.status = wasSent ? "sent" : "pending";
    card.dataset.category = ad.category || "";
    card.dataset.website = targetWebsite;

    const websiteBadge =
      targetWebsite === "hasak"
        ? `<span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; display: inline-flex; align-items: center; gap: 4px;">
            <i class="fas fa-calendar-alt"></i> حساك
          </span>`
        : `<span style="background: linear-gradient(135deg, #56ab2f 0%, #a8e063 100%); color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; display: inline-flex; align-items: center; gap: 4px;">
            <i class="fas fa-home"></i> مسعاك
          </span>`;

    card.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 15px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-left: 4px solid #25D366;
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: transform 0.2s, box-shadow 0.2s;
    `;

    // Image preview section (similar to Manage Ads)
    let imagePreview = null;
    if (ad.imageUrl && typeof ad.imageUrl === "object") {
      imagePreview = document.createElement("div");
      imagePreview.style.cssText = `
        margin-bottom: 12px;
        border-radius: 8px;
        overflow: hidden;
      `;
      imagePreview.innerHTML = `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 8px 12px; font-weight: bold; display: flex; align-items: center; gap: 8px; font-size: 0.85rem;">
          <i class="fas fa-image"></i>
          <span>🖼️ Ad Image</span>
        </div>
        <div style="padding: 10px; background: white; border: 2px solid #667eea; border-top: none; border-radius: 0 0 6px 6px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <img 
            id="wa-preview-img-${ad.id}"
            src="/api/bot/ads/${ad.id}/full-image" 
            alt="Ad Image" 
            style="max-width: 100%; max-height: 150px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); cursor: pointer; object-fit: contain;"
            onclick="openAdImageFullView('${ad.id}')"
            onerror="this.src='${ad.imageUrl.jpegThumbnail ? `data:image/jpeg;base64,${ad.imageUrl.jpegThumbnail}` : '/images/no-image-placeholder.png'}'"
          />
          <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center;">
            <button class="btn btn-sm btn-primary" onclick="openAdImageFullView('${ad.id}')" style="display: flex; align-items: center; gap: 4px; padding: 4px 10px; font-size: 0.75rem;">
              <i class="fas fa-expand"></i> Full View
            </button>
          </div>
          <small style="color: #666; font-size: 0.7rem;">${ad.imageUrl.mimetype || 'image/jpeg'} ${ad.imageUrl.width && ad.imageUrl.height ? `• ${ad.imageUrl.width}x${ad.imageUrl.height} px` : ''}</small>
        </div>
      `;
    }

    // Message preview
    const messagePreview = document.createElement("div");
    messagePreview.style.cssText = `
      background: #e8f5e9;
      padding: 10px;
      border-radius: 6px;
      font-size: 0.85rem;
      line-height: 1.4;
      max-height: none;
      overflow-y: visible;
      white-space: pre-wrap;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      border-left: 3px solid #4caf50;
    `;

    const messageText =
      ad.whatsappMessage ||
      "⏳ Message will be generated after posting to WordPress";
    messagePreview.textContent = messageText;

    // Metadata
    const metadata = document.createElement("div");
    metadata.style.cssText = `
      display: flex;
      gap: 10px;
      font-size: 0.75rem;
      color: #666;
      flex-wrap: wrap;
      align-items: center;
    `;
    // Use the wasSent variable declared earlier
    const statusBadge = wasSent
      ? `<span style="background: #28a745; color: white; padding: 3px 8px; border-radius: 4px; font-weight: 500;"><i class="fas fa-check-circle"></i> Sent</span>`
      : `<span style="background: #ffc107; color: #333; padding: 3px 8px; border-radius: 4px; font-weight: 500;"><i class="fas fa-clock"></i> Pending</span>`;

    metadata.innerHTML = `
      ${websiteBadge}
      ${statusBadge}
      ${
        ad.category
          ? `<span style="background: #f0f0f0; padding: 3px 8px; border-radius: 4px;"><i class="fas fa-folder"></i> ${escapeHtml(
              ad.category
            )}</span>`
          : ""
      }
      <span><i class="fas fa-users"></i> ${escapeHtml(
        ad.fromGroupName || ad.fromGroup
      )}</span>
      <span><i class="fas fa-clock"></i> ${new Date(
        ad.timestamp
      ).toLocaleString()}</span>
      ${
        ad.aiConfidence
          ? `<span style="color: ${
              ad.aiConfidence > 70
                ? "#28a745"
                : ad.aiConfidence > 40
                ? "#ffc107"
                : "#dc3545"
            }"><i class="fas fa-robot"></i> ${ad.aiConfidence}%</span>`
          : ""
      }
    `;

    // Collection quick-select section (only if collections exist and message is available)
    const collectionsSection = document.createElement("div");
    collectionsSection.className = "collection-pills-container";
    collectionsSection.style.cssText = `
      padding: 10px 0;
      border-top: 1px solid #e0e0e0;
    `;

    // Only show if we have collections and a whatsapp message
    if (allCollections && allCollections.length > 0 && ad.whatsappMessage) {
      const label = document.createElement("div");
      label.style.cssText = `
        font-size: 0.75rem;
        color: #666;
        margin-bottom: 8px;
        font-weight: 500;
      `;
      label.innerHTML = '<i class="fas fa-folder"></i> Quick Send to Collection:';
      collectionsSection.appendChild(label);

      const pillsWrapper = document.createElement("div");
      pillsWrapper.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      `;

      allCollections.forEach((collection) => {
        const groupCount = collection.groups ? collection.groups.length : 0;
        const pill = document.createElement("button");
        pill.className = "collection-pill";
        pill.style.cssText = `
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 16px;
          padding: 6px 12px;
          font-size: 0.75rem;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          transition: all 0.2s ease;
          min-width: 80px;
        `;
        pill.innerHTML = `
          <span style="font-weight: 600;">${escapeHtml(collection.name)}</span>
          <span style="font-size: 0.65rem; opacity: 0.9;">${groupCount} groups</span>
        `;
        pill.title = `Send to ${collection.name} (${groupCount} groups)`;
        pill.onmouseenter = () => {
          pill.style.transform = "translateY(-2px)";
          pill.style.boxShadow = "0 4px 12px rgba(102, 126, 234, 0.4)";
        };
        pill.onmouseleave = () => {
          pill.style.transform = "translateY(0)";
          pill.style.boxShadow = "none";
        };
        pill.onclick = (e) => {
          e.stopPropagation();
          quickSendToCollection(ad.id, ad, collection, card);
        };
        pillsWrapper.appendChild(pill);
      });

      collectionsSection.appendChild(pillsWrapper);
    } else if (!ad.whatsappMessage) {
      // Show helpful message if no whatsapp message yet
      collectionsSection.innerHTML = `
        <div style="font-size: 0.75rem; color: #999; text-align: center; padding: 8px;">
          <i class="fas fa-info-circle"></i> Quick send available after WordPress posting
        </div>
      `;
    }

    // Action buttons
    const actionButtons = document.createElement("div");
    actionButtons.style.cssText = `
      display: flex;
      gap: 8px;
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid #e0e0e0;
    `;


    // View full ad button
    const viewButton = document.createElement("button");
    viewButton.className = "btn btn-sm btn-secondary";
    viewButton.innerHTML = '<i class="fas fa-eye"></i>';
    viewButton.title = "View Full Ad Details";
    viewButton.style.cssText = `
      padding: 6px 10px;
      font-size: 0.85rem;
    `;
    viewButton.onclick = () => viewFullAdFromWhatsApp(ad.id);

    // Accept button or resend button
    let acceptButton, rejectButton;

    if (wasSent) {
      // Show "More" button for custom group selection
      const moreButton = document.createElement("button");
      moreButton.className = "btn btn-sm btn-info";
      moreButton.innerHTML = '<i class="fas fa-ellipsis-h"></i> More';
      moreButton.title = "More options (custom group selection)";
      moreButton.style.cssText = `
        flex: 1;
        padding: 8px;
        font-size: 0.85rem;
      `;
      moreButton.onclick = () => handleAcceptWhatsAppMessage(ad.id, ad, card);
      actionButtons.appendChild(viewButton);
      actionButtons.appendChild(moreButton);
      if (imagePreview) card.appendChild(imagePreview);
      card.appendChild(messagePreview);
      card.appendChild(metadata);
      card.appendChild(collectionsSection);
      card.appendChild(actionButtons);
      container.appendChild(card);
      return; // Skip adding reject button for sent messages
    }

    // More options button for pending messages (opens popup for custom selection)
    acceptButton = document.createElement("button");
    acceptButton.className = "btn btn-sm btn-success";
    acceptButton.innerHTML = '<i class="fas fa-ellipsis-h"></i> More';
    acceptButton.title = "More options (custom group selection)";
    acceptButton.style.cssText = `
      flex: 1;
      padding: 8px;
      font-size: 0.85rem;
    `;
    acceptButton.onclick = () => handleAcceptWhatsAppMessage(ad.id, ad, card);

    // Reject button for pending messages
    rejectButton = document.createElement("button");
    rejectButton.className = "btn btn-sm btn-danger";
    rejectButton.innerHTML = '<i class="fas fa-times"></i> Reject';
    rejectButton.style.cssText = `
      flex: 1;
      padding: 8px;
      font-size: 0.85rem;
    `;
    rejectButton.onclick = () => handleRejectWhatsAppMessage(ad.id, card);

    actionButtons.appendChild(viewButton);
    actionButtons.appendChild(acceptButton);
    actionButtons.appendChild(rejectButton);

    if (imagePreview) card.appendChild(imagePreview);
    card.appendChild(messagePreview);
    card.appendChild(metadata);
    card.appendChild(collectionsSection);
    card.appendChild(actionButtons);

    // Hover effect
    card.onmouseenter = () => {
      card.style.transform = "translateY(-2px)";
      card.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
    };
    card.onmouseleave = () => {
      card.style.transform = "translateY(0)";
      card.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
    };

    container.appendChild(card);
  });
}

// Quick send to a collection - sends message to all groups in the collection
async function quickSendToCollection(adId, ad, collection, cardElement) {
  const groups = collection.groups || [];
  
  if (groups.length === 0) {
    alert(`Collection "${collection.name}" has no groups`);
    return;
  }
  
  if (!ad.whatsappMessage) {
    alert("No WhatsApp message available. Please post to WordPress first.");
    return;
  }

  // Confirm action
  if (!confirm(`Send message to all ${groups.length} groups in "${collection.name}"?`)) {
    return;
  }

  // Update card UI to show sending status
  const collectionsContainer = cardElement.querySelector(".collection-pills-container");
  const originalContent = collectionsContainer.innerHTML;
  
  collectionsContainer.innerHTML = `
    <div style="text-align: center; padding: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; color: white;">
      <i class="fas fa-spinner fa-spin"></i> 
      <span id="quick-send-progress-${adId}">Sending to ${collection.name}... 0/${groups.length}</span>
    </div>
  `;

  const progressSpan = document.getElementById(`quick-send-progress-${adId}`);
  const message = ad.whatsappMessage;
  const delayMs = 3000; // 3 second delay between messages

  let successCount = 0;
  let failCount = 0;

  try {
    for (let i = 0; i < groups.length; i++) {
      const groupId = groups[i];
      
      try {
        await fetch("/api/bot/send-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ number: groupId, message }),
        });
        successCount++;
      } catch (err) {
        console.error(`Failed to send to group ${groupId}:`, err);
        failCount++;
      }

      // Update progress
      if (progressSpan) {
        progressSpan.textContent = `Sending to ${collection.name}... ${i + 1}/${groups.length}`;
      }

      // Wait before sending next message (except for last one)
      if (i < groups.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Mark ad as sent to groups
    try {
      await fetch(`/api/bot/ads/${adId}/mark-sent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          groupIds: groups,
          collectionName: collection.name 
        }),
      });
    } catch (err) {
      console.error("Failed to mark ad as sent:", err);
    }

    // Show success message
    collectionsContainer.innerHTML = `
      <div style="text-align: center; padding: 10px; background: #d4edda; border-radius: 8px; color: #155724;">
        <i class="fas fa-check-circle"></i> 
        Sent to ${successCount}/${groups.length} groups in "${collection.name}"!
        ${failCount > 0 ? `<br><small style="color: #856404;">${failCount} failed</small>` : ""}
      </div>
    `;

    // Update card status badge after 2 seconds
    setTimeout(() => {
      cardElement.dataset.status = "sent";
      const statusBadge = cardElement.querySelector('[style*="background: #ffc107"]');
      if (statusBadge) {
        statusBadge.outerHTML = `<span style="background: #28a745; color: white; padding: 3px 8px; border-radius: 4px; font-weight: 500;"><i class="fas fa-check-circle"></i> Sent</span>`;
      }
    }, 2000);

  } catch (error) {
    console.error("Error in quickSendToCollection:", error);
    collectionsContainer.innerHTML = `
      <div style="text-align: center; padding: 10px; background: #f8d7da; border-radius: 8px; color: #721c24;">
        <i class="fas fa-exclamation-circle"></i> Error sending messages
      </div>
    `;
    
    // Restore original content after 3 seconds
    setTimeout(() => {
      collectionsContainer.innerHTML = originalContent;
    }, 3000);
  }
}

// View full ad details from WhatsApp message

function viewFullAdFromWhatsApp(adId) {
  // Switch to ads view and focus on the specific ad
  switchView("ads");
  setTimeout(() => {
    focusOnAd(adId);
  }, 300); // Wait for view switch animation
}

// Handle accept WhatsApp message
async function handleAcceptWhatsAppMessage(adId, ad, cardElement) {
  try {
    // Show loading on the card
    if (cardElement) {
      const actionButtons = cardElement.querySelector("div:last-child");
      if (actionButtons) {
        actionButtons.innerHTML =
          '<div style="text-align: center; padding: 8px; color: #666;"><i class="fas fa-spinner fa-spin"></i> Processing...</div>';
      }
    }

    // Show loading immediately
    const loadingOverlay = document.getElementById("loading-overlay");
    if (loadingOverlay) {
      loadingOverlay.style.display = "flex";
      const loadingText = loadingOverlay.querySelector("p");
      if (loadingText) loadingText.textContent = "⏳ Loading groups...";
    }

    // Check if WhatsApp message exists (means it was already posted to WordPress)
    if (ad.whatsappMessage) {
      console.log("✅ Using WhatsApp message with WordPress link");
      // Open groups preview modal with the message
      await openGroupsPreviewModal(adId, ad.whatsappMessage);
    } else {
      // Need to post to WordPress first to get the link
      console.log(
        "📝 Posting to WordPress first to generate message with link..."
      );

      // Update loading message
      if (loadingOverlay) {
        const loadingText = loadingOverlay.querySelector("p");
        if (loadingText) loadingText.textContent = "📤 Posting to WordPress...";
      }

      const response = await fetch(`/api/bot/ads/${adId}/post-to-wordpress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const data = await response.json();

        if (data.whatsappMessage) {
          console.log(
            "✅ WordPress posted and WhatsApp message generated with link"
          );

          // Update loading message
          if (loadingOverlay) {
            const loadingText = loadingOverlay.querySelector("p");
            if (loadingText) loadingText.textContent = "⏳ Loading groups...";
          }

          // Open groups preview modal with the newly generated message
          await openGroupsPreviewModal(adId, data.whatsappMessage);

          // Reload the view to show updated message
          await loadWhatsAppMessagesView();
        } else {
          if (loadingOverlay) loadingOverlay.style.display = "none";
          alert("Failed to generate WhatsApp message. Please try again.");
        }
      } else {
        if (loadingOverlay) loadingOverlay.style.display = "none";
        const errorData = await response.json();
        alert(
          `Failed to post to WordPress: ${errorData.error || "Unknown error"}`
        );
      }
    }

    // Hide loading overlay (will be hidden by modal opening)
    if (loadingOverlay) {
      loadingOverlay.style.display = "none";
    }
  } catch (error) {
    console.error("Error in handleAcceptWhatsAppMessage:", error);
    const loadingOverlay = document.getElementById("loading-overlay");
    if (loadingOverlay) loadingOverlay.style.display = "none";
    alert("An error occurred. Please try again.");
  }
}

// Handle reject WhatsApp message
async function handleRejectWhatsAppMessage(adId, cardElement) {
  if (
    !confirm(
      "Are you sure you want to reject this message? It will be moved to the recycle bin."
    )
  ) {
    return;
  }

  try {
    // Show loading on the card
    if (cardElement) {
      const actionButtons = cardElement.querySelector("div:last-child");
      if (actionButtons) {
        actionButtons.innerHTML =
          '<div style="text-align: center; padding: 8px; color: #dc3545;"><i class="fas fa-spinner fa-spin"></i> Rejecting...</div>';
      }
    }

    const response = await fetch(`/api/bot/ads/${adId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status: "rejected" }),
    });

    if (response.ok) {
      // Show success on the card and fade it out
      if (cardElement) {
        cardElement.style.cssText += `
          background: #f8d7da;
          border: 2px solid #dc3545;
        `;
        const actionButtons = cardElement.querySelector("div:last-child");
        if (actionButtons) {
          actionButtons.innerHTML =
            '<div style="text-align: center; padding: 8px; color: #dc3545; font-weight: 500;"><i class="fas fa-check-circle"></i> Rejected</div>';
        }

        // Fade out and remove after 1.5 seconds
        setTimeout(() => {
          cardElement.style.transition = "opacity 0.5s";
          cardElement.style.opacity = "0";
          setTimeout(() => {
            cardElement.remove();
            updateWhatsAppMessagesCount();
          }, 500);
        }, 1500);
      }

      const infoEl = document.getElementById("whatsapp-messages-info");
      if (infoEl) {
        infoEl.textContent = "✅ Message rejected and moved to recycle bin";
        infoEl.className = "info-message success";
        infoEl.style.display = "block";

        setTimeout(() => {
          infoEl.style.display = "none";
        }, 3000);
      }
    } else {
      throw new Error("Failed to reject message");
    }
  } catch (err) {
    console.error("Error rejecting message:", err);
    if (cardElement) {
      const actionButtons = cardElement.querySelector("div:last-child");
      if (actionButtons) {
        actionButtons.innerHTML =
          '<div style="text-align: center; padding: 8px; color: #dc3545;">❌ Failed - Try Again</div>';
      }
    }
    alert("Failed to reject message. Please try again.");
  }
}

// ============================================
// PRIVATE CLIENTS FUNCTIONALITY
// ============================================

let allPrivateClients = [];
let filteredPrivateClients = [];
let interestGroups = [];

// ============================================
// INTEREST GROUPS FUNCTIONS
// ============================================

function toggleInterestGroupsSection() {
  const container = document.getElementById("interest-groups-container");
  const icon = document.getElementById("interest-groups-toggle-icon");
  
  if (container.style.display === "none") {
    container.style.display = "block";
    icon.style.transform = "rotate(180deg)";
    fetchInterestGroups();
  } else {
    container.style.display = "none";
    icon.style.transform = "rotate(0deg)";
  }
}

async function fetchInterestGroups() {
  try {
    const response = await fetch("/api/bot/interest-groups", {
      credentials: "include",
    });
    
    if (!response.ok) {
      throw new Error("Failed to fetch interest groups");
    }
    
    const data = await response.json();
    interestGroups = data.groups || [];
    
    document.getElementById("interest-groups-count").textContent = interestGroups.length;
    renderInterestGroups(interestGroups);
  } catch (error) {
    console.error("Error fetching interest groups:", error);
    document.getElementById("interest-groups-list").innerHTML = `
      <div style="text-align: center; padding: 20px; color: #dc3545; grid-column: 1 / -1;">
        <i class="fas fa-exclamation-circle"></i> فشل تحميل المجموعات
      </div>
    `;
  }
}

function renderInterestGroups(groups) {
  const container = document.getElementById("interest-groups-list");
  
  if (!groups || groups.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #666; grid-column: 1 / -1;">
        <i class="fas fa-users" style="font-size: 48px; color: #ddd; margin-bottom: 15px;"></i>
        <h3 style="margin: 0 0 10px 0;">لا توجد مجموعات</h3>
        <p style="margin: 0;">استخدم أمر <strong style="color: #667eea;">مهتم</strong> من واتساب لإنشاء مجموعة</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = groups.map(group => `
    <div class="interest-group-card" style="
      background: white;
      border-radius: 12px;
      padding: 15px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-right: 4px solid #667eea;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div>
          <span style="
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
          ">${group.id}</span>
        </div>
        <div style="display: flex; gap: 5px;">
          <button onclick="toggleGroupMembers('${group.id}')" class="btn btn-sm btn-secondary" title="عرض الأعضاء">
            <i class="fas fa-users"></i>
          </button>
          <button onclick="deleteInterestGroup('${group.id}')" class="btn btn-sm btn-danger" title="حذف">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      
      <div style="font-size: 1.1rem; font-weight: 600; color: #333; margin-bottom: 8px;">
        📌 ${escapeHtml(group.interest)}
      </div>
      
      <div style="display: flex; gap: 15px; font-size: 0.85rem; color: #666;">
        <span><i class="fas fa-users" style="color: #667eea;"></i> ${group.members.length} عضو</span>
        <span><i class="fas fa-calendar" style="color: #667eea;"></i> ${new Date(group.createdAt).toLocaleDateString('en-GB')}</span>
      </div>
      
      <div id="members-${group.id}" style="display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee;">
        ${group.members.map((m, i) => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #f0f0f0;">
            <span>${i + 1}. ${escapeHtml(m.name || 'غير محدد')}</span>
            <a href="https://wa.me/${m.phone}" target="_blank" style="color: #25D366; text-decoration: none;">
              <i class="fab fa-whatsapp"></i> +${m.phone}
            </a>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function toggleGroupMembers(groupId) {
  const membersDiv = document.getElementById(`members-${groupId}`);
  if (membersDiv) {
    membersDiv.style.display = membersDiv.style.display === "none" ? "block" : "none";
  }
}

async function deleteInterestGroup(groupId) {
  if (!confirm(`هل تريد حذف المجموعة ${groupId}؟`)) {
    return;
  }
  
  try {
    const response = await fetch(`/api/bot/interest-groups/${groupId}`, {
      method: "DELETE",
      credentials: "include",
    });
    
    if (response.ok) {
      await fetchInterestGroups();
    } else {
      alert("فشل حذف المجموعة");
    }
  } catch (error) {
    console.error("Error deleting interest group:", error);
    alert("حدث خطأ أثناء الحذف");
  }
}

// Filter interest groups by search term
function filterInterestGroupsBySearch() {
  const search = document.getElementById("pc-search-input")?.value?.toLowerCase().trim() || "";
  
  if (!interestGroups || interestGroups.length === 0) return;
  
  if (!search) {
    // No search term - show all groups
    renderInterestGroups(interestGroups);
    return;
  }
  
  // Filter groups by:
  // - Group ID (e.g., IG001)
  // - Interest text
  // - Member name
  // - Member phone
  const filtered = interestGroups.filter(group => {
    // Check group ID
    if (group.id.toLowerCase().includes(search)) return true;
    
    // Check interest text
    if (group.interest.toLowerCase().includes(search)) return true;
    
    // Check members
    return group.members.some(member => {
      if (member.name && member.name.toLowerCase().includes(search)) return true;
      if (member.phone && member.phone.includes(search)) return true;
      return false;
    });
  });
  
  renderInterestGroups(filtered);
  
  // If search found results in groups, expand the section automatically
  if (filtered.length > 0) {
    const container = document.getElementById("interest-groups-container");
    const icon = document.getElementById("interest-groups-toggle-icon");
    if (container && container.style.display === "none") {
      container.style.display = "block";
      if (icon) icon.style.transform = "rotate(180deg)";
    }
  }
}

async function loadPrivateClientsView() {
  try {
    await fetchPrivateClients();
    // Also update interest groups count
    const countEl = document.getElementById("interest-groups-count");
    if (countEl) {
      try {
        const resp = await fetch("/api/bot/interest-groups", { credentials: "include" });
        if (resp.ok) {
          const data = await resp.json();
          countEl.textContent = data.count || 0;
        }
      } catch (e) { /* ignore */ }
    }
  } catch (error) {
    console.error("Error loading private clients:", error);
  }
}

async function fetchPrivateClients() {
  try {
    const role = document.getElementById("pc-role-filter")?.value || "all";
    const sortBy = document.getElementById("pc-sort-select")?.value || "recent";
    const search = document.getElementById("pc-search-input")?.value || "";

    const params = new URLSearchParams();
    if (role !== "all") params.append("role", role);
    if (sortBy) params.append("sortBy", sortBy);
    if (search.trim()) params.append("search", search.trim());

    const response = await fetch(
      `/api/bot/private-clients?${params.toString()}`,
      {
        credentials: "include",
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        currentUser = null;
        showLogin();
        return;
      }
      throw new Error("Failed to fetch private clients");
    }

    const data = await response.json();
    allPrivateClients = data.clients || [];
    filteredPrivateClients = allPrivateClients;

    // Update stats
    updatePrivateClientsStats(data.stats);

    // Render clients
    renderPrivateClients(filteredPrivateClients);
  } catch (error) {
    console.error("Error fetching private clients:", error);
    document.getElementById("private-clients-list").innerHTML = `
      <div class="no-clients-message">
        <i class="fas fa-exclamation-circle"></i>
        <h3>Failed to load clients</h3>
        <p>Please try again later</p>
      </div>
    `;
  }
}

function updatePrivateClientsStats(stats) {
  if (!stats) return;

  document.getElementById("pc-stat-total").textContent = stats.total || 0;
  document.getElementById("pc-stat-active").textContent = `${
    stats.recentActivity || 0
  } active today`;
  document.getElementById("pc-stat-searcher").textContent =
    stats.byRole?.["باحث"] || 0;
  document.getElementById("pc-stat-owner").textContent =
    stats.byRole?.["مالك"] || 0;

  const others =
    (stats.byRole?.["مستثمر"] || 0) + (stats.byRole?.["وسيط"] || 0);
  document.getElementById("pc-stat-others").textContent = others;
}

function renderPrivateClients(clients) {
  const container = document.getElementById("private-clients-list");

  if (!clients || clients.length === 0) {
    container.innerHTML = `
      <div class="no-clients-message">
        <i class="fas fa-user-slash"></i>
        <h3>No Clients Found</h3>
        <p>No private clients have contacted the bot yet</p>
      </div>
    `;
    return;
  }

  // Create table HTML
  container.innerHTML = `
    <div class="clients-table-wrapper">
      <table class="clients-table">
        <thead>
          <tr>
            <th class="col-expand"></th>
            <th class="col-name">Name</th>
            <th class="col-phone">Phone</th>
            <th class="col-role">Role</th>
            <th class="col-status">Status</th>
            <th class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${clients.map((client) => createClientRow(client)).join("")}
        </tbody>
      </table>
    </div>
  `;

  // Add event listeners
  clients.forEach((client) => {
    const expandBtn = document.getElementById(
      `pc-expand-${client.phoneNumber}`
    );
    const viewBtn = document.getElementById(`pc-view-${client.phoneNumber}`);
    const deleteBtn = document.getElementById(
      `pc-delete-${client.phoneNumber}`
    );
    const whatsappBtn = document.getElementById(
      `pc-whatsapp-${client.phoneNumber}`
    );

    if (expandBtn) {
      expandBtn.addEventListener("click", () =>
        toggleClientDetails(client.phoneNumber)
      );
    }

    if (viewBtn) {
      viewBtn.addEventListener("click", () => editClientDetails(client));
    }

    if (deleteBtn) {
      deleteBtn.addEventListener("click", () =>
        deleteClient(client.phoneNumber)
      );
    }

    if (whatsappBtn) {
      whatsappBtn.addEventListener("click", () => {
        window.open(`https://wa.me/${client.phoneNumber}`, "_blank");
      });
    }
  });
}

function createClientRow(client) {
  const roleClass = getRoleClass(client.role);
  const roleIcon = getRoleIcon(client.role);
  const stateClass = getStateClass(client.state);
  const stateText = getStateText(client.state);

  const lastActivity = client.lastActivity
    ? formatRelativeTime(client.lastActivity)
    : "Never";

  // Format requirements/offer preview
  let requirementsPreview = "";
  const dataToShow = client.propertyOffer || client.requirements;

  if (dataToShow) {
    const label = client.propertyOffer ? "Property Offer" : "Requirements";
    const icon = client.propertyOffer ? "fas fa-home" : "fas fa-clipboard-list";

    let displayHTML = "";

    if (typeof dataToShow === "object" && !Array.isArray(dataToShow)) {
      // Format requirements object nicely
      displayHTML =
        "<div style='display: flex; flex-direction: column; gap: 8px;'>";

      if (dataToShow.propertyType) {
        displayHTML += `<div><strong>🏠 Type:</strong> ${escapeHtml(
          dataToShow.propertyType
        )}</div>`;
      }
      if (dataToShow.purpose) {
        displayHTML += `<div><strong>📋 Purpose:</strong> ${escapeHtml(
          dataToShow.purpose
        )}</div>`;
      }

      // Handle price range (priceMin/priceMax or priceRange)
      if (dataToShow.priceMin != null && dataToShow.priceMax != null) {
        const priceMin = dataToShow.priceMin.toLocaleString();
        const priceMax = dataToShow.priceMax.toLocaleString();
        displayHTML += `<div><strong>💰 Price:</strong> ${priceMin} - ${priceMax} ريال</div>`;
      } else if (dataToShow.priceMax != null) {
        const priceMax = dataToShow.priceMax.toLocaleString();
        displayHTML += `<div><strong>💰 Price:</strong> حتى ${priceMax} ريال</div>`;
      } else if (dataToShow.priceMin != null) {
        const priceMin = dataToShow.priceMin.toLocaleString();
        displayHTML += `<div><strong>💰 Price:</strong> من ${priceMin} ريال</div>`;
      } else if (dataToShow.priceRange) {
        displayHTML += `<div><strong>💰 Price:</strong> ${escapeHtml(
          dataToShow.priceRange
        )}</div>`;
      }

      // Handle area range (areaMin/areaMax or area)
      if (dataToShow.areaMin != null && dataToShow.areaMax != null) {
        displayHTML += `<div><strong>📏 Area:</strong> ${dataToShow.areaMin} - ${dataToShow.areaMax} م²</div>`;
      } else if (dataToShow.areaMax != null) {
        displayHTML += `<div><strong>📏 Area:</strong> حتى ${dataToShow.areaMax} م²</div>`;
      } else if (dataToShow.areaMin != null) {
        displayHTML += `<div><strong>📏 Area:</strong> من ${dataToShow.areaMin} م²</div>`;
      } else if (dataToShow.area) {
        displayHTML += `<div><strong>📏 Area:</strong> ${escapeHtml(
          dataToShow.area
        )} متر</div>`;
      }

      if (dataToShow.neighborhoods && dataToShow.neighborhoods.length > 0) {
        displayHTML += `<div><strong>📍 Neighborhoods:</strong> ${escapeHtml(
          dataToShow.neighborhoods.join(", ")
        )}</div>`;
      }
      if (dataToShow.contactNumber) {
        displayHTML += `<div><strong>📞 Contact:</strong> ${escapeHtml(
          dataToShow.contactNumber
        )}</div>`;
      }

      displayHTML += "</div>";
    } else if (typeof dataToShow === "string") {
      // Display string as-is
      displayHTML = `<pre class="detail-content">${escapeHtml(
        dataToShow
      )}</pre>`;
    } else {
      // Fallback to JSON
      displayHTML = `<pre class="detail-content">${escapeHtml(
        JSON.stringify(dataToShow, null, 2)
      )}</pre>`;
    }

    requirementsPreview = `
      <div class="detail-section">
        <strong><i class="${icon}"></i> ${label}:</strong>
        ${displayHTML}
      </div>
    `;
  }

  return `
    <tr class="client-row" data-phone="${client.phoneNumber}">
      <td class="col-expand">
        <button id="pc-expand-${
          client.phoneNumber
        }" class="btn-expand" title="Show Details">
          <i class="fas fa-plus"></i>
        </button>
      </td>
      <td class="col-name" data-label="Name">${escapeHtml(
        client.name || "Unknown"
      )}</td>
      <td class="col-phone" data-label="Phone">${client.phoneNumber}</td>
      <td class="col-role" data-label="Role">
        <span class="role-badge ${roleClass}">
          <i class="${roleIcon}"></i> ${escapeHtml(client.role || "Unknown")}
        </span>
      </td>
      <td class="col-status" data-label="Status">
        <span class="state-badge ${stateClass}">${stateText}</span>
      </td>
      <td class="col-actions">
        <div class="action-buttons">
          <button id="pc-whatsapp-${
            client.phoneNumber
          }" class="btn-action btn-whatsapp" title="Chat on WhatsApp">
            <i class="fab fa-whatsapp"></i>
          </button>
          <button id="pc-view-${
            client.phoneNumber
          }" class="btn-action btn-edit" title="Edit Client">
            <i class="fas fa-edit"></i>
          </button>
          <button id="pc-delete-${
            client.phoneNumber
          }" class="btn-action btn-delete" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
    <tr class="client-details-row" id="pc-details-${
      client.phoneNumber
    }" style="display: none;">
      <td colspan="6">
        <div class="client-details-content">
          <div class="detail-section">
            <strong><i class="fas fa-clock"></i> Last Active:</strong>
            <span>${lastActivity}</span>
          </div>
          ${requirementsPreview}
        </div>
      </td>
    </tr>
  `;
}

function toggleClientDetails(phoneNumber) {
  const detailsRow = document.getElementById(`pc-details-${phoneNumber}`);
  const expandBtn = document.getElementById(`pc-expand-${phoneNumber}`);

  if (detailsRow.style.display === "none") {
    detailsRow.style.display = "table-row";
    expandBtn.innerHTML = '<i class="fas fa-minus"></i>';
    expandBtn.classList.add("expanded");
  } else {
    detailsRow.style.display = "none";
    expandBtn.innerHTML = '<i class="fas fa-plus"></i>';
    expandBtn.classList.remove("expanded");
  }
}

function getRoleClass(role) {
  const roleMap = {
    باحث: "role-badge-searcher",
    مالك: "role-badge-owner",
    مستثمر: "role-badge-investor",
    وسيط: "role-badge-broker",
  };
  return roleMap[role] || "role-badge-searcher";
}

function getRoleIcon(role) {
  const iconMap = {
    باحث: "fas fa-search",
    مالك: "fas fa-home",
    مستثمر: "fas fa-chart-line",
    وسيط: "fas fa-handshake",
  };
  return iconMap[role] || "fas fa-user";
}

function getStateClass(state) {
  if (state === "completed") return "state-completed";
  if (state === "initial") return "state-initial";
  return "state-awaiting";
}

function getStateText(state) {
  const stateMap = {
    initial: "Initial",
    awaiting_name: "Awaiting Name",
    awaiting_role: "Awaiting Role",
    awaiting_broker_choice: "Awaiting Choice",
    awaiting_requirements: "Awaiting Requirements",
    awaiting_confirmation: "Awaiting Confirmation",
    awaiting_offer: "Awaiting Offer",
    completed: "Completed",
  };
  return stateMap[state] || state;
}

function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} min${minutes > 1 ? "s" : ""} ago`;
  return "Just now";
}

function editClientDetails(client) {
  const modal = document.getElementById("client-details-modal");
  const modalContent = document.getElementById("client-details-content");

  // Build editable form
  let requirementsHTML = "";
  if (client.role === "باحث" && client.requirements) {
    const req =
      typeof client.requirements === "string"
        ? JSON.parse(client.requirements)
        : client.requirements;

    // Format requirements in a nice structured way
    requirementsHTML = `
      <div class="client-detail-section">
        <h3><i class="fas fa-clipboard-list"></i> Client Requirements</h3>
        <div class="requirements-edit-grid">
          <div class="req-field">
            <label><i class="fas fa-home"></i> Property Type:</label>
            <input type="text" id="edit-req-propertyType" class="edit-input" value="${escapeHtml(
              req.propertyType || ""
            )}" placeholder="دبلكس، فيلا، شقة...">
          </div>
          <div class="req-field">
            <label><i class="fas fa-tag"></i> Purpose:</label>
            <select id="edit-req-purpose" class="edit-select">
              <option value="">-- اختر --</option>
              <option value="شراء" ${
                req.purpose === "شراء" ? "selected" : ""
              }>شراء</option>
              <option value="بيع" ${
                req.purpose === "بيع" ? "selected" : ""
              }>بيع</option>
              <option value="إيجار" ${
                req.purpose === "إيجار" ? "selected" : ""
              }>إيجار</option>
            </select>
          </div>
          <div class="req-field">
            <label><i class="fas fa-money-bill-wave"></i> Min Price (ريال):</label>
            <input type="number" id="edit-req-priceMin" class="edit-input" value="${
              req.priceMin || 0
            }" placeholder="0">
          </div>
          <div class="req-field">
            <label><i class="fas fa-money-bill-wave"></i> Max Price (ريال):</label>
            <input type="number" id="edit-req-priceMax" class="edit-input" value="${
              req.priceMax || ""
            }" placeholder="1000000">
          </div>
          <div class="req-field">
            <label><i class="fas fa-ruler-combined"></i> Min Area (م²):</label>
            <input type="number" id="edit-req-areaMin" class="edit-input" value="${
              req.areaMin || 0
            }" placeholder="0">
          </div>
          <div class="req-field">
            <label><i class="fas fa-ruler-combined"></i> Max Area (م²):</label>
            <input type="number" id="edit-req-areaMax" class="edit-input" value="${
              req.areaMax || ""
            }" placeholder="500">
          </div>
          <div class="req-field full-width">
            <label><i class="fas fa-map-marker-alt"></i> Neighborhoods:</label>
            <input type="text" id="edit-req-neighborhoods" class="edit-input" value="${escapeHtml(
              (req.neighborhoods || []).join(", ")
            )}" placeholder="النزهة، الخالدية، العزيزية...">
          </div>
          <div class="req-field full-width">
            <label><i class="fas fa-phone"></i> Contact Number:</label>
            <input type="text" id="edit-req-contactNumber" class="edit-input" value="${escapeHtml(
              req.contactNumber || ""
            )}" placeholder="+966508007053">
          </div>
          <div class="req-field full-width">
            <label><i class="fas fa-info-circle"></i> Additional Specs:</label>
            <textarea id="edit-req-additionalSpecs" class="edit-textarea" rows="3" placeholder="مواصفات إضافية...">${escapeHtml(
              req.additionalSpecs || ""
            )}</textarea>
          </div>
        </div>
      </div>
    `;
  } else if (client.role === "مالك" && client.propertyOffer) {
    const offerText =
      typeof client.propertyOffer === "string"
        ? client.propertyOffer
        : JSON.stringify(client.propertyOffer, null, 2);
    requirementsHTML = `
      <div class="client-detail-section">
        <h3><i class="fas fa-home"></i> Property Offer</h3>
        <textarea id="edit-property-offer" class="edit-textarea" rows="10">${escapeHtml(
          offerText
        )}</textarea>
      </div>
    `;
  }

  // Build the complete modal content with editable fields
  modalContent.innerHTML = `
    <div class="client-detail-section">
      <h3><i class="fas fa-edit"></i> Edit Client Information</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-user"></i> Name</div>
          <input type="text" id="edit-name" class="edit-input" value="${escapeHtml(
            client.name || ""
          )}" placeholder="Client Name">
        </div>
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-phone"></i> Phone Number</div>
          <div class="detail-item-value">${escapeHtml(client.phoneNumber)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-user-tag"></i> Role</div>
          <select id="edit-role" class="edit-select">
            <option value="باحث" ${
              client.role === "باحث" ? "selected" : ""
            }>باحث (Searcher)</option>
            <option value="مالك" ${
              client.role === "مالك" ? "selected" : ""
            }>مالك (Owner)</option>
            <option value="مستثمر" ${
              client.role === "مستثمر" ? "selected" : ""
            }>مستثمر (Investor)</option>
            <option value="وسيط" ${
              client.role === "وسيط" ? "selected" : ""
            }>وسيط (Broker)</option>
          </select>
        </div>
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-flag"></i> State</div>
          <select id="edit-state" class="edit-select">
            <option value="initial" ${
              client.state === "initial" ? "selected" : ""
            }>Initial</option>
            <option value="awaiting_name" ${
              client.state === "awaiting_name" ? "selected" : ""
            }>Awaiting Name</option>
            <option value="awaiting_role" ${
              client.state === "awaiting_role" ? "selected" : ""
            }>Awaiting Role</option>
            <option value="awaiting_requirements" ${
              client.state === "awaiting_requirements" ? "selected" : ""
            }>Awaiting Requirements</option>
            <option value="completed" ${
              client.state === "completed" ? "selected" : ""
            }>Completed</option>
          </select>
        </div>
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-calendar"></i> Created At</div>
          <div class="detail-item-value">${new Date(
            client.createdAt
          ).toLocaleString("ar-EG")}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-clock"></i> Last Updated</div>
          <div class="detail-item-value">${new Date(
            client.lastUpdated
          ).toLocaleString("ar-EG")}</div>
        </div>
      </div>
    </div>

    ${requirementsHTML}

    <div class="modal-actions">
      <button id="save-client-btn" class="btn btn-primary">
        <i class="fas fa-save"></i> Save Changes
      </button>
      <button id="cancel-edit-btn" class="btn btn-secondary">
        <i class="fas fa-times"></i> Cancel
      </button>
    </div>
  `;

  // Show the modal
  modal.style.display = "flex";

  // Save button handler
  const saveBtn = document.getElementById("save-client-btn");
  saveBtn.onclick = async () => {
    const updatedData = {
      name: document.getElementById("edit-name").value.trim(),
      role: document.getElementById("edit-role").value,
      state: document.getElementById("edit-state").value,
    };

    // Get requirements from individual fields if role is باحث
    if (updatedData.role === "باحث") {
      const propertyTypeEl = document.getElementById("edit-req-propertyType");
      const purposeEl = document.getElementById("edit-req-purpose");
      const priceMinEl = document.getElementById("edit-req-priceMin");
      const priceMaxEl = document.getElementById("edit-req-priceMax");
      const areaMinEl = document.getElementById("edit-req-areaMin");
      const areaMaxEl = document.getElementById("edit-req-areaMax");
      const neighborhoodsEl = document.getElementById("edit-req-neighborhoods");
      const contactNumberEl = document.getElementById("edit-req-contactNumber");
      const additionalSpecsEl = document.getElementById(
        "edit-req-additionalSpecs"
      );

      if (propertyTypeEl) {
        // Build requirements object from individual fields
        const neighborhoodsText = neighborhoodsEl.value.trim();
        const neighborhoodsArray = neighborhoodsText
          ? neighborhoodsText
              .split(/[،,]/)
              .map((n) => n.trim())
              .filter((n) => n)
          : [];

        updatedData.requirements = {
          clientName: updatedData.name,
          propertyType: propertyTypeEl.value.trim() || null,
          purpose: purposeEl.value || null,
          priceMin: priceMinEl.value ? parseInt(priceMinEl.value) : null,
          priceMax: priceMaxEl.value ? parseInt(priceMaxEl.value) : null,
          areaMin: areaMinEl.value ? parseInt(areaMinEl.value) : null,
          areaMax: areaMaxEl.value ? parseInt(areaMaxEl.value) : null,
          neighborhoods: neighborhoodsArray,
          contactNumber: contactNumberEl.value.trim() || null,
          additionalSpecs: additionalSpecsEl.value.trim() || null,
        };
      }
    }

    // Get property offer if role is مالك
    const offerTextarea = document.getElementById("edit-property-offer");
    if (offerTextarea) {
      try {
        updatedData.propertyOffer = JSON.parse(offerTextarea.value);
      } catch {
        updatedData.propertyOffer = offerTextarea.value;
      }
    }

    try {
      const response = await fetch(
        `/api/bot/private-clients/${client.phoneNumber}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(updatedData),
        }
      );

      if (!response.ok) throw new Error("Failed to update client");

      const data = await response.json();

      // Show success message
      const msgEl = document.getElementById("pc-message");
      if (msgEl) {
        msgEl.textContent = data.message || "Client updated successfully";
        msgEl.className = "info-message success";
        msgEl.style.display = "block";
        setTimeout(() => {
          msgEl.style.display = "none";
        }, 3000);
      }

      // Close modal and reload
      modal.style.display = "none";
      await fetchPrivateClients();
    } catch (error) {
      console.error("Error updating client:", error);
      alert("Failed to update client. Please try again.");
    }
  };

  // Close modal handlers
  const cancelBtn = document.getElementById("cancel-edit-btn");
  const closeBtn = document.getElementById("close-client-modal");
  const closeModal = () => {
    modal.style.display = "none";
  };

  cancelBtn.onclick = closeModal;
  closeBtn.onclick = closeModal;
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Close on Escape key
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

function viewClientDetails(client) {
  const modal = document.getElementById("client-details-modal");
  const modalContent = document.getElementById("client-details-content");

  // Build the requirements/offer section
  let requirementsHTML = "";
  if (client.role === "باحث" && client.requirements) {
    const reqText =
      typeof client.requirements === "string"
        ? client.requirements
        : JSON.stringify(client.requirements, null, 2);
    requirementsHTML = `
      <div class="client-detail-section">
        <h3><i class="fas fa-clipboard-list"></i> Client Requirements</h3>
        <div class="requirements-text">${escapeHtml(reqText)}</div>
      </div>
    `;
  } else if (client.role === "مالك" && client.propertyOffer) {
    const offerText =
      typeof client.propertyOffer === "string"
        ? client.propertyOffer
        : JSON.stringify(client.propertyOffer, null, 2);
    requirementsHTML = `
      <div class="client-detail-section">
        <h3><i class="fas fa-home"></i> Property Offer</h3>
        <div class="requirements-text">${escapeHtml(offerText)}</div>
      </div>
    `;
  }

  // Build the complete modal content
  modalContent.innerHTML = `
    <div class="client-detail-section">
      <h3><i class="fas fa-info-circle"></i> Client Information</h3>
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-user"></i> Name</div>
          <div class="detail-item-value">${escapeHtml(
            client.name || "Unknown"
          )}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-phone"></i> Phone Number</div>
          <div class="detail-item-value">${escapeHtml(client.phoneNumber)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-user-tag"></i> Role</div>
          <div class="detail-item-value">
            <span class="role-badge role-${client.role}">${escapeHtml(
    client.role || "Unknown"
  )}</span>
          </div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-flag"></i> State</div>
          <div class="detail-item-value">
            <span class="state-badge state-${client.state}">${getStateText(
    client.state
  )}</span>
          </div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-calendar"></i> Created At</div>
          <div class="detail-item-value">${new Date(
            client.createdAt
          ).toLocaleString("ar-EG")}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label"><i class="fas fa-clock"></i> Last Updated</div>
          <div class="detail-item-value">${new Date(
            client.lastUpdated
          ).toLocaleString("ar-EG")}</div>
        </div>
      </div>
    </div>

    ${requirementsHTML}
  `;

  // Show the modal
  modal.style.display = "flex";

  // Close modal handlers
  const closeBtn = document.getElementById("close-client-modal");
  const closeModal = () => {
    modal.style.display = "none";
  };

  closeBtn.onclick = closeModal;
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };

  // Close on Escape key
  const handleEscape = (e) => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", handleEscape);
    }
  };
  document.addEventListener("keydown", handleEscape);
}

async function deleteClient(phoneNumber) {
  if (
    !confirm(
      `Are you sure you want to delete client ${phoneNumber}?\n\nThis action cannot be undone.`
    )
  ) {
    return;
  }

  try {
    const response = await fetch(`/api/bot/private-clients/${phoneNumber}`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!response.ok) throw new Error("Failed to delete client");

    const data = await response.json();

    // Show success message
    const msgEl = document.getElementById("pc-message");
    if (msgEl) {
      msgEl.textContent = data.message || "Client deleted successfully";
      msgEl.className = "info-message success";
      msgEl.style.display = "block";
      setTimeout(() => {
        msgEl.style.display = "none";
      }, 3000);
    }

    // Reload clients
    await fetchPrivateClients();
  } catch (error) {
    console.error("Error deleting client:", error);
    alert("Failed to delete client. Please try again.");
  }
}

// Event listeners for private clients view
document.addEventListener("DOMContentLoaded", () => {
  const pcRefreshBtn = document.getElementById("pc-refresh-btn");
  const pcSearchInput = document.getElementById("pc-search-input");
  const pcRoleFilter = document.getElementById("pc-role-filter");
  const pcSortSelect = document.getElementById("pc-sort-select");

  if (pcRefreshBtn) {
    pcRefreshBtn.addEventListener("click", fetchPrivateClients);
  }

  if (pcSearchInput) {
    let searchTimeout;
    pcSearchInput.addEventListener("input", () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        fetchPrivateClients();
        filterInterestGroupsBySearch();
      }, 500);
    });
  }

  if (pcRoleFilter) {
    pcRoleFilter.addEventListener("change", fetchPrivateClients);
  }

  if (pcSortSelect) {
    pcSortSelect.addEventListener("change", fetchPrivateClients);
  }
});

// ==================== EXCLUDED GROUPS FUNCTIONS ====================

let currentExcludedGroups = [];
let allGroupsForExclusion = [];

async function loadExcludedGroups() {
  const loadBtn = document.getElementById("load-excluded-groups-btn");
  const container = document.getElementById("excluded-groups-container");

  try {
    loadBtn.disabled = true;
    loadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';

    // Fetch current settings
    const settingsRes = await fetch("/api/bot/settings", {
      credentials: "include",
    });
    if (!settingsRes.ok) throw new Error("Failed to fetch settings");
    const settingsData = await settingsRes.json();
    currentExcludedGroups = settingsData.settings.excludedGroups || [];

    // Fetch all groups
    const groupsRes = await fetch("/api/bot/groups/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (!groupsRes.ok) throw new Error("Failed to fetch groups");
    const groupsData = await groupsRes.json();
    allGroupsForExclusion = groupsData.groups || [];

    // Show container and render groups
    container.style.display = "block";
    renderExcludedGroupsList();

    loadBtn.innerHTML = '<i class="fas fa-check"></i> Groups Loaded';
    setTimeout(() => {
      loadBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Reload Groups';
      loadBtn.disabled = false;
    }, 2000);
  } catch (error) {
    console.error("Error loading excluded groups:", error);
    alert("Failed to load groups. Please try again.");
    loadBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Load Groups';
    loadBtn.disabled = false;
  }
}

function renderExcludedGroupsList() {
  const listContainer = document.getElementById("excluded-groups-list");
  const countContainer = document.getElementById("excluded-groups-count");

  if (!listContainer) return;

  if (allGroupsForExclusion.length === 0) {
    listContainer.innerHTML =
      '<p style="color: #999; text-align: center; padding: 2rem;">No groups found</p>';
    countContainer.textContent = "";
    return;
  }

  // Sort groups by name
  const sortedGroups = [...allGroupsForExclusion].sort((a, b) =>
    (a.name || a.jid).localeCompare(b.name || b.jid)
  );

  listContainer.innerHTML = sortedGroups
    .map((group) => {
      const isExcluded = currentExcludedGroups.includes(group.jid);
      const groupName = group.name || group.jid;
      const groupType = group.type || "Group";
      const typeIcon = groupType === "Community" ? "📢" : "👥";

      return `
      <div class="excluded-group-item" data-jid="${
        group.jid
      }" style="padding: 0.75rem; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 0.5rem;">
        <input type="checkbox" 
               class="excluded-group-checkbox" 
               data-jid="${group.jid}" 
               ${isExcluded ? "checked" : ""}
               onchange="handleExcludedGroupToggle('${
                 group.jid
               }', this.checked)"
               style="width: 18px; height: 18px; cursor: pointer;">
        <label style="flex: 1; cursor: pointer; margin: 0; display: flex; align-items: center; gap: 0.5rem;" 
               onclick="document.querySelector('[data-jid=\\'${
                 group.jid
               }\\']').click()">
          <span>${typeIcon}</span>
          <span style="font-weight: 500;">${escapeHtml(groupName)}</span>
          <span style="color: #999; font-size: 0.85rem;">(${groupType})</span>
        </label>
      </div>
    `;
    })
    .join("");

  updateExcludedGroupsCount();
}

function handleExcludedGroupToggle(jid, isChecked) {
  if (isChecked) {
    if (!currentExcludedGroups.includes(jid)) {
      currentExcludedGroups.push(jid);
    }
  } else {
    currentExcludedGroups = currentExcludedGroups.filter((g) => g !== jid);
  }
  updateExcludedGroupsCount();
}

function updateExcludedGroupsCount() {
  const countContainer = document.getElementById("excluded-groups-count");
  if (!countContainer) return;

  const total = allGroupsForExclusion.length;
  const excluded = currentExcludedGroups.length;
  const active = total - excluded;

  countContainer.innerHTML = `
    <strong>${excluded}</strong> group${excluded !== 1 ? "s" : ""} excluded | 
    <strong>${active}</strong> group${active !== 1 ? "s" : ""} active | 
    <strong>${total}</strong> total
  `;
}

function selectAllExcludedGroups() {
  const checkboxes = document.querySelectorAll(".excluded-group-checkbox");
  checkboxes.forEach((cb) => {
    cb.checked = true;
    handleExcludedGroupToggle(cb.dataset.jid, true);
  });
}

function deselectAllExcludedGroups() {
  const checkboxes = document.querySelectorAll(".excluded-group-checkbox");
  checkboxes.forEach((cb) => {
    cb.checked = false;
    handleExcludedGroupToggle(cb.dataset.jid, false);
  });
}

function filterExcludedGroups() {
  const searchInput = document.getElementById("excluded-groups-search");
  if (!searchInput) return;

  const searchTerm = searchInput.value.toLowerCase();
  const items = document.querySelectorAll(".excluded-group-item");

  items.forEach((item) => {
    const jid = item.dataset.jid;
    const group = allGroupsForExclusion.find((g) => g.jid === jid);
    if (!group) {
      item.style.display = "none";
      return;
    }

    const groupName = (group.name || group.jid).toLowerCase();
    const matches = groupName.includes(searchTerm) || jid.includes(searchTerm);
    item.style.display = matches ? "flex" : "none";
  });
}

// ==================== DAILY SUMMARIES VIEW ====================

// Smart Summary Builder State
let smartSummaryFilters = {
  presetPeriod: "today",
  startDate: null,
  endDate: null,
  website: "masaak",
  mainCategories: [],
  subCategories: [],
  sourceGroups: [],
  includeCommercial: true
};
let availableFiltersData = null;

async function loadDailySummariesView() {
  await loadSchedulerStatus();
  await loadDailySummaries();
  initDailySummariesEvents();
  // Initialize Smart Summary Builder
  await initSmartSummaryBuilder();
}

// ==================== SMART SUMMARY BUILDER ====================

async function initSmartSummaryBuilder() {
  try {
    // Load available filters from API
    await loadAvailableFilters();
    
    // Set default dates
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const startDateInput = document.getElementById("smart-start-date");
    const endDateInput = document.getElementById("smart-end-date");
    if (startDateInput) startDateInput.value = todayStr;
    if (endDateInput) endDateInput.value = todayStr;
    
  } catch (error) {
    console.error("Error initializing smart summary builder:", error);
  }
}

async function loadAvailableFilters() {
  try {
    const response = await fetch("/api/bot/daily-summaries/available-filters", {
      credentials: "include",
    });
    
    if (response.ok) {
      const data = await response.json();
      availableFiltersData = data.filters;
      
      // Render category chips
      renderMainCategoryChips();
      
      // Render source groups
      renderSourceGroups();
    }
  } catch (error) {
    console.error("Error loading available filters:", error);
  }
}

function renderMainCategoryChips() {
  const container = document.getElementById("main-category-chips");
  if (!container || !availableFiltersData) return;
  
  const website = smartSummaryFilters.website;
  let categories = [];
  
  if (website === "masaak") {
    categories = availableFiltersData.categories.masaak || [];
  } else if (website === "hasak") {
    categories = availableFiltersData.categories.hasak || [];
  } else {
    // All - combine both
    categories = [
      ...(availableFiltersData.categories.masaak || []),
      ...(availableFiltersData.categories.hasak || [])
    ];
  }
  
  if (categories.length === 0) {
    container.innerHTML = '<span style="color: #999;">لا توجد تصنيفات متاحة</span>';
    return;
  }
  
  container.innerHTML = categories.map(cat => `
    <button type="button" 
            class="category-chip ${smartSummaryFilters.mainCategories.includes(cat.name) ? 'active' : ''}" 
            data-category="${cat.name}"
            onclick="toggleMainCategory('${cat.name}')">
      ${cat.icon || '📁'} ${cat.displayName || cat.name}
    </button>
  `).join("");
  
  updateSelectedCategoriesCount();
}

function toggleMainCategory(categoryName) {
  const index = smartSummaryFilters.mainCategories.indexOf(categoryName);
  if (index > -1) {
    smartSummaryFilters.mainCategories.splice(index, 1);
  } else {
    smartSummaryFilters.mainCategories.push(categoryName);
  }
  
  // Update chip visual
  const chip = document.querySelector(`[data-category="${categoryName}"]`);
  if (chip) {
    chip.classList.toggle("active");
  }
  
  updateSelectedCategoriesCount();
  updateSubcategories();
}

function selectAllCategories() {
  const container = document.getElementById("main-category-chips");
  const chips = container.querySelectorAll(".category-chip");
  
  smartSummaryFilters.mainCategories = [];
  chips.forEach(chip => {
    const catName = chip.dataset.category;
    smartSummaryFilters.mainCategories.push(catName);
    chip.classList.add("active");
  });
  
  updateSelectedCategoriesCount();
  updateSubcategories();
}

function clearAllCategories() {
  const container = document.getElementById("main-category-chips");
  const chips = container.querySelectorAll(".category-chip");
  
  smartSummaryFilters.mainCategories = [];
  chips.forEach(chip => {
    chip.classList.remove("active");
  });
  
  updateSelectedCategoriesCount();
  updateSubcategories();
}

function updateSelectedCategoriesCount() {
  const countSpan = document.getElementById("selected-categories-count");
  if (countSpan) {
    const count = smartSummaryFilters.mainCategories.length;
    countSpan.textContent = count > 0 ? `(${count} محدد)` : "";
  }
}

async function updateSubcategories() {
  const section = document.getElementById("subcategories-section");
  const container = document.getElementById("subcategory-chips");
  
  if (smartSummaryFilters.mainCategories.length === 0) {
    section.style.display = "none";
    smartSummaryFilters.subCategories = [];
    return;
  }
  
  try {
    const response = await fetch("/api/bot/daily-summaries/subcategories", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mainCategories: smartSummaryFilters.mainCategories,
        website: smartSummaryFilters.website
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      const subcategories = data.subcategories || [];
      
      if (subcategories.length > 0) {
        section.style.display = "block";
        container.innerHTML = subcategories.map(sub => `
          <button type="button" 
                  class="subcategory-chip ${smartSummaryFilters.subCategories.includes(sub) ? 'active' : ''}" 
                  data-subcategory="${sub}"
                  onclick="toggleSubcategory('${sub}')">
            ${sub}
          </button>
        `).join("");
      } else {
        section.style.display = "none";
      }
    }
  } catch (error) {
    console.error("Error loading subcategories:", error);
    section.style.display = "none";
  }
}

function toggleSubcategory(subName) {
  const index = smartSummaryFilters.subCategories.indexOf(subName);
  if (index > -1) {
    smartSummaryFilters.subCategories.splice(index, 1);
  } else {
    smartSummaryFilters.subCategories.push(subName);
  }
  
  const chip = document.querySelector(`[data-subcategory="${subName}"]`);
  if (chip) {
    chip.classList.toggle("active");
  }
}

// Source groups state
let selectedSourceGroups = [];

function renderSourceGroups() {
  const listContainer = document.getElementById("source-groups-list");
  const select = document.getElementById("source-groups-filter");
  
  if (!listContainer || !availableFiltersData) return;
  
  const groups = availableFiltersData.sourceGroups || [];
  
  if (groups.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; color: #888; padding: 20px;">
        <i class="fas fa-info-circle" style="font-size: 24px; margin-bottom: 10px;"></i>
        <p style="margin: 0;">لا توجد مجموعات مصدر للإعلانات</p>
      </div>
    `;
    return;
  }
  
  // Sync hidden select
  if (select) {
    select.innerHTML = groups.map(g => 
      `<option value="${g.jid}">${g.name}</option>`
    ).join("");
  }
  
  listContainer.innerHTML = groups.map(g => `
    <label class="source-group-item" data-jid="${g.jid}" data-name="${g.name.toLowerCase()}" 
           style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin-bottom: 4px; 
                  background: #f8f9fa; border-radius: 6px; cursor: pointer; transition: background 0.2s;">
      <input type="checkbox" class="source-group-checkbox" value="${g.jid}" 
             onchange="toggleSourceGroup('${g.jid}')" 
             style="width: 18px; height: 18px; cursor: pointer;">
      <span style="flex: 1; font-size: 14px; color: #333;">${g.name}</span>
      <i class="fas fa-users" style="color: #667eea; font-size: 12px;"></i>
    </label>
  `).join("");
  
  updateSelectedGroupsCount();
}

function toggleSourceGroup(jid) {
  const index = selectedSourceGroups.indexOf(jid);
  if (index > -1) {
    selectedSourceGroups.splice(index, 1);
  } else {
    selectedSourceGroups.push(jid);
  }
  
  updateSelectedGroupsCount();
  syncHiddenSelect();
}

function selectAllSourceGroups() {
  const checkboxes = document.querySelectorAll(".source-group-checkbox");
  selectedSourceGroups = [];
  
  checkboxes.forEach(cb => {
    cb.checked = true;
    if (!selectedSourceGroups.includes(cb.value)) {
      selectedSourceGroups.push(cb.value);
    }
  });
  
  updateSelectedGroupsCount();
  syncHiddenSelect();
}

function clearAllSourceGroups() {
  const checkboxes = document.querySelectorAll(".source-group-checkbox");
  selectedSourceGroups = [];
  
  checkboxes.forEach(cb => {
    cb.checked = false;
  });
  
  updateSelectedGroupsCount();
  syncHiddenSelect();
}

function filterSourceGroups() {
  const searchInput = document.getElementById("source-groups-search");
  const searchTerm = (searchInput?.value || "").toLowerCase().trim();
  const items = document.querySelectorAll(".source-group-item");
  
  items.forEach(item => {
    const name = item.dataset.name || "";
    const matches = name.includes(searchTerm) || searchTerm === "";
    item.style.display = matches ? "flex" : "none";
  });
}

function updateSelectedGroupsCount() {
  const countSpan = document.getElementById("selected-groups-count");
  if (countSpan) {
    const count = selectedSourceGroups.length;
    countSpan.textContent = count > 0 ? `(${count} مجموعة محددة)` : "(الكل)";
  }
}

function syncHiddenSelect() {
  const select = document.getElementById("source-groups-filter");
  if (select) {
    Array.from(select.options).forEach(opt => {
      opt.selected = selectedSourceGroups.includes(opt.value);
    });
  }
}

function selectDatePreset(preset) {
  smartSummaryFilters.presetPeriod = preset;
  
  // Update button states
  document.querySelectorAll(".date-preset-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.preset === preset);
  });
  
  // Show/hide custom date range
  const customRange = document.getElementById("custom-date-range");
  if (customRange) {
    customRange.style.display = preset === "custom" ? "block" : "none";
  }
}

function selectWebsite(website) {
  smartSummaryFilters.website = website;
  
  // Update chip states
  document.querySelectorAll("#website-chips .chip-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.website === website);
  });
  
  // Reset categories when website changes
  smartSummaryFilters.mainCategories = [];
  smartSummaryFilters.subCategories = [];
  
  // Re-render categories
  renderMainCategoryChips();
  updateSubcategories();
}

function toggleSmartSummaryBuilder() {
  const builder = document.getElementById("smart-summary-builder");
  const icon = document.getElementById("smart-builder-toggle-icon");
  
  if (builder.style.display === "none") {
    builder.style.display = "block";
    icon.style.transform = "rotate(0deg)";
  } else {
    builder.style.display = "none";
    icon.style.transform = "rotate(-90deg)";
  }
}

function getSmartSummaryFilters() {
  // Use the selectedSourceGroups array (managed by checkbox UI)
  const selectedGroups = selectedSourceGroups || [];
  
  // Get commercial toggle
  const includeCommercial = document.getElementById("include-commercial")?.checked ?? true;
  
  // Get custom dates if preset is custom
  let startDate = null;
  let endDate = null;
  if (smartSummaryFilters.presetPeriod === "custom") {
    startDate = document.getElementById("smart-start-date")?.value;
    endDate = document.getElementById("smart-end-date")?.value;
  }
  
  return {
    presetPeriod: smartSummaryFilters.presetPeriod,
    startDate: startDate,
    endDate: endDate,
    website: smartSummaryFilters.website || undefined,
    mainCategories: smartSummaryFilters.mainCategories.length > 0 ? smartSummaryFilters.mainCategories : undefined,
    subCategories: smartSummaryFilters.subCategories.length > 0 ? smartSummaryFilters.subCategories : undefined,
    sourceGroups: selectedGroups.length > 0 ? selectedGroups : undefined,
    includeCommercial: includeCommercial
  };
}

async function previewSmartSummary() {
  const previewBtn = document.getElementById("preview-smart-summary-btn");
  const previewCount = document.getElementById("preview-count");
  const messageDiv = document.getElementById("smart-summary-message");
  
  try {
    previewBtn.disabled = true;
    previewBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري المعاينة...';
    
    const filters = getSmartSummaryFilters();
    
    const response = await fetch("/api/bot/daily-summaries/preview", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filters)
    });
    
    if (response.ok) {
      const data = await response.json();
      const count = data.preview?.count || 0;
      
      previewCount.textContent = count;
      previewCount.style.display = "inline";
      
      if (count === 0) {
        messageDiv.textContent = "⚠️ لا توجد إعلانات تطابق الفلاتر المحددة";
        messageDiv.className = "info-message warning";
      } else {
        messageDiv.textContent = `✅ تم العثور على ${count} إعلان(ات) مطابقة`;
        messageDiv.className = "info-message success";
      }
      messageDiv.style.display = "block";
      
      setTimeout(() => {
        messageDiv.style.display = "none";
      }, 5000);
    }
  } catch (error) {
    console.error("Error previewing summary:", error);
    messageDiv.textContent = "❌ حدث خطأ في المعاينة";
    messageDiv.className = "info-message error";
    messageDiv.style.display = "block";
  } finally {
    previewBtn.disabled = false;
    previewBtn.innerHTML = '<i class="fas fa-eye"></i> معاينة <span id="preview-count" style="background: #667eea; color: white; padding: 2px 8px; border-radius: 10px; margin-right: 5px;">' + (document.getElementById("preview-count")?.textContent || '0') + '</span>';
  }
}

async function generateSmartSummary() {
  const generateBtn = document.getElementById("generate-smart-summary-btn");
  const messageDiv = document.getElementById("smart-summary-message");
  
  try {
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإنشاء...';
    
    const filters = getSmartSummaryFilters();
    
    const response = await fetch("/api/bot/daily-summaries/generate-custom", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filters)
    });
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.count === 0) {
        messageDiv.textContent = "⚠️ لا توجد إعلانات تطابق الفلاتر المحددة";
        messageDiv.className = "info-message warning";
      } else {
        messageDiv.textContent = `✅ تم إنشاء ملخص يحتوي على ${data.count} إعلان(ات)`;
        messageDiv.className = "info-message success";
        
        // Reload summaries list
        await loadDailySummaries();
      }
      messageDiv.style.display = "block";
      
      setTimeout(() => {
        messageDiv.style.display = "none";
      }, 5000);
    } else {
      throw new Error("Failed to generate summary");
    }
  } catch (error) {
    console.error("Error generating summary:", error);
    messageDiv.textContent = "❌ حدث خطأ في إنشاء الملخص";
    messageDiv.className = "info-message error";
    messageDiv.style.display = "block";
  } finally {
    generateBtn.disabled = false;
    generateBtn.innerHTML = '<i class="fas fa-magic"></i> إنشاء الملخص الذكي';
  }
}

// Add CSS for smart summary builder
(function addSmartSummaryStyles() {
  const style = document.createElement("style");
  style.textContent = `
    /* Date Preset Buttons */
    .date-preset-btn {
      padding: 8px 16px;
      border: 2px solid #667eea;
      background: white;
      color: #667eea;
      border-radius: 20px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.3s ease;
      font-weight: 500;
    }
    .date-preset-btn:hover {
      background: #f0f0ff;
    }
    .date-preset-btn.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-color: transparent;
    }
    
    /* Website Chips */
    .chip-btn {
      padding: 10px 20px;
      border: 2px solid #ddd;
      background: white;
      color: #333;
      border-radius: 25px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.3s ease;
      font-weight: 500;
    }
    .chip-btn:hover {
      border-color: #667eea;
      background: #f8f9fa;
    }
    .chip-btn.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-color: transparent;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }
    
    /* Category Chips */
    .category-chip {
      padding: 6px 14px;
      border: 1px solid #ddd;
      background: white;
      color: #555;
      border-radius: 16px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s ease;
    }
    .category-chip:hover {
      border-color: #667eea;
      background: #f0f0ff;
    }
    .category-chip.active {
      background: #667eea;
      color: white;
      border-color: #667eea;
    }
    
    /* Subcategory Chips */
    .subcategory-chip {
      padding: 5px 12px;
      border: 1px solid #f0ad4e;
      background: white;
      color: #856404;
      border-radius: 12px;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.2s ease;
    }
    .subcategory-chip:hover {
      background: #fff3cd;
    }
    .subcategory-chip.active {
      background: #f0ad4e;
      color: white;
    }
    
    /* Smart filter section RTL support */
    .smart-filter-section {
      direction: rtl;
      text-align: right;
    }
  `;
  document.head.appendChild(style);
})();

async function loadSchedulerStatus() {
  try {
    const response = await fetch("/api/bot/daily-summaries/scheduler-status", {
      credentials: "include",
    });

    if (response.ok) {
      const data = await response.json();
      const status = data.status;

      document.getElementById("scheduler-running").textContent = status.running
        ? "✓ Running"
        : "✗ Stopped";
      document.getElementById("scheduler-running").style.color = status.running
        ? "#4caf50"
        : "#f44336";
      document.getElementById("scheduler-schedule").textContent =
        status.schedule || "-";
      document.getElementById("scheduler-ksa-time").textContent =
        status.currentKSATime || "-";
    }
  } catch (error) {
    console.error("Error loading scheduler status:", error);
  }
}

async function loadDailySummaries() {
  const listContainer = document.getElementById("summaries-list");
  listContainer.innerHTML = `
    <div style="text-align: center; padding: 30px; color: #999;">
      <i class="fas fa-spinner fa-spin" style="font-size: 2rem;"></i>
      <p style="margin-top: 10px;">Loading summaries...</p>
    </div>
  `;

  try {
    const response = await fetch("/api/bot/daily-summaries", {
      credentials: "include",
    });

    if (response.ok) {
      const data = await response.json();
      displayDailySummaries(data.summaries, data.stats);
    } else {
      throw new Error("Failed to load summaries");
    }
  } catch (error) {
    console.error("Error loading summaries:", error);
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #999;">
        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: #f44336;"></i>
        <p style="margin-top: 10px;">Failed to load summaries</p>
      </div>
    `;
  }
}

function displayDailySummaries(summaries, stats) {
  const listContainer = document.getElementById("summaries-list");

  // Update stats
  if (stats) {
    document.getElementById("summary-total").textContent = stats.total || 0;
    document.getElementById("summary-today").textContent = stats.today || 0;
    document.getElementById("summary-today-ads").textContent =
      stats.todayAdsCount || 0;
  }

  if (!summaries || summaries.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #999;">
        <i class="fas fa-inbox" style="font-size: 3rem; opacity: 0.5;"></i>
        <p style="margin-top: 15px; font-size: 1.1rem;">No summaries available</p>
        <p style="font-size: 0.9rem;">Summaries are generated automatically at 11:30 PM KSA time</p>
      </div>
    `;
    return;
  }

  // Group summaries by date
  const groupedByDate = {};
  summaries.forEach((summary) => {
    if (!groupedByDate[summary.date]) {
      groupedByDate[summary.date] = [];
    }
    groupedByDate[summary.date].push(summary);
  });

  // Build HTML
  let html = "";
  Object.keys(groupedByDate)
    .sort()
    .reverse()
    .forEach((date, dateIndex) => {
      const dateSummaries = groupedByDate[date];
      const arabicDate = new Date(date).toLocaleDateString("ar-EG", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const dateId = `date-${date.replace(/\//g, "-")}`;
      const isFirstDate = dateIndex === 0;

      html += `
        <div class="day-section" style="margin-bottom: 30px;" data-date="${date}">
          <div class="day-header" 
               style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 20px; border-radius: 8px; margin-bottom: 15px; font-weight: bold; font-size: 1.1rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: all 0.3s ease;"
               onclick="toggleDaySection('${dateId}')">
            <div style="display: flex; align-items: center; gap: 10px;">
              <i class="fas fa-chevron-down day-toggle-icon" id="toggle-${dateId}" style="transition: transform 0.3s; ${
        isFirstDate ? "" : "transform: rotate(-90deg);"
      }"></i>
              <span><i class="fas fa-calendar-day"></i> ${arabicDate}</span>
              <span style="background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 15px; font-size: 0.85rem;">
                ${dateSummaries.length} ${
        dateSummaries.length === 1 ? "summary" : "summaries"
      }
              </span>
            </div>
          </div>
          <div class="day-content" id="${dateId}" style="display: ${
        isFirstDate ? "block" : "none"
      };">
      `;

      dateSummaries.forEach((summary) => {
        const websiteColor =
          summary.website === "masaak" ? "#4caf50" : "#ff9800";
        const websiteName =
          summary.website === "masaak" ? "🔰 مسعاك" : "🌴 حساك";
        const isSent = summary.sent === true;
        const sentBadge = isSent
          ? '<span style="background: #4caf50; color: white; padding: 4px 12px; border-radius: 15px; font-size: 0.8rem;"><i class="fas fa-check-circle"></i> Sent</span>'
          : '<span style="background: #ff9800; color: white; padding: 4px 12px; border-radius: 15px; font-size: 0.8rem;"><i class="fas fa-clock"></i> Pending</span>';

        html += `
          <div class="card summary-card" style="margin-bottom: 15px; cursor: pointer; transition: all 0.3s ease; border-left: 4px solid ${websiteColor};" 
               onclick="toggleSummaryDetails('${summary.id}')" 
               data-summary-id="${summary.id}">
            <div class="card-body">
              <!-- Collapsed Header -->
              <div class="summary-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 15px; flex: 1;">
                  <i class="fas fa-chevron-right summary-toggle-icon" id="toggle-icon-${
                    summary.id
                  }" style="color: #999; transition: transform 0.3s;"></i>
                  <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 5px;">
                      <h3 style="margin: 0; font-size: 1.1rem; color: #333;">${
                        summary.categoryName
                      }</h3>
                      ${sentBadge}
                    </div>
                    <div style="display: flex; gap: 15px; color: #666; font-size: 0.85rem;">
                      <span><i class="fas fa-ad"></i> ${
                        summary.adsCount
                      } ads</span>
                      <span><i class="fas fa-clock"></i> ${new Date(
                        summary.createdAt
                      ).toLocaleTimeString("ar-SA", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}</span>
                      ${
                        isSent
                          ? `<span><i class="fas fa-paper-plane"></i> Sent ${new Date(
                              summary.sentAt
                            ).toLocaleTimeString("ar-SA", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}</span>`
                          : ""
                      }
                    </div>
                  </div>
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="background: ${websiteColor}; color: white; padding: 6px 18px; border-radius: 20px; font-size: 0.85rem; font-weight: bold;">
                      ${websiteName}
                    </span>
                    <button class="btn btn-sm ${
                      isSent ? "btn-warning" : "btn-primary"
                    }" 
                            onclick="event.stopPropagation(); sendSummaryToGroups('${
                              summary.id
                            }')"
                            style="white-space: nowrap;">
                      <i class="fas ${
                        isSent ? "fa-redo" : "fa-paper-plane"
                      }"></i> ${isSent ? "Resend" : "Send"}
                    </button>
                  </div>
                </div>
              </div>

              <!-- Expanded Details (hidden by default) -->
              <div class="summary-details" id="details-${
                summary.id
              }" style="display: none; margin-top: 20px; padding-top: 20px; border-top: 2px solid #e0e0e0;">
                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; white-space: pre-wrap; direction: rtl; text-align: right; font-family: Arial, sans-serif; line-height: 1.8; margin-bottom: 20px; border: 1px solid #e0e0e0;">
                  ${summary.message}
                </div>
                
                ${
                  isSent
                    ? `
                  <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #4caf50;">
                    <strong style="color: #2e7d32;"><i class="fas fa-info-circle"></i> Delivery Info:</strong>
                    <div style="margin-top: 8px; color: #1b5e20; font-size: 0.9rem;">
                      ${
                        summary.sentToGroups && summary.sentToGroups.length > 0
                          ? `
                        <div style="margin-bottom: 5px;">
                          <i class="fas fa-users"></i> Sent to ${summary.sentToGroups.length} group(s)
                        </div>
                      `
                          : ""
                      }
                      ${
                        summary.sentToNumbers &&
                        summary.sentToNumbers.length > 0
                          ? `
                        <div>
                          <i class="fas fa-phone"></i> Sent to ${summary.sentToNumbers.length} custom number(s)
                        </div>
                      `
                          : ""
                      }
                    </div>
                  </div>
                `
                    : ""
                }
                
              </div>
            </div>
          </div>
        `;
      });

      html += `</div></div>`;
    });

  listContainer.innerHTML = html;
}

function initDailySummariesEvents() {
  // Trigger summary button
  const triggerBtn = document.getElementById("trigger-summary-btn");
  const refreshBtn = document.getElementById("refresh-summaries-btn");
  const messageDiv = document.getElementById("trigger-message");
  const websiteFilter = document.getElementById("filter-website");
  const categoryFilter = document.getElementById("filter-category");

  if (triggerBtn) {
    triggerBtn.onclick = async () => {
      const website = websiteFilter?.value || "";
      const category = categoryFilter?.value || "";

      let confirmMsg = "Generate daily summary now?";
      if (website || category) {
        confirmMsg = `Generate summary for:\n`;
        if (website)
          confirmMsg += `Website: ${
            website === "masaak" ? "🔰 Masaak" : "🌴 Hasak"
          }\n`;
        if (category) {
          const catLabel =
            categoryFilter.options[categoryFilter.selectedIndex].text;
          confirmMsg += `Category: ${catLabel}`;
        }
      }

      if (!confirm(confirmMsg)) return;

      triggerBtn.disabled = true;
      triggerBtn.innerHTML =
        '<i class="fas fa-spinner fa-spin"></i> Generating...';
      messageDiv.style.display = "none";

      try {
        const body = {};
        if (website) body.website = website;
        if (category) body.category = category;

        const response = await fetch("/api/bot/daily-summaries/trigger", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.count === 0) {
            messageDiv.textContent = `ℹ️ ${data.message}`;
            messageDiv.className = "info-message";
          } else {
            messageDiv.textContent = `✅ Summary generated successfully! ${data.count} summaries created.`;
            messageDiv.className = "info-message success";
          }
          messageDiv.style.display = "block";
          await loadDailySummaries();
          await loadSchedulerStatus();
        } else {
          throw new Error("Failed to trigger summary");
        }
      } catch (error) {
        console.error("Error triggering summary:", error);
        messageDiv.textContent = "❌ Failed to generate summary";
        messageDiv.className = "info-message error";
        messageDiv.style.display = "block";
      } finally {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML =
          '<i class="fas fa-play-circle"></i> Generate Summary Now';
      }
    };
  }

  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      await loadSchedulerStatus();
      await loadDailySummaries();
    };
  }
}

// Toggle day section (expand/collapse)
function toggleDaySection(dateId) {
  const contentDiv = document.getElementById(dateId);
  const toggleIcon = document.getElementById(`toggle-${dateId}`);

  if (contentDiv.style.display === "none") {
    contentDiv.style.display = "block";
    toggleIcon.style.transform = "rotate(0deg)";
  } else {
    contentDiv.style.display = "none";
    toggleIcon.style.transform = "rotate(-90deg)";
  }
}

// Toggle summary details (expand/collapse)
function toggleSummaryDetails(summaryId) {
  const detailsDiv = document.getElementById(`details-${summaryId}`);
  const toggleIcon = document.getElementById(`toggle-icon-${summaryId}`);
  const card = document.querySelector(`[data-summary-id="${summaryId}"]`);

  if (detailsDiv.style.display === "none" || detailsDiv.style.display === "") {
    // Expand
    detailsDiv.style.display = "block";
    toggleIcon.style.transform = "rotate(90deg)";
    card.style.background = "#f8f9fa";
    card.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
  } else {
    // Collapse
    detailsDiv.style.display = "none";
    toggleIcon.style.transform = "rotate(0deg)";
    card.style.background = "white";
    card.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)";
  }
}

// Send summary to groups
async function sendSummaryToGroups(summaryId) {
  try {
    // Fetch the specific summary
    const response = await fetch("/api/bot/daily-summaries", {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Failed to fetch summaries");
    }

    const data = await response.json();
    const summary = data.summaries.find((s) => s.id === summaryId);

    if (!summary) {
      alert("Summary not found");
      return;
    }

    // Open the groups preview modal (same as WhatsApp messages)
    await openGroupsPreviewModalForSummary(summary);
  } catch (error) {
    console.error("Error preparing to send summary:", error);
    alert("Failed to prepare summary for sending");
  }
}

// Open groups preview modal for summary
async function openGroupsPreviewModalForSummary(summary) {
  try {
    const modal = document.getElementById("groups-preview-modal");
    if (!modal) return;

    // Set the message preview
    const messageTextarea = document.getElementById("groups-preview-message");
    if (messageTextarea) {
      messageTextarea.value = summary.message;
    }

    // Store summary ID on modal
    modal.dataset.summaryId = summary.id;

    // Reset selections
    if (typeof selectedCustomNumbers !== "undefined") {
      selectedCustomNumbers = [];
    }

    // Show modal immediately
    modal.style.display = "block";

    // Show loading state
    const groupsList = document.getElementById("groups-preview-list");
    if (groupsList) {
      groupsList.innerHTML =
        '<p style="padding: 20px; text-align: center; color: #666;">⏳ Loading groups...</p>';
    }

    // Load data in background
    try {
      // Load saved custom numbers first
      if (typeof loadSavedCustomNumbers === "function") {
        await loadSavedCustomNumbers();
      }

      // Load groups and collections using the function from ad-details-flow.js
      if (typeof loadGroupsAndCollections === "function") {
        await loadGroupsAndCollections();
      }

      // Render custom numbers list for manually added numbers
      if (typeof renderGroupsPreviewCustomNumbersList === "function") {
        renderGroupsPreviewCustomNumbersList();
      }
    } catch (error) {
      console.error("Error loading groups:", error);
      if (groupsList) {
        groupsList.innerHTML =
          '<p style="padding: 20px; text-align: center; color: red;">❌ Failed to load groups. Please try again.</p>';
      }
    }

    // Wire send button
    document.getElementById("groups-preview-send").onclick =
      sendSummaryFromPreview;
    document.getElementById("groups-preview-cancel").onclick = () => {
      modal.style.display = "none";
    };
    document.getElementById("close-groups-preview-modal").onclick = () => {
      modal.style.display = "none";
    };

    // Wire refresh button
    const refreshBtn = document.getElementById("refresh-groups-modal-btn");
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML =
          '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
        if (typeof loadGroupsAndCollections === "function") {
          await loadGroupsAndCollections(true);
        }
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
      };
    }

    // Wire manage collections button
    const manageBtn = document.getElementById("manage-collections-modal-btn");
    if (manageBtn) {
      manageBtn.onclick = () => {
        modal.style.display = "none";
        switchView("settings");
      };
    }
  } catch (err) {
    console.error("Error loading modal data:", err);
    const groupsListDiv = document.getElementById("groups-preview-list");
    if (groupsListDiv) {
      groupsListDiv.innerHTML =
        '<div class="error-message">Failed to load groups</div>';
    }
  }
}

// Send summary from preview modal
async function sendSummaryFromPreview() {
  try {
    const modal = document.getElementById("groups-preview-modal");
    const summaryId = modal.dataset.summaryId;

    if (!summaryId) {
      alert("No summary selected");
      return;
    }

    // Get selected groups (includes both regular groups and saved custom numbers)
    const groupCheckboxes = document.querySelectorAll(
      "#groups-preview-list .group-checkbox:checked"
    );
    const selectedGroups = Array.from(groupCheckboxes).map((cb) => cb.value);

    // Get saved custom numbers that are checked
    const savedNumberCheckboxes = document.querySelectorAll(
      "#groups-preview-list .custom-number-checkbox:checked"
    );
    const savedNumbers = Array.from(savedNumberCheckboxes).map((cb) => ({
      phone: cb.value,
      name: cb.dataset.name,
    }));

    // Get manually added custom numbers
    const manualNumbers = selectedCustomNumbers || [];

    // Combine all custom numbers
    const allCustomNumbers = [...savedNumbers, ...manualNumbers];

    if (selectedGroups.length === 0 && allCustomNumbers.length === 0) {
      alert("Please select at least one group or custom number");
      return;
    }

    // Get edited message from textarea
    const messageTextarea = document.getElementById("groups-preview-message");
    const customMessage = messageTextarea ? messageTextarea.value : null;

    // Get delay setting
    const delayInput = document.getElementById("send-delay");
    const delay = delayInput ? parseInt(delayInput.value) : 3;

    const sendBtn = document.getElementById("groups-preview-send");
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }

    // Close modal first
    modal.style.display = "none";

    // Show loading overlay with status
    const totalRecipients = selectedGroups.length + allCustomNumbers.length;
    if (typeof showLoadingOverlay === "function") {
      showLoadingOverlay(
        `Sending daily summary to ${totalRecipients} recipient(s)...`,
        "Sending Messages"
      );
    }

    // Send summary to API (including the edited message)
    const response = await fetch(`/api/bot/daily-summaries/${summaryId}/send`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        selectedGroups,
        customNumbers: allCustomNumbers.map((n) => n.phone),
        delay,
        customMessage, // Send the edited message to the backend
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();

      // Hide loading overlay
      if (typeof hideLoadingOverlay === "function") {
        hideLoadingOverlay();
      }

      // Show user-friendly error message
      let errorMessage = errorData.error || "Failed to send summary";
      if (errorData.message) {
        errorMessage = errorData.message;
      }

      throw new Error(errorMessage);
    }

    const result = await response.json();

    // Show success notification with detailed results
    let successMessage = `✅ Daily summary sent successfully to ${result.sentCount} of ${totalRecipients} recipient(s)!`;

    if (result.failedCount && result.failedCount > 0) {
      successMessage = `⚠️ Daily summary sent to ${result.sentCount} of ${totalRecipients} recipient(s). ${result.failedCount} failed (check console for details).`;
    }

    if (typeof showSuccessStatus === "function") {
      showSuccessStatus(successMessage);
    } else {
      // Fallback to hide overlay and show alert
      if (typeof hideLoadingOverlay === "function") {
        hideLoadingOverlay();
      }
      alert(successMessage);
    }

    // Reload summaries
    await loadDailySummariesView();
  } catch (error) {
    console.error("Error sending summary:", error);

    // Hide loading overlay if still showing
    if (typeof hideLoadingOverlay === "function") {
      hideLoadingOverlay();
    }

    // Show error with proper formatting
    alert(`❌ Failed to send summary:\n\n${error.message}`);
  } finally {
    const sendBtn = document.getElementById("groups-preview-send");
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Messages';
    }
  }
}

// ==================== END OF FILE ====================

// Add CSS for highlight animation
const style = document.createElement("style");
style.textContent = `
  @keyframes highlight {
    0% { background-color: #f9f9f9; }
    50% { background-color: #fff3cd; }
    100% { background-color: #f9f9f9; }
  }
  
  .summary-card {
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }
  
  .summary-card:hover {
    box-shadow: 0 4px 8px rgba(0,0,0,0.15);
    transform: translateY(-2px);
  }
  
  .summary-toggle-icon {
    min-width: 16px;
  }
  
  .day-header:hover {
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    transform: translateY(-2px);
  }
  
  .day-toggle-icon {
    min-width: 20px;
  }
`;
document.head.appendChild(style);
