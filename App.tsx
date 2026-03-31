
import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import ScheduleStats from './pages/ScheduleStats';
import BoxScore from './pages/BoxScore';
import Registration from './pages/Registration';
import LeagueRegistration from './pages/LeagueRegistration';
import RegistrationSuccess from './pages/RegistrationSuccess';
import Login from './pages/Login';
import MySeason from './pages/MySeason';
import MyTeam from './pages/MyTeam';
import PlayerProfile from './pages/PlayerProfile';
import MyPhotos from './pages/MyPhotos';
import MyProfile from './pages/MyProfile';
import ManageTeam from './pages/ManageTeam';
import UnpaidPlayers from './pages/UnpaidPlayers';
import About from './pages/About';
import FAQ from './pages/FAQ';
import AdminDashboard from './pages/AdminDashboard';
import AddTeam from './pages/AddTeam';
import AddGame from './pages/AddGame';
import AdminPlayer from './pages/AdminPlayer';
import AuthCallback from './pages/AuthCallback';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ClaimProfile from './pages/ClaimProfile';
import Maintenance from './pages/Maintenance';
import LoadingOverlay from './components/LoadingOverlay';

const ContactPage = () => (
    <div className="min-h-screen bg-brand-black pt-24 pb-12 px-4 flex justify-center items-center">
        <div className="max-w-md w-full bg-brand-dark p-8 rounded-xl border border-white/10">
            <h1 className="font-sports text-3xl text-white mb-6 uppercase">Contact Us</h1>
            <form className="space-y-4">
                <div>
                    <label className="block text-brand-grey text-xs font-bold uppercase mb-1">Subject</label>
                    <input type="text" className="w-full bg-black border border-white/20 rounded p-3 text-white" />
                </div>
                <div>
                    <label className="block text-brand-grey text-xs font-bold uppercase mb-1">Message</label>
                    <textarea rows={4} className="w-full bg-black border border-white/20 rounded p-3 text-white"></textarea>
                </div>
                <button className="w-full bg-brand-lime text-black font-bold py-3 rounded uppercase font-sports tracking-wider">Send Message</button>
            </form>
        </div>
    </div>
)

const AppShell: React.FC = () => {
  const location = useLocation();
  const [pageLoading, setPageLoading] = useState<boolean>(false);

  useEffect(() => {
    setPageLoading(true);
    const t = setTimeout(() => setPageLoading(false), 450); // brief shimmer on route change
    return () => clearTimeout(t);
  }, [location.pathname]);

  const showOverlay = pageLoading && location.pathname !== '/';

  return (
    <>
      {showOverlay && <LoadingOverlay message="Loading..." />}
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/stats" element={<ScheduleStats />} />
          <Route path="/boxscore/:gameId" element={<BoxScore />} />
          <Route path="/register" element={<LeagueRegistration />} />
          <Route path="/registertoday" element={<LeagueRegistration />} />
          <Route path="/portal/register" element={<Registration />} />
          <Route path="/register/success" element={<RegistrationSuccess />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/about" element={<About />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/login" element={<Login />} />
          
          {/* Member Pages */}
          <Route path="/my-season" element={<MySeason />} />
          <Route path="/my-team" element={<MyTeam />} />
          <Route path="/my-profile" element={<MyProfile />} />
          <Route path="/my-profile/*" element={<MyProfile />} />
          <Route path="/profile" element={<Navigate to="/my-profile" replace />} />
          <Route path="/player/:playerId" element={<PlayerProfile />} />
          <Route path="/team/:teamId/:teamSlug" element={<MyTeam />} />
          <Route path="/team/:teamId" element={<MyTeam />} />
          <Route path="/my-photos" element={<MyPhotos />} />
          <Route path="/manage-team" element={<ManageTeam />} />
          
          {/* Admin Pages */}
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/imports" element={<Navigate to="/admin?tab=imports" replace />} />
          <Route path="/admin/add-team" element={<AddTeam />} />
          <Route path="/admin/add-game" element={<AddGame />} />
          <Route path="/admin/player/:playerId" element={<AdminPlayer />} />
          <Route path="/admin/unpaid" element={<Navigate to="/admin?tab=unpaid" replace />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/claim" element={<ClaimProfile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </>
  );
};

const showMaintenance = import.meta.env.VITE_SITE_MAINTENANCE_MODE === 'true';

const App: React.FC = () => {
  if (showMaintenance) {
    return <Maintenance />;
  }
  return (
    <Router>
      <AppShell />
    </Router>
  );
};

export default App;
