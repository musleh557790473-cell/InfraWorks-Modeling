/** Base64-URL URN helpers (aps-simple-viewer `urnify` pattern). */

export function urnify(objectId: string): string {
  return Buffer.from(objectId)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function safeObjectKey(filename: string, prefix = ""): string {
  const base = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `${prefix}${stamp}_${base}`;
}

export function defaultBucketKey(clientId: string): string {
  const raw = `${clientId.toLowerCase()}-infraworks`.replace(/[^a-z0-9_-]/g, "");
  return raw.slice(0, 128);
}
