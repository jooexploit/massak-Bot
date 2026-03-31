function normalizeForSimilarity(text = "") {
  return String(text || "")
    .normalize("NFKC")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\W_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function levenshteinDistance(a = "", b = "") {
  const s = String(a);
  const t = String(b);
  const m = s.length;
  const n = t.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

function similarityScore(a = "", b = "") {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  const maxLen = Math.max(na.length, nb.length);

  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(na, nb);
  return 1 - distance / maxLen;
}

function findNearDuplicate(inputText, candidates = [], options = {}) {
  const threshold = typeof options.threshold === "number" ? options.threshold : 0.9;
  let best = null;

  for (const candidate of candidates) {
    const score = similarityScore(inputText, candidate?.text || "");

    if (score >= threshold && (!best || score > best.score)) {
      best = { candidate, score };
    }
  }

  return best;
}

module.exports = {
  normalizeForSimilarity,
  similarityScore,
  findNearDuplicate,
};
