import { supabase } from './supabaseClient';

export type RegistrationEmailStage =
  | 'registration_paid_full'
  | 'registration_deposit_paid'
  | 'registration_pay_later'
  | 'stats_portal_registration'
  | 'claim_profile_invite';

export type RegistrationEmailTemplate = {
  subject: string;
  body: string;
  bodyHtml?: string;
};

type TemplateDefinition = {
  label: string;
  description: string;
  subjectKey: string;
  bodyKey: string;
  defaultSubject: string;
  defaultBody: string;
};

export const REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS: Record<
  RegistrationEmailStage,
  TemplateDefinition
> = {
  registration_paid_full: {
    label: 'Registration (Paid Fully)',
    description: 'Sent after a player pays the full amount (or confirms full payment) during registration.',
    subjectKey: 'email_template_registration_paid_full_subject',
    bodyKey: 'email_template_registration_paid_full_body',
    defaultSubject: 'Registration received (paid in full): {{fullName}}',
    defaultBody:
      'Thanks for registering for Courtsight League.\n\nName: {{fullName}}\nEmail: {{email}}\nPhone: {{phone}}\nRegistration type: {{registrationType}}\nTeam: {{teamName}}\nSeason: {{season}}\nDivision: {{division}}\nPayment: {{paymentChoice}}\n\nNext step: complete your Stats Portal registration here: {{portalLink}}',
  },
  registration_deposit_paid: {
    label: 'Registration (Deposit Paid)',
    description: 'Sent after a player pays the deposit (or confirms deposit payment) during registration.',
    subjectKey: 'email_template_registration_deposit_paid_subject',
    bodyKey: 'email_template_registration_deposit_paid_body',
    defaultSubject: 'Registration received (deposit paid): {{fullName}}',
    defaultBody:
      'Thanks for registering for Courtsight League.\n\nName: {{fullName}}\nEmail: {{email}}\nPhone: {{phone}}\nRegistration type: {{registrationType}}\nTeam: {{teamName}}\nSeason: {{season}}\nDivision: {{division}}\nPayment: {{paymentChoice}}\n\nNext step: complete your Stats Portal registration here: {{portalLink}}',
  },
  registration_pay_later: {
    label: 'Registration (Pay Later)',
    description: 'Sent after a player selects Pay Later during registration.',
    subjectKey: 'email_template_registration_pay_later_subject',
    bodyKey: 'email_template_registration_pay_later_body',
    defaultSubject: 'Registration received (pay later): {{fullName}}',
    defaultBody:
      'Thanks for registering for Courtsight League.\n\nName: {{fullName}}\nEmail: {{email}}\nPhone: {{phone}}\nRegistration type: {{registrationType}}\nTeam: {{teamName}}\nSeason: {{season}}\nDivision: {{division}}\nPayment: {{paymentChoice}}\n\nNext step: complete your Stats Portal registration here: {{portalLink}}',
  },
  stats_portal_registration: {
    label: 'Stats Portal Registration',
    description: 'Include your Stats Portal Registration link in this email.',
    subjectKey: 'email_template_stats_portal_registration_subject',
    bodyKey: 'email_template_stats_portal_registration_body',
    defaultSubject: 'Complete your Stats Portal Registration: {{fullName}}',
    defaultBody:
      'Final step: complete your Stats Portal Registration using the link below.\n\nStats Portal Registration link: {{portalLink}}\n\nName: {{fullName}}\nEmail: {{email}}\nRegistration type: {{registrationType}}\nTeam: {{teamName}}\nSeason: {{season}}\nDivision: {{division}}\n',
  },
  claim_profile_invite: {
    label: 'Claim Profile Invite',
    description: 'Sent when a captain or admin invites an unclaimed player to claim their profile.',
    subjectKey: 'email_template_claim_profile_invite_subject',
    bodyKey: 'email_template_claim_profile_invite_body',
    defaultSubject: 'Claim your Courtsight profile: {{fullName}}',
    defaultBody:
      'Hi {{fullName}},\n\nYou were added to {{teamName}} for {{season}}.\n\nClaim your Courtsight profile here:\n{{claimLink}}\n\nUse this link to set your password and access your player account.\n\nIf this was not you, please ignore this email or contact support.\n\nCourtsight League',
  },
};

const LEGACY_TEMPLATE_KEYS = [
  'email_template_league_registration_subject',
  'email_template_league_registration_body',
  'email_template_payment_subject',
  'email_template_payment_body',
];

// Keys that are editable in the Admin "Registration Email Templates" panel.
export const REGISTRATION_EMAIL_TEMPLATE_KEYS = Object.values(
  REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS
).flatMap((config) => [config.subjectKey, config.bodyKey]);

// For backwards compatibility: also load legacy keys so new templates can fall back.
export const REGISTRATION_EMAIL_TEMPLATE_KEYS_FOR_LOAD = Array.from(
  new Set([...REGISTRATION_EMAIL_TEMPLATE_KEYS, ...LEGACY_TEMPLATE_KEYS])
);

export const REGISTRATION_EMAIL_TEMPLATE_TOKENS = [
  'fullName',
  'firstName',
  'lastName',
  'email',
  'phone',
  'registrationType',
  'teamName',
  'teamId',
  'season',
  'seasonId',
  'division',
  'paymentChoice',
  'portalLink',
  'claimLink',
];

type TemplateMap = Record<RegistrationEmailStage, RegistrationEmailTemplate>;

