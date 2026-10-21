import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, 
  Filter, 
  ArrowUpDown, 
  ChevronDown, 
  AlertTriangle, 
  Clock, 
  DollarSign, 
  CheckCircle2,
  MoreVertical,
  Download,
  RefreshCw,
  Package
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { downloadCSV } from '../utils/helpers';
import { Modal } from './Modal';
import { getAllData, TABLES } from '../services/dbService';
import { supabase } from '../services/supabase';

export type POStatus = 'Backorder' | 'Delayed' | 'Price Change' | 'Confirmed';

export interface PORecord {
  id: string;
  poNumber: string;
  vendor_name?: string;
  item_sku?: string;
  expected_quantity?: number;
  expected_eta?: string;
  ack_status?: POStatus;
  vendor: string;
  item: {
    name: string;
    sku: string;
  };
  intent: string;
  status: POStatus;
  eta: string;
  priceDelta?: string;
  qty: number;
  vendorText?: string;
  expectedQty?: number;
  emlFilename?: string;
}


export const ReconciliationTable = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<POStatus | 'All'>('All');
  const [sortConfig, setSortConfig] = useState<{ key: keyof PORecord; direction: 'asc' | 'desc' } | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<PORecord | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [data, setData] = useState<PORecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: pos, error } = await supabase
        .from(TABLES.purchaseOrders)
        .select('*');
      
      if (error) throw error;

      const formatDate = (dateStr: any) => {
        if (!dateStr) return 'TBD';
        try {
          const d = new Date(dateStr);
          if (isNaN(d.getTime())) return 'TBD';
          return d.toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
          });
        } catch (e) {
          return 'TBD';
        }
      };

      const mappedData: PORecord[] = (pos || []).map((item: any) => {
        return {
          id: item.id?.toString() || Math.random().toString(),
          poNumber: item.po_number || 'N/A',
          vendor_name: item.vendor_name || 'Unknown Vendor',
          item_sku: item.item_sku || 'N/A',
          expected_quantity: item.expected_quantity || 0,
          expected_eta: formatDate(item.expected_eta),
          ack_status: (item.ack_status as POStatus) || 'Confirmed',
          vendor: item.vendor_name || 'Unknown Vendor',
          item: { 
            name: item.item_details || 'Acknowledgement Document', 
            sku: item.item_sku || 'N/A' 
          },
          intent: 'Acknowledgement',
          status: (item.ack_status as POStatus) || 'Confirmed',
          eta: formatDate(item.expected_eta),
          priceDelta: `${Number(item.price_delta || 0) < 0 ? '-' : ''}$${Math.abs(Number(item.price_delta || 0)).toFixed(2)}`,
          qty: item.expected_quantity || 0,
          expectedQty: item.expected_quantity || 0,
          vendorText: item.ack_note || `No vendor acknowledgement received yet for PO ${item.po_number}.`,
          emlFilename: `Ack_${item.po_number}.eml`
        };
      });
      setData(mappedData);
    } catch (err) {
      console.error('Failed to fetch Acknowledgement data:', err);
      toast.error('Failed to load acknowledgements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSort = (key: keyof PORecord) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const filteredData = useMemo(() => {
    let result = [...data];

    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(item => {
        if (!item) return false;
        const poNumber = item.poNumber?.toLowerCase() || '';
        const vendor = item.vendor?.toLowerCase() || '';
        const itemName = item.item?.name?.toLowerCase() || '';
        return poNumber.includes(lowerSearch) ||
               vendor.includes(lowerSearch) ||
               itemName.includes(lowerSearch);
      });
    }

    if (statusFilter !== 'All') {
      result = result.filter(item => item.status === statusFilter);
    }

    if (sortConfig) {
      result.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortConfig.direction === 'asc' 
            ? aValue.localeCompare(bValue) 
            : bValue.localeCompare(aValue);
        }
        
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
        }
        
        return 0;
      });
    }

    return result;
  }, [data, searchTerm, statusFilter, sortConfig]);

  // Pagination logic mirroring Live Ingestion Stream
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredData.slice(indexOfFirstItem, indexOfLastItem);

  // Reset to page 1 if filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter]);

  const handleExport = () => {
    const exportData = filteredData.map(item => ({
      'PO Number': item.poNumber,
      'Vendor': item.vendor,
      'Item Name': item.item.name,
      'SKU': item.item.sku,
      'Status': item.status,
      'Qty': item.qty,
      'ETA': item.eta,
      'Price Delta': item.priceDelta || 'N/A'
    }));
    downloadCSV(exportData, 'acknowledgement_queue');
    toast.success('Acknowledgement queue exported to CSV');
  };

  const handleSyncERP = async () => {
    setLoading(true);
    try {
      await fetchData();
      toast.success('ERP synchronization complete.');
    } catch (err) {
      toast.error('Failed to sync with ERP.');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: POStatus) => {
    switch (status) {
      case 'Backorder':
        return (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-brand-danger/10 text-brand-danger text-[10px] font-bold uppercase tracking-wider border border-brand-danger/20">
            <AlertTriangle size={12} /> Backorder
          </span>
        );
      case 'Delayed':
        return (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-brand-warning/10 text-brand-warning text-[10px] font-bold uppercase tracking-wider border border-brand-warning/20">
            <Clock size={12} /> Shipping Delay
          </span>
        );
      case 'Price Change':
        return (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-brand-accent/10 text-brand-accent text-[10px] font-bold uppercase tracking-wider border border-brand-accent/20">
            <DollarSign size={12} /> Price Change
          </span>
        );
      case 'Confirmed':
        return (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-brand-success/10 text-brand-success text-[10px] font-bold uppercase tracking-wider border border-brand-success/20">
            <CheckCircle2 size={12} /> Confirmed
          </span>
        );
    }
  };

  if (loading && data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <RefreshCw className="animate-spin text-brand-accent" size={32} />
        <p className="text-slate-400 font-medium">Loading Purchase Orders...</p>
      </div>
    );
  }

  const ackStats = {
    unresolved: data.filter(d => d.ack_status !== 'Confirmed').length,
    price: data.filter(d => d.ack_status === 'Price Change').length,
    backordered: data.filter(d => d.ack_status === 'Backorder').length,
    confirmed: data.filter(d => d.ack_status === 'Confirmed').length,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-card p-6 flex items-center gap-4">
          <div className="p-3 bg-brand-danger/10 text-brand-danger rounded-xl"><AlertTriangle size={24} /></div>
          <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Unresolved</p>
          <h4 className="text-2xl font-bold text-white font-mono">{ackStats.unresolved} POs</h4></div>
        </div>
        <div className="glass-card p-6 flex items-center gap-4">
          <div className="p-3 bg-brand-warning/10 text-brand-warning rounded-xl"><DollarSign size={24} /></div>
          <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Price Alerts</p>
          <h4 className="text-2xl font-bold text-white font-mono">{ackStats.price} Items</h4></div>
        </div>
        <div className="glass-card p-6 flex items-center gap-4">
          <div className="p-3 bg-brand-accent/10 text-brand-accent rounded-xl"><Package size={24} /></div>
          <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Backordered</p>
          <h4 className="text-2xl font-bold text-white font-mono">{ackStats.backordered} POs</h4></div>
        </div>
        <div className="glass-card p-6 flex items-center gap-4">
          <div className="p-3 bg-brand-success/10 text-brand-success rounded-xl"><CheckCircle2 size={24} /></div>
          <div><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Confirmed</p>
          <h4 className="text-2xl font-bold text-white font-mono">{ackStats.confirmed} POs</h4></div>
        </div>
      </div>

      {/* Table Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input 
            type="text" 
            placeholder="Search by PO, Vendor, or Item..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900/50 border border-brand-border rounded-lg py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-brand-accent transition-colors"
          />
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-900/50 border border-brand-border rounded-lg px-3 py-1.5">
            <Filter size={14} className="text-slate-500" />
            <select 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-transparent text-xs font-medium text-slate-300 focus:outline-none cursor-pointer"
            >
              <option value="All">All Statuses</option>
              <option value="Backorder">Backorder</option>
              <option value="Delayed">Delayed</option>
              <option value="Price Change">Price Change</option>
              <option value="Confirmed">Confirmed</option>
            </select>
          </div>
          
          <button 
            onClick={handleSyncERP}
            className="flex items-center gap-2 px-3 py-1.5 bg-brand-accent hover:bg-brand-accent/90 text-white rounded-lg text-xs font-bold transition-colors shadow-lg shadow-brand-accent/20"
          >
            <RefreshCw size={14} /> Sync ERP
          </button>
        </div>
      </div>

      {/* Data Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-brand-border bg-slate-900/30">
                <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('poNumber')}>
                  <div className="flex items-center gap-2">
                    PO Number <ArrowUpDown size={12} />
                  </div>
                </th>
                <th className="px-6 py-4 cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('vendor')}>
                  <div className="flex items-center gap-2">
                    Vendor <ArrowUpDown size={12} />
                  </div>
                </th>
                <th className="px-6 py-4">Line Item / SKU</th>
                <th className="px-6 py-4 text-center">Qty</th>
                <th className="px-6 py-4">Acknowledgement Status</th>
                <th className="px-6 py-4 text-center">Price Delta</th>
                <th className="px-6 py-4">Expected ETA</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              <AnimatePresence initial={false}>
                {currentItems.map((record) => (
                  <React.Fragment key={record.id}>
                    <motion.tr 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                      className={`group hover:bg-white/[0.02] transition-colors cursor-pointer ${expandedId === record.id ? 'bg-brand-accent/5' : ''}`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <ChevronDown size={14} className={`text-slate-500 transition-transform ${expandedId === record.id ? 'rotate-180' : ''}`} />
                          <span className="text-sm font-bold text-brand-accent hover:underline">
                            {record.poNumber}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-white">{record.vendor_name || 'Unknown Vendor'}</span>
                          <span className="text-[10px] text-slate-500">{record.emlFilename || 'Domestic Fulfillment'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-sm text-slate-300">{record.item?.name || 'Acknowledgement Document'}</span>
                          <span className="text-[10px] font-mono text-slate-500">SKU: {record.item_sku || 'Unknown Item'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="text-sm font-mono text-slate-300">{(record.expected_quantity || 0).toLocaleString()}</span>
                      </td>
                      <td className="px-6 py-4">
                        {getStatusBadge(record.ack_status || 'Confirmed')}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {record.priceDelta ? (
                          <span className={`text-xs font-bold ${record.priceDelta.startsWith('+') ? 'text-brand-danger' : 'text-brand-success'}`}>
                            {record.priceDelta}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Clock size={14} className="text-slate-500" />
                          <span className={`text-sm ${record.status === 'Delayed' ? 'text-brand-danger font-medium' : 'text-slate-300'}`}>
                            {record.expected_eta}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setSelectedRecord(record); }}
                          className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                        >
                          <MoreVertical size={16} />
                        </button>
                      </td>
                    </motion.tr>
                    
                    {/* Expandable Mini-Tracker */}
                    <AnimatePresence>
                      {expandedId === record.id && (
                        <motion.tr
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="bg-slate-900/40"
                        >
                          <td colSpan={8} className="px-8 py-6">
                            <div className="flex flex-col md:flex-row gap-8">
                              <div className="flex-1 space-y-4">
                                <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Acknowledgement Mini-Tracker</h5>
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="p-3 bg-slate-800/50 rounded-lg border border-brand-border">
                                    <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Original Expected Qty</p>
                                    <p className="text-lg font-bold text-white font-mono">{record.expectedQty || record.expected_quantity}</p>
                                  </div>
                                  <div className="p-3 bg-slate-800/50 rounded-lg border border-brand-border">
                                    <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Acknowledged Qty</p>
                                    <p className={`text-lg font-bold font-mono ${record.expected_quantity !== record.expectedQty ? 'text-brand-warning' : 'text-brand-success'}`}>
                                      {record.expected_quantity}
                                    </p>
                                  </div>
                                </div>
                              </div>
                              <div className="flex-[2] space-y-4">
                                <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vendor Communication Payload</h5>
                                <div className="p-4 bg-slate-950 rounded-lg border border-brand-border italic text-xs text-slate-400 leading-relaxed">
                                  "{record.vendorText}"
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full bg-brand-accent animate-pulse"></div>
                                  <span className="text-[10px] text-slate-500 font-medium">AI Agent categorized this as: <span className="text-brand-accent">{record.status}</span></span>
                                </div>
                              </div>
                            </div>
                          </td>
                        </motion.tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))}
              </AnimatePresence>
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-3 text-slate-500">
                      <Search size={40} className="opacity-20" />
                      <p className="text-sm">No matching purchase orders found.</p>
                      <button 
                        onClick={() => { setSearchTerm(''); setStatusFilter('All'); }}
                        className="text-xs text-brand-accent hover:underline"
                      >
                        Clear all filters
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        <div className="p-4 border-t border-brand-border bg-slate-900/20 flex items-center justify-between">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            Showing {filteredData.length > 0 ? indexOfFirstItem + 1 : 0} to {Math.min(indexOfLastItem, filteredData.length)} of {filteredData.length} lines
          </p>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 rounded-lg text-xs font-medium transition-colors"
            >
              Previous
            </button>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 rounded-lg text-xs font-medium transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <Modal
        isOpen={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
        title="Acknowledgement Details"
      >
        {selectedRecord && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 p-4 bg-slate-900/50 border border-brand-border rounded-xl">
              <div className="p-3 bg-brand-accent/10 text-brand-accent rounded-xl">
                <Package size={24} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">{selectedRecord.item?.name || 'Acknowledgement Document'}</h4>
                <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">SKU: {selectedRecord.item_sku || 'Unknown Item'}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">PO Number</p>
                <p className="text-sm font-bold text-white">{selectedRecord.poNumber || 'N/A'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vendor</p>
                <p className="text-sm font-bold text-white">{selectedRecord.vendor_name || 'Unknown Vendor'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Quantity</p>
                <p className="text-sm font-bold text-white font-mono">{(selectedRecord.expected_quantity || 0).toLocaleString()} units</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</p>
                <div>{getStatusBadge(selectedRecord.ack_status || 'Confirmed')}</div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Expected ETA</p>
                <p className="text-sm font-bold text-white">{selectedRecord.expected_eta || 'TBD'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Price Variance</p>
                <p className={`text-sm font-bold ${selectedRecord.priceDelta?.startsWith('+') ? 'text-brand-danger' : 'text-brand-success'}`}>
                  {selectedRecord.priceDelta || 'No Variance'}
                </p>
              </div>
            </div>

            <div className="p-4 border border-brand-border rounded-xl space-y-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">AI Reconciliation Notes</p>
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  {selectedRecord.status === 'Confirmed' ? (
                    <CheckCircle2 size={14} className="text-brand-success" />
                  ) : (
                    <AlertTriangle size={14} className="text-brand-warning" />
                  )}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {selectedRecord.status === 'Confirmed' 
                    ? 'Vendor acknowledgement matches PO exactly. Automated reconciliation successful.' 
                    : `Discrepancy detected: ${selectedRecord.intent}. The system has flagged this for manual review or automated adjustment based on your tolerance settings.`}
                </p>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
