import { join } from "node:path";
import { createFileStore, runBuildPipeline } from "@infraworks/domain";

const dataDir = process.env.DATA_DIR || join(process.cwd(), "../../data");
const pollMs = Number(process.env.WORKER_POLL_MS || 2000);

// In LOCAL_MODE the API runs each build inline. Polling the same files here as well
// could pick a job up in the moment before the API marks it running, and build it twice.
if (process.env.LOCAL_MODE !== "0") {
  console.log("Worker idle: LOCAL_MODE runs builds inline in the API. Set LOCAL_MODE=0 to use the worker.");
} else {
  const store = createFileStore(dataDir);
  console.log(`Worker watching ${dataDir} every ${pollMs}ms`);

  let busy = false;
  const tick = async () => {
    if (busy) return; // never overlap ticks
    busy = true;
    try {
      for (const project of store.listProjects()) {
        for (const job of store.listJobs(project.id)) {
          if (job.status !== "queued") continue;
          console.log(`Running job ${job.id} for project ${project.id}`);
          try {
            await runBuildPipeline(store, project.id, job.id);
            console.log(`Job ${job.id} succeeded`);
          } catch (err) {
            console.error(`Job ${job.id} failed`, err instanceof Error ? err.message : err);
          }
        }
      }
    } finally {
      busy = false;
    }
  };

  setInterval(() => void tick(), pollMs);
  void tick();
}
