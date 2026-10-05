// UI vocabulary. Codes match the app.* domains in supabase/migrations (the database is the source of truth
// for integrity; this file is the source of truth for labels, icons and the quick-log grid).

export const CHANNELS = {
  call: { label: "Call", inPerson: false },
  email: { label: "Email", inPerson: false },
  text: { label: "Text", inPerson: false },
  door_knock: { label: "Door knock", inPerson: true },
  site_visit: { label: "Site visit", inPerson: true },
  inspection: { label: "Inspection", inPerson: true },
  roof_walk: { label: "Roof walk", inPerson: true },
  lunch_and_learn: { label: "Lunch & learn", inPerson: true },
  event: { label: "Event", inPerson: true },
  meeting: { label: "Meeting", inPerson: true },
  linkedin: { label: "LinkedIn", inPerson: false },
  mail: { label: "Mail", inPerson: false },
  other: { label: "Other", inPerson: false },
} as const;
export type Channel = keyof typeof CHANNELS;

export const OUTCOMES = {
  connected: { label: "Connected", tone: "good" },
  met_in_person: { label: "Met in person", tone: "good" },
  met_decision_maker: { label: "Met decision maker", tone: "great" },
  voicemail: { label: "Left voicemail", tone: "neutral" },
  no_answer: { label: "No answer", tone: "neutral" },
  gatekeeper: { label: "Gatekeeper", tone: "neutral" },
  not_there: { label: "Not there", tone: "neutral" },
  call_back_later: { label: "Call back later", tone: "good" },
  scheduled_inspection: { label: "Booked inspection", tone: "great" },
  bid_requested: { label: "Bid requested", tone: "great" },
  bid_submitted: { label: "Bid submitted", tone: "good" },
  sent: { label: "Sent", tone: "neutral" },
  replied: { label: "Got a reply", tone: "good" },
  not_interested: { label: "Not interested", tone: "bad" },
  bounced: { label: "Bounced", tone: "bad" },
  auto_reply: { label: "Auto-reply", tone: "neutral" },
  won: { label: "Won", tone: "great" },
  lost: { label: "Lost", tone: "bad" },
  other: { label: "Other", tone: "neutral" },
} as const;
export type Outcome = keyof typeof OUTCOMES;

/**
 * Quick-log grid: the outcomes that make sense per channel, in tap order. One tap on an outcome logs the touch
 * (channel + outcome are a single decision), which is how the log stays at three taps:
 *   1) contact (pre-selected from context)  2) channel  3) outcome.
 */
export const QUICK_OUTCOMES: Record<Channel, Outcome[]> = {
  call: ["connected", "voicemail", "no_answer", "gatekeeper", "call_back_later", "scheduled_inspection", "not_interested"],
  email: ["sent", "replied", "bounced"],
  text: ["sent", "replied"],
  door_knock: ["met_in_person", "met_decision_maker", "gatekeeper", "not_there", "scheduled_inspection", "not_interested"],
  site_visit: ["met_in_person", "met_decision_maker", "gatekeeper", "not_there", "scheduled_inspection", "bid_requested"],
  inspection: ["met_in_person", "bid_requested", "other"],
  roof_walk: ["met_in_person", "met_decision_maker", "bid_requested", "other"],
  lunch_and_learn: ["met_in_person", "met_decision_maker", "scheduled_inspection"],
  event: ["met_in_person", "met_decision_maker"],
  meeting: ["met_decision_maker", "met_in_person", "bid_requested", "scheduled_inspection"],
  linkedin: ["sent", "replied"],
  mail: ["sent"],
  other: ["connected", "other"],
};

/** Channels shown first in the log sheet (in-person first: it's the #1 way contracts are won). */
export const PRIMARY_CHANNELS: Channel[] = ["site_visit", "door_knock", "call", "email", "text", "meeting", "roof_walk", "lunch_and_learn"];

export const ACCOUNT_TYPES = {
  property_mgmt: "Property mgmt",
  condo_hoa_mgmt: "Condo/HOA management",
  owner: "Owner",
  reit: "REIT",
  institutional: "Institutional",
  facilities: "Facilities",
  asset_mgmt: "Asset mgmt",
  gc: "General contractor",
  developer: "Developer",
  consultant: "Roof consultant",
  architect: "Architect",
  broker: "Broker",
  government: "Government",
  education: "Education",
  healthcare: "Healthcare",
  industrial: "Industrial",
  retail: "Retail",
  hospitality: "Hospitality",
  religious: "House of worship",
  vendor: "Vendor",
  other: "Other",
} as const;
export type AccountType = keyof typeof ACCOUNT_TYPES;

export const STAGES = {
  lead: "Lead",
  contacted: "Contacted",
  inspection_scheduled: "Inspection scheduled",
  inspection_complete: "Inspection complete",
  proposal_sent: "Proposal sent",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
} as const;
export type Stage = keyof typeof STAGES;
export const OPEN_STAGES: Stage[] = ["lead", "contacted", "inspection_scheduled", "inspection_complete", "proposal_sent", "negotiation"];

/** Days in stage before an open opportunity is flagged as stalled. */
export const STALL_DAYS: Partial<Record<Stage, number>> = {
  lead: 7,
  contacted: 14,
  inspection_scheduled: 10,
  inspection_complete: 7,
  proposal_sent: 14,
  negotiation: 21,
};

export const SERVICE_LINES = {
  inspection: "Inspection",
  repair: "Repair",
  maintenance: "Maintenance program",
  emergency: "Emergency / leak",
  re_roof: "Re-roof",
  re_cover: "Re-cover",
  coating: "Coating",
  new_construction: "New construction",
  tenant_improvement: "Tenant improvement",
  envelope: "Envelope",
  insurance_claim: "Insurance claim",
  other: "Other",
} as const;
export type ServiceLine = keyof typeof SERVICE_LINES;

export const PERSONA_ROLES = {
  economic_buyer: "Decision maker",
  evaluator: "Evaluator",
  initiator: "Initiator",
  influencer: "Influencer",
  gatekeeper: "Gatekeeper",
  user: "On-site user",
  unknown: "Unknown",
} as const;
export type PersonaRole = keyof typeof PERSONA_ROLES;

export const ONBOARDING = {
  none: "Not started",
  initial_touch: "Initial touch",
  paperwork_started: "Paperwork started",
  paperwork_received: "Paperwork received",
  paperwork_finished: "Paperwork finished",
  compliant: "Compliant vendor",
} as const;
export type OnboardingStatus = keyof typeof ONBOARDING;

export const PREFERENCES = {
  pursue: { label: "Pursue", hint: "Ranks higher" },
  deprioritize: { label: "Deprioritize", hint: "Sinks to the bottom, stays visible" },
  do_not_pursue: { label: "Do not pursue", hint: "Off every queue and sequence" },
  competitor: { label: "Competitor", hint: "Off every queue and sequence" },
  existing_client: { label: "Existing client", hint: "Treated as a relationship to grow" },
  partner: { label: "Partner", hint: "Referral source, not a buyer" },
} as const;
export type Preference = keyof typeof PREFERENCES;

export const TIER_LABEL = (t: number | null | undefined) => `P${t ?? 3}`;

export const COLD_THRESHOLD_DAYS: Record<number, number> = { 1: 14, 2: 21, 3: 30, 4: 60 };

export const ROLES = ["owner", "admin", "manager", "rep", "estimator", "pm", "reviewer"] as const;
export type Role = (typeof ROLES)[number];
export const MANAGER_ROLES: Role[] = ["owner", "admin", "manager"];
