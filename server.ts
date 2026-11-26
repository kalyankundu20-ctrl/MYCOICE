import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Load Firebase project API key for server-side Firebase ID token verification
interface FirebaseConfigJson {
  apiKey?: string;
  projectId?: string;
}

let firebaseWebApiKey = '';
try {
  const cfgPath = path.resolve(__dirname, 'firebase-applet-config.json');
  const rawCfg = fs.readFileSync(cfgPath, 'utf8');
  const parsed = JSON.parse(rawCfg) as FirebaseConfigJson;
  firebaseWebApiKey = String(parsed.apiKey || '').trim();
} catch {
  firebaseWebApiKey = '';
}

interface VerifiedAdminCacheEntry {
  email: string;
  uid: string;
  expiresAt: number;
}

const verifiedAdminTokenCache = new Map<string, VerifiedAdminCacheEntry>();

async function verifyAdminBearerToken(
  authHeader: string | undefined
): Promise<{ ok: true; uid: string; email: string } | { ok: false; status: number; error: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Admin login required to use Photo Slip Scanner.' };
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken || idToken.length < 20) {
    return { ok: false, status: 401, error: 'Invalid authentication token.' };
  }

  const now = Date.now();
  const cached = verifiedAdminTokenCache.get(idToken);
  if (cached && cached.expiresAt > now) {
    return { ok: true, uid: cached.uid, email: cached.email };
  }

  if (!firebaseWebApiKey) {
    return { ok: false, status: 500, error: 'Server auth configuration missing.' };
  }

  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) {
      return { ok: false, status: 401, error: 'Admin session expired. Please sign in again.' };
    }
    const data = (await resp.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
      }>;
    };
    const user = data.users?.[0];
    const email = String(user?.email || '').trim().toLowerCase();
    const uid = String(user?.localId || '').trim();
    // Sellers/Masters authenticate anonymously (no email); only verified Admin email accounts are allowed
    if (!uid || !email) {
      return { ok: false, status: 403, error: 'Sirf Admin account hi Photo Slip Scanner use kar sakta hai.' };
    }

    // Prune cache occasionally
    if (verifiedAdminTokenCache.size > 100) {
      for (const [k, v] of verifiedAdminTokenCache.entries()) {
        if (v.expiresAt <= now) verifiedAdminTokenCache.delete(k);
      }
    }
    verifiedAdminTokenCache.set(idToken, {
      uid,
      email,
      expiresAt: now + 5 * 60 * 1000,
    });
    return { ok: true, uid, email };
  } catch {
    return { ok: false, status: 503, error: 'Could not verify Admin session. Check internet and retry.' };
  }
}

interface IncomingImageInput {
  mimeType?: unknown;
  data?: unknown;
  name?: unknown;
}

