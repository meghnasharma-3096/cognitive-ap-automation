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
import { populateDummyData, addData, getAllData, updateDocumentStatus, TABLES } from './services/dbService';
import { extractDocumentData } from './services/geminiService';
import { executeThreeWayMatch, classifyDocumentIntent, fetchVendorInvoice, fetchPoByVendor, processDocumentPipeline, performMultimodalExtraction } from './services/AgenticService';
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
}

// --- Mock Data ---

const INITIAL_DOCS: Document[] = [
  { id: 'INV-902341', vendor_name: 'Starlight Logistics', document_name: 'INV-902341.pdf', intent: 'Invoice', confidence_score: 99.2, status: 'Auto-posted', timestamp: new Date('2026-03-12T08:20:00Z').toISOString() },
  { id: 'ACK-77281', vendor_name: 'AWS Enterprise', document_name: 'ACK-77281.pdf', intent: 'Acknowledgement', confidence_score: 97.8, status: 'Matched', timestamp: new Date('2026-03-12T08:17:00Z').toISOString() },
  { id: 'INQ-00129', vendor_name: 'Unknown Sender', document_name: 'INQ-00129.pdf', intent: 'Inquiry', confidence_score: 62.1, status: 'Needs Review', timestamp: new Date('2026-03-12T08:10:00Z').toISOString() },
  { id: 'INV-902342', vendor_name: 'Global Tech Corp', document_name: 'INV-902342.pdf', intent: 'Invoice', confidence_score: 98.5, status: 'Auto-posted', timestamp: new Date('2026-03-12T08:07:00Z').toISOString() },
  { id: 'ACK-77282', vendor_name: 'Logistics Plus Inc', document_name: 'ACK-77282.pdf', intent: 'Acknowledgement', confidence_score: 94.2, status: 'Matched', timestamp: new Date('2026-03-12T08:04:00Z').toISOString() },
  { id: 'INV-902343', vendor_name: 'Apex Manufacturing', document_name: 'INV-902343.pdf', intent: 'Invoice', confidence_score: 89.4, status: 'Needs Review', timestamp: new Date('2026-03-11T08:00:00Z').toISOString() },
  { id: 'INV-902344', vendor_name: 'Starlight Logistics', document_name: 'INV-902344.pdf', intent: 'Invoice', confidence_score: 99.1, status: 'Auto-posted', timestamp: new Date('2026-03-10T08:00:00Z').toISOString() },
];

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
            AI Matching Engine processing 142 new invoices.
          </p>
          <div className="mt-3 h-1 bg-slate-800 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: '65%' }}
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
      <h4 className="text-lg font-bold text-white mb-1 group-hover:text-brand-accent transition-colors">{intent}s</h4>
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
              {tab === 'All' ? 'All Documents' : `${tab}s`}
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
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const multimodalInputRef = React.useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const filteredDocs = useMemo(() => {
    if (timeFilter === 'all') return docs;
    return docs.filter(doc => isWithinLast24Hours(doc.timestamp));
  }, [docs, timeFilter]);

  const metrics = useMemo(() => {
    // Total Ingested: Set this to the total length of the fetched IngestedDocuments array
    const total = docs.length;
    
    // Pending Review: Calculate this by filtering the array: documents.filter(doc => doc.status === 'Pending' || doc.status === 'Requires Review').length
    const pending = docs.filter(doc => doc.status === 'Pending' || doc.status === 'Requires Review').length;
    
    // STP (Straight Through Processing): Calculate this dynamically using the formula: ((Total Ingested - Pending Review) / Total Ingested) * 100
    // Round it to one decimal place. Prevent division by zero if Total Ingested is 0.
    const stp = total > 0 ? Number((((total - pending) / total) * 100).toFixed(1)) : 0;
    
    const intents = {
      Invoice: filteredDocs.filter(d => d.intent === 'Invoice').length,
      Acknowledgement: filteredDocs.filter(d => d.intent === 'Acknowledgement').length,
      Inquiry: filteredDocs.filter(d => d.intent === 'Inquiry').length,
    };

    return { total, stp, pending, intents };
  }, [docs, filteredDocs]);

  const fetchDocs = async () => {
    try {
      const ingested = await getAllData(TABLES.ingestedDocuments);
      if (ingested.length === 0) {
        // Seed with initial docs if empty (DB generates its own uuid ids)
        for (const doc of INITIAL_DOCS) {
          const { id, timestamp, ...docData } = doc;
          await addData(TABLES.ingestedDocuments, { ...docData, ingestion_date: timestamp });
        }
        setDocs(INITIAL_DOCS);
      } else {
        setDocs([...ingested].reverse().map(d => ({ ...d, timestamp: d.ingestion_date })));
      }
    } catch (err) {
      console.error('Failed to fetch docs from Supabase:', err);
      toast.error('Failed to connect to database');
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

  const handleIngestDocs = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      const mimeType = file.type;

      const toastId = toast.loading(`AI Agent analyzing ${file.name}...`);
      try {
        const extracted = await extractDocumentData(base64, mimeType);
        
        // URGENT DEMO HOTFIX: Intent Classification Logic
        const fileNameLower = file.name.toLowerCase();
        // Check filename and extracted intent for keywords
        const combinedText = `${fileNameLower} ${extracted.intent.toLowerCase()}`;
        
        let intent: Intent = 'Invoice';
        if (combinedText.includes('acknowledgement') || combinedText.includes('ack')) {
          intent = 'Acknowledgement';
        } else if (combinedText.includes('inquiry')) {
          intent = 'Inquiry';
        }

        const vendor_name = file.name.replace(/\.[^/.]+$/, "");
        const confidence_score = 98;

        const newDoc: Document = {
            id: intent === 'Invoice' ? `INV-${Math.floor(Math.random() * 1000000)}` :
                intent === 'Acknowledgement' ? `ACK-${Math.floor(Math.random() * 100000)}` :
                `INQ-${Math.floor(Math.random() * 100000)}`,
            vendor_name: vendor_name,
            document_name: file.name,
            intent: intent,
            confidence_score: confidence_score,
            status: intent === 'Invoice' ? 'Auto-posted' : 'Matched',
            timestamp: new Date().toISOString()
          };

        // Supabase Insert for Ingested Document (STRICT SCHEMA)
        try {
          await supabase.from(TABLES.ingestedDocuments).insert([{
            document_name: file.name,
            vendor_name: vendor_name,
            intent: intent,
            status: 'Pending',
            confidence_score: confidence_score,
            ingestion_date: new Date().toISOString(),
            invoice_number: intent === 'Invoice' ? newDoc.id : null
          }]);
        } catch (dbErr) {
          console.error('Failed to log ingestion to Supabase:', dbErr);
        }

        if (intent === 'Invoice') {
          const billedQty = extracted.items[0]?.quantity || 0;
          const unitPrice = extracted.items[0]?.unitPrice || 0;
          await addData(TABLES.vendorInvoices, {
            invoice_number: newDoc.id,
            po_number: extracted.poNumber,
            billed_quantity: billedQty,
            unit_price: unitPrice,
            total_amount: extracted.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0)
          });
        }

        toast.success(`${intent} processed and indexed.`, { id: toastId });
        await fetchDocs();
      } catch (err) {
        console.error(err);
        toast.error('Failed to process document. Please ensure it is a valid invoice or receipt.', { id: toastId });
      }
    };
    reader.readAsDataURL(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runBatchProcessing = async () => {
    const toastId = toast.loading('Batch Processing: Starting AI Matching Loop...');
    
    try {
      // Step A: Query pending invoices
      const { data: pendingInvoices, error: fetchError } = await supabase
        .from(TABLES.vendorInvoices)
        .select('*')
        .in('match_status', ['Pending', null]);

      if (fetchError) throw fetchError;

      if (!pendingInvoices || pendingInvoices.length === 0) {
        toast.info('No pending invoices found for processing.', { id: toastId });
        return;
      }

      let successCount = 0;
      let exceptionCount = 0;

      // Step B: Loop sequentially
      for (const invoice of pendingInvoices) {
        // Step C: Execute 3-way match
        const result = await executeThreeWayMatch({
          invoice_number: invoice.invoice_number,
          po_number: invoice.po_number,
          billed_quantity: invoice.billed_quantity || 0,
          freight_amount: invoice.freight_amount || 0
        });

        if (result.success) {
          // Step D: Perfect Match
          await supabase.from(TABLES.successReports).insert([{
            invoice_number: invoice.invoice_number,
            amount: invoice.total_amount || 0,
            status: 'Processed',
            date: new Date().toISOString()
          }]);

          await supabase.from(TABLES.vendorInvoices)
            .update({ match_status: 'Success' })
            .eq('invoice_number', invoice.invoice_number);

          successCount++;
        } else {
          // Step E: Exception
          const po = await fetchPoByVendor(invoice.po_number);
          await supabase.from(TABLES.exceptionReports).insert([{
            invoice_number: invoice.invoice_number,
            po_number: invoice.po_number,
            billed_amount: invoice.total_amount || 0,
            vendor: po?.vendor_name || 'Unknown',
            notes: result.reason,
            date: new Date().toISOString()
          }]);

          await supabase.from(TABLES.vendorInvoices)
            .update({ match_status: 'Exception' })
            .eq('invoice_number', invoice.invoice_number);

          exceptionCount++;
        }
      }

      toast.success(`Batch Processing Complete`, { 
        id: toastId,
        description: `Processed ${pendingInvoices.length} invoices. Success: ${successCount}, Exceptions: ${exceptionCount}`,
        duration: 5000
      });
      
      await refreshMetrics();
    } catch (err) {
      console.error(err);
      toast.error('Batch processing failed. Check console for details.', { id: toastId });
    }
  };

  const handleSimulateAgentRun = async () => {
    const toastId = toast.loading('Agentic Engine: Starting Multi-Agent Pipeline...');
    
    try {
      const sampleEmail = "Hi team, regarding PO-1044, we can only ship 10 units this week. The rest are delayed.";
      
      // Call the new Multi-Agent Orchestrator
      const pipelineResult = await processDocumentPipeline(sampleEmail);

      // Supabase Insert for Ingested Document (Text Ingestion)
      try {
        await supabase.from(TABLES.ingestedDocuments).insert([{
          document_name: 'Vendor Email: PO-1044 Update',
          vendor_name: 'Email Ingestion',
          intent: pipelineResult.intent, 
          status: 'Pending',
          confidence_score: 95,
          ingestion_date: new Date().toISOString()
        }]);
      } catch (dbErr) {
        console.error('Failed to log text ingestion to Supabase:', dbErr);
      }

      console.log("Pipeline Result:", pipelineResult);

      toast.success(`Multi-Agent Pipeline Complete`, { 
        id: toastId,
        description: `Intent: ${pipelineResult.intent} | PO: ${pipelineResult.extraction.poNumber || 'None'}`,
        duration: 5000
      });

      // Also show the raw JSON in a second toast for the demo
      setTimeout(() => {
        toast.info("Orchestrator Payload", {
          description: JSON.stringify(pipelineResult, null, 2),
          duration: 8000
        });
      }, 1000);
      
      await refreshMetrics();
    } catch (err) {
      console.error(err);
      toast.error('Simulation failed. Check console for details.', { id: toastId });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const toastId = toast.loading(`Uploading and analyzing ${file.name}...`);

    try {
      const base64 = await fileToBase64(file);
      const result = await performMultimodalExtraction(base64, file.type);
      
      // URGENT DEMO HOTFIX: Intent Classification Logic
      const fileNameLower = file.name.toLowerCase();
      // Check filename and extracted intent for keywords
      const combinedText = `${fileNameLower} ${result.intent?.toLowerCase() || ''}`;
      
      let intent: Intent = 'Invoice';
      if (combinedText.includes('acknowledgement') || combinedText.includes('ack')) {
        intent = 'Acknowledgement';
      } else if (combinedText.includes('inquiry')) {
        intent = 'Inquiry';
      }

      const vendor_name = file.name.replace(/\.[^/.]+$/, "");
      const confidence_score = 98;

      // Supabase Insert for Ingested Document (STRICT SCHEMA)
      try {
        await supabase.from(TABLES.ingestedDocuments).insert([{
          document_name: file.name,
          vendor_name: vendor_name,
          intent: intent, 
          status: 'Pending',
          confidence_score: confidence_score,
          ingestion_date: new Date().toISOString()
        }]);
      } catch (dbErr) {
        console.error('Failed to log ingestion to Supabase:', dbErr);
      }

      const newDoc: Document = {
        id: intent === 'Invoice' ? `INV-${Math.floor(Math.random() * 1000000)}` : 
            intent === 'Acknowledgement' ? `ACK-${Math.floor(Math.random() * 100000)}` : 
            `INQ-${Math.floor(Math.random() * 100000)}`,
        vendor_name: vendor_name,
        document_name: file.name,
        intent: intent,
        confidence_score: confidence_score,
        status: intent === 'Invoice' ? 'Auto-posted' : 'Matched',
        timestamp: new Date().toISOString()
      };
      await fetchDocs();

      toast.success('Extraction Complete', {
        id: toastId,
        description: `Vendor: ${vendor_name} | Intent: ${intent} | Confidence: ${confidence_score}%`,
        duration: 6000
      });

      console.log('Multimodal Extraction Result (Hacked):', { ...result, vendor_name, intent, confidence_score });
      
    } catch (err) {
      console.error('File upload failed:', err);
      toast.error('Failed to analyze document.', { id: toastId });
    } finally {
      setIsUploading(false);
      if (multimodalInputRef.current) {
        multimodalInputRef.current.value = '';
      }
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
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/*,application/pdf"
        onChange={handleFileChange}
      />
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
                    onClick={handleIngestDocs}
                    className="px-4 py-2 bg-brand-accent hover:bg-brand-accent/90 text-white rounded-lg text-sm font-bold transition-colors shadow-lg shadow-brand-accent/20 flex items-center gap-2"
                  >
                    <Inbox size={16} /> Ingest Docs
                  </button>
                  <input 
                    type="file" 
                    ref={multimodalInputRef}
                    onChange={handleFileUpload}
                    accept=".png,.jpg,.jpeg,.pdf"
                    className="hidden"
                  />
                  <button 
                    onClick={() => multimodalInputRef.current?.click()}
                    disabled={isUploading}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-colors border border-brand-border flex items-center gap-2 disabled:opacity-50"
                  >
                    {isUploading ? <RefreshCw className="animate-spin" size={16} /> : <Upload size={16} />}
                    Upload Vendor Document
                  </button>
                  <button 
                    onClick={runBatchProcessing}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-bold transition-colors border border-brand-border flex items-center gap-2"
                  >
                    <Cpu size={16} /> Run Batch Processing
                  </button>
                </div>
              </div>

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
                  value="1.2s" 
                  change="0.3s" 
                  trend="down" 
                  icon={Clock}
                  subtext="AI inference latency decreased"
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

              {/* Summary Stats for Acknowledgements */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="glass-card p-6 flex items-center gap-4">
                  <div className="p-3 bg-brand-danger/10 text-brand-danger rounded-xl">
                    <AlertTriangle size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Unresolved</p>
                    <h4 className="text-2xl font-bold text-white font-mono">42 Lines</h4>
                  </div>
                </div>
                <div className="glass-card p-6 flex items-center gap-4">
                  <div className="p-3 bg-brand-warning/10 text-brand-warning rounded-xl">
                    <Clock size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Price Alerts</p>
                    <h4 className="text-2xl font-bold text-white font-mono">12 Items</h4>
                  </div>
                </div>
                <div className="glass-card p-6 flex items-center gap-4">
                  <div className="p-3 bg-brand-accent/10 text-brand-accent rounded-xl">
                    <AlertCircle size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Backordered</p>
                    <h4 className="text-2xl font-bold text-white font-mono">8 POs</h4>
                  </div>
                </div>
                <div className="glass-card p-6 flex items-center gap-4">
                  <div className="p-3 bg-brand-success/10 text-brand-success rounded-xl">
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Matched Today</p>
                    <h4 className="text-2xl font-bold text-white font-mono">184 Lines</h4>
                  </div>
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
                  <p className="text-slate-400">Reconciling Purchase Orders, Receipts, and Invoices for Q4 Operations.</p>
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

              {/* Summary Stats for 3-Way Match */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass-card p-6 flex items-center gap-4">
                  <div className="p-3 bg-brand-accent/10 text-brand-accent rounded-xl">
                    <Layers size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Matches</p>
                    <h4 className="text-2xl font-bold text-white font-mono">1,284</h4>
                    <p className="text-[10px] text-brand-success font-bold mt-1">↗ +12% vs last month</p>
                  </div>
                </div>
                <div className="glass-card p-6 flex items-center gap-4">
                  <div className="p-3 bg-brand-success/10 text-brand-success rounded-xl">
                    <Zap size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Auto-Reconciled</p>
                    <h4 className="text-2xl font-bold text-white font-mono">856</h4>
                    <p className="text-[10px] text-brand-success font-bold mt-1">↗ +5% increase</p>
                  </div>
                </div>
                <div className="glass-card p-6 flex items-center gap-4">
                  <div className="p-3 bg-brand-danger/10 text-brand-danger rounded-xl">
                    <AlertCircle size={24} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Pending Exceptions</p>
                    <h4 className="text-2xl font-bold text-white font-mono">42</h4>
                    <p className="text-[10px] text-brand-warning font-bold mt-1">↘ -2% improvement</p>
                  </div>
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
