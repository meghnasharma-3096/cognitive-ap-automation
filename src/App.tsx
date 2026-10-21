/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  CheckCircle2, 
  HelpCircle, 
  Settings, 
  Zap, 
  Inbox, 
  TrendingUp, 
  Clock, 
  AlertCircle,
  AlertTriangle,
  Search,
  Bell,
  User,
  MoreHorizontal,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  Download,
  ExternalLink,
  Cpu,
  Users,
  Package,
  BarChart3,
  Layers,
  ClipboardList,
  RefreshCw,
  Upload
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { ReconciliationTable } from './components/ReconciliationTable';
import { ThreeWayMatch } from './components/ThreeWayMatch';
import { ReportingModule } from './components/ReportingModule';
import { IntelligenceModule } from './components/IntelligenceModule';
import { Modal } from './components/Modal';
import { supabase } from './services/supabase';
import { runMatchApi } from './services/matchApi';
import { populateDummyData, addData, getAllData, updateDocumentStatus, TABLES } from './services/dbService';
import { IngestPanel } from './components/IngestPanel';
import { resetDatabase } from './services/supabase';
import { downloadCSV, fileToBase64 } from './utils/helpers';

// --- Types ---

type Intent = 'Invoice' | 'Acknowledgement' | 'Inquiry';
type Status = 'Auto-posted' | 'Matched' | 'Needs Review';
type View = 'Overview' | 'Acknowledgements' | 'Matches' | 'Reports' | 'Vendors' | 'Inventory' | 'Intelligence';

interface Document {
  id: string;
  vendor_name: string;
  document_name: string;
  intent: Intent;
  confidence_score: number;
  status: Status;
  timestamp: string;
  processing_ms?: number | null;
}

// --- Utilities ---

const isWithinLast24Hours = (dateStr: string) => {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    return diff >= 0 && diff <= 24 * 60 * 60 * 1000;
  } catch (e) {
    return false;
  }
};

const formatTimestamp = (dateStr: string) => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    
    // Extract both date and time as requested
    return date.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  } catch (e) {
    return '';
  }
};

// --- Components ---

