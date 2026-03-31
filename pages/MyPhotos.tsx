
import React from 'react';
import { Camera, Sparkles } from 'lucide-react';

const MyPhotos: React.FC = () => {
  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex items-center gap-3">
          <span className="w-2 h-10 bg-brand-lime skew-x-[-12deg] block"></span>
          <h1 className="font-sports text-4xl font-bold text-white uppercase">Game Galleries</h1>
        </div>

        <div className="bg-brand-dark border border-white/10 rounded-2xl p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-brand-lime/5 via-transparent to-brand-lime/5 pointer-events-none" />
          <div className="flex flex-col md:flex-row items-center gap-8 relative z-10">
            <div className="w-24 h-24 rounded-full bg-brand-lime/10 border border-brand-lime/40 flex items-center justify-center">
              <Camera className="w-10 h-10 text-brand-lime" />
            </div>
            <div className="flex-1 space-y-2">
              <p className="text-brand-lime text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                <Sparkles size={14} /> Coming soon
              </p>
              <h2 className="text-white font-sports text-3xl md:text-4xl font-bold leading-tight">
                Photo drops are on deck.
              </h2>
              <p className="text-gray-300 text-sm md:text-base max-w-2xl">
                We’re lining up fresh game galleries so you can relive the highlights. Stay tuned — uploads will appear here as soon as they’re ready.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyPhotos;
