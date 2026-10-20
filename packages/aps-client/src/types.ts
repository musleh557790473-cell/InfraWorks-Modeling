/** Shared APS client types (patterns adapted from APS simple-viewer + design-automation samples). */

export interface ApsConfig {
  clientId?: string;
  clientSecret?: string;
  /** Optional 3-legged callback; not required for 2-legged OSS/MD/DA. */
  callbackUrl?: string;
  /** OSS bucket for uploads (default: `{clientId}-infraworks` lowercased). */
  bucketKey?: string;
  /** Design Automation activity id for DWG layer list / overlay normalize. */
  daActivityId?: string;
  /** APS base URL override (tests). */
  baseUrl?: string;
}

export interface ApsToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
  mocked: boolean;
  scopes: string[];
}

export type PreviewStatus = "mocked" | "ready" | "pending" | "failed" | "not_started";

export interface ModelDerivativePreview {
  status: PreviewStatus;
  urn?: string;
  objectId?: string;
  objectKey?: string;
  bucketKey?: string;
  /** Short-lived token for Viewer when live (viewables:read). */
  accessToken?: string;
  viewerScriptUrl?: string;
  viewerStyleUrl?: string;
  progress?: string;
  message: string;
  mocked: boolean;
}

export interface OssObjectRef {
  bucketKey: string;
  objectKey: string;
  objectId: string;
  urn: string;
  mocked: boolean;
}

export interface DesignAutomationWorkItemResult {
  status: "mocked" | "submitted" | "success" | "failed" | "inprogress" | "pending";
  workItemId?: string;
  layers?: string[];
  overlayObjectKey?: string;
  report?: string;
  message: string;
  mocked: boolean;
}

export const APS_BASE = "https://developer.api.autodesk.com";
export const VIEWER_SCRIPT =
  "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js";
export const VIEWER_STYLE =
  "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css";

/** Internal data scopes for OSS / MD / DA (2-legged). */
export const INTERNAL_SCOPES = [
  "data:read",
  "data:write",
  "data:create",
  "bucket:create",
  "bucket:read",
  "code:all",
] as const;

/** Public viewer token scope. */
export const VIEWER_SCOPES = ["viewables:read"] as const;
