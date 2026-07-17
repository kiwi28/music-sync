/**
 * Inline SVG icons for the SVAR file manager.
 *
 * SVAR loads file-type icons from https://cdn.svar.dev/…, but many audio
 * formats (flac, m4a, ogg, wav, opus, aac) return 404 from that CDN.
 * We provide tiny inline data-URI SVGs for every format we care about so
 * no requests fail and every file has a visible type icon.
 *
 * The icons follow SVAR's "vivid" style: a coloured rounded-rect background
 * with a white glyph, 24×24 viewBox.
 */

/* ── Tiny SVG helper ────────────────────────────────────── */

/** Build a minimal 24×24 SVG with a coloured background and white text. */
function makeIcon(
  bg: string,
  label: string,
  extra?: string,
): string {
  const encodedLabel = encodeURIComponent(label);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="4" fill="${encodeURIComponent(bg)}"/>
  <text x="12" y="17" text-anchor="middle" font-size="12" font-weight="700"
        font-family="system-ui,sans-serif" fill="white">${encodedLabel}</text>
  ${extra ?? ""}
</svg>`;
  return `data:image/svg+xml,${svg.replace(/\n\s*/g, "")}`;
}

/** Musical-note path for audio icons (24×24 viewBox). */
const NOTE_PATH =
  '<path d="M9 18V5l12-2v13" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" fill="white"/><circle cx="16" cy="16" r="3" fill="white"/>';

function audioIcon(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="4" fill="${encodeURIComponent(color)}"/>
  ${NOTE_PATH}
</svg>`;
  return `data:image/svg+xml,${svg.replace(/\n\s*/g, "").replace(/>\s+</g, "><")}`;
}

/* ── Icon map ───────────────────────────────────────────── */

const KNOWN_CDN_ICONS = new Set([
  "folder",
  "file",
  "unknown",
  "mp3",
]);

const AUDIO_COLORS: Record<string, string> = {
  mp3: "#DD3674",
  flac: "#E67E22",
  m4a: "#3498DB",
  ogg: "#2ECC71",
  wav: "#9B59B6",
  opus: "#1ABC9C",
  aac: "#E74C3C",
  m4b: "#F39C12",
  weba: "#2980B9",
};

const AUDIO_LABELS: Record<string, string> = {
  mp3: "MP3",
  flac: "F",
  m4a: "M4",
  ogg: "OG",
  wav: "W",
  opus: "OP",
  aac: "AA",
  m4b: "M4",
  weba: "WA",
};

/**
 * Custom icon provider for SVAR Filemanager.
 *
 * Returns a data-URI for the given file, or `false` to let SVAR use its
 * own fallback.  Only called for non-folder entries (SVAR skips the call
 * for folders).
 */
export function fileIconProvider(
  file: { type: string; ext?: string },
  _size: "big" | "small",
): string | false {
  const ext = file.ext?.toLowerCase();

  // ── Audio files — use colourful inline SVG ──
  if (ext && ext in AUDIO_COLORS) {
    return audioIcon(AUDIO_COLORS[ext]);
  }

  // ── M3U / playlist files ──
  if (ext === ".m3u" || ext === "m3u") {
    return makeIcon("#6C5CE7", "M3");
  }

  // ── Fall back to CDN for icons that exist there ──
  if (ext && KNOWN_CDN_ICONS.has(ext)) {
    return `https://cdn.svar.dev/icons/filemanager/vivid/${_size}/${ext}.svg`;
  }

  if (file.type && KNOWN_CDN_ICONS.has(file.type)) {
    return `https://cdn.svar.dev/icons/filemanager/vivid/${_size}/${file.type}.svg`;
  }

  // ── Ultimate fallback — "file" from CDN ──
  return `https://cdn.svar.dev/icons/filemanager/vivid/${_size}/file.svg`;
}
