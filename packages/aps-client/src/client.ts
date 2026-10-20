import { clearTokenCache, getTwoLeggedToken, getViewerToken, isApsConfigured } from "./auth.js";
import {
  getWorkItemStatus,
  submitDwgLayerListWorkItem,
} from "./design-automation.js";
import { buildPreviewFromUrn, getManifest, translateObject } from "./model-derivative.js";
import { ensureBucket, resolveBucketKey, uploadObject } from "./oss.js";
import { safeObjectKey, urnify } from "./urn.js";
import type {
  ApsConfig,
  ApsToken,
  DesignAutomationWorkItemResult,
  ModelDerivativePreview,
  OssObjectRef,
} from "./types.js";
import { VIEWER_SCRIPT, VIEWER_STYLE } from "./types.js";

/**
 * Facade over APS 2-legged auth, OSS, Model Derivative, and Design Automation stubs.
 * When credentials are missing every method returns a clear mock path (LOCAL_MODE friendly).
 */
export class ApsClient {
  constructor(private readonly config: ApsConfig = {}) {}

  get isConfigured(): boolean {
    return isApsConfigured(this.config);
  }

  get bucketKey(): string {
    return resolveBucketKey(this.config);
  }

  get configSnapshot(): Readonly<ApsConfig> {
    return { ...this.config };
  }

  clearCache(): void {
    clearTokenCache();
  }

  async getTwoLeggedToken(): Promise<ApsToken> {
    return getTwoLeggedToken(this.config);
  }

  async getViewerToken(): Promise<ApsToken> {
    return getViewerToken(this.config);
  }

  async ensureBucket(bucketKey?: string): Promise<string> {
    return ensureBucket(this.config, bucketKey);
  }

  async uploadObject(filePath: string, objectKey?: string): Promise<OssObjectRef> {
    return uploadObject(this.config, filePath, objectKey);
  }

  urnify(objectId: string): string {
    return urnify(objectId);
  }

  async translateObject(urn: string, rootFilename?: string) {
    return translateObject(this.config, urn, rootFilename);
  }

  async getManifest(urn: string) {
    return getManifest(this.config, urn);
  }

  /**
   * Full preview path: upload CAD → translate → return Viewer URN + token.
   * Mocked when APS credentials are absent.
   */
  async prepareDwgPreview(
    filePath: string,
    filename?: string,
  ): Promise<ModelDerivativePreview> {
    const objectKey = safeObjectKey(filename || filePath.split(/[/\\]/).pop() || "model.dwg");
    const uploaded = await this.uploadObject(filePath, objectKey);
    return buildPreviewFromUrn(this.config, uploaded.urn, {
      objectId: uploaded.objectId,
      objectKey: uploaded.objectKey,
      bucketKey: uploaded.bucketKey,
    });
  }

  /** @deprecated Prefer prepareDwgPreview — kept for callers that only have an object key name. */
  async translateForPreview(objectKey: string): Promise<ModelDerivativePreview> {
    if (!this.isConfigured) {
      const objectId = `urn:adsk.objects:os.object:${this.bucketKey}/${objectKey}`;
      return buildPreviewFromUrn(this.config, urnify(objectId), {
        objectKey,
        bucketKey: this.bucketKey,
        objectId,
      });
    }
    return {
      status: "not_started",
      objectKey,
      bucketKey: this.bucketKey,
      viewerScriptUrl: VIEWER_SCRIPT,
      viewerStyleUrl: VIEWER_STYLE,
      message: "Upload the CAD file first via prepareDwgPreview(filePath)",
      mocked: false,
    };
  }

  async listDwgLayersViaDesignAutomation(opts: {
    inputObjectId?: string;
    fallbackLayers?: string[];
  }): Promise<DesignAutomationWorkItemResult> {
    return submitDwgLayerListWorkItem(this.config, opts);
  }

  async getDesignAutomationStatus(workItemId: string): Promise<DesignAutomationWorkItemResult> {
    return getWorkItemStatus(this.config, workItemId);
  }
}

export function createApsClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ApsClient {
  return new ApsClient({
    clientId: env.APS_CLIENT_ID || undefined,
    clientSecret: env.APS_CLIENT_SECRET || undefined,
    callbackUrl: env.APS_CALLBACK_URL || undefined,
    bucketKey: env.APS_BUCKET || undefined,
    daActivityId: env.APS_DA_ACTIVITY_ID || undefined,
  });
}
