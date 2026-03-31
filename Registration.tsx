
import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Upload, X, Shield, Lock, Loader2, CreditCard, Calendar, CalendarClock, Wallet } from 'lucide-react';
import { signInWithGoogle, registerWithEmail, hydrateUserFromSupabase } from '../services/authService';
import { supabase } from '../services/supabaseClient';
import { createNotifications } from '../services/notificationService';
import { normalizeJerseyNumberInput } from '../utils/jerseyNumber';

type RegistrationType = 'create-team' | 'join-team' | 'individual';

const getAuthProvider = (user?: any) =>
  (user?.app_metadata?.provider || '').toString().toLowerCase();

const Registration: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const inviteTeamParam = searchParams.get('team');
  const lockRegType = !!inviteTeamParam;
  
  // Determine initial state from URL or default to individual
  const getInitialType = (): RegistrationType => {
    const type = searchParams.get('type');
    if (type === 'team') return 'create-team';
    if (type === 'join') return 'join-team';
    return 'individual';
  };

  const [regType, setRegType] = useState<RegistrationType>(getInitialType());
  const [step, setStep] = useState(1);
  
  // OAuth State
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [googleLinked, setGoogleLinked] = useState(false);

  // Sync state if URL param changes
  useEffect(() => {
    setRegType(getInitialType());
  }, [searchParams]);

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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadingDesigns, setUploadingDesigns] = useState(false);
  const [prefilledFromSession, setPrefilledFromSession] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [isCheckingRegistration, setIsCheckingRegistration] = useState(true);
  const [alreadyMemberNotice, setAlreadyMemberNotice] = useState<{
    message: string;
    redirectTo: string;
  } | null>(null);
  const [availableTeams, setAvailableTeams] = useState<{ id: string; label: string }[]>([]);
  const [activeSeasonName, setActiveSeasonName] = useState<string>('upcoming season');
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
    playerNumber: string | null;
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
  } | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [registrationResult, setRegistrationResult] = useState<{ teamId: string | null; playerId: string | null } | null>(null);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [waiverUrl, setWaiverUrl] = useState<string>('');
  const [showWaiverModal, setShowWaiverModal] = useState(false);
  const [waiverScrolled, setWaiverScrolled] = useState(false);
  const waiverScrollRef = useRef<HTMLDivElement | null>(null);
  const birthdateRef = useRef<HTMLInputElement | null>(null);
  const navigateIfAlreadyRegistered = async () => {
    try {
      // Allow join-team flow even if a player already exists, unless it's a captain invite link
      if (regType === 'join-team' && !inviteTeamParam) {
        setIsCheckingRegistration(false);
        return false;
      }

      const skip = sessionStorage.getItem('skipRegistrationRedirectOnce');
      if (skip) {
        sessionStorage.removeItem('skipRegistrationRedirectOnce');
        setIsCheckingRegistration(false);
        return;
      }

      const { data } = await supabase.auth.getUser();
      const authUser = data?.user;
      if (!authUser?.id) {
        return;
      }

      const seasonId = await getActiveSeasonId();
      if (!seasonId) return;

      if (inviteTeamParam) {
        const { data: playerRow } = await supabase
          .from('players')
          .select('id,team_id,is_captain')
          .eq('user_id', authUser.id)
          .eq('season_id', seasonId)
          .maybeSingle();
        if (playerRow?.team_id === inviteTeamParam) {
          const redirectTo = playerRow.is_captain ? '/manage-team' : '/my-team';
          setAlreadyMemberNotice({
            message: 'You are already on this team. Redirecting...',
            redirectTo,
          });
          window.setTimeout(() => {
            window.location.replace(redirectTo);
          }, 1400);
          return true;
        }
      }

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

  // Prefill from existing session (e.g., after returning from Google OAuth)
  useEffect(() => {
    const prefill = async () => {
      if (prefilledFromSession) return;
      try {
        const { data } = await supabase.auth.getUser();
        const authUser = data?.user;
        if (authUser?.email) {
          const provider = getAuthProvider(authUser);
          const meta = (authUser.user_metadata || {}) as any;
          const savedTeamName =
            sessionStorage.getItem('pendingTeamName') || localStorage.getItem('pendingTeamName') || '';
          const savedDivision =
            sessionStorage.getItem('pendingDivision') || localStorage.getItem('pendingDivision') || '';
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
          setFormData(prev => ({
            ...prev,
            ...(restoredDraft || {}),
            email: authUser.email || prev.email,
            fullName: meta.full_name || restoredDraft?.fullName || prev.fullName || authUser.email?.split('@')[0] || '',
            teamName: prev.teamName || savedTeamName || '',
            division: savedDivision || prev.division || 'D2',
            password: '',
            confirmPassword: '',
          }));
          sessionStorage.removeItem('pendingTeamName');
          localStorage.removeItem('pendingTeamName');
          sessionStorage.removeItem('pendingDivision');
          localStorage.removeItem('pendingDivision');
          sessionStorage.removeItem('pendingRegistrationForm');
          localStorage.removeItem('pendingRegistrationForm');
          sessionStorage.removeItem('pendingLogoRef');
          localStorage.removeItem('pendingLogoRef');
          sessionStorage.removeItem('pendingBannerRef');
          localStorage.removeItem('pendingBannerRef');
          if (restoredLogo) setSavedLogo(restoredLogo);
          if (restoredBanner) setSavedBanner(restoredBanner);
          setGoogleLinked(provider === 'google');
          setPrefilledFromSession(true);
        }
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
  }, [prefilledFromSession, navigateIfAlreadyRegistered]);

  // Payment status via query param (e.g., Stripe redirect)
  useEffect(() => {
    const status = searchParams.get('payment');
    let redirectTimer: number | undefined;
    if (status === 'success') {
      setPaymentMessage('Payment completed. Thank you!');
      (async () => {
        try {
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
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setLogoFile(e.target.files[0]);
    }
  };

  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setBannerFile(e.target.files[0]);
    }
  };

  const clearLogo = () => {
    setLogoFile(null);
    setSavedLogo(null);
  };

  const clearBanner = () => {
    setBannerFile(null);
    setSavedBanner(null);
  };

  async function getActiveSeasonId(): Promise<string | null> {
    const { data: current } = await supabase
      .from('seasons')
      .select('id')
      .eq('is_current', true)
      .maybeSingle();
    if (current?.id) return current.id;

    const { data: latest } = await supabase
      .from('seasons')
      .select('id')
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    return latest?.id || null;
  }

  const splitName = (value: string): [string, string] => {
    const parts = value.trim().split(/\s+/);
    if (parts.length === 0) return ['Player', 'Captain'];
    const first = parts.shift() || 'Player';
    const last = parts.join(' ') || 'Captain';
    return [first, last];
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

    return false;
  };

  const fetchAdminRecipients = async (): Promise<{ userId: string | null; role: string | null }[]> => {
    try {
      const { data, error } = await supabase
        .from('admin_users')
        .select('user_id,role');
      if (error) throw error;
      return (data || []).map((row: any) => ({
        userId: row.user_id ?? null,
        role: row.role ?? null,
      }));
    } catch (err) {
      console.warn('admin recipient lookup failed', err);
      return [];
    }
  };

  const getTeamCaptainUserId = async (teamId: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase
        .from('players')
        .select('user_id')
        .eq('team_id', teamId)
        .eq('is_captain', true)
        .maybeSingle();
      if (error) throw error;
      return data?.user_id ?? null;
    } catch (err) {
      console.warn('captain lookup failed', err);
      return null;
    }
  };

  const sendRegistrationNotifications = async (opts: {
    userId: string | null;
    regType: RegistrationType;
    teamId: string | null;
    teamName: string;
    seasonId: string;
    fullName: string;
  }) => {
    try {
      const adminRecipients = await fetchAdminRecipients();
      const notifications: any[] = [];

      const regLabel =
        opts.regType === 'create-team'
          ? 'Team Registration'
          : opts.regType === 'join-team'
          ? 'Join Team Registration'
          : 'Individual Registration';

      // Notify admins (role-based, with userId if available)
      adminRecipients.forEach((r) => {
        notifications.push({
          userId: r.userId ?? null,
          role: r.role ?? 'ADMIN_FULL',
          title: `${regLabel}`,
          body: `${opts.fullName} submitted a ${regLabel}${opts.teamName ? ` for ${opts.teamName}` : ''}.`,
          link: opts.regType === 'create-team' && opts.teamId ? `/admin?tab=teams&team=${opts.teamId}` : '/admin',
          metadata: {
            teamId: opts.teamId,
            seasonId: opts.seasonId,
            regType: opts.regType,
          },
        });
      });

      // Notify captain
      if (opts.teamId) {
        const captainId =
          opts.regType === 'create-team'
            ? opts.userId
            : await getTeamCaptainUserId(opts.teamId);
        if (captainId) {
          notifications.push({
            userId: captainId,
            role: null,
            teamId: opts.teamId,
            title: 'New Registration',
            body:
              opts.regType === 'create-team'
                ? `You created ${opts.teamName || 'your team'} for the new season.`
                : `${opts.fullName} registered for your team ${opts.teamName || ''}`.trim(),
            link: '/my-team',
            metadata: {
              teamId: opts.teamId,
              seasonId: opts.seasonId,
              regType: opts.regType,
            },
          });
        }
      }

      if (notifications.length) {
        await createNotifications(notifications);
      }
    } catch (err) {
      console.warn('send registration notifications failed', err);
    }
  };

  const uploadTeamMedia = async (teamId: string): Promise<{ logo?: string; banner?: string }> => {
    const uploaded: { logo?: string; banner?: string } = {};
    setUploadingDesigns(true);
    try {
      if (logoFile) {
        const safeName = logoFile.name.replace(/\s+/g, '-');
        const path = `teams/${teamId}/logo-${Date.now()}-${safeName}`;
        const { data, error } = await supabase.storage.from('team-assets').upload(path, logoFile, { upsert: true });
        if (error) throw error;
        if (data?.path) uploaded.logo = data.path;
      } else if (savedLogo?.path) {
        uploaded.logo = savedLogo.path;
      }

      if (bannerFile) {
        const safeName = bannerFile.name.replace(/\s+/g, '-');
        const path = `teams/${teamId}/banner-${Date.now()}-${safeName}`;
        const { data, error } = await supabase.storage.from('team-assets').upload(path, bannerFile, { upsert: true });
        if (error) throw error;
        if (data?.path) uploaded.banner = data.path;
      } else if (savedBanner?.path) {
        uploaded.banner = savedBanner.path;
      }
    } finally {
      setUploadingDesigns(false);
    }
    return uploaded;
  };
  const handleGoogleAuth = async () => {
    setIsAuthLoading(true);
    try {
      // Preserve intent so OAuth callback can return to registration
      const typeParam =
        regType === 'create-team' ? 'team' : regType === 'join-team' ? 'join' : 'individual';
      const redirectPath = `/register?type=${typeParam}`;
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
        sessionStorage.setItem('pendingDivision', formData.division || '');
        localStorage.setItem('pendingDivision', formData.division || '');
        sessionStorage.setItem('authFlow', 'register');
        localStorage.setItem('authFlow', 'register');
        sessionStorage.setItem('startedFromRegistration', 'true');
        localStorage.setItem('startedFromRegistration', 'true');
      } catch (storageErr) {
        console.warn('Redirect cache failed', storageErr);
      }

      // Pre-upload logo/banner so we don't serialize files in storage
      if (logoFile || bannerFile) {
        setUploadingDesigns(true);
        try {
          if (logoFile) {
            const safeName = logoFile.name.replace(/\s+/g, '-');
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
            const safeName = bannerFile.name.replace(/\s+/g, '-');
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

    if (!waiverAccepted) {
      setSubmitError('Please read and accept the CSL participation waiver before continuing.');
      return;
    }
    
    // Only validate password if not using Google Auth
    if (!googleLinked) {
      if (formData.password !== formData.confirmPassword) {
        alert("Passwords do not match. Please try again.");
        return;
      }
      if (formData.password.length < 8) {
        alert("Password must be at least 8 characters.");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const { data: preAuthUserData } = await supabase.auth.getUser();
      const existingUserId = preAuthUserData?.user?.id || null;
      const emailInUse = await isEmailAlreadyRegistered(formData.email, existingUserId);
      if (emailInUse) {
        if (!existingUserId) {
          const typeParam =
            regType === 'create-team' ? 'team' : regType === 'join-team' ? 'join' : 'individual';
          const teamParam = regType === 'join-team' ? formData.teamName : '';
          const redirectPath = `/register?type=${typeParam}${teamParam ? `&team=${teamParam}` : ''}`;
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
            sessionStorage.setItem('pendingDivision', formData.division || '');
            localStorage.setItem('pendingDivision', formData.division || '');
            sessionStorage.setItem('authFlow', 'register');
            localStorage.setItem('authFlow', 'register');
            sessionStorage.setItem('startedFromRegistration', 'true');
            localStorage.setItem('startedFromRegistration', 'true');
          } catch (storageErr) {
            console.warn('Login redirect cache failed', storageErr);
          }
          setSubmitError('This email is already registered. Please log in to continue.');
          setIsSubmitting(false);
          navigate('/login');
          return;
        }
        setSubmitError('This email is already registered. Please use that account to continue.');
        setIsSubmitting(false);
        return;
      }

      let signupUserId: string | null = null;
      if (!googleLinked) {
        const signupResult = await registerWithEmail(formData.email, formData.password, {
          fullName: formData.fullName,
        });
        signupUserId = signupResult.userId || null;
      }
      // Ensure we have a user session (from Google or email sign-up)
      await hydrateUserFromSupabase().catch(() => null);
      const { data: authUserData } = await supabase.auth.getUser();
      const authUser = authUserData?.user ?? null;
      const userId = authUser?.id || signupUserId || null;

      // Resolve season
      const seasonId = await getActiveSeasonId();
      if (!seasonId) {
        throw new Error('No active season found. Please contact the league admin to set a current season.');
      }

      const [firstName, lastName] = splitName(formData.fullName);
      const jerseyPreference = formData.playerNumber.split(',')[0]?.trim();
      const normalizedJerseyNumber = normalizeJerseyNumberInput(jerseyPreference);

      setPendingRegistration({
        userId,
        seasonId,
        regType,
        teamName: formData.teamName.trim(),
        division: formData.division,
        joinTeamId: regType === 'join-team' ? formData.teamName : null,
        fullName: formData.fullName.trim(),
        firstName: firstName || 'Player',
        lastName: lastName || '',
        playerNumber: normalizedJerseyNumber,
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
      });

      setRegistrationMeta({
        userId,
        regType,
        teamId: null,
        seasonId,
        fullName: formData.fullName.trim() || 'New Player',
        email: formData.email.trim(),
      });

      setStep(2); // Go to confirmation/payment step (actual DB insert after payment choice)
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
      case 'create-team': return 'Create My Own Team';
      case 'join-team': return 'Join Friends Team';
      case 'individual': return 'Individual Player Registration';
    }
  };

  const resetForm = () => {
    setStep(1);
  };

  // Load active-season teams for join-team dropdown
  // Load active-season info and teams for join-team dropdown
  useEffect(() => {
    const loadSeasonAndTeams = async () => {
      try {
        const { data: currentSeason } = await supabase
          .from('seasons')
          .select('id,name,is_current,start_date')
          .eq('is_current', true)
          .maybeSingle();
        const seasonId = currentSeason?.id || null;
        setActiveSeasonName(currentSeason?.name || 'upcoming season');
        if (!seasonId) {
          setAvailableTeams([]);
          setAvailableDivisions([]);
          return;
        }
        const [{ data: teams }, { data: divisionRows }] = await Promise.all([
          supabase
            .from('teams')
            .select('id,name,division')
            .eq('season_id', seasonId)
            .order('name', { ascending: true }),
          supabase
            .from('divisions')
            .select('name')
            .eq('season_id', seasonId)
            .order('name', { ascending: true }),
        ]);
        setAvailableTeams(
          (teams || []).map((t: any) => ({
            id: t.id,
            label: `${t.name}${t.division ? ` - ${t.division}` : ''}`,
          }))
        );
        const divisions: string[] = Array.from(
          new Set(
            [
              ...(divisionRows || []).map((row: any) => (row?.name || '').toString().trim()),
              ...(teams || []).map((t: any) => (t.division || '').toString().trim()),
            ].filter(Boolean)
          )
        );
        setAvailableDivisions(divisions);
      } catch {
        setAvailableTeams([]);
        setAvailableDivisions([]);
        setActiveSeasonName('upcoming season');
      }
    };
    loadSeasonAndTeams();
  }, []);

  // Preselect a team when arriving from an invite link
  useEffect(() => {
    const teamParam = searchParams.get('team');
    if (!teamParam) return;
    if (regType !== 'join-team') {
      setRegType('join-team');
    }
    if (availableTeams.some((t) => t.id === teamParam)) {
      setFormData((prev) => ({ ...prev, teamName: teamParam }));
    }
  }, [searchParams, availableTeams, regType]);

  // Load waiver public URL from storage
  useEffect(() => {
    const { data } = supabase.storage.from('public-assets').getPublicUrl('CSL-Participation-Waiver.pdf');
    if (data?.publicUrl) {
      setWaiverUrl(data.publicUrl);
    }
  }, []);

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
    } = pendingRegistration;
    const fallbackJerseyPreference = formData.playerNumber.split(',')[0]?.trim();
    const fallbackJerseyNumber = normalizeJerseyNumberInput(fallbackJerseyPreference);
    const resolvedPlayerNumber = playerNumber ?? fallbackJerseyNumber ?? null;
    const resolvedPosition = position || formData.playerPosition || '';
    const resolvedJerseySize = jerseySize || formData.jerseySize || '';
    const resolvedShortsSize = shortsSize || formData.shortsSize || '';
    const resolvedJerseyName = jerseyName || formData.jerseyName || '';
    const resolvedReferralSource = referralSource || formData.referralSource || '';
    const resolvedNbaComparison = nbaComparison || formData.nbaComparison || '';
    const resolvedInstagram = instagram || formData.instagram || '';
    const resolvedBirthDate = birthDate || formData.birthDate || '';
    const resolvedPhone = phone || formData.phone || '';
    if (!seasonId) throw new Error('No active season found. Please contact the league admin.');
    let resolvedTeamId: string | null = null;
    let playerId: string | null = null;
    const normalizedEmail = normalizeEmail(formData.email || '');

    try {
      const findExistingPlayer = async (opts?: { email?: string; teamId?: string | null }): Promise<string | null> => {
        if (!seasonId) return null;
        if (userId) {
          const { data, error } = await supabase
            .from('players')
            .select('id')
            .eq('user_id', userId)
            .eq('season_id', seasonId)
            .limit(1);
          if (!error && data?.[0]?.id) {
            return data[0].id;
          }
        }
        const emailLookup = opts?.email;
        if (emailLookup) {
          const query = supabase
            .from('players')
            .select('id')
            .eq('season_id', seasonId)
            .or(`email.eq.${emailLookup},email_address.eq.${emailLookup}`)
            .limit(1);
          if (opts?.teamId) {
            query.eq('team_id', opts.teamId);
          }
          const { data, error } = await query;
          if (!error && data?.[0]?.id) {
            return data[0].id;
          }
        }
        return null;
      };

      const savePlayer = async (payload: any, existingId: string | null): Promise<string | null> => {
        if (existingId) {
          const { error: updateErr } = await supabase
            .from('players')
            .update(payload)
            .eq('id', existingId);
          if (updateErr) {
            const msg = (updateErr.message || '').toLowerCase();
            if (msg.includes('is_captain')) {
              const { error: retryErr } = await supabase
                .from('players')
                .update({ ...payload, is_captain: undefined })
                .eq('id', existingId);
              if (retryErr) throw retryErr;
            } else {
              throw updateErr;
            }
          }
          return existingId;
        }

        const { data: newPlayer, error: insertErr } = await supabase
          .from('players')
          .insert(payload)
          .select('id')
          .maybeSingle();
        if (insertErr) {
          const msg = (insertErr.message || '').toLowerCase();
          if (msg.includes('is_captain')) {
            const { data: retryPlayer, error: retryErr } = await supabase
              .from('players')
              .insert({ ...payload, is_captain: undefined })
              .select('id')
              .maybeSingle();
            if (retryErr) throw retryErr;
            return retryPlayer?.id || null;
          }
          throw insertErr;
        }
        return newPlayer?.id || null;
      };

      if (regType === 'create-team') {
        // Create team
        let teamId: string | null = null;
        try {
          const { data: teamRow, error: teamErr } = await supabase
            .from('teams')
            .insert({
              name: teamName.trim(),
              season_id: seasonId,
              division: division,
            })
            .select('id')
            .single();
          if (teamErr || !teamRow?.id) throw teamErr || new Error('Unable to create team.');
          teamId = teamRow.id;
        } catch (teamErr: any) {
          const msg = (teamErr?.message || '').toLowerCase();
          if (msg.includes('division')) {
            const { data: teamRow, error: retryErr } = await supabase
              .from('teams')
              .insert({
                name: teamName.trim(),
                season_id: seasonId,
              })
              .select('id')
              .single();
            if (retryErr || !teamRow?.id) throw retryErr || teamErr;
            teamId = teamRow.id;
          } else {
            throw teamErr;
          }
        }

        resolvedTeamId = teamId;

        // Upload logo/banner (include any pre-uploaded ones)
        const media = await uploadTeamMedia(teamId!);
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

        const playerPayload: any = {
          season_id: seasonId,
          team_id: teamId,
          user_id: userId,
          first_name: firstName || 'Player',
          last_name: lastName || '',
          jersey_number: resolvedPlayerNumber ?? null,
          position: resolvedPosition || null,
          photo_url: null,
          is_captain: true,
          jersey_size: resolvedJerseySize || null,
          shorts_size: resolvedShortsSize || null,
          jersey_name: resolvedJerseyName || null,
          referral_source: resolvedReferralSource || null,
          nba_comparison: resolvedNbaComparison || null,
          instagram: resolvedInstagram || null,
          birth_date: resolvedBirthDate || null,
          phone: resolvedPhone || null,
        };
        const existingPlayerId = await findExistingPlayer({ email: normalizedEmail, teamId });
        playerId = await savePlayer(playerPayload, existingPlayerId);
      } else {
        // join-team or individual
        let teamId: string | null = null;
        if (regType === 'join-team') {
          if (!joinTeamId) {
            throw new Error('Please select a team.');
          }
          teamId = joinTeamId;
          resolvedTeamId = teamId;
        }
        const playerPayload: any = {
          season_id: seasonId,
          team_id: regType === 'individual' ? null : teamId,
          user_id: userId,
          first_name: firstName || 'Player',
          last_name: lastName || '',
          jersey_number: resolvedPlayerNumber ?? null,
          position: resolvedPosition || null,
          photo_url: null,
          jersey_size: resolvedJerseySize || null,
          shorts_size: resolvedShortsSize || null,
          jersey_name: resolvedJerseyName || null,
          referral_source: resolvedReferralSource || null,
          nba_comparison: resolvedNbaComparison || null,
          instagram: resolvedInstagram || null,
          birth_date: resolvedBirthDate || null,
          phone: resolvedPhone || null,
        };
        const existingPlayerId = await findExistingPlayer({
          email: normalizedEmail,
          teamId: regType === 'join-team' ? joinTeamId : null,
        });
        playerId = await savePlayer(playerPayload, existingPlayerId);
      }

      // Upsert profile details (phone/name/email)
      if (pendingRegistration.userId) {
        try {
          await supabase.from('profiles').upsert(
            {
              user_id: pendingRegistration.userId,
              phone: resolvedPhone || null,
              display_name: fullName || null,
              email: formData.email?.trim() || null,
              email_address: formData.email?.trim() || null,
            },
            { onConflict: 'user_id' }
          );
        } catch (err) {
          console.warn('Profile upsert failed', err);
        }
      }

      const result = { teamId: resolvedTeamId, playerId };
      setRegistrationResult(result);
      setRegistrationMeta((prev) => (prev ? { ...prev, teamId: resolvedTeamId } : prev));
      return result;
    } finally {
      setFinalizing(false);
    }
  };

  const handlePayment = async (method: 'full' | 'deposit' | 'later') => {
    // Optional Stripe payment links from env
    const paymentLinks = {
      full: import.meta.env.VITE_STRIPE_PAYMENT_LINK_FULL as string | undefined,
      deposit: import.meta.env.VITE_STRIPE_PAYMENT_LINK_DEPOSIT as string | undefined,
    };

    const notifyAdminsPayment = async (selection: string) => {
      if (!registrationMeta) return;
      const adminRecipients = await fetchAdminRecipients();
      const notifications = adminRecipients.map((r) => ({
        userId: r.userId ?? null,
        role: r.role ?? 'ADMIN_FULL',
        title: 'Registration Payment Update',
        body: `${registrationMeta.fullName} (${registrationMeta.email}) selected "${selection}" for ${registrationMeta.regType}${registrationMeta.teamId ? ` (team ${registrationMeta.teamId})` : ''}.`,
        link: '/admin',
        metadata: {
          regType: registrationMeta.regType,
          teamId: registrationMeta.teamId,
          seasonId: registrationMeta.seasonId,
          paymentChoice: selection,
        },
      }));
      if (notifications.length) {
        await createNotifications(notifications);
      }
    };

    if (method === 'later') {
      await completeRegistration();
      await notifyAdminsPayment('Pay Later');
      await setPaymentStatus('pending');
      setPaymentMessage('Registration saved. You can pay later or log in anytime.');
      return;
    }

    await completeRegistration();
    await notifyAdminsPayment(method === 'full' ? 'Stripe Full Payment' : 'Stripe Deposit');
    await setPaymentStatus('pending-stripe');

    const link = method === 'full' ? paymentLinks.full : paymentLinks.deposit;
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
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
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

        <div className="bg-brand-dark border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="bg-neutral-900 p-8 border-b border-white/5">
             <h1 className="font-sports text-3xl font-bold text-white uppercase mb-2">
               {step === 1 ? 'Registration' : 'Select Payment'}
             </h1>
             <p className="text-gray-400">
               {step === 1 ? `Join the league for the upcoming ${activeSeasonName}.` : 'Choose how you would like to complete your registration.'}
             </p>
          </div>

          {step === 1 ? (
            <div className="p-8">
              {/* Type Toggle */}
              <div className="flex flex-col md:flex-row bg-black p-1.5 rounded-xl mb-10 border border-white/10 gap-1">
                <button
                  onClick={() => !lockRegType && setRegType('create-team')}
                  disabled={lockRegType}
                  className={`flex-1 py-3 rounded-lg font-sports font-bold uppercase tracking-wider text-sm transition-all duration-300 ${regType === 'create-team' ? 'bg-brand-lime text-black shadow-lg' : 'text-gray-500 hover:text-white hover:bg-white/5'} ${lockRegType ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  Create My Own Team
                </button>
                <button
                  onClick={() => !lockRegType && setRegType('join-team')}
                  disabled={lockRegType}
                  className={`flex-1 py-3 rounded-lg font-sports font-bold uppercase tracking-wider text-sm transition-all duration-300 ${regType === 'join-team' ? 'bg-brand-lime text-black shadow-lg' : 'text-gray-500 hover:text-white hover:bg-white/5'} ${lockRegType ? 'opacity-40 cursor-not-allowed' : ''}`}
                  title={lockRegType ? 'Invite link locked' : undefined}
                >
                  Join Friends Team
                </button>
                <button
                  onClick={() => !lockRegType && setRegType('individual')}
                  disabled={lockRegType}
                  className={`flex-1 py-3 rounded-lg font-sports font-bold uppercase tracking-wider text-sm transition-all duration-300 ${regType === 'individual' ? 'bg-brand-lime text-black shadow-lg' : 'text-gray-500 hover:text-white hover:bg-white/5'} ${lockRegType ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  Join as Individual Player
                </button>
              </div>
              {lockRegType && (
                <div className="mb-6 text-xs text-brand-lime bg-brand-lime/10 border border-brand-lime/30 rounded px-3 py-2">
                  Invite link detected. Registration type is locked to Join Friends Team.
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-8">
                
                {/* --- CREATE TEAM SPECIFIC --- */}
                {regType === 'create-team' && (
                  <div className="bg-white/5 p-6 rounded-xl border border-white/10 animate-fadeIn">
                    <h3 className="font-sports text-xl text-brand-lime uppercase mb-4 flex items-center gap-2">
                      <Shield className="w-5 h-5" /> Team Details
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                      <div className="col-span-2 md:col-span-1">
                        <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Team Name <span className="text-brand-red">*</span></label>
                        <input type="text" required name="teamName" value={formData.teamName} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="e.g. The Monstars" />
                      </div>
                      <div className="col-span-2 md:col-span-1">
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
                  </div>
                )}

                {/* --- JOIN TEAM SPECIFIC --- */}
                {regType === 'join-team' && (
                  <div className="bg-white/5 p-6 rounded-xl border border-white/10 animate-fadeIn">
                    <h3 className="font-sports text-xl text-brand-lime uppercase mb-4 flex items-center gap-2">
                      <Shield className="w-5 h-5" /> Team Selection
                    </h3>
                    <div>
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Select Team <span className="text-brand-red">*</span></label>
                      <select
                        required
                        name="teamName"
                        value={formData.teamName}
                        onChange={handleChange}
                        className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors appearance-none"
                      >
                        <option value="">Choose a team</option>
                        {availableTeams.map((t) => (
                          <option key={t.id} value={t.id}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* --- ACCOUNT & PLAYER DETAILS (ALL TYPES) --- */}
                <div>
                  <h3 className="font-sports text-xl text-white uppercase mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-brand-red skew-x-[-12deg] inline-block"></span>
                    Account & Player Details
                  </h3>

                  <div className="bg-white/5 p-4 rounded-lg border border-white/10 mb-6 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setWaiverScrolled(false);
                          setShowWaiverModal(true);
                        }}
                        disabled={!waiverUrl}
                        className="px-4 py-2 rounded bg-black border border-white/20 text-white text-sm hover:border-brand-lime disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        Read CSL Participation Waiver (PDF)
                      </button>
                      <label className="flex items-center gap-2 text-sm text-gray-300">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-brand-lime"
                          checked={waiverAccepted}
                          onChange={(e) => setWaiverAccepted(e.target.checked)}
                          disabled={!waiverScrolled && !waiverAccepted}
                        />
                        I have read and agree to the CSL Participation Waiver.
                      </label>
                    </div>
                    {!waiverAccepted && (
                      <p className="text-xs text-brand-red">
                        Please read the waiver and scroll to the end to enable agreement.
                      </p>
                    )}
                  </div>
                  
                  {/* Google Sign Up Option */}
                  <div className="mb-8">
                    {!googleLinked ? (
                      <button 
                        type="button" 
                        onClick={handleGoogleAuth}
                        disabled={isAuthLoading}
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Email */}
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Email Address <span className="text-brand-red">*</span></label>
                      <input type="email" required name="email" value={formData.email} onChange={handleChange} readOnly={googleLinked} className={`w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700 ${googleLinked ? 'opacity-70 cursor-not-allowed' : ''}`} placeholder="you@example.com" />
                    </div>

                    {/* Password Fields - Only show if NOT Google Linked */}
                    {!googleLinked && (
                      <>
                        <div>
                            <label className="block text-xs font-bold text-brand-grey uppercase mb-2 flex items-center gap-1">
                                 Password <span className="text-brand-red">*</span>
                            </label>
                            <div className="relative">
                                <input type="password" required name="password" value={formData.password} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="Min 8 chars" />
                                <Lock className="absolute dropdown-icon-spacing right-3 top-1/2 transform -translate-y-1/2 text-gray-600 w-4 h-4" />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Confirm Password <span className="text-brand-red">*</span></label>
                            <div className="relative">
                                <input type="password" required name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="Re-enter password" />
                                <Lock className="absolute dropdown-icon-spacing right-3 top-1/2 transform -translate-y-1/2 text-gray-600 w-4 h-4" />
                            </div>
                        </div>
                      </>
                    )}

                    {/* Player Name */}
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Player Name <span className="text-brand-red">*</span></label>
                      <input type="text" required name="fullName" value={formData.fullName} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="Full Name" />
                    </div>

                    {/* Birthdate */}
                    <div>
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Birthdate <span className="text-brand-red">*</span></label>
                      <div className="relative">
                        <input
                          ref={birthdateRef}
                          type="date"
                          required
                          name="birthDate"
                          value={formData.birthDate}
                          onChange={handleChange}
                          onFocus={() => birthdateRef.current?.showPicker?.()}
                          onClick={() => birthdateRef.current?.showPicker?.()}
                          className="w-full bg-black border border-white/20 rounded px-4 py-3 pr-10 dropdown-select-spacing text-white focus:border-brand-lime focus:outline-none transition-colors appearance-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (birthdateRef.current) {
                              birthdateRef.current.showPicker?.();
                              birthdateRef.current.focus();
                            }
                          }}
                          className="absolute dropdown-icon-spacing right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                          aria-label="Open calendar"
                        >
                          <Calendar size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Phone */}
                    <div>
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Phone Number <span className="text-brand-red">*</span></label>
                      <input type="tel" required name="phone" value={formData.phone} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="(555) 123-4567" />
                    </div>

                    {/* Player Position */}
                    <div className="col-span-2">
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
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Jersey Number (Top 3 choices) <span className="text-brand-red">*</span></label>
                      <input type="text" required name="playerNumber" value={formData.playerNumber} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="e.g. 23, 11, 6" />
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

                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Name on Jersey <span className="text-brand-red">*</span></label>
                      <input type="text" required name="jerseyName" value={formData.jerseyName} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="Last Name / Nickname" />
                    </div>

                    {/* Referral */}
                    <div className="col-span-2">
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
                    <div className="col-span-2">
                       <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Which NBA player do you hoop like? <span className="text-brand-red">*</span></label>
                       <input type="text" required name="nbaComparison" value={formData.nbaComparison} onChange={handleChange} className="w-full bg-black border border-white/20 rounded px-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="e.g. Kyrie handles with Draymond shooting" />
                    </div>
                    
                    <div className="col-span-2">
                       <label className="block text-xs font-bold text-brand-grey uppercase mb-2">Instagram Handle</label>
                       <div className="relative">
                         <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-500">@</span>
                         <input type="text" name="instagram" value={formData.instagram} onChange={handleChange} className="w-full bg-black border border-white/20 rounded pl-8 pr-4 py-3 text-white focus:border-brand-lime focus:outline-none transition-colors placeholder-gray-700" placeholder="courtsight" />
                       </div>
                    </div>

                  </div>
                </div>
                
                <div className="pt-8 border-t border-white/10">
                  <button 
                    type="submit" 
                    disabled={isSubmitting || isAuthLoading}
                    className="w-full bg-brand-red hover:bg-red-600 disabled:hover:bg-brand-red text-white font-sports font-bold text-xl uppercase py-4 rounded transition-all transform hover:scale-[1.01] shadow-xl tracking-wider disabled:opacity-60 disabled:cursor-not-allowed">
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" /> {uploadingDesigns ? 'Uploading...' : 'Saving...'}
                      </span>
                    ) : (
                      'Lock-In Now'
                    )}
                  </button>
                  {submitError && (
                    <p className="text-brand-red text-sm mt-3 text-center">{submitError}</p>
                  )}
                  <p className="text-center text-brand-grey text-sm mt-4 flex items-center justify-center gap-2">
                    <span>{pricing.label}: ${pricing.full.toLocaleString()}</span>
                  </p>
                </div>
              </form>
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
                    <span className="text-xs text-gray-500">Winter 2025 Season</span>
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
                    <span className="text-white font-bold">{formData.teamName}</span>
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
                  <p className="text-sm text-gray-400 pl-[3.25rem]">Submit registration now. Coordinate Cash/Venmo payment with commissioner.</p>
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
