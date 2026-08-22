/**
 * Shared consent-purpose constant.
 *
 * Lives outside auth.ts and routes/privacy.ts so neither has to import the
 * other — auth.ts needs it for the has_consented flag, privacy.ts needs it as
 * the value clients actually post.
 */
export const INTERVIEW_CONSENT_PURPOSE = "interview_data_processing";
