/**
 * Parse a TTML timecode string like "00:01:23.456" into milliseconds.
 */
function parseTTMLTimecode(tc) {
  if (!tc) return 0;
  const parts = tc.split(':');
  const hours = parts.length === 3 ? parseInt(parts[0]) : 0;
  const minutes = parts.length === 3 ? parseInt(parts[1]) : parseInt(parts[0]);
  const secParts = parts[parts.length - 1].split('.');
  const seconds = parseInt(secParts[0]);
  const ms = parseInt((secParts[1] || '0').padEnd(3, '0').substring(0, 3));
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
}

/**
 * Parse TTML XML string into an array of cue objects.
 * Each cue: { start (ms), end (ms), text, speaker, type }
 */
export function parseTTML(ttmlString) {
  if (!ttmlString) return [];
  const cues = [];

  // Use regex to extract <p> elements with begin/end attributes
  const pRegex = /<p\s[^>]*begin="([^"]+)"[^>]*end="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gi;
  let match;

  while ((match = pRegex.exec(ttmlString)) !== null) {
    const begin = match[1];
    const end = match[2];
    let content = match[3];

    // Replace <br/> with newlines
    content = content.replace(/<br\s*\/?>/gi, '\n');
    // Strip remaining XML tags
    content = content.replace(/<[^>]+>/g, '');
    // Decode basic HTML entities
    content = content
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    content = content.trim();

    if (content) {
      cues.push({
        start: parseTTMLTimecode(begin),
        end: parseTTMLTimecode(end),
        text: content,
        speaker: null,
        type: 'caption',
      });
    }
  }

  return cues;
}

/**
 * Format milliseconds to SRT timecode: 00:01:23,456
 */
function msToSrtTimecode(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mil).padStart(3, '0')}`;
}

/**
 * Format milliseconds to VTT timecode: 00:01:23.456
 */
function msToVttTimecode(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(mil).padStart(3, '0')}`;
}

/**
 * Convert cues array to SRT string.
 */
export function cuesToSrt(cues) {
  return cues.map((cue, i) => {
    return `${i + 1}\n${msToSrtTimecode(cue.start)} --> ${msToSrtTimecode(cue.end)}\n${cue.text}`;
  }).join('\n\n');
}

/**
 * Convert cues array to VTT string.
 */
export function cuesToVtt(cues) {
  const lines = ['WEBVTT', ''];
  cues.forEach((cue, i) => {
    lines.push(`${i + 1}`);
    lines.push(`${msToVttTimecode(cue.start)} --> ${msToVttTimecode(cue.end)}`);
    lines.push(cue.text);
    lines.push('');
  });
  return lines.join('\n');
}

/**
 * Parse VTT string into cues array.
 */
export function parseVTT(vttString) {
  if (!vttString) return [];
  const lines = vttString.split('\n');
  const cues = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const [startStr, endStr] = line.split('-->').map(s => s.trim());
      const start = parseVTTTimecode(startStr);
      const end = parseVTTTimecode(endStr);
      const textLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i]);
        i++;
      }
      if (textLines.length > 0) {
        cues.push({ start, end, text: textLines.join('\n'), speaker: null, type: 'caption' });
      }
    }
    i++;
  }
  return cues;
}

function parseVTTTimecode(tc) {
  const parts = tc.split(':');
  const secParts = parts[parts.length - 1].split('.');
  const hours = parts.length === 3 ? parseInt(parts[0]) : 0;
  const minutes = parts.length === 3 ? parseInt(parts[1]) : parseInt(parts[0]);
  const seconds = parseInt(secParts[0]);
  const ms = parseInt(secParts[1] || 0);
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + ms;
}