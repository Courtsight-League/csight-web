import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';

const RegistrationSuccess: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [countdown, setCountdown] = useState(6);

  const nextPath = searchParams.get('next') || '/login';
  const message =
    (location.state as { message?: string } | null)?.message ||
    'Thanks for registering! We saved your spot and you can complete payment anytime.';

  useEffect(() => {
    const tick = window.setInterval(() => {
      setCountdown((prev) => Math.max(prev - 1, 0));
    }, 1000);
    const redirectTimer = window.setTimeout(() => {
      navigate(nextPath, { replace: true });
    }, 6000);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(redirectTimer);
    };
  }, [navigate, nextPath]);

  return (
    <div className="min-h-screen bg-brand-black px-4 py-20 flex items-center justify-center">
      <div className="max-w-xl w-full bg-black/70 border border-white/10 rounded-2xl p-10 text-center shadow-2xl">
        <h1 className="text-3xl font-sports text-brand-lime uppercase mb-4">Registration Complete</h1>
        <p className="text-white text-base mb-6">{message}</p>
        <p className="text-sm text-gray-300 mb-6">Redirecting to login in {countdown}s...</p>
        <div className="flex flex-col gap-3">
          <Link
            to={nextPath}
            className="inline-flex items-center justify-center rounded-full bg-brand-lime text-black font-bold py-3 text-sm uppercase tracking-widest"
          >
            Go to Login Now
          </Link>
          <Link to="/" className="text-xs text-white/70">
            Return to the homepage instead
          </Link>
        </div>
      </div>
    </div>
  );
};

export default RegistrationSuccess;
