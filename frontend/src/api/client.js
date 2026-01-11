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

// Multiplayer roulette mode
export function createRouletteGame(payload) {
  return request("/api/roulette/create", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchRouletteRound(gameId, round) {
  return request(`/api/roulette/${gameId}/round/${round}`);
}

export function submitRouletteGuess(gameId, round, playerId) {
  return request(`/api/roulette/${gameId}/guess`, {
    method: "POST",
    body: JSON.stringify({ round, player_id: playerId }),
  });
}

// Room-based roulette
export function createRouletteRoom(picks = 3) {
  return request("/api/roulette/room/create", {
    method: "POST",
    body: JSON.stringify({ picks }),
  });
}

export function fetchRouletteRoom(roomId) {
  return request(`/api/roulette/room/${roomId}`);
}

export function joinRouletteRoom(roomId, payload) {
  return request(`/api/roulette/room/${roomId}/join`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startRouletteRoom(roomId) {
  return request(`/api/roulette/room/${roomId}/start`, { method: "POST" });
}

export function deleteUser(sessionId) {
  return request("/api/delete-user", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId }),
  });
}
