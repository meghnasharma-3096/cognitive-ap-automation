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

const MOCK_ACKNOWLEDGEMENTS: PORecord[] = [
  {
    id: 'ack-1',
    poNumber: 'PO-2024-801',
    vendor: 'Uline',
    vendor_name: 'Uline',
    item_sku: 'UL-9920',
    expected_quantity: 500,
    expected_eta: 'Mar 20, 12:00 PM',
    ack_status: 'Confirmed',
    item: { name: 'Industrial Packaging Tape', sku: 'UL-9920' },
    intent: 'Acknowledgement',
    status: 'Confirmed',
    eta: '2024-03-20',
    priceDelta: '$0.00',
    qty: 500,
    expectedQty: 500,
    vendorText: 'Order confirmed. Shipping via UPS Ground.',
    emlFilename: 'Ack_PO-2024-801.eml'
  },
  {
    id: 'ack-2',
    poNumber: 'PO-2024-802',
    vendor: 'Global Freight',
    vendor_name: 'Global Freight',
    item_sku: 'GF-PJ-01',
    expected_quantity: 12,
    expected_eta: 'Apr 05, 12:00 PM',
    ack_status: 'Delayed',
    item: { name: 'Pallet Jack - Heavy Duty', sku: 'GF-PJ-01' },
    intent: 'Acknowledgement',
    status: 'Delayed',
    eta: '2024-04-05',
    priceDelta: '$0.00',
    qty: 12,
    expectedQty: 12,
    vendorText: 'Delayed due to weather conditions in the Midwest hub.',
    emlFilename: 'Ack_PO-2024-802.eml'
  },
  {
    id: 'ack-3',
    poNumber: 'PO-2024-803',
    vendor: 'Dell',
    vendor_name: 'Dell',
    item_sku: 'DELL-PW-58',
    expected_quantity: 5,
    expected_eta: 'Mar 25, 12:00 PM',
    ack_status: 'Price Change',
    item: { name: 'Precision Workstation 5820', sku: 'DELL-PW-58' },
    intent: 'Acknowledgement',
    status: 'Price Change',
    eta: '2024-03-25',
    priceDelta: '+$150.00',
    qty: 5,
    expectedQty: 5,
    vendorText: 'Price increased due to raw material shortage (semiconductors).',
    emlFilename: 'Ack_PO-2024-803.eml'
  },
  {
    id: 'ack-4',
    poNumber: 'PO-2024-804',
    vendor: 'Fastenal',
    vendor_name: 'Fastenal',
    item_sku: 'FAST-HB-08',
    expected_quantity: 50,
    expected_eta: 'Apr 15, 12:00 PM',
    ack_status: 'Backorder',
    item: { name: 'Grade 8 Hex Bolts - 1000pk', sku: 'FAST-HB-08' },
    intent: 'Acknowledgement',
    status: 'Backorder',
    eta: '2024-04-15',
    priceDelta: '$0.00',
    qty: 0,
    expectedQty: 50,
    vendorText: 'Item currently on backorder. Estimated restock in 3 weeks.',
    emlFilename: 'Ack_PO-2024-804.eml'
  },
  {
    id: 'ack-5',
    poNumber: 'PO-2024-805',
    vendor: 'Cisco',
    vendor_name: 'Cisco',
    item_sku: 'CIS-C9300',
    expected_quantity: 2,
    expected_eta: 'Mar 18, 12:00 PM',
    ack_status: 'Confirmed',
    item: { name: 'Catalyst 9300 Switch', sku: 'CIS-C9300' },
    intent: 'Acknowledgement',
    status: 'Confirmed',
    eta: '2024-03-18',
    priceDelta: '$0.00',
    qty: 2,
    expectedQty: 2,
    vendorText: 'Confirmed. Tracking number will be sent upon dispatch.',
    emlFilename: 'Ack_PO-2024-805.eml'
  },
  {
    id: 'ack-6',
    poNumber: 'PO-2024-806',
    vendor: 'Grainger',
    vendor_name: 'Grainger',
    item_sku: 'GR-SG-22',
    expected_quantity: 100,
    expected_eta: 'Mar 15, 12:00 PM',
    ack_status: 'Confirmed',
    item: { name: 'Safety Goggles - Anti-Fog', sku: 'GR-SG-22' },
    intent: 'Acknowledgement',
    status: 'Confirmed',
    eta: '2024-03-15',
    priceDelta: '-$12.00',
    qty: 100,
    expectedQty: 100,
    vendorText: 'Promotional discount applied to this bulk order.',
    emlFilename: 'Ack_PO-2024-806.eml'
  },
  {
    id: 'ack-7',
    poNumber: 'PO-2024-807',
    vendor: 'MSC Industrial',
    vendor_name: 'MSC Industrial',
    item_sku: 'MSC-EM-05',
    expected_quantity: 45,
    expected_eta: 'Mar 28, 12:00 PM',
    ack_status: 'Delayed',
    item: { name: 'Carbide End Mill Set', sku: 'MSC-EM-05' },
    intent: 'Acknowledgement',
    status: 'Delayed',
    eta: '2024-03-28',
    priceDelta: '$0.00',
    qty: 45,
    expectedQty: 45,
    vendorText: 'Split shipment: 20 now, 25 next week due to stock levels.',
    emlFilename: 'Ack_PO-2024-807.eml'
  },
  {
    id: 'ack-8',
    poNumber: 'PO-2024-808',
    vendor: 'Amazon Business',
    vendor_name: 'Amazon Business',
    item_sku: 'AMZ-OC-09',
    expected_quantity: 15,
    expected_eta: 'Mar 14, 12:00 PM',
    ack_status: 'Confirmed',
    item: { name: 'Ergonomic Office Chair', sku: 'AMZ-OC-09' },
    intent: 'Acknowledgement',
    status: 'Confirmed',
    eta: '2024-03-14',
    priceDelta: '$0.00',
    qty: 15,
    expectedQty: 15,
    vendorText: 'Confirmed. Delivery expected within 2 business days.',
    emlFilename: 'Ack_PO-2024-808.eml'
  },
  {
    id: 'ack-9',
    poNumber: 'PO-2024-809',
    vendor: 'Staples Advantage',
    vendor_name: 'Staples Advantage',
    item_sku: 'STP-CP-10',
    expected_quantity: 200,
    expected_eta: 'Mar 16, 12:00 PM',
    ack_status: 'Price Change',
    item: { name: 'Copy Paper - 10 Ream Case', sku: 'STP-CP-10' },
    intent: 'Acknowledgement',
    status: 'Price Change',
    eta: '2024-03-16',
    priceDelta: '+$4.50',
    qty: 200,
    expectedQty: 200,
    vendorText: 'Annual price adjustment for paper products.',
    emlFilename: 'Ack_PO-2024-809.eml'
  },
  {
    id: 'ack-10',
    poNumber: 'PO-2024-810',
    vendor: 'Thermo Fisher',
    vendor_name: 'Thermo Fisher',
    item_sku: 'TF-CT-50',
    expected_quantity: 5000,
    expected_eta: 'Mar 22, 12:00 PM',
    ack_status: 'Confirmed',
    item: { name: 'Centrifuge Tubes 50mL', sku: 'TF-CT-50' },
    intent: 'Acknowledgement',
    status: 'Confirmed',
    eta: '2024-03-22',
    priceDelta: '$0.00',
    qty: 5000,
    expectedQty: 5000,
    vendorText: 'Bulk order confirmed. Shipping via LTL freight.',
    emlFilename: 'Ack_PO-2024-810.eml'
  },
  {
    id: 'ack-11',
    poNumber: 'PO-2024-811',
    vendor: 'CDW-G',
    vendor_name: 'CDW-G',
    item_sku: 'CDW-TP-X1',
    expected_quantity: 10,
    expected_eta: 'Apr 10, 12:00 PM',
    ack_status: 'Delayed',
    item: { name: 'Lenovo ThinkPad X1 Carbon', sku: 'CDW-TP-X1' },
    intent: 'Acknowledgement',
    status: 'Delayed',
    eta: '2024-04-10',
    priceDelta: '$0.00',
    qty: 10,
    expectedQty: 10,
    vendorText: 'Logistics delay at the port of entry.',
    emlFilename: 'Ack_PO-2024-811.eml'
  },
  {
    id: 'ack-12',
    poNumber: 'PO-2024-812',
    vendor: 'Graybar',
    vendor_name: 'Graybar',
    item_sku: 'GB-C6-1K',
    expected_quantity: 8,
    expected_eta: 'Mar 19, 12:00 PM',
    ack_status: 'Confirmed',
    item: { name: 'Cat6 Ethernet Cable - 1000ft', sku: 'GB-C6-1K' },
    intent: 'Acknowledgement',
    status: 'Confirmed',
    eta: '2024-03-19',
    priceDelta: '$0.00',
    qty: 8,
    expectedQty: 8,
    vendorText: 'Confirmed. Ready for pickup at local branch.',
    emlFilename: 'Ack_PO-2024-812.eml'
  },
  {
    id: 'ack-13',
    poNumber: 'PO-2024-813',
    vendor: 'McMaster-Carr',
    vendor_name: 'McMaster-Carr',
    item_sku: 'MC-OR-KIT',
    expected_quantity: 25,
    expected_eta: 'Mar 13, 12:00 PM',
    ack_status: 'Confirmed',
    item: { name: 'O-Ring Assortment Kit', sku: 'MC-OR-KIT' },
    intent: 'Acknowledgement',
    status: 'Confirmed',
    eta: '2024-03-13',
    priceDelta: '$0.00',
    qty: 25,
    expectedQty: 25,
    vendorText: 'Confirmed. Shipping today via FedEx Overnight.',
    emlFilename: 'Ack_PO-2024-813.eml'
  },
  {
    id: 'ack-14',
    poNumber: 'PO-2024-814',
    vendor: 'W.W. Grainger',
    vendor_name: 'W.W. Grainger',
    item_sku: 'GR-AC-05',
    expected_quantity: 3,
    expected_eta: 'May 01, 12:00 PM',
    ack_status: 'Backorder',
    item: { name: 'Portable Air Compressor', sku: 'GR-AC-05' },
    intent: 'Acknowledgement',
    status: 'Backorder',
    eta: '2024-05-01',
    priceDelta: '$0.00',
    qty: 0,
    expectedQty: 3,
    vendorText: 'Manufacturer lead time increased to 6 weeks.',
    emlFilename: 'Ack_PO-2024-814.eml'
  },
  {
    id: 'ack-15',
    poNumber: 'PO-2024-815',
    vendor: 'B&H Photo',
    vendor_name: 'B&H Photo',
    item_sku: 'BH-SN-A7',
    expected_quantity: 2,
    expected_eta: 'Mar 17, 12:00 PM',
    ack_status: 'Confirmed',
    item: { name: 'Sony Alpha a7 IV Camera', sku: 'BH-SN-A7' },
    intent: 'Acknowledgement',
    status: 'Confirmed',
    eta: '2024-03-17',
    priceDelta: '$0.00',
    qty: 2,
    expectedQty: 2,
    vendorText: 'Confirmed. Signature required upon delivery.',
    emlFilename: 'Ack_PO-2024-815.eml'
  }
];

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
          priceDelta: item.freight_amount ? `$${Number(item.freight_amount).toFixed(2)}` : '$0.00',
          qty: item.expected_quantity || 0,
          expectedQty: item.expected_quantity || 0,
          vendorText: `Acknowledgement received for PO ${item.po_number}.`,
          emlFilename: `Ack_${item.po_number}.eml`
        };
      });
      setData(mappedData.length > 0 ? mappedData : MOCK_ACKNOWLEDGEMENTS);
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

  return (
    <div className="space-y-6">
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
