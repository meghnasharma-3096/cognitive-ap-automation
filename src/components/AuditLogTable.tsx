import React, { useState, useEffect } from 'react';
import { ClipboardList, RefreshCw, Clock, ShieldCheck, User } from 'lucide-react';
import { getAllData, AuditLog, TABLES } from '../services/dbService';

export const AuditLogTable = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await getAllData(TABLES.auditLogs);
      // Sort by timestamp descending
      const sorted = data.sort((a, b) => {
        return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
      });
      setLogs(sorted);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    
    // Refresh logs every 30 seconds
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <RefreshCw className="animate-spin text-brand-accent" size={24} />
        <p className="text-slate-500 text-sm">Loading Audit Trail...</p>
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="p-4 border-b border-brand-border bg-slate-900/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-brand-accent/10 text-brand-accent rounded-lg">
            <ClipboardList size={18} />
          </div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">System Audit Trail</h3>
        </div>
        <button 
          onClick={fetchLogs}
          className="p-2 text-slate-500 hover:text-white transition-colors"
          title="Refresh Logs"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-brand-border bg-slate-900/20">
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Timestamp</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Action</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Document / Cluster</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Transition</th>
              <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">User</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500 text-sm">
                  No audit logs found. Perform an action to see it logged here.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Clock size={12} />
                      <span className="text-xs font-mono">
                        {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest ${
                      log.action_type === 'Manual Approval' ? 'bg-brand-success/10 text-brand-success' : 'bg-brand-accent/10 text-brand-accent'
                    }`}>
                      {log.action_type}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-bold text-white">{log.document_id}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 line-through">{log.previous_status}</span>
                      <ShieldCheck size={12} className="text-brand-success" />
                      <span className="text-[10px] text-brand-success font-bold uppercase">{log.new_status}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-slate-400">
                      <User size={12} />
                      <span className="text-xs">System Admin</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
