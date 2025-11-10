interface TradingWindow {
  start: string; // HH:MM
  end: string; // HH:MM
}

interface TradingSessionDefinition {
  name: string;
  market: "us" | "hk";
  timeZone: string;
  windows: TradingWindow[];
  supportsDst?: boolean;
  description?: string;
}

const SESSION_DEFINITIONS: TradingSessionDefinition[] = [
  {
    name: "美股盘前",
    market: "us",
    timeZone: "America/New_York",
    windows: [{ start: "04:00", end: "09:30" }],
    description: "常规交易日前的延长时段，允许挂单与撮合。",
  },
  {
    name: "美股盘中",
    market: "us",
    timeZone: "America/New_York",
    windows: [{ start: "09:30", end: "16:00" }],
    description: "纽交所与纳斯达克的正常开盘时段。",
  },
  {
    name: "美股盘后",
    market: "us",
    timeZone: "America/New_York",
    windows: [{ start: "16:00", end: "20:00" }],
    description: "美股收盘后的延长时段，通常成交量较低。",
  },
  {
    name: "美股夜盘",
    market: "us",
    timeZone: "America/New_York",
    windows: [{ start: "20:00", end: "04:00" }],
    description: "部分券商提供的隔夜交易时段，跨越午夜。",
  },
  {
    name: "港股盘中",
    market: "hk",
    timeZone: "Asia/Hong_Kong",
    windows: [
      { start: "09:30", end: "12:00" },
      { start: "13:00", end: "16:00" },
    ],
    supportsDst: false,
    description: "香港交易所的常规日间交易，午间有一小时休市。",
  },
  {
    name: "港股夜盘",
    market: "hk",
    timeZone: "Asia/Hong_Kong",
    windows: [{ start: "17:15", end: "03:00" }],
    supportsDst: false,
    description: "港股衍生品及部分品种的夜间交易时段。",
  },
];

const US_SESSION_ORDER = ["美股盘前", "美股盘中", "美股盘后", "美股夜盘"];
const HK_SESSION_ORDER = ["港股盘中", "港股夜盘"];

function timeStringToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map((v) => parseInt(v, 10));
  return hour * 60 + minute;
}

function getMinutesInTimeZone(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function isWithinWindow(date: Date, definition: TradingSessionDefinition): boolean {
  const currentMinutes = getMinutesInTimeZone(date, definition.timeZone);
  return definition.windows.some((window) => {
    const start = timeStringToMinutes(window.start);
    const end = timeStringToMinutes(window.end);
    if (start <= end) {
      return currentMinutes >= start && currentMinutes < end;
    }
    // Cross-midnight window
    return currentMinutes >= start || currentMinutes < end;
  });
}

export interface SessionSnapshot {
  current: TradingSessionDefinition | null;
  localTime: string;
  dstLabel: string;
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const localized = new Date(date.toLocaleString("en-US", { timeZone }));
  return (date.getTime() - localized.getTime()) / 60000;
}

function computeDstLabel(definition: TradingSessionDefinition | undefined, date: Date): string {
  if (!definition) {
    return "未知时制";
  }
  if (definition.supportsDst === false) {
    return "标准时间（无夏令时）";
  }
  const tzNamePart = new Intl.DateTimeFormat("en-US", {
    timeZone: definition.timeZone,
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  if (tzNamePart) {
    const upper = tzNamePart.toUpperCase();
    if (upper.includes("DT")) {
      return "夏令时 (DST)";
    }
    if (upper.includes("ST") || upper.includes("STANDARD")) {
      return "冬令时 (标准时间)";
    }
  }

  const year = date.getUTCFullYear();
  const january = new Date(Date.UTC(year, 0, 1));
  const july = new Date(Date.UTC(year, 6, 1));
  const currentOffset = getTimeZoneOffsetMinutes(date, definition.timeZone);
  const januaryOffset = getTimeZoneOffsetMinutes(january, definition.timeZone);
  const julyOffset = getTimeZoneOffsetMinutes(july, definition.timeZone);
  const standardOffset = Math.max(januaryOffset, julyOffset);
  if (currentOffset < standardOffset) {
    return "夏令时 (DST)";
  }
  return "冬令时 (标准时间)";
}

function formatLocalTime(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return formatter.format(date);
}

export function getUsSessionSnapshot(date = new Date()): SessionSnapshot {
  const definitions = US_SESSION_ORDER.map((name) =>
    SESSION_DEFINITIONS.find((def) => def.name === name)
  ).filter((def): def is TradingSessionDefinition => Boolean(def));

  const current = definitions.find((definition) => isWithinWindow(date, definition)) ?? null;
  const localTime = formatLocalTime(date, "America/New_York");
  const dstLabel = computeDstLabel(definitions[0], date);
  return { current, localTime, dstLabel };
}

export function getHkSessionSnapshot(date = new Date()): SessionSnapshot {
  const definitions = HK_SESSION_ORDER.map((name) =>
    SESSION_DEFINITIONS.find((def) => def.name === name)
  ).filter((def): def is TradingSessionDefinition => Boolean(def));

  const current = definitions.find((definition) => isWithinWindow(date, definition)) ?? null;
  const localTime = formatLocalTime(date, "Asia/Hong_Kong");
  const dstLabel = computeDstLabel(definitions[0], date);
  return { current, localTime, dstLabel };
}

export function listSessionsByMarket(market: "us" | "hk"): TradingSessionDefinition[] {
  return SESSION_DEFINITIONS.filter((definition) => definition.market === market);
}


