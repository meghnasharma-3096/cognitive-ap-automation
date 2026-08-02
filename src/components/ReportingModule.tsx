import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  FileSpreadsheet, 
  Search, 
  Filter,
  ArrowUpDown,
  ExternalLink,
  Clock,
  DollarSign,
  Building2,
  FileText,
  TrendingUp,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { getAllData, runThreeWayMatchSimulation, TABLES } from '../services/dbService';
import { downloadCSV } from '../utils/helpers';
import { Modal } from './Modal';
import { AuditLogTable } from './AuditLogTable';

type ReportTab = 'success' | 'exceptions';

export const ReportingModule = () => {
  const [activeTab, setActiveTab] = useState<ReportTab>('success');
  const [searchQuery, setSearchQuery] = useState('');
  const [successData, setSuccessData] = useState<any[]>([]);
  const [exceptionData, setExceptionData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<any | null>(null);

  const [successPage, setSuccessPage] = useState(1);
  const [exceptionPage, setExceptionPage] = useState(1);
  const itemsPerPage = 5;

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } catch (e) {
      return '';
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD' 
    }).format(val);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // Run simulation to ensure we have latest results
      await runThreeWayMatchSimulation();
      
      const success = await getAllData(TABLES.successReports);
      const exceptions = await getAllData(TABLES.exceptionReports);
      
      setSuccessData(success);
      setExceptionData(exceptions);
    } catch (err) {
      console.error('Failed to fetch report data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredSuccess = successData.filter(item => {
    if (!item) return false;
    if ((item.amount || 0) <= 0) return false;
    const vendor = item.vendor?.toLowerCase() || '';
    const invoiceNumber = item.invoice_number?.toLowerCase() || '';
    const query = (searchQuery || '').toLowerCase();
    return vendor.includes(query) || invoiceNumber.includes(query);
  });

  const filteredExceptions = exceptionData.filter(item => {
    if (!item) return false;
    const vendor = item.vendor?.toLowerCase() || '';
    const invoiceNumber = item.invoice_number?.toLowerCase() || '';
    const notes = item.notes?.toLowerCase() || '';
    const query = (searchQuery || '').toLowerCase();
    return vendor.includes(query) || invoiceNumber.includes(query) || notes.includes(query);
  });

  // Pagination logic
  const paginatedSuccess = filteredSuccess.slice(
    (successPage - 1) * itemsPerPage,
    successPage * itemsPerPage
  );

  const paginatedExceptions = filteredExceptions.slice(
    (exceptionPage - 1) * itemsPerPage,
    exceptionPage * itemsPerPage
  );

  const totalSuccessAmount = successData.reduce((sum, item) => sum + item.amount, 0);
  const totalExceptionAmount = exceptionData.reduce((sum, item) => sum + (item.billed_amount || 0), 0);
  const accuracy = successData.length > 0 ? (successData.length / (successData.length + exceptionData.length) * 100).toFixed(1) : '0.0';

  const handleExport = () => {
    if (activeTab === 'success') {
      const exportData = filteredSuccess.map(item => ({
        'Invoice Number': item.invoice_number,
        'Amount': item.amount,
        'Date': item.date,
        'Status': item.status
      }));
      downloadCSV(exportData, 'success_reports');
      toast.success('Success reports exported to CSV');
    } else {
      const exportData = filteredExceptions.map(item => ({
        'Invoice Number': item.invoice_number,
        'PO Number': item.po_number,
        'Vendor': item.vendor,
        'Amount': item.billed_amount || 0,
        'Notes': item.notes,
        'Date': item.date
      }));
      downloadCSV(exportData, 'exception_reports');
      toast.success('Exception reports exported to CSV');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <RefreshCw className="animate-spin text-brand-accent" size={32} />
        <p className="text-slate-400 font-medium">AI Agent Analyzing Invoices...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="flex items-center justify-between border-b border-brand-border pb-px">
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab('success')}
            className={`pb-4 text-sm font-bold uppercase tracking-widest transition-all relative ${
              activeTab === 'success' ? 'text-brand-success' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Success Reports
            {activeTab === 'success' && (
              <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-success" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('exceptions')}
            className={`pb-4 text-sm font-bold uppercase tracking-widest transition-all relative ${
              activeTab === 'exceptions' ? 'text-brand-danger' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Exception Reports
            {activeTab === 'exceptions' && (
              <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-danger" />
            )}
          </button>
        </div>

          <div className="flex items-center gap-4 pb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
              <input 
                type="text" 
                placeholder="Search reports..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-900/50 border border-brand-border rounded-lg py-1.5 pl-9 pr-4 text-xs focus:outline-none focus:border-brand-accent transition-colors w-64"
              />
            </div>
            <button 
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1.5 bg-brand-accent hover:bg-brand-accent/90 text-white rounded-lg text-xs font-bold transition-colors shadow-lg shadow-brand-accent/20"
            >
              <FileSpreadsheet size={14} /> Export CSV
            </button>
          </div>
      </div>

      {/* Content Area */}
      <AnimatePresence mode="wait">
        {activeTab === 'success' ? (
          <motion.div
            key="success-table"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass-card overflow-hidden"
          >
            <div className="p-4 border-b border-brand-border bg-brand-success/5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-brand-success">
                <CheckCircle2 size={18} />
                <span className="text-xs font-bold uppercase tracking-wider">Batch Processed Invoices Ready for Payment</span>
              </div>
              <span className="text-[10px] font-bold text-slate-500 uppercase">{filteredSuccess.length} Records Found</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-brand-border bg-slate-900/30">
                    <th className="px-6 py-4">Invoice ID</th>
                    <th className="px-6 py-4">Vendor</th>
                    <th className="px-6 py-4">Amount</th>
                    <th className="px-6 py-4">Processed Date</th>
                    <th className="px-6 py-4">Notes</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {paginatedSuccess.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                        No records found.
                      </td>
                    </tr>
                  ) : (
                    paginatedSuccess.map((item) => (
                      <tr 
                        key={item.id} 
                        className="hover:bg-white/[0.02] transition-colors group cursor-pointer"
                        onClick={() => setSelectedReport(item)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <FileText size={14} className="text-slate-500" />
                            <span className="text-sm font-bold text-white">{item.invoice_number}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Building2 size={14} className="text-slate-500" />
                            <span className="text-sm text-slate-300">{item.vendor}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono text-sm text-white">{formatCurrency(item.amount || 0)}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <Clock size={12} />
                            {formatDate(item.date)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-800 px-2 py-1 rounded uppercase tracking-tighter">
                            {item.notes}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="status-badge bg-brand-success/10 text-brand-success">
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="p-4 border-t border-brand-border flex items-center justify-between bg-slate-900/30">
              <span className="text-xs text-slate-500">
                Showing {Math.min(filteredSuccess.length, (successPage - 1) * itemsPerPage + 1)} to {Math.min(filteredSuccess.length, successPage * itemsPerPage)} of {filteredSuccess.length} entries
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSuccessPage(p => Math.max(1, p - 1))}
                  disabled={successPage === 1}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-bold transition-colors border border-brand-border"
                >
                  Previous
                </button>
                <button
                  onClick={() => setSuccessPage(p => p + 1)}
                  disabled={successPage * itemsPerPage >= filteredSuccess.length}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-bold transition-colors border border-brand-border"
                >
                  Next
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="exception-table"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass-card overflow-hidden"
          >
            <div className="p-4 border-b border-brand-border bg-brand-danger/5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-brand-danger">
                <AlertCircle size={18} />
                <span className="text-xs font-bold uppercase tracking-wider">Exception Report: Failed Matches Isolations</span>
              </div>
              <span className="text-[10px] font-bold text-slate-500 uppercase">{filteredExceptions.length} Records Found</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-brand-border bg-slate-900/30">
                    <th className="px-6 py-4">Invoice ID</th>
                    <th className="px-6 py-4">Vendor</th>
                    <th className="px-6 py-4">Amount</th>
                    <th className="px-6 py-4">Failure Reason</th>
                    <th className="px-6 py-4">Severity</th>
                    <th className="px-6 py-4">Failure Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {paginatedExceptions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                        No records found.
                      </td>
                    </tr>
                  ) : (
                    paginatedExceptions.map((item) => (
                      <tr 
                        key={item.id} 
                        className="hover:bg-white/[0.02] transition-colors group cursor-pointer"
                        onClick={() => setSelectedReport(item)}
                      >
                        <td className="px-6 py-4">
                          <span className="text-sm font-bold text-brand-danger">{item.invoice_number}</span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-300">{item.vendor}</td>
                        <td className="px-6 py-4 font-mono text-sm text-white">{formatCurrency(item.billed_amount || 0)}</td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm text-white font-medium">{item.notes}</span>
                            <span className="text-[10px] text-slate-500 uppercase tracking-tighter mt-1">Requires Manual Intervention</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`status-badge ${
                            (item.notes || '').includes('Quantity') ? 'bg-brand-danger/10 text-brand-danger' :
                            (item.notes || '').includes('Price') ? 'bg-brand-warning/10 text-brand-warning' :
                            'bg-slate-800 text-slate-400'
                          }`}>
                            {(item.notes || '').includes('Quantity') ? 'High' : 'Medium'} Priority
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-400">{formatDate(item.date)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="p-4 border-t border-brand-border flex items-center justify-between bg-slate-900/30">
              <span className="text-xs text-slate-500">
                Showing {Math.min(filteredExceptions.length, (exceptionPage - 1) * itemsPerPage + 1)} to {Math.min(filteredExceptions.length, exceptionPage * itemsPerPage)} of {filteredExceptions.length} entries
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setExceptionPage(p => Math.max(1, p - 1))}
                  disabled={exceptionPage === 1}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-bold transition-colors border border-brand-border"
                >
                  Previous
                </button>
                <button
                  onClick={() => setExceptionPage(p => p + 1)}
                  disabled={exceptionPage * itemsPerPage >= filteredExceptions.length}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-bold transition-colors border border-brand-border"
                >
                  Next
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary Footer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-success/10 text-brand-success rounded-lg">
              <DollarSign size={16} />
            </div>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Ready for Payment</span>
          </div>
          <span className="text-lg font-bold text-white font-mono">{formatCurrency(totalSuccessAmount || 0)}</span>
        </div>
        <div className="glass-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-danger/10 text-brand-danger rounded-lg">
              <AlertCircle size={16} />
            </div>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Exception Value</span>
          </div>
          <span className="text-lg font-bold text-white font-mono">{formatCurrency(totalExceptionAmount || 0)}</span>
        </div>
        <div className="glass-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-accent/10 text-brand-accent rounded-lg">
              <TrendingUp size={16} />
            </div>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Automation Accuracy</span>
          </div>
          <span className="text-lg font-bold text-white font-mono">{accuracy}%</span>
        </div>
      </div>

      <Modal
        isOpen={!!selectedReport}
        onClose={() => setSelectedReport(null)}
        title={activeTab === 'success' ? 'Success Report Details' : 'Exception Report Details'}
      >
        {selectedReport && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Invoice Number</p>
                <p className="text-sm font-bold text-white">{selectedReport.invoice_number}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">PO Number</p>
                <p className="text-sm font-bold text-white">{selectedReport.po_number}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vendor</p>
                <p className="text-sm font-bold text-white">{selectedReport.vendor}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Amount</p>
                <p className="text-sm font-bold text-white font-mono">
                  {formatCurrency(activeTab === 'success' ? selectedReport.amount || 0 : selectedReport.billed_amount || 0)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Date</p>
                <p className="text-sm font-bold text-white">{formatDate(selectedReport.date)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</p>
                <span className={`status-badge ${activeTab === 'success' ? 'bg-brand-success/10 text-brand-success' : 'bg-brand-danger/10 text-brand-danger'}`}>
                  {activeTab === 'success' ? 'Ready to Pay' : 'Exception'}
                </span>
              </div>
            </div>

            <div className="p-4 bg-slate-900/50 border border-brand-border rounded-xl">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                {activeTab === 'success' ? 'Reconciliation Notes' : 'Failure Analysis'}
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">
                {activeTab === 'success' 
                  ? selectedReport.notes 
                  : `The AI agent identified a discrepancy: ${selectedReport.reason}. This record has been isolated for manual review by the accounts payable team.`}
              </p>
            </div>

            {activeTab === 'exceptions' && (
              <div className="flex gap-3">
                <button className="flex-1 py-2 bg-brand-accent hover:bg-brand-accent/90 text-white rounded-lg text-xs font-bold transition-colors">
                  Adjust & Re-process
                </button>
                <button className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold transition-colors border border-brand-border">
                  Request Info from Vendor
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Audit Trail Section */}
      <div className="pt-8">
        <div className="flex items-center gap-2 mb-6">
          <Clock size={20} className="text-brand-accent" />
          <h2 className="text-xl font-bold text-white">System Audit Trail</h2>
        </div>
        <AuditLogTable />
      </div>
    </div>
  );
};
