/**
 * Reconstruct cues array from job result.
 * Supports both old format (result.cues) and new chunked format (result.cue_chunks).
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