import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { useAppData } from './hooks/usePlans';
import Dashboard from './pages/Dashboard';
import PlansList from './pages/PlansList';
import PlanForm from './pages/PlanForm';
import PlanDetail from './pages/PlanDetail';
import Settings from './pages/Settings';

const NAV_ITEMS = [
  { to: '/', label: '今日', icon: '📅', end: true },
  { to: '/plans', label: 'プラン', icon: '📚', end: false },
  { to: '/settings', label: '設定', icon: '⚙️', end: false },
] as const;

export default function App() {
  const api = useAppData();

  return (
    <HashRouter>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <h1 className="shrink-0 text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              <span className="text-indigo-600">Study</span>Schedule
            </h1>
            <nav className="flex shrink-0 gap-1">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition sm:px-3 ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                    }`
                  }
                >
                  <span className="mr-1 hidden xs:inline" aria-hidden>
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 pb-16">
          {api.isLoaded ? (
            <Routes>
              <Route path="/" element={<Dashboard api={api} />} />
              <Route path="/plans" element={<PlansList api={api} />} />
              <Route path="/plans/new" element={<PlanForm api={api} />} />
              <Route path="/plans/:planId" element={<PlanDetail api={api} />} />
              <Route path="/plans/:planId/edit" element={<PlanForm api={api} />} />
              <Route path="/settings" element={<Settings api={api} />} />
              <Route path="*" element={<Dashboard api={api} />} />
            </Routes>
          ) : (
            <p className="py-10 text-center text-sm text-slate-400">読み込み中…</p>
          )}
        </main>
      </div>
    </HashRouter>
  );
}
