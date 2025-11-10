import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { Dialog } from "../components/Dialog";
import { StatusBadge } from "../components/StatusBadge";
import { PriceChart } from "../components/PriceChart";

interface TradeLogEntry {
  timestamp: string;
  action: string;
  price: number;
  quantity: number;
  cash: number;
  position: number;
  value: number;
}

interface EnhancedTradeEntry extends TradeLogEntry {
  change: number;
  changePct: number;
}

interface BacktestTask {
  task_id: string;
  status: string;
  metrics?: Record<string, number>;
  config: {
    data_id: string;
    strategy_id: string;
    initial_capital: number;
  };
  trades?: TradeLogEntry[];
  message?: string;
  created_at?: string;
}

interface StrategyParameter {
  name: string;
  parameter_type: string;
  description: string;
  default: number | string | boolean;
  minimum?: number;
  maximum?: number;
}

interface Strategy {
  strategy_id: string;
  name: string;
  description: string;
  parameters: StrategyParameter[];
}

const buildDefaultStrategyParams = (strategy: Strategy | undefined): Record<string, string> => {
  if (!strategy) {
    return {};
  }
  return strategy.parameters.reduce<Record<string, string>>((acc, parameter) => {
    const defaultValue = parameter.default;
    if (defaultValue === undefined || defaultValue === null) {
      acc[parameter.name] = "";
    } else if (typeof defaultValue === "boolean") {
      acc[parameter.name] = defaultValue ? "true" : "false";
    } else {
      acc[parameter.name] = String(defaultValue);
    }
    return acc;
  }, {});
};

const coerceStrategyParameterValue = (parameter: StrategyParameter, rawValue: string | undefined) => {
  const type = parameter.parameter_type.toLowerCase();
  if (type === "int" || type === "integer") {
    const parsed = rawValue !== undefined ? Number(rawValue) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
    if (typeof parameter.default === "number") {
      return Math.round(parameter.default);
    }
    return 0;
  }
  if (type === "float" || type === "double" || type === "number") {
    const parsed = rawValue !== undefined ? Number(rawValue) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    if (typeof parameter.default === "number") {
      return parameter.default;
    }
    return 0;
  }
  if (type === "bool" || type === "boolean") {
    if (rawValue === "true" || rawValue === "false") {
      return rawValue === "true";
    }
    if (typeof parameter.default === "boolean") {
      return parameter.default;
    }
    return false;
  }
  if (rawValue !== undefined) {
    return rawValue;
  }
  if (parameter.default === undefined || parameter.default === null) {
    return "";
  }
  return String(parameter.default);
};

interface DataItem {
  data_id: string;
  symbol: string;
}

interface DataDetail {
  data_id: string;
  symbol: string;
  data: Array<{ timestamp: string; price: number }>;
}

type ChartTrade = {
  timestamp: string;
  price: number;
  action: "buy" | "sell";
};

