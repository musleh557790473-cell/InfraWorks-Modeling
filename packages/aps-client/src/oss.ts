import { readFileSync } from "node:fs";
import { getTwoLeggedToken, isApsConfigured } from "./auth.js";
import { defaultBucketKey, safeObjectKey, urnify } from "./urn.js";
import { APS_BASE, type ApsConfig, type OssObjectRef } from "./types.js";

async function apsFetch(
  config: ApsConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getTwoLeggedToken(config);
  const base = config.baseUrl ?? APS_BASE;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token.access_token}`);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

export function resolveBucketKey(config: ApsConfig): string {
  if (config.bucketKey) return config.bucketKey;
  if (config.clientId) return defaultBucketKey(config.clientId);
  return "infraworks-local-mock";
}

/** Ensure OSS bucket exists (persistent). Pattern from aps-simple-viewer ensureBucketExists. */
export async function ensureBucket(config: ApsConfig, bucketKey?: string): Promise<string> {
  const key = bucketKey ?? resolveBucketKey(config);
  if (!isApsConfigured(config)) return key;

  const details = await apsFetch(config, `/oss/v2/buckets/${encodeURIComponent(key)}/details`);
  if (details.ok) return key;
  if (details.status !== 404) {
    throw new Error(`OSS getBucketDetails failed (${details.status}): ${await details.text()}`);
  }

  const create = await apsFetch(config, `/oss/v2/buckets`, {
    method: "POST",
    body: JSON.stringify({ bucketKey: key, policyKey: "persistent" }),
    headers: { "Content-Type": "application/json", "x-ads-region": "US" },
  });
  if (!create.ok && create.status !== 409) {
    throw new Error(`OSS createBucket failed (${create.status}): ${await create.text()}`);
  }
  return key;
}

/**
 * Upload a local file to OSS via signed S3 (direct-to-S3 pattern).
 * Falls back to mock object id when APS credentials are missing.
 */
export async function uploadObject(
  config: ApsConfig,
  filePath: string,
  objectKey?: string,
  bucketKey?: string,
): Promise<OssObjectRef> {
  const bucket = await ensureBucket(config, bucketKey);
  const key = objectKey ?? safeObjectKey(filePath.split(/[/\\]/).pop() || "upload.bin");

  if (!isApsConfigured(config)) {
    const objectId = `urn:adsk.objects:os.object:${bucket}/${key}`;
    return {
      bucketKey: bucket,
      objectKey: key,
      objectId,
      urn: urnify(objectId),
      mocked: true,
    };
  }

  const buf = readFileSync(filePath);
  const signed = await apsFetch(
    config,
    `/oss/v2/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(key)}/signeds3upload?minutesExpiration=60`,
    { method: "GET" },
  );
  if (!signed.ok) {
    throw new Error(`OSS signeds3upload failed (${signed.status}): ${await signed.text()}`);
  }
  const signedJson = (await signed.json()) as {
    uploadKey: string;
    urls: string[];
  };

  const put = await fetch(signedJson.urls[0]!, {
    method: "PUT",
    body: buf,
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!put.ok) {
    throw new Error(`OSS S3 PUT failed (${put.status}): ${await put.text()}`);
  }

  const complete = await apsFetch(
    config,
    `/oss/v2/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(key)}/signeds3upload`,
    {
      method: "POST",
      body: JSON.stringify({ uploadKey: signedJson.uploadKey }),
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!complete.ok) {
    throw new Error(`OSS complete upload failed (${complete.status}): ${await complete.text()}`);
  }
  const obj = (await complete.json()) as { objectId: string; objectKey: string };
  const objectId = obj.objectId;
  return {
    bucketKey: bucket,
    objectKey: obj.objectKey || key,
    objectId,
    urn: urnify(objectId),
    mocked: false,
  };
}
