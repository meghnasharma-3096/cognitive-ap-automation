/**
 * Turns an uploaded file / pasted text / email into the uniform ExtractInput the
 * extraction providers consume: text the model can read + raw attachments it can see.
 */
import { simpleParser } from 'mailparser';
import { extractText, getDocumentProxy } from 'unpdf';
import type { Attachment, ExtractInput } from './extraction/providers';

export interface RawDocument {
  filename: string;
  mimeType?: string;
  /** Base64 file content (PDF, image, .eml, .txt). */
  dataBase64?: string;
  /** Pasted text / email body. */
  text?: string;
}

export interface PreparedDocument {
  input: ExtractInput;
  /** All human-readable text we could pull out locally (used to verify the LLM's answers). */
  sourceText: string;
  kind: 'pdf' | 'image' | 'eml' | 'text';
  notes: string[];
}

const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif|heic|heif|bmp|tiff?)$/i;
const ext = (name: string) => name.toLowerCase().split('.').pop() ?? '';

const guessMime = (name: string, given?: string): string => {
  if (given && given !== 'application/octet-stream') return given;
  const e = ext(name);
  return ({
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', eml: 'message/rfc822', txt: 'text/plain', md: 'text/plain', csv: 'text/csv',
  } as Record<string, string>)[e] ?? 'application/octet-stream';
};

export async function pdfToText(buf: Uint8Array): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return (Array.isArray(text) ? text.join('\n') : text).trim();
  } catch {
    return '';
  }
}

export async function prepareDocument(doc: RawDocument): Promise<PreparedDocument> {
  const notes: string[] = [];

  // Pasted text, no file
  if (!doc.dataBase64) {
    const text = (doc.text ?? '').trim();
    if (!text) throw new Error('Nothing to ingest: no file content and no text');
    return { input: { filename: doc.filename, text, attachments: [] }, sourceText: text, kind: 'text', notes };
  }

  const mime = guessMime(doc.filename, doc.mimeType);
  const buf = Buffer.from(doc.dataBase64, 'base64');
  if (buf.length === 0) throw new Error('Uploaded file is empty');

  if (mime === 'application/pdf') {
    const text = await pdfToText(buf);
    if (text.length < 20) notes.push('PDF has no text layer (scanned): relying on the model to read the page image');
    return {
      input: { filename: doc.filename, text, attachments: [{ mimeType: mime, dataBase64: doc.dataBase64, filename: doc.filename }] },
      sourceText: text, kind: 'pdf', notes,
    };
  }

  if (IMAGE_MIME.test(mime)) {
    notes.push('Image input: values cannot be verified against a text layer');
    return {
      input: { filename: doc.filename, text: '', attachments: [{ mimeType: mime, dataBase64: doc.dataBase64, filename: doc.filename }] },
      sourceText: '', kind: 'image', notes,
    };
  }

  if (mime === 'message/rfc822' || ext(doc.filename) === 'eml') {
    const mail = await simpleParser(buf);
    const header = [
      mail.from?.text && `From: ${mail.from.text}`,
      mail.to && `To: ${Array.isArray(mail.to) ? mail.to.map(t => t.text).join(', ') : mail.to.text}`,
      mail.date && `Date: ${mail.date.toISOString().slice(0, 10)}`,
      mail.subject && `Subject: ${mail.subject}`,
    ].filter(Boolean).join('\n');
    let text = `${header}\n\n${(mail.text ?? '').trim()}`.trim();
    const attachments: Attachment[] = [];
    for (const a of mail.attachments ?? []) {
      const am = guessMime(a.filename ?? 'attachment', a.contentType);
      const b64 = a.content.toString('base64');
      if (am === 'application/pdf') {
        const pt = await pdfToText(a.content);
        if (pt) text += `\n\n--- attachment ${a.filename ?? ''} (text) ---\n${pt}`;
        attachments.push({ mimeType: am, dataBase64: b64, filename: a.filename });
        notes.push(`Attached PDF ${a.filename ?? ''} included`);
      } else if (IMAGE_MIME.test(am)) {
        attachments.push({ mimeType: am, dataBase64: b64, filename: a.filename });
        notes.push(`Attached image ${a.filename ?? ''} included`);
      }
    }
    return { input: { filename: doc.filename, text, attachments }, sourceText: text, kind: 'eml', notes };
  }

  if (mime.startsWith('text/') || ['txt', 'md', 'csv'].includes(ext(doc.filename))) {
    const text = buf.toString('utf8').trim();
    return { input: { filename: doc.filename, text, attachments: [] }, sourceText: text, kind: 'text', notes };
  }

  throw new Error(`Unsupported file type "${mime}". Use PDF, PNG/JPG, .eml or plain text.`);
}
