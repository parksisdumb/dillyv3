// Dev-only fixtures for /preview/[screen]. FOX-like book: multifamily PMCs in Austin and DFW.
import { addDays, localDate, weekStart } from "@/lib/format";
import { computeBadges } from "@/lib/domain/badges";
import { DEFAULT_POINTS } from "@/lib/domain/points";
import type { TodayData } from "@/components/today/today-view";
import type { QueueRow } from "@/components/today/queue-item";
import type { AccountRowData } from "@/components/accounts/account-row";
import type { AccountDetailData } from "@/components/accounts/account-detail-view";
import type { PipelineColumn } from "@/components/pipeline/pipeline-view";
import type { TeamHomeData } from "@/components/team/team-home-view";
import type { ApprovalRow } from "@/components/team/approvals-view";
import type { MeData } from "@/components/team/me-view";
import type { FocusItem, Stop } from "@/components/go/types";
import type { ContactOption, LogContextData } from "@/lib/actions/log-types";
import type { ContactListRow, PropertyListRow } from "@/lib/server/book";
import type { ContactDetailData } from "@/components/accounts/contact-detail-view";
import type { PropertyDetailData } from "@/components/accounts/property-detail-view";
import { propertyBadges } from "@/lib/domain/badges-property";

const TZ = "America/Chicago";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const USERS = {
  colby: id(901),
  kayla: id(902),
  ben: id(903),
  dylan: id(904),
  tyler: id(905),
};

