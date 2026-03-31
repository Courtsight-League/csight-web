import React, { useEffect, useState } from 'react';
import {
  getDefaultAboutPageContent,
  loadAboutPageContent,
  type AboutPageSection,
  type AboutPageContent,
} from '../services/aboutPageContent';

const toBodyLines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const cleanListLine = (value: string) => value.replace(/^[•*-]\s*/, '').trim();

const splitTwoColumns = (lines: string[]) => {
  if (lines.length <= 1) return [lines, []] as const;
  const midpoint = Math.ceil(lines.length / 2);
  return [lines.slice(0, midpoint), lines.slice(midpoint)] as const;
};

type DetailBlock = {
  label: string;
  lines: string[];
};

const parseDetailBlocks = (value: string): DetailBlock[] => {
  const rows = value.split('\n');
  const blocks: DetailBlock[] = [];
  let current: DetailBlock | null = null;

  rows.forEach((raw) => {
    const line = raw.trim();
    if (!line) {
      if (current && current.lines.length) blocks.push(current);
      current = null;
      return;
    }
    if (!current) {
      current = { label: line, lines: [] };
      return;
    }
    current.lines.push(cleanListLine(line));
  });

  if (current && current.lines.length) blocks.push(current);
  return blocks;
};

const isSectionMatch = (section: AboutPageSection, pattern: RegExp) =>
  pattern.test(section.title) || pattern.test(section.id);

const SectionCard: React.FC<{
  section: AboutPageSection;
  className?: string;
  listMode?: boolean;
}> = ({ section, className = '', listMode = false }) => {
  const lines = toBodyLines(section.body).map(cleanListLine);
  return (
    <div className={`bg-brand-dark border border-white/10 rounded-xl overflow-hidden ${className}`.trim()}>
      {section.imageUrl ? (
        <img
          src={section.imageUrl}
          alt={section.title}
          className="w-full h-44 object-cover"
          onError={(e) => {
            const target = e.currentTarget as HTMLImageElement;
            target.style.display = 'none';
          }}
        />
      ) : null}
      <div className="p-6 space-y-4">
        <h2 className="font-sports text-white text-2xl uppercase">{section.title}</h2>
        {listMode ? (
          <ul className="space-y-2 text-gray-200 text-sm md:text-base list-disc list-inside">
            {lines.map((line, index) => (
              <li key={`${section.id}-list-${index}`}>{line}</li>
            ))}
          </ul>
        ) : (
          <div className="text-gray-300 text-sm md:text-base space-y-2">
            {lines.map((line, index) => (
              <p key={`${section.id}-${index}`}>{line}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const About: React.FC = () => {
  const [content, setContent] = useState<AboutPageContent>(getDefaultAboutPageContent());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const loaded = await loadAboutPageContent();
      if (!active) return;
      setContent(loaded);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-black pt-24 pb-16 px-4">
        <div className="max-w-6xl mx-auto text-sm text-gray-400">Loading About page...</div>
      </div>
    );
  }

  const whereWePlay = content.sections.find((section) => isSectionMatch(section, /where\s*we\s*play/i));
  const leagueFormat = content.sections.find((section) => isSectionMatch(section, /league\s*format/i));
  const experience = content.sections.find((section) => isSectionMatch(section, /experience/i));
  const leagueDetails = content.sections.find((section) => isSectionMatch(section, /details\s*at\s*a\s*glance/i));

  const renderedIds = new Set(
    [whereWePlay?.id, leagueFormat?.id, experience?.id, leagueDetails?.id].filter(Boolean) as string[]
  );
  const fallbackSections = content.sections.filter((section) => !renderedIds.has(section.id));

  const experienceLines = experience ? toBodyLines(experience.body).map(cleanListLine) : [];
  const [experienceLeft, experienceRight] = splitTwoColumns(experienceLines);
  const detailBlocks = leagueDetails ? parseDetailBlocks(leagueDetails.body) : [];
  const detailLeft = detailBlocks.filter((_, index) => index % 2 === 0);
  const detailRight = detailBlocks.filter((_, index) => index % 2 === 1);

  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-16 px-4">
      <div className="max-w-6xl mx-auto space-y-10">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
          <img
            src={content.heroImageUrl}
            alt="Courtsight Experience"
            className="w-full h-72 md:h-96 object-cover opacity-70"
            onError={(e) => {
              const target = e.currentTarget as HTMLImageElement;
              if (target.dataset.fallbackApplied === '1') return;
              target.dataset.fallbackApplied = '1';
              target.src =
                'https://images.unsplash.com/photo-1684411531348-3aad121da52d?q=80&w=1470&auto=format&fit=crop';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-brand-black via-brand-black/40 to-transparent" />
          <div className="absolute inset-0 flex flex-col justify-center px-6 md:px-10">
            <span className="text-brand-lime font-bold uppercase text-sm tracking-widest mb-3">
              The CSL Experience
            </span>
            <h1 className="text-white font-sports text-4xl md:text-5xl font-bold leading-tight uppercase">
              {content.headline}
            </h1>
            <p className="text-gray-200 max-w-3xl mt-4 text-sm md:text-base">{content.intro}</p>
          </div>
        </div>

        {(whereWePlay || leagueFormat) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {whereWePlay ? <SectionCard section={whereWePlay} listMode /> : null}
            {leagueFormat ? <SectionCard section={leagueFormat} /> : null}
          </div>
        )}

        {experience && (
          <div className="bg-brand-dark border border-white/10 rounded-xl overflow-hidden">
            {experience.imageUrl ? (
              <img
                src={experience.imageUrl}
                alt={experience.title}
                className="w-full h-44 object-cover"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            ) : null}
            <div className="p-6 space-y-4">
              <h2 className="font-sports text-white text-2xl uppercase">{experience.title}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-6 text-gray-200 text-sm md:text-base">
                <div className="space-y-2">
                  {experienceLeft.map((line, index) => (
                    <p key={`experience-left-${index}`}>{line}</p>
                  ))}
                </div>
                <div className="space-y-2">
                  {experienceRight.map((line, index) => (
                    <p key={`experience-right-${index}`}>{line}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {leagueDetails && (
          <div className="bg-brand-dark border border-white/10 rounded-xl overflow-hidden">
            {leagueDetails.imageUrl ? (
              <img
                src={leagueDetails.imageUrl}
                alt={leagueDetails.title}
                className="w-full h-44 object-cover"
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
            ) : null}
            <div className="border-b border-white/10 px-6 py-4">
              <h2 className="font-sports text-white text-2xl uppercase">{leagueDetails.title}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/10">
              <div className="p-6 space-y-6">
                {detailLeft.map((block, index) => (
                  <div key={`details-left-${index}`} className="space-y-2">
                    <div className="text-[10px] uppercase tracking-[0.25em] text-gray-400">{block.label}</div>
                    <div className="space-y-1 text-gray-200 text-sm md:text-base">
                      {block.lines.map((line, lineIndex) => (
                        <p key={`details-left-${index}-${lineIndex}`}>{line}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-6 space-y-6">
                {detailRight.map((block, index) => (
                  <div key={`details-right-${index}`} className="space-y-2">
                    <div className="text-[10px] uppercase tracking-[0.25em] text-gray-400">{block.label}</div>
                    <div className="space-y-1 text-gray-200 text-sm md:text-base">
                      {block.lines.map((line, lineIndex) => (
                        <p key={`details-right-${index}-${lineIndex}`}>{line}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {fallbackSections.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {fallbackSections.map((section) => (
              <SectionCard key={section.id} section={section} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default About;
