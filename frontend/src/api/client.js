const API_BASE = import.meta.env.VITE_API_BASE || "";

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const msg = typeof data === "string" ? data : data?.error || "Request failed";
    throw new Error(msg);
  }
  return data;
}

export function fetchTypeMeta() {
  return request("/api/type-map");
}

export function fetchSessionTags(sessionId) {
  return request(`/api/session/${sessionId}/tags`);
}

export function createCase(payload) {
  return request("/api/create-case", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function editCase(caseId, payload) {
  return request(`/api/case/${caseId}/edit`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchCaseRounds(caseId) {
  return request(`/api/case/${caseId}/rounds`);
}

export function fetchRound(caseId, idx) {
  return request(`/api/case/${caseId}/round/${idx}`);
}

export function submitGuess(caseId, round, selection) {
  return request(`/api/case/${caseId}/guess`, {
    method: "POST",
    body: JSON.stringify({ round, selection }),
  });
}

export function uploadHistory(history) {
  return request("/api/upload-history", {
    method: "POST",
    body: JSON.stringify({ history }),
  });
}
