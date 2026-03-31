import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { supabaseAdmin } from '../services/supabaseAdminClient';
import { getStoredUser } from '../services/authService';
import { Role } from '../types';
import LoadingOverlay from '../components/LoadingOverlay';
import { AlertTriangle, Search, RefreshCw, ExternalLink } from 'lucide-react';

type PaymentStatus = 'paid' | 'pending' | 'pending-stripe' | 'unknown';

type UnpaidRow = {
  playerId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  paymentStatus: PaymentStatus | 'none';
  teamId: string | null;
  teamName: string;
  seasonName: string;
};

const UnpaidPlayers: React.FC = () => {
  const navigate = useNavigate();
  const user = useMemo(() => getStoredUser(), []);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<UnpaidRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PaymentStatus>('all');

  const isAdmin = user && (
    user.role === Role.ADMIN_FULL ||
    user.role === Role.ADMIN_MEDIA ||
    user.role === Role.ADMIN_SCOREKEEPER ||
    user.role === Role.ADMIN_COMMISSIONER
  );

  const normalizeStatus = (val: any): PaymentStatus | 'none' => {
    if (!val) return 'pending';
    const lower = String(val).toLowerCase();
    if (lower.includes('paid')) return 'paid';
    if (lower.includes('stripe')) return 'pending-stripe';
    if (lower.includes('pending')) return 'pending';
    return 'unknown';
  };

  useEffect(() => {
    const load = async () => {
      if (!isAdmin) {
        setError('Admins only.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // Profiles (anon, fallback to admin)
        let profiles: any[] = [];
        try {
          const { data } = await supabase.from('profiles').select('user_id,display_name,email,phone,payment_status');
          profiles = data || [];
        } catch (err) {
          if (supabaseAdmin) {
            const { data } = await supabaseAdmin.from('profiles').select('user_id,display_name,email,phone,payment_status');
            profiles = data || [];
          }
        }

        const profileMap = new Map<string, any>();
        (profiles || []).forEach((p: any) => {
          profileMap.set(p.user_id, p);
        });

        // Teams/Seasons maps (for names)
        const teamsMap: Record<string, string> = {};
        const seasonsMap: Record<string, string> = {};
        try {
          const { data: tdata } = await supabase.from('teams').select('id,name');
          (tdata || []).forEach((t: any) => (teamsMap[t.id] = t.name));
        } catch {
          if (supabaseAdmin) {
            const { data: tdata } = await supabaseAdmin.from('teams').select('id,name');
            (tdata || []).forEach((t: any) => (teamsMap[t.id] = t.name));
          }
        }
        try {
          const { data: sdata } = await supabase.from('seasons').select('id,name,year');
          (sdata || []).forEach((s: any) => (seasonsMap[s.id] = s.name || (s.year ? `Season ${s.year}` : 'Season')));
        } catch {
          if (supabaseAdmin) {
            const { data: sdata } = await supabaseAdmin.from('seasons').select('id,name,year');
            (sdata || []).forEach((s: any) => (seasonsMap[s.id] = s.name || (s.year ? `Season ${s.year}` : 'Season')));
          }
        }

        // Players (anon, fallback admin)
        let players: any[] = [];
        try {
          const { data } = await supabase
            .from('players')
            .select('id,first_name,last_name,team_id,season_id,user_id,payment_status')
            .order('created_at', { ascending: false });
          players = data || [];
        } catch (err) {
          if (supabaseAdmin) {
            const { data } = await supabaseAdmin
              .from('players')
              .select('id,first_name,last_name,team_id,season_id,user_id,payment_status')
              .order('created_at', { ascending: false });
            players = data || [];
          }
        }

        const unpaid: UnpaidRow[] = [];
        (players || []).forEach((p: any) => {
          const profile = p.user_id ? profileMap.get(p.user_id) : null;
          if (!profile?.email) return; // only show registered users with email
          const status: PaymentStatus | 'none' = normalizeStatus(
            profile?.payment_status || p.payment_status || 'pending'
          );
          if (status === 'paid') return;
          const seasonLabel = seasonsMap[p.season_id] || 'Season';
          const teamName = teamsMap[p.team_id] || 'No Team';
          unpaid.push({
            playerId: p.id || null,
            name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Player',
            email: profile?.email || null,
            phone: profile?.phone || null,
            paymentStatus: status,
            teamId: p.team_id || null,
            teamName,
            seasonName: seasonLabel,
          });
        });

        setRows(unpaid);
      } catch (err: any) {
        console.error('unpaid load error', err);
        setError(err?.message || 'Failed to load unpaid players.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAdmin]);

  const filtered = rows.filter((r) => {
    const q = query.toLowerCase();
    const matchQuery =
      !q ||
      r.name.toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (r.teamName || '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || r.paymentStatus === statusFilter;
    return matchQuery && matchStatus;
  });

  const statusClass = (status: PaymentStatus | 'none') => {
    if (status === 'pending-stripe') {
      return 'border-blue-400/60 text-blue-100 bg-blue-500/15';
    }
    if (status === 'pending') {
      return 'border-amber-300/70 text-amber-100 bg-amber-500/10';
    }
    return 'border-gray-500/60 text-gray-300 bg-white/5';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
        <LoadingOverlay message="Loading unpaid players..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 flex items-center justify-center">
        <div className="text-white text-xl font-sports">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-black pt-8 pb-12 px-4">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500/15 via-yellow-400/10 to-transparent border border-amber-400/30 rounded-2xl p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between shadow-lg shadow-amber-500/10">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0">
              <AlertTriangle className="text-amber-200" size={18} />
            </div>
            <div>
              <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.2em] text-amber-200/80 font-semibold">Admin</p>
              <h1 className="text-2xl sm:text-3xl font-sports text-white uppercase leading-tight">Unpaid Players</h1>
              <p className="text-xs sm:text-sm text-amber-100/70 mt-1">Review players with pending or unverified payments.</p>
            </div>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/10 border border-white/15 text-white text-xs uppercase tracking-wide hover:border-amber-300 hover:text-amber-200 transition"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="bg-brand-dark border border-white/10 rounded-2xl p-5 shadow-lg shadow-black/40">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div className="flex items-center gap-2 bg-black/60 border border-white/10 rounded-xl px-3 py-2.5 focus-within:border-amber-300/60 transition">
              <Search size={16} className="text-gray-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, or team"
                className="bg-transparent text-white w-full outline-none text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase text-brand-grey font-bold mb-1 tracking-widest">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full bg-black border border-white/15 rounded-xl px-3 py-2.5 text-white focus:border-amber-300/70 transition"
              >
                <option value="all">All unpaid</option>
                <option value="pending">Pending (Pay Later)</option>
                <option value="pending-stripe">Pending (Stripe)</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div className="text-xs text-gray-400 flex items-center justify-end md:justify-start">
              Showing {filtered.length} of {rows.length} players with unpaid status.
            </div>
          </div>
        </div>

        {/* Mobile Cards */}
        <div className="space-y-3 md:hidden">
          {!filtered.length && (
            <div className="bg-brand-dark border border-white/10 rounded-xl p-6 text-center text-gray-500 text-sm">
              No unpaid players found.
            </div>
          )}
          {filtered.map((r) => (
            <div key={`${r.playerId}-${r.email || r.name}`} className="bg-brand-dark border border-white/10 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {r.playerId ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/player/${r.playerId}`)}
                      className="text-white font-semibold hover:text-brand-lime transition-colors"
                    >
                      {r.name || 'Player'}
                    </button>
                  ) : (
                    <div className="text-white font-semibold">{r.name || 'Player'}</div>
                  )}
                  <div className="text-xs text-gray-400">
                    {r.teamId && r.teamName ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/team/${r.teamId}`)}
                        className="hover:text-brand-lime transition-colors"
                      >
                        {r.teamName}
                      </button>
                    ) : (
                      r.teamName || '-'
                    )}{' '}
                    • {r.seasonName || '-'}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-[11px] px-3 py-1 rounded-full border whitespace-nowrap shadow-sm ${statusClass(r.paymentStatus)}`}
                >
                  {r.paymentStatus}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase text-brand-grey font-bold">Email</div>
                  <div className="text-gray-300 break-all">{r.email || '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-brand-grey font-bold">Phone</div>
                  <div className="text-gray-300">{r.phone || '-'}</div>
                </div>
              </div>
              <div className="mt-3">
                {r.playerId ? (
                  <button
                    onClick={() => navigate(`/admin/player/${r.playerId}`)}
                    className="w-full text-[11px] px-3 py-2 rounded-lg border border-white/15 text-gray-200 hover:border-amber-300 hover:text-amber-200 inline-flex items-center justify-center gap-1 transition"
                  >
                    Open <ExternalLink size={12} />
                  </button>
                ) : (
                  <span className="text-[11px] text-gray-500">No player record</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="hidden md:block overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-brand-dark to-black/80 shadow-2xl shadow-black/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-gray-300 uppercase text-[11px] font-bold tracking-wide">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Team</th>
                <th className="px-5 py-3">Season</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Phone</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white">
              {filtered.map((r) => (
                <tr key={`${r.playerId}-${r.email || r.name}`} className="hover:bg-white/5 transition">
                  <td className="px-5 py-3 font-semibold">
                    {r.playerId ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/player/${r.playerId}`)}
                        className="hover:text-brand-lime transition-colors"
                      >
                        {r.name || 'Player'}
                      </button>
                    ) : (
                      r.name || 'Player'
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-300">
                    {r.teamId && r.teamName ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/team/${r.teamId}`)}
                        className="hover:text-brand-lime transition-colors"
                      >
                        {r.teamName}
                      </button>
                    ) : (
                      r.teamName || '-'
                    )}
                  </td>
                  <td className="px-5 py-3 text-gray-300">{r.seasonName || '-'}</td>
                  <td className="px-5 py-3 text-gray-300">{r.email || '-'}</td>
                  <td className="px-5 py-3 text-gray-300">{r.phone || '-'}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-block text-[11px] px-3 py-1 rounded-full border whitespace-nowrap shadow-sm ${statusClass(r.paymentStatus)}`}
                    >
                      {r.paymentStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {r.playerId ? (
                      <button
                        onClick={() => navigate(`/admin/player/${r.playerId}`)}
                        className="text-[11px] px-3 py-1.5 rounded-lg border border-white/15 text-gray-200 hover:border-amber-300 hover:text-amber-200 inline-flex items-center gap-1 transition"
                      >
                        Open <ExternalLink size={12} />
                      </button>
                    ) : (
                      <span className="text-[11px] text-gray-500">No player record</span>
                    )}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-gray-500">
                    No unpaid players found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default UnpaidPlayers;
