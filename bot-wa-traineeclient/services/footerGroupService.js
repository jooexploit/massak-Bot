/**
 * Footer Group Service
 * Manages footer message groups with rotation logic for WhatsApp messages
 * Each website (masaak, hasak) can have multiple groups with multiple messages
 * Rotation ensures all groups and all messages within each group are used fairly
 */

const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const { getDataPath } = require("../config/dataPath");

const FOOTER_GROUPS_FILE = getDataPath("footer_groups.json");

// In-memory storage
let footerData = {
  masaak: {
    groups: [],
    rotationState: {
      usedGroupIds: [],
      lastGroupId: null,
      totalMessagesSent: 0,
    },
  },
  hasak: {
    groups: [],
    rotationState: {
      usedGroupIds: [],
      lastGroupId: null,
      totalMessagesSent: 0,
    },
  },
};

// Default footer messages (fallback when no groups exist)
const DEFAULT_FOOTERS = {
  masaak: `┈┉━━🔰 *مسعاك العقارية* 🔰━━┅┄
⭕ إبراء للذمة التواصل فقط مع مسعاك عند الشراء أو إذا عندك مشتري ✅ نتعاون مع جميع الوسطاء`,
  hasak: `┈┉━🔰 *منصة 🌴حساك* 🔰━┅┄
*✅إنضم في منصة حساك* 
https://chat.whatsapp.com/Ge3nhVs0MFT0ILuqDmuGYd?mode=ems_copy_t
 *✅للإعلانات في منصة حساك* 
0507667103`,
};

// ========================================
// DATA INITIALIZATION
// ========================================

/**
 * Initialize footer groups data file
 */
async function initFooterGroups() {
  try {
    try {
      const data = await fs.readFile(FOOTER_GROUPS_FILE, "utf8");
      const parsed = JSON.parse(data);
      footerData = {
        masaak: parsed.masaak || footerData.masaak,
        hasak: parsed.hasak || footerData.hasak,
      };

      // Ensure rotationState exists for each website
      ["masaak", "hasak"].forEach((website) => {
        if (!footerData[website].rotationState) {
          footerData[website].rotationState = {
            usedGroupIds: [],
            lastGroupId: null,
            totalMessagesSent: 0,
          };
        }
        // Ensure usedMessages exists for each group
        footerData[website].groups.forEach((group) => {
          if (!group.usedMessages) {
            group.usedMessages = [];
          }
        });
      });
    } catch (error) {
      // File doesn't exist, create with defaults
      await saveFooterGroups();
    }

    const masaakCount = footerData.masaak.groups.length;
    const hasakCount = footerData.hasak.groups.length;
    console.log(
      `📝 Footer Groups: Loaded ${masaakCount} Masaak groups, ${hasakCount} Hasak groups`,
    );
  } catch (error) {
    console.error("❌ Error initializing footer groups:", error);
  }
}

/**
 * Save footer groups to file
 */
async function saveFooterGroups() {
  try {
    await fs.writeFile(FOOTER_GROUPS_FILE, JSON.stringify(footerData, null, 2));
  } catch (error) {
    console.error("❌ Error saving footer groups:", error);
    throw error;
  }
}

// ========================================
// GROUP CRUD OPERATIONS
// ========================================

/**
 * Get all groups for a website
 * @param {string} website - 'masaak' or 'hasak'
 */
function getGroups(website) {
  if (!footerData[website]) {
    return { groups: [], rotationState: {} };
  }
  return {
    groups: footerData[website].groups,
    rotationState: footerData[website].rotationState,
  };
}

/**
 * Get a single group by ID
 * @param {string} website - 'masaak' or 'hasak'
 * @param {string} groupId - Group ID
 */
function getGroupById(website, groupId) {
  if (!footerData[website]) return null;
  return footerData[website].groups.find((g) => g.id === groupId);
}

/**
 * Create a new group
 * @param {string} website - 'masaak' or 'hasak'
 * @param {object} data - Group data { name, messages? }
 */
