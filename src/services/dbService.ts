/**
 * Supabase Service for 3-Way Match Simulation
 */
import { supabase, resetDatabase } from './supabase';

// Real table names in the Supabase project (Postgres folds unquoted
// identifiers to lowercase, so these are lowercase even though the
// original schema was authored in PascalCase).
export const TABLES = {
  purchaseOrders: 'purchaseorders',
  warehouseReceipts: 'warehousereceipts',
  vendorInvoices: 'vendorinvoices',
  ingestedDocuments: 'ingesteddocuments',
  documentClusters: 'documentclusters',
  auditLogs: 'auditlogs',
  successReports: 'successreports',
  exceptionReports: 'exceptionreports',
} as const;

export type TableKey = keyof typeof TABLES;

export interface PurchaseOrder {
  id?: string;
  po_number: string;
  vendor_name: string;
  item_details?: string;
  expected_quantity?: number;
  expected_price?: number;
  unit_price?: number;
  freight_amount?: number;
  item_sku?: string;
  expected_eta?: string;
  ack_status?: string;
  price_delta?: number;
}

export interface WarehouseReceipt {
  id?: string;
  po_number: string;
  received_quantity?: number;
  receipt_date?: string;
  condition?: 'Perfect' | 'Damaged' | 'Partial' | 'Good' | 'Unknown';
}

export interface VendorInvoice {
  id?: string;
  invoice_number: string;
  po_number: string;
  billed_quantity?: number;
  freight_amount?: number;
  total_amount?: number;
  unit_price?: number;
  match_status?: string;
}

export interface DocumentCluster {
  id?: string;
  cluster_name: string;
  category: string;
  total_impact_amount: number;
  document_count: number;
  status: 'Requires Review' | 'Resolved';
  description?: string;
}

export interface AuditLog {
  id?: string;
  action_type: string;
  document_id: string;
  previous_status: string;
  new_status: string;
  timestamp?: string;
}

/**
 * Restore the golden seed dataset (data/seed.json) on the server.
 * Replaces the old generator so UI, API and tests all share ONE dataset.
 */
export const populateDummyData = async () => {
  const { error } = await resetDatabase();
  if (error) {
    console.error('Failed to reset data:', error);
    return false;
  }
  return true;
};

export const updateDocumentStatus = async (docId: string, status: string) => {
  try {
    const { data, error } = await supabase
      .from(TABLES.ingestedDocuments)
      .update({ status })
      .eq('id', docId)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error updating document status:', error);
    return null;
  }
};

export const addData = async (tableName: string, data: any) => {
  try {
    const { data: result, error } = await supabase.from(tableName).insert(data).select().single();
    if (error) throw error;
    return result;
  } catch (error) {
    console.error(`Error adding data to ${tableName}:`, error);
    return null;
  }
};

export const getAllData = async (tableName: string): Promise<any[]> => {
  try {
    const { data, error } = await supabase.from(tableName).select('*');
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error(`Error fetching data from ${tableName}:`, error);
    return [];
  }
};

export const updateData = async (tableName: string, id: any, data: any) => {
  try {
    const { data: result, error } = await supabase.from(tableName).update(data).eq('id', id).select().single();
    if (error) throw error;
    return result;
  } catch (error) {
    console.error(`Error updating data in ${tableName}:`, error);
    return null;
  }
};

export const deleteData = async (tableName: string, id: any) => {
  try {
    const { error } = await supabase.from(tableName).delete().eq('id', id);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error(`Error deleting data from ${tableName}:`, error);
    return false;
  }
};

export const createAuditLog = async (log: Omit<AuditLog, 'id' | 'timestamp'>) => {
  try {
    const { data, error } = await supabase
      .from(TABLES.auditLogs)
      .insert({
        ...log,
        timestamp: new Date().toISOString()
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating audit log:', error);
    return null;
  }
};
