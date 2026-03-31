import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { renderRegistrationEmailTemplate } from '../services/registrationEmailTemplates';
import { sendRegistrationStageEmail } from '../services/registrationStageEmailService';
import {
  getDefaultStripePaymentLinks,
  loadStripePaymentLinks,
  type StripePaymentLinks,
} from '../services/stripePaymentLinks';
import {
  createLeagueRegistrationLead,
  updateLeagueRegistrationLead,
  updateLeagueRegistrationLeadPayment,
} from '../services/leagueRegistrationService';
import {
  getDefaultRegistrationCapacitySettings,
  loadRegistrationCapacitySettings,
  resolveEffectiveRegistrationCapacity,
  type RegistrationCapacitySettings,
} from '../services/registrationCapacity';
import LoadingOverlay from '../components/LoadingOverlay';
import { Shield, CreditCard, ChevronDown } from 'lucide-react';
import { sortSeasonsNewestFirst } from '../utils/seasonOrdering';

type LeagueRegistrationType = 'team' | 'free-agent';
type PaymentChoice = 'full' | 'deposit' | 'later';

type SeasonRow = {
  id: string;
  name?: string | null;
  year?: string | number | null;
  is_current: boolean;
  start_date?: string;
  is_public?: boolean | string | null;
  registration_open?: boolean | string | null;
};

type DivisionRow = {
  id: string;
  name: string;
  season_id: string;
};

const formatSeasonLabel = (season?: SeasonRow) => {
  if (!season) return 'Season';
  const name = (season.name || 'Season').trim();
  const year = season.year ? season.year.toString().trim() : '';
  if (year && name.includes(year)) return name;
  return (name + (year ? ' ' + year : '')).trim();
};

const splitFullName = (value?: string | null) => {
  const text = (value || '').trim();
  if (!text) return { firstName: '', lastName: '' };
  const parts = text.split(/\s+/);
  const firstName = parts.shift() || '';
  const lastName = parts.join(' ');
  return { firstName, lastName };
};

const ordinalSuffix = (day: number) => {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'TH';
  const mod10 = day % 10;
  if (mod10 === 1) return 'ST';
  if (mod10 === 2) return 'ND';
  if (mod10 === 3) return 'RD';
  return 'TH';
};

const formatSeasonStartCallout = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const month = parsed.toLocaleString('en-US', { month: 'long' }).toUpperCase();
  const day = parsed.getDate();
  if (!Number.isFinite(day) || day <= 0) return null;
  return `${month} ${day}${ordinalSuffix(day)}`;
};

type LeagueRegistrationSummary = {
  leadId: string | null;
  registrationType: LeagueRegistrationType;
  seasonId: string;
  divisionId: string;
  seasonLabel: string;
  divisionLabel: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  teamName: string;
  receiveUpdates: boolean;
};

const registrationTypeCopy: Record<LeagueRegistrationType, { label: string; description: string }> = {
  team: {
    label: 'Register a team',
    description: 'You are building a team roster. Provide the team name + captain info, then pick payment.',
  },
  'free-agent': {
    label: 'Register as a free agent',
    description: 'Perfect for players without a team. Select a season/division and we will help place you.',
  },
};

const getStripePaymentLink = (
  stripeLinks: StripePaymentLinks,
  choice: PaymentChoice,
  registrationType: LeagueRegistrationType
) => {
  if (choice === 'deposit')
    return registrationType === 'team' ? stripeLinks.teamDeposit : stripeLinks.individualDeposit;
  if (choice === 'full') return registrationType === 'team' ? stripeLinks.teamFull : stripeLinks.individualFull;
  return undefined;
};

const defaultPaymentMessage =
  'Choose a payment method below. If paying now, complete checkout in Stripe, then confirm payment to continue to Step 3.';

const STORAGE_KEYS = {
  snapshot: 'league_registration_snapshot_v1',
  paymentChoice: 'league_registration_payment_choice_v1',
};

const STRIPE_RESULT_STORAGE_KEY = 'league_registration_stripe_result_v1';

const paymentOptions: Array<{ key: PaymentChoice; title: string; description: string; accent: string }> = [
  {
    key: 'full',
    title: 'Full payment',
    description: 'Lock your spot with the entire season fee.',
    accent: 'bg-brand-lime/10 text-brand-lime',
  },
  {
    key: 'deposit',
    title: 'Deposit',
    description: 'Reserve your spot with a deposit; remaining balance is due before Game 1.',
    accent: 'bg-black/50 text-white',
  },
  {
    key: 'later',
    title: 'Pay later',
    description: 'Submit registration now and coordinate offline payment with the commissioner.',
    accent: 'bg-black/50 text-white',
  },
];

