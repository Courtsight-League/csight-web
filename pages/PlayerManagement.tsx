import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { supabase } from '../services/supabaseClient';
import { supabaseAdmin } from '../services/supabaseAdminClient';
import { getStoredUser } from '../services/authService';
import {
  LeaguePaymentChoice,
  markLeagueRegistrationLeadCompleted,
  updateLeagueRegistrationLeadPayment,
} from '../services/leagueRegistrationService';
import { buildPlayerPortalUrl, sendPlayerClaimEmail } from '../services/playerClaimEmailService';
import { Role } from '../types';
import { RefreshCw, Search } from 'lucide-react';
import { sortSeasonsNewestFirst } from '../utils/seasonOrdering';

type ProfileRow = {
  user_id: string;
  display_name?: string | null;
  email?: string | null;
  email_address?: string | null;
  phone?: string | null;
  payment_status?: string | null;
  created_at?: string | null;
};

type PlayerRow = {
  id: string;
  user_id: string | null;
  first_name?: string | null;
  last_name?: string | null;
  team_id?: string | null;
  season_id?: string | null;
  created_at?: string | null;
  is_captain?: boolean | null;
  jersey_number?: string | null;
  position?: string | null;
  payment_status?: string | null;
  birth_date?: string | null;
  waiver_accepted?: boolean | null;
  waiver_accepted_at?: string | null;
  waiver_document_path?: string | null;
  // Optional fields that may exist for CSV-imported players.
  email?: string | null;
  email_address?: string | null;
  phone?: string | null;
};

type TeamRow = {
  id: string;
  name?: string | null;
  division?: string | null;
  short_name?: string | null;
};

type SeasonRow = {
  id: string;
  name?: string | null;
  year?: number | null;
  is_current?: boolean | null;
};

type ViewMode = 'players' | 'users' | 'leads' | 'team-leads';

type PaymentCategoryFilter = 'all' | 'active' | 'pending-payment' | 'jersey-pending' | 'inactive';
type ClaimStatusFilter = 'all' | 'claimed' | 'unclaimed';
type TeamFilterOption = {
  id: string;
  label: string;
};

type LeagueRegistrationLeadRow = {
  id: string;
  registration_type: 'team' | 'free-agent' | string;
  season_id: string;
  division_id: string;
  season_label?: string | null;
  division_label?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  team_name?: string | null;
  payment_choice?: 'full' | 'deposit' | 'later' | string | null;
  status?: string | null;
  submitted_at?: string | null;
  completed_at?: string | null;
  linked_user_id?: string | null;
  linked_team_id?: string | null;
  linked_player_id?: string | null;
};

type PlayerManagementUserRow = {
  userId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  paymentStatus: string | null;
  paymentCategory: Exclude<PaymentCategoryFilter, 'all'>;
  playerId: string | null;
  playerName: string | null;
  playerCount: number;
  hasAnyPlayer: boolean;
  hasCurrentSeasonPlayer: boolean;
  teamId: string | null;
  teamName: string | null;
  seasonName: string | null;
  isCaptain: boolean;
};

type PlayerManagementPlayerRow = {
  playerId: string;
  playerName: string;
  memberPlayerIds: string[];
  userId: string | null;
  linkSource: 'direct' | 'email' | null;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  paymentStatus: string | null;
  paymentCategory: Exclude<PaymentCategoryFilter, 'all'>;
  hasCurrentSeasonPlayer: boolean;
  teamId: string | null;
  teamName: string | null;
  seasonName: string | null;
  isCaptain: boolean;
  jerseyNumber: string | null;
  position: string | null;
  createdAt: string | null;
  hasAccount: boolean;
  waiverAccepted: boolean;
  waiverAcceptedAt: string | null;
  waiverDocumentPath: string | null;
  legacyInferredApproval: boolean;
};

type ClaimEmailTarget = {
  playerId: string;
  playerName: string;
  teamId: string | null;
  teamName: string | null;
  seasonName: string | null;
  email: string;
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const FILTER_SELECT_CLASS =
  'w-full h-11 appearance-none bg-black border border-white/20 rounded px-3 pr-11 dropdown-select-spacing text-white text-sm leading-none focus:outline-none focus:border-brand-lime/60';
const FILTER_SELECT_STYLE: React.CSSProperties = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 1.15rem center',
  backgroundSize: '12px 8px',
};

const normalizeStatus = (value: string | null | undefined) => {
  if (!value) return 'pending';
  const lower = value.toLowerCase();
  if (lower.includes('paid')) return 'paid';
  if (lower.includes('stripe')) return 'pending-stripe';
  if (lower.includes('pending')) return 'pending';
  return 'unknown';
};

const normalizeEmail = (value?: string | null) => (value || '').trim().toLowerCase();

const getDateValue = (value?: string | null) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const resolveSeasonLabel = (season: SeasonRow) => {
  if (season.name) return season.name;
  if (season.year) return `Season ${season.year}`;
  return 'Season';
};

const normalizePlayerNameKey = (firstNameRaw?: string | null, lastNameRaw?: string | null) => {
  let first = (firstNameRaw || '').trim();
  let last = (lastNameRaw || '').trim();

  // Some imports store full name in `first_name` only.
  if (!last && first.includes(' ')) {
    const parts = first.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      first = parts.shift() || '';
      last = parts.join(' ');
    }
  } else if (!first && last.includes(' ')) {
    const parts = last.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      first = parts.shift() || '';
      last = parts.join(' ');
    }
  }

  const firstKey = first.trim().toLowerCase();
  const lastKey = last.trim().toLowerCase();
  const combined = `${firstKey}|${lastKey}`.trim();
  return combined === '|' ? '' : combined;
};

type PlayerManagementProps = {
  defaultViewMode?: ViewMode;
  hideModeTabs?: boolean;
  title?: string;
};

