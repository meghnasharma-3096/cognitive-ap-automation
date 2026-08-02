import { GoogleGenAI, Type } from "@google/genai";

const API_KEY = import.meta.env.VITE_LLM_API_KEY || "";

export interface ExtractedData {
  intent: 'Invoice' | 'Acknowledgement' | 'Inquiry';
  poNumber: string;
  vendorName: string;
  date: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    sku?: string;
  }>;
}

export const extractDocumentData = async (base64Data: string, mimeType: string): Promise<ExtractedData> => {
  if (!API_KEY) {
    console.warn("geminiService: No VITE_LLM_API_KEY found. Returning mock extraction result.");
    return {
      intent: 'Invoice',
      poNumber: 'PO-9999',
      vendorName: 'Mock Vendor Inc.',
      date: new Date().toISOString().split('T')[0],
      items: [{ description: 'Mock Item', quantity: 1, unitPrice: 100 }]
    };
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-preview",
    contents: [
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      },
      {
        text: "Extract data from this document. Identify the document intent (Invoice, Acknowledgement, or Inquiry). Extract PO Number, Vendor Name, and a list of items with their descriptions, quantities, and unit prices. Return the data in strict JSON format.",
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          intent: { type: Type.STRING, enum: ["Invoice", "Acknowledgement", "Inquiry"] },
          poNumber: { type: Type.STRING },
          vendorName: { type: Type.STRING },
          date: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                description: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                unitPrice: { type: Type.NUMBER },
                sku: { type: Type.STRING }
              },
              required: ["description", "quantity", "unitPrice"]
            }
          }
        },
        required: ["intent", "poNumber", "vendorName", "items"]
      }
    }
  });

  if (!response.text) {
    throw new Error("No text returned from Gemini");
  }

  return JSON.parse(response.text) as ExtractedData;
};
