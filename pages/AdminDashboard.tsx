
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { getCurrentUser } from '../services/authService';
import { supabase } from '../services/supabaseClient';
import { User, Role, Game, Team, Season, PlayerGameStats, NewsItem, RosterPlayer } from '../types';
import { GAMES, TEAMS, SEASONS, MOCK_ROSTERS, DEFAULT_PLAYER_AVATAR } from '../constants';
import {
  LayoutDashboard,
  Calendar,
  Users,
  FileText,
  Image as ImageIcon,
  Layers,
  ShieldAlert,
  Save,
  Edit2,
  Trash2,
  CheckCircle,
  Plus,
  Trophy,
  Video,
  MapPin,
  ArrowLeft,
  ChevronDown,
  Upload,
  X,
  CreditCard,
  CheckSquare,
  Square,
  UserCog,
  Crown,
  Camera,
  AlertTriangle,
  Lock,
  LockOpen,
  Award,
  Quote,
  GitMerge,
  Copy,
  Shirt,
  Download,
  Search,
  RefreshCw
} from 'lucide-react';
import Cropper, { type Area } from 'react-easy-crop';
import UnpaidPlayers from './UnpaidPlayers';
import PlayerManagement from './PlayerManagement';
import { supabaseAdmin } from '../services/supabaseAdminClient';
import { createAdminUserViaServer } from '../services/adminUserApi';
import { createNotifications } from '../services/notificationService';
import { normalizeJerseyNumberInput } from '../utils/jerseyNumber';
import { buildPlayerPortalUrl, sendPlayerClaimEmail } from '../services/playerClaimEmailService';
import { parseJerseyNumberValue } from '../utils/jerseyNumber';
import {
  buildScheduleDateTimeIso,
  formatDisplayTime,
  getScheduleDateTimeParts,
  getScheduleTimestamp,
} from '../utils/time';
import RegistrationCapacityManager from '../components/RegistrationCapacityManager';
import RegistrationWaiverManager from '../components/RegistrationWaiverManager';
import AboutContentManager from '../components/AboutContentManager';
import TestimonialsManager from '../components/TestimonialsManager';
import FaqContentManager from '../components/FaqContentManager';
import JSZip from 'jszip';
import {
  getDefaultRegistrationEmailTemplates,
  REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS,
  REGISTRATION_EMAIL_TEMPLATE_KEYS,
  REGISTRATION_EMAIL_TEMPLATE_KEYS_FOR_LOAD,
  REGISTRATION_EMAIL_TEMPLATE_TOKENS,
  renderRegistrationTemplateString,
  type RegistrationEmailStage,
} from '../services/registrationEmailTemplates';
import {
  getDefaultStripePaymentLinks,
  resolveStripePaymentLinks,
  STRIPE_PAYMENT_LINK_KEYS_FOR_LOAD,
  STRIPE_PAYMENT_LINK_SETTING_KEYS,
  type StripePaymentLinks,
} from '../services/stripePaymentLinks';
import {
  BADGE_SETTINGS_SITE_KEY,
  getDefaultBadgeSettings,
  normalizeBadgeSettings,
  parseBadgeSettingsValue,
  serializeBadgeSettings,
  type BadgeSettings,
  type TrophyTierName,
} from '../services/badgeSettings';
import {
  loadTeamMergeMetadata,
  resolveTeamMergeRootId,
  saveTeamMergeMetadata,
  type TeamMergeMetadataMap,
} from '../services/teamMergeMetadata';
import {
  loadJerseyManagementSettings,
  saveJerseyManagementSettings,
  upsertTeamJerseyWorkflow,
  type JerseyDesignStatus,
  type JerseyTeamWorkflow,
} from '../services/jerseyManagement';
import { sortSeasonsNewestFirst } from '../utils/seasonOrdering';

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const getAdminInviteRedirectUrl = () => {
  const configured = (import.meta.env.VITE_SITE_URL || '').trim();
  if (configured) {
    return `${configured.replace(/\/+$/, '')}/auth/callback`;
  }
  if (typeof window === 'undefined') {
    return '/auth/callback';
  }
  return `${window.location.origin.replace(/\/+$/, '')}/auth/callback`;
};

const inviteAdminUserByEmail = async (
  email: string
): Promise<{ userId: string | null; error?: string }> => {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { userId: null, error: 'Missing email.' };
  }
  if (!supabaseAdmin) {
    return { userId: null, error: 'Missing admin service key for invites.' };
  }

  try {
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      normalized,
      {
        redirectTo: getAdminInviteRedirectUrl(),
      }
    );
    if (error) {
      return { userId: null, error: error.message };
    }
    return { userId: data?.user?.id ?? null };
  } catch (err: any) {
    return { userId: null, error: err?.message || 'Invite failed.' };
  }
};

// --- COMPONENT: USER MANAGER ---
const UserManager: React.FC<{ currentUser: User | null }> = ({ currentUser }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [source, setSource] = useState<'live' | 'empty' | 'error'>('live');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newAdmin, setNewAdmin] = useState<{ email: string; displayName: string; role: Role }>({
    email: '',
    displayName: '',
    role: Role.ADMIN_SCOREKEEPER,
  });
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [tempPasswordEmail, setTempPasswordEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'info'; text: string } | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from('admin_users')
        .select('id, email, display_name, role')
        .order('display_name', { ascending: true });

      if (err) throw err;
      if (!data || data.length === 0) {
        setUsers([]);
        setSource('empty');
        setError('No admin users found. Add records to admin_users.');
        return;
      }

      const mapped: User[] = data.map((row: any) => ({
        id: row.id,
        email: row.email,
        name: row.display_name || row.email.split('@')[0],
        role: row.role as Role,
      }));

      setUsers(mapped);
      setSource('live');
      setError(null);
    } catch (err: any) {
      console.error('Load admin users error', err);
      setUsers([]);
      setSource('error');
      setError('Unable to load admin users from Supabase.');
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleRoleChange = async (userId: string, newRole: Role) => {
    const target = users.find(u => u.id === userId);
    if (currentUser && target && target.email.toLowerCase() === currentUser.email.toLowerCase()) {
      setError('Cannot change your own role.');
      return;
    }

    const previous = users;
    setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
    try {
      const { error: err } = await supabase
        .from('admin_users')
        .update({ role: newRole })
        .eq('id', userId);
      if (err) {
        throw err;
      }
    } catch (err) {
      console.error('Update role error', err);
      setUsers(previous);
      setError('Failed to update role (reverted).');
    }
  };

  const handleCreateAdmin = async () => {
    if (!currentUser || currentUser.role !== Role.ADMIN_FULL) {
      setError('Only Full Admins can add new admin users.');
      return;
    }
    const normalizedEmail = normalizeEmail(newAdmin.email);
    if (!normalizedEmail) {
      setError('Email is required.');
      return;
    }
    setTempPassword(null);
    setTempPasswordEmail(null);
    setAdding(true);
    try {
      const displayName = newAdmin.displayName.trim() || normalizedEmail;
      const created = await createAdminUserViaServer({
        email: normalizedEmail,
        displayName,
        role: newAdmin.role,
      });

      setTempPassword(created.tempPassword || null);
      setTempPasswordEmail(created.email || normalizedEmail);
      setMessage({
        type: 'success',
        text: created.message || `A confirmation email with the invite link has been sent to ${created.email || normalizedEmail}.`,
      });

      setNewAdmin({ email: '', displayName: '', role: Role.ADMIN_SCOREKEEPER });
      await loadUsers();
      setError(null);
    } catch (err: any) {
      console.error('Create admin user error', err);
      setError(err?.message || 'Failed to add admin user.');
    } finally {
      setAdding(false);
    }
  };

  const getRoleBadgeColor = (role: Role) => {
    switch(role) {
      case Role.ADMIN_FULL: return 'bg-brand-red text-white';
      case Role.ADMIN_COMMISSIONER: return 'bg-blue-600 text-white';
      case Role.ADMIN_SCOREKEEPER: return 'bg-yellow-600 text-white';
      case Role.ADMIN_MEDIA: return 'bg-purple-600 text-white';
      default: return 'bg-gray-700 text-gray-300';
    }
  };

  return (
    <div className="animate-fadeIn">
      <div className="flex justify-between items-center mb-6">
        <h2 className="font-sports text-2xl text-white uppercase">User Management</h2>
        {error && <span className="text-xs text-brand-red font-mono">{error}</span>}
      </div>

      {currentUser?.role === Role.ADMIN_FULL && (
        <div className="bg-brand-dark border border-white/10 rounded-lg p-4 mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-bold text-sm uppercase">Add Admin User</h3>
            {adding && <span className="text-xs text-gray-400">Saving…</span>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="text"
              placeholder="Display Name"
              className="bg-black border border-white/15 rounded px-3 py-2 text-sm text-white focus:border-brand-lime outline-none"
              value={newAdmin.displayName}
              onChange={(e) => setNewAdmin({ ...newAdmin, displayName: e.target.value })}
            />
            <input
              type="email"
              placeholder="email@courtsight.com"
              className="bg-black border border-white/15 rounded px-3 py-2 text-sm text-white focus:border-brand-lime outline-none"
              value={newAdmin.email}
              onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })}
            />
            <select
              className="bg-black border border-white/15 rounded px-3 py-2 text-sm text-white focus:border-brand-lime outline-none"
              value={newAdmin.role}
              onChange={(e) => setNewAdmin({ ...newAdmin, role: e.target.value as Role })}
            >
              <option value={Role.ADMIN_FULL}>Full Admin</option>
              <option value={Role.ADMIN_COMMISSIONER}>Commissioner (Schedule)</option>
              <option value={Role.ADMIN_SCOREKEEPER}>Scorekeeper (Stats)</option>
              <option value={Role.ADMIN_MEDIA}>Media Uploader</option>
            </select>
            <button
              onClick={handleCreateAdmin}
              disabled={adding}
              className="bg-brand-lime text-black font-bold rounded px-4 py-2 text-sm hover:bg-lime-300 disabled:opacity-60"
            >
              Add Admin
            </button>
        </div>
      </div>
    )}

    {message && (
      <div
        className={`border-l-4 px-4 py-3 mt-4 rounded-r-xl text-sm ${
          message.type === 'success'
            ? 'border-brand-lime bg-brand-lime/10 text-brand-lime'
            : 'border-white/30 bg-white/5 text-gray-100'
        }`}
      >
        {message.text}
      </div>
    )}

    {(tempPassword && tempPasswordEmail) && (
      <div className="bg-gradient-to-r from-brand-dark via-black to-black border border-white/10 rounded-xl p-4 mt-4 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-xs uppercase text-gray-400 tracking-[0.3em] mb-1">Temporary password</p>
            <div className="text-sm text-white font-semibold">Ready to share</div>
          </div>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(tempPassword);
              } catch {}
            }}
            className="text-[11px] uppercase text-brand-lime font-bold tracking-wider"
          >
            Copy
          </button>
        </div>
        <div className="bg-black/70 border border-white/10 rounded px-3 py-2 text-xs font-mono text-brand-lime">
          {tempPassword}
        </div>
        <p className="text-xs text-gray-300 mt-3">
          Delivered securely and valid until the new admin changes it. The invite email has also been sent to{' '}
          <strong>{tempPasswordEmail}</strong>.
        </p>
      </div>
    )}
      
      <div className="space-y-3 md:hidden">
        {users.length === 0 && (
          <div className="bg-brand-dark border border-white/10 rounded-lg p-4 text-sm text-gray-400">
            No admin users found.
          </div>
        )}
        {users.map((u) => (
          <div key={u.id} className="bg-brand-dark border border-white/10 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-white font-bold">{u.name}</div>
                <div className="text-xs text-gray-400 font-mono break-all">{u.email}</div>
              </div>
              <span className={`shrink-0 px-2 py-1 rounded text-xs font-bold uppercase ${getRoleBadgeColor(u.role)}`}>
                {u.role.replace('ADMIN_', '').replace('MEMBER', 'Member')}
              </span>
            </div>
            <div className="mt-3">
              <div className="text-[10px] uppercase text-brand-grey font-bold mb-1">Role</div>
              <select 
                value={u.role} 
                onChange={(e) => handleRoleChange(u.id, e.target.value as Role)}
                disabled={
                  currentUser && u.email.toLowerCase() === currentUser.email.toLowerCase()
                }
                className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-xs focus:border-brand-lime focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value={Role.ADMIN_FULL}>Full Admin</option>
                <option value={Role.ADMIN_COMMISSIONER}>Commissioner (Schedule)</option>
                <option value={Role.ADMIN_SCOREKEEPER}>Scorekeeper (Stats)</option>
                <option value={Role.ADMIN_MEDIA}>Media Uploader</option>
              </select>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden md:block bg-brand-dark border border-white/10 rounded-lg overflow-hidden">
         <div className="overflow-x-auto">
         <table className="w-full min-w-[640px] text-left">
            <thead className="bg-neutral-900 text-brand-grey text-xs uppercase font-bold">
               <tr>
                  <th className="p-4">User</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Current Role</th>
                  <th className="p-4">Actions</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white text-sm">
               {users.map(u => (
                  <tr key={u.id} className="hover:bg-white/5">
                     <td className="p-4 font-bold">{u.name}</td>
                     <td className="p-4 text-gray-400 font-mono">{u.email}</td>
                     <td className="p-4">
                        <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${getRoleBadgeColor(u.role)}`}>
                           {u.role.replace('ADMIN_', '').replace('MEMBER', 'Member')}
                        </span>
                     </td>
                    <td className="p-4">
                       <select 
                         value={u.role} 
                         onChange={(e) => handleRoleChange(u.id, e.target.value as Role)}
                         disabled={
                           currentUser && u.email.toLowerCase() === currentUser.email.toLowerCase()
                         }
                         className="bg-black border border-white/20 rounded p-2 text-white text-xs focus:border-brand-lime focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                       >
                          <option value={Role.ADMIN_FULL}>Full Admin</option>
                          <option value={Role.ADMIN_COMMISSIONER}>Commissioner (Schedule)</option>
                          <option value={Role.ADMIN_SCOREKEEPER}>Scorekeeper (Stats)</option>
                          <option value={Role.ADMIN_MEDIA}>Media Uploader</option>
                       </select>
                     </td>
                  </tr>
               ))}
            </tbody>
         </table>
         </div>
      </div>
    </div>
  );
};

// --- COMPONENT: DIVISION MANAGER ---
const DivisionManager: React.FC = () => {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [divisions, setDivisions] = useState<{ id: string; name: string; description?: string; seasonId: string }[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [newDivisionName, setNewDivisionName] = useState('');
  const [newDivisionDesc, setNewDivisionDesc] = useState('');
  const [editingDivisionId, setEditingDivisionId] = useState<string | null>(null);
  const [editDivisionName, setEditDivisionName] = useState('');
  const [editDivisionDesc, setEditDivisionDesc] = useState('');
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const loadSeasons = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('seasons')
        .select('id,name,is_current,start_date')
        .order('start_date', { ascending: false });
      if (error) throw error;
      const mapped: Season[] = (data || []).map((s: any) => ({
        id: s.id,
        name: s.name || 'Season',
        isActive: !!s.is_current,
      }));
      setSeasons(mapped);
      if (!selectedSeasonId && mapped.length) {
        const current = mapped.find((s) => s.isActive) || mapped[0];
        setSelectedSeasonId(current.id);
      }
    } catch (err) {
      console.error('Load seasons error', err);
      setError('Unable to load seasons.');
    }
  }, [selectedSeasonId]);

  const loadDivisions = useCallback(async () => {
    if (!selectedSeasonId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('divisions')
        .select('id,name,description,season_id')
        .eq('season_id', selectedSeasonId)
        .order('name', { ascending: true });
      if (error) throw error;
      setDivisions(
        (data || []).map((d: any) => ({
          id: d.id,
          name: d.name,
          description: d.description || '',
          seasonId: d.season_id,
        }))
      );
      setError(null);
    } catch (err) {
      console.error('Load divisions error', err);
      setDivisions([]);
      setError('Unable to load divisions.');
    } finally {
      setLoading(false);
    }
  }, [selectedSeasonId]);

  useEffect(() => {
    loadSeasons();
  }, [loadSeasons]);

  useEffect(() => {
    loadDivisions();
  }, [loadDivisions]);

  useEffect(() => {
    setEditingDivisionId(null);
    setEditDivisionName('');
    setEditDivisionDesc('');
  }, [selectedSeasonId]);

  const handleAdd = async () => {
    if (!selectedSeasonId || !newDivisionName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: newDivisionName.trim(),
        description: newDivisionDesc.trim() || null,
        season_id: selectedSeasonId,
      };
      const { data, error } = await supabase.from('divisions').insert(payload).select('id,name,description,season_id').single();
      if (error) throw error;
      if (data) {
        setDivisions((prev) => [
          ...prev,
          {
            id: data.id,
            name: data.name,
            description: data.description || '',
            seasonId: data.season_id,
          },
        ]);
      }
      setNewDivisionName('');
      setNewDivisionDesc('');
    } catch (err) {
      console.error('Add division error', err);
      setError('Failed to add division.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (division: { id: string; name: string; description?: string }) => {
    setEditingDivisionId(division.id);
    setEditDivisionName(division.name);
    setEditDivisionDesc(division.description || '');
    setError(null);
  };

  const cancelEdit = () => {
    setEditingDivisionId(null);
    setEditDivisionName('');
    setEditDivisionDesc('');
  };

  const handleUpdate = async (id: string) => {
    if (!editDivisionName.trim()) {
      setError('Division name is required.');
      return;
    }
    setSavingEditId(id);
    try {
      const existingDivision = divisions.find((division) => division.id === id) || null;
      const previousName = String(existingDivision?.name || '').trim();
      const nextName = editDivisionName.trim();
      const payload = {
        name: nextName,
        description: editDivisionDesc.trim() || null,
      };
      const { data, error } = await supabase
        .from('divisions')
        .update(payload)
        .eq('id', id)
        .select('id,name,description,season_id')
        .single();
      if (error) throw error;

      const renamedDivision =
        previousName &&
        nextName &&
        previousName.localeCompare(nextName, undefined, { sensitivity: 'accent' }) !== 0;

      if (renamedDivision && selectedSeasonId) {
        let teamUpdateError: any = null;

        const runTeamRename = async (client: typeof supabase) => {
          const result = await client
            .from('teams')
            .update({ division: nextName })
            .eq('season_id', selectedSeasonId)
            .ilike('division', previousName);
          if (result.error) throw result.error;
        };

        try {
          await runTeamRename(supabase);
        } catch (err) {
          teamUpdateError = err;
          if (supabaseAdmin) {
            try {
              await runTeamRename(supabaseAdmin as any);
              teamUpdateError = null;
            } catch (adminErr) {
              teamUpdateError = adminErr;
            }
          }
        }

        if (teamUpdateError) {
          throw teamUpdateError;
        }
      }

      setDivisions((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                name: data?.name ?? payload.name,
                description: data?.description || '',
                seasonId: data?.season_id ?? d.seasonId,
              }
            : d
        )
      );
      setError(null);
      cancelEdit();
    } catch (err) {
      console.error('Update division error', err);
      setError('Failed to update division.');
    } finally {
      setSavingEditId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await supabase.from('divisions').delete().eq('id', id);
      setDivisions((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error('Delete division error', err);
      setError('Failed to delete division.');
    }
  };

  return (
    <div className="animate-fadeIn">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="font-sports text-2xl text-white uppercase">Divisions</h2>
          <p className="text-xs text-gray-400">Manage divisions per season.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedSeasonId}
            onChange={(e) => setSelectedSeasonId(e.target.value)}
            className="bg-brand-dark border border-white/20 text-white text-sm font-sports uppercase tracking-wide px-3 py-2 rounded"
          >
            <option value="" disabled>Select Season</option>
            {sortSeasonsNewestFirst(seasons).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="mb-4 text-xs text-brand-red font-mono">{error}</div>}

      <div className="bg-brand-dark border border-white/10 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            value={newDivisionName}
            onChange={(e) => setNewDivisionName(e.target.value)}
            placeholder="Division name"
            className="bg-black border border-white/20 rounded px-3 py-2 text-white"
          />
          <input
            value={newDivisionDesc}
            onChange={(e) => setNewDivisionDesc(e.target.value)}
            placeholder="Description (optional)"
            className="bg-black border border-white/20 rounded px-3 py-2 text-white"
          />
          <button
            onClick={handleAdd}
            disabled={!selectedSeasonId || !newDivisionName.trim() || saving}
            className="bg-brand-lime text-black font-sports uppercase font-bold text-sm rounded px-4 py-2 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Add Division'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">Loading divisions...</div>
      ) : (
        <div className="bg-brand-dark border border-white/10 rounded-xl p-3">
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
          >
            {divisions.map((d) => (
              <div key={d.id} className="p-4 border border-white/10 rounded-lg bg-black/20">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    {editingDivisionId === d.id ? (
                      <div className="space-y-2">
                        <input
                          value={editDivisionName}
                          onChange={(e) => setEditDivisionName(e.target.value)}
                          className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm"
                          placeholder="Division name"
                        />
                        <input
                          value={editDivisionDesc}
                          onChange={(e) => setEditDivisionDesc(e.target.value)}
                          className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm"
                          placeholder="Description (optional)"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="text-white font-bold">{d.name}</div>
                        <div className="text-xs text-gray-400">{d.description || 'No description'}</div>
                      </>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {editingDivisionId === d.id ? (
                      <>
                        <button
                          onClick={() => handleUpdate(d.id)}
                          disabled={savingEditId === d.id}
                          className="text-brand-lime hover:text-lime-200 text-xs font-bold uppercase disabled:opacity-60"
                        >
                          {savingEditId === d.id ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="text-gray-400 hover:text-white text-xs font-bold uppercase"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(d)}
                          className="text-brand-lime hover:text-lime-200 text-xs font-bold uppercase"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setPendingDelete({ id: d.id, name: d.name })}
                          className="text-brand-red hover:text-white text-xs font-bold uppercase"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!divisions.length && (
              <div className="p-4 text-gray-400 text-sm">No divisions yet for this season.</div>
            )}
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fadeIn">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="text-white font-sports text-xl uppercase">Delete Division</h4>
                <p className="text-gray-400 text-sm mt-1">This cannot be undone.</p>
              </div>
              <button onClick={() => setPendingDelete(null)} className="text-gray-500 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-lg p-4 text-sm text-gray-300 space-y-2">
              <div className="text-white font-bold">{pendingDelete.name}</div>
              <div className="text-xs text-brand-red">Deleting will remove this division from the season.</div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-4 py-2 rounded border border-white/20 text-white hover:border-white"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!pendingDelete) return;
                  await handleDelete(pendingDelete.id);
                  setPendingDelete(null);
                }}
                className="px-4 py-2 rounded bg-brand-red text-white font-bold hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- COMPONENT: SEASONS MANAGER ---
type SeasonView = {
  id: string;
  name: string;
  isActive: boolean;
  isPublic: boolean;
  isRegistrationOpen: boolean;
  year?: number | null;
  start_date?: string | null;
  end_date?: string | null;
};

const SeasonsManager = () => {
  const [seasons, setSeasons] = useState<SeasonView[]>([]);
  const [newSeasonName, setNewSeasonName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [supportsRegistrationOpen, setSupportsRegistrationOpen] = useState<boolean>(true);
  const [newSeasonStart, setNewSeasonStart] = useState<string>('');
  const [newSeasonEnd, setNewSeasonEnd] = useState<string>('');
  const [newSeasonStartDisplay, setNewSeasonStartDisplay] = useState<string>('');
  const [newSeasonEndDisplay, setNewSeasonEndDisplay] = useState<string>('');
  const [editingSeasonId, setEditingSeasonId] = useState<string | null>(null);
  const [editSeasonName, setEditSeasonName] = useState('');
  const [editSeasonStart, setEditSeasonStart] = useState<string>('');
  const [editSeasonEnd, setEditSeasonEnd] = useState<string>('');
  const [editSeasonStartDisplay, setEditSeasonStartDisplay] = useState<string>('');
  const [editSeasonEndDisplay, setEditSeasonEndDisplay] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [mutatingSeasonId, setMutatingSeasonId] = useState<string | null>(null);
  const newSeasonStartRef = useRef<HTMLInputElement | null>(null);
  const newSeasonEndRef = useRef<HTMLInputElement | null>(null);
  const hiddenNewSeasonStartRef = useRef<HTMLInputElement | null>(null);
  const hiddenNewSeasonEndRef = useRef<HTMLInputElement | null>(null);
  const editSeasonStartRef = useRef<HTMLInputElement | null>(null);
  const editSeasonEndRef = useRef<HTMLInputElement | null>(null);
  const hiddenEditSeasonStartRef = useRef<HTMLInputElement | null>(null);
  const hiddenEditSeasonEndRef = useRef<HTMLInputElement | null>(null);

  const requireAdminClient = () => {
    if (!supabaseAdmin) {
      throw new Error('Missing Supabase admin service key (VITE_SUPABASE_SERVICE_KEY).');
    }
    return supabaseAdmin;
  };

  const isPastEndDate = (endDate?: string | null) => {
    if (!endDate) return false;
    const end = new Date(endDate);
    if (Number.isNaN(end.getTime())) return false;
    end.setHours(23, 59, 59, 999);
    return Date.now() > end.getTime();
  };

  const normalizeDateInput = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!isoMatch && !usMatch) return null;

    const year = parseInt(isoMatch ? isoMatch[1] : usMatch[3], 10);
    const month = parseInt(isoMatch ? isoMatch[2] : usMatch[1], 10);
    const day = parseInt(isoMatch ? isoMatch[3] : usMatch[2], 10);
    if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;

    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
      return null;
    }

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const formatDateInput = (value?: string | null) => {
    if (!value) return '';
    const isoMatch = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (isoMatch) return isoMatch[0];
    return normalizeDateInput(value) || '';
  };

  const handleRawNewSeasonDate = (
    rawValue: string,
    setterDisplay: React.Dispatch<React.SetStateAction<string>>,
    setterIso: React.Dispatch<React.SetStateAction<string>>,
    hiddenRef: React.RefObject<HTMLInputElement | null>
  ) => {
    setterDisplay(rawValue);
    const normalized = normalizeDateInput(rawValue);
    if (normalized) {
      syncDisplayFromIso(normalized, setterIso, setterDisplay);
      if (hiddenRef.current) {
        hiddenRef.current.value = normalized;
      }
    }
  };

  const handleHiddenDateChange = (
    value: string,
    setterIso: React.Dispatch<React.SetStateAction<string>>,
    setterDisplay: React.Dispatch<React.SetStateAction<string>>
  ) => {
    if (!value) {
      setterIso('');
      setterDisplay('');
      return;
    }
    syncDisplayFromIso(value, setterIso, setterDisplay);
  };

  const formatIsoForDisplay = (value?: string | null) => {
    if (!value) return '';
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    const [, year, month, day] = match;
    return `${month}/${day}/${year}`;
  };

  const syncDisplayFromIso = (
    iso: string,
    setterIso: React.Dispatch<React.SetStateAction<string>>,
    setterDisplay: React.Dispatch<React.SetStateAction<string>>
  ) => {
    setterIso(iso);
    setterDisplay(formatIsoForDisplay(iso));
  };

  const triggerPicker = (pickerRef?: React.RefObject<HTMLInputElement | null>) => {
    if (pickerRef?.current) {
      pickerRef.current.showPicker?.();
      pickerRef.current.focus();
    }
  };

  const normalizeSeasonName = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

  const hasDuplicateSeasonName = (name: string, excludeId?: string) => {
    const normalized = normalizeSeasonName(name);
    return seasons.some(
      (season) => season.id !== excludeId && normalizeSeasonName(season.name) === normalized
    );
  };

  const cleanupSeasonTeamReferencesForDelete = async (teamIds: string[]) => {
    const ids = Array.from(new Set(teamIds.filter(Boolean)));
    if (!ids.length) return;

    const admin = requireAdminClient();
    const { error: detachErr } = await admin
      .from('players')
      .update({
        team_id: null,
        is_captain: false,
      })
      .in('team_id', ids);
    if (detachErr) throw detachErr;

    const runOptionalDelete = async (table: string) => {
      try {
        const { error: deleteErr } = await admin.from(table).delete().in('team_id', ids);
        if (deleteErr) throw deleteErr;
      } catch (err: any) {
        const code = String(err?.code || '').toUpperCase();
        const message = String(err?.message || '').toLowerCase();
        const isMissing =
          code === '42P01' ||
          code === '42703' ||
          code === 'PGRST205' ||
          message.includes('does not exist') ||
          (message.includes('relation') && message.includes('does not exist')) ||
          message.includes('could not find the table');
        if (isMissing) return;
        throw err;
      }
    };

    await runOptionalDelete('game_guest_players');
    await runOptionalDelete('notifications');
  };

  const loadSeasons = async () => {
    try {
      // `registration_open` is a newer optional column. Fall back gracefully if it's not present yet.
      let data: any[] | null = null;
      let supportsRegOpen = true;
      const withReg = await supabase
        .from('seasons')
        .select('id,name,year,is_current,start_date,end_date,is_public,registration_open')
        .order('start_date', { ascending: false });
      if (withReg.error) {
        const errAny = withReg.error as any;
        const msg = errAny?.message?.toString?.()?.toLowerCase?.() || '';
        const code = errAny?.code?.toString?.() || '';
        // 42703 = undefined_column
        if (code === '42703' || msg.includes('registration_open')) {
          supportsRegOpen = false;
          const fallback = await supabase
            .from('seasons')
            .select('id,name,year,is_current,start_date,end_date,is_public')
            .order('start_date', { ascending: false });
          if (fallback.error) throw fallback.error;
          data = fallback.data || [];
        } else {
          throw withReg.error;
        }
      } else {
        data = withReg.data || [];
      }
      setSupportsRegistrationOpen(
        supportsRegOpen && (data || []).some((row) => Object.prototype.hasOwnProperty.call(row, 'registration_open'))
      );
      if (!data) {
        setSeasons([]);
        return;
      }
      const expiredIds: string[] = [];
      const parseBool = (value: any, fallback = true) => {
        if (value === true || value === 'true' || value === 'TRUE' || value === 't') return true;
        if (value === false || value === 'false' || value === 'FALSE' || value === 'f') return false;
        return fallback;
      };

      const mapped: SeasonView[] = data.map((row: any) => ({
        id: row.id,
        name: row.name,
        year: row.year ?? null,
        isActive: !!row.is_current && !isPastEndDate(row.end_date),
        isPublic: parseBool(row.is_public),
        isRegistrationOpen: supportsRegOpen ? parseBool(row.registration_open, false) : false,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
      }));
      mapped.forEach((row) => {
        if (row.isActive) return;
        const original = data.find((d: any) => d.id === row.id);
        if (original?.is_current && isPastEndDate(original.end_date)) {
          expiredIds.push(row.id);
        }
      });
      if (expiredIds.length) {
        const admin = requireAdminClient();
        const { error: expireErr } = await admin
          .from('seasons')
          .update({ is_current: false })
          .in('id', expiredIds);
        if (expireErr) throw expireErr;
      }
      setSeasons(mapped);
      setError(null);
    } catch (err: any) {
      console.error('Load seasons error', err);
      setError('Using empty list (Supabase error).');
      setSeasons([]);
    }
  };

  useEffect(() => {
    loadSeasons();
  }, []);

  const handleAddSeason = async () => {
    setError(null);
    const trimmedSeasonName = newSeasonName.trim();
    if (!trimmedSeasonName || !newSeasonStart || !newSeasonEnd) {
      setError('Season name, start date, and end date are required.');
      return;
    }
    if (hasDuplicateSeasonName(trimmedSeasonName)) {
      setError('Season name already exists. Use a unique season name.');
      return;
    }
    const normalizedStart = normalizeDateInput(newSeasonStart);
    const normalizedEnd = normalizeDateInput(newSeasonEnd);
    if (!normalizedStart || !normalizedEnd) {
      setError('Invalid date format. Use MM/DD/YYYY or pick from the calendar.');
      return;
    }
    if (normalizedEnd < normalizedStart) {
      setError('End date must be after the start date.');
      return;
    }
    const yrMatch = trimmedSeasonName.match(/20\d{2}/);
    const yearVal = yrMatch ? parseInt(yrMatch[0], 10) : new Date().getFullYear();
    try {
      const admin = requireAdminClient();
      const { data: existing, error: existingErr } = await admin
        .from('seasons')
        .select('id,name')
        .ilike('name', trimmedSeasonName);
      if (existingErr) throw existingErr;
      if ((existing || []).some((row: any) => normalizeSeasonName(row.name || '') === normalizeSeasonName(trimmedSeasonName))) {
        setError('Season name already exists. Use a unique season name.');
        return;
      }

      const { error: err } = await admin.from('seasons').insert({
        name: trimmedSeasonName,
        year: yearVal,
        is_current: false,
        is_public: true,
        start_date: normalizedStart,
        end_date: normalizedEnd,
      });
      if (err) throw err;
      setNewSeasonName('');
      syncDisplayFromIso('', setNewSeasonStart, setNewSeasonStartDisplay);
      syncDisplayFromIso('', setNewSeasonEnd, setNewSeasonEndDisplay);
      loadSeasons();
    } catch (err: any) {
      console.error('Add season error', err);
      setError('Failed to add season.');
    }
  };

  const startEditSeason = (season: SeasonView) => {
    setEditingSeasonId(season.id);
    setEditSeasonName(season.name);
    syncDisplayFromIso(formatDateInput(season.start_date), setEditSeasonStart, setEditSeasonStartDisplay);
    syncDisplayFromIso(formatDateInput(season.end_date), setEditSeasonEnd, setEditSeasonEndDisplay);
    setError(null);
  };

  const cancelEditSeason = () => {
    setEditingSeasonId(null);
    setEditSeasonName('');
    syncDisplayFromIso('', setEditSeasonStart, setEditSeasonStartDisplay);
    syncDisplayFromIso('', setEditSeasonEnd, setEditSeasonEndDisplay);
  };

  const handleUpdateSeason = async (season: SeasonView) => {
    setError(null);
    const trimmedSeasonName = editSeasonName.trim();
    if (!trimmedSeasonName || !editSeasonStart || !editSeasonEnd) {
      setError('Season name, start date, and end date are required.');
      return;
    }
    if (hasDuplicateSeasonName(trimmedSeasonName, season.id)) {
      setError('Season name already exists. Use a unique season name.');
      return;
    }
    const normalizedStart = normalizeDateInput(editSeasonStart);
    const normalizedEnd = normalizeDateInput(editSeasonEnd);
    if (!normalizedStart || !normalizedEnd) {
      setError('Invalid date format. Use MM/DD/YYYY or pick from the calendar.');
      return;
    }
    if (normalizedEnd < normalizedStart) {
      setError('End date must be after the start date.');
      return;
    }
    const yrMatch = trimmedSeasonName.match(/20\d{2}/);
    const parsedStartYear = parseInt(normalizedStart.slice(0, 4), 10);
    const yearVal = yrMatch
      ? parseInt(yrMatch[0], 10)
      : season.year ?? (Number.isFinite(parsedStartYear) ? parsedStartYear : new Date().getFullYear());
    try {
      setSavingEdit(true);
      const admin = requireAdminClient();
      const { data: existing, error: existingErr } = await admin
        .from('seasons')
        .select('id,name')
        .ilike('name', trimmedSeasonName);
      if (existingErr) throw existingErr;
      if (
        (existing || []).some(
          (row: any) =>
            row.id !== season.id &&
            normalizeSeasonName(row.name || '') === normalizeSeasonName(trimmedSeasonName)
        )
      ) {
        setError('Season name already exists. Use a unique season name.');
        return;
      }

      const { error: err } = await admin
        .from('seasons')
        .update({
          is_public: season.isPublic,
          name: trimmedSeasonName,
          year: yearVal,
          start_date: normalizedStart,
          end_date: normalizedEnd,
        })
        .eq('id', season.id);
      if (err) throw err;
      cancelEditSeason();
      loadSeasons();
    } catch (err: any) {
      console.error('Update season error', err);
      setError('Failed to update season.');
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleSeasonStatus = async (id: string, nextActive: boolean) => {
    const target = seasons.find((s) => s.id === id);
    if (nextActive && target && isPastEndDate(target.end_date)) {
      setError('Cannot activate a season that is already past its end date.');
      return;
    }
    try {
      setMutatingSeasonId(id);
      const admin = requireAdminClient();
      if (nextActive) {
        let err = (await admin.from('seasons').update({ is_current: false }).neq('id', id)).error;
        if (err) throw err;

        err = (await admin.from('seasons').update({ is_current: true }).eq('id', id)).error;
        if (err) throw err;
      } else {
        let err = (await admin.from('seasons').update({ is_current: false }).eq('id', id)).error;
        if (err) throw err;
      }
      loadSeasons();
    } catch (err: any) {
      console.error('Toggle season error', err);
      setError(err?.message || 'Failed to update season status.');
    } finally {
      setMutatingSeasonId(null);
    }
  };

  const toggleSeasonVisibility = async (id: string, nextVisible: boolean) => {
    try {
      setMutatingSeasonId(id);
      const admin = requireAdminClient();
      const { error: err } = await admin
        .from('seasons')
        .update({ is_public: nextVisible })
        .eq('id', id);
      if (err) throw err;
      loadSeasons();
    } catch (err: any) {
      console.error('Toggle season visibility error', err);
      setError(err?.message || 'Failed to update season visibility.');
    } finally {
      setMutatingSeasonId(null);
    }
  };

  const toggleSeasonRegistrationOpen = async (id: string, nextOpen: boolean) => {
    if (!supportsRegistrationOpen) return;
    try {
      setMutatingSeasonId(id);
      const admin = requireAdminClient();
      const { error: err } = await admin
        .from('seasons')
        .update({ registration_open: nextOpen })
        .eq('id', id);
      if (err) throw err;
      loadSeasons();
    } catch (err: any) {
      console.error('Toggle season registration error', err);
      setError(err?.message || 'Failed to update season registration.');
    } finally {
      setMutatingSeasonId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setMutatingSeasonId(id);
      const admin = requireAdminClient();
      const { data: seasonTeams, error: teamsErr } = await admin
        .from('teams')
        .select('id')
        .eq('season_id', id);
      if (teamsErr) throw teamsErr;

      await cleanupSeasonTeamReferencesForDelete((seasonTeams || []).map((team: any) => String(team.id || '')));

      const { error: err } = await admin.from('seasons').delete().eq('id', id);
      if (err) throw err;
      loadSeasons();
    } catch (err: any) {
      console.error('Delete season error', err);
      setError(err?.message || 'Failed to delete season.');
    } finally {
      setMutatingSeasonId(null);
    }
  };

  return (
    <div className="animate-fadeIn">
      <div className="flex justify-between items-center mb-6">
        <h2 className="font-sports text-2xl text-white uppercase">Manage Seasons</h2>
        {error && <span className="text-xs text-brand-red font-mono">{error}</span>}
      </div>

      {!supportsRegistrationOpen && (
        <div className="bg-black/40 border border-white/10 rounded-xl p-4 mb-6 text-sm text-gray-300">
          Registration toggle is unavailable because your `seasons` table is missing the `registration_open` column.
          Run `server/seasons_registration_open.sql` in Supabase SQL editor, then refresh this page.
        </div>
      )}
      
      <div className="bg-brand-dark border border-white/10 p-6 rounded-lg mb-8">
         <h3 className="text-white font-bold mb-4">Create New Season</h3>
         <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input 
              type="text" 
              value={newSeasonName}
              onChange={(e) => setNewSeasonName(e.target.value)}
              placeholder="e.g. Spring 2025" 
              className="bg-black border border-white/20 rounded px-4 py-2 text-white" 
              required
            />
            <div className="relative">
              <input
                ref={newSeasonStartRef}
                type="text"
                value={newSeasonStartDisplay}
                onChange={(e) =>
                  handleRawNewSeasonDate(e.target.value, setNewSeasonStartDisplay, setNewSeasonStart, hiddenNewSeasonStartRef)
                }
                onFocus={() => triggerPicker(hiddenNewSeasonStartRef)}
                className="w-full bg-black border border-white/20 rounded px-4 py-2 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none transition-colors"
                placeholder="MM/DD/YYYY"
                inputMode="numeric"
                required
              />
              <button
                type="button"
                onClick={() => triggerPicker(hiddenNewSeasonStartRef)}
                className="absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                aria-label="Open start date calendar"
              >
                <Calendar size={16} />
              </button>
              <input
                ref={hiddenNewSeasonStartRef}
                type="date"
                value={newSeasonStart}
                onChange={(e) => handleHiddenDateChange(e.target.value, setNewSeasonStart, setNewSeasonStartDisplay)}
                className="absolute inset-0 w-0 h-0 opacity-0 pointer-events-none"
              />
            </div>
            <div className="relative">
              <input
                ref={newSeasonEndRef}
                type="text"
                value={newSeasonEndDisplay}
                onChange={(e) =>
                  handleRawNewSeasonDate(e.target.value, setNewSeasonEndDisplay, setNewSeasonEnd, hiddenNewSeasonEndRef)
                }
                onFocus={() => triggerPicker(hiddenNewSeasonEndRef)}
                className="w-full bg-black border border-white/20 rounded px-4 py-2 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none transition-colors"
                placeholder="MM/DD/YYYY"
                inputMode="numeric"
                required
              />
              <button
                type="button"
                onClick={() => triggerPicker(hiddenNewSeasonEndRef)}
                className="absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                aria-label="Open end date calendar"
              >
                <Calendar size={16} />
              </button>
              <input
                ref={hiddenNewSeasonEndRef}
                type="date"
                value={newSeasonEnd}
                onChange={(e) => handleHiddenDateChange(e.target.value, setNewSeasonEnd, setNewSeasonEndDisplay)}
                className="absolute inset-0 w-0 h-0 opacity-0 pointer-events-none"
              />
            </div>
            <button onClick={handleAddSeason} className="bg-brand-lime text-black px-6 py-2 rounded font-bold uppercase text-sm">
               Create
            </button>
         </div>
      </div>

      <div className="space-y-4">
         {seasons.map(s => (
            <div key={s.id} className="bg-brand-dark border border-white/10 p-4 rounded-lg">
               {editingSeasonId === s.id ? (
                 <div className="space-y-3">
                   <div className="flex flex-col gap-3">
                     <input
                       type="text"
                       value={editSeasonName}
                       onChange={(e) => setEditSeasonName(e.target.value)}
                       className="w-full bg-black border border-white/20 rounded px-4 py-2 text-white"
                     />
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="relative">
                          <input
                            ref={editSeasonStartRef}
                            type="text"
                            value={editSeasonStartDisplay}
                            onChange={(e) =>
                              handleRawNewSeasonDate(
                                e.target.value,
                                setEditSeasonStartDisplay,
                                setEditSeasonStart,
                                hiddenEditSeasonStartRef
                              )
                            }
                            onFocus={() => triggerPicker(hiddenEditSeasonStartRef)}
                            className="w-full bg-black border border-white/20 rounded px-4 py-2 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none transition-colors"
                            placeholder="MM/DD/YYYY"
                            inputMode="numeric"
                          />
                          <button
                            type="button"
                            onClick={() => triggerPicker(hiddenEditSeasonStartRef)}
                            className="absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                            aria-label="Open start date calendar"
                          >
                            <Calendar size={16} />
                          </button>
                          <input
                            ref={hiddenEditSeasonStartRef}
                            type="date"
                            value={editSeasonStart}
                            onChange={(e) => handleHiddenDateChange(e.target.value, setEditSeasonStart, setEditSeasonStartDisplay)}
                            className="absolute inset-0 w-0 h-0 opacity-0 pointer-events-none"
                          />
                        </div>
                        <div className="relative">
                          <input
                            ref={editSeasonEndRef}
                            type="text"
                            value={editSeasonEndDisplay}
                            onChange={(e) =>
                              handleRawNewSeasonDate(
                                e.target.value,
                                setEditSeasonEndDisplay,
                                setEditSeasonEnd,
                                hiddenEditSeasonEndRef
                              )
                            }
                            onFocus={() => triggerPicker(hiddenEditSeasonEndRef)}
                            className="w-full bg-black border border-white/20 rounded px-4 py-2 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none transition-colors"
                            placeholder="MM/DD/YYYY"
                            inputMode="numeric"
                          />
                          <button
                            type="button"
                            onClick={() => triggerPicker(hiddenEditSeasonEndRef)}
                            className="absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                            aria-label="Open end date calendar"
                          >
                            <Calendar size={16} />
                          </button>
                          <input
                            ref={hiddenEditSeasonEndRef}
                            type="date"
                            value={editSeasonEnd}
                            onChange={(e) => handleHiddenDateChange(e.target.value, setEditSeasonEnd, setEditSeasonEndDisplay)}
                            className="absolute inset-0 w-0 h-0 opacity-0 pointer-events-none"
                          />
                        </div>
                     </div>
                   </div>
                   <div className="flex flex-wrap gap-2">
                     <button
                       onClick={() => handleUpdateSeason(s)}
                       disabled={savingEdit}
                       className="text-xs font-bold border px-3 py-1 rounded transition-colors text-brand-black bg-brand-lime border-brand-lime hover:bg-white hover:border-white disabled:opacity-60"
                     >
                       {savingEdit ? 'Saving...' : 'Save'}
                     </button>
                     <button
                       onClick={cancelEditSeason}
                       disabled={savingEdit}
                       className="text-xs font-bold border px-3 py-1 rounded transition-colors text-gray-400 border-gray-600 hover:text-white hover:border-white disabled:opacity-60"
                     >
                       Cancel
                     </button>
                   </div>
                 </div>
               ) : (
                 <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                   <div className="flex-1">
                     <div className="font-sports text-xl text-white">{s.name}</div>
                     <div className="text-xs text-gray-400 font-mono mt-1">ID: {s.id}</div>
                     <div className="text-xs text-gray-400 mt-1">
                       {s.start_date ? `Start: ${s.start_date}` : 'Start: -'} {s.end_date ? `| End: ${s.end_date}` : ''}
                     </div>
                   </div>
                   <div className="flex flex-wrap items-center gap-2">
                     <button
                       onClick={() => toggleSeasonStatus(s.id, !s.isActive)}
                       disabled={mutatingSeasonId === s.id}
                       className={`text-xs font-bold border px-3 py-1 rounded transition-colors ${
                         s.isActive
                           ? 'text-brand-black bg-brand-lime border-brand-lime hover:bg-white hover:border-white'
                           : 'text-gray-400 border-gray-600 hover:text-white hover:border-white'
                       }`}
                     >
                       {s.isActive ? 'ACTIVE' : 'INACTIVE'}
                     </button>
                    <button
                      onClick={() => toggleSeasonVisibility(s.id, !s.isPublic)}
                      disabled={mutatingSeasonId === s.id}
                      className={`text-xs font-bold border px-3 py-1 rounded transition-colors ${
                        s.isPublic
                          ? 'text-brand-black bg-brand-lime border-brand-lime hover:bg-white hover:border-white'
                          : 'text-gray-400 border-gray-600 hover:text-white hover:border-white'
                      }`}
                    >
                      {s.isPublic ? 'PUBLIC' : 'HIDDEN'}
                    </button>
                    {supportsRegistrationOpen && (
                      <button
                        onClick={() => toggleSeasonRegistrationOpen(s.id, !s.isRegistrationOpen)}
                        disabled={mutatingSeasonId === s.id}
                        className={`text-xs font-bold border px-3 py-1 rounded transition-colors ${
                          s.isRegistrationOpen
                            ? 'text-brand-black bg-brand-lime border-brand-lime hover:bg-white hover:border-white'
                            : 'text-gray-400 border-gray-600 hover:text-white hover:border-white'
                        }`}
                      >
                        {s.isRegistrationOpen ? 'REG OPEN' : 'REG CLOSED'}
                      </button>
                    )}
                    <button
                      onClick={() => startEditSeason(s)}
                      className="text-gray-400 hover:text-white"
                      aria-label="Edit season"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => setPendingDelete({ id: s.id, name: s.name })}
                      className="text-brand-red hover:text-white"
                      aria-label="Delete season"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
         ))}
      </div>

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fadeIn">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="text-white font-sports text-xl uppercase">Delete Season</h4>
                <p className="text-gray-400 text-sm mt-1">This cannot be undone.</p>
              </div>
              <button onClick={() => setPendingDelete(null)} className="text-gray-500 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-lg p-4 text-sm text-gray-300">
              Are you sure you want to delete <span className="text-white font-bold">{pendingDelete.name}</span>?
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await handleDelete(pendingDelete.id);
                  setPendingDelete(null);
                }}
                className="px-4 py-2 rounded bg-brand-red text-white text-sm font-bold hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const createImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = (error) => reject(error);
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = src;
  });

const getCroppedImageBlob = async (src: string, area: Area): Promise<Blob> => {
  const image = await createImageElement(src);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(Math.round(area.width), 1);
  canvas.height = Math.max(Math.round(area.height), 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to access canvas context.');
  }
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Unable to produce cropped image.'));
    }, 'image/png');
  });
};

type ImageCropState = {
  file: File;
  src: string;
  type: 'logo' | 'banner';
  aspect: number;
};

// --- COMPONENT: TEAMS MANAGER ---
type CsvImportRow = {
  firstName: string;
  lastName: string;
  teamName: string;
  division: string;
  jerseyNumberRaw: string;
  position: string;
  birthDate: string;
  jerseySize: string;
  shortsSize: string;
  jerseyName: string;
  referralSource: string;
  nbaComparison: string;
  instagram: string;
  phone: string;
  email: string;
};

type SeasonStatsCsvRow = {
  firstName: string;
  lastName: string;
  season: string;
  division: string;
  teamName: string;
  jerseyNumber: string;
  status: string;
  position: string;
  gp: string;
  pts: string;
  fgm: string;
  fga: string;
  fgPct: string;
  tpm: string;
  tpa: string;
  threePct: string;
  reb: string;
  ast: string;
  stl: string;
  blk: string;
  tov: string;
  ftPct: string;
  fta: string;
};

type ScheduleCsvRow = {
  date: string;
  time: string;
  home: string;
  homeDivision: string;
  homeScore: string;
  homePIM: string;
  homeRoster: string;
  away: string;
  awayDivision: string;
  awayScore: string;
  awayPIM: string;
  awayRoster: string;
  status: string;
  facility: string;
  court: string;
  schedule: string;
  publicNotes: string;
  privateNotes: string;
};

interface TeamsManagerProps {
  showImportsOnly?: boolean;
  importSeasonId?: string | null;
  onImportSeasonChange?: (seasonId: string | null) => void;
  onTeamSeasonsChange?: (seasons: SeasonView[]) => void;
}

type ExistingUserOption = {
  userId: string;
  displayName: string;
  email: string;
};

type NewPlayerSuggestionOption = {
  key: string;
  source: 'player' | 'user';
  playerId: string | null;
  userId: string | null;
  displayName: string;
  email: string;
  jerseyNumber: string;
  subtitle: string;
};

type MergeTeamOption = {
  id: string;
  name: string;
  division: string;
  seasonId: string | null;
  seasonLabel: string;
  logoUrl: string;
  bannerUrl: string;
};

type TeamMergeState = {
  options: MergeTeamOption[];
  keepOptions: MergeTeamOption[];
  childTeamIds: string[];
  keepTeamId: string;
  mergeTeamId: string;
  profileSourceTeamId: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

type TeamWithJoinCode = Team & {
  shortName?: string | null;
};

type TeamShareLinkSeason = {
  id: string;
  name: string;
  year?: number;
  is_current?: boolean;
  start_date?: string | null;
};

type TeamShareLinkRow = {
  id: string;
  name: string;
  division: string;
  code: string;
  link: string;
};

type WaiverAuditProfileRow = {
  user_id: string;
  display_name?: string | null;
  email?: string | null;
  email_address?: string | null;
  phone?: string | null;
};

type WaiverAuditPlayerRow = {
  id: string;
  user_id: string | null;
  first_name?: string | null;
  last_name?: string | null;
  team_id?: string | null;
  season_id?: string | null;
  created_at?: string | null;
  waiver_accepted?: boolean | null;
  waiver_accepted_at?: string | null;
  waiver_document_path?: string | null;
  email?: string | null;
  email_address?: string | null;
};

type WaiverAuditTeamRow = {
  id: string;
  name?: string | null;
  division?: string | null;
  season_id?: string | null;
};

type WaiverAuditSeasonRow = {
  id: string;
  name?: string | null;
  year?: number | null;
  is_current?: boolean | null;
  start_date?: string | null;
};

type WaiverAuditRegistrantRow = {
  playerId: string;
  userId: string;
  fullName: string;
  displayName: string;
  email: string;
  phone: string;
  teamId: string;
  teamName: string;
  seasonName: string;
  waiverAccepted: boolean;
  waiverAcceptedAt: string;
  waiverDocumentPath: string;
  createdAt: string;
  seasonId: string;
  legacyInferredApproval: boolean;
};

const TeamsManager: React.FC<TeamsManagerProps> = ({
  showImportsOnly = false,
  importSeasonId,
  onImportSeasonChange,
  onTeamSeasonsChange,
}) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [teams, setTeams] = useState<TeamWithJoinCode[]>([]);
  const [allTeams, setAllTeams] = useState<TeamWithJoinCode[]>([]);
  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [rosterPreviews, setRosterPreviews] = useState<Record<string, { text: string; image?: string }[]>>({});
  const [teamSeasons, setTeamSeasons] = useState<SeasonView[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [divisionOptions, setDivisionOptions] = useState<string[]>(['all']);
  const [selectedDivision, setSelectedDivision] = useState<string>('all');
  const [copiedJoinCodeTeamId, setCopiedJoinCodeTeamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasBannerColumn, setHasBannerColumn] = useState(false);
  const [hasDivisionColumn, setHasDivisionColumn] = useState(false);
  const [hasCaptainColumn, setHasCaptainColumn] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [bannerPreview, setBannerPreview] = useState<string>('');
  const [signedLogos, setSignedLogos] = useState<Record<string, string>>({});
  const [signedBanners, setSignedBanners] = useState<Record<string, string>>({});
  const [croppingState, setCroppingState] = useState<ImageCropState | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [loadingAsset, setLoadingAsset] = useState<'logo' | 'banner' | null>(null);
  const isLogoLoading = loadingAsset === 'logo';
  const isBannerLoading = loadingAsset === 'banner';
  const isLogoCrop = croppingState?.type === 'logo';
  const croppingSrc = croppingState?.src;
  const [pendingPlayerDelete, setPendingPlayerDelete] = useState<RosterPlayer | null>(null);
  const [pendingTeamDelete, setPendingTeamDelete] = useState<{
    team: Team;
    playersCount: number;
    gamesCount: number;
    checking: boolean;
    error: string | null;
  } | null>(null);
  const [teamEditorRosterWarning, setTeamEditorRosterWarning] = useState<{
    title: string;
    description: string;
    body: string;
  } | null>(null);
  const [pendingTeamMerge, setPendingTeamMerge] = useState<TeamMergeState | null>(null);
  const [teamMergeMetaById, setTeamMergeMetaById] = useState<TeamMergeMetadataMap>({});
  const [teamMergeMessage, setTeamMergeMessage] = useState<string | null>(null);
  const [deletingTeam, setDeletingTeam] = useState(false);
  const [csvFileName, setCsvFileName] = useState('');
  const [csvRows, setCsvRows] = useState<CsvImportRow[]>([]);
  const [csvSummary, setCsvSummary] = useState<{
    total: number;
    ready: number;
    missingTeam: number;
    missingName: number;
  } | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvImportedCount, setCsvImportedCount] = useState<number | null>(null);
  const [csvResultMessage, setCsvResultMessage] = useState<string | null>(null);
  const [csvCreateTeams, setCsvCreateTeams] = useState(false);
  const [csvReplaceExisting, setCsvReplaceExisting] = useState(false);
  const [csvUpdateExistingContactsOnly, setCsvUpdateExistingContactsOnly] = useState(false);
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const signedUrlCacheRef = useRef<Map<string, string>>(new Map());
  const playerSelectColumnsRef = useRef<string[] | null>(null);
  const canDeleteTeams = useMemo(() => {
    const role = getCurrentUser()?.role;
    return (
      role === Role.ADMIN_FULL ||
      role === Role.ADMIN_COMMISSIONER ||
      role === Role.ADMIN_SCOREKEEPER ||
      role === Role.ADMIN_MEDIA
    );
  }, []);

  // Default assets when no logo/banner uploaded
  const defaultLogo =
    'https://images.unsplash.com/photo-1627627256672-027a4613d028?q=80&w=1474&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';
  const defaultBanner =
    'https://images.unsplash.com/photo-1608991631349-62e750946dfa?q=80&w=1479&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';

  // Editor State
  const [editTeamForm, setEditTeamForm] = useState<Team | null>(null);
  const [editRoster, setEditRoster] = useState<RosterPlayer[]>([]);
  const [newPlayer, setNewPlayer] = useState({ name: '', number: '', email: '' });
  const [newPlayerUserSearch, setNewPlayerUserSearch] = useState('');
  const [newPlayerUserOptions, setNewPlayerUserOptions] = useState<ExistingUserOption[]>([]);
  const [newPlayerUserLoading, setNewPlayerUserLoading] = useState(false);
  const [newPlayerLinkedUser, setNewPlayerLinkedUser] = useState<ExistingUserOption | null>(null);
  const [newPlayerSuggestions, setNewPlayerSuggestions] = useState<NewPlayerSuggestionOption[]>([]);
  const [showNewPlayerSuggestions, setShowNewPlayerSuggestions] = useState(false);
  const [newPlayerSuggestionLoading, setNewPlayerSuggestionLoading] = useState(false);
  const newPlayerSuggestionTimerRef = useRef<number | null>(null);
  const [showNewPlayerForm, setShowNewPlayerForm] = useState(false);
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingPlayerNumber, setEditingPlayerNumber] = useState<string>('');
  const [playerNumberSavingId, setPlayerNumberSavingId] = useState<string | null>(null);
  const selectedSeasonLabel =
    teamSeasons.find((s) => s.id === selectedSeasonId)?.name || 'Select Season';

  // Quick edit modal (stay on Teams page)
  const [quickEditPlayerId, setQuickEditPlayerId] = useState<string | null>(null);
  const [quickEditPlayerRow, setQuickEditPlayerRow] = useState<any | null>(null);
  const [quickEditPlayerLoading, setQuickEditPlayerLoading] = useState(false);
  const [quickEditPlayerSaving, setQuickEditPlayerSaving] = useState(false);
  const [quickEditFirstName, setQuickEditFirstName] = useState('');
  const [quickEditLastName, setQuickEditLastName] = useState('');
  const [quickEditJerseyNumber, setQuickEditJerseyNumber] = useState('');
  const [quickEditJerseyName, setQuickEditJerseyName] = useState('');
  const [quickEditUserSearch, setQuickEditUserSearch] = useState('');
  const [quickEditUserOptions, setQuickEditUserOptions] = useState<ExistingUserOption[]>([]);
  const [quickEditUserLoading, setQuickEditUserLoading] = useState(false);
  const [quickEditLinkedUser, setQuickEditLinkedUser] = useState<ExistingUserOption | null>(null);
  const [quickEditLinkDirty, setQuickEditLinkDirty] = useState(false);
  const primaryButtonClass =
    'bg-brand-lime text-black px-4 py-2.5 rounded font-bold font-sports uppercase text-xs tracking-wide hover:bg-lime-300 transition-colors text-center';

  const normalizeEmail = (value: string) => value.trim().toLowerCase();
  const isValidEmail = (value: string) => /\S+@\S+\.\S+/.test(value.trim());

  const signTeamAssetUrl = useCallback(async (path: string, fallback?: string) => {
    if (!path) return fallback || '';
    if (path.startsWith('http') && path.includes('/object/public/')) return path;
    if (path.startsWith('http') && !path.includes('team-assets')) return path;

    const stripQuery = (p: string) => p.split('?')[0];
    const cleanPath = stripQuery(path);
    const marker = 'team-assets/';
    const idx = cleanPath.indexOf(marker);
    const bucketPath = idx >= 0 ? cleanPath.slice(idx + marker.length) : cleanPath;

    try {
      const { data, error } = await supabase.storage
        .from('team-assets')
        .createSignedUrl(bucketPath, 60 * 60 * 24 * 365);
      if (error) throw error;
      return data?.signedUrl || path;
    } catch {
      return fallback || path;
    }
  }, []);
  const normalizeCsvHeader = (value: string) =>
      value.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
  const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();
  const normalizeDivisionLabel = (value: string) =>
    normalizeText(value).replace(/\s*-\s*/g, ' - ');
  const normalizeDivisionKey = (value: string) => normalizeDivisionLabel(value).toLowerCase();
  const normalizeTeamName = (value: string) => normalizeText(value).toLowerCase();
  const normalizeDivisionName = (value: string) => normalizeText(value).toLowerCase();
  const normalizeJoinCode = (value: string) =>
    (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const toTeamCodeBase = (teamName: string) => {
    const words = (teamName || '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return 'TEAM';
    if (words.length >= 2) {
      const initials = words.map((word) => word[0]).join('');
      if (initials.length >= 3) return initials.slice(0, 8);
    }
    const compact = words.join('');
    return (compact || 'TEAM').slice(0, 8);
  };
  const buildUniqueTeamJoinCode = (teamName: string, usedCodes: Set<string>): string | null => {
    const base = normalizeJoinCode(toTeamCodeBase(teamName));
    if (!base) return null;
    if (!usedCodes.has(base)) return base;
    for (let suffix = 2; suffix <= 9999; suffix += 1) {
      const suffixText = String(suffix);
      const candidate = normalizeJoinCode(
        `${base.slice(0, Math.max(1, 8 - suffixText.length))}${suffixText}`
      ).slice(0, 8);
      if (candidate && !usedCodes.has(candidate)) return candidate;
    }
    const fallback = normalizeJoinCode(`${base.slice(0, 7)}Z`).slice(0, 8);
    return fallback || base.slice(0, 8);
  };
  const getAvatarInitials = (name: string): string => {
    if (!name) return '';
    const parts = name
      .split(' ')
      .filter(Boolean)
      .map((part) => part.trim());
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };

  const getTeamJoinCode = useCallback((team: TeamWithJoinCode) => {
    return String(team.shortName || '').trim().toUpperCase();
  }, []);

  const ensureJoinCodesForTeams = useCallback(
    async (rows: any[]): Promise<any[]> => {
      const supportsShortName = rows.some((row) =>
        Object.prototype.hasOwnProperty.call(row, 'short_name')
      );
      if (!supportsShortName) return rows;

      let globalRows: any[] = rows;
      try {
        const { data, error } = await supabase.from('teams').select('id,short_name');
        if (error) throw error;
        if (data?.length) globalRows = data;
      } catch (err) {
        if (supabaseAdmin) {
          try {
            const { data, error } = await supabaseAdmin.from('teams').select('id,short_name');
            if (!error && data?.length) globalRows = data;
          } catch {
            // fallback to local rows
          }
        }
      }

      const codeOwners = new Map<string, Set<string>>();
      globalRows.forEach((row) => {
        const code = normalizeJoinCode(String(row?.short_name || ''));
        const id = String(row?.id || '');
        if (!code || !id) return;
        if (!codeOwners.has(code)) codeOwners.set(code, new Set<string>());
        codeOwners.get(code)?.add(id);
      });
      const usedCodes = new Set(Array.from(codeOwners.keys()));

      const updates: Array<{ id: string; code: string }> = [];
      rows.forEach((row) => {
        const rowId = String(row?.id || '');
        if (!rowId) return;
        const existing = normalizeJoinCode(String(row?.short_name || ''));
        if (existing) {
          const owners = codeOwners.get(existing);
          if (!owners || (owners.size === 1 && owners.has(rowId))) return;
          const keeperId = Array.from(owners).sort()[0];
          if (keeperId === rowId) return;
        }
        const generated = buildUniqueTeamJoinCode(String(row?.name || ''), usedCodes);
        if (!generated) return;
        usedCodes.add(generated);
        updates.push({ id: rowId, code: generated });
      });
      if (!updates.length) return rows;

      const runUpdate = async (client: any, id: string, code: string) =>
        client.from('teams').update({ short_name: code }).eq('id', id);

      const codeById = new Map<string, string>();
      for (const update of updates) {
        if (!update.id) continue;
        let updateErr: any = null;
        try {
          const { error } = await runUpdate(supabase, update.id, update.code);
          updateErr = error;
        } catch (err) {
          updateErr = err;
        }
        if (updateErr && supabaseAdmin) {
          try {
            const { error } = await runUpdate(supabaseAdmin, update.id, update.code);
            updateErr = error;
          } catch (err) {
            updateErr = err;
          }
        }
        if (updateErr) {
          console.warn('Auto-generate team code failed', update.id, updateErr);
          continue;
        }
        codeById.set(update.id, update.code);
      }
      if (!codeById.size) return rows;
      return rows.map((row) => {
        const id = String(row?.id || '');
        if (!id || !codeById.has(id)) return row;
        return { ...row, short_name: codeById.get(id) || row.short_name };
      });
    },
    []
  );

  const handleCopyTeamJoinCode = useCallback(
    async (team: TeamWithJoinCode) => {
      const code = getTeamJoinCode(team);
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        setCopiedJoinCodeTeamId(team.id);
        setTimeout(() => {
          setCopiedJoinCodeTeamId((current) => (current === team.id ? null : current));
        }, 1800);
      } catch (err) {
        console.warn('copy team join code failed', err);
      }
    },
    [getTeamJoinCode]
  );

  const handleCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  const resetCropControls = useCallback(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  }, []);

  const handleCropCancel = useCallback(() => {
    setCroppingState(null);
    resetCropControls();
  }, [resetCropControls]);

  const handleCropperMediaLoaded = useCallback(() => {
    setZoom(1);
    setCrop({ x: 0, y: 0 });
    setCroppedAreaPixels(null);
  }, [setCrop, setZoom, setCroppedAreaPixels]);

  const signUrl = useCallback(
    async (path: string, fallback?: string) => {
      if (!path) return fallback || '';
      if (path.startsWith('http') && path.includes('/object/public/')) return path;
      if (path.startsWith('http') && !path.includes('team-assets')) return path;

      const stripQuery = (p: string) => p.split('?')[0];
      const cleanPath = stripQuery(path);
      const marker = 'team-assets/';
      const idx = cleanPath.indexOf(marker);
      const bucketPath = idx >= 0 ? cleanPath.slice(idx + marker.length) : cleanPath;
      const cached = signedUrlCacheRef.current.get(cleanPath);
      if (cached) return cached;

      try {
        const { data, error } = await supabase.storage
          .from('team-assets')
          .createSignedUrl(bucketPath, 60 * 60 * 24 * 365);
        if (error) throw error;
        const signed = data?.signedUrl || path;
        signedUrlCacheRef.current.set(cleanPath, signed);
        return signed;
      } catch (err) {
        return fallback || path;
      }
    },
    []
  );

  const openCropperForAsset = useCallback(
    async (type: 'logo' | 'banner') => {
      if (!editTeamForm) return;
      const path = type === 'logo' ? editTeamForm.logoUrl : editTeamForm.bannerUrl;
      if (!path) {
        setError(`Upload a ${type} first.`);
        return;
      }
      try {
        setLoadingAsset(type);
        setError(null);
        const signed = await signUrl(path);
        const response = await fetch(signed);
        if (!response.ok) {
          throw new Error('Unable to load the current image.');
        }
        const blob = await response.blob();
        const fileName = path.split('/').pop() || `${type}.png`;
        const file = new File([blob], fileName, { type: blob.type || 'image/png' });
        const preview = URL.createObjectURL(file);
        setCroppingState({
          file,
          src: preview,
          type,
          aspect: type === 'logo' ? 1 : 4,
        });
        resetCropControls();
      } catch (err: any) {
        console.error('reopen crop failed', err);
        setError(err?.message || 'Unable to load image for cropping.');
      } finally {
        setLoadingAsset(null);
      }
    },
    [editTeamForm, resetCropControls, signUrl]
  );

  useEffect(() => {
    if (!croppingState) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCropCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [croppingState, handleCropCancel]);

  useEffect(() => {
    return () => {
      if (croppingSrc) {
        URL.revokeObjectURL(croppingSrc);
      }
    };
  }, [croppingSrc]);

  const parseCsv = (input: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (char === '"') {
        if (inQuotes && input[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current);
        current = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && input[i + 1] === '\n') i += 1;
        row.push(current);
        if (row.some((cell) => cell.trim() !== '')) {
          rows.push(row);
        }
        row = [];
        current = '';
      } else {
        current += char;
      }
    }

    row.push(current);
    if (row.some((cell) => cell.trim() !== '')) {
      rows.push(row);
    }
    return rows;
  };

  const buildCsvRows = (input: string): CsvImportRow[] => {
    const rawRows = parseCsv(input);
    if (!rawRows.length) return [];

    const headerRow = rawRows[0].map((cell, index) => {
      const cleaned = index === 0 ? cell.replace(/^\uFEFF/, '') : cell;
      return normalizeCsvHeader(cleaned);
    });
    const headerIndex = new Map<string, number>();
    headerRow.forEach((header, index) => headerIndex.set(header, index));

    const getValue = (rowValues: string[], keys: string[]) => {
      for (const key of keys) {
        const idx = headerIndex.get(key);
        if (idx !== undefined) return rowValues[idx] ?? '';
      }
      return '';
    };

    return rawRows.slice(1).map((rowValues) => ({
      firstName: normalizeText(getValue(rowValues, ['first name', 'firstname', 'first'])),
      lastName: normalizeText(getValue(rowValues, ['last name', 'lastname', 'last'])),
      teamName: normalizeText(getValue(rowValues, ['team', 'team name'])),
      division: normalizeText(getValue(rowValues, ['division'])),
      jerseyNumberRaw: normalizeText(getValue(rowValues, ['#', 'no.', 'number'])),
      position: normalizeText(getValue(rowValues, ['position', 'pos'])),
      birthDate: normalizeText(getValue(rowValues, ['birthdate', 'birth date', 'dob'])),
      jerseySize: normalizeText(getValue(rowValues, ['player jersey size', 'jersey size'])),
      shortsSize: normalizeText(getValue(rowValues, ['player shorts size', 'shorts size'])),
      jerseyName: normalizeText(getValue(rowValues, ['name on jersey', 'jersey name'])),
      referralSource: normalizeText(getValue(rowValues, ['how did you hear about us?', 'referral source', 'referral'])),
      nbaComparison: normalizeText(getValue(rowValues, ['which nba player do you hoop like?', 'nba comparison'])),
      instagram: normalizeText(getValue(rowValues, ['instagram handle', 'instagram'])),
      phone: normalizeText(getValue(rowValues, ['phone number', 'phone'])),
      email: normalizeText(getValue(rowValues, ['email'])),
    }));
  };

  const normalizeDate = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  };

  const resetCsvState = () => {
    setCsvFileName('');
    setCsvRows([]);
    setCsvSummary(null);
    setCsvError(null);
    setCsvImportedCount(null);
    setCsvResultMessage(null);
    if (csvInputRef.current) {
      csvInputRef.current.value = '';
    }
  };

  const findUserIdByEmail = async (email: string): Promise<string | null> => {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id')
        .or(`email.eq.${normalized},email_address.eq.${normalized}`)
        .limit(1);
      if (!error && data?.[0]?.user_id) return data[0].user_id;
    } catch (err) {
      console.warn('profiles email lookup failed', err);
    }

    if (supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
          .from('profiles')
          .select('user_id')
          .or(`email.eq.${normalized},email_address.eq.${normalized}`)
          .limit(1);
        if (!error && data?.[0]?.user_id) return data[0].user_id;
      } catch (err) {
        console.warn('profiles email lookup (admin) failed', err);
      }

      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserByEmail(normalized);
        if (!error && data?.user?.id) return data.user.id;
      } catch (err) {
        console.warn('auth email lookup failed', err);
      }
    }

    return null;
  };

  const inviteUserByEmail = async (
    email: string
  ): Promise<{ userId: string | null; error?: string }> => {
    const normalized = normalizeEmail(email);
    if (!normalized) return { userId: null, error: 'Missing email.' };
    if (!supabaseAdmin) {
      return { userId: null, error: 'Missing admin service key for invites.' };
    }
    try {
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalized, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      if (error) return { userId: null, error: error.message };
      return { userId: data?.user?.id ?? null };
    } catch (err: any) {
      return { userId: null, error: err?.message || 'Invite failed.' };
    }
  };

  const handleCsvFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsvError(null);
    setCsvImportedCount(null);
    setCsvResultMessage(null);
    setCsvFileName(file.name);
    try {
      const text = await file.text();
      const parsed = buildCsvRows(text).filter((row) =>
        Object.values(row).some((value) => value.trim() !== '')
      );
      setCsvRows(parsed);
      const summary = parsed.reduce(
        (acc, row) => {
          const hasName = !!(row.firstName || row.lastName).trim();
          const hasTeam = !!row.teamName.trim();
          if (!hasName) acc.missingName += 1;
          if (!hasTeam) acc.missingTeam += 1;
          if (hasName && hasTeam) acc.ready += 1;
          acc.total += 1;
          return acc;
        },
        { total: 0, ready: 0, missingTeam: 0, missingName: 0 }
      );
      setCsvSummary(summary);
      if (!parsed.length) {
        setCsvError('No rows found in that CSV.');
      }
    } catch (err) {
      console.error('CSV parse error', err);
      setCsvError('Failed to read that CSV. Please check the file format.');
    }
  };

  const handleCsvImport = async () => {
    if (!selectedSeasonId) {
      setCsvError('Select a season above before importing.');
      return;
    }
    if (!csvRows.length) {
      setCsvError('Upload a CSV before importing.');
      return;
    }
    if (csvReplaceExisting && csvUpdateExistingContactsOnly) {
      setCsvError('Choose only one mode: Replace existing OR Update existing contacts only.');
      return;
    }
    setCsvImporting(true);
    setCsvError(null);
    setCsvImportedCount(null);
    setCsvResultMessage(null);

    try {
      if (csvReplaceExisting) {
        const { error: clearErr } = await supabase
          .from('players')
          .delete()
          .eq('season_id', selectedSeasonId);
        if (clearErr) throw clearErr;
      }

      const teamSource = allTeams.length ? allTeams : teams;
      const teamIdByName = new Map<string, string>();
      const teamByName = new Map<string, { id: string; division: string }>();
      teamSource.forEach((team) => {
        const teamKey = normalizeTeamName(team.name);
        teamIdByName.set(teamKey, team.id);
        teamByName.set(teamKey, { id: team.id, division: team.division || '' });
      });

      const csvTeamDivisions = new Map<string, string>();
      csvRows.forEach((row) => {
        if (!row.teamName || !row.division) return;
        const teamKey = normalizeTeamName(row.teamName);
        if (!teamKey) return;
        if (!csvTeamDivisions.has(teamKey)) {
          csvTeamDivisions.set(teamKey, row.division);
        }
      });

      const missingTeams = new Map<string, { name: string; division: string }>();
      const candidates = csvRows.filter((row) => {
        const hasName = !!(row.firstName || row.lastName).trim();
        const teamKey = normalizeTeamName(row.teamName);
        if (!hasName || !teamKey) return false;
        if (!teamIdByName.has(teamKey) && csvCreateTeams) {
          missingTeams.set(teamKey, { name: row.teamName, division: row.division });
        }
        return true;
      });

      if (csvCreateTeams && missingTeams.size) {
        const teamPayload = Array.from(missingTeams.values()).map((team) => {
          const payload: any = {
            name: team.name,
            season_id: selectedSeasonId,
          };
          if (hasDivisionColumn && team.division) payload.division = team.division;
          return payload;
        });

        const { data: createdTeams, error: createErr } = await supabase
          .from('teams')
          .insert(teamPayload)
          .select('id,name');
        if (createErr) throw createErr;
        (createdTeams || []).forEach((team: any) => {
          const teamKey = normalizeTeamName(team.name);
          teamIdByName.set(teamKey, team.id);
          teamByName.set(teamKey, {
            id: team.id,
            division: csvTeamDivisions.get(teamKey) || missingTeams.get(teamKey)?.division || '',
          });
        });
      }

      if (hasDivisionColumn && csvTeamDivisions.size) {
        const teamDivisionUpdates = Array.from(csvTeamDivisions.entries())
          .map(([teamKey, division]) => {
            const info = teamByName.get(teamKey);
            if (!info) return null;
            if ((info.division || '').trim()) return null;
            return { id: info.id, division, teamKey };
          })
          .filter((row): row is { id: string; division: string; teamKey: string } => !!row);
        if (teamDivisionUpdates.length) {
          const updatePayload = teamDivisionUpdates.map(({ id, division }) => ({ id, division }));
          const { error: updateErr } = await supabase
            .from('teams')
            .upsert(updatePayload, { onConflict: 'id' });
          if (updateErr) throw updateErr;
          teamDivisionUpdates.forEach((update) => {
            const info = teamByName.get(update.teamKey);
            if (info) {
              teamByName.set(update.teamKey, { ...info, division: update.division });
            }
          });
        }
      }

      if (csvTeamDivisions.size) {
        const divisionCandidates = new Map<string, string>();
        csvTeamDivisions.forEach((division) => {
          const normalized = normalizeText(division);
          if (!normalized) return;
          divisionCandidates.set(normalizeDivisionName(normalized), normalized);
        });

        if (divisionCandidates.size) {
          try {
            const { data: existingDivisions, error: divisionErr } = await supabase
              .from('divisions')
              .select('id,name')
              .eq('season_id', selectedSeasonId);
            if (divisionErr) {
              const missingTable =
                divisionErr.code === 'PGRST205' ||
                divisionErr.message?.toLowerCase?.().includes('divisions');
              if (!missingTable) throw divisionErr;
            } else {
              const existingNames = new Set(
                (existingDivisions || []).map((d: any) => normalizeDivisionName(d.name))
              );
              const newDivisions = Array.from(divisionCandidates.entries())
                .filter(([key]) => !existingNames.has(key))
                .map(([, name]) => ({
                  name,
                  description: null,
                  season_id: selectedSeasonId,
                }));
              if (newDivisions.length) {
                let createDivErr = (await supabase.from('divisions').insert(newDivisions)).error;
                if (createDivErr && supabaseAdmin) {
                  createDivErr = (await supabaseAdmin.from('divisions').insert(newDivisions)).error;
                }
                if (createDivErr) throw createDivErr;
              }
            }
          } catch (err: any) {
            console.warn('Division sync skipped', err);
            if (!csvError) {
              setCsvError(
                `Players imported, but divisions sync failed. ${err?.message || 'Check divisions insert policy.'}`
              );
            }
          }
        }
      }

      const detectPlayerContactColumns = async () => {
        const isMissingColumn = (error: any) => {
          const code = (error?.code || '').toString();
          const msg = (error?.message || '').toString().toLowerCase();
          return code === '42703' || msg.includes('column') || msg.includes('does not exist');
        };

        const run = async (client: typeof supabase) => {
          const checkColumn = async (column: 'email' | 'email_address') => {
            const { error } = await client.from('players').select(`id,${column}`).limit(1);
            if (!error) return true;
            if (isMissingColumn(error)) return false;
            throw error;
          };

          const hasEmail = await checkColumn('email');
          const hasEmailAddress = await checkColumn('email_address');
          return { hasEmail, hasEmailAddress };
        };

        try {
          return await run(supabase);
        } catch (err) {
          if (!supabaseAdmin) throw err;
          return await run(supabaseAdmin as any);
        }
      };

      const { hasEmail, hasEmailAddress } = await detectPlayerContactColumns();

      if (csvUpdateExistingContactsOnly) {
        const hasContactColumn = hasEmail || hasEmailAddress;
        if (!hasContactColumn) {
          setCsvError(
            'Players table has no email/email_address column yet. Run server/players_contact_columns.sql first.'
          );
          return;
        }

        const existingSelect = [
          'id',
          'team_id',
          'first_name',
          'last_name',
          'phone',
          'created_at',
          hasEmail ? 'email' : null,
          hasEmailAddress ? 'email_address' : null,
        ]
          .filter(Boolean)
          .join(',');

        const loadExistingPlayers = async () => {
          try {
            const { data, error } = await supabase
              .from('players')
              .select(existingSelect)
              .eq('season_id', selectedSeasonId);
            if (error) throw error;
            return data || [];
          } catch (err) {
            if (!supabaseAdmin) throw err;
            const { data, error } = await supabaseAdmin
              .from('players')
              .select(existingSelect)
              .eq('season_id', selectedSeasonId);
            if (error) throw error;
            return data || [];
          }
        };

        const existingPlayers = await loadExistingPlayers();
        const playerKey = (teamId: string, firstName: string, lastName: string) =>
          `${teamId}::${normalizeText(`${firstName || ''} ${lastName || ''}`.toLowerCase())}`;

        const byKey = new Map<string, any[]>();
        existingPlayers.forEach((player: any) => {
          const key = playerKey(player.team_id, player.first_name || '', player.last_name || '');
          if (!byKey.has(key)) byKey.set(key, []);
          byKey.get(key)!.push(player);
        });

        const updates: Array<Record<string, any>> = [];
        const touched = new Set<string>();
        let unmatchedRows = 0;
        let unchangedRows = 0;

        candidates.forEach((row) => {
          const teamKey = normalizeTeamName(row.teamName);
          const teamId = teamIdByName.get(teamKey);
          if (!teamId) {
            unmatchedRows += 1;
            return;
          }

          const firstName = row.firstName || row.lastName || 'Player';
          const lastName = row.firstName ? row.lastName : '';
          const key = playerKey(teamId, firstName, lastName);
          const matches = (byKey.get(key) || []).slice().sort((a, b) =>
            String(b.created_at || '').localeCompare(String(a.created_at || ''))
          );
          if (!matches.length) {
            unmatchedRows += 1;
            return;
          }

          const normalizedEmail = normalizeEmail(row.email || '');
          const emailValue = normalizedEmail && isValidEmail(normalizedEmail) ? normalizedEmail : null;
          const phoneValue = normalizeText(row.phone || '') || null;

          const target = matches.find((m) => !touched.has(m.id)) || matches[0];
          if (!target) {
            unmatchedRows += 1;
            return;
          }

          const nextPayload: Record<string, any> = { id: target.id };
          let hasChange = false;

          if (emailValue) {
            if (hasEmail && !((target as any).email || '').trim()) {
              nextPayload.email = emailValue;
              hasChange = true;
            }
            if (hasEmailAddress && !((target as any).email_address || '').trim()) {
              nextPayload.email_address = emailValue;
              hasChange = true;
            }
          }

          if (phoneValue && !((target as any).phone || '').trim()) {
            nextPayload.phone = phoneValue;
            hasChange = true;
          }

          touched.add(target.id);
          if (hasChange) {
            updates.push(nextPayload);
          } else {
            unchangedRows += 1;
          }
        });

        const chunkSize = 50;
        let updatedCount = 0;
        const applyUpdates = async (client: typeof supabase) => {
          for (let i = 0; i < updates.length; i += chunkSize) {
            const chunk = updates.slice(i, i + chunkSize);
            await Promise.all(
              chunk.map(async (entry) => {
                const { id, ...fields } = entry;
                if (!id || !Object.keys(fields).length) return;
                const { error: updateErr } = await client
                  .from('players')
                  .update(fields)
                  .eq('id', id)
                  .eq('season_id', selectedSeasonId);
                if (updateErr) throw updateErr;
                updatedCount += 1;
              })
            );
          }
        };

        try {
          await applyUpdates(supabase);
        } catch (err) {
          if (!supabaseAdmin) throw err;
          updatedCount = 0;
          await applyUpdates(supabaseAdmin as any);
        }

        await loadTeams();
        resetCsvState();
        setCsvImportedCount(updatedCount);
        setCsvResultMessage(
          `Updated ${updatedCount} existing players. Unmatched rows: ${unmatchedRows}. No-change rows: ${unchangedRows}.`
        );
      } else {
        const playerPayload = candidates
          .map((row) => {
            const teamKey = normalizeTeamName(row.teamName);
            const teamId = teamIdByName.get(teamKey);
            if (!teamId) return null;
            const jerseyNumber = normalizeJerseyNumberInput(row.jerseyNumberRaw);
            const birthDate = normalizeDate(row.birthDate);
            const firstName = row.firstName || row.lastName || 'Player';
            const lastName = row.firstName ? row.lastName : '';
            const normalizedEmail = normalizeEmail(row.email || '');
            const emailValue = normalizedEmail && isValidEmail(normalizedEmail) ? normalizedEmail : null;

            const payload: Record<string, any> = {
              season_id: selectedSeasonId,
              team_id: teamId,
              first_name: firstName,
              last_name: lastName || '',
              jersey_number: jerseyNumber,
              position: row.position || null,
              jersey_size: row.jerseySize || null,
              shorts_size: row.shortsSize || null,
              jersey_name: row.jerseyName || null,
              referral_source: row.referralSource || null,
              nba_comparison: row.nbaComparison || null,
              instagram: row.instagram || null,
              birth_date: birthDate,
              phone: row.phone || null,
            };

            if (hasEmail) payload.email = emailValue;
            if (hasEmailAddress) payload.email_address = emailValue;

            return payload;
          })
          .filter((row): row is Record<string, any> => !!row);

        if (!playerPayload.length) {
          setCsvError('No valid rows to import. Check for missing names or teams.');
          return;
        }

        const chunkSize = 200;
        let imported = 0;
        for (let i = 0; i < playerPayload.length; i += chunkSize) {
          const chunk = playerPayload.slice(i, i + chunkSize);
          const { error: insertErr } = await supabase.from('players').insert(chunk);
          if (insertErr) throw insertErr;
          imported += chunk.length;
        }

        await loadTeams();
        resetCsvState();
        setCsvImportedCount(imported);
        setCsvResultMessage(`Imported ${imported} players.`);
      }
    } catch (err: any) {
      console.error('CSV import failed', err);
      setCsvError(err?.message || 'Import failed. Check the CSV and try again.');
    } finally {
      setCsvImporting(false);
    }
  };

  const handleEditClick = async (team: Team) => {
    setEditingTeamId(team.id);
    setEditTeamForm({ ...team });
    setEditRoster([...players.filter((p) => p.teamId === team.id)]);
    clearNewPlayerSuggestions();
    setNewPlayerUserSearch('');
    setNewPlayerUserOptions([]);
    setNewPlayerUserLoading(false);
    setNewPlayerLinkedUser(null);
    setLogoPreview(team.logoUrl ? await signUrl(team.logoUrl, defaultLogo) : defaultLogo);
    setBannerPreview(team.bannerUrl ? await signUrl(team.bannerUrl, defaultBanner) : defaultBanner);
  };

  const getTeamPlayersCount = async (teamId: string): Promise<number> => {
    const run = async (client: any) =>
      client
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId);
    try {
      const { count, error } = await run(supabase);
      if (error) throw error;
      return count || 0;
    } catch (err) {
      if (!supabaseAdmin) throw err;
      const { count, error } = await run(supabaseAdmin);
      if (error) throw error;
      return count || 0;
    }
  };

  const formatExistingUserLabel = (option: ExistingUserOption) => {
    const name = option.displayName || option.email || `User ${option.userId.slice(0, 8)}`;
    return option.email ? `${name} (${option.email})` : `${name} (${option.userId.slice(0, 8)})`;
  };

  const clearNewPlayerSuggestions = useCallback(() => {
    setNewPlayerSuggestions([]);
    setShowNewPlayerSuggestions(false);
    setNewPlayerSuggestionLoading(false);
  }, []);

  const searchExistingPlayers = async (rawQuery: string): Promise<NewPlayerSuggestionOption[]> => {
    const term = rawQuery.trim();
    if (term.length < 2) return [];

    const tokens = term
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .slice(0, 2);
    if (!tokens.length) return [];

    const patternTokens = tokens.map((token) => `*${token.replace(/[,*]/g, '')}*`);
    const selectVariants = [
      'id,user_id,first_name,last_name,jersey_number,email,email_address,created_at',
      'id,user_id,first_name,last_name,jersey_number,email,created_at',
      'id,user_id,first_name,last_name,jersey_number,email_address,created_at',
      'id,user_id,first_name,last_name,jersey_number,created_at',
    ];

    const isMissingColumn = (error: any) => {
      const code = String(error?.code || '');
      const msg = String(error?.message || '').toLowerCase();
      return code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
    };

    const runLookup = async (client: any, select: string) => {
      const filters = [
        ...patternTokens.map((pattern) => `first_name.ilike.${pattern}`),
        ...patternTokens.map((pattern) => `last_name.ilike.${pattern}`),
      ];
      return client
        .from('players')
        .select(select)
        .or(filters.join(','))
        .order('created_at', { ascending: false })
        .limit(8);
    };

    let rows: any[] = [];
    let loaded = false;
    for (const select of selectVariants) {
      try {
        const { data, error } = await runLookup(supabase, select);
        if (!error) {
          rows = data || [];
          loaded = true;
          break;
        }
        if (!isMissingColumn(error)) throw error;
      } catch (err) {
        if (!supabaseAdmin) {
          console.warn('existing player search failed', err);
          return [];
        }
        try {
          const { data, error } = await runLookup(supabaseAdmin as any, select);
          if (!error) {
            rows = data || [];
            loaded = true;
            break;
          }
          if (!isMissingColumn(error)) throw error;
        } catch (fallbackErr) {
          console.warn('existing player search (admin) failed', fallbackErr);
          return [];
        }
      }
    }

    if (!loaded) return [];

    const deduped: NewPlayerSuggestionOption[] = [];
    const suggestionKeys = new Map<string, number>();
    (rows || []).forEach((row: any) => {
        const playerId = String(row?.id || '').trim();
        const userId = String(row?.user_id || '').trim() || null;
        const firstName = String(row?.first_name || '').trim();
        const lastName = String(row?.last_name || '').trim();
        const displayName = `${firstName} ${lastName}`.trim() || 'Player';
        const email = normalizeEmail(String(row?.email || row?.email_address || '').trim());
        const jerseyNumber =
          row?.jersey_number !== null && row?.jersey_number !== undefined
            ? String(row.jersey_number).trim()
            : '';
        if (!playerId) return;
        const option: NewPlayerSuggestionOption = {
          key: `player-${playerId}`,
          source: 'player',
          playerId,
          userId,
          displayName,
          email,
          jerseyNumber,
          subtitle: email
            ? `${email}${jerseyNumber ? ` • #${jerseyNumber}` : ''} • Existing player`
            : `${jerseyNumber ? `#${jerseyNumber} • ` : ''}Existing player`,
        };
        const dedupeKeys = [
          email ? `email:${email}` : '',
          `name:${displayName.toLowerCase()}::${jerseyNumber || 'no-number'}`,
          userId ? `user:${userId}` : '',
        ].filter(Boolean);
        const existingIndex = dedupeKeys.reduce<number>(
          (foundIndex, key) =>
            foundIndex >= 0 ? foundIndex : suggestionKeys.has(key) ? suggestionKeys.get(key)! : -1,
          -1
        );
        if (existingIndex >= 0) {
          const existing = deduped[existingIndex];
          const existingScore = (existing.email ? 2 : 0) + (existing.userId ? 1 : 0);
          const nextScore = (option.email ? 2 : 0) + (option.userId ? 1 : 0);
          if (nextScore > existingScore) {
            deduped[existingIndex] = option;
            dedupeKeys.forEach((key) => suggestionKeys.set(key, existingIndex));
          }
          return;
        }

        const nextIndex = deduped.length;
        deduped.push(option);
        dedupeKeys.forEach((key) => suggestionKeys.set(key, nextIndex));
      });

    return deduped.slice(0, 8);
  };

  const searchExistingUsers = async (rawQuery: string): Promise<ExistingUserOption[]> => {
    const cleaned = rawQuery
      .trim()
      .replace(/[^a-zA-Z0-9@._+\-\s]/g, '')
      .replace(/\s+/g, ' ');
    if (cleaned.length < 2) return [];
    const pattern = `%${cleaned}%`;

    const run = async (client: any) => {
      const { data, error } = await client
        .from('profiles')
        .select('user_id,display_name,email,email_address')
        .or(`display_name.ilike.${pattern},email.ilike.${pattern},email_address.ilike.${pattern}`)
        .limit(12);
      if (error) throw error;
      return data || [];
    };

    let rows: any[] = [];
    try {
      rows = await run(supabase);
    } catch (err) {
      if (!supabaseAdmin) {
        console.warn('site user search failed', err);
        return [];
      }
      try {
        rows = await run(supabaseAdmin as any);
      } catch (fallbackErr) {
        console.warn('site user search (admin) failed', fallbackErr);
        return [];
      }
    }

    const byId = new Map<string, ExistingUserOption>();
    (rows || []).forEach((row: any) => {
      const userId = String(row?.user_id || '').trim();
      if (!userId) return;
      const email = normalizeEmail(String(row?.email || row?.email_address || '').trim());
      const displayName = String(row?.display_name || '').trim() || email || `User ${userId.slice(0, 8)}`;
      if (!byId.has(userId)) {
        byId.set(userId, {
          userId,
          displayName,
          email,
        });
      }
    });

    return Array.from(byId.values()).slice(0, 12);
  };

  const applyNewPlayerSuggestion = useCallback((suggestion: NewPlayerSuggestionOption) => {
    const linkedUser =
      suggestion.userId
        ? {
            userId: suggestion.userId,
            displayName: suggestion.displayName,
            email: suggestion.email,
          }
        : null;

    setNewPlayer((prev) => ({
      ...prev,
      name: suggestion.displayName,
      email: suggestion.email || prev.email,
      number: prev.number || suggestion.jerseyNumber,
    }));

    if (linkedUser) {
      setNewPlayerLinkedUser(linkedUser);
      setNewPlayerUserOptions((prev) => {
        const next = prev.filter((option) => option.userId !== linkedUser.userId);
        return [linkedUser, ...next].slice(0, 12);
      });
      setNewPlayerUserSearch(linkedUser.displayName || linkedUser.email);
    } else {
      setNewPlayerLinkedUser(null);
      setNewPlayerUserSearch('');
    }

    setError(null);
    clearNewPlayerSuggestions();
  }, [clearNewPlayerSuggestions]);

  const queueNewPlayerSuggestionSearch = useCallback((rawQuery: string) => {
    const term = rawQuery.trim();
    if (newPlayerSuggestionTimerRef.current) {
      window.clearTimeout(newPlayerSuggestionTimerRef.current);
      newPlayerSuggestionTimerRef.current = null;
    }

    if (term.length < 2) {
      clearNewPlayerSuggestions();
      return;
    }

    setNewPlayerSuggestionLoading(true);
    newPlayerSuggestionTimerRef.current = window.setTimeout(async () => {
      try {
        const [playerMatches, userMatches] = await Promise.all([
          searchExistingPlayers(term),
          searchExistingUsers(term),
        ]);

        const merged = new Map<string, NewPlayerSuggestionOption>();
        playerMatches.forEach((option) => {
          const key =
            option.email ||
            `${option.displayName.toLowerCase()}::${option.jerseyNumber || 'no-number'}` ||
            option.userId ||
            option.key;
          if (!merged.has(key)) merged.set(key, option);
        });
        userMatches.forEach((option) => {
          const key = option.email || option.displayName.toLowerCase() || option.userId;
          if (merged.has(key)) return;
          merged.set(key, {
            key: `user-${option.userId}`,
            source: 'user',
            playerId: null,
            userId: option.userId,
            displayName: option.displayName,
            email: option.email,
            jerseyNumber: '',
            subtitle: option.email ? `${option.email} • Existing user` : 'Existing user',
          });
        });

        const results = Array.from(merged.values()).slice(0, 8);
        setNewPlayerSuggestions(results);
        setShowNewPlayerSuggestions(results.length > 0);
      } catch (err) {
        console.warn('new player suggestion search failed', err);
        clearNewPlayerSuggestions();
      } finally {
        setNewPlayerSuggestionLoading(false);
      }
    }, 220);
  }, [clearNewPlayerSuggestions, searchExistingUsers]);

  useEffect(() => {
    return () => {
      if (newPlayerSuggestionTimerRef.current) {
        window.clearTimeout(newPlayerSuggestionTimerRef.current);
      }
    };
  }, []);

  const lookupNewPlayerUsers = async () => {
    setNewPlayerUserLoading(true);
    try {
      const results = await searchExistingUsers(newPlayerUserSearch);
      setNewPlayerUserOptions(results);
      if (!results.length) {
        setError('No matching site users found for that search.');
      } else {
        setError(null);
      }
    } finally {
      setNewPlayerUserLoading(false);
    }
  };

  const lookupQuickEditUsers = async () => {
    setQuickEditUserLoading(true);
    try {
      const results = await searchExistingUsers(quickEditUserSearch);
      setQuickEditUserOptions(results);
      if (!results.length) {
        setError('No matching site users found for that search.');
      } else {
        setError(null);
      }
    } finally {
      setQuickEditUserLoading(false);
    }
  };

  const getTeamGamesCount = async (teamId: string): Promise<number> => {
    const run = async (client: any) =>
      client
        .from('games')
        .select('id', { count: 'exact', head: true })
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
    try {
      const { count, error } = await run(supabase);
      if (error) throw error;
      return count || 0;
    } catch (err) {
      if (!supabaseAdmin) throw err;
      const { count, error } = await run(supabaseAdmin);
      if (error) throw error;
      return count || 0;
    }
  };

  const isMissingRelationOrColumnError = (error: any) => {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();
    if (code === '42P01' || code === '42703' || code === 'PGRST205') return true;
    return (
      message.includes('does not exist') ||
      (message.includes('relation') && message.includes('does not exist')) ||
      message.includes('could not find the table')
    );
  };

  const runOptionalMergeStep = async (
    label: string,
    step: () => Promise<{ error?: any } | void>
  ) => {
    try {
      const result = await step();
      const possibleError = (result as any)?.error;
      if (possibleError) throw possibleError;
    } catch (err: any) {
      if (isMissingRelationOrColumnError(err)) {
        console.warn(`Team merge skipped optional step (${label})`, err);
        return;
      }
      throw new Error(`${label}: ${err?.message || 'failed'}`);
    }
  };

  const cleanupTeamReferencesForDelete = async (teamIds: string[]) => {
    const ids = Array.from(new Set(teamIds.filter(Boolean)));
    if (!ids.length) return;

    const client: any = supabaseAdmin || supabase;

    const { error: detachErr } = await client
      .from('players')
      .update({
        team_id: null,
        is_captain: false,
      })
      .in('team_id', ids);
    if (detachErr) throw detachErr;

    await runOptionalMergeStep('game_guest_players', () =>
      client.from('game_guest_players').delete().in('team_id', ids)
    );
    await runOptionalMergeStep('notifications', () =>
      client.from('notifications').delete().in('team_id', ids)
    );
  };

  const openTeamMergeModal = async () => {
    setTeamMergeMessage(null);
    setPendingTeamMerge({
      options: [],
      keepOptions: [],
      childTeamIds: [],
      keepTeamId: '',
      mergeTeamId: '',
      profileSourceTeamId: '',
      loading: true,
      saving: false,
      error: null,
    });

    try {
      const client: any = supabaseAdmin || supabase;
      const [teamResult, seasonResult, mergeMetaMap] = await Promise.all([
        client
          .from('teams')
          .select('id,name,division,season_id,logo_url,banner_url')
          .order('name', { ascending: true }),
        client.from('seasons').select('id,name'),
        loadTeamMergeMetadata(true).catch(() => ({})),
      ]);

      if (teamResult.error) throw teamResult.error;

      const seasonNameMap = new Map<string, string>();
      teamSeasons.forEach((season) => {
        seasonNameMap.set(season.id, season.name);
      });
      if (!seasonResult?.error) {
        (seasonResult.data || []).forEach((row: any) => {
          if (row?.id && row?.name && !seasonNameMap.has(row.id)) {
            seasonNameMap.set(row.id, row.name);
          }
        });
      }

      const options: MergeTeamOption[] = (teamResult.data || [])
        .map((row: any) => {
          const seasonId = String(row?.season_id || '').trim() || null;
          return {
            id: String(row?.id || '').trim(),
            name: String(row?.name || '').trim() || 'Team',
            division: normalizeDivisionLabel(String(row?.division || '')),
            seasonId,
            seasonLabel: seasonId ? seasonNameMap.get(seasonId) || 'Season' : 'No Season',
            logoUrl: String(row?.logo_url || ''),
            bannerUrl: String(row?.banner_url || ''),
          };
        })
        .filter((option) => option.id);

      const childTeamIds = new Set<string>();
      const normalizedMergeMeta = mergeMetaMap || {};
      Object.entries(normalizedMergeMeta).forEach(([teamId, entry]: [string, any]) => {
        const id = String(teamId || '').trim();
        if (!id) return;
        const parentTeamId = String(entry?.parentTeamId || entry?.parent_team_id || '').trim();
        if (parentTeamId) {
          childTeamIds.add(id);
        }
      });

      const keepOptions = options.filter((option) => !childTeamIds.has(option.id));

      if (!keepOptions.length || options.length < 2) {
        setPendingTeamMerge((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                error: 'Need at least 1 parent team and 2 total teams to merge.',
              }
            : prev
        );
        return;
      }

      const defaultKeepId =
        (editingTeamId && keepOptions.some((option) => option.id === editingTeamId) && editingTeamId) ||
        keepOptions[0].id;
      const defaultMergeId = options.find((option) => option.id !== defaultKeepId)?.id || '';

      setPendingTeamMerge({
        options,
        keepOptions,
        childTeamIds: Array.from(childTeamIds),
        keepTeamId: defaultKeepId,
        mergeTeamId: defaultMergeId,
        profileSourceTeamId: defaultKeepId,
        loading: false,
        saving: false,
        error: null,
      });
    } catch (err: any) {
      setPendingTeamMerge((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: err?.message || 'Failed to load team merge options.',
            }
          : prev
      );
    }
  };

  const handleTeamMergeConfirmed = async () => {
    if (!pendingTeamMerge || pendingTeamMerge.loading || pendingTeamMerge.saving) return;
    const { keepTeamId, mergeTeamId, profileSourceTeamId, options } = pendingTeamMerge;
    if (!keepTeamId || !mergeTeamId || keepTeamId === mergeTeamId) {
      setPendingTeamMerge((prev) =>
        prev
          ? {
              ...prev,
              error: 'Select different parent and duplicate teams.',
            }
          : prev
      );
      return;
    }

    const keepTeam = options.find((option) => option.id === keepTeamId) || null;
    const mergeTeam = options.find((option) => option.id === mergeTeamId) || null;
    const profileSource =
      options.find((option) => option.id === profileSourceTeamId) || keepTeam || mergeTeam || null;

    if (!keepTeam || !mergeTeam || !profileSource) {
      setPendingTeamMerge((prev) =>
        prev
          ? {
              ...prev,
              error: 'Unable to resolve selected teams.',
            }
          : prev
      );
      return;
    }

    setPendingTeamMerge((prev) =>
      prev
        ? {
            ...prev,
            saving: true,
            error: null,
          }
        : prev
    );
    setError(null);

    try {
      const client: any = supabaseAdmin || supabase;
      const mergeMetadata = await loadTeamMergeMetadata(true);
      let effectiveKeepTeam = keepTeam;
      let effectiveMergeTeam = mergeTeam;

      const initialSameSeason = (keepTeam.seasonId || '') === (mergeTeam.seasonId || '');
      const initialSameDivision =
        normalizeDivisionKey(keepTeam.division) === normalizeDivisionKey(mergeTeam.division);
      const initialShouldConsolidate = initialSameSeason && initialSameDivision;

      if (!initialShouldConsolidate) {
        const keepRootId = resolveTeamMergeRootId(mergeMetadata, keepTeam.id) || keepTeam.id;
        const mergeRootId = resolveTeamMergeRootId(mergeMetadata, mergeTeam.id) || mergeTeam.id;

        if (keepRootId === mergeRootId) {
          setPendingTeamMerge((prev) =>
            prev
              ? {
                  ...prev,
                  saving: false,
                  error: 'These teams are already linked in the same merge group.',
                }
              : prev
          );
          return;
        }

        effectiveKeepTeam = options.find((option) => option.id === keepRootId) || keepTeam;
        effectiveMergeTeam = options.find((option) => option.id === mergeRootId) || mergeTeam;
      }

      const sameSeason =
        (effectiveKeepTeam.seasonId || '') === (effectiveMergeTeam.seasonId || '');
      const sameDivision =
        normalizeDivisionKey(effectiveKeepTeam.division) ===
        normalizeDivisionKey(effectiveMergeTeam.division);
      const shouldConsolidate = sameSeason && sameDivision;
      const selectedProfileName = String(profileSource.name || keepTeam.name || 'Team').trim() || 'Team';
      const selectedProfileLogo = profileSource.logoUrl || null;
      const selectedProfileBanner = hasBannerColumn ? profileSource.bannerUrl || null : undefined;
      const selectedProfileDivision = hasDivisionColumn ? profileSource.division || null : undefined;
      const effectiveKeepTeamId = effectiveKeepTeam.id;
      const effectiveMergeTeamId = effectiveMergeTeam.id;

      const syncProfilePayload: any = {
        name: selectedProfileName,
        logo_url: selectedProfileLogo,
      };
      if (hasBannerColumn) syncProfilePayload.banner_url = selectedProfileBanner;

      const appendMetadataEntry = (
        map: TeamMergeMetadataMap,
        teamId: string,
        namesToAdd: string[],
        linkedTeamId: string,
        mode: 'profile_sync' | 'consolidate',
        finalName: string,
        parentTeamId: string | null = null
      ) => {
        const existing = map[teamId] || {
          previousNames: [],
          mergedFromTeamIds: [],
          parentTeamId: null,
          mergedAt: null,
          mode: null,
        };
        const previousNames = Array.from(
          new Set(
            [...existing.previousNames, ...namesToAdd]
              .map((name) => String(name || '').trim())
              .filter((name) => name && name.toLowerCase() !== finalName.toLowerCase())
          )
        );
        const mergedFromTeamIds = Array.from(
          new Set(
            [...existing.mergedFromTeamIds, linkedTeamId]
              .map((id) => String(id || '').trim())
              .filter(Boolean)
          )
        );
        map[teamId] = {
          previousNames,
          mergedFromTeamIds,
          parentTeamId,
          mergedAt: new Date().toISOString(),
          mode,
        };
      };

      if (shouldConsolidate) {
        const { data: involvedGames, error: involvedGamesErr } = await client
          .from('games')
          .select('id,home_team_id,away_team_id')
          .or(
            `home_team_id.eq.${effectiveKeepTeamId},away_team_id.eq.${effectiveKeepTeamId},home_team_id.eq.${effectiveMergeTeamId},away_team_id.eq.${effectiveMergeTeamId}`
          );
        if (involvedGamesErr) throw involvedGamesErr;
        const collisions = (involvedGames || []).filter(
          (row: any) =>
            (row.home_team_id === effectiveKeepTeamId && row.away_team_id === effectiveMergeTeamId) ||
            (row.home_team_id === effectiveMergeTeamId && row.away_team_id === effectiveKeepTeamId)
        );
        if (collisions.length > 0) {
          throw new Error(
            `Merge blocked: ${collisions.length} game(s) directly match these two team IDs. Reassign those games first.`
          );
        }

        const consolidatedPayload: any = {
          ...syncProfilePayload,
        };
        if (hasDivisionColumn) consolidatedPayload.division = selectedProfileDivision;

        const { error: parentProfileErr } = await client
          .from('teams')
          .update(consolidatedPayload)
          .eq('id', effectiveKeepTeamId);
        if (parentProfileErr) throw parentProfileErr;

        const { error: playerErr } = await client
          .from('players')
          .update({ team_id: effectiveKeepTeamId })
          .eq('team_id', effectiveMergeTeamId);
        if (playerErr) throw playerErr;

        const { error: gameHomeErr } = await client
          .from('games')
          .update({ home_team_id: effectiveKeepTeamId })
          .eq('home_team_id', effectiveMergeTeamId);
        if (gameHomeErr) throw gameHomeErr;

        const { error: gameAwayErr } = await client
          .from('games')
          .update({ away_team_id: effectiveKeepTeamId })
          .eq('away_team_id', effectiveMergeTeamId);
        if (gameAwayErr) throw gameAwayErr;

        await runOptionalMergeStep('game_stats', () =>
          client.from('game_stats').update({ team_id: effectiveKeepTeamId }).eq('team_id', effectiveMergeTeamId)
        );
        await runOptionalMergeStep('game_guest_players', () =>
          client.from('game_guest_players').update({ team_id: effectiveKeepTeamId }).eq('team_id', effectiveMergeTeamId)
        );
        await runOptionalMergeStep('player_season_stats', () =>
          client.from('player_season_stats').update({ team_id: effectiveKeepTeamId }).eq('team_id', effectiveMergeTeamId)
        );
        await runOptionalMergeStep('league_registrations', () =>
          client
            .from('league_registrations')
            .update({ linked_team_id: effectiveKeepTeamId })
            .eq('linked_team_id', effectiveMergeTeamId)
        );
        await runOptionalMergeStep('notifications', () =>
          client.from('notifications').update({ team_id: effectiveKeepTeamId }).eq('team_id', effectiveMergeTeamId)
        );
        await runOptionalMergeStep('team_trophy_overrides', async () => {
          const trophyColumns = [
            'champion_team_id',
            'best_offense_team_id',
            'best_defense_team_id',
            'nice_guys_team_id',
          ] as const;

          const { data, error } = await client
            .from('team_trophy_overrides')
            .select(`season_id,${trophyColumns.join(',')}`)
            .or(trophyColumns.map((column) => `${column}.eq.${effectiveMergeTeamId}`).join(','));
          if (error) return { error };

          for (const row of data || []) {
            const updatePayload: Record<string, string> = {};
            trophyColumns.forEach((column) => {
              if (row?.[column] === effectiveMergeTeamId) {
                updatePayload[column] = effectiveKeepTeamId;
              }
            });
            if (!Object.keys(updatePayload).length) continue;
            let updateQuery = client.from('team_trophy_overrides').update(updatePayload);
            if (row?.season_id) {
              updateQuery = updateQuery.eq('season_id', row.season_id);
            } else {
              updateQuery = updateQuery.is('season_id', null);
            }
            const { error: updateErr } = await updateQuery;
            if (updateErr) return { error: updateErr };
          }
          return { error: null };
        });

        const { error: deleteErr } = await client.from('teams').delete().eq('id', effectiveMergeTeamId);
        if (deleteErr) throw deleteErr;

        if (editingTeamId === effectiveMergeTeamId) {
          setEditingTeamId(null);
          setEditTeamForm(null);
          setEditRoster([]);
        }
        if (searchParams.get('team') === effectiveMergeTeamId) {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete('team');
          setSearchParams(nextParams, { replace: true });
        }
      } else {
        const { error: keepProfileErr } = await client
          .from('teams')
          .update(syncProfilePayload)
          .eq('id', effectiveKeepTeamId);
        if (keepProfileErr) throw keepProfileErr;

        const { error: mergeProfileErr } = await client
          .from('teams')
          .update(syncProfilePayload)
          .eq('id', effectiveMergeTeamId);
        if (mergeProfileErr) throw mergeProfileErr;
      }

      const keepOriginalName = String(effectiveKeepTeam.name || '').trim();
      const mergeOriginalName = String(effectiveMergeTeam.name || '').trim();
      const selectedNameLower = selectedProfileName.toLowerCase();
      const keepNameChanged = !!keepOriginalName && keepOriginalName.toLowerCase() !== selectedNameLower;
      const mergeNameChanged = !!mergeOriginalName && mergeOriginalName.toLowerCase() !== selectedNameLower;
      if (shouldConsolidate) {
        const consolidatedPreviousNames: string[] = [];
        if (keepNameChanged) consolidatedPreviousNames.push(keepOriginalName);
        if (mergeNameChanged) consolidatedPreviousNames.push(mergeOriginalName);
        if (consolidatedPreviousNames.length > 0) {
          appendMetadataEntry(
            mergeMetadata,
            effectiveKeepTeamId,
            consolidatedPreviousNames,
            effectiveMergeTeamId,
            'consolidate',
            selectedProfileName,
            null
          );
        }
        if (mergeMetadata[effectiveKeepTeamId]) {
          mergeMetadata[effectiveKeepTeamId] = {
            ...mergeMetadata[effectiveKeepTeamId],
            parentTeamId: null,
          };
        }
        delete mergeMetadata[effectiveMergeTeamId];
      } else {
        if (keepNameChanged) {
          appendMetadataEntry(
            mergeMetadata,
            effectiveKeepTeamId,
            [keepOriginalName],
            effectiveMergeTeamId,
            'profile_sync',
            selectedProfileName,
            null
          );
        } else if (mergeMetadata[effectiveKeepTeamId]) {
          mergeMetadata[effectiveKeepTeamId] = {
            ...mergeMetadata[effectiveKeepTeamId],
            parentTeamId: null,
          };
        }
        if (mergeNameChanged) {
          appendMetadataEntry(
            mergeMetadata,
            effectiveMergeTeamId,
            [mergeOriginalName],
            effectiveKeepTeamId,
            'profile_sync',
            selectedProfileName,
            effectiveKeepTeamId
          );
        } else {
          mergeMetadata[effectiveMergeTeamId] = {
            ...(mergeMetadata[effectiveMergeTeamId] || {
              previousNames: [],
              mergedFromTeamIds: [],
              mergedAt: null,
              mode: 'profile_sync',
            }),
            parentTeamId: effectiveKeepTeamId,
            mode: 'profile_sync',
            mergedAt: new Date().toISOString(),
          };
        }
      }
      await saveTeamMergeMetadata(mergeMetadata, true);
      setTeamMergeMetaById(mergeMetadata);

      setPendingTeamMerge(null);
      setTeamMergeMessage(
        shouldConsolidate
          ? `"${effectiveMergeTeam.name}" was consolidated into "${effectiveKeepTeam.name}" and removed.`
          : `"${effectiveKeepTeam.name}" and "${effectiveMergeTeam.name}" were profile-synced. No team was deleted because they are from different seasons/divisions.`
      );
      await loadTeams();
    } catch (err: any) {
      setPendingTeamMerge((prev) =>
        prev
          ? {
              ...prev,
              saving: false,
              error: err?.message || 'Failed to merge teams.',
            }
          : prev
      );
      setTeamMergeMessage(null);
      return;
    }

  };

  const openTeamDeleteConfirm = async (team: Team) => {
    setPendingTeamDelete({
      team,
      playersCount: 0,
      gamesCount: 0,
      checking: true,
      error: null,
    });
    try {
      const [playersCount, gamesCount] = await Promise.all([
        getTeamPlayersCount(team.id),
        getTeamGamesCount(team.id),
      ]);
      setPendingTeamDelete((prev) => {
        if (!prev || prev.team.id !== team.id) return prev;
        return {
          ...prev,
          playersCount,
          gamesCount,
          checking: false,
          error: null,
        };
      });
    } catch (err: any) {
      setPendingTeamDelete((prev) => {
        if (!prev || prev.team.id !== team.id) return prev;
        return {
          ...prev,
          checking: false,
          error: err?.message || 'Failed to run safety checks.',
        };
      });
    }
  };

  const handleDeleteTeamConfirmed = async () => {
    if (!pendingTeamDelete) return;
    const teamId = pendingTeamDelete.team.id;
    setDeletingTeam(true);
    setError(null);
    try {
      const [playersCount, gamesCount] = await Promise.all([
        getTeamPlayersCount(teamId),
        getTeamGamesCount(teamId),
      ]);
      if (gamesCount > 0) {
        setPendingTeamDelete((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            playersCount,
            gamesCount,
            checking: false,
            error: 'Delete blocked: remove linked games first.',
          };
        });
        return;
      }

      await cleanupTeamReferencesForDelete([teamId]);
      const client: any = supabaseAdmin || supabase;
      const { error: deleteErr } = await client.from('teams').delete().eq('id', teamId);
      if (deleteErr) throw deleteErr;

      setPendingTeamDelete(null);
      await loadTeams();
    } catch (err: any) {
      setPendingTeamDelete((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          error: err?.message || 'Failed to delete team.',
        };
      });
    } finally {
      setDeletingTeam(false);
    }
  };

  const handleSave = async () => {
    if (!editTeamForm) return;
    if (editingPlayerId) {
      await handleSavePlayerNumber();
    }

    if (editRoster.length === 0) {
      setTeamEditorRosterWarning({
        title: 'Last Player Cannot Be Removed',
        description: 'A team cannot be saved with zero players on the roster.',
        body: 'Add another player first, or keep at least one player on the team before clicking Save Changes.',
      });
      return;
    }

    if (!editRoster.some((player) => !!player.isCaptain)) {
      setTeamEditorRosterWarning({
        title: 'Captain Required',
        description: 'Every team must have a captain before changes can be saved.',
        body: 'Assign the captain crown to one player on this roster, then save again.',
      });
      return;
    }

    try {
      setSaving(true);
      setError(null);
      let inviteErrorMessage: string | null = null;
      const writeClient: any = supabaseAdmin || supabase;

      let teamId = editTeamForm.id;
      if (editTeamForm.id === 'new') {
        const payload: any = {
          name: editTeamForm.name,
          logo_url: editTeamForm.logoUrl || null,
        };
        if (hasBannerColumn) payload.banner_url = editTeamForm.bannerUrl || null;
        if (hasDivisionColumn) payload.division = editTeamForm.division;
        const { data: inserted, error: insTeamErr } = await writeClient
          .from('teams')
          .insert(payload)
          .select('id')
          .single();
        if (insTeamErr) throw insTeamErr;
        teamId = inserted.id;
      } else {
        const { error: teamErr } = await writeClient
          .from('teams')
          .update({
            name: editTeamForm.name,
            logo_url: editTeamForm.logoUrl || null,
            banner_url: hasBannerColumn ? editTeamForm.bannerUrl || null : null,
            division: hasDivisionColumn ? editTeamForm.division : null,
          })
          .eq('id', editTeamForm.id);
        if (teamErr) throw teamErr;
      }

      if (editRoster.length > 0) {
        const emailCache = new Map<string, { userId: string | null; invited: boolean }>();
        const seasonIdForCheck = editTeamForm.seasonId || selectedSeasonId || null;
        const playerColumnSet = new Set(playerSelectColumnsRef.current || []);
        const hasEmailColumn = playerColumnSet.has('email');
        const hasEmailAddressColumn = playerColumnSet.has('email_address');

        const resolvedRoster = await Promise.all(
          editRoster.map(async (p) => {
            const normalizedEmail = normalizeEmail(p.email || '');
            if (p.isGuest) {
              return { ...p, email: normalizedEmail || p.email || null, userId: null, invited: false };
            }
            let resolvedUserId = p.userId || null;
            let invited = false;

            if (!resolvedUserId && normalizedEmail) {
              if (emailCache.has(normalizedEmail)) {
                const cached = emailCache.get(normalizedEmail)!;
                resolvedUserId = cached.userId;
                invited = cached.invited;
              } else {
                const existingUserId = await findUserIdByEmail(normalizedEmail);
                if (existingUserId) {
                  resolvedUserId = existingUserId;
                }
                emailCache.set(normalizedEmail, { userId: resolvedUserId, invited });
              }
            }

            return { ...p, email: normalizedEmail || p.email || null, userId: resolvedUserId, invited };
          })
        );

        // Ensure no duplicate emails/userIds in the pending roster
        const seenEmails = new Set<string>();
        const seenUsers = new Set<string>();
        for (const p of resolvedRoster) {
          if (p.email) {
            if (seenEmails.has(p.email)) {
              setError(`Duplicate email in roster: ${p.email}`);
              setSaving(false);
              return;
            }
            seenEmails.add(p.email);
          }
          if (p.userId) {
            if (seenUsers.has(p.userId)) {
              setError('Same account added twice in this roster.');
              setSaving(false);
              return;
            }
            seenUsers.add(p.userId);
          }
        }

        // Prevent duplicate roster spots in the same season/division for the same user
        if (seasonIdForCheck) {
          const userIdsToCheck = Array.from(
            new Set(resolvedRoster.map((p) => p.userId).filter((id): id is string => !!id))
          );
          if (userIdsToCheck.length) {
            const { data: conflicts, error: conflictErr } = await supabase
              .from('players')
              .select('id,user_id,team_id,teams:team_id(division)')
              .eq('season_id', seasonIdForCheck)
              .in('user_id', userIdsToCheck)
              .neq('team_id', teamId);
            if (conflictErr) throw conflictErr;
            if (conflicts && conflicts.length) {
              const teamDivisionMap: Record<string, string> = {};
              teams.forEach((t) => (teamDivisionMap[t.id] = (t.division || '').toLowerCase()));
              const targetDiv = (editTeamForm.division || '').toLowerCase();
              const blocking = conflicts.filter((c: any) => {
                const otherDiv =
                  (c as any)?.teams?.division?.toLowerCase?.() ||
                  teamDivisionMap[c.team_id] ||
                  '';
                if (!targetDiv) return true; // if target has no division, be strict
                return otherDiv === targetDiv;
              });
              if (blocking.length) {
                const conflictNames = blocking
                  .map((c: any) => {
                    const match = resolvedRoster.find((p) => p.userId === c.user_id);
                    return match ? match.name : `User ${String(c.user_id).slice(0, 8)}?`;
                  })
                  .join(', ');
                setError(
                  `Already rostered this season/division: ${conflictNames}. Remove from their current team first.`
                );
                setSaving(false);
                return;
              }
            }
          }
        }

        const payload = resolvedRoster.map((p) => {
          const parts = p.name.trim().split(' ');
          const first = parts.shift() || p.name || 'Player';
          const last = parts.join(' ');
          const jerseyNumber =
            p.number === '' || p.number === null || p.number === undefined
              ? null
              : normalizeJerseyNumberInput(p.number);
          return {
            // Preserve player id if it exists so we can upsert without losing fields
            ...(p.id && !p.id.startsWith('p_') ? { id: p.id } : {}),
            team_id: teamId,
            season_id: editTeamForm.seasonId || null,
            ...(p.userId ? { user_id: p.userId } : {}),
            first_name: first,
            last_name: last || '',
            jersey_number: jerseyNumber,
            ...(hasEmailColumn ? { email: normalizeEmail(p.email || '') || null } : {}),
            ...(hasEmailAddressColumn ? { email_address: normalizeEmail(p.email || '') || null } : {}),
            ...(hasCaptainColumn ? { is_captain: p.isCaptain ?? false } : {}),
            is_guest: !!p.isGuest,
          };
        });
        const keepIds = payload
          .map((p) => (p as any).id)
          .filter((id): id is string => !!id);
        const existingIds = players
          .filter(
            (p) =>
              p.teamId === editTeamForm.id &&
              (seasonIdForCheck ? (p.seasonId || null) === seasonIdForCheck : true) &&
              !p.id.startsWith('p_')
          )
          .map((p) => p.id);
        const toDelete = existingIds.filter((id) => !keepIds.includes(id));
        if (toDelete.length) {
          const captainDeletion = players.find((player) => toDelete.includes(player.id) && !!player.isCaptain);
          if (captainDeletion) {
            const captainName = String(captainDeletion.name || '').trim() || 'this player';
            setTeamEditorRosterWarning({
              title: 'Captain Cannot Be Removed',
              description: 'Team captain records cannot be removed from this screen without reassigning captain first.',
              body: `${captainName} is currently the team captain. Assign the captain crown to another player first, then remove this player if needed.`,
            });
            setSaving(false);
            return;
          }
        }
        const existingPayload = payload.filter((p) => (p as any).id);
        const newPayload = payload.filter((p) => !(p as any).id);
        let insertedRowsByEmail = new Map<string, { id: string | null }>();
        if (newPayload.length) {
          const selectFields = ['id'];
          if (hasEmailColumn) selectFields.push('email');
          if (hasEmailAddressColumn) selectFields.push('email_address');
          const { data: insertedRows, error: insertErr } = await writeClient
            .from('players')
            .insert(newPayload)
            .select(selectFields.join(','));
          if (insertErr) throw insertErr;
          insertedRowsByEmail = new Map();
          (insertedRows || []).forEach((row: any) => {
            const normalizedEmail = normalizeEmail(
              String(row?.email || row?.email_address || '').trim()
            );
            if (!normalizedEmail) return;
            insertedRowsByEmail.set(normalizedEmail, { id: row?.id || null });
          });
        }
        if (existingPayload.length) {
          const { error: upErr } = await writeClient.from('players').upsert(existingPayload, { onConflict: 'id' });
          if (upErr) throw upErr;
        }
        if (toDelete.length) {
          const { data: deletedRows, error: delErr } = await writeClient
            .from('players')
            .delete()
            .in('id', toDelete)
            .select('id');
          if (delErr) throw delErr;
          const deletedIds = new Set((deletedRows || []).map((row: any) => row?.id).filter(Boolean));
          if (deletedIds.size !== toDelete.length) {
            const { data: remainingRows, error: remainingErr } = await writeClient
              .from('players')
              .select('id')
              .in('id', toDelete);
            if (remainingErr) throw remainingErr;
            if ((remainingRows || []).length) {
              throw new Error('Some players could not be removed from the team. Please try again.');
            }
          }
        }

        let inviteSentCount = 0;
        let inviteSendFailure = '';
        const teamCode = String((editTeamForm as any)?.shortName || '').trim().toUpperCase() || null;
        const seasonNameForInvite =
          editTeamForm.seasonId
            ? teamSeasons.find((s) => s.id === editTeamForm.seasonId)?.name || 'Current Season'
            : 'Current Season';
        for (const p of resolvedRoster) {
          const normalizedEmail = normalizeEmail(p.email || '');
          if (!normalizedEmail || p.isGuest) continue;
          const previous = players.find((prev) => prev.id === p.id);
          const isNew = !previous || String(p.id).startsWith('p_');
          const shouldSendInvite = isNew && !p.userId;
          if (!shouldSendInvite) continue;

          try {
            await sendPlayerClaimEmail({
              playerId: isNew ? insertedRowsByEmail.get(normalizedEmail)?.id || null : p.id,
              email: normalizedEmail,
              playerName: p.name || 'Player',
              teamName: editTeamForm.name || 'Courtsight League',
              teamId,
              teamCode,
              seasonName: seasonNameForInvite,
              inviteLink: buildPlayerPortalUrl(teamId, normalizedEmail, teamCode),
              createdBy: 'admin-team-editor',
              deliveryMode: 'portal_registration',
            });
            inviteSentCount += 1;
          } catch (sendErr: any) {
            console.warn('team roster invite email failed', normalizedEmail, sendErr);
            if (!inviteSendFailure) {
              inviteSendFailure = String(sendErr?.message || '').trim();
            }
          }
        }

        const notifications: any[] = [];
        const notifiedUserIds = new Set<string>();
        const seasonName = editTeamForm.seasonId
          ? teamSeasons.find((s) => s.id === editTeamForm.seasonId)?.name || 'Current Season'
          : 'Current Season';
        const divisionLabel = editTeamForm.division ? editTeamForm.division : null;
        resolvedRoster.forEach((p) => {
          if (!p.userId || (p as any).invited) return;
          const previous = players.find((prev) => prev.id === p.id);
          const isNew = !previous || String(p.id).startsWith('p_');
          const previousUserId = (previous as any)?.userId || null;
          if (!isNew && previousUserId) return;
          if (notifiedUserIds.has(p.userId)) return;

          notifications.push({
            userId: p.userId,
            role: null,
            teamId,
            title: 'Added to Team',
            body: `You were added to ${editTeamForm.name} — ${seasonName}${
              divisionLabel ? ` • ${divisionLabel}` : ''
            }.`,
            link: '/my-team',
            metadata: {
              teamId,
              seasonId: editTeamForm.seasonId || null,
              seasonName,
              division: divisionLabel,
              source: 'admin-roster',
            },
          });
          notifiedUserIds.add(p.userId);
        });
        if (notifications.length) {
          try {
            await createNotifications(notifications);
          } catch (err) {
            console.warn('notify roster add failed', err);
          }
        }

        if (inviteSendFailure) {
          const summary = `Roster saved, but ${inviteSentCount ? 'some' : 'all'} invite emails failed to send.`;
          inviteErrorMessage = inviteErrorMessage
            ? `${inviteErrorMessage} | ${summary}${inviteSendFailure ? ` First email error: ${inviteSendFailure}` : ''}`
            : `${summary}${inviteSendFailure ? ` First email error: ${inviteSendFailure}` : ''}`;
        }
      }

      await loadTeams();
      setEditingTeamId(null);
      setEditTeamForm(null);
      setEditRoster([]);
      setNewPlayer({ name: '', number: '', email: '' });
      setNewPlayerUserSearch('');
      setNewPlayerUserOptions([]);
      setNewPlayerUserLoading(false);
      setNewPlayerLinkedUser(null);
      if (inviteErrorMessage) {
        setError(inviteErrorMessage);
      }
    } catch (err: any) {
      console.error('Save team error', err);
      setError(err?.message || 'Failed to save team.');
    } finally {
      setSaving(false);
    }
  };

  const uploadImageFile = async (file: File, type: 'logo' | 'banner') => {
    if (!editTeamForm) return;
    try {
      setSaving(true);
      setError(null);
      const path = `teams/${editTeamForm.id}/${type}-${Date.now()}-${file.name}`;
      const { data, error: uploadErr } = await supabase.storage
        .from('team-assets')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const signedUrl = await signUrl(data.path);
      const isLogo = type === 'logo';
      setEditTeamForm({
        ...editTeamForm,
        [isLogo ? 'logoUrl' : 'bannerUrl']: data.path,
      });
      if (isLogo) {
        setLogoPreview(signedUrl);
      } else {
        setBannerPreview(signedUrl);
      }
    } catch (err: any) {
      console.error('Upload error', err);
      setError('Upload failed. Ensure storage bucket "team-assets" allows uploads.');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleImageSelection = (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'banner') => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    const aspect = type === 'logo' ? 1 : 4;
    const previewUrl = URL.createObjectURL(file);
    setCroppingState({
      file,
      src: previewUrl,
      type,
      aspect,
    });
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    e.target.value = '';
  };

  const handleCropSave = async () => {
    if (!croppingState || !croppedAreaPixels) return;
    let croppedBlob: Blob;
    try {
      croppedBlob = await getCroppedImageBlob(croppingState.src, croppedAreaPixels);
    } catch (err: any) {
      console.error('Crop extraction failed', err);
      setError('Unable to crop the selected area. Please try again.');
      return;
    }
    const baseName = croppingState.file.name.replace(/\.[^.]+$/, '') || 'cropped';
    const croppedFile = new File([croppedBlob], `${baseName}.png`, { type: 'image/png' });
    try {
      await uploadImageFile(croppedFile, croppingState.type);
      handleCropCancel();
    } catch {
      // uploadImageFile sets the user-facing error message
    }
  };

  const handleUseOriginal = async () => {
    if (!croppingState) return;
    try {
      await uploadImageFile(croppingState.file, croppingState.type);
      handleCropCancel();
    } catch {
      // uploadImageFile already handles errors
    }
  };


  const toggleCaptain = (playerId: string) => {
    setEditRoster((prev) => {
      const target = prev.find((p) => p.id === playerId);
      if (!target) return prev;
      const willBeCaptain = !target.isCaptain;
      // If turning someone on, turn all others off
      if (willBeCaptain) {
        return prev.map((p) => ({ ...p, isCaptain: p.id === playerId }));
      }
      // If turning off, just unset this one
      return prev.map((p) => (p.id === playerId ? { ...p, isCaptain: false } : p));
    });
  };

  const startEditingPlayerNumber = (player: RosterPlayer) => {
    setEditingPlayerId(player.id);
    setEditingPlayerNumber(String(player.number || ''));
  };

  const cancelEditingPlayerNumber = () => {
    setEditingPlayerId(null);
    setEditingPlayerNumber('');
  };

  const handleSavePlayerNumber = async () => {
    if (!editingPlayerId) return;
    if (playerNumberSavingId === editingPlayerId) return;
    const normalized = normalizeJerseyNumberInput(editingPlayerNumber);
    if (!normalized) {
      setError('Jersey number is required.');
      return;
    }
    const existing = editRoster.find((p) => p.id === editingPlayerId);
    const existingDigits =
      normalizeJerseyNumberInput(String(existing?.number ?? '')) || '';
    if (existingDigits === (normalized || '')) {
      cancelEditingPlayerNumber();
      return;
    }
    setPlayerNumberSavingId(editingPlayerId);
    console.log('supabase payload', { id: editingPlayerId, jersey_number: normalized });
    try {
      const { error } = await supabase
        .from('players')
        .update({ jersey_number: normalized ?? null })
        .eq('id', editingPlayerId);
      if (error) throw error;
      setEditRoster((prev) =>
        prev.map((p) => (p.id === editingPlayerId ? { ...p, number: normalized ?? null } : p))
      );
    } catch (err: any) {
      console.error('Save player number failed', err);
      setError('Unable to save player number. Please try again.');
    } finally {
      setPlayerNumberSavingId(null);
      cancelEditingPlayerNumber();
    }
  };

  const handlePlayerNumberKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSavePlayerNumber();
    } else if (event.key === 'Escape') {
      cancelEditingPlayerNumber();
    }
  };

  const removePlayerConfirmed = (playerId: string) => {
    const targetPlayer = editRoster.find((p) => p.id === playerId);
    setPendingPlayerDelete(null);
    if (!targetPlayer) return;

    if (editRoster.length <= 1) {
      setTeamEditorRosterWarning({
        title: 'Last Player Cannot Be Removed',
        description: 'A team cannot be left with zero players.',
        body: 'This is the last player on the roster. Add another player first before removing this one.',
      });
      return;
    }

    if (targetPlayer.isCaptain) {
      const playerName = String(targetPlayer.name || '').trim() || 'this player';
      setTeamEditorRosterWarning({
        title: 'Captain Cannot Be Removed',
        description: 'Team captain records cannot be removed from this screen without reassigning captain first.',
        body: `${playerName} is currently the team captain. Assign the captain crown to another player first, then remove this player if needed.`,
      });
      return;
    }

    setEditRoster((prev) => prev.filter((p) => p.id !== playerId));
  };

  const closeQuickEditPlayer = () => {
    setQuickEditPlayerId(null);
    setQuickEditPlayerRow(null);
    setQuickEditPlayerLoading(false);
    setQuickEditPlayerSaving(false);
    setQuickEditFirstName('');
    setQuickEditLastName('');
    setQuickEditJerseyNumber('');
    setQuickEditJerseyName('');
    setQuickEditUserSearch('');
    setQuickEditUserOptions([]);
    setQuickEditUserLoading(false);
    setQuickEditLinkedUser(null);
    setQuickEditLinkDirty(false);
  };

  const openQuickEditPlayer = async (player: RosterPlayer) => {
    if (!player?.id) return;
    setError(null);
    setQuickEditPlayerId(player.id);
    setQuickEditUserSearch('');
    setQuickEditUserOptions([]);
    setQuickEditLinkDirty(false);

    // If this is a not-yet-saved roster entry, just use local values.
    if (String(player.id).startsWith('p_')) {
      const parts = (player.name || '').trim().split(' ').filter(Boolean);
      const first = parts.shift() || '';
      const last = parts.join(' ') || '';
      setQuickEditPlayerRow({});
      setQuickEditFirstName(first);
      setQuickEditLastName(last);
      setQuickEditJerseyNumber(String(player.number || ''));
      setQuickEditJerseyName('');
      if (player.userId) {
        setQuickEditLinkedUser({
          userId: player.userId,
          displayName: player.name || 'Player',
          email: normalizeEmail(player.email || ''),
        });
      } else {
        setQuickEditLinkedUser(null);
      }
      return;
    }

    setQuickEditPlayerLoading(true);
    try {
      const { data, error } = await supabase.from('players').select('*').eq('id', player.id).single();
      if (error) throw error;
      setQuickEditPlayerRow(data || {});

      const firstName = String((data as any)?.first_name ?? '').trim();
      const lastName = String((data as any)?.last_name ?? '').trim();
      setQuickEditFirstName(firstName);
      setQuickEditLastName(lastName);
      setQuickEditJerseyNumber(
        (data as any)?.jersey_number != null ? String((data as any).jersey_number) : String(player.number || '')
      );
      setQuickEditJerseyName(String((data as any)?.jersey_name ?? '').trim());
      const linkedUserId = String((data as any)?.user_id || '').trim();
      const linkedEmail = normalizeEmail(String((data as any)?.email || (data as any)?.email_address || '').trim());
      if (linkedUserId) {
        setQuickEditLinkedUser({
          userId: linkedUserId,
          displayName:
            [firstName, lastName].filter(Boolean).join(' ').trim() ||
            player.name ||
            linkedEmail ||
            `User ${linkedUserId.slice(0, 8)}`,
          email: linkedEmail,
        });
      } else {
        setQuickEditLinkedUser(null);
      }
    } catch (err: any) {
      console.error('load player for quick edit failed', err);
      setError(err?.message || 'Unable to load player info.');
      // Fall back to local roster values
      const parts = (player.name || '').trim().split(' ').filter(Boolean);
      const first = parts.shift() || '';
      const last = parts.join(' ') || '';
      setQuickEditPlayerRow({});
      setQuickEditFirstName(first);
      setQuickEditLastName(last);
      setQuickEditJerseyNumber(String(player.number || ''));
      setQuickEditJerseyName('');
      if (player.userId) {
        setQuickEditLinkedUser({
          userId: player.userId,
          displayName: player.name || 'Player',
          email: normalizeEmail(player.email || ''),
        });
      } else {
        setQuickEditLinkedUser(null);
      }
    } finally {
      setQuickEditPlayerLoading(false);
    }
  };

  const saveQuickEditPlayer = async () => {
    if (!quickEditPlayerId) return;
    if (quickEditPlayerSaving) return;

    const normalizedNumber = normalizeJerseyNumberInput(quickEditJerseyNumber);
    if (!normalizedNumber) {
      setError('Jersey number is required.');
      return;
    }
    const nextFirst = quickEditFirstName.trim();
    const nextLast = quickEditLastName.trim();
    const linkedUserId = quickEditLinkedUser?.userId?.trim() || null;
    const linkedEmail = normalizeEmail(quickEditLinkedUser?.email || '');

    // Update local-only roster entries
    if (String(quickEditPlayerId).startsWith('p_')) {
      const nextName = [nextFirst, nextLast].filter(Boolean).join(' ').trim() || 'Player';
      setEditRoster((prev) => {
        const updated = prev.map((p) =>
          p.id === quickEditPlayerId
            ? {
                ...p,
                name: nextName,
                number: normalizedNumber ?? null,
                userId: linkedUserId,
                email: linkedEmail || null,
              }
            : p
        );
        return updated.sort((a, b) => {
          const an = Number(normalizeJerseyNumberInput(String(a.number ?? '')) ?? 9999);
          const bn = Number(normalizeJerseyNumberInput(String(b.number ?? '')) ?? 9999);
          return an - bn;
        });
      });
      closeQuickEditPlayer();
      return;
    }

    setQuickEditPlayerSaving(true);
    setError(null);
    try {
      const row = quickEditPlayerRow || {};
      const payload: Record<string, any> = {};

      if (Object.prototype.hasOwnProperty.call(row, 'first_name')) payload.first_name = nextFirst || 'Player';
      if (Object.prototype.hasOwnProperty.call(row, 'last_name')) payload.last_name = nextLast || '';
      if (Object.prototype.hasOwnProperty.call(row, 'jersey_number')) payload.jersey_number = normalizedNumber ?? null;

      // Optional fields (only if the column exists on this project)
      if (Object.prototype.hasOwnProperty.call(row, 'jersey_name')) {
        payload.jersey_name = quickEditJerseyName.trim() || null;
      }
      if (quickEditLinkDirty) {
        if (Object.prototype.hasOwnProperty.call(row, 'user_id')) payload.user_id = linkedUserId;
        if (Object.prototype.hasOwnProperty.call(row, 'email')) payload.email = linkedEmail || null;
        if (Object.prototype.hasOwnProperty.call(row, 'email_address')) {
          payload.email_address = linkedEmail || null;
        }
      }

      if (!Object.keys(payload).length) {
        closeQuickEditPlayer();
        return;
      }

      const { error } = await supabase.from('players').update(payload).eq('id', quickEditPlayerId);
      if (error) throw error;

      const nextName = [nextFirst, nextLast].filter(Boolean).join(' ').trim() || 'Player';

      // Update both the editor roster and the global players list so previews stay consistent.
      setEditRoster((prev) => {
        const updated = prev.map((p) =>
          p.id === quickEditPlayerId
            ? {
                ...p,
                name: nextName,
                number: normalizedNumber ?? null,
                ...(quickEditLinkDirty ? { userId: linkedUserId, email: linkedEmail || null } : {}),
              }
            : p
        );
        return updated.sort((a, b) => {
          const an = Number(normalizeJerseyNumberInput(String(a.number ?? '')) ?? 9999);
          const bn = Number(normalizeJerseyNumberInput(String(b.number ?? '')) ?? 9999);
          return an - bn;
        });
      });
      setPlayers((prev) =>
        prev.map((p) =>
          p.id === quickEditPlayerId
            ? {
                ...p,
                name: nextName,
                number: normalizedNumber ?? null,
                ...(quickEditLinkDirty ? { userId: linkedUserId, email: linkedEmail || null } : {}),
              }
            : p
        )
      );

      closeQuickEditPlayer();
    } catch (err: any) {
      console.error('save player quick edit failed', err);
      setError(err?.message || 'Unable to save player info.');
    } finally {
      setQuickEditPlayerSaving(false);
    }
  };

  const addPlayer = () => {
    if (!editTeamForm) return;
    const selectedUser = newPlayerLinkedUser;
    const linkedEmail = normalizeEmail(selectedUser?.email || '');
    const cleanedName = (newPlayer.name || selectedUser?.displayName || '').trim();
    const cleanedNumber = newPlayer.number.trim();
    const cleanedEmail = normalizeEmail(newPlayer.email || linkedEmail);

    if (!cleanedName || !cleanedNumber) {
      setError('Player name and jersey # are required.');
      return;
    }
    if (cleanedEmail && !isValidEmail(cleanedEmail)) {
      setError('Enter a valid player email to send an invite.');
      return;
    }

    setError(null);
    const player: RosterPlayer = {
      id: `p_${Date.now()}`,
      teamId: editTeamForm.id,
      seasonId: editTeamForm.seasonId || null,
      name: cleanedName,
      number: cleanedNumber,
      isCaptain: false,
      email: cleanedEmail || null,
      userId: selectedUser?.userId || null,
      isGuest: false,
    };
    setEditRoster((prev) => [...prev, player]);
    setNewPlayer({ name: '', number: '', email: '' });
    clearNewPlayerSuggestions();
    setNewPlayerUserSearch('');
    setNewPlayerUserOptions([]);
    setNewPlayerUserLoading(false);
    setNewPlayerLinkedUser(null);
  };

  const loadTeams = async () => {
    setLoading(true);
    try {
      if (!selectedSeasonId) {
        setTeams([]);
        setAllTeams([]);
        setTeamMergeMetaById({});
        setDivisionOptions(['all']);
        setSelectedDivision('all');
        setLoading(false);
        return;
      }
      const loadPlayersWithSchemaFallback = async () => {
        let columns =
          playerSelectColumnsRef.current || [
            'id',
            'team_id',
            'season_id',
            'first_name',
            'last_name',
            'jersey_number',
            'is_captain',
            'user_id',
            'email',
            'email_address',
            'is_guest',
            'avatar_url',
            'photo_url',
          ];
        let attempts = 0;
        while (attempts < 8) {
          attempts += 1;
          const { data, error } = await supabase
            .from('players')
            .select(columns.join(','))
            .eq('season_id', selectedSeasonId);
          if (!error) {
            playerSelectColumnsRef.current = columns;
            return {
              rows: data || [],
              hasCaptain: columns.includes('is_captain'),
            };
          }
          const msg = String(error?.message || '').toLowerCase();
          const missingColumnMatch = msg.match(/column\s+players\.([a-z0-9_]+)\s+does not exist/);
          const missingColumn = missingColumnMatch?.[1];
          if (error?.code === '42703' && missingColumn && columns.includes(missingColumn)) {
            columns = columns.filter((col) => col !== missingColumn);
            continue;
          }
          throw error;
        }
        return { rows: [], hasCaptain: true };
      };

      const loadSeasonTeams = async () => {
        const withShortName = await supabase
          .from('teams')
          .select('id,name,logo_url,banner_url,division,season_id,short_name')
          .eq('season_id', selectedSeasonId);
        if (!withShortName.error) {
          const ensured = await ensureJoinCodesForTeams(withShortName.data || []);
          return ensured;
        }

        const msg = String(withShortName.error?.message || '').toLowerCase();
        const code = String(withShortName.error?.code || '').toUpperCase();
        const shortNameMissing =
          code === '42703' || (msg.includes('short_name') && msg.includes('column'));
        if (!shortNameMissing) throw withShortName.error;

        const fallback = await supabase
          .from('teams')
          .select('id,name,logo_url,banner_url,division,season_id')
          .eq('season_id', selectedSeasonId);
        if (fallback.error) throw fallback.error;
        return fallback.data || [];
      };

      const [teamRows, gamesResponse, playersResult, mergeMetadata] = await Promise.all([
        loadSeasonTeams(),
        supabase
          .from('games')
          .select('home_team_id,away_team_id,home_score,away_score')
          .eq('season_id', selectedSeasonId)
          .in('status', ['COMPLETED', 'completed']),
        loadPlayersWithSchemaFallback(),
        loadTeamMergeMetadata(true).catch((err) => {
          console.warn('Load team merge metadata failed', err);
          return null;
        }),
      ]);
      const { data: gameRows, error: gameErr } = gamesResponse;
      if (gameErr) throw gameErr;
      const playerRows = playersResult.rows;
      if (mergeMetadata) {
        setTeamMergeMetaById(mergeMetadata);
      }
      setHasBannerColumn(true);
      setHasDivisionColumn(true);

      let configuredDivisions: string[] = [];
      try {
        const { data: divisionRows, error: divisionErr } = await supabase
          .from('divisions')
          .select('name')
          .eq('season_id', selectedSeasonId)
          .order('name', { ascending: true });
        if (divisionErr) throw divisionErr;
        configuredDivisions = Array.from(
          new Set(
            (divisionRows || [])
              .map((row: any) => String(row.name || '').trim())
              .filter(Boolean)
          )
        );
      } catch (divisionLoadErr) {
        console.warn('Load divisions for team filter failed', divisionLoadErr);
      }
      setHasCaptainColumn(playersResult.hasCaptain);

      const records: Record<string, { w: number; l: number }> = {};
      (gameRows || []).forEach((g: any) => {
        const homeWin = (g.home_score ?? 0) > (g.away_score ?? 0);
        const awayWin = (g.away_score ?? 0) > (g.home_score ?? 0);
        if (homeWin) {
          records[g.home_team_id] = { w: (records[g.home_team_id]?.w || 0) + 1, l: records[g.home_team_id]?.l || 0 };
          records[g.away_team_id] = { w: records[g.away_team_id]?.w || 0, l: (records[g.away_team_id]?.l || 0) + 1 };
        } else if (awayWin) {
          records[g.away_team_id] = { w: (records[g.away_team_id]?.w || 0) + 1, l: records[g.away_team_id]?.l || 0 };
          records[g.home_team_id] = { w: records[g.home_team_id]?.w || 0, l: (records[g.home_team_id]?.l || 0) + 1 };
        }
      });

      const mappedTeams: TeamWithJoinCode[] = (teamRows || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          logoUrl: t.logo_url || '',
          bannerUrl: t.banner_url || '',
          division: normalizeDivisionLabel(String(t.division || 'D1')) || 'D1',
          shortName: (t.short_name || '').toString(),
          seasonId: t.season_id,
          wins: records[t.id]?.w ?? 0,
          losses: records[t.id]?.l ?? 0,
          ties: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        }));

      const mappedPlayers: RosterPlayer[] = (playerRows || []).map((p: any) => {
        return {
          id: p.id,
          teamId: p.team_id,
          seasonId: p.season_id || null,
          name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Player',
          number: p.jersey_number != null ? String(p.jersey_number) : '',
          isCaptain: !!p.is_captain,
          userId: p.user_id || null,
          email: p.email || (p as any)?.email_address || null,
          isGuest: !!p.is_guest,
          avatarUrl: p.avatar_url || p.photo_url || null,
        };
      });
      const rosterPlayers = mappedPlayers.filter((p) => !p.isGuest);

      const previewPlayersByTeam: Record<string, RosterPlayer[]> = {};
      rosterPlayers.forEach((player) => {
        if (!previewPlayersByTeam[player.teamId]) previewPlayersByTeam[player.teamId] = [];
        if (previewPlayersByTeam[player.teamId].length >= 4) return;
        previewPlayersByTeam[player.teamId].push(player);
      });

      const previewUserIds = Array.from(
        new Set(
          Object.values(previewPlayersByTeam)
            .flat()
            .filter((player) => !player.avatarUrl && player.userId)
            .map((player) => String(player.userId))
        )
      );
      const profileAvatarMap: Record<string, string> = {};
      if (previewUserIds.length) {
        try {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('user_id,avatar_url')
            .in('user_id', previewUserIds);
          (profileData || []).forEach((row: any) => {
            if (row.user_id && row.avatar_url) {
              profileAvatarMap[row.user_id] = row.avatar_url;
            }
          });
        } catch (err) {
          console.warn('Load player profile avatars failed', err);
          if (supabaseAdmin) {
            try {
              const { data: profileData } = await supabaseAdmin
                .from('profiles')
                .select('user_id,avatar_url')
                .in('user_id', previewUserIds);
              (profileData || []).forEach((row: any) => {
                if (row.user_id && row.avatar_url) {
                  profileAvatarMap[row.user_id] = row.avatar_url;
                }
              });
            } catch (fallbackErr) {
              console.warn('Admin client avatar lookup failed', fallbackErr);
            }
          }
        }
      }

      const logoPaths = Array.from(new Set(mappedTeams.map((team) => team.logoUrl).filter(Boolean)));
      const bannerPaths = Array.from(new Set(mappedTeams.map((team) => team.bannerUrl).filter(Boolean)));
      const previewAvatarPaths = new Set<string>();
      Object.values(previewPlayersByTeam).forEach((teamPlayers) => {
        teamPlayers.forEach((player) => {
          const rawAvatar = player.avatarUrl || (player.userId ? profileAvatarMap[player.userId] : '');
          if (rawAvatar) previewAvatarPaths.add(rawAvatar);
        });
      });

      const signedLogoPathMap: Record<string, string> = {};
      const signedBannerPathMap: Record<string, string> = {};
      const signedAvatarPathMap: Record<string, string> = {};

      await Promise.all([
        ...logoPaths.map(async (path) => {
          signedLogoPathMap[path] = await signUrl(path);
        }),
        ...bannerPaths.map(async (path) => {
          signedBannerPathMap[path] = await signUrl(path);
        }),
        ...Array.from(previewAvatarPaths).map(async (path) => {
          signedAvatarPathMap[path] = await signUrl(path);
        }),
      ]);

      const signedLogoMap: Record<string, string> = {};
      const signedBannerMap: Record<string, string> = {};
      mappedTeams.forEach((team) => {
        if (team.logoUrl) signedLogoMap[team.id] = signedLogoPathMap[team.logoUrl] || team.logoUrl;
        if (team.bannerUrl) signedBannerMap[team.id] = signedBannerPathMap[team.bannerUrl] || team.bannerUrl;
      });

      const previewMap: Record<string, { text: string; image?: string }[]> = {};
      Object.entries(previewPlayersByTeam).forEach(([teamId, teamPlayers]) => {
        previewMap[teamId] = teamPlayers.map((player) => {
          const rawAvatar = player.avatarUrl || (player.userId ? profileAvatarMap[player.userId] : '');
          const signedAvatar = rawAvatar ? signedAvatarPathMap[rawAvatar] || rawAvatar : DEFAULT_PLAYER_AVATAR;
          return {
            text: getAvatarInitials(player.name) || 'Player',
            image: signedAvatar,
          };
        });
      });

      const divisionLabelMap = new Map<string, string>();
      [...configuredDivisions, ...mappedTeams.map((team) => team.division)].forEach((rawDivision) => {
        const normalized = normalizeDivisionLabel(String(rawDivision || ''));
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (!divisionLabelMap.has(key)) {
          divisionLabelMap.set(key, normalized);
        }
      });
      const uniqDivs = Array.from(divisionLabelMap.values());
      const divOptions = ['all', ...uniqDivs];
      setAllTeams(mappedTeams);
      setTeams(mappedTeams);
      setDivisionOptions(divOptions);
      if (
        selectedDivision !== 'all' &&
        !uniqDivs.some((division) => normalizeDivisionKey(division) === normalizeDivisionKey(selectedDivision))
      ) {
        setSelectedDivision('all');
      }
      setPlayers(rosterPlayers);
      setRosterPreviews(previewMap);
      setSignedLogos(signedLogoMap);
      setSignedBanners(signedBannerMap);
      setError(null);
    } catch (err) {
      console.error('Load teams error', err);
      // fallback to mock
      setTeams(TEAMS);
      setAllTeams(TEAMS);
      setPlayers(MOCK_ROSTERS);
      const fallbackPreviews: Record<string, { text: string; image?: string }[]> = {};
      MOCK_ROSTERS.forEach((p) => {
        if (!fallbackPreviews[p.teamId]) fallbackPreviews[p.teamId] = [];
        if (fallbackPreviews[p.teamId].length >= 8) return;
        fallbackPreviews[p.teamId].push({
          text: getAvatarInitials(p.name) || 'Player',
          image: DEFAULT_PLAYER_AVATAR,
        });
      });
      setRosterPreviews(fallbackPreviews);
      setError('Using mock teams (Supabase error).');
    } finally {
      setLoading(false);
    }
  };

  const loadTeamSeasons = async () => {
    try {
      const { data, error } = await supabase
        .from('seasons')
        .select('id,name,is_current,start_date')
        .order('start_date', { ascending: false });
      if (error) throw error;
      if (!data) {
        setTeamSeasons([]);
        return;
      }
      const mapped = data.map((s: any) => ({
        id: s.id,
        name: s.name,
        isActive: !!s.is_current,
      }));
      setTeamSeasons(mapped);
      if (!selectedSeasonId && mapped.length) {
        const current = mapped.find((s) => s.isActive) || mapped[0];
        setSelectedSeasonId(current.id);
      }
    } catch (err) {
      console.error('Load seasons for teams error', err);
      setTeamSeasons([]);
    }
  };

  useEffect(() => {
    loadTeamSeasons();
  }, []);

  useEffect(() => {
    if (showImportsOnly && onTeamSeasonsChange) {
      onTeamSeasonsChange(teamSeasons);
    }
  }, [teamSeasons, showImportsOnly, onTeamSeasonsChange]);

  useEffect(() => {
    if (showImportsOnly && onImportSeasonChange) {
      onImportSeasonChange(selectedSeasonId);
    }
  }, [selectedSeasonId, showImportsOnly, onImportSeasonChange]);

  useEffect(() => {
    loadTeams();
  }, [selectedSeasonId]);

  useEffect(() => {
    const filteredTeams =
      selectedDivision === 'all'
        ? allTeams
        : allTeams.filter(
            (team) => normalizeDivisionKey(team.division) === normalizeDivisionKey(selectedDivision)
          );
    setTeams(filteredTeams);
  }, [allTeams, selectedDivision]);

  useEffect(() => {
    if (showImportsOnly || (!pendingTeamDelete && !pendingTeamMerge)) return;
    if (typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [pendingTeamDelete, pendingTeamMerge, showImportsOnly]);

  useEffect(() => {
    const teamParam = searchParams.get('team');
    if (teamParam && !editingTeamId && teams.some((t) => t.id === teamParam)) {
      setEditingTeamId(teamParam);
    }
  }, [searchParams, teams, editingTeamId]);

  const playerCountByTeam = useMemo(() => {
    const counts: Record<string, number> = {};
    players.forEach((player) => {
      counts[player.teamId] = (counts[player.teamId] || 0) + 1;
    });
    return counts;
  }, [players]);
  const mergeKeepTeam = pendingTeamMerge
    ? pendingTeamMerge.options.find((option) => option.id === pendingTeamMerge.keepTeamId) || null
    : null;
  const mergeSourceTeam = pendingTeamMerge
    ? pendingTeamMerge.options.find((option) => option.id === pendingTeamMerge.mergeTeamId) || null
    : null;
  const mergeWillConsolidate = Boolean(
    mergeKeepTeam &&
      mergeSourceTeam &&
      (mergeKeepTeam.seasonId || '') === (mergeSourceTeam.seasonId || '') &&
      normalizeDivisionKey(mergeKeepTeam.division) === normalizeDivisionKey(mergeSourceTeam.division)
  );
  const mergeActionLabel = mergeWillConsolidate ? 'Consolidate & Delete Duplicate' : 'Sync Team Profiles';
  const formatMergeOptionLabel = (option: MergeTeamOption) =>
    `${option.name} (${option.seasonLabel}${option.division ? ` • ${option.division}` : ''})`;

  if (editingTeamId && editTeamForm) {
      return (
          <div className="animate-fadeIn">
              <button onClick={() => setEditingTeamId(null)} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6">
                  <ArrowLeft size={18} /> Back to Team List
              </button>
              {error && <div className="mb-4 text-xs text-brand-red font-mono">{error}</div>}

             <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                 {/* LEFT: Team Branding */}
                 <div className="lg:col-span-1 space-y-6">
                     <div className="bg-brand-dark border border-white/10 rounded-xl p-6">
                         <h3 className="text-white font-sports uppercase text-xl mb-4 flex items-center gap-2">
                              <ImageIcon size={20} /> Branding
                          </h3>
                          
                          {/* Logo */}
                          <div className="mb-6">
                              <label className="block text-xs text-gray-400 uppercase font-bold mb-2">Team Logo</label>
                               <div className="flex items-center gap-4">
                                   <div
                                       className={`w-20 h-20 rounded-full bg-black border-2 overflow-hidden relative flex-shrink-0 transition-all ${isLogoLoading ? 'border-brand-lime/70 cursor-not-allowed opacity-80' : 'border-white/10 hover:border-brand-lime/70 cursor-pointer'}`}
                                       role="button"
                                       tabIndex={isLogoLoading ? -1 : 0}
                                       aria-disabled={isLogoLoading}
                                       aria-busy={isLogoLoading}
                                       onClick={() => {
                                         if (!isLogoLoading) openCropperForAsset('logo');
                                       }}
                                       onKeyDown={(event) => {
                                         if ((event.key === 'Enter' || event.key === ' ') && !isLogoLoading) {
                                           event.preventDefault();
                                           openCropperForAsset('logo');
                                         }
                                       }}
                                   >
                                       <img src={logoPreview || editTeamForm.logoUrl} alt="Logo" className="w-full h-full object-cover" />
                                       {isLogoLoading && (
                                         <div className="logo-loading-overlay" aria-live="polite">
                                           <span className="logo-loading-ring" aria-hidden="true" />
                                         </div>
                                       )}
                                   </div>
                                   <div>
                                       <input type="file" id="logo-upload" className="hidden" accept="image/*" onChange={(e) => handleImageSelection(e, 'logo')} />
                                       <label htmlFor="logo-upload" className="cursor-pointer bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded text-xs font-bold uppercase border border-white/10 transition-colors">
                                           Change Logo
                                       </label>
                                   </div>
                               </div>
                          </div>

                          {/* Banner */}
                          <div>
                              <label className="block text-xs text-gray-400 uppercase font-bold mb-2">Team Banner</label>
                               <div
                                   className={`w-full h-32 bg-black border-2 overflow-hidden rounded-lg relative group mb-3 transition-all ${isBannerLoading ? 'border-brand-lime/70 cursor-not-allowed' : 'border-white/10 cursor-pointer hover:border-brand-lime/60'}`}
                                   role="button"
                                   tabIndex={isBannerLoading ? -1 : 0}
                                   aria-disabled={isBannerLoading}
                                   aria-busy={isBannerLoading}
                                   onClick={() => {
                                     if (!isBannerLoading) openCropperForAsset('banner');
                                   }}
                                   onKeyDown={(event) => {
                                     if ((event.key === 'Enter' || event.key === ' ') && !isBannerLoading) {
                                       event.preventDefault();
                                       openCropperForAsset('banner');
                                     }
                                   }}
                               >
                                   <img src={bannerPreview || editTeamForm.bannerUrl || 'https://via.placeholder.com/800x400'} alt="Banner" className="w-full h-full object-cover" />
                                   <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                       <span className="text-white text-xs font-bold uppercase">Preview</span>
                                   </div>
                                   {isBannerLoading && (
                                     <div className="banner-loading-overlay">
                                       <div className="banner-loading-outline">
                                         <span className="banner-loading-edge horizontal top" />
                                         <span className="banner-loading-edge horizontal bottom" />
                                         <span className="banner-loading-edge vertical left" />
                                         <span className="banner-loading-edge vertical right" />
                                       </div>
                                       <span className="banner-loading-label">Opening</span>
                                     </div>
                                   )}
                               </div>
                              <input type="file" id="banner-upload" className="hidden" accept="image/*" onChange={(e) => handleImageSelection(e, 'banner')} />
                              <label htmlFor="banner-upload" className="block w-full text-center cursor-pointer bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded text-xs font-bold uppercase border border-white/10 transition-colors">
                                  Upload New Banner
                              </label>
                          </div>
                      </div>

                     <div className="bg-brand-dark border border-white/10 rounded-xl p-6">
                         <h3 className="text-white font-sports uppercase text-xl mb-4">Details</h3>
                         <div className="space-y-4">
                             <div>
                                 <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Team Name</label>
                                  <input 
                                      type="text" 
                                      value={editTeamForm.name} 
                                      onChange={(e) => setEditTeamForm({...editTeamForm, name: e.target.value})}
                                      className="w-full bg-black border border-white/20 rounded p-2 text-white focus:border-brand-lime focus:outline-none"
                                  />
                              </div>
                              <div>
                                  <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Division</label>
                                  <select 
                                      value={editTeamForm.division} 
                                      onChange={(e) => setEditTeamForm({...editTeamForm, division: e.target.value})}
                                      className="w-full appearance-none bg-black border border-white/20 rounded p-2 pr-12 text-white focus:border-brand-lime focus:outline-none"
                                      style={{
                                        backgroundImage:
                                          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 1rem center',
                                        backgroundSize: '12px 8px',
                                      }}
                                  >
                                      {(divisionOptions.filter((d) => d !== 'all').length ? divisionOptions.filter((d) => d !== 'all') : ['D1','D2','D3']).map((d) => (
                                        <option key={d} value={d}>
                                          {d}
                                        </option>
                                      ))}
                                  </select>
                              </div>
                          </div>
                      </div>
                      
                     <button onClick={handleSave} className="w-full bg-brand-lime text-black font-bold py-3 rounded uppercase font-sports text-lg hover:bg-white transition-colors shadow-lg">
                          {saving ? 'Saving...' : 'Save Changes'}
                     </button>
                 </div>

                  {/* RIGHT: Roster Management */}
                  <div className="lg:col-span-2 bg-brand-dark border border-white/10 rounded-xl p-6 flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-white font-sports uppercase text-xl flex items-center gap-2">
             <Users size={20} /> Roster Management
          </h3>
          <span className="text-xs text-gray-400 font-mono">{editRoster.length} Players</span>
                       </div>

                       <div className="flex-1 bg-black/20 rounded-lg border border-white/5 overflow-hidden mb-6">
                           <div className="overflow-x-auto">
                           <table className="w-full min-w-[520px] text-left text-sm">
                               <thead className="bg-white/5 text-brand-grey uppercase text-xs font-bold">
                                   <tr>
                                       <th className="p-3 text-center w-16">No.</th>
                                       <th className="p-3">Player Name</th>
                                       <th className="p-3 text-center w-24">Role</th>
                                       <th className="p-3 text-right">Actions</th>
                                   </tr>
                               </thead>
                               <tbody className="divide-y divide-white/5">
                                   {editRoster.map(player => (
                                        <tr key={player.id} className="group hover:bg-white/5 transition-colors">
                                            <td className="p-3 text-center font-mono text-brand-lime">
                                                {editingPlayerId === player.id ? (
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        pattern="[0-9]*"
                                                        value={editingPlayerNumber}
                                                        onChange={(e) => setEditingPlayerNumber(e.target.value)}
                                                        onBlur={handleSavePlayerNumber}
                                                        onKeyDown={handlePlayerNumberKeyDown}
                                                        className="w-full bg-transparent border border-white/40 rounded px-2 py-1 text-center text-sm text-white focus:outline-none"
                                                        disabled={playerNumberSavingId === player.id}
                                                    />
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => startEditingPlayerNumber(player)}
                                                        className="hover:text-white focus:outline-none"
                                                    >
                                                        {player.number || '-'}
                                                    </button>
                                                )}
                                            </td>
                                           <td className="p-3 font-bold text-white">
                                             <button
                                               type="button"
                                               onClick={() => openQuickEditPlayer(player)}
                                               className="text-left hover:text-brand-lime underline-offset-2 hover:underline"
                                             >
                                               {player.name}
                                             </button>
                                             {player.isGuest && (
                                               <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-gray-300 uppercase">
                                                 Guest
                                               </span>
                                             )}
                                           </td>
                                           <td className="p-3 text-center">
                                               <button 
                                                 onClick={() => toggleCaptain(player.id)}
                                                 className={`p-1 rounded hover:bg-white/10 transition-colors ${player.isCaptain ? 'text-yellow-400' : 'text-gray-600 group-hover:text-gray-400'}`}
                                                 title={player.isCaptain ? "Remove Captain" : "Make Captain"}
                                               >
                                                   <Crown size={18} fill={player.isCaptain ? "currentColor" : "none"} />
                                               </button>
                                           </td>
                                           <td className="p-3 text-right">
                                               <button onClick={() => setPendingPlayerDelete(player)} className="text-gray-500 hover:text-brand-red transition-colors">
                                                   <Trash2 size={16} />
                                               </button>
                                           </td>
                                       </tr>
                                   ))}
                                   {editRoster.length === 0 && (
                                       <tr>
                                           <td colSpan={4} className="p-8 text-center text-gray-500 italic">No players on roster.</td>
                                       </tr>
                                   )}
                               </tbody>
                           </table>
                           </div>
                       </div>

                        <div className="bg-white/5 p-4 rounded-lg border border-white/10 space-y-4">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs text-brand-lime uppercase font-bold">Add New Player</h4>
                              <button
                                type="button"
                                onClick={() =>
                                  setShowNewPlayerForm((prev) => {
                                    const next = !prev;
                                    if (!next) {
                                      clearNewPlayerSuggestions();
                                    }
                                    return next;
                                  })
                                }
                                className="text-xs uppercase tracking-wide text-gray-400 px-3 py-1 rounded border border-white/10 hover:border-white hover:text-white transition-colors"
                              >
                                {showNewPlayerForm ? 'Hide' : 'Show'}
                              </button>
                            </div>
                            {showNewPlayerForm && (
                              <div className="space-y-3">
                                <div className="flex flex-wrap gap-3">
                                  <div className="relative w-full sm:flex-[2] sm:min-w-[220px]">
                                    <input 
                                      type="text" 
                                      placeholder="Player Name" 
                                      value={newPlayer.name}
                                      onChange={(e) => {
                                        const nextName = e.target.value;
                                        setNewPlayer({ ...newPlayer, name: nextName });
                                        if (
                                          newPlayerLinkedUser &&
                                          nextName.trim().toLowerCase() !== newPlayerLinkedUser.displayName.trim().toLowerCase()
                                        ) {
                                          setNewPlayerLinkedUser(null);
                                        }
                                        queueNewPlayerSuggestionSearch(nextName);
                                      }}
                                      onFocus={() => {
                                        if (newPlayerSuggestions.length > 0) {
                                          setShowNewPlayerSuggestions(true);
                                        } else if (newPlayer.name.trim().length >= 2) {
                                          queueNewPlayerSuggestionSearch(newPlayer.name);
                                        }
                                      }}
                                      onBlur={() => {
                                        window.setTimeout(() => setShowNewPlayerSuggestions(false), 120);
                                      }}
                                      className="w-full bg-black border border-white/20 rounded p-2 text-white text-sm focus:border-brand-lime focus:outline-none"
                                    />
                                    {(newPlayerSuggestionLoading || (showNewPlayerSuggestions && newPlayerSuggestions.length > 0)) && (
                                      <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-white/10 bg-[#111111] shadow-2xl">
                                        {newPlayerSuggestionLoading && (
                                          <div className="px-3 py-2 text-xs text-gray-400">Searching existing players and users...</div>
                                        )}
                                        {!newPlayerSuggestionLoading && newPlayerSuggestions.map((option) => (
                                          <button
                                            key={option.key}
                                            type="button"
                                            onMouseDown={(event) => {
                                              event.preventDefault();
                                              applyNewPlayerSuggestion(option);
                                            }}
                                            className="block w-full border-b border-white/5 px-3 py-2 text-left hover:bg-white/5 last:border-b-0"
                                          >
                                            <div className="text-sm font-semibold text-white">{option.displayName}</div>
                                            <div className="text-xs text-gray-400">{option.subtitle}</div>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <input 
                                    type="email" 
                                    placeholder="Player Email (optional)" 
                                    value={newPlayer.email}
                                    onChange={(e) => {
                                      const nextEmail = e.target.value;
                                      setNewPlayer({...newPlayer, email: nextEmail});
                                      if (
                                        newPlayerLinkedUser &&
                                        normalizeEmail(nextEmail) !== normalizeEmail(newPlayerLinkedUser.email || '')
                                      ) {
                                        setNewPlayerLinkedUser(null);
                                      }
                                    }}
                                    className="w-full sm:flex-1 sm:min-w-[200px] bg-black border border-white/20 rounded p-2 text-white text-sm focus:border-brand-lime focus:outline-none"
                                  />
                                  <input 
                                    type="text" 
                                    placeholder="#" 
                                    value={newPlayer.number}
                                    onChange={(e) => setNewPlayer({...newPlayer, number: e.target.value})}
                                    className="w-full sm:w-16 bg-black border border-white/20 rounded p-2 text-white text-sm text-center focus:border-brand-lime focus:outline-none"
                                  />
                                  <button type="button" onClick={addPlayer} className={`w-full sm:w-auto ${primaryButtonClass}`}>
                                      Add
                                  </button>
                                </div>

                                <div className="border border-white/10 rounded-lg p-3 bg-black/20 space-y-2">
                                  <div className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">
                                    Link Existing Site User (optional)
                                  </div>
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                      type="text"
                                      placeholder="Search by name or email"
                                      value={newPlayerUserSearch}
                                      onChange={(e) => setNewPlayerUserSearch(e.target.value)}
                                      className="w-full bg-black border border-white/20 rounded p-2 text-white text-sm focus:border-brand-lime focus:outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => void lookupNewPlayerUsers()}
                                      disabled={newPlayerUserLoading || !newPlayerUserSearch.trim()}
                                      className="px-3 py-2 rounded border border-white/20 text-xs uppercase text-gray-200 hover:border-brand-lime disabled:opacity-60"
                                    >
                                      {newPlayerUserLoading ? 'Searching...' : 'Find'}
                                    </button>
                                  </div>
                                  {newPlayerUserOptions.length > 0 && (
                                    <select
                                      value={newPlayerLinkedUser?.userId || ''}
                                      onChange={(e) => {
                                        const selected =
                                          newPlayerUserOptions.find((option) => option.userId === e.target.value) || null;
                                        setNewPlayerLinkedUser(selected);
                                        if (selected) {
                                          if (!newPlayer.name.trim()) {
                                            setNewPlayer((prev) => ({ ...prev, name: selected.displayName }));
                                          }
                                          if (!newPlayer.email.trim() && selected.email) {
                                            setNewPlayer((prev) => ({ ...prev, email: selected.email }));
                                          }
                                        }
                                      }}
                                      className="w-full appearance-none bg-black border border-white/20 rounded p-2 pr-12 text-white text-sm focus:border-brand-lime focus:outline-none"
                                      style={{
                                        backgroundImage:
                                          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                                        backgroundRepeat: 'no-repeat',
                                        backgroundPosition: 'right 1rem center',
                                        backgroundSize: '12px 8px',
                                      }}
                                    >
                                      <option value="">Select existing user</option>
                                      {newPlayerUserOptions.map((option) => (
                                        <option key={option.userId} value={option.userId}>
                                          {formatExistingUserLabel(option)}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  {newPlayerLinkedUser && (
                                    <div className="flex items-center justify-between gap-2 text-xs text-brand-lime">
                                      <span>Linked: {formatExistingUserLabel(newPlayerLinkedUser)}</span>
                                      <button
                                        type="button"
                                        onClick={() => setNewPlayerLinkedUser(null)}
                                        className="text-gray-300 hover:text-white"
                                      >
                                        Clear
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                        </div>
                   </div>
               </div>
                {/* Delete player confirmation modal */}
                 {pendingPlayerDelete && (
                    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
                     <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fadeIn">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h4 className="text-white font-sports text-xl uppercase">Remove Player</h4>
                          <p className="text-gray-400 text-sm mt-1">This removes the player from this team.</p>
                        </div>
                        <button onClick={() => setPendingPlayerDelete(null)} className="text-gray-500 hover:text-white">
                          <X size={18} />
                        </button>
                      </div>
                      <div className="bg-black/40 border border-white/10 rounded-lg p-4 text-sm text-gray-300">
                        Remove <span className="text-white font-bold">{pendingPlayerDelete.name}</span> from the roster?
                      </div>
                      <div className="flex justify-end gap-3 mt-6">
                        <button
                          onClick={() => setPendingPlayerDelete(null)}
                          className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            removePlayerConfirmed(pendingPlayerDelete.id);
                          }}
                          className="px-4 py-2 rounded bg-brand-red text-white text-sm font-bold hover:bg-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                   </div>
                 )}

                 {teamEditorRosterWarning && (
                    <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center px-4">
                     <div className="w-full max-w-md bg-brand-dark border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
                      <div className="px-6 py-4 border-b border-white/10">
                        <div className="text-white font-sports text-xl uppercase">{teamEditorRosterWarning.title}</div>
                        <p className="text-xs text-gray-400 mt-1">
                          {teamEditorRosterWarning.description}
                        </p>
                      </div>
                      <div className="px-6 py-4 text-sm text-gray-300 space-y-3">
                        <p>{teamEditorRosterWarning.body}</p>
                      </div>
                      <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => setTeamEditorRosterWarning(null)}
                          className="px-4 py-2 rounded-xl bg-brand-lime text-black text-sm font-bold"
                        >
                          Got It
                        </button>
                      </div>
                    </div>
                   </div>
                 )}

                 {/* Player quick edit modal */}
                 {quickEditPlayerId && (
                   <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
                     <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-2xl animate-fadeIn">
                       <div className="flex items-start justify-between mb-4">
                         <div>
                           <h4 className="text-white font-sports text-xl uppercase">Edit Player</h4>
                           <p className="text-gray-400 text-sm mt-1">Update player info without leaving this page.</p>
                         </div>
                         <button type="button" onClick={closeQuickEditPlayer} className="text-gray-500 hover:text-white">
                           <X size={18} />
                         </button>
                       </div>

                       <div className="space-y-4">
                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                           <div>
                             <label className="block text-xs text-gray-400 uppercase font-bold mb-1">First name</label>
                             <input
                               type="text"
                               value={quickEditFirstName}
                               onChange={(e) => setQuickEditFirstName(e.target.value)}
                               disabled={quickEditPlayerLoading || quickEditPlayerSaving}
                               className="w-full bg-black border border-white/20 rounded p-2 text-white focus:border-brand-lime focus:outline-none"
                             />
                           </div>
                           <div>
                             <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Last name</label>
                             <input
                               type="text"
                               value={quickEditLastName}
                               onChange={(e) => setQuickEditLastName(e.target.value)}
                               disabled={quickEditPlayerLoading || quickEditPlayerSaving}
                               className="w-full bg-black border border-white/20 rounded p-2 text-white focus:border-brand-lime focus:outline-none"
                             />
                           </div>
                         </div>

                         <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                           <div>
                             <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Jersey #</label>
                             <input
                               type="text"
                               inputMode="numeric"
                               pattern="[0-9]*"
                               value={quickEditJerseyNumber}
                               onChange={(e) => setQuickEditJerseyNumber(e.target.value)}
                               disabled={quickEditPlayerLoading || quickEditPlayerSaving}
                               className="w-full bg-black border border-white/20 rounded p-2 text-white focus:border-brand-lime focus:outline-none"
                             />
                           </div>
                           <div className="sm:col-span-2">
                             <label className="block text-xs text-gray-400 uppercase font-bold mb-1">
                               Jersey name (optional)
                             </label>
                             <input
                               type="text"
                               value={quickEditJerseyName}
                               onChange={(e) => setQuickEditJerseyName(e.target.value)}
                               disabled={
                                 quickEditPlayerLoading ||
                                 quickEditPlayerSaving ||
                                 !Object.prototype.hasOwnProperty.call(quickEditPlayerRow || {}, 'jersey_name')
                               }
                               placeholder={
                                 Object.prototype.hasOwnProperty.call(quickEditPlayerRow || {}, 'jersey_name')
                                   ? ''
                                   : 'Not available in this database'
                               }
                               className="w-full bg-black border border-white/20 rounded p-2 text-white focus:border-brand-lime focus:outline-none disabled:opacity-60"
                             />
                           </div>
                         </div>

                         <div className="border border-white/10 rounded-lg p-3 bg-black/20 space-y-2">
                           <div className="text-[11px] uppercase tracking-wide text-gray-400 font-bold">
                             Linked Site User
                           </div>
                           <div className="flex flex-col sm:flex-row gap-2">
                             <input
                               type="text"
                               placeholder="Search by name or email"
                               value={quickEditUserSearch}
                               onChange={(e) => setQuickEditUserSearch(e.target.value)}
                               disabled={quickEditPlayerLoading || quickEditPlayerSaving}
                               className="w-full bg-black border border-white/20 rounded p-2 text-white text-sm focus:border-brand-lime focus:outline-none"
                             />
                             <button
                               type="button"
                               onClick={() => void lookupQuickEditUsers()}
                               disabled={
                                 quickEditPlayerLoading ||
                                 quickEditPlayerSaving ||
                                 quickEditUserLoading ||
                                 !quickEditUserSearch.trim()
                               }
                               className="px-3 py-2 rounded border border-white/20 text-xs uppercase text-gray-200 hover:border-brand-lime disabled:opacity-60"
                             >
                               {quickEditUserLoading ? 'Searching...' : 'Find'}
                             </button>
                           </div>

                           {quickEditUserOptions.length > 0 && (
                             <select
                               value={quickEditLinkedUser?.userId || ''}
                               onChange={(e) => {
                                 const selected =
                                   quickEditUserOptions.find((option) => option.userId === e.target.value) || null;
                                 setQuickEditLinkedUser(selected);
                                 setQuickEditLinkDirty(true);
                                 if (selected && !quickEditFirstName.trim() && !quickEditLastName.trim()) {
                                   const parts = selected.displayName.split(' ').filter(Boolean);
                                   const first = parts.shift() || '';
                                   const last = parts.join(' ');
                                   setQuickEditFirstName(first);
                                   setQuickEditLastName(last);
                                 }
                               }}
                               disabled={quickEditPlayerLoading || quickEditPlayerSaving}
                               className="w-full bg-black border border-white/20 rounded p-2 text-white text-sm focus:border-brand-lime focus:outline-none"
                             >
                               <option value="">Select existing user</option>
                               {quickEditUserOptions.map((option) => (
                                 <option key={option.userId} value={option.userId}>
                                   {formatExistingUserLabel(option)}
                                 </option>
                               ))}
                             </select>
                           )}

                           <div className="flex items-center justify-between gap-2 text-xs">
                             {quickEditLinkedUser ? (
                               <span className="text-brand-lime">
                                 Linked: {formatExistingUserLabel(quickEditLinkedUser)}
                               </span>
                             ) : (
                               <span className="text-gray-500">No linked account yet.</span>
                             )}
                             {quickEditLinkedUser && (
                               <button
                                 type="button"
                                 onClick={() => {
                                   setQuickEditLinkedUser(null);
                                   setQuickEditLinkDirty(true);
                                 }}
                                 disabled={quickEditPlayerLoading || quickEditPlayerSaving}
                                 className="text-gray-300 hover:text-white disabled:opacity-60"
                               >
                                 Unlink
                               </button>
                             )}
                           </div>
                         </div>

                         {quickEditPlayerLoading && <div className="text-xs text-gray-400">Loading player details...</div>}
                       </div>

                       <div className="flex justify-end gap-3 mt-6">
                         <button
                           type="button"
                           onClick={closeQuickEditPlayer}
                           disabled={quickEditPlayerSaving}
                           className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40 disabled:opacity-60"
                         >
                           Cancel
                         </button>
                         <button
                           type="button"
                           onClick={saveQuickEditPlayer}
                           disabled={quickEditPlayerLoading || quickEditPlayerSaving}
                           className="px-4 py-2 rounded bg-brand-lime text-black text-sm font-bold hover:bg-lime-300 disabled:opacity-60"
                         >
                           {quickEditPlayerSaving ? 'Saving...' : 'Save'}
                         </button>
                       </div>
                     </div>
                   </div>
                 )}
                {croppingState && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6">
                    <div
                      role="dialog"
                      aria-label="Crop uploaded image"
                      className="relative w-full max-w-3xl bg-brand-dark border border-white/10 rounded-2xl p-4 sm:p-6 shadow-2xl"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-white uppercase text-sm font-bold">
                          {croppingState.type === 'logo' ? 'Crop Team Logo' : 'Crop Team Banner'}
                        </h4>
                        <button
                          type="button"
                          onClick={handleCropCancel}
                          className="text-gray-400 hover:text-white"
                        >
                          <X size={18} />
                        </button>
                      </div>
                      <div className="relative h-72 sm:h-80 rounded-lg overflow-hidden bg-black/30">
                        <Cropper
                          image={croppingState.src}
                          crop={crop}
                          zoom={zoom}
                          aspect={croppingState.aspect}
                          onCropChange={setCrop}
                          onZoomChange={setZoom}
                          onCropComplete={handleCropComplete}
                          onMediaLoaded={handleCropperMediaLoaded}
                          objectFit="contain"
                          minZoom={0.1}
                          restrictPosition
                          cropShape={isLogoCrop ? 'round' : 'rect'}
                          classes={{
                            cropAreaClassName: isLogoCrop ? 'logo-crop-area' : undefined,
                          }}
                          style={
                            isLogoCrop
                              ? {
                                  cropAreaStyle: {
                                    borderRadius: '9999px',
                                    clipPath: 'circle(50% at 50% 50%)',
                                  },
                                }
                              : undefined
                          }
                        />
                        {isLogoCrop && (
                          <div className="logo-crop-overlay">
                            <div className="logo-crop-circle" />
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex items-center gap-3 text-xs text-gray-300">
                        <span className="uppercase tracking-widest">Zoom</span>
                        <input
                          type="range"
                          min={1}
                          max={4}
                          step={0.01}
                          value={zoom}
                          onChange={(event) => setZoom(Number(event.target.value))}
                          className="flex-1 h-1 accent-white"
                        />
                      </div>
                      <div className="mt-4 flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={handleCropCancel}
                          disabled={saving}
                          className="px-4 py-2 rounded border border-white/15 text-[11px] uppercase tracking-wide text-gray-300 hover:border-white/40 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleUseOriginal}
                          disabled={saving}
                          className="px-4 py-2 rounded border border-white/15 text-[11px] uppercase tracking-wide text-white hover:border-white/40 disabled:opacity-50"
                        >
                          Use Original
                        </button>
                        <button
                          type="button"
                          onClick={handleCropSave}
                          disabled={!croppedAreaPixels || saving}
                          className="px-4 py-2 rounded bg-brand-lime text-black text-[11px] uppercase tracking-wide font-bold disabled:opacity-60"
                        >
                          {saving ? 'Uploading...' : 'Apply Crop & Upload'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
          </div>
      );
  }

  return (
    <div className="animate-fadeIn">
      {showImportsOnly ? (
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <h2 className="font-sports text-2xl text-white uppercase">Player / Game Imports</h2>
            <p className="text-xs text-gray-400">Upload CSVs by season.</p>
            {error && <span className="text-xs text-brand-red font-mono">{error}</span>}
          </div>
          <div className="flex flex-col sm:flex-row sm:flex-wrap md:justify-end gap-3 w-full md:w-auto">
            <select
            value={importSeasonId || selectedSeasonId || ''}
            onChange={(e) => setSelectedSeasonId(e.target.value)}
              className="w-full sm:w-auto sm:min-w-[180px] appearance-none bg-brand-dark border border-brand-lime/50 text-white text-sm font-sports uppercase tracking-wide px-4 pr-10 dropdown-select-spacing py-2 rounded-lg shadow-[0_0_0_1px_rgba(225,255,43,0.3)] focus:outline-none focus:border-brand-lime focus:shadow-[0_0_0_2px_rgba(225,255,43,0.5)]"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23e1ff2b' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 1.15rem center',
                backgroundSize: '12px 8px',
              }}
            >
              <option value="" disabled>Select Season</option>
              {sortSeasonsNewestFirst(teamSeasons).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="mb-6 space-y-3">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-sports text-2xl text-white uppercase">Teams & Divisions</h2>
              {error && <span className="text-xs text-brand-red font-mono">{error}</span>}
            </div>
            <div className="flex flex-col sm:flex-row sm:flex-wrap md:justify-end gap-3 w-full md:w-auto">
            <select
              value={selectedSeasonId || ''}
              onChange={(e) => setSelectedSeasonId(e.target.value)}
              className="w-full sm:w-auto sm:min-w-[180px] appearance-none bg-brand-dark border border-brand-lime/50 text-white text-sm font-sports uppercase tracking-wide px-4 pr-10 dropdown-select-spacing py-2 rounded-lg shadow-[0_0_0_1px_rgba(225,255,43,0.3)] focus:outline-none focus:border-brand-lime focus:shadow-[0_0_0_2px_rgba(225,255,43,0.5)]"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23e1ff2b' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 1.15rem center',
                backgroundSize: '12px 8px',
              }}
            >
              <option value="" disabled>Select Season</option>
              {sortSeasonsNewestFirst(teamSeasons).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={selectedDivision}
              onChange={(e) => setSelectedDivision(e.target.value)}
              disabled={!selectedSeasonId}
              className={`w-full sm:w-auto sm:min-w-[180px] appearance-none bg-brand-dark border border-white/20 text-white text-sm font-sports uppercase tracking-wide px-4 pr-10 dropdown-select-spacing py-2 rounded-lg shadow-[0_0_0_1px_rgba(255,255,255,0.08)] focus:outline-none focus:border-white/60 focus:shadow-[0_0_0_2px_rgba(255,255,255,0.15)] ${!selectedSeasonId ? 'opacity-60 cursor-not-allowed' : ''}`}
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 1.15rem center',
                backgroundSize: '12px 8px',
              }}
            >
              {divisionOptions.map((d) => (
                <option key={d} value={d}>
                  {d === 'all' ? 'All Divisions' : d}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => navigate('/admin/add-team')}
              className="w-full sm:w-auto bg-brand-lime text-black px-4 py-2 rounded font-bold text-sm uppercase flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Add Team
            </button>
            {canDeleteTeams && (
              <button
                type="button"
                onClick={() => void openTeamMergeModal()}
                className="w-full sm:w-auto border border-white/20 text-white px-4 py-2 rounded font-bold text-sm uppercase flex items-center justify-center gap-2 hover:border-brand-lime/60 hover:text-brand-lime transition-colors"
              >
                <GitMerge size={16} /> Merge Teams
              </button>
            )}
            </div>
          </div>
          {teamMergeMessage && (
            <div className="rounded-lg border border-brand-lime/40 bg-brand-lime/10 px-3 py-2 text-xs text-brand-lime">
              {teamMergeMessage}
            </div>
          )}
        </div>
      )}

      {showImportsOnly && (
      <div className="bg-gradient-to-br from-brand-dark via-black/90 to-black border border-white/10 rounded-2xl p-5 mb-6 shadow-[0_24px_60px_rgba(0,0,0,0.45)] relative overflow-hidden">
        <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-brand-lime/10 blur-3xl" />
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between relative">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-brand-lime/15 border border-brand-lime/30 flex items-center justify-center text-brand-lime">
              <Upload size={18} />
            </div>
            <div>
              <h3 className="text-white font-sports uppercase text-lg tracking-wide">Import Players (CSV)</h3>
              {/*<p className="text-xs text-gray-400">
                Uses the CSV <span className="text-white">#</span> column for jersey numbers. Other jersey preference fields are ignored.
              </p> */}
            </div>
          </div>
          <div className="text-xs text-gray-400 uppercase tracking-wide">
            Importing into <span className="text-white">{selectedSeasonLabel}</span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-5 gap-4 relative">
          <div className="lg:col-span-3">
            <label className="block text-[11px] uppercase text-brand-grey font-bold mb-2 tracking-widest">CSV File</label>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                ref={csvInputRef}
                id="csv-upload"
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvFileChange}
                className="hidden"
              />
              <label
                htmlFor="csv-upload"
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/15 text-xs uppercase tracking-wide text-white hover:border-brand-lime/60 hover:text-brand-lime transition"
              >
                <Upload size={14} /> Select CSV
              </label>
              <div className="flex-1 min-w-0 bg-black/70 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-400 truncate">
                {csvFileName || 'No file selected'}
              </div>
              <button
                type="button"
                onClick={resetCsvState}
                disabled={!csvRows.length && !csvFileName}
                className="px-4 py-2 rounded-lg border border-white/15 text-[11px] uppercase font-bold text-gray-300 hover:border-white/40 disabled:opacity-50"
              >
                Clear
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
              <a
                href="/templates/player-import-template.csv"
                download
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/15 text-gray-300 hover:border-brand-lime/60 hover:text-brand-lime transition"
              >
                View template CSV
              </a>
              <span className="text-gray-500">
                Don't change the CSV headers.
              </span>
              <details className="text-gray-400">
                <summary className="cursor-pointer hover:text-white">Supported columns</summary>
                <div className="mt-2 text-gray-500">
                  First Name, Last Name, Team, Division, #, Position, Birthdate, Player Jersey Size, Player Shorts Size,
                  Name on Jersey, Email, Phone Number, Instagram Handle, Which NBA player do you hoop like?, How did you hear about us?
                </div>
              </details>
            </div>
          </div>

          <div className="lg:col-span-2 flex flex-col gap-3">
            <div className="flex items-center gap-2 bg-black/60 border border-white/10 rounded-lg px-3 py-2">
              <input
                id="csv-create-teams"
                type="checkbox"
                checked={csvCreateTeams}
                onChange={(e) => setCsvCreateTeams(e.target.checked)}
                className="h-4 w-4 rounded border border-white/30 bg-black text-brand-lime"
              />
              <label htmlFor="csv-create-teams" className="text-xs text-gray-300">
                Auto-create missing teams
              </label>
            </div>
            <div className="flex items-center gap-2 bg-black/60 border border-white/10 rounded-lg px-3 py-2">
              <input
                id="csv-replace-existing"
                type="checkbox"
                checked={csvReplaceExisting}
                onChange={(e) => setCsvReplaceExisting(e.target.checked)}
                className="h-4 w-4 rounded border border-white/30 bg-black text-brand-lime"
              />
              <label htmlFor="csv-replace-existing" className="text-xs text-gray-300">
                Replace existing players for this season
              </label>
            </div>
            <div className="flex items-center gap-2 bg-black/60 border border-white/10 rounded-lg px-3 py-2">
              <input
                id="csv-update-existing-contacts-only"
                type="checkbox"
                checked={csvUpdateExistingContactsOnly}
                onChange={(e) => setCsvUpdateExistingContactsOnly(e.target.checked)}
                className="h-4 w-4 rounded border border-white/30 bg-black text-brand-lime"
              />
              <label htmlFor="csv-update-existing-contacts-only" className="text-xs text-gray-300">
                Update existing contacts only (email/phone)
              </label>
            </div>
            <button
              type="button"
              onClick={handleCsvImport}
              disabled={!csvRows.length || !selectedSeasonId || csvImporting}
              className="w-full bg-brand-lime text-black px-4 py-2.5 rounded-lg font-bold text-sm uppercase flex items-center justify-center gap-2 shadow-[0_10px_20px_rgba(209,255,28,0.18)] hover:bg-lime-300 disabled:opacity-60"
            >
              <Upload size={16} /> {csvImporting ? 'Importing...' : 'Import Players'}
            </button>
          </div>
        </div>

        {csvSummary && (
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-wide">
            <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
              Total {csvSummary.total}
            </span>
            <span className="px-3 py-1 rounded-full bg-brand-lime/15 border border-brand-lime/40 text-brand-lime">
              Ready {csvSummary.ready}
            </span>
            <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
              Missing Team {csvSummary.missingTeam}
            </span>
            <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
              Missing Name {csvSummary.missingName}
            </span>
          </div>
        )}
        {csvError && <div className="mt-2 text-xs text-brand-red font-mono">{csvError}</div>}
        {csvImportedCount !== null && (
          <div className="mt-2 text-xs text-brand-lime">
            {csvResultMessage || `Imported ${csvImportedCount} players.`}
          </div>
        )}

        <div className="mt-4 text-[11px] text-gray-500">
          Only available fields are imported. Unknown teams are skipped unless auto-create is enabled.
        </div>
      </div>
      )}

      {!showImportsOnly && loading && (
        <div className="mb-4 flex items-center gap-2 text-xs text-gray-400">
          <span className="inline-flex h-2 w-2 rounded-full bg-brand-lime animate-pulse"></span>
          Loading teams...
        </div>
      )}

      {!showImportsOnly && (loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`team-skeleton-${index}`}
              className="bg-brand-dark border border-white/10 p-5 rounded-xl animate-pulse"
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10"></div>
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-white/10 rounded w-2/3"></div>
                  <div className="h-3 bg-white/10 rounded w-1/3"></div>
                  <div className="h-3 bg-white/5 rounded w-1/4"></div>
                </div>
              </div>
              <div className="h-16 bg-white/5 rounded mb-4"></div>
              <div className="flex items-center justify-between border-t border-white/10 pt-4">
                <div className="flex gap-2">
                  <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10"></div>
                  <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10"></div>
                  <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10"></div>
                </div>
                <div className="h-6 w-16 rounded bg-white/10"></div>
              </div>
            </div>
          ))}
        </div>
      ) : teams.length === 0 ? (
        <div className="bg-brand-dark border border-dashed border-white/10 text-center text-gray-400 py-12 rounded-xl">
          No teams found for this season{selectedDivision !== 'all' ? ` (${selectedDivision})` : ''}.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map((team) => {
            const joinCode = getTeamJoinCode(team);
            const copied = copiedJoinCodeTeamId === team.id;
            const mergeMeta = teamMergeMetaById[team.id];
            const previousNames = mergeMeta?.previousNames || [];
            const parentTeamId = String(mergeMeta?.parentTeamId || '').trim();
            const parentTeam = parentTeamId ? teams.find((entry) => entry.id === parentTeamId) : null;
            const isMergedTeam = previousNames.length > 0 || !!parentTeamId;
            return (
            <div key={team.id} className="bg-brand-dark border border-white/10 p-5 rounded-xl hover:border-brand-lime/50 transition-all group relative overflow-hidden">
              {isMergedTeam ? (
                <div className="absolute top-3 right-3 z-20 rounded-full border border-brand-lime/60 bg-black/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-lime">
                  Merged Team
                </div>
              ) : null}
              <div className="flex items-start gap-4 mb-4 min-h-[132px] relative z-10">
                <div className="w-14 h-14 rounded-full bg-black border border-white/10 overflow-hidden">
                  <img src={signedLogos[team.id] || team.logoUrl || defaultLogo} alt={team.name} className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/team/${team.id}`)}
                    title={team.name}
                    className={`block min-w-0 text-left font-bold text-white text-lg leading-tight hover:text-brand-lime transition-colors ${
                      isMergedTeam ? 'pr-28' : ''
                    }`}
                  >
                    <span className="block line-clamp-2 break-words">{team.name}</span>
                  </button>
                  <div className="text-xs text-brand-lime mt-1 font-bold">{team.division}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{team.wins}W - {team.losses}L</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">Code:</span>
                    <span className="text-[11px] font-mono text-white/90">{joinCode || 'Not set'}</span>
                    <button
                      type="button"
                      onClick={() => void handleCopyTeamJoinCode(team)}
                      disabled={!joinCode}
                      className="inline-flex items-center gap-1 rounded border border-white/20 px-1.5 py-0.5 text-[10px] uppercase text-gray-200 hover:border-brand-lime hover:text-brand-lime disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Copy size={10} />
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1 min-h-[14px]">
                    {parentTeam ? (
                      <>Linked to: {parentTeam.name}</>
                    ) : previousNames.length > 0 ? (
                      <>Previously: {previousNames.join(' / ')}</>
                    ) : (
                      <span className="invisible">Previously: -</span>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Banner Preview Background */}
              { (signedBanners[team.id] || team.bannerUrl || defaultBanner) && (
                <div className="absolute inset-0 opacity-20 pointer-events-none">
                  <img src={signedBanners[team.id] || team.bannerUrl || defaultBanner} className="w-full h-full object-cover grayscale" />
                </div>
              )}

                <div className="border-t border-white/10 pt-4 relative z-10 space-y-2">
                  <div className="flex -space-x-2 min-h-8">
                    {(() => {
                      const previewItems = (rosterPreviews[team.id] || []).slice(0, 4);
                      const totalPlayers = playerCountByTeam[team.id] || 0;
                      const overflow = Math.max(totalPlayers - previewItems.length, 0);
                      return (
                        <>
                          {previewItems.map((item, idx) => (
                            <div
                              key={`${team.id}-${item.text}-${idx}`}
                              className="w-8 h-8 rounded-full bg-gray-800 border-2 border-brand-dark overflow-hidden flex items-center justify-center text-[10px] text-white font-bold"
                              title={item.text}
                            >
                              {item.image ? (
                                <img src={item.image} alt={item.text} className="w-full h-full object-cover" />
                              ) : (
                                <span>{item.text}</span>
                              )}
                            </div>
                          ))}
                          {overflow > 0 && (
                            <div className="w-8 h-8 rounded-full bg-gray-700 border-2 border-brand-dark flex items-center justify-center text-[10px] text-white font-bold">
                              +{overflow}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div className={`grid ${canDeleteTeams ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                    <button 
                      onClick={() => handleEditClick(team)}
                      className="h-8 w-full text-white bg-white/10 border border-white/20 hover:bg-white/20 px-3 rounded text-[11px] font-bold uppercase inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <Edit2 size={12} /> Edit
                    </button>
                    {canDeleteTeams && (
                      <button
                        type="button"
                        onClick={() => openTeamDeleteConfirm(team)}
                        className="h-8 w-full text-brand-red border border-brand-red/50 bg-brand-red/10 hover:bg-brand-red/20 px-3 rounded text-[11px] font-bold uppercase inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                  </div>
                </div>
            </div>
          )})}
        </div>
      ))}

      {/* Delete player confirmation modal */}
      {!showImportsOnly && pendingPlayerDelete && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fadeIn">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="text-white font-sports text-xl uppercase">Remove Player</h4>
                <p className="text-gray-400 text-sm mt-1">This removes the player from this team.</p>
              </div>
              <button onClick={() => setPendingPlayerDelete(null)} className="text-gray-500 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="bg-black/40 border border-white/10 rounded-lg p-4 text-sm text-gray-300">
              Remove <span className="text-white font-bold">{pendingPlayerDelete.name}</span> from the roster?
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setPendingPlayerDelete(null)}
                className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  removePlayerConfirmed(pendingPlayerDelete.id);
                }}
                className="px-4 py-2 rounded bg-brand-red text-white text-sm font-bold hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {!showImportsOnly &&
        pendingTeamMerge &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[120] p-4">
            <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 w-full max-w-2xl shadow-2xl animate-fadeIn">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h4 className="text-white font-sports text-xl uppercase">Merge Teams</h4>
                  <p className="text-gray-400 text-sm mt-1">
                    Use this to either sync one identity across seasons/divisions or consolidate exact duplicates.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (pendingTeamMerge.saving) return;
                    setPendingTeamMerge(null);
                  }}
                  disabled={pendingTeamMerge.saving}
                  className="text-gray-500 hover:text-white disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>

              {pendingTeamMerge.loading ? (
                <div className="py-10 text-sm text-gray-400">Loading teams...</div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 uppercase font-bold mb-1">Parent Team (Keep)</label>
                      <select
                        value={pendingTeamMerge.keepTeamId}
                        onChange={(event) => {
                          const nextKeepId = event.target.value;
                          setPendingTeamMerge((prev) => {
                            if (!prev) return prev;
                            const nextMergeId =
                              prev.mergeTeamId === nextKeepId
                                ? prev.options.find((option) => option.id !== nextKeepId)?.id || ''
                                : prev.mergeTeamId;
                            const nextProfileId = [nextKeepId, nextMergeId].includes(prev.profileSourceTeamId)
                              ? prev.profileSourceTeamId
                              : nextKeepId;
                            return {
                              ...prev,
                              keepTeamId: nextKeepId,
                              mergeTeamId: nextMergeId,
                              profileSourceTeamId: nextProfileId,
                              error: null,
                            };
                          });
                        }}
                        className="w-full appearance-none bg-black border border-white/20 rounded p-2 pr-10 dropdown-select-spacing text-white text-sm focus:border-brand-lime focus:outline-none"
                        style={{
                          backgroundImage:
                            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                          backgroundRepeat: 'no-repeat',
                          backgroundPosition: 'right 1.15rem center',
                          backgroundSize: '12px 8px',
                        }}
                      >
                        {pendingTeamMerge.keepOptions.map((option) => (
                          <option key={`merge-keep-${option.id}`} value={option.id}>
                            {formatMergeOptionLabel(option)}
                          </option>
                        ))}
                      </select>
                      {pendingTeamMerge.childTeamIds.length > 0 && (
                        <div className="mt-1 text-[11px] text-gray-500">
                          Child-merged teams are excluded from Parent Team selection.
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs text-gray-400 uppercase font-bold mb-1">
                        Duplicate Team (Delete After Merge)
                      </label>
                      <select
                        value={pendingTeamMerge.mergeTeamId}
                        onChange={(event) => {
                          const nextMergeId = event.target.value;
                          setPendingTeamMerge((prev) => {
                            if (!prev) return prev;
                            const nextProfileId = [prev.keepTeamId, nextMergeId].includes(prev.profileSourceTeamId)
                              ? prev.profileSourceTeamId
                              : prev.keepTeamId;
                            return {
                              ...prev,
                              mergeTeamId: nextMergeId,
                              profileSourceTeamId: nextProfileId,
                              error: null,
                            };
                          });
                        }}
                        className="w-full appearance-none bg-black border border-white/20 rounded p-2 pr-10 dropdown-select-spacing text-white text-sm focus:border-brand-lime focus:outline-none"
                        style={{
                          backgroundImage:
                            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                          backgroundRepeat: 'no-repeat',
                          backgroundPosition: 'right 1.15rem center',
                          backgroundSize: '12px 8px',
                        }}
                      >
                        {pendingTeamMerge.options
                          .filter((option) => option.id !== pendingTeamMerge.keepTeamId)
                          .map((option) => (
                            <option key={`merge-source-${option.id}`} value={option.id}>
                              {formatMergeOptionLabel(option)}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-400 uppercase font-bold mb-1">
                      Parent Profile Design Source
                    </label>
                    <select
                      value={pendingTeamMerge.profileSourceTeamId}
                      onChange={(event) =>
                        setPendingTeamMerge((prev) =>
                          prev
                            ? {
                                ...prev,
                                profileSourceTeamId: event.target.value,
                                error: null,
                              }
                            : prev
                        )
                      }
                      className="w-full appearance-none bg-black border border-white/20 rounded p-2 pr-10 dropdown-select-spacing text-white text-sm focus:border-brand-lime focus:outline-none"
                      style={{
                        backgroundImage:
                          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 1.15rem center',
                        backgroundSize: '12px 8px',
                      }}
                    >
                      {[mergeKeepTeam, mergeSourceTeam]
                        .filter((option): option is MergeTeamOption => !!option)
                        .map((option) => (
                          <option key={`merge-profile-${option.id}`} value={option.id}>
                            {formatMergeOptionLabel(option)}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-300">
                    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Keep Team</div>
                      <div className="text-white font-semibold">{mergeKeepTeam?.name || '-'}</div>
                      <div className="text-gray-400">
                        {mergeKeepTeam?.seasonLabel || 'Season'} {mergeKeepTeam?.division ? `• ${mergeKeepTeam.division}` : ''}
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Team To Remove</div>
                      <div className="text-white font-semibold">{mergeSourceTeam?.name || '-'}</div>
                      <div className="text-gray-400">
                        {mergeSourceTeam?.seasonLabel || 'Season'} {mergeSourceTeam?.division ? `• ${mergeSourceTeam.division}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
                    {mergeWillConsolidate ? (
                      'These teams are in the same season and division. Merge will transfer linked records into the parent team, then delete the duplicate.'
                    ) : (
                      <div className="space-y-1">
                        <p>
                          These teams are from different seasons/divisions. Merge will only sync profile identity
                          (name/logo/banner) while keeping both season records and stats intact.
                        </p>
                        <p className="text-[11px] text-yellow-200/80">
                          No team will be deleted in this mode. A confirmation banner will appear after saving.
                        </p>
                      </div>
                    )}
                  </div>

                  {pendingTeamMerge.error && (
                    <div className="rounded-lg border border-brand-red/40 bg-brand-red/10 px-3 py-2 text-xs text-brand-red">
                      {pendingTeamMerge.error}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setPendingTeamMerge(null)}
                  disabled={pendingTeamMerge.saving}
                  className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleTeamMergeConfirmed}
                  disabled={
                    pendingTeamMerge.loading ||
                    pendingTeamMerge.saving ||
                    !pendingTeamMerge.keepTeamId ||
                    !pendingTeamMerge.mergeTeamId ||
                    pendingTeamMerge.keepTeamId === pendingTeamMerge.mergeTeamId
                  }
                  className="px-4 py-2 rounded bg-brand-lime text-black text-sm font-bold hover:bg-lime-300 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  <GitMerge size={14} />
                  {pendingTeamMerge.saving ? 'Merging...' : mergeActionLabel}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {!showImportsOnly &&
        pendingTeamDelete &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-[120] p-4">
            <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-2xl animate-fadeIn">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h4 className="text-white font-sports text-xl uppercase">Delete Team</h4>
                  <p className="text-gray-400 text-sm mt-1">
                    This action permanently removes the team record. Player profiles are kept.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (deletingTeam) return;
                    setPendingTeamDelete(null);
                  }}
                  disabled={deletingTeam}
                  className="text-gray-500 hover:text-white disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3">
                <div className="bg-black/40 border border-white/10 rounded-lg p-4 text-sm text-gray-300 space-y-2">
                  <div>
                    Team: <span className="text-white font-bold">{pendingTeamDelete.team.name}</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    Linked players:{' '}
                    <span className="text-white font-semibold">
                      {pendingTeamDelete.checking ? 'Checking...' : pendingTeamDelete.playersCount}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400">
                    Scheduled games:{' '}
                    <span className="text-white font-semibold">
                      {pendingTeamDelete.checking ? 'Checking...' : pendingTeamDelete.gamesCount}
                    </span>
                  </div>
                </div>

                {pendingTeamDelete.error && (
                  <div className="rounded-lg border border-brand-red/40 bg-brand-red/10 px-3 py-2 text-xs text-brand-red">
                    {pendingTeamDelete.error}
                  </div>
                )}

                {!pendingTeamDelete.error &&
                  !pendingTeamDelete.checking &&
                  pendingTeamDelete.gamesCount > 0 && (
                    <div className="rounded-lg border border-brand-red/40 bg-brand-red/10 px-3 py-2 text-xs text-brand-red">
                      Delete blocked: this team is still linked to {pendingTeamDelete.gamesCount} game
                      {pendingTeamDelete.gamesCount === 1 ? '' : 's'}. Remove or reassign those games first.
                    </div>
                  )}

                {!pendingTeamDelete.error &&
                  !pendingTeamDelete.checking &&
                  pendingTeamDelete.playersCount > 0 &&
                  pendingTeamDelete.gamesCount === 0 && (
                    <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
                      {pendingTeamDelete.playersCount} player
                      {pendingTeamDelete.playersCount === 1 ? '' : 's'} will be detached from this team, but their
                      player profiles will stay active.
                    </div>
                  )}

                {!pendingTeamDelete.error &&
                  !pendingTeamDelete.checking &&
                  pendingTeamDelete.gamesCount === 0 && (
                    <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200 flex items-start gap-2">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>This cannot be undone. Confirm only if this team was created by mistake.</span>
                    </div>
                  )}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setPendingTeamDelete(null)}
                  disabled={deletingTeam}
                  className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteTeamConfirmed}
                  disabled={
                    pendingTeamDelete.checking ||
                    deletingTeam ||
                    pendingTeamDelete.gamesCount > 0
                  }
                  className="px-4 py-2 rounded bg-brand-red text-white text-sm font-bold hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deletingTeam ? 'Deleting...' : pendingTeamDelete.checking ? 'Checking...' : 'Delete Team'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

const TeamShareLinksManager: React.FC = () => {
  const navigate = useNavigate();
  const [seasons, setSeasons] = useState<TeamShareLinkSeason[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [selectedDivision, setSelectedDivision] = useState<string>('all');
  const [rows, setRows] = useState<TeamShareLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedTeamId, setCopiedTeamId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const normalizeText = useCallback((value: string) => value.replace(/\s+/g, ' ').trim(), []);
  const normalizeDivisionLabel = useCallback(
    (value: string) => normalizeText(value).replace(/\s*-\s*/g, ' - '),
    [normalizeText]
  );
  const normalizeJoinCode = useCallback(
    (value: string) => (value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    []
  );

  useEffect(() => {
    let active = true;
    const loadSeasons = async () => {
      try {
        setLoading(true);
        setError(null);
        const { data, error } = await supabase
          .from('seasons')
          .select('id,name,year,is_current,start_date')
          .order('start_date', { ascending: false });
        if (error) throw error;
        const seasonRows = sortSeasonsNewestFirst((data || []) as any);
        if (!active) return;
        setSeasons(seasonRows);
        const currentSeason =
          seasonRows.find((season: any) => season.is_current) ||
          seasonRows[0] ||
          null;
        setSelectedSeasonId(currentSeason?.id || '');
      } catch (err: any) {
        console.error('team share links seasons load failed', err);
        if (active) {
          setSeasons([]);
          setSelectedSeasonId('');
          setError(err?.message || 'Unable to load seasons.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    loadSeasons();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadTeams = async () => {
      if (!selectedSeasonId) {
        setRows([]);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        let teamRows: any[] = [];
        const withShortName = await supabase
          .from('teams')
          .select('id,name,division,short_name')
          .eq('season_id', selectedSeasonId)
          .order('name', { ascending: true });
        if (!withShortName.error) {
          teamRows = withShortName.data || [];
        } else {
          const msg = String(withShortName.error?.message || '').toLowerCase();
          const code = String(withShortName.error?.code || '').toUpperCase();
          const shortNameMissing =
            code === '42703' || (msg.includes('short_name') && msg.includes('column'));
          if (!shortNameMissing) throw withShortName.error;
          const fallback = await supabase
            .from('teams')
            .select('id,name,division')
            .eq('season_id', selectedSeasonId)
            .order('name', { ascending: true });
          if (fallback.error) throw fallback.error;
          teamRows = fallback.data || [];
        }

        const base = typeof window === 'undefined' ? '' : window.location.origin.replace(/\/+$/, '');
        const mapped = teamRows.map((row) => {
          const code = normalizeJoinCode(String(row?.short_name || ''));
          const params = new URLSearchParams();
          params.set('type', 'join');
          params.set('invite', '1');
          params.set('team', String(row?.id || ''));
          if (code) params.set('code', code);
          return {
            id: String(row?.id || ''),
            name: String(row?.name || 'Team'),
            division: normalizeDivisionLabel(String(row?.division || '')),
            code,
            link: `${base}/portal/register?${params.toString()}`,
          } as TeamShareLinkRow;
        });

        if (!active) return;
        setRows(mapped);
      } catch (err: any) {
        console.error('team share links load failed', err);
        if (active) {
          setRows([]);
          setError(err?.message || 'Unable to load team links.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    loadTeams();
    return () => {
      active = false;
    };
  }, [normalizeDivisionLabel, normalizeJoinCode, selectedSeasonId]);

  const selectedSeasonLabel =
    seasons.find((season) => season.id === selectedSeasonId)?.name || 'Select Season';

  const divisionOptions = useMemo(() => {
    const values = Array.from(
      new Set(rows.map((row) => row.division).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    return ['all', ...values];
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (selectedDivision === 'all') return rows;
    return rows.filter(
      (row) => normalizeDivisionLabel(row.division) === normalizeDivisionLabel(selectedDivision)
    );
  }, [rows, selectedDivision, normalizeDivisionLabel]);

  const copyTextWithReset = useCallback((text: string, onDone: () => void) => {
    return navigator.clipboard.writeText(text).then(onDone);
  }, []);

  const handleCopyOne = useCallback(async (row: TeamShareLinkRow) => {
    try {
      await copyTextWithReset(row.link, () => {
        setCopiedTeamId(row.id);
        setTimeout(() => {
          setCopiedTeamId((current) => (current === row.id ? null : current));
        }, 1800);
      });
    } catch (err) {
      console.warn('copy share link failed', err);
    }
  }, [copyTextWithReset]);

  const handleCopyAll = useCallback(async () => {
    if (!filteredRows.length) return;
    const payload = filteredRows
      .map((row) => `${row.name}${row.division ? ` (${row.division})` : ''}: ${row.link}`)
      .join('\n');
    try {
      await copyTextWithReset(payload, () => {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 1800);
      });
    } catch (err) {
      console.warn('copy all share links failed', err);
    }
  }, [copyTextWithReset, filteredRows]);

  const handleDownloadCsv = useCallback(() => {
    if (!filteredRows.length) return;
    const escapeCsv = (value: string) => `"${String(value || '').replace(/"/g, '""')}"`;
    const csvRows = [
      ['team_name', 'division', 'team_code', 'share_link'],
      ...filteredRows.map((row) => [row.name, row.division, row.code, row.link]),
    ];
    const csv = csvRows.map((row) => row.map((value) => escapeCsv(value)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeSeason = selectedSeasonLabel.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'season';
    link.href = url;
    link.download = `team-share-links-${safeSeason}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filteredRows, selectedSeasonLabel]);

  return (
    <div className="animate-fadeIn space-y-6">
      <div className="bg-brand-dark border border-white/10 rounded-xl p-4 sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs uppercase text-brand-grey font-bold mb-1">Shareable Team Links</div>
            <h2 className="font-sports text-2xl text-white uppercase">All Team Join Links</h2>
            <p className="text-sm text-gray-400 mt-2">
              Dedicated admin view for copying and exporting all public team join links.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={selectedSeasonId}
              onChange={(e) => setSelectedSeasonId(e.target.value)}
              className="w-full sm:min-w-[220px] appearance-none bg-black border border-white/20 text-white text-sm font-sports uppercase tracking-wide px-4 pr-10 dropdown-select-spacing py-2 rounded-lg focus:outline-none focus:border-brand-lime"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 1.15rem center',
                backgroundSize: '12px 8px',
              }}
            >
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
            <select
              value={selectedDivision}
              onChange={(e) => setSelectedDivision(e.target.value)}
              className="w-full sm:min-w-[220px] appearance-none bg-black border border-white/20 text-white text-sm font-sports uppercase tracking-wide px-4 pr-10 dropdown-select-spacing py-2 rounded-lg focus:outline-none focus:border-brand-lime"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 1.15rem center',
                backgroundSize: '12px 8px',
              }}
            >
              {divisionOptions.map((division) => (
                <option key={division} value={division}>
                  {division === 'all' ? 'All Divisions' : division}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-brand-dark border border-white/10 rounded-xl p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div className="text-sm text-gray-400">
            Showing <span className="text-white font-bold">{filteredRows.length}</span> team link{filteredRows.length === 1 ? '' : 's'} for <span className="text-white">{selectedSeasonLabel}</span>.
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => void handleCopyAll()}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:border-brand-lime hover:text-brand-lime transition-colors"
            >
              <Copy size={14} />
              {copiedAll ? 'Copied All' : 'Copy All Links'}
            </button>
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:border-brand-lime hover:text-brand-lime transition-colors"
            >
              <Download size={14} />
              Download CSV
            </button>
          </div>
        </div>

        {error && <div className="mb-4 text-sm text-brand-red">{error}</div>}
        {loading ? (
          <div className="text-sm text-gray-400">Loading team links...</div>
        ) : filteredRows.length === 0 ? (
          <div className="text-sm text-gray-400">No team links found for that selection.</div>
        ) : (
          <div className="space-y-3">
            {filteredRows.map((row) => (
              <div key={row.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-white font-bold text-lg">{row.name}</span>
                      {row.division && (
                        <span className="rounded-full border border-brand-lime/30 bg-brand-lime/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-lime">
                          {row.division}
                        </span>
                      )}
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-gray-300">
                        {row.code || 'No Code'}
                      </span>
                    </div>
                    <div className="break-all rounded-lg border border-white/10 bg-black px-3 py-3 text-xs text-gray-300">
                      {row.link}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleCopyOne(row)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:border-brand-lime hover:text-brand-lime transition-colors"
                    >
                      <Copy size={14} />
                      {copiedTeamId === row.id ? 'Copied' : 'Copy Link'}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/team/${row.id}`)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white hover:border-brand-lime hover:text-brand-lime transition-colors"
                    >
                      View Team
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const WaiverAuditManager: React.FC = () => {
  const navigate = useNavigate();
  const selectStyle: React.CSSProperties = {
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 1.15rem center',
    backgroundSize: '12px 8px',
  };
  const [profiles, setProfiles] = useState<WaiverAuditProfileRow[]>([]);
  const [players, setPlayers] = useState<WaiverAuditPlayerRow[]>([]);
  const [teams, setTeams] = useState<WaiverAuditTeamRow[]>([]);
  const [seasons, setSeasons] = useState<WaiverAuditSeasonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [seasonFilter, setSeasonFilter] = useState<string>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');

  const resolveSeasonLabel = useCallback((season: WaiverAuditSeasonRow) => {
    if (season.name) return season.name;
    if (season.year) return `Season ${season.year}`;
    return 'Season';
  }, []);

  const teamMap = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((team) => {
      if (team.id) map.set(team.id, team.name || 'Team');
    });
    return map;
  }, [teams]);

  const teamMetaMap = useMemo(() => {
    const map = new Map<string, { name: string; division: string; seasonId: string }>();
    teams.forEach((team) => {
      if (!team.id) return;
      map.set(team.id, {
        name: team.name || 'Team',
        division: team.division || '',
        seasonId: team.season_id || '',
      });
    });
    return map;
  }, [teams]);

  const seasonMap = useMemo(() => {
    const map = new Map<string, string>();
    seasons.forEach((season) => {
      if (season.id) map.set(season.id, resolveSeasonLabel(season));
    });
    return map;
  }, [seasons, resolveSeasonLabel]);

  useEffect(() => {
    let active = true;
    const loadAll = async () => {
      try {
        setLoading(true);
        setError(null);

        const loadProfiles = async () => {
          try {
            const { data, error } = await supabase
              .from('profiles')
              .select('user_id,display_name,email,email_address,phone');
            if (error) throw error;
            return data || [];
          } catch (err) {
            if (!supabaseAdmin) throw err;
            const { data, error } = await supabaseAdmin
              .from('profiles')
              .select('user_id,display_name,email,email_address,phone');
            if (error) throw error;
            return data || [];
          }
        };

        const loadPlayers = async () => {
          const selectVariants = [
            'id,user_id,first_name,last_name,team_id,season_id,created_at,waiver_accepted,waiver_accepted_at,waiver_document_path,email,email_address',
            'id,user_id,first_name,last_name,team_id,season_id,created_at,waiver_accepted,waiver_accepted_at,email,email_address',
            'id,user_id,first_name,last_name,team_id,season_id,created_at,waiver_accepted,email,email_address',
            'id,user_id,first_name,last_name,team_id,season_id,created_at,email,email_address',
            'id,user_id,first_name,last_name,team_id,season_id,created_at,email',
            'id,user_id,first_name,last_name,team_id,season_id,created_at',
          ];
          const isMissingColumn = (err: any) => {
            const code = (err?.code || '').toString();
            const msg = (err?.message || '').toString().toLowerCase();
            return code === '42703' || msg.includes('column') || msg.includes('does not exist');
          };

          const run = async (client: typeof supabase) => {
            let lastErr: any = null;
            for (const sel of selectVariants) {
              const { data, error } = await client.from('players').select(sel).order('created_at', { ascending: false });
              if (!error) return data || [];
              lastErr = error;
              if (!isMissingColumn(error)) break;
            }
            throw lastErr;
          };

          try {
            return await run(supabase);
          } catch (err) {
            if (!supabaseAdmin) throw err;
            return await run(supabaseAdmin as any);
          }
        };

        const loadTeams = async () => {
          const run = async (client: typeof supabase) => {
            const { data, error } = await client.from('teams').select('id,name,division,season_id');
            if (error) throw error;
            return data || [];
          };
          try {
            return await run(supabase);
          } catch (err) {
            if (!supabaseAdmin) throw err;
            return await run(supabaseAdmin as any);
          }
        };

        const loadSeasons = async () => {
          const run = async (client: typeof supabase) => {
            const { data, error } = await client.from('seasons').select('id,name,year,is_current,start_date');
            if (error) throw error;
            return data || [];
          };
          try {
            return await run(supabase);
          } catch (err) {
            if (!supabaseAdmin) throw err;
            return await run(supabaseAdmin as any);
          }
        };

        const [nextProfiles, nextPlayers, nextTeams, nextSeasons] = await Promise.all([
          loadProfiles(),
          loadPlayers(),
          loadTeams(),
          loadSeasons(),
        ]);

        if (!active) return;
        setProfiles(nextProfiles as WaiverAuditProfileRow[]);
        setPlayers(nextPlayers as WaiverAuditPlayerRow[]);
        setTeams(nextTeams as WaiverAuditTeamRow[]);
        setSeasons(nextSeasons as WaiverAuditSeasonRow[]);
      } catch (err: any) {
        console.error('waiver audit load failed', err);
        if (active) setError(err?.message || 'Unable to load waiver audit records.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadAll();
    return () => {
      active = false;
    };
  }, []);

  const profileMap = useMemo(() => {
    const map = new Map<string, WaiverAuditProfileRow>();
    profiles.forEach((profile) => {
      if (profile.user_id) map.set(profile.user_id, profile);
    });
    return map;
  }, [profiles]);

  const profileEmailUserMap = useMemo(() => {
    const map = new Map<string, string>();
    profiles.forEach((profile) => {
      const emails = [profile.email, profile.email_address]
        .map((value) => normalizeEmail(value))
        .filter(Boolean);
      emails.forEach((email) => {
        if (!map.has(email)) map.set(email, profile.user_id);
      });
    });
    return map;
  }, [profiles]);

  const currentSeasonId = useMemo(() => {
    const current = seasons.find((season) => !!season.is_current);
    return current?.id || null;
  }, [seasons]);

  const registrantRows = useMemo<WaiverAuditRegistrantRow[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = players.filter((player) => {
      const playerEmail = normalizeEmail(player.email || player.email_address || '');
      const resolvedUserId = player.user_id || (playerEmail ? profileEmailUserMap.get(playerEmail) || null : null);
      if (!resolvedUserId) return false;
      if (seasonFilter !== 'all' && player.season_id !== seasonFilter) return false;
      if (teamFilter !== 'all' && player.team_id !== teamFilter) return false;
      const profile = profileMap.get(resolvedUserId) || null;
      const displayName = profile?.display_name || '';
      const fullName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Player';
      const teamName = player.team_id ? teamMap.get(player.team_id) || 'Team' : 'No Team';
      const seasonName = player.season_id ? seasonMap.get(player.season_id) || 'Season' : 'No Season';
      return (
        !q ||
        fullName.toLowerCase().includes(q) ||
        displayName.toLowerCase().includes(q) ||
        (profile?.email || profile?.email_address || playerEmail || '').toLowerCase().includes(q) ||
        teamName.toLowerCase().includes(q) ||
        seasonName.toLowerCase().includes(q)
      );
    });

    return filtered
      .map((player) => {
        const playerEmail = normalizeEmail(player.email || player.email_address || '');
        const resolvedUserId = player.user_id || (playerEmail ? profileEmailUserMap.get(playerEmail) || null : null) || '';
        const profile = profileMap.get(resolvedUserId) || null;
        const legacyInferredApproval = !player.waiver_accepted && !!resolvedUserId;
        const waiverAccepted = !!player.waiver_accepted || legacyInferredApproval;
        const waiverAcceptedAt =
          player.waiver_accepted_at ||
          (waiverAccepted ? player.created_at || '' : '');
        const waiverDocumentPath =
          player.waiver_document_path ||
          (legacyInferredApproval ? 'legacy-registration-flow' : '');
        return {
          playerId: player.id,
          userId: resolvedUserId,
          fullName: `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Player',
          displayName: profile?.display_name || '',
          email: profile?.email || profile?.email_address || playerEmail || '',
          phone: profile?.phone || '',
          teamId: player.team_id || '',
          teamName: player.team_id ? teamMap.get(player.team_id) || 'Team' : 'No Team',
          seasonName: player.season_id ? seasonMap.get(player.season_id) || 'Season' : 'No Season',
          waiverAccepted,
          waiverAcceptedAt,
          waiverDocumentPath,
          createdAt: player.created_at || '',
          seasonId: player.season_id || '',
          legacyInferredApproval,
        };
      })
      .sort((a, b) => {
        const byWaiverDate = new Date(b.waiverAcceptedAt || 0).getTime() - new Date(a.waiverAcceptedAt || 0).getTime();
        if (byWaiverDate !== 0) return byWaiverDate;
        return a.fullName.localeCompare(b.fullName);
      });
  }, [players, profileEmailUserMap, profileMap, query, seasonFilter, seasonMap, teamFilter, teamMap]);

  const teamFilterOptions = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>();
    registrantRows.forEach((row) => {
      if (!row.teamId || byId.has(row.teamId)) return;
      const meta = teamMetaMap.get(row.teamId);
      const seasonLabel = meta?.seasonId ? seasonMap.get(meta.seasonId) || row.seasonName : row.seasonName;
      const divisionLabel = meta?.division || '';
      const contextParts =
        seasonFilter === 'all'
          ? [seasonLabel, divisionLabel].filter(Boolean)
          : [divisionLabel].filter(Boolean);
      const label = contextParts.length
        ? `${row.teamName} (${contextParts.join(' • ')})`
        : row.teamName;
      byId.set(row.teamId, { id: row.teamId, label });
    });
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [registrantRows, seasonFilter, seasonMap, teamMetaMap]);

  const summary = useMemo(() => {
    const accepted = registrantRows.filter((row) => row.waiverAccepted).length;
    const missing = registrantRows.length - accepted;
    const currentSeasonCount = currentSeasonId
      ? registrantRows.filter((row) => row.seasonId === currentSeasonId).length
      : registrantRows.length;
    return { total: registrantRows.length, accepted, missing, currentSeasonCount };
  }, [registrantRows, currentSeasonId]);

  const exportCsv = useCallback(() => {
    const escapeCsv = (value: string) => `"${String(value || '').replace(/"/g, '""')}"`;
    const rows = [
      ['player_name', 'display_name', 'user_id', 'email', 'phone', 'team', 'season', 'waiver_status', 'waiver_signed_at', 'waiver_document_path', 'registration_created_at'],
      ...registrantRows.map((row) => [
        row.fullName,
        row.displayName,
        row.userId,
        row.email,
        row.phone,
        row.teamName,
        row.seasonName,
        row.waiverAccepted ? 'accepted' : 'missing',
        row.waiverAcceptedAt,
        row.waiverDocumentPath,
        row.createdAt,
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => escapeCsv(value)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `waiver-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [registrantRows]);

  return (
    <div className="animate-fadeIn space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="font-sports text-2xl text-white uppercase">Waiver Audit</h2>
          <p className="text-xs text-gray-400">Only website registrants with actual user accounts are shown here. For legacy completed registrations, the registration timestamp is treated as the waiver signing timestamp.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportCsv}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-white/5 border border-white/10 text-xs uppercase text-white hover:border-brand-lime"
          >
            <Download size={14} />
            Export Waiver Audit
          </button>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-white/5 border border-white/10 text-xs uppercase text-white hover:border-brand-lime"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-brand-dark border border-white/10 rounded-lg p-4">
          <div className="text-xs uppercase text-brand-grey font-bold mb-1">Website Registrants</div>
          <div className="text-2xl font-sports text-white">{summary.total}</div>
        </div>
        <div className="bg-brand-dark border border-white/10 rounded-lg p-4">
          <div className="text-xs uppercase text-brand-grey font-bold mb-1">Waiver Accepted</div>
          <div className="text-2xl font-sports text-brand-lime">{summary.accepted}</div>
        </div>
        <div className="bg-brand-dark border border-white/10 rounded-lg p-4">
          <div className="text-xs uppercase text-brand-grey font-bold mb-1">Waiver Missing</div>
          <div className="text-2xl font-sports text-white">{summary.missing}</div>
        </div>
        <div className="bg-brand-dark border border-white/10 rounded-lg p-4">
          <div className="text-xs uppercase text-brand-grey font-bold mb-1">Current Season</div>
          <div className="text-2xl font-sports text-white">{summary.currentSeasonCount}</div>
        </div>
      </div>

      <div className="bg-brand-dark border border-white/10 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
          <div className="md:col-span-2">
            <div className="h-11 flex items-center gap-2 bg-black border border-white/20 rounded px-3 focus-within:border-brand-lime/60">
              <Search size={16} className="text-gray-500 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search registrant, email, team"
                className="bg-transparent text-white w-full outline-none text-sm placeholder:text-gray-300"
              />
            </div>
          </div>
          <div>
            <select
              value={seasonFilter}
              onChange={(e) => setSeasonFilter(e.target.value)}
              className="w-full h-11 appearance-none bg-black border border-white/20 rounded px-3 pr-11 dropdown-select-spacing text-white text-sm leading-none focus:outline-none focus:border-brand-lime/60"
              style={selectStyle}
            >
              <option value="all">All Seasons</option>
              {sortSeasonsNewestFirst(seasons).map((season) => (
                <option key={season.id} value={season.id}>
                  {resolveSeasonLabel(season)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="w-full h-11 appearance-none bg-black border border-white/20 rounded px-3 pr-11 dropdown-select-spacing text-white text-sm leading-none focus:outline-none focus:border-brand-lime/60"
              style={selectStyle}
            >
              <option value="all">All Teams</option>
              {teamFilterOptions.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-brand-dark border border-white/10 rounded-xl overflow-hidden">
        {error && <div className="px-4 py-3 text-sm text-brand-red border-b border-white/10">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-neutral-900 text-brand-grey text-xs uppercase font-bold">
              <tr>
                <th className="p-4">Registrant</th>
                <th className="p-4">Contact</th>
                <th className="p-4">Team / Season</th>
                <th className="p-4">Waiver Status</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm text-white">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-gray-400 text-sm">Loading waiver audit...</td>
                </tr>
              ) : registrantRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-gray-400 text-sm">No waiver audit records match this view.</td>
                </tr>
              ) : (
                registrantRows.map((row) => (
                  <tr key={row.playerId} className="hover:bg-white/5">
                    <td className="p-4">
                      <div className="font-bold">{row.displayName || row.fullName}</div>
                      <div className="text-[11px] text-gray-500">{row.fullName}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{row.userId}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-gray-200 font-mono text-xs">{row.email || 'No email'}</div>
                      <div className="text-[11px] text-gray-500">{row.phone || 'No phone'}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-white">{row.teamName || 'No Team'}</div>
                      <div className="text-[11px] text-gray-500">{row.seasonName || 'No Season'}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col items-start gap-2">
                        <span
                          className={`inline-flex px-2 py-1 rounded border text-[11px] uppercase ${
                            row.waiverAccepted
                              ? 'border-emerald-400/60 text-emerald-100 bg-emerald-500/15'
                              : 'border-red-400/60 text-red-100 bg-red-500/10'
                          }`}
                        >
                          {row.waiverAccepted ? 'Waiver Accepted' : 'Waiver Missing'}
                        </span>
                        <div className="text-[11px] text-gray-500">
                          {row.waiverAcceptedAt
                            ? `Approved ${new Date(row.waiverAcceptedAt).toLocaleString()}`
                            : 'No waiver approval timestamp'}
                        </div>
                        {row.legacyInferredApproval && (
                          <div className="text-[11px] text-gray-500">Legacy record: registration timestamp used as waiver signing time.</div>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => navigate(`/admin/player/${row.playerId}`)}
                        className="text-xs uppercase font-bold text-brand-lime"
                      >
                        View Player
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// --- COMPONENT: BOX SCORE EDITOR ---
interface BoxScoreEditorProps {
  game: Game;
  teams: Team[];
  onClose: () => void;
  onSaved?: () => Promise<void> | void;
}

const BoxScoreEditor: React.FC<BoxScoreEditorProps> = ({ game, teams, onClose, onSaved }) => {
  const rosterTeams = teams.length ? teams : TEAMS;
  const [selectedHomeTeamId, setSelectedHomeTeamId] = useState(game.homeTeamId);
  const [selectedAwayTeamId, setSelectedAwayTeamId] = useState(game.awayTeamId);
  const [gameDate, setGameDate] = useState(game.date || '');
  const [gameTime, setGameTime] = useState(game.time || '');
  const gameDateInputRef = useRef<HTMLInputElement | null>(null);
  const homeTeam = rosterTeams.find((t) => t.id === selectedHomeTeamId);
  const awayTeam = rosterTeams.find((t) => t.id === selectedAwayTeamId);
  const homeTeamOptions = useMemo(
    () => rosterTeams.filter((team) => team.id !== selectedAwayTeamId),
    [rosterTeams, selectedAwayTeamId]
  );
  const awayTeamOptions = useMemo(
    () => rosterTeams.filter((team) => team.id !== selectedHomeTeamId),
    [rosterTeams, selectedHomeTeamId]
  );

  const [youtubeLink, setYoutubeLink] = useState(game.youtubeLink || '');
  const [homeScore, setHomeScore] = useState(game.homeScore || 0);
  const [awayScore, setAwayScore] = useState(game.awayScore || 0);
  const [gameStatus, setGameStatus] = useState(game.status);
  const [forfeitWinnerTeamId, setForfeitWinnerTeamId] = useState(() => {
    if (game.status !== 'FORFEITED') return '';
    if ((game.homeScore ?? 0) > (game.awayScore ?? 0)) return game.homeTeamId;
    if ((game.awayScore ?? 0) > (game.homeScore ?? 0)) return game.awayTeamId;
    return game.homeTeamId || game.awayTeamId || '';
  });

  const [homeRoster, setHomeRoster] = useState<RosterPlayer[]>([]);
  const [awayRoster, setAwayRoster] = useState<RosterPlayer[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [activePlayerIds, setActivePlayerIds] = useState<Set<string>>(new Set());
  const [playerStats, setPlayerStats] = useState<PlayerGameStats[]>([]);
  const [dragging, setDragging] = useState<{ team: 'home' | 'away'; index: number } | null>(null);
  const supportsSplitRebounds = useRef<boolean>(true);
  const [scoreLocked, setScoreLocked] = useState(true);
  const shouldAutoSyncScoreRef = useRef(false);
  const [unlockedPlayerIds, setUnlockedPlayerIds] = useState<Set<string>>(new Set());
  const [guestPlayerIds, setGuestPlayerIds] = useState<Set<string>>(new Set());
  type GameGuestRecord = {
    id: string;
    game_id: string;
    team_id: string;
    name: string;
    email?: string | null;
    jersey_number?: string | null;
    created_at?: string;
  };
  const buildGuestRosterPlayer = (entry: GameGuestRecord, teamId: string | undefined): RosterPlayer => ({
    id: entry.id,
    teamId: teamId || '',
    name: entry.name || 'Guest Player',
    number: entry.jersey_number ? String(entry.jersey_number) : '',
    isCaptain: false,
    isGuest: true,
    email: entry.email || null,
  });
  const loadGuestsForGame = useCallback(async (): Promise<GameGuestRecord[]> => {
    if (!game.id) return [];
    try {
      const { data, error } = await supabase
        .from('game_guest_players')
        .select('*')
        .eq('game_id', game.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as GameGuestRecord[];
    } catch (err) {
      console.warn('Guest player load failed', err);
      return [];
    }
  }, [game.id]);
  const [guestForm, setGuestForm] = useState({
    team: 'home' as 'home' | 'away',
    name: '',
    email: '',
    number: '',
  });
  const [guestError, setGuestError] = useState<string | null>(null);
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [guestAdding, setGuestAdding] = useState(false);
  const [guestRemovingIds, setGuestRemovingIds] = useState<Set<string>>(new Set());
  const [pendingGuestDelete, setPendingGuestDelete] = useState<{
    id: string;
    name: string;
    team: 'home' | 'away';
  } | null>(null);
  const [teamNameOverrides, setTeamNameOverrides] = useState<Record<string, string>>({});

  // Team editor (full modal, used from box score view)
  const [teamEditor, setTeamEditor] = useState<{ teamId: string } | null>(null);
  const [teamEditorLoading, setTeamEditorLoading] = useState(false);
  const [teamEditorSaving, setTeamEditorSaving] = useState(false);
  const [teamEditorError, setTeamEditorError] = useState<string | null>(null);
  const [teamEditorForm, setTeamEditorForm] = useState<
    | null
    | {
        id: string;
        name: string;
        division: string;
        seasonId: string | null;
        logoUrl: string;
        bannerUrl: string;
      }
  >(null);
  const [teamEditorDivisionOptions, setTeamEditorDivisionOptions] = useState<string[]>([]);
  const [teamEditorRoster, setTeamEditorRoster] = useState<
    Array<{
      id: string;
      name: string;
      number: string;
      isCaptain: boolean;
    }>
  >([]);
  const [teamEditorInitialRosterIds, setTeamEditorInitialRosterIds] = useState<string[]>([]);
  const [teamEditorNewPlayer, setTeamEditorNewPlayer] = useState({ name: '', email: '', number: '' });
  const [teamEditorShowNewPlayer, setTeamEditorShowNewPlayer] = useState(false);
  const [teamEditorLogoFile, setTeamEditorLogoFile] = useState<File | null>(null);
  const [teamEditorBannerFile, setTeamEditorBannerFile] = useState<File | null>(null);
  const [teamEditorLogoPreview, setTeamEditorLogoPreview] = useState<string>('');
  const [teamEditorBannerPreview, setTeamEditorBannerPreview] = useState<string>('');
  const [teamEditorRosterWarning, setTeamEditorRosterWarning] = useState<{
    title: string;
    description: string;
    body: string;
  } | null>(null);

  const [editingPlayerQuick, setEditingPlayerQuick] = useState<{
    playerId: string;
    displayName: string;
    jerseyNumber: string;
    jerseyName: string;
  } | null>(null);
  const [editingPlayerQuickSaving, setEditingPlayerQuickSaving] = useState(false);
  const [editingPlayerQuickError, setEditingPlayerQuickError] = useState<string | null>(null);
  // Box score layout: single table per team with view toggle (core / shooting / misc)

  const sortRosterByJersey = (list: RosterPlayer[]) =>
    [...list].sort((a, b) => {
      const numA = parseInt(String(a.number || '').replace(/\D/g, ''), 10);
      const numB = parseInt(String(b.number || '').replace(/\D/g, ''), 10);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
      if (!Number.isNaN(numA)) return -1;
      if (!Number.isNaN(numB)) return 1;
      return String(a.number || '').localeCompare(String(b.number || ''));
    });

  const normalizeEmail = (value: string) => value.trim().toLowerCase();
  const isValidEmail = (value: string) => /\S+@\S+\.\S+/.test(value.trim());

  const signTeamEditorAssetUrl = useCallback(async (path: string, fallback?: string) => {
    if (!path) return fallback || '';
    if (path.startsWith('http') && path.includes('/object/public/')) return path;
    if (path.startsWith('http') && !path.includes('team-assets')) return path;

    const stripQuery = (p: string) => p.split('?')[0];
    const cleanPath = stripQuery(path);
    const marker = 'team-assets/';
    const idx = cleanPath.indexOf(marker);
    const bucketPath = idx >= 0 ? cleanPath.slice(idx + marker.length) : cleanPath;

    try {
      const { data, error } = await supabase.storage
        .from('team-assets')
        .createSignedUrl(bucketPath, 60 * 60 * 24 * 365);
      if (error) throw error;
      return data?.signedUrl || path;
    } catch {
      return fallback || path;
    }
  }, []);

  const getTeamDisplayName = useCallback(
    (teamId?: string | null, fallbackName?: string) => {
      if (!teamId) return fallbackName || '';
      return (teamNameOverrides[teamId] || fallbackName || '').trim();
    },
    [teamNameOverrides]
  );

  const openTeamEditor = (teamId: string, currentName: string) => {
    setTeamEditor({ teamId });
    setTeamEditorError(null);
    setTeamEditorLoading(true);
    setTeamEditorSaving(false);
    setTeamEditorLogoFile(null);
    setTeamEditorBannerFile(null);
    setTeamEditorNewPlayer({ name: '', email: '', number: '' });
    setTeamEditorShowNewPlayer(false);

    (async () => {
      try {
        const { data: teamRow, error: teamErr } = await supabase
          .from('teams')
          .select('*')
          .eq('id', teamId)
          .maybeSingle();
        if (teamErr) throw teamErr;

        const seasonId: string | null = (teamRow as any)?.season_id || game.seasonId || null;

        let divisionOptions: string[] = [];
        if (seasonId) {
          try {
            const { data: divs, error: divErr } = await supabase
              .from('divisions')
              .select('name')
              .eq('season_id', seasonId)
              .order('name', { ascending: true });
            if (!divErr) {
              divisionOptions = Array.from(
                new Set((divs || []).map((d: any) => String(d.name || '').trim()).filter(Boolean))
              );
            }
          } catch {
            // ignore
          }
        }
        setTeamEditorDivisionOptions(divisionOptions);

        const { data: playerRows, error: playerErr } = await supabase
          .from('players')
          .select('id,first_name,last_name,jersey_number,is_captain,team_id,season_id')
          .eq('team_id', teamId)
          .eq('season_id', seasonId || game.seasonId);
        if (playerErr) throw playerErr;

        const roster = (playerRows || [])
          .map((p: any) => ({
            id: p.id,
            name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Player',
            number: p.jersey_number != null ? String(p.jersey_number) : '',
            isCaptain: !!p.is_captain,
          }))
          .sort((a, b) => {
            const an = Number(normalizeJerseyNumberInput(String(a.number || '')) ?? 9999);
            const bn = Number(normalizeJerseyNumberInput(String(b.number || '')) ?? 9999);
            return an - bn;
          });

        setTeamEditorInitialRosterIds(roster.map((p) => p.id));
        setTeamEditorRoster(roster);

        const logoPath = String((teamRow as any)?.logo_url || '');
        const bannerPath = String((teamRow as any)?.banner_url || '');
        const signedLogo = logoPath ? await signTeamEditorAssetUrl(logoPath) : '';
        const signedBanner = bannerPath ? await signTeamEditorAssetUrl(bannerPath) : '';

        setTeamEditorLogoPreview(signedLogo || '');
        setTeamEditorBannerPreview(signedBanner || '');
        setTeamEditorForm({
          id: teamId,
          name: String((teamRow as any)?.name || currentName || '').trim(),
          division: String((teamRow as any)?.division || ''),
          seasonId,
          logoUrl: logoPath,
          bannerUrl: bannerPath,
        });
      } catch (err: any) {
        console.error('Team editor load failed', err);
        setTeamEditorError(err?.message || 'Unable to load team details.');
      } finally {
        setTeamEditorLoading(false);
      }
    })();
  };

  const saveTeamEditor = async () => {
    if (!teamEditor || !teamEditorForm) return;
    if (teamEditorSaving) return;

    const cleanedName = (teamEditorForm.name || '').trim();
    if (!cleanedName) {
      setTeamEditorError('Team name is required.');
      return;
    }

    setTeamEditorSaving(true);
    setTeamEditorError(null);
    try {
      if (teamEditorRoster.length === 0) {
        setTeamEditorRosterWarning({
          title: 'Last Player Cannot Be Removed',
          description: 'A team cannot be saved with zero players on the roster.',
          body: 'Add another player first, or keep at least one player on the team before clicking Save Changes.',
        });
        return;
      }

      const hasCaptainInRoster = teamEditorRoster.some((player) => !!player.isCaptain);
      if (!hasCaptainInRoster) {
        setTeamEditorRosterWarning({
          title: 'Captain Required',
          description: 'Every team must have a captain before changes can be saved.',
          body: 'Assign the captain crown to one player on this roster, then save again.',
        });
        return;
      }

      const keepIds = teamEditorRoster
        .map((p) => p.id)
        .filter((id) => id && !String(id).startsWith('p_'));
      const toDelete = teamEditorInitialRosterIds.filter((id) => !keepIds.includes(id));
      if (toDelete.length) {
        const { data: captainRows, error: captainRowsErr } = await supabase
          .from('players')
          .select('id,first_name,last_name,is_captain')
          .in('id', toDelete);
        if (captainRowsErr) throw captainRowsErr;

        const captainDeletion = (captainRows || []).find((row: any) => !!row?.is_captain);
        if (captainDeletion) {
          const captainName =
            [captainDeletion.first_name, captainDeletion.last_name].filter(Boolean).join(' ').trim() ||
            'this player';
          setTeamEditorRosterWarning({
            title: 'Captain Cannot Be Removed',
            description: 'Team captain records cannot be removed from this screen without reassigning captain first.',
            body: `${captainName} is currently the team captain. Assign the captain crown to another player first, then remove this player if needed.`,
          });
          return;
        }
      }

      let logoUrl = teamEditorForm.logoUrl || '';
      let bannerUrl = teamEditorForm.bannerUrl || '';

      const uploadAsset = async (file: File, type: 'logo' | 'banner') => {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `teams/${teamEditorForm.id}/${type}-${Date.now()}-${safeName}`;
        const { error } = await supabase.storage.from('team-assets').upload(path, file, { upsert: true });
        if (error) throw error;
        return path;
      };

      if (teamEditorLogoFile) {
        logoUrl = await uploadAsset(teamEditorLogoFile, 'logo');
      }
      if (teamEditorBannerFile) {
        bannerUrl = await uploadAsset(teamEditorBannerFile, 'banner');
      }

      const { error: teamErr } = await supabase
        .from('teams')
        .update({
          name: cleanedName,
          division: (teamEditorForm.division || '').trim() || null,
          logo_url: logoUrl || null,
          banner_url: bannerUrl || null,
        })
        .eq('id', teamEditorForm.id);
      if (teamErr) throw teamErr;

      // Sync roster (permanent players)
      if (toDelete.length) {
        const { error: delErr } = await supabase.from('players').delete().in('id', toDelete);
        if (delErr) throw delErr;
      }

      const seasonId = teamEditorForm.seasonId || game.seasonId || null;
      const missingRosterJersey = teamEditorRoster.find(
        (p) => !normalizeJerseyNumberInput(p.number)
      );
      if (missingRosterJersey) {
        const playerName = String(missingRosterJersey.name || '').trim() || 'this player';
        setError(`Jersey number is required for ${playerName}.`);
        return;
      }
      const mapped = teamEditorRoster.map((p) => {
        const parts = String(p.name || '').trim().split(' ').filter(Boolean);
        const first = parts.shift() || 'Player';
        const last = parts.join(' ') || '';
        const jersey = normalizeJerseyNumberInput(p.number);
        const base: any = {
          team_id: teamEditorForm.id,
          season_id: seasonId,
          first_name: first,
          last_name: last || '',
          jersey_number: jersey ?? null,
          is_captain: !!p.isCaptain,
          is_guest: false,
        };
        if (p.id && !String(p.id).startsWith('p_')) {
          base.id = p.id;
        }
        return base;
      });

      const existingPayload = mapped.filter((p) => p.id);
      const newPayload = mapped.filter((p) => !p.id);
      if (newPayload.length) {
        const { error: insErr } = await supabase.from('players').insert(newPayload);
        if (insErr) throw insErr;
      }
      if (existingPayload.length) {
        const { error: upErr } = await supabase.from('players').upsert(existingPayload, { onConflict: 'id' });
        if (upErr) throw upErr;
      }

      setTeamNameOverrides((prev) => ({ ...prev, [teamEditorForm.id]: cleanedName }));
      if (onSaved) {
        await onSaved();
      }

      // Refresh roster in box score view
      try {
        const teamIds = [selectedHomeTeamId, selectedAwayTeamId].filter(Boolean);
        if (teamIds.length) {
          const { data: refreshed, error: rosterErr } = await supabase
            .from('players')
            .select('*')
            .in('team_id', teamIds);
          if (!rosterErr && refreshed) {
            const mappedPlayers: RosterPlayer[] =
              refreshed
                ?.filter((p: any) => !p.is_guest)
                .map((p: any) => ({
                  id: p.id,
                  teamId: p.team_id,
                  name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Player',
                  number: p.jersey_number != null ? String(p.jersey_number) : '',
                  isCaptain: !!p.is_captain,
                })) || [];
            const home = sortRosterByJersey(mappedPlayers.filter((p) => p.teamId === selectedHomeTeamId));
            const away = sortRosterByJersey(mappedPlayers.filter((p) => p.teamId === selectedAwayTeamId));
            setHomeRoster(home);
            setAwayRoster(away);
          }
        }
      } catch {
        // ignore refresh failures
      }

      setTeamEditor(null);
      setTeamEditorForm(null);
      setTeamEditorRoster([]);
      setTeamEditorInitialRosterIds([]);
      setTeamEditorLogoFile(null);
      setTeamEditorBannerFile(null);
      setTeamEditorLogoPreview('');
      setTeamEditorBannerPreview('');
    } catch (err: any) {
      console.error('Team editor save failed', err);
      setTeamEditorError(err?.message || 'Unable to save team changes.');
    } finally {
      setTeamEditorSaving(false);
    }
  };

  const closeTeamEditor = () => {
    if (teamEditorLogoPreview && teamEditorLogoPreview.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(teamEditorLogoPreview);
      } catch {}
    }
    if (teamEditorBannerPreview && teamEditorBannerPreview.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(teamEditorBannerPreview);
      } catch {}
    }
    setTeamEditor(null);
    setTeamEditorForm(null);
    setTeamEditorRoster([]);
    setTeamEditorInitialRosterIds([]);
    setTeamEditorDivisionOptions([]);
    setTeamEditorLogoFile(null);
    setTeamEditorBannerFile(null);
    setTeamEditorLogoPreview('');
    setTeamEditorBannerPreview('');
    setTeamEditorNewPlayer({ name: '', email: '', number: '' });
    setTeamEditorShowNewPlayer(false);
    setTeamEditorRosterWarning(null);
    setTeamEditorError(null);
    setTeamEditorLoading(false);
    setTeamEditorSaving(false);
  };

  const attemptRemoveTeamEditorPlayer = (player: { id: string; name: string; isCaptain: boolean }) => {
    if (teamEditorRoster.length <= 1) {
      setTeamEditorRosterWarning({
        title: 'Last Player Cannot Be Removed',
        description: 'A team cannot be left with zero players.',
        body: 'This is the last player on the roster. Add another player first before removing this one.',
      });
      return;
    }
    if (player.isCaptain) {
      const playerName = String(player.name || '').trim() || 'this player';
      setTeamEditorRosterWarning({
        title: 'Captain Cannot Be Removed',
        description: 'Team captain records cannot be removed from this screen without reassigning captain first.',
        body: `${playerName} is currently the team captain. Assign the captain crown to another player first, then remove this player if needed.`,
      });
      return;
    }
    setTeamEditorRoster((prev) => prev.filter((row) => row.id !== player.id));
  };

  const toggleTeamEditorCaptain = (playerId: string) => {
    const target = teamEditorRoster.find((row) => row.id === playerId);
    if (!target) return;

    if (target.isCaptain) {
      const captainCount = teamEditorRoster.filter((row) => row.isCaptain).length;
      if (captainCount <= 1) {
        const playerName = String(target.name || '').trim() || 'this player';
        setTeamEditorRosterWarning({
          title: 'Captain Required',
          description: 'Every team must keep at least one captain.',
          body: `${playerName} is the only captain on this roster. Assign the captain crown to another player first before removing it here.`,
        });
        return;
      }
      setTeamEditorRoster((prev) =>
        prev.map((row) => (row.id === playerId ? { ...row, isCaptain: false } : row))
      );
      return;
    }

    setTeamEditorRoster((prev) =>
      prev.map((row) => ({ ...row, isCaptain: row.id === playerId }))
    );
  };

  const addTeamEditorPlayer = () => {
    const cleanedName = teamEditorNewPlayer.name.trim();
    const cleanedNumber = teamEditorNewPlayer.number.trim();
    const cleanedEmail = teamEditorNewPlayer.email.trim();

    if (!cleanedName || !cleanedNumber) {
      setTeamEditorError('Player name and jersey # are required.');
      return;
    }
    if (cleanedEmail && !isValidEmail(cleanedEmail)) {
      setTeamEditorError('Enter a valid player email.');
      return;
    }

    setTeamEditorError(null);
    setTeamEditorRoster((prev) => {
      const next = [
        ...prev,
        {
          id: `p_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
          name: cleanedName,
          number: cleanedNumber,
          isCaptain: false,
        },
      ];
      return next.sort((a, b) => {
        const an = Number(normalizeJerseyNumberInput(String(a.number || '')) ?? 9999);
        const bn = Number(normalizeJerseyNumberInput(String(b.number || '')) ?? 9999);
        return an - bn;
      });
    });
    setTeamEditorNewPlayer({ name: '', email: '', number: '' });
  };

  const openPlayerQuickEditor = async (player: RosterPlayer) => {
    setEditingPlayerQuickError(null);
    try {
      const { data, error } = await supabase
        .from('players')
        .select('jersey_number,jersey_name,first_name,last_name')
        .eq('id', player.id)
        .maybeSingle();
      if (error) throw error;
      const jerseyNumber = data?.jersey_number != null ? String(data.jersey_number) : String(player.number || '');
      const jerseyName = (data?.jersey_name || '').toString();
      const displayName =
        [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim() ||
        player.name ||
        'Player';
      setEditingPlayerQuick({
        playerId: player.id,
        displayName,
        jerseyNumber,
        jerseyName,
      });
    } catch (err: any) {
      console.warn('Player quick edit preload failed', err);
      setEditingPlayerQuick({
        playerId: player.id,
        displayName: player.name || 'Player',
        jerseyNumber: String(player.number || ''),
        jerseyName: '',
      });
    }
  };

  const savePlayerQuickEditor = async () => {
    if (!editingPlayerQuick) return;
    if (editingPlayerQuickSaving) return;
    const normalizedJersey = normalizeJerseyNumberInput(editingPlayerQuick.jerseyNumber);
    if (!normalizedJersey) {
      setEditingPlayerQuickError('Jersey number is required.');
      return;
    }
    const jerseyName = (editingPlayerQuick.jerseyName || '').trim();
    setEditingPlayerQuickSaving(true);
    setEditingPlayerQuickError(null);
    try {
      const { error } = await supabase
        .from('players')
        .update({
          jersey_number: normalizedJersey ?? null,
          jersey_name: jerseyName || null,
        })
        .eq('id', editingPlayerQuick.playerId);
      if (error) throw error;

      const applyUpdate = (prev: RosterPlayer[]) =>
        sortRosterByJersey(
          prev.map((p) =>
            p.id === editingPlayerQuick.playerId
              ? { ...p, number: normalizedJersey ?? '' }
              : p
          )
        );
      setHomeRoster(applyUpdate);
      setAwayRoster(applyUpdate);
      setEditingPlayerQuick(null);
    } catch (err: any) {
      console.error('Player quick edit save failed', err);
      setEditingPlayerQuickError(err?.message || 'Unable to update player.');
    } finally {
      setEditingPlayerQuickSaving(false);
    }
  };

  const toNonNegative = (raw: string) => {
    const cleaned = raw.replace(/[^0-9]/g, '');
    const val = parseInt(cleaned, 10);
    return Number.isNaN(val) ? 0 : val;
  };

  useEffect(() => {
    shouldAutoSyncScoreRef.current = false;
    setHomeScore(game.homeScore ?? 0);
    setAwayScore(game.awayScore ?? 0);
  }, [game.awayScore, game.homeScore, game.id]);

  useEffect(() => {
    if (gameStatus !== 'FORFEITED') return;
    const validWinner =
      forfeitWinnerTeamId === selectedHomeTeamId || forfeitWinnerTeamId === selectedAwayTeamId;
    if (validWinner) return;
    setForfeitWinnerTeamId(selectedHomeTeamId || selectedAwayTeamId || '');
  }, [gameStatus, forfeitWinnerTeamId, selectedHomeTeamId, selectedAwayTeamId]);

  useEffect(() => {
    const loadRosters = async () => {
      const teamIds = [selectedHomeTeamId, selectedAwayTeamId].filter(Boolean);
      if (!teamIds.length) {
        setHomeRoster([]);
        setAwayRoster([]);
        setGuestPlayerIds(new Set());
        setActivePlayerIds(new Set());
        setRosterLoading(false);
        return;
      }
      try {
        setRosterLoading(true);
        const { data, error } = await supabase
          .from('players')
          .select('*')
          .in('team_id', teamIds);
        if (error) throw error;
        const mapped: RosterPlayer[] =
          data
            ?.filter((p: any) => !p.is_guest)
            .map((p: any) => ({
              id: p.id,
              teamId: p.team_id,
              name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Player',
              number: p.jersey_number != null ? String(p.jersey_number) : '',
              isCaptain: !!p.is_captain,
            })) || [];
        const home = sortRosterByJersey(mapped.filter((p) => p.teamId === selectedHomeTeamId));
        const away = sortRosterByJersey(mapped.filter((p) => p.teamId === selectedAwayTeamId));
        const guestEntries = await loadGuestsForGame();
        const homeGuestPlayers = guestEntries
          .filter((entry) => entry.team_id === selectedHomeTeamId)
          .map((entry) => buildGuestRosterPlayer(entry, selectedHomeTeamId));
        const awayGuestPlayers = guestEntries
          .filter((entry) => entry.team_id === selectedAwayTeamId)
          .map((entry) => buildGuestRosterPlayer(entry, selectedAwayTeamId));
        setHomeRoster(sortRosterByJersey([...home, ...homeGuestPlayers]));
        setAwayRoster(sortRosterByJersey([...away, ...awayGuestPlayers]));
        setGuestPlayerIds(new Set(guestEntries.map((entry) => entry.id)));
        setRosterError(null);
        setActivePlayerIds(new Set());
      } catch (err) {
        console.error('Roster load error', err);
        setRosterError('Using mock rosters (Supabase error).');
        const mockHome = MOCK_ROSTERS.filter((p) => p.teamId === selectedHomeTeamId);
        const mockAway = MOCK_ROSTERS.filter((p) => p.teamId === selectedAwayTeamId);
        setHomeRoster(mockHome);
        setAwayRoster(mockAway);
        setActivePlayerIds(new Set());
        setGuestPlayerIds(new Set());
      } finally {
        setRosterLoading(false);
      }
    };

    loadRosters();
  }, [selectedHomeTeamId, selectedAwayTeamId, game.id, loadGuestsForGame]);

  useEffect(() => {
    const loadStats = async () => {
      try {
        shouldAutoSyncScoreRef.current = false;
        const { data, error } = await supabase
          .from('game_stats')
          .select('*')
          .eq('game_id', game.id)
          .order('created_at', { ascending: true });
        if (error) throw error;
        const mapped: PlayerGameStats[] =
          data?.map((row: any) => ({
            id: row.id?.toString() || `stat_${row.player_id}`,
            gameId: row.game_id,
            playerId: row.player_id,
            teamId: row.team_id,
            playerName:
              [...homeRoster, ...awayRoster].find((p) => p.id === row.player_id)?.name || 'Player',
            pts: row.points ?? 0,
            reb: row.rebounds ?? 0,
            oreb:
              row.offensive_rebounds ??
              row.oreb ??
              row.off_rebounds ??
              null,
            dreb:
              row.defensive_rebounds ??
              row.dreb ??
              row.def_rebounds ??
              null,
            ast: row.assists ?? 0,
            stl: row.steals ?? 0,
            blk: row.blocks ?? 0,
            fouls: row.fouls ?? 0,
            turnovers: row.turnovers ?? 0,
            minutes: row.minutes ?? 0,
            fgm: row.fgm ?? 0,
            fga: row.fga ?? 0,
            tpm: row.tpm ?? 0,
            tpa: row.tpa ?? 0,
            ftm: row.ftm ?? 0,
            fta: row.fta ?? 0,
            plusMinus: row.plus_minus ?? 0,
            fgPct: row.fg_pct ?? null,
            threePct: row.three_pct ?? null,
            ftPct: row.ft_pct ?? null,
            twoPm: Math.max(0, (row.fgm ?? 0) - (row.tpm ?? 0)),
            twoPa: Math.max(0, (row.fga ?? 0) - (row.tpa ?? 0)),
            manualPts: true, // preserve stored points unless user edits raw stats
          })) || [];
        const filteredMapped = mapped.filter(
          (row) => row.teamId === selectedHomeTeamId || row.teamId === selectedAwayTeamId
        );
        if (filteredMapped.length > 0) {
          setPlayerStats(filteredMapped.map((m) => computeDerived(m)));
          setActivePlayerIds(new Set(filteredMapped.map((s) => s.playerId)));
          const orderMap = filteredMapped.reduce<Record<string, number>>((acc, s, idx) => {
            acc[s.playerId] = idx;
            return acc;
          }, {});
          setHomeRoster((prev) =>
            [...prev].sort((a, b) => (orderMap[a.id] ?? Infinity) - (orderMap[b.id] ?? Infinity))
          );
          setAwayRoster((prev) =>
            [...prev].sort((a, b) => (orderMap[a.id] ?? Infinity) - (orderMap[b.id] ?? Infinity))
          );
        } else {
          setPlayerStats([]);
          setActivePlayerIds(new Set());
        }
      } catch (err) {
        console.error('Load stats error', err);
      }
    };

    // Load stats after roster is available (so names can match)
    if (!rosterLoading) {
      loadStats();
    }
  }, [game.id, rosterLoading, selectedHomeTeamId, selectedAwayTeamId]);

  const addGuestPlayer = async () => {
    const cleanedName = guestForm.name.trim();
    const cleanedNumber = guestForm.number.trim();
    const rawEmail = guestForm.email.trim();
    const normalizedEmail = rawEmail ? normalizeEmail(rawEmail) : null;
    if (normalizedEmail && !isValidEmail(normalizedEmail)) {
      setGuestError('Enter a valid guest email.');
      return;
    }
    const jerseyNumberNormalized = cleanedNumber
      ? normalizeJerseyNumberInput(cleanedNumber)
      : null;
    if (cleanedNumber && !jerseyNumberNormalized) {
      setGuestError('Enter a valid jersey number for the guest.');
      return;
    }
    const teamId = guestForm.team === 'home' ? selectedHomeTeamId : selectedAwayTeamId;
    if (!teamId) {
      setGuestError('Unable to assign guest to a team.');
      return;
    }
    if (!game.id) {
      setGuestError('Unable to map guest to this game.');
      return;
    }
    const guestName =
      cleanedName || `Guest ${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 5)}`;
    const finalGuestEmail =
      normalizedEmail || `guest-${game.id || 'unknown'}-${Date.now()}@guest.courtsight`;
    setGuestAdding(true);
    try {

      const { data: inserted, error } = await supabase
        .from('game_guest_players')
        .insert({
          game_id: game.id,
          team_id: teamId,
          name: guestName,
          email: finalGuestEmail,
          jersey_number: jerseyNumberNormalized ?? null,
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      const guestRow: GameGuestRecord =
        (inserted as GameGuestRecord) || {
          id: `guest-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
          game_id: game.id,
          team_id: teamId,
          name: guestName,
          email: finalGuestEmail,
          jersey_number: jerseyNumberNormalized ?? null,
        };
      const rosterPlayer = buildGuestRosterPlayer(guestRow, teamId);
      if (teamId === selectedHomeTeamId) {
        setHomeRoster((prev) => sortRosterByJersey([...prev, rosterPlayer]));
      } else {
        setAwayRoster((prev) => sortRosterByJersey([...prev, rosterPlayer]));
      }
      setGuestPlayerIds((prev) => {
        const next = new Set(prev);
        next.add(rosterPlayer.id);
        return next;
      });
      setGuestForm((prev) => ({ ...prev, name: '', email: '', number: '' }));
      setGuestError(null);
    } catch (err) {
      console.error('Guest player add failed', err);
      setGuestError((err as any)?.message || 'Failed to add guest player. Please try again.');
    } finally {
      setGuestAdding(false);
    }
  };

  const removeGuestPlayer = async (guestId: string): Promise<boolean> => {
    if (!guestId || !game.id) return false;
    setGuestRemovingIds((prev) => {
      const next = new Set(prev);
      next.add(guestId);
      return next;
    });
    try {
      const { error: guestDeleteErr } = await supabase
        .from('game_guest_players')
        .delete()
        .eq('id', guestId)
        .eq('game_id', game.id);
      if (guestDeleteErr) throw guestDeleteErr;

      const { error: statsDeleteErr } = await supabase
        .from('game_stats')
        .delete()
        .eq('game_id', game.id)
        .eq('player_id', guestId);
      if (statsDeleteErr) throw statsDeleteErr;
      const { error: shadowDeleteErr } = await supabase
        .from('players')
        .delete()
        .eq('id', guestId)
        .eq('is_guest', true);
      if (shadowDeleteErr) {
        const msg = String(shadowDeleteErr.message || '').toLowerCase();
        const code = String(shadowDeleteErr.code || '').toUpperCase();
        const missingColumn = code === '42703' || (msg.includes('is_guest') && msg.includes('column'));
        if (!missingColumn) throw shadowDeleteErr;
      }

      setHomeRoster((prev) => prev.filter((player) => player.id !== guestId));
      setAwayRoster((prev) => prev.filter((player) => player.id !== guestId));
      setGuestPlayerIds((prev) => {
        const next = new Set(prev);
        next.delete(guestId);
        return next;
      });
      setActivePlayerIds((prev) => {
        const next = new Set(prev);
        next.delete(guestId);
        return next;
      });
      setUnlockedPlayerIds((prev) => {
        const next = new Set(prev);
        next.delete(guestId);
        return next;
      });
      shouldAutoSyncScoreRef.current = true;
      setPlayerStats((prev) => prev.filter((stat) => stat.playerId !== guestId));
      setGuestError(null);
      return true;
    } catch (err) {
      console.error('Guest player remove failed', err);
      setGuestError((err as any)?.message || 'Failed to remove guest player. Please try again.');
      return false;
    } finally {
      setGuestRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(guestId);
        return next;
      });
    }
  };

  const togglePlayerActive = (playerId: string) => {
    shouldAutoSyncScoreRef.current = true;
    setActivePlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
  };

  const ensureGuestPlayersExistForStats = async (guests: RosterPlayer[]) => {
    if (!guests.length) return;
    const guestIds = Array.from(new Set(guests.map((guest) => String(guest.id || '')).filter(Boolean)));
    if (!guestIds.length) return;

    const loadExisting = async (client: typeof supabase) => {
      const { data, error } = await client.from('players').select('id').in('id', guestIds);
      if (error) throw error;
      return new Set((data || []).map((row: any) => String(row.id || '')).filter(Boolean));
    };

    let existingIds = new Set<string>();
    try {
      existingIds = await loadExisting(supabase);
    } catch (err) {
      if (!supabaseAdmin) throw err;
      existingIds = await loadExisting(supabaseAdmin as any);
    }

    const missingGuests = guests.filter((guest) => !existingIds.has(String(guest.id || '')));
    if (!missingGuests.length) return;

    const seasonId = game.seasonId || null;
    const toNameParts = (name: string) => {
      const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      const first = parts.shift() || 'Guest';
      const last = parts.join(' ');
      return { first, last };
    };

    const basePayloads = missingGuests.map((guest) => {
      const guestId = String(guest.id || '');
      const teamId = String(guest.teamId || '');
      const { first, last } = toNameParts(guest.name || 'Guest Player');
      const normalizedNumber = normalizeJerseyNumberInput(String(guest.number || ''));
      return {
        id: guestId,
        team_id: teamId || null,
        season_id: seasonId,
        first_name: first,
        last_name: last || '',
        jersey_number: normalizedNumber ?? null,
        is_guest: true,
        is_captain: false,
      };
    });

    const upsertWithFallback = async (client: any) => {
      let allowedColumns = [
        'id',
        'team_id',
        'season_id',
        'first_name',
        'last_name',
        'jersey_number',
        'is_guest',
        'is_captain',
      ];

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const payload = basePayloads.map((row) => {
          const shaped: Record<string, any> = {};
          allowedColumns.forEach((column) => {
            if (Object.prototype.hasOwnProperty.call(row, column)) {
              shaped[column] = (row as any)[column];
            }
          });
          return shaped;
        });

        const { error } = await client.from('players').upsert(payload, { onConflict: 'id' });
        if (!error) return;

        const msg = String(error?.message || '').toLowerCase();
        const code = String(error?.code || '').toUpperCase();
        const missingMatch = msg.match(
          /column\s+\"?([a-z0-9_]+)\"?\s+of relation\s+\"?players\"?\s+does not exist/
        );
        const missingColumn = missingMatch?.[1];
        const isMissingColumnError = code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
        if (isMissingColumnError && missingColumn && allowedColumns.includes(missingColumn)) {
          allowedColumns = allowedColumns.filter((column) => column !== missingColumn);
          continue;
        }
        throw error;
      }
    };

    try {
      await upsertWithFallback(supabase);
    } catch (err) {
      if (!supabaseAdmin) throw err;
      await upsertWithFallback(supabaseAdmin as any);
    }
  };

  // Helper to update a specific stat
  const updateStat = (playerId: string, field: keyof PlayerGameStats, value: number) => {
     shouldAutoSyncScoreRef.current = true;
     const existing = playerStats.find(s => s.playerId === playerId);
     const rawFields = new Set<keyof PlayerGameStats>([
       'twoPm',
       'twoPa',
       'tpm',
       'tpa',
       'ftm',
       'fta',
       'oreb',
       'dreb',
       'ast',
       'blk',
       'stl',
       'fouls',
       'turnovers',
     ]);

     if (existing) {
        setPlayerStats(playerStats.map(s => {
          if (s.playerId !== playerId) return s;
          const base = { ...s, [field]: value } as PlayerGameStats;
          if (field === 'pts') {
            base.manualPts = true;
          } else if (rawFields.has(field)) {
            base.manualPts = false;
          }
          const updated = computeDerived(base);
          return updated;
        }));
     } else {
        // Create new entry
        const player = [...homeRoster, ...awayRoster].find(p => p.id === playerId);
        if (!player) return;
        const newStat: PlayerGameStats = {
            id: `stat_${Date.now()}_${playerId}`,
            gameId: game.id,
            playerId,
            teamId: player.teamId,
            playerName: player.name,
            pts: 0,
            reb: 0,
            oreb: 0,
            dreb: 0,
            ast: 0,
            stl: 0,
            blk: 0,
            fouls: 0,
            turnovers: 0,
            minutes: 0,
            fgm: 0,
            fga: 0,
            tpm: 0,
            tpa: 0,
            ftm: 0,
            fta: 0,
            plusMinus: 0,
            twoPm: 0,
            twoPa: 0,
            fgPct: 0,
            threePct: 0,
            ftPct: 0,
            [field]: value
        };
        if (field === 'pts') newStat.manualPts = true;
        setPlayerStats([...playerStats, computeDerived(newStat)]);
     }
  };

  const getStat = (playerId: string, field: keyof PlayerGameStats) => {
    const stat = playerStats.find((s) => s.playerId === playerId);
    const val = stat ? (stat as any)[field] : 0;
    return typeof val === 'number' ? val : 0;
  };

  const computeDerived = (stat: PlayerGameStats): PlayerGameStats => {
    const twoPm = stat.twoPm ?? Math.max(0, (stat.fgm ?? 0) - (stat.tpm ?? 0));
    const twoPa = stat.twoPa ?? Math.max(0, (stat.fga ?? 0) - (stat.tpa ?? 0));
    const tpm = stat.tpm ?? 0;
    const tpa = stat.tpa ?? 0;
    const ftm = stat.ftm ?? 0;
    const fta = stat.fta ?? 0;
    const fgm = twoPm + tpm;
    const fga = twoPa + tpa;
    const reb = stat.reb ?? 0;
    const oreb = stat.oreb ?? 0;
    const dreb = stat.dreb ?? 0;
    const fgPct = fga > 0 ? +(fgm / fga * 100).toFixed(1) : 0;
    const threePct = tpa > 0 ? +(tpm / tpa * 100).toFixed(1) : 0;
    const ftPct = fta > 0 ? +(ftm / fta * 100).toFixed(1) : 0;
    const ptsCalculated = twoPm * 2 + tpm * 3 + ftm;
    const ptsFinal = stat.manualPts ? (stat.pts ?? ptsCalculated) : ptsCalculated;

    return {
      ...stat,
      twoPm,
      twoPa,
      tpm,
      tpa,
      ftm,
      fta,
      oreb,
      dreb,
      rebounds: reb,
      fgm,
      fga,
      pts: ptsFinal,
      reb,
      fgPct,
      threePct,
      ftPct,
    };
  };

  useEffect(() => {
    if (!scoreLocked || !shouldAutoSyncScoreRef.current) return;
    const totals = playerStats.reduce(
      (acc, stat) => {
        if (!activePlayerIds.has(stat.playerId) || !stat.teamId) return acc;
        const pts = stat.pts ?? 0;
        if (stat.teamId === selectedHomeTeamId) {
          acc.home += pts;
        } else if (stat.teamId === selectedAwayTeamId) {
          acc.away += pts;
        }
        return acc;
      },
      { home: 0, away: 0 }
    );
    setHomeScore(totals.home);
    setAwayScore(totals.away);
  }, [activePlayerIds, playerStats, scoreLocked, selectedHomeTeamId, selectedAwayTeamId]);

  const reorderList = <T,>(list: T[], from: number, to: number) => {
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };

  const handleReorder = (team: 'home' | 'away', from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    if (team === 'home') {
      setHomeRoster((prev) => reorderList(prev, from, to));
    } else {
      setAwayRoster((prev) => reorderList(prev, from, to));
    }
  };

  const handleSave = async () => {
      try {
        const normalizedDate = (gameDate || '').trim();
        const normalizedTime = (gameTime || '').trim();
        if (!selectedHomeTeamId || !selectedAwayTeamId) {
          setSaveMessage('Select both home and away teams.');
          return;
        }
        if (selectedHomeTeamId === selectedAwayTeamId) {
          setSaveMessage('Home and away teams must be different.');
          return;
        }
        if (!normalizedDate) {
          setSaveMessage('Game date is required.');
          return;
        }
        if (
          gameStatus === 'FORFEITED' &&
          (!forfeitWinnerTeamId ||
            (forfeitWinnerTeamId !== selectedHomeTeamId &&
              forfeitWinnerTeamId !== selectedAwayTeamId))
        ) {
          setSaveMessage('Select the winner for a forfeited game.');
          return;
        }
        const gameDateTime = buildScheduleDateTimeIso(normalizedDate, normalizedTime || '00:00');
        if (!gameDateTime) {
          setSaveMessage('Invalid game time.');
          return;
        }
        let persistedHomeScore = homeScore;
        let persistedAwayScore = awayScore;
        if (gameStatus === 'FORFEITED') {
          if (forfeitWinnerTeamId === selectedHomeTeamId && persistedHomeScore <= persistedAwayScore) {
            persistedHomeScore = Math.max((persistedAwayScore || 0) + 1, 1);
          } else if (
            forfeitWinnerTeamId === selectedAwayTeamId &&
            persistedAwayScore <= persistedHomeScore
          ) {
            persistedAwayScore = Math.max((persistedHomeScore || 0) + 1, 1);
          }
        }
        setSaving(true);
        setSaveMessage(null);
        await supabase
          .from('games')
          .update({
            home_team_id: selectedHomeTeamId,
            away_team_id: selectedAwayTeamId,
            game_datetime: gameDateTime,
            home_score: persistedHomeScore,
            away_score: persistedAwayScore,
            status: (gameStatus || 'SCHEDULED').toLowerCase(),
            youtube_url: youtubeLink || null,
          })
          .eq('id', game.id);

        // Persist box score
        const buildPayload = (includeSplit: boolean) =>
          [...homeRoster, ...awayRoster]
            .filter((p) => activePlayerIds.has(p.id))
            .map((p) => {
              const stat = playerStats.find((s) => s.playerId === p.id);
              const derived = computeDerived(
                stat || {
                  id: '',
                  gameId: game.id,
                  playerId: p.id,
                  teamId: p.teamId,
                  playerName: '',
                  pts: 0,
                  reb: 0,
                  ast: 0,
                  stl: 0,
                  blk: 0,
                  fouls: 0,
                  turnovers: 0,
                  minutes: 0,
                  fgm: 0,
                  fga: 0,
                  tpm: 0,
                  tpa: 0,
                  ftm: 0,
                  fta: 0,
                }
              );
              const base: any = {
                game_id: game.id,
                player_id: p.id,
                team_id: p.teamId,
                starter: false,
                points: derived.pts ?? 0,
                rebounds: derived.reb ?? 0,
                assists: derived.ast ?? 0,
                steals: derived.stl ?? 0,
                blocks: derived.blk ?? 0,
                turnovers: derived.turnovers ?? 0,
                fouls: derived.fouls ?? 0,
                fgm: derived.fgm ?? 0,
                fga: derived.fga ?? 0,
                tpm: derived.tpm ?? 0,
                tpa: derived.tpa ?? 0,
                ftm: derived.ftm ?? 0,
                fta: derived.fta ?? 0,
                plus_minus: derived.plusMinus ?? 0,
                minutes: derived.minutes ?? 0,
                fg_pct: derived.fgPct ?? null,
                three_pct: derived.threePct ?? null,
                ft_pct: derived.ftPct ?? null,
              };
              if (includeSplit) {
                base.offensive_rebounds = derived.oreb ?? 0;
                base.defensive_rebounds = derived.dreb ?? 0;
              }
              return base;
            });

        const activePlayers = [...homeRoster, ...awayRoster].filter((p) => activePlayerIds.has(p.id));
        const activeGuestPlayers = activePlayers.filter((p) => p.isGuest || guestPlayerIds.has(p.id));
        const previouslyTrackedIds = playerStats.map((s) => s.playerId);
        const playersToRemove = previouslyTrackedIds.filter((id) => !activePlayerIds.has(id));
        if (playersToRemove.length > 0) {
          const { error: deleteErr } = await supabase
            .from('game_stats')
            .delete()
            .eq('game_id', game.id)
            .in('player_id', playersToRemove);
          if (deleteErr) {
            throw deleteErr;
          }
        }

        if (activeGuestPlayers.length > 0) {
          await ensureGuestPlayersExistForStats(activeGuestPlayers);
        }

        if (activePlayers.length > 0) {
          let payload = buildPayload(supportsSplitRebounds.current);
          let error: any = null;
          try {
            const { error: upsertErr } = await supabase
              .from('game_stats')
              .upsert(payload, { onConflict: 'game_id,player_id' });
            error = upsertErr;
          } catch (err) {
            error = err as any;
          }
          if (error && supportsSplitRebounds.current) {
            // Retry without split rebounds (column may not exist)
            supportsSplitRebounds.current = false;
            payload = buildPayload(false);
            await supabase.from('game_stats').upsert(payload, { onConflict: 'game_id,player_id' });
          } else if (error) {
            throw error;
          }
        }

        setSaveMessage('Saved to Supabase.');
        if (onSaved) await onSaved();
        onClose();
      } catch (err) {
        console.error('Save game error', err);
        setSaveMessage('Failed to save game.');
      } finally {
        setSaving(false);
      }
  };

  const statColumns: { key: keyof PlayerGameStats; label: string; editable?: boolean }[] = [
    { key: 'twoPm', label: '2PM', editable: true },
    { key: 'twoPa', label: '2PA', editable: true },
    { key: 'tpm', label: '3PM', editable: true },
    { key: 'tpa', label: '3PA', editable: true },
    { key: 'ftm', label: 'FTM', editable: true },
    { key: 'fta', label: 'FTA', editable: true },
    { key: 'reb', label: 'REB', editable: true },
    { key: 'ast', label: 'AST', editable: true },
    { key: 'blk', label: 'BLK', editable: true },
    { key: 'stl', label: 'STL', editable: true },
    { key: 'fouls', label: 'PF', editable: true },
    { key: 'turnovers', label: 'TOV', editable: true },
    { key: 'pts', label: 'PTS', editable: true },
    { key: 'fgm', label: 'FGM' },
    { key: 'fga', label: 'FGA' },
    { key: 'fgPct', label: 'FG%' },
    { key: 'threePct', label: '3P%' },
    { key: 'ftPct', label: 'FT%' },
  ];

  const manualStatGroups: Array<(keyof PlayerGameStats)[]> = [
    ['twoPm', 'twoPa', 'tpm', 'tpa', 'ftm', 'fta'],
    ['reb', 'ast', 'blk', 'stl'],
    ['fouls', 'turnovers', 'fgm', 'fga'],
  ];
  const computedFields: (keyof PlayerGameStats)[] = ['fgPct', 'threePct', 'ftPct'];

  const statColumnMap = statColumns.reduce<Record<string, { label: string; editable?: boolean }>>(
    (acc, col) => {
      acc[col.key as string] = { label: col.label, editable: col.editable };
      return acc;
    },
    {}
  );

  const desktopStatColumns: { key: keyof PlayerGameStats; label: string; editable?: boolean; minWidth?: string }[] = [
    { key: 'pts', label: 'PTS', editable: true, minWidth: '110px' },
    { key: 'twoPm', label: '2PM', editable: true, minWidth: '70px' },
    { key: 'twoPa', label: '2PA', editable: true, minWidth: '70px' },
    { key: 'tpm', label: '3PM', editable: true, minWidth: '70px' },
    { key: 'tpa', label: '3PA', editable: true, minWidth: '70px' },
    { key: 'ftm', label: 'FTM', editable: true, minWidth: '70px' },
    { key: 'fta', label: 'FTA', editable: true, minWidth: '70px' },
    { key: 'reb', label: 'REB', editable: true, minWidth: '70px' },
    { key: 'ast', label: 'AST', editable: true, minWidth: '70px' },
    { key: 'blk', label: 'BLK', editable: true, minWidth: '60px' },
    { key: 'stl', label: 'STL', editable: true, minWidth: '60px' },
    { key: 'fouls', label: 'PF', editable: true, minWidth: '60px' },
    { key: 'turnovers', label: 'TOV', editable: true, minWidth: '60px' },
    { key: 'fgm', label: 'FGM', minWidth: '60px' },
    { key: 'fga', label: 'FGA', minWidth: '60px' },
    { key: 'fgPct', label: 'FG%', minWidth: '80px' },
    { key: 'threePct', label: '3P%', minWidth: '80px' },
    { key: 'ftPct', label: 'FT%', minWidth: '80px' },
  ];

  const renderScoreLockButton = (extraClasses = '') => (
    <button
      type="button"
      onClick={() => setScoreLocked((prev) => !prev)}
      className={`flex items-center gap-2 text-xs uppercase tracking-wider text-gray-300 px-3 py-2 rounded-full border border-white/10 hover:border-white hover:text-white transition-colors ${extraClasses}`}
      title={scoreLocked ? 'Unlock game score for editing' : 'Lock game score'}
    >
      {scoreLocked ? <Lock size={16} /> : <LockOpen size={16} />}
      <span>{scoreLocked ? 'Locked' : 'Unlocked'}</span>
    </button>
  );

  const renderStatGroup = (
    playerId: string,
    keys: (keyof PlayerGameStats)[],
    editable: boolean,
    columnClasses = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4'
  ) => (
    <div className={`${columnClasses} gap-1`}>
      {keys.map((key) => {
        const colMeta = statColumnMap[key as string];
        const isPtsField = key === 'pts';
        const isEditable = editable && colMeta?.editable && !isPtsField;
        return (
          <div key={`${playerId}-${key}`} className="flex flex-col gap-1 text-[11px]">
            <span className="text-gray-400 uppercase tracking-wider leading-snug">
              {colMeta?.label || String(key)}
            </span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              disabled={!isEditable}
              className={`w-full bg-white/5 rounded text-center text-white text-xs py-1 focus:bg-brand-lime focus:text-black focus:outline-none transition-colors ${
                !isEditable ? 'cursor-not-allowed opacity-70' : ''
              }`}
              value={getStat(playerId, key)}
              onChange={(e) =>
                updateStat(playerId, key, Math.max(0, parseInt(e.target.value, 10) || 0))
              }
              readOnly={!isEditable}
            />
          </div>
        );
      })}
    </div>
  );

  const renderPtsField = (playerId: string, editable: boolean) => {
    const isUnlocked = unlockedPlayerIds.has(playerId);
    const isEditable = editable && isUnlocked;
    return (
      <div className="w-full">
        <div className="mb-1 text-[10px] text-gray-400 uppercase tracking-wider">PTS</div>
        <div className="relative">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            disabled={!isEditable}
            className={`w-full bg-white/5 rounded text-center text-white text-xs py-1.5 pr-10 dropdown-select-spacing focus:bg-brand-lime focus:text-black focus:outline-none transition-colors ${
              !isEditable ? 'cursor-not-allowed opacity-70' : ''
            }`}
            value={getStat(playerId, 'pts')}
            onChange={(e) =>
              updateStat(playerId, 'pts', Math.max(0, parseInt(e.target.value, 10) || 0))
            }
            readOnly={!isEditable}
          />
          <button
            type="button"
            onClick={() =>
              setUnlockedPlayerIds((prev) => {
                const next = new Set(prev);
                if (next.has(playerId)) {
                  next.delete(playerId);
                } else {
                  next.add(playerId);
                }
                return next;
              })
            }
            className="absolute right-1 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-black/70 border border-white/20 text-[10px] text-gray-300 hover:text-white"
            title={isUnlocked ? 'Lock PTS' : 'Unlock PTS'}
          >
            {isUnlocked ? <LockOpen size={12} /> : <Lock size={12} />}
          </button>
        </div>
      </div>
    );
  };

  const renderDesktopCell = (playerId: string, key: keyof PlayerGameStats, editable: boolean) => {
    const colMeta = statColumnMap[key as string];
    const isEditable = editable && !!colMeta?.editable;
    return (
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={!isEditable}
        className={`w-full bg-white/5 rounded text-center text-white text-xs py-1 focus:bg-brand-lime focus:text-black focus:outline-none transition-colors ${
          !isEditable ? 'cursor-not-allowed opacity-70' : ''
        }`}
        value={getStat(playerId, key)}
        onChange={(e) =>
          updateStat(playerId, key, Math.max(0, parseInt(e.target.value, 10) || 0))
        }
        readOnly={!isEditable}
      />
    );
  };

  const renderDesktopPtsInput = (playerId: string, editable: boolean) => {
    const isUnlocked = unlockedPlayerIds.has(playerId);
    const isEditable = editable && isUnlocked;
    return (
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          disabled={!isEditable}
          className={`w-full bg-white/5 rounded text-center text-white text-xs py-1.5 pr-10 dropdown-select-spacing focus:bg-brand-lime focus:text-black focus:outline-none transition-colors ${
            !isEditable ? 'cursor-not-allowed opacity-70' : ''
          }`}
          value={getStat(playerId, 'pts')}
          onChange={(e) =>
            updateStat(playerId, 'pts', Math.max(0, parseInt(e.target.value, 10) || 0))
          }
          readOnly={!isEditable}
        />
        <button
          type="button"
          onClick={() =>
            setUnlockedPlayerIds((prev) => {
              const next = new Set(prev);
              if (next.has(playerId)) {
                next.delete(playerId);
              } else {
                next.add(playerId);
              }
              return next;
            })
          }
          className="absolute right-1 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 border border-white/20 text-[10px] text-gray-300 hover:text-white"
          title={isUnlocked ? 'Lock PTS' : 'Unlock PTS'}
        >
          {isUnlocked ? <LockOpen size={10} /> : <Lock size={10} />}
        </button>
      </div>
    );
  };

  const guestBadgeClass =
    'inline-flex flex-shrink-0 h-5 w-5 min-w-[20px] items-center justify-center rounded-full border border-white/30 bg-black/50 text-[11px] font-semibold leading-none text-white/80';
  const GuestBadge: React.FC<{ className?: string }> = ({ className }) => (
    <span className={`${guestBadgeClass} ${className ?? ''}`} title="Guest player">
      G
    </span>
  );

  const renderDesktopTable = (roster: typeof homeRoster, teamName: string, teamKey: 'home' | 'away') => (
    <div className="hidden md:block bg-black/40 rounded-xl border border-white/10 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex items-center justify-between">
        <h4 className="text-brand-lime font-bold uppercase text-xs tracking-wider m-0">
          {teamName.toUpperCase()} Box Score
        </h4>
      </div>
      <div className="overflow-x-auto">
                <table className="min-w-[960px] border-separate border-spacing-0 w-full text-[11px] text-white">
                  <thead>
                    <tr className="text-brand-grey uppercase text-[11px] tracking-wider border-b border-white/10">
                      <th className="px-3 py-2 text-left">Act</th>
                      <th className="px-3 py-2 text-left">Player</th>
                      {desktopStatColumns.map((col) => (
                        <th
                          key={col.key}
                          className="px-2 py-2 text-center"
                          style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                        >
                          {col.label}
                        </th>
                      ))}
            </tr>
          </thead>
          <tbody>
            {roster.map((p, idx) => {
              const isActive = activePlayerIds.has(p.id);
              const isGuestEntry = p.isGuest || guestPlayerIds.has(p.id);
              return (
                <tr
                  key={`${teamKey}-${p.id}`}
                  draggable
                  onDragStart={() => setDragging({ team: teamKey, index: idx })}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragging && dragging.team === teamKey && dragging.index !== idx) {
                      handleReorder(teamKey, dragging.index, idx);
                      setDragging({ team: teamKey, index: idx });
                    }
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={`border-b border-white/10 ${!isActive ? 'opacity-60' : ''}`}
                >
                  <td className="px-3 py-2 text-left whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => togglePlayerActive(p.id)}
                      className={`flex items-center gap-2 ${isActive ? 'text-brand-lime' : 'text-gray-600'}`}
                    >
                      {isActive ? <CheckSquare size={16} /> : <Square size={16} />}
                      <span className="text-white text-xs font-semibold">#{p.number || ''}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-left font-semibold text-white flex items-center gap-2">
                    {!isGuestEntry ? (
                      <button
                        type="button"
                        onClick={() => void openPlayerQuickEditor(p)}
                        className="hover:text-brand-lime transition-colors"
                      >
                        {p.name}
                      </button>
                    ) : (
                      <span>{p.name}</span>
                    )}
                    {isGuestEntry && <GuestBadge />}
                    {isGuestEntry && (
                      <button
                        type="button"
                        onClick={() =>
                          setPendingGuestDelete({
                            id: p.id,
                            name: p.name || 'Guest Player',
                            team: teamKey,
                          })
                        }
                        disabled={guestRemovingIds.has(p.id)}
                        className="inline-flex items-center justify-center rounded border border-brand-red/40 bg-brand-red/10 p-1 text-brand-red hover:bg-brand-red/20 disabled:opacity-50"
                        title="Remove guest"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                  {desktopStatColumns.map((col) => (
                    <td
                      key={`${p.id}-${String(col.key)}`}
                      className="px-2 py-2 text-center"
                      style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                    >
                      {col.key === 'pts'
                        ? renderDesktopPtsInput(p.id, isActive)
                        : renderDesktopCell(p.id, col.key, isActive)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderPlayerTable = (roster: typeof homeRoster, teamName: string, teamKey: 'home' | 'away') => {
    return (
      <div className="bg-black/30 rounded-lg border border-white/5 p-3 mb-4 space-y-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-brand-lime font-bold uppercase text-sm m-0">{teamName} Box Score</h4>
        </div>
        <div className="space-y-2">
          {roster.map((p, idx) => {
            const isActive = activePlayerIds.has(p.id);
            const isGuestEntry = p.isGuest || guestPlayerIds.has(p.id);
            return (
              <div
                key={p.id}
                draggable
                onDragStart={() => setDragging({ team: teamKey, index: idx })}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragging && dragging.team === teamKey && dragging.index !== idx) {
                    handleReorder(teamKey, dragging.index, idx);
                    setDragging({ team: teamKey, index: idx });
                  }
                }}
                onDragEnd={() => setDragging(null)}
                  className={`flex flex-wrap gap-3 border-b border-white/10 pb-3 ${
                  !isActive ? 'opacity-40' : ''
                }`}
              >
                  <div className="flex-shrink-0 w-56 flex items-center gap-3 sticky left-0">
                  <button
                    onClick={() => togglePlayerActive(p.id)}
                    className={`hover:text-white ${isActive ? 'text-brand-lime' : 'text-gray-600'}`}
                  >
                    {isActive ? <CheckSquare size={20} /> : <Square size={20} />}
                  </button>
                  <div>
                    <div className="text-[11px] text-gray-400 uppercase tracking-wide">#{p.number}</div>
                  <div className="flex items-center gap-2">
                    {!isGuestEntry ? (
                      <button
                        type="button"
                        onClick={() => void openPlayerQuickEditor(p)}
                        className="text-sm font-semibold text-white leading-tight hover:text-brand-lime transition-colors"
                      >
                        {p.name}
                      </button>
                    ) : (
                      <div className="text-sm font-semibold text-white leading-tight">{p.name}</div>
                    )}
                    {isGuestEntry && <GuestBadge />}
                    {isGuestEntry && (
                      <button
                        type="button"
                        onClick={() =>
                          setPendingGuestDelete({
                            id: p.id,
                            name: p.name || 'Guest Player',
                            team: teamKey,
                          })
                        }
                        disabled={guestRemovingIds.has(p.id)}
                        className="inline-flex items-center justify-center rounded border border-brand-red/40 bg-brand-red/10 p-1 text-brand-red hover:bg-brand-red/20 disabled:opacity-50"
                        title="Remove guest"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  </div>
                </div>
                <div className="flex-1 flex flex-col gap-3 md:flex-row">
                  <div className="flex-shrink-0 w-full md:w-32">
                    {renderPtsField(p.id, isActive)}
                  </div>
                  <div className="flex-1">
                  <div className="md:overflow-x-auto -mx-0.5">
                    <div className="min-w-[260px] md:min-w-[520px] space-y-1 px-0.5">
                        {manualStatGroups.map((group, groupIdx) => (
                          <div key={`${p.id}-group-${groupIdx}`} className="space-y-1">
                            {renderStatGroup(p.id, group, isActive)}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex-shrink-0 min-w-[160px] border-l border-white/10 pl-3">
                    <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Computed</div>
                    {renderStatGroup(p.id, computedFields, isActive, 'grid grid-cols-2 gap-1')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const boxScoreEditorContent = (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col overflow-y-auto">
      {editingPlayerQuick && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-lg bg-brand-dark border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div>
                <div className="text-[11px] uppercase tracking-[0.3em] text-gray-400">Quick Edit</div>
                <div className="text-white font-sports text-xl uppercase">
                  {editingPlayerQuick.displayName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingPlayerQuick(null)}
                disabled={editingPlayerQuickSaving}
                className="text-gray-400 hover:text-white text-sm disabled:opacity-60"
              >
                Close
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-gray-400 mb-2">
                    Jersey Number
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editingPlayerQuick.jerseyNumber}
                    onChange={(e) =>
                      setEditingPlayerQuick((prev) =>
                        prev ? { ...prev, jerseyNumber: e.target.value } : prev
                      )
                    }
                    className="w-full bg-black border border-white/15 rounded-xl px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                    placeholder="e.g. 23"
                    disabled={editingPlayerQuickSaving}
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-gray-400 mb-2">
                    Jersey Name
                  </label>
                  <input
                    type="text"
                    value={editingPlayerQuick.jerseyName}
                    onChange={(e) =>
                      setEditingPlayerQuick((prev) =>
                        prev ? { ...prev, jerseyName: e.target.value } : prev
                      )
                    }
                    className="w-full bg-black border border-white/15 rounded-xl px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                    placeholder="e.g. SMITH"
                    disabled={editingPlayerQuickSaving}
                  />
                </div>
              </div>
              {editingPlayerQuickError && (
                <div className="text-xs text-brand-red">{editingPlayerQuickError}</div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingPlayerQuick(null)}
                disabled={editingPlayerQuickSaving}
                className="px-4 py-2 rounded-xl border border-white/20 text-gray-300 text-sm hover:border-white/40 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void savePlayerQuickEditor()}
                disabled={editingPlayerQuickSaving}
                className="px-4 py-2 rounded-xl bg-brand-lime text-black text-sm font-bold disabled:opacity-60"
              >
                {editingPlayerQuickSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingGuestDelete && (
        <div className="fixed inset-0 z-[61] bg-black/75 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-md bg-brand-dark border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <div className="text-white font-sports text-xl uppercase">Remove Guest Player</div>
              <p className="text-xs text-gray-400 mt-1">
                This will remove the guest from this game and delete their box score line.
              </p>
            </div>
            <div className="px-6 py-4 text-sm text-gray-300">
              Remove <span className="text-white font-semibold">{pendingGuestDelete.name}</span> from{' '}
              <span className="text-white font-semibold">
                {pendingGuestDelete.team === 'home'
                  ? getTeamDisplayName(homeTeam?.id, homeTeam?.name || 'Home Team')
                  : getTeamDisplayName(awayTeam?.id, awayTeam?.name || 'Away Team')}
              </span>
              ?
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingGuestDelete(null)}
                disabled={guestRemovingIds.has(pendingGuestDelete.id)}
                className="px-4 py-2 rounded-xl border border-white/20 text-gray-300 text-sm hover:border-white/40 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = await removeGuestPlayer(pendingGuestDelete.id);
                  if (ok) setPendingGuestDelete(null);
                }}
                disabled={guestRemovingIds.has(pendingGuestDelete.id)}
                className="px-4 py-2 rounded-xl bg-brand-red text-white text-sm font-bold disabled:opacity-60"
              >
                {guestRemovingIds.has(pendingGuestDelete.id) ? 'Removing...' : 'Delete Guest'}
              </button>
            </div>
          </div>
        </div>
      )}

      {teamEditor && (
        <div className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-start justify-center px-4 py-8 overflow-y-auto">
          <div className="w-full max-w-6xl bg-brand-dark border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-white/10">
              <div>
                <div className="text-[11px] uppercase tracking-[0.3em] text-gray-400">Team Editor</div>
                <div className="text-white font-sports text-2xl uppercase">
                  {teamEditorForm?.name || 'Team'}
                </div>
              </div>
              <button
                type="button"
                onClick={closeTeamEditor}
                disabled={teamEditorSaving}
                className="text-gray-400 hover:text-white text-sm disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="p-6">
              {teamEditorLoading ? (
                <div className="text-sm text-gray-400">Loading team editor...</div>
              ) : (
                <div className="grid gap-6 lg:grid-cols-[360px,1fr]">
                  <div className="space-y-5">
                    <div className="bg-black/40 border border-white/10 rounded-2xl p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold uppercase tracking-wider text-gray-300">Branding</div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center gap-4">
                          <div className="w-16 h-16 rounded-full overflow-hidden bg-black border border-white/10">
                            {teamEditorLogoPreview ? (
                              <img
                                src={teamEditorLogoPreview}
                                alt="Team logo"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                                Logo
                              </div>
                            )}
                          </div>
                          <div className="flex-1 space-y-2">
                            <div className="text-[11px] uppercase tracking-wider text-gray-500">Team Logo</div>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setTeamEditorLogoFile(file);
                                setTeamEditorError(null);
                                setTeamEditorLogoPreview((prev) => {
                                  if (prev && prev.startsWith('blob:')) {
                                    try {
                                      URL.revokeObjectURL(prev);
                                    } catch {}
                                  }
                                  return URL.createObjectURL(file);
                                });
                              }}
                              className="block w-full text-xs text-gray-400 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-brand-lime file:text-black file:font-bold file:uppercase file:tracking-wide hover:file:brightness-110"
                              disabled={teamEditorSaving}
                            />
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Team Banner</div>
                          <div className="w-full h-28 rounded-xl overflow-hidden bg-black border border-white/10">
                            {teamEditorBannerPreview ? (
                              <img
                                src={teamEditorBannerPreview}
                                alt="Team banner"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                                Banner
                              </div>
                            )}
                          </div>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setTeamEditorBannerFile(file);
                              setTeamEditorError(null);
                              setTeamEditorBannerPreview((prev) => {
                                if (prev && prev.startsWith('blob:')) {
                                  try {
                                    URL.revokeObjectURL(prev);
                                  } catch {}
                                }
                                return URL.createObjectURL(file);
                              });
                            }}
                            className="mt-3 block w-full text-xs text-gray-400 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-black file:text-white file:font-bold file:uppercase file:tracking-wide hover:file:border hover:file:border-brand-lime"
                            disabled={teamEditorSaving}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="bg-black/40 border border-white/10 rounded-2xl p-5 space-y-4">
                      <div className="text-xs font-bold uppercase tracking-wider text-gray-300">Details</div>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-2">
                            Team Name
                          </label>
                          <input
                            type="text"
                            value={teamEditorForm?.name || ''}
                            onChange={(e) =>
                              setTeamEditorForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                            }
                            className="w-full bg-black border border-white/15 rounded-xl px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                            placeholder="e.g. Ballers"
                            disabled={teamEditorSaving}
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-2">
                            Division
                          </label>
                          {teamEditorDivisionOptions.length ? (
                            <select
                              value={teamEditorForm?.division || ''}
                              onChange={(e) =>
                                setTeamEditorForm((prev) =>
                                  prev ? { ...prev, division: e.target.value } : prev
                                )
                              }
                              className="w-full appearance-none bg-black border border-white/15 rounded-xl px-4 py-3 pr-12 text-white focus:border-brand-lime focus:outline-none"
                              style={{
                                backgroundImage:
                                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                                backgroundRepeat: 'no-repeat',
                                backgroundPosition: 'right 1rem center',
                                backgroundSize: '12px 8px',
                              }}
                              disabled={teamEditorSaving}
                            >
                              <option value="">Select division</option>
                              {teamEditorDivisionOptions.map((d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={teamEditorForm?.division || ''}
                              onChange={(e) =>
                                setTeamEditorForm((prev) => (prev ? { ...prev, division: e.target.value } : prev))
                              }
                              className="w-full bg-black border border-white/15 rounded-xl px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                              placeholder="e.g. D2"
                              disabled={teamEditorSaving}
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    {teamEditorError && <div className="text-xs text-brand-red">{teamEditorError}</div>}
                  </div>

                  <div className="bg-black/40 border border-white/10 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold uppercase tracking-wider text-gray-300">Roster Management</div>
                      <div className="text-xs text-gray-500">{teamEditorRoster.length} Players</div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-white/10">
                            <th className="text-left py-2 pr-2 w-20">No.</th>
                            <th className="text-left py-2 pr-2">Player Name</th>
                            <th className="text-center py-2 px-2 w-20">Role</th>
                            <th className="text-right py-2 pl-2 w-20">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {teamEditorRoster.map((p) => (
                            <tr key={p.id} className="border-b border-white/5">
                              <td className="py-2 pr-2">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={p.number}
                                  onChange={(e) =>
                                    setTeamEditorRoster((prev) =>
                                      prev.map((row) =>
                                        row.id === p.id ? { ...row, number: e.target.value } : row
                                      )
                                    )
                                  }
                                  className="w-16 bg-black border border-white/15 rounded px-2 py-1 text-white text-center focus:border-brand-lime focus:outline-none"
                                  disabled={teamEditorSaving}
                                />
                              </td>
                              <td className="py-2 pr-2">
                                <input
                                  type="text"
                                  value={p.name}
                                  onChange={(e) =>
                                    setTeamEditorRoster((prev) =>
                                      prev.map((row) =>
                                        row.id === p.id ? { ...row, name: e.target.value } : row
                                      )
                                    )
                                  }
                                  className="w-full bg-black border border-white/15 rounded px-3 py-1.5 text-white focus:border-brand-lime focus:outline-none"
                                  disabled={teamEditorSaving}
                                />
                              </td>
                              <td className="py-2 px-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => toggleTeamEditorCaptain(p.id)}
                                  className={`p-1 rounded hover:bg-white/10 transition-colors ${
                                    p.isCaptain ? 'text-yellow-400' : 'text-gray-600 hover:text-gray-300'
                                  }`}
                                  title={p.isCaptain ? 'Captain' : 'Make Captain'}
                                  disabled={teamEditorSaving}
                                >
                                  <Crown size={18} fill={p.isCaptain ? 'currentColor' : 'none'} />
                                </button>
                              </td>
                              <td className="py-2 pl-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => attemptRemoveTeamEditorPlayer(p)}
                                  className="text-gray-500 hover:text-brand-red transition-colors"
                                  disabled={teamEditorSaving}
                                  title="Remove"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {teamEditorRoster.length === 0 && (
                            <tr>
                              <td colSpan={4} className="py-6 text-center text-gray-500 italic">
                                No players on roster.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="bg-white/5 p-4 rounded-xl border border-white/10 space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs text-brand-lime uppercase font-bold">Add New Player</h4>
                        <button
                          type="button"
                          onClick={() => setTeamEditorShowNewPlayer((prev) => !prev)}
                          className="text-xs uppercase tracking-wide text-gray-400 px-3 py-1 rounded border border-white/10 hover:border-white hover:text-white transition-colors"
                        >
                          {teamEditorShowNewPlayer ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      {teamEditorShowNewPlayer && (
                        <div className="flex flex-wrap gap-3">
                          <input
                            type="text"
                            placeholder="Player Name"
                            value={teamEditorNewPlayer.name}
                            onChange={(e) =>
                              setTeamEditorNewPlayer((prev) => ({ ...prev, name: e.target.value }))
                            }
                            className="w-full sm:flex-[2] sm:min-w-[220px] bg-black border border-white/20 rounded p-2 text-white text-sm focus:border-brand-lime focus:outline-none"
                            disabled={teamEditorSaving}
                          />
                          <input
                            type="email"
                            placeholder="Player Email (optional)"
                            value={teamEditorNewPlayer.email}
                            onChange={(e) =>
                              setTeamEditorNewPlayer((prev) => ({ ...prev, email: e.target.value }))
                            }
                            className="w-full sm:flex-1 sm:min-w-[200px] bg-black border border-white/20 rounded p-2 text-white text-sm focus:border-brand-lime focus:outline-none"
                            disabled={teamEditorSaving}
                          />
                          <input
                            type="text"
                            placeholder="#"
                            value={teamEditorNewPlayer.number}
                            onChange={(e) =>
                              setTeamEditorNewPlayer((prev) => ({ ...prev, number: e.target.value }))
                            }
                            className="w-full sm:w-16 bg-black border border-white/20 rounded p-2 text-white text-sm text-center focus:border-brand-lime focus:outline-none"
                            disabled={teamEditorSaving}
                          />
                          <button
                            type="button"
                            onClick={addTeamEditorPlayer}
                            disabled={teamEditorSaving}
                            className="w-full sm:w-auto bg-brand-lime text-black px-4 py-2.5 rounded font-bold font-sports uppercase text-xs tracking-wide hover:bg-lime-300 transition-colors text-center disabled:opacity-60"
                          >
                            Add
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeTeamEditor}
                disabled={teamEditorSaving}
                className="px-4 py-2 rounded-xl border border-white/20 text-gray-300 text-sm hover:border-white/40 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveTeamEditor()}
                disabled={teamEditorSaving || teamEditorLoading || !teamEditorForm}
                className="px-4 py-2 rounded-xl bg-brand-lime text-black text-sm font-bold disabled:opacity-60"
              >
                {teamEditorSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {teamEditorRosterWarning && (
        <div className="fixed inset-0 z-[61] bg-black/75 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-md bg-brand-dark border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10">
              <div className="text-white font-sports text-xl uppercase">{teamEditorRosterWarning.title}</div>
              <p className="text-xs text-gray-400 mt-1">
                {teamEditorRosterWarning.description}
              </p>
            </div>
            <div className="px-6 py-4 text-sm text-gray-300 space-y-3">
              <p>{teamEditorRosterWarning.body}</p>
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setTeamEditorRosterWarning(null)}
                className="px-4 py-2 rounded-xl bg-brand-lime text-black text-sm font-bold"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className="mx-auto w-full p-4 md:p-8"
        style={{ maxWidth: 'min(1200px, 98vw)' }}
      >
          <button onClick={onClose} className="text-gray-400 hover:text-white flex items-center gap-2 mb-6">
             <ArrowLeft size={20} /> Back to Schedule
          </button>

          <div className="bg-brand-dark border border-white/10 rounded-xl p-6 mb-6">
               <div className="flex flex-col gap-4 mb-6">
                 <div className="relative">
                   <div className="flex items-center justify-center gap-8 bg-black pt-10 pb-6 px-6 rounded-xl border border-white/10">
                     <div className="flex flex-col items-center gap-3 text-center">
                       {homeTeam?.id ? (
                         <button
                           type="button"
                           onClick={() =>
                             openTeamEditor(
                               homeTeam.id,
                               getTeamDisplayName(homeTeam.id, homeTeam.name)
                             )
                           }
                           className="block text-2xl font-sports text-white hover:text-brand-lime transition-colors"
                         >
                           {getTeamDisplayName(homeTeam.id, homeTeam.name)}
                         </button>
                       ) : (
                         <h2 className="text-2xl font-sports text-white">{homeTeam?.name}</h2>
                       )}
                       <input
                         type="text"
                         inputMode="numeric"
                         pattern="[0-9]*"
                         value={homeScore}
                         onChange={(e) => setHomeScore(toNonNegative(e.target.value))}
                         disabled={scoreLocked}
                         className={`bg-white/10 text-4xl font-bold text-center w-24 rounded p-2 text-white focus:outline-none focus:border-brand-lime border border-transparent ${
                           scoreLocked ? 'opacity-60 cursor-not-allowed' : ''
                         }`}
                       />
                     </div>
                     <span className="text-gray-500 font-bold">VS</span>
                     <div className="flex flex-col items-center gap-3 text-center">
                       {awayTeam?.id ? (
                         <button
                           type="button"
                           onClick={() =>
                             openTeamEditor(
                               awayTeam.id,
                               getTeamDisplayName(awayTeam.id, awayTeam.name)
                             )
                           }
                           className="block text-2xl font-sports text-white hover:text-brand-lime transition-colors"
                         >
                           {getTeamDisplayName(awayTeam.id, awayTeam.name)}
                         </button>
                       ) : (
                         <h2 className="text-2xl font-sports text-white">{awayTeam?.name}</h2>
                       )}
                       <input
                         type="text"
                         inputMode="numeric"
                         pattern="[0-9]*"
                         value={awayScore}
                         onChange={(e) => setAwayScore(toNonNegative(e.target.value))}
                         disabled={scoreLocked}
                         className={`bg-white/10 text-4xl font-bold text-center w-24 rounded p-2 text-white focus:outline-none focus:border-brand-lime border border-transparent ${
                           scoreLocked ? 'opacity-60 cursor-not-allowed' : ''
                         }`}
                       />
                     </div>
                   </div>
                   {renderScoreLockButton('absolute top-3 right-3 z-20 md:top-4 md:right-4')}
                 </div>

                 <div className="bg-black/20 border border-white/10 rounded-xl p-4">
                   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                     <div>
                       <label className="block text-xs text-gray-400 uppercase mb-1">Game Status</label>
                       <div className="relative">
                         <select
                           value={gameStatus}
                           onChange={(e) => setGameStatus(e.target.value as any)}
                           className="w-full appearance-none bg-black border border-white/20 rounded p-2 pr-10 dropdown-select-spacing text-white"
                         >
                           <option value="SCHEDULED">Scheduled</option>
                           <option value="COMPLETED">Final / Completed</option>
                           <option value="FORFEITED">Forfeited</option>
                           <option value="CANCELED">Canceled</option>
                         </select>
                         <ChevronDown
                           size={14}
                           className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                         />
                       </div>
                     </div>
                     <div>
                       <label className="block text-xs text-gray-400 uppercase mb-1">Date</label>
                       <div className="flex items-center bg-black border border-white/20 rounded px-2">
                         <input
                           ref={gameDateInputRef}
                           type="date"
                           value={gameDate}
                           onChange={(e) => setGameDate(e.target.value)}
                           className="w-full bg-transparent py-2 text-white text-sm focus:outline-none [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:pointer-events-none [&::-webkit-calendar-picker-indicator]:w-0"
                         />
                         <button
                           type="button"
                           onClick={() => {
                             const input = gameDateInputRef.current as any;
                             input?.showPicker?.();
                             gameDateInputRef.current?.focus();
                           }}
                           className="ml-2 text-gray-400 hover:text-white transition-colors"
                           aria-label="Open date picker"
                         >
                           <Calendar size={14} />
                         </button>
                       </div>
                     </div>
                     <div>
                       <label className="block text-xs text-gray-400 uppercase mb-1">Time</label>
                       <input
                         type="time"
                         value={gameTime}
                         onChange={(e) => setGameTime(e.target.value)}
                         className="w-full bg-black border border-white/20 rounded p-2 text-white text-sm"
                       />
                     </div>
                     <div>
                       <label className="block text-xs text-gray-400 uppercase mb-1">Home Team</label>
                       <div className="relative">
                         <select
                           value={selectedHomeTeamId}
                           onChange={(e) => {
                             const nextHomeId = e.target.value;
                             setSelectedHomeTeamId(nextHomeId);
                             if (nextHomeId === selectedAwayTeamId) {
                               const replacementAway = rosterTeams.find((team) => team.id !== nextHomeId);
                               setSelectedAwayTeamId(replacementAway?.id || '');
                             }
                           }}
                           className="w-full appearance-none bg-black border border-white/20 rounded p-2 pr-10 dropdown-select-spacing text-white text-sm"
                         >
                           {homeTeamOptions.map((team) => (
                             <option key={`home-${team.id}`} value={team.id}>
                               {getTeamDisplayName(team.id, team.name) || team.name}
                             </option>
                           ))}
                         </select>
                         <ChevronDown
                           size={14}
                           className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                         />
                       </div>
                     </div>
                     <div>
                       <label className="block text-xs text-gray-400 uppercase mb-1">Away Team</label>
                       <div className="relative">
                         <select
                           value={selectedAwayTeamId}
                           onChange={(e) => {
                             const nextAwayId = e.target.value;
                             setSelectedAwayTeamId(nextAwayId);
                             if (nextAwayId === selectedHomeTeamId) {
                               const replacementHome = rosterTeams.find((team) => team.id !== nextAwayId);
                               setSelectedHomeTeamId(replacementHome?.id || '');
                             }
                           }}
                           className="w-full appearance-none bg-black border border-white/20 rounded p-2 pr-10 dropdown-select-spacing text-white text-sm"
                         >
                           {awayTeamOptions.map((team) => (
                             <option key={`away-${team.id}`} value={team.id}>
                               {getTeamDisplayName(team.id, team.name) || team.name}
                             </option>
                           ))}
                         </select>
                         <ChevronDown
                           size={14}
                           className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                         />
                       </div>
                     </div>
                     {gameStatus === 'FORFEITED' && (
                       <div>
                         <label className="block text-xs text-gray-400 uppercase mb-1">Forfeit Winner</label>
                         <div className="relative">
                           <select
                             value={forfeitWinnerTeamId}
                             onChange={(e) => setForfeitWinnerTeamId(e.target.value)}
                             className="w-full appearance-none bg-black border border-white/20 rounded p-2 pr-10 dropdown-select-spacing text-white text-sm"
                           >
                             <option value="">Select winner</option>
                             {selectedHomeTeamId ? (
                               <option value={selectedHomeTeamId}>
                                 {getTeamDisplayName(selectedHomeTeamId, homeTeam?.name || 'Home')}
                               </option>
                             ) : null}
                             {selectedAwayTeamId ? (
                               <option value={selectedAwayTeamId}>
                                 {getTeamDisplayName(selectedAwayTeamId, awayTeam?.name || 'Away')}
                               </option>
                             ) : null}
                           </select>
                           <ChevronDown
                             size={14}
                             className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                           />
                         </div>
                       </div>
                     )}
                     <div>
                       <label className="block text-xs text-gray-400 uppercase mb-1">YouTube Link</label>
                       <div className="flex items-center bg-black border border-white/20 rounded px-2">
                         <Video size={16} className="text-red-500 mr-2" />
                         <input
                           type="text"
                           value={youtubeLink}
                           onChange={(e) => setYoutubeLink(e.target.value)}
                           placeholder="https://youtube.com/..."
                           className="w-full bg-transparent py-2 text-white focus:outline-none text-sm"
                         />
                       </div>
                     </div>
                   </div>
                 </div>
               </div>
            
            {/* Player Stats Section */}
            <div className="text-gray-400 text-sm mb-3">Box Score</div>

            <div className="bg-black/20 border border-white/10 rounded-xl p-4 mb-4">
               <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                 <div>
                   <div className="text-xs text-brand-lime uppercase font-bold tracking-wide">Guest Player</div>
                   <p className="text-[11px] text-gray-400">Add a guest just for this game (they won't appear on the team roster).</p>
                 </div>
                 <button
                   type="button"
                   onClick={() => setShowGuestForm((prev) => !prev)}
                   className="text-[11px] uppercase tracking-wide text-gray-400 px-3 py-1 rounded border border-white/10 hover:border-white hover:text-white transition-colors self-start"
                 >
                   {showGuestForm ? 'Hide' : 'Add Guest'}
                 </button>
               </div>
               {showGuestForm && (
                 <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-3">
                   <select
                     value={guestForm.team}
                     onChange={(e) => setGuestForm({ ...guestForm, team: e.target.value as 'home' | 'away' })}
                     className="bg-black border border-white/20 rounded px-3 py-2 text-xs text-white uppercase tracking-wide"
                   >
                     <option value="home">
                       {getTeamDisplayName(homeTeam?.id, homeTeam?.name || 'Home Team')}
                     </option>
                     <option value="away">
                       {getTeamDisplayName(awayTeam?.id, awayTeam?.name || 'Away Team')}
                     </option>
                   </select>
                   <input
                     type="text"
                     placeholder="Guest Name"
                     value={guestForm.name}
                     onChange={(e) => setGuestForm({ ...guestForm, name: e.target.value })}
                     className="bg-black border border-white/20 rounded px-3 py-2 text-xs text-white placeholder:text-gray-500 focus:border-brand-lime focus:outline-none"
                   />
                   <input
                     type="email"
                     placeholder="Guest Email"
                     value={guestForm.email}
                     onChange={(e) => setGuestForm({ ...guestForm, email: e.target.value })}
                     className="bg-black border border-white/20 rounded px-3 py-2 text-xs text-white placeholder:text-gray-500 focus:border-brand-lime focus:outline-none"
                   />
                   <input
                     type="text"
                     placeholder="Guest # (optional)"
                     value={guestForm.number}
                     onChange={(e) => setGuestForm({ ...guestForm, number: e.target.value })}
                     className="bg-black border border-white/20 rounded px-3 py-2 text-xs text-white text-center placeholder:text-gray-500 focus:border-brand-lime focus:outline-none"
                   />
                   <button
                     type="button"
                     onClick={addGuestPlayer}
                     disabled={guestAdding}
                     className="bg-brand-lime text-black font-bold uppercase text-xs rounded px-3 py-2 disabled:opacity-60"
                   >
                     {guestAdding ? 'Adding...' : 'Save Guest'}
                   </button>
                 </div>
               )}
               {guestError && showGuestForm && (
                 <p className="text-xs text-brand-red mt-2">{guestError}</p>
               )}
             </div>

            <div className="space-y-6 md:hidden">
               {rosterLoading ? (
                 <div className="text-gray-400 text-sm">Loading roster...</div>
               ) : (
                 renderPlayerTable(
                   homeRoster,
                   getTeamDisplayName(homeTeam?.id, homeTeam?.name || 'Home'),
                   'home'
                 )
               )}
               {rosterLoading ? (
                 <div className="text-gray-400 text-sm">Loading roster...</div>
               ) : (
                 renderPlayerTable(
                   awayRoster,
                   getTeamDisplayName(awayTeam?.id, awayTeam?.name || 'Away'),
                   'away'
                 )
               )}
             </div>
             <div className="hidden md:block space-y-6">
               {rosterLoading ? (
                 <div className="text-gray-400 text-sm">Loading roster...</div>
               ) : (
                 renderDesktopTable(
                   homeRoster,
                   getTeamDisplayName(homeTeam?.id, homeTeam?.name || 'Home'),
                   'home'
                 )
               )}
               {rosterLoading ? (
                 <div className="text-gray-400 text-sm">Loading roster...</div>
               ) : (
                 renderDesktopTable(
                   awayRoster,
                   getTeamDisplayName(awayTeam?.id, awayTeam?.name || 'Away'),
                   'away'
                 )
               )}
             </div>

             {rosterError && <div className="text-xs text-brand-red font-mono mt-2">{rosterError}</div>}

             <div className="mt-6 flex justify-end">
                <div className="flex flex-col items-end gap-2">
                  {saveMessage && <div className="text-xs text-gray-300">{saveMessage}</div>}
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-brand-lime text-black px-8 py-3 rounded font-bold text-lg uppercase flex items-center gap-2 hover:bg-white transition-colors disabled:opacity-60"
                  >
                   <Save size={20} /> {saving ? 'Saving...' : 'Save All Stats'}
                  </button>
                </div>
             </div>
          </div>
       </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(boxScoreEditorContent, document.body);
  }
  return boxScoreEditorContent;
};

// --- COMPONENT: SCHEDULE MANAGER ---
interface ScheduleManagerProps {
  userRole: Role;
  showImportsOnly?: boolean;
  importSeasonId?: string | null;
  importSeasonLabel?: string;
}

const ScheduleManager: React.FC<ScheduleManagerProps> = ({
  userRole,
  showImportsOnly = false,
  importSeasonId,
  importSeasonLabel,
}) => {
  const [games, setGames] = useState<Game[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasonOptions, setSeasonOptions] = useState<SeasonView[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [divisionOptions, setDivisionOptions] = useState<string[]>(['all']);
  const [selectedDivision, setSelectedDivision] = useState<string>('all');
  const [selectedGameStatus, setSelectedGameStatus] = useState<string>('all');
  const [page, setPage] = useState<number>(1);
  const pageSize = 6;
  type ScheduleSortOption = 'date_desc' | 'date_asc' | 'team_name';
  type PageEntry = number | 'ellipsis';
  const [sortOption, setSortOption] = useState<ScheduleSortOption>('date_desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingGame, setEditingGame] = useState<Game | null>(null); // If set, shows BoxScoreEditor
  const [pendingDelete, setPendingDelete] = useState<Game | null>(null);
  const [statsCsvFileName, setStatsCsvFileName] = useState('');
  const [statsCsvRows, setStatsCsvRows] = useState<SeasonStatsCsvRow[]>([]);
    const [statsCsvSummary, setStatsCsvSummary] = useState<{
      total: number;
      ready: number;
      missingTeam: number;
      missingName: number;
      seasonMismatch: number;
      missingStats: number;
    } | null>(null);
  const [statsCsvError, setStatsCsvError] = useState<string | null>(null);
  const [statsCsvImporting, setStatsCsvImporting] = useState(false);
  const [statsCsvImportedCount, setStatsCsvImportedCount] = useState<number | null>(null);
  const [statsCsvCreateTeams, setStatsCsvCreateTeams] = useState(false);
  const [statsCsvReplaceExisting, setStatsCsvReplaceExisting] = useState(true);
  const [statsGameType, setStatsGameType] = useState<'regular' | 'playoffs' | 'exhibition'>('regular');
  const statsCsvInputRef = useRef<HTMLInputElement | null>(null);
  const [scheduleCsvFileName, setScheduleCsvFileName] = useState('');
  const [scheduleCsvRows, setScheduleCsvRows] = useState<ScheduleCsvRow[]>([]);
  const [scheduleCsvSummary, setScheduleCsvSummary] = useState<{
    total: number;
    ready: number;
    missingDate: number;
    missingTime: number;
    missingHome: number;
    missingAway: number;
    missingLocation: number;
  } | null>(null);
  const [scheduleCsvError, setScheduleCsvError] = useState<string | null>(null);
  const [scheduleCsvImporting, setScheduleCsvImporting] = useState(false);
  const [scheduleCsvImportedCount, setScheduleCsvImportedCount] = useState<number | null>(null);
  const [scheduleCsvResultMessage, setScheduleCsvResultMessage] = useState<string | null>(null);
  const [scheduleCsvUpdateExistingDateTimeOnly, setScheduleCsvUpdateExistingDateTimeOnly] = useState(false);
  const scheduleCsvInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  const teamMap = useMemo(() => {
    const map = new Map<string, Team>();
    teams.forEach((team) => map.set(team.id, team));
    return map;
  }, [teams]);

  const normalizeDivisionFilterKey = (value: string | null | undefined) =>
    (value || '')
      .toString()
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase();

  const normalizeGameStatus = (status: string | null | undefined) => {
    const normalized = (status || 'SCHEDULED')
      .toString()
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '_');
    if (normalized === 'FINAL') return 'COMPLETED';
    if (normalized === 'CANCELLED') return 'CANCELED';
    return normalized || 'SCHEDULED';
  };

  const formatGameStatusLabel = (status: string) => {
    if (status === 'COMPLETED') return 'Final / Completed';
    if (status === 'CANCELED') return 'Canceled';
    return status
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (match) => match.toUpperCase());
  };

  const gameStatusOptions = useMemo(() => {
    const baseOptions = ['SCHEDULED', 'COMPLETED', 'FORFEITED', 'CANCELED'];
    const seen = new Set(baseOptions);
    const extras = Array.from(
      new Set(
        games
          .map((game) => normalizeGameStatus(game.status))
          .filter((status) => !!status && !seen.has(status))
      )
    ).sort((a, b) => a.localeCompare(b));
    return ['all', ...baseOptions, ...extras];
  }, [games]);

  useEffect(() => {
    if (selectedGameStatus !== 'all' && !gameStatusOptions.includes(selectedGameStatus)) {
      setSelectedGameStatus('all');
    }
  }, [gameStatusOptions, selectedGameStatus]);

  const filteredGames = useMemo(() => {
    if (selectedGameStatus === 'all') return games;
    return games.filter((game) => normalizeGameStatus(game.status) === selectedGameStatus);
  }, [games, selectedGameStatus]);

  const sortedGames = useMemo(() => {
    const gamesCopy = [...filteredGames];
    const getTimestamp = (game: Game) => {
      const datePart = game.date || '1900-01-01';
      const timePart = game.time || '00:00';
      const parsed = Date.parse(`${datePart}T${timePart}`);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const homeTeamName = (game: Game) => teamMap.get(game.homeTeamId)?.name || '';
    const awayTeamName = (game: Game) => teamMap.get(game.awayTeamId)?.name || '';

    gamesCopy.sort((a, b) => {
      if (sortOption === 'team_name') {
        const homeA = homeTeamName(a);
        const homeB = homeTeamName(b);
        const nameCompare = homeA.localeCompare(homeB);
        if (nameCompare !== 0) return nameCompare;
        return awayTeamName(a).localeCompare(awayTeamName(b));
      }
      const timeA = getTimestamp(a);
      const timeB = getTimestamp(b);
      if (sortOption === 'date_asc') return timeA - timeB;
      return timeB - timeA;
    });
    return gamesCopy;
  }, [filteredGames, sortOption, teamMap]);

  const totalPages = Math.max(1, Math.ceil(sortedGames.length / pageSize));
  useEffect(() => {
    setPage((prev) => Math.max(1, Math.min(prev, totalPages)));
  }, [totalPages]);

  const paginationPages = useMemo<PageEntry[]>(() => {
    const pages: PageEntry[] = [];
    const windowSize = Math.min(5, totalPages);
    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, page + 2);

    if (end - start + 1 < windowSize) {
      if (start === 1) {
        end = Math.min(totalPages, start + windowSize - 1);
      } else if (end === totalPages) {
        start = Math.max(1, end - windowSize + 1);
      } else {
        const extra = windowSize - (end - start + 1);
        start = Math.max(1, start - extra);
      }
    }

    if (start > 1) {
      pages.push(1);
      if (start > 2) pages.push('ellipsis');
    }

    for (let p = start; p <= end; p += 1) {
      pages.push(p);
    }

    if (end < totalPages) {
      if (end < totalPages - 1) pages.push('ellipsis');
      pages.push(totalPages);
    }

    return pages;
  }, [page, totalPages]);

  const pageGames = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedGames.slice(start, start + pageSize);
  }, [page, pageSize, sortedGames]);

  const effectiveImportSeasonId = showImportsOnly ? importSeasonId : selectedSeasonId;
  const effectiveSeasonLabel =
    importSeasonLabel ||
    seasonOptions.find((s) => s.id === effectiveImportSeasonId)?.name ||
    'Season';
  
  // Permissions
  const canSchedule = userRole === Role.ADMIN_FULL || userRole === Role.ADMIN_COMMISSIONER;
  const canScore = userRole === Role.ADMIN_FULL || userRole === Role.ADMIN_SCOREKEEPER;

  const normalizeCsvHeader = (value: string) =>
    value.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
  const normalizeHeaderKey = (value: string) =>
    normalizeCsvHeader(value).replace(/[^a-z0-9#]/g, '');
  const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();
  const normalizeTeamName = (value: string) => normalizeText(value).toLowerCase();
  const normalizeDivisionName = (value: string) => normalizeText(value).toLowerCase();
  const parseNumber = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    let normalized = trimmed;
    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');
    if (hasComma && !hasDot) {
      normalized = normalized.replace(/,/g, '.');
    } else if (hasComma && hasDot) {
      normalized = normalized.replace(/,/g, '');
    }
    const cleaned = normalized.replace(/[^0-9.+-]/g, '');
    if (!cleaned) return null;
    const parsed = Number.parseFloat(cleaned);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const parseCsv = (input: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (char === '"') {
        if (inQuotes && input[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current);
        current = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && input[i + 1] === '\n') i += 1;
        row.push(current);
        if (row.some((cell) => cell.trim() !== '')) {
          rows.push(row);
        }
        row = [];
        current = '';
      } else {
        current += char;
      }
    }

    row.push(current);
    if (row.some((cell) => cell.trim() !== '')) {
      rows.push(row);
    }
    return rows;
  };

  const buildStatsRows = (input: string): SeasonStatsCsvRow[] => {
    const rawRows = parseCsv(input);
    if (!rawRows.length) return [];

    const headerRow = rawRows[0].map((cell, index) => {
      const cleaned = index === 0 ? cell.replace(/^\uFEFF/, '') : cell;
      return normalizeCsvHeader(cleaned);
    });
    const headerIndex = new Map<string, number>();
    headerRow.forEach((header, index) => {
      const key = normalizeHeaderKey(header);
      if (key && !headerIndex.has(key)) {
        headerIndex.set(key, index);
      }
    });

    const getValue = (rowValues: string[], keys: string[]) => {
      for (const key of keys) {
        const idx = headerIndex.get(normalizeHeaderKey(key));
        if (idx !== undefined) return rowValues[idx] ?? '';
      }
      return '';
    };

    return rawRows.slice(1).map((rowValues) => ({
        firstName: normalizeText(getValue(rowValues, ['first name', 'firstname', 'first'])).trim(),
        lastName: normalizeText(getValue(rowValues, ['last name', 'lastname', 'last'])).trim(),
        season: normalizeText(getValue(rowValues, ['season', 'season name'])),
        division: normalizeText(getValue(rowValues, ['division', 'division name'])),
        teamName: normalizeText(getValue(rowValues, ['team', 'team name', 'teamname'])),
        jerseyNumber: normalizeText(
          getValue(rowValues, ['#', 'no', 'no.', 'number', 'jersey', 'jersey number', 'jersey #'])
        ),
        status: normalizeText(getValue(rowValues, ['status'])),
        position: normalizeText(getValue(rowValues, ['pos', 'position'])),
        gp: normalizeText(getValue(rowValues, ['gp', 'games', 'games played', 'g'])),
        pts: normalizeText(getValue(rowValues, ['pts', 'points', 'ppg', 'pts/g', 'points per game', 'pts per game'])),
        fgm: normalizeText(getValue(rowValues, ['fgm', 'fg made', 'fg made per game'])),
        fga: normalizeText(getValue(rowValues, ['fga', 'fg attempted', 'fg attempts', 'fg attempted per game'])),
        fgPct: normalizeText(getValue(rowValues, ['fg%', 'fg pct', 'fg percentage', 'fg percent', 'fgp'])),
        tpm: normalizeText(getValue(rowValues, ['3pm', '3p made', '3pt made', '3ptm'])),
        tpa: normalizeText(getValue(rowValues, ['3pa', '3p attempted', '3pt attempted', '3pta'])),
        threePct: normalizeText(
          getValue(rowValues, ['3p%', '3pt%', '3p pct', '3pt pct', '3p percentage', '3pt percentage'])
        ),
        reb: normalizeText(getValue(rowValues, ['reb', 'rebounds', 'rpg', 'reb/g', 'reb per game'])),
        ast: normalizeText(getValue(rowValues, ['ast', 'assists', 'apg', 'ast/g', 'assists per game', 'ast per game'])),
        stl: normalizeText(getValue(rowValues, ['stl', 'steals', 'spg', 'stl/g', 'steals per game', 'stl per game'])),
        blk: normalizeText(getValue(rowValues, ['blk', 'blocks', 'bpg', 'blk/g', 'blocks per game', 'blk per game'])),
        tov: normalizeText(
          getValue(rowValues, ['tov', 'turnovers', 'tpg', 'tov/g', 'turnovers per game', 'tov per game'])
        ),
        ftPct: normalizeText(getValue(rowValues, ['ft%', 'ft pct', 'ft percentage', 'ft percent'])),
        fta: normalizeText(getValue(rowValues, ['fta', 'ft attempted', 'ft attempts'])),
      }));
    };

  const resetStatsCsvState = () => {
    setStatsCsvFileName('');
    setStatsCsvRows([]);
    setStatsCsvSummary(null);
    setStatsCsvError(null);
    setStatsCsvImportedCount(null);
    if (statsCsvInputRef.current) {
      statsCsvInputRef.current.value = '';
    }
  };

  const handleStatsCsvFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatsCsvError(null);
    setStatsCsvImportedCount(null);
    setStatsCsvFileName(file.name);
    try {
      const text = await file.text();
      const parsed = buildStatsRows(text).filter((row) =>
        Object.values(row).some((value) => value.trim() !== '')
      );
      setStatsCsvRows(parsed);
      const seasonName =
        seasonOptions.find((s) => s.id === selectedSeasonId)?.name?.toLowerCase() || '';
        const summary = parsed.reduce(
          (acc, row) => {
            const hasName = !!(row.firstName || row.lastName).trim();
            const hasTeam = !!row.teamName.trim();
            const seasonMismatch =
              row.season &&
              seasonName &&
              !row.season.toLowerCase().includes(seasonName);
            const hasStats = [
              row.gp,
              row.pts,
              row.fgm,
              row.fga,
              row.fgPct,
              row.tpm,
              row.tpa,
              row.threePct,
              row.reb,
              row.ast,
              row.stl,
              row.blk,
              row.tov,
              row.ftPct,
              row.fta,
            ].some((value) => value.trim() !== '');
            if (!hasName) acc.missingName += 1;
            if (!hasTeam) acc.missingTeam += 1;
            if (seasonMismatch) acc.seasonMismatch += 1;
            if (!hasStats) acc.missingStats += 1;
            if (hasName && hasTeam && !seasonMismatch) acc.ready += 1;
            acc.total += 1;
            return acc;
          },
          { total: 0, ready: 0, missingTeam: 0, missingName: 0, seasonMismatch: 0, missingStats: 0 }
        );
      setStatsCsvSummary(summary);
      if (!parsed.length) {
        setStatsCsvError('No rows found in that CSV.');
      }
    } catch (err) {
      console.error('Stats CSV parse error', err);
      setStatsCsvError('Failed to read that CSV. Please check the file format.');
    }
  };

  const handleStatsCsvImport = async () => {
    const seasonIdForStats = showImportsOnly ? importSeasonId : selectedSeasonId;
    if (!seasonIdForStats) {
      setStatsCsvError('Select a season above before importing.');
      return;
    }
    if (!statsCsvRows.length) {
      setStatsCsvError('Upload a CSV before importing.');
      return;
    }
    setStatsCsvImporting(true);
    setStatsCsvError(null);
    setStatsCsvImportedCount(null);

    try {
      const seasonName =
        seasonOptions.find((s) => s.id === seasonIdForStats)?.name?.toLowerCase() || '';
      const teamIdByName = new Map<string, string>();
      teams.forEach((team) => {
        teamIdByName.set(normalizeTeamName(team.name), team.id);
      });

      const divisionCandidates = new Map<string, string>();
      csvRows.forEach((row) => {
        const divisionName = normalizeText(row.division);
        if (divisionName) {
          divisionCandidates.set(normalizeDivisionName(divisionName), divisionName);
        }
      });

      if (divisionCandidates.size) {
        try {
          const { data: existingDivisions, error: divisionErr } = await supabase
            .from('divisions')
            .select('id,name')
            .eq('season_id', selectedSeasonId);
          if (divisionErr) {
            const missingTable =
              divisionErr.code === 'PGRST205' ||
              divisionErr.message?.toLowerCase?.().includes('divisions');
            if (!missingTable) throw divisionErr;
          } else {
            const existingNames = new Set(
              (existingDivisions || []).map((d: any) => normalizeDivisionName(d.name))
            );
            const newDivisions = Array.from(divisionCandidates.entries())
              .filter(([key]) => !existingNames.has(key))
              .map(([, name]) => ({
                name,
                description: null,
                season_id: selectedSeasonId,
              }));
            if (newDivisions.length) {
              let createDivErr = (
                await supabase.from('divisions').insert(newDivisions)
              ).error;
              if (createDivErr && supabaseAdmin) {
                createDivErr = (
                  await supabaseAdmin.from('divisions').insert(newDivisions)
                ).error;
              }
              if (createDivErr) throw createDivErr;
            }
          }
        } catch (err: any) {
          console.warn('Division import skipped', err);
          if (!csvError) {
            setCsvError(
              `Players imported, but divisions sync failed. ${err?.message || 'Check divisions insert policy.'}`
            );
          }
        }
      }

      const missingTeams = new Map<string, { name: string; division: string }>();
      const candidates = statsCsvRows.filter((row) => {
        const hasName = !!(row.firstName || row.lastName).trim();
        const hasTeam = !!row.teamName.trim();
        const seasonMismatch =
          row.season &&
          seasonName &&
          !row.season.toLowerCase().includes(seasonName);
        if (!hasName || !hasTeam || seasonMismatch) return false;
        const teamKey = normalizeTeamName(row.teamName);
        if (!teamIdByName.has(teamKey) && statsCsvCreateTeams) {
          missingTeams.set(teamKey, { name: row.teamName, division: row.division });
        }
        return true;
      });

      if (statsCsvCreateTeams && missingTeams.size) {
        const teamPayload = Array.from(missingTeams.values()).map((team) => {
          const payload: any = {
            name: team.name,
            season_id: selectedSeasonId,
          };
          if (team.division) payload.division = team.division;
          return payload;
        });
        const { data: createdTeams, error: createErr } = await supabase
          .from('teams')
          .insert(teamPayload)
          .select('id,name');
        if (createErr) throw createErr;
        (createdTeams || []).forEach((team: any) => {
          teamIdByName.set(normalizeTeamName(team.name), team.id);
        });
      }

      if (statsCsvReplaceExisting) {
        const { error: clearErr } = await supabase
          .from('season_player_stats')
          .delete()
          .eq('season_id', selectedSeasonId)
          .eq('game_type', statsGameType);
        if (clearErr) throw clearErr;
      }

      const payload = candidates
        .map((row) => {
          const teamKey = normalizeTeamName(row.teamName);
          const teamId = teamIdByName.get(teamKey);
          if (!teamId) return null;
          return {
            season_id: selectedSeasonId,
            team_id: teamId,
            team_name: row.teamName || null,
            division: row.division || null,
            first_name: row.firstName || null,
            last_name: row.lastName || null,
            jersey_number: parseJerseyNumberValue(row.jerseyNumber),
            status: row.status || null,
            position: row.position || null,
            gp: parseNumber(row.gp),
            pts: parseNumber(row.pts),
            fgm: parseNumber(row.fgm),
            fga: parseNumber(row.fga),
            fg_pct: parseNumber(row.fgPct),
            tpm: parseNumber(row.tpm),
            tpa: parseNumber(row.tpa),
            three_pct: parseNumber(row.threePct),
            reb: parseNumber(row.reb),
            ast: parseNumber(row.ast),
            stl: parseNumber(row.stl),
            blk: parseNumber(row.blk),
            tov: parseNumber(row.tov),
            ft_pct: parseNumber(row.ftPct),
            fta: parseNumber(row.fta),
            game_type: statsGameType,
          };
        })
        .filter((row): row is Record<string, any> => !!row);

      if (teamDivisionUpdates.size) {
        for (const [teamId, division] of teamDivisionUpdates.entries()) {
          const { error: divErr } = await supabase.from('teams').update({ division }).eq('id', teamId);
          if (divErr) throw divErr;
        }
      }

      if (!payload.length) {
        setStatsCsvError('No valid rows to import. Check the CSV and try again.');
        return;
      }

      const chunkSize = 200;
      let imported = 0;
      for (let i = 0; i < payload.length; i += chunkSize) {
        const chunk = payload.slice(i, i + chunkSize);
        const { error: insertErr } = await supabase.from('season_player_stats').insert(chunk);
        if (insertErr) throw insertErr;
        imported += chunk.length;
      }

      resetStatsCsvState();
      setStatsCsvImportedCount(imported);
      } catch (err: any) {
        console.error('Stats CSV import failed', err);
        setStatsCsvError(err?.message || 'Import failed. Check the CSV and try again.');
      } finally {
        setStatsCsvImporting(false);
      }
    };

  const parseScheduleDate = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const buildScheduleRows = (input: string): ScheduleCsvRow[] => {
    const rawRows = parseCsv(input);
    if (!rawRows.length) return [];

    const headerRow = rawRows[0].map((cell, index) => {
      const cleaned = index === 0 ? cell.replace(/^\uFEFF/, '') : cell;
      return normalizeCsvHeader(cleaned);
    });
    const headerIndex = new Map<string, number>();
    headerRow.forEach((header, index) => {
      const key = normalizeHeaderKey(header);
      if (key && !headerIndex.has(key)) {
        headerIndex.set(key, index);
      }
    });

    const getValue = (rowValues: string[], keys: string[]) => {
      for (const key of keys) {
        const idx = headerIndex.get(normalizeHeaderKey(key));
        if (idx !== undefined) return rowValues[idx] ?? '';
      }
      return '';
    };

    return rawRows.slice(1).map((rowValues) => ({
      date: normalizeText(getValue(rowValues, ['date', 'game date'])),
      time: normalizeText(getValue(rowValues, ['time', 'start time', 'game time'])),
      home: normalizeText(getValue(rowValues, ['home', 'home team', 'home name'])),
      homeDivision: normalizeText(getValue(rowValues, ['home division', 'home div'])),
      homeScore: normalizeText(getValue(rowValues, ['home score', 'home pts', 'home points'])),
      homePIM: normalizeText(getValue(rowValues, ['home pim'])),
      homeRoster: normalizeText(getValue(rowValues, ['home roster', 'home rost'])),
      away: normalizeText(getValue(rowValues, ['away', 'away team', 'away name'])),
      awayDivision: normalizeText(getValue(rowValues, ['away division', 'away div'])),
      awayScore: normalizeText(getValue(rowValues, ['away score', 'away pts', 'away points'])),
      awayPIM: normalizeText(getValue(rowValues, ['away pim'])),
      awayRoster: normalizeText(getValue(rowValues, ['away roster', 'away rost'])),
      status: normalizeText(getValue(rowValues, ['status'])),
      facility: normalizeText(getValue(rowValues, ['facility', 'venue', 'location'])),
      court: normalizeText(getValue(rowValues, ['court'])),
      schedule: normalizeText(getValue(rowValues, ['schedule', 'game type', 'division'])),
      publicNotes: normalizeText(getValue(rowValues, ['public notes', 'public note'])),
      privateNotes: normalizeText(getValue(rowValues, ['private notes', 'private note'])),
    }));
  };

  const resetScheduleCsvState = () => {
    setScheduleCsvFileName('');
    setScheduleCsvRows([]);
    setScheduleCsvSummary(null);
    setScheduleCsvError(null);
    setScheduleCsvImportedCount(null);
    setScheduleCsvResultMessage(null);
    if (scheduleCsvInputRef.current) {
      scheduleCsvInputRef.current.value = '';
    }
  };

  const handleScheduleCsvFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setScheduleCsvError(null);
    setScheduleCsvImportedCount(null);
    setScheduleCsvResultMessage(null);
    setScheduleCsvFileName(file.name);
    try {
      const text = await file.text();
      const parsed = buildScheduleRows(text).filter((row) =>
        Object.values(row).some((value) => value.trim() !== '')
      );
      setScheduleCsvRows(parsed);
      const summary = parsed.reduce(
        (acc, row) => {
          if (!row.date) acc.missingDate += 1;
          if (!row.time) acc.missingTime += 1;
          if (!row.home) acc.missingHome += 1;
          if (!row.away) acc.missingAway += 1;
          if (!row.facility && !row.court) acc.missingLocation += 1;
          if (row.date && row.time && row.home && row.away) acc.ready += 1;
          acc.total += 1;
          return acc;
        },
        { total: 0, ready: 0, missingDate: 0, missingTime: 0, missingHome: 0, missingAway: 0, missingLocation: 0 }
      );
      setScheduleCsvSummary(summary);
      if (!parsed.length) {
        setScheduleCsvError('No rows found in that CSV.');
      }
    } catch (err) {
      console.error('Schedule CSV parse error', err);
      setScheduleCsvError('Failed to read that CSV. Please check the file format.');
    }
  };

  const handleScheduleCsvImport = async () => {
    const seasonIdForSchedule = showImportsOnly ? importSeasonId : selectedSeasonId;
    if (!seasonIdForSchedule) {
      setScheduleCsvError('Select a season above before importing.');
      return;
    }
    if (!scheduleCsvRows.length) {
      setScheduleCsvError('Upload a CSV before importing.');
      return;
    }
    setScheduleCsvImporting(true);
    setScheduleCsvError(null);
    setScheduleCsvImportedCount(null);
    setScheduleCsvResultMessage(null);

    try {
      const teamIdByName = new Map<string, string>();
      const teamDivisionById = new Map<string, string>();
      teams.forEach((team) => {
        const key = normalizeTeamName(team.name);
        if (key) {
          teamIdByName.set(key, team.id);
          teamDivisionById.set(team.id, team.division || '');
        }
      });

      const payload: Record<string, any>[] = [];
      const teamDivisionUpdates = new Map<string, string>();

      const normalizeTimeForIso = (value: string) => {
        const raw = value.trim();
        if (!raw) return null;

        const strippedTimezone = raw.replace(
          /\s+\b(?:est|edt|cst|cdt|mst|mdt|pst|pdt|gmt|utc)\b$/i,
          ''
        ).trim();
        const normalized = strippedTimezone.replace(/\./g, '').replace(/\s+/g, ' ');

        const meridiemMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([AaPp][Mm])$/);
        if (meridiemMatch) {
          let hours = Number(meridiemMatch[1]);
          const minutes = Number(meridiemMatch[2] || 0);
          const seconds = Number(meridiemMatch[3] || 0);
          const meridiem = meridiemMatch[4].toUpperCase();
          if (hours < 1 || hours > 12 || minutes > 59 || seconds > 59) return null;
          if (meridiem === 'AM') {
            hours = hours === 12 ? 0 : hours;
          } else {
            hours = hours === 12 ? 12 : hours + 12;
          }
          return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        const twentyFourHourMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?$/);
        if (twentyFourHourMatch) {
          const hours = Number(twentyFourHourMatch[1]);
          const minutes = Number(twentyFourHourMatch[2] || 0);
          const seconds = Number(twentyFourHourMatch[3] || 0);
          if (hours > 23 || minutes > 59 || seconds > 59) return null;
          return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        return null;
      };

      const buildIso = (dateIso: string, value: string) => {
        if (!dateIso || !value.trim()) return '';
        const normalizedTime = normalizeTimeForIso(value);
        if (!normalizedTime) return '';
        return buildScheduleDateTimeIso(dateIso, normalizedTime);
      };

      const missingTeamNames = new Set<string>();
      scheduleCsvRows.forEach((row) => {
        const dateIso = parseScheduleDate(row.date);
        if (!dateIso) {
          console.warn('skip invalid schedule date', row.date, row);
          return;
        }
        if (!row.time.trim()) {
          console.warn('skip missing schedule time', row.time, row);
          return;
        }
        if (!row.home || !row.away) return;
        const normalizedHomeDivision = normalizeText(row.homeDivision || '');
        const normalizedAwayDivision = normalizeText(row.awayDivision || '');

        const homeId = teamIdByName.get(normalizeTeamName(row.home));
        const awayId = teamIdByName.get(normalizeTeamName(row.away));
        if (!homeId) {
          console.warn('missing home team when importing schedule', row.home, row);
          missingTeamNames.add(row.home);
        }
        if (!awayId) {
          console.warn('missing away team when importing schedule', row.away, row);
          missingTeamNames.add(row.away);
        }
        const normalizedHome = normalizeTeamName(row.home);
        const normalizedAway = normalizeTeamName(row.away);
        if (!homeId) missingTeamNames.add(row.home);
        if (!awayId) missingTeamNames.add(row.away);
        if (!homeId || !awayId) return;
        if (homeId && normalizedHomeDivision) {
          const existing = teamDivisionById.get(homeId) || '';
          if (!existing || existing !== normalizedHomeDivision) {
            teamDivisionUpdates.set(homeId, normalizedHomeDivision);
            teamDivisionById.set(homeId, normalizedHomeDivision);
          }
        }
        if (awayId && normalizedAwayDivision) {
          const existing = teamDivisionById.get(awayId) || '';
          if (!existing || existing !== normalizedAwayDivision) {
            teamDivisionUpdates.set(awayId, normalizedAwayDivision);
            teamDivisionById.set(awayId, normalizedAwayDivision);
          }
        }
        const locationParts = [row.facility, row.court, row.schedule]
          .map((part) => part.trim())
          .filter(Boolean);
        const location = locationParts.join(' / ');
        const normalizedStatus = (() => {
          const raw = row.status.toLowerCase();
          if (raw.includes('final')) return 'completed';
          if (raw.includes('complete')) return 'completed';
          if (raw.includes('cancel')) return 'canceled';
          if (raw.includes('not started')) return 'scheduled';
          return 'scheduled';
        })();
        const homeScore = parseNumber(row.homeScore);
        const awayScore = parseNumber(row.awayScore);
        const isPlayoff = /playoff/i.test(row.schedule || '');

        const rawTimeValue = row.time.trim();
        const iso = buildIso(dateIso, rawTimeValue);
        if (!iso) {
          console.warn('skip invalid schedule time', row.time, row);
          return;
        }
        payload.push({
          season_id: seasonIdForSchedule,
          game_datetime: iso,
          location: location || row.facility || row.court || row.schedule || 'TBD',
          home_team_id: homeId,
          away_team_id: awayId,
          status: normalizedStatus,
          home_score: homeScore ?? null,
          away_score: awayScore ?? null,
        });
      });

      if (!payload.length) {
        if (missingTeamNames.size) {
          const missing = Array.from(missingTeamNames);
          setScheduleCsvError(
            `No valid rows to import. Missing team${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`
          );
        } else {
          setScheduleCsvError('No valid rows to import. Check the CSV and team names.');
        }
        return;
      }

      const chunkSize = 200;
      let imported = 0;
      let resultMessage: string | null = null;

      if (scheduleCsvUpdateExistingDateTimeOnly) {
        const { data: existingRows, error: existingErr } = await supabase
          .from('games')
          .select('id,home_team_id,away_team_id,game_datetime')
          .eq('season_id', seasonIdForSchedule)
          .order('game_datetime', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true });
        if (existingErr) throw existingErr;

        const makeMatchKey = (homeId: string, awayId: string) => `${homeId}::${awayId}`;
        const existingByKey = new Map<string, Array<{ id: string; game_datetime: string | null }>>();
        (existingRows || []).forEach((row: any) => {
          const key = makeMatchKey(String(row.home_team_id || ''), String(row.away_team_id || ''));
          const list = existingByKey.get(key) || [];
          list.push({
            id: String(row.id || ''),
            game_datetime: row.game_datetime ? String(row.game_datetime) : null,
          });
          existingByKey.set(key, list);
        });

        const incomingByKey = new Map<string, Array<{ game_datetime: string }>>();
        payload.forEach((row) => {
          const key = makeMatchKey(String(row.home_team_id || ''), String(row.away_team_id || ''));
          const list = incomingByKey.get(key) || [];
          list.push({ game_datetime: String(row.game_datetime || '') });
          incomingByKey.set(key, list);
        });

        const updates: Array<{ id: string; game_datetime: string }> = [];
        let unmatchedRows = 0;

        incomingByKey.forEach((incomingList, key) => {
          const existingList = existingByKey.get(key) || [];
          incomingList.forEach((incoming, index) => {
            const existing = existingList[index];
            if (!existing?.id) {
              unmatchedRows += 1;
              return;
            }
            if ((existing.game_datetime || '') !== incoming.game_datetime) {
              updates.push({
                id: existing.id,
                game_datetime: incoming.game_datetime,
              });
            }
          });
        });

        if (!updates.length) {
          if (unmatchedRows > 0) {
            setScheduleCsvResultMessage(
              `No game date/time updated. ${unmatchedRows} CSV row(s) did not match an existing game (same home/away pair order).`
            );
          } else {
            setScheduleCsvResultMessage('No game date/time changes detected.');
          }
          setScheduleCsvImportedCount(0);
          return;
        }

        for (let i = 0; i < updates.length; i += chunkSize) {
          const chunk = updates.slice(i, i + chunkSize);
          const chunkResults = await Promise.all(
            chunk.map((row) =>
              supabase
                .from('games')
                .update({ game_datetime: row.game_datetime })
                .eq('id', row.id)
            )
          );
          const chunkErr = chunkResults.find((result) => result.error)?.error;
          if (chunkErr) throw chunkErr;
          imported += chunk.length;
        }

        resultMessage = (
          `Updated ${imported} existing game schedule(s) date/time.${unmatchedRows > 0 ? ` ${unmatchedRows} CSV row(s) had no matching game.` : ''}`
        );
      } else {
        for (let i = 0; i < payload.length; i += chunkSize) {
          const chunk = payload.slice(i, i + chunkSize);
          const { error: insertErr } = await supabase.from('games').insert(chunk);
          if (insertErr) throw insertErr;
          imported += chunk.length;
        }
      }

      resetScheduleCsvState();
      setScheduleCsvImportedCount(imported);
      setScheduleCsvResultMessage(resultMessage || `Imported ${imported} games.`);
      loadSchedule();
    } catch (err: any) {
      console.error('Schedule CSV import failed', err);
      setScheduleCsvError(err?.message || 'Import failed. Check the CSV and team names.');
    } finally {
      setScheduleCsvImporting(false);
    }
  };

  const loadSchedule = async () => {
    try {
      if (!selectedSeasonId) {
        setDivisionOptions(['all']);
        setSelectedDivision('all');
        setLoading(false);
        return;
      }
      setLoading(true);
      // Fetch teams
        const { data: teamRows, error: teamErr } = await supabase
          .from('teams')
          .select('id,name,logo_url,division,season_id')
          .eq('season_id', selectedSeasonId);
      if (teamErr) throw teamErr;
      const mappedTeams: Team[] =
        teamRows?.map((t: any) => ({
          id: t.id,
          name: t.name,
          logoUrl: t.logo_url || '',
          bannerUrl: '',
          division: t.division || 'D1',
          seasonId: t.season_id,
          wins: 0,
          losses: 0,
          ties: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        })) || [];
      const fallbackTeams = TEAMS.filter((t) => !selectedSeasonId || t.seasonId === selectedSeasonId);
      const finalTeams = mappedTeams.length ? mappedTeams : fallbackTeams;
      setTeams(finalTeams);

      const uniqDivs = Array.from(
        new Set(finalTeams.map((t) => normalizeDivisionFilterKey(t.division)).filter(Boolean))
      );
      const divOptions = ['all', ...uniqDivs];
      setDivisionOptions(divOptions);
      if (selectedDivision !== 'all' && uniqDivs.length && !uniqDivs.includes(selectedDivision)) {
        setSelectedDivision('all');
      }

      // Fetch games
      const { data: gameRows, error: gameErr } = await supabase
        .from('games')
        .select('*')
        .eq('season_id', selectedSeasonId);
      if (gameErr) throw gameErr;
      const mappedGames: Game[] =
        gameRows?.map((g: any) => {
          const dateTime = g.game_datetime || '';
          let dateVal = '';
          let timeVal = '';
          if (dateTime) {
            const parts = getScheduleDateTimeParts(dateTime);
            dateVal = parts.date;
            timeVal = parts.time;
          }
          dateVal = dateVal || g.date || g.start_date || '';
          timeVal = timeVal || g.time || g.start_time || '';
          const statusRaw = g.status || g.game_status || 'SCHEDULED';
          return {
            id: g.id,
            seasonId: g.season_id,
            date: dateVal,
            time: timeVal,
            location: g.location || '',
          homeTeamId: g.home_team_id,
          awayTeamId: g.away_team_id,
          homeScore: g.home_score ?? 0,
          awayScore: g.away_score ?? 0,
          status: normalizeGameStatus(statusRaw) as Game['status'],
          youtubeLink: g.youtube_url || g.youtube_link || g.youtube || '',
          isPlayoff: !!g.is_playoff,
         };
       }) || [];
      const teamMap = new Map<string, Team>();
      finalTeams.forEach((t) => teamMap.set(t.id, t));
      const filteredByDivision =
        selectedDivision === 'all'
          ? mappedGames
          : mappedGames.filter((g) => {
              const homeDiv = teamMap.get(g.homeTeamId)?.division;
              const awayDiv = teamMap.get(g.awayTeamId)?.division;
              return (
                normalizeDivisionFilterKey(homeDiv) === selectedDivision ||
                normalizeDivisionFilterKey(awayDiv) === selectedDivision
              );
            });
      filteredByDivision.sort((a, b) => {
        const toComparable = (d: string, t: string) =>
          getScheduleTimestamp(null, d || '1900-01-01', t || '00:00') || 0;
        return toComparable(b.date, b.time) - toComparable(a.date, a.time);
      });
      const fallbackGames = GAMES.filter((g) => {
        if (selectedSeasonId && g.seasonId !== selectedSeasonId) return false;
        if (selectedDivision === 'all') return true;
        const homeDiv = teamMap.get(g.homeTeamId)?.division;
        const awayDiv = teamMap.get(g.awayTeamId)?.division;
        return (
          normalizeDivisionFilterKey(homeDiv) === selectedDivision ||
          normalizeDivisionFilterKey(awayDiv) === selectedDivision
        );
      });
      setGames(filteredByDivision.length ? filteredByDivision : fallbackGames);
      setError(null);
    } catch (err) {
      console.error('Load schedule error', err);
      const fallbackTeams = TEAMS.filter((t) => !selectedSeasonId || t.seasonId === selectedSeasonId);
      const fallbackGames = GAMES.filter((g) => {
        if (selectedSeasonId && g.seasonId !== selectedSeasonId) return false;
        if (selectedDivision === 'all') return true;
        const homeDiv = fallbackTeams.find((t) => t.id === g.homeTeamId)?.division;
        const awayDiv = fallbackTeams.find((t) => t.id === g.awayTeamId)?.division;
        return (
          normalizeDivisionFilterKey(homeDiv) === selectedDivision ||
          normalizeDivisionFilterKey(awayDiv) === selectedDivision
        );
      });
      setTeams(fallbackTeams);
      setGames(fallbackGames);
      setError('Using mock schedule (Supabase error).');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await supabase.from('games').delete().eq('id', id);
      setGames((prev) => prev.filter((g) => g.id !== id));
      setPendingDelete(null);
    } catch (err) {
      console.error('Delete game error', err);
      setError('Failed to delete game.');
    }
  };

  useEffect(() => {
    const loadSeasons = async () => {
      try {
        const { data, error } = await supabase
          .from('seasons')
          .select('id,name,is_current,start_date')
          .order('start_date', { ascending: false });
        if (error) throw error;
        const mapped = (data || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          isActive: !!s.is_current,
        }));
        setSeasonOptions(mapped);
        if (!selectedSeasonId && mapped.length) {
          const ordered = sortSeasonsNewestFirst(mapped);
          const current = ordered.find((s) => s.isActive) || ordered[0];
          setSelectedSeasonId(current.id);
        }
      } catch (err) {
        console.error('Load seasons (schedule) error', err);
        setSeasonOptions([]);
      }
    };

    loadSeasons();
  }, []);

  const loadSeasonTeams = async () => {
    const seasonId = showImportsOnly ? importSeasonId : selectedSeasonId;
    if (!seasonId) {
      setTeams([]);
      return;
    }
    try {
      const { data: teamRows, error: teamErr } = await supabase
        .from('teams')
        .select('id,name,logo_url,division,season_id')
        .eq('season_id', seasonId);
      if (teamErr) throw teamErr;
      const mappedTeams: Team[] =
        teamRows?.map((t: any) => ({
          id: t.id,
          name: t.name,
          logoUrl: t.logo_url || '',
          bannerUrl: '',
          division: t.division || 'D1',
          seasonId: t.season_id,
        })) || [];
      setTeams(mappedTeams);
    } catch (err) {
      console.error('Load season teams error', err);
      setTeams([]);
    }
  };

  useEffect(() => {
    if (showImportsOnly) {
      loadSeasonTeams();
      return;
    }
    loadSchedule();
  }, [showImportsOnly, selectedSeasonId, selectedDivision, importSeasonId]);

  useEffect(() => {
    if (showImportsOnly) return;
    setPage(1);
  }, [showImportsOnly, selectedDivision, selectedSeasonId, selectedGameStatus, games.length]);

  if (!showImportsOnly && editingGame) {
     return (
       <BoxScoreEditor
         game={editingGame}
         teams={teams.length ? teams : TEAMS}
         onClose={() => setEditingGame(null)}
         onSaved={loadSchedule}
       />
     );
  }

  const selectedSeasonLabel =
    seasonOptions.find((s) => s.id === selectedSeasonId)?.name || 'Season';

  return (
    <div className="animate-fadeIn">
      {showImportsOnly && canSchedule && (
        <div className="bg-gradient-to-br from-brand-dark via-black/90 to-black border border-white/10 rounded-2xl p-5 mb-6 shadow-[0_24px_60px_rgba(0,0,0,0.45)] relative overflow-hidden">
          <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-brand-lime/10 blur-3xl" />
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between relative">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-brand-lime/15 border border-brand-lime/30 flex items-center justify-center text-brand-lime">
                <Upload size={18} />
              </div>
              <div>
                <h3 className="text-white font-sports uppercase text-lg tracking-wide">Import League Schedule (CSV)</h3>
                <p className="text-xs text-gray-400">
                  Upload rows that match our league schedule template.
                </p>
              </div>
            </div>
            <div className="text-xs text-gray-400 uppercase tracking-wide">
              Importing into <span className="text-white">{effectiveSeasonLabel}</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 lg:grid-cols-5 gap-4 relative">
            <div className="lg:col-span-3">
              <label className="block text-[11px] uppercase text-brand-grey font-bold mb-2 tracking-widest">CSV File</label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  ref={scheduleCsvInputRef}
                  id="schedule-csv-upload"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleScheduleCsvFile}
                  className="hidden"
                />
                <label
                  htmlFor="schedule-csv-upload"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/15 text-xs uppercase tracking-wide text-white hover:border-brand-lime/60 hover:text-brand-lime transition"
                >
                  <Upload size={14} /> Select CSV
                </label>
                <div className="flex-1 min-w-0 bg-black/70 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-400 truncate">
                  {scheduleCsvFileName || 'No file selected'}
                </div>
                <button
                  type="button"
                  onClick={resetScheduleCsvState}
                  disabled={!scheduleCsvRows.length && !scheduleCsvFileName}
                  className="px-4 py-2 rounded-lg border border-white/15 text-[11px] uppercase font-bold text-gray-300 hover:border-white/40 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
                <a
                  href="/templates/schedule-template.csv"
                  download
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/15 text-gray-300 hover:border-brand-lime/60 hover:text-brand-lime transition"
                >
                  View template CSV
                </a>
                <span className="text-gray-500">Don't change the CSV headers.</span>
                <details className="text-gray-400">
                  <summary className="cursor-pointer hover:text-white">Supported columns</summary>
                  <div className="mt-2 text-gray-500">
                    Date, Time, Home, Away, Status, Facility, Court, Schedule, Home Score, Away Score, Public Notes, Private Notes
                  </div>
                </details>
              </div>
            </div>

            <div className="lg:col-span-2 flex flex-col gap-3">
              <label className="inline-flex items-start gap-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={scheduleCsvUpdateExistingDateTimeOnly}
                  onChange={(e) => setScheduleCsvUpdateExistingDateTimeOnly(e.target.checked)}
                  className="mt-0.5 accent-brand-lime"
                />
                <span>
                  Update existing games only.
                </span>
              </label>
              <button
                type="button"
                onClick={handleScheduleCsvImport}
                disabled={!scheduleCsvRows.length || !effectiveImportSeasonId || scheduleCsvImporting}
                className="w-full bg-brand-lime text-black px-4 py-2.5 rounded-lg font-bold text-sm uppercase flex items-center justify-center gap-2 shadow-[0_10px_20px_rgba(209,255,28,0.18)] hover:bg-lime-300 disabled:opacity-60"
              >
                <Upload size={16} /> {scheduleCsvImporting ? 'Importing...' : scheduleCsvUpdateExistingDateTimeOnly ? 'Update Schedule Times' : 'Import Schedule'}
              </button>
            </div>
          </div>

          {scheduleCsvSummary && (
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-wide">
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                Total {scheduleCsvSummary.total}
              </span>
              <span className="px-3 py-1 rounded-full bg-brand-lime/15 border border-brand-lime/40 text-brand-lime">
                Ready {scheduleCsvSummary.ready}
              </span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                Missing Date {scheduleCsvSummary.missingDate}
              </span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                Missing Time {scheduleCsvSummary.missingTime}
              </span>
              <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                Missing Team {Math.max(scheduleCsvSummary.missingHome, scheduleCsvSummary.missingAway)}
              </span>
            </div>
          )}

          {scheduleCsvError && <div className="mt-2 text-xs text-brand-red font-mono">{scheduleCsvError}</div>}
          {scheduleCsvImportedCount !== null && !scheduleCsvResultMessage && (
            <div className="mt-2 text-xs text-brand-lime">Imported {scheduleCsvImportedCount} games.</div>
          )}
          {scheduleCsvResultMessage && (
            <div className="mt-2 text-xs text-brand-lime">{scheduleCsvResultMessage}</div>
          )}

          <div className="mt-4 text-[11px] text-gray-500">
            Rows that reference unknown teams are skipped; make sure the names match the league list.
          </div>
        </div>
      )}

        {showImportsOnly ? (
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
            <div>
              <h2 className="font-sports text-2xl text-white uppercase">Stats Imports</h2>
              <p className="text-xs text-gray-400">Upload legacy player stats per season.</p>
              {error && <span className="text-xs text-brand-red font-mono">{error}</span>}
            </div>
            {/* <div className="text-xs uppercase tracking-wide text-gray-400">
              Season: <span className="text-white">{effectiveSeasonLabel}</span>
            </div> */}
          </div>
        ) : (
          <div className="bg-gradient-to-br from-brand-dark via-black/90 to-black border border-white/10 rounded-3xl p-4 mb-6 shadow-[0_30px_60px_rgba(0,0,0,0.6)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-sports text-2xl text-white uppercase">League Schedule</h2>
                <p className="text-xs uppercase text-gray-400 tracking-wide mt-1">
                  Filter the list below to find the right games faster.
                </p>
              </div>
              {canSchedule && (
                <button
                  onClick={() => navigate('/admin/add-game')}
                  className="w-full sm:w-auto bg-brand-lime text-black px-4 py-2 rounded font-bold text-sm uppercase flex items-center justify-center gap-2"
                >
                  <Plus size={16} /> Add Game
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 mt-4 sm:grid-cols-2 md:grid-cols-3">
              <select
                value={selectedSeasonId || ''}
                onChange={(e) => setSelectedSeasonId(e.target.value)}
                className="w-full appearance-none bg-brand-dark border border-brand-lime/50 text-white text-sm font-sports uppercase tracking-wide px-4 pr-10 dropdown-select-spacing py-2 rounded-lg shadow-[0_0_0_1px_rgba(225,255,43,0.3)] focus:outline-none focus:border-brand-lime focus:shadow-[0_0_0_2px_rgba(225,255,43,0.5)]"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23e1ff2b' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 1.15rem center',
                  backgroundSize: '12px 8px',
                }}
              >
                <option value="" disabled>
                  Select Season
                </option>
                {sortSeasonsNewestFirst(seasonOptions).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                value={selectedDivision}
                onChange={(e) => setSelectedDivision(e.target.value)}
                disabled={!selectedSeasonId}
                className={`w-full appearance-none bg-brand-dark border border-white/20 text-white text-sm font-sports uppercase tracking-wide px-4 pr-10 dropdown-select-spacing py-2 rounded-lg shadow-[0_0_0_1px_rgba(255,255,255,0.08)] focus:outline-none focus:border-white/60 focus:shadow-[0_0_0_2px_rgba(255,255,255,0.15)] ${!selectedSeasonId ? 'opacity-60 cursor-not-allowed' : ''}`}
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 1.15rem center',
                  backgroundSize: '12px 8px',
                }}
              >
                {divisionOptions.map((d) => (
                  <option key={d} value={d}>
                    {d === 'all' ? 'All Divisions' : d}
                  </option>
                ))}
              </select>
              <select
                value={selectedGameStatus}
                onChange={(e) => setSelectedGameStatus(e.target.value)}
                disabled={!selectedSeasonId}
                className={`w-full appearance-none bg-brand-dark border border-white/20 text-white text-sm font-sports uppercase tracking-wide px-4 pr-10 dropdown-select-spacing py-2 rounded-lg shadow-[0_0_0_1px_rgba(255,255,255,0.08)] focus:outline-none focus:border-white/60 focus:shadow-[0_0_0_2px_rgba(255,255,255,0.15)] ${!selectedSeasonId ? 'opacity-60 cursor-not-allowed' : ''}`}
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 1.15rem center',
                  backgroundSize: '12px 8px',
                }}
              >
                {gameStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status === 'all' ? 'All Statuses' : formatGameStatusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

       {showImportsOnly && canScore && (
         <div className="bg-gradient-to-br from-brand-dark via-black/90 to-black border border-white/10 rounded-2xl p-5 mb-6 shadow-[0_24px_60px_rgba(0,0,0,0.45)] relative overflow-hidden">
           <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-brand-lime/10 blur-3xl" />
           <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between relative">
             <div className="flex items-start gap-3">
               <div className="w-11 h-11 rounded-xl bg-brand-lime/15 border border-brand-lime/30 flex items-center justify-center text-brand-lime">
                 <Upload size={18} />
               </div>
               <div>
                 <h3 className="text-white font-sports uppercase text-lg tracking-wide">Import Player Stats (Legacy CSV)</h3>
                 <p className="text-xs text-gray-400">
                   Match the existing CMS headers. Season selection above is used for import.
                 </p>
               </div>
             </div>
             <div className="flex flex-col sm:flex-row gap-3 sm:items-center w-full md:w-auto">
               <label
                 htmlFor="stats-game-type"
                 className="text-[11px] uppercase text-gray-400 tracking-wide flex items-center gap-2"
               >
                 Game Type
                 <span className="text-[10px] text-gray-500 normal-case">(select)</span>
               </label>
               <div className="relative">
                 <select
                   id="stats-game-type"
                   value={statsGameType}
                   onChange={(e) => setStatsGameType(e.target.value as 'regular' | 'playoffs' | 'exhibition')}
                   className="appearance-none bg-brand-dark border border-white/20 text-white px-4 pr-10 dropdown-select-spacing py-2 rounded-lg text-xs uppercase tracking-wide focus:outline-none focus:border-brand-lime hover:border-brand-lime/60 cursor-pointer"
                 >
                   <option value="regular">Regular Season</option>
                   <option value="playoffs">Playoffs</option>
                   <option value="exhibition">Exhibition</option>
                 </select>
                 <ChevronDown
                   size={14}
                   className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-brand-lime/80"
                 />
               </div>
             </div>
           </div>

           <div className="mt-5 grid grid-cols-1 lg:grid-cols-5 gap-4 relative">
             <div className="lg:col-span-3">
               <label className="block text-[11px] uppercase text-brand-grey font-bold mb-2 tracking-widest">CSV File</label>
               <div className="flex flex-col sm:flex-row gap-3">
                 <input
                   ref={statsCsvInputRef}
                   id="stats-csv-upload"
                   type="file"
                   accept=".csv,text/csv"
                   onChange={handleStatsCsvFile}
                   className="hidden"
                 />
                 <label
                   htmlFor="stats-csv-upload"
                   className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/15 text-xs uppercase tracking-wide text-white hover:border-brand-lime/60 hover:text-brand-lime transition"
                 >
                   <Upload size={14} /> Select CSV
                 </label>
                 <div className="flex-1 min-w-0 bg-black/70 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-400 truncate">
                   {statsCsvFileName || 'No file selected'}
                 </div>
                 <button
                   type="button"
                   onClick={resetStatsCsvState}
                   disabled={!statsCsvRows.length && !statsCsvFileName}
                   className="px-4 py-2 rounded-lg border border-white/15 text-[11px] uppercase font-bold text-gray-300 hover:border-white/40 disabled:opacity-50"
                 >
                   Clear
                 </button>
               </div>
               <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
                 <a
                   href="/templates/player-season-stats-template.csv"
                   download
                   className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/15 text-gray-300 hover:border-brand-lime/60 hover:text-brand-lime transition"
                 >
                   View template CSV
                 </a>
                 <span className="text-gray-500">Don't change the CSV headers.</span>
                 <details className="text-gray-400">
                   <summary className="cursor-pointer hover:text-white">Supported columns</summary>
                   <div className="mt-2 text-gray-500">
                     First Name, Last Name, Season, Division, Team, #, Status, Pos, GP, Pts, FGM, FGA, FG%, 3PM, 3PA,
                     3P%, Reb, Ast, Stl, Blk, Tov, FT%, FTA
                   </div>
                 </details>
               </div>
             </div>

             <div className="lg:col-span-2 flex flex-col gap-3">
               <label className="flex items-center gap-2 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300">
                 <input
                   type="checkbox"
                   checked={statsCsvCreateTeams}
                   onChange={(e) => setStatsCsvCreateTeams(e.target.checked)}
                   className="h-4 w-4 rounded border border-white/30 bg-black text-brand-lime"
                 />
                 Auto-create missing teams
               </label>
               <label className="flex items-center gap-2 bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300">
                 <input
                   type="checkbox"
                   checked={statsCsvReplaceExisting}
                   onChange={(e) => setStatsCsvReplaceExisting(e.target.checked)}
                   className="h-4 w-4 rounded border border-white/30 bg-black text-brand-lime"
                 />
                 Replace existing stats for this season & game type
               </label>
               <button
                 type="button"
                 onClick={handleStatsCsvImport}
                 disabled={!statsCsvRows.length || !effectiveImportSeasonId || statsCsvImporting}
                 className="w-full bg-brand-lime text-black px-4 py-2.5 rounded-lg font-bold text-sm uppercase flex items-center justify-center gap-2 shadow-[0_10px_20px_rgba(209,255,28,0.18)] hover:bg-lime-300 disabled:opacity-60"
               >
                 <Upload size={16} /> {statsCsvImporting ? 'Importing...' : 'Import Stats'}
               </button>
             </div>
           </div>

           {statsCsvSummary && (
             <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-wide">
               <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                 Total {statsCsvSummary.total}
               </span>
               <span className="px-3 py-1 rounded-full bg-brand-lime/15 border border-brand-lime/40 text-brand-lime">
                 Ready {statsCsvSummary.ready}
               </span>
               <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                 Missing Team {statsCsvSummary.missingTeam}
               </span>
               <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                 Missing Name {statsCsvSummary.missingName}
               </span>
               <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                 Missing Stats {statsCsvSummary.missingStats}
               </span>
               <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300">
                 Season Mismatch {statsCsvSummary.seasonMismatch}
               </span>
             </div>
           )}
           {statsCsvError && <div className="mt-2 text-xs text-brand-red font-mono">{statsCsvError}</div>}
           {statsCsvImportedCount !== null && (
             <div className="mt-2 text-xs text-brand-lime">Imported {statsCsvImportedCount} stat rows.</div>
                 )}

              </div>
            )}

       {!showImportsOnly && error && <div className="mb-4 text-xs text-brand-red font-mono">{error}</div>}
       {!showImportsOnly && loading && <div className="mb-4 text-xs text-gray-400">Loading schedule...</div>}

       {!showImportsOnly && !loading && !sortedGames.length && (
         <div className="bg-brand-dark border border-dashed border-white/10 text-center text-gray-400 py-12 rounded-xl">
           No games found for this season{selectedDivision !== 'all' ? ` (${selectedDivision})` : ''}
           {selectedGameStatus !== 'all' ? ` (${formatGameStatusLabel(selectedGameStatus)})` : ''}.
         </div>
       )}

       {!showImportsOnly && !!sortedGames.length && (
         <>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between text-xs text-gray-400 mb-2">
            <div>
              <span>
                Showing {pageGames.length} of {sortedGames.length} games • Page {page} of {totalPages}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Sort</span>
                <div className="relative">
                  <select
                    value={sortOption}
                    onChange={(e) => setSortOption(e.target.value as ScheduleSortOption)}
                    className="appearance-none bg-black border border-white/20 text-white text-[11px] uppercase tracking-wide px-3 pr-10 dropdown-select-spacing py-1.5 rounded-lg focus:outline-none focus:border-brand-lime transition cursor-pointer"
                  >
                    <option value="date_desc">Date (newest)</option>
                    <option value="date_asc">Date (oldest)</option>
                    <option value="team_name">Home team</option>
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                </div>
              </div>
              <div className="max-w-full overflow-x-auto -mx-1 px-1 pb-1">
                <div className="flex items-center gap-1 w-max">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 text-[11px] uppercase tracking-[0.3em] rounded-lg border border-white/10 hover:border-brand-lime disabled:opacity-50 transition"
                  >
                    Prev
                  </button>
                  {paginationPages.map((entry, idx) => {
                    if (entry === 'ellipsis') {
                      return (
                        <span
                          key={`ellipsis-${idx}`}
                          className="px-2 text-[11px] uppercase tracking-wider text-gray-500"
                        >
                          …
                        </span>
                      );
                    }
                    return (
                      <button
                        key={`page-btn-${entry}`}
                        onClick={() => setPage(entry)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-[0.3em] border border-white/10 transition ${
                          page === entry
                            ? 'bg-brand-lime text-black border-brand-lime'
                            : 'hover:border-brand-lime text-white'
                        }`}
                      >
                        {entry}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 text-[11px] uppercase tracking-[0.3em] rounded-lg border border-white/10 hover:border-brand-lime disabled:opacity-50 transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            {pageGames.map(game => {
            const rosterTeams = teams.length ? teams : TEAMS;
            const home = rosterTeams.find(t => t.id === game.homeTeamId);
            const away = rosterTeams.find(t => t.id === game.awayTeamId);
            const normalizedStatus = normalizeGameStatus(game.status);
            const isCompletedGame = normalizedStatus === 'COMPLETED';
            const isForfeitedGame = normalizedStatus === 'FORFEITED';
            const isCanceledGame = normalizedStatus === 'CANCELED';
            const winnerTeamId =
              game.homeScore > game.awayScore
                ? game.homeTeamId
                : game.awayScore > game.homeScore
                  ? game.awayTeamId
                  : '';
            const showWinnerCrown = isForfeitedGame && !!winnerTeamId;
            const homeIsWinner = showWinnerCrown && winnerTeamId === game.homeTeamId;
            const awayIsWinner = showWinnerCrown && winnerTeamId === game.awayTeamId;
                 
                 return (
                    <div
                      key={game.id}
                      className="bg-brand-dark border border-white/10 p-4 rounded-lg flex flex-col gap-4 hover:border-brand-lime/30 transition-colors md:flex-row md:items-center md:gap-6"
                    >
                      <div className="text-sm text-gray-400 font-mono text-center md:text-left md:w-32">
                        <div className="text-white font-bold">{game.date}</div>
                        <div>{formatDisplayTime(game.time)}</div>
                        <div className="flex items-center justify-center gap-1 text-xs mt-1 md:justify-start">
                          <MapPin size={10} /> {game.location}
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="w-full flex flex-col items-center gap-2 font-sports text-xl text-white md:flex-row md:justify-center md:gap-6 md:text-left">
                          <span className="flex-1 min-w-0 text-center md:text-right">
                            <span className="relative inline-block">
                              {homeIsWinner && (
                                <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                                  <Crown size={12} className="text-amber-300" />
                                </span>
                              )}
                              <span className="break-words">{home?.name}</span>
                            </span>
                          </span>
                          <span
                            className={`text-sm font-bold px-3 py-1 rounded ${
                              isCompletedGame
                                ? 'bg-white/10 text-brand-lime'
                                : isForfeitedGame
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : isCanceledGame
                                    ? 'bg-gray-600/30 text-gray-300'
                                    : 'bg-brand-red/20 text-brand-red'
                            }`}
                          >
                            {isCompletedGame
                              ? `${game.homeScore} - ${game.awayScore}`
                              : isForfeitedGame
                                ? 'FORFEITED'
                                : isCanceledGame
                                  ? 'CANCELED'
                                  : 'VS'}
                          </span>
                          <span className="flex-1 min-w-0 text-center md:text-left">
                            <span className="relative inline-block">
                              {awayIsWinner && (
                                <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                                  <Crown size={12} className="text-amber-300" />
                                </span>
                              )}
                              <span className="break-words">{away?.name}</span>
                            </span>
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-center gap-2 md:justify-end">
                          {canScore && (
                            <button
                              onClick={() => setEditingGame(game)}
                              className="bg-white/5 hover:bg-white/10 text-white px-3 py-2 rounded border border-white/10 text-xs flex items-center gap-2 font-bold uppercase"
                            >
                              <FileText size={14} /> Stats & Score
                            </button>
                          )}
                          {canSchedule && (
                            <button
                              onClick={() => setPendingDelete(game)}
                              className="bg-brand-red/10 hover:bg-brand-red text-brand-red hover:text-white p-2 rounded transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                       );
                      })}
          </div>
          <div className="mt-6 max-w-full overflow-x-auto -mx-1 px-1 pb-1">
            <div className="flex items-center justify-center gap-2 w-max mx-auto">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-[11px] uppercase tracking-[0.3em] rounded-lg border border-white/10 hover:border-brand-lime disabled:opacity-50 transition"
              >
                Prev
              </button>
              {paginationPages.map((entry, idx) => {
                if (entry === 'ellipsis') {
                  return (
                    <span
                      key={`bottom-ellipsis-${idx}`}
                      className="px-2 text-[11px] uppercase tracking-wider text-gray-500"
                    >
                      …
                    </span>
                  );
                }
                return (
                  <button
                    key={`bottom-page-btn-${entry}`}
                    onClick={() => setPage(entry)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-[0.3em] border border-white/10 transition ${
                      page === entry
                        ? 'bg-brand-lime text-black border-brand-lime'
                        : 'hover:border-brand-lime text-white'
                    }`}
                  >
                    {entry}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-[11px] uppercase tracking-[0.3em] rounded-lg border border-white/10 hover:border-brand-lime disabled:opacity-50 transition"
              >
                Next
              </button>
            </div>
          </div>

        </>
      )}

       {/* Delete confirmation modal */}
       {!showImportsOnly && pendingDelete && (
         <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
           <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fadeIn">
             <div className="flex items-start justify-between mb-4">
               <div>
                 <h4 className="text-white font-sports text-xl uppercase">Delete Game</h4>
                 <p className="text-gray-400 text-sm mt-1">This cannot be undone.</p>
               </div>
               <button onClick={() => setPendingDelete(null)} className="text-gray-500 hover:text-white">
                 <X size={18} />
               </button>
             </div>
             <div className="bg-black/40 border border-white/10 rounded-lg p-4 text-sm text-gray-300 space-y-2">
               <div>
                 <span className="text-white font-bold">{pendingDelete.date}</span> —{' '}
                 <span className="text-white font-bold">
                   {teams.find((t) => t.id === pendingDelete.homeTeamId)?.name || 'Home'}
                 </span>{' '}
                 vs{' '}
                 <span className="text-white font-bold">
                   {teams.find((t) => t.id === pendingDelete.awayTeamId)?.name || 'Away'}
                 </span>
               </div>
               <div className="text-xs text-gray-400 flex items-center gap-1">
                 <MapPin size={12} /> {pendingDelete.location || 'Unknown location'}
               </div>
             </div>
             <div className="flex justify-end gap-3 mt-6">
               <button
                 onClick={() => setPendingDelete(null)}
                 className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40"
               >
                 Cancel
               </button>
               <button
                 onClick={() => handleDelete(pendingDelete.id)}
                 className="px-4 py-2 rounded bg-brand-red text-white text-sm font-bold hover:bg-red-600"
               >
                 Delete
               </button>
             </div>
           </div>
         </div>
       )}
    </div>
  );
};

const ImportsManager: React.FC<{ userRole: Role }> = ({ userRole }) => {
  const [importSeasonId, setImportSeasonId] = useState<string | null>(null);
  const [importSeasons, setImportSeasons] = useState<SeasonView[]>([]);
  const importSeasonLabel =
    importSeasons.find((s) => s.id === importSeasonId)?.name || 'Season';

  return (
    <div className="animate-fadeIn space-y-8">
      <div>
        <h1 className="font-sports text-2xl text-white uppercase">Data Imports</h1>
        <p className="text-xs text-gray-400">
          Upload roster and legacy stats CSVs.
        </p>
      </div>
      <div className="space-y-8">
        <TeamsManager
          showImportsOnly
          importSeasonId={importSeasonId}
          onImportSeasonChange={setImportSeasonId}
          onTeamSeasonsChange={setImportSeasons}
        />
        <ScheduleManager
          userRole={userRole}
          showImportsOnly
          importSeasonId={importSeasonId}
          importSeasonLabel={importSeasonLabel}
        />
      </div>
    </div>
  );
};

// --- COMPONENT: TEAM TROPHIES ---
type TrophyOverrideMap = Record<
  string,
  {
    championTeamId?: string;
    bestOffenseTeamId?: string;
    bestDefenseTeamId?: string;
    niceGuysTeamId?: string;
  }
>;

type TeamOption = {
  id: string;
  name: string;
  seasonId?: string | null;
};

type TeamTrophyOverrideRow = {
  season_id: string;
  champion_team_id: string | null;
  best_offense_team_id: string | null;
  best_defense_team_id: string | null;
  nice_guys_team_id: string | null;
};

const TEAM_TROPHY_TABLE = 'team_trophy_overrides';

const finalGameStatuses = new Set(['COMPLETED', 'FINAL', 'FORFEITED']);

const computeTeamTrophyLeaders = (games: Game[]) => {
  const recordAgg: Record<
    string,
    { pf: number; pa: number; gp: number; wins: number; losses: number; ties: number }
  > = {};
  let totalFinalGames = 0;

  const addRecord = (teamId: string, pfVal: number, paVal: number) => {
    const rec = recordAgg[teamId] || { pf: 0, pa: 0, gp: 0, wins: 0, losses: 0, ties: 0 };
    rec.pf += pfVal;
    rec.pa += paVal;
    rec.gp += 1;
    if (pfVal > paVal) rec.wins += 1;
    else if (pfVal < paVal) rec.losses += 1;
    else rec.ties += 1;
    recordAgg[teamId] = rec;
  };

  games.forEach((g) => {
    if (!finalGameStatuses.has(g.status)) return;
    if (g.homeScore == null || g.awayScore == null) return;
    totalFinalGames += 1;
    addRecord(g.homeTeamId, g.homeScore, g.awayScore);
    addRecord(g.awayTeamId, g.awayScore, g.homeScore);
  });

  const entries = Object.entries(recordAgg).filter(([, rec]) => rec.gp > 0);
  if (!entries.length) {
    return {
      championTeamId: null,
      bestOffenseTeamId: null,
      bestDefenseTeamId: null,
      totalFinalGames,
    };
  }

  const pickChampion = () =>
    entries.reduce<string | null>((best, [teamId, rec]) => {
      if (!best) return teamId;
      const bestRec = recordAgg[best];
      const winPct = rec.wins / rec.gp;
      const bestWinPct = bestRec.wins / bestRec.gp;
      if (winPct !== bestWinPct) return winPct > bestWinPct ? teamId : best;
      if (rec.wins !== bestRec.wins) return rec.wins > bestRec.wins ? teamId : best;
      const diff = rec.pf - rec.pa;
      const bestDiff = bestRec.pf - bestRec.pa;
      if (diff !== bestDiff) return diff > bestDiff ? teamId : best;
      return rec.pf > bestRec.pf ? teamId : best;
    }, null);

  const pickBestOffense = () =>
    entries.reduce<string | null>((best, [teamId, rec]) => {
      if (!best) return teamId;
      const bestRec = recordAgg[best];
      const ppg = rec.pf / rec.gp;
      const bestPpg = bestRec.pf / bestRec.gp;
      if (ppg !== bestPpg) return ppg > bestPpg ? teamId : best;
      return rec.pf > bestRec.pf ? teamId : best;
    }, null);

  const pickBestDefense = () =>
    entries.reduce<string | null>((best, [teamId, rec]) => {
      if (!best) return teamId;
      const bestRec = recordAgg[best];
      const papg = rec.pa / rec.gp;
      const bestPapg = bestRec.pa / bestRec.gp;
      if (papg !== bestPapg) return papg < bestPapg ? teamId : best;
      return rec.pa < bestRec.pa ? teamId : best;
    }, null);

  return {
    championTeamId: pickChampion(),
    bestOffenseTeamId: pickBestOffense(),
    bestDefenseTeamId: pickBestDefense(),
    totalFinalGames,
  };
};

const TeamTrophiesManager = () => {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [overrides, setOverrides] = useState<TrophyOverrideMap>({});
  const [loading, setLoading] = useState(true);
  const [loadingGames, setLoadingGames] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const seasonTeams = useMemo(() => {
    if (!selectedSeasonId) return teams;
    const filtered = teams.filter((t) => t.seasonId === selectedSeasonId);
    return filtered.length ? filtered : teams;
  }, [teams, selectedSeasonId]);

  const autoWinners = useMemo(() => computeTeamTrophyLeaders(games), [games]);
  const seasonOverrides = selectedSeasonId ? overrides[selectedSeasonId] || {} : {};

  const resolveTeamName = (teamId: string | null | undefined) => {
    if (!teamId) return 'Unassigned';
    return teams.find((t) => t.id === teamId)?.name || 'Unknown team';
  };

  const persistSeasonOverrides = async (
    seasonId: string,
    seasonOverride: TrophyOverrideMap[string] | null
  ) => {
    if (!seasonId) return;
    setSaveState('saving');
    setSaveMessage(null);
    try {
      if (!seasonOverride || Object.keys(seasonOverride).length === 0) {
        const { error: deleteErr } = await supabase
          .from(TEAM_TROPHY_TABLE)
          .delete()
          .eq('season_id', seasonId);
        if (deleteErr) throw deleteErr;
        setSaveState('saved');
        setSaveMessage('Overrides cleared in database.');
        return;
      }
      const payload = {
        season_id: seasonId,
        champion_team_id: seasonOverride.championTeamId || null,
        best_offense_team_id: seasonOverride.bestOffenseTeamId || null,
        best_defense_team_id: seasonOverride.bestDefenseTeamId || null,
        nice_guys_team_id: seasonOverride.niceGuysTeamId || null,
        updated_at: new Date().toISOString(),
      };
      const { error: saveErr } = await supabase
        .from(TEAM_TROPHY_TABLE)
        .upsert(payload, { onConflict: 'season_id' });
      if (saveErr) throw saveErr;
      setSaveState('saved');
      setSaveMessage('Overrides saved in database.');
    } catch (err) {
      console.error('Save team trophies error', err);
      setSaveState('error');
      setSaveMessage('Failed to save overrides. Check Supabase permissions.');
    }
  };

  const updateOverrides = async (
    seasonId: string,
    key: keyof TrophyOverrideMap[string],
    value: string
  ) => {
    let nextSeasonOverride: TrophyOverrideMap[string] | null = null;
    setOverrides((prev) => {
      const next = { ...prev };
      const seasonOverride = { ...(next[seasonId] || {}) };
      if (value) seasonOverride[key] = value;
      else delete seasonOverride[key];
      if (Object.keys(seasonOverride).length) {
        next[seasonId] = seasonOverride;
        nextSeasonOverride = seasonOverride;
      } else {
        delete next[seasonId];
        nextSeasonOverride = null;
      }
      return next;
    });
    await persistSeasonOverrides(seasonId, nextSeasonOverride);
  };

  const clearSeasonOverrides = async (seasonId: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[seasonId];
      return next;
    });
    await persistSeasonOverrides(seasonId, null);
  };

  useEffect(() => {
    const loadBase = async () => {
      try {
        setLoading(true);
        setError(null);
        setSaveState('idle');
        setSaveMessage(null);

        const { data: seasonRows, error: seasonErr } = await supabase
          .from('seasons')
          .select('id,name,is_current,start_date')
          .order('start_date', { ascending: false });
        if (seasonErr) throw seasonErr;
        const mappedSeasons: Season[] = (seasonRows || []).map((s: any) => ({
          id: s.id,
          name: s.name || 'Season',
          isActive: !!s.is_current,
        }));
        setSeasons(mappedSeasons.length ? mappedSeasons : SEASONS);

        const { data: teamRows, error: teamErr } = await supabase
          .from('teams')
          .select('id,name,season_id')
          .order('name', { ascending: true });
        if (teamErr) throw teamErr;
        const mappedTeams: TeamOption[] = (teamRows || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          seasonId: t.season_id || null,
        }));
        setTeams(
          mappedTeams.length
            ? mappedTeams
            : TEAMS.map((t) => ({ id: t.id, name: t.name, seasonId: t.seasonId || null }))
        );

        if (!selectedSeasonId) {
          const current = mappedSeasons.find((s) => s.isActive) || mappedSeasons[0];
          if (current) setSelectedSeasonId(current.id);
        }
        try {
          const { data: overrideRows, error: overrideErr } = await supabase
            .from(TEAM_TROPHY_TABLE)
            .select(
              'season_id,champion_team_id,best_offense_team_id,best_defense_team_id,nice_guys_team_id'
            );
          if (overrideErr) throw overrideErr;
          const mappedOverrides: TrophyOverrideMap = {};
          (overrideRows as TeamTrophyOverrideRow[] | null | undefined)?.forEach((row) => {
            mappedOverrides[row.season_id] = {
              championTeamId: row.champion_team_id ?? undefined,
              bestOffenseTeamId: row.best_offense_team_id ?? undefined,
              bestDefenseTeamId: row.best_defense_team_id ?? undefined,
              niceGuysTeamId: row.nice_guys_team_id ?? undefined,
            };
          });
          setOverrides(mappedOverrides);
        } catch (overrideErr) {
          console.error('Load team trophies overrides error', overrideErr);
          setError(
            (prev) => prev || 'Unable to load trophy overrides from Supabase. Check team_trophy_overrides.'
          );
        }
      } catch (err) {
        console.error('Load team trophies base data error', err);
        setError('Unable to load seasons/teams from Supabase.');
        setSeasons(SEASONS);
        setTeams(TEAMS.map((t) => ({ id: t.id, name: t.name, seasonId: t.seasonId || null })));
      } finally {
        setLoading(false);
      }
    };

    loadBase();
  }, []);

  useEffect(() => {
    if (!selectedSeasonId) {
      setGames([]);
      return;
    }
    const loadGames = async () => {
      setLoadingGames(true);
      try {
        const { data, error: gameErr } = await supabase
          .from('games')
          .select(
            'id,season_id,home_team_id,away_team_id,home_score,away_score,status,game_datetime,location'
          )
          .eq('season_id', selectedSeasonId);
        if (gameErr) throw gameErr;
        const mappedGames: Game[] = (data || []).map((g: any) => {
          const scheduleParts = getScheduleDateTimeParts(g.game_datetime);
          return {
            id: g.id,
            seasonId: g.season_id || selectedSeasonId,
            date: scheduleParts.date || '',
            time: scheduleParts.time || '',
            location: g.location || '',
            homeTeamId: g.home_team_id,
            awayTeamId: g.away_team_id,
            homeScore: g.home_score ?? undefined,
            awayScore: g.away_score ?? undefined,
            status: (g.status || 'SCHEDULED').toString().toUpperCase(),
            youtubeLink: undefined,
            isPlayoff: false,
          };
        });
        setGames(mappedGames);
        setError(null);
      } catch (err) {
        console.error('Load games for trophies error', err);
        setError('Unable to load games from Supabase. Using mock data.');
        setGames(GAMES.filter((g) => g.seasonId === selectedSeasonId));
      } finally {
        setLoadingGames(false);
      }
    };

    loadGames();
  }, [selectedSeasonId]);

  useEffect(() => {
    setSaveState('idle');
    setSaveMessage(null);
  }, [selectedSeasonId]);

  const trophyRows = [
    {
      key: 'championTeamId' as const,
      label: 'Champion Trophy',
      description: 'Best win percentage in the season (auto).',
      autoId: autoWinners.championTeamId,
    },
    {
      key: 'bestOffenseTeamId' as const,
      label: 'Offensive Team of the Year',
      description: 'Highest points per game (auto).',
      autoId: autoWinners.bestOffenseTeamId,
    },
    {
      key: 'bestDefenseTeamId' as const,
      label: 'Defensive Team of the Year',
      description: 'Lowest points allowed per game (auto).',
      autoId: autoWinners.bestDefenseTeamId,
    },
    {
      key: 'niceGuysTeamId' as const,
      label: 'The Nice Guys Trophy',
      description: 'Admin-assigned sportsmanship award.',
      autoId: null,
    },
  ];

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading team trophy settings...</div>;
  }

  return (
    <div className="animate-fadeIn space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="font-sports text-2xl text-white uppercase">Team Trophies</h2>
          <p className="text-xs text-gray-400 mt-1">
            Auto winners come from completed games. Overrides are saved in Supabase for all users.
          </p>
          {error && <div className="text-xs text-brand-red font-mono mt-2">{error}</div>}
          {saveState === 'saving' && (
            <div className="text-xs text-gray-400 font-mono mt-2">Saving overrides...</div>
          )}
          {saveState === 'saved' && saveMessage && (
            <div className="text-xs text-brand-lime font-mono mt-2">{saveMessage}</div>
          )}
          {saveState === 'error' && saveMessage && (
            <div className="text-xs text-brand-red font-mono mt-2">{saveMessage}</div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            className="bg-black border border-white/20 rounded px-3 py-2 text-sm text-white focus:border-brand-lime outline-none"
            value={selectedSeasonId}
            onChange={(e) => setSelectedSeasonId(e.target.value)}
          >
            {sortSeasonsNewestFirst(seasons).map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => selectedSeasonId && clearSeasonOverrides(selectedSeasonId)}
            className="text-xs uppercase tracking-wider text-gray-300 border border-white/10 px-3 py-2 rounded hover:border-white/30"
          >
            Clear overrides
          </button>
        </div>
      </div>

      <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between text-xs text-brand-grey uppercase tracking-[0.2em]">
          <span>Season Results</span>
          <span>{loadingGames ? 'Loading games...' : `${autoWinners.totalFinalGames} final games`}</span>
        </div>
        {trophyRows.map((row) => {
          const overrideValue = seasonOverrides[row.key] || '';
          const autoName = row.autoId ? resolveTeamName(row.autoId) : 'Unassigned';
          const effectiveId = overrideValue || row.autoId || '';
          const effectiveName = effectiveId ? resolveTeamName(effectiveId) : 'Unassigned';
          return (
            <div
              key={row.key}
              className="bg-black/40 border border-white/10 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
            >
              <div>
                <div className="text-white font-bold text-sm uppercase">{row.label}</div>
                <div className="text-xs text-gray-400 mt-1">{row.description}</div>
                <div className="text-xs text-brand-grey mt-2">
                  Auto: <span className="text-white">{autoName}</span>
                </div>
                <div className="text-xs text-brand-grey mt-1">
                  Current: <span className="text-brand-lime">{effectiveName}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <select
                  className="bg-black border border-white/20 rounded px-3 py-2 text-sm text-white focus:border-brand-lime outline-none min-w-[200px]"
                  value={overrideValue}
                  onChange={(e) =>
                    selectedSeasonId && updateOverrides(selectedSeasonId, row.key, e.target.value)
                  }
                >
                  <option value="">{`Auto (${autoName})`}</option>
                  {seasonTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                {overrideValue && (
                  <button
                    onClick={() => selectedSeasonId && updateOverrides(selectedSeasonId, row.key, '')}
                    className="text-xs text-gray-300 hover:text-white"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    );
  };

const BADGE_TIERS: TrophyTierName[] = ['Bronze', 'Silver', 'Gold', 'Platinum'];
const BADGE_PREVIEW_FALLBACK_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="14" fill="#0b0f14"/><rect x="10" y="10" width="76" height="76" rx="12" fill="#111827" stroke="#2a3444"/><path d="M26 62l14-16 11 12 9-10 10 14H26z" fill="#3b475b"/><circle cx="38" cy="34" r="7" fill="#5b677a"/></svg>'
)}`;

const BadgeSettingsManager: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingTarget, setUploadingTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<BadgeSettings>(getDefaultBadgeSettings());

  const sanitizeFileToken = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'badge';

  const resolveFileExtension = (file: File) => {
    const fromName = (file.name.split('.').pop() || '').toLowerCase();
    if (fromName) return fromName;
    const mime = (file.type || '').toLowerCase();
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('svg')) return 'svg';
    return 'png';
  };

  const getBadgePreviewUrl = (fileName: string) =>
    supabase.storage.from('public-assets').getPublicUrl(`badges/${fileName}`).data.publicUrl;

  const handleBadgePreviewError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const target = event.currentTarget;
    if (target.dataset.fallbackApplied === '1') return;
    target.dataset.fallbackApplied = '1';
    target.src = BADGE_PREVIEW_FALLBACK_SRC;
  };

  const uploadBadgeFile = async (file: File, baseName: string) => {
    if (!file.type.startsWith('image/')) {
      throw new Error('Only image files are allowed.');
    }
    const extension = resolveFileExtension(file);
    const token = sanitizeFileToken(baseName);
    const filename = `${token}-${Date.now()}.${extension}`;
    const storagePath = `badges/${filename}`;
    const storageClient: any = supabaseAdmin ?? supabase;
    const { error: uploadError } = await storageClient.storage
      .from('public-assets')
      .upload(storagePath, file, {
        upsert: true,
        contentType: file.type || undefined,
      });
    if (uploadError) throw uploadError;
    return filename;
  };

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const fetchValue = async (client: typeof supabase) =>
          client
            .from('site_settings')
            .select('value')
            .eq('key', BADGE_SETTINGS_SITE_KEY)
            .maybeSingle();

        let data: any = null;
        let loadErr: any = null;
        try {
          const result = await fetchValue(supabase);
          data = result.data;
          loadErr = result.error;
        } catch (err) {
          loadErr = err;
        }

        if (loadErr && supabaseAdmin) {
          const fallback = await fetchValue(supabaseAdmin);
          data = fallback.data;
          loadErr = fallback.error;
        }

        if (loadErr) throw loadErr;
        setSettings(parseBadgeSettingsValue((data as any)?.value));
      } catch (err: any) {
        console.error('Load badge settings error', err);
        setError('Unable to load badge settings. Using defaults.');
        setSettings(getDefaultBadgeSettings());
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, []);

  const updateTeamRatingThreshold = (
    key: keyof BadgeSettings['teamRatingThresholds'],
    value: string
  ) => {
    setSettings((prev) => ({
      ...prev,
      teamRatingThresholds: {
        ...prev.teamRatingThresholds,
        [key]: Number(value),
      },
    }));
  };

  const updateTeamBadgeField = (
    key: string,
    field: 'label' | 'file',
    value: string
  ) => {
    setSettings((prev) => ({
      ...prev,
      teamBadges: prev.teamBadges.map((badge) =>
        badge.key === key ? { ...badge, [field]: value } : badge
      ),
    }));
  };

  const updatePlayerAwardField = (
    key: string,
    field: 'label' | 'file',
    value: string
  ) => {
    setSettings((prev) => ({
      ...prev,
      playerAwards: prev.playerAwards.map((award) =>
        award.key === key ? { ...award, [field]: value } : award
      ),
    }));
  };

  const updateMilestoneThreshold = (
    categoryKey: string,
    thresholdIndex: number,
    value: string
  ) => {
    setSettings((prev) => ({
      ...prev,
      playerMilestones: prev.playerMilestones.map((category) => {
        if (category.key !== categoryKey) return category;
        const nextThresholds = [...category.thresholds] as [number, number, number, number];
        nextThresholds[thresholdIndex] = Number(value);
        return { ...category, thresholds: nextThresholds };
      }),
    }));
  };

  const updateMilestoneBadgeFile = (
    categoryKey: string,
    tier: TrophyTierName,
    value: string
  ) => {
    setSettings((prev) => ({
      ...prev,
      playerMilestones: prev.playerMilestones.map((category) => {
        if (category.key !== categoryKey) return category;
        return {
          ...category,
          badgeFiles: {
            ...category.badgeFiles,
            [tier]: value,
          },
        };
      }),
    }));
  };

  const handleTeamBadgeUpload = async (badgeKey: string, file: File | null) => {
    if (!file) return;
    const target = `team-${badgeKey}`;
    setUploadingTarget(target);
    setError(null);
    setMessage(null);
    try {
      const uploadedFile = await uploadBadgeFile(file, `team-${badgeKey}`);
      updateTeamBadgeField(badgeKey, 'file', uploadedFile);
      setMessage('Team badge uploaded. Click Save settings to apply.');
    } catch (err: any) {
      console.error('Team badge upload error', err);
      setError(err?.message || 'Failed to upload team badge.');
    } finally {
      setUploadingTarget((prev) => (prev === target ? null : prev));
    }
  };

  const handlePlayerAwardUpload = async (awardKey: string, file: File | null) => {
    if (!file) return;
    const target = `award-${awardKey}`;
    setUploadingTarget(target);
    setError(null);
    setMessage(null);
    try {
      const uploadedFile = await uploadBadgeFile(file, `award-${awardKey}`);
      updatePlayerAwardField(awardKey, 'file', uploadedFile);
      setMessage('Player award badge uploaded. Click Save settings to apply.');
    } catch (err: any) {
      console.error('Award badge upload error', err);
      setError(err?.message || 'Failed to upload player award badge.');
    } finally {
      setUploadingTarget((prev) => (prev === target ? null : prev));
    }
  };

  const handleMilestoneBadgeUpload = async (
    categoryKey: string,
    tier: TrophyTierName,
    file: File | null
  ) => {
    if (!file) return;
    const tierToken = tier.toLowerCase();
    const target = `milestone-${categoryKey}-${tierToken}`;
    setUploadingTarget(target);
    setError(null);
    setMessage(null);
    try {
      const uploadedFile = await uploadBadgeFile(file, `${categoryKey}-${tierToken}`);
      updateMilestoneBadgeFile(categoryKey, tier, uploadedFile);
      setMessage('Milestone badge uploaded. Click Save settings to apply.');
    } catch (err: any) {
      console.error('Milestone badge upload error', err);
      setError(err?.message || 'Failed to upload milestone badge.');
    } finally {
      setUploadingTarget((prev) => (prev === target ? null : prev));
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    const normalized = normalizeBadgeSettings(settings);
    const payload = {
      key: BADGE_SETTINGS_SITE_KEY,
      value: serializeBadgeSettings(normalized),
      updated_at: new Date().toISOString(),
    };
    try {
      const persist = async (client: typeof supabase) =>
        client.from('site_settings').upsert(payload, { onConflict: 'key' });

      let saveErr: any = null;
      try {
        const { error } = await persist(supabase);
        saveErr = error;
      } catch (err) {
        saveErr = err;
      }

      if (saveErr && supabaseAdmin) {
        const { error } = await persist(supabaseAdmin);
        saveErr = error;
      }

      if (saveErr) throw saveErr;
      setSettings(normalized);
      setMessage('Badge settings saved.');
    } catch (err: any) {
      console.error('Save badge settings error', err);
      setError(err?.message || 'Failed to save badge settings.');
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    setSettings(getDefaultBadgeSettings());
    setMessage('Reset to defaults (not saved yet).');
    setError(null);
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading badge settings...</div>;
  }

  return (
    <div className="animate-fadeIn space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="font-sports text-2xl text-white uppercase">Badge Settings</h2>
          <p className="text-xs text-gray-400 mt-1">
            Edit player/team badge thresholds and upload badge images from one place.
          </p>
          {error && <div className="text-xs text-brand-red font-mono mt-2">{error}</div>}
          {message && <div className="text-xs text-brand-lime font-mono mt-2">{message}</div>}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={resetToDefaults}
            className="text-xs uppercase tracking-wider text-gray-300 border border-white/10 px-3 py-2 rounded hover:border-white/30"
          >
            Reset defaults
          </button>
          <button
            type="button"
            onClick={saveSettings}
            disabled={saving}
            className="bg-brand-lime text-black px-4 py-2 rounded font-bold uppercase text-xs disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        </div>
      </div>

      <div className="bg-brand-dark border border-white/10 rounded-2xl p-6">
        <h3 className="text-white font-sports uppercase text-lg mb-4">Team Rating Thresholds</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(
            [
              ['elite', 'Elite'],
              ['outstanding', 'Outstanding'],
              ['aboveAverage', 'Above Average'],
              ['average', 'Average'],
            ] as Array<[keyof BadgeSettings['teamRatingThresholds'], string]>
          ).map(([key, label]) => (
            <label key={key} className="text-xs text-brand-grey uppercase">
              {label}
              <input
                type="number"
                min={0}
                value={settings.teamRatingThresholds[key]}
                onChange={(e) => updateTeamRatingThreshold(key, e.target.value)}
                className="mt-1 w-full bg-black border border-white/20 rounded px-2 py-2 text-white text-sm focus:border-brand-lime outline-none"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="bg-brand-dark border border-white/10 rounded-2xl p-6">
        <h3 className="text-white font-sports uppercase text-lg mb-4">Team Badges</h3>
        <div className="space-y-3">
          {settings.teamBadges.map((badge) => (
            <div
              key={badge.key}
              className="grid grid-cols-1 md:grid-cols-[180px_1fr_340px] gap-3 items-center bg-black/30 border border-white/10 rounded-lg p-3"
            >
              <div className="text-xs text-brand-grey uppercase">{badge.key}</div>
              <input
                type="text"
                value={badge.label}
                onChange={(e) => updateTeamBadgeField(badge.key, 'label', e.target.value)}
                className="bg-black border border-white/20 rounded px-2 py-2 text-white text-sm focus:border-brand-lime outline-none"
                placeholder="Badge label"
              />
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-lg border border-white/10 bg-black/40 overflow-hidden shrink-0">
                  {badge.file ? (
                    <img
                      src={getBadgePreviewUrl(badge.file)}
                      alt={badge.label}
                      className="w-full h-full object-contain"
                      onError={handleBadgePreviewError}
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-gray-400 truncate">{badge.file || 'No file selected'}</div>
                  <label className="inline-flex mt-2 items-center justify-center bg-black border border-white/20 rounded px-3 py-2 text-xs text-white cursor-pointer hover:border-brand-lime/60">
                    {uploadingTarget === `team-${badge.key}` ? 'Uploading...' : 'Upload image'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={saving || uploadingTarget === `team-${badge.key}`}
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        e.currentTarget.value = '';
                        void handleTeamBadgeUpload(badge.key, file);
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-brand-dark border border-white/10 rounded-2xl p-6">
        <h3 className="text-white font-sports uppercase text-lg mb-4">Player Milestone Badges</h3>
        <div className="space-y-5">
          {settings.playerMilestones.map((category) => (
            <div key={category.key} className="bg-black/30 border border-white/10 rounded-lg p-4">
              <div className="text-white font-bold uppercase text-sm mb-3">{category.label}</div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {BADGE_TIERS.map((tier, index) => (
                  <div key={`${category.key}-${tier}`} className="space-y-2">
                    <div className="text-xs text-brand-grey uppercase">{tier}</div>
                    <input
                      type="number"
                      min={0}
                      value={category.thresholds[index]}
                      onChange={(e) => updateMilestoneThreshold(category.key, index, e.target.value)}
                      className="w-full bg-black border border-white/20 rounded px-2 py-2 text-white text-sm focus:border-brand-lime outline-none"
                      placeholder="Threshold"
                    />
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded border border-white/10 bg-black/40 overflow-hidden shrink-0">
                        {category.badgeFiles[tier] ? (
                          <img
                            src={getBadgePreviewUrl(category.badgeFiles[tier])}
                            alt={`${category.label} ${tier}`}
                            className="w-full h-full object-contain"
                            onError={handleBadgePreviewError}
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] text-gray-400 truncate">
                          {category.badgeFiles[tier] || 'No file selected'}
                        </div>
                        <label className="inline-flex mt-1 items-center justify-center bg-black border border-white/20 rounded px-2 py-1.5 text-[10px] text-white cursor-pointer hover:border-brand-lime/60">
                          {uploadingTarget === `milestone-${category.key}-${tier.toLowerCase()}` ? 'Uploading...' : 'Upload'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={saving || uploadingTarget === `milestone-${category.key}-${tier.toLowerCase()}`}
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              e.currentTarget.value = '';
                              void handleMilestoneBadgeUpload(category.key, tier, file);
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-brand-dark border border-white/10 rounded-2xl p-6">
        <h3 className="text-white font-sports uppercase text-lg mb-4">Player Award Badges</h3>
        <div className="space-y-3">
          {settings.playerAwards.map((award) => (
            <div
              key={award.key}
              className="grid grid-cols-1 md:grid-cols-[180px_1fr_340px] gap-3 items-center bg-black/30 border border-white/10 rounded-lg p-3"
            >
              <div className="text-xs text-brand-grey uppercase">{award.key}</div>
              <input
                type="text"
                value={award.label}
                onChange={(e) => updatePlayerAwardField(award.key, 'label', e.target.value)}
                className="bg-black border border-white/20 rounded px-2 py-2 text-white text-sm focus:border-brand-lime outline-none"
                placeholder="Award label"
              />
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-lg border border-white/10 bg-black/40 overflow-hidden shrink-0">
                  {award.file ? (
                    <img
                      src={getBadgePreviewUrl(award.file)}
                      alt={award.label}
                      className="w-full h-full object-contain"
                      onError={handleBadgePreviewError}
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-gray-400 truncate">{award.file || 'No file selected'}</div>
                  <label className="inline-flex mt-2 items-center justify-center bg-black border border-white/20 rounded px-3 py-2 text-xs text-white cursor-pointer hover:border-brand-lime/60">
                    {uploadingTarget === `award-${award.key}` ? 'Uploading...' : 'Upload image'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={saving || uploadingTarget === `award-${award.key}`}
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        e.currentTarget.value = '';
                        void handlePlayerAwardUpload(award.key, file);
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

type RegistrationTemplateMap = ReturnType<typeof getDefaultRegistrationEmailTemplates>;

const REGISTRATION_EMAIL_EDITOR_TAGS = new Set([
  'div',
  'span',
  'p',
  'br',
  'style',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'small',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'img',
  'hr',
]);

const hasRegistrationTemplateHtml = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value || '');

const escapeRegistrationTemplateHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeRegistrationTemplateBodyForEditor = (value: string) => {
  const trimmed = (value || '').trim();
  if (!trimmed) return '<p><br></p>';
  if (hasRegistrationTemplateHtml(trimmed)) return trimmed;
  return `<p>${escapeRegistrationTemplateHtml(trimmed).replace(/\r?\n/g, '<br>')}</p>`;
};

const shouldPreferHtmlModeForTemplate = (value: string) => {
  const body = (value || '').trim();
  if (!body) return false;
  // Full email templates (table/layout-heavy HTML) are easier and safer to edit in HTML mode.
  return /<(html|head|body|table|thead|tbody|tfoot|tr|td|th|img|style)\b/i.test(body);
};

const sanitizeRegistrationTemplateHtml = (value: string) => {
  if (typeof window === 'undefined') return value || '';
  const root = document.createElement('div');
  root.innerHTML = value || '';
  // Keep <style> tags because Canva/HTML email templates often rely on them for layout.
  root.querySelectorAll('script,iframe,object,embed').forEach((node) => node.remove());

  root.querySelectorAll('*').forEach((node) => {
    const tag = node.tagName.toLowerCase();
    if (!REGISTRATION_EMAIL_EDITOR_TAGS.has(tag)) {
      const parent = node.parentNode;
      if (parent) {
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
      }
      return;
    }

    Array.from(node.attributes).forEach((attr) => {
      const attrName = attr.name.toLowerCase();
      const attrValue = attr.value || '';
      if (attrName.startsWith('on')) {
        node.removeAttribute(attr.name);
        return;
      }
      if ((attrName === 'href' || attrName === 'src') && /^\s*javascript:/i.test(attrValue)) {
        node.removeAttribute(attr.name);
        return;
      }
      if (tag !== 'a' && (attrName === 'href' || attrName === 'target' || attrName === 'rel')) {
        node.removeAttribute(attr.name);
      }
    });

    if (tag === 'a') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  return root.innerHTML.trim();
};

const registrationTemplateHtmlToText = (value: string) => {
  if (!value) return '';
  if (!hasRegistrationTemplateHtml(value)) return value;
  if (typeof window !== 'undefined') {
    const root = document.createElement('div');
    root.innerHTML = value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h1|h2|h3|h4|li|blockquote)>/gi, '\n');
    return (root.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|h4|li|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// --- COMPONENT: REGISTRATION EMAIL TEMPLATES ---
const RegistrationEmailTemplatesManager: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [templates, setTemplates] = useState<RegistrationTemplateMap>(getDefaultRegistrationEmailTemplates());
  const [activeStage, setActiveStage] = useState<RegistrationEmailStage>('registration_paid_full');
  const [bodyMode, setBodyMode] = useState<'rich' | 'html'>('rich');
  const [previewMode, setPreviewMode] = useState<'rendered' | 'plain'>('rendered');
  const editorRefs = useRef<Partial<Record<RegistrationEmailStage, HTMLDivElement | null>>>({});
  const htmlBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyModeOverridesRef = useRef<Partial<Record<RegistrationEmailStage, 'rich' | 'html'>>>({});
  const selectionRangeRefs = useRef<Partial<Record<RegistrationEmailStage, Range | null>>>({});
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const [linkModalStage, setLinkModalStage] = useState<RegistrationEmailStage | null>(null);
  const [linkModalUrl, setLinkModalUrl] = useState('');
  const [linkModalError, setLinkModalError] = useState<string | null>(null);
  const [activeRegistrationVariant, setActiveRegistrationVariant] = useState<RegistrationEmailStage>('registration_paid_full');
  const [importingCanvaZip, setImportingCanvaZip] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const stageOrder = useMemo(
    () => Object.keys(REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS) as RegistrationEmailStage[],
    []
  );

  const isRegistrationVariantStage = useCallback(
    (stage: RegistrationEmailStage) => stage.startsWith('registration_'),
    []
  );

  useEffect(() => {
    if (isRegistrationVariantStage(activeStage)) {
      setActiveRegistrationVariant(activeStage);
    }
  }, [activeStage, isRegistrationVariantStage]);

  const previewData = {
    fullName: 'Jordan Smith',
    firstName: 'Jordan',
    lastName: 'Smith',
    email: 'jordan@example.com',
    phone: '(555) 123-4567',
    registrationType: 'Team Registration',
    teamName: 'Courtsight Legends',
    teamId: 'team_123',
    season: "Spring '26",
    seasonId: 'season_2026_spring',
    division: 'D2',
    paymentChoice: 'Deposit paid',
    portalLink: 'https://courtsightleague.com/portal/register?type=team',
    claimLink: 'https://courtsightleague.com/claim?token=preview-token',
  };

  const withEditorBodies = useCallback(
    (input: RegistrationTemplateMap): RegistrationTemplateMap => {
      const next = { ...input };
      stageOrder.forEach((stage) => {
        next[stage] = {
          ...next[stage],
          body: sanitizeRegistrationTemplateHtml(
            normalizeRegistrationTemplateBodyForEditor(next[stage].body || '')
          ),
        };
      });
      return next;
    },
    [stageOrder]
  );

  const syncEditor = useCallback(
    (stage: RegistrationEmailStage) => {
      const editor = editorRefs.current[stage];
      if (!editor) return;
      const body = sanitizeRegistrationTemplateHtml(
        normalizeRegistrationTemplateBodyForEditor(editor.innerHTML || '')
      );
      setTemplates((prev) => ({
        ...prev,
        [stage]: {
          ...prev[stage],
          body,
        },
      }));
    },
    []
  );

  const runEditorCommand = (
    stage: RegistrationEmailStage,
    command: string,
    value?: string
  ) => {
    const editor = editorRefs.current[stage];
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    syncEditor(stage);
  };

  const insertTokenAtCursor = (stage: RegistrationEmailStage, token: string) => {
    const payload = `{{${token}}}`;
    if (bodyMode === 'html') {
      const input = htmlBodyRef.current;
      const current = templates[stage].body || '';
      if (!input) {
        updateTemplate(stage, 'body', `${current}${payload}`);
        return;
      }
      const start = input.selectionStart ?? current.length;
      const end = input.selectionEnd ?? start;
      const nextValue = `${current.slice(0, start)}${payload}${current.slice(end)}`;
      updateTemplate(stage, 'body', nextValue);
      window.setTimeout(() => {
        input.focus();
        const cursor = start + payload.length;
        input.setSelectionRange(cursor, cursor);
      }, 0);
      return;
    }

    const editor = editorRefs.current[stage];
    if (!editor) return;
    editor.focus();
    document.execCommand('insertText', false, payload);
    syncEditor(stage);
  };

  const captureEditorSelection = (stage: RegistrationEmailStage) => {
    if (typeof window === 'undefined') return;
    const editor = editorRefs.current[stage];
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      selectionRangeRefs.current[stage] = null;
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      selectionRangeRefs.current[stage] = null;
      return;
    }
    selectionRangeRefs.current[stage] = range.cloneRange();
  };

  const openLinkModal = (stage: RegistrationEmailStage) => {
    captureEditorSelection(stage);
    setLinkModalStage(stage);
    setLinkModalUrl('');
    setLinkModalError(null);
  };

  const closeLinkModal = () => {
    setLinkModalStage(null);
    setLinkModalUrl('');
    setLinkModalError(null);
  };

  const applyLinkFromModal = () => {
    if (!linkModalStage) return;
    const stage = linkModalStage;
    const editor = editorRefs.current[stage];
    if (!editor) {
      closeLinkModal();
      return;
    }

    const raw = linkModalUrl.trim();
    if (!raw) {
      setLinkModalError('Please enter a URL.');
      return;
    }

    let href = raw;
    const hasProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw);
    const isTemplateToken = raw.includes('{{') && raw.includes('}}');
    if (!hasProtocol && !isTemplateToken && !raw.startsWith('/') && !raw.startsWith('#')) {
      href = `https://${raw}`;
    }

    editor.focus();
    const selection = window.getSelection();
    const savedRange = selectionRangeRefs.current[stage];
    if (selection && savedRange) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }

    document.execCommand('createLink', false, href);
    syncEditor(stage);
    closeLinkModal();
  };

  const loadTemplates = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const fetchSettings = async (client: typeof supabase) => {
        return client
          .from('site_settings')
          .select('key,value')
          .in('key', REGISTRATION_EMAIL_TEMPLATE_KEYS_FOR_LOAD);
      };

      let data: any[] | null = null;
      let err: any = null;

      const primary = await fetchSettings(supabase);
      data = primary.data || null;
      err = primary.error;

      if (err && supabaseAdmin) {
        const fallback = await fetchSettings(supabaseAdmin);
        data = fallback.data || null;
        err = fallback.error;
      }

      if (err) throw err;

      const next = getDefaultRegistrationEmailTemplates();
      const byKey = new Map<string, string>();
      (data || []).forEach((row: any) => {
        if (row?.key && typeof row?.value === 'string') {
          byKey.set(row.key, row.value);
        }
      });

      const legacyLeagueSubject = byKey.get('email_template_league_registration_subject');
      const legacyLeagueBody = byKey.get('email_template_league_registration_body');
      const legacyPaymentSubject = byKey.get('email_template_payment_subject');
      const legacyPaymentBody = byKey.get('email_template_payment_body');

      stageOrder.forEach((stage) => {
        const definition = REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS[stage];
        const customSubject = byKey.get(definition.subjectKey);
        const customBody = byKey.get(definition.bodyKey);

        const isRegistrationGroup = stage.startsWith('registration_');
        const fallbackSubject =
          isRegistrationGroup ? legacyPaymentSubject || legacyLeagueSubject : undefined;
        const fallbackBody = isRegistrationGroup ? legacyPaymentBody || legacyLeagueBody : undefined;

        const resolvedSubject =
          customSubject && customSubject.trim() ? customSubject : fallbackSubject;
        const resolvedBody = customBody && customBody.trim() ? customBody : fallbackBody;

        if (resolvedSubject && resolvedSubject.trim()) {
          next[stage].subject = resolvedSubject;
        }
        if (resolvedBody && resolvedBody.trim()) {
          next[stage].body = resolvedBody;
        }
      });

      setTemplates(withEditorBodies(next));
    } catch (err: any) {
      console.error('Load registration email templates error', err);
      const msg =
        err?.code === '42P01'
          ? 'Missing site_settings table. Create it to manage registration email templates.'
          : 'Unable to load registration email templates.';
      setError(msg);
      setTemplates(withEditorBodies(getDefaultRegistrationEmailTemplates()));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    const stage = activeStage;
    const body = templates[stage]?.body || '';
    const override = bodyModeOverridesRef.current[stage];
    setBodyMode(override || (shouldPreferHtmlModeForTemplate(body) ? 'html' : 'rich'));
  }, [activeStage, templates]);

  const setBodyModeForStage = (stage: RegistrationEmailStage, mode: 'rich' | 'html') => {
    bodyModeOverridesRef.current[stage] = mode;
    setBodyMode(mode);
  };

  useEffect(() => {
    if (bodyMode !== 'rich') return;
    const stage = activeStage;
    const editor = editorRefs.current[stage];
    if (!editor) return;
    if (document.activeElement === editor) return;
    const nextBody = sanitizeRegistrationTemplateHtml(
      normalizeRegistrationTemplateBodyForEditor(templates[stage].body || '')
    );
    if (editor.innerHTML !== nextBody) {
      editor.innerHTML = nextBody;
    }
  }, [activeStage, bodyMode, templates]);

  useEffect(() => {
    if (!linkModalStage) return;
    const id = window.setTimeout(() => {
      linkInputRef.current?.focus();
    }, 10);
    return () => window.clearTimeout(id);
  }, [linkModalStage]);

  const saveSetting = async (key: string, value: string | null) => {
    const payload = value
      ? { key, value, updated_at: new Date().toISOString() }
      : null;

    const run = async (client: typeof supabase) => {
      if (!payload) return client.from('site_settings').delete().eq('key', key);
      return client.from('site_settings').upsert(payload, { onConflict: 'key' });
    };

    let result = await run(supabase);
    if (result.error && supabaseAdmin) {
      result = await run(supabaseAdmin);
    }
    if (result.error) throw result.error;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const nextTemplates = { ...templates };
      for (const stage of stageOrder) {
        const definition = REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS[stage];
        const editor = editorRefs.current[stage];
        const rawBody = editor?.innerHTML ?? nextTemplates[stage].body;
        const bodyValue = sanitizeRegistrationTemplateHtml(
          normalizeRegistrationTemplateBodyForEditor(rawBody || '')
        ).trim();
        const subjectValue = nextTemplates[stage].subject.trim();
        nextTemplates[stage] = { ...nextTemplates[stage], body: bodyValue };

        await saveSetting(definition.subjectKey, subjectValue || null);
        await saveSetting(
          definition.bodyKey,
          registrationTemplateHtmlToText(bodyValue).trim() ? bodyValue : null
        );
      }
      setTemplates(nextTemplates);
      setMessage('Registration email templates saved.');
    } catch (err) {
      console.error('Save registration email templates error', err);
      setError('Failed to save registration email templates.');
    } finally {
      setSaving(false);
    }
  };

  const handleClearOverrides = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      for (const key of REGISTRATION_EMAIL_TEMPLATE_KEYS) {
        await saveSetting(key, null);
      }
      setTemplates(withEditorBodies(getDefaultRegistrationEmailTemplates()));
      setMessage('Template overrides cleared. Defaults restored.');
    } catch (err) {
      console.error('Clear registration email templates error', err);
      setError('Failed to clear template overrides.');
    } finally {
      setSaving(false);
    }
  };

  const updateTemplate = (
    stage: RegistrationEmailStage,
    field: 'subject' | 'body',
    value: string
  ) => {
    setTemplates((prev) => ({
      ...prev,
      [stage]: {
        ...prev[stage],
        [field]: value,
      },
    }));
  };

  const rewriteTemplateAssetUrls = (
    html: string,
    assets: Array<{ basename: string; publicUrl: string }>
  ) => {
    let output = html || '';
    assets.forEach(({ basename, publicUrl }) => {
      const safeName = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patterns = [
        new RegExp(`\\bimages\\/${safeName}\\b`, 'g'),
        new RegExp(`\\b\\.\\/images\\/${safeName}\\b`, 'g'),
        new RegExp(`\\b\\.\\.\\/images\\/${safeName}\\b`, 'g'),
      ];
      patterns.forEach((pattern) => {
        output = output.replace(pattern, publicUrl);
      });
    });
    return output;
  };

  const guessContentType = (filename: string) => {
    const lower = (filename || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
  };

  const handleImportCanvaZip = async (file: File) => {
    if (!file) return;
    setError(null);
    setMessage(null);
    setImportingCanvaZip(true);

    try {
      const bucket =
        (import.meta.env.VITE_EMAIL_TEMPLATE_ASSETS_BUCKET as string | undefined)?.trim() ||
        'public-assets';
      const importId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const zip = await JSZip.loadAsync(file);

      const htmlCandidates = Object.keys(zip.files)
        .filter((name) => name.toLowerCase().endsWith('.html') && !zip.files[name].dir)
        .sort((a, b) => a.length - b.length);
      const htmlPath =
        htmlCandidates.find((name) => /(^|\/)email\.html$/i.test(name)) ||
        htmlCandidates[0] ||
        null;

      const imagePaths = Object.keys(zip.files).filter((name) => {
        const lower = name.toLowerCase();
        if (zip.files[name].dir) return false;
        if (!/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return false;
        return lower.includes('/images/') || lower.startsWith('images/');
      });

      if (!htmlPath && imagePaths.length === 0) {
        throw new Error('ZIP did not contain an email HTML file or an images folder.');
      }

      const uploadedAssets: Array<{ basename: string; publicUrl: string }> = [];
      // Prefer service-role client to avoid storage RLS failures for admins.
      const storageClient = supabaseAdmin ?? supabase;
      for (const path of imagePaths) {
        const entry = zip.file(path);
        if (!entry) continue;

        const basename = path.split('/').pop() || path;
        const blob = await entry.async('blob');
        const storagePath = `email-templates/${activeStage}/${importId}/${basename}`;

        const { error: uploadErr } = await storageClient.storage.from(bucket).upload(storagePath, blob, {
          upsert: true,
          contentType: guessContentType(basename),
        });
        if (uploadErr) throw uploadErr;

        const { data } = storageClient.storage.from(bucket).getPublicUrl(storagePath);
        const publicUrl = data?.publicUrl || '';
        if (!publicUrl) throw new Error(`Unable to generate public URL for ${basename}.`);

        uploadedAssets.push({ basename, publicUrl });
      }

      const baseHtml = htmlPath
        ? await zip.file(htmlPath)!.async('string')
        : templates[activeStage].body || '';
      const nextHtml = rewriteTemplateAssetUrls(baseHtml, uploadedAssets);

      // Canva exports are full HTML templates; force HTML mode for this stage.
      bodyModeOverridesRef.current[activeStage] = 'html';
      setBodyMode('html');
      updateTemplate(activeStage, 'body', nextHtml);

      setMessage(
        `Imported Canva ZIP. Uploaded ${uploadedAssets.length} image(s) and updated the HTML for ${activeStage.replace(/_/g, ' ')}.`
      );
    } catch (err: any) {
      console.error('Canva ZIP import failed', err);
      const msg =
        err?.message ||
        'Canva ZIP import failed. Ensure the ZIP contains email.html and an images/ folder, and that your Supabase storage bucket is accessible.';
      setError(msg);
    } finally {
      setImportingCanvaZip(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="bg-brand-dark border border-white/10 rounded-2xl p-6">
        <div className="text-gray-400 text-sm">Loading registration email templates...</div>
      </div>
    );
  }

  const activeDefinition = REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS[activeStage];
  const activeTemplate = templates[activeStage];
  const previewSubject = renderRegistrationTemplateString(activeTemplate.subject, previewData);
  const previewBodyHtml = sanitizeRegistrationTemplateHtml(
    renderRegistrationTemplateString(activeTemplate.body, previewData)
  );
  const previewBodyText = registrationTemplateHtmlToText(previewBodyHtml);
  const toolbarBtn =
    'px-2.5 py-1.5 rounded border border-white/15 text-[11px] uppercase tracking-wide text-gray-300 hover:border-brand-lime/60 hover:text-brand-lime';

  return (
    <div className="animate-fadeIn bg-brand-dark border border-white/10 rounded-2xl p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h3 className="text-white font-sports text-2xl uppercase">Registration Email Templates</h3>
          <p className="text-xs text-gray-400">
            Dedicated controls for registration, stats portal, and claim-invite emails.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearOverrides}
            disabled={saving}
            className="text-xs uppercase text-gray-400 border border-white/10 px-3 py-2 rounded hover:border-white/30"
          >
            Reset to defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-brand-lime text-black font-bold text-xs uppercase px-4 py-2 rounded disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save templates'}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-brand-red font-mono">{error}</div>}
      {message && <div className="text-xs text-brand-lime font-mono">{message}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[280px,1fr] gap-4">
        <div className="bg-black/40 border border-white/10 rounded-xl p-4 space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-gray-500 mb-2">Template Type</div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setActiveStage(activeRegistrationVariant)}
                className={`w-full text-left border rounded-lg px-3 py-2 transition-colors ${
                  isRegistrationVariantStage(activeStage)
                    ? 'border-brand-lime/60 bg-brand-lime/10 text-brand-lime'
                    : 'border-white/10 bg-black/40 text-gray-300 hover:border-white/30 hover:text-white'
                }`}
              >
                <div className="text-sm font-bold">Registration &amp; Payment</div>
                <div className="text-[11px] opacity-80 mt-1 leading-snug">
                  Edit the confirmation email for Paid Fully, Deposit Paid, or Pay Later.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveStage('stats_portal_registration')}
                className={`w-full text-left border rounded-lg px-3 py-2 transition-colors ${
                  activeStage === 'stats_portal_registration'
                    ? 'border-brand-lime/60 bg-brand-lime/10 text-brand-lime'
                    : 'border-white/10 bg-black/40 text-gray-300 hover:border-white/30 hover:text-white'
                }`}
              >
                <div className="text-sm font-bold">
                  {REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.stats_portal_registration.label}
                </div>
                <div className="text-[11px] opacity-80 mt-1 leading-snug">
                  {REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.stats_portal_registration.description}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setActiveStage('claim_profile_invite')}
                className={`w-full text-left border rounded-lg px-3 py-2 transition-colors ${
                  activeStage === 'claim_profile_invite'
                    ? 'border-brand-lime/60 bg-brand-lime/10 text-brand-lime'
                    : 'border-white/10 bg-black/40 text-gray-300 hover:border-white/30 hover:text-white'
                }`}
              >
                <div className="text-sm font-bold">
                  {REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.claim_profile_invite.label}
                </div>
                <div className="text-[11px] opacity-80 mt-1 leading-snug">
                  {REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.claim_profile_invite.description}
                </div>
              </button>
            </div>
          </div>

          <div className="border-t border-white/10 pt-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-gray-500 mb-2">Tokens</div>
            <div className="flex flex-wrap gap-2">
              {REGISTRATION_EMAIL_TEMPLATE_TOKENS.map((token) => (
                <button
                  key={token}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertTokenAtCursor(activeStage, token);
                  }}
                  className="px-2 py-1 rounded border border-white/10 text-[11px] text-gray-300 hover:border-brand-lime/60 hover:text-brand-lime"
                >
                  {`{{${token}}}`}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-gray-500 mt-2">
              Click a token to insert it at the cursor in the email body.
            </div>
          </div>
        </div>

        <div className="bg-black/40 border border-white/10 rounded-xl p-4 space-y-3">
          <div className="space-y-3">
            <div>
              <h4 className="text-white font-bold text-base">
                {isRegistrationVariantStage(activeStage) ? 'Registration & Payment' : activeDefinition.label}
              </h4>
              <p className="text-xs text-gray-400">
                {isRegistrationVariantStage(activeStage)
                  ? 'Choose which registration/payment confirmation email you want to edit.'
                  : activeDefinition.description}
              </p>
            </div>

            {isRegistrationVariantStage(activeStage) && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-[11px] uppercase tracking-[0.25em] text-gray-500">
                  Template Variant
                </label>
                <select
                  value={activeStage}
                  onChange={(e) => setActiveStage(e.target.value as RegistrationEmailStage)}
                  className="bg-black border border-white/20 rounded px-3 py-2 text-white text-xs uppercase tracking-wide"
                >
                  <option value="registration_paid_full">Paid fully</option>
                  <option value="registration_deposit_paid">Deposit paid</option>
                  <option value="registration_pay_later">Pay later</option>
                </select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-[0.25em] text-gray-500">Subject</label>
            <input
              type="text"
              value={activeTemplate.subject}
              onChange={(e) => updateTemplate(activeStage, 'subject', e.target.value)}
              className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm"
              placeholder={activeDefinition.defaultSubject}
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-gray-500">Canva Import</div>
                <div className="text-sm text-gray-300 font-semibold mt-1">Upload Canva ZIP (HTML + images)</div>
                <div className="text-xs text-gray-400 mt-1">
                  Upload the ZIP you downloaded from Canva.
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <input
                ref={importInputRef}
                type="file"
                accept=".zip,application/zip"
                disabled={importingCanvaZip}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImportCanvaZip(f);
                }}
                className="block w-full text-xs text-gray-300 file:mr-4 file:rounded file:border-0 file:bg-brand-lime file:px-4 file:py-2 file:text-xs file:font-bold file:uppercase file:text-black hover:file:brightness-110 disabled:opacity-60"
              />
              <div className="text-[11px] text-gray-500 whitespace-nowrap">
                {importingCanvaZip ? 'IMPORTING...' : 'ZIP FILE'}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-[11px] uppercase tracking-[0.25em] text-gray-500">Body Editor</label>
              <div className="inline-flex items-center gap-1 rounded border border-white/10 p-1 bg-black/60">
                <button
                  type="button"
                  onClick={() => setBodyModeForStage(activeStage, 'rich')}
                  className={`px-2 py-1 rounded text-[11px] uppercase tracking-[0.1em] ${
                    bodyMode === 'rich'
                      ? 'bg-brand-lime/15 border border-brand-lime/60 text-brand-lime'
                      : 'text-gray-400 border border-transparent hover:text-white hover:border-white/20'
                  }`}
                >
                  Rich
                </button>
                <button
                  type="button"
                  onClick={() => setBodyModeForStage(activeStage, 'html')}
                  className={`px-2 py-1 rounded text-[11px] uppercase tracking-[0.1em] ${
                    bodyMode === 'html'
                      ? 'bg-brand-lime/15 border border-brand-lime/60 text-brand-lime'
                      : 'text-gray-400 border border-transparent hover:text-white hover:border-white/20'
                  }`}
                >
                  HTML
                </button>
              </div>
            </div>
            <div className="border border-white/20 rounded overflow-hidden bg-black">
              {bodyMode === 'rich' ? (
                <>
                  <div className="flex flex-wrap gap-2 p-2 border-b border-white/10 bg-black/60">
                    <button type="button" className={toolbarBtn} onMouseDown={(e) => { e.preventDefault(); runEditorCommand(activeStage, 'formatBlock', 'P'); }}>P</button>
                    <button type="button" className={toolbarBtn} onMouseDown={(e) => { e.preventDefault(); runEditorCommand(activeStage, 'formatBlock', 'H2'); }}>H2</button>
                    <button type="button" className={toolbarBtn} onMouseDown={(e) => { e.preventDefault(); runEditorCommand(activeStage, 'bold'); }}>Bold</button>
                    <button type="button" className={toolbarBtn} onMouseDown={(e) => { e.preventDefault(); runEditorCommand(activeStage, 'italic'); }}>Italic</button>
                    <button type="button" className={toolbarBtn} onMouseDown={(e) => { e.preventDefault(); runEditorCommand(activeStage, 'underline'); }}>Underline</button>
                    <button type="button" className={toolbarBtn} onMouseDown={(e) => { e.preventDefault(); runEditorCommand(activeStage, 'insertUnorderedList'); }}>Bullets</button>
                    <button type="button" className={toolbarBtn} onMouseDown={(e) => { e.preventDefault(); runEditorCommand(activeStage, 'insertOrderedList'); }}>Numbered</button>
                    <button
                      type="button"
                      className={toolbarBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        openLinkModal(activeStage);
                      }}
                    >
                      Link
                    </button>
                    <button
                      type="button"
                      className={toolbarBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        runEditorCommand(activeStage, 'removeFormat');
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div
                    ref={(node) => {
                      editorRefs.current[activeStage] = node;
                    }}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={() => syncEditor(activeStage)}
                    onBlur={() => syncEditor(activeStage)}
                    className="min-h-[220px] p-3 text-sm text-white leading-relaxed focus:outline-none [&_a]:text-brand-lime [&_a]:underline [&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 [&_h2]:text-base [&_h2]:font-bold [&_blockquote]:border-l-2 [&_blockquote]:border-brand-lime/40 [&_blockquote]:pl-3"
                  />
                </>
              ) : (
                <div className="p-2">
                  <textarea
                    ref={htmlBodyRef}
                    value={activeTemplate.body}
                    onChange={(e) => updateTemplate(activeStage, 'body', e.target.value)}
                    spellCheck={false}
                    className="w-full min-h-[260px] bg-black border border-white/10 rounded px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none focus:border-brand-lime/60"
                    placeholder="<p>Your HTML email body here...</p>"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="border border-white/10 rounded-lg bg-black/50 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.25em] text-gray-500">Preview</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewMode('rendered')}
                  className={`px-2 py-1 rounded border text-[11px] uppercase ${
                    previewMode === 'rendered'
                      ? 'border-brand-lime/60 text-brand-lime bg-brand-lime/10'
                      : 'border-white/10 text-gray-400 hover:border-white/30'
                  }`}
                >
                  Rendered
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('plain')}
                  className={`px-2 py-1 rounded border text-[11px] uppercase ${
                    previewMode === 'plain'
                      ? 'border-brand-lime/60 text-brand-lime bg-brand-lime/10'
                      : 'border-white/10 text-gray-400 hover:border-white/30'
                  }`}
                >
                  Plain
                </button>
              </div>
            </div>
            <div className="text-sm text-white font-semibold">{previewSubject || '(empty subject)'}</div>
            {previewMode === 'rendered' ? (
              <div
                className="text-sm text-gray-200 leading-relaxed space-y-2 [&_a]:text-brand-lime [&_a]:underline [&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5"
                dangerouslySetInnerHTML={{ __html: previewBodyHtml || '<p><em>(empty body)</em></p>' }}
              />
            ) : (
              <pre className="whitespace-pre-wrap text-xs text-gray-400">
                {previewBodyText || '(empty body)'}
              </pre>
            )}
          </div>
        </div>
      </div>
      {linkModalStage && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-brand-dark border border-white/10 rounded-2xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-white font-sports text-lg uppercase">Insert Link</h4>
              <button
                type="button"
                onClick={closeLinkModal}
                className="text-gray-500 hover:text-white"
                aria-label="Close link modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.25em] text-gray-500">URL</label>
              <input
                ref={linkInputRef}
                type="text"
                value={linkModalUrl}
                onChange={(e) => {
                  setLinkModalUrl(e.target.value);
                  if (linkModalError) setLinkModalError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyLinkFromModal();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeLinkModal();
                  }
                }}
                placeholder="https://example.com"
                className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm focus:border-brand-lime focus:outline-none"
              />
              <div className="text-[11px] text-gray-500">
                Supports `https://...`, `mailto:...`, `/path`, or {'{{portalLink}}'}.
              </div>
              {linkModalError && <div className="text-xs text-brand-red">{linkModalError}</div>}
            </div>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={closeLinkModal}
                className="px-3 py-2 rounded border border-white/10 text-gray-300 text-xs uppercase hover:border-white/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyLinkFromModal}
                className="px-4 py-2 rounded bg-brand-lime text-black font-bold text-xs uppercase"
              >
                Insert Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const STRIPE_PAYMENT_SETTINGS_TABLE = 'site_settings';
const STRIPE_PAYMENT_LINK_FIELD_DEFINITIONS: Array<{
  field: keyof StripePaymentLinks;
  settingKey: string;
  label: string;
  helper: string;
}> = [
  {
    field: 'teamFull',
    settingKey: STRIPE_PAYMENT_LINK_SETTING_KEYS.teamFull,
    label: 'Team full payment',
    helper: 'Used for team registrations selecting Full Payment.',
  },
  {
    field: 'teamDeposit',
    settingKey: STRIPE_PAYMENT_LINK_SETTING_KEYS.teamDeposit,
    label: 'Team deposit',
    helper: 'Used for team registrations selecting Deposit.',
  },
  {
    field: 'individualFull',
    settingKey: STRIPE_PAYMENT_LINK_SETTING_KEYS.individualFull,
    label: 'Free agent full payment',
    helper: 'Used for free-agent registrations selecting Full Payment.',
  },
  {
    field: 'individualDeposit',
    settingKey: STRIPE_PAYMENT_LINK_SETTING_KEYS.individualDeposit,
    label: 'Free agent deposit',
    helper: 'Used for free-agent registrations selecting Deposit.',
  },
];

const StripePaymentLinksManager: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [links, setLinks] = useState<StripePaymentLinks>(getDefaultStripePaymentLinks());
  const defaultLinks = useMemo(() => getDefaultStripePaymentLinks(), []);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const fetchSettings = async (client: typeof supabase) => {
        return client
          .from(STRIPE_PAYMENT_SETTINGS_TABLE)
          .select('key,value')
          .in('key', STRIPE_PAYMENT_LINK_KEYS_FOR_LOAD);
      };

      let data: any[] | null = null;
      let err: any = null;

      const primary = await fetchSettings(supabase);
      data = primary.data || null;
      err = primary.error;

      if (err && supabaseAdmin) {
        const fallback = await fetchSettings(supabaseAdmin);
        data = fallback.data || null;
        err = fallback.error;
      }

      if (err) throw err;

      const settings = new Map<string, string>();
      (data || []).forEach((row: any) => {
        if (row?.key && typeof row?.value === 'string') {
          settings.set(row.key, row.value);
        }
      });

      setLinks(resolveStripePaymentLinks(settings));
    } catch (err: any) {
      console.error('Load stripe payment links settings error', err);
      const msg =
        err?.code === '42P01'
          ? 'Missing site_settings table. Create it to manage Stripe payment links.'
          : 'Unable to load Stripe payment links.';
      setError(msg);
      setLinks(getDefaultStripePaymentLinks());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const saveSetting = async (key: string, value: string | null) => {
    const payload = value
      ? { key, value, updated_at: new Date().toISOString() }
      : null;

    const run = async (client: typeof supabase) => {
      if (!payload) return client.from(STRIPE_PAYMENT_SETTINGS_TABLE).delete().eq('key', key);
      return client.from(STRIPE_PAYMENT_SETTINGS_TABLE).upsert(payload, { onConflict: 'key' });
    };

    let result = await run(supabase);
    if (result.error && supabaseAdmin) {
      result = await run(supabaseAdmin);
    }
    if (result.error) throw result.error;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      for (const fieldDef of STRIPE_PAYMENT_LINK_FIELD_DEFINITIONS) {
        const nextValue = (links[fieldDef.field] || '').trim();
        await saveSetting(fieldDef.settingKey, nextValue || null);
      }
      setLinks((prev) => ({
        teamFull: prev.teamFull.trim(),
        teamDeposit: prev.teamDeposit.trim(),
        individualFull: prev.individualFull.trim(),
        individualDeposit: prev.individualDeposit.trim(),
      }));
      setMessage('Stripe payment links saved.');
    } catch (err) {
      console.error('Save stripe payment links settings error', err);
      setError('Failed to save Stripe payment links.');
    } finally {
      setSaving(false);
    }
  };

  const handleClearOverrides = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      for (const key of STRIPE_PAYMENT_LINK_KEYS_FOR_LOAD) {
        await saveSetting(key, null);
      }
      setLinks(getDefaultStripePaymentLinks());
      setMessage('Stripe payment link overrides cleared. Defaults restored.');
    } catch (err) {
      console.error('Clear stripe payment links settings error', err);
      setError('Failed to clear Stripe payment links.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-brand-dark border border-white/10 rounded-2xl p-6">
        <div className="text-gray-400 text-sm">Loading Stripe payment links...</div>
      </div>
    );
  }

  return (
    <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h3 className="text-white font-sports text-xl uppercase">Stripe Payment Links</h3>
          <p className="text-xs text-gray-400">
            Paste new Stripe checkout URLs here to update registration payment buttons.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearOverrides}
            disabled={saving}
            className="text-xs uppercase text-gray-400 border border-white/10 px-3 py-2 rounded hover:border-white/30"
          >
            Reset to defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-brand-lime text-black font-bold text-xs uppercase px-4 py-2 rounded disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save links'}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-brand-red font-mono">{error}</div>}
      {message && <div className="text-xs text-brand-lime font-mono">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {STRIPE_PAYMENT_LINK_FIELD_DEFINITIONS.map((fieldDef) => (
          <div key={fieldDef.field} className="bg-black/40 border border-white/10 rounded-xl p-4 space-y-2">
            <div className="text-xs uppercase tracking-wide text-brand-grey font-bold">{fieldDef.label}</div>
            <input
              type="url"
              value={links[fieldDef.field]}
              onChange={(e) =>
                setLinks((prev) => ({
                  ...prev,
                  [fieldDef.field]: e.target.value,
                }))
              }
              placeholder={defaultLinks[fieldDef.field]}
              className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm"
            />
            <div className="text-[11px] text-gray-500">{fieldDef.helper}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- COMPONENT: COUNTDOWN SETTINGS ---
const COUNTDOWN_SETTINGS_TABLE = 'site_settings';
const COUNTDOWN_SETTINGS_KEYS = {
  date: 'countdown_target_date',
  image: 'countdown_image_url',
  title: 'countdown_title',
  deadlineLabel: 'countdown_deadline_label',
};

const CountdownSettings: React.FC = () => {
  const countdownBucket = (import.meta.env.VITE_SUPABASE_COUNTDOWN_BUCKET as string) || 'site-media';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState('');
  const [deadlineLabelInput, setDeadlineLabelInput] = useState('');
  const [targetDateInput, setTargetDateInput] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  const toInputValue = (value?: string | null) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (num: number) => String(num).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}`;
  };

  const toIsoValue = (value: string) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  };

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const fetchSettings = async (client: typeof supabase) => {
        return client
          .from(COUNTDOWN_SETTINGS_TABLE)
          .select('key,value')
          .in('key', [
            COUNTDOWN_SETTINGS_KEYS.date,
            COUNTDOWN_SETTINGS_KEYS.image,
            COUNTDOWN_SETTINGS_KEYS.title,
            COUNTDOWN_SETTINGS_KEYS.deadlineLabel,
          ]);
      };

      let data: any[] | null = null;
      let err: any = null;
      const primary = await fetchSettings(supabase);
      data = primary.data || null;
      err = primary.error;

      if (err && supabaseAdmin) {
        const fallback = await fetchSettings(supabaseAdmin);
        data = fallback.data || null;
        err = fallback.error;
      }

      if (err) throw err;
      const settings = new Map<string, string>();
      (data || []).forEach((row: any) => {
        if (row?.key && row?.value) settings.set(row.key, row.value);
      });
      const storedDate = settings.get(COUNTDOWN_SETTINGS_KEYS.date) || '';
      const storedImage = settings.get(COUNTDOWN_SETTINGS_KEYS.image) || '';
      const storedTitle = settings.get(COUNTDOWN_SETTINGS_KEYS.title) || '';
      const storedDeadlineLabel = settings.get(COUNTDOWN_SETTINGS_KEYS.deadlineLabel) || '';
      setTitleInput(storedTitle);
      setDeadlineLabelInput(storedDeadlineLabel);
      setTargetDateInput(toInputValue(storedDate));
      setImageUrl(storedImage);
      setImagePreview(storedImage);
    } catch (err: any) {
      console.error('Load countdown settings error', err);
      const msg = err?.code === '42P01'
        ? 'Missing site_settings table. Create it to manage countdown settings.'
        : 'Unable to load countdown settings.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const saveSetting = async (key: string, value: string | null) => {
    const payload = value
      ? { key, value, updated_at: new Date().toISOString() }
      : null;

    const run = async (client: typeof supabase) => {
      if (!payload) {
        return client.from(COUNTDOWN_SETTINGS_TABLE).delete().eq('key', key);
      }
      return client.from(COUNTDOWN_SETTINGS_TABLE).upsert(payload, { onConflict: 'key' });
    };

    let res = await run(supabase);
    if (res.error && supabaseAdmin) {
      res = await run(supabaseAdmin);
    }
    if (res.error) throw res.error;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    const isoDate = targetDateInput ? toIsoValue(targetDateInput) : '';
    if (targetDateInput && !isoDate) {
      setSaving(false);
      setError('Please enter a valid date/time.');
      return;
    }
    try {
      await saveSetting(COUNTDOWN_SETTINGS_KEYS.date, isoDate || null);
      await saveSetting(COUNTDOWN_SETTINGS_KEYS.image, imageUrl.trim() || null);
      await saveSetting(COUNTDOWN_SETTINGS_KEYS.title, titleInput.trim() || null);
      await saveSetting(COUNTDOWN_SETTINGS_KEYS.deadlineLabel, deadlineLabelInput.trim() || null);
      setMessage('Countdown settings saved.');
    } catch (err: any) {
      console.error('Save countdown settings error', err);
      setError('Failed to save countdown settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveSetting(COUNTDOWN_SETTINGS_KEYS.date, null);
      await saveSetting(COUNTDOWN_SETTINGS_KEYS.image, null);
      await saveSetting(COUNTDOWN_SETTINGS_KEYS.title, null);
      await saveSetting(COUNTDOWN_SETTINGS_KEYS.deadlineLabel, null);
      setTitleInput('');
      setDeadlineLabelInput('');
      setTargetDateInput('');
      setImageUrl('');
      setImagePreview('');
      setMessage('Countdown overrides cleared.');
    } catch (err) {
      console.error('Clear countdown settings error', err);
      setError('Failed to clear countdown settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const uploadToBucket = async (client: typeof supabase) => {
        const path = `countdown/${Date.now()}-${file.name}`;
        const { data, error } = await client.storage
          .from(countdownBucket)
          .upload(path, file, { upsert: true });
        if (error) throw error;
        const publicData = client.storage.from(countdownBucket).getPublicUrl(data?.path || path);
        return publicData.data.publicUrl || '';
      };

      let publicUrl = '';
      try {
        publicUrl = await uploadToBucket(supabase);
      } catch (err) {
        if (supabaseAdmin) {
          publicUrl = await uploadToBucket(supabaseAdmin);
        } else {
          throw err;
        }
      }

      if (!publicUrl) {
        throw new Error('Upload succeeded but URL is missing.');
      }
      setImageUrl(publicUrl);
      setImagePreview(publicUrl);
      setMessage('Image uploaded. Remember to save changes.');
    } catch (err) {
      console.error('Countdown image upload error', err);
      setError(`Upload failed. Ensure the ${countdownBucket} bucket exists and is public.`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (loading) {
    return (
      <div className="bg-brand-dark border border-white/10 rounded-2xl p-6">
        <div className="text-gray-400 text-sm">Loading countdown settings...</div>
      </div>
    );
  }

  return (
    <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h3 className="text-white font-sports text-xl uppercase">Flash News Update</h3>
          <p className="text-xs text-gray-400">Controls the landing popup countdown (Ontario time).</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            disabled={saving}
            className="text-xs uppercase text-gray-400 border border-white/10 px-3 py-2 rounded hover:border-white/30"
          >
            Clear overrides
          </button>
          <button
            onClick={handleSave}
            disabled={saving || uploading}
            className="bg-brand-lime text-black font-bold text-xs uppercase px-4 py-2 rounded disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-brand-red font-mono">{error}</div>}
      {message && <div className="text-xs text-brand-lime font-mono">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-black/40 border border-white/10 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase text-brand-grey font-bold">
            Flash news title
          </div>
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="Next Season"
            className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm"
          />
          <div className="flex items-center gap-2 text-xs uppercase text-brand-grey font-bold">
            Deadline label
          </div>
          <input
            type="text"
            value={deadlineLabelInput}
            onChange={(e) => setDeadlineLabelInput(e.target.value)}
            placeholder="Registration deadline"
            className="w-full bg-black border border-white/20 rounded px-3 py-2 text-white text-sm"
          />
          <div className="flex items-center gap-2 text-xs uppercase text-brand-grey font-bold">
            <Calendar size={14} /> Countdown date/time
          </div>
          <div className="relative">
            <input
              ref={dateInputRef}
              type="datetime-local"
              value={targetDateInput}
              onChange={(e) => setTargetDateInput(e.target.value)}
              className="w-full bg-black border border-white/20 rounded px-3 py-2 pr-10 dropdown-select-spacing text-white text-sm"
            />
            <button
              type="button"
              onClick={() => {
                const el = dateInputRef.current;
                if (!el) return;
                const picker = (el as any).showPicker;
                if (typeof picker === 'function') picker.call(el);
                else el.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              aria-label="Open date/time picker"
            >
              <Calendar size={16} />
            </button>
          </div>
          <div className="text-[11px] text-gray-500">
            Title and deadline label show on the popup. Set the exact launch time. Popup appears only when a title, date, image, or label is saved. Leave date blank to use the next season start date.
          </div>
        </div>
        <div className="bg-black/40 border border-white/10 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase text-brand-grey font-bold mb-3">
            <ImageIcon size={14} /> Countdown image
          </div>
          <label className={`w-full mt-3 bg-black border border-dashed ${uploading ? 'border-gray-600 text-gray-500' : 'border-white/20 text-white'} rounded px-3 py-2 text-xs cursor-pointer hover:border-brand-lime/60 transition-colors`}>
            <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} disabled={uploading} />
            {uploading ? 'Uploading image...' : 'Upload image to storage'}
          </label>
          {imagePreview ? (
            <img src={imagePreview} alt="Countdown preview" className="w-full h-40 object-cover rounded-lg border border-white/10" />
          ) : (
            <div className="text-[11px] text-gray-500">No image selected yet.</div>
          )}
          {/* <div className="text-[11px] text-gray-500">Bucket: {countdownBucket}</div> */}
        </div>
      </div>
    </div>
  );
};

// --- COMPONENT: CONTENT MANAGER ---
type NewsAdminItem = NewsItem & {
  imagePath?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  publishedAt?: string | null;
};

const ContentManager = () => {
  const [news, setNews] = useState<NewsAdminItem[]>([]);
  const [archivedNews, setArchivedNews] = useState<NewsAdminItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newItem, setNewItem] = useState({ title: '', summary: '' });
  const [editingItem, setEditingItem] = useState<NewsAdminItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeNewsTable, setActiveNewsTable] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imagePath, setImagePath] = useState<string>('');
  const [imagePreview, setImagePreview] = useState<string>('');
  const [activeNewsBucket, setActiveNewsBucket] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NewsAdminItem | null>(null);

  const formatDisplayDate = (raw?: string | null) => {
    if (!raw) return 'TBD';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const archiveWindowDays = 30;
  const dayMs = 24 * 60 * 60 * 1000;

  const getArchiveDaysLeft = (archivedAt?: string | null) => {
    if (!archivedAt) return null;
    const archivedTime = new Date(archivedAt).getTime();
    if (Number.isNaN(archivedTime)) return null;
    const expiresAt = archivedTime + archiveWindowDays * dayMs;
    return Math.ceil((expiresAt - Date.now()) / dayMs);
  };

  const mapRowToNews = (row: any): NewsAdminItem => {
    const archivedAt =
      row.archived_at ||
      row.archivedAt ||
      (row.is_archived ? row.updated_at || row.created_at || row.published_at || row.date || null : null);
    return {
      id: row.id?.toString() || `news_${Date.now()}`,
      title: row.title || 'Untitled',
      summary: row.summary || row.content || '',
      imageUrl: row.image_url || row.imageUrl || 'https://via.placeholder.com/400',
      imagePath: row.image_url || null,
      date: formatDisplayDate(row.date || row.published_at || row.created_at || row.createdAt),
      archivedAt,
      createdAt: row.created_at || row.createdAt || null,
      publishedAt: row.published_at || row.publishedAt || null,
    };
  };

  const envNewsTable = (import.meta.env.VITE_SUPABASE_NEWS_TABLE as string) || '';
  const candidateTables = envNewsTable
    ? [envNewsTable, 'news']
    : ['news']; // keep short to avoid noisy 404s

  const envNewsBucket = (import.meta.env.VITE_SUPABASE_NEWS_BUCKET as string) || '';
  const candidateBuckets = [envNewsBucket || 'news-assets'];

  const normalizeStoragePath = (p?: string | null, bucket?: string) => {
    if (!p) return '';
    const bucketName = bucket || activeNewsBucket || candidateBuckets[0];
    const marker = `${bucketName}/`;
    if (p.includes(marker)) return p.slice(p.indexOf(marker) + marker.length);
    // handle public URL form
    const match = p.match(/\/object\/public\/[^/]+\/(.+)$/);
    if (match?.[1]) return match[1];
    return p;
  };

  const signImageUrl = async (path?: string | null) => {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    for (const bucket of candidateBuckets) {
      const cleanPath = normalizeStoragePath(path, bucket);
      try {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(cleanPath, 60 * 60 * 24 * 365);
        if (error) throw error;
        setActiveNewsBucket(bucket);
        return data?.signedUrl || path;
      } catch (err) {
        console.error('Sign news image error', err);
        continue;
      }
    }
    return path;
  };

  const loadNews = async () => {
    setLoading(true);
    setError(null);
    let lastError: string | null = null;

    for (const table of candidateTables) {
      try {
        const { data, error: err } = await supabase
          .from(table)
          .select('*')
          .order('published_at', { ascending: false, nulls: 'last' })
          .order('created_at', { ascending: false, nulls: 'last' });
        if (err) throw err;
        const mapped = await Promise.all(
          (data || []).map(async (row: any) => {
            const base = mapRowToNews(row);
            return { ...base, imageUrl: await signImageUrl(base.imageUrl) };
          })
        );
        const activeItems: NewsAdminItem[] = [];
        const archivedItems: NewsAdminItem[] = [];
        const expiredIds: string[] = [];

        mapped.forEach((item) => {
          if (item.archivedAt) {
            const daysLeft = getArchiveDaysLeft(item.archivedAt);
            if (daysLeft != null && daysLeft <= 0) {
              expiredIds.push(item.id);
              return;
            }
            archivedItems.push(item);
            return;
          }
          activeItems.push(item);
        });

        if (expiredIds.length) {
          try {
            await supabase.from(table).delete().in('id', expiredIds);
          } catch (deleteErr) {
            console.warn('Auto-delete archived news failed', deleteErr);
          }
        }

        setActiveNewsTable(table);
        setNews(activeItems);
        setArchivedNews(archivedItems);
        setLoading(false);
        return;
      } catch (err: any) {
        console.error('Load news error', err);
        lastError = `${table}: ${err?.message || err}`;
      }
    }

    // All attempts failed
    setActiveNewsTable(null);
    setNews([]);
    setArchivedNews([]);
    setError(
      `Unable to load news (Supabase error). Tried tables: ${candidateTables.join(', ')}${
        lastError ? ` | Last error: ${lastError}` : ''
      }`
    );
    setLoading(false);
  };

  useEffect(() => {
    loadNews();
  }, []);

  const resetForm = () => {
    setShowForm(false);
    setEditingItem(null);
    setNewItem({ title: '', summary: '' });
    setImagePath('');
    setImagePreview('');
  };

  const startNewForm = () => {
    setEditingItem(null);
    setNewItem({ title: '', summary: '' });
    setImagePath('');
    setImagePreview('');
    setShowForm(true);
  };

  const startEdit = (item: NewsAdminItem) => {
    setEditingItem(item);
    setNewItem({ title: item.title || '', summary: item.summary || '' });
    setImagePath(item.imagePath || '');
    setImagePreview(item.imageUrl || '');
    setShowForm(true);
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    try {
      setUploadingImage(true);
      setError(null);
      let uploaded = false;
      let lastErr: any = null;
      for (const bucket of candidateBuckets) {
        try {
          const path = `news/${Date.now()}-${file.name}`;
          const { data, error: uploadErr } = await supabase.storage
            .from(bucket)
            .upload(path, file, { upsert: true });
          if (uploadErr) throw uploadErr;
          const signed = await signImageUrl(data?.path || path);
          setImagePath(data?.path || path);
          setImagePreview(signed);
          setActiveNewsBucket(bucket);
          uploaded = true;
          break;
        } catch (err) {
          lastErr = err;
          continue;
        }
      }
      if (!uploaded) {
        throw lastErr || new Error('Upload failed');
      }
    } catch (err) {
      console.error('Upload news image error', err);
      setError(`Upload failed. Ensure a storage bucket exists (tried: ${candidateBuckets.join(', ')}).`);
    } finally {
      setUploadingImage(false);
      // reset input value so same file can be re-selected
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!newItem.title.trim()) return;
    if (!imagePath) {
      setError('Please upload a banner image before publishing.');
      return;
    }
    if (!activeNewsTable) {
      setError('Cannot add news because no Supabase news table was found.');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      if (editingItem) {
        const { error: err } = await supabase
          .from(activeNewsTable)
          .update({
            title: newItem.title.trim(),
            summary: newItem.summary.trim(),
            image_url: imagePath || null,
          })
          .eq('id', editingItem.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase
          .from(activeNewsTable)
          .insert({
            title: newItem.title.trim(),
            summary: newItem.summary.trim(),
            image_url: imagePath || null,
            published_at: new Date().toISOString(),
          });
        if (err) throw err;
      }
      resetForm();
      loadNews();
    } catch (err) {
      console.error('Save news error', err);
      setError('Failed to save news.');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (item: NewsAdminItem) => {
    if (!activeNewsTable) {
      setError('Cannot archive news because no Supabase news table was found.');
      return;
    }
    try {
      setError(null);
      const { error: err } = await supabase
        .from(activeNewsTable)
        .update({ archived_at: new Date().toISOString() })
        .eq('id', item.id);
      if (err) throw err;
      loadNews();
    } catch (err) {
      console.error('Archive news error', err);
      setError('Failed to archive news.');
    }
  };

  const handleRestore = async (item: NewsAdminItem) => {
    if (!activeNewsTable) {
      setError('Cannot restore news because no Supabase news table was found.');
      return;
    }
    try {
      setError(null);
      const { error: err } = await supabase
        .from(activeNewsTable)
        .update({ archived_at: null })
        .eq('id', item.id);
      if (err) throw err;
      loadNews();
    } catch (err) {
      console.error('Restore news error', err);
      setError('Failed to restore news.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!activeNewsTable) {
      setError('Cannot delete news because no Supabase news table was found.');
      return;
    }
    const previousNews = news;
    const previousArchived = archivedNews;
    setNews((prev) => prev.filter((n) => n.id !== id));
    setArchivedNews((prev) => prev.filter((n) => n.id !== id));
    try {
      const { error: err } = await supabase.from(activeNewsTable).delete().eq('id', id);
      if (err) throw err;
    } catch (err) {
      console.error('Delete news error', err);
      setError('Failed to delete news.');
      setNews(previousNews);
      setArchivedNews(previousArchived);
    }
  };

  return (
    <div className="animate-fadeIn space-y-10">
      <CountdownSettings />
      <div>
       <div className="flex justify-between items-center mb-6 gap-4">
          <div>
            <h2 className="font-sports text-2xl text-white uppercase">News & Content</h2>
            {error && <div className="text-xs text-brand-red font-mono mt-1">{error}</div>}
          </div>
          <button 
            onClick={() => {
              if (showForm && !editingItem) {
                setShowForm(false);
                return;
              }
              startNewForm();
            }} 
            disabled={saving}
            className="bg-brand-lime text-black px-4 py-2 rounded font-bold text-sm uppercase disabled:opacity-60"
          >
             {editingItem ? '+ New News' : showForm ? 'Close' : '+ Add News'}
          </button>
       </div>

       {showForm && (
          <div className="bg-brand-dark p-6 rounded-lg mb-8 border border-white/10 space-y-4">
             <div className="flex items-center justify-between">
               <div className="text-white font-bold">
                 {editingItem ? 'Edit News' : 'Add News'}
               </div>
               {editingItem && (
                 <button
                   type="button"
                   onClick={resetForm}
                   className="text-xs text-gray-400 hover:text-white"
                 >
                   Cancel Edit
                 </button>
               )}
             </div>
             <input 
               className="w-full bg-black border border-white/20 rounded p-3 text-white" 
               placeholder="Title" 
               value={newItem.title} 
               onChange={e => setNewItem({...newItem, title: e.target.value})} 
               disabled={saving}
             />
             <textarea 
               className="w-full bg-black border border-white/20 rounded p-3 text-white" 
               placeholder="Summary / Content" 
               rows={3} 
               value={newItem.summary} 
               onChange={e => setNewItem({...newItem, summary: e.target.value})} 
               disabled={saving}
             />
             <div className="space-y-2">
               <label className="text-xs uppercase text-brand-grey font-bold">Banner Image</label>
               <div className="flex items-center gap-3">
                 <label className={`flex-1 bg-black border border-dashed ${uploadingImage ? 'border-gray-600 text-gray-500' : 'border-white/20 text-white'} rounded p-3 cursor-pointer hover:border-brand-lime/60 transition-colors text-sm`}>
                   <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} disabled={uploadingImage || saving} />
                   {uploadingImage ? 'Uploading image...' : 'Click to upload image'}
                 </label>
                 {imagePreview && (
                   <img src={imagePreview} alt="Preview" className="w-16 h-16 object-cover rounded border border-white/10" />
                 )}
               </div>
               {!imagePath && !uploadingImage && (
                 <div className="text-xs text-gray-500">Required. Upload a banner image before publishing.</div>
               )}
               {imagePath && (
                 <div className="text-xs text-brand-grey break-all">Image uploaded: {imagePath}</div>
               )}
             </div>
             <button 
               onClick={handleSave} 
               disabled={saving || uploadingImage || !imagePath}
               className="bg-white text-black font-bold px-6 py-2 rounded uppercase text-sm disabled:opacity-60"
             >
              {saving ? 'Saving...' : editingItem ? 'Save Changes' : 'Publish'}
             </button>
          </div>
       )}

       {loading ? (
         <div className="text-gray-400 text-sm">Loading news...</div>
       ) : news.length === 0 ? (
         <div className="text-gray-400 text-sm">No news yet. Add your first update.</div>
       ) : (
         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {news.map(item => (
               <div key={item.id} className="bg-brand-dark border border-white/10 rounded-lg overflow-hidden group flex">
                  <div className="w-32 h-full relative flex-shrink-0">
                     <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                  </div>
                  <div className="p-4 flex-1">
                     <div className="text-brand-grey text-xs mb-1">{item.date}</div>
                     <h3 className="text-white font-bold text-sm mb-2">{item.title}</h3>
                     <p className="text-gray-500 text-xs line-clamp-2">{item.summary}</p>
                     <div className="mt-2 flex flex-wrap gap-3">
                        <button
                          onClick={() => startEdit(item)}
                          className="text-xs text-brand-lime hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleArchive(item)}
                          className="text-xs text-yellow-300 hover:text-yellow-200 hover:underline"
                        >
                          Archive
                        </button>
                        <button 
                          onClick={() => setPendingDelete(item)} 
                          className="text-xs text-brand-red hover:underline"
                        >
                          Delete
                        </button>
                     </div>
                  </div>
               </div>
          ))}
        </div>
       )}

       {!loading && (
         <div className="mt-10">
           <div className="flex items-center justify-between mb-4">
             <h3 className="text-white font-sports text-lg uppercase">Archived News</h3>
             <div className="text-xs text-gray-500">Auto-deletes after {archiveWindowDays} days</div>
           </div>
           {archivedNews.length === 0 ? (
             <div className="text-gray-500 text-sm">No archived news.</div>
           ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {archivedNews.map((item) => {
                 const daysLeft = getArchiveDaysLeft(item.archivedAt);
                 const daysLabel =
                   daysLeft == null
                     ? 'Unknown'
                     : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
                 return (
                   <div key={item.id} className="bg-black/40 border border-white/10 rounded-lg overflow-hidden flex">
                     <div className="w-28 h-full relative flex-shrink-0">
                       <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                     </div>
                     <div className="p-4 flex-1">
                       <div className="flex items-center justify-between text-xs text-brand-grey mb-1">
                         <span>Archived {formatDisplayDate(item.archivedAt)}</span>
                         <span
                           className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                             daysLeft != null && daysLeft <= 7
                               ? 'bg-brand-red/20 text-brand-red'
                               : 'bg-white/10 text-gray-200'
                           }`}
                         >
                           {daysLabel}
                         </span>
                       </div>
                       <h4 className="text-white font-bold text-sm mb-2">{item.title}</h4>
                       <p className="text-gray-500 text-xs line-clamp-2">{item.summary}</p>
                       <div className="mt-2 flex flex-wrap gap-3">
                         <button
                           onClick={() => handleRestore(item)}
                           className="text-xs text-brand-lime hover:underline"
                         >
                           Restore
                         </button>
                         <button
                           onClick={() => setPendingDelete(item)}
                           className="text-xs text-brand-red hover:underline"
                         >
                           Delete
                         </button>
                       </div>
                     </div>
                   </div>
                 );
               })}
             </div>
           )}
         </div>
       )}

       {pendingDelete && (
         <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
           <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
             <div className="flex items-start justify-between mb-4">
               <div>
                 <h4 className="text-white font-sports text-xl uppercase">Delete News</h4>
                 <p className="text-gray-400 text-sm mt-1">This cannot be undone.</p>
               </div>
               <button onClick={() => setPendingDelete(null)} className="text-gray-500 hover:text-white">
                 <X size={18} />
               </button>
             </div>
             <div className="bg-black/40 border border-white/10 rounded-lg p-4 text-sm text-gray-300 space-y-2">
               <div className="text-white font-bold">{pendingDelete.title}</div>
               <div className="text-gray-400 text-xs line-clamp-3">{pendingDelete.summary}</div>
             </div>
             <div className="flex justify-end gap-3 mt-6">
               <button
                 onClick={() => setPendingDelete(null)}
                 className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40"
               >
                 Cancel
               </button>
               <button
                 onClick={async () => {
                   await handleDelete(pendingDelete.id);
                   setPendingDelete(null);
                 }}
                 className="px-4 py-2 rounded bg-brand-red text-white text-sm font-bold hover:bg-red-600"
               >
                 Delete
               </button>
             </div>
           </div>
         </div>
       )}
      </div>
    </div>
  );
};

// --- COMPONENT: PHOTO MANAGER ---
const PhotoManager = () => {
    const [files, setFiles] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [selectedGameId, setSelectedGameId] = useState('');
    const [games, setGames] = useState<Game[]>([]);
    const [teamsList, setTeamsList] = useState<Team[]>(TEAMS);
    const [gamesError, setGamesError] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
    const photoBucket = (import.meta.env.VITE_SUPABASE_PHOTOS_BUCKET as string) || 'player-photos';

    useEffect(() => {
      const loadGames = async () => {
        try {
          setGamesError(null);
          const { data, error } = await supabase.from('games').select('*').order('game_datetime', { ascending: false });
          if (error) throw error;
          const mapped: Game[] = (data || []).map((g: any) => {
            const scheduleParts = getScheduleDateTimeParts(g.game_datetime);
            return {
              id: g.id,
              seasonId: g.season_id,
              date: scheduleParts.date || g.date || g.start_date || '',
              time: scheduleParts.time || g.time || g.start_time || '',
              location: g.location || '',
              homeTeamId: g.home_team_id,
              awayTeamId: g.away_team_id,
              homeScore: g.home_score ?? 0,
              awayScore: g.away_score ?? 0,
              status: (g.status || 'SCHEDULED').toString().toUpperCase(),
              youtubeLink: g.youtube_url || g.youtube_link || g.youtube || '',
              isPlayoff: !!g.is_playoff,
            };
          });
          setGames(mapped);
        } catch (err) {
          console.error('Load games for photos error', err);
          setGames(GAMES);
          setGamesError('Using mock games (Supabase error).');
        }
      };

      const loadTeams = async () => {
        try {
          const { data, error } = await supabase.from('teams').select('id,name');
          if (error) throw error;
          if (data && data.length) {
            setTeamsList(data.map((t: any) => ({ ...t, logoUrl: '', bannerUrl: '', division: '', seasonId: '', wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 } as Team)));
          }
        } catch (err) {
          console.error('Load teams for photos error', err);
          setTeamsList(TEAMS);
        }
      };

      loadTeams();
      loadGames();
    }, []);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setFiles(Array.from(e.target.files));
            setUploadError(null);
            setUploadSuccess(null);
        }
    };

    const handleUpload = async () => {
        if (files.length === 0) return;
        setUploading(true);
        setProgress(0);
        setUploadError(null);
        setUploadSuccess(null);

        let uploadedCount = 0;
        try {
          for (const file of files) {
            const path = `${selectedGameId || 'unassigned'}/${Date.now()}-${file.name}`;
            const { error } = await supabase.storage.from(photoBucket).upload(path, file, { upsert: true });
            if (error) throw error;
            uploadedCount += 1;
            setProgress(Math.round((uploadedCount / files.length) * 100));
          }
          setUploadSuccess(`Uploaded ${uploadedCount} file(s)${selectedGameId ? ` to game ${selectedGameId}` : ''}.`);
          setFiles([]);
        } catch (err: any) {
          console.error('Photo upload error', err);
          setUploadError(err?.message || 'Upload failed. Ensure bucket allows uploads.');
        } finally {
          setUploading(false);
        }
    };

    const renderGameLabel = (g: Game) => {
      const h = teamsList.find(t => t.id === g.homeTeamId)?.name || 'Home';
      const a = teamsList.find(t => t.id === g.awayTeamId)?.name || 'Away';
      const date = g.date || 'TBD';
      return `${date}: ${h} vs ${a}`;
    };

    return (
        <div className="animate-fadeIn py-12 px-4 bg-brand-dark border border-white/10 rounded-xl">
            <div className="max-w-2xl mx-auto">
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-brand-lime/10 text-brand-lime mb-4">
                        <ImageIcon className="w-10 h-10" />
                    </div>
                    <h3 className="text-white font-sports text-3xl font-bold uppercase mb-2">Photo Upload Center</h3>
                    <p className="text-gray-400 text-sm max-w-md mx-auto">
                       Upload high-resolution game photos. System handles batch processing for full season archiving.
                    </p>
                </div>

                <div className="space-y-6">
                    <div>
                        <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Assign to Game (Optional)</label>
                        <select 
                            value={selectedGameId} 
                            onChange={(e) => setSelectedGameId(e.target.value)} 
                            className="w-full bg-black border border-white/20 rounded-lg p-3 text-white focus:border-brand-lime focus:outline-none transition-colors"
                        >
                            <option value="">-- Select Game --</option>
                            {games.map(g => (
                              <option key={g.id} value={g.id}>{renderGameLabel(g)}</option>
                            ))}
                        </select>
                        {gamesError && <div className="text-xs text-brand-red mt-1">{gamesError}</div>}
                    </div>

                    <div className="border-2 border-dashed border-white/20 rounded-xl p-8 text-center bg-black/20 hover:border-brand-lime/50 transition-all">
                        <input 
                            type="file" 
                            id="photo-upload" 
                            multiple 
                            accept="image/*"
                            onChange={handleFileSelect} 
                            className="hidden" 
                            disabled={uploading}
                        />
                        <label htmlFor="photo-upload" className="cursor-pointer flex flex-col items-center justify-center h-full">
                            <Upload className={`w-12 h-12 mb-4 ${uploading ? 'text-gray-600' : 'text-brand-lime'}`} />
                            <span className="text-white font-bold text-lg mb-1">Click to Select Files</span>
                            <span className="text-xs text-gray-500">Supports JPG, PNG, RAW (Max 5GB per batch)</span>
                        </label>
                    </div>

                    {files.length > 0 && (
                        <div className="bg-black border border-white/10 rounded-lg p-4">
                            <div className="flex justify-between items-center mb-3">
                                <span className="text-white font-bold text-sm">{files.length} files selected</span>
                                {!uploading && (
                                    <button onClick={() => setFiles([])} className="text-brand-red text-xs hover:underline">Clear All</button>
                                )}
                            </div>
                            
                            {uploading && (
                                <div className="mb-4">
                                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                                        <span>Uploading...</span>
                                        <span>{progress}%</span>
                                    </div>
                                    <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                                        <div 
                                            className="bg-brand-lime h-full transition-all duration-200 ease-out" 
                                            style={{ width: `${progress}%` }}
                                        ></div>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-4 gap-2">
                                {files.slice(0, 4).map((file, idx) => (
                                    <div key={idx} className="aspect-square bg-gray-800 rounded overflow-hidden relative">
                                        <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs break-all p-1">
                                            {file.name}
                                        </div>
                                    </div>
                                ))}
                                {files.length > 4 && (
                                    <div className="aspect-square bg-gray-800 rounded flex items-center justify-center text-gray-400 text-xs font-bold">
                                        +{files.length - 4} more
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {uploadError && <div className="text-xs text-brand-red">{uploadError}</div>}
                    {uploadSuccess && <div className="text-xs text-brand-lime">{uploadSuccess}</div>}

                    <button 
                        onClick={handleUpload}
                        disabled={files.length === 0 || uploading}
                        className="w-full bg-brand-lime text-black font-bold font-sports text-xl py-4 rounded-lg uppercase tracking-wider hover:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {uploading ? 'Uploading Batch...' : 'Upload Photos'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- MAIN ADMIN DASHBOARD ---
const JerseyManagementManager: React.FC = () => {
  type SeasonOption = { id: string; name: string; year?: number | null; start_date?: string | null };
  type TeamRow = { id: string; name: string; division: string; season_id: string };
  type JerseyDeleteAction =
    | { mode: 'all'; team: TeamRow }
    | { mode: 'upload'; team: TeamRow; path: string }
    | { mode: 'mockup'; team: TeamRow };
  type PlayerRow = {
    id: string;
    team_id: string | null;
    season_id: string | null;
    first_name?: string | null;
    last_name?: string | null;
    is_guest?: boolean | null;
    jersey_name?: string | null;
    jersey_number?: number | null;
    jersey_size?: string | null;
    shorts_size?: string | null;
  };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [selectedDivision, setSelectedDivision] = useState('all');
  const [selectedTeamId, setSelectedTeamId] = useState('all');
  const [teamPage, setTeamPage] = useState(1);
  const [pendingDeleteAction, setPendingDeleteAction] = useState<JerseyDeleteAction | null>(null);
  const [workflows, setWorkflows] = useState<JerseyTeamWorkflow[]>([]);
  const [thumbByTeamSeason, setThumbByTeamSeason] = useState<Record<string, string>>({});
  const teamsPerPage = 8;

  const orderSeasonsForUi = (rows: SeasonOption[]) =>
    sortSeasonsNewestFirst(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        year: row.year,
      }))
    );
  const formatSeasonOptionLabel = (season: SeasonOption) => {
    const baseName = String(season.name || 'Season').trim();
    const yearText = season.year != null ? String(season.year).trim() : '';
    if (!yearText) return baseName;
    if (baseName.toLowerCase().includes(yearText.toLowerCase())) return baseName;
    return `${baseName} ${yearText}`.trim();
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [seasonResult, teamResult, playerResult, workflowSettings] = await Promise.all([
        supabase.from('seasons').select('id,name,year,start_date').order('start_date', { ascending: false }),
        supabase.from('teams').select('id,name,division,season_id').order('name', { ascending: true }),
        supabase
          .from('players')
          .select('id,team_id,season_id,first_name,last_name,is_guest,jersey_name,jersey_number,jersey_size,shorts_size'),
        loadJerseyManagementSettings(),
      ]);
      if (seasonResult.error) throw seasonResult.error;
      if (teamResult.error) throw teamResult.error;
      if (playerResult.error) throw playerResult.error;
      const seasonRows = (seasonResult.data || []) as SeasonOption[];
      const orderedSeasons = orderSeasonsForUi(seasonRows);
      setSeasons(orderedSeasons);
      setTeams((teamResult.data || []) as TeamRow[]);
      setPlayers((playerResult.data || []) as PlayerRow[]);
      setWorkflows(workflowSettings.teams || []);
      setSelectedSeasonId((prev) => prev || orderedSeasons[0]?.id || '');
    } catch (err: any) {
      console.error('Jersey management load error', err);
      setError(err?.message || 'Unable to load jersey management data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const seasonMap = useMemo(() => {
    const map = new Map<string, string>();
    seasons.forEach((s) => map.set(s.id, formatSeasonOptionLabel(s)));
    return map;
  }, [seasons]);

  const orderedSeasonOptions = useMemo(() => orderSeasonsForUi(seasons), [seasons]);

  const scopedTeams = useMemo(() => {
    return teams.filter((team) => {
      if (selectedSeasonId && team.season_id !== selectedSeasonId) return false;
      if (selectedDivision !== 'all' && (team.division || '').toLowerCase() !== selectedDivision.toLowerCase()) {
        return false;
      }
      return true;
    });
  }, [teams, selectedSeasonId, selectedDivision]);

  const filteredTeams = useMemo(() => {
    return scopedTeams.filter((team) => {
      if (selectedTeamId !== 'all' && team.id !== selectedTeamId) return false;
      return true;
    });
  }, [scopedTeams, selectedTeamId]);

  const totalTeamPages = Math.max(1, Math.ceil(filteredTeams.length / teamsPerPage));
  const paginatedTeams = useMemo(() => {
    const start = (teamPage - 1) * teamsPerPage;
    return filteredTeams.slice(start, start + teamsPerPage);
  }, [filteredTeams, teamPage]);

  const allDivisions = useMemo(() => {
    const source = teams.filter((team) => !selectedSeasonId || team.season_id === selectedSeasonId);
    return Array.from(new Set(source.map((team) => (team.division || '').trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [teams, selectedSeasonId]);

  const keyFor = (teamId: string, seasonId: string) => `${teamId}::${seasonId}`;
  const getTeamAssetBucketPath = (path: string) => {
    const raw = String(path || '').trim();
    if (!raw) return '';
    const cleanPath = raw.split('?')[0];
    const marker = 'team-assets/';
    const idx = cleanPath.indexOf(marker);
    return idx >= 0 ? cleanPath.slice(idx + marker.length) : cleanPath;
  };

  const workflowByKey = useMemo(() => {
    const map = new Map<string, JerseyTeamWorkflow>();
    workflows.forEach((row) => map.set(keyFor(row.teamId, row.seasonId), row));
    return map;
  }, [workflows]);

  const playersByTeamSeason = useMemo(() => {
    const map = new Map<string, PlayerRow[]>();
    players.forEach((p) => {
      if (!p.team_id || !p.season_id) return;
      const key = keyFor(p.team_id, p.season_id);
      const list = map.get(key) || [];
      list.push(p);
      map.set(key, list);
    });
    return map;
  }, [players]);

  const selectedTeam = selectedTeamId === 'all' ? null : scopedTeams.find((t) => t.id === selectedTeamId) || null;
  const selectedTeamPlayers = useMemo(() => {
    if (!selectedTeam) return [];
    return (playersByTeamSeason.get(keyFor(selectedTeam.id, selectedTeam.season_id)) || [])
      .filter((player) => {
        const byFlag = !!player.is_guest;
        const first = String(player.first_name || '').trim().toLowerCase();
        const byName = first.startsWith('guest');
        return !byFlag && !byName;
      })
      .sort((a, b) =>
      `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(`${b.last_name || ''} ${b.first_name || ''}`)
    );
  }, [playersByTeamSeason, selectedTeam]);

  useEffect(() => {
    setTeamPage(1);
  }, [selectedSeasonId, selectedDivision, selectedTeamId]);

  useEffect(() => {
    setTeamPage((prev) => Math.min(prev, totalTeamPages));
  }, [totalTeamPages]);

  const setWorkflow = async (team: TeamRow, patch: Partial<JerseyTeamWorkflow>) => {
    try {
      setSaving(true);
      const existing = workflowByKey.get(keyFor(team.id, team.season_id));
      const nextEntry = {
        teamId: team.id,
        seasonId: team.season_id,
        status: (patch.status || existing?.status || 'pending_review') as JerseyDesignStatus,
        uploadedDesignPaths: patch.uploadedDesignPaths || existing?.uploadedDesignPaths || [],
        approvedDesignPath:
          patch.approvedDesignPath !== undefined ? patch.approvedDesignPath : existing?.approvedDesignPath || null,
        finalMockupPath: patch.finalMockupPath !== undefined ? patch.finalMockupPath : existing?.finalMockupPath || null,
      };
      const settings = await loadJerseyManagementSettings();
      const updated = upsertTeamJerseyWorkflow(settings, nextEntry);
      await saveJerseyManagementSettings(updated);
      setWorkflows(updated.teams);
      setMessage('Jersey workflow updated.');
    } catch (err: any) {
      console.error('Jersey workflow save error', err);
      setError(err?.message || 'Unable to save jersey workflow.');
    } finally {
      setSaving(false);
    }
  };

  const handleMockupUpload = async (team: TeamRow, file?: File | null) => {
    if (!file) return;
    try {
      setSaving(true);
      const safeName = file.name.replace(/\s+/g, '-');
      const path = `teams/${team.id}/mockup-${Date.now()}-${safeName}`;
      const { error: uploadErr } = await supabase.storage.from('team-assets').upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      await setWorkflow(team, {
        finalMockupPath: path,
        status: 'mockup_approved',
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to upload mockup.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDesign = async (team: TeamRow) => {
    try {
      setSaving(true);
      setError(null);
      const wf = workflowByKey.get(keyFor(team.id, team.season_id));
      if (!wf) return;

      const pathsToDelete = Array.from(
        new Set(
          [wf.finalMockupPath, wf.approvedDesignPath, ...(wf.uploadedDesignPaths || [])]
            .map((value) => getTeamAssetBucketPath(String(value || '')))
            .filter(Boolean)
        )
      );

      if (pathsToDelete.length) {
        const { error: removeErr } = await supabase.storage.from('team-assets').remove(pathsToDelete);
        if (removeErr) {
          console.warn('team design delete storage warning', removeErr);
        }
      }

      await setWorkflow(team, {
        uploadedDesignPaths: [],
        approvedDesignPath: null,
        finalMockupPath: null,
        status: 'pending_review',
      });
      setThumbByTeamSeason((prev) => {
        const next = { ...prev };
        delete next[keyFor(team.id, team.season_id)];
        return next;
      });
      setMessage('Team design deleted.');
    } catch (err: any) {
      console.error('delete team design error', err);
      setError(err?.message || 'Unable to delete team design.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUploadedPath = async (team: TeamRow, path: string) => {
    try {
      setSaving(true);
      setError(null);
      const wf = workflowByKey.get(keyFor(team.id, team.season_id));
      if (!wf) return;

      const bucketPath = getTeamAssetBucketPath(path);
      if (bucketPath) {
        const { error: removeErr } = await supabase.storage.from('team-assets').remove([bucketPath]);
        if (removeErr) {
          console.warn('captain upload delete storage warning', removeErr);
        }
      }

      const remainingUploads = (wf.uploadedDesignPaths || []).filter((item) => item !== path);
      await setWorkflow(team, {
        uploadedDesignPaths: remainingUploads,
        approvedDesignPath: wf.approvedDesignPath === path ? null : wf.approvedDesignPath || null,
        finalMockupPath: wf.finalMockupPath === path ? null : wf.finalMockupPath || null,
        status:
          wf.finalMockupPath === path
            ? 'pending_review'
            : wf.approvedDesignPath === path
            ? 'pending_review'
            : (wf.status || 'pending_review'),
      });
      setMessage('Uploaded design removed.');
    } catch (err: any) {
      console.error('delete uploaded design error', err);
      setError(err?.message || 'Unable to remove uploaded design.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMockup = async (team: TeamRow) => {
    try {
      setSaving(true);
      setError(null);
      const wf = workflowByKey.get(keyFor(team.id, team.season_id));
      if (!wf?.finalMockupPath) return;

      const bucketPath = getTeamAssetBucketPath(wf.finalMockupPath);
      if (bucketPath) {
        const { error: removeErr } = await supabase.storage.from('team-assets').remove([bucketPath]);
        if (removeErr) {
          console.warn('mockup delete storage warning', removeErr);
        }
      }

      await setWorkflow(team, {
        uploadedDesignPaths: wf.uploadedDesignPaths || [],
        approvedDesignPath: wf.approvedDesignPath || null,
        finalMockupPath: null,
        status: wf.approvedDesignPath ? 'approved_pending_mockup' : 'pending_review',
      });
      setThumbByTeamSeason((prev) => {
        const next = { ...prev };
        delete next[keyFor(team.id, team.season_id)];
        return next;
      });
      setMessage('Mockup deleted.');
    } catch (err: any) {
      console.error('delete mockup error', err);
      setError(err?.message || 'Unable to delete mockup.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    let active = true;
    const loadThumbs = async () => {
      const next: Record<string, string> = {};
      for (const team of paginatedTeams) {
        const wf = workflowByKey.get(keyFor(team.id, team.season_id));
        const path = wf?.finalMockupPath || wf?.approvedDesignPath || '';
        if (!path) continue;
        try {
          const { data } = await supabase.storage.from('team-assets').createSignedUrl(path, 60 * 60);
          if (data?.signedUrl) next[keyFor(team.id, team.season_id)] = data.signedUrl;
        } catch {
          // ignore per-item errors
        }
      }
      if (active) setThumbByTeamSeason(next);
    };
    loadThumbs();
    return () => {
      active = false;
    };
  }, [paginatedTeams, workflowByKey]);

  const saveAllSelectedTeamPlayers = async () => {
    if (!selectedTeam) return;
    try {
      setSaving(true);
      setError(null);

      const seen = new Set<string>();
      for (const player of selectedTeamPlayers) {
        const normalizedNumber = normalizeJerseyNumberInput(player.jersey_number);
        if (normalizedNumber === null) {
          setError(`Jersey number is required for ${`${player.first_name || ''} ${player.last_name || ''}`.trim() || 'this player'}.`);
          return;
        }
        if (seen.has(normalizedNumber)) {
          setError(`Jersey #${normalizedNumber} is duplicated in this roster. Please fix conflicts first.`);
          return;
        }
        seen.add(normalizedNumber);
      }

      for (const player of selectedTeamPlayers) {
        const normalizedNumber = normalizeJerseyNumberInput(player.jersey_number);
        const payload: any = {
          jersey_name: (player.jersey_name || '').trim() || null,
          jersey_number: normalizedNumber,
          jersey_size: (player.jersey_size || '').trim() || null,
          shorts_size: (player.shorts_size || '').trim() || null,
        };
        const { error: updateErr } = await supabase.from('players').update(payload).eq('id', player.id);
        if (updateErr) throw updateErr;
      }
      setMessage(`Saved jersey details for ${selectedTeamPlayers.length} player${selectedTeamPlayers.length !== 1 ? 's' : ''}.`);
    } catch (err: any) {
      console.error('save player jersey error', err);
      setError(err?.message || 'Unable to save jersey details.');
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const getManufacturerRows = () => {
      const rows: string[][] = [];
      filteredTeams.forEach((team) => {
        const wf = workflowByKey.get(keyFor(team.id, team.season_id));
        const design = wf?.finalMockupPath || wf?.approvedDesignPath || '';
        const roster = playersByTeamSeason.get(keyFor(team.id, team.season_id)) || [];
        roster.forEach((player) => {
          rows.push([
            team.name || '',
            team.division || '',
            seasonMap.get(team.season_id) || '',
            `${player.first_name || ''} ${player.last_name || ''}`.trim(),
            player.jersey_name || '',
            player.jersey_number != null ? String(player.jersey_number) : '',
            player.jersey_size || '',
            player.shorts_size || '',
            design,
          ]);
        });
      });
      return rows;
    };

    const header = [
      'Team Name',
      'Division',
      'Season',
      'Player Legal Name',
      'Jersey Name',
      'Jersey Number',
      'Jersey Size',
      'Shorts Size',
      'Jersey Design',
    ];
    const rows: string[][] = [header, ...getManufacturerRows()];
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jersey-export-${selectedSeasonId || 'all-seasons'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    const header = [
      'Team Name',
      'Division',
      'Season',
      'Player Legal Name',
      'Jersey Name',
      'Jersey Number',
      'Jersey Size',
      'Shorts Size',
      'Jersey Design',
    ];
    const bodyRows: string[][] = [];
    filteredTeams.forEach((team) => {
      const wf = workflowByKey.get(keyFor(team.id, team.season_id));
      const design = wf?.finalMockupPath || wf?.approvedDesignPath || '';
      const roster = playersByTeamSeason.get(keyFor(team.id, team.season_id)) || [];
      roster.forEach((player) => {
        bodyRows.push([
          team.name || '',
          team.division || '',
          seasonMap.get(team.season_id) || '',
          `${player.first_name || ''} ${player.last_name || ''}`.trim(),
          player.jersey_name || '',
          player.jersey_number != null ? String(player.jersey_number) : '',
          player.jersey_size || '',
          player.shorts_size || '',
          design,
        ]);
      });
    });

    const escapeHtml = (value: string) =>
      String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table border="1"><thead><tr>${header
      .map((cell) => `<th>${escapeHtml(cell)}</th>`)
      .join('')}</tr></thead><tbody>${bodyRows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jersey-export-${selectedSeasonId || 'all-seasons'}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const buildCheckInRows = () => {
    const rows: Array<{ playerLegalName: string; teamName: string; division: string; season: string }> = [];
    filteredTeams.forEach((team) => {
      const roster = playersByTeamSeason.get(keyFor(team.id, team.season_id)) || [];
      roster.forEach((player) => {
        const isGuest = !!player.is_guest || String(player.first_name || '').trim().toLowerCase().startsWith('guest');
        if (isGuest) return;
        rows.push({
          playerLegalName: `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Player',
          teamName: team.name || '',
          division: team.division || '',
          season: seasonMap.get(team.season_id) || '',
        });
      });
    });
    return rows;
  };

  const exportCheckInCsv = () => {
    setError(null);
    const header = ['Player Legal Name', 'Team Name', 'Division', 'Season'];
    const rows = [header, ...buildCheckInRows().map((row) => [row.playerLegalName, row.teamName, row.division, row.season])];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `check-in-report-${selectedSeasonId || 'all-seasons'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportCheckInPdf = () => {
    setError(null);
    const rows = buildCheckInRows();
    if (typeof document === 'undefined') {
      setError('Print preview is not available in this browser context.');
      return;
    }
    const tableRows = rows
      .map(
        (row) =>
          `<tr><td>${row.playerLegalName}</td><td>${row.teamName}</td><td>${row.division}</td><td>${row.season}</td></tr>`
      )
      .join('');
    const html = `
      <!doctype html>
      <html>
        <head>
          <title>Check-in Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            h1 { margin: 0 0 8px; font-size: 22px; }
            p { margin: 0 0 16px; color: #444; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #bbb; padding: 8px; text-align: left; }
            th { background: #f2f2f2; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
          </style>
        </head>
        <body>
          <h1>CSL Check-in Report</h1>
          <p>Generated ${new Date().toLocaleString()}</p>
          <table>
            <thead>
              <tr>
                <th>Player Legal Name</th>
                <th>Team Name</th>
                <th>Division</th>
                <th>Season</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </body>
      </html>
    `;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');

    const cleanup = () => {
      window.setTimeout(() => {
        iframe.remove();
      }, 1000);
    };

    iframe.onload = () => {
      try {
        const targetWindow = iframe.contentWindow;
        if (!targetWindow) {
          setError('Unable to open print preview.');
          cleanup();
          return;
        }
        targetWindow.focus();
        targetWindow.print();
        cleanup();
      } catch (err: any) {
        console.error('check-in print error', err);
        setError('Unable to open print preview.');
        cleanup();
      }
    };

    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading jersey management...</div>;
  }

  const selectArrowStyle = {
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 1.15rem center',
    backgroundSize: '12px 8px',
  } as const;
  const compactSelectArrowStyle = {
    ...selectArrowStyle,
    backgroundPosition: 'right 1.15rem center',
  } as const;

  const deleteModalRoot = typeof document !== 'undefined' ? document.body : null;
  const pendingDeleteTitle =
    pendingDeleteAction?.mode === 'all'
      ? 'Delete Team Design'
      : pendingDeleteAction?.mode === 'mockup'
      ? 'Delete Mockup'
      : 'Delete Uploaded Design';
  const pendingDeleteBody =
    pendingDeleteAction?.mode === 'all'
      ? 'This will remove the uploaded design, approved design, and mockup for this team.'
      : pendingDeleteAction?.mode === 'mockup'
      ? 'This will remove the final mockup for this team.'
      : 'This will remove this uploaded design file from the workflow.';
  const confirmPendingDelete = async () => {
    if (!pendingDeleteAction) return;
    const action = pendingDeleteAction;
    setPendingDeleteAction(null);
    if (action.mode === 'all') {
      await handleDeleteDesign(action.team);
      return;
    }
    if (action.mode === 'mockup') {
      await handleDeleteMockup(action.team);
      return;
    }
    await handleDeleteUploadedPath(action.team, action.path);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="font-sports text-2xl text-white uppercase">Jersey Management</h2>
          <p className="text-xs text-gray-400">Admin review, player edits, and manufacturer export.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 px-4 py-2 rounded bg-brand-lime text-black text-xs font-bold uppercase"
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            onClick={exportExcel}
            className="inline-flex items-center gap-2 px-4 py-2 rounded border border-white/20 bg-black/40 text-white text-xs font-bold uppercase hover:border-brand-lime"
          >
            <Download size={14} /> Export Excel
          </button>
          <button
            onClick={exportCheckInCsv}
            className="inline-flex items-center gap-2 px-4 py-2 rounded border border-white/20 bg-black/40 text-white text-xs font-bold uppercase hover:border-brand-lime"
            title="Download a game-day attendance sheet as CSV"
          >
            <Download size={14} /> Check-in Sheet CSV
          </button>
          <button
            onClick={exportCheckInPdf}
            className="inline-flex items-center gap-2 px-4 py-2 rounded border border-white/20 bg-black/40 text-white text-xs font-bold uppercase hover:border-brand-lime"
            title="Open a print-friendly game-day attendance sheet"
          >
            <Download size={14} /> Print Check-in Sheet
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-brand-red">{error}</div>}
      {message && <div className="text-xs text-brand-lime">{message}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <select
          value={selectedSeasonId}
          onChange={(e) => {
            setSelectedSeasonId(e.target.value);
            setSelectedTeamId('all');
          }}
          className="appearance-none bg-brand-dark border border-white/20 rounded px-3 pr-10 dropdown-select-spacing py-2 text-sm text-white focus:outline-none focus:border-brand-lime"
          style={selectArrowStyle}
        >
          <option value="">All Seasons</option>
          {orderedSeasonOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {formatSeasonOptionLabel(s)}
            </option>
          ))}
        </select>
        <select
          value={selectedDivision}
          onChange={(e) => {
            setSelectedDivision(e.target.value);
            setSelectedTeamId('all');
          }}
          className="appearance-none bg-brand-dark border border-white/20 rounded px-3 pr-10 dropdown-select-spacing py-2 text-sm text-white focus:outline-none focus:border-brand-lime"
          style={selectArrowStyle}
        >
          <option value="all">All Divisions</option>
          {allDivisions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={selectedTeamId}
          onChange={(e) => setSelectedTeamId(e.target.value)}
          className="appearance-none bg-brand-dark border border-white/20 rounded px-3 pr-10 dropdown-select-spacing py-2 text-sm text-white focus:outline-none focus:border-brand-lime"
          style={selectArrowStyle}
        >
          <option value="all">All Teams</option>
          {scopedTeams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <div className="grid grid-cols-12 bg-white/5 px-3 py-2 text-[11px] uppercase text-gray-400">
          <div className="col-span-3">Team</div>
          <div className="col-span-2">Division</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Jersey Completion</div>
          <div className="col-span-1">Design</div>
          <div className="col-span-2">Actions</div>
        </div>
        {paginatedTeams.map((team) => {
          const key = keyFor(team.id, team.season_id);
          const wf = workflowByKey.get(key);
          const roster = playersByTeamSeason.get(key) || [];
          const complete = roster.filter(
            (p) => (p.jersey_name || '').trim() && p.jersey_number != null && (p.jersey_size || '').trim() && (p.shorts_size || '').trim()
          ).length;
          return (
            <div key={key} className="grid grid-cols-12 px-3 py-3 border-t border-white/5 text-sm items-center">
              <div className="col-span-3 text-white">{team.name}</div>
              <div className="col-span-2 text-gray-300">{team.division || '-'}</div>
              <div className="col-span-2 pr-4">
                <select
                  value={wf?.status || 'pending_review'}
                  onChange={(e) =>
                    void setWorkflow(team, {
                      status: e.target.value as JerseyDesignStatus,
                      uploadedDesignPaths: wf?.uploadedDesignPaths || [],
                      approvedDesignPath: wf?.approvedDesignPath || null,
                      finalMockupPath: wf?.finalMockupPath || null,
                    })
                  }
                  className="w-full appearance-none bg-brand-dark border border-white/20 text-white text-[11px] font-sports uppercase tracking-wide px-3 pr-10 dropdown-select-spacing py-1.5 rounded-lg focus:outline-none focus:border-brand-lime"
                  style={selectArrowStyle}
                >
                  <option value="pending_review">Pending Review</option>
                  <option value="approved_pending_mockup">Approved - Pending Mockup</option>
                  <option value="mockup_approved">Mockup Approved</option>
                </select>
              </div>
              <div className="col-span-2 text-gray-300 pl-3">
                {complete}/{roster.length}
              </div>
              <div className="col-span-1">
                {thumbByTeamSeason[key] ? (
                  <img src={thumbByTeamSeason[key]} alt="Design" className="w-10 h-10 rounded object-cover border border-white/20" />
                ) : (
                  <span className="text-[11px] text-gray-500">N/A</span>
                )}
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <label className="px-2 py-1 text-[11px] rounded border border-white/20 text-white hover:border-white/50 cursor-pointer">
                  Mockup
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void handleMockupUpload(team, e.target.files?.[0] || null)}
                  />
                </label>
                {(wf?.finalMockupPath || wf?.approvedDesignPath || (wf?.uploadedDesignPaths || []).length > 0) && (
                  <button
                    type="button"
                    onClick={() => setPendingDeleteAction({ mode: 'all', team })}
                    disabled={saving}
                    className="px-2 py-1 text-[11px] rounded border border-brand-red/40 text-brand-red hover:bg-brand-red/10 disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTeamId === 'all' && filteredTeams.length > teamsPerPage && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-white/10 px-4 py-3">
          <div className="text-xs text-gray-400">
            Showing {Math.min((teamPage - 1) * teamsPerPage + 1, filteredTeams.length)}-
            {Math.min(teamPage * teamsPerPage, filteredTeams.length)} of {filteredTeams.length} teams
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTeamPage((prev) => Math.max(1, prev - 1))}
              disabled={teamPage === 1}
              className="px-3 py-1.5 rounded border border-white/20 text-xs font-bold uppercase text-white disabled:opacity-40"
            >
              Previous
            </button>
            <div className="text-xs text-gray-300">
              Page {teamPage} / {totalTeamPages}
            </div>
            <button
              type="button"
              onClick={() => setTeamPage((prev) => Math.min(totalTeamPages, prev + 1))}
              disabled={teamPage === totalTeamPages}
              className="px-3 py-1.5 rounded border border-white/20 text-xs font-bold uppercase text-white disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {selectedTeam ? (
        <div className="rounded-xl border border-white/10 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h3 className="text-white font-sports uppercase text-lg">
              Player-Level Editing: {selectedTeam.name}
            </h3>
            <button
              onClick={() => void saveAllSelectedTeamPlayers()}
              disabled={saving || selectedTeamPlayers.length === 0}
              className="px-4 py-2 rounded bg-brand-lime text-black text-xs font-bold uppercase disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
          {(() => {
            const wf = workflowByKey.get(keyFor(selectedTeam.id, selectedTeam.season_id));
            const uploaded = wf?.uploadedDesignPaths || [];
            return (
              <div className="rounded-lg border border-white/10 p-3 bg-black/30 space-y-2">
                <div className="text-xs uppercase text-gray-400">Team Design Workflow</div>
                <div className="text-sm text-gray-200">
                  Status:{' '}
                  <span className="text-white font-semibold">
                    {wf?.status === 'approved_pending_mockup'
                      ? 'Approved - Pending Mockup'
                      : wf?.status === 'mockup_approved'
                      ? 'Mockup Approved'
                      : 'Pending Review'}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500">
                  This section is for team jersey design approval only (captain upload to admin approval to mockup).
                </div>
                {wf?.finalMockupPath ? (
                  <div className="flex items-center justify-between gap-2 text-xs bg-white/5 rounded px-2 py-1">
                    <span className="text-gray-300 truncate">Mockup: {wf.finalMockupPath.split('/').pop() || wf.finalMockupPath}</span>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteAction({ mode: 'mockup', team: selectedTeam })}
                      className="px-2 py-1 rounded border border-brand-red/40 text-brand-red hover:bg-brand-red/10"
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
                {uploaded.length ? (
                  <div className="space-y-1">
                    <div className="text-xs text-gray-400">Captain uploads</div>
                    {uploaded.map((path) => (
                      <div key={path} className="flex items-center justify-between gap-2 text-xs bg-white/5 rounded px-2 py-1">
                        <span className="text-gray-300 truncate">{path.split('/').pop() || path}</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              void setWorkflow(selectedTeam, {
                                uploadedDesignPaths: uploaded,
                                approvedDesignPath: path,
                                finalMockupPath: wf?.finalMockupPath || null,
                                status: 'approved_pending_mockup',
                              })
                            }
                            className="px-2 py-1 rounded border border-brand-lime/40 text-brand-lime hover:bg-brand-lime/10"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteAction({ mode: 'upload', team: selectedTeam, path })}
                            className="px-2 py-1 rounded border border-brand-red/40 text-brand-red hover:bg-brand-red/10"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">No captain design uploads found yet.</div>
                )}
              </div>
            );
          })()}
          <div className="space-y-2 overflow-x-auto">
            <div className="hidden lg:grid lg:grid-cols-[260px_150px_130px_130px_130px] gap-2 text-[10px] uppercase text-gray-500 px-1">
              <div>Player</div>
              <div>Jersey Name</div>
              <div>Jersey #</div>
              <div>Jersey Size</div>
              <div>Shorts Size</div>
            </div>
            {selectedTeamPlayers.map((player) => (
              <div key={player.id} className="grid lg:grid-cols-[260px_150px_130px_130px_130px] gap-2 items-center min-w-[820px]">
                <div className="text-sm text-gray-200">
                  {`${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Player'}
                </div>
                <input
                  value={player.jersey_name || ''}
                  onChange={(e) =>
                    setPlayers((prev) => prev.map((row) => (row.id === player.id ? { ...row, jersey_name: e.target.value } : row)))
                  }
                  className="bg-black border border-white/20 rounded px-2 py-1 text-sm text-white"
                  placeholder="Jersey Name"
                />
                <input
                  value={player.jersey_number != null ? String(player.jersey_number) : ''}
                  onChange={(e) =>
                    setPlayers((prev) =>
                      prev.map((row) =>
                        row.id === player.id ? { ...row, jersey_number: parseJerseyNumberValue(e.target.value) } : row
                      )
                    )
                  }
                  className="bg-black border border-white/20 rounded px-2 py-1 text-sm text-white"
                  placeholder="Jersey #"
                />
                <select
                  value={player.jersey_size || ''}
                  onChange={(e) =>
                    setPlayers((prev) => prev.map((row) => (row.id === player.id ? { ...row, jersey_size: e.target.value } : row)))
                  }
                  className="appearance-none bg-black border border-white/20 rounded px-2 pr-7 py-1 text-sm text-white focus:outline-none focus:border-brand-lime"
                  style={compactSelectArrowStyle}
                >
                  <option value="">Jersey Size</option>
                  {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                <select
                  value={player.shorts_size || ''}
                  onChange={(e) =>
                    setPlayers((prev) =>
                      prev.map((row) => (row.id === player.id ? { ...row, shorts_size: e.target.value } : row))
                    )
                  }
                  className="appearance-none bg-black border border-white/20 rounded px-2 pr-7 py-1 text-sm text-white focus:outline-none focus:border-brand-lime"
                  style={compactSelectArrowStyle}
                  >
                    <option value="">Shorts Size</option>
                    {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 p-4">
          <div className="text-sm text-gray-400">Select a team from the filter above to edit player-level jersey details.</div>
        </div>
      )}

      {pendingDeleteAction &&
        deleteModalRoot &&
        createPortal(
          <div className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl border border-white/10 bg-brand-dark p-6 shadow-2xl animate-fadeIn">
              <h4 className="text-white font-sports text-xl uppercase">{pendingDeleteTitle}</h4>
              <p className="mt-2 text-sm text-gray-300">{pendingDeleteBody}</p>
              <div className="mt-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200">
                This cannot be undone.
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPendingDeleteAction(null)}
                  disabled={saving}
                  className="px-4 py-2 rounded border border-white/20 text-gray-300 text-sm hover:border-white/40 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmPendingDelete()}
                  disabled={saving}
                  className="px-4 py-2 rounded bg-brand-red text-white text-sm font-bold hover:bg-red-600 disabled:opacity-50"
                >
                  {saving ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>,
          deleteModalRoot
        )}
    </div>
  );
};

// --- MAIN ADMIN DASHBOARD ---
const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [adminDisplayName, setAdminDisplayName] = useState<string | null>(null);
  const initialTab = searchParams.get('tab');
  const allowedTabs = [
    'overview',
    'users',
    'players',
    'waivers',
    'registrations',
    'capacity',
    'seasons',
    'teams',
    'team-links',
    'jerseys',
    'divisions',
    'imports',
    'trophies',
    'badges',
    'emails',
    'payments',
    'testimonials',
    'faq',
    'about',
    'content',
    'unpaid',
  ];
  const normalizedTab =
    initialTab && allowedTabs.includes(initialTab)
    ? initialTab
    : 'overview';
  const [activeTab, setActiveTab] = useState(normalizedTab);
  const [unpaidUnread, setUnpaidUnread] = useState(false);
  const [hasPlayerProfile, setHasPlayerProfile] = useState(false);
  const [playerTeamId, setPlayerTeamId] = useState<string | null>(null);
  const [playerLookupLoading, setPlayerLookupLoading] = useState(false);
  const [isCaptain, setIsCaptain] = useState(false);
  const [overview, setOverview] = useState<{
    teams: number;
    activeSeason: string;
    upcoming: number;
    source: 'mock' | 'live';
    error?: string | null;
  }>({
    teams: TEAMS.length,
    activeSeason: "Winter '25",
    upcoming: 2,
    source: 'mock',
    error: null,
  });
  const [playerColumns, setPlayerColumns] = useState<Set<string>>(new Set());
  const [emailBlastLoading, setEmailBlastLoading] = useState(false);
  const [emailBlastMessage, setEmailBlastMessage] = useState<string | null>(null);
  const [emailBlastError, setEmailBlastError] = useState<string | null>(null);

  useEffect(() => {
    const currentUser = getCurrentUser();
    const adminRoles = [Role.ADMIN_FULL, Role.ADMIN_MEDIA, Role.ADMIN_SCOREKEEPER, Role.ADMIN_COMMISSIONER];
    if (!currentUser || !adminRoles.includes(currentUser.role)) {
      navigate('/login');
      return;
    }
    setUser(currentUser);
  }, [navigate]);

  useEffect(() => {
    let active = true;
    const loadDisplayName = async () => {
      if (!user?.email) {
        if (active) setAdminDisplayName(null);
        return;
      }
      try {
        const normalized = user.email.trim().toLowerCase();
        const { data } = await supabase
          .from('admin_users')
          .select('display_name')
          .ilike('email', normalized)
          .limit(1)
          .maybeSingle();
        if (active) {
          setAdminDisplayName(data?.display_name || null);
        }
      } catch (err) {
        console.warn('admin display name lookup failed', err);
      }
    };
    loadDisplayName();
    return () => {
      active = false;
    };
  }, [user?.email]);

  useEffect(() => {
    let active = true;
    const loadPlayerProfile = async () => {
      if (!user?.id) {
        if (active) {
          setHasPlayerProfile(false);
          setPlayerTeamId(null);
          setIsCaptain(false);
          setPlayerLookupLoading(false);
        }
        return;
      }
      setPlayerLookupLoading(true);
      try {
        const { data: currentSeason } = await supabase
          .from('seasons')
          .select('id')
          .eq('is_current', true)
          .maybeSingle();
        const currentSeasonId = currentSeason?.id || null;
        let playerRow: any = null;
        if (currentSeasonId) {
          const { data } = await supabase
            .from('players')
            .select('id,team_id,season_id,created_at,is_captain')
            .eq('user_id', user.id)
            .eq('season_id', currentSeasonId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          playerRow = data || null;
        }
        if (!playerRow) {
          const { data } = await supabase
            .from('players')
            .select('id,team_id,season_id,created_at,is_captain')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          playerRow = data || null;
        }
        if (active) {
          setHasPlayerProfile(!!playerRow?.id);
          setPlayerTeamId(playerRow?.team_id || null);
          const isCaptainCurrent =
            !!playerRow?.is_captain && !!currentSeasonId && playerRow?.season_id === currentSeasonId;
          setIsCaptain(isCaptainCurrent);
        }
      } catch (err) {
        console.warn('admin player view lookup failed', err);
        if (active) {
          setHasPlayerProfile(false);
          setPlayerTeamId(null);
          setIsCaptain(false);
        }
      } finally {
        if (active) setPlayerLookupLoading(false);
      }
    };
    loadPlayerProfile();
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
      setSearchParams({ tab: activeTab });
      if (activeTab === 'unpaid') {
        setUnpaidUnread(false);
        try {
          localStorage.setItem('courtsight_unpaid_seen', new Date().toISOString());
        } catch {}
      }
  }, [activeTab, setSearchParams]);

  // Prevent access to the Photos tab (temporarily disabled)
  useEffect(() => {
    if (!allowedTabs.includes(activeTab)) setActiveTab('overview');
  }, [activeTab]);

  const loadOverview = useCallback(async () => {
    try {
      // Active season
      const { data: season } = await supabase
        .from('seasons')
        .select('id,name, year')
        .eq('is_current', true)
        .maybeSingle();

      // Teams count for active season (fallback to all if none active)
      let teamQuery = supabase
        .from('teams')
        .select('id', { count: 'exact', head: true });
      if (season?.id) {
        teamQuery = teamQuery.eq('season_id', season.id);
      }
      const { count: teamCount } = await teamQuery;

      // Upcoming scheduled games (all with status = scheduled) for active season
      let gameQuery = supabase
        .from('games')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'scheduled');
      if (season?.id) {
        gameQuery = gameQuery.eq('season_id', season.id);
      }
      const { count: upcomingCount } = await gameQuery;

      const yearShort = season?.year ? `'${season.year.toString().slice(-2)}` : '';
      const baseName = season?.name ? season.name.replace(/\s*20\d{2}$/, '').trim() : null;

      setOverview({
        teams: teamCount ?? TEAMS.length,
        activeSeason: season
          ? `${baseName || season.name} ${yearShort}`.trim()
          : "Winter '25",
        upcoming: upcomingCount ?? 0,
        source: 'live',
        error: null,
      });
    } catch (err) {
      console.error('Admin overview load error', err);
      setOverview((prev) => ({
        ...prev,
        source: 'mock',
        error: 'Using mock overview (Supabase unreachable).',
      }));
    }
  }, []);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const normalizedNext =
      tabParam && allowedTabs.includes(tabParam)
        ? tabParam
        : 'overview';
    if (normalizedNext !== activeTab) {
      setActiveTab(normalizedNext);
    }
  }, [searchParams]);

  // Permission Logic (safe when user is not yet loaded)
  const role = user?.role;
  const isFullAdmin = role === Role.ADMIN_FULL;
  const isCommish = role === Role.ADMIN_COMMISSIONER;
  const isScorekeeper = role === Role.ADMIN_SCOREKEEPER;
  const isMedia = role === Role.ADMIN_MEDIA;

      const tabs = [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard, allowed: true },
        { id: 'users', label: 'User Management', icon: UserCog, allowed: isFullAdmin },
        { id: 'players', label: 'Player Management', icon: Users, allowed: isFullAdmin },
        { id: 'waivers', label: 'Waiver Audit', icon: CheckSquare, allowed: isFullAdmin },
        { id: 'registrations', label: 'Team Registrations', icon: FileText, allowed: isFullAdmin },
        { id: 'capacity', label: 'Registration Capacity', icon: LockOpen, allowed: isFullAdmin || isCommish },
        { id: 'seasons', label: 'Seasons', icon: Trophy, allowed: isFullAdmin || isCommish },
        { id: 'teams', label: 'Teams', icon: Users, allowed: isFullAdmin || isCommish },
        { id: 'team-links', label: 'Team Links', icon: Copy, allowed: isFullAdmin || isCommish },
        { id: 'jerseys', label: 'Jersey Management', icon: Shirt, allowed: isFullAdmin || isCommish },
        { id: 'trophies', label: 'Team Trophies', icon: Trophy, allowed: isFullAdmin || isCommish },
        { id: 'badges', label: 'Badge Settings', icon: Award, allowed: isFullAdmin || isCommish },
        { id: 'divisions', label: 'Divisions', icon: Layers, allowed: isFullAdmin || isCommish },
        { id: 'imports', label: 'Imports', icon: Upload, allowed: isFullAdmin || isCommish || isScorekeeper },
        { id: 'unpaid', label: 'Unpaid Players', icon: AlertTriangle, allowed: isFullAdmin, hidden: true },
        { id: 'emails', label: 'Email Templates', icon: FileText, allowed: isFullAdmin },
        { id: 'payments', label: 'Payment Links', icon: CreditCard, allowed: isFullAdmin },
        { id: 'testimonials', label: 'Testimonials', icon: Quote, allowed: isFullAdmin },
        { id: 'faq', label: 'FAQ Content', icon: FileText, allowed: isFullAdmin },
        { id: 'about', label: 'About Content', icon: FileText, allowed: isFullAdmin },
        { id: 'content', label: 'News', icon: FileText, allowed: isFullAdmin },
      ];

  const currentTab = tabs.find(t => t.id === activeTab);

  const getRoleLabel = (role: Role) => {
    switch(role) {
      case Role.ADMIN_FULL: return 'Full Admin';
      case Role.ADMIN_MEDIA: return 'Media Mgr';
      case Role.ADMIN_SCOREKEEPER: return 'Scorekeeper';
      case Role.ADMIN_COMMISSIONER: return 'Commissioner';
      default: return 'Admin';
    }
  }

  const loadPlayerColumns = async () => {
    if (playerColumns.size) {
      return playerColumns;
    }
    if (!supabaseAdmin) {
      return playerColumns;
    }
    try {
      const { data, error } = await supabaseAdmin.from('players').select('*').limit(1);
      if (!error && data?.[0]) {
        const columns = new Set(Object.keys(data[0]));
        setPlayerColumns(columns);
        return columns;
      }
    } catch (err) {
      console.warn('player columns lookup failed', err);
    }
    return playerColumns;
  };

  const handleEmailAllNonUserPlayers = async () => {
    if (emailBlastLoading) return;
    if (!supabaseAdmin) {
      setEmailBlastError('Admin service credentials are required to email non-user players.');
      return;
    }
    setEmailBlastMessage(null);
    setEmailBlastError(null);
    setEmailBlastLoading(true);
    try {
      const columnSet = await loadPlayerColumns();
      const emailColumns: string[] = [];
      if (columnSet.has('email')) emailColumns.push('email');
      if (columnSet.has('email_address')) emailColumns.push('email_address');
      if (!emailColumns.length) {
        setEmailBlastMessage('Players table has no email/email_address column yet. Run server/players_contact_columns.sql first.');
        return;
      }
      const selectFields = ['id', 'first_name', 'last_name', 'team_id', ...emailColumns].join(',');
      const { data: playersData, error: playersError } = await supabaseAdmin
        .from('players')
        .select(selectFields)
        .is('user_id', null);
      if (playersError) throw playersError;
      const { data: teamRows, error: teamsError } = await supabaseAdmin
        .from('teams')
        .select('id,name,season_id,division,short_name');
      if (teamsError) {
        console.warn('team lookup failed', teamsError);
      }
      const teamMap = new Map((teamRows || []).map((team: any) => [team.id, team]));
      const inviteTargets = (playersData || [])
        .map((row: any) => {
          const email = normalizeEmail((row.email || row.email_address || '').trim());
          if (!email) return null;
          return {
            playerId: row.id || null,
            teamId: row.team_id || null,
            email,
            playerName: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Player',
          };
        })
        .filter(Boolean) as Array<{
        playerId: string | null;
        teamId: string | null;
        email: string;
        playerName: string;
      }>;
      if (!inviteTargets.length) {
        setEmailBlastMessage('No non-user players with an email address were found.');
        return;
      }
      let sentCount = 0;
      let failureCount = 0;
      let firstFailureReason = '';
      for (const target of inviteTargets) {
        const teamRecord = target.teamId ? teamMap.get(target.teamId) : null;
        const teamName = teamRecord?.name || 'Courtsight League';
        const seasonLabel = 'current season';
        const teamCode = String((teamRecord as any)?.short_name || '').trim().toUpperCase() || null;
        const inviteLink = buildPlayerPortalUrl(target.teamId, target.email, teamCode);
        try {
          await sendPlayerClaimEmail({
            playerId: target.playerId,
            email: target.email,
            playerName: target.playerName,
            teamName,
            teamId: target.teamId,
            teamCode,
            seasonName: seasonLabel,
            inviteLink,
          });
          sentCount += 1;
        } catch (sendErr: any) {
          console.warn('email blast failed for', target.email, sendErr);
          failureCount += 1;
          if (!firstFailureReason) {
            firstFailureReason = String(sendErr?.message || '').trim();
          }
        }
      }
      if (sentCount) {
        setEmailBlastMessage(`Invite emails queued for ${sentCount} non-user player${sentCount === 1 ? '' : 's'}.`);
      } else {
        setEmailBlastMessage('No invitation emails were queued.');
      }
      if (failureCount) {
        const summary = `${failureCount} invitation email${failureCount === 1 ? '' : 's'} failed to send.`;
        setEmailBlastError(firstFailureReason ? `${summary} First error: ${firstFailureReason}` : summary);
      }
    } catch (err: any) {
      console.error('global email blast failed', err);
      setEmailBlastError(err?.message || 'Failed to send invite emails to non-user players.');
    } finally {
      setEmailBlastLoading(false);
    }
  };

  const loadUnpaidCount = useCallback(async () => {
    try {
      let profiles: any[] = [];
      try {
        const { data } = await supabase.from('profiles').select('user_id,payment_status');
        profiles = data || [];
      } catch {
        if (supabaseAdmin) {
          const { data } = await supabaseAdmin.from('profiles').select('user_id,payment_status');
          profiles = data || [];
        }
      }
      const profileStatus = new Map<string, string>();
      profiles.forEach((p: any) => profileStatus.set(p.user_id, (p as any).payment_status || 'pending'));

      let players: any[] = [];
      try {
        const { data } = await supabase.from('players').select('user_id,payment_status').order('created_at', { ascending: false });
        players = data || [];
      } catch {
        if (supabaseAdmin) {
          const { data } = await supabaseAdmin.from('players').select('user_id,payment_status').order('created_at', { ascending: false });
          players = data || [];
        }
      }

      const normalize = (val: any) => {
        if (!val) return 'pending';
        const lower = String(val).toLowerCase();
        if (lower.includes('paid')) return 'paid';
        if (lower.includes('stripe')) return 'pending-stripe';
        if (lower.includes('pending')) return 'pending';
        return 'unknown';
      };

      let count = 0;
      players.forEach((p: any) => {
        const status = normalize(profileStatus.get(p.user_id) || p.payment_status);
        if (status !== 'paid') count += 1;
      });

      const lastSeen = (() => {
        try {
          return localStorage.getItem('courtsight_unpaid_seen');
        } catch {
          return null;
        }
      })();

      if (count > 0 && activeTab !== 'unpaid') {
        setUnpaidUnread(true);
      } else if (activeTab === 'unpaid') {
        setUnpaidUnread(false);
      } else if (lastSeen) {
        setUnpaidUnread(false);
      }
    } catch (err) {
      console.warn('unpaid count load failed', err);
    }
  }, [activeTab]);

  useEffect(() => {
    loadOverview();
    loadUnpaidCount();

    const channel = supabase
      .channel('admin-overview-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => loadOverview())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => loadOverview())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seasons' }, () => loadOverview())
      .subscribe();

    const handleFocus = () => {
      loadOverview();
      loadUnpaidCount();
    };
    const interval = setInterval(() => {
      loadOverview();
      loadUnpaidCount();
    }, 5000);
    window.addEventListener('focus', handleFocus);

    return () => {
      channel.unsubscribe();
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, [loadOverview, loadUnpaidCount]);

  const resolvedUserName = adminDisplayName || user?.name || '';

  if (!user) {
    return (
      <div className="min-h-screen bg-brand-black pt-20 sm:pt-24 pb-12 px-4 sm:px-6 flex items-center justify-center text-white">
        Loading admin dashboard...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-black pt-20 sm:pt-24 pb-12 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-6 lg:gap-8">
        
        {/* SIDEBAR */}
        <div className="w-full lg:w-72 flex-shrink-0">
          <div className="bg-brand-dark border border-white/10 rounded-xl p-4 sm:p-6 mb-4 sm:mb-6 lg:sticky lg:top-24">
             <div className="flex items-center gap-3 mb-4 sm:mb-6">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-xl ${isFullAdmin ? 'bg-brand-red' : 'bg-brand-lime text-black'}`}>
                       {resolvedUserName.charAt(0)}
                    </div>
                    <div>
                       <h3 className="text-white font-bold leading-tight">{resolvedUserName}</h3>
                   <span className="text-xs text-brand-grey uppercase">{getRoleLabel(user.role)}</span>
                </div>
             </div>
             <div className="lg:hidden border-t border-white/10 pt-3 sm:pt-4">
               <label className="block text-xs text-brand-grey uppercase font-bold mb-2">
                 Admin Section
               </label>
               <div className="relative">
                 <select
                   value={activeTab}
                   onChange={(e) => setActiveTab(e.target.value)}
                   className="w-full appearance-none bg-black border border-white/20 rounded px-3 pr-10 dropdown-select-spacing py-2 text-sm text-white focus:border-brand-lime outline-none"
                 >
                   {tabs.filter((tab) => !tab.hidden).map(tab => (
                     <option key={tab.id} value={tab.id}>
                       {tab.label}{tab.id === 'unpaid' && unpaidUnread && tab.allowed ? ' *' : ''}
                     </option>
                   ))}
                 </select>
                 <ChevronDown
                   size={14}
                   className="pointer-events-none absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-400"
                 />
               </div>
             </div>
             <nav className="hidden lg:flex lg:flex-col gap-1 border-t border-white/10 pt-3 sm:pt-4">
                {tabs.filter((tab) => !tab.hidden).map(tab => (
                   <button
                     key={tab.id}
                     onClick={() => setActiveTab(tab.id)}
                     className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-[13px] font-medium leading-tight border-l-4 border-transparent ${
                       activeTab === tab.id 
                         ? 'bg-white/10 text-brand-lime border-brand-lime' 
                         : 'text-gray-400 hover:text-white hover:bg-white/5'
                     }`}
                     title={tab.label}
                   >
                      <tab.icon size={16} className="shrink-0" />
                      <span className="flex-1 text-left truncate">{tab.label}</span>
                      {tab.id === 'unpaid' && unpaidUnread && tab.allowed && (
                        <span className="w-2 h-2 rounded-full bg-brand-red animate-pulse" aria-label="New unpaid players" />
                      )}
                      {!tab.allowed && <ShieldAlert size={12} className="ml-auto text-gray-600" />}
                   </button>
                ))}
             </nav>
          </div>
        </div>

        {/* MAIN CONTENT AREA */}
        <div className="flex-1 min-h-[600px]">
           {!currentTab?.allowed ? (
              <div className="bg-brand-dark border border-white/10 rounded-xl p-8 sm:p-12 flex flex-col items-center justify-center h-full text-center opacity-50">
                 <ShieldAlert className="w-16 h-16 sm:w-24 sm:h-24 text-brand-red mb-4" />
                 <h2 className="text-xl sm:text-2xl font-sports font-bold text-white uppercase">Access Restricted</h2>
                 <p className="text-gray-400 mt-2 text-sm sm:text-base">You do not have permission to view this section.</p>
              </div>
           ) : (
              <>
                {activeTab === 'overview' && (
                   <div className="animate-fadeIn">
                      <h1 className="font-sports text-2xl sm:text-3xl text-white uppercase mb-6 sm:mb-8">Dashboard Overview</h1>
                      {playerLookupLoading && (
                        <div className="bg-brand-dark border border-white/10 p-4 rounded-lg mb-6 text-xs text-gray-500">
                          Loading player views...
                        </div>
                      )}
                      {!playerLookupLoading && (
                        <div className="bg-brand-dark border border-white/10 p-4 rounded-lg mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                          <div>
                            <div className="text-xs uppercase text-brand-grey font-bold mb-1">Player Views</div>
                            <div className="text-sm text-gray-400">
                              {hasPlayerProfile
                                ? 'Open your player and team profiles without leaving admin access.'
                                : 'No player profile linked to this admin account yet.'}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => navigate('/my-season')}
                              disabled={!hasPlayerProfile}
                              className={`px-4 py-2 rounded text-xs font-bold uppercase ${
                                hasPlayerProfile
                                  ? 'bg-white/10 text-white hover:bg-white/20'
                                  : 'bg-white/5 text-gray-500 cursor-not-allowed'
                              }`}
                            >
                              Player Profile
                            </button>
                            <button
                              onClick={() => navigate(playerTeamId ? `/team/${playerTeamId}` : '/my-team')}
                              disabled={!hasPlayerProfile}
                              className={`px-4 py-2 rounded text-xs font-bold uppercase ${
                                hasPlayerProfile
                                  ? 'bg-white/10 text-white hover:bg-white/20'
                                  : 'bg-white/5 text-gray-500 cursor-not-allowed'
                              }`}
                            >
                              Team Profile
                            </button>
                            {isCaptain && (
                              <button
                                onClick={() => navigate('/manage-team')}
                                className="px-4 py-2 rounded bg-brand-lime/20 text-brand-lime text-xs font-bold uppercase hover:bg-brand-lime/30"
                              >
                                Manage Team
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
                         <div className="bg-brand-dark border border-white/10 p-5 sm:p-6 rounded-lg">
                            <div className="text-gray-400 text-xs uppercase font-bold mb-2">Total Teams</div>
                            <div className="text-3xl sm:text-4xl font-sports font-bold text-white">{overview.teams}</div>
                         </div>
                         <div className="bg-brand-dark border border-white/10 p-5 sm:p-6 rounded-lg">
                            <div className="text-gray-400 text-xs uppercase font-bold mb-2">Active Season</div>
                            <div className="text-2xl sm:text-4xl font-sports font-bold text-brand-lime">
                              {overview.activeSeason}
                            </div>
                         </div>
                         <div className="bg-brand-dark border border-white/10 p-5 sm:p-6 rounded-lg">
                            <div className="text-gray-400 text-xs uppercase font-bold mb-2">Upcoming Games</div>
                            <div className="text-lg font-bold text-white flex items-center gap-2">
                               {overview.upcoming} Scheduled
                            </div>
                            {overview.source === 'mock' && (
                              <div className="text-xs text-brand-red mt-2">Using mock overview</div>
                            )}
                         </div>
                      </div>

                      <div className="mt-10">
                        {user && <ScheduleManager userRole={user.role} />}
                      </div>
                   </div>
                )}

                  {activeTab === 'users' && <UserManager currentUser={user} />}
                  {activeTab === 'players' && (
                    <>
                      <div className="mb-4 rounded-2xl border border-white/10 bg-brand-dark p-4 space-y-2">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-xs uppercase text-brand-grey font-bold">Email non-user players</p>
                            <p className="text-sm text-gray-400">Send claim links to every non-user player in the league.</p>
                          </div>
                          <button
                            onClick={handleEmailAllNonUserPlayers}
                            disabled={emailBlastLoading}
                            className="px-3 py-2 rounded bg-white/10 text-white text-xs font-bold uppercase tracking-wide hover:bg-white/20 disabled:opacity-50"
                          >
                            {emailBlastLoading ? 'Sending to non-user players...' : 'Email all non-user players'}
                          </button>
                        </div>
                        {emailBlastMessage && (
                          <div className="text-xs text-brand-lime">{emailBlastMessage}</div>
                        )}
                        {emailBlastError && (
                          <div className="text-xs text-brand-red">{emailBlastError}</div>
                        )}
                      </div>
                      <PlayerManagement />
                    </>
                  )}
                  {activeTab === 'waivers' && (
                    <WaiverAuditManager />
                  )}
                  {activeTab === 'registrations' && (
                    <PlayerManagement
                      defaultViewMode="team-leads"
                      hideModeTabs={true}
                      title="Team Registrations"
                    />
                  )}
                  {activeTab === 'capacity' && (
                    <div className="space-y-6">
                      <RegistrationWaiverManager />
                      <RegistrationCapacityManager />
                    </div>
                  )}
                  {activeTab === 'seasons' && <SeasonsManager />}
                  {activeTab === 'teams' && <TeamsManager />}
                  {activeTab === 'team-links' && <TeamShareLinksManager />}
                  {activeTab === 'jerseys' && <JerseyManagementManager />}
                  {activeTab === 'trophies' && <TeamTrophiesManager />}
                  {activeTab === 'badges' && <BadgeSettingsManager />}
                  {activeTab === 'divisions' && <DivisionManager />}
                  {activeTab === 'imports' && user && <ImportsManager userRole={user.role} />}
                  {activeTab === 'unpaid' && <UnpaidPlayers />}
                  {activeTab === 'emails' && <RegistrationEmailTemplatesManager />}
                  {activeTab === 'payments' && <StripePaymentLinksManager />}
                  {activeTab === 'testimonials' && <TestimonialsManager />}
                  {activeTab === 'faq' && <FaqContentManager />}
                  {activeTab === 'about' && <AboutContentManager />}
                  {activeTab === 'content' && <ContentManager />}
                  {activeTab === 'photos' && <PhotoManager />}
              </>
           )}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