const buildDefaultTemplates = (): TemplateMap => {
  return {
    registration_paid_full: {
      subject: REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.registration_paid_full.defaultSubject,
      body: REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.registration_paid_full.defaultBody,
    },
    registration_deposit_paid: {
      subject: REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.registration_deposit_paid.defaultSubject,
      body: REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.registration_deposit_paid.defaultBody,
    },
    registration_pay_later: {
      subject: REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.registration_pay_later.defaultSubject,
      body: REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.registration_pay_later.defaultBody,
    },
    stats_portal_registration: {
      subject:
        REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.stats_portal_registration
          .defaultSubject,
      body: REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.stats_portal_registration.defaultBody,
    },
    claim_profile_invite: {
      subject: REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.claim_profile_invite.defaultSubject,
      body: REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS.claim_profile_invite.defaultBody,
    },
  };
};

export const getDefaultRegistrationEmailTemplates = (): TemplateMap =>
  buildDefaultTemplates();

export const renderRegistrationTemplateString = (
  template: string,
  data: Record<string, string | number | boolean | null | undefined>
): string => {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, token) => {
    const value = data[token];
    if (value === null || value === undefined) return '';
    return String(value);
  });
};

const containsHtmlMarkup = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value || '');

// "Full" email templates (tables/layout HTML) should be preserved as-authored.
const isFullEmailHtml = (value: string) => /<(html|head|body|table|thead|tbody|tfoot|tr|td|th|img|style|meta|link)\b/i.test((value || '').trim());

// For simple rich-editor bodies, strip inline styles/classes that can leak dark UI background into emails.
const sanitizeBasicEmailHtml = (value: string): string => {
  const input = (value || '').trim();
  if (!input) return '';

  // Best-effort fallback when DOM APIs are unavailable.
  if (typeof window === 'undefined') {
    return input
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
      .replace(/\sstyle\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
      .replace(/\sclass\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
      .replace(/\sid\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');
  }

  const root = document.createElement('div');
  root.innerHTML = input;

  root.querySelectorAll('script,style,iframe,object,embed').forEach((node) => node.remove());

  const allowedTags = new Set([
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'a',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'div',
    'span',
  ]);

  root.querySelectorAll('*').forEach((node) => {
    const tag = node.tagName.toLowerCase();
    if (!allowedTags.has(tag)) {
      const parent = node.parentNode;
      if (parent) {
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
      }
      return;
    }

    // Remove styles/classes/ids and anything except safe anchor attrs.
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const val = attr.value || '';
      if (name.startsWith('on')) {
        node.removeAttribute(attr.name);
        return;
      }
      if (name === 'style' || name === 'class' || name === 'id') {
        node.removeAttribute(attr.name);
        return;
      }
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(val)) {
        node.removeAttribute(attr.name);
        return;
      }
      if (tag !== 'a') {
        node.removeAttribute(attr.name);
        return;
      }
      if (tag === 'a' && name !== 'href' && name !== 'target' && name !== 'rel') {
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

const htmlToText = (value: string): string => {
  if (!value) return '';
  if (!containsHtmlMarkup(value)) return value;
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

export const loadRegistrationEmailTemplates = async (): Promise<TemplateMap> => {
  const defaults = buildDefaultTemplates();
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('key,value')
      .in('key', REGISTRATION_EMAIL_TEMPLATE_KEYS_FOR_LOAD);
    if (error) throw error;

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

    (Object.keys(REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS) as RegistrationEmailStage[]).forEach(
      (stage) => {
        const definition = REGISTRATION_EMAIL_TEMPLATE_DEFINITIONS[stage];
        const customSubject = byKey.get(definition.subjectKey);
        const customBody = byKey.get(definition.bodyKey);

        const isRegistrationGroup = stage.startsWith('registration_');
        const fallbackSubject =
          isRegistrationGroup ? legacyPaymentSubject || legacyLeagueSubject : undefined;
        const fallbackBody =
          isRegistrationGroup ? legacyPaymentBody || legacyLeagueBody : undefined;

        const resolvedSubject = (customSubject && customSubject.trim()) ? customSubject : fallbackSubject;
        const resolvedBody = (customBody && customBody.trim()) ? customBody : fallbackBody;

        if (resolvedSubject && resolvedSubject.trim()) {
          defaults[stage].subject = resolvedSubject;
        }
        if (resolvedBody && resolvedBody.trim()) {
          defaults[stage].body = resolvedBody;
        }
      }
    );
  } catch (err) {
    console.warn('registration email templates lookup failed, using defaults', err);
  }
  return defaults;
};

export const renderRegistrationEmailTemplate = async (
  stage: RegistrationEmailStage,
  data: Record<string, string | number | boolean | null | undefined>
): Promise<RegistrationEmailTemplate> => {
  const templates = await loadRegistrationEmailTemplates();
  const selected = templates[stage];
  const renderedBody = renderRegistrationTemplateString(selected.body, data).trim();
  const bodyHasHtml = containsHtmlMarkup(renderedBody);
  const sanitizedBodyHtml =
    bodyHasHtml && !isFullEmailHtml(renderedBody) ? sanitizeBasicEmailHtml(renderedBody) : renderedBody;
  return {
    subject: renderRegistrationTemplateString(selected.subject, data).trim(),
    body: bodyHasHtml ? htmlToText(sanitizedBodyHtml) : renderedBody,
    bodyHtml: sanitizedBodyHtml,
  };
};
