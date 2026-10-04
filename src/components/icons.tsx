// Small inline icon set. 24px grid, 2px strokes, currentColor. No emoji anywhere in the UI.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconToday = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M3 9h18M8 2v4M16 2v4M8 14l2.5 2.5L16 12" />
  </Svg>
);
export const IconGo = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
);
export const IconAccounts = (p: P) => (
  <Svg {...p}>
    <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5M9 10h.01M15 10h.01M9 13h.01M15 13h.01" />
  </Svg>
);
export const IconPipeline = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="5" height="16" rx="1" />
    <rect x="10" y="4" width="5" height="11" rx="1" />
    <rect x="17" y="4" width="4" height="7" rx="1" />
  </Svg>
);
export const IconTeam = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
  </Svg>
);
export const IconUser = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconPhone = (p: P) => (
  <Svg {...p}>
    <path d="M5 3h3.5l2 5-2.5 1.5a11 11 0 0 0 6.5 6.5l1.5-2.5 5 2V19a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2Z" />
  </Svg>
);
export const IconMail = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </Svg>
);
export const IconDirections = (p: P) => (
  <Svg {...p}>
    <path d="M12 2 2 12l10 10 10-10L12 2Z" />
    <path d="M9 14v-2a2 2 0 0 1 2-2h4M13 8l2 2-2 2" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m4 12.5 5 5L20 6.5" />
  </Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IconX = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const IconChevronLeft = (p: P) => (
  <Svg {...p}>
    <path d="m15 6-6 6 6 6" />
  </Svg>
);
export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IconStreak = (p: P) => (
  <Svg {...p}>
    <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5Z" />
  </Svg>
);
export const IconBolt = (p: P) => (
  <Svg {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </Svg>
);
export const IconLog = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />
  </Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Svg>
);
export const IconLogout = (p: P) => (
  <Svg {...p}>
    <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" />
  </Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
);
export const IconSwap = (p: P) => (
  <Svg {...p}>
    <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
  </Svg>
);
export const IconBuilding = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="1" />
    <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" />
  </Svg>
);
export const IconTrophy = (p: P) => (
  <Svg {...p}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6" />
  </Svg>
);
export const IconTarget = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </Svg>
);
export const IconList = (p: P) => (
  <Svg {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Svg>
);
export const IconEdit = (p: P) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
  </Svg>
);
export const IconSkip = (p: P) => (
  <Svg {...p}>
    <path d="m5 5 9 7-9 7V5ZM19 5v14" />
  </Svg>
);

// --- Property badges & condition flags (badges-property.ts) -------------------------------------------------
export const IconDroplet = (p: P) => (
  <Svg {...p}>
    <path d="M12 3s-6 6.4-6 11a6 6 0 0 0 12 0c0-4.6-6-11-6-11Z" />
  </Svg>
);
export const IconPuddle = (p: P) => (
  <Svg {...p}>
    <path d="M12 3s-3.5 3.9-3.5 6.6a3.5 3.5 0 0 0 7 0C15.5 6.9 12 3 12 3Z" />
    <path d="M3 18.5c0-1.4 4-2.5 9-2.5s9 1.1 9 2.5S17 21 12 21s-9-1.1-9-2.5Z" />
  </Svg>
);
export const IconHail = (p: P) => (
  <Svg {...p}>
    <path d="M7 14.5a4 4 0 0 1-.5-7.97A6 6 0 0 1 17.7 7.5 3.5 3.5 0 0 1 17.5 14.5H7Z" />
    <circle cx="8" cy="19" r="1" />
    <circle cx="12" cy="20.5" r="1" />
    <circle cx="16" cy="19" r="1" />
  </Svg>
);
export const IconWind = (p: P) => (
  <Svg {...p}>
    <path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 12h15a2.5 2.5 0 1 1-2.5 2.5M3 16h8" />
  </Svg>
);
export const IconTear = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="1.5" />
    <path d="m11 5 2.5 4.5L11 13l2.5 6" />
  </Svg>
);
export const IconFlashing = (p: P) => (
  <Svg {...p}>
    <path d="M7 3v18M7 16h14" />
    <path d="M4 12h6v7" />
  </Svg>
);
export const IconDrain = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8 9h8M7.5 12h9M8 15h8" />
  </Svg>
);
export const IconLadder = (p: P) => (
  <Svg {...p}>
    <path d="M8 3v18M16 3v18M8 7h8M8 12h8M8 17h8" />
  </Svg>
);
export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3Z" />
  </Svg>
);
export const IconWrench = (p: P) => (
  <Svg {...p}>
    <path d="M15.5 3.5a5 5 0 0 0-5.7 6.6L3.5 16.4a2.1 2.1 0 0 0 3 3l6.3-6.3a5 5 0 0 0 6.6-5.7l-3 3-3-.8-.8-3 3-3Z" />
  </Svg>
);
export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
    <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
  </Svg>
);
export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);
export const IconClipboard = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <rect x="9" y="2.5" width="6" height="3.5" rx="1" />
    <path d="M9 11h6M9 15h4" />
  </Svg>
);
export const IconRoller = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="14" height="6" rx="1.5" />
    <path d="M17 6h3v5h-8v3" />
    <rect x="10.5" y="14" width="3" height="7" rx="1" />
  </Svg>
);
export const IconStorm = (p: P) => (
  <Svg {...p}>
    <path d="M7 14.5a4 4 0 0 1-.5-7.97A6 6 0 0 1 17.7 7.5 3.5 3.5 0 0 1 17.5 14.5" />
    <path d="m13 12-3 4.5h4l-3 4.5" />
  </Svg>
);
export const IconDoor = (p: P) => (
  <Svg {...p}>
    <path d="M3 21h18M5 21V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v17" />
    <path d="M10.5 12h.01M17 8l3 3-3 3M14 11h6" />
  </Svg>
);
export const IconRoof = (p: P) => (
  <Svg {...p}>
    <path d="M2 12 12 4l10 8" />
    <path d="M5 10v10h14V10" />
  </Svg>
);
export const IconHistory = (p: P) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </Svg>
);
export const IconCamera = (p: P) => (
  <Svg {...p}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Svg>
);
export const IconNoSignal = (p: P) => (
  <Svg {...p}>
    <path d="M4 20v-2M9 20v-6M14 20v-3M19 20V8M3 3l18 18" />
  </Svg>
);
export const IconRoute = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="5" r="2" />
    <path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16" />
  </Svg>
);
export const IconCard = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="11" r="2" />
    <path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M15 10h3M15 13h3" />
  </Svg>
);
export const IconNearMe = (p: P) => (
  <Svg {...p}>
    <path d="M21 3 3 10.5l7.5 3 3 7.5L21 3Z" />
  </Svg>
);
