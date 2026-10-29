import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Crm from './pages/Crm';
import StudentCard from './pages/StudentCard';
import Groups from './pages/Groups';
import GroupPage from './pages/GroupPage';
import Soon from './pages/Soon';

export default function App() {
  const { loading, session, profile, profileError, signOut } = useAuth();

  if (loading) return <div className="center-screen muted">Загрузка…</div>;
  if (!session) return <Login />;

  if (!profile) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h1>Нет доступа</h1>
          <p className="muted">
            Для вашей учётной записи не настроен профиль. Обратитесь к администратору.
          </p>
          {profileError && <p className="error">{profileError}</p>}
          <button className="btn" onClick={signOut}>Выйти</button>
        </div>
      </div>
    );
  }

  const isAdmin = profile.role === 'admin';

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/crm" element={<Crm />} />
        <Route path="/students/:id" element={<StudentCard />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/groups/:id" element={<GroupPage />} />
        <Route path="/attendance" element={<Soon title="Посещаемость" />} />
        {isAdmin && <Route path="/pricing" element={<Soon title="Цены и расписание" />} />}
        {isAdmin && <Route path="/billing" element={<Soon title="Оплаты и счета" />} />}
        {isAdmin && <Route path="/teachers" element={<Soon title="Преподаватели" />} />}
        <Route path="*" element={<Navigate to="/crm" replace />} />
      </Route>
    </Routes>
  );
}
