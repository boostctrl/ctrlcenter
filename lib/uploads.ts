import fs from "fs/promises";
import path from "path";
import { CONFIG_DIR } from "./config";

// Uploaded custom icons live beside config.yaml so they persist in the same
// mounted volume as the rest of the app's data (not in /public, which is baked
// into the build and isn't writable at runtime in the standalone container).
const UPLOADS_DIR = path.join(CONFIG_DIR, "uploads");

// Icons are small; cap uploads so config storage can't be filled with large
// images.
export const MAX_ICON_BYTES = 512 * 1024; // 512 KB

// Allowed image content types → the canonical extension we store them under. The
// extension is derived from the validated type, never from the uploaded
// filename, so an uploader can't control the on-disk path. SVG is allowed but
// served defensively (see app/api/icons/[name]) so it can't execute scripts.
const TYPE_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

// Stored extension → content type for serving and for filtering the listing.
const EXT_TO_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
};

export type UploadedIcon = { name: string; url: string };

export function extForType(type: string): string | null {
  return TYPE_TO_EXT[type] ?? null;
}

// The public URL an uploaded icon is served at; this is what gets stored as an
// app/bookmark/favicon icon value.
export function uploadUrl(name: string): string {
  return `/api/icons/${name}`;
}

// Single-segment names with an allowed-looking shape only; rejects anything with
// a path separator or `..` so a request can never escape the uploads dir.
export function isSafeName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name) && !name.includes("..");
}

function extOf(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

function slugifyBase(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "icon";
}

// Absolute path for a stored icon, or null if the name is unsafe or would resolve
// outside the uploads dir (defense in depth on top of isSafeName).
function iconPath(name: string): string | null {
  if (!isSafeName(name)) return null;
  const full = path.join(UPLOADS_DIR, name);
  const rel = path.relative(UPLOADS_DIR, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

// Raster types we pad to a square (transparent) canvas, so a non-square logo —
// e.g. a wide wordmark used as the favicon — isn't stretched by the browser tab
// or a PWA. SVG (vector, keeps its own ratio) and ICO (already square) pass
// through untouched.
const SQUARABLE = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// Center a non-square raster on a transparent square canvas (its longest side),
// re-encoded as PNG to keep the transparency. Already-square images, vector/ICO
// types, and anything sharp can't read are returned unchanged so an upload never
// fails on this. sharp is imported lazily so it stays out of the public
// icon-serving route's bundle.
async function squareIcon(
  type: string,
  data: Uint8Array
): Promise<{ type: string; data: Uint8Array }> {
  if (!SQUARABLE.has(type)) return { type, data };
  try {
    const sharp = (await import("sharp")).default;
    // Cap decoded pixels (defense-in-depth against a decompression bomb on top of
    // the 512 KB upload limit) and the output dimension.
    const opts = { limitInputPixels: 24_000_000 };
    const meta = await sharp(data, opts).metadata();
    if (!meta.width || !meta.height || meta.width === meta.height) {
      return { type, data };
    }
    const size = Math.min(1024, Math.max(meta.width, meta.height));
    const out = await sharp(data, opts)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    return { type: "image/png", data: new Uint8Array(out) };
  } catch {
    return { type, data };
  }
}

// Save an uploaded image and return its stored filename + serving URL. Raster
// images are squared first (see squareIcon) so they read correctly as a favicon.
export async function saveIcon(
  originalName: string,
  type: string,
  data: Uint8Array
): Promise<UploadedIcon> {
  const squared = await squareIcon(type, data);
  const ext = extForType(squared.type);
  if (!ext) throw new Error("Unsupported image type");
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const name = `${slugifyBase(originalName)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await fs.writeFile(path.join(UPLOADS_DIR, name), squared.data);
  return { name, url: uploadUrl(name) };
}

export async function listIcons(): Promise<UploadedIcon[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(UPLOADS_DIR);
  } catch {
    return []; // no uploads dir yet
  }
  return entries
    .filter((n) => isSafeName(n) && extOf(n) in EXT_TO_TYPE)
    .sort()
    .map((name) => ({ name, url: uploadUrl(name) }));
}

export async function readIcon(
  name: string
): Promise<{ data: ArrayBuffer; type: string } | null> {
  const full = iconPath(name);
  if (!full) return null;
  const type = EXT_TO_TYPE[extOf(name)];
  if (!type) return null;
  try {
    const buf = await fs.readFile(full);
    // A standalone ArrayBuffer (sliced to this file's bytes) is a valid response
    // BodyInit; the raw Node Buffer's generic type isn't.
    const data = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    ) as ArrayBuffer;
    return { data, type };
  } catch {
    return null;
  }
}

export async function deleteIcon(name: string): Promise<boolean> {
  const full = iconPath(name);
  if (!full) return false;
  try {
    await fs.unlink(full);
    return true;
  } catch {
    return false;
  }
}