const LeagueRegistration: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [capacitySettings, setCapacitySettings] = useState<RegistrationCapacitySettings>(
    getDefaultRegistrationCapacitySettings()
  );
  const [supportsRegistrationOpen, setSupportsRegistrationOpen] = useState(true);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [step, setStep] = useState<'form' | 'payment' | 'portal'>('form');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionInfo, setSubmissionInfo] = useState<string | null>(null);
  const [leadSaved, setLeadSaved] = useState<boolean | null>(null);
  const [leadSaveError, setLeadSaveError] = useState<string | null>(null);
  const [registrationSnapshot, setRegistrationSnapshot] = useState<LeagueRegistrationSummary | null>(null);
  const [resumeCandidate, setResumeCandidate] = useState<LeagueRegistrationSummary | null>(null);
  const [resumeCandidateChoice, setResumeCandidateChoice] = useState<PaymentChoice | null>(null);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice | null>(null);
  const [paymentMessage, setPaymentMessage] = useState(defaultPaymentMessage);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [paymentFinalizeError, setPaymentFinalizeError] = useState<string | null>(null);
  const [isFinalizingPayment, setIsFinalizingPayment] = useState(false);
  const [stripeLinks, setStripeLinks] = useState<StripePaymentLinks>(getDefaultStripePaymentLinks());
  const [stripeCheckoutLink, setStripeCheckoutLink] = useState<string | null>(null);
  const [waitingForStripe, setWaitingForStripe] = useState(false);
  const paymentEmailSentRef = useRef(false);
  const autoStripeReturnHandledRef = useRef(false);
  const [portalEmailError, setPortalEmailError] = useState<string | null>(null);
  const [isSendingPortalEmail, setIsSendingPortalEmail] = useState(false);
  const portalEmailSentRef = useRef(false);
  const [identityPrefillApplied, setIdentityPrefillApplied] = useState(false);
  const [lockedIdentityFields, setLockedIdentityFields] = useState({
    name: false,
    email: false,
    phone: false,
  });

  const [formData, setFormData] = useState({
    registrationType: 'team' as LeagueRegistrationType,
    seasonId: '',
    divisionId: '',
    name: '',
    email: '',
    phone: '',
    teamName: '',
    receiveUpdates: false,
  });

  const loadSavedSnapshot = useCallback((): LeagueRegistrationSummary | null => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.snapshot) || localStorage.getItem(STORAGE_KEYS.snapshot);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { ts?: number; snapshot?: LeagueRegistrationSummary };
      const ts = typeof parsed?.ts === 'number' ? parsed.ts : 0;
      if (ts && Date.now() - ts > 1000 * 60 * 60 * 24) return null; // 24h
      return (parsed?.snapshot || null) as LeagueRegistrationSummary | null;
    } catch {
      return null;
    }
  }, []);

  const saveSnapshot = useCallback((snapshot: LeagueRegistrationSummary | null) => {
    try {
      if (!snapshot) {
        sessionStorage.removeItem(STORAGE_KEYS.snapshot);
        localStorage.removeItem(STORAGE_KEYS.snapshot);
        return;
      }
      const payload = JSON.stringify({ ts: Date.now(), snapshot });
      sessionStorage.setItem(STORAGE_KEYS.snapshot, payload);
      localStorage.setItem(STORAGE_KEYS.snapshot, payload);
    } catch {
      // ignore
    }
  }, []);

  const loadSavedPaymentChoice = useCallback((): PaymentChoice | null => {
    try {
      const raw =
        sessionStorage.getItem(STORAGE_KEYS.paymentChoice) || localStorage.getItem(STORAGE_KEYS.paymentChoice);
      if (raw === 'full' || raw === 'deposit' || raw === 'later') return raw;
      return null;
    } catch {
      return null;
    }
  }, []);

  const savePaymentChoice = useCallback((choice: PaymentChoice | null) => {
    try {
      if (!choice) {
        sessionStorage.removeItem(STORAGE_KEYS.paymentChoice);
        localStorage.removeItem(STORAGE_KEYS.paymentChoice);
        return;
      }
      sessionStorage.setItem(STORAGE_KEYS.paymentChoice, choice);
      localStorage.setItem(STORAGE_KEYS.paymentChoice, choice);
    } catch {
      // ignore
    }
  }, []);

  const clearSavedProgress = useCallback(() => {
    saveSnapshot(null);
    savePaymentChoice(null);
  }, [saveSnapshot, savePaymentChoice]);

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

  useEffect(() => {
    let mounted = true;
    (async () => {
      const settings = await loadRegistrationCapacitySettings();
      if (!mounted) return;
      setCapacitySettings(settings);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const fetchLeagueDetails = useCallback(async () => {
    setLoadingData(true);
    setDataError(null);
    try {
      // `registration_open` is optional (newer column). If missing, fall back to using `is_current` only.
      let seasonRows: SeasonRow[] = [];
      let supportsRegOpen = true;
      const withReg = await supabase
        .from('seasons')
        .select('id,name,year,is_current,start_date,is_public,registration_open')
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
            .select('id,name,year,is_current,start_date,is_public')
            .order('start_date', { ascending: false });
          if (fallback.error) throw fallback.error;
          seasonRows = (fallback.data || []) as SeasonRow[];
        } else {
          throw withReg.error;
        }
      } else {
        seasonRows = (withReg.data || []) as SeasonRow[];
      }
      setSupportsRegistrationOpen(
        supportsRegOpen &&
          seasonRows.some((row) => Object.prototype.hasOwnProperty.call(row as any, 'registration_open'))
      );
      setSeasons(seasonRows || []);

      const { data: divisionRows, error: divisionError } = await supabase
        .from('divisions')
        .select('id,name,season_id')
        .order('name', { ascending: true });
      if (divisionError) throw divisionError;
      setDivisions(divisionRows || []);
    } catch (err) {
      console.error('Unable to load league registration data', err);
      setDataError('Unable to load league details right now. Please try again in a moment.');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    fetchLeagueDetails();
  }, [fetchLeagueDetails]);

  useEffect(() => {
    if (prefillApplied) return;
    const typeParam = searchParams.get('type');
    const teamParam = searchParams.get('team');
    setFormData((prev) => {
      let registrationType = prev.registrationType;
      if (typeParam === 'team') registrationType = 'team';
      if (typeParam === 'free-agent' || typeParam === 'individual') registrationType = 'free-agent';
      let teamName = prev.teamName;
      if (teamParam) {
        teamName = decodeURIComponent(teamParam);
        registrationType = 'team';
      }
      return {
        ...prev,
        registrationType,
        teamName,
      };
    });
    setPrefillApplied(true);
  }, [searchParams, prefillApplied]);

  useEffect(() => {
    if (identityPrefillApplied) return;
    let cancelled = false;

    const applyIdentityPrefill = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const authUser = data?.user;
        if (!authUser) return;

        const metadata = (authUser.user_metadata || {}) as Record<string, any>;
        const metaFullName =
          (metadata.full_name as string | undefined) ||
          [metadata.given_name, metadata.family_name].filter(Boolean).join(' ');
        const metaSplit = splitFullName(metaFullName);

        let latestFirst = '';
        let latestLast = '';
        let latestPhone = '';
        try {
          const { data: latestPlayer } = await supabase
            .from('players')
            .select('first_name,last_name,phone')
            .eq('user_id', authUser.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          latestFirst = (latestPlayer?.first_name || '').trim();
          latestLast = (latestPlayer?.last_name || '').trim();
          latestPhone = (latestPlayer?.phone || '').trim();
        } catch {
          // ignore optional lookup failure
        }

        if (!latestPhone) {
          try {
            const { data: profileRow } = await supabase
              .from('profiles')
              .select('display_name,phone')
              .eq('user_id', authUser.id)
              .maybeSingle();
            latestPhone = (profileRow?.phone || '').trim();
            if (!latestFirst && !latestLast) {
              const profileName = splitFullName(profileRow?.display_name);
              latestFirst = profileName.firstName;
              latestLast = profileName.lastName;
            }
          } catch {
            // ignore optional lookup failure
          }
        }

        if (cancelled) return;
        const prefilledFirstName = (latestFirst || metaSplit.firstName || '').trim();
        const prefilledLastName = (latestLast || metaSplit.lastName || '').trim();
        const prefilledName = `${prefilledFirstName} ${prefilledLastName}`.trim();
        const prefilledEmail = (authUser.email || '').trim();
        const prefilledPhone = (latestPhone || '').trim();

        setFormData((prev) => ({
          ...prev,
          name: prev.name || prefilledName,
          email: prev.email || prefilledEmail,
          phone: prev.phone || prefilledPhone,
        }));
        setLockedIdentityFields({
          name: Boolean(prefilledName),
          email: Boolean(prefilledEmail),
          phone: Boolean(prefilledPhone),
        });
      } finally {
        if (!cancelled) {
          setIdentityPrefillApplied(true);
        }
      }
    };

    applyIdentityPrefill();
    return () => {
      cancelled = true;
    };
  }, [identityPrefillApplied]);

  const parseBool = (value: any, fallback = true) => {
    if (value === true || value === 'true' || value === 'TRUE' || value === 't' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 'FALSE' || value === 'f' || value === 0 || value === '0') return false;
    return fallback;
  };

  const availableSeasons = useMemo(() => {
    if (supportsRegistrationOpen) {
      // Registration visibility is controlled via `registration_open` (not `is_public`).
      return seasons.filter((s) => parseBool(s.registration_open, false));
    }
    // Back-compat: if the column doesn't exist yet, only show the current season (and respect visibility).
    return seasons.filter((s) => parseBool(s.is_public, true)).filter((s) => !!s.is_current);
  }, [seasons, supportsRegistrationOpen]);

  useEffect(() => {
    if (!availableSeasons.length) {
      if (formData.seasonId || formData.divisionId) {
        setFormData((prev) => ({ ...prev, seasonId: '', divisionId: '' }));
      }
      return;
    }

    const preferred = availableSeasons.find((season) => season.is_current) || availableSeasons[0];
    const currentSelectedOk =
      !!formData.seasonId && availableSeasons.some((season) => season.id === formData.seasonId);
    if (!currentSelectedOk && preferred?.id) {
      setFormData((prev) => ({ ...prev, seasonId: preferred.id }));
    }
  }, [availableSeasons, formData.divisionId, formData.seasonId]);

  useEffect(() => {
    if (!formData.seasonId) return;
    const seasonDivisions = divisions.filter((division) => division.season_id === formData.seasonId);
    if (!seasonDivisions.length) {
      setFormData((prev) => ({ ...prev, divisionId: '' }));
      return;
    }
    if (!seasonDivisions.find((division) => division.id === formData.divisionId)) {
      setFormData((prev) => ({ ...prev, divisionId: seasonDivisions[0].id }));
    }
  }, [divisions, formData.divisionId, formData.seasonId]);

  const seasonLabel = useMemo(() => {
    if (!availableSeasons.length) return 'Registration Closed';
    const season = seasons.find((row) => row.id === formData.seasonId) || availableSeasons[0];
    return formatSeasonLabel(season);
  }, [availableSeasons, formData.seasonId, seasons]);

  const seasonStartCallout = useMemo(() => {
    const dated = availableSeasons
      .map((s) => s.start_date)
      .filter((d): d is string => !!d && !Number.isNaN(new Date(d).getTime()));
    if (!dated.length) return null;
    const sorted = dated.slice().sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    const label = formatSeasonStartCallout(sorted[0]);
    if (!label) return null;
    if (availableSeasons.length > 1) return `NEXT SEASON STARTS ${label}!`;
    return `SEASON STARTS ${label}!`;
  }, [availableSeasons]);

  const divisionLabel = useMemo(() => {
    return divisions.find((division) => division.id === formData.divisionId)?.name || 'Division';
  }, [divisions, formData.divisionId]);

  const seasonDivisions = useMemo(() => {
    if (!formData.seasonId) return [];
    return divisions
      .filter((division) => division.season_id === formData.seasonId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [divisions, formData.seasonId]);

  const registrationClosed = !loadingData && !dataError && !availableSeasons.length;

  const validateEmail = (value: string) => {
    return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value.trim());
  };
  const normalizeTeamNameForMatch = (value: string) =>
    (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const getCurrentCapacityUsage = useCallback(
    async (opts: {
      registrationType: LeagueRegistrationType;
      seasonId: string;
      divisionLabel: string;
    }) => {
      const normalizedDivision = opts.divisionLabel.trim();

      if (opts.registrationType === 'team') {
        let byDivision = supabase
          .from('teams')
          .select('id', { count: 'exact', head: true })
          .eq('season_id', opts.seasonId);
        if (normalizedDivision) {
          byDivision = byDivision.eq('division', normalizedDivision);
        }
        const divisionResult = await byDivision;
        if (divisionResult.error) {
          const msg = (divisionResult.error.message || '').toString().toLowerCase();
          const code = (divisionResult.error.code || '').toString();
          const missingDivisionColumn = code === '42703' || msg.includes('division');
          if (!missingDivisionColumn) throw divisionResult.error;

          const fallback = await supabase
            .from('teams')
            .select('id', { count: 'exact', head: true })
            .eq('season_id', opts.seasonId);
          if (fallback.error) throw fallback.error;
          return fallback.count || 0;
        }
        return divisionResult.count || 0;
      }

      let divisionTeams: { id: string }[] = [];
      if (normalizedDivision) {
        const teamRows = await supabase
          .from('teams')
          .select('id')
          .eq('season_id', opts.seasonId)
          .eq('division', normalizedDivision);
        if (teamRows.error) {
          const msg = (teamRows.error.message || '').toString().toLowerCase();
          const code = (teamRows.error.code || '').toString();
          const missingDivisionColumn = code === '42703' || msg.includes('division');
          if (!missingDivisionColumn) throw teamRows.error;
          divisionTeams = [];
        } else {
          divisionTeams = (teamRows.data || []) as { id: string }[];
        }
      } else {
        const allSeasonTeams = await supabase
          .from('teams')
          .select('id')
          .eq('season_id', opts.seasonId);
        if (allSeasonTeams.error) throw allSeasonTeams.error;
        divisionTeams = (allSeasonTeams.data || []) as { id: string }[];
      }

      const divisionTeamIds = divisionTeams
        .map((team) => team.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
      if (!divisionTeamIds.length) return 0;

      const playersCount = await supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', opts.seasonId)
        .in('team_id', divisionTeamIds);
      if (playersCount.error) throw playersCount.error;
      return playersCount.count || 0;
    },
    []
  );

  const buildPortalQuery = (summary: LeagueRegistrationSummary) => {
    const params = new URLSearchParams();
    params.set('type', summary.registrationType === 'team' ? 'team' : 'individual');
    params.set('statsPortal', '1');
    if (summary.leadId) params.set('leadId', summary.leadId);
    if (summary.seasonId) params.set('seasonId', summary.seasonId);
    if (summary.teamName) params.set('teamName', summary.teamName);
    if (summary.divisionLabel) params.set('division', summary.divisionLabel);
    return params.toString();
  };

  const buildPortalRegistrationPath = (summary: LeagueRegistrationSummary) => {
    return `/portal/register?${buildPortalQuery(summary)}`;
  };

  const resolvePostPortalDestination = async () => {
    try {
      const { data } = await supabase.auth.getUser();
      if (data?.user?.id) return '/my-season';
    } catch {
      // ignore and fall back to home
    }
    return '/';
  };

  const sendStatsPortalEmailAndGoToLiveSite = async (options?: { force?: boolean; redirectAfterSend?: boolean }) => {
    if (!registrationSnapshot) {
      navigate('/');
      return;
    }
    const alreadySent = portalEmailSentRef.current;
    if (alreadySent && !options?.force) return;

    setPortalEmailError(null);
    setIsSendingPortalEmail(true);

    const choiceLabel = paymentChoice ? paymentChoiceLabel(paymentChoice) : '';
    const regLabel = registrationSnapshot.registrationType === 'team' ? 'Team' : 'Free agent';
    const fullName = `${registrationSnapshot.firstName} ${registrationSnapshot.lastName}`.trim();
    const portalLink =
      typeof window !== 'undefined'
        ? `${window.location.origin}${buildPortalRegistrationPath(registrationSnapshot)}`
        : buildPortalRegistrationPath(registrationSnapshot);

    try {
      const template = await renderRegistrationEmailTemplate('stats_portal_registration', {
        fullName,
        firstName: registrationSnapshot.firstName,
        lastName: registrationSnapshot.lastName,
        email: registrationSnapshot.email,
        phone: registrationSnapshot.phone,
        registrationType: regLabel,
        teamName: registrationSnapshot.teamName || 'N/A',
        season: registrationSnapshot.seasonLabel,
        seasonId: registrationSnapshot.seasonId,
        division: registrationSnapshot.divisionLabel,
        paymentChoice: choiceLabel,
        portalLink,
      });

      await sendRegistrationStageEmail({
        stage: 'stats_portal_registration',
        subject: template.subject || 'Complete your Stats Portal Registration',
        body: template.body || `Complete your Stats Portal Registration: ${portalLink}`,
        bodyHtml: template.bodyHtml || undefined,
        recipientEmail: registrationSnapshot.email,
        includeAdminRecipients: false,
        metadata: {
          registrationType: registrationSnapshot.registrationType,
          seasonId: registrationSnapshot.seasonId,
          divisionId: registrationSnapshot.divisionId,
          paymentChoice: paymentChoice || null,
          stage: 'stats_portal_registration',
          leadId: registrationSnapshot.leadId,
        },
      });

      portalEmailSentRef.current = true;
      clearSavedProgress();
      setPortalEmailError(null);
      setSubmissionInfo(
        alreadySent
          ? 'Stats Portal link sent again. Check your email (and spam folder).'
          : 'Registration complete. Check your email for the Stats Portal registration link.'
      );
      if (options?.redirectAfterSend) {
        const nextPath = await resolvePostPortalDestination();
        navigate(nextPath);
      }
    } catch (err) {
      console.warn('Stats portal email notify failed', err);
      setPortalEmailError('Email sending failed. Please try again.');
    } finally {
      setIsSendingPortalEmail(false);
    }
  };

  // After confirming deposit payment, send the Stats Portal email automatically (best-effort).
  useEffect(() => {
    if (step !== 'portal') return;
    if (paymentChoice !== 'deposit') return;
    if (!registrationSnapshot) return;
    if (portalEmailSentRef.current) return;
    if (isSendingPortalEmail) return;
    void sendStatsPortalEmailAndGoToLiveSite();
  }, [step, paymentChoice, registrationSnapshot, isSendingPortalEmail]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loadingData || dataError) return;
    setSubmissionError(null);
    setSubmissionInfo(null);
    setLeadSaved(null);
    setLeadSaveError(null);

    if (!formData.seasonId) {
      setSubmissionError('Please select a registration season.');
      return;
    }
    if (!formData.divisionId) {
      setSubmissionError('Please select a division.');
      return;
    }
    if (!formData.name.trim()) {
      setSubmissionError('Enter your name.');
      return;
    }
    if (!formData.email.trim() || !validateEmail(formData.email)) {
      setSubmissionError('Enter a valid email address.');
      return;
    }
    if (!formData.phone.trim()) {
      setSubmissionError('Enter a phone number so we can reach you about payment.');
      return;
    }
    if (formData.registrationType === 'team' && !formData.teamName.trim()) {
      setSubmissionError('Enter the name of the team you are registering.');
      return;
    }
    if (formData.registrationType === 'team') {
      const normalizedRequestedName = normalizeTeamNameForMatch(formData.teamName);
      if (normalizedRequestedName) {
        let candidateRows: any[] = [];
        const byDivision = await supabase
          .from('teams')
          .select('name,division')
          .eq('season_id', formData.seasonId)
          .eq('division', divisionLabel);
        if (byDivision.error) {
          const msg = (byDivision.error.message || '').toString().toLowerCase();
          const code = (byDivision.error.code || '').toString();
          const missingDivisionColumn =
            code === '42703' || (msg.includes('division') && msg.includes('column'));
          if (!missingDivisionColumn) {
            setSubmissionError('Unable to validate team name right now. Please try again.');
            return;
          }

          const fallback = await supabase
            .from('teams')
            .select('name')
            .eq('season_id', formData.seasonId);
          if (fallback.error) {
            setSubmissionError('Unable to validate team name right now. Please try again.');
            return;
          }
          candidateRows = fallback.data || [];
        } else {
          candidateRows = byDivision.data || [];
        }

        const hasDuplicate = candidateRows.some(
          (row: any) => normalizeTeamNameForMatch(row?.name || '') === normalizedRequestedName
        );
        if (hasDuplicate) {
          setSubmissionError(
            `Team "${formData.teamName.trim()}" already exists in ${divisionLabel} for this season.`
          );
          return;
        }
      }
    }

    const effectiveCapacityLimit = resolveEffectiveRegistrationCapacity(
      capacitySettings,
      formData.registrationType,
      formData.seasonId,
      formData.divisionId
    );
    if (effectiveCapacityLimit && effectiveCapacityLimit > 0) {
      try {
        const usageCount = await getCurrentCapacityUsage({
          registrationType: formData.registrationType,
          seasonId: formData.seasonId,
          divisionLabel,
        });
        if (usageCount >= effectiveCapacityLimit) {
          const slotLabel =
            formData.registrationType === 'team' ? 'team slots' : 'player slots';
          setSubmissionError(
            `${divisionLabel} is already full for ${seasonLabel}. Capacity reached (${usageCount}/${effectiveCapacityLimit} ${slotLabel}).`
          );
          return;
        }
      } catch (capacityErr) {
        console.warn('Registration capacity validation failed', capacityErr);
        setSubmissionError('Unable to validate capacity right now. Please try again.');
        return;
      }
    }

    const { firstName, lastName } = splitFullName(formData.name);

    const summary: LeagueRegistrationSummary = {
      leadId: null,
      registrationType: formData.registrationType,
      seasonId: formData.seasonId,
      divisionId: formData.divisionId,
      seasonLabel,
      divisionLabel,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      teamName: formData.teamName.trim(),
      receiveUpdates: !!formData.receiveUpdates,
    };

    // Only reuse an already-active lead in this live flow.
    // Do not silently reuse resume/saved lead IDs unless the user explicitly resumed,
    // otherwise a "new" submit can overwrite/link the wrong historical lead.
    const reusableLeadId = registrationSnapshot?.leadId || null;

    setIsSubmitting(true);
    try {
      if (reusableLeadId) {
        summary.leadId = reusableLeadId;
        const updatedLead = await updateLeagueRegistrationLead(reusableLeadId, {
          registrationType: summary.registrationType,
          seasonId: summary.seasonId,
          divisionId: summary.divisionId,
          seasonLabel: summary.seasonLabel,
          divisionLabel: summary.divisionLabel,
          firstName: summary.firstName,
          lastName: summary.lastName,
          email: summary.email,
          phone: summary.phone,
          teamName: summary.teamName,
          receiveUpdates: summary.receiveUpdates,
        });
        if (updatedLead.saved) {
          setLeadSaved(true);
          setLeadSaveError(null);
          setSubmissionInfo('Registration updated. Continuing to payment.');
        } else {
          const msg = (updatedLead.error || '').toLowerCase();
          const noMatchingLead = msg.includes('no matching lead row');
          if (noMatchingLead) {
            const leadSave = await createLeagueRegistrationLead({
              registrationType: summary.registrationType,
              seasonId: summary.seasonId,
              divisionId: summary.divisionId,
              seasonLabel: summary.seasonLabel,
              divisionLabel: summary.divisionLabel,
              firstName: summary.firstName,
              lastName: summary.lastName,
              email: summary.email,
              phone: summary.phone,
              teamName: summary.teamName,
              receiveUpdates: summary.receiveUpdates,
            });
            summary.leadId = leadSave.id;
            setLeadSaved(leadSave.saved);
            if (!leadSave.saved) {
              setLeadSaveError(leadSave.error || 'Lead save failed.');
              setSubmissionInfo(
                "Registration received, but it wasn't saved to the admin registrations table yet. Ask the developer to run `server/league_registrations.sql` in Supabase."
              );
            } else {
              setLeadSaveError(null);
              setSubmissionInfo('Registration saved.');
            }
          } else {
            setLeadSaved(false);
            setLeadSaveError(updatedLead.error || 'Lead update failed.');
            setSubmissionInfo(
              "We could not update your saved registration right now. Please try again in a moment."
            );
          }
        }
      } else {
        const leadSave = await createLeagueRegistrationLead({
          registrationType: summary.registrationType,
          seasonId: summary.seasonId,
          divisionId: summary.divisionId,
          seasonLabel: summary.seasonLabel,
          divisionLabel: summary.divisionLabel,
          firstName: summary.firstName,
          lastName: summary.lastName,
          email: summary.email,
          phone: summary.phone,
          teamName: summary.teamName,
          receiveUpdates: summary.receiveUpdates,
        });
        summary.leadId = leadSave.id;
        setLeadSaved(leadSave.saved);
        if (!leadSave.saved) {
          setLeadSaveError(leadSave.error || 'Lead save failed.');
          setSubmissionInfo(
            "Registration received, but it wasn't saved to the admin registrations table yet. Ask the developer to run `server/league_registrations.sql` in Supabase."
          );
        } else {
          setLeadSaveError(null);
          setSubmissionInfo('Registration saved.');
        }
      }
    } catch (err) {
      console.warn('League registration lead save failed', err);
      setLeadSaved(false);
      setLeadSaveError(err instanceof Error ? err.message : 'Lead save failed.');
      setSubmissionInfo(
        "Registration received, but it wasn't saved to the admin registrations table yet. Ask the developer to run `server/league_registrations.sql` in Supabase."
      );
    } finally {
      setIsSubmitting(false);
    }

    setRegistrationSnapshot(summary);
    saveSnapshot(summary);
    setStep('payment');
    setPaymentChoice(null);
    savePaymentChoice(null);
    setPaymentMessage(defaultPaymentMessage);
    setPaymentConfirmed(false);
    setPaymentFinalizeError(null);
    setIsFinalizingPayment(false);
    paymentEmailSentRef.current = false;
    setPortalEmailError(null);
    setIsSendingPortalEmail(false);
    portalEmailSentRef.current = false;
  };

  const paymentChoiceLabel = (choice: PaymentChoice) => {
    if (choice === 'full') return 'Paid fully';
    if (choice === 'deposit') return 'Deposit paid';
    return 'Pay later';
  };

  const finalizePaymentAndContinue = async (choice: PaymentChoice, snapshotOverride?: LeagueRegistrationSummary) => {
    const snapshot = snapshotOverride || registrationSnapshot;
    if (!snapshot) return;
    if (paymentEmailSentRef.current) {
      setStep('portal');
      return;
    }

    setPaymentFinalizeError(null);
    setIsFinalizingPayment(true);

    const choiceLabel = paymentChoiceLabel(choice);
    const regLabel = snapshot.registrationType === 'team' ? 'Team' : 'Free agent';
    const fullName = `${snapshot.firstName} ${snapshot.lastName}`.trim();
    const portalLink =
      typeof window !== 'undefined'
        ? `${window.location.origin}${buildPortalRegistrationPath(snapshot)}`
        : buildPortalRegistrationPath(snapshot);

    try {
      const templateStage =
        choice === 'full'
          ? 'registration_paid_full'
          : choice === 'deposit'
          ? 'registration_deposit_paid'
          : 'registration_pay_later';

      const template = await renderRegistrationEmailTemplate(templateStage, {
        fullName,
        firstName: snapshot.firstName,
        lastName: snapshot.lastName,
        email: snapshot.email,
        phone: snapshot.phone,
        registrationType: regLabel,
        teamName: snapshot.teamName || 'N/A',
        season: snapshot.seasonLabel,
        seasonId: snapshot.seasonId,
        division: snapshot.divisionLabel,
        paymentChoice: choiceLabel,
        portalLink,
      });

      await sendRegistrationStageEmail({
        stage: 'payment',
        subject: template.subject || 'League registration payment update',
        body: template.body || `${fullName} selected ${choiceLabel}.`,
        bodyHtml: template.bodyHtml || undefined,
        recipientEmail: snapshot.email,
        includeAdminRecipients: false,
        metadata: {
          registrationType: snapshot.registrationType,
          seasonId: snapshot.seasonId,
          divisionId: snapshot.divisionId,
          paymentChoice: choice,
          stage: 'payment',
          leadId: snapshot.leadId,
        },
      });

      paymentEmailSentRef.current = true;
    } catch (err) {
      console.warn('League registration payment email notify failed', err);
      // Don't block the registration flow on an email failure.
      setPaymentFinalizeError(
        'We could not send the confirmation email right now. You can still continue to Step 3.'
      );
    } finally {
      setIsFinalizingPayment(false);
    }

    // Once payment is confirmed, don't force-resume this registration later.
    // (Players often come back to register again and get stuck back on the payment step.)
    if (choice === 'deposit' || choice === 'full') {
      clearSavedProgress();
      try {
        sessionStorage.removeItem(STRIPE_RESULT_STORAGE_KEY);
        localStorage.removeItem(STRIPE_RESULT_STORAGE_KEY);
      } catch {
        // ignore
      }
    }

    setStep('portal');
  };

  // If there's saved progress, show a "Resume?" prompt instead of auto-resuming.
  // Stripe return flows are handled separately via the `payment=success|canceled` query param.
  useEffect(() => {
    if (registrationSnapshot) return;
    const status = (searchParams.get('payment') || '').toLowerCase();
    if (status) return;
    const saved = loadSavedSnapshot();
    if (!saved) return;
    setResumeCandidate(saved);
    setResumeCandidateChoice(loadSavedPaymentChoice());
  }, [registrationSnapshot, searchParams, loadSavedSnapshot, loadSavedPaymentChoice]);

  // Stripe redirect handling. Configure your Stripe Payment Link "after payment" redirect to include:
  // `...?payment=success&choice=deposit` (or `choice=full`) and cancel URL `...?payment=canceled`.
  useEffect(() => {
    if (autoStripeReturnHandledRef.current) return;
    const status = (searchParams.get('payment') || '').toLowerCase();
    if (!status) return;
    autoStripeReturnHandledRef.current = true;

    const cleanupUrl = () => {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('payment');
        url.searchParams.delete('choice');
        url.searchParams.delete('session_id');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      } catch {
        // ignore
      }
    };

    const savedSnapshot = registrationSnapshot || loadSavedSnapshot();
    if (savedSnapshot && !registrationSnapshot) {
      setRegistrationSnapshot(savedSnapshot);
    }

    if (status === 'success') {
      const choiceParam = (searchParams.get('choice') || '').toLowerCase();
      const choiceFromQuery =
        choiceParam === 'full' || choiceParam === 'deposit' || choiceParam === 'later'
          ? (choiceParam as PaymentChoice)
          : null;
      const choice = choiceFromQuery || loadSavedPaymentChoice();

      setStep('payment');
      setPaymentFinalizeError(null);

      // Cross-tab signal for "Stripe opened in a new tab" flows.
      try {
        localStorage.setItem(
          STRIPE_RESULT_STORAGE_KEY,
          JSON.stringify({ status: 'success', choice, ts: Date.now() })
        );
      } catch {
        // ignore
      }

      if (choice === 'full' || choice === 'deposit') {
        setPaymentChoice(choice);
        savePaymentChoice(choice);
        setPaymentConfirmed(true);
        setWaitingForStripe(false);
        setPaymentMessage('PAYMENT SUCCESSFUL. CONTINUING TO STEP 3...');
        void finalizePaymentAndContinue(choice, savedSnapshot || undefined);
        cleanupUrl();
        return;
      }

      setPaymentMessage('PAYMENT SUCCESSFUL. PLEASE SELECT THE PAYMENT OPTION YOU USED TO CONTINUE.');
      cleanupUrl();
      return;
    }

    if (status === 'canceled' || status === 'cancelled') {
      setStep('payment');
      setPaymentConfirmed(false);
      setWaitingForStripe(false);
      setPaymentFinalizeError(null);
      setPaymentMessage('PAYMENT CANCELED. YOU CAN TRY AGAIN OR SELECT PAY LATER.');
      try {
        localStorage.setItem(
          STRIPE_RESULT_STORAGE_KEY,
          JSON.stringify({ status: 'canceled', choice: loadSavedPaymentChoice(), ts: Date.now() })
        );
      } catch {
        // ignore
      }
      cleanupUrl();
      return;
    }
  }, [
    searchParams,
    registrationSnapshot,
    loadSavedSnapshot,
    loadSavedPaymentChoice,
    savePaymentChoice,
    finalizePaymentAndContinue,
  ]);

  const handlePaymentChoice = async (choice: PaymentChoice) => {
    if (!registrationSnapshot) return;
    setPaymentFinalizeError(null);
    setPaymentChoice(choice);
    savePaymentChoice(choice);
    setPaymentConfirmed(false);
    setStripeCheckoutLink(null);
    setWaitingForStripe(false);
    if (choice === 'later') {
      setPaymentMessage(
        'You selected Pay Later. Continue to Step 3 so we can collect your Stats Portal profile details now.'
      );
      try {
        if (registrationSnapshot.leadId) {
          await updateLeagueRegistrationLeadPayment(registrationSnapshot.leadId, choice);
        }
      } catch (err) {
        console.warn('Payment choice lead update failed', err);
      }
      await finalizePaymentAndContinue(choice);
      return;
    } else {
      const link = getStripePaymentLink(stripeLinks, choice, registrationSnapshot.registrationType);
      if (link) {
        // Persist progress so a Stripe redirect can restore and auto-continue.
        saveSnapshot(registrationSnapshot);
        setStripeCheckoutLink(link);
        try {
          localStorage.setItem(
            STRIPE_RESULT_STORAGE_KEY,
            JSON.stringify({ status: 'pending', choice, ts: Date.now() })
          );
        } catch {
          // ignore
        }
        // Open Stripe in a new tab so players can return to the registration flow.
        const opened = window.open(link, '_blank', 'noopener,noreferrer');
        if (opened) {
          setWaitingForStripe(true);
          setPaymentMessage('Stripe opened in a new tab. Complete checkout, then confirm payment below to continue.');
        } else {
          setPaymentMessage(
            'Your browser blocked the new tab. Use the "Open Stripe Checkout" button below, then come back to confirm payment.'
          );
        }
      } else {
        setPaymentMessage('Payment link is not configured. Email us to get the checkout link or pay offline.');
      }
    }

    try {
      if (registrationSnapshot.leadId) {
        await updateLeagueRegistrationLeadPayment(registrationSnapshot.leadId, choice);
      }
    } catch (err) {
      console.warn('Payment choice lead update failed', err);
    }
  };

  // If Stripe is opened in a new tab, lock the UI until the user returns focus.
  useEffect(() => {
    if (!waitingForStripe) return;
    const onFocus = () => setWaitingForStripe(false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [waitingForStripe]);

  // Cross-tab: if Stripe redirects back to our site in the Stripe tab, that tab writes a result to localStorage.
  // The original registration tab listens and auto-continues to Step 3 on success.
  useEffect(() => {
    if (!waitingForStripe) return;

    const tryHandleStripeResult = () => {
      let parsed: any = null;
      try {
        const raw = localStorage.getItem(STRIPE_RESULT_STORAGE_KEY);
        if (!raw) return;
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      const status = (parsed?.status || '').toString().toLowerCase();
      const ts = typeof parsed?.ts === 'number' ? parsed.ts : 0;
      const choice = parsed?.choice as PaymentChoice | null | undefined;

      // Ignore stale signals.
      if (!ts || Date.now() - ts > 1000 * 60 * 20) return;

      if (status === 'success' && (choice === 'full' || choice === 'deposit')) {
        const snapshot = registrationSnapshot || loadSavedSnapshot();
        if (snapshot && !registrationSnapshot) {
          setRegistrationSnapshot(snapshot);
        }
        setStep('payment');
        setPaymentChoice(choice);
        savePaymentChoice(choice);
        setPaymentConfirmed(true);
        setWaitingForStripe(false);
        setPaymentFinalizeError(null);
        setPaymentMessage('PAYMENT SUCCESSFUL. CONTINUING TO STEP 3...');
        void finalizePaymentAndContinue(choice, snapshot || undefined);
        try {
          localStorage.removeItem(STRIPE_RESULT_STORAGE_KEY);
        } catch {}
        return;
      }

      if (status === 'canceled' || status === 'cancelled') {
        setWaitingForStripe(false);
        setPaymentConfirmed(false);
        setPaymentFinalizeError(null);
        setPaymentMessage('PAYMENT CANCELED. YOU CAN TRY AGAIN OR SELECT PAY LATER.');
        try {
          localStorage.removeItem(STRIPE_RESULT_STORAGE_KEY);
        } catch {}
        return;
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STRIPE_RESULT_STORAGE_KEY) return;
      tryHandleStripeResult();
    };

    window.addEventListener('storage', onStorage);
    // Also check immediately (in case the result was written before the listener attached).
    tryHandleStripeResult();
    return () => window.removeEventListener('storage', onStorage);
  }, [
    waitingForStripe,
    registrationSnapshot,
    loadSavedSnapshot,
    savePaymentChoice,
    finalizePaymentAndContinue,
  ]);

  const openStripeCheckout = useCallback(() => {
    if (!stripeCheckoutLink) return;
    try {
      localStorage.setItem(
        STRIPE_RESULT_STORAGE_KEY,
        JSON.stringify({ status: 'pending', choice: paymentChoice, ts: Date.now() })
      );
    } catch {
      // ignore
    }
    const opened = window.open(stripeCheckoutLink, '_blank', 'noopener,noreferrer');
    if (opened) {
      setWaitingForStripe(true);
    } else {
      setWaitingForStripe(false);
    }
  }, [stripeCheckoutLink, paymentChoice]);

  if (loadingData && !dataError) {
    return <LoadingOverlay message="Loading league registration..." />;
  }

  const canSubmit = !isSubmitting && !loadingData && !Boolean(dataError) && !registrationClosed;
  const typeEntry = registrationTypeCopy[formData.registrationType];

  return (
    <div className="min-h-screen bg-brand-black text-white pt-20 sm:pt-24 pb-12 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">

        {dataError && (
          <div className="bg-red-900/40 border border-red-500/60 text-red-100 rounded-2xl p-5 space-y-2">
            <p className="font-bold">{dataError}</p>
            <p className="text-sm text-red-100/70">Try again in a few moments or message us on Instagram.</p>
            <button
              type="button"
              onClick={fetchLeagueDetails}
              className="text-sm font-bold uppercase tracking-wider text-brand-lime"
            >
              Retry
            </button>
          </div>
        )}

        {step === 'form' && !dataError && !registrationSnapshot && resumeCandidate && (
          <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 sm:p-8 space-y-4">
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.35em] text-brand-grey font-bold">Saved Progress</div>
              <div className="text-white font-sports text-xl uppercase tracking-wide">Resume your last registration?</div>
              <div className="text-sm text-gray-300">
                We found an in-progress registration for{' '}
                <span className="text-white font-semibold">
                  {resumeCandidate.firstName} {resumeCandidate.lastName}
                </span>{' '}
                ({resumeCandidate.email}).
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  const candidate = resumeCandidate;
                  if (!candidate) return;
                  const savedChoice = resumeCandidateChoice;
                  setRegistrationSnapshot(candidate);
                  setResumeCandidate(null);
                  setResumeCandidateChoice(null);
                  setStep('payment');
                  setSubmissionError(null);
                  setSubmissionInfo(null);
                  setPaymentFinalizeError(null);
                  setIsFinalizingPayment(false);
                  setWaitingForStripe(false);
                  setPaymentConfirmed(false);
                  setPaymentMessage(defaultPaymentMessage);
                  setPortalEmailError(null);
                  setIsSendingPortalEmail(false);
                  portalEmailSentRef.current = false;
                  paymentEmailSentRef.current = false;

                  if (savedChoice) {
                    setPaymentChoice(savedChoice);
                    savePaymentChoice(savedChoice);
                    if (savedChoice === 'deposit' || savedChoice === 'full') {
                      setStripeCheckoutLink(
                        getStripePaymentLink(stripeLinks, savedChoice, candidate.registrationType) || null
                      );
                    } else {
                      setStripeCheckoutLink(null);
                    }
                  } else {
                    setPaymentChoice(null);
                    savePaymentChoice(null);
                    setStripeCheckoutLink(null);
                  }
                }}
                className="w-full rounded-full bg-brand-lime py-4 text-sm uppercase tracking-wide text-black font-sports font-bold transition hover:brightness-110"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={() => {
                  clearSavedProgress();
                  setResumeCandidate(null);
                  setResumeCandidateChoice(null);
                }}
                className="w-full rounded-full border border-white/20 bg-black/40 px-4 py-3 text-sm font-semibold text-gray-200 hover:border-brand-lime"
              >
                Start New
              </button>
            </div>
          </div>
        )}

        {step === 'form' && (
          <form
            onSubmit={handleSubmit}
            className="bg-brand-dark border border-white/10 rounded-2xl"
          >
            <div className="p-6 sm:p-8 space-y-6">
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase text-brand-grey">Step 1</p>
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <h2 className="font-sports text-3xl text-white uppercase">Registration Details</h2>
                  <span className="text-xs uppercase tracking-wide text-brand-lime font-bold">{typeEntry.label}</span>
                </div>
                <p className="text-sm text-gray-400 leading-relaxed">{typeEntry.description}</p>
              </div>

                <div className="space-y-5">
                {registrationClosed && (
                  <div className="bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-gray-300">
                    Registration is currently closed. Please check back later or contact the commissioner.
                  </div>
                )}
                <div className="grid gap-3 md:grid-cols-[200px,1fr] items-start">
                  <label className="text-xs font-bold uppercase text-brand-grey">Registration Type</label>
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(registrationTypeCopy).map(([key, config]) => {
                      const isActive = formData.registrationType === key;
                      const keyTyped = key as LeagueRegistrationType;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setFormData((prev) => ({ ...prev, registrationType: keyTyped }))}
                          className={`px-5 py-3 rounded-full border uppercase text-xs tracking-wide font-bold transition ${
                            isActive
                              ? 'border-brand-lime bg-brand-lime/10 text-brand-lime'
                              : 'border-white/30 text-white hover:border-white/60'
                          }`}
                          >
                          {config.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-brand-grey">Registration Season</label>
                    <div className="relative mt-2">
                      <select
                        name="seasonId"
                        value={formData.seasonId}
                        onChange={(event) => setFormData((prev) => ({ ...prev, seasonId: event.target.value }))}
                        className="w-full appearance-none bg-black border border-white/20 rounded-2xl px-4 pr-12 py-3 text-white focus:border-brand-lime focus:outline-none"
                        disabled={!availableSeasons.length}
                      >
                        {!availableSeasons.length && (
                          <option value="">{loadingData ? 'Loading seasons...' : 'No open registration seasons'}</option>
                        )}
                        <option value="" disabled>
                          Select a season
                        </option>
                        {sortSeasonsNewestFirst(availableSeasons).map((season) => (
                          <option key={season.id} value={season.id}>
                            {formatSeasonLabel(season)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={16}
                        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-brand-grey">Registration Division</label>
                    <div className="relative mt-2">
                      <select
                        name="divisionId"
                        value={formData.divisionId}
                        onChange={(event) => setFormData((prev) => ({ ...prev, divisionId: event.target.value }))}
                        className="w-full appearance-none bg-black border border-white/20 rounded-2xl px-4 pr-12 py-3 text-white focus:border-brand-lime focus:outline-none"
                        disabled={!seasonDivisions.length}
                      >
                        {!seasonDivisions.length && <option value="">No divisions available</option>}
                        <option value="" disabled>
                          Select a division
                        </option>
                        {seasonDivisions.map((division) => (
                          <option key={division.id} value={division.id}>
                            {division.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={16}
                        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-brand-grey">Name</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                    readOnly={lockedIdentityFields.name}
                    className={`mt-2 w-full bg-black border border-white/20 rounded-2xl px-4 py-3 text-white focus:border-brand-lime focus:outline-none ${
                      lockedIdentityFields.name ? 'opacity-70 cursor-not-allowed' : ''
                    }`}
                    placeholder="Alexa Torres"
                  />
                  {/* <p className="text-xs text-gray-500">For CRM and email personalization only.</p> */}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-brand-grey">Email</label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={(event) => setFormData((prev) => ({ ...prev, email: event.target.value }))}
                      readOnly={lockedIdentityFields.email}
                      className={`mt-2 w-full bg-black border border-white/20 rounded-2xl px-4 py-3 text-white focus:border-brand-lime focus:outline-none ${
                        lockedIdentityFields.email ? 'opacity-70 cursor-not-allowed' : ''
                      }`}
                      placeholder="you@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-brand-grey">Phone</label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={(event) => setFormData((prev) => ({ ...prev, phone: event.target.value }))}
                      readOnly={lockedIdentityFields.phone}
                      className={`mt-2 w-full bg-black border border-white/20 rounded-2xl px-4 py-3 text-white focus:border-brand-lime focus:outline-none ${
                        lockedIdentityFields.phone ? 'opacity-70 cursor-not-allowed' : ''
                      }`}
                      placeholder="555 123-4567"
                    />
                  </div>
                </div>
                {(lockedIdentityFields.name || lockedIdentityFields.email || lockedIdentityFields.phone) && (
                  <p className="text-xs text-gray-500">
                    Account details were prefilled from your logged-in profile and are locked.
                  </p>
                )}

                {formData.registrationType === 'team' && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-brand-grey">Team Name</label>
                    <input
                      type="text"
                      name="teamName"
                      value={formData.teamName}
                      onChange={(event) => setFormData((prev) => ({ ...prev, teamName: event.target.value }))}
                      className="mt-2 w-full bg-black border border-white/20 rounded-2xl px-4 py-3 text-white focus:border-brand-lime focus:outline-none"
                      placeholder="Example: Courtsight Legends"
                    />
                    <p className="text-xs text-gray-500">This appears on the roster and payment confirmation.</p>
                  </div>
                )}

              </div>

              {submissionError && <p className="text-sm text-red-400">{submissionError}</p>}
              {submissionInfo && <p className="text-sm text-amber-300">{submissionInfo}</p>}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full rounded-full bg-brand-red py-4 text-sm uppercase tracking-wide text-white font-sports font-bold transition hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Saving...' : 'Complete Registration'}
              </button>
            </div>
          </form>
        )}

        {step !== 'payment' && (
          <section className="bg-brand-dark border border-white/10 rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3 text-xs font-bold uppercase text-brand-grey">
            <Shield size={18} /> League Registration
          </div>
          <div className="space-y-4">
            {seasonStartCallout && (
              <div className="text-[11px] uppercase tracking-[0.3em] text-brand-lime font-bold">
                {seasonStartCallout}
              </div>
            )}
            <h1 className="font-sports text-3xl sm:text-4xl text-white uppercase tracking-wide">
              JOIN THE LEAGUE IN 30 SECONDS
            </h1>
            <div className="bg-black/40 border border-white/10 rounded-2xl p-5">
              <div className="text-xs font-bold uppercase tracking-widest text-brand-red">
                HOW IT WORKS:
              </div>
              <ol className="mt-4 space-y-3 text-sm text-gray-200 list-decimal pl-5">
                <li>
                  <span className="font-bold text-white">Register (30 seconds):</span> Fill out the form below — that's it.
                </li>
                <li>
                  <span className="font-bold text-white">Lock in your spot:</span> Pay a $50 deposit to secure your place. This goes toward your season fee, not an extra cost.
                </li>
                <li>
                  <span className="font-bold text-white">Complete payment:</span> We'll email you a link to finish up your registration fee.
                </li>
                <li>
                  <span className="font-bold text-white">Get connected:</span> Sign up for the CSL Stats Portal and invite your team.
                </li>
              </ol>
              <div className="mt-4 space-y-2 text-sm text-gray-200">
                <p>
                  <span className="font-bold text-brand-red">Team Captains:</span> Once your deposit is paid, a CSL rep
                  will personally onboard you and make coordinating with your team seamless.
                </p>
                <p>
                  <span className="font-bold text-brand-red">Free Agents:</span> No team? No problem. After your
                  deposit, we'll match you with a squad that fits your vibe.
                </p>
              </div>
            </div>
          </div>
          </section>
        )}

        {step === 'payment' && registrationSnapshot && (
          <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase text-brand-grey">Step 2</p>
              <h2 className="font-sports text-2xl sm:text-3xl text-white uppercase">Payment</h2>
              <p className="text-xs font-bold uppercase text-brand-grey">Stripe / Apple Pay / Google Pay</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/5 bg-black/40 px-5 py-5 space-y-1">
                <p className="text-xs font-bold uppercase text-brand-grey">Name</p>
                <p className="text-white font-semibold">
                  {registrationSnapshot.firstName} {registrationSnapshot.lastName}
                </p>
                <p className="text-xs text-gray-400">{registrationSnapshot.email}</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-black/40 px-5 py-5 space-y-1">
                <p className="text-xs font-bold uppercase text-brand-grey">Registration</p>
                <p className="text-white font-semibold">
                  {registrationSnapshot.registrationType === 'team' ? 'Team' : 'Free agent'}
                </p>
                <p className="text-xs text-gray-400">{registrationSnapshot.teamName || seasonLabel}</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-black/40 px-5 py-5">
                <p className="text-xs font-bold uppercase text-brand-grey">Season</p>
                <p className="text-white font-semibold">{registrationSnapshot.seasonLabel}</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-black/40 px-5 py-5">
                <p className="text-xs font-bold uppercase text-brand-grey">Division</p>
                <p className="text-white font-semibold">{registrationSnapshot.divisionLabel}</p>
              </div>
            </div>

            <div className="space-y-4">
              {paymentOptions.map((option) => {
                const isSelected = paymentChoice === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => handlePaymentChoice(option.key)}
                    disabled={waitingForStripe}
                    className={`w-full rounded-xl border px-5 py-5 text-left transition ${
                      isSelected
                        ? 'border-brand-lime bg-brand-lime/10'
                        : 'border-white/10 bg-black/40 hover:border-brand-lime'
                    } ${waitingForStripe ? 'opacity-60 cursor-not-allowed hover:border-white/10' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-sports uppercase tracking-wider">
                        {option.title}
                      </span>
                      <CreditCard className="text-brand-lime" />
                    </div>
                    <p className="mt-2 text-sm text-gray-400">{option.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="text-sm text-gray-300 space-y-2">
              {paymentMessage && (
                <div
                  className={`rounded-xl border px-4 py-3 text-sm ${
                    paymentMessage.toUpperCase().includes('PAYMENT SUCCESSFUL')
                      ? 'border-brand-lime/40 bg-brand-lime/10 text-brand-lime'
                      : paymentMessage.toUpperCase().includes('PAYMENT CANCELED')
                      ? 'border-brand-red/40 bg-red-900/20 text-red-100'
                      : 'border-white/10 bg-black/40 text-gray-200'
                  }`}
                >
                  {paymentMessage}
                </div>
              )}
              <p>
                After confirming payment (or selecting Pay Later), you will continue to Step 3 to complete your detailed{' '}
                <span className="text-brand-lime">Stats Portal Registration</span>.
              </p>
            </div>

            {(paymentChoice === 'deposit' || paymentChoice === 'full') && (
              <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-4">
                {stripeCheckoutLink && (
                  <button
                    type="button"
                    onClick={openStripeCheckout}
                    disabled={waitingForStripe}
                    className="inline-flex w-full items-center justify-center rounded-full border border-white/20 bg-black/40 px-4 py-3 text-xs font-bold uppercase tracking-wide text-white hover:border-brand-lime"
                  >
                    Open Stripe Checkout (new tab)
                  </button>
                )}
                <label className="flex items-start gap-3 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={paymentConfirmed}
                    onChange={(e) => setPaymentConfirmed(e.target.checked)}
                    disabled={waitingForStripe}
                    className="mt-1 h-4 w-4 accent-brand-lime"
                  />
                  <span>
                    <span className="text-xs font-bold uppercase tracking-wider text-white">Confirm payment</span>
                    <br />
                    I completed checkout in Stripe and want to continue to Step 3.
                  </span>
                </label>

                {paymentFinalizeError && (
                  <div className="rounded-xl border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                    {paymentFinalizeError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => finalizePaymentAndContinue(paymentChoice)}
                  disabled={!paymentConfirmed || isFinalizingPayment || waitingForStripe}
                  className="w-full rounded-full bg-brand-lime py-4 text-sm uppercase tracking-wide text-black font-sports font-bold transition hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isFinalizingPayment ? 'Processing...' : 'Continue to Step 3'}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setStep('form');
                setPaymentChoice(null);
                setPaymentMessage(defaultPaymentMessage);
                setPaymentConfirmed(false);
                setWaitingForStripe(false);
                setPaymentFinalizeError(null);
                setIsFinalizingPayment(false);
                setPortalEmailError(null);
                setIsSendingPortalEmail(false);
                portalEmailSentRef.current = false;
                clearSavedProgress();
              }}
              className="w-full rounded-full border border-white/20 px-4 py-3 text-center text-sm uppercase tracking-wide text-gray-300"
            >
              Edit registration information
            </button>
          </div>
        )}

        {step === 'portal' && registrationSnapshot && (
          <div className="bg-brand-dark border border-white/10 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase text-brand-grey">Step 3</p>
              {paymentChoice === 'deposit' ? (
                <>
                  <h2 className="font-sports text-2xl sm:text-3xl text-white">Your Registration is Confirmed!</h2>
                  <div className="text-sm text-gray-300 space-y-3">
                    <p>Thank you for confirming your registration by paying a deposit!</p>
                    <p>
                      Following this registration, you will receive an email to join the CSL Stats Portal. Here you will
                      have access to the CSL online social experience: Advanced Player &amp; Team Stats, Social Box
                      Scores, as well as the ability to share your stats on social media.
                    </p>
                    <p>
                      Please note, in order to be eligible to take the floor, all payments must be received at least 2
                      weeks prior to the start of the season.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="font-sports text-2xl sm:text-3xl text-white uppercase">Registration Confirmation</h2>
                  <p className="text-sm text-gray-400">
                    {leadSaved === false
                      ? "Your registration details were received, but they're not visible in Admin Player Management until the registrations table is installed."
                      : "Your registration details were received. Next, we'll send you the Stats Portal Registration link so you can complete your profile."}
                  </p>
                </>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/40 p-5 text-sm text-gray-300 space-y-2">
              <p>
                <span className="text-gray-500 uppercase tracking-wide text-xs">Payment Choice</span>
              </p>
              <p className="text-white font-semibold">
                {paymentChoice ? paymentChoiceLabel(paymentChoice) : 'Not selected'}
              </p>
              <p>
                <span className="text-gray-500 uppercase tracking-wide text-xs">Profile</span>
              </p>
              <p className="text-white">
                {registrationSnapshot.firstName} {registrationSnapshot.lastName} ({registrationSnapshot.email})
              </p>
              <p>
                <span className="text-gray-500 uppercase tracking-wide text-xs">CSL Updates</span>
              </p>
              <p className="text-white font-semibold">
                {registrationSnapshot.receiveUpdates ? 'Opted in' : 'Not subscribed'}
              </p>
            </div>

            {paymentChoice === 'later' && (
              <div className="rounded-xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {leadSaved === false
                  ? "Your registration details were received, but they weren't saved to the admin registrations table yet."
                  : 'Your registration is saved, but your spot is not confirmed until the deposit is paid.'}
                {getStripePaymentLink(stripeLinks, 'deposit', registrationSnapshot.registrationType) ? (
                  <div className="mt-3">
                    <a
                      href={getStripePaymentLink(stripeLinks, 'deposit', registrationSnapshot.registrationType)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-full items-center justify-center rounded-full bg-black/40 border border-white/20 px-4 py-3 text-xs font-bold uppercase tracking-wide text-white hover:border-brand-lime"
                    >
                      Pay Deposit (new tab)
                    </a>
                  </div>
                ) : null}
              </div>
            )}

            {/* Deposit-confirmed copy above replaces the old "Deposit received..." callout. */}

            {submissionInfo && (
              <div className="rounded-xl border border-brand-lime/40 bg-brand-lime/10 px-4 py-3 text-sm text-brand-lime">
                {submissionInfo}
              </div>
            )}

            {leadSaved === false && leadSaveError && (
              <div className="rounded-xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                Admin note: lead save failed: <span className="font-mono">{leadSaveError}</span>
              </div>
            )}

            {paymentChoice === 'deposit' ? (
              <>
                {isSendingPortalEmail && (
                  <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-gray-200">
                    Sending Stats Portal email...
                  </div>
                )}

                {portalEmailError && (
                  <div className="rounded-xl border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                    {portalEmailError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    clearSavedProgress();
                    navigate('/');
                  }}
                  className="w-full rounded-full bg-brand-lime py-4 text-sm uppercase tracking-wide text-black font-sports font-bold transition hover:brightness-110"
                >
                  DONE
                </button>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <a
                    href={stripeLinks.individualFull}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full items-center justify-center rounded-full border border-white/20 bg-black/40 px-4 py-3 text-center text-sm font-semibold text-gray-200 hover:border-brand-lime"
                  >
                    Complete Free Agent Payment
                  </a>
                  <a
                    href={stripeLinks.teamFull}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full items-center justify-center rounded-full border border-white/20 bg-black/40 px-4 py-3 text-center text-sm font-semibold text-gray-200 hover:border-brand-lime"
                  >
                    Complete Team Payment
                  </a>
                </div>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void sendStatsPortalEmailAndGoToLiveSite({ force: true, redirectAfterSend: true })}
                  disabled={isSendingPortalEmail}
                  className="w-full rounded-full bg-brand-lime py-4 text-sm uppercase tracking-wide text-black font-sports font-bold transition hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSendingPortalEmail
                    ? 'Sending email...'
                    : portalEmailSentRef.current
                    ? 'Resend Stats Portal Link'
                    : 'Email Me The Stats Portal Link'}
                </button>

                {portalEmailError && (
                  <div className="rounded-xl border border-red-500/40 bg-red-900/20 px-4 py-3 text-sm text-red-100">
                    {portalEmailError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setStep('payment')}
                    className="w-full rounded-full border border-white/20 px-4 py-3 text-center text-xs uppercase text-gray-300"
                  >
                    Back to payment
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep('form');
                      setPaymentChoice(null);
                      setPaymentMessage(defaultPaymentMessage);
                      setWaitingForStripe(false);
                      setPortalEmailError(null);
                      setIsSendingPortalEmail(false);
                      portalEmailSentRef.current = false;
                    }}
                    className="w-full rounded-full border border-white/20 px-4 py-3 text-center text-xs uppercase text-gray-300"
                  >
                    Edit league form
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {step === 'payment' && waitingForStripe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 py-6">
          <div className="w-full max-w-md rounded-3xl border border-white/15 bg-black/95 shadow-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-white/10">
              <div className="text-[11px] uppercase tracking-[0.35em] text-brand-grey font-bold">
                Payment Pending
              </div>
              <div className="mt-2 text-white font-sports text-xl uppercase tracking-wide">
                Waiting For Stripe
              </div>
              <div className="mt-2 text-sm text-gray-300">
                Complete checkout in the Stripe tab/window. When payment succeeds, this page will auto-continue to Step 3
                if Stripe redirects back to Courtsight.
              </div>
            </div>
            <div className="px-6 py-5 space-y-3">
              {stripeCheckoutLink && (
                <button
                  type="button"
                  onClick={openStripeCheckout}
                  className="w-full rounded-full bg-black/40 border border-white/20 px-4 py-3 text-xs font-bold uppercase tracking-wide text-white hover:border-brand-lime"
                >
                  Open Stripe Checkout
                </button>
              )}
              <div className="text-[11px] text-gray-500">
                If you return here and it did not auto-continue, confirm payment using the checkbox and continue button.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeagueRegistration;
