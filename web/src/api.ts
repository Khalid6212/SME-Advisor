/**
 * API client.
 *
 * `credentials: "include"` on everything — the session is an httpOnly cookie,
 * which is why no token is ever held in JavaScript. The API allows exactly this
 * origin; a mismatch drops the cookie silently.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers:
      init.body && !(init.body instanceof FormData)
        ? { "content-type": "application/json", ...init.headers }
        : init.headers,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!res.ok) throw new ApiError(res.status, body?.error ?? "unknown", body?.message);
  return body as T;
}

export const api = {
  get: <T,>(p: string) => request<T>(p),
  post: <T,>(p: string, body?: unknown) =>
    request<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T,>(p: string, body: unknown) =>
    request<T>(p, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T,>(p: string) => request<T>(p, { method: "DELETE" }),
  upload: <T,>(p: string, file: File, consent: string) => {
    const form = new FormData();
    form.append("consent", consent);
    form.append("file", file);
    return request<T>(p, { method: "POST", body: form });
  },
  downloadUrl: (id: string) => `${BASE}/documents/${id}`,
};

// ─── types ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  role: "client" | "manager" | "admin";
  has_password: boolean;
  has_consented: boolean;
}

export interface AccountRow {
  id: string;
  email: string;
  role: "client" | "manager" | "admin";
  status: "active" | "disabled";
  created_at: string;
  last_seen_at: string | null;
  has_password: boolean;
}

export interface ClientRow {
  id: string;
  name: string;
  status: string;
  sector_id: string;
  created_at: string;
  closed_at: string | null;
  group_name: string | null;
  contact_email?: string;
  readiness: string | null;
  high_claims?: string;
  open_requests?: string;
}

export interface Node {
  id: string;
  parent_id: string | null;
  kind: "folder" | "item";
  position: number;
  path: string;
  title_en: string;
  title_ar: string;
  description_en: string | null;
  required: boolean;
  status: string;
  document_type: string | null;
  claim_keys: string[];
  children: Node[];
}

export interface Doc {
  id: string;
  node_id: string;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface DocVersion {
  id: string;
  version: number;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  superseded_at: string | null;
  uploaded_by_email: string;
  extract_status: "pending" | "done" | "unsupported" | "failed" | null;
  extract_summary: string | null;
}

export interface RoomView {
  progress: { provided: number; requested: number };
  tree: Node[];
  documents: Doc[];
  reasons?: { node_id: string; owner_quote: string; field_path: string }[];
}

export interface InterviewTurn {
  role: string;
  text: string;
}

export interface Claim {
  id: string;
  field_path: string;
  stated_value: string | null;
  owner_quote: string;
  materiality: "high" | "medium" | "low";
  verification_status: "unverified" | "confirmed" | "contradicted";
}

export interface InterviewSummary {
  status: string;
  sections: { section_id: string; complete: boolean }[];
  messages: InterviewTurn[];
  profile: { version: number; readiness: string | null } | null;
  claims: Claim[];
}

export interface CompetitorNote {
  name: string;
  strengths: string;
  weaknesses: string;
}

export interface PlanInputs {
  revenue_growth_pct: number | null;
  growth_basis: string | null;
  projection_years: number;
  management_assessment: string | null;
  positioning_notes: string | null;
  risk_mitigants: string | null;
  use_of_funds_notes: string | null;
  loan_term_years: number | null;
  loan_interest_rate_pct: number | null;
  asset_useful_life_years: number | null;
  market_size_tam: number | null;
  market_size_sam: number | null;
  market_size_som: number | null;
  market_size_sources: string | null;
  market_growth_pct: number | null;
  market_drivers_notes: string | null;
  competitor_notes: CompetitorNote[];
  exit_strategy_notes: string | null;
  unit_economics_notes: string | null;
  updated_at?: string;
}

export interface FinancialLine {
  year_offset: number;
  line_item: string;
  value: string;
  basis: string | null;
  scenario: "base" | "bull" | "bear";
}
