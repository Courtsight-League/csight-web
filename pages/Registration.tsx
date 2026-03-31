
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Check, Upload, X, Shield, Lock, Loader2, CreditCard, CalendarClock, Wallet } from 'lucide-react';
import { signInWithGoogle, registerWithEmail, hydrateUserFromSupabase, getStoredUser, logout } from '../services/authService';
import { supabase } from '../services/supabaseClient';
import { supabaseAdmin } from '../services/supabaseAdminClient';
import { renderRegistrationEmailTemplate } from '../services/registrationEmailTemplates';
import { sendRegistrationStageEmail } from '../services/registrationStageEmailService';
import { markLeagueRegistrationLeadCompleted } from '../services/leagueRegistrationService';
import { getDefaultStripePaymentLinks, loadStripePaymentLinks } from '../services/stripePaymentLinks';
import { buildPlayerPortalUrl, sendPlayerClaimEmail } from '../services/playerClaimEmailService';
import {
  loadJerseyManagementSettings,
  saveJerseyManagementSettings,
  upsertTeamJerseyWorkflow,
} from '../services/jerseyManagement';
import { User } from '../types';
import { sortSeasonsNewestFirst } from '../utils/seasonOrdering';

type RegistrationType = 'create-team' | 'join-team' | 'individual';

type AvailableTeam = {
  id: string;
  name: string;
  division: string;
  label: string;
  shortName: string;
};

type RegistrationSeasonOption = {
  id: string;
  name: string;
  year?: string | number | null;
  is_current?: boolean | null;
  start_date?: string | null;
  is_public?: boolean | string | null;
  registration_open?: boolean | string | null;
};

type CaptainRosterEntry = {
  id: string;
  fullName: string;
  email: string;
  playerPosition: string;
  jerseyName: string;
  jerseyNumberChoices: string;
  jerseySize: string;
  shortsSize: string;
};

type ExistingPlayerSuggestion = {
  id: string;
  fullName: string;
  email: string;
  playerPosition: string;
  jerseyName: string;
  jerseyNumber: string;
  jerseySize: string;
  shortsSize: string;
  seasonLabel: string;
};

type CaptainRosterInviteTarget = {
  playerId: string | null;
  email: string;
  playerName: string;
};

const getAuthProvider = (user?: any) =>
  (user?.app_metadata?.provider || '').toString().toLowerCase();

const parseBool = (value: any, fallback = true) => {
  if (value === true || value === 'true' || value === 'TRUE' || value === 't' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 'FALSE' || value === 'f' || value === 0 || value === '0') return false;
  return fallback;
};

const normalizeEmail = (value?: string) => (value || '').trim().toLowerCase();

const formatSeasonLabel = (season?: RegistrationSeasonOption | null) => {
  const name = (season?.name || 'Season').trim();
  const year = season?.year ? String(season.year).trim() : '';
  if (year && name.toLowerCase().includes(year.toLowerCase())) return name;
  return `${name}${year ? ` ${year}` : ''}`.trim();
};

