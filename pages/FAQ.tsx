import React from 'react';
import { HelpCircle } from 'lucide-react';

const faqs = [
  {
    q: 'How do I join the league?',
    a: (
      <>
        Click on <a href="/register" className="text-brand-lime font-semibold hover:underline">Register</a> and follow the required steps to sign up on our portal. Once signed up, a CSL rep will contact you within 48 hours.
      </>
    ),
  },
  {
    q: 'How much does it cost?',
    a: (
      <div className="space-y-2">
        <p>As a community-driven league, we keep our prices static and our spots limited.</p>
        <p className="font-semibold text-white">$195</p>
        <p>to sign up as an individual</p>
        <p className="font-semibold text-white">$1750</p>
        <p>for team signups</p>
      </div>
    ),
  },
  {
    q: 'What does the league include?',
    a: (
      <ul className="list-disc list-inside space-y-1">
        <li>8 guaranteed games (including 1 playoff game)</li>
        <li>HD Live Stream</li>
        <li>Detailed Player and Team Stat tracking</li>
        <li>2 FIBA Officiated Refs</li>
        <li>Standard FIBA-sized courts</li>
        <li>Social Media Coverage</li>
        <li>Championship Rings + Shirts + Awards</li>
        <li>All-Star activities</li>
      </ul>
    ),
  },
  {
    q: 'What are the league rules?',
    a: (
      <p>
        Here is our downloadable:{' '}
        <a
          href="https://vhpsqwpdfvsproqzmpjk.supabase.co/storage/v1/object/public/public-assets/CSL-Rule-Book.pdf"
          className="text-brand-lime font-semibold hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          CSL Rule Book
        </a>
      </p>
    ),
  },
  {
    q: 'When are the games?',
    a: (
      <ul className="list-disc list-inside space-y-1">
        <li><span className="font-semibold text-white">Sunday</span> 5–11PM</li>
        <li><span className="font-semibold text-white">Monday & Wednesday:</span> 9:15–11:15PM</li>
      </ul>
    ),
  },
  {
    q: 'Where are the games held?',
    a: (
      <ul className="list-disc list-inside space-y-1">
        <li><span className="font-semibold text-white">Sunday & Monday:</span> Burnhamthorpe Community Centre</li>
        <li><span className="font-semibold text-white">Wednesday:</span> Carmen Corbasson Community Centre</li>
      </ul>
    ),
  },
  {
    q: 'How many players can be on a team?',
    a: (
      <p>
        A maximum of 13 players, with a minimum of 7 players (if signed up as a team).
      </p>
    ),
  },
];

const FAQ: React.FC = () => {
  return (
    <div className="min-h-screen bg-brand-black pt-24 pb-16 px-4">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex items-center gap-3">
          <span className="w-2 h-10 bg-brand-lime skew-x-[-12deg] block"></span>
          <h1 className="font-sports text-4xl font-bold text-white uppercase flex items-center gap-3">
            <HelpCircle className="w-8 h-8 text-brand-lime" />
            FAQ
          </h1>
        </div>

        <div className="bg-brand-dark border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
          <div className="grid grid-cols-1 divide-y divide-white/5">
            {faqs.map((item, idx) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-3">
                <div className="bg-black/30 md:border-r border-white/5 p-4 md:p-6">
                  <div className="text-white font-sports text-lg uppercase leading-tight">{item.q}</div>
                </div>
                <div className="col-span-2 p-4 md:p-6 text-gray-300 text-sm md:text-base leading-relaxed space-y-2">
                  {item.a}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FAQ;
