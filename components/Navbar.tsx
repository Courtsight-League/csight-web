
import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, LogOut, User as UserIcon, ShieldAlert, Bell, Settings, ChevronDown, Crown, Users, Plus } from 'lucide-react';
import { getCurrentUser, logout } from '../services/authService';
import { signTeamAssetUrl } from '../services/dataCache';
import { supabase } from '../services/supabaseClient';
import { User, Role, Notification } from '../types';
import { fetchRecentNotifications, markNotificationRead } from '../services/notificationService';
import Logo from './Logo';

const IDLE_TIMEOUT_MS = Number(import.meta.env.VITE_IDLE_TIMEOUT_MS || 30 * 60 * 1000); // default 30 mins
const LAST_ACTIVITY_KEY = 'courtsight_last_activity';

type TeamNavOption = {
  id: string;
  name: string;
  division?: string | null;
  isCaptain?: boolean;
};

const Navbar: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [resolvedAvatarUrl, setResolvedAvatarUrl] = useState<string>('');
  const [playerTeamId, setPlayerTeamId] = useState<string | null>(null);
  const [playerTeams, setPlayerTeams] = useState<TeamNavOption[]>([]);
  const [myTeamDropdownOpen, setMyTeamDropdownOpen] = useState(false);
  const [mobileTeamDropdownOpen, setMobileTeamDropdownOpen] = useState(false);
  const [teamActionsDropdownOpen, setTeamActionsDropdownOpen] = useState(false);
  const [mobileTeamActionsDropdownOpen, setMobileTeamActionsDropdownOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [adminDisplayName, setAdminDisplayName] = useState<string | null>(null);
  const [seasonNames, setSeasonNames] = useState<Record<string, string>>({});
  const [teamDivisions, setTeamDivisions] = useState<Record<string, string>>({});
  const myTeamDropdownRef = useRef<HTMLDivElement | null>(null);
  const teamActionsDropdownRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const currentRouteTeamId =
    location.pathname.startsWith('/team/') ? decodeURIComponent(location.pathname.split('/')[2] || '') || null : null;

  // Check auth state on mount and when location changes (to catch login redirects)
  useEffect(() => {
    setUser(getCurrentUser());
  }, [location]);

  useEffect(() => {
    const syncUser = () => setUser(getCurrentUser());
    window.addEventListener('courtsight:user-updated', syncUser as EventListener);
    return () => window.removeEventListener('courtsight:user-updated', syncUser as EventListener);
  }, []);

  useEffect(() => {
    let active = true;
    const resolveAvatar = async () => {
      const raw = (user?.avatarUrl || '').trim();
      if (!raw) {
        if (active) setResolvedAvatarUrl('');
        return;
      }
      try {
        const resolved = await signTeamAssetUrl(raw);
        if (active) setResolvedAvatarUrl((resolved || raw).trim());
      } catch {
        if (active) setResolvedAvatarUrl(raw);
      }
    };
    resolveAvatar();
    return () => {
      active = false;
    };
  }, [user?.id, user?.avatarUrl]);

  // Inactivity auto-logout per device/browser
  useEffect(() => {
    if (!user) return;
    let timer: number | null = null;
    const now = Date.now();
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    } catch {}

    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || '0');
          if (!last || Date.now() - last >= IDLE_TIMEOUT_MS) {
            await logout();
            navigate('/login');
          } else {
            // If there was recent activity in another tab, reschedule
            schedule();
          }
        } catch {
          await logout();
          navigate('/login');
        }
      }, IDLE_TIMEOUT_MS + 500);
    };

    const bump = () => {
      try {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
      } catch {}
      schedule();
    };

    const events = ['mousemove', 'keydown', 'touchstart', 'visibilitychange'];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    bump();

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      if (timer) window.clearTimeout(timer);
    };
  }, [user, navigate]);

  useEffect(() => {
  const loadNotifications = async () => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }
      setNotifLoading(true);
      const data = await fetchRecentNotifications(user.id, user.role || null, 8);
      setNotifications(data);
      setNotifLoading(false);
  };
  loadNotifications();
}, [user]);

  useEffect(() => {
    let cancelled = false;
    const loadAdminDisplayName = async () => {
      if (!user?.email) {
        setAdminDisplayName(null);
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
        if (!cancelled) {
          setAdminDisplayName(data?.display_name || null);
        }
      } catch (err) {
        console.warn('admin display name lookup failed', err);
      }
    };
    loadAdminDisplayName();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  // Hydrate season/division labels for richer notification display
  useEffect(() => {
    const seasonIds = Array.from(
      new Set(
        notifications
          .map((n) => (n.metadata as any)?.seasonId)
          .filter((id): id is string => !!id && !seasonNames[id])
      )
    );
    const teamIds = Array.from(
      new Set(
        notifications
          .map((n) => (n.metadata as any)?.teamId)
          .filter((id): id is string => !!id && !teamDivisions[id])
      )
    );
    const loadLookups = async () => {
      try {
        if (seasonIds.length) {
          const { data } = await supabase.from('seasons').select('id,name').in('id', seasonIds);
          if (data) {
            setSeasonNames((prev) => ({
              ...prev,
              ...Object.fromEntries(data.map((s: any) => [s.id, s.name || 'Season'])),
            }));
          }
        }
      } catch (err) {
        console.warn('load seasons for notifications failed', err);
      }
      try {
        if (teamIds.length) {
          const { data } = await supabase.from('teams').select('id,division').in('id', teamIds);
          if (data) {
            setTeamDivisions((prev) => ({
              ...prev,
              ...Object.fromEntries(data.map((t: any) => [t.id, t.division || ''])),
            }));
          }
        }
      } catch (err) {
        console.warn('load team divisions for notifications failed', err);
      }
    };
    if (seasonIds.length || teamIds.length) {
      loadLookups();
    }
  }, [notifications, seasonNames, teamDivisions]);

  const toggleMenu = () => setIsOpen(!isOpen);

  useEffect(() => {
    setMyTeamDropdownOpen(false);
    setMobileTeamDropdownOpen(false);
    setTeamActionsDropdownOpen(false);
    setMobileTeamActionsDropdownOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!myTeamDropdownOpen) return;
    const handleClickAway = (event: MouseEvent) => {
      if (!myTeamDropdownRef.current) return;
      if (!myTeamDropdownRef.current.contains(event.target as Node)) {
        setMyTeamDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickAway);
    return () => document.removeEventListener('mousedown', handleClickAway);
  }, [myTeamDropdownOpen]);

  useEffect(() => {
    if (!teamActionsDropdownOpen) return;
    const handleClickAway = (event: MouseEvent) => {
      if (!teamActionsDropdownRef.current) return;
      if (!teamActionsDropdownRef.current.contains(event.target as Node)) {
        setTeamActionsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickAway);
    return () => document.removeEventListener('mousedown', handleClickAway);
  }, [teamActionsDropdownOpen]);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      setUser(null);
      setIsOpen(false);
      navigate('/');
    }
  };

  const publicLinks = [
    { name: 'Home', path: '/' },
    { name: 'Schedule & Stats', path: '/stats' },
    { name: 'Contact', path: '/contact' },
  ];

  const isAdmin = user && (
    user.role === Role.ADMIN_FULL || 
    user.role === Role.ADMIN_MEDIA || 
    user.role === Role.ADMIN_SCOREKEEPER || 
    user.role === Role.ADMIN_COMMISSIONER
  );
  const homePath = isAdmin ? '/admin?tab=overview' : '/';

  useEffect(() => {
    let active = true;
    const loadCaptain = async () => {
      if (!user) {
        if (active) {
          setPlayerTeamId(null);
          setPlayerTeams([]);
        }
        return;
      }
      try {
        // Prefer current-season membership, but still allow captain tools if the user is
        // captain on a registration-open/upcoming season team.
        const { data: currentSeason } = await supabase
          .from('seasons')
          .select('id')
          .eq('is_current', true)
          .maybeSingle();
        const seasonId = currentSeason?.id || null;
        let query = supabase
          .from('players')
          .select('id,is_captain,team_id,season_id,created_at')
          .eq('user_id', user.id);
        if (seasonId) {
          query = query.eq('season_id', seasonId);
        }
        const { data: currentSeasonRows } = await query
          .order('created_at', { ascending: false })
          .limit(50);

        let currentRows = currentSeasonRows || [];
        if (!currentRows.length) {
          const { data: anySeasonRows } = await supabase
            .from('players')
            .select('id,is_captain,team_id,season_id,created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(100);
          currentRows = anySeasonRows || [];
        }

        let uniqueTeamIds = Array.from(
          new Set(
            currentRows
              .map((row: any) => String(row?.team_id || '').trim())
              .filter((id: string) => !!id)
          )
        );
        const currentCaptainRow = currentRows.find((row: any) => !!row?.is_captain) || null;
        const latestCurrentRow = currentRows[0] || null;

        let fallbackCaptainRow: any = null;
        if (!currentCaptainRow) {
          const { data: captainRows } = await supabase
            .from('players')
            .select('id,is_captain,team_id,season_id,created_at')
            .eq('user_id', user.id)
            .eq('is_captain', true)
            .order('created_at', { ascending: false })
            .limit(1);
          fallbackCaptainRow = captainRows?.[0] || null;
          const fallbackCaptainTeamId = String(fallbackCaptainRow?.team_id || '').trim();
          if (fallbackCaptainTeamId && !uniqueTeamIds.includes(fallbackCaptainTeamId)) {
            uniqueTeamIds = [fallbackCaptainTeamId, ...uniqueTeamIds];
          }
        }

        const resolvedCaptainRow = currentCaptainRow || fallbackCaptainRow;
        const captainTeamIds = new Set(
          currentRows
            .filter((row: any) => !!row?.is_captain)
            .map((row: any) => String(row?.team_id || '').trim())
            .filter((id: string) => !!id)
        );
        if (resolvedCaptainRow?.team_id) {
          captainTeamIds.add(String(resolvedCaptainRow.team_id));
        }
        let persistedTeamId: string | null = null;
        try {
          persistedTeamId = localStorage.getItem(`courtsight_last_team_id_${user.id}`) || null;
        } catch {
          persistedTeamId = null;
        }
        const routeTeamId = currentRouteTeamId && uniqueTeamIds.includes(currentRouteTeamId) ? currentRouteTeamId : null;
        const captainTeamId =
          resolvedCaptainRow?.team_id && uniqueTeamIds.includes(String(resolvedCaptainRow.team_id))
            ? String(resolvedCaptainRow.team_id)
            : null;
        const latestTeamId =
          latestCurrentRow?.team_id && uniqueTeamIds.includes(String(latestCurrentRow.team_id))
            ? String(latestCurrentRow.team_id)
            : null;
        const resolvedTeamId =
          (persistedTeamId && uniqueTeamIds.includes(persistedTeamId) ? persistedTeamId : null) ||
          routeTeamId ||
          captainTeamId ||
          latestTeamId ||
          null;
        let resolvedTeams: TeamNavOption[] = uniqueTeamIds.map((teamId) => ({ id: teamId, name: 'My Team' }));

        if (uniqueTeamIds.length) {
          const { data: teamRows } = await supabase
            .from('teams')
            .select('id,name,division')
            .in('id', uniqueTeamIds);
          const teamById = Object.fromEntries((teamRows || []).map((team: any) => [String(team.id), team]));
          resolvedTeams = uniqueTeamIds
            .map((teamId) => {
              const row = teamById[teamId];
              if (!row) return null;
              return {
                id: teamId,
                name: String(row.name || 'My Team'),
                division: row.division ? String(row.division) : '',
                isCaptain: captainTeamIds.has(teamId),
              };
            })
            .filter((team): team is TeamNavOption => !!team);
        }

        if (active) {
          setPlayerTeamId(resolvedTeamId || resolvedTeams[0]?.id || null);
          setPlayerTeams(resolvedTeams);
        }
      } catch {
        if (active) {
          setPlayerTeamId(null);
          setPlayerTeams([]);
        }
      }
    };
    loadCaptain();
    return () => {
      active = false;
    };
  }, [user, isAdmin, currentRouteTeamId]);

  const handleTeamSwitch = (teamId: string, closeMobileMenu = false) => {
    if (!teamId) return;
    setPlayerTeamId(teamId);
    if (user?.id) {
      try {
        localStorage.setItem(`courtsight_last_team_id_${user.id}`, teamId);
      } catch {}
    }
    setMyTeamDropdownOpen(false);
    setMobileTeamDropdownOpen(false);
    if (closeMobileMenu) {
      setIsOpen(false);
    }
    navigate(`/team/${teamId}`);
  };

  const handleManageTeam = (teamId: string, closeMobileMenu = false) => {
    if (!teamId) return;
    setPlayerTeamId(teamId);
    if (user?.id) {
      try {
        localStorage.setItem(`courtsight_last_team_id_${user.id}`, teamId);
      } catch {}
    }
    setMyTeamDropdownOpen(false);
    setMobileTeamDropdownOpen(false);
    if (closeMobileMenu) {
      setIsOpen(false);
    }
    navigate(`/manage-team?team=${encodeURIComponent(teamId)}`);
  };

  const handleJoinTeamAction = (closeMobileMenu = false) => {
    setMyTeamDropdownOpen(false);
    setMobileTeamDropdownOpen(false);
    setTeamActionsDropdownOpen(false);
    setMobileTeamActionsDropdownOpen(false);
    if (closeMobileMenu) {
      setIsOpen(false);
    }
    navigate('/my-season?join=1');
  };

  const handleCreateTeamAction = (closeMobileMenu = false) => {
    try {
      sessionStorage.setItem('skipRegistrationRedirectOnce', 'true');
    } catch {}
    setMyTeamDropdownOpen(false);
    setMobileTeamDropdownOpen(false);
    setTeamActionsDropdownOpen(false);
    setMobileTeamActionsDropdownOpen(false);
    if (closeMobileMenu) {
      setIsOpen(false);
    }
    navigate('/register?type=team');
  };

  const myTeamPath = playerTeamId ? `/team/${playerTeamId}` : '/my-team';
  const hasCaptainTeam = playerTeams.some((team) => !!team.isCaptain);
  const showTeamActions = !!user;

  const memberLinks = [
    { name: 'My Season', path: '/my-season' },
    { name: 'My Team', path: myTeamPath },
    { name: 'Schedule & Stats', path: '/stats' },
  ];

  const playerLinks = [
    { name: 'My Season', path: '/my-season' },
    { name: 'My Team', path: myTeamPath },
  ];

  const adminLinks = [
     { name: 'Dashboard', path: '/admin' },
     { name: 'Live Site', path: '/' },
      ...(playerTeams.length ? [{ name: 'My Team', path: myTeamPath }] : []),
      { name: 'Schedule & Stats', path: '/stats' },
  ];

  let links = publicLinks;
  if (user) {
    if (isAdmin) {
        links = adminLinks;
    } else {
        links = memberLinks;
    }
  }

  const isActive = (path: string) => {
    if (path.startsWith('/team/') && location.pathname.startsWith(path)) {
      return true;
    }
    if (path === '/my-team' && location.pathname.startsWith('/team/')) {
      return true;
    }
    return location.pathname === path;
  };

  const resolvedUserName = adminDisplayName || user?.name || '';

  const getRoleLabel = (role: Role) => {
    switch(role) {
      case Role.ADMIN_FULL: return 'Full Admin';
      case Role.ADMIN_MEDIA: return 'Media Mgr';
      case Role.ADMIN_SCOREKEEPER: return 'Scorekeeper';
      case Role.ADMIN_COMMISSIONER: return 'Commissioner';
      default: return 'Member';
    }
  }

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const formatNotificationBody = (n: Notification) => {
    const meta = (n.metadata || {}) as any;
    const seasonName = meta.seasonName || (meta.seasonId ? seasonNames[meta.seasonId] : null);
    const division = meta.division || (meta.teamId ? teamDivisions[meta.teamId] : null);
    const suffix = [seasonName, division].filter(Boolean).join(' • ');
    if (!suffix) return n.body;
    const alreadyHasSeason =
      seasonName && n.body.toLowerCase().includes(String(seasonName).toLowerCase());
    const alreadyHasDivision =
      division && n.body.toLowerCase().includes(String(division).toLowerCase());
    if (alreadyHasSeason || alreadyHasDivision) return n.body;
    return `${n.body} — ${suffix}`;
  };

  const handleNotificationClick = async (notif: Notification) => {
    if (!notif.readAt) {
      await markNotificationRead(notif.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, readAt: new Date().toISOString() } : n))
      );
    }
    if (notif.link) {
      navigate(notif.link);
      setNotifOpen(false);
    }
  };

  return (
    <nav className="fixed top-0 left-0 w-full z-50 bg-brand-black/95 backdrop-blur-md border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
            {/* Logo */}
            <div className="flex-shrink-0 cursor-pointer text-white">
              <Link to={homePath} className="flex items-center" onClick={() => setIsOpen(false)}>
                <Logo className="h-auto w-auto md:h-15 max-w-[160px]" />
              </Link>
            </div>

          {/* Desktop Nav */}
          <div className="hidden md:block">
            <div className="ml-10 flex items-baseline space-x-8">
              {links.map((link) => {
                const isMyTeamLink = link.name === 'My Team' && (playerTeams.length > 1 || hasCaptainTeam);
                if (isMyTeamLink) {
                  return (
                    <div key={link.name} className="relative" ref={myTeamDropdownRef}>
                      <button
                        onClick={() => setMyTeamDropdownOpen((prev) => !prev)}
                        className={`inline-flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 font-sans uppercase tracking-wide ${
                          isActive(link.path) ? 'text-brand-lime' : 'text-gray-300 hover:text-white'
                        }`}
                      >
                        {link.name}
                        <ChevronDown size={14} className={`${myTeamDropdownOpen ? 'rotate-180' : ''} transition-transform`} />
                      </button>
                      {myTeamDropdownOpen && (
                        <div className="absolute left-0 mt-2 w-56 rounded-md border border-white/10 bg-brand-dark shadow-2xl overflow-hidden z-50">
                          {playerTeams.map((team) => {
                            const selected = team.id === playerTeamId;
                            return (
                              <div
                                key={team.id}
                                className={`group flex items-stretch transition-colors ${
                                  selected ? 'bg-brand-lime/10' : 'hover:bg-white/5'
                                }`}
                              >
                                <button
                                  onClick={() => handleTeamSwitch(team.id)}
                                  className={`flex-1 text-left px-3 py-2 transition-colors ${
                                    selected ? 'text-brand-lime' : 'text-gray-200 hover:text-white'
                                  }`}
                                >
                                  <div className="text-sm font-semibold flex items-center gap-1">
                                    <span>{team.name}</span>
                                    {team.isCaptain && <Crown size={12} className="text-brand-lime" />}
                                  </div>
                                  {team.division && <div className="text-[11px] uppercase text-gray-400">{team.division}</div>}
                                </button>
                                {team.isCaptain && (
                                  <button
                                    onClick={() => handleManageTeam(team.id)}
                                    className="rounded-r-md bg-brand-lime px-3 text-[11px] uppercase tracking-wide font-semibold text-black opacity-0 transition-opacity hover:brightness-95 group-hover:opacity-100 focus:opacity-100"
                                    title={`Team Manager ${team.name}`}
                                  >
                                    Team Manager
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <Link
                    key={link.name}
                    to={link.path}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 font-sans uppercase tracking-wide ${
                      isActive(link.path) ? 'text-brand-lime' : 'text-gray-300 hover:text-white'
                    }`}
                  >
                    {link.name}
                  </Link>
                );
              })}
              {showTeamActions && (
                <div className="relative" ref={teamActionsDropdownRef}>
                  <button
                    onClick={() => setTeamActionsDropdownOpen((prev) => !prev)}
                    className={`inline-flex items-center gap-1 rounded-md border px-4 py-2 text-sm font-semibold uppercase tracking-wide transition-all duration-200 ${
                      location.pathname === '/my-season' || location.pathname === '/register'
                        ? 'border-brand-lime bg-brand-lime text-black shadow-[0_0_18px_rgba(190,242,100,0.45)]'
                        : 'border-brand-lime bg-brand-lime text-black shadow-[0_0_14px_rgba(190,242,100,0.35)] hover:brightness-110 hover:shadow-[0_0_22px_rgba(190,242,100,0.55)]'
                    }`}
                  >
                    Register
                    <ChevronDown size={14} className={`${teamActionsDropdownOpen ? 'rotate-180' : ''} transition-transform`} />
                  </button>
                  {teamActionsDropdownOpen && (
                    <div className="absolute left-0 mt-2 w-56 rounded-md border border-white/10 bg-brand-dark shadow-2xl overflow-hidden z-50">
                      <button
                        type="button"
                        onClick={() => handleJoinTeamAction()}
                        className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm text-gray-200 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        <Users size={15} className="text-brand-lime" />
                        <span>Join a Team</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCreateTeamAction()}
                        className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-3 text-left text-sm text-gray-200 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        <Plus size={15} className="text-brand-lime" />
                        <span>Create New Team</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* CTA Buttons / User Profile */}
          <div className="hidden md:flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-white">
                   <Link
                     to="/my-profile"
                     className={`w-8 h-8 rounded-full flex items-center justify-center font-bold overflow-hidden hover:ring-2 hover:ring-white/40 transition ${isAdmin ? 'bg-brand-red text-white' : 'bg-brand-lime text-black'}`}
                     title="Edit Profile"
                   >
                     {resolvedAvatarUrl ? (
                       <img
                         src={resolvedAvatarUrl}
                         alt="User"
                         className="w-full h-full object-cover"
                         onError={() => setResolvedAvatarUrl('')}
                       />
                     ) : (
                       <UserIcon size={16} />
                     )}
                   </Link>
                   <div className="flex flex-col">
                       <span className="font-sports text-sm tracking-wider leading-none">{resolvedUserName}</span>
                       {isAdmin && <span className="text-[10px] text-brand-lime uppercase font-bold">{getRoleLabel(user.role)}</span>}
                    </div>
                 </div>
                <div className="relative">
                  <button
                    onClick={() => setNotifOpen(!notifOpen)}
                    className="relative inline-flex items-center justify-center h-8 w-8 text-gray-300 hover:text-white transition-colors align-middle"
                    title="Notifications"
                  >
                    <Bell size={20} />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-brand-red text-white text-[10px] rounded-full px-1 leading-tight">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                  {notifOpen && (
                    <div className="absolute right-0 mt-3 w-72 bg-brand-dark border border-white/10 rounded-lg shadow-2xl z-50">
                      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
                        <span className="text-xs uppercase text-gray-400 font-bold">Notifications</span>
                        {notifLoading && <span className="text-[10px] text-gray-500">Loading...</span>}
                      </div>
                      <div className="max-h-80 overflow-auto divide-y divide-white/5">
                        {notifications.length === 0 && !notifLoading && (
                          <div className="px-3 py-4 text-xs text-gray-500">No notifications yet.</div>
                        )}
                        {notifications.map((n) => (
                          <button
                            key={n.id}
                            onClick={() => handleNotificationClick(n)}
                            className={`w-full text-left px-3 py-3 hover:bg-white/5 transition-colors ${
                              !n.readAt ? 'bg-brand-lime/5 border-l border-brand-lime/40' : ''
                            }`}
                          >
                            <div className="text-xs uppercase text-gray-500 font-bold flex items-center justify-between">
                              <span>{n.type || 'Update'}</span>
                              {n.createdAt && (
                                <span className="text-[10px] text-gray-500">
                                  {new Date(n.createdAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-white font-semibold">{n.title}</div>
                            <div className="text-xs text-gray-400">{formatNotificationBody(n)}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <Link
                  to="/my-profile"
                  className="text-gray-400 hover:text-white transition-colors"
                  title="My Profile"
                >
                  <Settings size={20} />
                </Link>
                <button 
                  onClick={handleLogout}
                  className="text-gray-400 hover:text-white transition-colors"
                  title="Sign Out"
                >
                  <LogOut size={20} />
                </button>
              </div>
            ) : (
              <>
                <Link
                  to="/portal/register"
                  className="border border-white/20 text-white hover:bg-white/10 px-4 py-2 rounded font-sports font-bold uppercase tracking-wider transition-all"
                >
                  Activate My Profile
                </Link>
                <Link
                  to="/register"
                  className="bg-brand-red hover:bg-red-600 text-white px-5 py-2 rounded font-sports font-bold uppercase tracking-wider transition-all transform hover:scale-105"
                >
                  Register Now
                </Link>
                <Link to="/login" className="text-gray-300 hover:text-white font-medium text-sm">
                  LOG IN
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="-mr-2 flex md:hidden">
            <button
              onClick={toggleMenu}
              type="button"
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800 focus:outline-none"
              aria-controls="mobile-menu"
              aria-expanded={isOpen}
            >
              <span className="sr-only">Open main menu</span>
              {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden absolute top-20 left-0 w-full bg-brand-black border-b border-white/10 shadow-2xl animate-fadeIn" id="mobile-menu">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 border-t border-white/5">
            {links.map((link) => {
              const isMyTeamLink = link.name === 'My Team' && (playerTeams.length > 1 || hasCaptainTeam);
              if (isMyTeamLink) {
                return (
                  <div key={link.name}>
                    <button
                      onClick={() => setMobileTeamDropdownOpen((prev) => !prev)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-base font-medium ${
                        isActive(link.path)
                          ? 'text-brand-lime bg-gray-900'
                          : 'text-gray-300 hover:text-white hover:bg-gray-800'
                      }`}
                    >
                      <span>{link.name}</span>
                      <ChevronDown
                        size={16}
                        className={`${mobileTeamDropdownOpen ? 'rotate-180' : ''} transition-transform`}
                      />
                    </button>
                    {mobileTeamDropdownOpen && (
                      <div className="mt-1 ml-3 rounded-md border border-white/10 overflow-hidden">
                        {playerTeams.map((team) => {
                          const selected = team.id === playerTeamId;
                          return (
                            <div
                              key={team.id}
                              className={`flex items-stretch ${
                                selected ? 'bg-brand-lime/10' : 'hover:bg-white/5'
                              }`}
                            >
                              <button
                                onClick={() => handleTeamSwitch(team.id, true)}
                                className={`flex-1 text-left px-3 py-2 ${
                                  selected ? 'text-brand-lime' : 'text-gray-200 hover:text-white'
                                }`}
                              >
                                <div className="text-sm font-semibold flex items-center gap-1">
                                  <span>{team.name}</span>
                                  {team.isCaptain && <Crown size={12} className="text-brand-lime" />}
                                </div>
                                {team.division && <div className="text-[11px] uppercase text-gray-400">{team.division}</div>}
                              </button>
                              {team.isCaptain && (
                                <button
                                  onClick={() => handleManageTeam(team.id, true)}
                                  className="rounded-r-md bg-brand-lime px-3 text-[11px] uppercase tracking-wide font-semibold text-black hover:brightness-95"
                                >
                                  Team Manager
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <Link
                  key={link.name}
                  to={link.path}
                  onClick={() => setIsOpen(false)}
                  className={`block px-3 py-2 rounded-md text-base font-medium ${
                    isActive(link.path)
                      ? 'text-brand-lime bg-gray-900'
                      : 'text-gray-300 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  {link.name}
                </Link>
              );
            })}
            {showTeamActions && (
              <div>
                <button
                  onClick={() => setMobileTeamActionsDropdownOpen((prev) => !prev)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-base font-medium ${
                    location.pathname === '/my-season' || location.pathname === '/register'
                      ? 'text-brand-lime bg-gray-900'
                      : 'text-gray-300 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  <span>Register</span>
                  <ChevronDown
                    size={16}
                    className={`${mobileTeamActionsDropdownOpen ? 'rotate-180' : ''} transition-transform`}
                  />
                </button>
                {mobileTeamActionsDropdownOpen && (
                  <div className="mt-1 ml-3 rounded-md border border-white/10 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => handleJoinTeamAction(true)}
                      className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm text-gray-200 hover:bg-white/5 hover:text-white"
                    >
                      <Users size={15} className="text-brand-lime" />
                      <span>Join a Team</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCreateTeamAction(true)}
                      className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-3 text-left text-sm text-gray-200 hover:bg-white/5 hover:text-white"
                    >
                      <Plus size={15} className="text-brand-lime" />
                      <span>Create New Team</span>
                    </button>
                  </div>
                )}
              </div>
            )}
            
            <div className="border-t border-gray-800 pt-4 mt-4">
              {user ? (
                 <div className="px-3">
                    <div className="flex items-center gap-3 mb-4">
                       <Link
                         to="/my-profile"
                         onClick={() => setIsOpen(false)}
                         className={`w-10 h-10 rounded-full flex items-center justify-center font-bold overflow-hidden hover:ring-2 hover:ring-white/40 transition ${isAdmin ? 'bg-brand-red text-white' : 'bg-brand-lime text-black'}`}
                         title="Edit Profile"
                       >
                         {resolvedAvatarUrl ? (
                           <img
                             src={resolvedAvatarUrl}
                             alt="User"
                             className="w-full h-full object-cover"
                             onError={() => setResolvedAvatarUrl('')}
                           />
                         ) : (
                           <UserIcon size={20} />
                         )}
                       </Link>
                        <div>
                            <div className="text-white font-bold">{resolvedUserName}</div>
                            <div className="text-xs text-gray-400">{user.email}</div>
                         </div>
                     </div>
                    <button
                      onClick={() => {
                        navigate('/my-profile');
                        setIsOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-base font-medium text-gray-300 hover:bg-gray-800 rounded-md"
                    >
                      <Settings size={18} /> My Profile
                    </button>
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 px-3 py-2 text-base font-medium text-brand-red hover:bg-gray-800 rounded-md"
                    >
                      <LogOut size={18} /> Sign Out
                    </button>
                 </div>
              ) : (
                <div className="space-y-2 px-3">
                  <Link
                    to="/register"
                    onClick={() => setIsOpen(false)}
                    className="block w-full text-center bg-brand-red text-white px-5 py-3 rounded font-sports font-bold uppercase tracking-wider"
                  >
                    Register Now
                  </Link>
                  <Link
                    to="/portal/register"
                    onClick={() => setIsOpen(false)}
                    className="block w-full text-center border border-white/20 text-white px-5 py-3 rounded font-sports font-bold uppercase tracking-wider hover:bg-white/10 transition-colors"
                  >
                    Activate My Profile
                  </Link>
                  <Link
                    to="/login"
                    onClick={() => setIsOpen(false)}
                    className="block w-full text-center px-3 py-2 rounded-md text-base font-medium text-gray-300 hover:text-white hover:bg-white/5 border border-white/10"
                  >
                    Log In
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
