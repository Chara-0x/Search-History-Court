export const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
export const SESSION_KEY = import.meta.env.VITE_SESSION_KEY || "session_id";
export const STORAGE_KEYS = {
  reviewPayload: "hc_review_payload",
  session: SESSION_KEY,
};
