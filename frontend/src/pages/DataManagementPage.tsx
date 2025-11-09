import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { Dialog } from "../components/Dialog";
import { PriceChart } from "../components/PriceChart";
import { StatusBadge } from "../components/StatusBadge";

type SymbolSuffix = ".US" | ".HK";

interface LiveTask {
  task_id: string;
  symbol: string;
  session: string;
  account_mode: string;
  interval_seconds: number;
  duration_seconds: number | null;
  is_permanent: boolean;
  max_points: number | null;
  status: string;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  data_id?: string | null;
  message?: string;
}

interface LiveSnapshot {
  snapshot_id: string;
  data_id: string;
  created_at: string;
  task_id: string;
}

interface DataSeriesDetail {
  data_id: string;
  symbol: string;
  data: Array<{ timestamp: string; price: number }>;
  config: Record<string, unknown>;
}

interface SimulatedSeries {
  data_id: string;
  symbol: string;
  created_at: string;
  source: string;
}

interface DataListItem {
  type: "live" | "sim";
  data_id: string;
  symbol: string;
  created_at: string;
  source: string;
  tag: "LIVE" | "SIM";
  task_id?: string;
  snapshot_id?: string;
  suffix?: SymbolSuffix | null;
}

interface LiveFormState {
  symbolPrefix: string;
  symbolSuffix: SymbolSuffix;
  sessions: string[];
  interval_seconds: number;
  durationDays: number;
  durationHours: number;
  durationMinutes: number;
  durationSeconds: number;
  isPermanent: boolean;
  maxPoints: number | "";
  account_mode: string;
}

type DurationField = "durationDays" | "durationHours" | "durationMinutes" | "durationSeconds";

const durationFieldLabels: Record<DurationField, string> = {
  durationDays: "天",
  durationHours: "小时",
  durationMinutes: "分钟",
  durationSeconds: "秒"
};

const sessionOptionsBySuffix: Record<
  SymbolSuffix,
  { label: string; value: string }[]
> = {
  ".US": [
    { label: "美股盘前", value: "美股盘前" },
    { label: "美股盘中", value: "美股盘中" },
    { label: "美股盘后", value: "美股盘后" },
    { label: "美股夜盘", value: "美股夜盘" }
  ],
  ".HK": [
    { label: "港股盘中", value: "港股盘中" },
    { label: "港股夜盘", value: "港股夜盘" }
  ]
};

const simConfigOrder = [
  "data_points",
  "start_price",
  "end_price",
  "mean_price",
  "volatility_probability",
  "volatility_magnitude",
  "noise",
  "uncertainty"
] as const;

const simConfigLabelMap: Record<string, string> = {
  data_points: "数据点数",
  start_price: "初始价格",
  end_price: "末尾价格",
  mean_price: "均值价格",
  volatility_probability: "波动概率",
  volatility_magnitude: "波动幅度",
  noise: "噪声",
  uncertainty: "不确定性"
};

const liveConfigLabelMap: Record<string, string> = {
  task_id: "任务ID",
  session: "交易时段",
  interval_seconds: "采样间隔(秒)",
  duration_seconds: "持续时间(秒)",
  duration_minutes: "持续时间(分钟)",
  is_permanent: "永久运行",
  max_points: "最大数据点",
  account_mode: "账号类型",
  source: "数据来源",
  created_at: "采集时间",
  symbol: "股票代码"
};

const generateSimSymbol = () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return `${code}.SIM`;
};

const computeTrend = (points: Array<{ price: number | string }>) => {
  if (points.length < 2) {
    return null;
  }
  const first = Number(points[0].price);
  const last = Number(points[points.length - 1].price);
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return null;
  }
  const diff = last - first;
  const diffPercent = first !== 0 ? (diff / first) * 100 : null;
  return {
    first,
    last,
    diff,
    diffPercent,
    direction: diff === 0 ? "持平" : diff > 0 ? "上涨" : "下跌"
  };
};

const formatTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const pad = (num: number) => num.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
};

const makeDefaultLiveForm = (): LiveFormState => ({
  symbolPrefix: "AAPL",
  symbolSuffix: ".US",
  sessions: ["美股盘中"],
  interval_seconds: 30,
  durationDays: 0,
  durationHours: 2,
  durationMinutes: 0,
  durationSeconds: 0,
  isPermanent: false,
  maxPoints: "",
  account_mode: "paper"
});

