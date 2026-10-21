import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Package, 
  Receipt, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  ShieldCheck,
  Search,
  Filter,
  MoreVertical,
  Eye,
  Edit3,
  Check,
  TrendingUp,
  Zap,
  RefreshCw,
  Play,
  Download,
  X,
  Info,
  Clock,
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { supabase } from '../services/supabase';
import { TABLES } from '../services/dbService';
import { fetchPoByVendor, fetchPOReceipt, fetchVendorInvoice } from '../services/AgenticService';
import { runMatchApi, approveInvoiceApi } from '../services/matchApi';
import { downloadCSV } from '../utils/helpers';

type MatchStatus = 'Matched' | 'Variance' | 'Auto-Reconciled' | 'Pending';

export const ThreeWayMatch = () => {
  const [matches, setMatches] = useState<any[]>([]);
  const [sortBy, setSortBy] = useState<'attention' | 'newest' | 'amount'>('attention');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [isVisualizerOpen, setIsVisualizerOpen] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [detailedData, setDetailedData] = useState<{po: any, receipt: any, invoice: any} | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const parseMarkdownBold = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-white">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr || dateStr === 'N/A') return '';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '';
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

  const formatCurrency = (value: any) => {
    const num = Number(value);
    return isNaN(num) ? '0.00' : num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: invoices, error } = await supabase
        .from(TABLES.vendorInvoices)
        .select('*');

      if (error) throw error;

      const rank: Record<string, number> = { Variance: 0, Pending: 1, Matched: 2 };
      const combined = (invoices || []).map((inv: any, idx: number) => {
        return {
          id: inv.id?.toString() || `inv-${idx}`,
          invoice_number: inv.invoice_number || 'N/A',
          po_number: inv.po_number || 'N/A',
          vendor_name: inv.vendor_name || 'Unknown Vendor',
          billed_amount: Number(inv.total_amount) || 0,
          billed_quantity: Number(inv.billed_quantity) || 0,
          freight_amount: Number(inv.freight_amount) || 0,
          status: inv.match_status === 'Exception' ? 'Variance' : inv.match_status === 'Success' ? 'Matched' : 'Pending',
          reason: inv.notes || '',
          varianceReason: inv.match_status === 'Exception' ? (inv.notes || '') : '',
          checks: inv.match_checks || [],
          raw: inv
        };
      }).sort((x: any, y: any) => rank[x.status] - rank[y.status]);

      setMatches(combined);
      if (combined.length > 0 && !selectedId) {
        setSelectedId(combined[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch match data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRunAnalysis = async () => {
    setAnalyzing(true);
    try {
      // Everything still pending, plus the invoice currently selected (re-check after data fixes).
      const ids = matches.filter(m => m.status === 'Pending').map(m => m.id);
      if (selectedMatch && !ids.includes(selectedMatch.id)) ids.push(selectedMatch.id);
      const result = await runMatchApi({ invoiceIds: ids });
      if (result.processed === 0) {
        toast.info('Nothing to analyse.');
      } else if (result.exceptions === 0) {
        toast.success(`${result.success} invoice(s) matched.`);
      } else {
        toast.warning(`${result.success} matched, ${result.exceptions} flagged for review.`);
      }
      await fetchData();
    } catch (err) {
      console.error('Analysis failed:', err);
      toast.error('AI Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleManualApprove = async () => {
    if (!selectedMatch) return;
    setIsApproving(true);
    const toastId = toast.loading(`Approving Invoice ${selectedMatch.invoice_number}...`);
    try {
      const r = await approveInvoiceApi(selectedMatch.id);
      toast.success(r.message, { id: toastId });
      setIsVisualizerOpen(false);
      await fetchData();
    } catch (err) {
      console.error(err);
      toast.error('Failed to approve invoice.', { id: toastId });
    } finally {
      setIsApproving(false);
    }
  };

  const sortedMatches = React.useMemo(() => {
    const rank: Record<string, number> = { Variance: 0, Pending: 1, Matched: 2 };
    const t = (m: any) => Date.parse(m.raw?.created_at ?? m.raw?.invoice_date ?? '') || 0;
    const list = [...matches];
    if (sortBy === 'newest') list.sort((a, b) => t(b) - t(a));
    else if (sortBy === 'amount') list.sort((a, b) => b.billed_amount - a.billed_amount);
    else list.sort((a, b) => rank[a.status] - rank[b.status]);
    return list;
  }, [matches, sortBy]);

  const selectedMatch = matches.find(m => m.id === selectedId) || matches[0];

  useEffect(() => {
    const fetchDetailedMatch = async () => {
      if (!selectedMatch) return;
      
      const poNum = selectedMatch.po_number;
      const invNum = selectedMatch.invoice_number;

      if (poNum !== 'N/A' || invNum !== 'N/A') {
        setLoadingDetails(true);
        try {
          const [po, receipt, invoice] = await Promise.all([
            poNum !== 'N/A' ? fetchPoByVendor(poNum) : Promise.resolve(null),
            poNum !== 'N/A' ? fetchPOReceipt(poNum) : Promise.resolve(null),
            Promise.resolve(selectedMatch.raw ?? null) // the exact row (invoice numbers can legitimately repeat: duplicates)
          ]);
          
          setDetailedData({ po, receipt, invoice });
        } catch (err) {
          console.error('Error fetching detailed match data:', err);
        } finally {
          setLoadingDetails(false);
        }
      }
    };

    fetchDetailedMatch();
  }, [selectedId, selectedMatch?.po_number, selectedMatch?.invoice_number]);

  const handleExport = () => {
    const exportData = matches.map(match => ({
      'Vendor': match.vendor_name || 'N/A',
      'Invoice #': match.invoice_number || 'N/A',
      'PO #': match.po_number || 'N/A',
      'Status': match.status,
      'Invoice Amount': match.billed_amount || 0,
      'Freight Amount': match.freight_amount || 0
    }));
    downloadCSV(exportData, 'three_way_matches');
    toast.success('Match results exported to CSV');
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <RefreshCw className="animate-spin text-brand-accent" size={32} />
        <p className="text-slate-400 font-medium">Loading Reconciliation Sets...</p>
      </div>
    );
  }

  if (!selectedMatch) {
    return (
      <div className="glass-card p-12 text-center space-y-2">
        <p className="text-white font-bold">No invoices to reconcile</p>
        <p className="text-slate-500 text-sm">Upload a vendor document from Overview, or reset the sample data.</p>
      </div>
    );
  }

  const stats = {
    total: matches.length,
    matched: matches.filter(m => m.status === 'Matched').length,
    exceptions: matches.filter(m => m.status === 'Variance').length,
    pending: matches.filter(m => m.status === 'Pending').length,
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 flex items-center gap-4">
          <div className="p-3 bg-brand-accent/10 text-brand-accent rounded-xl"><Layers size={24} /></div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Invoices</p>
            <h4 className="text-2xl font-bold text-white font-mono">{stats.total}</h4>
            <p className="text-[10px] text-slate-400 font-bold mt-1">{stats.pending} awaiting analysis</p>
          </div>
        </div>
        <div className="glass-card p-6 flex items-center gap-4">
          <div className="p-3 bg-brand-success/10 text-brand-success rounded-xl"><Zap size={24} /></div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Matched</p>
            <h4 className="text-2xl font-bold text-white font-mono">{stats.matched}</h4>
            <p className="text-[10px] text-brand-success font-bold mt-1">
              {stats.total - stats.pending > 0 ? `${Math.round((stats.matched / (stats.total - stats.pending)) * 100)}% of analysed` : 'Run analysis to match'}
            </p>
          </div>
        </div>
        <div className="glass-card p-6 flex items-center gap-4">
          <div className="p-3 bg-brand-danger/10 text-brand-danger rounded-xl"><AlertCircle size={24} /></div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Exceptions</p>
            <h4 className="text-2xl font-bold text-white font-mono">{stats.exceptions}</h4>
            <p className="text-[10px] text-brand-warning font-bold mt-1">Need review</p>
          </div>
        </div>
      </div>

      {/* List of Match Sets */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-brand-border bg-slate-900/30 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Active Reconciliation Sets</h3>
            <button 
              onClick={handleRunAnalysis}
              disabled={analyzing}
              className="flex items-center gap-2 px-3 py-1 bg-brand-accent/10 hover:bg-brand-accent/20 text-brand-accent rounded text-[10px] font-bold uppercase tracking-widest transition-all border border-brand-accent/20 disabled:opacity-50"
            >
              {analyzing ? <RefreshCw className="animate-spin" size={12} /> : <Play size={12} />}
              Run AI Analysis
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-bold uppercase tracking-widest transition-all border border-brand-border"
            >
              <Download size={12} /> Export Report
            </button>
            <span className="text-[10px] font-bold text-slate-500 uppercase ml-2">Sort by:</span>
            <select
              data-testid="match-sort"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'attention' | 'newest' | 'amount')}
              className="bg-transparent text-[10px] font-bold text-brand-accent uppercase focus:outline-none cursor-pointer"
            >
              <option value="attention" className="bg-slate-900">Needs Attention First</option>
              <option value="newest" className="bg-slate-900">Newest First</option>
              <option value="amount" className="bg-slate-900">Amount High to Low</option>
            </select>
          </div>
        </div>
        <div className="divide-y divide-brand-border max-h-64 overflow-y-auto">
          {matches.length > 0 ? (
            sortedMatches.map((match) => (
              <button
                key={match.id}
                onClick={() => setSelectedId(match.id)}
                className={`w-full flex items-center justify-between p-4 transition-colors text-left ${
                  selectedId === match.id ? 'bg-brand-accent/5 border-l-2 border-brand-accent' : 'hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg ${
                    match.status === 'Matched' ? 'bg-brand-success/10 text-brand-success' :
                    match.status === 'Auto-Reconciled' ? 'bg-brand-accent/10 text-brand-accent' :
                    match.status === 'Pending' ? 'bg-slate-700/40 text-slate-300' :
                    'bg-brand-danger/10 text-brand-danger'
                  }`}>
                    {match.status === 'Matched' ? <CheckCircle2 size={18} /> : 
                     match.status === 'Auto-Reconciled' ? <ShieldCheck size={18} /> : 
                     match.status === 'Pending' ? <Clock size={18} /> : 
                     <AlertCircle size={18} />}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{match.po_number}</p>
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tight">
                      {match.invoice_number} • {match.vendor_name}
                    </p>
                    {match.status === 'Variance' && match.reason && (
                      <p className="text-[11px] text-brand-danger mt-1 max-w-xl truncate" title={match.reason}>{match.reason}</p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono text-white">${formatCurrency(match.billed_amount || 0)}</p>
                  <span className={`status-badge ${
                    match.status === 'Matched' ? 'bg-brand-success/10 text-brand-success' :
                    match.status === 'Auto-Reconciled' ? 'bg-brand-accent/10 text-brand-accent' :
                    match.status === 'Pending' ? 'bg-slate-700/40 text-slate-300' :
                    'bg-brand-danger/10 text-brand-danger'
                  }`}>
                    {match.status}
                  </span>
                </div>
              </button>
            ))
          ) : (
            <div className="p-12 text-center">
              <p className="text-slate-500 font-medium">No unresolved matches found</p>
            </div>
          )}
        </div>
      </div>

      {/* Side-by-Side Comparison */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Comparison View <ArrowRight size={20} className="text-slate-600" /> 
            <span className="text-brand-accent">{selectedMatch?.po_number}</span>
          </h2>
          <div className="flex items-center gap-3">
            {selectedMatch.status === 'Variance' && (
              <>
                <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors border border-brand-border flex items-center gap-2">
                  <Edit3 size={16} /> Adjust Invoice
                </button>
                <button 
                  onClick={() => setIsVisualizerOpen(true)}
                  className="px-4 py-2 bg-brand-danger hover:bg-brand-danger/90 text-white rounded-lg text-sm font-bold transition-colors shadow-lg shadow-brand-danger/20 flex items-center gap-2"
                >
                  <Eye size={16} /> Visualizer Modal
                </button>
              </>
            )}
            {selectedMatch.status === 'Matched' && (
              <div className="flex items-center gap-2 text-brand-success bg-brand-success/10 px-3 py-1.5 rounded-lg border border-brand-success/20">
                <Check size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Matched</span>
              </div>
            )}
            {selectedMatch.status === 'Auto-Reconciled' && (
              <div className="flex items-center gap-2 text-brand-success bg-brand-success/10 px-3 py-1.5 rounded-lg border border-brand-success/20">
                <Check size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Auto-Reconciled</span>
              </div>
            )}
            {selectedMatch.status === 'Pending' && (
              <div className="flex items-center gap-2 text-slate-300 bg-slate-700/40 px-3 py-1.5 rounded-lg border border-brand-border">
                <Clock size={16} />
                <span className="text-xs font-bold uppercase tracking-wider">Awaiting analysis</span>
              </div>
            )}
          </div>
        </div>

        {selectedMatch.checks && selectedMatch.checks.length > 0 && (
          <div className="glass-card p-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Match checks</p>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
              {selectedMatch.checks.map((c: any) => (
                <li key={c.code} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 font-bold ${c.status === 'pass' ? 'text-brand-success' : c.status === 'fail' ? 'text-brand-danger' : 'text-slate-500'}`}>
                    {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '–'}
                  </span>
                  <span className="text-slate-300"><span className="font-semibold text-white">{c.label}:</span> {c.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* PO Card */}
          <motion.div 
            key={`po-${selectedMatch.id}`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="glass-card p-6 space-y-6 border-t-4 border-slate-700"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-800 rounded-lg text-slate-400">
                  <FileText size={20} />
                </div>
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Purchase Order</h4>
              </div>
              <span className="text-xs font-mono text-slate-500">{detailedData?.po?.po_number || selectedMatch?.po_number}</span>
            </div>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-brand-border">
                <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Quantity</span>
                <span className="text-sm font-mono text-white">
                  {detailedData?.po?.expected_quantity || 0} units
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-brand-border">
                <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Unit Price</span>
                <span className="text-sm font-mono text-white">
                  ${formatCurrency(detailedData?.po?.unit_price || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Total Expected</span>
                <span className="text-lg font-bold text-white font-mono">
                  ${formatCurrency(detailedData?.po?.expected_price || 0)}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Warehouse Receipt Card */}
          <motion.div 
            key={`wr-${selectedMatch.id}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-6 space-y-6 border-t-4 border-slate-700"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-800 rounded-lg text-slate-400">
                  <Package size={20} />
                </div>
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Warehouse Receipt</h4>
              </div>
              <span className="text-xs font-mono text-slate-500">{detailedData?.receipt?.receipt_number || detailedData?.receipt?.id || 'N/A'}</span>
            </div>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-brand-border">
                <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Qty Received</span>
                <span className={`text-sm font-mono font-bold ${
                  (detailedData?.receipt?.received_quantity || 0) !== (detailedData?.po?.expected_quantity || 0) 
                    ? 'text-brand-danger' : 'text-brand-success'
                }`}>
                  {detailedData?.receipt?.received_quantity || 0} units
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-brand-border">
                <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Receipt Date</span>
                <span className="text-sm font-mono text-white">
                  {formatDate(detailedData?.receipt?.receipt_date || detailedData?.receipt?.date)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Condition</span>
                <span className={`text-sm font-bold ${
                  (detailedData?.receipt?.condition) === 'Perfect' 
                    ? 'text-brand-success' : 'text-brand-warning'
                }`}>
                  {detailedData?.receipt?.condition || 'N/A'}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Invoice Card */}
          <motion.div 
            key={`inv-${selectedMatch.id}`}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className={`glass-card p-6 space-y-6 border-t-4 ${
              selectedMatch.status === 'Matched' ? 'border-brand-success' :
              selectedMatch.status === 'Auto-Reconciled' ? 'border-brand-accent' :
              selectedMatch.status === 'Pending' ? 'border-slate-600' :
              'border-brand-danger'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-800 rounded-lg text-slate-400">
                  <Receipt size={20} />
                </div>
                <h4 className="text-sm font-bold text-white uppercase tracking-wider">Vendor Invoice</h4>
              </div>
              <span className="text-xs font-mono text-slate-500">{detailedData?.invoice?.invoice_number || selectedMatch?.invoice_number}</span>
            </div>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-brand-border">
                <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Qty Billed</span>
                {detailedData?.invoice?.billed_quantity == null ? (
                  <span className="text-sm font-mono text-slate-400">not stated</span>
                ) : (
                  <span className={`text-sm font-mono font-bold ${
                    detailedData.invoice.billed_quantity !== (detailedData?.receipt?.received_quantity || 0) ? 'text-brand-danger' : 'text-brand-success'
                  }`}>
                    {detailedData.invoice.billed_quantity} units
                  </span>
                )}
              </div>
              <div className="flex justify-between items-center py-2 border-b border-brand-border">
                <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Unit Price</span>
                <span className="text-sm font-mono text-white">
                  {detailedData?.invoice?.unit_price == null ? <span className="text-slate-400">not stated</span> : `$${formatCurrency(detailedData.invoice.unit_price)}`}
                </span>
              </div>
              <div className={`flex justify-between items-center py-2 px-2 -mx-2 rounded transition-colors ${
                selectedMatch?.status === 'Auto-Reconciled' ? 'bg-brand-success/10' : ''
              }`}>
                <div className="flex flex-col">
                  <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Freight Variance</span>
                  {selectedMatch?.status === 'Auto-Reconciled' && (
                    <span className="text-[8px] text-brand-success font-bold uppercase tracking-tighter">Within Tolerance</span>
                  )}
                </div>
                <span className={`text-sm font-mono font-bold ${
                  (detailedData?.invoice?.freight_amount || 0) > 0 && selectedMatch?.status !== 'Auto-Reconciled' ? 'text-brand-danger' : 
                  selectedMatch?.status === 'Auto-Reconciled' ? 'text-brand-success' : 'text-slate-300'
                }`}>
                  +${formatCurrency(detailedData?.invoice?.freight_amount || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Invoice Total</span>
                <span className="text-lg font-bold text-white font-mono">
                  ${formatCurrency(detailedData?.invoice?.total_amount || 0)}
                </span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Resolution Patterns / Smart Suggestion */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-card p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-brand-accent/10 text-brand-accent rounded-lg">
                <TrendingUp size={20} />
              </div>
              <h4 className="text-sm font-bold text-white uppercase tracking-wider">Resolution Patterns</h4>
            </div>
            <div className="space-y-4" data-testid="resolution-patterns">
              {(() => {
                const analysed = matches.filter(m => m.status !== 'Pending');
                const matched = analysed.filter(m => m.status === 'Matched').length;
                const exceptions = analysed.filter(m => m.status === 'Variance');
                const LABEL: Record<string, string> = {
                  DUPLICATE: 'Duplicate invoice', FREIGHT: 'Unapproved freight', PRICE: 'Price variance', QTY_VS_RECEIPT: 'Billed > received',
                  QTY_VS_PO: 'Billed > ordered', VENDOR_MISMATCH: 'Vendor mismatch', PO_MISSING: 'PO not found', RECEIPT_MISSING: 'No goods receipt', TOTAL_MISSING: 'Total missing',
                };
                const byCause: Record<string, number> = {};
                exceptions.forEach(m => { const c = LABEL[m.raw?.match_code] ?? 'Other'; byCause[c] = (byCause[c] || 0) + 1; });
                const rows = Object.entries(byCause).sort((a, b) => b[1] - a[1]);
                if (analysed.length === 0) return <p className="text-xs text-slate-500">Run the analysis to see how invoices resolve.</p>;
                const pct = Math.round((matched / analysed.length) * 1000) / 10;
                return (
                  <>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Auto-match rate</span>
                        <span className="text-white font-bold">{pct}% ({matched} of {analysed.length})</span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-success" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    {rows.map(([label, n]) => (
                      <div key={label} className="space-y-2">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">{label}</span>
                          <span className="text-white font-bold">{n} of {exceptions.length} exceptions</span>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-danger" style={{ width: `${(n / exceptions.length) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* 3-Way Match Visualizer Modal */}
      <AnimatePresence>
        {isVisualizerOpen && selectedMatch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-brand-bg border border-brand-border rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-brand-border flex items-center justify-between bg-slate-900/50">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    selectedMatch.status === 'Variance' ? 'bg-brand-danger/20 text-brand-danger' : selectedMatch.status === 'Pending' ? 'bg-slate-700/40 text-slate-300' : 'bg-brand-success/20 text-brand-success'
                  }`}>
                    {selectedMatch.status === 'Variance' ? <AlertCircle size={24} /> : selectedMatch.status === 'Pending' ? <Clock size={24} /> : <CheckCircle2 size={24} />}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {selectedMatch.status === 'Variance' ? 'Exception Detected' : 'Match Successful'}
                    </h3>
                    <p className="text-xs text-slate-500">Invoice: {detailedData?.invoice?.invoice_number || selectedMatch?.invoice_number} | PO: {detailedData?.po?.po_number || selectedMatch?.po_number}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsVisualizerOpen(false)}
                  className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  
                  {/* Column 1: PO Details */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText size={16} className="text-brand-accent" />
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Purchase Order</h4>
                    </div>
                    <div className="bg-slate-900/50 border border-brand-border rounded-xl p-4 space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Expected Qty</span>
                        <span className="text-sm font-mono text-white">{detailedData?.po?.expected_quantity || 0}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Unit Price</span>
                        <span className="text-sm font-mono text-white">${formatCurrency(detailedData?.po?.unit_price || 0)}</span>
                      </div>
                      <div className="pt-4 border-t border-brand-border flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-400">Total Amount</span>
                        <span className="text-lg font-bold text-white font-mono">${formatCurrency(detailedData?.po?.expected_price || 0)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Column 2: Receipt Details */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Package size={16} className="text-brand-success" />
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Warehouse Receipt</h4>
                    </div>
                    <div className="bg-slate-900/50 border border-brand-border rounded-xl p-4 space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Received Qty</span>
                        <span className={`text-sm font-mono font-bold ${detailedData?.receipt?.received_quantity !== detailedData?.po?.expected_quantity ? 'text-brand-danger' : 'text-white'}`}>
                          {detailedData?.receipt?.received_quantity || 0}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Receipt Date</span>
                        <span className="text-sm font-mono text-white">{formatDate(detailedData?.receipt?.receipt_date || 'N/A')}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Condition</span>
                        <span className="text-sm text-brand-success font-medium">{detailedData?.receipt?.condition || 'N/A'}</span>
                      </div>
                      {detailedData?.receipt?.received_quantity !== detailedData?.po?.expected_quantity && (
                        <div className="mt-4 p-2 bg-brand-danger/10 border border-brand-danger/20 rounded-lg flex items-start gap-2">
                          <AlertCircle size={14} className="text-brand-danger mt-0.5 shrink-0" />
                          <p className="text-[10px] text-brand-danger leading-tight">Quantity Mismatch: Received {detailedData?.receipt?.received_quantity || 0} vs Ordered {detailedData?.po?.expected_quantity || 0}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Column 3: Invoice Details */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Receipt size={16} className="text-brand-warning" />
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Vendor Invoice</h4>
                    </div>
                    <div className="bg-slate-900/50 border border-brand-border rounded-xl p-4 space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Billed Qty</span>
                        <span className={`text-sm font-mono font-bold ${detailedData?.invoice?.billed_quantity !== detailedData?.receipt?.received_quantity ? 'text-brand-danger' : 'text-white'}`}>
                          {detailedData?.invoice?.billed_quantity || 0}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Unit Price</span>
                        <span className="text-sm font-mono text-white">${formatCurrency(detailedData?.invoice?.unit_price || 0)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-slate-500">Freight Variance</span>
                        <span className={`text-sm font-mono font-bold ${detailedData?.invoice?.freight_amount && detailedData?.invoice?.freight_amount > 0 ? 'text-brand-danger' : 'text-brand-success'}`}>
                          +${formatCurrency(detailedData?.invoice?.freight_amount || 0)}
                        </span>
                      </div>
                      <div className="pt-4 border-t border-brand-border flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-400">Total Billed</span>
                        <span className="text-lg font-bold text-white font-mono">${formatCurrency(detailedData?.invoice?.total_amount || 0)}</span>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Exception Summary */}
                <div className={`mt-8 p-4 rounded-xl border ${
                  selectedMatch.status === 'Variance' 
                    ? 'bg-brand-danger/5 border-brand-danger/10' 
                    : 'bg-brand-success/5 border-brand-success/10'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    {selectedMatch.status === 'Variance' ? (
                      <>
                        <AlertCircle size={16} className="text-brand-danger" />
                        <h5 className="text-sm font-bold text-brand-danger">Exception Cause Identified</h5>
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={16} className="text-brand-success" />
                        <h5 className="text-sm font-bold text-brand-success">Match Verified</h5>
                      </>
                    )}
                  </div>
                  <p className="text-sm text-slate-400">
                    {selectedMatch.status === 'Variance' ? (
                      <>
                        The AI Agent detected a <span className="text-white font-bold">Variance</span> in the 3-way match. 
                        {selectedMatch.varianceReason && <span className="block mt-1 text-white">{selectedMatch.varianceReason}</span>}
                      </>
                    ) : (
                      <>
                        The AI Agent has <span className="text-brand-success font-bold">Verified</span> the 3-way match. All quantities and prices are within tolerance.
                      </>
                    )}
                  </p>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="px-6 py-4 border-t border-brand-border flex items-center justify-between bg-slate-900/50">
                <div className="flex items-center gap-2 text-slate-500">
                  <Info size={14} />
                  <span className="text-[10px] uppercase tracking-wider font-bold">Manual Review Required</span>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setIsVisualizerOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors">
                    Request Credit
                  </button>
                  <button 
                    onClick={handleManualApprove}
                    disabled={isApproving}
                    className="px-6 py-2 bg-brand-accent hover:bg-brand-accent/90 disabled:opacity-50 text-white rounded-lg text-sm font-bold transition-all shadow-lg shadow-brand-accent/20 flex items-center gap-2"
                  >
                    {isApproving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    Manually Approve
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
