/**
 * Interest Groups Service
 * Manages interest groups for categorizing interested clients
 */

const fs = require("fs").promises;
const path = require("path");

const INTEREST_GROUPS_FILE = path.join(__dirname, "../data/interest_groups.json");

// In-memory cache
let interestGroups = { groups: {}, nextId: 1 };

/**
 * Load interest groups from file
 */
async function loadGroups() {
  try {
    const data = await fs.readFile(INTEREST_GROUPS_FILE, "utf8");
    interestGroups = JSON.parse(data);
    console.log(`✅ Loaded ${Object.keys(interestGroups.groups).length} interest groups`);
  } catch (err) {
    // File doesn't exist, create it
    interestGroups = { groups: {}, nextId: 1 };
    await saveGroups();
    console.log("📁 Created new interest_groups.json");
  }
}

/**
 * Save interest groups to file
 */
async function saveGroups() {
  try {
    await fs.writeFile(INTEREST_GROUPS_FILE, JSON.stringify(interestGroups, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("❌ Error saving interest groups:", err);
    return false;
  }
}

/**
 * Generate next unique group ID (format: IG001, IG002, etc.)
 */
function generateGroupId() {
  const id = `IG${String(interestGroups.nextId).padStart(3, "0")}`;
  interestGroups.nextId++;
  return id;
}

/**
 * Check if a string is a valid group ID
 * @param {string} str - String to check
 * @returns {boolean}
 */
function isGroupId(str) {
  return /^IG\d{3,}$/i.test(str);
}

/**
 * Create a new interest group
 * @param {string} interest - Interest description (any text)
 * @param {Array} members - Array of {phone, name} objects
 * @param {string} createdBy - Admin phone who created
 * @returns {object} Created group
 */
async function createGroup(interest, members, createdBy) {
  const id = generateGroupId();
  const now = Date.now();

  const group = {
    id,
    interest: interest.trim(),
    createdAt: now,
    createdBy,
    members: members.map(m => ({
      phone: m.phone,
      name: m.name || null,
      addedAt: now
    }))
  };

  interestGroups.groups[id] = group;
  await saveGroups();

  return group;
}

/**
 * Add members to an existing group
 * @param {string} groupId - Group ID
 * @param {Array} members - Array of {phone, name} objects
 * @returns {object|null} Updated group or null if not found
 */
async function addToGroup(groupId, members) {
  const id = groupId.toUpperCase();
  const group = interestGroups.groups[id];
  
  if (!group) return null;

  const now = Date.now();
  const existingPhones = new Set(group.members.map(m => m.phone));
  let addedCount = 0;

  for (const member of members) {
    if (!existingPhones.has(member.phone)) {
      group.members.push({
        phone: member.phone,
        name: member.name || null,
        addedAt: now
      });
      addedCount++;
    }
  }

  if (addedCount > 0) {
    await saveGroups();
  }

  return { group, addedCount, skippedCount: members.length - addedCount };
}

/**
 * Get a group by ID
 * @param {string} groupId - Group ID
 * @returns {object|null} Group object or null
 */
function getGroup(groupId) {
  return interestGroups.groups[groupId.toUpperCase()] || null;
}

/**
 * Get all interest groups
 * @returns {Array} Array of groups
 */
function getAllGroups() {
  return Object.values(interestGroups.groups).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Delete a group
 * @param {string} groupId - Group ID
 * @returns {boolean} True if deleted
 */
async function deleteGroup(groupId) {
  const id = groupId.toUpperCase();
  if (interestGroups.groups[id]) {
    delete interestGroups.groups[id];
    await saveGroups();
    return true;
  }
  return false;
}

/**
 * Remove a member from a group
 * @param {string} groupId - Group ID
 * @param {string} phone - Phone number to remove
 * @returns {boolean} True if removed
 */
async function removeMember(groupId, phone) {
  const id = groupId.toUpperCase();
  const group = interestGroups.groups[id];
  
  if (!group) return false;

  const initialLength = group.members.length;
  group.members = group.members.filter(m => m.phone !== phone);

  if (group.members.length < initialLength) {
    await saveGroups();
    return true;
  }
  return false;
}

/**
 * Get groups containing a specific phone number
 * @param {string} phone - Phone number
 * @returns {Array} Groups containing the phone
 */
function getGroupsByPhone(phone) {
  return Object.values(interestGroups.groups).filter(
    group => group.members.some(m => m.phone === phone)
  );
}

// Initialize on load
loadGroups();

module.exports = {
  isGroupId,
  createGroup,
  addToGroup,
  getGroup,
  getAllGroups,
  deleteGroup,
  removeMember,
  getGroupsByPhone,
  loadGroups
};
