export interface ApsConfig {
  clientId?: string;
  clientSecret?: string;
  callbackUrl?: string;
}

export interface ModelDerivativePreview {
  status: "mocked" | "ready" | "pending" | "failed";
  urn?: string;
  viewerUrl?: string;
  message: string;
}

export class ApsClient {
  constructor(private readonly config: ApsConfig = {}) {}

  get isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  async getTwoLeggedToken(): Promise<{ access_token: string; mocked: boolean }> {
    if (!this.isConfigured) {
      return { access_token: "local-mock-token", mocked: true };
    }
    // Production path would call APS authentication API.
    throw new Error(
      "Live APS token exchange not wired in this MVP build — set LOCAL_MODE or implement OAuth",
    );
  }

  async translateForPreview(objectKey: string): Promise<ModelDerivativePreview> {
    if (!this.isConfigured) {
      return {
        status: "mocked",
        urn: `urn:local:mock:${objectKey}`,
        viewerUrl: undefined,
        message:
          "APS_CLIENT_ID / APS_CLIENT_SECRET missing — Model Derivative preview is mocked",
      };
    }
    return {
      status: "pending",
      urn: `urn:adsk:live:${objectKey}`,
      message: "Submit to Model Derivative (live path stub)",
    };
  }
}

export function createApsClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ApsClient {
  return new ApsClient({
    clientId: env.APS_CLIENT_ID || undefined,
    clientSecret: env.APS_CLIENT_SECRET || undefined,
    callbackUrl: env.APS_CALLBACK_URL || undefined,
  });
}
