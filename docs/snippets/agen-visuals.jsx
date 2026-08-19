export const DiagramFrame = ({ children, caption, tone = 'cyan' }) => {
  const tones = {
    cyan: 'from-cyan-500/15 via-slate-950 to-slate-950 ring-cyan-300/20',
    amber: 'from-amber-500/15 via-slate-950 to-slate-950 ring-amber-300/20',
    green: 'from-emerald-500/15 via-slate-950 to-slate-950 ring-emerald-300/20',
  };

  return (
    <figure className={`not-prose my-8 rounded-3xl bg-gradient-to-br ${tones[tone] ?? tones.cyan} p-4 ring-1`}>
      <div className="overflow-hidden rounded-2xl">{children}</div>
      {caption ? <figcaption className="mt-3 text-sm text-slate-300">{caption}</figcaption> : null}
    </figure>
  );
};

export const SignalPath = ({ title, steps = [] }) => {
  return (
    <div className="not-prose my-6 rounded-3xl bg-slate-950 p-5 text-slate-100 ring-1 ring-slate-700/70">
      <div className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200">{title}</div>
      <div className="grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <div key={`${step.title}-${index}`} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-cyan-100 text-sm font-bold text-slate-950">
              {index + 1}
            </div>
            <div className="text-base font-semibold text-white">{step.title}</div>
            {step.description ? <div className="mt-2 text-sm text-slate-300">{step.description}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
};

export const ModeBadge = ({ mode }) => {
  const styles = {
    monitor: 'bg-cyan-100 text-cyan-950 ring-cyan-300/60',
    audit: 'bg-amber-100 text-amber-950 ring-amber-300/60',
    enforce: 'bg-emerald-100 text-emerald-950 ring-emerald-300/60',
  };

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${styles[mode] ?? styles.monitor}`}>
      {mode}
    </span>
  );
};
