// Pulls an Instagram post (or reel) into a local UploadAsset by scraping its public OG tags.
// Runs from the client, same pattern as lib/vision.ts. No server piece needed.
//
// Limitations to be aware of:
//   - IG truncates captions in og:description to roughly the first ~150 chars. Long captions
//     are not fully recoverable without the Graph API. We surface what we can and let the user edit.
//   - Carousels: og:image is the first slide only.
//   - Reels: og:image is the video thumbnail. That's fine, we still get a savable image.
//   - Private accounts / login-wall pages return a generic IG og:image and no caption. We treat
//     that as a soft failure so the user gets a useful error.
//   - Stories aren't shareable to third-party apps, so we never see them.
//
// We pretend to be a desktop browser. Instagram returns a stripped page (no og tags) when the
// User-Agent looks like a mobile app or a known scraper.
import * as FileSystem from "expo-file-system/legacy";

export type InstagramImportResult = {
  // local file URI ready to drop into the existing upload pipeline
  localUri: string;
  fileName: string;
  mimeType: string;
  // best-effort caption pulled from og:description (and trimmed of IG's "N likes" prefix)
  caption: string;
  // @handle if we could find one, otherwise null
  author: string | null;
  // canonical post URL, stripped of share tracking params
  sourceUrl: string;
};

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

// instagram.com/p/<id>, /reel/<id>, /reels/<id>, /tv/<id> — with or without www., trailing slash, etc.
const IG_URL_REGEX =
  /^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+/i;

export function isInstagramUrl(url: string): boolean {
  return IG_URL_REGEX.test(url.trim());
}

// Pull the post out of whatever the user shared. iOS sometimes hands us "Check this out https://..."
// rather than the bare URL, so we hunt for the first IG URL substring.
export function extractInstagramUrl(text: string): string | null {
  const match = text.match(
    /(https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+[^\s]*)/i,
  );
  return match ? match[1] : null;
}

// Strip share tracking (?igsh=, ?utm_*) and normalize trailing slash so we can dedupe later.
function canonicalizeInstagramUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    let path = u.pathname;
    if (!path.endsWith("/")) path += "/";
    return `https://www.instagram.com${path}`;
  } catch {
    return url.split("?")[0];
  }
}

// Grab the content="..." value of a meta tag whose property/name matches `key`.
// Cheap regex parse, no DOM available in RN.
function readMetaTag(html: string, key: string): string | null {
  // matches <meta property="og:image" content="..."> in either attribute order, single or double quotes
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decodeHtmlEntities(m[1]);
  }
  return null;
}

// IG escapes a bunch of stuff in og tags. RN has no DOMParser so we do this by hand.
// Order matters: decode &amp; LAST so we don't double-decode &amp;quot; -> "
function decodeHtmlEntities(s: string): string {
  return (
    s
      // named entities we see in IG captions
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&hellip;/g, "…")
      .replace(/&mdash;/g, "—")
      .replace(/&ndash;/g, "–")
      .replace(/&lsquo;/g, "‘")
      .replace(/&rsquo;/g, "’")
      .replace(/&ldquo;/g, "“")
      .replace(/&rdquo;/g, "”")
      .replace(/&trade;/g, "™")
      .replace(/&copy;/g, "©")
      .replace(/&reg;/g, "®")
      // numeric entities, e.g. &#8217;  →  ’
      .replace(/&#(\d+);/g, (_, code: string) => {
        const n = parseInt(code, 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : "";
      })
      // hex numeric entities, e.g. &#x2019;  →  ’
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => {
        const n = parseInt(code, 16);
        return Number.isFinite(n) ? String.fromCodePoint(n) : "";
      })
      // do amp last so we don't double-decode
      .replace(/&amp;/g, "&")
  );
}