const makeCaptainRosterEntry = (): CaptainRosterEntry => ({
  id: `roster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  fullName: '',
  email: '',
  playerPosition: '',
  jerseyName: '',
  jerseyNumberChoices: '',
  jerseySize: 'L',
  shortsSize: 'L',
});

const parsePreferredJerseyNumber = (value?: string | null): number | null => {
  const first = String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)[0];
  if (!first) return null;
  const parsed = Number(first);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const sanitizeJerseyNumberInput = (value?: string | null) =>
  String(value || '')
    .replace(/\D/g, '')
    .slice(0, 3);

const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'heic',
  'heif',
]);

const getFileExtension = (value?: string | null) => {
  const match = String(value || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
};

const sanitizeStorageFileName = (value?: string | null, fallbackBase = 'upload') => {
  const ext = getFileExtension(value) || 'jpg';
  const base = String(value || '')
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${base || fallbackBase}.${ext}`;
};

const validateImageUploadFile = (file: File, label: string) => {
  const isImageMime = (file.type || '').toLowerCase().startsWith('image/');
  const hasImageExtension = ALLOWED_IMAGE_EXTENSIONS.has(getFileExtension(file.name));
  if (!isImageMime && !hasImageExtension) {
    return `${label} must be an image file. Try PNG, JPG, WEBP, SVG, HEIC, or GIF.`;
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return `${label} must be 5MB or smaller.`;
  }
  return null;
};

const Registration: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const inviteTeamParam = searchParams.get('team');
  const inviteFlow = searchParams.get('invite') === '1';
  const isStatsPortalFlow =
    searchParams.get('statsPortal') === '1' || location.pathname.startsWith('/portal/register');
  const leadIdParam = searchParams.get('leadId');
  const lockRegType = !!inviteTeamParam;
  const inviteEmailParam = (searchParams.get('email') || '').trim();
  const normalizedInviteEmail = normalizeEmail(inviteEmailParam);
  const lockInviteEmail = lockRegType && !!normalizedInviteEmail;
  
  // Determine initial state from URL or default to setup-my-team
  const getInitialType = (): RegistrationType => {
    const type = (searchParams.get('type') || '').trim().toLowerCase();
    if (type === 'team') return 'create-team';
    if (type === 'join' || type === 'existing-team') return 'join-team';
    if (type === 'free-agent' || type === 'freeagent') return 'individual';
    return 'create-team';
  };

  const [regType, setRegType] = useState<RegistrationType>(getInitialType());
  const [step, setStep] = useState(1);
  const [portalScreen, setPortalScreen] = useState<1 | 2>(1);
  const isStatsPortalJerseyStep = isStatsPortalFlow && portalScreen === 2;
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // OAuth State
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [googleLinked, setGoogleLinked] = useState(false);
  const [accountIntent, setAccountIntent] = useState<'new' | 'existing'>('new');
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);
  const hasExistingAccount = !!currentUser?.id;
  const shouldShowPasswordFields =
    !googleLinked && !hasExistingAccount && (accountIntent === 'new' || needsPasswordSetup);
  const isExistingAccountFlow = hasExistingAccount || (accountIntent === 'existing' && !needsPasswordSetup);
  const shouldLockFullName = hasExistingAccount;

  // Sync state if URL param changes
  useEffect(() => {
    setRegType(getInitialType());
  }, [searchParams]);

  useEffect(() => {
    setCurrentUser(getStoredUser());
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const links = await loadStripePaymentLinks();
      if (!mounted) return;
      setStripeLinks(links);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // If user backs out of OAuth (browser back), clear loading state so the form is usable again.
  useEffect(() => {
    const resetLoading = () => setIsAuthLoading(false);
    window.addEventListener('pageshow', resetLoading);
    window.addEventListener('popstate', resetLoading);
    return () => {
      window.removeEventListener('pageshow', resetLoading);
      window.removeEventListener('popstate', resetLoading);
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(rosterSearchTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      rosterSearchTimersRef.current = {};
    };
  }, []);

  // Form State
  const [formData, setFormData] = useState({
    // Account Credentials
    email: '',
    password: '',
    confirmPassword: '',

    // Common Fields
    fullName: '',
    birthDate: '',
    phone: '',
    playerPosition: '',
    playerNumber: '', // Changed to string for "Top 3"
    jerseySize: 'L',
    shortsSize: 'L',
    jerseyName: '',
    referralSource: '',
    nbaComparison: '',
    instagram: '',
    
    // Team Specific
    teamName: '',
    division: 'D2',
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [savedLogo, setSavedLogo] = useState<{ name: string; path: string } | null>(null);
  const [savedBanner, setSavedBanner] = useState<{ name: string; path: string } | null>(null);
  const [jerseyDesignFiles, setJerseyDesignFiles] = useState<Array<File | null>>([null, null, null]);
  const [captainRosterEntries, setCaptainRosterEntries] = useState<CaptainRosterEntry[]>([makeCaptainRosterEntry()]);
  const [rosterModalOpen, setRosterModalOpen] = useState(false);
  const [rosterSuggestions, setRosterSuggestions] = useState<Record<string, ExistingPlayerSuggestion[]>>({});
  const [activeRosterSuggestionId, setActiveRosterSuggestionId] = useState<string | null>(null);
  const [joinPrefillNotice, setJoinPrefillNotice] = useState<string | null>(null);
  const [joinPrefillKey, setJoinPrefillKey] = useState<string>('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadingDesigns, setUploadingDesigns] = useState(false);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const [prefilledFromSession, setPrefilledFromSession] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [isCheckingRegistration, setIsCheckingRegistration] = useState(true);
  const [alreadyMemberNotice, setAlreadyMemberNotice] = useState<{
    message: string;
    redirectTo: string;
  } | null>(null);
  const [availableTeams, setAvailableTeams] = useState<AvailableTeam[]>([]);
  const [teamCodeInput, setTeamCodeInput] = useState('');
  const [teamCodeMessage, setTeamCodeMessage] = useState<string | null>(null);
  const isEmailInputValid = useMemo(() => /\S+@\S+\.\S+/.test(formData.email), [formData.email]);
  const [activeSeasonName, setActiveSeasonName] = useState<string>('upcoming season');
  const [availableRegistrationSeasons, setAvailableRegistrationSeasons] = useState<RegistrationSeasonOption[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>('');
  const [supportsRegistrationOpen, setSupportsRegistrationOpen] = useState<boolean>(true);
  const [availableDivisions, setAvailableDivisions] = useState<string[]>([]);
  const [pendingRegistration, setPendingRegistration] = useState<{
    userId: string | null;
    seasonId: string | null;
    regType: RegistrationType;
    teamName: string;
    division: string;
    joinTeamId?: string | null;
    fullName: string;
    firstName: string;
    lastName: string;
    playerNumber: number | null;
    position: string;
    logoPath: string | null;
    bannerPath: string | null;
    jerseySize: string;
    shortsSize: string;
    jerseyName: string;
    referralSource: string;
    nbaComparison: string;
    instagram: string;
    birthDate: string;
    phone: string;
    captainRosterEntries: CaptainRosterEntry[];
  } | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [registrationResult, setRegistrationResult] = useState<{ teamId: string | null; playerId: string | null } | null>(null);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [waiverUrl, setWaiverUrl] = useState<string>('');
  const [showWaiverModal, setShowWaiverModal] = useState(false);
  const [waiverScrolled, setWaiverScrolled] = useState(false);
  const [duplicateEmail, setDuplicateEmail] = useState<string | null>(null);
  const [duplicateEmailRedirectPath, setDuplicateEmailRedirectPath] = useState<string | null>(null);
  const [stripeLinks, setStripeLinks] = useState(getDefaultStripePaymentLinks());
  const waiverScrollRef = useRef<HTMLDivElement | null>(null);
  const rosterSearchTimersRef = useRef<Record<string, number>>({});
  const navigateIfAlreadyRegistered = async () => {
    try {
      const skip = sessionStorage.getItem('skipRegistrationRedirectOnce');
      const skipRedirects = !!skip || (!!inviteTeamParam && inviteFlow);
      if (skip) {
        sessionStorage.removeItem('skipRegistrationRedirectOnce');
      }

      // Allow join-team flow even if a player already exists, unless it's a captain invite link
      const { data } = await supabase.auth.getUser();
      const authUser = data?.user;
      if (!authUser?.id) {
        return false;
      }

      if (skipRedirects) {
        return false;
      }

      // Stats Portal registration must stay accessible even for existing logged-in users.
      if (isStatsPortalFlow) {
        return false;
      }

      if (regType === 'create-team') {
        // Allow returning free agents/captains to land on the team form
        return false;
      }

      if (regType === 'join-team') {
        if (inviteTeamParam) {
          const { data: memberRow } = await supabase
            .from('players')
            .select('id,team_id,is_captain,created_at')
            .eq('user_id', authUser.id)
            .eq('team_id', inviteTeamParam)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (memberRow?.team_id === inviteTeamParam) {
            const redirectTo = memberRow.is_captain ? '/manage-team' : '/my-team';
            setAlreadyMemberNotice({
              message: 'You are already a member of this team. Redirecting...',
              redirectTo,
            });
            window.setTimeout(() => {
              window.location.replace(redirectTo);
            }, 1400);
            return true;
          }
        }
        // Allow join-team flow to continue even if the user already has another team in this season.
        return false;
      }

      // Get active season
      const seasonId = await getActiveSeasonId();
      if (!seasonId) return false;

      const { data: existingPlayer } = await supabase
        .from('players')
        .select('id')
        .eq('user_id', authUser.id)
        .eq('season_id', seasonId)
        .maybeSingle();

      if (existingPlayer?.id) {
        window.location.replace('/my-season');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const getRegistrationRedirectPath = () => {
    const typeParam =
      regType === 'create-team' ? 'team' : regType === 'join-team' ? 'join' : 'individual';
    const teamParam = regType === 'join-team' ? formData.teamName : '';
    const codeParam = regType === 'join-team' ? teamCodeInput.trim() : '';
    const params = new URLSearchParams();
    params.set('type', typeParam);
    if (teamParam) params.set('team', teamParam);
    else if (codeParam) params.set('code', codeParam);
    if (isStatsPortalFlow) params.set('statsPortal', '1');
    if (selectedSeasonId) params.set('seasonId', selectedSeasonId);
    return `/portal/register?${params.toString()}`;
  };

  const cacheRegistrationDraftForRedirect = (redirectPath: string) => {
    try {
      const draft = {
        ...formData,
        password: '',
        confirmPassword: '',
      };
      const draftPayload = JSON.stringify(draft);
      sessionStorage.setItem('postAuthRedirect', redirectPath);
      localStorage.setItem('postAuthRedirect', redirectPath);
      sessionStorage.setItem('pendingRegistrationForm', draftPayload);
      localStorage.setItem('pendingRegistrationForm', draftPayload);
      sessionStorage.setItem('pendingTeamName', formData.teamName || '');
      localStorage.setItem('pendingTeamName', formData.teamName || '');
      sessionStorage.setItem('pendingTeamCode', teamCodeInput || '');
      localStorage.setItem('pendingTeamCode', teamCodeInput || '');
      sessionStorage.setItem('pendingDivision', formData.division || '');
      localStorage.setItem('pendingDivision', formData.division || '');
      sessionStorage.setItem('pendingSeasonId', selectedSeasonId || '');
      localStorage.setItem('pendingSeasonId', selectedSeasonId || '');
      sessionStorage.setItem('authFlow', 'register');
      localStorage.setItem('authFlow', 'register');
      sessionStorage.setItem('startedFromRegistration', 'true');
      localStorage.setItem('startedFromRegistration', 'true');
    } catch (storageErr) {
      console.warn('Registration redirect cache failed', storageErr);
    }
  };

  const handleDuplicateEmailDetected = () => {
    const redirectPath = getRegistrationRedirectPath();
    cacheRegistrationDraftForRedirect(redirectPath);
    const normalizedEmail = formData.email.trim().toLowerCase();
    setDuplicateEmail(normalizedEmail);
    setDuplicateEmailRedirectPath(redirectPath);
    setSubmitError('This email is already registered. Try logging in or use a different email to continue.');
    setIsSubmitting(false);
  };

  const goToLoginFromDuplicateEmail = () => {
    const redirectPath = duplicateEmailRedirectPath || getRegistrationRedirectPath();
    cacheRegistrationDraftForRedirect(redirectPath);
    setDuplicateEmailRedirectPath(redirectPath);
    navigate('/login');
  };

  const promptLoginForExistingAccount = () => {
    if (!isEmailInputValid) {
      setSubmitError('Please enter the email associated with your existing account to continue.');
      return;
    }
    const redirectPath = getRegistrationRedirectPath();
    cacheRegistrationDraftForRedirect(redirectPath);
    const normalizedEmail = formData.email.trim().toLowerCase();
    setDuplicateEmail(normalizedEmail);
    setDuplicateEmailRedirectPath(redirectPath);
    navigate('/login');
  };

  const handleSignOutAndReload = async () => {
    const params = searchParams.toString();
    const targetPath = `/portal/register${params ? `?${params}` : ''}`;
    try {
      await logout();
    } finally {
      window.location.assign(targetPath);
    }
  };

  // Prefill from existing session (e.g., after returning from Google OAuth)
  useEffect(() => {
    const prefill = async () => {
      if (prefilledFromSession) return;
      try {
        const { data } = await supabase.auth.getUser();
        const authUser = data?.user;
        const provider = getAuthProvider(authUser);
        const meta = (authUser?.user_metadata || {}) as any;
        const savedTeamName =
          sessionStorage.getItem('pendingTeamName') || localStorage.getItem('pendingTeamName') || '';
        const savedTeamCode =
          sessionStorage.getItem('pendingTeamCode') || localStorage.getItem('pendingTeamCode') || '';
        const savedDivision =
          sessionStorage.getItem('pendingDivision') || localStorage.getItem('pendingDivision') || '';
        const savedSeasonId =
          sessionStorage.getItem('pendingSeasonId') || localStorage.getItem('pendingSeasonId') || '';
        const querySeasonId = (searchParams.get('seasonId') || searchParams.get('season') || '').trim();
        const queryTeamName = (searchParams.get('teamName') || '').trim();
        const queryDivision = (searchParams.get('division') || '').trim();
        const savedDraftRaw =
          sessionStorage.getItem('pendingRegistrationForm') ||
          localStorage.getItem('pendingRegistrationForm') ||
          '';
        const savedLogoRaw =
          sessionStorage.getItem('pendingLogoRef') || localStorage.getItem('pendingLogoRef') || '';
        const savedBannerRaw =
          sessionStorage.getItem('pendingBannerRef') || localStorage.getItem('pendingBannerRef') || '';
        let restoredDraft: any = null;
        let restoredLogo: { name: string; path: string } | null = null;
        let restoredBanner: { name: string; path: string } | null = null;
        if (savedDraftRaw) {
          try {
            restoredDraft = JSON.parse(savedDraftRaw);
          } catch {
            restoredDraft = null;
          }
        }
        if (savedLogoRaw) {
          try {
            restoredLogo = JSON.parse(savedLogoRaw);
          } catch {
            restoredLogo = null;
          }
        }
        if (savedBannerRaw) {
          try {
            restoredBanner = JSON.parse(savedBannerRaw);
          } catch {
            restoredBanner = null;
          }
        }

        const hasRestorableData =
          !!authUser?.email ||
          !!savedTeamName ||
          !!savedDivision ||
          !!savedSeasonId ||
          !!savedTeamCode ||
          !!querySeasonId ||
          !!queryTeamName ||
          !!queryDivision ||
          !!restoredDraft ||
          !!restoredLogo ||
          !!restoredBanner;

        if (!hasRestorableData) return;

        setFormData(prev => ({
          ...prev,
          ...(restoredDraft || {}),
          email:
            authUser?.email ||
            (lockInviteEmail ? normalizedInviteEmail : restoredDraft?.email || prev.email),
          fullName:
            meta.full_name ||
            restoredDraft?.fullName ||
            prev.fullName ||
            authUser?.email?.split('@')[0] ||
            '',
          teamName: restoredDraft?.teamName || savedTeamName || queryTeamName || prev.teamName || '',
          division: savedDivision || restoredDraft?.division || queryDivision || prev.division || 'D2',
          password: '',
          confirmPassword: '',
        }));
        sessionStorage.removeItem('pendingTeamName');
        localStorage.removeItem('pendingTeamName');
        sessionStorage.removeItem('pendingTeamCode');
        localStorage.removeItem('pendingTeamCode');
        sessionStorage.removeItem('pendingDivision');
        localStorage.removeItem('pendingDivision');
        sessionStorage.removeItem('pendingSeasonId');
        localStorage.removeItem('pendingSeasonId');
        sessionStorage.removeItem('pendingDivisionId');
        localStorage.removeItem('pendingDivisionId');
        sessionStorage.removeItem('pendingRegistrationForm');
        localStorage.removeItem('pendingRegistrationForm');
        sessionStorage.removeItem('pendingLogoRef');
        localStorage.removeItem('pendingLogoRef');
        sessionStorage.removeItem('pendingBannerRef');
        localStorage.removeItem('pendingBannerRef');
        if (restoredLogo) setSavedLogo(restoredLogo);
        if (restoredBanner) setSavedBanner(restoredBanner);
        if (savedTeamCode && !savedTeamName) {
          setTeamCodeInput(savedTeamCode);
        }
        if (authUser?.email) {
          setGoogleLinked(provider === 'google');
        }
        if (savedSeasonId || querySeasonId) {
          setSelectedSeasonId(savedSeasonId || querySeasonId);
        }
        setPrefilledFromSession(true);
      } catch {
        // ignore
      }
    };
    prefill();

    const startedFromReg =
      sessionStorage.getItem('startedFromRegistration') ||
      localStorage.getItem('startedFromRegistration');
    if (startedFromReg) {
      sessionStorage.removeItem('startedFromRegistration');
      localStorage.removeItem('startedFromRegistration');
      setIsCheckingRegistration(false);
      return;
    }

    navigateIfAlreadyRegistered().finally(() => setIsCheckingRegistration(false));
  }, [prefilledFromSession, navigateIfAlreadyRegistered, searchParams, lockInviteEmail, normalizedInviteEmail]);

  useEffect(() => {
    if (!lockInviteEmail || hasExistingAccount) return;
    setFormData((prev) => {
      if ((prev.email || '').trim().toLowerCase() === normalizedInviteEmail) return prev;
      return { ...prev, email: normalizedInviteEmail };
    });
  }, [lockInviteEmail, normalizedInviteEmail, hasExistingAccount, prefilledFromSession]);

  useEffect(() => {
    if (!duplicateEmail) return;
    const normalized = formData.email.trim().toLowerCase();
    if (normalized !== duplicateEmail) {
      setDuplicateEmail(null);
      setDuplicateEmailRedirectPath(null);
    }
  }, [formData.email, duplicateEmail]);

  // Payment status via query param (e.g., Stripe redirect)
  useEffect(() => {
    const status = searchParams.get('payment');
    let redirectTimer: number | undefined;
    if (status === 'success') {
      setPaymentMessage('Payment completed. Thank you!');
      (async () => {
        try {
          // Best-effort: mark paid if the Stripe "after payment" redirect returns here while the user session still exists.
          try {
            const { data: udata } = await supabase.auth.getUser();
            const uid = udata?.user?.id || null;
            if (uid) {
              try {
                localStorage.setItem(`courtsight_payment_status_${uid}`, 'paid');
              } catch {}
              try {
                await supabase.from('profiles').update({ payment_status: 'paid' }).eq('user_id', uid);
              } catch (err) {
                console.warn('payment_status paid update failed', err);
              }
            }
          } catch (err) {
            console.warn('payment status success handler failed', err);
          }

          const { data } = await supabase.auth.getUser();
          const provider = getAuthProvider(data?.user);
          if (provider !== 'google') {
            setPaymentMessage('Payment completed. Thank you! Redirecting to login...');
            redirectTimer = window.setTimeout(async () => {
              try {
                await supabase.auth.signOut();
              } catch {}
              window.location.replace('/login');
            }, 1500);
          }
        } catch {
          setPaymentMessage('Payment completed. Thank you! Redirecting to login...');
          redirectTimer = window.setTimeout(() => {
            window.location.replace('/login');
          }, 1500);
        }
      })();
    } else if (status === 'canceled') {
      setPaymentMessage('Payment was canceled. You can try again or choose Pay Later.');
    }
    return () => {
      if (redirectTimer) window.clearTimeout(redirectTimer);
    };
  }, [searchParams]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const nextValue =
      e.target.name === 'playerNumber' ? sanitizeJerseyNumberInput(e.target.value) : e.target.value;
    setFormData({ ...formData, [e.target.name]: nextValue });
  };

  useEffect(() => {
    // If user changes email after we asked for password setup, re-check on next submit.
    if (needsPasswordSetup) {
      setNeedsPasswordSetup(false);
    }
  }, [formData.email]);

  useEffect(() => {
    // Logged-in users: always trust the authenticated account name.
    if (!hasExistingAccount) return;
    const syncedName = (currentUser?.name || '').trim() || (formData.email || '').trim().split('@')[0] || '';
    if (!syncedName) return;
    setFormData((prev) => {
      if ((prev.fullName || '').trim() === syncedName) return prev;
      return { ...prev, fullName: syncedName };
    });
  }, [hasExistingAccount, formData.email, currentUser?.name]);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    e.currentTarget.value = '';
    if (!file) return;
    const error = validateImageUploadFile(file, 'Team logo');
    if (error) {
      setMediaUploadError(error);
      setSubmitError(error);
      return;
    }
    setMediaUploadError(null);
    setSubmitError(null);
    setLogoFile(file);
  };

  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    e.currentTarget.value = '';
    if (!file) return;
    const error = validateImageUploadFile(file, 'Team banner');
    if (error) {
      setMediaUploadError(error);
      setSubmitError(error);
      return;
    }
    setMediaUploadError(null);
    setSubmitError(null);
    setBannerFile(file);
  };

  const clearLogo = () => {
    setLogoFile(null);
    setSavedLogo(null);
  };

  const clearBanner = () => {
    setBannerFile(null);
    setSavedBanner(null);
  };

  const handleJerseyDesignFileChange = (slotIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    e.currentTarget.value = '';
    if (!file) return;
    const error = validateImageUploadFile(file, `Inspiration ${slotIndex + 1}`);
    if (error) {
      setMediaUploadError(error);
      setSubmitError(error);
      return;
    }
    setMediaUploadError(null);
    setSubmitError(null);
    setJerseyDesignFiles((prev) => {
      const next = [...prev];
      next[slotIndex] = file;
      return next;
    });
  };

  const clearJerseyDesignFile = (index: number) => {
    setJerseyDesignFiles((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  };

  const updateCaptainRosterEntry = (entryId: string, patch: Partial<CaptainRosterEntry>) => {
    setCaptainRosterEntries((prev) =>
      prev.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry))
    );
  };

  const clearRosterSuggestions = (entryId: string) => {
    setRosterSuggestions((prev) => {
      if (!prev[entryId]) return prev;
      const next = { ...prev };
      delete next[entryId];
      return next;
    });
  };

  const applyRosterSuggestion = (entryId: string, suggestion: ExistingPlayerSuggestion) => {
    updateCaptainRosterEntry(entryId, {
      fullName: suggestion.fullName,
      email: suggestion.email,
      playerPosition: suggestion.playerPosition,
      jerseyName: suggestion.jerseyName || suggestion.fullName,
      jerseyNumberChoices: suggestion.jerseyNumber,
      jerseySize: suggestion.jerseySize || 'L',
      shortsSize: suggestion.shortsSize || 'L',
    });
    clearRosterSuggestions(entryId);
    setActiveRosterSuggestionId(null);
  };

  const queueRosterSuggestionSearch = (entryId: string, rawTerm: string) => {
    const term = rawTerm.trim();
    if (rosterSearchTimersRef.current[entryId]) {
      window.clearTimeout(rosterSearchTimersRef.current[entryId]);
      delete rosterSearchTimersRef.current[entryId];
    }

    if (term.length < 2) {
      clearRosterSuggestions(entryId);
      return;
    }

    rosterSearchTimersRef.current[entryId] = window.setTimeout(async () => {
      const tokens = term
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .slice(0, 2);
      if (!tokens.length) {
        clearRosterSuggestions(entryId);
        return;
      }

      const patternTokens = tokens.map((token) => `*${token.replace(/[,*]/g, '')}*`);
      const selectVariants = [
        'id,season_id,first_name,last_name,position,jersey_name,jersey_number,jersey_size,shorts_size,email,email_address,created_at',
        'id,season_id,first_name,last_name,position,jersey_name,jersey_number,jersey_size,shorts_size,email,created_at',
        'id,season_id,first_name,last_name,position,jersey_name,jersey_number,jersey_size,shorts_size,email_address,created_at',
        'id,season_id,first_name,last_name,position,jersey_name,jersey_number,jersey_size,shorts_size,created_at',
      ];
      const isMissingColumn = (error: any) => {
        const code = (error?.code || '').toString();
        const msg = (error?.message || '').toString().toLowerCase();
        return code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
      };

      let rows: any[] = [];
      for (const select of selectVariants) {
        const filters = [
          ...patternTokens.map((pattern) => `first_name.ilike.${pattern}`),
          ...patternTokens.map((pattern) => `last_name.ilike.${pattern}`),
          ...patternTokens.map((pattern) => `jersey_name.ilike.${pattern}`),
        ];
        const { data, error } = await supabase
          .from('players')
          .select(select)
          .or(filters.join(','))
          .order('created_at', { ascending: false })
          .limit(8);
        if (!error) {
          rows = data || [];
          break;
        }
        if (!isMissingColumn(error)) {
          console.warn('roster player suggestion lookup failed', error);
          clearRosterSuggestions(entryId);
          return;
        }
      }

      const seasonLabelById = new Map(
        availableRegistrationSeasons.map((season) => [season.id, formatSeasonLabel(season)])
      );
      const normalizedTerm = term.toLowerCase();
      const suggestionsByIdentity = new Map<string, ExistingPlayerSuggestion>();

      for (const row of rows) {
        const id = String(row?.id || '').trim();
        if (!id) continue;

        const firstName = String(row?.first_name || '').trim();
        const lastName = String(row?.last_name || '').trim();
        const fullName = `${firstName} ${lastName}`.trim() || String(row?.jersey_name || '').trim() || 'Player';
        const email = normalizeEmail(String(row?.email || row?.email_address || ''));
        const seasonId = String(row?.season_id || '').trim();
        const seasonLabel = seasonLabelById.get(seasonId) || 'Existing Player';

        if (!fullName.toLowerCase().includes(normalizedTerm) && !email.includes(normalizedTerm)) {
          continue;
        }

        const identityKey = email || `${fullName.toLowerCase()}::${seasonId || seasonLabel.toLowerCase()}`;
        if (suggestionsByIdentity.has(identityKey)) {
          continue;
        }

        suggestionsByIdentity.set(identityKey, {
          id,
          fullName,
          email,
          playerPosition: String(row?.position || '').trim(),
          jerseyName: String(row?.jersey_name || '').trim(),
          jerseyNumber: row?.jersey_number != null ? String(row.jersey_number) : '',
          jerseySize: String(row?.jersey_size || '').trim(),
          shortsSize: String(row?.shorts_size || '').trim(),
          seasonLabel,
        });
      }

      const suggestions = Array.from(suggestionsByIdentity.values()).slice(0, 5);

      setRosterSuggestions((prev) => ({
        ...prev,
        [entryId]: suggestions,
      }));
    }, 220);
  };

  const addCaptainRosterEntry = () => {
    setCaptainRosterEntries((prev) => [...prev, makeCaptainRosterEntry()]);
  };

  const removeCaptainRosterEntry = (entryId: string) => {
    setCaptainRosterEntries((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((entry) => entry.id !== entryId);
    });
    clearRosterSuggestions(entryId);
    setActiveRosterSuggestionId((current) => (current === entryId ? null : current));
  };

  async function getActiveSeasonId(): Promise<string | null> {
    if (selectedSeasonId) return selectedSeasonId;

    // Fallback path: resolve from registration-open seasons directly.
    let rows: RegistrationSeasonOption[] = [];
    let supportsRegOpen = true;
    const withReg = await supabase
      .from('seasons')
      .select('id,name,year,is_current,start_date,is_public,registration_open')
      .order('start_date', { ascending: false });

    if (withReg.error) {
      const errAny = withReg.error as any;
      const msg = errAny?.message?.toString?.()?.toLowerCase?.() || '';
      const code = errAny?.code?.toString?.() || '';
      if (code === '42703' || msg.includes('registration_open')) {
        supportsRegOpen = false;
        const fallback = await supabase
          .from('seasons')
          .select('id,name,year,is_current,start_date,is_public')
          .order('start_date', { ascending: false });
        if (fallback.error) return null;
        rows = (fallback.data || []) as RegistrationSeasonOption[];
      } else {
        return null;
      }
    } else {
      rows = (withReg.data || []) as RegistrationSeasonOption[];
    }

    const openRows = supportsRegOpen
      ? rows.filter((row) => parseBool((row as any).registration_open, false))
      : rows.filter((row) => parseBool((row as any).is_public, true)).filter((row) => !!row.is_current);
    if (!openRows.length) return null;
    const preferred = openRows.find((row) => row.is_current) || openRows[0];
    return preferred?.id || null;
  };

  const splitName = (value: string): [string, string] => {
    const parts = value.trim().split(/\s+/);
    if (parts.length === 0) return ['Player', 'Captain'];
    const first = parts.shift() || 'Player';
    const last = parts.join(' ') || 'Captain';
    return [first, last];
  };

  const parseMissingColumn = (error: any) => {
    const lower = String(error?.message || '').toLowerCase();
    const relationMatch = lower.match(/column\s+\"?([a-z0-9_]+)\"?\s+of relation/);
    if (relationMatch?.[1]) return relationMatch[1];
    const genericMatch = lower.match(/column\s+([a-z0-9_]+)\s+does not exist/);
    return genericMatch?.[1] || null;
  };

  const findExistingPlayerUserId = async (
    teamId: string | null,
    seasonId: string | null,
    fullName: string
  ): Promise<string | null> => {
    if (!teamId || !seasonId) return null;
    const normalizedName = (fullName || '').trim();
    if (!normalizedName) return null;
    const [firstName, lastName] = splitName(normalizedName);
    const normalizedFirst = firstName.trim();
    const normalizedLast = lastName.trim();
    if (!normalizedFirst && !normalizedLast) return null;

    const runQuery = async (client: any): Promise<string | null> => {
      let builder: any = client
        .from('players')
        .select('user_id')
        .eq('team_id', teamId)
        .eq('season_id', seasonId)
        .not('user_id', 'is', null);

      if (normalizedFirst) {
        builder = builder.ilike('first_name', `${normalizedFirst}%`);
      }
      if (normalizedLast) {
        builder = builder.ilike('last_name', `${normalizedLast}%`);
      }

      const { data, error } = await builder.order('created_at', { ascending: false }).limit(1);
      if (!error && data?.[0]?.user_id) {
        return data[0].user_id;
      }
      return null;
    };

    const primary = await runQuery(supabase);
    if (primary) return primary;
    if (!supabaseAdmin) return null;
    return runQuery(supabaseAdmin);
  };

  const isEmailAlreadyRegistered = async (email: string, currentUserId: string | null) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return false;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id')
        .or(`email.eq.${normalized},email_address.eq.${normalized}`)
        .limit(1);
      if (!error && data?.[0]?.user_id) {
        return !currentUserId || data[0].user_id !== currentUserId;
      }
    } catch (err) {
      console.warn('email lookup failed', err);
    }

    try {
      const { data, error } = await supabase
        .from('admin_users')
        .select('user_id')
        .eq('email', normalized)
        .limit(1);
      if (!error && data?.[0]?.user_id) {
        return !currentUserId || data[0].user_id !== currentUserId;
      }
    } catch (err) {
      console.warn('admin email lookup failed', err);
    }

    if (supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserByEmail(normalized);
        if (!error && data?.user?.id) {
          return !currentUserId || data.user.id !== currentUserId;
        }
      } catch (err) {
        console.warn('auth user lookup failed', err);
      }
    }

    return false;
  };

  const sendRegistrationNotifications = async (opts: {
    regType: RegistrationType;
    teamId: string | null;
    teamName: string;
    seasonId: string;
    fullName: string;
    email: string;
  }) => {
    // NOTE: The Stats Portal Registration email template is used for the league registration flow (/register).
    // Avoid sending this automatically here after portal completion to prevent duplicate/confusing emails.
  };

  const uploadTeamMedia = async (teamId: string): Promise<{ logo?: string; banner?: string }> => {
    const uploaded: { logo?: string; banner?: string } = {};
    setUploadingDesigns(true);
    try {
      if (logoFile) {
        const safeName = sanitizeStorageFileName(logoFile.name, 'logo');
        const path = `teams/${teamId}/logo-${Date.now()}-${safeName}`;
        const { data, error } = await supabase.storage.from('team-assets').upload(path, logoFile, { upsert: true });
        if (error) throw error;
        if (data?.path) uploaded.logo = data.path;
      } else if (savedLogo?.path) {
        uploaded.logo = savedLogo.path;
      }

      if (bannerFile) {
        const safeName = sanitizeStorageFileName(bannerFile.name, 'banner');
        const path = `teams/${teamId}/banner-${Date.now()}-${safeName}`;
        const { data, error } = await supabase.storage.from('team-assets').upload(path, bannerFile, { upsert: true });
        if (error) throw error;
        if (data?.path) uploaded.banner = data.path;
      } else if (savedBanner?.path) {
        uploaded.banner = savedBanner.path;
      }
    } catch (err: any) {
      const message =
        err?.message || 'Team media upload failed. Try a smaller PNG or JPG with a simpler file name.';
      setMediaUploadError(message);
      setSubmitError(message);
      throw new Error(message);
    } finally {
      setUploadingDesigns(false);
    }
    return uploaded;
  };

  const uploadJerseyDesignInspiration = async (teamId: string): Promise<string[]> => {
    const filesToUpload = jerseyDesignFiles.filter((file): file is File => Boolean(file));
    if (!filesToUpload.length) return [];
    const uploadedPaths: string[] = [];
    setUploadingDesigns(true);
    try {
      for (let i = 0; i < filesToUpload.length; i += 1) {
        const file = filesToUpload[i];
        const ext = getFileExtension(file.name) || 'jpg';
        const path = `teams/${teamId}/jersey-inspiration-${i + 1}-${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from('team-assets').upload(path, file, { upsert: true });
        if (error) throw error;
        uploadedPaths.push(path);
      }
      return uploadedPaths;
    } catch (err: any) {
      const message =
        err?.message || 'One of the jersey inspiration uploads failed. Try a smaller JPG or PNG with a simpler file name.';
      console.warn('jersey design upload failed', err);
      setMediaUploadError(message);
      setSubmitError(message);
      throw new Error(message);
    } finally {
      setUploadingDesigns(false);
    }
  };
  const handleGoogleAuth = async () => {
    setIsAuthLoading(true);
    try {
      // Preserve intent so OAuth callback can return to registration
      const redirectPath = getRegistrationRedirectPath();
      cacheRegistrationDraftForRedirect(redirectPath);

      // Pre-upload logo/banner so we don't serialize files in storage
      if (logoFile || bannerFile) {
        setUploadingDesigns(true);
        try {
          if (logoFile) {
            const safeName = sanitizeStorageFileName(logoFile.name, 'logo');
            const path = `pending/logo-${Date.now()}-${safeName}`;
            const { data, error } = await supabase.storage.from('team-assets').upload(path, logoFile, { upsert: true });
            if (error) throw error;
            if (data?.path) {
              setSavedLogo({ name: logoFile.name, path: data.path });
              const payload = JSON.stringify({ name: logoFile.name, path: data.path });
              sessionStorage.setItem('pendingLogoRef', payload);
              localStorage.setItem('pendingLogoRef', payload);
            }
          }
          if (bannerFile) {
            const safeName = sanitizeStorageFileName(bannerFile.name, 'banner');
            const path = `pending/banner-${Date.now()}-${safeName}`;
            const { data, error } = await supabase.storage.from('team-assets').upload(path, bannerFile, { upsert: true });
            if (error) throw error;
            if (data?.path) {
              setSavedBanner({ name: bannerFile.name, path: data.path });
              const payload = JSON.stringify({ name: bannerFile.name, path: data.path });
              sessionStorage.setItem('pendingBannerRef', payload);
              localStorage.setItem('pendingBannerRef', payload);
            }
          }
          setLogoFile(null);
          setBannerFile(null);
        } catch (uploadErr) {
          console.error('Pre-upload media failed', uploadErr);
        } finally {
          setUploadingDesigns(false);
        }
      }
      const user = await signInWithGoogle();
      // If Supabase returns a user immediately (no redirect), go straight to the intended form.
      if (user?.email) {
        setGoogleLinked(true);
        try {
          sessionStorage.setItem('skipRegistrationRedirectOnce', 'true');
        } catch {}
        const target = redirectPath;
        window.location.replace(target);
        return;
      }
      // If no user (redirect path), keep the loading state until navigation.
    } catch (error) {
      console.error("Google Auth Failed", error);
      alert("Failed to authenticate with Google. Please try again.");
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (isStatsPortalFlow && regType === 'individual') {
      setSubmitError(
        'Free-agent profile activation starts after team assignment. Wait for your captain invite link or contact CSL support.'
      );
      return;
    }

    if (isStatsPortalFlow && portalScreen === 1) {
      const validEmail = /\S+@\S+\.\S+/.test(formData.email.trim());
      if (!formData.fullName.trim()) {
        setSubmitError('Please enter your full legal name.');
        return;
      }
      if (!validEmail) {
        setSubmitError('Please enter a valid email address.');
        return;
      }
      if (regType === 'create-team') {
        if (!formData.teamName.trim()) {
          setSubmitError('Please enter your team name.');
          return;
        }
        if (!formData.division.trim()) {
          setSubmitError('Please select a division.');
          return;
        }
      }
      if (regType === 'join-team' && !formData.teamName.trim() && !teamCodeInput.trim()) {
        setSubmitError('Please select your team or enter a team code.');
        return;
      }
      if (!waiverAccepted) {
        setSubmitError('Please read and accept the CSL participation waiver before continuing.');
        return;
      }
      if (shouldShowPasswordFields) {
        if (formData.password.length < 8) {
          setSubmitError('Password must be at least 8 characters.');
          return;
        }
        if (formData.password !== formData.confirmPassword) {
          setSubmitError('Passwords do not match.');
          return;
        }
      }
      setPortalScreen(2);
      return;
    }

    if (!waiverAccepted) {
      setSubmitError('Please read and accept the CSL participation waiver before continuing.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: preAuthUserData } = await supabase.auth.getUser();
      const existingUserId = preAuthUserData?.user?.id || null;
      const authEmail = preAuthUserData?.user?.email?.trim().toLowerCase() || '';
      const inputEmail = formData.email.trim().toLowerCase();
      const resolvedEmail = authEmail || inputEmail;
      const requiresNewAccount =
        !existingUserId && !googleLinked && (accountIntent === 'new' || needsPasswordSetup);

      if (requiresNewAccount) {
        if (formData.password !== formData.confirmPassword) {
          alert("Passwords do not match. Please try again.");
          setIsSubmitting(false);
          return;
        }
        if (formData.password.length < 8) {
          alert("Password must be at least 8 characters.");
          setIsSubmitting(false);
          return;
        }
      }

      if (!resolvedEmail) {
        setSubmitError('Email is required.');
        setIsSubmitting(false);
        return;
      }

      // Existing-user mode: verify account by email first.
      // If found, user should log in instead of creating a new password here.
      // If not found, reveal password setup so they can create a new account.
      if (!existingUserId && !googleLinked && accountIntent === 'existing' && !needsPasswordSetup) {
        const emailExists = await isEmailAlreadyRegistered(resolvedEmail, null);
        if (emailExists) {
          const redirectPath = getRegistrationRedirectPath();
          cacheRegistrationDraftForRedirect(redirectPath);
          setDuplicateEmail(resolvedEmail);
          setDuplicateEmailRedirectPath(redirectPath);
          setSubmitError('Account found for this email. Please log in to continue registration.');
          setIsSubmitting(false);
          return;
        }

        setNeedsPasswordSetup(true);
        setSubmitError('No existing account found for this email. Create a password below to continue.');
        setIsSubmitting(false);
        return;
      }

      const seasonId = await getActiveSeasonId();
      if (!seasonId) {
        throw new Error('No registration-open season is available right now. Please contact the league admin.');
      }

      const [firstName, lastName] = splitName(formData.fullName);
      const jerseyPreference = formData.playerNumber.split(',')[0]?.trim();
      const jerseyNumber = jerseyPreference ? parseInt(jerseyPreference, 10) : null;
      const currentTypeParam = (searchParams.get('type') || '').trim().toLowerCase();
      const isJoinTeamRegistration =
        regType === 'join-team' ||
        currentTypeParam === 'join' ||
        currentTypeParam === 'existing-team' ||
        !!inviteTeamParam;
      const shouldRequireJerseyNumber = !isJoinTeamRegistration;
      if (shouldRequireJerseyNumber && !Number.isFinite(jerseyNumber)) {
        throw new Error('Jersey number is required.');
      }
      const incompleteCaptainRosterEntry = captainRosterEntries.find(
        (entry) =>
          (entry.fullName.trim() || entry.email.trim()) &&
          !parsePreferredJerseyNumber(entry.jerseyNumberChoices)
      );
      if (incompleteCaptainRosterEntry) {
        throw new Error('Jersey number is required for every added player.');
      }
      let resolvedJoinTeamId = formData.teamName.trim();
      let resolvedJoinTeamName = selectedJoinTeam?.name || '';
      if (regType === 'join-team') {
        if (!resolvedJoinTeamId && teamCodeInput.trim()) {
          const matchedTeam = findTeamByCodeOrId(teamCodeInput);
          if (!matchedTeam) {
            throw new Error('Invalid team code. Ask your captain for a valid code or invite link.');
          }
          resolvedJoinTeamId = matchedTeam.id;
          resolvedJoinTeamName = matchedTeam.name || matchedTeam.label || '';
          setFormData((prev) => ({ ...prev, teamName: matchedTeam.id }));
          setTeamCodeInput(matchedTeam.shortName || teamCodeInput.trim());
        } else if (resolvedJoinTeamId) {
          const matchedTeam = availableTeams.find((team) => team.id === resolvedJoinTeamId) || null;
          resolvedJoinTeamName = matchedTeam?.name || matchedTeam?.label || resolvedJoinTeamName;
        } else {
          throw new Error('Please select a team or enter a valid team code.');
        }
      }

      const normalizeTeamNameForMatch = (value: string) =>
        (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (regType === 'create-team') {
        const requestedTeamName = normalizeTeamNameForMatch(formData.teamName);
        const targetDivision = (formData.division || '').trim().toUpperCase();
        const duplicateTeamInDivision = availableTeams.some((team) => {
          return (
            normalizeTeamNameForMatch(team.name) === requestedTeamName &&
            (team.division || '').trim().toUpperCase() === targetDivision
          );
        });
        if (duplicateTeamInDivision) {
          throw new Error(
            `Team "${formData.teamName.trim()}" already exists in ${formData.division || 'this division'} for this season.`
          );
        }
      }

      const matchedExistingPlayerUserId =
        !existingUserId && !googleLinked && regType === 'join-team'
          ? await findExistingPlayerUserId(
              resolvedJoinTeamId || null,
              seasonId,
              formData.fullName.trim() || `${firstName} ${lastName}`.trim()
            )
          : null;

      const emailInUse = await isEmailAlreadyRegistered(resolvedEmail, existingUserId);
      const canLinkExistingPlayer = !!matchedExistingPlayerUserId;
      if (emailInUse && !existingUserId && !canLinkExistingPlayer) {
        handleDuplicateEmailDetected();
        return;
      }
      if (emailInUse && existingUserId) {
        setSubmitError('This email is already registered. Please use that account to continue.');
        setIsSubmitting(false);
        return;
      }

      let signupUserId: string | null = null;
      if (!existingUserId && !googleLinked) {
        if (matchedExistingPlayerUserId) {
          signupUserId = matchedExistingPlayerUserId;
        } else {
          try {
            const signupResult = await registerWithEmail(resolvedEmail, formData.password, {
              fullName: formData.fullName,
            });
            signupUserId = signupResult.userId || null;
          } catch (signupErr: any) {
            const message = String(signupErr?.message || '').toLowerCase();
            if (
              message.includes('already registered') ||
              (message.includes('user') && message.includes('already'))
            ) {
              handleDuplicateEmailDetected();
              return;
            }
            throw signupErr;
          }
        }
      } else if (existingUserId) {
        signupUserId = existingUserId;
      }

      // Ensure we have a user session (from Google or email sign-up)
      await hydrateUserFromSupabase().catch(() => null);
      const { data: authUserData } = await supabase.auth.getUser();
      const authUser = authUserData?.user ?? null;
      const userId = authUser?.id || signupUserId || null;

      if (userId && (regType === 'create-team' || regType === 'join-team')) {
        const normalizeDivision = (value: any) => (value || '').toString().trim().toUpperCase();
        let targetDivision =
          regType === 'create-team'
            ? normalizeDivision(formData.division)
            : normalizeDivision(
                availableTeams.find((team) => team.id === resolvedJoinTeamId)?.division || ''
              );

        if (regType === 'join-team' && !targetDivision && resolvedJoinTeamId) {
          const { data: joinTeamRow, error: joinTeamErr } = await supabase
            .from('teams')
            .select('season_id,division')
            .eq('id', resolvedJoinTeamId)
            .maybeSingle();
          if (joinTeamErr) throw joinTeamErr;
          const teamSeasonId = (joinTeamRow as any)?.season_id || '';
          if (teamSeasonId && teamSeasonId !== seasonId) {
            throw new Error('Selected team is not in the current registration season.');
          }
          targetDivision = normalizeDivision((joinTeamRow as any)?.division || '');
        }

        if (targetDivision) {
          const { data: seasonMemberships, error: membershipErr } = await supabase
            .from('players')
            .select('team_id,teams:team_id(division)')
            .eq('user_id', userId)
            .eq('season_id', seasonId);
          if (membershipErr) throw membershipErr;

          const hasDivisionConflict = (seasonMemberships || []).some((row: any) => {
            const existingTeamId = row?.team_id || null;
            if (!existingTeamId) return false;
            if (regType === 'join-team' && existingTeamId === resolvedJoinTeamId) return false;
            const teamRelation = Array.isArray(row?.teams) ? row.teams[0] : row?.teams;
            return normalizeDivision(teamRelation?.division) === targetDivision;
          });

          if (hasDivisionConflict) {
            throw new Error(
              `You are already on a ${targetDivision} team this season. You can only play one team per division.`
            );
          }
        }
      }

      setPendingRegistration({
        userId,
        seasonId,
        regType,
        teamName: regType === 'join-team' ? resolvedJoinTeamName : formData.teamName.trim(),
        division: formData.division,
        joinTeamId: regType === 'join-team' ? resolvedJoinTeamId : null,
        fullName: formData.fullName.trim(),
        firstName: firstName || 'Player',
        lastName: lastName || '',
        playerNumber: Number.isFinite(jerseyNumber) ? jerseyNumber : null,
        position: formData.playerPosition || '',
        logoPath: savedLogo?.path || null,
        bannerPath: savedBanner?.path || null,
        jerseySize: formData.jerseySize || '',
        shortsSize: formData.shortsSize || '',
        jerseyName: formData.jerseyName || '',
        referralSource: formData.referralSource || '',
        nbaComparison: formData.nbaComparison || '',
        instagram: formData.instagram || '',
        birthDate: formData.birthDate || '',
        phone: formData.phone || '',
        captainRosterEntries: captainRosterEntries.map((entry) => ({
          ...entry,
          fullName: entry.fullName.trim(),
          email: normalizeEmail(entry.email),
          jerseyName: entry.jerseyName.trim(),
          jerseyNumberChoices: entry.jerseyNumberChoices.trim(),
          jerseySize: entry.jerseySize || 'L',
          shortsSize: entry.shortsSize || 'L',
        })),
      });

      setRegistrationMeta({
        userId,
        regType,
        teamId: null,
        seasonId,
        fullName: formData.fullName.trim() || 'New Player',
        email: resolvedEmail,
      });

      // NOTE: Registration + payment emails are triggered from the payment step (not here).

      setStep(2); // In stats-portal flow this triggers auto-finalization; otherwise shows payment options.
      if (isStatsPortalFlow) {
        setPaymentMessage('Saving your Stats Portal registration...');
      }
    } catch (err: any) {
      console.error('Registration failed', err);
      setSubmitError(err?.message || 'Unable to complete registration. Please try again.');
    } finally {
      setIsSubmitting(false);
      setUploadingDesigns(false);
    }
  };

  // Pricing Logic
  const getPricing = () => {
    switch(regType) {
      case 'create-team': return { full: 1650, deposit: 75, label: 'Team Fee' };
      case 'join-team': return { full: 140, deposit: 50, label: 'Individual Fee' };
      case 'individual': return { full: 140, deposit: 50, label: 'Individual Fee' };
    }
  };

  const pricing = getPricing();

  const getTitle = () => {
    switch(regType) {
      case 'create-team': return 'Setup My Team';
      case 'join-team': return 'Join an Existing Team';
      case 'individual': return 'Join as a Free Agent';
    }
  };

  const normalizeTeamCodeToken = (value: string) =>
    (value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

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

  const normalizeJoinCode = (value: string) =>
    (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

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

  const generateUniqueTeamJoinCode = async (teamName: string, _seasonId: string): Promise<string | null> => {
    const base = normalizeJoinCode(toTeamCodeBase(teamName));
    if (!base) return null;
    try {
      const { data, error } = await supabase
        .from('teams')
        .select('short_name');
      if (error) throw error;
      const used = new Set(
        (data || [])
          .map((row: any) => normalizeJoinCode(String(row?.short_name || '')))
          .filter(Boolean)
      );
      return buildUniqueTeamJoinCode(teamName, used);
    } catch (err: any) {
      const msg = (err?.message || '').toString().toLowerCase();
      const code = (err?.code || '').toString();
      const missingShortName = code === '42703' || (msg.includes('short_name') && msg.includes('column'));
      if (missingShortName) return null;
      console.warn('team join code generation fallback', err);
      return base;
    }
  };

  const findTeamByCodeOrId = (value: string): AvailableTeam | null => {
    const raw = (value || '').trim().toLowerCase();
    const token = normalizeTeamCodeToken(value);
    if (!raw && !token) return null;
    const byId = availableTeams.find((team) => team.id.toLowerCase() === raw);
    if (byId) return byId;
    const byCode = availableTeams.find(
      (team) => team.shortName && normalizeTeamCodeToken(team.shortName) === token
    );
    if (byCode) return byCode;
    return null;
  };

  const applyTeamCode = (value: string, opts?: { silent?: boolean }) => {
    const matched = findTeamByCodeOrId(value);
    if (!matched) {
      if (!opts?.silent) {
        setTeamCodeMessage('Team code not found for this season. Check with your captain.');
      }
      return false;
    }
    setRegType('join-team');
    setFormData((prev) => ({ ...prev, teamName: matched.id }));
    setTeamCodeInput(matched.shortName || value.trim());
    if (!opts?.silent) {
      setTeamCodeMessage(`Matched team: ${matched.label}`);
    }
    return true;
  };

  const selectedJoinTeam = availableTeams.find((team) => team.id === formData.teamName) || null;
  const createTeamCodePreview = useMemo(() => {
    if (regType !== 'create-team') return '';
    const teamName = formData.teamName.trim();
    if (!teamName) return '';
    const usedCodes = new Set(
      availableTeams
        .map((team) => normalizeJoinCode(team.shortName || ''))
        .filter(Boolean)
    );
    return buildUniqueTeamJoinCode(teamName, usedCodes) || '';
  }, [availableTeams, formData.teamName, regType]);

  const shareableTeamLinkPreview = useMemo(() => {
    if (typeof window === 'undefined') return '';
    if (regType !== 'join-team' || !selectedJoinTeam?.id) return '';
    const base = window.location.origin.replace(/\/+$/, '');
    const params = new URLSearchParams();
    params.set('type', 'join');
    params.set('invite', '1');
    params.set('team', selectedJoinTeam.id);
    const code = (selectedJoinTeam.shortName || teamCodeInput || '').trim();
    if (code) params.set('code', code);
    return `${base}/portal/register?${params.toString()}`;
  }, [regType, selectedJoinTeam, teamCodeInput]);

  const resetForm = () => {
    setStep(1);
    setPortalScreen(1);
  };

  // Load registration-open seasons for Stats Portal registration.
  useEffect(() => {
    const loadOpenSeasons = async () => {
      try {
        let seasonRows: RegistrationSeasonOption[] = [];
        let supportsRegOpen = true;
        const withReg = await supabase
          .from('seasons')
          .select('id,name,year,is_current,start_date,is_public,registration_open')
          .order('start_date', { ascending: false });
        if (withReg.error) {
          const errAny = withReg.error as any;
          const msg = errAny?.message?.toString?.()?.toLowerCase?.() || '';
          const code = errAny?.code?.toString?.() || '';
          if (code === '42703' || msg.includes('registration_open')) {
            supportsRegOpen = false;
            const fallback = await supabase
              .from('seasons')
              .select('id,name,year,is_current,start_date,is_public')
              .order('start_date', { ascending: false });
            if (fallback.error) throw fallback.error;
            seasonRows = (fallback.data || []) as RegistrationSeasonOption[];
          } else {
            throw withReg.error;
          }
        } else {
          seasonRows = (withReg.data || []) as RegistrationSeasonOption[];
        }

        const canUseRegistrationOpen =
          supportsRegOpen &&
          seasonRows.some((row) => Object.prototype.hasOwnProperty.call(row as any, 'registration_open'));
        setSupportsRegistrationOpen(canUseRegistrationOpen);

        const openSeasons = canUseRegistrationOpen
          ? seasonRows.filter((row) => parseBool((row as any).registration_open, false))
          : seasonRows.filter((row) => parseBool((row as any).is_public, true)).filter((row) => !!row.is_current);
        setAvailableRegistrationSeasons(openSeasons);

        const querySeasonId = (searchParams.get('seasonId') || searchParams.get('season') || '').trim();
        const preferred =
          openSeasons.find((season) => season.id === querySeasonId) ||
          openSeasons.find((season) => season.is_current) ||
          openSeasons[0];

        setSelectedSeasonId((prev) => {
          if (prev && openSeasons.some((season) => season.id === prev)) return prev;
          return preferred?.id || '';
        });
        setActiveSeasonName(preferred ? formatSeasonLabel(preferred) : 'upcoming season');
      } catch {
        setAvailableRegistrationSeasons([]);
        setSelectedSeasonId('');
        setAvailableTeams([]);
        setAvailableDivisions([]);
        setActiveSeasonName('upcoming season');
      }
    };
    loadOpenSeasons();
  }, [searchParams]);

  const loadTeamsForSeason = useCallback(async () => {
    if (!selectedSeasonId) {
      setAvailableTeams([]);
      setAvailableDivisions([]);
      setActiveSeasonName('upcoming season');
      return;
    }

    const season = availableRegistrationSeasons.find((row) => row.id === selectedSeasonId) || null;
    setActiveSeasonName(season ? formatSeasonLabel(season) : 'upcoming season');

    try {
      const [{ data: teams }, { data: divisionRows }] = await Promise.all([
        supabase
          .from('teams')
          .select('id,name,division,short_name')
          .eq('season_id', selectedSeasonId)
          .order('name', { ascending: true }),
        supabase
          .from('divisions')
          .select('name')
          .eq('season_id', selectedSeasonId)
          .order('name', { ascending: true }),
      ]);
      setAvailableTeams(
        (teams || []).map((t: any) => ({
          id: t.id,
          name: t.name || '',
          division: t.division || '',
          shortName: (t.short_name || '').toString(),
          label: `${t.name}${t.division ? ` - ${t.division}` : ''}`,
        }))
      );
      setAvailableDivisions(
        Array.from(new Set((divisionRows || []).map((row: any) => (row?.name || '').toString().trim()).filter(Boolean)))
      );
    } catch {
      setAvailableTeams([]);
      setAvailableDivisions([]);
    }
  }, [availableRegistrationSeasons, selectedSeasonId]);

  // Load teams/divisions for the selected registration season.
  useEffect(() => {
    void loadTeamsForSeason();
  }, [loadTeamsForSeason]);

  useEffect(() => {
    if (!selectedSeasonId) return;

    const refresh = () => {
      void loadTeamsForSeason();
    };
    const interval = window.setInterval(refresh, 5000);

    const handleFocus = () => {
      refresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadTeamsForSeason, selectedSeasonId]);

  useEffect(() => {
    if (!isStatsPortalFlow || regType !== 'create-team') return;
    if (!availableDivisions.length) {
      if (formData.division) {
        setFormData((prev) => ({ ...prev, division: '' }));
      }
      return;
    }
    const currentDivision = (formData.division || '').trim();
    if (currentDivision && availableDivisions.includes(currentDivision)) return;

    const queryDivision = (searchParams.get('division') || '').trim();
    const source = (currentDivision || queryDivision).toUpperCase();
    const strictMatch =
      (currentDivision &&
        availableDivisions.find((division) => division.toLowerCase() === currentDivision.toLowerCase())) ||
      (queryDivision &&
        availableDivisions.find((division) => division.toLowerCase() === queryDivision.toLowerCase())) ||
      '';
    const divisionCode = source.match(/\bD[1-3]\b/)?.[0] || '';
    const codeMatch = divisionCode
      ? availableDivisions.find((division) => division.toUpperCase().includes(divisionCode))
      : '';
    const nextDivision = strictMatch || codeMatch || availableDivisions[0] || '';
    if (nextDivision && nextDivision !== formData.division) {
      setFormData((prev) => ({ ...prev, division: nextDivision }));
    }
  }, [availableDivisions, formData.division, isStatsPortalFlow, regType, searchParams]);

  // Preselect a team when arriving from an invite link or shared team code.
  useEffect(() => {
    const teamParam = (searchParams.get('team') || '').trim();
    const codeParam = (searchParams.get('code') || searchParams.get('teamCode') || '').trim();

    if (teamParam) {
      if (regType !== 'join-team') {
        setRegType('join-team');
      }
      if (availableTeams.some((t) => t.id === teamParam)) {
        setFormData((prev) => ({ ...prev, teamName: teamParam }));
        setTeamCodeMessage(null);
      }
      return;
    }

    if (codeParam) {
      applyTeamCode(codeParam, { silent: false });
    }
  }, [searchParams, availableTeams, regType, prefilledFromSession]);

  useEffect(() => {
    const teamParam = (searchParams.get('team') || '').trim();
    if (!teamParam) return;
    if (!availableRegistrationSeasons.length) return;
    if (availableTeams.some((team) => team.id === teamParam)) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('teams')
        .select('season_id')
        .eq('id', teamParam)
        .maybeSingle();
      if (cancelled) return;
      const targetSeasonId = (data as any)?.season_id || '';
      if (!targetSeasonId) return;
      if (targetSeasonId !== selectedSeasonId) {
        setSelectedSeasonId(targetSeasonId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, availableRegistrationSeasons, availableTeams, selectedSeasonId]);

  useEffect(() => {
    if (regType !== 'join-team') {
      setTeamCodeMessage(null);
      return;
    }
    if (formData.teamName) {
      setTeamCodeMessage(null);
    }
  }, [formData.teamName, regType]);

  useEffect(() => {
    if (regType !== 'join-team') return;
    if (!formData.teamName) return;
    if (availableTeams.some((team) => team.id === formData.teamName)) return;
    setFormData((prev) => ({ ...prev, teamName: '' }));
  }, [availableTeams, formData.teamName, regType]);

  // Load waiver public URL from storage
  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    const loadWaiver = async () => {
      try {
        const { data } = supabase.storage.from('public-assets').getPublicUrl('latest-csl-waiver.pdf');
        if (!data?.publicUrl) return;
        const cacheBustedUrl = `${data.publicUrl}${data.publicUrl.includes('?') ? '&' : '?'}v=latest-csl-waiver&t=${Date.now()}`;
        const response = await fetch(cacheBustedUrl, { cache: 'no-store' });
        if (!response.ok) return;
        const blob = await response.blob();
        if (cancelled) return;
        revokedUrl = URL.createObjectURL(blob);
        setWaiverUrl(revokedUrl);
      } catch (err) {
        console.warn('waiver load failed', err);
      }
    };

    loadWaiver();

    return () => {
      cancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, []);

  useEffect(() => {
    const canPrefill =
      isStatsPortalFlow &&
      regType === 'join-team' &&
      portalScreen === 2 &&
      !!formData.teamName &&
      !!selectedSeasonId &&
      /\S+@\S+\.\S+/.test(formData.email.trim());
    if (!canPrefill) return;

    const key = `${formData.teamName}::${selectedSeasonId}::${normalizeEmail(formData.email)}`;
    if (joinPrefillKey === key) return;

    let cancelled = false;
    (async () => {
      const selectVariants = [
        'id,season_id,first_name,last_name,jersey_name,jersey_number,jersey_size,shorts_size,email,email_address,created_at',
        'id,season_id,first_name,last_name,jersey_name,jersey_number,jersey_size,shorts_size,email,created_at',
        'id,season_id,first_name,last_name,jersey_name,jersey_number,jersey_size,shorts_size,email_address,created_at',
        'id,season_id,first_name,last_name,jersey_name,jersey_number,jersey_size,shorts_size,created_at',
      ];
      const isMissingColumn = (error: any) => {
        const code = (error?.code || '').toString();
        const msg = (error?.message || '').toString().toLowerCase();
        return code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
      };

      let rows: any[] = [];
      for (const sel of selectVariants) {
        const { data, error } = await supabase
          .from('players')
          .select(sel)
          .eq('team_id', formData.teamName)
          .eq('season_id', selectedSeasonId)
          .is('user_id', null)
          .order('created_at', { ascending: false });
        if (!error) {
          rows = data || [];
          break;
        }
        if (!isMissingColumn(error)) {
          console.warn('join-team prefill load failed', error);
          return;
        }
      }

      const normalizedEmail = normalizeEmail(formData.email);
      if (!normalizedEmail) return;
      const matched = rows.find((row: any) => {
        const rowEmail = normalizeEmail(String(row?.email || row?.email_address || ''));
        return rowEmail && rowEmail === normalizedEmail;
      });
      if (!matched || cancelled) return;

      const matchedFullName = `${String(matched?.first_name || '').trim()} ${String(matched?.last_name || '').trim()}`.trim();
      setFormData((prev) => ({
        ...prev,
        fullName: prev.fullName.trim() || matchedFullName || prev.fullName,
        jerseyName: prev.jerseyName.trim() || String(matched?.jersey_name || '').trim(),
        playerNumber:
          prev.playerNumber.trim() ||
          (matched?.jersey_number != null ? String(matched.jersey_number) : prev.playerNumber),
        jerseySize:
          (prev.jerseySize === 'L' ? '' : prev.jerseySize) ||
          String(matched?.jersey_size || '').trim() ||
          prev.jerseySize,
        shortsSize:
          (prev.shortsSize === 'L' ? '' : prev.shortsSize) ||
          String(matched?.shorts_size || '').trim() ||
          prev.shortsSize,
      }));
      setJoinPrefillNotice('Jersey details were prefilled from your captain entry. You can edit before saving.');
      setJoinPrefillKey(key);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    formData.email,
    formData.teamName,
    isStatsPortalFlow,
    joinPrefillKey,
    portalScreen,
    regType,
    selectedSeasonId,
  ]);

  const [registrationMeta, setRegistrationMeta] = useState<{
    userId: string | null;
    regType: RegistrationType;
    teamId: string | null;
    seasonId: string | null;
    fullName: string;
    email: string;
  } | null>(null);

  const setPaymentStatus = async (status: 'paid' | 'pending' | 'pending-stripe') => {
    if (!registrationMeta?.userId) return;
    // Cache locally so UI can read it without waiting on Supabase
    try {
      localStorage.setItem(`courtsight_payment_status_${registrationMeta.userId}`, status);
    } catch {
      // ignore
    }
    // Best-effort profile update; safe if column doesn't exist (error will be logged)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ payment_status: status })
        .eq('user_id', registrationMeta.userId);
      if (error) {
        console.warn('payment_status update failed', error.message);
      }
    } catch (err) {
      console.warn('payment_status update error', err);
    }
  };

  const completeRegistration = async (): Promise<{ teamId: string | null; playerId: string | null }> => {
    if (registrationResult) return registrationResult;
    if (!pendingRegistration) throw new Error('No pending registration to finalize.');
    setFinalizing(true);
    const {
      userId,
      seasonId,
      regType,
      teamName,
      division,
      joinTeamId,
      fullName,
      firstName,
      lastName,
      playerNumber,
      position,
      logoPath,
      bannerPath,
      jerseySize,
      shortsSize,
      jerseyName,
      referralSource,
      nbaComparison,
      instagram,
      birthDate,
      phone,
      captainRosterEntries,
    } = pendingRegistration;
    const fallbackJerseyPreference = formData.playerNumber.split(',')[0]?.trim();
    const fallbackJerseyNumber = fallbackJerseyPreference ? parseInt(fallbackJerseyPreference, 10) : null;
    const resolvedPlayerNumber =
      Number.isFinite(playerNumber) ? playerNumber : Number.isFinite(fallbackJerseyNumber) ? fallbackJerseyNumber : null;
    const resolvedPosition = position || formData.playerPosition || '';
    const resolvedJerseySize = jerseySize || formData.jerseySize || '';
    const resolvedShortsSize = shortsSize || formData.shortsSize || '';
    const resolvedJerseyName = jerseyName || formData.jerseyName || '';
    const resolvedReferralSource = referralSource || formData.referralSource || '';
    const resolvedNbaComparison = nbaComparison || formData.nbaComparison || '';
    const resolvedInstagram = instagram || formData.instagram || '';
    const resolvedBirthDate = birthDate || formData.birthDate || '';
    const resolvedPhone = phone || formData.phone || '';
    if (!seasonId) throw new Error('No registration-open season is available right now. Please contact the league admin.');
    let resolvedTeamId: string | null = null;
    let playerId: string | null = null;

    try {
      const normalizeDivision = (value: any) => (value || '').toString().trim().toUpperCase();
      const normalizeTeamName = (value: any) =>
        (value || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

      const loadSeasonMemberships = async (): Promise<
        Array<{ id: string; teamId: string | null; division: string }>
      > => {
        if (!userId || !seasonId) return [];
        try {
          const { data, error } = await supabase
            .from('players')
            .select('id,team_id,created_at,teams:team_id(division)')
            .eq('user_id', userId)
            .eq('season_id', seasonId)
            .order('created_at', { ascending: false });
          if (error) throw error;
          return (data || []).map((row: any) => {
            const teamRelation = row?.teams;
            const relationValue = Array.isArray(teamRelation) ? teamRelation[0] : teamRelation;
            return {
              id: row.id,
              teamId: row.team_id || null,
              division: normalizeDivision(relationValue?.division),
            };
          });
        } catch {
          const { data, error } = await supabase
            .from('players')
            .select('id,team_id,created_at')
            .eq('user_id', userId)
            .eq('season_id', seasonId)
            .order('created_at', { ascending: false });
          if (error) return [];
          return (data || []).map((row: any) => ({
            id: row.id,
            teamId: row.team_id || null,
            division: '',
          }));
        }
      };

      const seasonMemberships = await loadSeasonMemberships();
      const teamlessMembership = seasonMemberships.find((membership) => !membership.teamId) || null;

      const findSeasonPlayerForIndividual = async (): Promise<string | null> => {
        if (!userId || !seasonId) return null;
        // Never repurpose an existing team membership into an individual profile.
        // Only reuse a teamless row in the same season.
        return teamlessMembership?.id || null;
      };

      const resolveJoinTeamDivision = async (teamId: string): Promise<string> => {
        const local = availableTeams.find((team) => team.id === teamId);
        if (local?.division) return normalizeDivision(local.division);

        const { data, error } = await supabase
          .from('teams')
          .select('id,season_id,division')
          .eq('id', teamId)
          .maybeSingle();
        if (error) throw error;
        const teamSeasonId = (data as any)?.season_id || '';
        if (teamSeasonId && teamSeasonId !== seasonId) {
          throw new Error('Selected team is not in the current registration season.');
        }
        return normalizeDivision((data as any)?.division || '');
      };

      const pickUpdatablePlayerId = (preferredId?: string | null) =>
        preferredId || teamlessMembership?.id || null;

      const ensureTeamNameAvailableInDivision = async (teamNameValue: string, divisionValue: string) => {
        const normalizedRequestedName = normalizeTeamName(teamNameValue);
        if (!normalizedRequestedName || !seasonId) return;

        let rows: any[] = [];
        const withDivision = await supabase
          .from('teams')
          .select('id,name,division')
          .eq('season_id', seasonId)
          .eq('division', divisionValue);
        if (withDivision.error) {
          const msg = (withDivision.error.message || '').toString().toLowerCase();
          const code = (withDivision.error.code || '').toString();
          const missingDivisionColumn =
            code === '42703' || (msg.includes('division') && msg.includes('column'));
          if (!missingDivisionColumn) throw withDivision.error;

          const fallback = await supabase
            .from('teams')
            .select('id,name')
            .eq('season_id', seasonId);
          if (fallback.error) throw fallback.error;
          rows = fallback.data || [];
        } else {
          rows = withDivision.data || [];
        }

        const duplicate = rows.some(
          (row: any) => normalizeTeamName(row?.name) === normalizedRequestedName
        );
        if (duplicate) {
          throw new Error(
            `Team "${teamNameValue.trim()}" already exists in ${divisionValue || 'this division'} for this season.`
          );
        }
      };

      const savePlayer = async (payload: any, existingId: string | null): Promise<string | null> => {
        let nextPayload = { ...payload };
        if (existingId) {
          while (Object.keys(nextPayload).length) {
            const { error: updateErr } = await supabase
              .from('players')
              .update(nextPayload)
              .eq('id', existingId);
            if (!updateErr) {
              return existingId;
            }
            const missingColumn = parseMissingColumn(updateErr);
            if (missingColumn && Object.prototype.hasOwnProperty.call(nextPayload, missingColumn)) {
              delete (nextPayload as any)[missingColumn];
              continue;
            }
            throw updateErr;
          }
          return existingId;
        }

        while (Object.keys(nextPayload).length) {
          const { data: newPlayer, error: insertErr } = await supabase
            .from('players')
            .insert(nextPayload)
            .select('id')
            .maybeSingle();
          if (!insertErr) {
            return newPlayer?.id || null;
          }
          const missingColumn = parseMissingColumn(insertErr);
          if (missingColumn && Object.prototype.hasOwnProperty.call(nextPayload, missingColumn)) {
            delete (nextPayload as any)[missingColumn];
            continue;
          }
          throw insertErr;
        }
        return null;
      };

      const ensureJerseyNumberAvailable = async (teamId: string, existingId: string | null) => {
        if (!Number.isFinite(resolvedPlayerNumber)) return;
        const targetNumber = Number(resolvedPlayerNumber);
        const { data, error } = await supabase
          .from('players')
          .select('id')
          .eq('team_id', teamId)
          .eq('season_id', seasonId)
          .eq('jersey_number', targetNumber);
        if (error) {
          const code = String((error as any)?.code || '');
          const msg = String((error as any)?.message || '').toLowerCase();
          const missingColumn = code === '42703' || (msg.includes('jersey_number') && msg.includes('column'));
          if (missingColumn) return;
          throw error;
        }
        const conflict = (data || []).some((row: any) => row?.id && row.id !== existingId);
        if (conflict) {
          throw new Error(
            `Jersey #${targetNumber} is already taken on this team. Please choose another jersey number preference.`
          );
        }
      };

      const findUnlinkedJoinTeamPlayerIdByEmail = async (
        teamId: string,
        currentSeasonId: string,
        candidateEmail: string
      ): Promise<string | null> => {
        const normalizedCandidate = normalizeEmail(candidateEmail);
        if (!normalizedCandidate) return null;

        const selectVariants = [
          'id,season_id,email,email_address,created_at',
          'id,season_id,email,created_at',
          'id,season_id,email_address,created_at',
        ];

        const isMissingColumn = (error: any) => {
          const code = (error?.code || '').toString();
          const msg = (error?.message || '').toString().toLowerCase();
          return code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
        };

        let rows: any[] = [];
        let lastErr: any = null;
        for (const selectQuery of selectVariants) {
          const { data, error } = await supabase
            .from('players')
            .select(selectQuery)
            .eq('team_id', teamId)
            .is('user_id', null)
            .order('created_at', { ascending: false });
          if (!error) {
            rows = data || [];
            lastErr = null;
            break;
          }
          lastErr = error;
          if (!isMissingColumn(error)) {
            throw error;
          }
        }

        if (lastErr) {
          if (isMissingColumn(lastErr)) {
            return null;
          }
          throw lastErr;
        }

        const matchedRows = rows.filter((row: any) => {
          const rowEmail = normalizeEmail(
            String((row as any)?.email || (row as any)?.email_address || '')
          );
          return rowEmail && rowEmail === normalizedCandidate;
        });
        if (!matchedRows.length) return null;

        const exactSeasonMatch =
          matchedRows.find((row: any) => String((row as any)?.season_id || '').trim() === currentSeasonId) || null;
        if (exactSeasonMatch?.id) return exactSeasonMatch.id;

        const noSeasonMatch =
          matchedRows.find((row: any) => !String((row as any)?.season_id || '').trim()) || null;
        if (noSeasonMatch?.id) return noSeasonMatch.id;

        return matchedRows[0]?.id || null;
      };

      const upsertRosterEntryEmail = async (playerId: string, email: string) => {
        const normalized = normalizeEmail(email);
        if (!normalized) return;
        const updates = [{ email: normalized }, { email_address: normalized }];
        for (const payload of updates) {
          try {
            const { error } = await supabase.from('players').update(payload).eq('id', playerId);
            if (error) throw error;
          } catch (err: any) {
            const code = (err?.code || '').toString();
            const msg = (err?.message || '').toString().toLowerCase();
            const missingColumn = code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
            if (!missingColumn) {
              console.warn('roster email update failed', err);
            }
          }
        }
      };

      const saveCaptainRosterPlaceholders = async (
        teamId: string,
        currentSeasonId: string,
        entries: CaptainRosterEntry[]
      ): Promise<CaptainRosterInviteTarget[]> => {
        const inviteTargets: CaptainRosterInviteTarget[] = [];
        for (const entry of entries) {
          const normalizedEmail = normalizeEmail(entry.email);
          const normalizedName = entry.fullName.trim();
          if (!normalizedEmail && !normalizedName) continue;

          const [entryFirstName, entryLastName] = splitName(normalizedName || normalizedEmail || 'Player');
          const preferredNumber = parsePreferredJerseyNumber(entry.jerseyNumberChoices);

          const existingId = normalizedEmail
            ? await findUnlinkedJoinTeamPlayerIdByEmail(teamId, currentSeasonId, normalizedEmail)
            : null;

          const payload: any = {
            season_id: currentSeasonId,
            team_id: teamId,
            user_id: null,
            first_name: entryFirstName || 'Player',
            last_name: entryLastName || '',
            position: entry.playerPosition || null,
            jersey_name: entry.jerseyName || null,
            jersey_number: Number.isFinite(preferredNumber) ? preferredNumber : null,
            jersey_size: entry.jerseySize || null,
            shorts_size: entry.shortsSize || null,
            is_captain: false,
          };

          const savedId = await savePlayer(payload, existingId);
          if (savedId && normalizedEmail) {
            await upsertRosterEntryEmail(savedId, normalizedEmail);
            inviteTargets.push({
              playerId: savedId,
              email: normalizedEmail,
              playerName: normalizedName || `${entryFirstName} ${entryLastName}`.trim() || 'Player',
            });
          }
        }
        return inviteTargets;
      };

      if (regType === 'create-team') {
        const targetDivision = normalizeDivision(division);
        if (targetDivision) {
          const existingDivisionMembership = seasonMemberships.find(
            (membership) => membership.teamId && membership.division === targetDivision
          );
          if (existingDivisionMembership) {
            throw new Error(
              `You are already on a ${targetDivision} team this season. You can only play one team per division.`
            );
          }
        }
        await ensureTeamNameAvailableInDivision(teamName, targetDivision || division || '');

        // Create team
        let teamId: string | null = null;
        const createdTeamCode = await generateUniqueTeamJoinCode(teamName.trim(), seasonId);
        const insertCandidates: Record<string, any>[] = [
          {
            name: teamName.trim(),
            season_id: seasonId,
            division: division,
            ...(createdTeamCode ? { short_name: createdTeamCode } : {}),
          },
          {
            name: teamName.trim(),
            season_id: seasonId,
            ...(createdTeamCode ? { short_name: createdTeamCode } : {}),
          },
          {
            name: teamName.trim(),
            season_id: seasonId,
            division: division,
          },
          {
            name: teamName.trim(),
            season_id: seasonId,
          },
        ];
        let lastInsertErr: any = null;
        for (const payload of insertCandidates) {
          try {
            const { data: teamRow, error: teamErr } = await supabase
              .from('teams')
              .insert(payload)
              .select('id')
              .single();
            if (teamErr || !teamRow?.id) throw teamErr || new Error('Unable to create team.');
            teamId = teamRow.id;
            break;
          } catch (teamErr: any) {
            lastInsertErr = teamErr;
            const msg = (teamErr?.message || '').toString().toLowerCase();
            const code = (teamErr?.code || '').toString();
            const schemaMissing = code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
            if (!schemaMissing) {
              throw teamErr;
            }
          }
        }
        if (!teamId) {
          throw lastInsertErr || new Error('Unable to create team.');
        }

        resolvedTeamId = teamId;

        // Upload logo/banner (include any pre-uploaded ones)
        const media = await uploadTeamMedia(teamId!);
        const jerseyDesignPaths = await uploadJerseyDesignInspiration(teamId!);
        const updates: any = {};
        if (media.logo || logoPath) updates.logo_url = media.logo || logoPath;
        if (media.banner || bannerPath) updates.banner_url = media.banner || bannerPath;
        if (updates.logo_url || updates.banner_url) {
          try {
            await supabase.from('teams').update(updates).eq('id', teamId!);
          } catch (uploadErr) {
            console.error('Media upload error', uploadErr);
          }
        }
        setSavedLogo(null);
        setSavedBanner(null);
        if (jerseyDesignPaths.length) {
          try {
            const settings = await loadJerseyManagementSettings();
            const existing =
              settings.teams.find((row) => row.teamId === teamId && row.seasonId === seasonId) || null;
            const next = upsertTeamJerseyWorkflow(settings, {
              teamId: teamId!,
              seasonId,
              status: 'pending_review',
              uploadedDesignPaths: Array.from(
                new Set([...(existing?.uploadedDesignPaths || []), ...jerseyDesignPaths])
              ),
              approvedDesignPath: existing?.approvedDesignPath || null,
              finalMockupPath: existing?.finalMockupPath || null,
            });
            await saveJerseyManagementSettings(next);
          } catch (workflowErr) {
            console.warn('jersey workflow update failed', workflowErr);
          }
        }

        const waiverAcceptedAt = new Date().toISOString();
        const playerPayload: any = {
          season_id: seasonId,
          team_id: teamId,
          user_id: userId,
          first_name: firstName || 'Player',
          last_name: lastName || '',
          jersey_number: Number.isFinite(resolvedPlayerNumber) ? resolvedPlayerNumber : null,
          position: resolvedPosition || null,
          photo_url: null,
          is_captain: true,
          jersey_size: resolvedJerseySize || null,
          shorts_size: resolvedShortsSize || null,
          jersey_name: resolvedJerseyName || null,
          referral_source: resolvedReferralSource || null,
          nba_comparison: resolvedNbaComparison || null,
          instagram: resolvedInstagram || null,
          waiver_accepted: true,
          waiver_accepted_at: waiverAcceptedAt,
          waiver_document_path: 'latest-csl-waiver.pdf',
        };
        if (resolvedBirthDate) playerPayload.birth_date = resolvedBirthDate;
        if (resolvedPhone) playerPayload.phone = resolvedPhone;
        const sameTeamMembership =
          seasonMemberships.find((membership) => membership.teamId === teamId) || null;
        const existingPlayerId = pickUpdatablePlayerId(sameTeamMembership?.id || null);
        await ensureJerseyNumberAvailable(teamId, existingPlayerId);
        playerId = await savePlayer(playerPayload, existingPlayerId);

        // Captain can pre-enter roster jersey details; these entries are later matched when players join via link/email.
        if (Array.isArray(captainRosterEntries) && captainRosterEntries.length) {
          const inviteTargets = await saveCaptainRosterPlaceholders(teamId, seasonId, captainRosterEntries);
          if (inviteTargets.length) {
            const seasonLabel = formatSeasonLabel(
              availableRegistrationSeasons.find((season) => season.id === seasonId) || null
            );
            const teamCode = String(createdTeamCode || '').trim().toUpperCase() || null;
            for (const target of inviteTargets) {
              try {
                await sendPlayerClaimEmail({
                  playerId: target.playerId,
                  email: target.email,
                  playerName: target.playerName,
                  teamName: teamName || 'your team',
                  teamId,
                  teamCode,
                  seasonName: seasonLabel,
                  inviteLink: buildPlayerPortalUrl(teamId, target.email, teamCode),
                  createdBy: userId,
                  deliveryMode: 'portal_registration',
                });
              } catch (sendErr) {
                console.warn('captain roster invite email failed', target.email, sendErr);
              }
            }
          }
        }
      } else {
        // join-team or individual
        let teamId: string | null = null;
        let existingPlayerId: string | null = null;
          if (regType === 'join-team') {
            if (!joinTeamId) {
              throw new Error('Please select a team.');
            }
            teamId = joinTeamId;
            resolvedTeamId = teamId;

          const targetDivision = await resolveJoinTeamDivision(teamId);
          const sameTeamMembership =
            seasonMemberships.find((membership) => membership.teamId === teamId) || null;
          if (targetDivision) {
            const sameDivisionMembership = seasonMemberships.find(
                (membership) =>
                  membership.teamId &&
                  membership.teamId !== teamId &&
                  membership.division === targetDivision
            );
            if (sameDivisionMembership) {
              throw new Error(
                `You are already on a ${targetDivision} team this season. You can only play one team per division.`
              );
            }
          }
          existingPlayerId = pickUpdatablePlayerId(sameTeamMembership?.id || null);
          if (!existingPlayerId) {
            const normalizedCandidateEmail = normalizeEmail(formData.email);
            if (normalizedCandidateEmail) {
              existingPlayerId = await findUnlinkedJoinTeamPlayerIdByEmail(
                teamId,
                seasonId,
                normalizedCandidateEmail
              );
            }
          }
          if (teamId) {
            await ensureJerseyNumberAvailable(teamId, existingPlayerId);
          }
        } else {
          existingPlayerId = await findSeasonPlayerForIndividual();
        }
        const waiverAcceptedAt = new Date().toISOString();
        const playerPayload: any = {
          season_id: seasonId,
          team_id: regType === 'individual' ? null : teamId,
          user_id: userId,
          first_name: firstName || 'Player',
          last_name: lastName || '',
          jersey_number: Number.isFinite(resolvedPlayerNumber) ? resolvedPlayerNumber : null,
          position: resolvedPosition || null,
          photo_url: null,
          jersey_size: resolvedJerseySize || null,
          shorts_size: resolvedShortsSize || null,
          jersey_name: resolvedJerseyName || null,
          referral_source: resolvedReferralSource || null,
          nba_comparison: resolvedNbaComparison || null,
          instagram: resolvedInstagram || null,
          waiver_accepted: true,
          waiver_accepted_at: waiverAcceptedAt,
          waiver_document_path: 'latest-csl-waiver.pdf',
        };
        if (resolvedBirthDate) playerPayload.birth_date = resolvedBirthDate;
        if (resolvedPhone) playerPayload.phone = resolvedPhone;
        playerId = await savePlayer(playerPayload, existingPlayerId);
      }

      // Upsert profile details (phone/name/email)
      if (pendingRegistration.userId) {
        try {
          const profilePayload: any = {
            user_id: pendingRegistration.userId,
            display_name: fullName || null,
            email: formData.email?.trim() || null,
            email_address: formData.email?.trim() || null,
          };
          if (resolvedPhone) {
            profilePayload.phone = resolvedPhone;
          }
          await supabase.from('profiles').upsert(
            profilePayload,
            { onConflict: 'user_id' }
          );
        } catch (err) {
          console.warn('Profile upsert failed', err);
        }
      }

      const result = { teamId: resolvedTeamId, playerId };
      setRegistrationResult(result);
      setRegistrationMeta((prev) => (prev ? { ...prev, teamId: resolvedTeamId } : prev));
      if (leadIdParam) {
        try {
          await markLeagueRegistrationLeadCompleted(leadIdParam, {
            userId,
            teamId: resolvedTeamId,
            playerId,
          });
        } catch (leadErr) {
          console.warn('lead completion update failed', leadErr);
        }
      }
      await sendRegistrationNotifications({
        regType,
        teamId: resolvedTeamId,
        teamName: teamName || '',
        seasonId,
        fullName: fullName || `${firstName || ''} ${lastName || ''}`.trim() || 'New Player',
        email: formData.email?.trim() || '',
      });
      return result;
    } finally {
      setFinalizing(false);
    }
  };

  useEffect(() => {
    if (!isStatsPortalFlow) return;
    if (step !== 2) return;
    if (!pendingRegistration) return;
    if (finalizing) return;

    let active = true;
    (async () => {
      try {
        await completeRegistration();
        if (!active) return;
        const message = 'Stats Portal registration complete. Your profile is saved.';
        setPaymentMessage(message);
        navigate('/register/success?next=/login', { state: { message } });
      } catch (err: any) {
        console.error('Stats Portal completion failed', err);
        if (!active) return;
        setSubmitError(err?.message || 'Unable to complete Stats Portal registration. Please try again.');
        setStep(1);
      }
    })();

    return () => {
      active = false;
    };
  }, [isStatsPortalFlow, step, pendingRegistration, finalizing, navigate]);

  const handlePayment = async (method: 'full' | 'deposit' | 'later') => {
    const notifyAdminsPayment = async (methodKey: 'full' | 'deposit' | 'later') => {
      if (!registrationMeta) return;
      try {
        const selection =
          methodKey === 'full' ? 'Paid fully' : methodKey === 'deposit' ? 'Deposit paid' : 'Pay later';
        const templateStage =
          methodKey === 'full'
            ? 'registration_paid_full'
            : methodKey === 'deposit'
            ? 'registration_deposit_paid'
            : 'registration_pay_later';

        const regLabel =
          registrationMeta.regType === 'create-team'
            ? 'Team Registration'
            : registrationMeta.regType === 'join-team'
            ? 'Join Team Registration'
            : 'Individual Registration';
        const template = await renderRegistrationEmailTemplate(templateStage, {
          fullName: registrationMeta.fullName,
          firstName: registrationMeta.fullName.split(' ')[0] || registrationMeta.fullName,
          lastName: registrationMeta.fullName.split(' ').slice(1).join(' ') || '',
          email: registrationMeta.email || '',
          phone: formData.phone?.trim() || '',
          registrationType: regLabel,
          teamName: formData.teamName?.trim() || 'N/A',
          teamId: registrationMeta.teamId || 'N/A',
          season: activeSeasonName || 'Current season',
          seasonId: registrationMeta.seasonId || 'N/A',
          division: formData.division?.trim() || 'N/A',
          paymentChoice: selection,
          portalLink:
            typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login',
        });
        const title = template.subject || 'Registration update';
        const body =
          template.body ||
          `${registrationMeta.fullName} (${registrationMeta.email}) selected "${selection}" for ${registrationMeta.regType}${registrationMeta.teamId ? ` (team ${registrationMeta.teamId})` : ''}.`;
        await sendRegistrationStageEmail({
          stage: 'payment',
          subject: title,
          body,
          bodyHtml: template.bodyHtml || undefined,
          recipientEmail: registrationMeta.email || undefined,
          includeAdminRecipients: false,
          metadata: {
            regType: registrationMeta.regType,
            teamId: registrationMeta.teamId,
            seasonId: registrationMeta.seasonId,
            paymentChoice: methodKey,
            stage: 'payment',
          },
        });
      } catch (emailErr) {
        console.warn('registration payment email notify failed', emailErr);
      }
    };

      if (method === 'later') {
        await completeRegistration();
        await notifyAdminsPayment('later');
        await setPaymentStatus('pending');
        const message = 'Registration saved. You can pay later or log in anytime.';
        setPaymentMessage(message);
        navigate('/register/success?next=/login', { state: { message } });
        return;
      }

    await completeRegistration();
    await notifyAdminsPayment(method);
    await setPaymentStatus('pending-stripe');

    const link =
      method === 'full'
        ? regType === 'create-team'
          ? stripeLinks.teamFull
          : stripeLinks.individualFull
        : regType === 'create-team'
        ? stripeLinks.teamDeposit
        : stripeLinks.individualDeposit;
    if (link) {
      window.open(link, '_blank', 'noopener');
      setPaymentMessage('Stripe opened in a new tab. After payment, return here or log in later.');
      return;
    }

    // Fallback message if no link configured
    let message = '';
    if (method === 'full') message = `Please proceed to pay the full amount of $${pricing.full}.`;
    if (method === 'deposit') message = `Please proceed to pay the deposit of $${pricing.deposit}.`;
    setPaymentMessage(message);
  };

  const WaiverSection: React.FC<{ className?: string }> = ({ className = '' }) => {
    const wrapperClass = ['space-y-2', className].filter(Boolean).join(' ');
    return (
      <div className={wrapperClass}>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-black/50 p-4">
          <button
            type="button"
            onClick={() => {
              setWaiverScrolled(false);
              setShowWaiverModal(true);
            }}
            className="px-4 py-2 rounded bg-black border border-white/20 text-white text-sm hover:border-brand-lime transition-colors"
          >
            Read CSL Participation Waiver (PDF)
          </button>
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              className="w-4 h-4 accent-brand-lime"
              checked={waiverAccepted}
              onChange={(event) => setWaiverAccepted(event.target.checked)}
              disabled={!waiverScrolled && !waiverAccepted}
            />
            <span className="text-xs text-gray-400">
              I have read and agree to the CSL Participation Waiver.
            </span>
          </label>
        </div>
        {!waiverAccepted && (
          <p className="text-xs text-brand-red">
            Please read the waiver and scroll to the end to enable agreement.
          </p>
        )}
      </div>
    );
  };

  if (isCheckingRegistration) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (alreadyMemberNotice) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 flex items-center justify-center">
        <div className="bg-brand-dark border border-white/10 rounded-xl px-6 py-4 text-center">
          <div className="text-white font-bold mb-2">Already registered</div>
          <div className="text-gray-400 text-sm">{alreadyMemberNotice.message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-40 md:pb-12 px-4 relative">
      {/* Waiver modal */}
      {showWaiverModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4">
          <div className="bg-brand-dark border border-white/10 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div>
                <h3 className="text-white font-sports text-xl">CSL Participation Waiver</h3>
                <p className="text-xs text-gray-400">Scroll to the bottom to enable agreement.</p>
              </div>
              <button
                onClick={() => setShowWaiverModal(false)}
                className="text-gray-400 hover:text-white text-sm"
              >
                Close
              </button>
            </div>
            <div
              ref={waiverScrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) {
                  setWaiverScrolled(true);
                }
              }}
              className="max-h-[70vh] overflow-y-auto bg-black"
            >
              {waiverUrl ? (
                <embed
                  key={waiverUrl}
                  src={waiverUrl}
                  type="application/pdf"
                  className="w-full min-h-[1600px]"
                />
              ) : (
                <div className="p-6 text-gray-400 text-sm">Waiver file not available.</div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between">
              <div className="text-xs text-gray-400">
                {waiverScrolled ? 'You reached the end of the document.' : 'Scroll to the bottom to enable agreement.'}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowWaiverModal(false)}
                  className="px-4 py-2 rounded bg-black border border-white/20 text-white text-sm hover:border-white/40"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (waiverScrolled) {
                      setWaiverAccepted(true);
                      setShowWaiverModal(false);
                    }
                  }}
                  disabled={!waiverScrolled}
                  className="px-4 py-2 rounded bg-brand-lime text-black text-sm font-bold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Mark as Read & Agree
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

        <div className="max-w-3xl mx-auto">
          <Link to="/" className="text-brand-grey hover:text-white flex items-center gap-2 mb-8 text-sm font-medium transition-colors">
            <ArrowLeft size={16} /> Back to Home
          </Link>

          {/* {currentUser && (
            <div className="mb-6 rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-gray-300 space-y-1">
              <div className="text-[10px] uppercase tracking-[0.4em] text-gray-500">Signed in as</div>
              <div className="text-white font-semibold leading-tight">
                {currentUser.name || currentUser.email}
              </div>
              <div className="text-[12px] text-gray-500">{currentUser.email}</div>
              <button
                type="button"
                onClick={handleSignOutAndReload}
                className="text-[10px] uppercase tracking-[0.4em] text-brand-lime"
              >
                Sign out & try a different account
              </button>
            </div>
          )} */}

        <div className="bg-brand-dark border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="bg-neutral-900 p-8 border-b border-white/5">
             <h1 className="font-sports text-3xl font-bold text-white uppercase mb-2">
               {step === 1
                 ? isStatsPortalFlow
                   ? portalScreen === 1
                     ? 'Activate My Profile - Account & Identity'
                     : 'Activate My Profile - Jersey Intake'
                   : 'Registration'
                 : isStatsPortalFlow
                 ? 'Finalizing Registration'
                 : 'Select Payment'}
             </h1>
             <p className="text-gray-400">
               {step === 1
                 ? (isStatsPortalFlow
                    ? portalScreen === 1
                      ? ''
                      : 'Complete jersey details to finish your stats portal activation.'
                     : `Join the league for the upcoming ${activeSeasonName}.`)
                 : (isStatsPortalFlow
                     ? 'Saving your profile and linking your account...'
                     : 'Choose how you would like to complete your registration.')}
             </p>
          </div>

          {step === 1 ? (
            <div className="p-8">
              {!lockRegType && (
                <div className="mb-8 bg-white/5 p-5 rounded-xl border border-white/10">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <label className="text-xs font-bold text-brand-grey uppercase">
                      Registration Season <span className="text-brand-red">*</span>
                    </label>
                    {!supportsRegistrationOpen && (
                      <span className="text-[10px] text-gray-500 uppercase tracking-wide">
                        Using current season fallback
                      </span>
                    )}
                  </div>
                  <select
                    value={selectedSeasonId}
                    onChange={(e) => {
                      setSelectedSeasonId(e.target.value);
                      setTeamCodeMessage(null);
                    }}
                    className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors appearance-none"
                    disabled={!availableRegistrationSeasons.length}
                  >
                    {!availableRegistrationSeasons.length && (
                      <option value="">No open registration seasons</option>
                    )}
                    {sortSeasonsNewestFirst(availableRegistrationSeasons).map((season) => (
                      <option key={season.id} value={season.id}>
                        {formatSeasonLabel(season)}
                      </option>
                    ))}
                  </select>
                  {!availableRegistrationSeasons.length && (
                    <p className="text-xs text-brand-red mt-2">
                      Registration is currently closed. Please contact the commissioner.
                    </p>
                  )}
                </div>
              )}

              {/* Type Toggle */}
              <div className="flex flex-col md:flex-row bg-black p-1.5 rounded-xl mb-10 border border-white/10 gap-1">
                <button
                  onClick={() => !lockRegType && setRegType('create-team')}
                  disabled={lockRegType}
                  className={`flex-1 py-3 rounded-lg font-sports font-bold uppercase tracking-wider text-sm transition-all duration-300 ${regType === 'create-team' ? 'bg-brand-lime text-black shadow-lg' : 'text-gray-500 hover:text-white hover:bg-white/5'} ${lockRegType ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  Setup My Team
                </button>
                <button
                  onClick={() => !lockRegType && setRegType('join-team')}
                  disabled={lockRegType}
                  className={`flex-1 py-3 rounded-lg font-sports font-bold uppercase tracking-wider text-sm transition-all duration-300 ${regType === 'join-team' ? 'bg-brand-lime text-black shadow-lg' : 'text-gray-500 hover:text-white hover:bg-white/5'} ${lockRegType ? 'opacity-40 cursor-not-allowed' : ''}`}
                  title={lockRegType ? 'Invite link locked' : undefined}
                >
                  Join an Existing Team
                </button>
                <button
                  onClick={() => !lockRegType && setRegType('individual')}
                  disabled={lockRegType || isStatsPortalFlow}
                  className={`flex-1 py-3 rounded-lg font-sports font-bold uppercase tracking-wider text-sm transition-all duration-300 ${regType === 'individual' ? 'bg-brand-lime text-black shadow-lg' : 'text-gray-500 hover:text-white hover:bg-white/5'} ${(lockRegType || isStatsPortalFlow) ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  Join as a Free Agent
                </button>
              </div>
              {isStatsPortalFlow && (
                <div className="mb-6 text-xs text-gray-400 bg-white/5 border border-white/10 rounded px-3 py-2">
                  Free-agent activation is opened after team assignment. Use your captain invite link once assigned.
                </div>
              )}
              {lockRegType && (
                <div className="mb-6 text-xs text-brand-lime bg-brand-lime/10 border border-brand-lime/30 rounded px-3 py-2">
                  Invite link detected. Registration type is locked to Join an Existing Team.
                </div>
              )}

               <div className="mb-8">
                 {!googleLinked ? (
                   <button 
                     type="button" 
                     onClick={handleGoogleAuth}
                     disabled={isAuthLoading || !selectedSeasonId}
                     className="w-full bg-white hover:bg-gray-100 text-black font-bold py-3 rounded flex items-center justify-center gap-3 transition-colors border border-gray-200 shadow-lg shadow-white/5 disabled:opacity-70"
                   >
                     {isAuthLoading ? (
                       <Loader2 className="w-5 h-5 animate-spin" />
                     ) : (
                       <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5" />
                     )}
                     {isAuthLoading ? 'Connecting...' : 'Sign up with Google'}
                   </button>
                 ) : (
                   <div className="w-full bg-brand-lime/10 border border-brand-lime/30 text-brand-lime font-bold py-3 rounded flex items-center justify-center gap-2">
                     <Check className="w-5 h-5" />
                     Account Linked with Google
                   </div>
                 )}
                 
                 {!googleLinked && (
                   <div className="relative my-6 text-center">
                       <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
                       <div className="relative z-10 inline-block px-4 bg-brand-dark text-gray-500 text-xs uppercase font-bold">Or create with email</div>
                   </div>
                 )}
               </div>

               <form onSubmit={handleSubmit} className="space-y-8">
                
                {/* --- CREATE TEAM SPECIFIC --- */}
                {regType === 'create-team' && (!isStatsPortalFlow || portalScreen === 1 || portalScreen === 2) && (
                  <div className="bg-white/5 p-6 rounded-xl border border-white/10 animate-fadeIn">
                    <h3 className="font-sports text-xl text-brand-lime uppercase mb-4 flex items-center gap-2">
                      <Shield className="w-5 h-5" /> {isStatsPortalFlow && portalScreen === 2 ? 'Jersey Design Upload' : 'Team Details'}
                    </h3>
                    {(!isStatsPortalFlow || portalScreen === 1) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                      <div className="md:col-span-1">
                        <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Team Name <span className="text-brand-red">*</span></label>
                        <input type="text" required name="teamName" value={formData.teamName} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="e.g. The Monstars" />
                        <div className="mt-2 rounded-lg border border-brand-lime/25 bg-brand-lime/10 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wider text-brand-lime/80 font-semibold">Team Code Preview</p>
                          <p className="font-mono text-sm text-brand-lime mt-0.5">
                            {createTeamCodePreview || 'Will auto-generate after team name'}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-1">
                            Auto-generated from your team name. Share this with teammates to join your team.
                          </p>
                        </div>
                      </div>
                      <div className="md:col-span-1">
                        <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Division Preference <span className="text-brand-red">*</span></label>
                        <select
                          name="division"
                          value={formData.division}
                          onChange={handleChange}
                          className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors appearance-none"
                        >
                          <option value="">Select division</option>
                          {availableDivisions.map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    )}

                {!isStatsPortalFlow && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Team Logo (1 image)</label>
                          <div className="border-2 border-dashed border-white/20 rounded-lg p-4 text-center hover:border-brand-lime/50 transition-colors bg-black/30">
                            <input type="file" id="logo-upload" accept="image/*" onChange={handleLogoChange} className="hidden" />
                            <label htmlFor="logo-upload" className="cursor-pointer flex flex-col items-center justify-center">
                              <Upload className="w-7 h-7 text-brand-grey mb-2" />
                              <span className="text-sm text-gray-400">Click to upload logo</span>
                            </label>
                          </div>
                          {(savedLogo || logoFile) && (
                            <div className="flex items-center gap-2 mt-3 bg-brand-lime/10 text-brand-lime text-xs px-3 py-2 rounded-full border border-brand-lime/20">
                              <span className="truncate max-w-[180px]">{savedLogo?.name || logoFile?.name}</span>
                              <button type="button" onClick={clearLogo} className="hover:text-white"><X size={14} /></button>
                            </div>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Team Banner (1 image)</label>
                          <div className="border-2 border-dashed border-white/20 rounded-lg p-4 text-center hover:border-brand-lime/50 transition-colors bg-black/30">
                            <input type="file" id="banner-upload" accept="image/*" onChange={handleBannerChange} className="hidden" />
                            <label htmlFor="banner-upload" className="cursor-pointer flex flex-col items-center justify-center">
                              <Upload className="w-7 h-7 text-brand-grey mb-2" />
                              <span className="text-sm text-gray-400">Click to upload banner</span>
                            </label>
                          </div>
                          {(savedBanner || bannerFile) && (
                            <div className="flex items-center gap-2 mt-3 bg-brand-lime/10 text-brand-lime text-xs px-3 py-2 rounded-full border border-brand-lime/20">
                              <span className="truncate max-w-[180px]">{savedBanner?.name || bannerFile?.name}</span>
                              <button type="button" onClick={clearBanner} className="hover:text-white"><X size={14} /></button>
                            </div>
                          )}
                        </div>
                      </div>
                      {mediaUploadError && (
                        <p className="mt-3 text-sm text-brand-red">{mediaUploadError}</p>
                      )}
                    </>
                    )}

                    {isStatsPortalFlow && portalScreen === 2 && (
                      <div className="mt-6">
                        <label className="block text-xs font-bold text-brand-grey uppercase mb-2">
                          Upload up to 3 jersey design inspirations (any image format, max 5MB each)
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {jerseyDesignFiles.map((file, index) => (
                            <div key={`jersey-inspiration-${index}`}>
                              <div className="border-2 border-dashed border-white/20 rounded-lg p-4 text-center hover:border-brand-lime/50 transition-colors bg-black/30">
                                <input
                                  type="file"
                                  id={`jersey-inspiration-upload-${index}`}
                                  accept="image/*"
                                  onChange={(e) => handleJerseyDesignFileChange(index, e)}
                                  className="hidden"
                                />
                                <label
                                  htmlFor={`jersey-inspiration-upload-${index}`}
                                  className="cursor-pointer flex flex-col items-center justify-center"
                                >
                                  <Upload className="w-7 h-7 text-brand-grey mb-2" />
                                  <span className="text-sm text-gray-400">
                                    {file ? `Replace inspiration ${index + 1}` : `Click to upload inspiration ${index + 1}`}
                                  </span>
                                </label>
                              </div>
                              {file && (
                                <div className="flex items-center gap-2 mt-3 bg-brand-lime/10 text-brand-lime text-xs px-3 py-2 rounded-full border border-brand-lime/20">
                                  <span className="truncate max-w-[180px]">{file.name}</span>
                                  <button type="button" onClick={() => clearJerseyDesignFile(index)} className="hover:text-white">
                                    <X size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-gray-500">
                          Uploaded: {jerseyDesignFiles.filter(Boolean).length}/3 files optional
                        </p>
                        {mediaUploadError && (
                          <p className="mt-3 text-sm text-brand-red">{mediaUploadError}</p>
                        )}
                      </div>
                    )}

                    {isStatsPortalFlow && portalScreen === 2 && (
                      <div className="mt-6 rounded-2xl border border-white/10 bg-[#111111]/90 p-4 md:p-5">
                        <div className="flex flex-col gap-3 border-b border-white/10 pb-4 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="text-sm uppercase text-gray-200 font-bold tracking-wide">Roster Jersey Intake</div>
                            <div className="text-xs text-gray-400 mt-1">
                              Pre-fill jersey details for your players. They can edit these when activating profile.
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setRosterModalOpen(true)}
                              className="self-start h-10 px-4 rounded-lg border border-white/20 bg-white/[0.02] text-xs font-bold uppercase tracking-wide text-white hover:border-white/40 hover:bg-white/[0.05]"
                            >
                              {captainRosterEntries.some((entry) => entry.fullName.trim() || entry.email.trim()) ? 'Manage Roster' : 'Add Player'}
                            </button>
                          </div>
                        </div>
                        <div className="mt-4">
                          {captainRosterEntries.some((entry) => entry.fullName.trim() || entry.email.trim()) ? (
                            <div className="space-y-3">
                              {captainRosterEntries
                                .filter((entry) => entry.fullName.trim() || entry.email.trim())
                                .map((entry, index) => (
                                  <div
                                    key={entry.id}
                                    className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                                  >
                                    <div className="flex items-start gap-3">
                                      <div>
                                        <div className="text-sm font-semibold text-white">
                                          {entry.fullName.trim() || `Player ${index + 1}`}
                                        </div>
                                        <div className="mt-1 text-xs text-gray-400">
                                          {entry.email.trim() || 'No email provided'}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      <span className="rounded-full border border-white/10 bg-black px-3 py-1 text-xs text-gray-300">
                                        Position: {entry.playerPosition || 'N/A'}
                                      </span>
                                      <span className="rounded-full border border-white/10 bg-black px-3 py-1 text-xs text-gray-300">
                                        Jersey Name: {entry.jerseyName.trim() || 'N/A'}
                                      </span>
                                      <span className="rounded-full border border-white/10 bg-black px-3 py-1 text-xs text-gray-300">
                                        Number: {entry.jerseyNumberChoices.trim() || 'N/A'}
                                      </span>
                                      <span className="rounded-full border border-white/10 bg-black px-3 py-1 text-xs text-gray-300">
                                        Jersey: {entry.jerseySize || 'N/A'}
                                      </span>
                                      <span className="rounded-full border border-white/10 bg-black px-3 py-1 text-xs text-gray-300">
                                        Shorts: {entry.shortsSize || 'N/A'}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-sm text-gray-500">
                              No players added yet. Use `Add Player` to build your roster.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* --- JOIN TEAM SPECIFIC --- */}
                {regType === 'join-team' && (!isStatsPortalFlow || portalScreen === 1) && (
                  <div className="bg-white/5 p-6 rounded-xl border border-white/10 animate-fadeIn">
                    <h3 className="font-sports text-xl text-brand-lime uppercase mb-4 flex items-center gap-2">
                      <Shield className="w-5 h-5" /> Team Selection
                    </h3>
                    <div className="space-y-4">
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Select Team <span className="text-brand-red">*</span></label>
                      <select
                        name="teamName"
                        value={formData.teamName}
                        onChange={(e) => {
                          handleChange(e);
                          setTeamCodeMessage(null);
                        }}
                        disabled={lockRegType}
                        className={`w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors appearance-none ${lockRegType ? 'opacity-70 cursor-not-allowed' : ''}`}
                      >
                        <option value="">Choose a team</option>
                        {availableTeams.map((t) => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                      {!lockRegType && (
                        <>
                          <div className="relative my-1 text-center">
                            <div className="absolute inset-0 flex items-center">
                              <div className="w-full border-t border-white/10"></div>
                            </div>
                            <div className="relative z-10 inline-block px-3 bg-brand-dark text-gray-500 text-[10px] uppercase font-bold">
                              Or use team code
                            </div>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              type="text"
                              value={teamCodeInput}
                              onChange={(e) => {
                                setTeamCodeInput(e.target.value);
                                setTeamCodeMessage(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  applyTeamCode(teamCodeInput);
                                }
                              }}
                              className="flex-1 bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors"
                              placeholder="Enter team code from captain"
                            />
                            <button
                              type="button"
                              onClick={() => applyTeamCode(teamCodeInput)}
                              className="px-4 py-3 rounded bg-white/10 text-white text-xs font-bold uppercase hover:bg-white/20"
                            >
                              Apply Code
                            </button>
                          </div>
                          <p className="text-[11px] text-gray-500">
                            Ask your captain for a private invite link or team code.
                          </p>
                          {teamCodeMessage && (
                            <p className="text-xs text-brand-lime">{teamCodeMessage}</p>
                          )}
                        </>
                      )}
                      {lockRegType && (
                        <p className="text-xs text-gray-500 mt-2">
                          Team is locked to the captain invite link.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {isStatsPortalFlow &&
                  portalScreen === 2 &&
                  rosterModalOpen &&
                  typeof document !== 'undefined' &&
                  createPortal(
                  <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
                    <div
                      className="absolute inset-0 bg-black/75"
                      onClick={() => {
                        setRosterModalOpen(false);
                        setActiveRosterSuggestionId(null);
                      }}
                    />
                    <div className="relative z-[91] w-full max-w-4xl rounded-2xl border border-white/10 bg-[#121212] p-5 shadow-2xl">
                      <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
                        <div>
                          <h3 className="font-sports text-2xl uppercase text-white">Roster Jersey Intake</h3>
                          <p className="mt-1 text-sm text-gray-400">
                            Add players here. Existing players in the system will appear as suggestions while you type.
                          </p>
                          <p className="mt-2 text-xs text-brand-lime">
                            Players added with an email address will receive an email notification to join this created team.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setRosterModalOpen(false);
                            setActiveRosterSuggestionId(null);
                          }}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-gray-400 hover:border-white/30 hover:text-white"
                          aria-label="Close roster modal"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div className="mt-4 max-h-[70vh] space-y-4 overflow-y-auto pr-1">
                        {captainRosterEntries.map((entry, index) => {
                          const suggestions = rosterSuggestions[entry.id] || [];
                          const showSuggestions = activeRosterSuggestionId === entry.id && suggestions.length > 0;
                          return (
                            <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
                                  Player {index + 1}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeCaptainRosterEntry(entry.id)}
                                  disabled={captainRosterEntries.length <= 1}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-brand-red/30 text-brand-red hover:bg-brand-red/10 disabled:cursor-not-allowed disabled:opacity-40"
                                  title="Remove player"
                                >
                                  <X size={14} />
                                </button>
                              </div>

                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="relative md:col-span-2">
                                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                                    Player Name
                                  </label>
                                  <input
                                    type="text"
                                    value={entry.fullName}
                                    onChange={(e) => {
                                      updateCaptainRosterEntry(entry.id, { fullName: e.target.value });
                                      setActiveRosterSuggestionId(entry.id);
                                      queueRosterSuggestionSearch(entry.id, e.target.value);
                                    }}
                                    onFocus={() => {
                                      setActiveRosterSuggestionId(entry.id);
                                      queueRosterSuggestionSearch(entry.id, entry.fullName);
                                    }}
                                    onBlur={() => {
                                      window.setTimeout(() => {
                                        setActiveRosterSuggestionId((current) => (current === entry.id ? null : current));
                                      }, 140);
                                    }}
                                    className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white placeholder:text-gray-600 focus:border-brand-lime focus:outline-none"
                                    placeholder="Player name"
                                  />
                                  {showSuggestions && (
                                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-xl border border-white/10 bg-[#151515] shadow-2xl">
                                      {suggestions.map((suggestion) => (
                                        <button
                                          key={suggestion.id}
                                          type="button"
                                          onMouseDown={(e) => e.preventDefault()}
                                          onClick={() => applyRosterSuggestion(entry.id, suggestion)}
                                          className="flex w-full flex-col gap-0.5 border-b border-white/5 px-3 py-2.5 text-left hover:bg-white/[0.05] last:border-b-0"
                                        >
                                          <span className="text-sm text-white">{suggestion.fullName}</span>
                                          <span className="text-[11px] text-gray-400">
                                            {suggestion.email || 'No email'} · {suggestion.seasonLabel}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                <div>
                                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                                    Email
                                  </label>
                                  <input
                                    type="email"
                                    value={entry.email}
                                    onChange={(e) => updateCaptainRosterEntry(entry.id, { email: e.target.value })}
                                    className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white placeholder:text-gray-600 focus:border-brand-lime focus:outline-none"
                                    placeholder="player@email.com"
                                  />
                                </div>

                                <div>
                                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                                    Player Position
                                  </label>
                                  <select
                                    value={entry.playerPosition}
                                    onChange={(e) => updateCaptainRosterEntry(entry.id, { playerPosition: e.target.value })}
                                    className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white appearance-none focus:border-brand-lime focus:outline-none"
                                  >
                                    <option value="">Select position</option>
                                    <option value="PG">Point Guard</option>
                                    <option value="SG">Shooting Guard</option>
                                    <option value="SF">Small Forward</option>
                                    <option value="PF">Power Forward</option>
                                    <option value="C">Center</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                                    Jersey Name
                                  </label>
                                  <input
                                    type="text"
                                    value={entry.jerseyName}
                                    onChange={(e) => updateCaptainRosterEntry(entry.id, { jerseyName: e.target.value })}
                                    className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white placeholder:text-gray-600 focus:border-brand-lime focus:outline-none"
                                    placeholder="Jersey name"
                                  />
                                </div>

                                <div>
                                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                                    Jersey Number
                                  </label>
                                  <input
                                    type="text"
                                    value={entry.jerseyNumberChoices}
                                    onChange={(e) =>
                                      updateCaptainRosterEntry(entry.id, {
                                        jerseyNumberChoices: sanitizeJerseyNumberInput(e.target.value),
                                      })
                                    }
                                    required={Boolean(entry.fullName.trim() || entry.email.trim())}
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    maxLength={3}
                                    className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white placeholder:text-gray-600 focus:border-brand-lime focus:outline-none"
                                    placeholder="000"
                                  />
                                </div>

                                <div>
                                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                                    Jersey Size
                                  </label>
                                  <select
                                    value={entry.jerseySize}
                                    onChange={(e) => updateCaptainRosterEntry(entry.id, { jerseySize: e.target.value })}
                                    className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white appearance-none focus:border-brand-lime focus:outline-none"
                                  >
                                    {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => (
                                      <option key={size} value={size}>
                                        {size}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                                    Shorts Size
                                  </label>
                                  <select
                                    value={entry.shortsSize}
                                    onChange={(e) => updateCaptainRosterEntry(entry.id, { shortsSize: e.target.value })}
                                    className="h-11 w-full rounded-lg border border-white/15 bg-black px-3 text-sm text-white appearance-none focus:border-brand-lime focus:outline-none"
                                  >
                                    {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((size) => (
                                      <option key={size} value={size}>
                                        {size}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
                        <button
                          type="button"
                          onClick={addCaptainRosterEntry}
                          className="rounded-lg border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:border-white/35"
                        >
                          Add Another Player
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRosterModalOpen(false);
                            setActiveRosterSuggestionId(null);
                          }}
                          className="rounded-lg bg-brand-lime px-5 py-2 text-xs font-bold uppercase tracking-wide text-black hover:brightness-95"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}

                {/* --- ACCOUNT & PLAYER DETAILS (ALL TYPES) --- */}
                <div>
                  <h3 className="font-sports text-xl text-white uppercase mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-brand-red skew-x-[-12deg] inline-block"></span>
                    Account & Player Details
                  </h3>

                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Email */}
                    {!isStatsPortalJerseyStep && (
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Email Address <span className="text-brand-red">*</span></label>
                    <input
                      type="email"
                      required
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      readOnly={googleLinked || hasExistingAccount || lockInviteEmail}
                      disabled={lockInviteEmail}
                      className={`w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700 ${(googleLinked || hasExistingAccount || lockInviteEmail) ? 'opacity-70 cursor-not-allowed' : ''}`}
                      placeholder="you@example.com"
                    />
                      {hasExistingAccount && (
                        <p className="mt-2 text-xs text-gray-500">
                          Logged-in account detected. We will use this email for registration.
                        </p>
                      )}
                      {!hasExistingAccount && lockInviteEmail && (
                        <p className="mt-2 text-xs text-gray-500">
                          Email is locked to the captain invite link.
                        </p>
                      )}
                    </div>
                    )}

                    {/* Existing-vs-new account intent (email flow) */}
                    {!isStatsPortalJerseyStep && !googleLinked && !hasExistingAccount && (
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-brand-grey uppercase mb-2">
                          Do you already have an account?
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setAccountIntent('existing');
                              setNeedsPasswordSetup(false);
                              setSubmitError(null);
                            }}
                            className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wide border transition-colors ${
                              accountIntent === 'existing'
                                ? 'bg-brand-lime text-black border-brand-lime'
                                : 'bg-black text-gray-300 border-white/20 hover:border-white/40'
                            }`}
                          >
                            Yes, I already have one
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAccountIntent('new');
                              setNeedsPasswordSetup(true);
                              setSubmitError(null);
                            }}
                            className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wide border transition-colors ${
                              accountIntent === 'new'
                                ? 'bg-brand-lime text-black border-brand-lime'
                                : 'bg-black text-gray-300 border-white/20 hover:border-white/40'
                            }`}
                          >
                            No, create new account
                          </button>
                        </div>
                        {accountIntent === 'existing' && !needsPasswordSetup && (
                          <div className="mt-3 text-xs text-gray-400 space-y-2">
                            <p>
                              To protect your information, we require you to sign in before we show any saved player details.
                              After logging in you'll confirm them on the next screen.
                            </p>
                            <button
                              type="button"
                              onClick={promptLoginForExistingAccount}
                              disabled={!isEmailInputValid}
                              className="inline-flex items-center gap-2 text-brand-lime underline decoration-brand-lime/60 disabled:text-white/40 disabled:decoration-white/20"
                            >
                              Log in & confirm my account
                            </button>
                          </div>
                        )}
                        {needsPasswordSetup && !hasExistingAccount && !googleLinked && (
                          <p className="mt-2 text-xs text-brand-lime">
                            No existing account detected for this email. Please set a password below.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Password Fields - show only when needed for new account setup */}
                    {!isStatsPortalJerseyStep && shouldShowPasswordFields && (
                      <>
                        <div>
                            <label className="block text-xs font-bold text-brand-grey uppercase mb-2 flex items-center gap-1">
                                 Password <span className="text-brand-red">*</span>
                            </label>
                            <div className="relative">
                                <input type="password" required name="password" value={formData.password} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="Min 8 chars" />
                                <Lock className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-600 w-4 h-4" />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Confirm Password <span className="text-brand-red">*</span></label>
                            <div className="relative">
                                <input type="password" required name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="Re-enter password" />
                                <Lock className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-600 w-4 h-4" />
                            </div>
                        </div>
                      </>
                    )}

                    {/* Player Name */}
                    {!isStatsPortalJerseyStep && (
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">
                        {isStatsPortalFlow ? 'Full Legal Name' : 'Player Name'} <span className="text-brand-red">*</span>
                      </label>
                      <input
                        type="text"
                        required={!shouldLockFullName}
                        name="fullName"
                        value={formData.fullName}
                        onChange={handleChange}
                        readOnly={shouldLockFullName}
                        className={`w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700 ${shouldLockFullName ? 'opacity-70 cursor-not-allowed' : ''}`}
                        placeholder="Full Name"
                      />
                      {shouldLockFullName && (
                        <p className="mt-2 text-xs text-gray-500">
                          Name is tied to your existing account and cannot be changed here.
                        </p>
                      )}
                    </div>
                    )}

                    {(!isStatsPortalFlow || portalScreen === 2) && (
                    <>
                    {isStatsPortalFlow && regType === 'join-team' && joinPrefillNotice && (
                      <div className="md:col-span-2 rounded-lg border border-brand-lime/30 bg-brand-lime/10 p-3 text-xs text-brand-lime">
                        {joinPrefillNotice}
                      </div>
                    )}
                    {!isStatsPortalJerseyStep && (
                    <>
                    {/* Player Position */}
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Player Position <span className="text-brand-red">*</span></label>
                      <select required name="playerPosition" value={formData.playerPosition} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors appearance-none">
                        <option value="">Select Position</option>
                        <option value="PG">Point Guard</option>
                        <option value="SG">Shooting Guard</option>
                        <option value="SF">Small Forward</option>
                        <option value="PF">Power Forward</option>
                       <option value="C">Center</option>
                      </select>
                    </div>
                    {/* Jersey Info - Top 3 Choices */}
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Jersey Number <span className="text-brand-red">*</span></label>
                      <input type="text" required name="playerNumber" value={formData.playerNumber} onChange={handleChange} inputMode="numeric" pattern="[0-9]*" maxLength={3} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="e.g. 023" />
                      <p className="text-xs text-gray-500 mt-1">List in order of preference.</p>
                    </div>

                    {/* Sizes */}
                    <div>
                       <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Player Jersey Size <span className="text-brand-red">*</span></label>
                       <select name="jerseySize" value={formData.jerseySize} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors appearance-none">
                         <option value="S">Small</option>
                         <option value="M">Medium</option>
                         <option value="L">Large</option>
                         <option value="XL">XL</option>
                         <option value="XXL">XXL</option>
                         <option value="XXXL">XXXL</option>
                       </select>
                    </div>
                    <div>
                       <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Player Shorts Size <span className="text-brand-red">*</span></label>
                       <select name="shortsSize" value={formData.shortsSize} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors appearance-none">
                         <option value="S">Small</option>
                         <option value="M">Medium</option>
                         <option value="L">Large</option>
                         <option value="XL">XL</option>
                         <option value="XXL">XXL</option>
                         <option value="XXXL">XXXL</option>
                       </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Name on Jersey <span className="text-brand-red">*</span></label>
                      <input type="text" required name="jerseyName" value={formData.jerseyName} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="Last Name / Nickname" />
                    </div>
                    </>
                    )}

                    {/* Referral */}
                    <div className="md:col-span-2">
                       <label className="block text-xs font-bold text-brand-grey uppercase mb-2">How did you hear about us? <span className="text-brand-red">*</span></label>
                       <select required name="referralSource" value={formData.referralSource} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors appearance-none">
                         <option value="">Select an option</option>
                         <option value="Instagram">Instagram</option>
                         <option value="Friend">Friend / Word of Mouth</option>
                         <option value="Google">Google Search</option>
                         <option value="Flyer">Flyer at Gym</option>
                         <option value="Other">Other</option>
                       </select>
                    </div>

                    {/* Fun / Extra */}
                    <div className="md:col-span-2">
                       <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Which NBA player do you hoop like? <span className="text-brand-red">*</span></label>
                       <input type="text" required name="nbaComparison" value={formData.nbaComparison} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="e.g. Kyrie handles with Draymond shooting" />
                    </div>
                    
                    <div className="md:col-span-2">
                       <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Instagram Handle</label>
                       <div className="relative">
                         <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500">@</span>
                         <input type="text" name="instagram" value={formData.instagram} onChange={handleChange} className="w-full bg-black border border-white/20 rounded pl-8 pr-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="courtsight" />
                       </div>
                    </div>
                    </>
                    )}
                  </div>
                </div>
                
                {(!isStatsPortalFlow || portalScreen === 1) && (
                <div className="mt-6">
                  <WaiverSection />
                </div>
                )}

                <div className="pt-8 border-t border-white/10">
                  {isStatsPortalFlow && portalScreen === 2 && (
                    <button
                      type="button"
                      onClick={() => setPortalScreen(1)}
                      className="w-full mb-3 border border-white/20 text-white rounded py-3 text-sm uppercase tracking-wide hover:border-white/40"
                    >
                      Back to Account & Identity
                    </button>
                  )}
                  <button 
                    type="submit" 
                    disabled={isSubmitting || isAuthLoading || !selectedSeasonId}
                    className="w-full bg-brand-red hover:bg-red-600 disabled:hover:bg-brand-red text-white font-sports font-bold text-xl uppercase py-4 rounded transition-all transform hover:scale-[1.01] shadow-xl tracking-wider disabled:opacity-60 disabled:cursor-not-allowed">
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" /> {uploadingDesigns ? 'Uploading...' : 'Saving...'}
                      </span>
                    ) : (
                      isStatsPortalFlow && portalScreen === 1 ? 'Continue to Jersey Details' : 'Access my Profile'
                    )}
                  </button>
                  {submitError && (
                    <p className="text-brand-red text-sm mt-3 text-center">{submitError}</p>
                  )}
                  {duplicateEmail && (
                    <div className="mt-3 text-center text-xs text-gray-300 space-y-1">
                      <p>
                        Looks like <span className="text-white font-semibold">{duplicateEmail}</span> already has an account.
                      </p>
                      <button
                        type="button"
                        onClick={goToLoginFromDuplicateEmail}
                        className="text-brand-lime hover:text-white underline"
                      >
                        Log in to continue or try another email
                      </button>
                    </div>
                  )}
                </div>
              </form>
            </div>
          ) : isStatsPortalFlow ? (
            <div className="p-8 animate-fadeIn">
              <div className="flex items-center gap-4 mb-6 p-4 bg-brand-lime/10 border border-brand-lime/20 rounded-lg">
                <div className="w-10 h-10 bg-brand-lime rounded-full flex items-center justify-center flex-shrink-0">
                  <Loader2 className="text-black w-5 h-5 animate-spin" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-sm">Finalizing Stats Portal Registration</h3>
                  <p className="text-xs text-gray-400">
                    {paymentMessage || 'Saving your profile details...'}
                  </p>
                </div>
              </div>
              <div className="text-xs text-gray-400">
                This should take a few seconds. If nothing changes, refresh and submit again.
              </div>
            </div>
          ) : (
            <div className="p-8 animate-fadeIn">
              <div className="flex items-center gap-4 mb-6 p-4 bg-brand-lime/10 border border-brand-lime/20 rounded-lg">
                <div className="w-10 h-10 bg-brand-lime rounded-full flex items-center justify-center flex-shrink-0">
                   <Check className="text-black font-bold" size={20} />
                </div>
                <div>
                   <h3 className="text-white font-bold text-sm">Registration Details Received</h3>
                   <p className="text-xs text-gray-400">Complete your registration by selecting a payment method below.</p>
                </div>
              </div>

              {/* Summary Box */}
              <div className="bg-black p-6 rounded-xl border border-white/10 mb-8">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-gray-400 text-sm font-medium">Registration Type</span>
                    <div className="text-right">
                      <span className="text-white font-bold block">{getTitle()}</span>
                      <span className="text-xs text-gray-500">
                        {activeSeasonName ? `${activeSeasonName} Season` : 'Current season'}
                      </span>
                    </div>
                  </div>
                {regType === 'create-team' && formData.teamName && (
                  <div className="flex justify-between items-center mb-4 border-t border-white/5 pt-4">
                    <span className="text-gray-400 text-sm font-medium">Team Name</span>
                    <span className="text-white font-bold">{formData.teamName}</span>
                  </div>
                )}
                 {regType === 'join-team' && formData.teamName && (
                  <div className="flex justify-between items-center mb-4 border-t border-white/5 pt-4">
                    <span className="text-gray-400 text-sm font-medium">Joining Team</span>
                    <span className="text-white font-bold">{selectedJoinTeam?.label || formData.teamName}</span>
                  </div>
                )}
              </div>

              <h3 className="font-sports text-xl text-white uppercase mb-4">Payment Options</h3>
              
              <div className="grid grid-cols-1 gap-4">
                
                {/* Option 1: Full Payment */}
                <button 
                  onClick={() => handlePayment('full')}
                  className="group relative bg-neutral-900 hover:bg-white/5 border border-white/10 hover:border-brand-lime rounded-xl p-5 text-left transition-all duration-200 shadow-lg"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-brand-lime/10 text-brand-lime rounded-lg group-hover:bg-brand-lime group-hover:text-black transition-colors">
                        <CreditCard size={24} />
                      </div>
                      <div>
                         <span className="block text-white font-bold text-lg">Pay Full Amount</span>
                         <span className="text-xs text-gray-500 uppercase tracking-wider">Secure via Stripe</span>
                      </div>
                    </div>
                    <div className="text-right">
                       <span className="block text-2xl font-sports font-bold text-white">${pricing.full.toLocaleString()}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400 pl-[3.25rem]">Pay the complete registration fee now to fully secure your spot.</p>
                </button>
                {/* Option 2: Deposit */}
                <button 
                  onClick={() => handlePayment('deposit')}
                  className="group relative bg-neutral-900 hover:bg-white/5 border border-white/10 hover:border-brand-lime rounded-xl p-5 text-left transition-all duration-200 shadow-lg"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-brand-lime/10 text-brand-lime rounded-lg group-hover:bg-brand-lime group-hover:text-black transition-colors">
                        <CalendarClock size={24} />
                      </div>
                      <div>
                         <span className="block text-white font-bold text-lg">Pay Deposit</span>
                         <span className="text-xs text-gray-500 uppercase tracking-wider">Secure via Stripe</span>
                      </div>
                    </div>
                    <div className="text-right">
                       <span className="block text-2xl font-sports font-bold text-white">${pricing.deposit.toLocaleString()}</span>
                       <span className="text-xs text-gray-500">Due Today</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400 pl-[3.25rem]">Reserve your spot with a deposit. Remaining balance due before Game 1.</p>
                </button>

                {/* Option 3: Pay Later */}
                 <button 
                  onClick={() => handlePayment('later')}
                  className="group relative bg-neutral-900 hover:bg-white/5 border border-white/10 hover:border-brand-lime rounded-xl p-5 text-left transition-all duration-200 shadow-lg"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-brand-lime/10 text-brand-lime rounded-lg group-hover:bg-brand-lime group-hover:text-black transition-colors">
                        <Wallet size={24} />
                      </div>
                      <div>
                         <span className="block text-white font-bold text-lg">Pay Later</span>
                         <span className="text-xs text-gray-500 uppercase tracking-wider">Offline Payment</span>
                      </div>
                    </div>
                    <div className="text-right">
                       <span className="block text-2xl font-sports font-bold text-white">$0.00</span>
                       <span className="text-xs text-gray-500">Due Today</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400 pl-[3.25rem]">Submit registration now. Coordinate offline payment with commissioner.</p>
                </button>

              </div>
              {paymentMessage && (
                <div className="mt-4 bg-brand-lime/10 border border-brand-lime/30 text-brand-lime text-sm px-4 py-3 rounded">
                  {paymentMessage}
                </div>
              )}
              
              <button onClick={resetForm} className="mt-8 w-full text-center text-sm text-brand-grey hover:text-white underline transition-colors">
                Go back to edit details
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Registration;
