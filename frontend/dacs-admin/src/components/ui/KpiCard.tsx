/*
 * Mockup KPI card: big number on top, label underneath. The number is a
 * hero figure, not a chart (dataviz: a single value wants a stat tile).
 */
export function KpiCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-dacs-card bg-white px-6 py-8 shadow-dacs-card">
      <p className="text-5xl font-bold tracking-tight">{value}</p>
      <p className="text-center font-semibold">{label}</p>
    </div>
  );
}