const formatDuration = (
  durationSeconds: number | null | undefined,
  isPermanent: boolean
): string => {
  if (isPermanent) {
    return "永久";
  }
  if (!durationSeconds || durationSeconds <= 0) {
    return "-";
  }
  const days = Math.floor(durationSeconds / 86_400);
  const hours = Math.floor((durationSeconds % 86_400) / 3_600);
  const minutes = Math.floor((durationSeconds % 3_600) / 60);
  const seconds = durationSeconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}天`);
  if (hours) parts.push(`${hours}小时`);
  if (minutes) parts.push(`${minutes}分钟`);
  if (seconds || parts.length === 0) parts.push(`${seconds}秒`);
  return parts.join("");
};

const PauseIcon = () => (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

const PlayIcon = () => (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l9.2-6.86a1 1 0 0 0 0-1.7l-9.2-6.86A1 1 0 0 0 8 5.14Z" />
  </svg>
);

const TrashIcon = () => (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const StopIcon = () => (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export function DataManagementPage() {
  const [activeTab, setActiveTab] = useState<"live" | "data">("live");
  const [isCreatingLive, setIsCreatingLive] = useState(false);
  const [isCreatingSimulated, setIsCreatingSimulated] = useState(false);
  const [activeTask, setActiveTask] = useState<LiveTask | null>(null);
  const [taskDetail, setTaskDetail] = useState<DataSeriesDetail | null>(null);
  const [taskRange, setTaskRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [isTaskRangePinnedToEnd, setIsTaskRangePinnedToEnd] = useState(true);
  const [selectedData, setSelectedData] = useState<{ type: "live" | "sim"; id: string } | null>(null);
  const [detail, setDetail] = useState<DataSeriesDetail | null>(null);
  const [detailSource, setDetailSource] = useState<"live" | "sim" | null>(null);
  const [dataRange, setDataRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const client = useQueryClient();
  const taskRangeRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const taskPinnedRef = useRef(true);

  useEffect(() => {
    taskRangeRef.current = taskRange;
  }, [taskRange]);

  useEffect(() => {
    taskPinnedRef.current = isTaskRangePinnedToEnd;
  }, [isTaskRangePinnedToEnd]);

  const [liveForm, setLiveForm] = useState<LiveFormState>(() => makeDefaultLiveForm());

  const [simForm, setSimForm] = useState({
    symbol: generateSimSymbol(),
    data_points: 480,
    start_price: 100,
    end_price: 105,
    mean_price: 103,
    volatility_probability: 0.25,
    volatility_magnitude: 2.5,
    noise: 0.6,
    uncertainty: 0.12
  });

  const liveTasksQuery = useQuery({
    queryKey: ["liveTasks"],
    queryFn: async () => {
      const { data } = await api.get<LiveTask[]>("/data/live/tasks");
      return data;
    }
  });

  const liveSnapshotsQuery = useQuery({
    queryKey: ["liveSnapshots"],
    queryFn: async () => {
      const { data } = await api.get<LiveSnapshot[]>("/data/live/snapshots");
      return data;
    }
  });

  const simulatedQuery = useQuery({
    queryKey: ["simulatedData"],
    queryFn: async () => {
      const { data } = await api.get<SimulatedSeries[]>("/data/simulated");
      return data;
    }
  });

  const createLiveTask = useMutation({
    mutationFn: async () => {
      const symbolPrefix = liveForm.symbolPrefix.trim().toUpperCase();
      const durationSeconds = liveForm.isPermanent ? null : composedDurationSeconds;
      const maxPoints =
        liveForm.maxPoints === "" ? null : Math.max(1, Math.floor(Number(liveForm.maxPoints)));
      const payload = {
        symbol: `${symbolPrefix}${liveForm.symbolSuffix}`,
        session: liveForm.sessions.join(", "),
        interval_seconds: liveForm.interval_seconds,
        duration_seconds: durationSeconds,
        is_permanent: liveForm.isPermanent,
        max_points: maxPoints,
        account_mode: liveForm.account_mode
      };
      await api.post("/data/live/tasks", payload);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["liveTasks"] });
      setIsCreatingLive(false);
      setLiveForm((prev) => {
        const next = makeDefaultLiveForm();
        const optionValues = sessionOptionsBySuffix[prev.symbolSuffix].map((option) => option.value);
        return {
          ...next,
          symbolSuffix: prev.symbolSuffix,
          sessions: [optionValues[0]]
        };
      });
    }
  });

  const controlLiveTask = useMutation({
    mutationFn: async ({ taskId, action }: { taskId: string; action: "pause" | "resume" | "stop" | "delete" }) => {
      if (action === "delete") {
        await api.delete(`/data/live/tasks/${taskId}`);
      } else {
        await api.post(`/data/live/tasks/${taskId}/${action}`);
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["liveTasks"] });
    }
  });

  const fetchTaskSeries = useMutation({
    mutationFn: async (taskId: string) => {
      const { data } = await api.get<DataSeriesDetail>(`/data/live/tasks/${taskId}/data`);
      return data;
    },
    onSuccess: (data) => {
      setTaskDetail(data);
    }
  });

  const createSnapshot = useMutation({
    mutationFn: async ({ taskId, range }: { taskId: string; range?: { start: number; end: number } }) => {
      const payload = range ? { start_index: range.start, end_index: range.end } : {};
      await api.post(`/data/live/tasks/${taskId}/snapshot`, payload);
    },
    onSuccess: async (_, variables) => {
      await client.invalidateQueries({ queryKey: ["liveSnapshots"] });
      if (variables && activeTask?.task_id === variables.taskId) {
        fetchTaskSeries.mutate(variables.taskId);
      }
    }
  });

  const fetchSeries = useMutation({
    mutationFn: async ({ type, id }: { type: "live" | "sim"; id: string }) => {
      if (type === "live") {
        const { data } = await api.get<DataSeriesDetail>(`/data/live/data/${id}`);
        return data;
      }
      const { data } = await api.get<DataSeriesDetail>(`/data/simulated/${id}`);
      return data;
    },
    onSuccess: (data, variables) => {
      setDetail(data);
      setDetailSource(variables.type);
    }
  });

  const createSimulated = useMutation({
    mutationFn: async () => {
      await api.post("/data/simulated", simForm);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["simulatedData"] });
      setIsCreatingSimulated(false);
      setSelectedData(null);
      setDetail(null);
      setDetailSource(null);
      setSimForm((prev) => ({ ...prev, symbol: generateSimSymbol() }));
    }
  });

  const deleteSimulated = useMutation({
    mutationFn: async (dataId: string) => {
      await api.delete(`/data/simulated/${dataId}`);
    },
    onSuccess: async (_, dataId) => {
      await client.invalidateQueries({ queryKey: ["simulatedData"] });
      const isDetailRemoved = detailSource === "sim" && detail?.data_id === dataId;
      const isSelectionRemoved = selectedData?.type === "sim" && selectedData.id === dataId;
      if (isDetailRemoved) {
        setDetail(null);
        setDetailSource(null);
      }
      if (isSelectionRemoved) {
        setSelectedData(null);
      }
    }
  });

  const deleteLiveDataMutation = useMutation({
    mutationFn: async (dataId: string) => {
      await api.delete(`/data/live/data/${dataId}`);
    },
    onSuccess: async (_, dataId) => {
      await client.invalidateQueries({ queryKey: ["liveSnapshots"] });
      const shouldClearDetail = detailSource === "live" && detail?.data_id === dataId;
      if (shouldClearDetail) {
        setDetail(null);
        setDetailSource(null);
      } else {
        setDetail((prev) => (prev?.data_id === dataId ? null : prev));
      }
      setSelectedData((prev) => {
        if (prev?.type === "live" && prev.id === dataId) {
          return null;
        }
        return prev;
      });
    }
  });

  const handleTaskSelect = (task: LiveTask) => {
    const initialRange = { start: 0, end: 0 };
    setActiveTask(task);
    setTaskDetail(null);
    setTaskRange(initialRange);
    setIsTaskRangePinnedToEnd(true);
    taskRangeRef.current = initialRange;
    taskPinnedRef.current = true;
    fetchTaskSeries.reset();
    fetchTaskSeries.mutate(task.task_id);
  };

  const closeTaskDetail = () => {
    setActiveTask(null);
    setTaskDetail(null);
    setTaskRange({ start: 0, end: 0 });
    setIsTaskRangePinnedToEnd(true);
    taskRangeRef.current = { start: 0, end: 0 };
    taskPinnedRef.current = true;
    fetchTaskSeries.reset();
  };

  const liveTasks = liveTasksQuery.data ?? [];
  const snapshots = liveSnapshotsQuery.data ?? [];
  const simulated = simulatedQuery.data ?? [];

  const availableSessions = useMemo(
    () => sessionOptionsBySuffix[liveForm.symbolSuffix],
    [liveForm.symbolSuffix]
  );

  const composedDurationSeconds = useMemo(() => {
    const total =
      liveForm.durationDays * 86_400 +
      liveForm.durationHours * 3_600 +
      liveForm.durationMinutes * 60 +
      liveForm.durationSeconds;
    return Math.max(0, total);
  }, [liveForm.durationDays, liveForm.durationHours, liveForm.durationMinutes, liveForm.durationSeconds]);
  const isDurationInvalid = !liveForm.isPermanent && composedDurationSeconds <= 0;
  const isMaxPointsInvalid =
    liveForm.maxPoints !== "" &&
    (!Number.isFinite(Number(liveForm.maxPoints)) || Number(liveForm.maxPoints) <= 0);

  useEffect(() => {
    const optionValues = sessionOptionsBySuffix[liveForm.symbolSuffix].map((option) => option.value);
    setLiveForm((prev) => {
      const filtered = prev.sessions.filter((session) => optionValues.includes(session));
      if (filtered.length === prev.sessions.length && filtered.length > 0) {
        return prev;
      }
      return { ...prev, sessions: filtered.length > 0 ? filtered : [optionValues[0]] };
    });
  }, [liveForm.symbolSuffix]);

  const symbolPreview = useMemo(() => {
    const prefix = liveForm.symbolPrefix.trim().toUpperCase();
    return prefix ? `${prefix}${liveForm.symbolSuffix}` : `示例：AAPL${liveForm.symbolSuffix}`;
  }, [liveForm.symbolPrefix, liveForm.symbolSuffix]);

  const toggleSession = (sessionValue: string) => {
    setLiveForm((prev) => {
      const optionValues = sessionOptionsBySuffix[prev.symbolSuffix].map((option) => option.value);
      let nextSessions: string[];
      if (prev.sessions.includes(sessionValue)) {
        nextSessions = prev.sessions.filter((item) => item !== sessionValue);
      } else {
        nextSessions = [...prev.sessions, sessionValue];
      }
      nextSessions = nextSessions.filter((item, index, array) => array.indexOf(item) === index);
      if (nextSessions.length > 1) {
        nextSessions = nextSessions.sort((a, b) => optionValues.indexOf(a) - optionValues.indexOf(b));
      }
      return { ...prev, sessions: nextSessions };
    });
  };

  const isCreateLiveDisabled =
    createLiveTask.isPending ||
    liveForm.symbolPrefix.trim() === "" ||
    liveForm.sessions.length === 0 ||
    liveForm.interval_seconds <= 0 ||
    isDurationInvalid ||
    isMaxPointsInvalid;

  useEffect(() => {
    if (!activeTask) {
      return;
    }
    const updated = liveTasks.find((task) => task.task_id === activeTask.task_id);
    if (!updated) {
      setActiveTask(null);
      setTaskDetail(null);
      return;
    }
    const keys: Array<keyof LiveTask> = [
      "status",
      "message",
      "interval_seconds",
      "duration_seconds",
      "is_permanent",
      "max_points",
      "account_mode",
      "symbol",
      "session",
      "data_id",
      "started_at",
      "finished_at",
      "created_at"
    ];
    const hasChanges = keys.some((key) => updated[key] !== activeTask[key]);
    if (hasChanges) {
      setActiveTask(updated);
    }
  }, [liveTasks, activeTask]);

  useEffect(() => {
    if (!activeTask) {
      return;
    }
    const taskId = activeTask.task_id;
    const intervalMs = Math.max(activeTask.interval_seconds, 1) * 1000;
    const intervalId = window.setInterval(() => {
      if (!fetchTaskSeries.isPending) {
        fetchTaskSeries.mutate(taskId);
      }
    }, intervalMs);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeTask, fetchTaskSeries]);

  const liveTaskMap = useMemo(() => {
    const map = new Map<string, LiveTask>();
    liveTasks.forEach((task) => {
      map.set(task.task_id, task);
    });
    return map;
  }, [liveTasks]);

  const dataItems = useMemo(() => {
    const simItems: DataListItem[] = simulated.map((item) => ({
      type: "sim",
      data_id: item.data_id,
      symbol: item.symbol,
      created_at: item.created_at,
      source: item.source,
      tag: "SIM",
      suffix: item.symbol.endsWith(".HK") ? ".HK" : item.symbol.endsWith(".US") ? ".US" : null
    }));
    const liveItems: DataListItem[] = snapshots.map((snapshot) => {
      const relatedTask = liveTaskMap.get(snapshot.task_id);
      return {
        type: "live",
        data_id: snapshot.data_id,
        symbol: relatedTask?.symbol ?? snapshot.task_id,
        created_at: snapshot.created_at,
        source: "longport_live",
        tag: "LIVE" as const,
        task_id: snapshot.task_id,
        snapshot_id: snapshot.snapshot_id,
        suffix: relatedTask?.symbol?.endsWith(".HK") ? ".HK" : relatedTask?.symbol?.endsWith(".US") ? ".US" : null
      };
    });
    return [...simItems, ...liveItems].sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      return timeB - timeA;
    });
  }, [simulated, snapshots, liveTaskMap]);

  const selectedDataMeta = useMemo(
    () => (selectedData ? dataItems.find((item) => item.data_id === selectedData.id && item.type === selectedData.type) ?? null : null),
    [dataItems, selectedData]
  );

  useEffect(() => {
    if (activeTab !== "data") {
      return;
    }
    if (dataItems.length === 0) {
      setSelectedData(null);
      setDetail(null);
      setDetailSource(null);
      return;
    }
    if (!selectedData) {
      const first = dataItems[0];
      setSelectedData({ type: first.type, id: first.data_id });
      return;
    }
    const exists = dataItems.some((item) => item.data_id === selectedData.id && item.type === selectedData.type);
    if (!exists) {
      const first = dataItems[0];
      setSelectedData({ type: first.type, id: first.data_id });
      setDetail(null);
      setDetailSource(null);
    }
  }, [activeTab, dataItems, selectedData]);

  useEffect(() => {
    if (activeTab !== "data") {
      return;
    }
    if (!selectedData) {
      return;
    }
    if (detail && detail.data_id === selectedData.id && detailSource === selectedData.type) {
      return;
    }
    fetchSeries.mutate({ type: selectedData.type, id: selectedData.id });
  }, [activeTab, selectedData, detail, detailSource, fetchSeries]);

  useEffect(() => {
    if (!detail || detail.data.length === 0) {
      setDataRange({ start: 0, end: 0 });
      return;
    }
    const maxIndex = detail.data.length - 1;
    setDataRange({ start: 0, end: maxIndex });
  }, [detail]);

  useEffect(() => {
    if (!taskDetail || taskDetail.data.length === 0) {
      if (taskRangeRef.current.start !== 0 || taskRangeRef.current.end !== 0) {
        const fallbackRange = { start: 0, end: 0 };
        taskRangeRef.current = fallbackRange;
        setTaskRange(fallbackRange);
      }
      if (!taskPinnedRef.current) {
        taskPinnedRef.current = true;
        setIsTaskRangePinnedToEnd(true);
      }
      return;
    }
    const maxIndex = taskDetail.data.length - 1;
    const prevRange = taskRangeRef.current;
    const clampedStart = Math.max(0, Math.min(prevRange.start, maxIndex));
    const clampedEnd = Math.max(clampedStart, Math.min(prevRange.end, maxIndex));
    const windowSize = Math.max(0, clampedEnd - clampedStart);
    const nextStart = clampedStart;
    let nextEnd = clampedEnd;
    if (taskPinnedRef.current) {
      nextEnd = maxIndex;
    }
    const nextRange = { start: nextStart, end: nextEnd };
    if (nextRange.start !== prevRange.start || nextRange.end !== prevRange.end) {
      taskRangeRef.current = nextRange;
      setTaskRange(nextRange);
    }
    const shouldPin = nextRange.end >= maxIndex;
    if (shouldPin !== taskPinnedRef.current) {
      taskPinnedRef.current = shouldPin;
      setIsTaskRangePinnedToEnd(shouldPin);
    }
  }, [taskDetail]);

  const sliderMax = detail ? Math.max(detail.data.length - 1, 0) : 0;

  const chartData = useMemo(() => {
    if (!detail || detail.data.length === 0) {
      return [];
    }
    const safeStart = Math.max(0, Math.min(dataRange.start, detail.data.length - 1));
    const safeEnd = Math.max(safeStart, Math.min(dataRange.end, detail.data.length - 1));
    return detail.data.slice(safeStart, safeEnd + 1).map((point) => {
      const normalizedPrice = Number(point.price);
      return {
        ...point,
        price: Number.isFinite(normalizedPrice) ? normalizedPrice : 0
      };
    });
  }, [detail, dataRange]);

  const visibleStartPoint =
    detail && detail.data.length > 0 ? detail.data[Math.min(dataRange.start, detail.data.length - 1)] : null;
  const visibleEndPoint =
    detail && detail.data.length > 0 ? detail.data[Math.min(dataRange.end, detail.data.length - 1)] : null;
  const visibleCount = chartData.length;

  const overallTrend = useMemo(() => {
    if (!detail) {
      return null;
    }
    return computeTrend(detail.data);
  }, [detail]);

  const startPercent = sliderMax > 0 ? (dataRange.start / sliderMax) * 100 : 0;
  const endPercent = sliderMax > 0 ? (dataRange.end / sliderMax) * 100 : 100;
  const sliderHighlightStyle =
    sliderMax > 0 ? { left: `${startPercent}%`, right: `${100 - endPercent}%` } : { left: "0%", right: "0%" };

  const simFormattedConfigEntries = useMemo(() => {
    if (!detail?.config || detailSource !== "sim") {
      return [];
    }
    type ConfigCard = {
      key: string;
      label: string;
      value: string;
    };

    const cards: ConfigCard[] = [];

    const formatNumber = (value: number) =>
      Number.isFinite(value) ? value.toLocaleString("zh-CN", { maximumFractionDigits: 4 }) : String(value);

    const formatPrimitive = (value: unknown): string => {
      if (value === null || value === undefined) {
        return "无";
      }
      if (typeof value === "number") {
        return formatNumber(value);
      }
      if (typeof value === "boolean") {
        return value ? "是" : "否";
      }
      return String(value);
    };

    const traverse = (value: unknown, path: string[], labels: string[]) => {
      const cardKey = path.join(".");
      const label = labels.join(" / ");

      if (value === null || value === undefined) {
        cards.push({ key: cardKey, label, value: "无" });
        return;
      }

      if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
        cards.push({ key: cardKey, label, value: formatPrimitive(value) });
        return;
      }

      if (Array.isArray(value)) {
        if (value.length === 0) {
          cards.push({ key: `${cardKey}[]`, label, value: "无" });
        } else {
          value.forEach((item, index) => {
            traverse(item, [...path, String(index)], [...labels, `第${index + 1}项`]);
          });
        }
        return;
      }

      if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) {
          cards.push({ key: cardKey, label, value: "无" });
          return;
        }
        entries.forEach(([subKey, subValue]) => {
          const friendlyLabel = simConfigLabelMap[subKey] ?? subKey;
          traverse(subValue, [...path, subKey], [...labels, friendlyLabel]);
        });
        return;
      }

      cards.push({ key: cardKey, label, value: String(value) });
    };

    const sortedEntries = Object.entries(detail.config).sort((a, b) => {
      const aIndex = simConfigOrder.indexOf(a[0] as (typeof simConfigOrder)[number]);
      const bIndex = simConfigOrder.indexOf(b[0] as (typeof simConfigOrder)[number]);
      if (aIndex === -1 && bIndex === -1) {
        return a[0].localeCompare(b[0]);
      }
      if (aIndex === -1) {
        return 1;
      }
      if (bIndex === -1) {
        return -1;
      }
      return aIndex - bIndex;
    });

    sortedEntries.forEach(([key, value]) => {
      const label = simConfigLabelMap[key] ?? key;
      traverse(value, [key], [label]);
    });

    return cards;
  }, [detail, detailSource]);

  const liveFormattedConfigEntries = useMemo(() => {
    if (!detail?.config || detailSource !== "live") {
      return [];
    }
    const entries: { key: string; label: string; value: string }[] = [];
    const isPermanentConfig = Boolean(
      detail.config.is_permanent ?? detail.config["is_permanent"]
    );
    const formatValue = (key: string, value: unknown): string => {
      if (key === "max_points") {
        if (value === null || value === undefined) {
          return "无限制";
        }
        if (typeof value === "number") {
          return value.toLocaleString("zh-CN");
        }
      }
      if (key === "is_permanent") {
        return value ? "是" : "否";
      }
      if (key === "duration_seconds") {
        if (typeof value === "number") {
          return formatDuration(value, isPermanentConfig);
        }
        if (value === null) {
          return formatDuration(null, isPermanentConfig);
        }
      }
      if (key === "duration_minutes" && typeof value === "number") {
        return formatDuration(value * 60, isPermanentConfig);
      }
      if (value === null || value === undefined) {
        return "无";
      }
      if (key === "created_at" && typeof value === "string") {
        return formatTimestamp(value);
      }
      if (key === "account_mode" && typeof value === "string") {
        return value === "live" ? "实盘账户" : value === "paper" ? "纸上账户" : value;
      }
      if (typeof value === "number") {
        return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
      }
      return String(value);
    };
    Object.entries(detail.config).forEach(([key, value]) => {
      const label = liveConfigLabelMap[key] ?? key;
      entries.push({ key, label, value: formatValue(key, value) });
    });
    return entries;
  }, [detail, detailSource]);

  const formattedConfigEntries = detailSource === "sim" ? simFormattedConfigEntries : liveFormattedConfigEntries;

  const isDetailLoading = Boolean(
    selectedData &&
      fetchSeries.isPending &&
      fetchSeries.variables?.id === selectedData.id &&
      fetchSeries.variables?.type === selectedData.type &&
      (detail?.data_id !== selectedData.id || detailSource !== selectedData.type)
  );

  const taskSliderMax = taskDetail ? Math.max(taskDetail.data.length - 1, 0) : 0;

  const taskChartData = useMemo(() => {
    if (!taskDetail || taskDetail.data.length === 0) {
      return [];
    }
    const maxIndex = taskDetail.data.length - 1;
    const start = Math.max(0, Math.min(taskRange.start, maxIndex));
    const end = Math.max(start, Math.min(taskRange.end, maxIndex));
    return taskDetail.data.slice(start, end + 1).map((point) => {
      const normalizedPrice = Number(point.price);
      return {
        ...point,
        price: Number.isFinite(normalizedPrice) ? normalizedPrice : 0
      };
    });
  }, [taskDetail, taskRange]);

  const taskVisibleCount = taskChartData.length;
  const taskVisibleStartPoint = taskChartData.length > 0 ? taskChartData[0] : null;
  const taskVisibleEndPoint = taskChartData.length > 0 ? taskChartData[taskChartData.length - 1] : null;

  const taskTrend = useMemo(() => {
    if (taskChartData.length === 0) {
      return null;
    }
    return computeTrend(taskChartData);
  }, [taskChartData]);

  const taskStartPercent = taskSliderMax > 0 ? (Math.min(taskRange.start, taskSliderMax) / taskSliderMax) * 100 : 0;
  const taskEndPercent = taskSliderMax > 0 ? (Math.min(taskRange.end, taskSliderMax) / taskSliderMax) * 100 : 100;
  const taskSliderHighlightStyle =
    taskSliderMax > 0 ? { left: `${taskStartPercent}%`, right: `${100 - taskEndPercent}%` } : { left: "0%", right: "0%" };

  const isSnapshotFromDialogPending = Boolean(
    activeTask && createSnapshot.isPending && createSnapshot.variables?.taskId === activeTask.task_id
  );

  const isTaskDetailLoading =
    activeTask &&
    fetchTaskSeries.isPending &&
    fetchTaskSeries.variables === activeTask.task_id &&
    !taskDetail;

  const taskDetailErrorMessage = fetchTaskSeries.isError
    ? fetchTaskSeries.error instanceof Error
      ? fetchTaskSeries.error.message
      : "加载任务详情失败"
    : null;

  const totalTaskPoints = taskDetail?.data.length ?? 0;
  const latestTaskTimestamp = taskVisibleEndPoint ? formatTimestamp(taskVisibleEndPoint.timestamp) : null;

  const toggleFilter = (filter: string) => {
    setActiveFilters((prev) => {
      if (prev.includes(filter)) {
        return prev.filter((item) => item !== filter);
      }
      return [...prev, filter];
    });
  };

  const filteredDataItems = useMemo(() => {
    if (activeFilters.length === 0) {
      return dataItems;
    }

    return dataItems.filter((item) => {
      const tags: string[] = [item.tag];
      if (item.suffix) {
        tags.push(item.suffix.replace(".", ""));
      } else if (item.symbol.endsWith(".HK")) {
        tags.push("HK");
      } else if (item.symbol.endsWith(".US")) {
        tags.push("US");
      }
      return activeFilters.some((filter) => tags.includes(filter));
    });
  }, [dataItems, activeFilters]);

  const filterOptions: { label: string; value: string }[] = [
    { label: "SIM 数据", value: "SIM" },
    { label: "LIVE 数据", value: "LIVE" },
    { label: "美股 .US", value: "US" },
    { label: "港股 .HK", value: "HK" }
  ];

  return (
    <div className="space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-semibold">数据管理</h2>
          <p className="text-slate-400 mt-2">实时数据与模拟数据统一管理，支持任务监控与快照。</p>
        </div>
        <div className="glass-panel px-6 py-3 rounded-full text-sm text-slate-300">
          <span className="text-red-400 font-medium">红色</span> 表示上涨 / 盈利，<span className="text-green-400 font-medium">绿色</span>{" "}
          表示下跌 / 亏损
        </div>
      </header>

      <section>
        <div className="flex gap-4 mb-6">
          <button
            type="button"
            onClick={() => setActiveTab("live")}
            className={`px-5 py-2 rounded-full transition ${
              activeTab === "live" ? "bg-blue-500/40 text-white" : "bg-slate-800/60 text-slate-300"
            }`}
          >
            实盘任务
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("data")}
            className={`px-5 py-2 rounded-full transition ${
              activeTab === "data" ? "bg-blue-500/40 text-white" : "bg-slate-800/60 text-slate-300"
            }`}
          >
            数据管理
          </button>
        </div>

        {activeTab === "live" ? (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">实时爬取任务</h3>
              <button
                type="button"
                className="bg-blue-500/80 hover:bg-blue-500 transition px-5 py-2 rounded-full text-sm font-medium"
                onClick={() => setIsCreatingLive(true)}
              >
                新建任务
              </button>
            </div>

            <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-white/5 text-slate-300">
                    <tr className="text-left">
                      <th className="px-6 py-3 font-medium">股票</th>
                      <th className="px-4 py-3 font-medium">状态</th>
                      <th className="px-4 py-3 font-medium">创建时间</th>
                      <th className="px-4 py-3 font-medium">交易时段</th>
                      <th className="px-4 py-3 font-medium">账号类型</th>
                      <th className="px-4 py-3 font-medium">采样间隔</th>
                      <th className="px-4 py-3 font-medium">持续时长</th>
                      <th className="px-4 py-3 font-medium">最大数据点</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveTasks.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-6 py-12 text-center text-slate-500">
                          暂无任务，点击右上角"新建任务"开始采集。
                        </td>
                      </tr>
                    ) : (
                      liveTasks.map((task) => {
                        const normalizedStatus = task.status.toLowerCase();
                        const isPaused = normalizedStatus === "paused";
                        const isStopped = ["stopped", "completed", "failed"].includes(normalizedStatus);
                        const isControlPending =
                          controlLiveTask.isPending && controlLiveTask.variables?.taskId === task.task_id;
                        return (
                          <tr
                            key={task.task_id}
                        onClick={() => handleTaskSelect(task)}
                        className="border-t border-white/5 transition hover:bg-slate-800/40 cursor-pointer"
                          >
                            <td className="px-6 py-4 align-top text-white">
                              <div className="font-medium">{task.symbol}</div>
                              {task.message && (
                                <p className="mt-1 text-xs text-red-300/80 line-clamp-2">{task.message}</p>
                              )}
                            </td>
                            <td className="px-4 py-4 align-middle">
                              <div className="flex items-center gap-2">
                                <StatusBadge status={task.status} />
                                <div className="flex items-center gap-2 text-slate-300">
                                  {!isStopped && (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        controlLiveTask.mutate({
                                          taskId: task.task_id,
                                          action: isPaused ? "resume" : "pause"
                                        });
                                      }}
                                      className={`flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/80 text-white transition hover:bg-blue-500 ${
                                        isControlPending ? "cursor-not-allowed opacity-70" : ""
                                      }`}
                                      disabled={isControlPending}
                                      aria-label={isPaused ? "恢复任务" : "暂停任务"}
                                    >
                                      {isPaused ? <PlayIcon /> : <PauseIcon />}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      controlLiveTask.mutate({
                                        taskId: task.task_id,
                                        action: isStopped ? "delete" : "stop"
                                      });
                                    }}
                                    className={`flex h-8 w-8 items-center justify-center rounded-full text-white transition ${
                                      isStopped ? "bg-red-500/80 hover:bg-red-500" : "bg-amber-500/80 hover:bg-amber-500"
                                    } ${
                                      isControlPending ? "cursor-not-allowed opacity-70" : ""
                                    }`}
                                    disabled={isControlPending}
                                    aria-label={isStopped ? "删除任务" : "停止任务"}
                                  >
                                    {isStopped ? <TrashIcon /> : <StopIcon />}
                                  </button>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 align-middle text-slate-300">
                              {formatTimestamp(task.created_at)}
                            </td>
                            <td className="px-4 py-4 align-middle text-slate-300">{task.session}</td>
                            <td className="px-4 py-4 align-middle text-slate-300">
                              {task.account_mode === "live" ? "实盘账户" : "纸上账户"}
                            </td>
                            <td className="px-4 py-4 align-middle text-slate-300">{task.interval_seconds} 秒</td>
                            <td className="px-4 py-4 align-middle text-slate-300">
                              {formatDuration(task.duration_seconds, task.is_permanent)}
                            </td>
                            <td className="px-4 py-4 align-middle text-slate-300">
                              {task.max_points != null ? task.max_points.toLocaleString("zh-CN") : "无限制"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(280px,20%)_minmax(0,80%)] items-start">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">数据系列</h3>
                <button
                  type="button"
                  className="bg-blue-500/80 hover:bg-blue-500 transition px-5 py-2 rounded-full text-sm font-medium"
                  onClick={() => {
                    setSimForm((prev) => ({ ...prev, symbol: generateSimSymbol() }));
                    setIsCreatingSimulated(true);
                  }}
                >
                  创建数据
                </button>
              </div>
              <div className="space-y-3 max-h-[100vh] overflow-y-auto p-2">
                <div className="flex flex-wrap gap-2 pb-2">
                  {filterOptions.map((option: { label: string; value: string }) => {
                    const selected = activeFilters.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => toggleFilter(option.value)}
                        className={`rounded-full px-3 py-1 text-xs transition ${
                          selected
                            ? "bg-blue-500 text-white shadow-[0_0_12px_rgba(59,130,246,0.35)]"
                            : "bg-slate-900/50 text-slate-200 hover:bg-blue-500/30 hover:text-white"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                  {activeFilters.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveFilters([])}
                      className="rounded-full bg-slate-800/60 px-3 py-1 text-xs text-slate-200 transition hover:bg-slate-700/60"
                    >
                      重置
                    </button>
                  )}
                </div>
                {filteredDataItems.map((item) => {
                  const isActive = selectedData?.id === item.data_id && selectedData.type === item.type;
                  const isDeleting =
                    item.type === "sim"
                      ? deleteSimulated.isPending && deleteSimulated.variables === item.data_id
                      : deleteLiveDataMutation.isPending && deleteLiveDataMutation.variables === item.data_id;
                  return (
                    <div
                      key={item.data_id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedData({ type: item.type, id: item.data_id })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedData({ type: item.type, id: item.data_id });
                        }
                      }}
                      className={`relative w-full cursor-pointer rounded-3xl border px-5 py-4 transition focus:outline-none focus:ring-2 focus:ring-blue-400/60 ${
                        isActive
                          ? "border-blue-400/70 bg-blue-500/20 text-white shadow-[0_0_26px_rgba(59,130,246,0.22)]"
                          : "border-white/5 bg-slate-900/40 text-slate-200 hover:border-blue-500/30 hover:bg-blue-500/10"
                      }`}
                    >
                      <button
                        type="button"
                        className={`absolute right-4 top-4 transition ${
                          isDeleting ? "text-slate-600 cursor-not-allowed" : "text-slate-500 hover:text-red-400"
                        }`}
                        aria-label="删除数据"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isDeleting) {
                            return;
                          }
                          if (item.type === "sim") {
                            deleteSimulated.mutate(item.data_id);
                          } else {
                            deleteLiveDataMutation.mutate(item.data_id);
                          }
                        }}
                        disabled={isDeleting}
                      >
                        ✕
                      </button>
                      <div className="flex items-center justify-between gap-2 pr-6">
                        <h4 className="text-lg font-medium tracking-wide">{item.symbol}</h4>
                        <span
                          className={`text-[10px] font-semibold tracking-wider px-2 py-1 rounded-full ${
                            item.type === "live" ? "bg-emerald-500/15 text-emerald-300" : "bg-indigo-500/15 text-indigo-300"
                          }`}
                        >
                          {item.tag}
                        </span>
                      </div>
                      {item.type === "live" && item.task_id && (
                        <p className="text-[11px] text-slate-400 mt-1">任务：{item.task_id}</p>
                      )}
                      <p className="text-xs text-slate-400 mt-2 break-all">数据ID：{item.data_id}</p>
                      <p className="text-xs text-slate-500 mt-1">{formatTimestamp(item.created_at)}</p>
                    </div>
                  );
                })}
                {filteredDataItems.length === 0 && (
                  <div className="text-slate-500">暂无符合筛选条件的数据。</div>
                )}
              </div>
            </div>
            <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-6 min-h-[520px] max-h-[100vh] overflow-y-auto pr-3 xl:w-full">
              {selectedData ? (
                isDetailLoading ? (
                  <div className="flex h-full min-h-[320px] items-center justify-center text-slate-500">加载中...</div>
                ) : detail ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h4 className="text-2xl font-semibold text-white">{detail.symbol}</h4>
                        <p className="text-slate-400 text-sm mt-1">数据ID：{detail.data_id}</p>
                        {selectedDataMeta && (
                          <p className="text-xs text-slate-500 mt-1">
                            创建于 {formatTimestamp(selectedDataMeta.created_at)}
                          </p>
                        )}
                      </div>
                      {overallTrend && (
                        <div className="text-right">
                          <p
                            className={`text-sm font-medium ${
                              overallTrend.direction === "上涨"
                                ? "text-red-400"
                                : overallTrend.direction === "下跌"
                                  ? "text-green-400"
                                  : "text-slate-300"
                            }`}
                          >
                            {overallTrend.direction}
                          </p>
                          <p
                            className={`text-lg font-semibold ${
                              overallTrend.direction === "上涨"
                                ? "text-red-400"
                                : overallTrend.direction === "下跌"
                                  ? "text-green-400"
                                  : "text-slate-100"
                            }`}
                          >
                            {overallTrend.diff >= 0 ? "+" : ""}
                            {overallTrend.diff.toFixed(2)}
                          </p>
                          {overallTrend.diffPercent !== null && (
                            <p className="text-xs text-slate-400">
                              {overallTrend.diffPercent >= 0 ? "+" : ""}
                              {overallTrend.diffPercent.toFixed(2)}%
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 text-sm text-slate-300 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                        <p className="text-xs text-slate-400">起始价格</p>
                        <p className="text-lg font-medium text-white">
                          {overallTrend ? overallTrend.first.toFixed(2) : "-"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                        <p className="text-xs text-slate-400">结束价格</p>
                        <p className="text-lg font-medium text-white">
                          {overallTrend ? overallTrend.last.toFixed(2) : "-"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                        <p className="text-xs text-slate-400">可见数据点</p>
                        <p className="text-lg font-medium text-white">
                          {visibleCount}/{detail.data.length}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                        <p className="text-xs text-slate-400">时间范围</p>
                        <p className="text-sm text-white/90">
                          {visibleStartPoint ? formatTimestamp(visibleStartPoint.timestamp) : "--"}
                          <span className="mx-1 text-slate-500">→</span>
                          {visibleEndPoint ? formatTimestamp(visibleEndPoint.timestamp) : "--"}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <PriceChart data={chartData} />
                      {detail.data.length > 1 ? (
                        <div className="space-y-2">
                          <div className="relative h-10">
                            <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-800/80" />
                            <div
                              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-500/50"
                              style={sliderHighlightStyle}
                            />
                            <input
                              type="range"
                              min={0}
                              max={sliderMax}
                              value={dataRange.start}
                              onChange={(event) => {
                                const value = Number(event.target.value);
                                setDataRange((prev) => {
                                  const clamped = Math.max(0, Math.min(value, sliderMax));
                                  if (clamped > prev.end) {
                                    return { start: clamped, end: clamped };
                                  }
                                  return { start: clamped, end: prev.end };
                                });
                              }}
                              className="range-slider absolute inset-0 z-30"
                            />
                            <input
                              type="range"
                              min={0}
                              max={sliderMax}
                          value={dataRange.end}
                              onChange={(event) => {
                                const value = Number(event.target.value);
                            setDataRange((prev) => {
                                  const clamped = Math.max(prev.start, Math.min(value, sliderMax));
                                  return { start: prev.start, end: clamped };
                                });
                              }}
                              className="range-slider absolute inset-0 z-40"
                            />
                          </div>
                          <div className="flex justify-between text-xs text-slate-400">
                            <span>起点：{dataRange.start + 1}</span>
                            <span>终点：{dataRange.end + 1}</span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">数据点不足，无需调整范围。</p>
                      )}
                    </div>

                    {formattedConfigEntries.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-slate-200">
                          {detailSource === "sim" ? "生成参数" : "采集参数"}
                        </h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {formattedConfigEntries.map((entry) => (
                            <div
                              key={entry.key}
                              className="rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm text-slate-300"
                            >
                              <p className="text-xs text-slate-400">{entry.label}</p>
                              <p className="mt-1 font-medium text-white break-words">{entry.value}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex h-full min-h-[320px] items-center justify-center text-slate-500">
                    未找到数据详情。
                  </div>
                )
              ) : (
                <div className="flex h-full min-h-[320px] items-center justify-center text-slate-500">
                  请选择左侧的数据系列。
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <Dialog
        open={Boolean(activeTask)}
        title={activeTask ? `任务详情 · ${activeTask.symbol}` : ""}
        onClose={closeTaskDetail}
        size="lg"
      >
        {activeTask && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h4 className="text-2xl font-semibold text-white">{activeTask.symbol}</h4>
                <p className="text-xs text-slate-400 mt-1">任务ID：{activeTask.task_id}</p>
                <p className="text-xs text-slate-400 mt-1">创建于 {formatTimestamp(activeTask.created_at)}</p>
                {activeTask.started_at && (
                  <p className="text-xs text-slate-400 mt-1">
                    启动于 {formatTimestamp(activeTask.started_at)}
                  </p>
                )}
                {activeTask.finished_at && (
                  <p className="text-xs text-slate-400 mt-1">
                    结束于 {formatTimestamp(activeTask.finished_at)}
                  </p>
                )}
                {activeTask.message && (
                  <p className="mt-2 text-sm text-red-300/80">{activeTask.message}</p>
                )}
              </div>
              <div className="flex items-start gap-3">
                <StatusBadge status={activeTask.status} />
                <div className="flex gap-2">
                  {activeTask.status.toLowerCase() !== "stopped" && (
                    <button
                      type="button"
                      className={`flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/80 text-white transition hover:bg-blue-500 ${
                        controlLiveTask.isPending && controlLiveTask.variables?.taskId === activeTask.task_id
                          ? "cursor-not-allowed opacity-70"
                          : ""
                      }`}
                      onClick={() => {
                        const action = activeTask.status.toLowerCase() === "paused" ? "resume" : "pause";
                        controlLiveTask.mutate({ taskId: activeTask.task_id, action });
                      }}
                      disabled={
                        controlLiveTask.isPending && controlLiveTask.variables?.taskId === activeTask.task_id
                      }
                      aria-label={activeTask.status.toLowerCase() === "paused" ? "恢复任务" : "暂停任务"}
                    >
                      {activeTask.status.toLowerCase() === "paused" ? (
                        <PlayIcon />
                      ) : (
                        <PauseIcon />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-white transition ${
                      activeTask.status.toLowerCase() === "stopped"
                        ? "bg-red-500/80 hover:bg-red-500"
                        : "bg-amber-500/80 hover:bg-amber-500"
                    } ${
                      controlLiveTask.isPending && controlLiveTask.variables?.taskId === activeTask.task_id
                        ? "cursor-not-allowed opacity-70"
                        : ""
                    }`}
                    onClick={() => {
                      const action = activeTask.status.toLowerCase() === "stopped" ? "delete" : "stop";
                      controlLiveTask.mutate({ taskId: activeTask.task_id, action });
                    }}
                    disabled={
                      controlLiveTask.isPending && controlLiveTask.variables?.taskId === activeTask.task_id
                    }
                    aria-label={activeTask.status.toLowerCase() === "stopped" ? "删除任务" : "停止任务"}
                  >
                    {activeTask.status.toLowerCase() === "stopped" ? <TrashIcon /> : <StopIcon />}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-4 text-sm text-slate-300 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                <p className="text-xs text-slate-400">账号类型</p>
                <p className="text-lg font-medium text-white">
                  {activeTask.account_mode === "live" ? "实盘账户" : "纸上账户"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                <p className="text-xs text-slate-400">交易时段</p>
                <p className="text-lg font-medium text-white">{activeTask.session}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                <p className="text-xs text-slate-400">采样间隔</p>
                <p className="text-lg font-medium text-white">{activeTask.interval_seconds} 秒</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                <p className="text-xs text-slate-400">持续时长</p>
                <p className="text-lg font-medium text-white">
                  {formatDuration(activeTask.duration_seconds, activeTask.is_permanent)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                <p className="text-xs text-slate-400">可见数据点</p>
                <p className="text-lg font-medium text-white">
                  {taskVisibleCount}/{totalTaskPoints}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                <p className="text-xs text-slate-400">时间范围</p>
                <p className="text-sm text-white/90">
                  {formatTimestamp(taskVisibleStartPoint?.timestamp)}
                  <span className="mx-1 text-slate-500">→</span>
                  {formatTimestamp(taskVisibleEndPoint?.timestamp)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                <p className="text-xs text-slate-400">最大数据点</p>
                <p className="text-lg font-medium text-white">
                  {activeTask.max_points != null
                    ? activeTask.max_points.toLocaleString("zh-CN")
                    : "无限制"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                <p className="text-xs text-slate-400">运行模式</p>
                <p className="text-lg font-medium text-white">
                  {activeTask.is_permanent ? "永久运行" : "按时长停止"}
                </p>
              </div>
            </div>

            {taskTrend && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 text-sm text-slate-200">
                <p className="text-xs text-slate-400">整体走势</p>
                <div className="mt-2 flex flex-wrap items-end gap-4">
                  <span
                    className={`text-lg font-semibold ${
                      taskTrend.direction === "上涨"
                        ? "text-red-400"
                        : taskTrend.direction === "下跌"
                          ? "text-green-400"
                          : "text-slate-100"
                    }`}
                  >
                    {taskTrend.direction}
                  </span>
                  <span className="text-sm text-slate-300">
                    {taskTrend.first.toFixed(2)} → {taskTrend.last.toFixed(2)}
                  </span>
                  {taskTrend.diffPercent !== null && (
                    <span className="text-xs text-slate-400">
                      {taskTrend.diff >= 0 ? "+" : ""}
                      {taskTrend.diff.toFixed(2)} /{" "}
                      {taskTrend.diffPercent >= 0 ? "+" : ""}
                      {taskTrend.diffPercent.toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>
            )}

            {taskDetailErrorMessage && <p className="text-sm text-red-300">{taskDetailErrorMessage}</p>}

            {isTaskDetailLoading ? (
              <div className="flex h-72 items-center justify-center text-slate-500">加载中...</div>
            ) : taskChartData.length > 0 ? (
              <div className="space-y-4">
                <PriceChart data={taskChartData} />
                {taskDetail && taskDetail.data.length > 1 ? (
                  <div className="space-y-2">
                    <div className="relative h-10">
                      <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-800/80" />
                      <div
                        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-500/50"
                        style={taskSliderHighlightStyle}
                      />
                      <input
                        type="range"
                        min={0}
                        max={taskSliderMax}
                        value={taskRange.start}
                        onChange={(event) => {
                          const sliderMaxValue = taskSliderMax;
                          const rawValue = Number(event.target.value);
                          const clampedStart = Math.max(0, Math.min(rawValue, sliderMaxValue));
                          const prevRange = taskRangeRef.current;
                          const nextEnd = Math.max(clampedStart, Math.min(prevRange.end, sliderMaxValue));
                          const nextRange = { start: clampedStart, end: nextEnd };
                          const shouldPin = sliderMaxValue <= 0 ? true : nextRange.end >= sliderMaxValue;
                          taskRangeRef.current = nextRange;
                          taskPinnedRef.current = shouldPin;
                          setTaskRange(nextRange);
                          setIsTaskRangePinnedToEnd(shouldPin);
                        }}
                        className="range-slider absolute inset-0 z-30"
                      />
                      <input
                        type="range"
                        min={0}
                        max={taskSliderMax}
                        value={taskRange.end}
                        onChange={(event) => {
                          const sliderMaxValue = taskSliderMax;
                          const rawValue = Number(event.target.value);
                          const prevRange = taskRangeRef.current;
                          const clampedEnd = Math.max(
                            prevRange.start,
                            Math.min(rawValue, sliderMaxValue)
                          );
                          const nextRange = { start: prevRange.start, end: clampedEnd };
                          const shouldPin = sliderMaxValue <= 0 ? true : clampedEnd >= sliderMaxValue;
                          taskRangeRef.current = nextRange;
                          taskPinnedRef.current = shouldPin;
                          setTaskRange(nextRange);
                          setIsTaskRangePinnedToEnd(shouldPin);
                        }}
                        className="range-slider absolute inset-0 z-40"
                      />
                    </div>
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>起点：{taskRange.start + 1}</span>
                      <span>终点：{taskRange.end + 1}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">数据点不足，无需调整范围。</p>
                )}
                <p className="text-xs text-slate-400">
                  共 {totalTaskPoints} 个数据点，当前选择：第 {taskRange.start + 1} - {taskRange.end + 1} 个，最近时间：
                  {latestTaskTimestamp ?? "暂无"}
                </p>
              </div>
            ) : (
              <div className="flex h-72 items-center justify-center text-slate-500">
                暂无采集数据，请稍后刷新。
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="self-end rounded-full bg-blue-500/20 px-5 py-2 text-xs text-blue-200 transition hover:bg-blue-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => createSnapshot.mutate({ taskId: activeTask.task_id, range: taskRange })}
                disabled={isSnapshotFromDialogPending || taskChartData.length === 0}
              >
                {isSnapshotFromDialogPending ? "生成中..." : "创建快照"}
              </button>
              <p className="text-right text-[11px] text-slate-500">该快照会保存当前滑动条选择的数据范围</p>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={isCreatingLive} title="创建实时任务" onClose={() => setIsCreatingLive(false)}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (isCreateLiveDisabled) {
              return;
            }
            createLiveTask.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <span className="text-sm">股票代码</span>
              <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
                <input
                  className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2 uppercase"
                  value={liveForm.symbolPrefix}
                  onChange={(e) =>
                    setLiveForm((prev) => ({ ...prev, symbolPrefix: e.target.value.toUpperCase() }))
                  }
                  placeholder="AAPL"
                />
                <select
                  className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                  value={liveForm.symbolSuffix}
                  onChange={(e) =>
                    setLiveForm((prev) => ({
                      ...prev,
                      symbolSuffix: e.target.value as SymbolSuffix
                    }))
                  }
                >
                  <option value=".US">.US</option>
                  <option value=".HK">.HK</option>
                </select>
              </div>
              <p className="text-xs text-slate-500">完整代码：{symbolPreview}</p>
            </div>
            <label className="text-sm space-y-2">
              采样间隔(秒)
              <input
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                type="number"
                min={1}
                value={liveForm.interval_seconds}
                onChange={(e) => setLiveForm((prev) => ({ ...prev, interval_seconds: Number(e.target.value) }))}
              />
            </label>
            <div className="col-span-2 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">持续时间</span>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={liveForm.isPermanent}
                    onChange={(event) =>
                      setLiveForm((prev) => ({
                        ...prev,
                        isPermanent: event.target.checked
                      }))
                    }
                  />
                  永久运行
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(Object.entries(durationFieldLabels) as [DurationField, string][]).map(
                  ([field, label]) => (
                    <label key={field} className="text-xs space-y-1">
                      <span className="block text-slate-400">{label}</span>
                      <input
                        className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                        type="number"
                        min={0}
                        value={liveForm[field]}
                        disabled={liveForm.isPermanent}
                        onChange={(event) => {
                          const raw = Number(event.target.value);
                          const next = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
                          setLiveForm((prev) => ({
                            ...prev,
                            [field]: next
                          }) as LiveFormState);
                        }}
                      />
                    </label>
                  )
                )}
              </div>
              {isDurationInvalid && !liveForm.isPermanent && (
                <p className="text-xs text-amber-300">请输入大于 0 的持续时间，或勾选"永久运行"。</p>
              )}
            </div>
            <div className="col-span-2 space-y-2">
              <span className="text-sm">交易时段（可多选）</span>
              <div className="flex flex-wrap gap-2">
                {availableSessions.map((option) => {
                  const selected = liveForm.sessions.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleSession(option.value)}
                      className={`rounded-full border px-4 py-1.5 text-xs transition ${
                        selected
                          ? "border-blue-400/70 bg-blue-500/30 text-white shadow-[0_0_12px_rgba(59,130,246,0.35)]"
                          : "border-white/10 bg-slate-900/50 text-slate-200 hover:border-blue-400/40 hover:text-white"
                      }`}
                      >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {liveForm.sessions.length === 0 && (
                <p className="text-xs text-amber-300">至少选择一个交易时段</p>
              )}
            </div>
            <label className="text-sm space-y-2 col-span-2 sm:col-span-1">
              账号类型
              <select
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={liveForm.account_mode}
                onChange={(e) => setLiveForm((prev) => ({ ...prev, account_mode: e.target.value }))}
              >
                <option value="paper">纸上账户</option>
                <option value="live">实盘账户</option>
              </select>
            </label>
            <div className="col-span-2 space-y-2">
              <span className="text-sm">最大保存数据点（可选）</span>
              <input
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                type="number"
                min={1}
                value={liveForm.maxPoints === "" ? "" : liveForm.maxPoints}
                onChange={(event) => {
                  const rawValue = event.target.value;
                  if (rawValue === "") {
                    setLiveForm((prev) => ({ ...prev, maxPoints: "" }));
                    return;
                  }
                  const parsed = Number(rawValue);
                  if (!Number.isFinite(parsed)) {
                    return;
                  }
                  setLiveForm((prev) => ({ ...prev, maxPoints: Math.max(1, Math.floor(parsed)) }));
                }}
                placeholder="例如 1000"
              />
              <p className="text-xs text-slate-500">留空表示不限制，设定后将只保留最新的 N 个数据点。</p>
              {isMaxPointsInvalid && (
                <p className="text-xs text-amber-300">请输入大于 0 的数字，或留空表示无限制。</p>
              )}
            </div>
          </div>
          <button
            type="submit"
            className="bg-blue-500/80 hover:bg-blue-500 transition px-5 py-2 rounded-full text-sm font-medium"
            disabled={isCreateLiveDisabled}
          >
            创建
          </button>
        </form>
      </Dialog>

      <Dialog open={isCreatingSimulated} title="生成模拟数据" onClose={() => setIsCreatingSimulated(false)}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            createSimulated.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm space-y-2 col-span-2">
              股票代码
              <input
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={simForm.symbol}
                onChange={(e) => setSimForm((prev) => ({ ...prev, symbol: e.target.value }))}
              />
            </label>
            <label className="text-sm space-y-2">
              数据点数
              <input
                type="number"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={simForm.data_points}
                onChange={(e) => setSimForm((prev) => ({ ...prev, data_points: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              初始价格
              <input
                type="number"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={simForm.start_price}
                onChange={(e) => setSimForm((prev) => ({ ...prev, start_price: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              末尾价格
              <input
                type="number"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={simForm.end_price}
                onChange={(e) => setSimForm((prev) => ({ ...prev, end_price: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              均值价格
              <input
                type="number"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={simForm.mean_price}
                onChange={(e) => setSimForm((prev) => ({ ...prev, mean_price: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              波动概率
              <input
                type="number"
                step="0.01"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={simForm.volatility_probability}
                onChange={(e) => setSimForm((prev) => ({ ...prev, volatility_probability: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              波动幅度
              <input
                type="number"
                step="0.1"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={simForm.volatility_magnitude}
                onChange={(e) => setSimForm((prev) => ({ ...prev, volatility_magnitude: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              噪声
              <input
                type="number"
                step="0.1"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={simForm.noise}
                onChange={(e) => setSimForm((prev) => ({ ...prev, noise: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              不确定性
              <input
                type="number"
                step="0.01"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={simForm.uncertainty}
                onChange={(e) => setSimForm((prev) => ({ ...prev, uncertainty: Number(e.target.value) }))}
              />
            </label>
          </div>
          <button
            type="submit"
            className="bg-blue-500/80 hover:bg-blue-500 transition px-5 py-2 rounded-full text-sm font-medium"
            disabled={createSimulated.isPending}
          >
            生成
          </button>
        </form>
      </Dialog>

    </div>
  );
}

