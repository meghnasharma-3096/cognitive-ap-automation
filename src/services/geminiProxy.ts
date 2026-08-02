import { supabase } from './supabase';

/**
 * Calls the `gemini-proxy` Supabase Edge Function instead of the
 * @google/genai SDK directly, so the real Gemini API key stays a
 * server-side secret and never ships in the public browser bundle.
 */
export const callGemini = async (params: {
  model: string;
  contents: any;
  config?: any;
}): Promise<string> => {
  const { data, error } = await supabase.functions.invoke('gemini-proxy', { body: params });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.text ?? '';
};
