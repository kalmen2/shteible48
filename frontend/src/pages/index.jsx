import Layout from './Layout.jsx';
import Members from './Members';
import MemberDetail from './MemberDetail';
import Transactions from './Transactions';
import Calendar from './Calendar';
import EmailManagement from './EmailManagement';
import Dashboard from './Dashboard';
import Guests from './Guests';
import GuestDetail from './GuestDetail';
import Months from './Months';
import Settings from './Settings';
import Landing from './Landing';
import SaveCard from './SaveCard';
import ProtectedRoute from '@/components/ProtectedRoute';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';

const PAGES = {
  Members: Members,
  MemberDetail: MemberDetail,
  Transactions: Transactions,
  Calendar: Calendar,
  EmailManagement: EmailManagement,
  Dashboard: Dashboard,
  Guests: Guests,
  GuestDetail: GuestDetail,
  Months: Months,
  Settings: Settings,
};

function _getCurrentPage(url) {
  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  let urlLastPart = url.split('/').pop();
  if (urlLastPart.includes('?')) {
    urlLastPart = urlLastPart.split('?')[0];
  }

  const pageName = Object.keys(PAGES).find(
    (page) => page.toLowerCase() === urlLastPart.toLowerCase()
  );
  return pageName || Object.keys(PAGES)[0];
}

// Create a wrapper component that uses useLocation inside the Router context
function PagesContent() {
  const location = useLocation();
  const currentPage = _getCurrentPage(location.pathname);

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/save-card" element={<SaveCard />} />

      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout currentPageName={currentPage}>
              <Routes>
                <Route path="/Members" element={<Members />} />
                <Route path="/MemberDetail" element={<MemberDetail />} />
                <Route path="/Transactions" element={<Transactions />} />
                <Route path="/Calendar" element={<Calendar />} />
                <Route path="/EmailManagement" element={<EmailManagement />} />
                <Route path="/Dashboard" element={<Dashboard />} />
                <Route path="/Guests" element={<Guests />} />
                <Route path="/GuestDetail" element={<GuestDetail />} />
                <Route path="/Months" element={<Months />} />
                <Route path="/Settings" element={<Settings />} />
                <Route path="*" element={<Members />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default function Pages() {
  return (
    <Router>
      <PagesContent />
    </Router>
  );
}
