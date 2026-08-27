import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../common/components/AppLayout';
import { PlaceholderPage } from '../common/components/PlaceholderPage';
import { PreferencesPage } from '../modules/profile/pages/PreferencesPage';

export function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/goals" replace />} />
        <Route path="/dashboard" element={<PlaceholderPage title="Dashboard" />} />
        <Route path="/meal-plan" element={<PlaceholderPage title="Meal Plan" />} />
        <Route path="/recipes" element={<PlaceholderPage title="Recipes" />} />
        <Route path="/shopping-list" element={<PlaceholderPage title="Shopping List" />} />
        <Route path="/goals" element={<PreferencesPage />} />
      </Routes>
    </AppLayout>
  );
}
