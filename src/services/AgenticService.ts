import { Type } from "@google/genai";
import { supabase } from './supabase';
import { TABLES } from './dbService';
import { callGemini } from './geminiProxy';

/**
 * AgenticService - Simulates AI-Agent and REST API endpoints for Cognitive AP.
 * All LLM calls go through the `gemini-proxy` Supabase Edge Function so the
 * real Gemini API key stays a server-side secret.
 */

const routerMockFallback = (safeText: string): 'Invoice' | 'Acknowledgement' | 'Inquiry' => {
  const lowerText = safeText.toLowerCase();
  if (lowerText.includes('delay') || lowerText.includes('split') || lowerText.includes('backorder')) {
    return 'Acknowledgement';
  }
  if (lowerText.includes('amount') || lowerText.includes('freight') || lowerText.includes('due')) {
    return 'Invoice';
  }
  return 'Inquiry';
};

/**
 * Agent 1 (The Router): Analyzes the text and returns an intent string.
 */
export async function runRouterAgent(text: string): Promise<'Invoice' | 'Acknowledgement' | 'Inquiry'> {
  const safeText = text || "";

  try {
    const systemInstruction = `You are an Accounts Payable Document Router.
Analyze the provided text and classify its intent into EXACTLY one of these categories: "Invoice", "Acknowledgement", or "Inquiry".
Return ONLY the category name as a string.`;

    const text_ = await callGemini({
      model: "gemini-3-flash-preview",
      contents: safeText,
      config: {
        systemInstruction: systemInstruction,
      }
    });

    const intent = text_.trim() as any;
    if (['Invoice', 'Acknowledgement', 'Inquiry'].includes(intent)) {
      return intent;
    }
    return routerMockFallback(safeText);
  } catch (error) {
    console.error("RouterAgent failed, falling back to mock:", error);
    return routerMockFallback(safeText);
  }
}

/**
 * Agent 2 (The Extractor): Extracts entities if the intent is "Acknowledgement".
 */
export async function runExtractorAgent(text: string, intent: string) {
  const safeText = text || "";
  if (intent !== 'Acknowledgement') {
    return { message: "Extraction skipped: Intent is not Acknowledgement" };
  }

  const mockFallback = () => {
    const poMatch = safeText.match(/PO-\d+/i);
    return {
      poNumber: poMatch ? poMatch[0].toUpperCase() : null,
      delayStatus: safeText.toLowerCase().includes('delay') ? 'Delayed' : 'Confirmed',
      quantity: safeText.match(/\d+ units/i)?.[0] || null
    };
  };

  try {
    const systemInstruction = `You are an Accounts Payable Data Extractor.
The document has been classified as an "Acknowledgement".
Extract the following entities from the text:
- PO Number (e.g., PO-1234)
- Delay Status (e.g., Delayed, Confirmed, Split)
- Quantity mentioned

Return a PURE JSON object matching this schema:
{
  "poNumber": string | null,
  "delayStatus": string | null,
  "quantity": string | null
}`;

    const responseText = await callGemini({
      model: "gemini-3-flash-preview",
      contents: safeText,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            poNumber: { type: Type.STRING, nullable: true },
            delayStatus: { type: Type.STRING, nullable: true },
            quantity: { type: Type.STRING, nullable: true }
          },
          required: ["poNumber", "delayStatus", "quantity"]
        }
      }
    });

    return JSON.parse(responseText || "{}");
  } catch (error) {
    console.error("ExtractorAgent failed, falling back to mock:", error);
    return mockFallback();
  }
}

/**
 * Performs multimodal extraction (OCR + CV) from an uploaded document.
 */
export async function performMultimodalExtraction(base64Data: string, mimeType: string) {
  const mockFallback = () => ({
    vendorName: "Mock Vendor Inc.",
    totalAmount: 1250.50,
    poNumber: "PO-9999"
  });

  try {
    const systemInstruction = "You are an OCR and CV agent. Read this uploaded document. Extract the Vendor Name, Total Amount, and PO Number, and return it strictly as a JSON object.";

    const responseText = await callGemini({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType
          }
        },
        {
          text: "Please extract the data from this document."
        }
      ],
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            vendorName: { type: Type.STRING },
            totalAmount: { type: Type.NUMBER },
            poNumber: { type: Type.STRING }
          },
          required: ["vendorName", "totalAmount", "poNumber"]
        }
      }
    });

    return JSON.parse(responseText || "{}");
  } catch (error) {
    console.error("Multimodal extraction failed, falling back to mock:", error);
    return mockFallback();
  }
}

