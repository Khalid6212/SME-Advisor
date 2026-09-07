/**
 * Derives a five-tier confidence rating (see CONFIDENCE_TIER) for one
 * provenance item, from data this app already collects — claims'
 * verification_status (was a document checked against this and did it
 * agree?) and provenance.source (where did this statement actually come
 * from?) — rather than asking for anything new. A pure mapping, not new
 * data collection, per D-reconcile's Milestone 5.
 */

import type { ConfidenceTier, Provenance } from "./types.ts";

export interface ClaimLookup {
  claim_key: string;
  field_path: string;
  verification_status: "unverified" | "confirmed" | "contradicted";
}

/** Keyed by both claim_key and field_path — provenance.ref is documented as
 *  "field path, claim key, or assumption label depending on source," and
 *  either can show up depending on which one the drafting agent had handy. */
export function buildClaimLookup(claims: ClaimLookup[]): Map<string, ClaimLookup> {
  const map = new Map<string, ClaimLookup>();
  for (const c of claims) {
    map.set(c.claim_key, c);
    map.set(c.field_path, c);
  }
  return map;
}

export function confidenceTier(provenance: Provenance, claims: Map<string, ClaimLookup>): ConfidenceTier {
  if (provenance.source === "assumption" || provenance.source === "manager_note") {
    // Forward-looking or advisor judgment — never a claim to check against,
    // by construction (see PLANNER_SYSTEM's grounding rules).
    return "estimated";
  }

  if (provenance.source === "document") {
    // An uploaded document's own extracted content — the closest this app's
    // vocabulary gets to the brief's "audited," whether or not it happens
    // to be a formally audited statement.
    return "audited";
  }

  // "profile" or "owner_quote" — the owner's own word, checked against a
  // document if one exists to check it against.
  const claim = claims.get(provenance.ref);
  if (!claim) return "stated";
  if (claim.verification_status === "confirmed") return "measured";
  if (claim.verification_status === "contradicted") return "unverified";
  return "stated";
}
