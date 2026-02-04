import { ApiError } from "@/lib/errors";

const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_ALLOWED_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
  "mp4",
  "pdf"
];
const DEFAULT_SUPPLIER_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "pdf"];
const DEFAULT_FIELD_EXTENSIONS = DEFAULT_SUPPLIER_EXTENSIONS;
const DEFAULT_CHAT_EXTENSIONS = DEFAULT_ALLOWED_EXTENSIONS;
const DEFAULT_COST_EVIDENCE_EXTENSIONS = DEFAULT_SUPPLIER_EXTENSIONS;

const EXTENSION_MIME_HINT: Record<string, string> = {
  jpg: "image/",
  jpeg: "image/",
  png: "image/",
  webp: "image/",
  gif: "image/",
  heic: "image/",
  heif: "image/",
  mp4: "video/",
  pdf: "application/pdf"
};

function getExtension(fileName: string): string | null {
  const parts = fileName.split(".");
  if (parts.length < 2) return null;
  return parts[parts.length - 1].toLowerCase();
}

export function validateUpload(fileName: string, mimeType: string, sizeBytes: number) {
  validateUploadByPolicy(fileName, mimeType, sizeBytes, getUploadPolicy("KOVI", "CHAT"));
}

export function validateUploadByRole(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  role: "KOVI" | "ADMIN" | "SUPPLIER" | "FIELD",
  origin: "CHAT" | "COST_EVIDENCE" | "FIELD",
  meta?: { width?: number; height?: number }
) {
  validateUploadByPolicy(fileName, mimeType, sizeBytes, getUploadPolicy(role, origin), meta);
}

function validateUploadByPolicy(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  policy: { maxBytes: number; allowedExtensions: Set<string>; maxImageWidth?: number; maxImageHeight?: number },
  meta?: { width?: number; height?: number }
) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new ApiError(400, "Invalid file size");
  }

  if (sizeBytes > policy.maxBytes) {
    throw new ApiError(413, `File size exceeds limit (${policy.maxBytes} bytes)`);
  }

  const extension = getExtension(fileName);
  if (!extension || !policy.allowedExtensions.has(extension)) {
    throw new ApiError(400, "File extension not allowed");
  }

  const normalizedMime = (mimeType || "").toLowerCase();
  const expected = EXTENSION_MIME_HINT[extension];

  const isImage = expected?.startsWith("image/") || normalizedMime.startsWith("image/");

  if (normalizedMime && normalizedMime !== "application/octet-stream") {
    if (expected.endsWith("/")) {
      if (!normalizedMime.startsWith(expected)) {
        throw new ApiError(400, "Mime type does not match file extension");
      }
    } else if (normalizedMime !== expected) {
      throw new ApiError(400, "Mime type does not match file extension");
    }
  }

  if (isImage) {
    if (policy.maxImageWidth && meta?.width && meta.width > policy.maxImageWidth) {
      throw new ApiError(400, "Image width exceeds limit");
    }
    if (policy.maxImageHeight && meta?.height && meta.height > policy.maxImageHeight) {
      throw new ApiError(400, "Image height exceeds limit");
    }
  }
}

export function getMaxUploadBytes() {
  return getUploadPolicy("KOVI", "CHAT").maxBytes;
}

function parseAllowedExtensions(value: string | undefined, fallback: string[]): Set<string> {
  if (!value) {
    return new Set(fallback);
  }
  const entries = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return new Set(entries.length ? entries : fallback);
}

function parseMaxBytes(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function getUploadPolicy(
  role: "KOVI" | "ADMIN" | "SUPPLIER" | "FIELD",
  origin: "CHAT" | "COST_EVIDENCE" | "FIELD"
) {
  const maxBytes = parseMaxBytes(process.env.UPLOAD_MAX_BYTES, DEFAULT_MAX_UPLOAD_BYTES);
  const allowedDefault = parseAllowedExtensions(process.env.UPLOAD_ALLOWED_EXTENSIONS, DEFAULT_ALLOWED_EXTENSIONS);
  const allowedSupplier = parseAllowedExtensions(process.env.UPLOAD_SUPPLIER_EXTENSIONS, DEFAULT_SUPPLIER_EXTENSIONS);
  const allowedField = parseAllowedExtensions(process.env.UPLOAD_FIELD_EXTENSIONS, DEFAULT_FIELD_EXTENSIONS);
  const allowedChat = parseAllowedExtensions(process.env.UPLOAD_CHAT_EXTENSIONS, DEFAULT_CHAT_EXTENSIONS);
  const allowedCost = parseAllowedExtensions(
    process.env.UPLOAD_COST_EVIDENCE_EXTENSIONS,
    DEFAULT_COST_EVIDENCE_EXTENSIONS
  );
  const maxImageWidth = parseMaxBytes(process.env.UPLOAD_MAX_IMAGE_WIDTH, 0) || undefined;
  const maxImageHeight = parseMaxBytes(process.env.UPLOAD_MAX_IMAGE_HEIGHT, 0) || undefined;

  let roleAllowed = allowedDefault;
  if (role === "SUPPLIER") {
    roleAllowed = allowedSupplier;
  } else if (role === "FIELD") {
    roleAllowed = allowedField;
  }

  let originAllowed = allowedChat;
  if (origin === "COST_EVIDENCE") {
    originAllowed = allowedCost;
  } else if (origin === "FIELD") {
    originAllowed = allowedField;
  }

  const allowedExtensions = new Set(
    [...roleAllowed].filter((ext) => originAllowed.has(ext))
  );

  return { maxBytes, allowedExtensions, maxImageWidth, maxImageHeight };
}