const Sidebar = ({ active, setActive }: { active: View, setActive: (v: View) => void }) => {
  const navItems = [
    { name: 'Overview' as View, icon: LayoutDashboard },
    { name: 'Acknowledgements' as View, icon: CheckCircle2 },
    { name: 'Matches' as View, icon: Layers },
    { name: 'Reports' as View, icon: ClipboardList },
    { name: 'Intelligence' as View, icon: BarChart3 },
  ];

  return (
    <aside className="w-64 bg-brand-sidebar border-r border-brand-border flex flex-col h-screen sticky top-0">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-brand-accent rounded-lg flex items-center justify-center">
          <Zap className="text-white w-5 h-5 fill-current" />
        </div>
        <span className="font-bold text-xl tracking-tight text-white">Cognitive AP</span>
      </div>

      <nav className="flex-1 px-4 space-y-8 mt-4">
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 mb-4">Main Menu</p>
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.name}>
                <button
                  onClick={() => setActive(item.name)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors ${
                    active === item.name 
                      ? 'bg-brand-accent/10 text-brand-accent' 
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <item.icon size={18} />
                    <span className="text-sm font-medium">{item.name}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="p-4">
        <div className="bg-brand-card/50 border border-brand-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">System Status</span>
            <div className="w-2 h-2 bg-brand-success rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Match engine ready. Data is stored locally.
          </p>
          <div className="mt-3 h-1 bg-slate-800 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              className="h-full bg-brand-accent"
            />
          </div>
        </div>
      </div>
    </aside>
  );
};

const Header = () => {
  return (
    <header className="h-16 border-b border-brand-border flex items-center justify-between px-8 bg-brand-bg/80 backdrop-blur-md sticky top-0 z-10">
      <div className="flex items-center gap-8 flex-1">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input 
            type="text" 
            placeholder="Search POs, vendors, or items..." 
            className="w-full bg-slate-900/50 border border-brand-border rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-brand-accent transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="h-8 w-px bg-brand-border mx-2"></div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium text-white">M. Thompson</p>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Operations Lead</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-accent to-indigo-600 flex items-center justify-center border-2 border-brand-border overflow-hidden cursor-pointer">
            <img 
              src="https://picsum.photos/seed/thompson/100/100" 
              alt="User" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      </div>
    </header>
  );
};

const KPICard = ({ title, value, change, trend, icon: Icon, subtext }: any) => {
  return (
    <div className="glass-card p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="p-2 bg-slate-800 rounded-lg text-slate-400">
          <Icon size={20} />
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium ${trend === 'up' ? 'text-brand-success' : 'text-brand-danger'}`}>
          {trend === 'up' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {change}
        </div>
      </div>
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">{title}</p>
        <motion.h3 
          key={value}
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 0.3 }}
          className="text-3xl font-bold text-white font-mono tracking-tight"
        >
          {value}
        </motion.h3>
      </div>
      {subtext && <p className="text-[11px] text-slate-500">{subtext}</p>}
    </div>
  );
};

const STPCard = ({ rate }: { rate: number }) => {
  const target = 85;

  return (
    <div className="glass-card p-6 flex flex-col gap-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 p-6 opacity-10">
        <Zap size={80} className="text-brand-accent fill-current" />
      </div>
      
      <div className="flex items-center justify-between">
        <div className="p-2 bg-brand-accent/10 rounded-lg text-brand-accent">
          <Zap size={20} />
        </div>
        {rate > 0 && (
          <div className="flex items-center gap-1 text-xs font-medium text-brand-success">
            <ArrowUpRight size={14} />
            System Optimized
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Straight Through (STP)</p>
        <div className="flex items-baseline gap-2">
          <motion.h3 
            key={rate}
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 0.3 }}
            className="text-3xl font-bold text-white font-mono tracking-tight"
          >
            {rate}%
          </motion.h3>
          <span className="text-[10px] font-bold text-brand-success uppercase tracking-widest bg-brand-success/10 px-1.5 py-0.5 rounded">
            Above Target
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${rate}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="h-full bg-gradient-to-r from-brand-accent to-indigo-500"
          />
        </div>
        <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          <span>Target: {target}%</span>
          <span>Current: {rate}%</span>
        </div>
      </div>
    </div>
  );
};

const IntentCard = ({ intent, count, description, color, onClick }: any) => {
  const icons = {
    Invoice: FileText,
    Acknowledgement: CheckCircle2,
    Inquiry: HelpCircle
  };
  const Icon = icons[intent as keyof typeof icons];

  return (
    <div 
      onClick={onClick}
      className={`glass-card p-6 border-l-4 ${color} hover:translate-y-[-4px] transition-transform cursor-pointer group`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className={`p-2 rounded-lg ${color.replace('border-l-', 'bg-').replace('500', '500/10')} ${color.replace('border-l-', 'text-')}`}>
          <Icon size={24} />
        </div>
        <span className="text-2xl font-bold text-white font-mono">{(count || 0).toLocaleString()}</span>
      </div>
      <h4 className="text-lg font-bold text-white mb-1 group-hover:text-brand-accent transition-colors">{intent === 'Inquiry' ? 'Inquiries' : `${intent}s`}</h4>
      <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
      
      <div className="mt-6 pt-6 border-t border-brand-border flex items-center justify-between">
        <div className="flex -space-x-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="w-6 h-6 rounded-full border-2 border-brand-card bg-slate-800 overflow-hidden">
              <img src={`https://picsum.photos/seed/user${i}/50/50`} alt="" referrerPolicy="no-referrer" />
            </div>
          ))}
          <div className="w-6 h-6 rounded-full border-2 border-brand-card bg-slate-800 flex items-center justify-center text-[8px] font-bold text-slate-400">
            +5
          </div>
        </div>
        <button className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-white transition-colors flex items-center gap-1">
          Assigned Agents <ExternalLink size={10} />
        </button>
      </div>
    </div>
  );
};

