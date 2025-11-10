interface StatusBadgeProps {
  status: string;
}

const statusMap: Record<
  string,
  { label: string; className: string }
> = {
  waiting: { label: "等待中", className: "bg-indigo-500/20 text-indigo-200" },
  running: { label: "运行中", className: "bg-emerald-500/20 text-emerald-300" },
  paused: { label: "已暂停", className: "bg-amber-500/20 text-amber-300" },
  stopped: { label: "已停止", className: "bg-slate-500/20 text-slate-200" },
  completed: { label: "已完成", className: "bg-blue-500/20 text-blue-200" },
  failed: { label: "失败", className: "bg-green-500/20 text-green-200" }
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = status.toLowerCase();
  const entry = statusMap[normalized] ?? statusMap.stopped;
  return <span className={`status-chip ${entry.className}`}>{entry.label}</span>;
}