/**
 * Orchestrator: Processes the document through the multi-agent pipeline.
 */
export async function processDocumentPipeline(text: string) {
  console.log("--- Starting Multi-Agent Pipeline ---");
  
  console.log("Step 1: Running Router Agent...");
  const intent = await runRouterAgent(text);
  console.log(`Router Result: ${intent}`);

  console.log("Step 2: Running Extractor Agent...");
  const extraction = await runExtractorAgent(text, intent);
  console.log("Extractor Result:", extraction);

  return {
    intent,
    extraction,
    timestamp: new Date().toISOString()
  };
}

/**
 * Classifies the intent of a document based on text content using a Real LLM.
 * (Deprecated in favor of processDocumentPipeline, but kept for compatibility)
 */
export async function classifyDocumentIntent(textPayload: string) {
  // Fallback mock logic
  const mockFallback = (text: string) => {
    const lowerText = text.toLowerCase();
    let intent: 'Acknowledgement' | 'Invoice' | 'Inquiry' = 'Inquiry';
    let status: any = null;
    let po = null;

    if (lowerText.includes('delay') || lowerText.includes('split') || lowerText.includes('backorder')) {
      intent = 'Acknowledgement';
      status = 'Delayed';
    } else if (lowerText.includes('amount') || lowerText.includes('freight') || lowerText.includes('due')) {
      intent = 'Invoice';
    }

    const poMatch = text.match(/PO-\d+/i);
    if (poMatch) po = poMatch[0].toUpperCase();

    return {
      intent,
      confidenceScore: 0.85,
      supplyChainStatus: status,
      extractedPoNumber: po
    };
  };

  try {
    const systemInstruction = `You are an Accounts Payable Document Classifier.
Analyze the provided text payload from a vendor and classify its intent.
Return a PURE JSON object exactly matching this schema:
{
  "intent": "Invoice" | "Acknowledgement" | "Inquiry",
  "confidenceScore": number (0.0 to 1.0),
  "supplyChainStatus": "Delayed" | "Confirmed" | "Split Shipment" | "Price Change" | null,
  "extractedPoNumber": "PO-XXXX" or null
}
Do not include any markdown formatting or extra text.`;

    const responseText = await callGemini({
      model: "gemini-3-flash-preview",
      contents: textPayload,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: { type: Type.STRING, enum: ["Invoice", "Acknowledgement", "Inquiry"] },
            confidenceScore: { type: Type.NUMBER },
            supplyChainStatus: { type: Type.STRING, nullable: true, enum: ["Delayed", "Confirmed", "Split Shipment", "Price Change", null] },
            extractedPoNumber: { type: Type.STRING, nullable: true }
          },
          required: ["intent", "confidenceScore", "supplyChainStatus", "extractedPoNumber"]
        }
      }
    });

    return JSON.parse(responseText || "{}");
  } catch (error) {
    console.error("AgenticService: LLM API call failed, falling back to mock:", error);
    return mockFallback(textPayload);
  }
}

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

// --- 3-Way Match & Variance Agent ---

interface InvoiceMatchData {
  invoice_number: string;
  po_number: string;
  billed_quantity: number;
  freight_amount: number;
}

/**
 * Executes a 3-way match logic between Invoice, PO, and Receipt.
 */
export async function executeThreeWayMatch(invoiceData: InvoiceMatchData) {
  const po = await fetchPoByVendor(invoiceData.po_number);
  const receipt = await fetchPOReceipt(invoiceData.po_number);

  if (!po || !receipt) {
    return {
      success: false,
      reason: 'Missing PO or Receipt data for matching',
      details: { po: !!po, receipt: !!receipt }
    };
  }

  // Logic A: Quantity Mismatch
  if (invoiceData.billed_quantity > receipt.received_quantity) {
    return {
      success: false,
      reason: 'Quantity mismatch',
      details: {
        billed: invoiceData.billed_quantity,
        received: receipt.received_quantity
      }
    };
  }

  // Logic B: Freight Variance
  // Assuming po.freight_amount is the expected freight
  const poFreight = po.freight_amount || 0;
  const freightDifference = Math.abs(invoiceData.freight_amount - poFreight);

  if (freightDifference <= 5.00) {
    return {
      success: true,
      message: 'Straight-Through Processing: Auto-reconciled',
      details: {
        freightDifference,
        status: 'Auto-posted'
      }
    };
  } else {
    return {
      success: false,
      reason: 'Freight variance exceeds threshold',
      details: {
        freightDifference,
        threshold: 5.00
      }
    };
  }
}