async function createGroup(website, data) {
  if (!footerData[website]) {
    throw new Error(`Invalid website: ${website}`);
  }

  const group = {
    id: `grp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    name: data.name || "مجموعة جديدة",
    enabled: data.enabled !== false,
    messages: (data.messages || []).map((msg) => ({
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      text: msg.text || msg,
      createdAt: new Date().toISOString(),
    })),
    usedMessages: [],
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  footerData[website].groups.push(group);
  await saveFooterGroups();

  console.log(`✅ Created footer group: ${group.name} (${website})`);
  return group;
}

/**
 * Update a group
 * @param {string} website - 'masaak' or 'hasak'
 * @param {string} groupId - Group ID
 * @param {object} data - Updated data
 */
async function updateGroup(website, groupId, data) {
  if (!footerData[website]) {
    throw new Error(`Invalid website: ${website}`);
  }

  const index = footerData[website].groups.findIndex((g) => g.id === groupId);
  if (index === -1) {
    throw new Error("Group not found");
  }

  const group = footerData[website].groups[index];

  if (data.name !== undefined) group.name = data.name;
  if (data.enabled !== undefined) group.enabled = data.enabled;
  if (data.messages !== undefined) {
    // Update messages while preserving IDs for existing ones
    group.messages = data.messages.map((msg) => {
      if (msg.id) {
        // Existing message
        return {
          ...msg,
          updatedAt: new Date().toISOString(),
        };
      } else {
        // New message
        return {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          text: msg.text || msg,
          createdAt: new Date().toISOString(),
        };
      }
    });
  }
  group.updatedAt = new Date().toISOString();

  await saveFooterGroups();
  console.log(`✅ Updated footer group: ${group.name} (${website})`);
  return group;
}

/**
 * Delete a group
 * @param {string} website - 'masaak' or 'hasak'
 * @param {string} groupId - Group ID
 */
async function deleteGroup(website, groupId) {
  if (!footerData[website]) {
    throw new Error(`Invalid website: ${website}`);
  }

  const index = footerData[website].groups.findIndex((g) => g.id === groupId);
  if (index === -1) {
    throw new Error("Group not found");
  }

  const group = footerData[website].groups.splice(index, 1)[0];

  // Remove from rotation state if present
  const rotState = footerData[website].rotationState;
  rotState.usedGroupIds = rotState.usedGroupIds.filter((id) => id !== groupId);
  if (rotState.lastGroupId === groupId) {
    rotState.lastGroupId = null;
  }

  await saveFooterGroups();
  console.log(`🗑️ Deleted footer group: ${group.name} (${website})`);
  return true;
}

// ========================================
// MESSAGE CRUD OPERATIONS
// ========================================

/**
 * Add a message to a group
 * @param {string} website - 'masaak' or 'hasak'
 * @param {string} groupId - Group ID
 * @param {string} text - Message text
 */
async function addMessage(website, groupId, text) {
  const group = getGroupById(website, groupId);
  if (!group) {
    throw new Error("Group not found");
  }

  const message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    text: text,
    createdAt: new Date().toISOString(),
  };

  group.messages.push(message);
  group.updatedAt = new Date().toISOString();

  await saveFooterGroups();
  console.log(`✅ Added message to group: ${group.name}`);
  return message;
}

/**
 * Update a message in a group
 * @param {string} website - 'masaak' or 'hasak'
 * @param {string} groupId - Group ID
 * @param {string} messageId - Message ID
 * @param {string} text - New message text
 */
async function updateMessage(website, groupId, messageId, text) {
  const group = getGroupById(website, groupId);
  if (!group) {
    throw new Error("Group not found");
  }

  const message = group.messages.find((m) => m.id === messageId);
  if (!message) {
    throw new Error("Message not found");
  }

  message.text = text;
  message.updatedAt = new Date().toISOString();
  group.updatedAt = new Date().toISOString();

  await saveFooterGroups();
  return message;
}

/**
 * Delete a message from a group
 * @param {string} website - 'masaak' or 'hasak'
 * @param {string} groupId - Group ID
 * @param {string} messageId - Message ID
 */
async function deleteMessage(website, groupId, messageId) {
  const group = getGroupById(website, groupId);
  if (!group) {
    throw new Error("Group not found");
  }

  const index = group.messages.findIndex((m) => m.id === messageId);
  if (index === -1) {
    throw new Error("Message not found");
  }

  group.messages.splice(index, 1);

  // Remove from used messages if present
  group.usedMessages = group.usedMessages.filter((id) => id !== messageId);
  group.updatedAt = new Date().toISOString();

  await saveFooterGroups();
  return true;
}

// ========================================
// ROTATION LOGIC
// ========================================

/**
 * Get next footer message using rotation algorithm
 * Ensures all groups are used before repeating, and all messages in each group are used
 * @param {string} website - 'masaak' or 'hasak'
 * @returns {string} - Footer message text
 */
async function getNextFooter(website) {
  if (!footerData[website]) {
    console.log(`⚠️ Invalid website: ${website}, using default footer`);
    return DEFAULT_FOOTERS[website] || DEFAULT_FOOTERS.masaak;
  }

  // Get enabled groups only
  const enabledGroups = footerData[website].groups.filter(
    (g) => g.enabled && g.messages.length > 0,
  );

  if (enabledGroups.length === 0) {
    console.log(
      `📝 No enabled footer groups for ${website}, using default footer`,
    );
    return DEFAULT_FOOTERS[website];
  }

  const rotState = footerData[website].rotationState;

  // Find groups not yet used in this cycle
  let availableGroups = enabledGroups.filter(
    (g) => !rotState.usedGroupIds.includes(g.id),
  );

  // If all groups have been used, reset the cycle
  if (availableGroups.length === 0) {
    console.log(`🔄 All footer groups used for ${website}, resetting cycle`);
    rotState.usedGroupIds = [];
    availableGroups = enabledGroups;
  }

  // Pick a random group from available ones
  const randomIndex = Math.floor(Math.random() * availableGroups.length);
  const selectedGroup = availableGroups[randomIndex];

  // Find messages not yet used in this group
  let availableMessages = selectedGroup.messages.filter(
    (m) => !selectedGroup.usedMessages.includes(m.id),
  );

  // If all messages have been used, reset the group's message cycle
  if (availableMessages.length === 0) {
    console.log(
      `🔄 All messages used in group "${selectedGroup.name}", resetting group cycle`,
    );
    selectedGroup.usedMessages = [];
    availableMessages = selectedGroup.messages;
  }

  // Pick a random message from available ones
  const msgIndex = Math.floor(Math.random() * availableMessages.length);
  const selectedMessage = availableMessages[msgIndex];

  // Mark as used
  selectedGroup.usedMessages.push(selectedMessage.id);
  rotState.usedGroupIds.push(selectedGroup.id);
  rotState.lastGroupId = selectedGroup.id;
  rotState.totalMessagesSent = (rotState.totalMessagesSent || 0) + 1;
  selectedGroup.lastUsedAt = new Date().toISOString();

  // Save state
  await saveFooterGroups();

  console.log(
    `📝 Footer rotation: ${website} → Group "${selectedGroup.name}" → Message ${msgIndex + 1}/${selectedGroup.messages.length}`,
  );

  return selectedMessage.text;
}

/**
 * Reset rotation state for a website
 * @param {string} website - 'masaak' or 'hasak'
 */
async function resetRotation(website) {
  if (!footerData[website]) {
    throw new Error(`Invalid website: ${website}`);
  }

  // Reset rotation state
  footerData[website].rotationState = {
    usedGroupIds: [],
    lastGroupId: null,
    totalMessagesSent: footerData[website].rotationState.totalMessagesSent || 0,
  };

  // Reset usedMessages for all groups
  footerData[website].groups.forEach((group) => {
    group.usedMessages = [];
  });

  await saveFooterGroups();
  console.log(`🔄 Reset footer rotation for ${website}`);
  return true;
}

/**
 * Get rotation statistics
 * @param {string} website - 'masaak' or 'hasak'
 */
function getRotationStats(website) {
  if (!footerData[website]) {
    return null;
  }

  const groups = footerData[website].groups;
  const rotState = footerData[website].rotationState;
  const enabledGroups = groups.filter(
    (g) => g.enabled && g.messages.length > 0,
  );

  return {
    totalGroups: groups.length,
    enabledGroups: enabledGroups.length,
    usedGroupsInCycle: rotState.usedGroupIds.length,
    totalMessagesSent: rotState.totalMessagesSent || 0,
    lastGroupId: rotState.lastGroupId,
    groupsDetail: groups.map((g) => ({
      id: g.id,
      name: g.name,
      enabled: g.enabled,
      totalMessages: g.messages.length,
      usedMessages: g.usedMessages.length,
      lastUsedAt: g.lastUsedAt,
    })),
  };
}

/**
 * Check if footer groups feature is enabled for a website
 * (has at least one enabled group with messages)
 * @param {string} website - 'masaak' or 'hasak'
 */
function hasEnabledGroups(website) {
  if (!footerData[website]) return false;
  return footerData[website].groups.some(
    (g) => g.enabled && g.messages.length > 0,
  );
}

/**
 * Get default footer for a website
 * @param {string} website - 'masaak' or 'hasak'
 */
function getDefaultFooter(website) {
  return DEFAULT_FOOTERS[website] || DEFAULT_FOOTERS.masaak;
}

// Initialize on module load
initFooterGroups();

module.exports = {
  initFooterGroups,
  getGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  addMessage,
  updateMessage,
  deleteMessage,
  getNextFooter,
  resetRotation,
  getRotationStats,
  hasEnabledGroups,
  getDefaultFooter,
  DEFAULT_FOOTERS,
};
