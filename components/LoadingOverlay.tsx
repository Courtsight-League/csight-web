import React from 'react';

type Props = {
  message?: string;
};

const LoadingOverlay: React.FC<Props> = ({ message = 'Loading...' }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex items-center gap-3 px-4 py-3 rounded-full border border-brand-lime/40 bg-brand-dark/80 shadow-[0_0_30px_rgba(225,255,43,0.25)]">
        <span className="w-3 h-3 rounded-full bg-brand-lime animate-ping" />
        <span className="text-white font-sports text-sm uppercase tracking-wide">{message}</span>
      </div>
    </div>
  );
};

export default LoadingOverlay;
