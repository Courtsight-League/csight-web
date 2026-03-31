
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { NewsItem } from '../types';
import { supabase } from '../services/supabaseClient';
import { ChevronDown, ChevronUp, ArrowRight, Quote, X } from 'lucide-react';
import {
  getDefaultHomeTestimonials,
  getTestimonialGlow,
  loadHomeTestimonials,
  type HomeTestimonial,
} from '../services/homeTestimonials';
import {
  getDefaultHomeFaqItems,
  loadHomeFaqItems,
  type HomeFaqItem,
} from '../services/homeFaq';

type NewsItemView = NewsItem & { rawDate?: string | null };

const DIVISION_OVERVIEW = [
  {
    id: 'd1',
    level: 'D1',
    name: 'Elite / Comp',
    label: 'Top Tier',
    summary: 'No training wheels. Just hoops.',
    details:
      "D1 is top tier. High pace, high skill, and zero wasted possessions. Everyone knows the system, makes the right reads, and competes every night. If you're here, you can hoop.",
    image:
      'https://vhpsqwpdfvsproqzmpjk.supabase.co/storage/v1/object/public/site-media/home/d1.jpg',
    accentText: 'text-brand-red',
    accentChip: 'border-brand-red/40 text-brand-red bg-brand-red/10',
    overlay: 'linear-gradient(120deg, rgba(9,9,9,0.9), rgba(9,9,9,0.4))',
  },
  {
    id: 'd2',
    level: 'D2',
    name: 'Rec / Inter',
    label: 'Mid Tier',
    summary: 'Built for the next step.',
    details:
      "D2 is where players level up fast. Tighter handle, smarter reads, better pace. You know the flow, you run the system, and you show up ready to compete every night.",
    image:
      'https://vhpsqwpdfvsproqzmpjk.supabase.co/storage/v1/object/public/site-media/home/d2.jpg',
    accentText: 'text-yellow-300',
    accentChip: 'border-yellow-400/40 text-yellow-200 bg-yellow-400/20',
    overlay: 'linear-gradient(120deg, rgba(6,6,6,0.8), rgba(6,6,6,0.35))',
  },
  {
    id: 'd3',
    level: 'D3',
    name: 'Rookie / Rec',
    label: 'Entry Tier',
    summary: 'Where the game begins and growth starts here.',
    details:
      'D3 is our entry tier for beginners and developing players. Learn the fundamentals, build confidence, and level up your game IQ in organized play. Open to all skill levels - beginners welcome.',
    image:
      'https://vhpsqwpdfvsproqzmpjk.supabase.co/storage/v1/object/public/site-media/home/d3.jpeg',
    accentText: 'text-emerald-300',
    accentChip: 'border-emerald-400/40 text-emerald-200 bg-emerald-500/20',
    overlay: 'linear-gradient(120deg, rgba(9,9,9,0.8), rgba(9,9,9,0.3))',
  },
];

const LEAGUE_FEATURES = [
      {
        id: 'skill-divisions',
        title: '3 Skill Divisions',
        image:
          'https://vhpsqwpdfvsproqzmpjk.supabase.co/storage/v1/object/public/site-media/home/3skilldivisions.jpg',
      },
      {
        id: 'media-coverage',
        title: 'Pro-Media Coverage',
        image:
          'https://vhpsqwpdfvsproqzmpjk.supabase.co/storage/v1/object/public/site-media/home/promediacoverage.jpg',
        imagePosition: 'center 20%',
        imageZoom: '100%',
      },
      {
        id: 'custom-uniforms',
        title: 'Design your own uniforms',
        image:
          'https://vhpsqwpdfvsproqzmpjk.supabase.co/storage/v1/object/public/site-media/home/designyourownuniforms.jpg',
        imagePosition: 'center 33%',
        imageZoom: '90%',
      },
  {
    id: 'advanced-stats',
    title: 'Advanced Team & Player Stats',
    image:
      'https://vhpsqwpdfvsproqzmpjk.supabase.co/storage/v1/object/public/site-media/home/advanced.png',
    imagePosition: 'center center',
    imageZoom: 'cover',
  },
  {
    id: 'livestream',
    title: 'HD Livestream Games',
    image:
      'https://vhpsqwpdfvsproqzmpjk.supabase.co/storage/v1/object/public/site-media/home/hdlivestreams.png',
  },
  {
    id: 'championship-rings',
    title: 'Championship Rings + TShirts',
    image:
      'https://vhpsqwpdfvsproqzmpjk.supabase.co/storage/v1/object/public/site-media/home/championshipringstshirts.jpg',
  },
];

const COUNTDOWN_FALLBACK_DAYS = 30;
const COUNTDOWN_STORAGE_KEY = 'courtsight_next_season_countdown_seen';
const DEFAULT_COUNTDOWN_IMAGE_URL =
  'https://images.unsplash.com/photo-1519861531473-9200262188bf?q=80&w=1400&auto=format&fit=crop';

