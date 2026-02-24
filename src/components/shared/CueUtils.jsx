/**
 * Reconstruct cues array from job result.
 * Supports: URL-based (result.cue_url), chunked (result.cue_chunks), and old (result.cues).
 */
export async function getCuesFromResultAsync(result) {
  if (!result) return [];
  if (result.cue_url) {
    try {
      const res = await fetch(result.cue_url);
      const text = await res.text();
      return JSON.parse(text);
    } catch (e) {
      console.error("Failed to fetch cue_url:", e);
      return [];
    }
  }
  return getCuesFromResult(result);
}

/**
 * Synchronous version — works for chunked and old formats only.
 */
export function getCuesFromResult(result) {
  if (!result) return [];
  if (result.cue_chunks) {
    try {
      return JSON.parse(result.cue_chunks.join(""));
    } catch (e) {
      console.error("Failed to parse cue_chunks:", e);
      return [];
    }
  }
  return result.cues || [];
}