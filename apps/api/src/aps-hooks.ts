import type { ApsPipelineHooks } from "@infraworks/domain";
import type { ApsClient } from "@infraworks/aps-client";

/** Wire domain package pipeline to aps-client (mock-safe when credentials missing). */
export function createApsPipelineHooks(aps: ApsClient): ApsPipelineHooks {
  return {
    async preparePreview(filePath, filename) {
      const preview = await aps.prepareDwgPreview(filePath, filename);
      return {
        urn: preview.urn,
        status: preview.status,
        mocked: preview.mocked,
        message: preview.message,
      };
    },
    async listLayers({ fallbackLayers, filePath, filename }) {
      // Upload first so live DA has an OSS object id; mock path ignores object id.
      let inputObjectId: string | undefined;
      try {
        const uploaded = await aps.uploadObject(filePath, undefined);
        inputObjectId = uploaded.objectId;
      } catch {
        // Local parse still proceeds if OSS upload fails in unexpected ways.
      }
      const da = await aps.listDwgLayersViaDesignAutomation({
        inputObjectId,
        fallbackLayers,
      });
      return {
        layers: da.layers ?? fallbackLayers,
        message: da.message || `DA for ${filename}`,
        mocked: da.mocked,
      };
    },
  };
}
