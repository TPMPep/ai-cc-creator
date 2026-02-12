// Domain allowlist validation with wildcard support
export function matchesDomainAllowlist(url, allowedDomains) {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    
    return allowedDomains.some(pattern => {
      const p = pattern.toLowerCase().trim();
      if (p.startsWith("*.")) {
        // Wildcard match: *.cloudfront.net matches abc.cloudfront.net
        const domain = p.substring(2);
        return hostname.endsWith(domain) || hostname === domain;
      }
      // Exact match
      return hostname === p;
    });
  } catch {
    return false;
  }
}

// Rate limiting: track job creation timestamps
const JOB_CREATION_KEY = "aicc_job_timestamps";

export function checkRateLimit(jobsPerMinute) {
  const now = Date.now();
  const timestamps = JSON.parse(localStorage.getItem(JOB_CREATION_KEY) || "[]");
  
  // Filter timestamps within last minute
  const recentTimestamps = timestamps.filter(t => now - t < 60000);
  
  if (recentTimestamps.length >= jobsPerMinute) {
    return { allowed: false, message: "Rate limit reached. Try again in a moment." };
  }
  
  // Add current timestamp and save
  recentTimestamps.push(now);
  localStorage.setItem(JOB_CREATION_KEY, JSON.stringify(recentTimestamps));
  
  return { allowed: true };
}

// Initialize settings singleton
export async function ensureSettingsExist(base44) {
  const existing = await base44.entities.Settings.filter({ settingsId: "global" }, "", 1);
  if (existing.length === 0) {
    await base44.entities.Settings.create({
      settingsId: "global",
      allowlistEnabled: false,
      allowedDomains: [],
      defaultAllowHttp: false,
      jobsPerMinute: 3,
      maxConcurrentProcessingJobsPerUser: 3,
    });
  }
}

export async function getSettings(base44) {
  const settings = await base44.entities.Settings.filter({ settingsId: "global" }, "", 1);
  return settings[0] || {
    allowlistEnabled: false,
    allowedDomains: [],
    defaultAllowHttp: false,
    jobsPerMinute: 3,
    maxConcurrentProcessingJobsPerUser: 3,
  };
}