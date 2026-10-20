import { join } from "node:path";
import { createFileStore, runBuildPipeline } from "@infraworks/domain";
import { createApsClientFromEnv } from "@infraworks/aps-client";

const dataDir = process.env.DATA_DIR || join(process.cwd(), "../../data");
const store = createFileStore(dataDir);
const aps = createApsClientFromEnv();
const pollMs = Number(process.env.WORKER_POLL_MS || 2000);

const apsHooks = {
  async preparePreview(filePath: string, filename: string) {
    const preview = await aps.prepareDwgPreview(filePath, filename);
    return {
      urn: preview.urn,
      status: preview.status,
      mocked: preview.mocked,
      message: preview.message,
    };
  },
  async listLayers({
    fallbackLayers,
    filePath,
    filename,
  }: {
    filePath: string;
    filename: string;
    fallbackLayers: string[];
  }) {
    let inputObjectId: string | undefined;
    try {
      const uploaded = await aps.uploadObject(filePath);
      inputObjectId = uploaded.objectId;
    } catch {
      /* continue with mock / fallback */
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

console.log(
  `Worker watching ${dataDir} every ${pollMs}ms (APS ${aps.isConfigured ? "live" : "mock"})`,
);

async function tick() {
  const projects = store.listProjects();
  for (const project of projects) {
    const jobs = store.listJobs(project.id);
    for (const job of jobs) {
      if (job.status !== "queued") continue;
      console.log(`Running job ${job.id} for project ${project.id}`);
      try {
        const result = await runBuildPipeline(store, project.id, job.id, apsHooks);
        console.log(`Job ${job.id} succeeded`, result.aps ?? "");
      } catch (err) {
        console.error(`Job ${job.id} failed`, err);
      }
    }
  }
}

setInterval(() => {
  void tick();
}, pollMs);
void tick();