// Normalize a caption pulled out of IG's og:description into something that won't look weird
// in our text input: kill invisible/zero-width chars, fix non-breaking spaces, collapse runs of
// whitespace and blank lines, and drop the trailing "..." that IG appends when it truncates.
function sanitizeCaption(s: string): string {
  return (
    s
      // non-breaking spaces look fine until you try to select / wrap them
      .replace(/ /g, " ")
      // zero-width spaces / joiners / non-joiners / BOM. IG uses these for layout tricks
      .replace(/[​-‍﻿]/g, "")
      // strip control chars but keep \n and \t
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      // normalize windows line endings
      .replace(/\r\n?/g, "\n")
      // collapse 3+ newlines down to 2 (one blank line max)
      .replace(/\n{3,}/g, "\n\n")
      // collapse runs of spaces/tabs
      .replace(/[ \t]{2,}/g, " ")
      // trim each line so trailing spaces don't show up as weird underlines in inputs
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      // IG truncates around 150 chars and appends "..." or "…". the user will edit if they want
      // more, so chop the trailing ellipsis off so the caption doesn't end mid-thought with dots
      .replace(/[.…]+\s*$/g, "")
      .trim()
  );
}

// og:description looks like: `1,234 likes, 56 comments - username on October 1, 2023: "Caption..."`
// We pull out the caption from the quoted tail when possible, and the @handle from "username on".
function parseDescription(desc: string): { caption: string; author: string | null } {
  // pull the quoted caption tail
  const quoted = desc.match(/[:\-]\s*"([^"]*)"\s*\.?\s*$/);
  // username is the word immediately before " on <date>"
  const authorMatch = desc.match(/([A-Za-z0-9._]+)\s+on\s+[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}/);
  const rawCaption = quoted ? quoted[1] : stripLikesPrefix(desc);
  return { caption: sanitizeCaption(rawCaption), author: authorMatch ? authorMatch[1] : null };
}

// fallback for when we can't find a quoted caption — strip the leading "N likes, M comments - "
function stripLikesPrefix(s: string): string {
  return s.replace(/^[\d,.\s]+likes?,\s*[\d,.\s]+comments?\s*[-–]\s*/i, "");
}

// og:title is usually `"<Display Name> (@username) on Instagram: ..."`
function parseAuthorFromTitle(title: string): string | null {
  const m = title.match(/\(@([A-Za-z0-9._]+)\)/);
  return m ? m[1] : null;
}

export async function fetchInstagramPost(rawUrl: string): Promise<InstagramImportResult> {
  const sourceUrl = canonicalizeInstagramUrl(rawUrl.trim());

  // pretend to be a desktop browser, otherwise IG often returns a stripped page
  const res = await fetch(sourceUrl, {
    method: "GET",
    headers: {
      "User-Agent": DESKTOP_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`Instagram returned HTTP ${res.status}`);
  }
  const html = await res.text();

  const imageUrl = readMetaTag(html, "og:image");
  if (!imageUrl) {
    // typically means private / login-walled / removed
    throw new Error("Could not read the post. It may be private or unavailable.");
  }
  const description = readMetaTag(html, "og:description") ?? "";
  const title = readMetaTag(html, "og:title") ?? "";

  const { caption, author: authorFromDesc } = parseDescription(description);
  const author = authorFromDesc ?? parseAuthorFromTitle(title);

  // pick a unique cache filename so concurrent shares don't clobber each other
  const shortcode = sourceUrl.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)?.[1] ?? `${Date.now()}`;
  const fileName = `instagram-${shortcode}-${Date.now()}.jpg`;
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) throw new Error("No cache directory available for Instagram download.");
  const localUri = `${cacheDir}${fileName}`;

  // IG CDN sometimes 403s without a referer, so set one
  const download = await FileSystem.downloadAsync(imageUrl, localUri, {
    headers: {
      "User-Agent": DESKTOP_USER_AGENT,
      Referer: "https://www.instagram.com/",
    },
  });
  if (download.status !== 200) {
    throw new Error(`Could not download the post image (HTTP ${download.status}).`);
  }

  return {
    localUri: download.uri,
    fileName,
    mimeType: "image/jpeg",
    caption,
    author,
    sourceUrl,
  };
}
