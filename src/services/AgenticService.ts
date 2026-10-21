import { supabase } from './supabase';
import { TABLES } from './dbService';

/** Small read helpers over the local data store (extraction now lives server-side in server/ingest.ts). */

/**
 * Fetches a Purchase Order by its PO number.
 */
export async function fetchPoByVendor(poNumber: string) {
  const { data, error } = await supabase
    .from(TABLES.purchaseOrders)
    .select('*')
    .eq('po_number', poNumber)
    .maybeSingle();

  if (error) {
    console.error('Error fetching PO:', error);
    return null;
  }
  return data;
}

/**
 * Fetches a Warehouse Receipt by PO number.
 */
export async function fetchPOReceipt(poNumber: string) {
  const { data, error } = await supabase
    .from(TABLES.warehouseReceipts)
    .select('*')
    .eq('po_number', poNumber)
    .maybeSingle();

  if (error) {
    console.error('Error fetching PO Receipt:', error);
    return null;
  }
  return data;
}

/**
 * Fetches a Vendor Invoice by invoice number.
 */
export async function fetchVendorInvoice(invoiceNumber: string) {
  const { data, error } = await supabase
    .from(TABLES.vendorInvoices)
    .select('*')
    .eq('invoice_number', invoiceNumber)
    .maybeSingle();

  if (error) {
    console.error('Error fetching Vendor Invoice:', error);
    return null;
  }
  return data;
}
