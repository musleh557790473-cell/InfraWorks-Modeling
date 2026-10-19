import { join } from "node:path";
import { createFileStore, runBuildPipeline } from "@infraworks/domain";

const dataDir = process.env.DATA_DIR || join(process.cwd(), "../../data");
const store = createFileStore(dataDir);
const pollMs = Number(process.env.WORKER_POLL_MS || 2000);

console.log(`Worker watching ${dataDir} every ${pollMs}ms`);

async function tick() {
  const projects = store.listProjects();
  for (const project of projects) {
    const jobs = store.listJobs(project.id);
    for (const job of jobs) {
      if (job.status !== "queued") continue;
      console.log(`Running job ${job.id} for project ${project.id}`);
      try {
        await runBuildPipeline(store, project.id, job.id);
        console.log(`Job ${job.id} succeeded`);
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
