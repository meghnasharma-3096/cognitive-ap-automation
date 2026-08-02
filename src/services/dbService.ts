/**
 * Supabase Service for 3-Way Match Simulation
 */
import { supabase } from './supabase';

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

export const runThreeWayMatchSimulation = async () => {
  try {
    const pos = await getAllData(TABLES.purchaseOrders);
    const receipts = await getAllData(TABLES.warehouseReceipts);
    const invoices = await getAllData(TABLES.vendorInvoices);

    const successReports: any[] = [];
    const exceptionReports: any[] = [];

    invoices.forEach(invoice => {
      const po = pos.find(p => p.po_number === invoice.po_number);
      const receipt = receipts.find(r => r.po_number === invoice.po_number);

      const billedAmount = Number(invoice.total_amount) || 0;

      if (!po || !receipt) {
        exceptionReports.push({
          invoice_number: invoice.invoice_number,
          po_number: invoice.po_number,
          billed_amount: billedAmount,
          vendor: po?.vendor_name || 'Unknown',
          notes: !po ? 'Missing Purchase Order' : 'Missing Warehouse Receipt',
          date: new Date().toISOString()
        });
        return;
      }

      const billedQty = Number(invoice.billed_quantity) || 0;
      const receivedQty = Number(receipt.received_quantity) || 0;
      const expectedAmount = Number(po.expected_price) || 0;
      const variance = Math.abs(billedAmount - expectedAmount);

      if (billedQty > receivedQty) {
        exceptionReports.push({
          invoice_number: invoice.invoice_number,
          po_number: invoice.po_number,
          billed_amount: billedAmount,
          vendor: po.vendor_name,
          notes: `Quantity Mismatch: Billed (${billedQty}) > Received (${receivedQty})`,
          date: new Date().toISOString()
        });
      }
      else if (variance <= 5) {
        successReports.push({
          invoice_number: invoice.invoice_number,
          amount: billedAmount,
          status: 'Processed',
          date: new Date().toISOString()
        });
      }
      else {
        exceptionReports.push({
          invoice_number: invoice.invoice_number,
          po_number: invoice.po_number,
          billed_amount: billedAmount,
          vendor: po.vendor_name,
          notes: `Price Variance: $${(variance || 0).toFixed(2)} exceeds threshold`,
          date: new Date().toISOString()
        });
      }
    });

    // Clear existing reports and insert new ones
    await supabase.from(TABLES.successReports).delete().not('id', 'is', null);
    await supabase.from(TABLES.exceptionReports).delete().not('id', 'is', null);

    if (successReports.length > 0) {
      const { error: sError } = await supabase.from(TABLES.successReports).insert(successReports);
      if (sError) console.error('Error inserting success reports:', sError);
    }

    if (exceptionReports.length > 0) {
      const { error: eError } = await supabase.from(TABLES.exceptionReports).insert(exceptionReports);
      if (eError) console.error('Error inserting exception reports:', eError);
    }

    return { successReports, exceptionReports };
  } catch (error) {
    console.error('Simulation failed:', error);
    return { successReports: [], exceptionReports: [] };
  }
};

export const populateDummyData = async () => {
  try {
    const poData: PurchaseOrder[] = Array.from({ length: 15 }, (_, i) => ({
      po_number: `PO-2024-${100 + i}`,
      vendor_name: ['Global Tech', 'Apex Mfg', 'Starlight Log', 'Logistics Plus', 'AWS Ent'][i % 5],
      item_sku: `SKU-${500 + i}`,
      item_details: `Industrial Component ${String.fromCharCode(65 + i)}`,
      expected_quantity: 100 + (i * 10),
      unit_price: 25.50 + i,
      expected_price: (100 + (i * 10)) * (25.50 + i),
      freight_amount: 0,
      expected_eta: '2024-03-01'
    }));

    const receiptData: WarehouseReceipt[] = poData.map((po, i) => ({
      po_number: po.po_number,
      received_quantity: i === 3 ? (po.expected_quantity || 0) - 5 : (i === 7 ? (po.expected_quantity || 0) + 2 : po.expected_quantity),
      condition: i === 3 ? 'Damaged' : 'Perfect',
      receipt_date: '2024-03-05'
    }));

    const invoiceData: VendorInvoice[] = poData.map((po, i) => ({
      invoice_number: `INV-2024-${300 + i}`,
      po_number: po.po_number,
      billed_quantity: i === 10 ? (po.expected_quantity || 0) + 10 : po.expected_quantity,
      unit_price: i === 12 ? (po.unit_price || 0) + 5 : po.unit_price,
      total_amount: (i === 10 ? (po.expected_quantity || 0) + 10 : (po.expected_quantity || 0)) * (i === 12 ? (po.unit_price || 0) + 5 : (po.unit_price || 0)),
      freight_amount: 0
    }));

    const clusterData: DocumentCluster[] = [
      {
        cluster_name: 'Duplicate Invoices - Q1',
        category: 'Compliance',
        total_impact_amount: 12500.50,
        document_count: 24,
        status: 'Requires Review',
        description: 'Potential duplicate billing detected across multiple vendor portals.'
      },
      {
        cluster_name: 'Price Variance - Logistics',
        category: 'Pricing',
        total_impact_amount: 8420.00,
        document_count: 15,
        status: 'Requires Review',
        description: 'Consistent 5% surcharge discrepancy from Starlight Logistics.'
      },
      {
        cluster_name: 'Tax ID Mismatch',
        category: 'Regulatory',
        total_impact_amount: 0,
        document_count: 8,
        status: 'Requires Review',
        description: 'Vendor Tax IDs do not match ERP master data records.'
      }
    ];

    // Clear and populate
    await supabase.from(TABLES.purchaseOrders).delete().not('id', 'is', null);
    await supabase.from(TABLES.warehouseReceipts).delete().not('id', 'is', null);
    await supabase.from(TABLES.vendorInvoices).delete().not('id', 'is', null);
    await supabase.from(TABLES.documentClusters).delete().not('id', 'is', null);

    await supabase.from(TABLES.purchaseOrders).insert(poData);
    await supabase.from(TABLES.warehouseReceipts).insert(receiptData);
    await supabase.from(TABLES.vendorInvoices).insert(invoiceData);
    await supabase.from(TABLES.documentClusters).insert(clusterData);

    return true;
  } catch (error) {
    console.error('Failed to populate dummy data:', error);
    return false;
  }
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
