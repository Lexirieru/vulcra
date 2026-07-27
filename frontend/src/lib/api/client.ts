// Thin typed fetch client for the Vulcra backend (KTD5). One place wraps the
// base URL, JSON handling, and a normalized error so the rest of the app never
// touches `fetch` directly. Swapping endpoint shapes = edit here + ./types.
import { API_BASE_URL } from "@/config/contracts";
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
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

  listAtRiskVaults: (belowCrBps?: number, branch?: string) => {
    const params = new URLSearchParams();
    if (belowCrBps) params.set("belowCr", String(belowCrBps));
    if (branch) params.set("branch", branch);
    const qs = params.toString();
    return request<AtRiskVault[]>(`/vaults/at-risk${qs ? `?${qs}` : ""}`);
  },

  listGuardianRules: (owner: string) =>
    request<GuardianRule[]>(`/guardian/rules?owner=${encodeURIComponent(owner)}`),

  createGuardianRule: (input: GuardianRuleInput) =>
    request<GuardianRule>("/guardian/rules", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  setGuardianRuleEnabled: (id: string, enabled: boolean) =>
    request<GuardianRule>(`/guardian/rules/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
};
