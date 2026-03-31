import React from 'react';

const Maintenance: React.FC = () => {
  return (
    <div className="min-h-screen text-white flex items-center justify-center px-4 py-12 relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-70"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.8)), url('https://images.pexels.com/photos/1752757/pexels-photo-1752757.jpeg?_gl=1*1knldoz*_ga*NjExODU1ODY1LjE3NTY1NzI5MjI.*_ga_8JE65Q40S6*czE3Njk4NzQ2NzEkbzMkZzEkdDE3Njk4NzQ5NjEkajIxJGwwJGgw')",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,14,14,0.9),_transparent_45%)]" />
      <div className="relative max-w-3xl w-full border border-white/10 rounded-[32px] bg-black/40 backdrop-blur-2xl shadow-[0_30px_60px_rgba(0,0,0,0.45)] p-10 space-y-6">
        <p className="text-sm uppercase tracking-[0.5em] text-brand-lime">loading the new circuit</p>
        <h1 className="text-4xl md:text-5xl font-sports font-bold tracking-tight text-white">
          Courtsight is crafting the next-level arena.
        </h1>
        <p className="text-base text-gray-300 leading-relaxed">
          We are rebuilding the playsheet, amplifying the stats, and staging a premiere home for your rosters and rivalries.
          Stay tuned—this blackout is just the prelude to a bigger, faster, louder Courtsight rollout.
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            { title: 'Refined Stats', copy: 'Instant, live-safe, curated dashboards so every lineup feels premium.' },
            { title: 'Roster Rebuild', copy: 'Next-level team builder with season-aware workflows.' },
            { title: 'Legacy Data', copy: 'Imported schedules, photos, and wins from every era.' },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm space-y-1"
            >
              <h3 className="text-xs uppercase tracking-[0.3em] text-white/60">{card.title}</h3>
              <p className="text-sm text-gray-300">{card.copy}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4 text-sm text-gray-400">
          <p>
            Need intel? Drop a shout to the crew or email <span className="text-brand-lime">admin@courtsight.ca</span>—we're logging every play you want to see at tip-off.
          </p>
          <p className="text-[13px] text-gray-500">Estimated lift-off: very soon. Thanks for riding the hype while we finish the court.</p>
        </div>
      </div>
    </div>
  );
};

export default Maintenance;
