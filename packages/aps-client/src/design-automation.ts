import { getTwoLeggedToken, isApsConfigured } from "./auth.js";
import { APS_BASE, type ApsConfig, type DesignAutomationWorkItemResult } from "./types.js";

/**
 * Design Automation work-item stub for DWG layer listing / overlay normalize.
 * Patterns adapted from aps-design-automation-nodejs + aps-listlayers-designautomation.
 *
 * Live path requires `APS_DA_ACTIVITY_ID` (qualified activity, e.g. `{clientId}.ListLayersActivity+dev`)
 * and an uploaded OSS object id for the input DWG. Without credentials or activity id, returns mock layers.
 */
export async function submitDwgLayerListWorkItem(
  config: ApsConfig,
  opts: {
    inputObjectId?: string;
    /** Fallback layer names when mocking or when DA is not configured. */
    fallbackLayers?: string[];
  } = {},
): Promise<DesignAutomationWorkItemResult> {
  const fallback =
    opts.fallbackLayers ??
    ["ROADS", "COVERAGES", "WATER", "PARCELS", "ANNOTATION"];

  if (!isApsConfigured(config)) {
    return {
      status: "mocked",
      layers: fallback,
      message:
        "APS credentials missing — Design Automation layer list mocked from fallback / local parse",
      mocked: true,
    };
  }

  const activityId = config.daActivityId || process.env.APS_DA_ACTIVITY_ID;
  if (!activityId) {
    return {
      status: "mocked",
      layers: fallback,
      message:
        "APS_DA_ACTIVITY_ID not set — skipping live DA workitem; using fallback layers (configure ListLayers AutoCAD activity to enable)",
      mocked: true,
    };
  }

  if (!opts.inputObjectId) {
    return {
      status: "failed",
      message: "inputObjectId required for live Design Automation workitem",
      mocked: false,
    };
  }

  const token = await getTwoLeggedToken(config);
  const base = config.baseUrl ?? APS_BASE;
  const bearer = `Bearer ${token.access_token}`;

  // Workitem skeleton mirrors DA Node sample: inputFile GET from OSS object id.
  const workItemSpec = {
    activityId,
    arguments: {
      inputFile: {
        url: opts.inputObjectId,
        headers: { Authorization: bearer },
      },
      // ListLayers-style samples often emit result.json; we accept either.
      result: {
        url: `data:application/json,{"placeholder":true}`,
        verb: "put",
      },
    },
  };

  const res = await fetch(`${base}/da/us-east/v3/workitems`, {
    method: "POST",
    headers: {
      Authorization: bearer,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(workItemSpec),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      status: "failed",
      message: `DA workitem submit failed (${res.status}): ${text}`,
      mocked: false,
    };
  }

  const json = (await res.json()) as { id: string; status?: string };
  return {
    status: "submitted",
    workItemId: json.id,
    message: `Design Automation workitem ${json.id} submitted (${json.status ?? "pending"}). Poll getWorkItemStatus for layers JSON.`,
    mocked: false,
  };
}

export async function getWorkItemStatus(
  config: ApsConfig,
  workItemId: string,
): Promise<DesignAutomationWorkItemResult> {
  if (!isApsConfigured(config)) {
    return {
      status: "mocked",
      workItemId,
      layers: ["ROADS", "COVERAGES", "WATER", "PARCELS", "ANNOTATION"],
      message: "Mock workitem status",
      mocked: true,
    };
  }

  const token = await getTwoLeggedToken(config);
  const base = config.baseUrl ?? APS_BASE;
  const res = await fetch(`${base}/da/us-east/v3/workitems/${encodeURIComponent(workItemId)}`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!res.ok) {
    return {
      status: "failed",
      workItemId,
      message: `DA status failed (${res.status}): ${await res.text()}`,
      mocked: false,
    };
  }
  const json = (await res.json()) as {
    status: string;
    reportUrl?: string;
  };
  const mapped =
    json.status === "success"
      ? "success"
      : json.status === "failed" || json.status === "cancelled"
        ? "failed"
        : json.status === "pending"
          ? "pending"
          : "inprogress";

  return {
    status: mapped,
    workItemId,
    report: json.reportUrl,
    message: `Workitem ${workItemId}: ${json.status}`,
    mocked: false,
  };
}