const PlayerManagement: React.FC<PlayerManagementProps> = ({
  defaultViewMode = 'players',
  hideModeTabs = false,
  title = 'Player Management',
}) => {
  const sectionTitle = (title || 'Player Management').trim();
  const sectionTitleLower = sectionTitle.toLowerCase();
  const navigate = useNavigate();
  const user = useMemo(() => getStoredUser(), []);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [leads, setLeads] = useState<LeagueRegistrationLeadRow[]>([]);
  const [leadsUnavailable, setLeadsUnavailable] = useState(false);
  const [leadsLoadError, setLeadsLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [seasonFilter, setSeasonFilter] = useState<string>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentCategoryFilter>('all');
  const [claimFilter, setClaimFilter] = useState<ClaimStatusFilter>('all');
  const [showWithoutPlayer, setShowWithoutPlayer] = useState(true);
  const [showUnlinkedPlayers, setShowUnlinkedPlayers] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [emailSelectedLoading, setEmailSelectedLoading] = useState(false);
  const [emailSelectedMessage, setEmailSelectedMessage] = useState<string | null>(null);
  const [emailSelectedError, setEmailSelectedError] = useState<string | null>(null);
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false);
  const [emailDraftTargetIds, setEmailDraftTargetIds] = useState<Set<string>>(new Set());
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergePrimaryPlayerId, setMergePrimaryPlayerId] = useState<string>('');
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeIncludeNameMatches, setMergeIncludeNameMatches] = useState(false);
  const [unmergeModalOpen, setUnmergeModalOpen] = useState(false);
  const [unmergeKeepPlayerId, setUnmergeKeepPlayerId] = useState<string>('');
  const [unmergeBusy, setUnmergeBusy] = useState(false);
  const [unmergeError, setUnmergeError] = useState<string | null>(null);
  const [unmergeDetachIds, setUnmergeDetachIds] = useState<Set<string>>(new Set());
  const [unmergeAcknowledge, setUnmergeAcknowledge] = useState(false);
  const [leadActionBusyKey, setLeadActionBusyKey] = useState<string | null>(null);
  const [leadActionError, setLeadActionError] = useState<string | null>(null);
  const [leadActionSuccess, setLeadActionSuccess] = useState<string | null>(null);

  const isAdmin = user && (
    user.role === Role.ADMIN_FULL ||
    user.role === Role.ADMIN_MEDIA ||
    user.role === Role.ADMIN_SCOREKEEPER ||
    user.role === Role.ADMIN_COMMISSIONER
  );

  const loadProfiles = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id,display_name,email,email_address,phone,payment_status,created_at');
      if (error) throw error;
      return data || [];
    } catch (err) {
      if (!supabaseAdmin) throw err;
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('user_id,display_name,email,email_address,phone,payment_status,created_at');
      if (error) throw error;
      return data || [];
    }
  };

  const loadPlayers = async () => {
    const baseVariants = [
      'id,user_id,first_name,last_name,team_id,season_id,is_captain,created_at,jersey_number,position,payment_status,birth_date,waiver_accepted,waiver_accepted_at,waiver_document_path',
      'id,user_id,first_name,last_name,team_id,season_id,is_captain,created_at,jersey_number,position,payment_status,birth_date,waiver_accepted,waiver_accepted_at',
      'id,user_id,first_name,last_name,team_id,season_id,is_captain,created_at,jersey_number,position,payment_status,birth_date,waiver_accepted',
      'id,user_id,first_name,last_name,team_id,season_id,is_captain,created_at,jersey_number,position,payment_status,birth_date',
      'id,user_id,first_name,last_name,team_id,season_id,is_captain,created_at,jersey_number,position,payment_status',
      'id,user_id,first_name,last_name,team_id,season_id,is_captain,created_at,jersey_number,position',
      'id,user_id,first_name,last_name,team_id,season_id,is_captain,created_at,jersey_number',
      'id,user_id,first_name,last_name,team_id,season_id,is_captain,created_at',
      'id,user_id,first_name,last_name,team_id,season_id,created_at',
      'id,user_id,first_name,last_name,team_id,season_id',
    ];

    // Some deployments have extra/missing player columns, so progressively fall back.
    const variants = baseVariants.flatMap((base) => [
      `${base},email,email_address,phone`,
      `${base},email,phone`,
      `${base},email_address,phone`,
      `${base},phone`,
      base,
    ]);

    const isMissingColumn = (error: any) => {
      const code = (error?.code || '').toString();
      const msg = (error?.message || '').toString().toLowerCase();
      return code === '42703' || msg.includes('column') || msg.includes('does not exist');
    };

    const run = async (client: typeof supabase) => {
      let lastErr: any = null;
      for (const sel of variants) {
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

  const hasShortNameColumnError = (err: any) => {
    const code = (err?.code || '').toString();
    const msg = (err?.message || '').toString().toLowerCase();
    return code === '42703' || (msg.includes('short_name') && msg.includes('column'));
  };

  const fetchTeams = async (client: typeof supabase) => {
    try {
      const { data, error } = await client
        .from('teams')
        .select('id,name,division,short_name');
      if (error) throw error;
      return (data || []).map((row: TeamRow) => ({
        ...row,
        short_name: (row.short_name || null),
      }));
    } catch (err) {
      if (!hasShortNameColumnError(err)) {
        throw err;
      }
      const { data, error } = await client.from('teams').select('id,name,division');
      if (error) throw error;
      return (data || []).map((row: TeamRow) => ({
        ...row,
        short_name: null,
      }));
    }
  };

  const loadTeams = async () => {
    try {
      return await fetchTeams(supabase);
    } catch (err) {
      if (!supabaseAdmin) throw err;
      return await fetchTeams(supabaseAdmin);
    }
  };

  const loadSeasons = async () => {
    try {
      const { data, error } = await supabase
        .from('seasons')
        .select('id,name,year,is_current')
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (err) {
      if (!supabaseAdmin) throw err;
      const { data, error } = await supabaseAdmin
        .from('seasons')
        .select('id,name,year,is_current')
        .order('start_date', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  };

  const isMissingTableError = (err: any) => {
    const code = (err?.code || '').toString();
    const msg = (err?.message || '').toString().toLowerCase();
    return (
      code === '42P01' ||
      msg.includes('does not exist') ||
      msg.includes('schema cache') ||
      msg.includes('could not find the table')
    );
  };

  const loadLeads = async () => {
    const client = supabaseAdmin || supabase;
    const { data, error } = await client
      .from('league_registrations')
      .select(
        'id,registration_type,season_id,division_id,season_label,division_label,first_name,last_name,email,phone,team_name,payment_choice,status,submitted_at,completed_at,linked_user_id,linked_team_id,linked_player_id'
      )
      .order('submitted_at', { ascending: false });
    if (error) throw error;
    return (data || []) as LeagueRegistrationLeadRow[];
  };

  const loadAll = async () => {
    if (!isAdmin) {
      setError('Admins only.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [profileRows, playerRows, teamRows, seasonRows] = await Promise.all([
        loadProfiles(),
        loadPlayers(),
        loadTeams(),
        loadSeasons(),
      ]);
      setProfiles(profileRows);
      setPlayers(playerRows);
      setTeams(teamRows);
      setSeasons(seasonRows);

      try {
        const leadRows = await loadLeads();
        setLeads(leadRows);
        setLeadsUnavailable(false);
        setLeadsLoadError(null);
      } catch (leadErr: any) {
        if (isMissingTableError(leadErr)) {
          setLeads([]);
          setLeadsUnavailable(true);
          setLeadsLoadError(null);
        } else {
          console.warn('league_registrations load failed', leadErr);
          setLeads([]);
          setLeadsUnavailable(false);
          setLeadsLoadError(leadErr?.message || 'Failed to load registration leads.');
        }
      }
    } catch (err: any) {
      console.error('player management load error', err);
      setError(err?.message || `Failed to load ${sectionTitleLower} data.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [isAdmin]);

  useEffect(() => {
    setPage(1);
  }, [query, seasonFilter, teamFilter, paymentFilter, claimFilter, viewMode, showWithoutPlayer, showUnlinkedPlayers, pageSize]);

  useEffect(() => {
    setViewMode(defaultViewMode);
  }, [defaultViewMode]);

  const viewIsPlayers = viewMode === 'players';
  const viewIsUsers = viewMode === 'users';
  const viewIsPlayerLeads = viewMode === 'leads';
  const viewIsTeamLeads = viewMode === 'team-leads';
  const viewIsLeads = viewIsPlayerLeads || viewIsTeamLeads;

  const handleLeadPaymentSettled = async (
    lead: LeagueRegistrationLeadRow & { __resolvedUserId?: string | null },
    paymentChoice: Extract<LeaguePaymentChoice, 'full' | 'deposit'>
  ) => {
    if (!lead?.id) return;
    const busyKey = `${lead.id}:${paymentChoice}`;
    setLeadActionBusyKey(busyKey);
    setLeadActionError(null);
    setLeadActionSuccess(null);
    try {
      const result = await updateLeagueRegistrationLeadPayment(lead.id, paymentChoice);
      if (!result.saved) {
        throw new Error(result.error || 'Unable to update lead payment status.');
      }

      let completionNote = '';
      if (paymentChoice === 'full') {
        const client = (supabaseAdmin || supabase) as any;
        const leadEmail = normalizeEmail(lead.email);
        let syncedDuplicateCount = 0;
        const teamName = (lead.team_name || '').trim();
        const divisionLabel = (lead.division_label || '').trim();
        const isDivisionColumnMissing = (err: any) => {
          const code = (err?.code || '').toString();
          const msg = (err?.message || '').toString().toLowerCase();
          return code === '42703' || (msg.includes('division') && msg.includes('column'));
        };

        // Resolve account from email first so we don't trust stale linked ids on edited leads.
        let userId: string | null = null;
        let teamId: string | null = null;
        let playerId: string | null = null;

        if (leadEmail) {
          try {
            const { data: p1 } = await client
              .from('profiles')
              .select('user_id')
              .ilike('email', leadEmail)
              .limit(1)
              .maybeSingle();
            userId = p1?.user_id || null;
          } catch {}
          if (!userId) {
            try {
              const { data: p2 } = await client
                .from('profiles')
                .select('user_id')
                .ilike('email_address', leadEmail)
                .limit(1)
                .maybeSingle();
              userId = p2?.user_id || null;
            } catch {}
          }
          if (!userId && supabaseAdmin) {
            try {
              const { data: authUser } = await supabaseAdmin.auth.admin.getUserByEmail(leadEmail);
              userId = authUser?.user?.id || null;
            } catch {}
          }
        }
        if (!userId) userId = lead.__resolvedUserId || lead.linked_user_id || null;

        if (lead.registration_type === 'team' && teamName && lead.season_id) {
          let divisionColumnMissing = false;
          if (divisionLabel) {
            try {
              const { data: existingTeamByDivision, error: findDivisionErr } = await client
                .from('teams')
                .select('id')
                .eq('season_id', lead.season_id)
                .ilike('name', teamName)
                .eq('division', divisionLabel)
                .order('created_at', { ascending: false })
                .limit(1);
              if (findDivisionErr) throw findDivisionErr;
              if (existingTeamByDivision?.[0]?.id) teamId = existingTeamByDivision[0].id as string;
            } catch (err) {
              if (isDivisionColumnMissing(err)) {
                divisionColumnMissing = true;
              } else {
                throw err;
              }
            }
          }
          if (!teamId && (!divisionLabel || divisionColumnMissing)) {
            const { data: existingTeam } = await client
              .from('teams')
              .select('id')
              .eq('season_id', lead.season_id)
              .ilike('name', teamName)
              .order('created_at', { ascending: false })
              .limit(1);
            if (existingTeam?.[0]?.id) teamId = existingTeam[0].id as string;
          }
          if (!teamId) {
            try {
              const { data: createdTeam, error: createErr } = await client
                .from('teams')
                .insert({
                  name: teamName,
                  season_id: lead.season_id,
                  division: divisionLabel || null,
                })
                .select('id')
                .maybeSingle();
              if (createErr) throw createErr;
              teamId = createdTeam?.id || null;
            } catch (teamErr: any) {
              if (isDivisionColumnMissing(teamErr)) {
                const { data: createdTeam, error: retryErr } = await client
                  .from('teams')
                  .insert({
                    name: teamName,
                    season_id: lead.season_id,
                  })
                  .select('id')
                  .maybeSingle();
                if (retryErr) throw retryErr;
                teamId = createdTeam?.id || null;
              } else {
                const msg = (teamErr?.message || '').toLowerCase();
                if (msg.includes('duplicate key') || msg.includes('already exists')) {
                  const { data: existingTeam } = await client
                    .from('teams')
                    .select('id')
                    .eq('season_id', lead.season_id)
                    .ilike('name', teamName)
                    .order('created_at', { ascending: false })
                    .limit(1);
                  if (existingTeam?.[0]?.id) {
                    teamId = existingTeam[0].id as string;
                  } else {
                    throw teamErr;
                  }
                } else {
                  throw teamErr;
                }
              }
            }
          }
        }

        if (userId && lead.season_id) {
          if (lead.registration_type === 'team') {
            let existingPlayer: { id?: string; team_id?: string | null } | null = null;
            if (teamId) {
              const { data: sameTeamRows } = await client
                .from('players')
                .select('id,team_id')
                .eq('user_id', userId)
                .eq('season_id', lead.season_id)
                .eq('team_id', teamId)
                .order('created_at', { ascending: false })
                .limit(1);
              existingPlayer = sameTeamRows?.[0] || null;
            }

            if (existingPlayer?.id) {
              playerId = existingPlayer.id;
              const updatePayload: any = {};
              if (lead.first_name) updatePayload.first_name = lead.first_name;
              if (lead.last_name !== undefined) updatePayload.last_name = lead.last_name || '';
              if (Object.keys(updatePayload).length) {
                await client.from('players').update(updatePayload).eq('id', playerId);
              }
            } else {
              const { data: createdPlayer, error: createPlayerErr } = await client
                .from('players')
                .insert({
                  user_id: userId,
                  season_id: lead.season_id,
                  team_id: teamId,
                  first_name: lead.first_name || 'Player',
                  last_name: lead.last_name || '',
                })
                .select('id')
                .maybeSingle();
              if (createPlayerErr) throw createPlayerErr;
              playerId = createdPlayer?.id || null;
            }
          } else {
            const { data: existingFreeAgentRows } = await client
              .from('players')
              .select('id,team_id')
              .eq('user_id', userId)
              .eq('season_id', lead.season_id)
              .is('team_id', null)
              .order('created_at', { ascending: false })
              .limit(1);
            const existingFreeAgent = existingFreeAgentRows?.[0];
            if (existingFreeAgent?.id) {
              playerId = existingFreeAgent.id;
              const updatePayload: any = {};
              if (lead.first_name) updatePayload.first_name = lead.first_name;
              if (lead.last_name !== undefined) updatePayload.last_name = lead.last_name || '';
              if (Object.keys(updatePayload).length) {
                await client.from('players').update(updatePayload).eq('id', playerId);
              }
            } else {
              const { data: createdPlayer, error: createPlayerErr } = await client
                .from('players')
                .insert({
                  user_id: userId,
                  season_id: lead.season_id,
                  first_name: lead.first_name || 'Player',
                  last_name: lead.last_name || '',
                })
                .select('id')
                .maybeSingle();
              if (createPlayerErr) throw createPlayerErr;
              playerId = createdPlayer?.id || null;
            }
          }

          if (playerId && lead.registration_type === 'team') {
            try {
              await client.from('players').update({ is_captain: true }).eq('id', playerId);
            } catch {}
          }
          if (playerId) {
            try {
              await client.from('players').update({ payment_status: 'paid' }).eq('id', playerId);
            } catch {}
          }
          try {
            await client.from('profiles').update({ payment_status: 'paid' }).eq('user_id', userId);
          } catch {}
        }

        try {
          const completeResult = await markLeagueRegistrationLeadCompleted(lead.id, {
            userId: userId || null,
            teamId: teamId || null,
            playerId: playerId || null,
          });
          if (!completeResult.saved) {
            throw new Error(completeResult.error || 'Unable to mark lead completed.');
          }

          // If the same registrant submitted duplicate short-form leads,
          // sync them so admins only need to mark paid once.
          try {
            let duplicateQuery = client
              .from('league_registrations')
              .select('id,status')
              .neq('id', lead.id)
              .eq('season_id', lead.season_id)
              .eq('registration_type', lead.registration_type);
            if (leadEmail) {
              duplicateQuery = duplicateQuery.eq('email', leadEmail);
            }
            const normalizedTeamName = (lead.team_name || '').trim();
            if (lead.registration_type === 'team' && normalizedTeamName) {
              duplicateQuery = duplicateQuery.eq('team_name', normalizedTeamName);
              if (lead.division_id) {
                duplicateQuery = duplicateQuery.eq('division_id', lead.division_id);
              } else if (lead.division_label) {
                duplicateQuery = duplicateQuery.eq('division_label', lead.division_label);
              }
            }
            const { data: duplicateRows } = await duplicateQuery;
            for (const duplicate of duplicateRows || []) {
              const duplicateStatus = (duplicate?.status || '').toString().toLowerCase();
              if (duplicateStatus === 'completed') continue;
              const duplicateId = duplicate?.id;
              if (!duplicateId) continue;
              const dupPayment = await updateLeagueRegistrationLeadPayment(duplicateId, paymentChoice);
              if (!dupPayment.saved) {
                throw new Error(dupPayment.error || `Unable to update duplicate lead ${duplicateId}.`);
              }
              const dupComplete = await markLeagueRegistrationLeadCompleted(duplicateId, {
                userId: userId || null,
                teamId: teamId || null,
                playerId: playerId || null,
              });
              if (!dupComplete.saved) {
                throw new Error(dupComplete.error || `Unable to complete duplicate lead ${duplicateId}.`);
              }
              syncedDuplicateCount += 1;
            }
          } catch (dupErr) {
            console.warn('duplicate lead sync failed', dupErr);
          }

          if (playerId) {
            completionNote = ' Player/team linked to this account.';
          } else if (userId) {
            completionNote = ' Lead marked completed for this account.';
          } else {
            completionNote = ' Lead marked completed, but no account match was found.';
          }
          if (syncedDuplicateCount > 0) {
            completionNote += ` Synced ${syncedDuplicateCount} duplicate lead(s).`;
          }
        } catch (completeErr: any) {
          completionNote = ` Payment saved, but completion sync failed: ${completeErr?.message || 'Unknown error.'}`;
        }
      }

      await loadAll();
      setLeadActionSuccess(
        paymentChoice === 'full'
          ? `Lead updated: payment marked as Full.${completionNote}`
          : 'Lead updated: payment marked as Deposit.'
      );
    } catch (err: any) {
      setLeadActionError(err?.message || 'Failed to update lead payment.');
    } finally {
      setLeadActionBusyKey(null);
    }
  };

  useEffect(() => {
    // Selection only makes sense in Players view.
    if (!viewIsPlayers && selectedPlayerIds.size) {
      setSelectedPlayerIds(new Set());
    }
  }, [viewIsPlayers, selectedPlayerIds.size]);

  const profileMap = useMemo(() => {
    const map = new Map<string, ProfileRow>();
    profiles.forEach((p) => {
      if (p.user_id) map.set(p.user_id, p);
    });
    return map;
  }, [profiles]);

  const profileEmailUserMap = useMemo(() => {
    const buckets = new Map<string, Set<string>>();
    profiles.forEach((profile) => {
      if (!profile.user_id) return;
      const primary = normalizeEmail(profile.email);
      const secondary = normalizeEmail(profile.email_address);
      if (primary) {
        if (!buckets.has(primary)) buckets.set(primary, new Set<string>());
        buckets.get(primary)?.add(profile.user_id);
      }
      if (secondary) {
        if (!buckets.has(secondary)) buckets.set(secondary, new Set<string>());
        buckets.get(secondary)?.add(profile.user_id);
      }
    });
    const map = new Map<string, string>();
    buckets.forEach((userIds, email) => {
      if (userIds.size !== 1) return;
      const onlyId = Array.from(userIds)[0];
      if (onlyId) map.set(email, onlyId);
    });
    return map;
  }, [profiles]);

  const teamMap = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((t) => {
      if (t.id) map.set(t.id, t.name || 'Team');
    });
    return map;
  }, [teams]);

  const teamCodeMap = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((t) => {
      if (!t.id) return;
      const code = (t.short_name || '').trim().toUpperCase();
      if (code) {
        map.set(t.id, code);
      }
    });
    return map;
  }, [teams]);

  const seasonMap = useMemo(() => {
    const map = new Map<string, string>();
    seasons.forEach((s) => {
      if (s.id) map.set(s.id, resolveSeasonLabel(s));
    });
    return map;
  }, [seasons]);

  const playersByUser = useMemo(() => {
    const map = new Map<string, PlayerRow[]>();
    players.forEach((p) => {
      if (!p.user_id) return;
      if (!map.has(p.user_id)) map.set(p.user_id, []);
      map.get(p.user_id)?.push(p);
    });
    return map;
  }, [players]);

  const currentSeasonId = useMemo(() => {
    const current = seasons.find((s) => !!s.is_current);
    return current?.id || null;
  }, [seasons]);

  const resolvePaymentCategory = useCallback(
    (opts: {
      paymentStatus: string | null;
      hasAnyPlayer: boolean;
      hasCurrentSeasonPlayer: boolean;
    }): Exclude<PaymentCategoryFilter, 'all'> => {
      const raw = (opts.paymentStatus || '').toLowerCase();
      if (opts.hasAnyPlayer && currentSeasonId && !opts.hasCurrentSeasonPlayer) return 'inactive';
      if (raw.includes('jersey')) return 'jersey-pending';
      const normalized = normalizeStatus(opts.paymentStatus);
      if (normalized === 'paid') return 'active';
      return 'pending-payment';
    },
    [currentSeasonId]
  );

  const userRows = useMemo(() => {
    const seasonId = seasonFilter === 'all' ? null : seasonFilter;
    const mapped = profiles.map((profile) => {
      const list = playersByUser.get(profile.user_id) || [];
      const filtered = seasonId ? list.filter((p) => p.season_id === seasonId) : list;
      const primary = filtered.length
        ? filtered.reduce((latest, current) =>
            getDateValue(current.created_at) > getDateValue(latest.created_at) ? current : latest
          )
        : null;
      const displayName =
        profile.display_name ||
        (profile.email || profile.email_address || '').split('@')[0] ||
        'User';
      const playerName = primary
        ? `${primary.first_name || ''} ${primary.last_name || ''}`.trim() || 'Player'
        : null;
      const hasAnyPlayer = list.length > 0;
      const hasCurrentSeasonPlayer = currentSeasonId ? list.some((p) => p.season_id === currentSeasonId) : false;
      const paymentStatus = profile.payment_status || primary?.payment_status || null;
      return {
        userId: profile.user_id,
        displayName,
        email: profile.email || profile.email_address || null,
        phone: profile.phone || null,
        paymentStatus,
        paymentCategory: resolvePaymentCategory({ paymentStatus, hasAnyPlayer, hasCurrentSeasonPlayer }),
        playerId: primary?.id || null,
        playerName,
        playerCount: list.length,
        hasAnyPlayer,
        hasCurrentSeasonPlayer,
        teamId: primary?.team_id || null,
        teamName: primary?.team_id ? teamMap.get(primary.team_id) || 'Team' : null,
        seasonName: primary?.season_id ? seasonMap.get(primary.season_id) || 'Season' : null,
        isCaptain: !!primary?.is_captain,
      } as PlayerManagementUserRow;
    });

    return mapped.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [profiles, playersByUser, seasonFilter, teamMap, seasonMap, currentSeasonId, resolvePaymentCategory]);

  const playerRows = useMemo(() => {
    const seasonId = seasonFilter === 'all' ? null : seasonFilter;
    const filteredPlayers = seasonId ? players.filter((p) => p.season_id === seasonId) : players;
    const buildGroupKey = (player: PlayerRow) => {
      if (player.user_id) return `user:${player.user_id}`;
      const nameKey = normalizePlayerNameKey(player.first_name, player.last_name);
      if (!nameKey) return `player:${player.id}`;
      if (player.birth_date) return `name:${nameKey}|birth:${player.birth_date}`;
      return `name:${nameKey}`;
    };

    const grouped = new Map<string, { latest: PlayerRow; seasons: Set<string>; playerIds: Set<string> }>();
    filteredPlayers.forEach((player) => {
      if (seasonId) {
        const entry = { latest: player, seasons: new Set([player.season_id || '']), playerIds: new Set([player.id]) };
        grouped.set(player.id, entry);
        return;
      }
      const key = buildGroupKey(player);
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { latest: player, seasons: new Set([player.season_id || '']), playerIds: new Set([player.id]) });
        return;
      }
      if (player.season_id) existing.seasons.add(player.season_id);
      existing.playerIds.add(player.id);
      if (getDateValue(player.created_at) > getDateValue(existing.latest.created_at)) {
        existing.latest = player;
      }
    });

    const mapped = Array.from(grouped.values()).map(({ latest, seasons, playerIds }) => {
      const playerEmail = normalizeEmail((latest as any)?.email || (latest as any)?.email_address || null);
      const inferredUserId = !latest.user_id && playerEmail ? profileEmailUserMap.get(playerEmail) || null : null;
      const resolvedUserId = latest.user_id || inferredUserId || null;
      const profile = resolvedUserId ? profileMap.get(resolvedUserId) : null;
      const displayName =
        profile?.display_name ||
        (profile?.email || profile?.email_address || '').split('@')[0] ||
        null;
      const playerName = `${latest.first_name || ''} ${latest.last_name || ''}`.trim() || 'Player';
      const hasAccount = !!resolvedUserId;
      const linkSource: PlayerManagementPlayerRow['linkSource'] = latest.user_id
        ? 'direct'
        : resolvedUserId
        ? 'email'
        : null;
      const seasonLabel = latest.season_id ? seasonMap.get(latest.season_id) || 'Season' : null;
      const seasonCount = seasons.size;
      const seasonName = seasonCount > 1
        ? seasonLabel
          ? `Latest: ${seasonLabel} (${seasonCount})`
          : `Multiple seasons (${seasonCount})`
        : seasonLabel || 'No Season';
      const hasCurrentSeasonPlayer = currentSeasonId ? seasons.has(currentSeasonId) : false;
      const paymentStatus = profile?.payment_status || latest.payment_status || null;
      const playerEmailRaw = (latest as any)?.email || (latest as any)?.email_address || null;
      const playerPhone = (latest as any)?.phone || null;
      const legacyInferredApproval = !latest.waiver_accepted && !!resolvedUserId;
      const waiverAccepted = !!latest.waiver_accepted || legacyInferredApproval;
      const waiverAcceptedAt = latest.waiver_accepted_at || (waiverAccepted ? latest.created_at || null : null);
      const waiverDocumentPath = latest.waiver_document_path || (legacyInferredApproval ? 'legacy-registration-flow' : null);

      return {
        playerId: latest.id,
        playerName,
        memberPlayerIds: Array.from(playerIds),
        userId: resolvedUserId,
        linkSource,
        displayName,
        email: profile?.email || profile?.email_address || playerEmailRaw,
        phone: profile?.phone || playerPhone,
        paymentStatus,
        paymentCategory: resolvePaymentCategory({
          paymentStatus,
          hasAnyPlayer: true,
          hasCurrentSeasonPlayer,
        }),
        hasCurrentSeasonPlayer,
        teamId: latest.team_id || null,
        teamName: latest.team_id ? teamMap.get(latest.team_id) || 'Team' : null,
        seasonName,
        isCaptain: !!latest.is_captain,
        jerseyNumber: latest.jersey_number || null,
        position: latest.position || null,
        createdAt: latest.created_at || null,
        hasAccount,
        waiverAccepted,
        waiverAcceptedAt,
        waiverDocumentPath,
        legacyInferredApproval,
      } as PlayerManagementPlayerRow;
    });

    return mapped.sort((a, b) => a.playerName.localeCompare(b.playerName));
  }, [players, profileMap, profileEmailUserMap, seasonFilter, seasonMap, teamMap, currentSeasonId, resolvePaymentCategory]);

  const leadRows = useMemo(() => {
    const seasonId = seasonFilter === 'all' ? null : seasonFilter;
    const filtered = seasonId ? leads.filter((l) => l.season_id === seasonId) : leads;
    const normalizeText = (value?: string | null) => (value || '').trim().toLowerCase();
    return filtered.map((lead) => {
      const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Registrant';
      const status = (lead.status || '').toString().trim().toLowerCase() || 'submitted';
      const paymentChoice = (lead.payment_choice || '').toString().trim().toLowerCase();
      const hasRecordedPayment = paymentChoice === 'full' || paymentChoice === 'deposit';
      const leadEmail = normalizeEmail(lead.email);
      const resolvedUserId = lead.linked_user_id || (leadEmail ? profileEmailUserMap.get(leadEmail) || null : null);
      const hasDerivedLinkedPlayer =
        !!lead.linked_player_id ||
        (!!resolvedUserId &&
          players.some((player) => {
            if (player.user_id !== resolvedUserId) return false;
            if (lead.season_id && player.season_id !== lead.season_id) return false;
            if (lead.registration_type !== 'team' || !lead.team_name) return true;
            const playerTeamName = player.team_id ? teamMap.get(player.team_id) || '' : '';
            return normalizeText(playerTeamName) === normalizeText(lead.team_name);
          }));
      const effectiveStatus =
        status === 'completed' || hasDerivedLinkedPlayer ? 'completed' : status;
      const paymentCategory: Exclude<PaymentCategoryFilter, 'all'> =
        effectiveStatus === 'completed' || hasRecordedPayment ? 'active' : 'pending-payment';
      return {
        ...lead,
        hasAccount: !!resolvedUserId,
        __resolvedUserId: resolvedUserId,
        __fullName: fullName,
        __status: effectiveStatus,
        __paymentCategory: paymentCategory,
      };
    });
  }, [leads, seasonFilter, profileEmailUserMap, players, teamMap]);

  const openLeadRows = useMemo(() => {
    return leadRows.filter((row: any) => {
      const paymentChoice = (row.payment_choice || '').toString().trim().toLowerCase();
      // Keep the queue focused on unresolved leads only.
      if (row.__status === 'completed') return false;
      if (paymentChoice === 'full') return false;
      return true;
    });
  }, [leadRows]);

  const openTeamLeadRows = useMemo(
    () => openLeadRows.filter((row: any) => (row.registration_type || '').toString().trim().toLowerCase() === 'team'),
    [openLeadRows]
  );

  const openPlayerLeadRows = useMemo(
    () => openLeadRows.filter((row: any) => (row.registration_type || '').toString().trim().toLowerCase() !== 'team'),
    [openLeadRows]
  );

  const activeOpenLeadRows = useMemo(
    () => (viewIsTeamLeads ? openTeamLeadRows : openPlayerLeadRows),
    [openPlayerLeadRows, openTeamLeadRows, viewIsTeamLeads]
  );

  const leadStats = useMemo(() => {
    const total = activeOpenLeadRows.length;
    const deposit = activeOpenLeadRows.filter((r: any) => (r.payment_choice || '').toString().trim().toLowerCase() === 'deposit').length;
    const pending = total - deposit;
    return { total, deposit, pending };
  }, [activeOpenLeadRows]);

  const userStats = useMemo(() => {
    const total = userRows.length;
    const withPlayer = userRows.filter((r) => !!r.playerId).length;
    const withoutPlayer = total - withPlayer;
    return { total, withPlayer, withoutPlayer };
  }, [userRows]);

  const playerStats = useMemo(() => {
    const total = playerRows.length;
    const linked = playerRows.filter((r) => r.hasAccount).length;
    const unlinked = total - linked;
    return { total, linked, unlinked };
  }, [playerRows]);

  const teamFilterOptions = useMemo<TeamFilterOption[]>(() => {
    const seasonId = seasonFilter === 'all' ? null : seasonFilter;
    const byId = new Map<string, TeamFilterOption>();
    players.forEach((player) => {
      const teamId = player.team_id || null;
      if (!teamId) return;
      if (seasonId && player.season_id !== seasonId) return;
      if (byId.has(teamId)) return;
      const teamName = teamMap.get(teamId) || 'Team';
      let label = teamName;
      if (!seasonId && player.season_id) {
        const seasonLabel = seasonMap.get(player.season_id);
        if (seasonLabel) label = `${teamName} (${seasonLabel})`;
      }
      byId.set(teamId, { id: teamId, label });
    });
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [players, seasonFilter, seasonMap, teamMap]);

  useEffect(() => {
    if (teamFilter === 'all') return;
    const exists = teamFilterOptions.some((option) => option.id === teamFilter);
    if (!exists) setTeamFilter('all');
  }, [teamFilter, teamFilterOptions]);

  const filteredUserRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return userRows.filter((row) => {
      if (!showWithoutPlayer && !row.playerId) return false;
      if (teamFilter !== 'all' && row.teamId !== teamFilter) return false;
      if (paymentFilter !== 'all' && row.paymentCategory !== paymentFilter) return false;
      const matchQuery =
        !q ||
        row.displayName.toLowerCase().includes(q) ||
        (row.email || '').toLowerCase().includes(q) ||
        (row.playerName || '').toLowerCase().includes(q) ||
        (row.teamName || '').toLowerCase().includes(q) ||
        (row.seasonName || '').toLowerCase().includes(q);
      return matchQuery;
    });
  }, [userRows, query, showWithoutPlayer, teamFilter, paymentFilter]);

  const filteredPlayerRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return playerRows.filter((row) => {
      if (claimFilter === 'claimed' && !row.hasAccount) return false;
      if (claimFilter === 'unclaimed' && row.hasAccount) return false;
      if (claimFilter === 'all' && !showUnlinkedPlayers && !row.hasAccount) return false;
      if (teamFilter !== 'all' && row.teamId !== teamFilter) return false;
      if (paymentFilter !== 'all' && row.paymentCategory !== paymentFilter) return false;
      const matchQuery =
        !q ||
        row.playerName.toLowerCase().includes(q) ||
        (row.displayName || '').toLowerCase().includes(q) ||
        (row.email || '').toLowerCase().includes(q) ||
        (row.teamName || '').toLowerCase().includes(q) ||
        (row.seasonName || '').toLowerCase().includes(q);
      return matchQuery;
    });
  }, [playerRows, query, showUnlinkedPlayers, teamFilter, paymentFilter, claimFilter]);

  const filteredWaiverAuditRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players.filter((player) => {
      if (seasonFilter !== 'all' && player.season_id !== seasonFilter) return false;
      if (teamFilter !== 'all' && player.team_id !== teamFilter) return false;

      const playerName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Player';
      const playerEmail = normalizeEmail((player as any)?.email || (player as any)?.email_address || '');
      const resolvedUserId =
        player.user_id || (playerEmail ? profileEmailUserMap.get(playerEmail) || null : null);
      const profile = resolvedUserId ? profileMap.get(resolvedUserId) : null;
      const displayName = profile?.display_name || '';
      const teamName = player.team_id ? teamMap.get(player.team_id) || 'Team' : 'No Team';
      const seasonName = player.season_id ? seasonMap.get(player.season_id) || 'Season' : 'No Season';

      return (
        !q ||
        playerName.toLowerCase().includes(q) ||
        displayName.toLowerCase().includes(q) ||
        (playerEmail || '').toLowerCase().includes(q) ||
        teamName.toLowerCase().includes(q) ||
        seasonName.toLowerCase().includes(q)
      );
    });
  }, [players, profileEmailUserMap, profileMap, query, seasonFilter, seasonMap, teamFilter, teamMap]);

  const filteredLeadRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return activeOpenLeadRows.filter((row: any) => {
      if (paymentFilter !== 'all' && row.__paymentCategory !== paymentFilter) return false;
      const matchQuery =
        !q ||
        (row.__fullName || '').toLowerCase().includes(q) ||
        (row.email || '').toLowerCase().includes(q) ||
        (row.phone || '').toLowerCase().includes(q) ||
        (row.team_name || '').toLowerCase().includes(q) ||
        (row.season_label || '').toLowerCase().includes(q) ||
        (row.division_label || '').toLowerCase().includes(q) ||
        (row.id || '').toLowerCase().includes(q);
      return matchQuery;
    });
  }, [activeOpenLeadRows, query, paymentFilter]);

  const statusClass = (status: string | null) => {
    const normalized = normalizeStatus(status);
    if (normalized === 'paid') return 'border-emerald-400/60 text-emerald-100 bg-emerald-500/15';
    if (normalized === 'pending-stripe') return 'border-blue-400/60 text-blue-100 bg-blue-500/15';
    if (normalized === 'pending') return 'border-amber-300/70 text-amber-100 bg-amber-500/10';
    return 'border-gray-500/60 text-gray-300 bg-white/5';
  };

  const totalRows = viewIsPlayers
    ? filteredPlayerRows.length
    : viewIsLeads
    ? filteredLeadRows.length
    : filteredUserRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = totalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIndex = Math.min(currentPage * pageSize, totalRows);
  const pagedPlayerRows = filteredPlayerRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pagedUserRows = filteredUserRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pagedLeadRows = filteredLeadRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  type PageEntry = number | 'ellipsis';
  const paginationPages = useMemo<PageEntry[]>(() => {
    const pages: PageEntry[] = [];
    const windowSize = Math.min(5, totalPages);
    let start = Math.max(1, currentPage - 2);
    let end = Math.min(totalPages, currentPage + 2);

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
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!viewIsPlayers || selectedPlayerIds.size === 0) return;
    const visibleIds = new Set(filteredPlayerRows.map((row) => row.playerId));
    let changed = false;
    const next = new Set<string>();
    selectedPlayerIds.forEach((id) => {
      if (visibleIds.has(id)) {
        next.add(id);
      } else {
        changed = true;
      }
    });
    if (changed) {
      setSelectedPlayerIds(next);
    }
  }, [filteredPlayerRows, selectedPlayerIds, viewIsPlayers]);

  const csvEscape = (value: string) => {
    const text = value ?? '';
    if (/[,"\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const downloadCsv = (filename: string, rows: string[][]) => {
    const content = rows.map((row) => row.map((cell) => csvEscape(cell)).join(',')).join('\r\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportEmails = () => {
    // Export deduped emails from the current view + filters (not just the current page).
    // This matches "from this page", and lets admins filter by season first if desired.
    const emailMap = new Map<string, { email: string; displayName: string; playerName: string; userId: string; playerId: string }>();

    if (viewIsPlayers) {
      filteredPlayerRows.forEach((row) => {
        const email = (row.email || '').trim();
        if (!email) return;
        const key = email.toLowerCase();
        if (emailMap.has(key)) return;
        emailMap.set(key, {
          email,
          displayName: row.displayName || '',
          playerName: row.playerName || '',
          userId: row.userId || '',
          playerId: row.playerId || '',
        });
      });
    } else if (viewIsLeads) {
      filteredLeadRows.forEach((row: any) => {
        const email = (row.email || '').trim();
        if (!email) return;
        const key = email.toLowerCase();
        if (emailMap.has(key)) return;
        emailMap.set(key, {
          email,
          displayName: row.__fullName || '',
          playerName: '',
          userId: row.linked_user_id || '',
          playerId: row.linked_player_id || '',
        });
      });
    } else {
      filteredUserRows.forEach((row) => {
        const email = (row.email || '').trim();
        if (!email) return;
        const key = email.toLowerCase();
        if (emailMap.has(key)) return;
        emailMap.set(key, {
          email,
          displayName: row.displayName || '',
          playerName: row.playerName || '',
          userId: row.userId || '',
          playerId: row.playerId || '',
        });
      });
    }

    const rows: string[][] = [
      ['email', 'display_name', 'player_name', 'user_id', 'player_id'],
      ...Array.from(emailMap.values())
        .sort((a, b) => a.email.localeCompare(b.email))
        .map((r) => [r.email, r.displayName, r.playerName, r.userId, r.playerId]),
    ];

    const stamp = new Date().toISOString().slice(0, 10);
    const mode = viewIsPlayers
      ? 'players'
      : viewIsTeamLeads
      ? 'team-leads'
      : viewIsPlayerLeads
      ? 'player-leads'
      : 'users';
    downloadCsv(`courtsight-${mode}-emails-${stamp}.csv`, rows);
  };

  const exportRegistrations = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const mode = viewIsPlayers
      ? 'players'
      : viewIsTeamLeads
      ? 'team-leads'
      : viewIsPlayerLeads
      ? 'player-leads'
      : 'users';
    const filterTag = paymentFilter === 'all' ? 'all' : paymentFilter;

    if (viewIsPlayers) {
      const rows: string[][] = [
        ['player_id', 'player_name', 'user_id', 'display_name', 'email', 'phone', 'team', 'season', 'payment_status', 'payment_category', 'waiver_status', 'waiver_accepted_at'],
        ...filteredPlayerRows
          .slice()
          .sort((a, b) => a.playerName.localeCompare(b.playerName))
          .map((r) => [
            r.playerId,
            r.playerName,
            r.userId || '',
            r.displayName || '',
            r.email || '',
            r.phone || '',
            r.teamName || '',
            r.seasonName || '',
            r.paymentStatus || '',
            r.paymentCategory,
            r.waiverAccepted ? 'accepted' : 'missing',
            r.waiverAcceptedAt || '',
          ]),
      ];
      downloadCsv(`courtsight-${mode}-registrations-${filterTag}-${stamp}.csv`, rows);
      return;
    }

    if (viewIsLeads) {
      const rows: string[][] = [
        [
          'lead_id',
          'full_name',
          'email',
          'phone',
          'registration_type',
          'team_name',
          'season_label',
          'division_label',
          'payment_choice',
          'status',
          'submitted_at',
          'linked_user_id',
          'linked_team_id',
          'linked_player_id',
          'payment_category',
        ],
        ...filteredLeadRows
          .slice()
          .map((r: any) => [
            r.id,
            r.__fullName || '',
            r.email || '',
            r.phone || '',
            r.registration_type || '',
            r.team_name || '',
            r.season_label || '',
            r.division_label || '',
            r.payment_choice || '',
            r.status || '',
            r.submitted_at || '',
            r.linked_user_id || '',
            r.linked_team_id || '',
            r.linked_player_id || '',
            r.__paymentCategory || '',
          ]),
      ];
      downloadCsv(`courtsight-${mode}-registrations-${filterTag}-${stamp}.csv`, rows);
      return;
    }

    const rows: string[][] = [
      ['user_id', 'display_name', 'email', 'phone', 'payment_status', 'payment_category', 'player_count', 'player_id', 'player_name', 'team', 'season'],
      ...filteredUserRows
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((r) => [
          r.userId,
          r.displayName,
          r.email || '',
          r.phone || '',
          r.paymentStatus || '',
          r.paymentCategory,
          String(r.playerCount || 0),
          r.playerId || '',
          r.playerName || '',
          r.teamName || '',
          r.seasonName || '',
        ]),
    ];
    downloadCsv(`courtsight-${mode}-registrations-${filterTag}-${stamp}.csv`, rows);
  };

  const exportWaiverAudit = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const rows: string[][] = [
      [
        'player_id',
        'player_name',
        'user_id',
        'display_name',
        'email',
        'team',
        'season',
        'waiver_status',
        'waiver_accepted_at',
        'waiver_document_path',
        'player_created_at',
      ],
      ...filteredWaiverAuditRows
        .slice()
        .sort((a, b) => {
          const byWaiverDate = getDateValue(b.waiver_accepted_at) - getDateValue(a.waiver_accepted_at);
          if (byWaiverDate !== 0) return byWaiverDate;
          return getDateValue(b.created_at) - getDateValue(a.created_at);
        })
        .map((player) => {
          const playerName = `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'Player';
          const playerEmail = normalizeEmail((player as any)?.email || (player as any)?.email_address || '');
          const resolvedUserId =
            player.user_id || (playerEmail ? profileEmailUserMap.get(playerEmail) || null : null);
          const profile = resolvedUserId ? profileMap.get(resolvedUserId) : null;
          const displayName = profile?.display_name || '';
          return [
            player.id,
            playerName,
            resolvedUserId || '',
            displayName,
            profile?.email || profile?.email_address || playerEmail || '',
            player.team_id ? teamMap.get(player.team_id) || 'Team' : '',
            player.season_id ? seasonMap.get(player.season_id) || 'Season' : '',
            player.waiver_accepted ? 'accepted' : 'missing',
            player.waiver_accepted_at || '',
            player.waiver_document_path || '',
            player.created_at || '',
          ];
        }),
    ];
    downloadCsv(`courtsight-waiver-audit-${stamp}.csv`, rows);
  };

  const toggleSelected = (playerId: string) => {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      const pageIds = pagedPlayerRows.map((r) => r.playerId);
      const allSelected = pageIds.every((id) => next.has(id));
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const selectedPlayerRows = useMemo(() => {
    if (!viewIsPlayers || selectedPlayerIds.size === 0) return [];
    return filteredPlayerRows.filter((row) => selectedPlayerIds.has(row.playerId));
  }, [filteredPlayerRows, selectedPlayerIds, viewIsPlayers]);

  const selectedClaimInviteTargets = useMemo(() => {
    if (!viewIsPlayers) return [];
    return selectedPlayerRows
      .map((row) => {
        if (row.hasAccount) return null;
        const email = normalizeEmail(row.email);
        if (!email) return null;
        return {
          playerId: row.playerId,
          playerName: row.playerName,
          teamId: row.teamId,
          teamName: row.teamName,
          seasonName: row.seasonName,
          email,
        };
      })
      .filter((target): target is ClaimEmailTarget => Boolean(target));
  }, [selectedPlayerRows, viewIsPlayers]);

  const emailDraftTargets = useMemo(() => {
    if (!emailDraftTargetIds.size) return [];
    return selectedClaimInviteTargets.filter((target) => emailDraftTargetIds.has(target.playerId));
  }, [selectedClaimInviteTargets, emailDraftTargetIds]);

  const allDraftTargetsSelected = useMemo(() => {
    return (
      selectedClaimInviteTargets.length > 0 &&
      selectedClaimInviteTargets.every((target) => emailDraftTargetIds.has(target.playerId))
    );
  }, [selectedClaimInviteTargets, emailDraftTargetIds]);

  const openEmailSelectedModal = useCallback(() => {
    if (emailSelectedLoading) return;
    if (!selectedClaimInviteTargets.length) {
      setEmailSelectedMessage('Select non-user players with email addresses to send invites.');
      setEmailSelectedError(null);
      return;
    }
    setEmailSelectedMessage(null);
    setEmailSelectedError(null);
    setEmailDraftTargetIds(new Set(selectedClaimInviteTargets.map((target) => target.playerId)));
    setEmailConfirmOpen(true);
  }, [emailSelectedLoading, selectedClaimInviteTargets]);

  const closeEmailSelectedModal = useCallback(() => {
    if (emailSelectedLoading) return;
    setEmailConfirmOpen(false);
    setEmailDraftTargetIds(new Set());
  }, [emailSelectedLoading]);

  const toggleEmailDraftTarget = useCallback((playerId: string) => {
    setEmailDraftTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }, []);

  const handleEmailSelectedPlayers = useCallback(async () => {
    if (emailSelectedLoading) return;
    if (!emailDraftTargets.length) {
      setEmailSelectedError('Select at least 1 player to send a claim invite.');
      setEmailSelectedMessage(null);
      return;
    }
    setEmailSelectedMessage(null);
    setEmailSelectedError(null);
    setEmailSelectedLoading(true);
    try {
      let sentCount = 0;
      let failureCount = 0;
      let firstFailureReason = '';
      for (const target of emailDraftTargets) {
        const teamName = target.teamName || 'Courtsight League';
        const teamCode = target.teamId ? teamCodeMap.get(target.teamId) || null : null;
        const inviteLink = buildPlayerPortalUrl(target.teamId, target.email, teamCode);
        try {
          await sendPlayerClaimEmail({
            playerId: target.playerId,
            email: target.email,
            playerName: target.playerName,
            teamName,
            teamId: target.teamId,
            teamCode,
            seasonName: target.seasonName,
            inviteLink,
          });
          sentCount += 1;
        } catch (sendErr: any) {
          failureCount += 1;
          if (!firstFailureReason) {
            firstFailureReason = String(sendErr?.message || '').trim();
          }
        }
      }
      if (sentCount) {
        setEmailSelectedMessage(`Invite emails queued for ${sentCount} selected non-user player${sentCount === 1 ? '' : 's'}.`);
      } else {
        setEmailSelectedMessage('No invitation emails were queued.');
      }
      if (failureCount) {
        const summary = `${failureCount} invitation email${failureCount === 1 ? '' : 's'} failed to send.`;
        setEmailSelectedError(firstFailureReason ? `${summary} First error: ${firstFailureReason}` : summary);
      }
      setEmailConfirmOpen(false);
      setEmailDraftTargetIds(new Set());
    } catch (err: any) {
      setEmailSelectedError(err?.message || 'Failed to send invite emails to selected players.');
    } finally {
      setEmailSelectedLoading(false);
    }
  }, [emailSelectedLoading, emailDraftTargets, teamCodeMap]);

  useEffect(() => {
    if (!selectedClaimInviteTargets.length) {
      setEmailSelectedMessage(null);
      setEmailSelectedError(null);
      setEmailConfirmOpen(false);
      setEmailDraftTargetIds(new Set());
    }
  }, [selectedClaimInviteTargets.length]);

  useEffect(() => {
    if (!emailConfirmOpen) return;
    const availableIds = new Set(selectedClaimInviteTargets.map((target) => target.playerId));
    setEmailDraftTargetIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (availableIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [emailConfirmOpen, selectedClaimInviteTargets]);

  const openMergeModal = () => {
    setMergeError(null);
    if (!selectedPlayerIds.size) return;
    const selected = playerRows.filter((row) => selectedPlayerIds.has(row.playerId));
    const primaryCandidate = selected.find((r) => r.hasAccount)?.playerId || '';
    setMergePrimaryPlayerId(primaryCandidate);
    setMergeIncludeNameMatches(false);
    setMergeModalOpen(true);
  };

  const closeMergeModal = () => {
    if (mergeBusy) return;
    setMergeModalOpen(false);
    setMergePrimaryPlayerId('');
    setMergeError(null);
    setMergeIncludeNameMatches(false);
  };

  const performMerge = async () => {
    if (mergeBusy) return;
    setMergeError(null);

    const selected = playerRows.filter((row) => selectedPlayerIds.has(row.playerId));
    if (selected.length < 2) {
      setMergeError('Select at least 2 players to merge.');
      return;
    }

    const primaryRow = selected.find((r) => r.playerId === mergePrimaryPlayerId) || null;
    const primaryUserId = primaryRow?.userId || null;
    if (!primaryRow || !primaryUserId) {
      setMergeError('Pick a primary player that has a linked user account.');
      return;
    }

    const selectedIds = Array.from(new Set(selected.flatMap((r) => r.memberPlayerIds || [r.playerId])));
    let playerIdsToUpdate = selectedIds;

    if (mergeIncludeNameMatches) {
      const primaryPlayerRow = players.find((p) => p.id === primaryRow.playerId) || null;
      const primaryBirth = (primaryPlayerRow?.birth_date || '').trim();
      const primaryKey = normalizePlayerNameKey(
        primaryPlayerRow?.first_name ?? primaryRow.playerName,
        primaryPlayerRow?.last_name ?? null
      );
      if (!primaryKey) {
        setMergeError('Unable to determine primary player name for matching.');
        return;
      }
      // Safety rail: name-only matching is too risky (common names). Require a birthdate on the primary.
      if (!primaryBirth) {
        setMergeError(
          "Primary player is missing a birthdate. Auto-merge by name is disabled without birthdate to prevent pulling in another person's stats. Add birthdate first, then retry."
        );
        return;
      }
      const nameMatchIds = players
        .filter((p) => !p.user_id) // only pull in unlinked rows
        .filter((p) => normalizePlayerNameKey(p.first_name, p.last_name) === primaryKey)
        .filter((p) => String(p.birth_date || '').trim() === primaryBirth)
        .map((p) => p.id);
      playerIdsToUpdate = Array.from(new Set([...selectedIds, ...nameMatchIds]));
    }

    setMergeBusy(true);
    try {
      // Merge strategy:
      // - Keep all player rows (season/team history stays intact).
      // - Point all selected players to the same `user_id` so PlayerProfile aggregates them.
      const client = supabaseAdmin || supabase;
      const { error: updErr } = await client
        .from('players')
        .update({ user_id: primaryUserId })
        .in('id', playerIdsToUpdate);
      if (updErr) throw updErr;

      await loadAll();
      setSelectedPlayerIds(new Set());
      closeMergeModal();
    } catch (err: any) {
      console.error('merge players failed', err);
      setMergeError(err?.message || 'Merge failed. Check RLS / admin service key.');
    } finally {
      setMergeBusy(false);
    }
  };

  const selectedLinkedUserIds = useMemo(() => {
    const ids = selectedPlayerRows.map((r) => r.userId).filter((id): id is string => !!id);
    return new Set(ids);
  }, [selectedPlayerRows]);

  const canUnmerge =
    viewIsPlayers &&
    selectedPlayerRows.length >= 1 &&
    selectedLinkedUserIds.size === 1 &&
    selectedPlayerRows.some((row) => (row.memberPlayerIds || []).length > 1);

  const openUnmergeModal = () => {
    setUnmergeError(null);
    if (!canUnmerge) {
      setUnmergeError('Select a merged row (one that shows multiple profiles) to unmerge.');
      setUnmergeModalOpen(true);
      return;
    }

    const keepCandidate =
      selectedPlayerRows.find((r) => (r.memberPlayerIds || []).length > 1)?.playerId ||
      selectedPlayerRows[0]?.playerId ||
      '';

    // Default: detach everything except the selected "keep" player row.
    const allIds = Array.from(
      new Set(selectedPlayerRows.flatMap((r) => r.memberPlayerIds || [r.playerId]))
    );
    setUnmergeKeepPlayerId(keepCandidate);
    setUnmergeDetachIds(new Set(allIds.filter((id) => id !== keepCandidate)));
    setUnmergeAcknowledge(false);
    setUnmergeModalOpen(true);
  };

  const closeUnmergeModal = () => {
    if (unmergeBusy) return;
    setUnmergeModalOpen(false);
    setUnmergeKeepPlayerId('');
    setUnmergeError(null);
    setUnmergeDetachIds(new Set());
    setUnmergeAcknowledge(false);
  };

  const unmergeCandidateIds = useMemo(() => {
    if (!unmergeModalOpen || !canUnmerge) return [];
    const allIds = Array.from(
      new Set(selectedPlayerRows.flatMap((r) => r.memberPlayerIds || [r.playerId]))
    );
    return allIds;
  }, [canUnmerge, selectedPlayerRows, unmergeModalOpen]);

  const unmergeCandidates = useMemo(() => {
    if (!unmergeCandidateIds.length) return [];
    return unmergeCandidateIds
      .map((id) => players.find((p) => p.id === id) || null)
      .filter((p): p is PlayerRow => !!p);
  }, [players, unmergeCandidateIds]);

  const formatPlayerName = (p: PlayerRow) => {
    const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    return name || 'Player';
  };

  const performUnmerge = async () => {
    if (unmergeBusy) return;
    setUnmergeError(null);

    if (!canUnmerge) {
      setUnmergeError('Select at least 2 player rows that are linked to the same account.');
      return;
    }

    const keepRow = selectedPlayerRows.find((r) => r.playerId === unmergeKeepPlayerId) || null;
    if (!keepRow || !keepRow.userId) {
      setUnmergeError('Choose which player row should stay linked to the account.');
      return;
    }

    const detachIds = Array.from(unmergeDetachIds).filter((id) => id && id !== keepRow.playerId);

    if (!detachIds.length) {
      setUnmergeError('Select at least 1 profile to detach.');
      return;
    }

    if (!unmergeAcknowledge) {
      setUnmergeError('Confirm the unmerge acknowledgement before proceeding.');
      return;
    }

    setUnmergeBusy(true);
    try {
      const client = supabaseAdmin || supabase;
      const { error: updErr } = await client.from('players').update({ user_id: null }).in('id', detachIds);
      if (updErr) throw updErr;

      await loadAll();
      setSelectedPlayerIds(new Set());
      closeUnmergeModal();
    } catch (err: any) {
      console.error('unmerge players failed', err);
      setUnmergeError(err?.message || 'Unmerge failed. Check RLS / admin service key.');
    } finally {
      setUnmergeBusy(false);
    }
  };

  if (loading) {
    return <div className="text-gray-400 text-sm">Loading {sectionTitleLower}...</div>;
  }

  if (error) {
    return <div className="text-brand-red text-sm">{error}</div>;
  }

  const headerCopy = viewIsPlayers
    ? 'Rostered players with linked user credentials (if available).'
    : viewIsUsers
    ? 'All users with linked player profiles and credentials.'
    : viewIsTeamLeads
    ? 'Team registration submissions (short form leads).'
    : 'Player registration submissions (short form leads).';
  const searchPlaceholder = viewIsPlayers
    ? 'Search player, user, team'
    : viewIsUsers
    ? 'Search user, email, team'
    : viewIsTeamLeads
    ? 'Search captain, email, phone, team, season'
    : 'Search player, email, phone, season';
  const modalRoot = typeof document !== 'undefined' ? document.body : null;

  return (
    <div className="animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h2 className="font-sports text-2xl text-white uppercase">{title}</h2>
          <p className="text-xs text-gray-400">{headerCopy}</p>
        </div>
        <div className="flex flex-col gap-2 items-start md:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {!hideModeTabs && (
              <div className="flex bg-black/40 border border-white/10 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('players')}
                  className={`px-3 py-1.5 text-xs uppercase rounded ${
                    viewIsPlayers ? 'bg-brand-lime text-black font-bold' : 'text-gray-300 hover:text-white'
                  }`}
                >
                  Players
                </button>
                <button
                  onClick={() => setViewMode('users')}
                  className={`px-3 py-1.5 text-xs uppercase rounded ${
                    viewIsUsers ? 'bg-brand-lime text-black font-bold' : 'text-gray-300 hover:text-white'
                  }`}
                >
                  Users
                </button>
                <button
                  onClick={() => setViewMode('leads')}
                  className={`px-3 py-1.5 text-xs uppercase rounded ${
                    viewIsPlayerLeads ? 'bg-brand-lime text-black font-bold' : 'text-gray-300 hover:text-white'
                  }`}
                >
                  Player Leads
                </button>
              </div>
            )}
            {viewIsPlayers && (
              <button
                onClick={openMergeModal}
                disabled={selectedPlayerIds.size < 2}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-white/5 border border-white/10 text-xs uppercase text-white hover:border-brand-lime disabled:opacity-50 disabled:hover:border-white/10"
                title={selectedPlayerIds.size < 2 ? 'Select at least 2 players to merge' : 'Merge selected players'}
              >
                Merge Players{selectedPlayerIds.size ? ` (${selectedPlayerIds.size})` : ''}
              </button>
            )}
            {viewIsPlayers && (
              <button
                onClick={openUnmergeModal}
                disabled={!canUnmerge}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-white/5 border border-white/10 text-xs uppercase text-white hover:border-brand-lime disabled:opacity-50 disabled:hover:border-white/10"
                title={canUnmerge ? 'Unmerge selected players' : 'Select 2+ linked rows from the same account to unmerge'}
              >
                Unmerge Players{selectedPlayerIds.size ? ` (${selectedPlayerIds.size})` : ''}
              </button>
            )}
            {viewIsPlayers && (
              <button
                onClick={openEmailSelectedModal}
                disabled={emailSelectedLoading || !selectedClaimInviteTargets.length}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-white/5 border border-white/10 text-xs uppercase text-white hover:border-brand-lime disabled:opacity-50 disabled:hover:border-white/10"
                title="Select non-user players with email addresses to send claim invites"
              >
                {emailSelectedLoading
                  ? 'Sending selected emails...'
                  : `Email selected non-user players${selectedClaimInviteTargets.length ? ` (${selectedClaimInviteTargets.length})` : ''}`}
              </button>
            )}
            <button
              onClick={exportEmails}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-white/5 border border-white/10 text-xs uppercase text-white hover:border-brand-lime"
            >
              Export Emails
            </button>
            <button
              onClick={exportRegistrations}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-white/5 border border-white/10 text-xs uppercase text-white hover:border-brand-lime"
            >
              Export Registrations
            </button>
            {viewIsPlayers && (
              <button
                onClick={exportWaiverAudit}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-white/5 border border-white/10 text-xs uppercase text-white hover:border-brand-lime"
              >
                Export Waiver Audit
              </button>
            )}
            <button
              onClick={loadAll}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-white/5 border border-white/10 text-xs uppercase text-white hover:border-brand-lime"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
          {(emailSelectedMessage || emailSelectedError) && (
            <div className="flex flex-col gap-1 text-xs items-end">
              {emailSelectedMessage && <div className="text-brand-lime">{emailSelectedMessage}</div>}
              {emailSelectedError && <div className="text-brand-red">{emailSelectedError}</div>}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {viewIsLeads ? (
          <>
            <div className="bg-brand-dark border border-white/10 rounded-lg p-4">
              <div className="text-xs uppercase text-brand-grey font-bold mb-1">
                {viewIsTeamLeads ? 'Open Team Leads' : 'Open Player Leads'}
              </div>
              <div className="text-2xl font-sports text-white">{leadStats.total}</div>
            </div>
            <div className="bg-brand-dark border border-white/10 rounded-lg p-4">
              <div className="text-xs uppercase text-brand-grey font-bold mb-1">Deposit Paid</div>
              <div className="text-2xl font-sports text-brand-lime">{leadStats.deposit}</div>
            </div>
            <div className="bg-brand-dark border border-white/10 rounded-lg p-4">
              <div className="text-xs uppercase text-brand-grey font-bold mb-1">Payment Pending</div>
              <div className="text-2xl font-sports text-white">{leadStats.pending}</div>
            </div>
          </>
        ) : (
          <>
            <div className="bg-brand-dark border border-white/10 rounded-lg p-4">
              <div className="text-xs uppercase text-brand-grey font-bold mb-1">
                {viewIsPlayers ? 'Total Players' : 'Total Users'}
              </div>
              <div className="text-2xl font-sports text-white">{viewIsPlayers ? playerStats.total : userStats.total}</div>
            </div>
            <div className="bg-brand-dark border border-white/10 rounded-lg p-4">
              <div className="text-xs uppercase text-brand-grey font-bold mb-1">
                {viewIsPlayers ? 'Linked Accounts' : 'With Player Profile'}
              </div>
              <div className="text-2xl font-sports text-brand-lime">
                {viewIsPlayers ? playerStats.linked : userStats.withPlayer}
              </div>
            </div>
            <div className="bg-brand-dark border border-white/10 rounded-lg p-4">
              <div className="text-xs uppercase text-brand-grey font-bold mb-1">
                {viewIsPlayers ? 'No User Account' : 'No Player Profile'}
              </div>
              <div className="text-2xl font-sports text-white">
                {viewIsPlayers ? playerStats.unlinked : userStats.withoutPlayer}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-brand-dark border border-white/10 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3 items-center">
          <div className="md:col-span-2">
            <label className="block text-[11px] uppercase text-brand-grey font-bold mb-1 tracking-widest opacity-0 select-none">
              Search
            </label>
            <div className="h-11 flex items-center gap-2 bg-black border border-white/20 rounded px-3 focus-within:border-brand-lime/60">
              <Search size={16} className="text-gray-500 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="bg-transparent text-white w-full outline-none text-sm placeholder:text-gray-300"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase text-brand-grey font-bold mb-1 tracking-widest">Season</label>
            <select
              value={seasonFilter}
              onChange={(e) => setSeasonFilter(e.target.value)}
              className={FILTER_SELECT_CLASS}
              style={FILTER_SELECT_STYLE}
            >
              <option value="all">All Seasons</option>
              {sortSeasonsNewestFirst(seasons).map((s) => (
                <option key={s.id} value={s.id}>
                  {resolveSeasonLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase text-brand-grey font-bold mb-1 tracking-widest">Team</label>
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className={FILTER_SELECT_CLASS}
              style={FILTER_SELECT_STYLE}
              disabled={viewIsLeads}
            >
              <option value="all">All Teams</option>
              {teamFilterOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase text-brand-grey font-bold mb-1 tracking-widest">Payment</label>
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value as PaymentCategoryFilter)}
              className={FILTER_SELECT_CLASS}
              style={FILTER_SELECT_STYLE}
            >
              <option value="all">All</option>
              <option value="active">Active (Paid)</option>
              <option value="pending-payment">Registered - Payment Pending</option>
              <option value="jersey-pending">Registered - Jersey Pending</option>
              <option value="inactive">Inactive (Not current season)</option>
            </select>
          </div>
          {viewIsPlayers ? (
            <div>
              <label className="block text-[11px] uppercase text-brand-grey font-bold mb-1 tracking-widest">Claim Status</label>
              <select
                value={claimFilter}
                onChange={(e) => setClaimFilter(e.target.value as ClaimStatusFilter)}
                className={FILTER_SELECT_CLASS}
                style={FILTER_SELECT_STYLE}
              >
                <option value="all">All</option>
                <option value="unclaimed">Unclaimed</option>
                <option value="claimed">Claimed</option>
              </select>
            </div>
          ) : (
            <div />
          )}
          {viewIsLeads ? (
            <div className="text-sm text-gray-300">
              {leadsUnavailable ? (
                <div className="text-amber-200/90">
                  Leads table is not installed. Run <span className="font-mono">server/league_registrations.sql</span> in the Supabase SQL editor.
                </div>
              ) : leadsLoadError ? (
                <div className="text-amber-200/90">Lead load error: {leadsLoadError}</div>
              ) : (
                <div className="text-gray-400">
                  Showing open {viewIsTeamLeads ? 'team' : 'player'} registrations only. Fully paid/completed leads are hidden.
                </div>
              )}
            </div>
          ) : viewIsPlayers ? (
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <input
                id="show-unlinked-players"
                type="checkbox"
                checked={showUnlinkedPlayers}
                onChange={(e) => setShowUnlinkedPlayers(e.target.checked)}
                disabled={claimFilter !== 'all'}
                className="accent-brand-lime"
              />
              <label htmlFor="show-unlinked-players">
                {claimFilter === 'all'
                  ? 'Show players without user account'
                  : 'Claim Status filter is active'}
              </label>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <input
                id="show-no-player"
                type="checkbox"
                checked={showWithoutPlayer}
                onChange={(e) => setShowWithoutPlayer(e.target.checked)}
                className="accent-brand-lime"
              />
              <label htmlFor="show-no-player">Show users without player profile</label>
            </div>
          )}
        </div>
      </div>

      <div className="bg-brand-dark border border-white/10 rounded-xl overflow-hidden">
        {viewIsLeads && leadActionError && (
          <div className="px-4 py-3 text-sm text-amber-200 border-b border-amber-300/20 bg-amber-500/10">
            {leadActionError}
          </div>
        )}
        {viewIsLeads && !leadActionError && leadActionSuccess && (
          <div className="px-4 py-3 text-sm text-brand-lime border-b border-brand-lime/20 bg-brand-lime/10">
            {leadActionSuccess}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-neutral-900 text-brand-grey text-xs uppercase font-bold">
              <tr>
                {viewIsLeads ? (
                  <>
                    <th className="p-4">Lead</th>
                    <th className="p-4">Contact</th>
                    <th className="p-4">Season / Division</th>
                    <th className="p-4">Payment Choice</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Actions</th>
                  </>
                ) : (
                  <>
                    {viewIsPlayers && (
                      <th className="p-4 w-10">
                        <input
                          type="checkbox"
                          aria-label="Select all players on this page"
                          checked={pagedPlayerRows.length > 0 && pagedPlayerRows.every((r) => selectedPlayerIds.has(r.playerId))}
                          onChange={toggleSelectAllPage}
                          className="accent-brand-lime"
                        />
                      </th>
                    )}
                    <th className="p-4">User</th>
                    <th className="p-4">Contact</th>
                    <th className="p-4">Player Profile</th>
                    <th className="p-4">Team / Season</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Actions</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm text-white">
              {viewIsLeads && pagedLeadRows.map((row: any) => {
                const submitted =
                  row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '';
                const typeLabel =
                  row.registration_type === 'team'
                    ? 'Team'
                    : row.registration_type === 'free-agent'
                    ? 'Free agent'
                    : (row.registration_type || 'Lead');
                const paymentChoice =
                  row.payment_choice === 'full'
                    ? 'Full'
                    : row.payment_choice === 'deposit'
                    ? 'Deposit'
                    : row.payment_choice === 'later'
                    ? 'Pay later'
                    : (row.payment_choice || '-');
                return (
                  <tr key={row.id} className="hover:bg-white/5">
                    <td className="p-4">
                      <div className="font-bold">{row.__fullName || 'Registrant'}</div>
                      <div className="text-[11px] text-gray-500">{typeLabel}{row.team_name ? ` / ${row.team_name}` : ''}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{row.id}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-gray-200 font-mono text-xs">{row.email || 'No email'}</div>
                      {row.email && (
                        <div className="text-[11px] text-gray-500">
                          {row.hasAccount ? 'User account email' : 'CSV/import email (no user account yet)'}
                        </div>
                      )}
                      <div className="text-[11px] text-gray-500">{row.phone || 'No phone'}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-white">{row.season_label || 'Season'}</div>
                      <div className="text-[11px] text-gray-500">{row.division_label || 'Division'}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-white">{paymentChoice}</div>
                      <div className="text-[11px] text-gray-500 uppercase">{row.__paymentCategory}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-white uppercase text-xs">{row.__status}</div>
                      <div className="text-[11px] text-gray-500">{submitted}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col items-start gap-2">
                        {row.linked_player_id ? (
                          <button
                            onClick={() => navigate(`/admin/player/${row.linked_player_id}`)}
                            className="text-xs uppercase font-bold text-brand-lime"
                          >
                            View Player
                          </button>
                        ) : (
                          <span className="text-xs uppercase text-gray-500">No player yet</span>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleLeadPaymentSettled(row, 'deposit')}
                            disabled={leadActionBusyKey !== null}
                            className="px-2 py-1 text-[11px] uppercase border border-white/20 rounded text-white hover:border-brand-lime disabled:opacity-50"
                            title="Use this when the lead has paid a deposit offline."
                          >
                            {leadActionBusyKey === `${row.id}:deposit` ? 'Saving...' : 'Mark Deposit Paid'}
                          </button>
                          <button
                            onClick={() => handleLeadPaymentSettled(row, 'full')}
                            disabled={leadActionBusyKey !== null}
                            className="px-2 py-1 text-[11px] uppercase border border-white/20 rounded text-white hover:border-brand-lime disabled:opacity-50"
                            title="Use this when the lead has fully paid offline."
                          >
                            {leadActionBusyKey === `${row.id}:full` ? 'Saving...' : 'Mark Full Paid'}
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {viewIsPlayers && pagedPlayerRows.map((row) => {
                const userLabel = row.displayName || 'No user account';
                const userIdLabel = row.userId || 'No user id';
                const playerMeta = [
                  row.jerseyNumber ? `#${row.jerseyNumber}` : 'No #',
                  row.position || null,
                  row.isCaptain ? 'Captain' : null,
                ].filter(Boolean).join(' / ');
                return (
                  <tr key={row.playerId} className="hover:bg-white/5">
                    <td className="p-4">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.playerName}`}
                        checked={selectedPlayerIds.has(row.playerId)}
                        onChange={() => toggleSelected(row.playerId)}
                        className="accent-brand-lime"
                      />
                    </td>
                    <td className="p-4">
                      <div className="font-bold">{userLabel}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{userIdLabel}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-gray-200 font-mono text-xs">{row.email || 'No email'}</div>
                      <div className="text-[11px] text-gray-500">{row.phone || 'No phone'}</div>
                    </td>
                    <td className="p-4">
                      <button
                        type="button"
                        onClick={() => navigate(`/player/${row.playerId}`)}
                        className="font-semibold text-left hover:text-brand-lime transition-colors"
                      >
                        {row.playerName}
                      </button>
                      <div className="text-[11px] text-gray-500 font-mono">{row.playerId}</div>
                      <div className="text-[11px] text-gray-500">{playerMeta}</div>
                    </td>
                    <td className="p-4">
                      {row.teamId && row.teamName ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/team/${row.teamId}`)}
                          className="text-white text-left hover:text-brand-lime transition-colors"
                        >
                          {row.teamName}
                        </button>
                      ) : (
                        <div className="text-white">{row.teamName || 'No Team'}</div>
                      )}
                      <div className="text-[11px] text-gray-500">{row.seasonName || 'No Season'}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col items-start gap-2">
                        <span className={`inline-flex px-2 py-1 rounded border text-[11px] uppercase ${statusClass(row.paymentStatus)}`}>
                          {normalizeStatus(row.paymentStatus)}
                        </span>
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
                          <div className="text-[11px] text-gray-500">
                            Account-linked registration: waiver accepted inferred from linked user record.
                          </div>
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
                );
              })}
              {viewIsUsers && pagedUserRows.map((row) => (
                <tr key={row.userId} className="hover:bg-white/5">
                  <td className="p-4">
                    <div className="font-bold">{row.displayName}</div>
                    <div className="text-[11px] text-gray-500 font-mono">{row.userId}</div>
                  </td>
                  <td className="p-4">
                    <div className="text-gray-200 font-mono text-xs">{row.email || 'No email'}</div>
                    <div className="text-[11px] text-gray-500">{row.phone || 'No phone'}</div>
                  </td>
                  <td className="p-4">
                      {row.playerId ? (
                      <>
                        <button
                          type="button"
                          onClick={() => navigate(`/player/${row.playerId}`)}
                          className="font-semibold text-left hover:text-brand-lime transition-colors"
                        >
                          {row.playerName || 'Player'}
                        </button>
                        <div className="text-[11px] text-gray-500 font-mono">{row.playerId}</div>
                        <div className="text-[11px] text-gray-500">
                          {row.playerCount > 1 ? `${row.playerCount} profiles` : '1 profile'}
                          {row.isCaptain ? ' / Captain' : ''}
                        </div>
                      </>
                    ) : (
                      <div className="text-gray-500 text-xs uppercase tracking-wide">No player profile</div>
                    )}
                  </td>
                  <td className="p-4">
                    {row.teamId && row.teamName ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/team/${row.teamId}`)}
                        className="text-white text-left hover:text-brand-lime transition-colors"
                      >
                        {row.teamName}
                      </button>
                    ) : (
                      <div className="text-white">{row.teamName || 'No Team'}</div>
                    )}
                    <div className="text-[11px] text-gray-500">{row.seasonName || 'No Season'}</div>
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex px-2 py-1 rounded border text-[11px] uppercase ${statusClass(row.paymentStatus)}`}>
                      {normalizeStatus(row.paymentStatus)}
                    </span>
                  </td>
                  <td className="p-4">
                    <button
                      onClick={() => row.playerId && navigate(`/admin/player/${row.playerId}`)}
                      disabled={!row.playerId}
                      className="text-xs uppercase font-bold text-brand-lime disabled:text-gray-500"
                    >
                      View Player
                    </button>
                  </td>
                </tr>
              ))}
              {totalRows === 0 && (
                <tr>
                  <td colSpan={viewIsPlayers ? 7 : 6} className="p-6 text-center text-gray-400 text-sm">
                    No results match this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mt-4 text-xs text-gray-400">
        <div>
          {totalRows === 0
            ? 'Showing 0 results'
            : `Showing ${startIndex}-${endIndex} of ${totalRows} rows | Page ${currentPage} of ${totalPages}`}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.3em] text-gray-500">Rows</span>
            <select
              id="page-size"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="appearance-none bg-black border border-white/20 text-white text-[11px] uppercase tracking-wide px-3 pr-8 py-1.5 rounded-lg focus:outline-none focus:border-brand-lime transition"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7' viewBox='0 0 12 8'%3E%3Cpath fill='%23ffffff' d='M1.41 0L6 4.59 10.59 0 12 1.41 6 7.41 0 1.41z'/%3E%3C/svg%3E\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 1.15rem center',
                backgroundSize: '10px 7px',
              }}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
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
                    ...
                  </span>
                );
              }
              return (
                <button
                  key={`page-btn-${entry}`}
                  onClick={() => setPage(entry)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] uppercase tracking-[0.3em] border border-white/10 transition ${
                    currentPage === entry
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
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 text-[11px] uppercase tracking-[0.3em] rounded-lg border border-white/10 hover:border-brand-lime disabled:opacity-50 transition"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {modalRoot && mergeModalOpen && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-2xl bg-brand-dark border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <div className="text-white font-sports text-xl uppercase">Merge Player Profiles</div>
                <div className="text-xs text-gray-400 mt-1">
                  This links multiple player rows to one account by setting the same <span className="font-mono">players.user_id</span>.
                  It does not delete players or user accounts.
                </div>
              </div>
              <button
                type="button"
                onClick={closeMergeModal}
                disabled={mergeBusy}
                className="px-3 py-2 rounded border border-white/15 text-gray-200 text-xs uppercase hover:border-white/30 disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-3">
              {mergeError && (
                <div className="bg-red-900/30 border border-red-500/40 text-red-100 rounded-xl p-3 text-sm">
                  {mergeError}
                </div>
              )}

              <div className="text-xs uppercase tracking-widest text-brand-grey font-bold">
                Choose Primary (must have user account)
              </div>
              <div className="space-y-2 max-h-[50vh] overflow-auto pr-1">
                {playerRows
                  .filter((row) => selectedPlayerIds.has(row.playerId))
                  .sort((a, b) => a.playerName.localeCompare(b.playerName))
                  .map((row) => {
                    const disabled = !row.hasAccount;
                    const suffix = !row.hasAccount ? '(NO USER)' : row.linkSource === 'email' ? '(EMAIL MATCH)' : '';
                    const label = `${row.playerName} ${suffix}`.trim();
                    const emailLabel = row.email || 'No email';
                    return (
                      <label
                        key={row.playerId}
                        className={`flex items-start gap-3 rounded-xl border p-3 ${
                          disabled ? 'border-white/10 opacity-60' : 'border-white/15 hover:border-brand-lime/40'
                        }`}
                      >
                        <input
                          type="radio"
                          name="mergePrimary"
                          value={row.playerId}
                          disabled={disabled || mergeBusy}
                          checked={mergePrimaryPlayerId === row.playerId}
                          onChange={() => setMergePrimaryPlayerId(row.playerId)}
                          className="mt-1 accent-brand-lime"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-white font-bold truncate">{label}</div>
                          <div className="text-[11px] text-gray-400 font-mono truncate">{row.playerId}</div>
                          <div className="text-[11px] text-gray-400 truncate">{emailLabel}</div>
                        </div>
                      </label>
                    );
                  })}
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-3">
                <input
                  type="checkbox"
                  checked={mergeIncludeNameMatches}
                  disabled={mergeBusy}
                  onChange={(e) => setMergeIncludeNameMatches(e.target.checked)}
                  className="mt-1 accent-brand-lime"
                />
                <div className="text-sm text-gray-300">
                  Also merge unlinked player rows that match the primary player's name and birthdate (helps when the same person has multiple accounts).
                  <div className="text-[11px] text-gray-500 mt-1">
                    Safety: requires a birthdate on the primary player to prevent pulling in another person's stats.
                  </div>
                </div>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={performMerge}
                  disabled={mergeBusy}
                  className="px-4 py-2 rounded bg-brand-lime text-black text-xs font-bold uppercase disabled:opacity-60"
                >
                  {mergeBusy ? 'Merging...' : 'Merge'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        modalRoot
      )}

      {modalRoot && unmergeModalOpen && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-2xl bg-brand-dark border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <div className="text-white font-sports text-xl uppercase">Unmerge Player Profiles</div>
                <div className="text-xs text-gray-400 mt-1">
                  This detaches selected profiles by setting <span className="font-mono">players.user_id</span> to NULL.
                  If a detached profile should be linked to a different account, relink it via the player editor.
                </div>
              </div>
              <button
                type="button"
                onClick={closeUnmergeModal}
                disabled={unmergeBusy}
                className="px-3 py-2 rounded border border-white/15 text-gray-200 text-xs uppercase hover:border-white/30 disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-3">
              {unmergeError && (
                <div className="bg-red-900/30 border border-red-500/40 text-red-100 rounded-xl p-3 text-sm">
                  {unmergeError}
                </div>
              )}

              <div className="text-xs uppercase tracking-widest text-brand-grey font-bold">
                Keep Linked (others will detach)
              </div>
              <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
                {unmergeCandidates
                  .slice()
                  .sort((a, b) => formatPlayerName(a).localeCompare(formatPlayerName(b)))
                  .map((p) => {
                    const isKeep = unmergeKeepPlayerId === p.id;
                    const teamName = p.team_id ? teamMap.get(p.team_id) || 'Team' : 'No Team';
                    const seasonName = p.season_id ? seasonMap.get(p.season_id) || 'Season' : 'No Season';
                    const meta = [
                      p.jersey_number ? `#${p.jersey_number}` : null,
                      p.position || null,
                      teamName ? `${teamName}` : null,
                      seasonName ? `${seasonName}` : null,
                    ].filter(Boolean).join(' • ');
                    const detachChecked = unmergeDetachIds.has(p.id);

                    return (
                      <div
                        key={p.id}
                        className={`flex items-start gap-3 rounded-xl border p-3 ${
                          isKeep ? 'border-brand-lime/40 bg-brand-lime/5' : 'border-white/15 hover:border-brand-lime/40'
                        }`}
                      >
                        <input
                          type="radio"
                          name="unmergeKeep"
                          value={p.id}
                          disabled={unmergeBusy}
                          checked={isKeep}
                          onChange={() => {
                            setUnmergeKeepPlayerId(p.id);
                            setUnmergeDetachIds(new Set(unmergeCandidateIds.filter((id) => id !== p.id)));
                          }}
                          className="mt-1 accent-brand-lime"
                          aria-label={`Keep ${formatPlayerName(p)} linked`}
                        />

                        <div className="flex-1 min-w-0">
                          <div className="text-white font-bold truncate">{formatPlayerName(p)}</div>
                          <div className="text-[11px] text-gray-400 font-mono truncate">{p.id}</div>
                          <div className="text-[11px] text-gray-400 truncate">{meta || 'No metadata'}</div>
                        </div>

                        <label className="flex items-center gap-2 text-xs text-gray-300 select-none">
                          <input
                            type="checkbox"
                            disabled={unmergeBusy || isKeep}
                            checked={!isKeep && detachChecked}
                            onChange={() => {
                              if (isKeep) return;
                              setUnmergeDetachIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.id)) next.delete(p.id);
                                else next.add(p.id);
                                return next;
                              });
                            }}
                            className="accent-brand-lime"
                            aria-label={`Detach ${formatPlayerName(p)}`}
                          />
                          Detach
                        </label>
                      </div>
                    );
                  })}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <div className="flex-1 pr-2">
                  <label className="flex items-start gap-2 text-xs text-gray-300 select-none">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-brand-lime"
                      checked={unmergeAcknowledge}
                      disabled={unmergeBusy || unmergeDetachIds.size === 0}
                      onChange={(e) => setUnmergeAcknowledge(e.target.checked)}
                    />
                    <span>
                      I understand this will detach <span className="text-white font-bold">{unmergeDetachIds.size}</span> profile(s) and change which stats appear on the player profile.
                    </span>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={performUnmerge}
                  disabled={
                    unmergeBusy ||
                    !canUnmerge ||
                    !unmergeAcknowledge ||
                    unmergeDetachIds.size === 0 ||
                    (unmergeDetachIds.size === 1 && unmergeDetachIds.has(unmergeKeepPlayerId))
                  }
                  className="px-4 py-2 rounded bg-brand-lime text-black text-xs font-bold uppercase disabled:opacity-60"
                >
                  {unmergeBusy ? 'Unmerging...' : 'Unmerge'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        modalRoot
      )}

      {modalRoot && emailConfirmOpen && createPortal(
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-3xl bg-brand-dark border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <div className="text-white font-sports text-xl uppercase">Confirm Claim Invites</div>
                <div className="text-xs text-gray-400 mt-1">
                  Review recipients before sending. Uncheck any player you do not want to invite.
                </div>
              </div>
              <button
                type="button"
                onClick={closeEmailSelectedModal}
                disabled={emailSelectedLoading}
                className="px-3 py-2 rounded border border-white/15 text-gray-200 text-xs uppercase hover:border-white/30 disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-gray-300">
                  Sending to <span className="text-white font-bold">{emailDraftTargets.length}</span> of{' '}
                  <span className="text-white font-bold">{selectedClaimInviteTargets.length}</span> selected player
                  {selectedClaimInviteTargets.length === 1 ? '' : 's'}.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEmailDraftTargetIds(new Set(selectedClaimInviteTargets.map((target) => target.playerId)))}
                    disabled={emailSelectedLoading || allDraftTargetsSelected}
                    className="px-3 py-1.5 rounded border border-white/15 text-[11px] uppercase tracking-wider text-gray-200 hover:border-brand-lime/50 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmailDraftTargetIds(new Set())}
                    disabled={emailSelectedLoading || !emailDraftTargetIds.size}
                    className="px-3 py-1.5 rounded border border-white/15 text-[11px] uppercase tracking-wider text-gray-200 hover:border-brand-lime/50 disabled:opacity-50"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
                {selectedClaimInviteTargets
                  .slice()
                  .sort((a, b) => a.playerName.localeCompare(b.playerName))
                  .map((target) => {
                    const checked = emailDraftTargetIds.has(target.playerId);
                    return (
                      <label
                        key={target.playerId}
                        className={`flex items-start gap-3 rounded-xl border p-3 ${
                          checked ? 'border-brand-lime/40 bg-brand-lime/5' : 'border-white/15 hover:border-brand-lime/30'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={emailSelectedLoading}
                          onChange={() => toggleEmailDraftTarget(target.playerId)}
                          className="mt-1 accent-brand-lime"
                          aria-label={`Include ${target.playerName}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-white font-bold truncate">{target.playerName}</div>
                          <div className="text-[11px] text-gray-300 font-mono truncate">{target.email}</div>
                          <div className="text-[11px] text-gray-500 truncate">
                            {(target.teamName || 'No team')} | {(target.seasonName || 'No season')}
                          </div>
                        </div>
                      </label>
                    );
                  })}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeEmailSelectedModal}
                  disabled={emailSelectedLoading}
                  className="px-4 py-2 rounded border border-white/20 text-white text-xs uppercase hover:border-white/40 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleEmailSelectedPlayers}
                  disabled={emailSelectedLoading || !emailDraftTargets.length}
                  className="px-4 py-2 rounded bg-brand-lime text-black text-xs font-bold uppercase disabled:opacity-60"
                >
                  {emailSelectedLoading
                    ? 'Sending...'
                    : `Send Invites (${emailDraftTargets.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>,
        modalRoot
      )}
    </div>
  );
};

export default PlayerManagement;