export function fixtures() {
  const today = localDate(TZ);
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

  const A = {
    greystar: id(1),
    rpm: id(2),
    asset: id(3),
    lincoln: id(4),
    cortland: id(5),
    pinnacle: id(6),
    camden: id(7),
    lonestar: id(8),
    avenue5: id(9),
  };

  const session = {
    tenant: { slug: "fox", name: "FOX Roofing", role: "rep" },
    tenants: [
      { slug: "fox", name: "FOX Roofing", role: "rep" },
      { slug: "tsg", name: "The Service Group", role: "rep" },
    ],
    fullName: "Colby Remedios",
    email: "colby@foxroofing.co",
  };

  const queue: QueueRow[] = [
    {
      item_type: "task",
      task_id: id(101),
      account_id: A.greystar,
      contact_id: id(201),
      opportunity_id: id(301),
      property_id: id(401),
      title: "Follow up on bid with Dave Morales",
      reason: "After bid submitted (email) — $160K TPO re-roof, Riverside",
      due_on: addDays(today, -4),
      overdue_days: 4,
      account_name: "Greystar — Austin",
      contact_name: "Dave Morales",
      phone: "512-555-0142",
      email: "dmorales@greystar.com",
      icp_tier: 1,
    },
    {
      item_type: "task",
      task_id: id(102),
      account_id: A.rpm,
      contact_id: id(202),
      opportunity_id: null,
      property_id: null,
      title: "Call Jen Park back",
      reason: "After voicemail (call) on " + addDays(today, -5).slice(5),
      due_on: addDays(today, -2),
      overdue_days: 2,
      account_name: "RPM Living — DFW",
      contact_name: "Jen Park",
      phone: "214-555-0199",
      email: "jpark@rpmliving.com",
      icp_tier: 2,
    },
    {
      item_type: "task",
      task_id: id(103),
      account_id: A.asset,
      contact_id: id(203),
      opportunity_id: null,
      property_id: null,
      title: "Confirm inspection with Marcus Lee",
      reason: "After booked inspection (site visit) — Thu 9:00, Bldg C ponding",
      due_on: today,
      overdue_days: 0,
      account_name: "Asset Living",
      contact_name: "Marcus Lee",
      phone: "512-555-0110",
      email: null,
      icp_tier: 2,
    },
    {
      item_type: "task",
      task_id: id(104),
      account_id: A.cortland,
      contact_id: id(204),
      opportunity_id: null,
      property_id: null,
      title: "Respond to Ana Ruiz",
      reason: "She replied: “send the maintenance program pricing”",
      due_on: today,
      overdue_days: 0,
      account_name: "Cortland — Round Rock",
      contact_name: "Ana Ruiz",
      phone: null,
      email: "aruiz@cortland.com",
      icp_tier: 3,
    },
    {
      item_type: "reengage",
      task_id: null,
      account_id: A.lincoln,
      contact_id: null,
      opportunity_id: null,
      property_id: null,
      title: "Re-engage Lincoln Property Co",
      reason: "P1 quiet 22 days (threshold 14)",
      due_on: null,
      overdue_days: null,
      account_name: "Lincoln Property Co",
      contact_name: null,
      phone: "214-555-0123",
      email: null,
      icp_tier: 1,
    },
    {
      item_type: "first_touch",
      task_id: null,
      account_id: A.pinnacle,
      contact_id: null,
      opportunity_id: null,
      property_id: null,
      title: "First touch: Pinnacle Property Management",
      reason: "P2 · 14 properties · 3 roofs past 18 years",
      due_on: null,
      overdue_days: null,
      account_name: "Pinnacle Property Management",
      contact_name: null,
      phone: "512-555-0177",
      email: null,
      icp_tier: 2,
    },
  ];

  queue.unshift({
    item_type: "task",
    task_id: id(100),
    account_id: A.rpm,
    contact_id: null,
    opportunity_id: null,
    property_id: id(401),
    title: "Intro to new management at Riverside Apartments",
    reason: "Riverside Apartments moved from Greystar — Austin to RPM Living — DFW",
    due_on: today,
    overdue_days: 0,
    account_name: "RPM Living — DFW",
    contact_name: null,
    phone: "214-555-0199",
    email: null,
    icp_tier: 2,
  });
  const todayData: TodayData = {
    brief: {
      headline: "Greystar’s $160K Riverside re-roof has sat 53 days in Proposal Sent. Call Dave before 10.",
      lines: [
        { kind: "one_thing", text: "Dave Morales owes you a decision — ask what’s holding the board vote." },
        { kind: "due", text: "4 follow-ups due (2 late) · first stop Asset Living Bldg C at 9:00." },
        { kind: "new", text: "1.25″ hail over north Austin overnight · 2 PMC accounts assigned to you." },
      ],
    },
    items: queue,
    snoozes: { [id(102)]: 3 },
    cleared: 3,
    pointsToday: 14,
    streak: 4,
    goal: { label: "Inspections booked", target: 20, count: 13 },
    leaders: [
      { user_id: USERS.kayla, full_name: "Kayla Smiley", touches: 48, points: 86 },
      { user_id: USERS.colby, full_name: "Colby Remedios", touches: 45, points: 72 },
      { user_id: USERS.ben, full_name: "Ben Mitchell", touches: 31, points: 51 },
      { user_id: USERS.dylan, full_name: "Dylan Kreiser", touches: 22, points: 38 },
    ],
    meId: USERS.colby,
    badges: {
      [id(401)]: propertyBadges({ roof_system: "TPO", roof_install_year: 2009, warranty_expires_on: addDays(today, -400), active_flags: ["active_leak"], open_service_lines: ["re_roof"], management_changed_on: addDays(today, -21) }, today),
    },
  };

  const accounts: AccountRowData[] = [
    { id: A.greystar, name: "Greystar — Austin", account_type: "property_mgmt", icp_tier: 1, relationship_state: "active", last_touch_at: daysAgo(4), days_since_touch: 4, property_count: 23, contact_count: 9, open_opps: 2, excluded_reason: null, preference: "pursue", city: "Austin" },
    { id: A.lincoln, name: "Lincoln Property Co", account_type: "property_mgmt", icp_tier: 1, relationship_state: "cold", last_touch_at: daysAgo(22), days_since_touch: 22, property_count: 31, contact_count: 6, open_opps: 0, excluded_reason: null, preference: null, city: "Dallas" },
    { id: A.rpm, name: "RPM Living — DFW", account_type: "property_mgmt", icp_tier: 2, relationship_state: "active", last_touch_at: daysAgo(7), days_since_touch: 7, property_count: 18, contact_count: 5, open_opps: 1, excluded_reason: null, preference: null, city: "Plano" },
    { id: A.asset, name: "Asset Living", account_type: "property_mgmt", icp_tier: 2, relationship_state: "active", last_touch_at: daysAgo(2), days_since_touch: 2, property_count: 12, contact_count: 4, open_opps: 1, excluded_reason: null, preference: null, city: "Austin" },
    { id: A.pinnacle, name: "Pinnacle Property Management", account_type: "property_mgmt", icp_tier: 2, relationship_state: "not_started", last_touch_at: null, days_since_touch: null, property_count: 14, contact_count: 0, open_opps: 0, excluded_reason: null, preference: null, city: "Austin" },
    { id: A.cortland, name: "Cortland — Round Rock", account_type: "owner", icp_tier: 3, relationship_state: "active", last_touch_at: daysAgo(1), days_since_touch: 1, property_count: 4, contact_count: 2, open_opps: 0, excluded_reason: null, preference: null, city: "Round Rock" },
    { id: A.avenue5, name: "Avenue5 Residential", account_type: "property_mgmt", icp_tier: 3, relationship_state: "active", last_touch_at: daysAgo(9), days_since_touch: 9, property_count: 7, contact_count: 3, open_opps: 0, excluded_reason: null, preference: "deprioritize", city: "San Antonio" },
    { id: A.camden, name: "Camden Property Trust", account_type: "reit", icp_tier: 2, relationship_state: "do_not_pursue", last_touch_at: daysAgo(40), days_since_touch: 40, property_count: 11, contact_count: 3, open_opps: 0, excluded_reason: "Pays at 120 days, uses in-house crew", preference: "do_not_pursue", city: "Houston" },
    { id: A.lonestar, name: "Lone Star Roofing & Restoration", account_type: "vendor", icp_tier: 4, relationship_state: "do_not_pursue", last_touch_at: null, days_since_touch: null, property_count: 0, contact_count: 1, open_opps: 0, excluded_reason: "Marked competitor", preference: "competitor", city: "Austin" },
  ];

  const account: AccountDetailData = {
    id: A.greystar,
    today,
    a: {
      name: "Greystar — Austin",
      icp_tier: 1,
      relationship_state: "active",
      account_type: "property_mgmt",
      days_since_touch: 4,
      last_touch_at: daysAgo(4),
      excluded_reason: null,
      phone: "512-555-0100",
      address1: "600 Congress Ave, Ste 1400",
      city: "Austin",
      state: "TX",
      onboarding_status: "paperwork_received",
      preference: "pursue",
      preference_reason: "Largest PMC in the metro",
      open_value: 184000,
    },
    task: { id: id(101), title: "Follow up on bid with Dave Morales", due_on: addDays(today, -4), reason: "After bid submitted (email)" },
    opps: [
      { id: id(301), name: "Riverside — TPO re-roof, Bldgs A–F", stage: "proposal_sent", value_estimate: 160000, next_step: "Board vote follow-up with Dave", next_step_due: addDays(today, -4), stage_changed_at: daysAgo(53) },
      { id: id(302), name: "Eastside Lofts — leak repair", stage: "inspection_scheduled", value_estimate: 24000, next_step: "Walk Bldg 2 with maintenance lead", next_step_due: addDays(today, 2), stage_changed_at: daysAgo(3) },
    ],
    props: [
      { id: id(401), name: "Riverside Apartments", address1: "1801 S Pleasant Valley Rd", city: "Austin", roof_system: "TPO", roof_install_year: 2009, roof_area_sf: 186000 },
      { id: id(402), name: "Eastside Lofts", address1: "1100 E 5th St", city: "Austin", roof_system: "Mod-bit", roof_install_year: 2014, roof_area_sf: 64000 },
      { id: id(403), name: "The Domain Flats", address1: "11400 Domain Dr", city: "Austin", roof_system: null, roof_install_year: null, roof_area_sf: null },
    ],
    contacts: [
      { id: id(201), full_name: "Dave Morales", title: "Regional Facilities Director", persona_role: "economic_buyer", phone: "512-555-0142", mobile: null, email: "dmorales@greystar.com", do_not_contact: false },
      { id: id(205), full_name: "Priya Shah", title: "Regional Manager", persona_role: "evaluator", phone: null, mobile: "512-555-0167", email: "pshah@greystar.com", do_not_contact: false },
      { id: id(206), full_name: "Luis Ortega", title: "Maintenance Supervisor, Riverside", persona_role: "user", phone: "512-555-0188", mobile: null, email: null, do_not_contact: false },
      { id: id(207), full_name: "Maria Chen", title: "Leasing Office", persona_role: "gatekeeper", phone: "512-555-0101", mobile: null, email: null, do_not_contact: false },
    ],
    timeline: [
      { id: id(501), occurred_at: daysAgo(4), channel: "email", outcome: "bid_submitted", notes: "Sent 3-option proposal: repair / recover / full TPO tear-off. Middle option $160K.", who: "Colby Remedios", contact: "Dave Morales", contact_id: id(201) },
      { id: id(502), occurred_at: daysAgo(9), channel: "roof_walk", outcome: "met_decision_maker", notes: "Walked A–F with Dave and Luis. 2009 TPO, seams failing on B and D, ponding west side of C. Warranty expired 2024.", who: "Colby Remedios", contact: "Dave Morales", contact_id: id(201) },
      { id: id(503), occurred_at: daysAgo(16), channel: "site_visit", outcome: "gatekeeper", notes: "Maria at leasing gave me Luis’s cell. Dave is the decision maker.", who: "Kayla Smiley", contact: "Maria Chen", contact_id: id(207) },
    ],
    ownerName: "Colby Remedios",
    propBadges: {
      [id(401)]: propertyBadges({ roof_system: "TPO", roof_install_year: 2009, warranty_expires_on: addDays(today, -400), active_flags: ["active_leak"], open_service_lines: ["re_roof"], management_changed_on: addDays(today, -21) }, today),
      [id(402)]: propertyBadges({ roof_system: "Mod-bit", roof_install_year: 2014, open_service_lines: ["repair"] }, today),
      [id(403)]: propertyBadges({}, today),
    },
    past: [
      { id: id(409), name: "Barton Creek Villas", role: "manager", started_on: "2019-04-01", ended_on: addDays(today, -60), now: "RPM Living — DFW" },
      { id: id(410), name: "Mueller Station", role: "manager", started_on: null, ended_on: "2025-11-15", now: "Asset Living" },
    ],
    movePeople: [
      { id: id(201), name: "Dave Morales", title: "Regional Facilities Director", persona_role: "economic_buyer", account_id: A.greystar, propertyIds: [id(401), id(402)] },
      { id: id(206), name: "Luis Ortega", title: "Maintenance Supervisor, Riverside", persona_role: "user", account_id: A.greystar, propertyIds: [id(401)] },
      { id: id(207), name: "Maria Chen", title: "Leasing Office", persona_role: "gatekeeper", account_id: A.greystar, propertyIds: [id(401)] },
    ],
  };

  const LINES: Record<number, string> = { 601: "inspection", 602: "emergency", 302: "repair", 603: "repair", 301: "re_roof", 604: "re_cover", 605: "maintenance" };
  const card = (n: number, name: string, acct: string, value: number, days: number, stalled: boolean, next: string | null, due: string | null) => ({
    service_line: LINES[n] ?? null,
    id: id(n),
    name,
    account: acct,
    value,
    daysInStage: days,
    stalled,
    next_step: next,
    next_step_due: due,
  });
  const pipeline: PipelineColumn[] = [
    { stage: "lead", items: [card(601, "Pinnacle — portfolio inspection", "Pinnacle Property Management", 8000, 2, false, "Get the regional’s name", addDays(today, 1))], total: 8000, stalled: 0 },
    { stage: "contacted", items: [card(602, "Lincoln — Preston Hollow leak", "Lincoln Property Co", 18000, 19, true, null, null)], total: 18000, stalled: 1 },
    {
      stage: "inspection_scheduled",
      items: [card(302, "Eastside Lofts — leak repair", "Greystar — Austin", 24000, 3, false, "Walk Bldg 2", addDays(today, 2)), card(603, "Bldg C ponding repair", "Asset Living", 31000, 5, false, "Confirm with Marcus", today)],
      total: 55000,
      stalled: 0,
    },
    { stage: "inspection_complete", items: [], total: 0, stalled: 0 },
    {
      stage: "proposal_sent",
      items: [card(301, "Riverside — TPO re-roof, Bldgs A–F", "Greystar — Austin", 160000, 53, true, "Board vote follow-up with Dave", addDays(today, -4)), card(604, "Legacy Oaks recover", "RPM Living — DFW", 72000, 11, false, "Call Jen re: budget", addDays(today, 3))],
      total: 232000,
      stalled: 1,
    },
    { stage: "negotiation", items: [card(605, "Cortland maintenance program", "Cortland — Round Rock", 26000, 24, true, "Send revised scope", addDays(today, -1))], total: 26000, stalled: 1 },
  ];

  const team: TeamHomeData = {
    tenantName: "FOX Roofing",
    pace: [
      { user_id: USERS.kayla, name: "Kayla Smiley", role: "rep", touchesToday: 9, touchesWeek: 48, inPersonWeek: 21, connectsWeek: 12, pointsWeek: 86, followUpPct: 94, followUpsDue: 17, overdue: 0, streak: 6 },
      { user_id: USERS.colby, name: "Colby Remedios", role: "rep", touchesToday: 7, touchesWeek: 45, inPersonWeek: 18, connectsWeek: 9, pointsWeek: 72, followUpPct: 71, followUpsDue: 24, overdue: 2, streak: 4 },
      { user_id: USERS.ben, name: "Ben Mitchell", role: "rep", touchesToday: 4, touchesWeek: 31, inPersonWeek: 6, connectsWeek: 4, pointsWeek: 51, followUpPct: 88, followUpsDue: 8, overdue: 1, streak: 2 },
      { user_id: USERS.dylan, name: "Dylan Kreiser", role: "rep", touchesToday: 0, touchesWeek: 22, inPersonWeek: 3, connectsWeek: 2, pointsWeek: 38, followUpPct: 52, followUpsDue: 21, overdue: 9, streak: 0 },
    ],
    cold: [
      { id: A.lincoln, name: "Lincoln Property Co", days_since_touch: 22, last_touch_at: daysAgo(22) },
      { id: id(10), name: "Bell Partners — Dallas", days_since_touch: 31, last_touch_at: daysAgo(31) },
      { id: id(11), name: "Morgan Group", days_since_touch: 27, last_touch_at: daysAgo(27) },
      { id: id(12), name: "Embrey Partners", days_since_touch: 24, last_touch_at: daysAgo(24) },
      { id: id(13), name: "Trammell Crow Residential", days_since_touch: 23, last_touch_at: daysAgo(23) },
    ],
    stalled: [
      { id: id(301), name: "Riverside — TPO re-roof, Bldgs A–F", why: "53d in stage", value_estimate: 160000 },
      { id: id(605), name: "Cortland maintenance program", why: "24d in stage", value_estimate: 26000 },
      { id: id(602), name: "Lincoln — Preston Hollow leak", why: "No next step", value_estimate: 18000 },
    ],
    health: { duplicates: 19, propertiesIncomplete: 136, completePct: 71 },
    pending: 3,
  };

  const approvals: ApprovalRow[] = [
    {
      id: id(701),
      gate: "G1",
      action_type: "send_email",
      summary: "Follow-up email to Dave Morales (Greystar) on the Riverside proposal",
      payload: { to: "dmorales@greystar.com", subject: "Riverside — the board question", body: "Dave — you mentioned the board meets the 20th. Want me to walk them through the middle option?" },
      created_at: hoursAgo(2),
    },
    {
      id: id(702),
      gate: "G6",
      action_type: "event_spend",
      summary: "Lunch & learn for RPM Living DFW regional team — $240 catering",
      payload: { vendor: "Torchy’s Catering", amount_usd: 240, attendees: 14, topic: "Storm prep for multifamily roofs" },
      created_at: hoursAgo(20),
    },
    {
      id: id(703),
      gate: "G8",
      action_type: "bulk_update",
      summary: "Merge 19 duplicate contacts found at insert-time review",
      payload: { merges: 19, sample: ["Jen Park ×2 (RPM Living)", "Luis Ortega ×2 (Greystar)"] },
      created_at: daysAgo(1),
    },
  ];

  const evt = (event: string, d: number) => ({ event, occurred_at: daysAgo(d), voided: false });
  const meEvents = [
    ...Array.from({ length: 7 }, (_, i) => evt("decision_maker_conversation", i % 9)),
    ...Array.from({ length: 11 }, (_, i) => evt("field_contact_created", i % 10)),
    evt("lunch_and_learn", 30),
    ...Array.from({ length: 3 }, (_, i) => evt("cold_rescued", i * 5)),
  ];
  const wk = weekStart(today);
  const repDays = Array.from({ length: 10 }, (_, i) => ({ day: addDays(wk, -i - 1), cleared: i < 6 }));
  const me: MeData = {
    name: "Colby Remedios",
    subtitle: "FOX Roofing · rep",
    pts: { today: 14, week: 72, month: 311, all: 1874 },
    streak: 4,
    badges: computeBadges({ pointEvents: meEvents, repDays, today, timeZone: TZ }),
    recent: [
      { label: "Bid requested", occurred_at: hoursAgo(1), points: 15 },
      { label: "Reached a decision maker", occurred_at: hoursAgo(1), points: 6 },
      { label: "Conversation", occurred_at: hoursAgo(1), points: 3 },
      { label: "Follow-up on time", occurred_at: hoursAgo(3), points: 3 },
      { label: "New contact from the field", occurred_at: hoursAgo(5), points: 4 },
      { label: "Logged touch", occurred_at: hoursAgo(5), points: 1 },
    ],
    pending: 3,
  };

  const austinStops: Stop[] = [
    {
      accountId: A.asset,
      accountName: "Asset Living",
      tier: 2,
      propertyId: id(404),
      place: "Crestview Station — Bldg C",
      address: "7101 Woodrow Ave",
      city: "Austin",
      reason: "Confirm inspection with Marcus Lee",
      directions: "https://www.google.com/maps/dir/?api=1&destination=7101%20Woodrow%20Ave%2C%20Austin%2C%20TX",
      contacts: [
        { id: id(203), name: "Marcus Lee", title: "Maintenance Supervisor", role: "user" },
        { id: id(208), name: "Tanya Brooks", title: "Community Manager", role: "evaluator" },
      ],
      fromQueue: true,
    },
    {
      accountId: A.greystar,
      accountName: "Greystar — Austin",
      tier: 1,
      propertyId: id(401),
      place: "Riverside Apartments",
      address: "1801 S Pleasant Valley Rd",
      city: "Austin",
      reason: "Follow up on bid with Dave Morales",
      directions: "https://www.google.com/maps",
      contacts: account.contacts.map((c) => ({ id: c.id, name: c.full_name ?? "", title: c.title, role: c.persona_role })),
      fromQueue: true,
    },
    {
      accountId: A.pinnacle,
      accountName: "Pinnacle Property Management",
      tier: 2,
      propertyId: id(405),
      place: "Mueller Commons",
      address: "1900 Aldrich St",
      city: "Austin",
      reason: "P2 · Never touched",
      directions: "https://www.google.com/maps",
      contacts: [],
      fromQueue: false,
    },
  ];
  austinStops[0].badges = propertyBadges({ roof_system: "Mod-bit", roof_install_year: 2008, active_flags: ["ponding"], open_service_lines: ["repair"], storm_kind: "hail", storm_at: daysAgo(3) }, today);
  austinStops[0].flags = ["ponding"];
  austinStops[1].badges = propertyBadges({ roof_system: "TPO", roof_install_year: 2009, active_flags: ["active_leak"], open_service_lines: ["re_roof"], management_changed_on: addDays(today, -21) }, today);
  austinStops[1].flags = ["active_leak"];
  const cities = [
    { city: "Austin", total: 9, due: 3 },
    { city: "Round Rock", total: 4, due: 1 },
    { city: "Dallas", total: 6, due: 0 },
    { city: "Plano", total: 3, due: 0 },
  ];

  const focus: FocusItem[] = queue
    .filter((q) => q.phone)
    .map((q) => ({
      key: q.task_id ?? q.account_id ?? "",
      accountId: q.account_id,
      contactId: q.contact_id,
      propertyId: q.property_id,
      opportunityId: q.opportunity_id,
      name: q.contact_name ?? q.account_name ?? "",
      account: q.contact_name ? q.account_name : null,
      phone: q.phone!,
      reason: q.title,
      tier: q.icp_tier,
    }));

  const logContacts: ContactOption[] = account.contacts.map((c) => ({
    id: c.id,
    name: c.full_name ?? "",
    title: c.title,
    persona_role: c.persona_role,
    account_id: A.greystar,
    account_name: "Greystar — Austin",
  }));
  const logData: LogContextData = {
    account: { id: A.greystar, name: "Greystar — Austin" },
    contact: logContacts[0],
    contacts: logContacts,
    properties: account.props.map((p) => ({ id: p.id, label: p.name ?? p.address1 ?? "" })),
    opportunities: account.opps.map((o) => ({ id: o.id, name: o.name })),
    points: DEFAULT_POINTS,
    today,
  };


  const now = new Date();
  const ago = (d: number | null) => (d == null ? null : new Date(now.getTime() - d * 86_400_000).toISOString());
  const crow = (n: number, name: string, title: string | null, role: string, acct: string | null, acctName: string | null, days: number | null, extra: Partial<ContactListRow> = {}): ContactListRow => ({
    id: id(n),
    name,
    title,
    persona_role: role,
    account_id: acct,
    account_name: acctName,
    last_touch_at: ago(days),
    days,
    phone: "512-555-01" + String(n).slice(-2),
    email: name.split(" ")[0].toLowerCase() + "@example.com",
    bounced: false,
    quiet: false,
    dupe: false,
    do_not_contact: false,
    ...extra,
  });
  const contactsList: ContactListRow[] = [
    crow(201, "Dave Morales", "Regional Facilities Director", "economic_buyer", A.greystar, "Greystar — Austin", 4),
    crow(203, "Marcus Lee", "Maintenance Supervisor", "user", A.asset, "Asset Living", 2, { email: null }),
    crow(202, "Jen Park", "Regional Property Manager", "evaluator", A.rpm, "RPM Living — DFW", 7, { dupe: true }),
    crow(209, "Jennifer Park", "Property Manager", "evaluator", A.rpm, "RPM Living — DFW", 41, { dupe: true, quiet: true }),
    crow(210, "Tom Reyes", "VP Asset Management", "economic_buyer", A.lincoln, "Lincoln Property Co", 22, { quiet: true }),
    crow(204, "Ana Ruiz", "Community Manager", "initiator", A.cortland, "Cortland — Round Rock", 1, { phone: null }),
    crow(211, "Kevin Walsh", "Chief Engineer", "user", A.pinnacle, "Pinnacle Property Management", null),
    crow(212, "Brianna Cole", null, "unknown", null, null, 9, { bounced: true }),
    crow(207, "Maria Chen", "Leasing Office", "gatekeeper", A.greystar, "Greystar — Austin", 16),
  ];

  const year = Number(today.slice(0, 4));
  const prow = (n: number, name: string, address: string | null, city: string, acct: string | null, acctName: string | null, roof: string | null, installed: number | null, sf: number | null, days: number | null, extra: Partial<PropertyListRow> = {}): PropertyListRow => ({
    id: id(n),
    name,
    address,
    city,
    account_id: acct,
    account_name: acctName,
    roof_system: roof,
    roof_install_year: installed,
    roof_area_sf: sf,
    warranty_expires_on: null,
    open_value: 0,
    open_count: 0,
    last_touch_at: ago(days),
    days,
    incomplete: !roof || !address || sf == null,
    ...extra,
  });
  const propertiesList: PropertyListRow[] = [
    prow(401, "Riverside Apartments", "1801 S Pleasant Valley Rd", "Austin", A.greystar, "Greystar — Austin", "TPO", 2009, 186000, 4, { open_value: 160000, open_count: 1, warranty_expires_on: addDays(today, -400) }),
    prow(406, "Preston Hollow Village", "6200 Averill Way", "Dallas", A.lincoln, "Lincoln Property Co", "BUR", 2001, 142000, 88, { open_value: 18000, open_count: 1 }),
    prow(404, "Crestview Station — Bldg C", "7101 Woodrow Ave", "Austin", A.asset, "Asset Living", "Mod-bit", 2008, 52000, 2, { open_value: 31000, open_count: 1 }),
    prow(407, "Legacy Oaks", "4500 Legacy Dr", "Plano", A.rpm, "RPM Living — DFW", "TPO", 2012, 98000, 7, { warranty_expires_on: addDays(today, 150), open_value: 72000, open_count: 1 }),
    prow(405, "Mueller Commons", "1900 Aldrich St", "Austin", A.pinnacle, "Pinnacle Property Management", "EPDM", 2004, 61000, null),
    prow(402, "Eastside Lofts", "1100 E 5th St", "Austin", A.greystar, "Greystar — Austin", "Mod-bit", 2014, 64000, 3, { open_value: 24000, open_count: 1 }),
    prow(408, "Oak Creek Retail Center", "8820 Burnet Rd", "Austin", null, null, null, null, null, null),
    prow(403, "The Domain Flats", "11400 Domain Dr", "Austin", A.greystar, "Greystar — Austin", null, null, null, 30),
  ];
  const listExtra: Record<string, Parameters<typeof propertyBadges>[0]> = {
    [id(401)]: { active_flags: ["active_leak"], open_service_lines: ["re_roof"], management_changed_on: addDays(today, -21), storm_kind: "hail", storm_at: daysAgo(3) },
    [id(406)]: { open_service_lines: ["emergency"] },
    [id(404)]: { active_flags: ["ponding"], open_service_lines: ["repair"] },
    [id(407)]: { open_service_lines: ["re_cover"], ownership_changed_on: addDays(today, -40) },
    [id(405)]: { storm_kind: "hail", storm_at: daysAgo(3) },
    [id(402)]: { open_service_lines: ["repair"] },
  };
  for (const r of propertiesList) {
    r.badges = propertyBadges({ ...listExtra[r.id], roof_system: r.roof_system, roof_install_year: r.roof_install_year, warranty_expires_on: r.warranty_expires_on }, today);
    r.manager_name = r.account_name;
  }
  propertiesList[0].account_name = "RPM Living — DFW";
  propertiesList[0].manager_name = "RPM Living — DFW";
  propertiesList[3].owner_name = "Blackstone REIT";
  const propertyCities = [
    { city: "Austin", n: 212 },
    { city: "Dallas", n: 96 },
    { city: "Plano", n: 41 },
    { city: "San Antonio", n: 38 },
    { city: "Round Rock", n: 27 },
  ];

  const contactDetail: ContactDetailData = {
    today,
    c: {
      id: id(201),
      full_name: "Dave Morales",
      first_name: "Dave",
      title: "Regional Facilities Director",
      persona_role: "economic_buyer",
      email: "dmorales@greystar.com",
      phone: "512-555-0142",
      mobile: null,
      linkedin_url: null,
      account_id: A.greystar,
      notes: "Board meets the 20th. Prefers texts before 8am.",
      do_not_contact: false,
      email_status: "verified",
      last_touch_at: ago(4),
      source: "field",
    },
    account: { id: A.greystar, label: "Greystar — Austin", sub: "Austin" },
    properties: [
      { id: id(401), label: "Riverside Apartments", sub: "1801 S Pleasant Valley Rd, Austin", role: "Signs off on capex" },
      { id: id(402), label: "Eastside Lofts", sub: "1100 E 5th St, Austin", role: null },
    ],
    tasks: [{ id: id(101), title: "Follow up on bid with Dave Morales", due_on: addDays(today, -4), reason: "After bid submitted (email)" }],
    opps: [{ id: id(301), name: "Riverside — TPO re-roof, Bldgs A–F", stage: "proposal_sent", value_estimate: 160000, next_step: "Board vote follow-up", next_step_due: addDays(today, -4) }],
    timeline: account.timeline.filter((t) => t.contact_id === id(201)),
    daysSinceTouch: 4,
    touchCount: 12,
    oldCompanyBuildings: 2,
    employment: [
      { id: id(851), account_id: A.greystar, account_name: "Greystar — Austin", title: "Regional Facilities Director", started_on: "2023-02-01", ended_on: null, note: null },
      { id: id(852), account_id: A.lincoln, account_name: "Lincoln Property Co", title: "Facilities Manager", started_on: null, ended_on: "2023-02-01", note: "Moved from Lincoln Property Co" },
    ],
  };

  const propertyDetail: PropertyDetailData = {
    today,
    year,
    p: {
      id: id(401),
      account_id: A.greystar,
      name: "Riverside Apartments",
      address1: "1801 S Pleasant Valley Rd",
      city: "Austin",
      state: "TX",
      zip: "78741",
      asset_class: "multifamily",
      roof_system: "TPO",
      roof_area_sf: 186000,
      roof_install_year: 2009,
      warranty_expires_on: addDays(today, -400),
      building_count: 6,
      notes: "Seams failing on B and D, ponding west side of C.",
    },
    account: { id: A.greystar, label: "Greystar — Austin", sub: "Austin" },
    contacts: [
      { id: id(201), label: "Dave Morales", sub: "Regional Facilities Director", role: "Signs off on capex" },
      { id: id(206), label: "Luis Ortega", sub: "Maintenance Supervisor", role: "On site daily" },
    ],
    tasks: [{ id: id(101), title: "Follow up on bid with Dave Morales", due_on: addDays(today, -4), reason: "After bid submitted (email)" }],
    opps: [{ id: id(301), name: "Riverside — TPO re-roof, Bldgs A–F", stage: "proposal_sent", value_estimate: 160000, next_step: "Board vote follow-up", next_step_due: addDays(today, -4) }],
    timeline: account.timeline.slice(0, 2),
    lastTouchAt: ago(4),
    badge: { active_flags: ["active_leak", "ponding"], open_service_lines: ["re_roof"], management_changed_on: addDays(today, -21), storm_kind: "hail", storm_at: daysAgo(3) },
    ownership: {
      propertyId: id(401),
      propertyName: "Riverside Apartments",
      accountId: A.greystar,
      today,
      history: [
        { id: id(801), role: "manager", account_id: A.lincoln, account_name: "Lincoln Property Co", started_on: null, ended_on: addDays(today, -21), source: "backfill", note: null },
        { id: id(802), role: "manager", account_id: A.greystar, account_name: "Greystar — Austin", started_on: addDays(today, -21), ended_on: null, source: "transfer", note: "Luis says Greystar took over Sept 13; same on-site team." },
        { id: id(803), role: "owner", account_id: id(20), account_name: "Blackstone REIT", started_on: "2021-06-01", ended_on: null, source: "rep", note: null },
        { id: id(804), role: "owner", account_id: id(21), account_name: "Riverside Partners LP", started_on: null, ended_on: "2021-06-01", source: "backfill", note: null },
      ],
      people: [
        { id: id(201), name: "Dave Morales", title: "Regional Facilities Director", persona_role: "economic_buyer", account_id: A.greystar },
        { id: id(206), name: "Luis Ortega", title: "Maintenance Supervisor, Riverside", persona_role: "user", account_id: A.greystar },
        { id: id(207), name: "Maria Chen", title: "Leasing Office", persona_role: "gatekeeper", account_id: A.greystar },
        { id: id(208), name: "Tanya Brooks", title: "Community Manager", persona_role: "evaluator", account_id: A.greystar },
      ],
      opps: [{ id: id(301), account_id: A.greystar, stage: "proposal_sent", value_estimate: 160000, service_line: "re_roof" }],
      touches: 41,
    },
  };
  const propertyEmpty: PropertyDetailData = {
    ...propertyDetail,
    p: { ...propertyDetail.p, id: id(408), account_id: null, name: "Oak Creek Retail Center", address1: "8820 Burnet Rd", asset_class: null, roof_system: null, roof_area_sf: null, roof_install_year: null, warranty_expires_on: null, building_count: null, notes: null },
    account: null,
    contacts: [],
    tasks: [],
    opps: [],
    timeline: [],
    lastTouchAt: null,
    badge: {},
    ownership: { propertyId: id(408), propertyName: "Oak Creek Retail Center", accountId: null, today, history: [], people: [], opps: [], touches: 0 },
  };

  return { contactsList, propertiesList, propertyCities, contactDetail, propertyDetail, propertyEmpty, today, session, todayData, accounts, account, pipeline, team, approvals, me, austinStops, cities, focus, logData, logContacts, points: DEFAULT_POINTS };
}
