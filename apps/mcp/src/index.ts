import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const API_BASE = process.env.API_BASE || "http://127.0.0.1:8787";

async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${path}: ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as T;
}

const tools = [
  {
    name: "create_project",
    description: "Create an InfraWorks packaging project with CRS (default EPSG:32638)",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        epsg: { type: "number" },
      },
      required: ["name"],
    },
  },
  {
    name: "upload_input",
    description: "Upload a DWG/DXF/CSV/XLSX/PDF input file to a project",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        filePath: { type: "string", description: "Local filesystem path to upload" },
      },
      required: ["projectId", "filePath"],
    },
  },
  {
    name: "set_mapping_profile",
    description: "Set DWG layer → InfraWorks feature-class mapping profile",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        profile: { type: "object" },
      },
      required: ["projectId", "profile"],
    },
  },
  {
    name: "run_build",
    description: "Run the package build job for a project",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "get_job",
    description: "Get job status",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "get_validation",
    description: "Get validation report for a job",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "get_package_url",
    description: "Get download URL for the InfraWorks import ZIP",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "list_mapping_profiles",
    description: "List saved team mapping profiles (layer rules + where each team keeps asset ids)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "save_mapping_profile",
    description: "Save a team mapping profile for reuse across projects",
    inputSchema: {
      type: "object",
      properties: { profile: { type: "object" } },
      required: ["profile"],
    },
  },
  {
    name: "scan_layers",
    description:
      "List the layers of the project's latest drawing (DWG is converted to DXF first) with the class each would get and where asset ids were found",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" }, profileId: { type: "string" } },
      required: ["projectId"],
    },
  },
  {
    name: "list_report_columns",
    description: "Columns (and Excel sheets) of each uploaded report, for choosing the join column",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
    },
  },
] as const;

const server = new Server(
  { name: "infraworks-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments || {}) as Record<string, unknown>;

  try {
    let result: unknown;
    switch (name) {
      case "create_project":
        result = await api("/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: args.name,
            epsg: args.epsg ?? 32638,
          }),
        });
        break;
      case "upload_input": {
        const filePath = String(args.filePath);
        const buf = readFileSync(filePath);
        const form = new FormData();
        form.append(
          "file",
          new Blob([buf]),
          basename(filePath),
        );
        result = await api(`/projects/${args.projectId}/uploads`, {
          method: "POST",
          body: form,
        });
        break;
      }
      case "set_mapping_profile":
        result = await api(`/projects/${args.projectId}/mapping`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args.profile),
        });
        break;
      case "run_build":
        result = await api(`/projects/${args.projectId}/jobs`, { method: "POST" });
        break;
      case "get_job":
        result = await api(`/jobs/${args.jobId}`);
        break;
      case "get_validation":
        result = await api(`/jobs/${args.jobId}/validation`);
        break;
      case "get_package_url":
        result = await api(`/jobs/${args.jobId}/package-url`);
        break;
      case "list_mapping_profiles":
        result = await api("/mapping-profiles");
        break;
      case "save_mapping_profile":
        result = await api("/mapping-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args.profile),
        });
        break;
      case "scan_layers":
        result = await api(`/projects/${args.projectId}/scan-layers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args.profileId ? { profileId: args.profileId } : {}),
        });
        break;
      case "list_report_columns":
        result = await api(`/projects/${args.projectId}/reports`);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: message }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`infraworks-mcp connected (API ${API_BASE})`);