const Home: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  const [news, setNews] = useState<NewsItemView[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [seasonTagline, setSeasonTagline] = useState('Season starts soon');
  const [activeNews, setActiveNews] = useState<NewsItemView | null>(null);
  const [activeNewsIndex, setActiveNewsIndex] = useState(0);
  const [autoAdvanceKey, setAutoAdvanceKey] = useState(0);
  const [timeLeftMs, setTimeLeftMs] = useState(0);
  const [countdownTargetMs, setCountdownTargetMs] = useState<number | null>(null);
  const [countdownLabel, setCountdownLabel] = useState('Next Season');
  const [countdownDeadlineLabel, setCountdownDeadlineLabel] = useState('Registration deadline');
  const [countdownStartLabel, setCountdownStartLabel] = useState('TBD');
  const [nextSeasonStartLabel, setNextSeasonStartLabel] = useState('TBD');
  const [hasFlashNews, setHasFlashNews] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const [countdownLoaded, setCountdownLoaded] = useState(false);
  const [countdownImageUrl, setCountdownImageUrl] = useState(DEFAULT_COUNTDOWN_IMAGE_URL);
  const [testimonials, setTestimonials] = useState<HomeTestimonial[]>(getDefaultHomeTestimonials());
  const [faqItems, setFaqItems] = useState<HomeFaqItem[]>(getDefaultHomeFaqItems());
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const toggleFaq = (id: string) => {
    setOpenFaq(openFaq === id ? null : id);
  };

  useEffect(() => {
    const formatDisplayDate = (raw?: string | null) => {
      if (!raw) return 'TBD';
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return raw;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const mapRowToNews = (row: any): NewsItemView => {
      const displayDate = row.date || row.published_at || row.created_at || row.createdAt || null;
      const badgeDate = row.published_at || row.created_at || row.createdAt || row.date || null;
      return {
        id: row.id?.toString() || `news_${Date.now()}`,
        title: row.title || 'Untitled',
        summary: row.summary || row.content || '',
        imageUrl: row.image_url || row.imageUrl || 'https://via.placeholder.com/400',
        date: formatDisplayDate(displayDate),
        rawDate: badgeDate,
      };
    };

    const newsBucket = (import.meta.env.VITE_SUPABASE_NEWS_BUCKET as string) || 'news-assets';

    const normalizeStoragePath = (p?: string | null) => {
      if (!p) return '';
      const marker = `${newsBucket}/`;
      if (p.includes(marker)) return p.slice(p.indexOf(marker) + marker.length);
      const match = p.match(/\/object\/public\/[^/]+\/(.+)$/);
      if (match?.[1]) return match[1];
      return p;
    };

    const signImageUrl = async (path?: string | null) => {
      if (!path) return '';
      if (path.startsWith('http')) return path;
      const cleanPath = normalizeStoragePath(path);
      try {
        const { data, error } = await supabase.storage
          .from(newsBucket)
          .createSignedUrl(cleanPath, 60 * 60 * 24 * 365);
        if (error) throw error;
        return data?.signedUrl || path;
      } catch (err) {
        console.error('Sign public news image error', err);
        return path;
      }
    };

    const envNewsTable = (import.meta.env.VITE_SUPABASE_NEWS_TABLE as string) || '';
    const candidateTables = envNewsTable ? [envNewsTable, 'news'] : ['news'];

    const load = async () => {
      let loaded = false;
      try {
        setNewsLoading(true);
        for (const table of candidateTables) {
          try {
            const { data, error } = await supabase
              .from(table)
              .select('*')
              .order('published_at', { ascending: false, nulls: 'last' })
              .order('created_at', { ascending: false, nulls: 'last' });
            if (error) throw error;
            const activeRows = (data || []).filter(
              (row: any) => !row.archived_at && !row.archivedAt && !row.is_archived
            );
            const mapped = await Promise.all(
              activeRows.map(async (row: any) => {
                const base = mapRowToNews(row);
                return { ...base, imageUrl: await signImageUrl(base.imageUrl) };
              })
            );
            if (mapped.length > 0) {
              setNews(mapped);
              loaded = true;
              break;
            }
          } catch (err) {
            // Try next table
            console.error('Load public news error', err);
          }
        }
      } finally {
        setNewsLoading(false);
      }

      if (!loaded) {
        setNews([]);
      }
    };

    load();
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const loaded = await loadHomeTestimonials();
      if (!active) return;
      setTestimonials(loaded.items);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const loaded = await loadHomeFaqItems();
      if (!active) return;
      setFaqItems(loaded.length ? loaded : getDefaultHomeFaqItems());
    })();
    return () => {
      active = false;
    };
  }, []);

  const isRecentNews = (value?: string | null) => {
    if (!value) return false;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return false;
    const diffMs = Date.now() - d.getTime();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    return diffMs >= 0 && diffMs <= weekMs;
  };

  const handleSwipeStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (activeNews || news.length <= 2) return;
    const touch = event.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleManualAdvance = (nextIndex: number) => {
    setActiveNewsIndex(nextIndex);
    setAutoAdvanceKey((prev) => prev + 1);
  };

  const renderStaticNewsCard = (
    item: NewsItemView,
    index: number,
    options?: { featured?: boolean }
  ) => {
    const isFeatured = options?.featured ?? false;
    return (
      <div
        key={`news-card-static-${item.id}`}
        className="bg-brand-dark border border-white/10 rounded-2xl overflow-hidden group hover:border-brand-lime/50 transition-all duration-300 max-w-[min(60vw,520px)] w-full"
      >
        <div className="h-56 overflow-hidden relative">
          <img
            src={item.imageUrl}
            alt={item.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          {isRecentNews(item.rawDate) && (
            <div className="absolute top-4 left-4 bg-brand-red text-white text-xs font-bold px-2 py-1 rounded uppercase">
              New
            </div>
          )}
        </div>
        <div className="p-6">
          {isFeatured && (
            <span className="text-[10px] uppercase tracking-widest font-bold text-brand-lime bg-brand-lime/10 border border-brand-lime/30 px-2 py-1 rounded-full self-start mb-3 inline-block">
              Featured
            </span>
          )}
          <div className="text-brand-grey text-xs mb-2">{item.date}</div>
          <h3 className="font-sports text-xl font-bold text-white mb-2 group-hover:text-brand-lime transition-colors">
            {item.title}
          </h3>
          <p className="text-gray-400 text-sm line-clamp-2 mb-4">{item.summary}</p>
          <button
            type="button"
            onClick={() => {
              setActiveNews(item);
              setActiveNewsIndex(index);
            }}
            className="text-brand-lime text-sm font-bold uppercase tracking-wider flex items-center gap-1 hover:gap-2 transition-all"
          >
            Read More <ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  };

  const handleSwipeEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (activeNews || news.length <= 2 || !swipeStartRef.current) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - swipeStartRef.current.x;
    const dy = touch.clientY - swipeStartRef.current.y;
    swipeStartRef.current = null;

    if (Math.abs(dx) < 40) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.2) return;

    if (dx < 0) {
      handleManualAdvance((activeNewsIndex + 1) % news.length);
    } else {
      handleManualAdvance((activeNewsIndex - 1 + news.length) % news.length);
    }
  };

  useEffect(() => {
    const loadSeason = async () => {
      try {
        const formatTag = (name?: string | null, start?: string | null) => {
          const prettifySeasonName = (raw?: string | null) => {
            if (!raw) return '';
            const match = raw.match(/(20\d{2})/);
            if (!match) return raw;
            const year = match[1];
            const shortYear = `'${year.slice(-2)}`;
            return raw.replace(year, shortYear);
          };

          if (!start) {
            const displayName = prettifySeasonName(name);
            return displayName ? `${displayName} starts soon` : 'Season starts soon';
          }
          const d = new Date(start);
          const when = Number.isNaN(d.getTime())
            ? start
            : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          const displayName = prettifySeasonName(name);
          return displayName ? `${displayName} starts ${when}` : `Season starts ${when}`;
        };

        const { data: current } = await supabase
          .from('seasons')
          .select('name,start_date')
          .eq('is_current', true)
          .maybeSingle();

        if (current) {
          setSeasonTagline(formatTag(current.name, (current as any).start_date));
          return;
        }

        const { data: latest } = await supabase
          .from('seasons')
          .select('name,start_date')
          .order('start_date', { ascending: false, nulls: 'last' })
          .limit(1)
          .maybeSingle();

        if (latest) {
          setSeasonTagline(formatTag(latest.name, (latest as any).start_date));
        }
      } catch (err) {
        console.warn('Load season tagline failed', err);
        setSeasonTagline('Season starts soon');
      }
    };
    loadSeason();
  }, []);

  useEffect(() => {
    if (news.length === 0) return;
    setActiveNewsIndex((prev) => (prev >= news.length ? 0 : prev));
  }, [news.length]);

  useEffect(() => {
    if (news.length <= 2 || activeNews) return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) return;

    const intervalId = window.setInterval(() => {
      setActiveNewsIndex((prev) => (prev + 1) % news.length);
    }, 4500);
    return () => window.clearInterval(intervalId);
  }, [news.length, activeNews, autoAdvanceKey]);

  useEffect(() => {
    const formatDateLabel = (value: string) => {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return 'TBD';
      return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const fallbackDate = new Date(Date.now() + COUNTDOWN_FALLBACK_DAYS * 24 * 60 * 60 * 1000);
    const setFallback = (keepTitle = false) => {
      setCountdownTargetMs(fallbackDate.getTime());
      if (!keepTitle) {
        setCountdownLabel('Next Season');
      }
      setCountdownStartLabel(formatDateLabel(fallbackDate.toISOString()));
    };

    const loadNextSeason = async () => {
      let overrideTitle = '';
      let overrideDate = '';
      let overrideImage = '';
      let overrideDeadlineLabel = '';
      let hasFlashNewsUpdate = false;
      try {
        const settings = new Map<string, string>();
        try {
          const { data: settingsRows, error: settingsErr } = await supabase
            .from('site_settings')
            .select('key,value')
            .in('key', ['countdown_target_date', 'countdown_image_url', 'countdown_title', 'countdown_deadline_label']);
          if (settingsErr) throw settingsErr;
          (settingsRows || []).forEach((row: any) => {
            if (row?.key && row?.value) settings.set(row.key, row.value);
          });
        } catch (settingsError) {
          console.warn('Countdown settings lookup failed', settingsError);
        }

        overrideImage = settings.get('countdown_image_url') || '';
        overrideDate = settings.get('countdown_target_date') || '';
        overrideTitle = settings.get('countdown_title') || '';
        overrideDeadlineLabel = settings.get('countdown_deadline_label') || '';
        hasFlashNewsUpdate = Boolean(overrideImage || overrideDate || overrideTitle || overrideDeadlineLabel);
        setHasFlashNews(hasFlashNewsUpdate);

        setCountdownDeadlineLabel(overrideDeadlineLabel.trim() || 'Registration deadline');

        if (!hasFlashNewsUpdate) {
          setCountdownTargetMs(null);
          return;
        }

        if (overrideTitle) {
          setCountdownLabel(overrideTitle);
        }

        if (overrideImage) setCountdownImageUrl(overrideImage);

        if (overrideDate) {
          const overrideMs = new Date(overrideDate).getTime();
          if (!Number.isNaN(overrideMs)) {
            setCountdownTargetMs(overrideMs);
            setCountdownStartLabel(formatDateLabel(overrideDate));
          }
        }

        const nowIso = new Date().toISOString();
        const { data } = await supabase
          .from('seasons')
          .select('name,start_date,year')
          .gt('start_date', nowIso)
          .order('start_date', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (data?.start_date) {
          const label = data.name || (data.year ? `Season ${data.year}` : 'Next Season');
          const seasonStartLabel = formatDateLabel(data.start_date);
          setNextSeasonStartLabel(seasonStartLabel);
          if (!overrideTitle) {
            setCountdownLabel(label);
          }
          if (!overrideDate) {
            setCountdownTargetMs(new Date(data.start_date).getTime());
            setCountdownStartLabel(seasonStartLabel);
          }
        } else {
          setNextSeasonStartLabel(formatDateLabel(fallbackDate.toISOString()));
          if (!overrideDate) {
            setFallback(!!overrideTitle);
          }
        }
      } catch (err) {
        console.warn('Next season countdown lookup failed', err);
        setNextSeasonStartLabel(formatDateLabel(fallbackDate.toISOString()));
        setFallback(!!overrideTitle);
      } finally {
        setCountdownLoaded(true);
      }
    };

    loadNextSeason();
  }, []);

  useEffect(() => {
    if (!countdownLoaded) return;
    setShowCountdown(hasFlashNews);
  }, [countdownLoaded, hasFlashNews]);

  useEffect(() => {
    if (!countdownTargetMs) return;
    const tick = () => {
      const diff = Math.max(0, countdownTargetMs - Date.now());
      setTimeLeftMs(diff);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [countdownTargetMs]);

  const countdown = useMemo(() => {
    const total = Math.max(0, timeLeftMs);
    const days = Math.floor(total / (1000 * 60 * 60 * 24));
    const hours = Math.floor((total % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((total % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((total % (1000 * 60)) / 1000);
    return { days, hours, minutes, seconds };
  }, [timeLeftMs]);

  const pad = (value: number) => String(value).padStart(2, '0');
  const isLive = countdownTargetMs !== null && timeLeftMs <= 0;
  const countdownDeadlineCopy = countdownDeadlineLabel.trim() || 'Registration deadline';
  const handleCloseCountdown = () => {
    setShowCountdown(false);
    try {
      sessionStorage.setItem(COUNTDOWN_STORAGE_KEY, '1');
    } catch {}
  };

  const orderedTestimonials = useMemo(
    () => (testimonials.length ? testimonials : getDefaultHomeTestimonials()),
    [testimonials]
  );
  const bottomTestimonials = useMemo(() => {
    if (orderedTestimonials.length <= 1) return orderedTestimonials;
    const offset = Math.max(1, Math.ceil(orderedTestimonials.length / 2));
    return orderedTestimonials.map(
      (_, index) => orderedTestimonials[(index + offset) % orderedTestimonials.length]
    );
  }, [orderedTestimonials]);

  const topMarqueeItems = [
    ...orderedTestimonials,
    ...orderedTestimonials,
    ...orderedTestimonials,
  ];
  const bottomMarqueeItems = [
    ...bottomTestimonials,
    ...bottomTestimonials,
    ...bottomTestimonials,
  ];

  const renderTestimonialCard = (item: HomeTestimonial, key: string) => {
    const initials = item.name
      .split(' ')
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();

    return (
      <article
        key={key}
        className="shrink-0 w-[min(84vw,360px)] sm:w-[320px] md:w-[360px] relative overflow-hidden rounded-2xl border border-white/10 bg-brand-dark/95 p-5 sm:p-6"
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: getTestimonialGlow(item.accentColor) }}
        />
        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <div className="inline-flex items-center rounded-full border border-brand-lime/40 bg-brand-lime/10 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-brand-lime">
              Verified Player
            </div>
            <Quote size={20} className="text-brand-lime/80" />
          </div>

          <p className="text-white text-sm sm:text-base leading-relaxed min-h-[112px]">
            "{item.quote}"
          </p>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-full border border-brand-lime/40 bg-black/60 text-brand-lime text-xs font-bold grid place-items-center shrink-0 overflow-hidden relative">
                <span>{initials}</span>
                {item.avatarUrl ? (
                  <img
                    src={item.avatarUrl}
                    alt={item.name}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-white truncate">{item.name}</div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-gray-400 truncate">
                  {item.role}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gray-500">{item.season}</div>
              <div className="text-xs text-brand-lime font-semibold">{item.division}</div>
            </div>
          </div>
        </div>
      </article>
    );
  };

  const testimonialsSection = (
    <section className="py-20 bg-brand-black border-b border-white/5 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-10">
          <div>
            <div className="text-xs uppercase tracking-[0.35em] text-brand-grey font-bold mb-3">
              Community Voices
            </div>
            <h3 className="font-sports text-3xl md:text-5xl uppercase text-white">
              What players say about CSL
            </h3>
          </div>
        </div>

        <style>{`
          @keyframes testimonialMarqueeLeft {
            0% { transform: translateX(0); }
            100% { transform: translateX(-33.333333%); }
          }
          @keyframes testimonialMarqueeRight {
            0% { transform: translateX(-33.333333%); }
            100% { transform: translateX(0); }
          }
          .testimonial-marquee-left {
            animation: testimonialMarqueeLeft 42s linear infinite;
          }
          .testimonial-marquee-right {
            animation: testimonialMarqueeRight 42s linear infinite;
          }
          .testimonial-row-mask {
            -webkit-mask-image: linear-gradient(
              to right,
              transparent 0%,
              rgba(0, 0, 0, 1) 8%,
              rgba(0, 0, 0, 1) 92%,
              transparent 100%
            );
            mask-image: linear-gradient(
              to right,
              transparent 0%,
              rgba(0, 0, 0, 1) 8%,
              rgba(0, 0, 0, 1) 92%,
              transparent 100%
            );
          }
          @media (prefers-reduced-motion: reduce) {
            .testimonial-marquee-left,
            .testimonial-marquee-right {
              animation: none;
            }
          }
        `}</style>

        <div className="relative space-y-5">
          <div className="overflow-hidden testimonial-row-mask">
            <div className="flex w-max gap-4 sm:gap-5 testimonial-marquee-right will-change-transform">
              {topMarqueeItems.map((item, index) =>
                renderTestimonialCard(item, `top-${item.id}-${index}`)
              )}
            </div>
          </div>

          <div className="overflow-hidden testimonial-row-mask">
            <div className="flex w-max gap-4 sm:gap-5 testimonial-marquee-left will-change-transform">
              {bottomMarqueeItems.map((item, index) =>
                renderTestimonialCard(item, `bottom-${item.id}-${index}`)
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-brand-black text-white">
      {/* HERO SECTION */}
      <section className="relative w-full overflow-visible sm:overflow-hidden flex items-center justify-center bg-hero-pattern bg-cover bg-center min-h-[85vh] px-4 pt-28 pb-12 sm:py-0 sm:h-[90vh]">
        {/* Video Background */}
        <video
          className="absolute inset-0 w-full h-full object-cover"
          src="https://vhpsqwpdfvsproqzmpjk.supabase.co/storage/v1/object/public/site-media/hero/hero-video.mp4"
          autoPlay
          muted
          loop
          playsInline
        />
        <div className="absolute inset-0 bg-black/40"></div> {/* Overlay */}
        
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
          <h1 className="font-sports text-5xl sm:text-6xl md:text-8xl font-bold text-white mb-6 leading-tight uppercase italic">
            Hoops. Homies. <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-lime to-white pr-1 sm:pr-0">Good energy only.</span>
          </h1>
          <p className="text-gray-200 text-base sm:text-lg md:text-xl mb-10 max-w-2xl mx-auto font-light">
            Ontario's fastest growing basketball league. Pro-style stats, media coverage, and a competitive community built for hoopers.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center w-full max-w-2xl mx-auto">
            <Link 
              to="/register?type=team" 
              className="w-full sm:w-auto max-w-[320px] bg-brand-lime text-black px-6 py-3 sm:px-8 sm:py-4 rounded font-sports text-lg sm:text-xl font-bold uppercase tracking-wider hover:bg-white transition-colors text-center"
            >
              Create a Team
            </Link>
            <Link 
              to="/register?type=individual" 
              className="w-full sm:w-auto max-w-[320px] bg-transparent border-2 border-white text-white px-6 py-3 sm:px-8 sm:py-4 rounded font-sports text-lg sm:text-xl font-bold uppercase tracking-wider hover:bg-white hover:text-black transition-colors text-center"
            >
              Join Myself
            </Link>
          </div>
        </div>
        
        {/* Scroll Indicator */}
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce text-brand-lime">
          <ChevronDown size={32} />
        </div>
      </section>

      {showCountdown && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-3 sm:px-4 countdown-backdrop">
          <div className="w-full max-w-5xl max-h-[70vh] sm:max-h-[74vh] md:max-h-[72vh] rounded-2xl sm:rounded-3xl border border-white/10 bg-brand-dark shadow-2xl overflow-hidden countdown-modal">
            <div className="relative">
              <button
                type="button"
                onClick={handleCloseCountdown}
                className="absolute top-3 right-3 sm:top-4 sm:right-4 z-20 w-9 h-9 rounded-full border border-white/20 text-white bg-black/40 flex items-center justify-center hover:border-brand-lime"
                aria-label="Close countdown"
              >
                <X size={16} />
              </button>
              <div className="grid grid-cols-1 md:grid-cols-[0.95fr_1.05fr] max-h-[70vh] sm:max-h-[74vh] md:max-h-[72vh] overflow-y-auto">
                <div className="relative h-[170px] sm:h-[220px] md:h-[440px]">
                  <img
                    src={countdownImageUrl}
                    alt="Courtsight player"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                  <div className="absolute bottom-3 left-3 sm:bottom-5 sm:left-5">
                    <div className="text-[9px] sm:text-xs uppercase tracking-[0.35em] text-brand-lime font-bold">
                      {countdownLabel}
                    </div>
                    <div className="text-[10px] sm:text-sm text-gray-200 mt-2">{nextSeasonStartLabel}</div>
                  </div>
                </div>
                <div className="p-4 sm:p-6 md:p-8">
                  <div className="flex flex-col gap-4 sm:gap-5 items-start">
                    <div className="w-full sm:hidden grid grid-cols-[minmax(0,1fr)_96px] gap-3 items-stretch">
                      <div className="min-w-0 h-full flex flex-col justify-between py-1">
                        <div className="text-[9px] uppercase tracking-[0.35em] text-brand-grey font-bold mb-2">
                          Countdown
                        </div>
                        <h3 className="font-sports text-2xl uppercase text-white leading-none">
                          {isLive ? 'Registration Open' : countdownLabel}
                        </h3>
                        <p className="text-gray-300 text-sm mt-2">
                          {isLive
                            ? 'Registration is open for the next season.'
                            : `${countdownDeadlineCopy}: ${countdownStartLabel} (ET).`}
                        </p>
                      </div>
                      <div className="h-full rounded-2xl border border-brand-lime/40 bg-gradient-to-b from-black/60 to-black/80 px-3 py-3 text-center shadow-[0_22px_38px_rgba(0,0,0,0.8)] flex flex-col items-center justify-center">
                        <div className="font-sports text-5xl text-brand-lime leading-none">{pad(countdown.days)}</div>
                        <div className="mt-2 w-full text-center text-[9px] uppercase tracking-[0.2em] leading-none text-brand-grey whitespace-nowrap">
                          Days Left
                        </div>
                      </div>
                    </div>

                    <div className="hidden sm:block">
                      <div className="text-[9px] sm:text-xs uppercase tracking-[0.35em] text-brand-grey font-bold mb-2 sm:mb-3">
                        Countdown
                      </div>
                      <h3 className="font-sports text-xl sm:text-3xl md:text-4xl uppercase text-white">
                        {isLive ? 'Registration Open' : countdownLabel}
                      </h3>
                      <p className="text-gray-300 text-[11px] sm:text-sm md:text-base mt-1">
                        {isLive
                          ? 'Registration is open for the next season.'
                          : `${countdownDeadlineCopy}: ${countdownStartLabel} (ET).`}
                      </p>
                    </div>

                    <div className="flex flex-col items-start gap-3 sm:gap-4 w-full max-w-sm sm:max-w-none">
                      <div className="hidden sm:block rounded-3xl border border-brand-lime/40 bg-gradient-to-b from-black/60 to-black/80 px-5 py-5 w-24 sm:w-28 md:w-32 text-center shadow-[0_25px_45px_rgba(0,0,0,0.9)]">
                        <div className="font-sports text-3xl sm:text-4xl md:text-6xl text-brand-lime">{pad(countdown.days)}</div>
                        <div className="mt-2 w-full inline-flex items-center justify-center text-[9px] sm:text-[11px] uppercase tracking-[0.3em] leading-none text-brand-grey whitespace-nowrap">
                          Days Left
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3 md:gap-4 w-full">
                        <Link
                          to="/register?type=team"
                          className="bg-brand-lime text-black px-4 py-3 flex-1 min-w-[170px] text-center rounded font-sports text-[10px] sm:text-sm font-bold uppercase shadow-[0_8px_20px_rgba(225,255,43,0.35)]"
                          onClick={handleCloseCountdown}
                        >
                          Create a Team
                        </Link>
                        <Link
                          to="/register?type=individual"
                          className="border border-white/40 text-white px-4 py-3 flex-1 min-w-[170px] text-center rounded font-sports text-[10px] sm:text-sm font-bold uppercase hover:bg-white hover:text-black transition-colors"
                          onClick={handleCloseCountdown}
                        >
                          Join as Player
                        </Link>
                      </div>
                    </div>

                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={handleCloseCountdown}
                        className="text-[10px] sm:text-xs uppercase font-bold text-gray-300 hover:text-white cursor-pointer tracking-[0.3em] bg-transparent border-none p-0 focus:outline-none focus:ring-0"
                      >
                        Maybe later
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {testimonialsSection}

      {/* DIVISION OVERVIEW */}
      <section className="py-16 bg-brand-black border-b border-white/5">
        <div className="w-full space-y-6 px-4 lg:px-10">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <div className="text-xs uppercase tracking-[0.35em] text-brand-grey font-bold mb-3">
                Skill Divisions
              </div>
              <h2 className="font-sports text-4xl md:text-5xl uppercase text-white">
                Find your level
              </h2>
            </div>
            <p className="text-gray-300 text-sm md:text-base max-w-xl">
              Every team is placed by skill so games stay competitive and fun. Start where
              you are and move up as your squad grows.
            </p>
          </div>
          <div className="w-full overflow-visible">
            <div className="grid grid-cols-1 gap-1 lg:grid-cols-3">
              {DIVISION_OVERVIEW.map((division) => (
                <article
                  key={division.id}
                className="relative overflow-hidden border border-white/10 bg-slate-900/60 shadow-[inset_0_0_120px_rgba(0,0,0,0.9),0_55px_120px_rgba(0,0,0,0.9)] transition duration-500 group hover:-translate-y-1"
                  style={{
                    clipPath: 'polygon(6% 0, 100% 0, 96% 100%, 0 100%)',
                  }}
                >
                  <div
                    className="absolute inset-0 bg-cover bg-center transition duration-700 filter grayscale-[70%] contrast-[135%] brightness-[95%] group-hover:grayscale-0 group-hover:contrast-125 group-hover:saturate-150 group-hover:brightness-105"
                    style={{
                      backgroundImage: `linear-gradient(120deg, rgba(9,9,9,0.95), rgba(9,9,9,0.3)), url(${division.image})`,
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-br from-black/90 via-black/60 to-black/30 opacity-90 transition duration-500 group-hover:opacity-20" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent)] opacity-60 transition duration-500 group-hover:opacity-0" />
                  <div className="relative z-10 flex flex-col justify-between min-h-[420px] lg:min-h-[520px] px-[2.25rem] py-8 sm:px-12 text-left">
                    <div className="space-y-4 max-w-[70%] pl-4">
                      <div className="text-[10px] uppercase tracking-[0.4em] text-white/70">
                        {division.level}
                      </div>
                      <h3 className="text-3xl font-sports uppercase text-white leading-tight mt-1">
                        {division.name}
                      </h3>
                      <p className="text-gray-200 text-sm leading-relaxed tracking-wide">
                        {division.details}
                      </p>
                    </div>
                    <div className="flex items-center justify-start gap-6 pt-4 pr-6">
                      <span className="inline-flex px-3 py-1 text-[10px] uppercase rounded-full border border-white/30 text-white/70">
                        {division.label}
                      </span>
                      <Link
                        to="/register"
                        className="px-8 py-3 text-[11px] uppercase font-semibold tracking-[0.35em] text-black rounded-full border border-white/40 bg-white transition duration-300 hover:bg-brand-lime hover:text-black hover:border-brand-lime"
                      >
                        Join {division.level}
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>
      {/* LEAGUE FEATURES */}
      <section className="py-20 bg-neutral-900 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 mb-10">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-brand-grey font-bold mb-3">
                League Features
              </div>
              <h3 className="font-sports text-3xl md:text-4xl uppercase text-white">
                What you get with CSL
              </h3>
            </div>
            <p className="text-gray-300 text-sm md:text-base max-w-xl">
              A full pro-style experience from skill divisions to media, stats, and championship rewards.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {LEAGUE_FEATURES.map((feature) => (
              <div
                key={feature.id}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/50"
              >
                <div
                  className={`${feature.imageHeightClass || 'h-44 sm:h-48 md:h-56'} bg-cover bg-center transition-transform duration-500 group-hover:scale-105`}
                  style={{
                    backgroundImage: `url(${feature.image})`,
                    backgroundPosition: feature.imagePosition || 'center',
                    backgroundSize: feature.imageZoom ? feature.imageZoom : 'cover',
                    backgroundRepeat: 'no-repeat',
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                <div className="relative z-10 p-5">
                  <h4 className="font-sports text-xl uppercase text-white">{feature.title}</h4>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* NEWS TICKER / CAROUSEL */}
      <section className="py-12 bg-neutral-900 border-b border-white/5 overflow-x-hidden sm:overflow-visible">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-sports text-3xl font-bold uppercase text-white flex items-center gap-2">
              <span className="w-2 h-8 bg-brand-red block skew-x-[-12deg]"></span>
              Latest News
            </h2>
          </div>
          
          {newsLoading && news.length === 0 && (
            <div className="text-gray-400 text-sm">Loading news...</div>
          )}
          {!newsLoading && news.length === 0 && (
            <div className="text-gray-400 text-sm">No news published yet.</div>
          )}
          {news.length > 0 && (
            <>
              {news.length === 1 ? (
                <div className="flex justify-center">
                  {renderStaticNewsCard(news[0], 0, { featured: true })}
                </div>
              ) : (
                <>
                  <style>{`@keyframes newsProgress { from { transform: scaleX(0); } to { transform: scaleX(1); } }`}</style>
              {news.length === 2 ? (
                <div className="flex justify-center">
                  <div className="flex flex-wrap justify-center gap-8">
                    {news.map((item, index) => renderStaticNewsCard(item, index))}
                  </div>
                </div>
              ) : (
                <div
                  className="relative pb-10"
                  style={{ perspective: '1100px' }}
                >
                  <div
                    className="relative h-[520px] sm:h-[540px] lg:h-[560px] flex items-center justify-center"
                    style={{ touchAction: 'pan-y' }}
                    onTouchStart={handleSwipeStart}
                    onTouchEnd={handleSwipeEnd}
                    onTouchCancel={handleSwipeEnd}
                  >
                    {news.map((item, index) => {
                      const total = news.length;
                      const prevIndex = (activeNewsIndex - 1 + total) % total;
                      const nextIndex = (activeNewsIndex + 1) % total;
                      const isActive = index === activeNewsIndex;
                      const isPrev = index === prevIndex;
                      const isNext = index === nextIndex;

                      let offset = 0;
                      let scale = 1;
                      let rotate = 0;
                      let opacity = 1;
                      let zIndex = 20;
                      let depth = 80;
                      let shadow = '0 35px 80px rgba(0,0,0,0.6)';
                      let pointerEvents: 'auto' | 'none' = 'auto';

                      if (isPrev) {
                        offset = -60;
                        scale = 0.88;
                        rotate = 16;
                        opacity = 0.35;
                        zIndex = 10;
                        depth = -80;
                        shadow = '0 20px 50px rgba(0,0,0,0.45)';
                      } else if (isNext) {
                        offset = 60;
                        scale = 0.88;
                        rotate = -16;
                        opacity = 0.35;
                        zIndex = 10;
                        depth = -80;
                        shadow = '0 20px 50px rgba(0,0,0,0.45)';
                      } else if (!isActive) {
                        opacity = 0;
                        zIndex = 0;
                        pointerEvents = 'none';
                        scale = 0.75;
                        depth = -180;
                        shadow = '0 0 0 rgba(0,0,0,0)';
                      }

                      return (
                        <div
                          key={item.id}
                          className={`absolute left-1/2 w-[min(80vw,520px)] sm:w-[min(70vw,560px)] lg:w-[min(60vw,620px)] transition-all duration-700 ease-out ${
                            isActive ? 'cursor-default' : 'cursor-pointer'
                          }`}
                          style={{
                            transform: `translateX(calc(-50% + ${offset}%)) translateZ(${depth}px) scale(${scale}) rotateY(${rotate}deg)`,
                            opacity,
                            zIndex,
                            pointerEvents,
                          }}
                          onClick={() => {
                            if (!isActive) {
                              handleManualAdvance(index);
                            }
                          }}
                        >
                          <div
                            className="bg-brand-dark border border-white/10 rounded-2xl overflow-hidden group hover:border-brand-lime/50 transition-all duration-300"
                            style={{ boxShadow: shadow }}
                            onMouseMove={(event) => {
                              const card = event.currentTarget;
                              const img = card.querySelector<HTMLImageElement>('[data-parallax]');
                              if (!img) return;
                              const rect = card.getBoundingClientRect();
                              const x = event.clientX - rect.left - rect.width / 2;
                              const y = event.clientY - rect.top - rect.height / 2;
                              const moveX = Math.max(-10, Math.min(10, (x / rect.width) * 20));
                              const moveY = Math.max(-10, Math.min(10, (y / rect.height) * 20));
                              img.style.transform = `translate3d(${moveX}px, ${moveY}px, 0) scale(1.08)`;
                            }}
                            onMouseLeave={(event) => {
                              const card = event.currentTarget;
                              const img = card.querySelector<HTMLImageElement>('[data-parallax]');
                              if (!img) return;
                              img.style.transform = 'translate3d(0, 0, 0) scale(1.04)';
                            }}
                          >
                            <div className="h-56 overflow-hidden relative">
                              <img
                                src={item.imageUrl}
                                alt={item.title}
                                data-parallax
                                className="w-full h-full object-cover transition-transform duration-300 ease-out"
                                style={{ transform: 'translate3d(0, 0, 0) scale(1.04)' }}
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                              {isRecentNews(item.rawDate) && (
                                <div className="absolute top-4 left-4 bg-brand-red text-white text-xs font-bold px-2 py-1 rounded uppercase">
                                  New
                                </div>
                              )}
                            </div>
                            <div className="p-6">
                              <div className="text-brand-grey text-xs mb-2">{item.date}</div>
                              <h3 className="font-sports text-xl font-bold text-white mb-2 group-hover:text-brand-lime transition-colors">
                                {item.title}
                              </h3>
                              <p className="text-gray-400 text-sm line-clamp-2 mb-4">{item.summary}</p>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (!isActive) {
                                    handleManualAdvance(index);
                                    return;
                                  }
                                  setActiveNews(item);
                                  setActiveNewsIndex(index);
                                }}
                                className="text-brand-lime text-sm font-bold uppercase tracking-wider flex items-center gap-1 hover:gap-2 transition-all"
                              >
                                Read More <ArrowRight size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {news.length > 2 && (
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-1 w-32 sm:w-40 bg-white/10 rounded-full overflow-hidden">
                        <div
                          key={`news-progress-${activeNewsIndex}`}
                          className="h-full bg-brand-lime/80"
                          style={{
                            transformOrigin: 'left',
                            animation: 'newsProgress 4500ms linear forwards',
                            animationPlayState: activeNews ? 'paused' : 'running',
                          }}
                        />
                      </div>
                      <div className="flex justify-center gap-2">
                        {news.map((item, index) => (
                          <button
                            key={`news-dot-${item.id}`}
                            type="button"
                            onClick={() => {
                              if (index !== activeNewsIndex) {
                                handleManualAdvance(index);
                              }
                            }}
                            className={`h-2.5 w-2.5 rounded-full transition-colors ${
                              index === activeNewsIndex ? 'bg-brand-lime' : 'bg-white/20 hover:bg-white/40'
                            }`}
                            aria-label={`Go to news ${index + 1}`}
                          />
                        ))}
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">
                        Tap side cards or swipe
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/* FAQ SECTION */}
      <section className="py-16 bg-brand-black">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="font-sports text-4xl font-bold text-center text-white mb-12 uppercase">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            {faqItems.map((faq) => (
              <div key={faq.id} className="border border-white/10 rounded-lg bg-brand-dark overflow-hidden">
                <button
                  onClick={() => toggleFaq(faq.id)}
                  className="w-full px-6 py-4 flex items-center justify-between text-left focus:outline-none hover:bg-white/5 transition-colors"
                >
                  <span className="font-bold text-lg text-white">{faq.question}</span>
                  {openFaq === faq.id ? <ChevronUp className="text-brand-lime" /> : <ChevronDown className="text-brand-grey" />}
                </button>
                {openFaq === faq.id && (
                  <div className="px-6 pb-6 pt-2 text-gray-400 text-sm leading-relaxed border-t border-white/5 animate-fadeIn">
                    {faq.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT CTA */}
      <section className="py-20 bg-gradient-to-r from-brand-lime/95 via-brand-lime/80 to-brand-lime/60 text-brand-black">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="font-sports text-5xl font-bold uppercase mb-6">Ready to Ball?</h2>
          <p className="text-xl font-medium mb-8 max-w-2xl mx-auto">
            Don't miss out on the upcoming season. Spots fill up quickly for both teams and free agents.
          </p>
          <div className="flex justify-center gap-4">
             <Link to="/register" className="bg-black text-white px-10 py-4 rounded font-sports text-xl font-bold uppercase hover:bg-gray-900 transition-transform hover:-translate-y-1 shadow-xl">
               Register Now
             </Link>
             <Link to="/contact" className="bg-transparent border-2 border-black text-black px-10 py-4 rounded font-sports text-xl font-bold uppercase hover:bg-black hover:text-white transition-colors">
               Contact Us
             </Link>
          </div>
        </div>
      </section>

      {activeNews && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={() => setActiveNews(null)}
        >
          <div
            className="bg-brand-dark border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] shadow-2xl overflow-hidden animate-fadeIn flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="relative">
              <img
                src={activeNews.imageUrl}
                alt={activeNews.title}
                className="w-full h-48 sm:h-56 object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <button
                type="button"
                onClick={() => setActiveNews(null)}
                className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black"
                aria-label="Close news"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto min-h-0">
              <div className="text-brand-grey text-xs mb-2">{activeNews.date}</div>
              <h3 className="font-sports text-2xl text-white mb-4">{activeNews.title}</h3>
              <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-line">
                {activeNews.summary || 'No additional details yet.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
