import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { Dialog } from "../components/Dialog";
import { StatusBadge } from "../components/StatusBadge";
import { PriceChart } from "../components/PriceChart";

interface QuantTask {
  task_id: string;
  status: string;
  config: Record<string, any>;
  message?: string;
  logs?: Array<{ timestamp: string; action: string; price: number; quantity: number; realized_pnl: number }>;
  price_series?: Array<{ timestamp: string; price: number }>;
}

interface Strategy {
  strategy_id: string;
  name: string;
}

const sessions = ["美股盘前", "美股盘中", "美股盘后", "美股夜盘", "港股盘中", "港股夜盘"];
const timeframeOptions = [
  { label: "1分钟", value: 1 },
  { label: "10分钟", value: 10 },
  { label: "30分钟", value: 30 },
  { label: "1小时", value: 60 }
];

export function QuantTradingPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [selectedTask, setSelectedTask] = useState<QuantTask | null>(null);
  const [timeframe, setTimeframe] = useState(10);
  const client = useQueryClient();

  const [form, setForm] = useState({
    strategy_id: "",
    symbol: "AAPL.US",
    session: sessions[1],
    account_mode: "paper",
    interval_seconds: 30,
    lot_size: 1,
    strategy_params: {}
  });

  const tasksQuery = useQuery({
    queryKey: ["quantTasks"],
    queryFn: async () => {
      const { data } = await api.get<QuantTask[]>("/quant/tasks");
      return data;
    },
    refetchInterval: 10000
  });

  const strategiesQuery = useQuery({
    queryKey: ["strategies"],
    queryFn: async () => {
      const { data } = await api.get<Strategy[]>("/strategies");
      return data;
    }
  });

  const createTask = useMutation({
    mutationFn: async () => {
      await api.post("/quant/tasks", form);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["quantTasks"] });
      setIsCreating(false);
    }
  });

  const controlTask = useMutation({
    mutationFn: async ({ taskId, action }: { taskId: string; action: "pause" | "resume" | "stop" | "delete" }) => {
      if (action === "delete") {
        await api.delete(`/quant/tasks/${taskId}`);
      } else {
        await api.post(`/quant/tasks/${taskId}/${action}`);
      }
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["quantTasks"] });
    }
  });

  const detailTask = useMutation({
    mutationFn: async (taskId: string) => {
      const { data } = await api.get<QuantTask>(`/quant/tasks/${taskId}`);
      setSelectedTask(data);
    }
  });

  const tasks = tasksQuery.data ?? [];
  const strategies = strategiesQuery.data ?? [];

  useEffect(() => {
    if (!form.strategy_id && strategies.length > 0) {
      setForm((prev) => ({ ...prev, strategy_id: strategies[0].strategy_id }));
    }
  }, [form.strategy_id, strategies]);

  const filteredSeries = selectedTask?.price_series
    ? selectedTask.price_series.filter((point) => {
        const cutoff = Date.now() - timeframe * 60 * 1000;
        return new Date(point.timestamp).getTime() >= cutoff;
      })
    : [];

  return (
    <div className="space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-semibold">量化交易</h2>
          <p className="text-slate-400 mt-2">连接纸上或实盘账户执行策略，实时监控指标与交易日志。</p>
        </div>
        <button
          type="button"
          className="bg-blue-500/80 hover:bg-blue-500 transition px-5 py-2 rounded-full text-sm font-medium"
          onClick={() => setIsCreating(true)}
        >
          新建量化任务
        </button>
      </header>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {tasks.map((task) => (
          <div key={task.task_id} className="glass-panel p-7 rounded-3xl border border-white/5 card-hover space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">任务 {task.task_id}</h3>
                <p className="text-sm text-slate-400">股票：{String(task.config.symbol)}</p>
              </div>
              <StatusBadge status={task.status} />
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm text-slate-300">
              <div>可用资金：<span className="text-red-300 font-medium">{Number(task.config.cash ?? 0).toFixed(2)}</span></div>
              <div>仓位：<span className="text-red-300 font-medium">{Number(task.config.position ?? 0).toFixed(2)}</span></div>
              <div>市值：<span className="text-red-300 font-medium">{Number(task.config.market_value ?? 0).toFixed(2)}</span></div>
              <div>已实现盈亏：<span className="text-green-300 font-medium">{Number(task.config.realized_pnl ?? 0).toFixed(2)}</span></div>
            </div>
            {task.message && <p className="text-sm text-green-300">{task.message}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => controlTask.mutate({ taskId: task.task_id, action: task.status === "paused" ? "resume" : "pause" })}
                className="px-4 py-2 rounded-full bg-slate-800/60 hover:bg-slate-700/60 text-sm"
              >
                {task.status === "paused" ? "恢复" : "暂停"}
              </button>
              <button
                type="button"
                onClick={() => controlTask.mutate({ taskId: task.task_id, action: task.status === "stopped" ? "delete" : "stop" })}
                className="px-4 py-2 rounded-full bg-slate-800/60 hover:bg-slate-700/60 text-sm"
              >
                {task.status === "stopped" ? "删除" : "停止"}
              </button>
              <button
                type="button"
                onClick={() => detailTask.mutate(task.task_id)}
                className="px-4 py-2 rounded-full bg-blue-500/20 hover:bg-blue-500/40 text-sm text-blue-200"
              >
                查看详情
              </button>
            </div>
          </div>
        ))}
        {tasks.length === 0 && <div className="text-slate-500">暂无量化任务。</div>}
      </section>

      <Dialog open={isCreating} title="创建量化任务" onClose={() => setIsCreating(false)}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            createTask.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm space-y-2">
              策略
              <select
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.strategy_id}
                onChange={(e) => setForm((prev) => ({ ...prev, strategy_id: e.target.value }))}
              >
                {strategies.map((strategy) => (
                  <option key={strategy.strategy_id} value={strategy.strategy_id}>
                    {strategy.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm space-y-2">
              股票代码
              <input
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.symbol}
                onChange={(e) => setForm((prev) => ({ ...prev, symbol: e.target.value }))}
              />
            </label>
            <label className="text-sm space-y-2">
              交易时段
              <select
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.session}
                onChange={(e) => setForm((prev) => ({ ...prev, session: e.target.value }))}
              >
                {sessions.map((session) => (
                  <option key={session} value={session}>
                    {session}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm space-y-2">
              账号模式
              <select
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.account_mode}
                onChange={(e) => setForm((prev) => ({ ...prev, account_mode: e.target.value }))}
              >
                <option value="paper">纸上账户</option>
                <option value="live">实盘账户</option>
              </select>
            </label>
            <label className="text-sm space-y-2">
              信号间隔(秒)
              <input
                type="number"
                className="w-full rounded-xl bg-slate-900/60 border border-white/10 px-3 py-2"
                value={form.interval_seconds}
                onChange={(e) => setForm((prev) => ({ ...prev, interval_seconds: Number(e.target.value) }))}
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
          </div>
          <button
            type="submit"
            className="bg-blue-500/80 hover:bg-blue-500 transition px-5 py-2 rounded-full text-sm font-medium"
          >
            创建
          </button>
        </form>
      </Dialog>

      <Dialog open={!!selectedTask} title={`量化详情 ${selectedTask?.task_id ?? ""}`} onClose={() => setSelectedTask(null)}>
        {selectedTask && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4 text-sm text-slate-300">
              <div>现金：<span className="text-red-300 font-medium">{Number(selectedTask.config.cash ?? 0).toFixed(2)}</span></div>
              <div>仓位：<span className="text-red-300 font-medium">{Number(selectedTask.config.position ?? 0).toFixed(2)}</span></div>
              <div>权益：<span className="text-red-300 font-medium">{Number(selectedTask.config.equity ?? 0).toFixed(2)}</span></div>
              <div>市值：{Number(selectedTask.config.market_value ?? 0).toFixed(2)}</div>
              <div>已实现盈亏：<span className="text-green-300 font-medium">{Number(selectedTask.config.realized_pnl ?? 0).toFixed(2)}</span></div>
              <div>信号间隔：{selectedTask.config.interval_seconds ?? form.interval_seconds} 秒</div>
            </div>

            <div className="flex items-center justify-between">
              <h4 className="text-sm uppercase tracking-widest text-slate-400">实时行情</h4>
              <div className="flex gap-2">
                {timeframeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTimeframe(option.value)}
                    className={`px-3 py-1 rounded-full text-xs ${
                      timeframe === option.value ? "bg-blue-500/60 text-white" : "bg-slate-800/60 text-slate-300"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <PriceChart
              data={(filteredSeries.length > 0 ? filteredSeries : selectedTask.price_series ?? []).map((point) => ({
                timestamp: point.timestamp,
                price: Number(point.price)
              }))}
              trades={
                selectedTask.logs?.map((log) => ({
                  timestamp: log.timestamp,
                  price: log.price,
                  action: log.action === "buy" ? "buy" : "sell"
                })) ?? []
              }
            />

            <div>
              <h4 className="text-sm uppercase tracking-widest text-slate-400 mb-3">交易日志</h4>
              <div className="max-h-64 overflow-y-auto space-y-2 text-sm">
                {selectedTask.logs?.map((log) => (
                  <div key={`${log.timestamp}-${log.action}`} className="bg-slate-900/60 px-4 py-2 rounded-xl border border-white/5 flex justify-between">
                    <span className={log.action === "buy" ? "text-red-300" : "text-green-300"}>
                      {log.action === "buy" ? "买入" : "卖出"} · {log.quantity.toFixed(2)}
                    </span>
                    <span>{log.price.toFixed(2)}</span>
                    <span className="text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                ))}
                {(!selectedTask.logs || selectedTask.logs.length === 0) && <div className="text-slate-500">暂无交易。</div>}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

