import { sendClaimInviteEmail } from './playerClaimWorkflowService';
import { sendRegistrationStageEmail } from './registrationStageEmailService';
import { renderRegistrationEmailTemplate } from './registrationEmailTemplates';

export type PlayerClaimEmailOpts = {
  playerId?: string | null;
  email: string;
  playerName?: string | null;
  teamName: string;
  teamId?: string | null;
  teamCode?: string | null;
  seasonName?: string | null;
  inviteLink?: string | null;
  password?: string | null;
  createdBy?: string | null;
  deliveryMode?: 'claim' | 'portal_registration';
};

const isWorkflowUnavailableError = (error: unknown) => {
  const message = String((error as any)?.message || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('claim workflow service is unreachable') ||
    message.includes('edge function') ||
    message.includes('requested function was not found') ||
    message.includes('not deployed') ||
    message.includes('cors/preflight')
  );
};

const getConfiguredBaseUrl = () => {
  const configured =
    (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_SITE_URL as string | undefined)?.trim() ||
    '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (configured || origin).replace(/\/+$/, '');
};

export const buildPlayerPortalUrl = (teamId?: string | null, playerEmail?: string | null, teamCode?: string | null) => {
  const base = getConfiguredBaseUrl();
  const portalPath = base ? `${base}/portal/register` : '/portal/register';
  const params = new URLSearchParams();
  params.set('type', 'join');
  params.set('invite', '1');
  if (teamId) {
    params.set('team', teamId);
  }
  if (teamCode) {
    params.set('code', teamCode);
  }
  if (playerEmail) {
    params.set('email', playerEmail);
  }
  return `${portalPath}?${params.toString()}`;
};

const buildFallbackInviteLink = (opts: PlayerClaimEmailOpts) => {
  if (opts.inviteLink && opts.inviteLink.trim()) {
    return opts.inviteLink.trim();
  }
  const base = getConfiguredBaseUrl();
  const url = new URL(`${base || 'http://localhost:3000'}/portal/register`);
  url.searchParams.set('type', 'join');
  url.searchParams.set('invite', '1');
  url.searchParams.set('email', opts.email);
  if (opts.teamId) {
    url.searchParams.set('team', opts.teamId);
  }
  if (opts.teamCode) {
    url.searchParams.set('code', opts.teamCode);
  }
  return url.toString();
};

const sendFallbackInviteEmail = async (opts: PlayerClaimEmailOpts, originalError?: unknown) => {
  const teamLabel = (opts.teamName || 'your team').trim();
  const seasonLabel = (opts.seasonName || 'current season').trim();
  const playerLabel = (opts.playerName || 'Player').trim();
  const inviteLink = buildFallbackInviteLink(opts);
  const [firstName, ...restName] = playerLabel.split(/\s+/).filter(Boolean);
  const lastName = restName.join(' ');
  const rendered = await renderRegistrationEmailTemplate('claim_profile_invite', {
    fullName: playerLabel,
    firstName: firstName || '',
    lastName,
    email: opts.email,
    phone: '',
    registrationType: 'Claim Profile Invite',
    teamName: teamLabel,
    teamId: opts.teamId || '',
    season: seasonLabel,
    seasonId: '',
    division: '',
    paymentChoice: '',
    portalLink: inviteLink,
    claimLink: inviteLink,
  });

  await sendRegistrationStageEmail({
    stage: 'claim_profile_invite',
    subject: rendered.subject,
    body: rendered.body,
    bodyHtml: rendered.bodyHtml,
    recipientEmail: opts.email,
    includeAdminRecipients: false,
    metadata: {
      source: 'player-claim-fallback',
      playerId: opts.playerId || null,
      teamId: opts.teamId || null,
      teamCode: opts.teamCode || null,
      createdBy: opts.createdBy || null,
      originalError: String((originalError as any)?.message || ''),
    },
  });
};

export const sendPlayerClaimEmail = async (opts: PlayerClaimEmailOpts) => {
  if (opts.deliveryMode === 'portal_registration') {
    await sendFallbackInviteEmail(opts);
    return;
  }

  try {
    await sendClaimInviteEmail({
      playerId: opts.playerId || null,
      email: opts.email,
      playerName: opts.playerName || null,
      teamName: opts.teamName,
      seasonName: opts.seasonName || null,
      createdBy: opts.createdBy || null,
    });
  } catch (err: any) {
    if (!isWorkflowUnavailableError(err)) {
      throw err;
    }
    try {
      await sendFallbackInviteEmail(opts, err);
    } catch (fallbackErr: any) {
      const originalMessage = String(err?.message || 'Claim workflow request failed.');
      const fallbackMessage = String(fallbackErr?.message || 'Fallback email request failed.');
      throw new Error(`${originalMessage} Fallback failed: ${fallbackMessage}`);
    }
  }
};
