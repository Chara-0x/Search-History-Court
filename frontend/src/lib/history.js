const MAX_SELECTED_TAGS = 6;

export function canonicalHost(host = "") {
  const h = host.trim().toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}

function lookupHostType(host, typeMap) {
  const parts = host.split(".");
  const candidates = [host];
  if (parts.length >= 3) {
    candidates.push(parts.slice(-2).join("."));
  }
  for (const cand of candidates) {
    if (typeMap[cand]) return typeMap[cand];
  }
  return null;
}

export function detectTag(host, title, { typeMap = {}, typeToTag = {}, tagDefs = [] }) {
  const h = canonicalHost(host);
  const t = (title || "").toLowerCase();

  const hostType = lookupHostType(h, typeMap);
  if (hostType && typeToTag[hostType]) {
    return typeToTag[hostType];
  }

  for (const tag of tagDefs) {
    if ((tag.hosts || []).some((p) => h.includes(p))) return tag.id;
    if ((tag.keywords || []).some((kw) => t.includes(kw))) return tag.id;
  }

  return "uncategorized";
}

export function classifyHistory(history, meta) {
  const { typeMap = {}, typeToTag = {}, tagDefs = [] } = meta || {};
  return (history || []).reduce((acc, h) => {
    if (!h || typeof h !== "object") return acc;
    const host = canonicalHost(h.host || "");
    const title = (h.title || "").trim();
    if (!host || !title) return acc;
    const tag = detectTag(host, title, { typeMap, typeToTag, tagDefs });
    acc.push({
      host,
      title,
      tag,
      lastVisitTime: h.lastVisitTime || null,
      visitCount: Number(h.visitCount || 1),
    });
    return acc;
  }, []);
}

export function summarizeByTag(items, tagDefs) {
  const allTags = [...tagDefs, { id: "uncategorized", label: "Uncategorized", hosts: [], keywords: [] }];
  const counts = {};
  const hostCounts = {};
  allTags.forEach((t) => {
    counts[t.id] = 0;
    hostCounts[t.id] = {};
  });

  for (const it of items) {
    const tag = it.tag || "uncategorized";
    const host = it.host || "unknown";
    counts[tag] = (counts[tag] || 0) + 1;
    const hc = hostCounts[tag] || {};
    hc[host] = (hc[host] || 0) + 1;
    hostCounts[tag] = hc;
  }

  return allTags.map((tag) => {
    const hosts = Object.entries(hostCounts[tag.id] || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([h, c]) => ({ host: h, count: c }));
    return {
      id: tag.id,
      label: tag.label,
      count: counts[tag.id] || 0,
      hosts,
    };
  });
}

export function clampSelectedTags(tags, max = MAX_SELECTED_TAGS) {
  return tags.slice(0, max);
}

export const MAX_TAGS = MAX_SELECTED_TAGS;
