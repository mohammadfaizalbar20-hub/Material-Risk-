/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PpicProvider, usePpic } from './context/PpicContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { DashboardView } from './components/views/DashboardView';
import { UploadExcelView } from './components/views/UploadExcelView';
import { MaterialSummaryView } from './components/views/MaterialSummaryView';
import { ProductionScheduleView } from './components/views/ProductionScheduleView';
import { MaterialRiskAnalysisView } from './components/views/MaterialRiskAnalysisView';
import { AiAssistantView } from './components/views/AiAssistantView';
import { SettingsView } from './components/views/SettingsView';

const MainLayout: React.FC = () => {
  const { activeMenu } = usePpic();

  const renderActiveView = () => {
    switch (activeMenu) {
      case 'Dashboard':
        return <DashboardView />;
      case 'Upload Excel':
        return <UploadExcelView />;
      case 'Rekap Material':
        return <MaterialSummaryView />;
      case 'Penjadwalan Produksi':
        return <ProductionScheduleView />;
      case 'Material Risk Analysis':
        return <MaterialRiskAnalysisView />;
      case 'AI Assistant':
        return <AiAssistantView />;
      case 'Pengaturan':
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col antialiased">
      {/* Slide-out Sidebar Drawer (Hidden by default, opened via hamburger) */}
      <Sidebar />

      {/* Main Content Area - Expands to full screen width with clean padding */}
      <div className="flex-1 flex flex-col min-w-0 w-full transition-all duration-300">
        <Header />

        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {renderActiveView()}
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <PpicProvider>
      <MainLayout />
    </PpicProvider>
  );
}