const DocumentFeed = ({ docs, isLoading, activeTab, setActiveTab }: { docs: Document[], isLoading: boolean, activeTab: 'All' | Intent, setActiveTab: (t: 'All' | Intent) => void }) => {
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');

  // Filtering logic
  const filteredDocs = useMemo(() => {
    let result = docs;

    // 1. Filter by Tab (Intent)
    if (activeTab !== 'All') {
      result = result.filter(doc => doc.intent === activeTab);
    }

    // 2. Filter by Search Query
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(doc => {
        if (!doc) return false;
        const id = (doc.id || '').toLowerCase();
        const vendor = (doc.vendor_name || 'N/A').toLowerCase();
        const intent = (doc.intent || 'N/A').toLowerCase();
        const status = (doc.status || 'N/A').toLowerCase();
        
        return id.includes(lowerQuery) ||
               vendor.includes(lowerQuery) ||
               intent.includes(lowerQuery) ||
               status.includes(lowerQuery);
      });
    }

    return result;
  }, [docs, searchQuery, activeTab]);

  // Pagination logic
  const totalPages = Math.ceil(filteredDocs.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedDocs = filteredDocs.slice(startIndex, startIndex + rowsPerPage);

  // Reset to page 1 if rowsPerPage, searchQuery, or activeTab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [rowsPerPage, searchQuery, activeTab]);

  const getStatusColor = (status: Status) => {
    switch (status) {
      case 'Auto-posted': return 'bg-brand-success/10 text-brand-success';
      case 'Matched': return 'bg-brand-accent/10 text-brand-accent';
      case 'Needs Review': return 'bg-brand-warning/10 text-brand-warning';
    }
  };

  const getIntentColor = (intent: Intent) => {
    switch (intent) {
      case 'Invoice': return 'bg-blue-500/10 text-blue-400';
      case 'Acknowledgement': return 'bg-emerald-500/10 text-emerald-400';
      case 'Inquiry': return 'bg-amber-500/10 text-amber-400';
    }
  };

  const SkeletonRow = () => (
    <tr className="animate-pulse border-b border-brand-border">
      <td className="px-6 py-4">
        <div className="h-4 w-24 bg-slate-800 rounded mb-2"></div>
        <div className="h-3 w-16 bg-slate-800/50 rounded"></div>
      </td>
      <td className="px-6 py-4">
        <div className="h-4 w-32 bg-slate-800 rounded"></div>
      </td>
      <td className="px-6 py-4">
        <div className="h-6 w-20 bg-slate-800 rounded-full"></div>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-20 bg-slate-800 rounded-full"></div>
          <div className="h-3 w-8 bg-slate-800 rounded"></div>
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="h-6 w-24 bg-slate-800 rounded-full"></div>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="h-8 w-8 bg-slate-800 rounded ml-auto"></div>
      </td>
    </tr>
  );

  return (
    <div className="glass-card overflow-hidden">
      {/* Intent Tabs */}
      <div className="px-6 pt-6 border-b border-brand-border/50">
        <div className="flex items-center gap-8">
          {(['All', 'Invoice', 'Acknowledgement', 'Inquiry'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-4 text-xs font-bold uppercase tracking-widest transition-all relative ${
                activeTab === tab 
                  ? 'text-brand-accent' 
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab === 'All' ? 'All Documents' : tab === 'Inquiry' ? 'Inquiries' : `${tab}s`}
              {activeTab === tab && (
                <motion.div 
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-accent"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 border-b border-brand-border flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-white">Live Ingestion Stream</h3>
          <p className="text-xs text-slate-500">Real-time processing queue and AI confidence scores</p>
        </div>
        
        <div className="flex flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input 
            type="text" 
            placeholder="Search documents or vendors..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900/50 border border-brand-border rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-brand-accent transition-colors text-slate-200"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-brand-border">
              <th className="px-6 py-4">Document ID</th>
              <th className="px-6 py-4">Vendor</th>
              <th className="px-6 py-4">Intent</th>
              <th className="px-6 py-4">Confidence</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
            ) : filteredDocs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-slate-500">
                    <Search size={32} className="opacity-20" />
                    <p className="text-sm font-medium">No documents found matching "{searchQuery}"</p>
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="text-xs text-brand-accent hover:underline mt-2"
                    >
                      Clear search
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <AnimatePresence initial={false}>
                {paginatedDocs.map((doc) => (
                  <motion.tr 
                    key={doc.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="group hover:bg-white/2 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-white">{doc.id}</span>
                        <span className="text-[10px] text-slate-500">{formatTimestamp(doc.timestamp)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-300">{doc.vendor_name}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`status-badge ${getIntentColor(doc.intent)}`}>
                        {doc.intent}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 w-20 bg-slate-800 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${doc.confidence_score > 90 ? 'bg-brand-success' : 'bg-brand-warning'}`}
                            style={{ width: `${doc.confidence_score}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono font-medium text-slate-300">{doc.confidence_score}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`status-badge ${getStatusColor(doc.status)}`}>
                        {doc.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => setSelectedDoc(doc)}
                        className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            )}
          </tbody>
        </table>
      </div>
      
      <div className="p-4 border-t border-brand-border bg-slate-900/20 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">Rows per page:</span>
            <select 
              value={rowsPerPage}
              onChange={(e) => setRowsPerPage(Number(e.target.value))}
              className="bg-slate-800 border border-brand-border text-slate-300 text-xs rounded-lg focus:ring-brand-accent focus:border-brand-accent p-1 outline-none"
              disabled={isLoading}
            >
              {[10, 20, 30, 50, 100].map(val => (
                <option key={val} value={val}>{val}</option>
              ))}
            </select>
          </div>
          <span className="text-xs text-slate-500">
            Showing {filteredDocs.length > 0 ? startIndex + 1 : 0} to {Math.min(startIndex + rowsPerPage, filteredDocs.length)} of {filteredDocs.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1 || isLoading}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 rounded-lg text-xs font-medium transition-colors"
          >
            Previous
          </button>
          <button 
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages || totalPages === 0 || isLoading}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 rounded-lg text-xs font-medium transition-colors"
          >
            Next
          </button>
        </div>
      </div>

      <Modal
        isOpen={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        title="Document Details"
      >
        {selectedDoc && (
          <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Document ID</p>
            <p className="text-sm font-bold text-white">{selectedDoc.id || 'N/A'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vendor</p>
            <p className="text-sm font-bold text-white">{selectedDoc?.vendor_name || 'Unknown Vendor'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Intent</p>
            <p className="text-sm font-bold text-white">{selectedDoc.intent || 'N/A'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Confidence Score</p>
            <p className="text-sm font-bold text-white font-mono">{selectedDoc.confidence_score || 0}%</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</p>
            <p className="text-sm font-bold text-white">{selectedDoc.status || 'N/A'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Ingested</p>
            <p className="text-sm font-bold text-white">{formatTimestamp(selectedDoc.timestamp || new Date().toISOString())}</p>
          </div>
        </div>
            <div className="p-4 bg-slate-900/50 border border-brand-border rounded-xl">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">AI Extraction Summary</p>
              <p className="text-xs text-slate-300 leading-relaxed">
                The AI model has successfully extracted line item data with {selectedDoc.confidence_score || 0}% confidence. 
                All mandatory fields (Vendor, Amount, Date) were identified. 
                {selectedDoc.status === 'Needs Review' ? ' Manual verification is required due to low confidence in tax ID extraction.' : ' The document has been auto-categorized and routed to the matching engine.'}
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [activeView, setActiveView] = useState<View>('Overview');
  const [docs, setDocs] = useState<Document[]>([]);
  const [clusterPendingDocs, setClusterPendingDocs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState<'all' | '24h'>('all');
  const [feedTab, setFeedTab] = useState<'All' | Intent>('All');

  const filteredDocs = useMemo(() => {
    if (timeFilter === 'all') return docs;
    return docs.filter(doc => isWithinLast24Hours(doc.timestamp));
  }, [docs, timeFilter]);

  const metrics = useMemo(() => {
    // Total Ingested: Set this to the total length of the fetched IngestedDocuments array
    const total = docs.length;
    
    // Pending Review: Calculate this by filtering the array: documents.filter(doc => doc.status === 'Needs Review' || (doc.status as string) === 'Pending' || (doc.status as string) === 'Requires Review').length
    const pending = docs.filter(doc => doc.status === 'Needs Review' || (doc.status as string) === 'Pending' || (doc.status as string) === 'Requires Review').length;
    
    // STP (Straight Through Processing): Calculate this dynamically using the formula: ((Total Ingested - Pending Review) / Total Ingested) * 100
    // Round it to one decimal place. Prevent division by zero if Total Ingested is 0.
    const stp = total > 0 ? Number((((total - pending) / total) * 100).toFixed(1)) : 0;
    
    const intents = {
      Invoice: filteredDocs.filter(d => d.intent === 'Invoice').length,
      Acknowledgement: filteredDocs.filter(d => d.intent === 'Acknowledgement').length,
      Inquiry: filteredDocs.filter(d => d.intent === 'Inquiry').length,
    };

    const timed = docs.filter(d => typeof d.processing_ms === 'number') as (Document & { processing_ms: number })[];
    const avgMs = timed.length ? timed.reduce((a, d) => a + d.processing_ms, 0) / timed.length : null;
    return { total, stp, pending, intents, avgMs };
  }, [docs, filteredDocs]);

  const fetchDocs = async () => {
    try {
      const ingested = await getAllData(TABLES.ingestedDocuments);
      setDocs(
        [...ingested]
          .sort((x, y) => String(y.ingestion_date).localeCompare(String(x.ingestion_date)))
          .map(d => ({ ...d, timestamp: d.ingestion_date }))
      );
    } catch (err) {
      console.error('Failed to fetch documents:', err);
      toast.error('Failed to load documents');
    }
  };

  const refreshMetrics = async () => {
    await fetchDocs();
    try {
      const clusters = await getAllData(TABLES.documentClusters);
      const pendingCount = clusters
        .filter(c => c.status === 'Requires Review')
        .reduce((sum, c) => sum + (c.document_count || 0), 0);
      setClusterPendingDocs(pendingCount);
    } catch (err) {
      console.error('Failed to fetch clusters for metrics:', err);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        // Only populate if needed, or just fetch
        const existing = await getAllData(TABLES.purchaseOrders);
        if (existing.length === 0) {
          await populateDummyData();
        }
        await refreshMetrics();
        console.log('Simulation data initialized in Supabase');
      } catch (err) {
        console.error('Failed to initialize simulation data:', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleReset = async () => {
    if (!window.confirm('Reset all data back to the original sample set? Anything you ingested will be removed.')) return;
    const r = await resetDatabase();
    if (r.error) { toast.error('Reset failed'); return; }
    toast.success('Data reset to the sample set');
    await refreshMetrics();
  };

  const runBatchProcessing = async () => {
    const toastId = toast.loading('Batch Processing: running three-way match...');
    try {
      const result = await runMatchApi();
      if (result.processed === 0) {
        toast.info('No pending invoices found for processing.', { id: toastId });
        return;
      }
      toast.success('Batch Processing Complete', {
        id: toastId,
        description: `Processed ${result.processed} invoices. Success: ${result.success}, Exceptions: ${result.exceptions}`,
        duration: 5000
      });
      await refreshMetrics();
    } catch (err) {
      console.error(err);
      toast.error('Batch processing failed. Check console for details.', { id: toastId });
    }
  };

  const handleExportBatchReport = async () => {
    const toastId = toast.loading('Fetching batch reports from Supabase...');
    try {
      const success = await getAllData(TABLES.successReports);
      const exceptions = await getAllData(TABLES.exceptionReports);
      
      const combined = [
        ...success.map(r => ({ ...r, type: 'SUCCESS' })),
        ...exceptions.map(r => ({ ...r, type: 'EXCEPTION' }))
      ];

      if (combined.length === 0) {
        toast.error('No reports found to export.', { id: toastId });
        return;
      }

      downloadCSV(combined, 'batch_report');
      toast.success('Batch report exported successfully.', { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error('Failed to export reports.', { id: toastId });
    }
  };

  return (
    <div className="flex min-h-screen bg-brand-bg">
      <Toaster position="top-right" theme="dark" richColors />
      <Sidebar active={activeView} setActive={setActiveView} />
      
      <main className="flex-1 flex flex-col min-w-0">
        <Header />
        
        <div className="p-8 max-w-7xl mx-auto w-full space-y-8">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
              <RefreshCw className="animate-spin text-brand-accent" size={48} />
              <p className="text-slate-400 font-medium animate-pulse">Initializing Cognitive Engine...</p>
            </div>
          ) : activeView === 'Overview' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="flex items-end justify-between">
                <div>
                  <h1 className="text-4xl font-bold text-white tracking-tight mb-2">Automation Hub</h1>
                  <p className="text-slate-400">Real-time document ingestion and AI categorization overview.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setTimeFilter(prev => prev === 'all' ? '24h' : 'all')}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      timeFilter === '24h' 
                        ? 'bg-brand-accent text-white shadow-lg shadow-brand-accent/20' 
                        : 'bg-slate-800 hover:bg-slate-700 text-white'
                    }`}
                  >
                    <Clock size={16} /> Last 24h
                  </button>
                  <button 
                    data-testid="reset-data"
                    onClick={handleReset}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-colors border border-brand-border flex items-center gap-2"
                  >
                    <RefreshCw size={16} /> Reset Data
                  </button>
                  <button 
                    onClick={runBatchProcessing}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-colors border border-brand-border flex items-center gap-2"
                  >
                    <Cpu size={16} /> Run Batch Processing
                  </button>
                </div>
              </div>

              <IngestPanel onDone={refreshMetrics} />

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <STPCard rate={metrics.stp} />
                <KPICard 
                  title="Total Ingested" 
                  value={(metrics.total || 0).toLocaleString()} 
                  change={timeFilter === '24h' ? "Filtered" : "Live Data"} 
                  trend="up" 
                  icon={Inbox}
                  subtext={timeFilter === '24h' ? "Showing last 24 hours" : "Total documents in system"}
                />
                <KPICard 
                  title="Avg Processing Time" 
                  value={metrics.avgMs === null ? '–' : (metrics.avgMs < 1000 ? `${Math.round(metrics.avgMs)}ms` : `${(metrics.avgMs / 1000).toFixed(1)}s`)} 
                  change={metrics.avgMs === null ? 'No data' : 'Measured'} 
                  trend="down" 
                  icon={Clock}
                  subtext="Average read time of documents ingested live"
                />
                <KPICard 
                  title="Pending Review" 
                  value={(metrics.pending || 0).toLocaleString()} 
                  change={timeFilter === '24h' ? "Filtered" : "Action Required"} 
                  trend={metrics.pending > 0 ? "down" : "up"} 
                  icon={AlertCircle}
                  subtext={timeFilter === '24h' ? "Requiring manual triage" : "Documents awaiting processing"}
                />
              </div>

              <section>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-white">Intent Categorization</h2>
                  <button 
                    onClick={() => setActiveView('Intelligence')}
                    className="text-xs font-bold text-brand-accent uppercase tracking-widest hover:underline"
                  >
                    View All Clusters
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <IntentCard 
                    intent="Invoice" 
                    count={metrics.intents.Invoice} 
                    description="Financial requests requiring multi-point verification and GL coding." 
                    color="border-l-blue-500"
                    onClick={() => setFeedTab('Invoice')}
                  />
                  <IntentCard 
                    intent="Acknowledgement" 
                    count={metrics.intents.Acknowledgement} 
                    description="Payment confirmations and receipts requiring archival and matching." 
                    color="border-l-emerald-500"
                    onClick={() => setFeedTab('Acknowledgement')}
                  />
                  <IntentCard 
                    intent="Inquiry" 
                    count={metrics.intents.Inquiry} 
                    description="Vendor questions and support tickets requiring NLP triage." 
                    color="border-l-amber-500"
                    onClick={() => setFeedTab('Inquiry')}
                  />
                </div>
              </section>

              <section>
                <DocumentFeed 
                  docs={filteredDocs} 
                  isLoading={loading} 
                  activeTab={feedTab}
                  setActiveTab={setFeedTab}
                />
              </section>
            </motion.div>
          )}

          {activeView === 'Acknowledgements' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="flex items-end justify-between">
                <div>
                  <h1 className="text-4xl font-bold text-white tracking-tight mb-2">Acknowledgement Queue</h1>
                  <p className="text-slate-400">Real-time reconciliation of unstructured vendor confirmations vs. ERP records.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                    <Download size={16} /> Export CSV
                  </button>
                  <button className="px-4 py-2 bg-brand-accent hover:bg-brand-accent/90 text-white rounded-lg text-sm font-bold transition-colors shadow-lg shadow-brand-accent/20 flex items-center gap-2">
                    <RefreshCw size={16} className="animate-spin-slow" /> Sync ERP
                  </button>
                </div>
              </div>

              <ReconciliationTable />
            </motion.div>
          )}

          {activeView === 'Matches' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="flex items-end justify-between">
                <div>
                  <h1 className="text-4xl font-bold text-white tracking-tight mb-2">3-Way Match Overview</h1>
                  <p className="text-slate-400">Reconciling purchase orders, goods receipts and vendor invoices.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                    <Filter size={16} /> Filter
                  </button>
                  <button 
                    onClick={handleExportBatchReport}
                    className="px-4 py-2 bg-brand-accent hover:bg-brand-accent/90 text-white rounded-lg text-sm font-bold transition-colors shadow-lg shadow-brand-accent/20 flex items-center gap-2"
                  >
                    <Download size={16} /> Export Report
                  </button>
                </div>
              </div>

              <ThreeWayMatch />
            </motion.div>
          )}

          {activeView === 'Reports' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="flex items-end justify-between">
                <div>
                  <h1 className="text-4xl font-bold text-white tracking-tight mb-2">Operational Reports</h1>
                  <p className="text-slate-400">Detailed analysis of batch processing results and matching exceptions.</p>
                </div>
              </div>

              <ReportingModule />
            </motion.div>
          )}

          {activeView === 'Intelligence' && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <IntelligenceModule onRefresh={refreshMetrics} />
            </motion.div>
          )}

          {activeView !== 'Overview' && activeView !== 'Acknowledgements' && activeView !== 'Matches' && activeView !== 'Reports' && activeView !== 'Intelligence' && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <Cpu size={64} className="opacity-10 mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">{activeView} Module</h2>
              <p className="text-sm">This module is currently being optimized by the AI engine.</p>
              <button 
                onClick={() => setActiveView('Overview')}
                className="mt-6 text-brand-accent font-bold text-sm hover:underline"
              >
                Return to Dashboard
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
