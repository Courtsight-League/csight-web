import React, { useEffect, useMemo, useRef, useState } from 'react';

export type BadgeCarouselItem = {
  key: string;
  label: string;
  url: string;
  tooltip?: string;
  fallbackUrl?: string;
};

type BadgeCylinderCarouselProps = {
  items: BadgeCarouselItem[];
  hintText?: string;
  className?: string;
};

const AUTO_ROTATE_MS = 3000;
const SWIPE_THRESHOLD_PX = 36;
const CARD_SIZE_PX = 80;
const CARD_GAP_PX = 12;
const MIN_STATIC_CARD_SIZE_PX = 52;

const wrapIndex = (index: number, total: number) => {
  if (total <= 0) return 0;
  return ((index % total) + total) % total;
};

const getRelativeOffset = (index: number, active: number, total: number) => {
  if (total <= 1) return 0;
  let diff = index - active;
  if (diff > total / 2) diff -= total;
  if (diff < -total / 2) diff += total;
  return diff;
};

const BadgeCylinderCarousel: React.FC<BadgeCylinderCarouselProps> = ({
  items,
  hintText = 'Swipe badges',
  className = '',
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const updateWidth = () => {
      setContainerWidth(node.clientWidth || 0);
    };
    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(node);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length]);

  const effectiveWidth = containerWidth || 320;
  const staticTargetCount = Math.min(items.length, 4);
  const computedStaticCardSize =
    staticTargetCount > 0
      ? Math.floor((effectiveWidth - CARD_GAP_PX * (staticTargetCount - 1)) / staticTargetCount)
      : CARD_SIZE_PX;
  const staticCardSize = Math.min(CARD_SIZE_PX, Math.max(MIN_STATIC_CARD_SIZE_PX, computedStaticCardSize));
  const canUseStaticLayout = items.length <= 4 && computedStaticCardSize >= MIN_STATIC_CARD_SIZE_PX;

  const naturalTotalWidth =
    items.length > 0 ? items.length * CARD_SIZE_PX + (items.length - 1) * CARD_GAP_PX : 0;
  const hasOverflow = naturalTotalWidth > effectiveWidth;
  const useCylinderMode = items.length > 1 && !canUseStaticLayout && hasOverflow;

  useEffect(() => {
    if (!useCylinderMode || items.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => wrapIndex(prev + 1, items.length));
    }, AUTO_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [items.length, useCylinderMode]);

  const movePrev = () => setActiveIndex((prev) => wrapIndex(prev - 1, items.length));
  const moveNext = () => setActiveIndex((prev) => wrapIndex(prev + 1, items.length));

  const visibleCards = useMemo(() => {
    if (!items.length) return [];
    if (items.length === 1) return [{ item: items[0], offset: 0, index: 0 }];
    return items
      .map((item, index) => ({
        item,
        index,
        offset: getRelativeOffset(index, activeIndex, items.length),
      }))
      .filter(({ offset }) => Math.abs(offset) <= 1);
  }, [activeIndex, items]);

  if (!items.length) return null;

  if (!useCylinderMode) {
    return (
      <div ref={containerRef} className={`w-full ${className}`}>
        <div className="flex items-center gap-3">
          {items.map((item) => (
            <div
              key={item.key}
              className="shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/20"
              style={{ width: staticCardSize, height: staticCardSize }}
              title={item.tooltip || item.label}
            >
              <img
                src={item.url}
                alt={`${item.label} badge`}
                className="h-full w-full object-contain scale-[1.2] bg-transparent"
                loading="lazy"
                onError={(event) => {
                  const target = event.currentTarget as HTMLImageElement;
                  if (target.dataset.fallbackApplied === '1') return;
                  if (item.fallbackUrl) {
                    target.dataset.fallbackApplied = '1';
                    target.src = item.fallbackUrl;
                  }
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`w-full ${className}`}>
      <div
        className="relative h-24 w-full [perspective:1000px]"
        onTouchStart={(event) => {
          touchStartX.current = event.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (touchStartX.current == null) return;
          const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
          const delta = endX - touchStartX.current;
          touchStartX.current = null;
          if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
          if (delta > 0) movePrev();
          else moveNext();
        }}
      >
        <div className="absolute inset-0 rounded-xl border border-white/10 bg-black/25 backdrop-blur-[1px]" />

        {visibleCards.map(({ item, offset, index }) => {
          const isCenter = offset === 0;
          const translateX = offset * 86;
          const rotateY = offset * -40;
          const scale = isCenter ? 1 : 0.88;
          const opacity = isCenter ? 1 : 0.58;
          const zIndex = isCenter ? 30 : 20;
          return (
            <button
              key={item.key}
              type="button"
              className="absolute left-1/2 top-1/2 h-20 w-20 overflow-hidden rounded-lg border border-white/10 bg-black/20 p-0 transition-all duration-500"
              style={{
                transform: `translate(-50%, -50%) translateX(${translateX}px) rotateY(${rotateY}deg) scale(${scale})`,
                opacity,
                zIndex,
                boxShadow: isCenter ? '0 14px 30px rgba(0,0,0,0.5)' : '0 8px 18px rgba(0,0,0,0.35)',
              }}
              onClick={() => {
                if (index === activeIndex) return;
                setActiveIndex(index);
              }}
              aria-label={item.label}
              title={item.tooltip || item.label}
            >
              <img
                src={item.url}
                alt={`${item.label} badge`}
                className="h-full w-full object-contain scale-[1.2] bg-transparent"
                loading="lazy"
                onError={(event) => {
                  const target = event.currentTarget as HTMLImageElement;
                  if (target.dataset.fallbackApplied === '1') return;
                  if (item.fallbackUrl) {
                    target.dataset.fallbackApplied = '1';
                    target.src = item.fallbackUrl;
                  }
                }}
              />
            </button>
          );
        })}

        {items.length > 1 && (
          <>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-10 rounded-l-xl bg-gradient-to-r from-brand-dark via-brand-dark/80 to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-xl bg-gradient-to-l from-brand-dark via-brand-dark/80 to-transparent" />
          </>
        )}
      </div>

      {items.length > 1 && (
        <div className="mt-1">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">{hintText}</div>
        </div>
      )}
    </div>
  );
};

export default BadgeCylinderCarousel;