export function BacktestManagementPage() {
  const client = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [selectedTask, setSelectedTask] = useState<BacktestTask | null>(null);
  const [selectedData, setSelectedData] = useState<DataDetail | null>(null);
  const [chartRange, setChartRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [sortConfig, setSortConfig] = useState<{ field: "created_at" | "total_return" | "win_rate" | "task_id"; direction: "asc" | "desc" }>({
    field: "created_at",
    direction: "desc"
  });
  const [form, setForm] = useState({
    data_id: "",
    strategy_id: "",
    initial_capital: 100000,
    lot_size: 1,
    min_position: 0,
    max_position: 1,
    data_frequency_seconds: 60,
    signal_frequency_seconds: 60,
    strategy_params: {} as Record<string, string>
  });

  const tasksQuery = useQuery({
    queryKey: ["backtests"],
    queryFn: async () => {
      const { data } = await api.get<BacktestTask[]>("/backtests");
      return data;
    }
  });

  const strategiesQuery = useQuery({
    queryKey: ["strategies"],
    queryFn: async () => {
      const { data } = await api.get<Strategy[]>("/strategies");
      return data;
    }
  });

  const dataSourcesQuery = useQueries({
    queries: [
      {
        queryKey: ["simulatedData"],
        queryFn: async () => {
          const { data } = await api.get<DataItem[]>("/data/simulated");
          return data;
        }
      },
      {
        queryKey: ["liveSnapshots"],
        queryFn: async () => {
          const { data } = await api.get<Array<{ data_id: string; task_id: string }>>("/data/live/snapshots");
          return data.map((item) => ({ data_id: item.data_id, symbol: item.task_id }));
        }
      }
    ]
  });

  const strategies = strategiesQuery.data ?? [];
  const simulatedDataOptions = (dataSourcesQuery[0]?.data as DataItem[] | undefined) ?? [];
  const snapshotDataOptions = (dataSourcesQuery[1]?.data as DataItem[] | undefined) ?? [];

  useEffect(() => {
    if (!form.data_id && simulatedDataOptions.length > 0) {
      setForm((prev) => ({ ...prev, data_id: simulatedDataOptions[0].data_id }));
    }
  }, [form.data_id, simulatedDataOptions]);

  useEffect(() => {
    if (strategies.length === 0) {
      return;
    }
    if (!form.strategy_id) {
      const defaultStrategy = strategies[0];
      setForm((prev) => ({
        ...prev,
        strategy_id: defaultStrategy.strategy_id,
        strategy_params: buildDefaultStrategyParams(defaultStrategy)
      }));
      return;
    }
    if (Object.keys(form.strategy_params).length === 0) {
      const active = strategies.find((item) => item.strategy_id === form.strategy_id);
      if (active) {
        setForm((prev) => ({
          ...prev,
          strategy_params: buildDefaultStrategyParams(active)
        }));
      }
    }
  }, [strategies, form.strategy_id, form.strategy_params]);

  const createBacktest = useMutation({
    mutationFn: async () => {
      const { strategy_params: rawStrategyParams, ...rest } = form;
      const active = strategies.find((item) => item.strategy_id === rest.strategy_id);
      const normalizedParams = active
        ? active.parameters.reduce<Record<string, number | string | boolean>>((acc, parameter) => {
            acc[parameter.name] = coerceStrategyParameterValue(parameter, rawStrategyParams[parameter.name]);
            return acc;
          }, {})
        : {};
      await api.post("/backtests", {
        ...rest,
        strategy_params: normalizedParams
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["backtests"] });
      setIsCreating(false);
    }
  });

  const controlTask = useMutation({
    mutationFn: async ({ taskId, action }: { taskId: string; action: "pause" | "resume" | "stop" | "delete" }) => {
      if (action === "delete") {
        await api.delete(`/backtests/${taskId}`);
      } else {
        await api.post(`/backtests/${taskId}/${action}`);
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["backtests"] });
    }
  });

  const taskDetail = useMutation({
    mutationFn: async (taskId: string) => {
      const { data } = await api.get<BacktestTask>(`/backtests/${taskId}`);
      setSelectedTask(data);
      const dataId = data.config.data_id;
      let detail: DataDetail | null = null;
      try {
        const response = await api.get<DataDetail>(`/data/simulated/${dataId}`);
        detail = response.data;
      } catch (error) {
        const response = await api.get<DataDetail>(`/data/live/data/${dataId}`);
        detail = response.data;
      }
      setSelectedData(detail);
    }
  });

  const tasks = tasksQuery.data ?? [];
  const dataOptions = [...simulatedDataOptions, ...snapshotDataOptions];
  const activeStrategy = useMemo(
    () => strategies.find((item) => item.strategy_id === form.strategy_id),
    [strategies, form.strategy_id]
  );

  useEffect(() => {
    const activeStatuses = new Set(["running", "pending", "created"]);
    const hasActive = tasks.some((task) => activeStatuses.has(task.status.toLowerCase()));
    if (!hasActive) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void tasksQuery.refetch();
    }, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [tasks, tasksQuery]);

  const sortedTasks = tasks.slice().sort((a, b) => {
    const { field, direction } = sortConfig;
    const multiplier = direction === "asc" ? 1 : -1;

    const getFieldValue = (task: BacktestTask) => {
      if (field === "task_id") {
        return task.task_id;
      }
      if (field === "created_at") {
        return task.created_at ? new Date(task.created_at).getTime() : 0;
      }
      const metricKey = field === "total_return" ? "total_return" : "win_rate";
      const metricValue = task.metrics?.[metricKey];
      return typeof metricValue === "number" ? metricValue : Number.NEGATIVE_INFINITY;
    };

    const valueA = getFieldValue(a);
    const valueB = getFieldValue(b);

    if (typeof valueA === "number" && typeof valueB === "number") {
      if (valueA === valueB) {
        return a.task_id.localeCompare(b.task_id) * multiplier;
      }
      return (valueA - valueB) * multiplier;
    }

    return String(valueA).localeCompare(String(valueB)) * multiplier;
  });

  const toggleSort = (field: typeof sortConfig.field) => {
    setSortConfig((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { field, direction: field === "task_id" ? "asc" : "desc" };
    });
  };

  const getSortIndicator = (field: typeof sortConfig.field) => {
    if (sortConfig.field !== field) {
      return "";
    }
    return sortConfig.direction === "asc" ? "↑" : "↓";
  };

  useEffect(() => {
    if (!selectedData || selectedData.data.length === 0) {
      setChartRange({ start: 0, end: 0 });
      return;
    }
    const maxIndex = selectedData.data.length - 1;
    setChartRange({ start: 0, end: maxIndex });
  }, [selectedData]);

  const sliderMax = selectedData ? Math.max(selectedData.data.length - 1, 0) : 0;

  const chartData = useMemo(() => {
    if (!selectedData || selectedData.data.length === 0) {
      return [];
    }
    const safeStart = Math.max(0, Math.min(chartRange.start, selectedData.data.length - 1));
    const safeEnd = Math.max(safeStart, Math.min(chartRange.end, selectedData.data.length - 1));
    return selectedData.data.slice(safeStart, safeEnd + 1).map((point) => ({
      ...point,
      price: Number(point.price)
    }));
  }, [selectedData, chartRange]);

  const visibleTimestamps = useMemo(() => new Set(chartData.map((point) => point.timestamp)), [chartData]);

  const chartTrades = useMemo((): ChartTrade[] => {
    if (!selectedTask?.trades) {
      return [];
    }
    return selectedTask.trades
      .filter((trade) => visibleTimestamps.has(trade.timestamp))
      .map((trade): ChartTrade => ({
        timestamp: trade.timestamp,
        price: trade.price,
        action: trade.action === "buy" ? "buy" : "sell"
      }));
  }, [selectedTask, visibleTimestamps]);

  const visibleStartPoint = chartData.length > 0 ? chartData[0] : null;
  const visibleEndPoint = chartData.length > 0 ? chartData[chartData.length - 1] : null;

  const tradeNumberFormatter = useMemo(
    () =>
      new Intl.NumberFormat("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }),
    []
  );

  const metricsCards = useMemo(() => {
    if (!selectedTask?.metrics) {
      return [];
    }
    const metrics = selectedTask.metrics;
    const initialCapital =
      typeof selectedTask.config.initial_capital === "number"
        ? selectedTask.config.initial_capital
        : Number(selectedTask.config.initial_capital ?? 0);
    const finalEquity =
      typeof metrics.final_equity === "number" ? metrics.final_equity : undefined;
    const totalProfit =
      typeof finalEquity === "number" && !Number.isNaN(initialCapital)
        ? finalEquity - initialCapital
        : undefined;
    const totalProfitRate =
      typeof totalProfit === "number" && initialCapital
        ? totalProfit / initialCapital
        : undefined;
    const currencyFormatter = new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: "CNY",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const formatCurrency = (value?: number) => {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
      }
      return currencyFormatter.format(value);
    };
    const formatPercent = (value?: number, digits = 2, withSign = false) => {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
      }
      if (!Number.isFinite(value)) {
        if (value === Infinity) return "∞";
        if (value === -Infinity) return "-∞";
        return "--";
      }
      const numeric = (value * 100).toFixed(digits);
      if (withSign && value > 0) {
        return `+${numeric}%`;
      }
      return `${numeric}%`;
    };
    const formatInteger = (value?: number) => {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return "--";
      }
      return Math.round(value).toLocaleString("zh-CN");
    };

    const totalReturn = metrics.total_return;
    const winRate = metrics.win_rate;
    const maxDrawdown = metrics.max_drawdown;
    const profitFactor = metrics.profit_factor;

    type Accent = {
      accent?: string;
      border?: "positive" | "negative";
    };

    const cards: Array<
      {
        key: string;
        label: string;
        value: string;
      } & Accent
    > = [
      {
        key: "final_equity",
        label: "最终资产",
        value: formatCurrency(metrics.final_equity),
        accent: "text-blue-100"
      },
      {
        key: "total_profit",
        label: "总盈亏",
        value: typeof totalProfit === "number" ? formatCurrency(totalProfit) : "--",
        accent:
          typeof totalProfit === "number"
            ? totalProfit >= 0
              ? "text-rose-300"
              : "text-emerald-300"
            : undefined,
        border:
          typeof totalProfit === "number"
            ? totalProfit >= 0
              ? "positive"
              : "negative"
            : undefined
      },
      {
        key: "total_profit_rate",
        label: "总盈亏率",
        value: formatPercent(totalProfitRate, 2, true),
        accent:
          typeof totalProfitRate === "number"
            ? totalProfitRate >= 0
              ? "text-rose-300"
              : "text-emerald-300"
            : undefined,
        border:
          typeof totalProfitRate === "number"
            ? totalProfitRate >= 0
              ? "positive"
              : "negative"
            : undefined
      },
      {
        key: "max_drawdown",
        label: "最大回撤",
        value:
          typeof maxDrawdown === "number"
            ? `-${(Math.abs(maxDrawdown) * 100).toFixed(2)}%`
            : "--",
        accent: "text-amber-200"
      },
      {
        key: "win_rate",
        label: "胜率",
        value: formatPercent(winRate, 1),
        accent:
          typeof winRate === "number"
            ? winRate >= 0.5
              ? "text-rose-200"
              : "text-emerald-200"
            : undefined,
        border:
          typeof winRate === "number"
            ? winRate >= 0.5
              ? "positive"
              : "negative"
            : undefined
      },
      {
        key: "profit_factor",
        label: "盈亏比",
        value:
          typeof profitFactor === "number"
            ? Number.isFinite(profitFactor)
              ? profitFactor.toFixed(2)
              : "∞"
            : "--",
        accent:
          typeof profitFactor === "number" && Number.isFinite(profitFactor)
            ? profitFactor >= 1
              ? "text-rose-200"
              : "text-emerald-300"
            : "text-blue-200",
        border:
          typeof profitFactor === "number" && Number.isFinite(profitFactor)
            ? profitFactor >= 1
              ? "positive"
              : "negative"
            : undefined
      },
      {
        key: "total_trades",
        label: "交易次数",
        value: formatInteger(metrics.total_trades),
        accent: "text-slate-200"
      }
    ];

    return cards.filter((card) => card.value !== "--");
  }, [selectedTask]);

  const tradeTimeline = useMemo<EnhancedTradeEntry[]>(() => {
    if (!selectedTask?.trades || selectedTask.trades.length === 0) {
      return [];
    }
    const initialEquity =
      typeof selectedTask.config.initial_capital === "number" ? selectedTask.config.initial_capital : 0;
    const sorted = selectedTask.trades
      .slice()
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    let previousValue = initialEquity;
    const enhanced = sorted.map((trade, index) => {
      const baseline = index === 0 ? previousValue || trade.value : previousValue;
      const change = trade.value - baseline;
      const changePct = baseline !== 0 ? change / baseline : 0;
      previousValue = trade.value;
      return {
        ...trade,
        change,
        changePct
      };
    });
    return enhanced.reverse();
  }, [selectedTask]);

  const startPercent = sliderMax > 0 ? (chartRange.start / sliderMax) * 100 : 0;
  const endPercent = sliderMax > 0 ? (chartRange.end / sliderMax) * 100 : 100;
  const sliderHighlightStyle =
    sliderMax > 0 ? { left: `${startPercent}%`, right: `${100 - endPercent}%` } : { left: "0%", right: "0%" };

  return (
    <div className="space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-semibold">回测管理</h2>
          <p className="text-slate-400 mt-2">基于历史数据评估策略表现，输出多维度指标与交易日志。</p>
        </div>
        <button
          type="button"
          className="bg-blue-500/80 hover:bg-blue-500 transition px-5 py-2 rounded-full text-sm font-medium"
          onClick={() => setIsCreating(true)}
        >
          新建回测
        </button>
      </header>

      <section className="space-y-4">
        <div className="glass-panel border border-white/5 rounded-3xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/5 text-sm text-slate-200">
              <thead className="bg-slate-900/40 text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-4 text-left">
                    <button type="button" className="flex items-center gap-1 hover:text-slate-200 transition" onClick={() => toggleSort("task_id")}>
                      任务ID
                      <span className="text-slate-500 text-[10px]">{getSortIndicator("task_id")}</span>
                    </button>
                  </th>
                  <th className="px-4 py-4 text-left">策略</th>
                  <th className="px-4 py-4 text-left">状态</th>
                  <th className="px-4 py-4 text-left">
                    <button type="button" className="flex items-center gap-1 hover:text-slate-200 transition" onClick={() => toggleSort("total_return")}>
                      收益率
                      <span className="text-slate-500 text-[10px]">{getSortIndicator("total_return")}</span>
                    </button>
                  </th>
                  <th className="px-4 py-4 text-left">
                    <button type="button" className="flex items-center gap-1 hover:text-slate-200 transition" onClick={() => toggleSort("win_rate")}>
                      胜率
                      <span className="text-slate-500 text-[10px]">{getSortIndicator("win_rate")}</span>
                    </button>
                  </th>
                  <th className="px-4 py-4 text-left">
                    <button type="button" className="flex items-center gap-1 hover:text-slate-200 transition" onClick={() => toggleSort("created_at")}>
                      创建时间
                      <span className="text-slate-500 text-[10px]">{getSortIndicator("created_at")}</span>
                    </button>
                  </th>
                  <th className="px-6 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sortedTasks.map((task) => {
                  const totalReturn = typeof task.metrics?.total_return === "number" ? task.metrics.total_return : null;
                  const winRate = typeof task.metrics?.win_rate === "number" ? task.metrics.win_rate : null;
                  const createdAtText = task.created_at ? new Date(task.created_at).toLocaleString() : "未知";
                  const normalizedStatus = task.status.toLowerCase();
                  const isCompleted = normalizedStatus === "completed";
                  return (
                    <tr
                      key={task.task_id}
                      onClick={() => taskDetail.mutate(task.task_id)}
                      className="cursor-pointer bg-slate-900/20 hover:bg-blue-500/10 transition"
                    >
                      <td className="px-6 py-5 align-top font-medium">
                        <div className="flex flex-col gap-1">
                          <span className="text-white/90">{task.task_id}</span>
                          {task.message && <span className="text-xs text-amber-300/80">{task.message}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-5 align-top text-slate-400">{task.config.strategy_id}</td>
                      <td className="px-4 py-5 align-top">
                        <StatusBadge status={task.status} />
                      </td>
                      <td className="px-4 py-5 align-top">
                        {totalReturn !== null ? (
                          <span className={totalReturn >= 0 ? "text-red-300 font-semibold" : "text-green-300 font-semibold"}>
                            {(totalReturn * 100).toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-slate-500">--</span>
                        )}
                      </td>
                      <td className="px-4 py-5 align-top">
                        {winRate !== null ? (
                          <span className={winRate >= 0.5 ? "text-red-300 font-semibold" : "text-slate-200 font-semibold"}>
                            {(winRate * 100).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-500">--</span>
                        )}
                      </td>
                      <td className="px-4 py-5 align-top text-slate-400">{createdAtText}</td>
                      <td className="px-6 py-5 align-top">
                        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                          {isCompleted ? (
                            <button
                              type="button"
                              onClick={() => controlTask.mutate({ taskId: task.task_id, action: "delete" })}
                              className="px-3 py-1.5 rounded-full bg-slate-800/60 hover:bg-slate-700/60 text-xs"
                            >
                              删除
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => controlTask.mutate({ taskId: task.task_id, action: task.status === "paused" ? "resume" : "pause" })}
                                className="px-3 py-1.5 rounded-full bg-slate-800/60 hover:bg-slate-700/60 text-xs"
                              >
                                {task.status === "paused" ? "恢复" : "暂停"}
                              </button>
                              <button
                                type="button"
                                onClick={() => controlTask.mutate({ taskId: task.task_id, action: task.status === "stopped" ? "delete" : "stop" })}
                                className="px-3 py-1.5 rounded-full bg-slate-800/60 hover:bg-slate-700/60 text-xs"
                              >
                                {task.status === "stopped" ? "删除" : "停止"}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {sortedTasks.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      暂无回测任务。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Dialog open={isCreating} title="新建回测任务" onClose={() => setIsCreating(false)}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            createBacktest.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm space-y-2">
              数据源
              <select
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.data_id}
                onChange={(e) => setForm((prev) => ({ ...prev, data_id: e.target.value }))}
              >
                {dataOptions.map((option) => (
                  <option key={option.data_id} value={option.data_id}>
                    {option.data_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm space-y-2">
              策略
              <select
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.strategy_id}
                onChange={(e) => {
                  const nextStrategyId = e.target.value;
                  const nextStrategy = strategies.find((item) => item.strategy_id === nextStrategyId);
                  setForm((prev) => ({
                    ...prev,
                    strategy_id: nextStrategyId,
                    strategy_params: buildDefaultStrategyParams(nextStrategy)
                  }));
                }}
              >
                {strategies.map((strategy) => (
                  <option key={strategy.strategy_id} value={strategy.strategy_id}>
                    {strategy.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm space-y-2">
              初始资金
              <input
                type="number"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.initial_capital}
                onChange={(e) => setForm((prev) => ({ ...prev, initial_capital: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              仓位上限
              <input
                type="number"
                step="0.1"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.max_position}
                onChange={(e) => setForm((prev) => ({ ...prev, max_position: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              仓位下限
              <input
                type="number"
                step="0.1"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.min_position}
                onChange={(e) => setForm((prev) => ({ ...prev, min_position: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              Lot Size
              <input
                type="number"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.lot_size}
                onChange={(e) => setForm((prev) => ({ ...prev, lot_size: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              数据频率(秒)
              <input
                type="number"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.data_frequency_seconds}
                onChange={(e) => setForm((prev) => ({ ...prev, data_frequency_seconds: Number(e.target.value) }))}
              />
            </label>
            <label className="text-sm space-y-2">
              信号频率(秒)
              <input
                type="number"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.signal_frequency_seconds}
                onChange={(e) => setForm((prev) => ({ ...prev, signal_frequency_seconds: Number(e.target.value) }))}
              />
            </label>
          </div>
        {activeStrategy && activeStrategy.parameters.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-slate-300">策略参数</h4>
            <div className="grid grid-cols-2 gap-4">
              {activeStrategy.parameters.map((parameter) => {
                const typeLower = parameter.parameter_type.toLowerCase();
                const rawValue =
                  form.strategy_params[parameter.name] ??
                  (typeof parameter.default === "boolean"
                    ? parameter.default
                      ? "true"
                      : "false"
                    : parameter.default !== undefined && parameter.default !== null
                      ? String(parameter.default)
                      : "");
                const value = typeof rawValue === "string" ? rawValue : String(rawValue);
                const min = parameter.minimum ?? undefined;
                const max = parameter.maximum ?? undefined;

                if (typeLower === "bool" || typeLower === "boolean") {
                  return (
                    <label key={parameter.name} className="text-sm space-y-2">
                      <div className="flex items-center justify-between">
                        <span>{parameter.description || parameter.name}</span>
                        <span className="text-xs text-slate-500">{parameter.name}</span>
                      </div>
                      <select
                        className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                        value={value}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            strategy_params: { ...prev.strategy_params, [parameter.name]: e.target.value }
                          }))
                        }
                      >
                        <option value="true">开启</option>
                        <option value="false">关闭</option>
                      </select>
                    </label>
                  );
                }

                const step = typeLower === "int" || typeLower === "integer" ? 1 : "any";

                return (
                  <label key={parameter.name} className="text-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <span>{parameter.description || parameter.name}</span>
                      <span className="text-xs text-slate-500">{parameter.name}</span>
                    </div>
                    <input
                      type="number"
                      className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                      value={value}
                      min={min}
                      max={max}
                      step={step}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          strategy_params: { ...prev.strategy_params, [parameter.name]: e.target.value }
                        }))
                      }
                    />
                    {(min !== undefined || max !== undefined) && (
                      <p className="text-xs text-slate-500">
                        范围：{min !== undefined ? min : "无下限"} ~ {max !== undefined ? max : "无上限"}
                      </p>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}
          <button
            type="submit"
            className="bg-blue-500/80 hover:bg-blue-500 transition px-5 py-2 rounded-full text-sm font-medium"
          >
            提交
          </button>
        </form>
      </Dialog>

      <Dialog
        open={!!selectedTask}
        title={`回测详情 ${selectedTask?.task_id ?? ""}`}
        onClose={() => {
          setSelectedTask(null);
          setSelectedData(null);
        }}
        size="lg"
      >
        {selectedTask && (
          <div className="space-y-6">
            {metricsCards.length > 0 && (
              <div className="stat-card-grid">
                {metricsCards.map((card) => (
                  <div
                    key={card.key}
                    className={`stat-card${card.border ? ` ${card.border === "positive" ? "positive" : "negative"}` : ""}`}
                  >
                    <span className="stat-card-label">{card.label}</span>
                    <span className={`stat-card-value ${card.accent ?? ""}`}>{card.value}</span>
                  </div>
                ))}
            </div>
            )}

            {selectedData && (
              <PriceChart
                data={chartData}
                trades={chartTrades}
              />
            )}

            {selectedData && selectedData.data.length > 1 && (
              <div className="space-y-2">
                <div className="relative h-10">
                  <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-800/80" />
                  <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-blue-500/50" style={sliderHighlightStyle} />
                  <input
                    type="range"
                    min={0}
                    max={sliderMax}
                    value={chartRange.start}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setChartRange((prev) => {
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
                    value={chartRange.end}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setChartRange((prev) => {
                        const clamped = Math.max(prev.start, Math.min(value, sliderMax));
                        return { start: prev.start, end: clamped };
                      });
                    }}
                    className="range-slider absolute inset-0 z-40"
                  />
                </div>
                <div className="flex justify-between text-xs text-slate-400">
                  <span>起点：{chartRange.start + 1}</span>
                  <span>终点：{chartRange.end + 1}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {visibleStartPoint?.timestamp ?? "--"}
                  <span className="mx-1 text-slate-600">→</span>
                  {visibleEndPoint?.timestamp ?? "--"}
                </div>
              </div>
            )}

            <div>
              <h4 className="text-sm uppercase tracking-widest text-slate-400 mb-3">交易日志</h4>
              <div className="trade-log-wrapper">
                <table className="trade-log-table">
                  <thead>
                    <tr>
                      <th>交易时间</th>
                      <th>类型</th>
                      <th>数量</th>
                      <th>成交价</th>
                      <th>持仓</th>
                      <th>账户现金</th>
                      <th>权益</th>
                      <th>资产变化</th>
                      <th>变化比例</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeTimeline.map((trade) => {
                      const actionLabel = trade.action === "buy" ? "买入" : "卖出";
                      const timestampText = new Date(trade.timestamp).toLocaleString();
                      const quantityText = trade.quantity.toFixed(2);
                      const priceText = trade.price.toFixed(2);
                      const positionText = trade.position.toFixed(2);
                      const cashText = tradeNumberFormatter.format(trade.cash);
                      const equityText = tradeNumberFormatter.format(trade.value);
                      const changeText = `${trade.change >= 0 ? "+" : "-"}${tradeNumberFormatter.format(Math.abs(trade.change))}`;
                      const changePctText = `${trade.changePct >= 0 ? "+" : "-"}${(Math.abs(trade.changePct) * 100).toFixed(2)}%`;

                      return (
                        <tr key={`${trade.timestamp}-${trade.action}-${trade.quantity}`}>
                          <td>{timestampText}</td>
                          <td className={trade.action === "buy" ? "text-rose-300 font-medium" : "text-emerald-300 font-medium"}>{actionLabel}</td>
                          <td>{quantityText}</td>
                          <td>{priceText}</td>
                          <td>{positionText}</td>
                          <td>{cashText}</td>
                          <td>{equityText}</td>
                          <td className={trade.change >= 0 ? "text-rose-300" : "text-emerald-300"}>{changeText}</td>
                          <td className={trade.changePct >= 0 ? "text-rose-200" : "text-emerald-300"}>{changePctText}</td>
                        </tr>
                      );
                    })}
                    {tradeTimeline.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-6 text-center text-slate-500">
                          暂无交易记录。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                  </div>
              {/* keep legacy fallback */}
              <div className="sr-only">
                {tradeTimeline.map((trade) => {
                  return <div key={`${trade.timestamp}-${trade.action}-${trade.quantity}`}>{trade.timestamp}</div>;
                })}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

