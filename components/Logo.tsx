
import React from 'react';

interface LogoProps {
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ className = "h-8 w-auto" }) => {
  // Expect a logo file at public/logo.png (update the path if you place it elsewhere)
  return <img src="/logo.png" alt="Logo" className={className} aria-label="Site Logo" />;
};

export default Logo;
