import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  Brain, 
  Layers, 
  AlertCircle, 
  CheckCircle2, 
  XCircle, 
  Zap, 
  RefreshCw,
  TrendingUp,
  ShieldCheck,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { getAllData, updateData, DocumentCluster, createAuditLog, TABLES } from '../services/dbService';
import { Modal } from './Modal';

export const IntelligenceModule = ({ onRefresh }: { onRefresh?: () => Promise<void> }) => {
  const [clusters, setClusters] = useState<DocumentCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCluster, setSelectedCluster] = useState<DocumentCluster | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);

  const fetchClusters = async () => {
    setLoading(true);
    try {
      const data = await getAllData(TABLES.documentClusters);
      // Filter for 'Requires Review' as per prompt logic "remove the resolved item"
      setClusters(data.filter(c => c.status === 'Requires Review'));
    } catch (err) {
      console.error('Failed to fetch clusters:', err);
      toast.error('Failed to load intelligence data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClusters();
  }, []);

  const handleResolve = async (status: 'Resolved') => {
    if (!selectedCluster) return;
    
    setIsResolving(true);
    try {
      const previousStatus = selectedCluster.status;
      await updateData(TABLES.documentClusters, selectedCluster.id, { status });
      
      // Create Audit Log
      await createAuditLog({
        action_type: 'Bulk Resolution',
        document_id: selectedCluster.cluster_name,
        previous_status: previousStatus,
        new_status: status
      });

      toast.success(`Successfully resolved ${selectedCluster.document_count} documents`);
      setSelectedCluster(null);
      await fetchClusters();
      if (onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      console.error('Resolution failed:', err);
      toast.error('Failed to resolve cluster');
    } finally {
      setIsResolving(false);
    }
  };

  const handleTrainAI = () => {
    toast.info('AI Mapping Interface loading...');
  };

  if (loading && clusters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-4">
        <RefreshCw className="animate-spin text-brand-accent" size={48} />
        <p className="text-slate-400 font-medium animate-pulse">AI Agent Clustering Documents...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white tracking-tight mb-2">Cognitive Intelligence</h1>
          <p className="text-slate-400">AI-driven anomaly detection and document clustering for proactive risk management.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 bg-slate-800/50 border border-brand-border rounded-lg flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-brand-success rounded-full animate-pulse"></div>
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Model: GPT-4o-Cognitive</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 flex items-center gap-4">
          <div className="p-3 bg-brand-accent/10 text-brand-accent rounded-xl">
            <Brain size={24} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active Clusters</p>
            <h4 className="text-2xl font-bold text-white font-mono">{clusters.length}</h4>
          </div>
        </div>
        <div className="glass-card p-6 flex items-center gap-4">
          <div className="p-3 bg-brand-warning/10 text-brand-warning rounded-xl">
            <TrendingUp size={24} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Risk Exposure</p>
            <h4 className="text-2xl font-bold text-white font-mono">
              ${clusters.reduce((sum, c) => sum + (c.total_impact_amount || 0), 0).toLocaleString()}
            </h4>
          </div>
        </div>
        <div className="glass-card p-6 flex items-center gap-4">
          <div className="p-3 bg-brand-success/10 text-brand-success rounded-xl">
            <ShieldCheck size={24} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Auto-Resolved</p>
            <h4 className="text-2xl font-bold text-white font-mono">1,429</h4>
          </div>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Layers size={20} className="text-brand-accent" />
            Anomaly Clusters
          </h2>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            Last Scan: Just Now
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {clusters.map((cluster) => (
            <motion.div 
              key={cluster.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="glass-card p-6 flex items-center justify-between group hover:border-brand-accent/50 transition-colors"
            >
              <div className="flex items-center gap-6">
                <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-brand-accent">
                  <Cpu size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-lg font-bold text-white">{cluster.cluster_name}</h3>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      {cluster.category}
                    </span>
                  </div>
                  <p className="text-sm text-slate-400 max-w-xl">{cluster.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-12">
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Impact</p>
                  <p className="text-xl font-bold text-white font-mono">${(cluster.total_impact_amount || 0).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Documents</p>
                  <p className="text-xl font-bold text-white font-mono">{cluster.document_count}</p>
                </div>
                <button 
                  onClick={() => setSelectedCluster(cluster)}
                  className="px-4 py-2 bg-slate-800 hover:bg-brand-accent text-white rounded-lg text-xs font-bold transition-all flex items-center gap-2 group-hover:shadow-lg group-hover:shadow-brand-accent/20"
                >
                  Review Cluster <ArrowRight size={14} />
                </button>
              </div>
            </motion.div>
          ))}

          {clusters.length === 0 && !loading && (
            <div className="py-20 flex flex-col items-center justify-center glass-card border-dashed">
              <CheckCircle2 size={48} className="text-brand-success opacity-20 mb-4" />
              <p className="text-slate-500 font-medium">All clusters have been resolved.</p>
            </div>
          )}
        </div>
      </section>

      {/* Bulk Resolution Modal */}
      <Modal
        isOpen={!!selectedCluster}
        onClose={() => setSelectedCluster(null)}
        title="Bulk Resolution"
        footer={
          <div className="flex items-center gap-4 w-full">
            <button 
              onClick={() => handleResolve('Resolved')}
              disabled={isResolving}
              className="flex-1 py-3 bg-brand-success hover:bg-brand-success/90 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand-success/20 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isResolving ? <RefreshCw className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
              Approve & Process All
            </button>
            <button 
              onClick={() => handleResolve('Resolved')}
              disabled={isResolving}
              className="flex-1 py-3 bg-brand-danger hover:bg-brand-danger/90 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-brand-danger/20 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isResolving ? <RefreshCw className="animate-spin" size={18} /> : <XCircle size={18} />}
              Reject & Route to Vendor
            </button>
          </div>
        }
      >
        {selectedCluster && (
          <div className="space-y-6">
            <div className="p-6 bg-brand-accent/5 border border-brand-accent/20 rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <span className="px-3 py-1 rounded-full bg-brand-accent/10 text-brand-accent text-[10px] font-bold uppercase tracking-widest">
                  {selectedCluster.category}
                </span>
                <div className="flex items-center gap-2 text-brand-warning">
                  <AlertCircle size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">High Risk Anomaly</span>
                </div>
              </div>
              <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">{selectedCluster.cluster_name}</h2>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-white font-mono">${(selectedCluster.total_impact_amount || 0).toLocaleString()}</span>
                <span className="text-slate-500 text-sm font-medium">Total Impact Amount</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-900/50 border border-brand-border rounded-xl">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Document Count</p>
                <p className="text-xl font-bold text-white">{selectedCluster.document_count} Files</p>
              </div>
              <div className="p-4 bg-slate-900/50 border border-brand-border rounded-xl">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">AI Confidence</p>
                <p className="text-xl font-bold text-brand-success">98.4%</p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">AI Analysis Summary</p>
              <div className="p-4 bg-slate-900/30 border border-brand-border rounded-xl">
                <p className="text-sm text-slate-300 leading-relaxed italic">
                  "The cognitive engine has identified a recurring pattern regarding {selectedCluster.cluster_name}. Resolving this will update ERP records for the affected documents and prevent downstream STP failures."
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Included Documents</p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 uppercase">Per Page:</span>
                  <select 
                    value={itemsPerPage}
                    onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                    className="bg-transparent text-[10px] font-bold text-brand-accent uppercase focus:outline-none cursor-pointer"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                {Array.from({ length: selectedCluster.document_count }).slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((_, i) => {
                  const docIndex = (currentPage - 1) * itemsPerPage + i + 1;
                  return (
                    <div key={docIndex} className="flex items-center justify-between p-3 bg-slate-900/20 border border-brand-border/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center text-slate-500">
                          <Zap size={14} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-white">DOC-2024-{String(docIndex).padStart(4, '0')}</p>
                          <p className="text-[10px] text-slate-500">
                            {['Uline', 'Global Freight', 'Dell', 'Fastenal', 'Cisco'][docIndex % 5]} • ${(420 + docIndex * 15).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                
                {selectedCluster.document_count > itemsPerPage && (
                  <div className="flex items-center justify-between pt-4">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, selectedCluster.document_count)} of {selectedCluster.document_count}
                    </p>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.ceil(selectedCluster.document_count / itemsPerPage) }).map((_, p) => (
                        <button 
                          key={p + 1}
                          onClick={() => setCurrentPage(p + 1)}
                          className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-colors ${
                            currentPage === p + 1 ? 'bg-brand-accent text-white' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                          }`}
                        >
                          {p + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
