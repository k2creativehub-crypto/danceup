import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

interface NavItem {
  to: string;
  label: string;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/crm', label: 'CRM' },
  { to: '/groups', label: 'Группы' },
  { to: '/attendance', label: 'Посещаемость' },
  { to: '/pricing', label: 'Цены и расписание', adminOnly: true },
  { to: '/billing', label: 'Оплаты и счета', adminOnly: true },
  { to: '/teachers', label: 'Преподаватели', adminOnly: true },
];

export default function Layout() {
  const { profile, session, signOut } = useAuth();
  const isAdmin = profile?.role === 'admin';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">CRM школы танцев</div>
        <div className="topbar-right">
          <span className="who muted">
            {session?.user.email} · {isAdmin ? 'админ' : 'учитель'}
          </span>
          <button className="btn btn-ghost" onClick={signOut}>Выйти</button>
        </div>
      </header>
      <nav className="nav">
        {NAV.filter((i) => !i.adminOnly || isAdmin).map((i) => (
          <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            {i.label}
          </NavLink>
        ))}
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
