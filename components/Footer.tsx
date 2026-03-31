
import React from 'react';
import { Link } from 'react-router-dom';
import { Instagram, Twitter, Facebook } from 'lucide-react';
import Logo from './Logo';

const Footer: React.FC = () => {
  return (
    <footer className="bg-brand-dark border-t border-white/10 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-1">
            <div className="mb-6">
              <Link to="/" aria-label="Go to home" className="inline-flex items-center">
                <Logo className="h-8 w-auto block -ml-1" />
              </Link>
            </div>
            <p className="text-gray-400 text-sm">
              The premier recreational basketball league. High-quality runs, professional stats, and a community like no other.
            </p>
          </div>
          
          <div>
            <h3 className="font-sports text-white text-lg mb-4 tracking-wider">LEAGUE</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li><Link to="/stats" className="hover:text-brand-lime">Schedule</Link></li>
              <li><Link to="/stats?tab=standings" className="hover:text-brand-lime">Standings</Link></li>
              <li><Link to="/stats?tab=leaders" className="hover:text-brand-lime">Stats Leaders</Link></li>
              <li><Link to="/register" className="hover:text-brand-lime">Register Team</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-sports text-white text-lg mb-4 tracking-wider">INFO</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li><Link to="/about" className="hover:text-brand-lime">About Us</Link></li>
              {/* <li><Link to="/rules" className="hover:text-brand-lime">Rules & Regulations</Link></li> */}
              <li><Link to="/faq" className="hover:text-brand-lime">FAQ</Link></li>
              <li><Link to="/contact" className="hover:text-brand-lime">Contact Us</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-sports text-white text-lg mb-4 tracking-wider">FOLLOW US</h3>
            <div className="flex space-x-4">
              <a href="https://www.instagram.com/courtsightleague?igsh=MTViajM1ZjdnbHdtMQ==" target="_blank" rel="noreferrer" className="text-gray-400 hover:text-brand-lime transition-colors">
                <Instagram size={24} />
              </a>
              <a href="#" className="text-gray-400 hover:text-brand-lime transition-colors">
                <Twitter size={24} />
              </a>
              <a href="#" className="text-gray-400 hover:text-brand-lime transition-colors">
                <Facebook size={24} />
              </a>
            </div>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-white/5 text-center text-xs text-gray-600">
          &copy; {new Date().getFullYear()} Courtsight League. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

export default Footer;
