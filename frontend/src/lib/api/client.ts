// Thin typed fetch client for the Vulcra backend (KTD5). One place wraps the
// base URL, JSON handling, and a normalized error so the rest of the app never
// touches `fetch` directly. Swapping endpoint shapes = edit here + ./types.
import { API_BASE_URL, GUARDIAN_API_URL } from "@/config/contracts";
import type {
  AccountResponse,
  AtRiskVault,
  GuardianRule,
  GuardianRuleInput,
  ManageBuildRequest,
  MintBuildRequest,
  MintBuildResponse,
  MintPlanRaw,
  MintStatusResponse,
  MintSubmitRequest,
  MintSubmitResponse,
  PreflightRequest,
  PreflightResponse,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  baseUrl: string = API_BASE_URL,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch (cause) {
    throw new ApiError("Backend unreachable", 0, cause);
  }
  const text = await res.text();
  const body = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const message =
      (body as { message?: string } | undefined)?.message ??
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status, body);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Adapt the backend's flat MintPlan/ManagePlan to the nested UI shape. */
function planToBuildResponse(plan: MintPlanRaw): MintBuildResponse {
  return {
    packedUserOpHex: plan.userOpBytes,
    memoUserOpHash: plan.userOpHash,
    payment: {
      destination: plan.coreVaultXrplAddress,
      amountDrops: plan.requiredPaymentDrops,
      memoHex: plan.memo,
    },
    requiredPaymentXrp: plan.requiredPaymentXrp,
    qrData: plan.coreVaultXrplAddress,
  };
}

export const api = {
  getAccount: (xrplAddress: string) =>
    request<AccountResponse>(`/account/${encodeURIComponent(xrplAddress)}`),

  preflight: (input: PreflightRequest) =>
    request<PreflightResponse>("/mint/preflight", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // The backend returns the flat MintPlan (coreVaultXrplAddress / requiredPayment*
  // / memo / userOpBytes / userOpHash). Adapt it here to the nested shape the UI
  // renders + submits, so the components never touch the wire format. Xaman
  // deep-link payloads need the Xumm API server-side, which we don't run, so it
  // is omitted (the QR + Crossmark in-wallet sign are the sign paths).
  buildMint: async (input: MintBuildRequest): Promise<MintBuildResponse> =>
    planToBuildResponse(
      await request<MintPlanRaw>("/mint/build", { method: "POST", body: JSON.stringify(input) }),
    ),

  // Manage an existing vault (repay / close / adjust). Same flat MintPlan shape,
  // same adapter, so the sign → submit → track flow is byte-identical to the mint.
  buildManage: async (input: ManageBuildRequest): Promise<MintBuildResponse> =>
    planToBuildResponse(
      await request<MintPlanRaw>("/manage/build", { method: "POST", body: JSON.stringify(input) }),
    ),

  submitMint: (input: MintSubmitRequest) =>
    request<MintSubmitResponse>("/mint/submit", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getMintStatus: (mintId: string) =>
    request<MintStatusResponse>(`/mint/status/${encodeURIComponent(mintId)}`),

  listAtRiskVaults: async (belowCrBps?: number, branch?: string) => {
    const params = new URLSearchParams();
    if (belowCrBps) params.set("belowCr", String(belowCrBps));
    if (branch) params.set("branch", branch);
    const qs = params.toString();
    try {
      return await request<AtRiskVault[]>(`/vaults/at-risk${qs ? `?${qs}` : ""}`);
    } catch (err) {
      // The at-risk discovery endpoint (indexer, R19) is optional. When it isn't
      // served (404), degrade to "none at risk" — a healthy book genuinely has
      // no liquidatable vaults — instead of a hard error. Real failures (network,
      // 5xx) still surface as the error state.
      if (err instanceof ApiError && err.status === 404) return [] as AtRiskVault[];
      throw err;
    }
  },

  // Guardian rules live on the confidential keeper (guardian-service), a separate
  // service from the executor — so these three hit GUARDIAN_API_URL, not the
  // executor base. Falls back to the executor origin when the two are co-located.
  listGuardianRules: (owner: string) =>
    request<GuardianRule[]>(
      `/guardian/rules?owner=${encodeURIComponent(owner)}`,
      undefined,
      GUARDIAN_API_URL,
    ),

  createGuardianRule: (input: GuardianRuleInput) =>
    request<GuardianRule>(
      "/guardian/rules",
      { method: "POST", body: JSON.stringify(input) },
      GUARDIAN_API_URL,
    ),

  setGuardianRuleEnabled: (id: string, enabled: boolean) =>
    request<GuardianRule>(
      `/guardian/rules/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ enabled }) },
      GUARDIAN_API_URL,
    ),
};