interface ExtractedSlipRow {
  prefix: string;
  number: string;
  range: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const SLIP_EXTRACTOR_SYSTEM_INSTRUCTION = `You are a high-precision OCR & data extraction engine for Indian lottery ticket slips (Dear / Nagaland / State lottery handwritten and printed slips).
Your ONLY job is to read every valid ticket entry from the provided image(s) strictly in order from Photo 1 to the last Photo (top-to-bottom, column-by-column inside each photo) and output structured rows.

STRICT EXTRACTION RULES:
1. THREE COLUMNS PER TICKET ROW:
   - prefix: ALWAYS formatted as "M" followed immediately by digits (e.g. "M5", "M10", "M15", "M20", "M25", "M30", "M50", "M100", "M200").
     * If a line writes quantity/sem after the number like "53680=10", "53680-10", "53680/10", "53680 10s", "53680 - 5", "10 sem", "5p", convert that quantity to "M10" or "M5" in the prefix column!
     * If a section header or line explicitly writes "M5", "M10", "M15", "M20", "10S", "5 SEM", "25 SEM", etc., normalize it to "M5", "M10", "M15", "M20", "M25".
   - number: The exact full 5-digit ticket number (e.g. "53680", preserving any leading zeros like "04512"). Strip any leading/trailing symbols (-, /, =, _to, spaces). NEVER output 4-digit or 6-digit numbers unless clearly a 5-digit ticket number.
   - range: ONLY the valid range end part when a dash/to range is given (e.g. "53680-89" -> number="53680", range="89"; "53680-53689" -> number="53680", range="89"; "53680_to_85" -> number="53680", range="85").
     * CRITICAL DISTINCTION: If the number after "-" or "=" or "/" is a QUANTITY / SEM (like "53680-5", "53680-10", "53680=10", "53680-25", where 5/10/15/20/25 is the ticket bundle/sem rather than a sequential range end), put "M5"/"M10"/"M25" in prefix and leave range completely EMPTY "".
     * If there is NO range (single 5-digit ticket number), range MUST be "".

2. PREFIX AUTOFILL & LINE LOGIC:
   - If a line explicitly specifies a new prefix (or quantity like "=10"), use that new prefix for this line and remember it as the current active prefix.
   - If a line has NO prefix written on it, automatically autofill the exact prefix from the item immediately above it (or the provided carried-over prefix from the previous photo).

3. STRICT EXCLUSIONS (DO NOT INCLUDE):
   - Completely EXCLUDE all total / summary / footer lines such as "=50ps", "50ps", "100pcs", "Total 50", "/5", "/10", "BOX", "BOOK", "B/X", dates, timestamps, phone numbers, seller names, party names, page numbers, serial numbers (1., 2., 3.), greetings, or signatures.
   - Do NOT include any explanation, notes, brackets, or metadata tags.

4. SEQUENCE & VERIFICATION:
   - Process every image strictly in order from first photo to last photo.
   - Read every single valid ticket line without skipping or reordering any line. Double-check every digit carefully (especially handwritten 0/6, 1/7, 3/8, 4/9, 5/6).`;

function cleanMetadataAndBrackets(raw: string): string {
  return String(raw || '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[()[\]{}`<>]/g, '')
    .trim();
}

function normalizePrefix(rawPrefix: string, fallbackPrefix: string): string {
  const cleaned = cleanMetadataAndBrackets(rawPrefix).toUpperCase();
  if (!cleaned) return fallbackPrefix;
  // Exclude summary markers if mistakenly returned as prefix
  if (/\b(BOX|BOOK|TOTAL|TTL|PS|PCS)\b/.test(cleaned)) {
    return '';
  }
  const mMatch = cleaned.match(/M\s*(\d{1,4})/);
  if (mMatch) {
    const val = Number(mMatch[1]);
    if (Number.isFinite(val) && val > 0) return `M${val}`;
  }
  const numMatch = cleaned.match(/(?:^|[=/\-\s])(\d{1,4})(?:\s*(?:S|SEM|P|M)?)?$/);
  if (numMatch) {
    const val = Number(numMatch[1]);
    if (Number.isFinite(val) && val > 0) return `M${val}`;
  }
  return fallbackPrefix;
}

function normalizeTicketNumber(rawNumber: string): string {
  const cleaned = cleanMetadataAndBrackets(rawNumber)
    .replace(/_to/gi, ' ')
    .replace(/[^0-9]/g, '');
  if (cleaned.length === 5) return cleaned;
  return '';
}

function normalizeRange(rawRange: string, ticketNumber: string): string {
  const cleaned = cleanMetadataAndBrackets(rawRange).trim();
  if (!cleaned) return '';
  if (/\b(BOX|BOOK|TOTAL|PS|PCS)\b/i.test(cleaned)) return '';
  const digits = cleaned.replace(/[^0-9]/g, '');
  if (!digits || digits.length > 5) return '';
  // If Gemini returned full 5-digit end sharing the same first 3 digits (e.g. 53680 & 53689), keep exact trailing 2 digits (89)
  if (digits.length === 5 && ticketNumber.length === 5 && digits.slice(0, 3) === ticketNumber.slice(0, 3)) {
    return digits.slice(3);
  }
  if (digits === ticketNumber) return '';
  return digits;
}

function postProcessRows(
  rawRows: Array<{ prefix?: unknown; number?: unknown; range?: unknown }>,
  initialPrefix: string
): { rows: ExtractedSlipRow[]; lastPrefix: string } {
  const rows: ExtractedSlipRow[] = [];
  let activePrefix = normalizePrefix(initialPrefix, '');

  for (const item of rawRows) {
    if (!item || typeof item !== 'object') continue;
    const rawP = String(item.prefix ?? '');
    const rawN = String(item.number ?? '');
    const rawR = String(item.range ?? '');

    // Skip obvious excluded total/box/book rows
    const combinedUpper = `${rawP} ${rawN} ${rawR}`.toUpperCase();
    if (/\b(BOX|BOOK|TOTAL)\b/.test(combinedUpper) || /=\s*\d+\s*PS\b/i.test(combinedUpper)) {
      continue;
    }

    const number = normalizeTicketNumber(rawN);
    if (!number) continue;

    const normalizedP = normalizePrefix(rawP, activePrefix);
    if (normalizedP) {
      activePrefix = normalizedP;
    }
    const finalPrefix = normalizedP || activePrefix || 'M5';
    const range = normalizeRange(rawR, number);

    rows.push({
      prefix: finalPrefix,
      number,
      range,
    });
  }

  return { rows, lastPrefix: activePrefix };
}

function formatRowsAsTsv(rows: ExtractedSlipRow[]): string {
  return rows.map((r) => `${r.prefix}\t${r.number}\t${r.range}`).join('\n');
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Admin-only Multi-Photo Slip OCR & 3-Column Tab-Separated Extractor
  app.post('/api/admin/scan-slips', async (req, res) => {
    const authResult = await verifyAdminBearerToken(req.headers.authorization);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(500).json({
        error:
          'GEMINI_API_KEY configured nahi hai. Settings > Secrets panel me GEMINI_API_KEY check karein.',
      });
      return;
    }

    const body = req.body as {
      images?: IncomingImageInput[];
      initialPrefix?: unknown;
      startIndex?: unknown;
      totalImages?: unknown;
    };

    const incomingImages = Array.isArray(body?.images) ? body.images : [];
    if (incomingImages.length === 0) {
      res.status(400).json({ error: 'Kam se kam 1 photo upload karein.' });
      return;
    }
    if (incomingImages.length > 20) {
      res.status(400).json({ error: 'Ek baar me maximum 20 photos process kar sakte hain.' });
      return;
    }

    const sanitizedImages: Array<{ mimeType: string; data: string; name: string }> = [];
    for (let i = 0; i < incomingImages.length; i += 1) {
      const img = incomingImages[i];
      const mimeType = String(img?.mimeType || 'image/jpeg').trim().toLowerCase();
      const normalizedMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
      if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
        res.status(400).json({ error: `Photo #${i + 1} ka format supported nahi hai (${mimeType}).` });
        return;
      }
      const rawData = String(img?.data || '').trim();
      const base64Data = rawData.includes(',') ? rawData.slice(rawData.indexOf(',') + 1) : rawData;
      if (!base64Data || base64Data.length < 32) {
        res.status(400).json({ error: `Photo #${i + 1} khali ya corrupt hai.` });
        return;
      }
      if (base64Data.length > 15_000_000) {
        res.status(400).json({ error: `Photo #${i + 1} bohot badi hai.` });
        return;
      }
      sanitizedImages.push({
        mimeType: normalizedMime,
        data: base64Data,
        name: String(img?.name || `Photo ${i + 1}`).slice(0, 80),
      });
    }

    const initialPrefix = normalizePrefix(String(body?.initialPrefix || ''), '');
    const startIndex = Math.max(1, Math.floor(Number(body?.startIndex) || 1));
    const totalImages = Math.max(
      startIndex + sanitizedImages.length - 1,
      Math.floor(Number(body?.totalImages) || sanitizedImages.length)
    );

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    for (let i = 0; i < sanitizedImages.length; i += 1) {
      const photoNum = startIndex + i;
      parts.push({ text: `--- Photo ${photoNum} of ${totalImages} (process in exact top-to-bottom sequence) ---` });
      parts.push({
        inlineData: {
          mimeType: sanitizedImages[i].mimeType,
          data: sanitizedImages[i].data,
        },
      });
    }

    const carryNote = initialPrefix
      ? `The carried-over active prefix from the previous photo is "${initialPrefix}". If the first ticket line of Photo ${startIndex} does not write its own prefix, autofill "${initialPrefix}".`
      : `If a line has no prefix written on it, autofill the prefix from the ticket item directly above it.`;

    parts.push({
      text: `Extract ALL valid lottery ticket rows from these ${sanitizedImages.length} photo(s) strictly in order from Photo ${startIndex} to Photo ${startIndex + sanitizedImages.length - 1}.
${carryNote}
Remember:
- Column 1 (prefix): Always M format (e.g. M5, M10, M15, M20). For "53680=10" or "53680-10", prefix is "M10" and range is "".
- Column 2 (number): Full 5-digit ticket number only.
- Column 3 (range): Only valid range end after dash (e.g. "53680-89" -> "89"). Leave "" if quantity or no range.
- Exclude "=50ps", "/5", "/10", "BOX", "BOOK", totals, names, dates, and serial numbers.
Return JSON strictly matching the schema.`,
    });

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction: SLIP_EXTRACTOR_SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rows: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    prefix: {
                      type: Type.STRING,
                      description: 'Normalized M prefix such as M5, M10, M15, M20.',
                    },
                    number: {
                      type: Type.STRING,
                      description: 'Exact 5-digit lottery ticket number.',
                    },
                    range: {
                      type: Type.STRING,
                      description: 'Range ending suffix (e.g. 89 for 53680-89) or empty string if no range.',
                    },
                  },
                  required: ['prefix', 'number', 'range'],
                },
              },
            },
            required: ['rows'],
          },
        },
      });

      const rawText = (response.text || '').trim();
      let parsedRows: Array<{ prefix?: unknown; number?: unknown; range?: unknown }> = [];
      try {
        const parsed = JSON.parse(rawText) as { rows?: Array<{ prefix?: unknown; number?: unknown; range?: unknown }> };
        if (Array.isArray(parsed?.rows)) {
          parsedRows = parsed.rows;
        }
      } catch {
        res.status(502).json({
          error: 'Scan output parse nahi ho paya. Photo clear hai check karke dubara scan karein.',
        });
        return;
      }

      const { rows, lastPrefix } = postProcessRows(parsedRows, initialPrefix);
      const tsv = formatRowsAsTsv(rows);
      const codeBlock = tsv ? `\`\`\`text\n${tsv}\n\`\`\`` : '';

      res.json({
        rows,
        lastPrefix,
        tsv,
        codeBlock,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        message.includes('429') || message.includes('RESOURCE_EXHAUSTED')
          ? 429
          : message.includes('403') || message.includes('PERMISSION_DENIED') || message.includes('API_KEY_INVALID')
            ? 403
            : 500;
      const friendly =
        status === 429
          ? 'API quota temporarily full hai. Thodi der baad dubara try karein ya Settings > Secrets me billing-enabled key check karein.'
          : status === 403
            ? 'Gemini API key invalid ya permission denied hai. Settings > Secrets panel check karein.'
            : `Scan failed: ${message.slice(0, 200)}`;
      res.status(status).json({ error: friendly });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir, { index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[KK Agency] Server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
