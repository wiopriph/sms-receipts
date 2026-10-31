import { formatDisplayDate } from '~/utils/thai';


export interface ReceiptRow {
  description: string
  qty: string
  price: string
  amount: string
}

export interface ReceiptData {
  shop: {
    name: string
    address: string
    phone: string
    email: string
    website: string
    taxId: string
    note: string
    logo: string // PNG dataURL or ''
    qr: string // PNG dataURL or ''
    bankLines: string[]
  }
  book: string
  number: string
  date: Date
  customerCompany: string
  customer: string
  customerAddress: string
  customerPhone: string
  customerEmail: string
  customerTaxId: string
  rows: ReceiptRow[]
  subtotal: number
  discount: number
  total: number
  deposit: number
  amountDue: number // total minus deposit; equals total when there is no deposit
  totalWords: string
}

const ACCENT_COLOR = '#e6000e';
const INK_COLOR = '#374151';
const GRAY_COLOR = '#6b7280';
const MUTED_COLOR = '#9ca3af';
const FAINT_LINE_COLOR = '#f3f4f6';
const CARD_BACKGROUND = '#f9fafb';
const SIGNATURE_LINE_COLOR = '#d1d5db';
const CONTENT_WIDTH = 515; // A4 width minus page margins, pt

const FONTS = {
  Sarabun: {
    normal: 'Sarabun-Regular.ttf',
    bold: 'Sarabun-Bold.ttf',
    italics: 'Sarabun-Regular.ttf',
    bolditalics: 'Sarabun-Bold.ttf',
  },
  // Sarabun has no Cyrillic glyphs — Cyrillic runs are rendered with Noto Sans
  NotoSans: {
    normal: 'NotoSans-Regular.ttf',
    bold: 'NotoSans-Bold.ttf',
    italics: 'NotoSans-Regular.ttf',
    bolditalics: 'NotoSans-Bold.ttf',
  },
};

async function urlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

let pdfEnginePromise: Promise<any> | null = null;

function loadPdfEngine(): Promise<any> {
  if (!pdfEnginePromise) {
    pdfEnginePromise = (async () => {
      const pdfmakeModule: any = await import('pdfmake/build/pdfmake');
      const pdfMake = pdfmakeModule.default || pdfmakeModule;

      const [sarabunRegular, sarabunBold, notoSansRegular, notoSansBold] = await Promise.all([
        urlToDataUrl('/fonts/Sarabun-Regular.ttf'),
        urlToDataUrl('/fonts/Sarabun-Bold.ttf'),
        urlToDataUrl('/fonts/NotoSans-Regular.ttf'),
        urlToDataUrl('/fonts/NotoSans-Bold.ttf'),
      ]);

      const stripDataUrlHeader = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

      pdfMake.addVirtualFileSystem({
        'Sarabun-Regular.ttf': stripDataUrlHeader(sarabunRegular),
        'Sarabun-Bold.ttf': stripDataUrlHeader(sarabunBold),
        'NotoSans-Regular.ttf': stripDataUrlHeader(notoSansRegular),
        'NotoSans-Bold.ttf': stripDataUrlHeader(notoSansBold),
      });

      pdfMake.setFonts(FONTS);

      return pdfMake;
    })();
  }

  return pdfEnginePromise;
}

// pdfmake sizes table columns by the longest unbreakable word, and its line
// breaker (UAX#14) treats a spaceless Thai run as ONE word — a long run pushes
// columns off the page. Break long runs with newlines at proper Thai word
// boundaries via Intl.Segmenter. (Sarabun has no zero-width-space glyph, so
// U+200B would render as tofu boxes.)
const MAX_UNBROKEN_RUN = 40; // runs shorter than this always fit the description column
const HARD_CHUNK_LENGTH = 30; // fallback slice size for unsegmentable runs

const hasSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl;
const thaiWordSegmenter = hasSegmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const graphemeSegmenter = hasSegmenter ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;

// split at grapheme boundaries so base characters keep their combining marks
function splitIntoChunks(text: string, maxLength: number): string[] {
  const graphemes = graphemeSegmenter ? [...graphemeSegmenter.segment(text)].map((item) => item.segment) : text.split('');
  const chunks: string[] = [];

  let currentChunk = '';

  for (const grapheme of graphemes) {
    if (currentChunk.length + grapheme.length > maxLength) {
      chunks.push(currentChunk);
      currentChunk = grapheme;
    } else {
      currentChunk += grapheme;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function breakLongRuns(text: string): string {
  if (!text) {
    return text;
  }

  return text.replace(new RegExp(`\\S{${MAX_UNBROKEN_RUN},}`, 'g'), (run) => {
    const containsThai = /[฀-๿]/.test(run);
    const words = thaiWordSegmenter && containsThai ?
      [...thaiWordSegmenter.segment(run)].map((item) => item.segment) :
      splitIntoChunks(run, HARD_CHUNK_LENGTH);

    // greedily pack words into lines that fit the column
    const maxLineLength = MAX_UNBROKEN_RUN - 2;
    const lines: string[] = [];

    let currentLine = '';

    for (const word of words) {
      const pieces = word.length > maxLineLength ? splitIntoChunks(word, HARD_CHUNK_LENGTH) : [word];

      for (const piece of pieces) {
        if (currentLine && currentLine.length + piece.length > maxLineLength) {
          lines.push(currentLine);
          currentLine = piece;
        } else {
          currentLine += piece;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.join('\n');
  });
}

// Split a string into pdfmake rich-text chunks: Cyrillic runs use NotoSans
// (Sarabun would render them as tofu), everything else stays on the default font.
const CYRILLIC_PATTERN = /[Ѐ-ӿԀ-ԯ]/;
const CYRILLIC_RUN_PATTERN = /([Ѐ-ӿԀ-ԯ]+(?:[\s\d.,:;!?()"'%№-]+[Ѐ-ӿԀ-ԯ]+)*)/;

function withCyrillicFallback(text: string): any {
  if (!text || !CYRILLIC_PATTERN.test(text)) {
    return text;
  }

  return text
    .split(CYRILLIC_RUN_PATTERN)
    .filter((part) => part !== '')
    .map((part) => (CYRILLIC_PATTERN.test(part) ? { text: part, font: 'NotoSans' } : { text: part }));
}

/** user-entered text, safe for pdfmake: long runs broken, Cyrillic on a fallback font */
function userText(text: string): any {
  return withCyrillicFallback(breakLongRuns(text));
}

function formatBahtAmount(value: number): string {
  if (!isFinite(value) || value === 0) {
    return '-';
  }

  return `฿${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatAmount(value: number): string {
  if (!isFinite(value) || value === 0) {
    return '-';
  }

  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function generateReceiptPdf(receipt: ReceiptData, filename: string, mode: 'download' | 'base64' = 'download'): Promise<string | void> {
  const pdfMake = await loadPdfEngine();

  // compact "นาม CUSTOMER: value" row (label and value on one line)
  const labeledValueRow = (thaiLabel: string, englishLabel: string, value: string, labelWidth = 88) => ({
    columns: [
      {
        width: labelWidth,
        text: [
          { text: thaiLabel, color: GRAY_COLOR },
          { text: `  ${englishLabel}`, fontSize: 6.5, color: MUTED_COLOR, characterSpacing: 0.3 },
        ],
      },
      { width: '*', text: userText(value) || ' ', color: INK_COLOR },
    ],
    margin: [0, 1.5, 0, 1.5] as [number, number, number, number],
  });

  const tableHeaderCell = (thaiLabel: string, englishLabel: string, align: 'left' | 'center' | 'right') => ({
    stack: [
      { text: thaiLabel, bold: true, color: ACCENT_COLOR, fontSize: 9.5, noWrap: true },
      {
        text: englishLabel,
        fontSize: 6.5,
        characterSpacing: 1,
        color: MUTED_COLOR,
        noWrap: true,
        margin: [0, 1.5, 0, 0],
      },
    ],
    alignment: align,
    margin: [0, 1, 0, 2] as [number, number, number, number],
  });

  const horizontalRule = (width: number, color: string, lineWidth = 1.5) => ({
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth, lineColor: color }],
  });

  // ----- header -----
  const contactLines: any[] = [];

  if (receipt.shop.address) {
    contactLines.push({ text: userText(receipt.shop.address), margin: [0, 0, 0, 2] });
  }

  const phoneEmailWebsite = [
    receipt.shop.phone ? `โทร. ${receipt.shop.phone}` : '',
    receipt.shop.email,
    receipt.shop.website,
  ].filter(Boolean).join('  ·  ');

  if (phoneEmailWebsite) {
    contactLines.push({ text: phoneEmailWebsite, margin: [0, 0, 0, 2] });
  }

  if (receipt.shop.taxId) {
    contactLines.push({ text: `Tax ID: ${receipt.shop.taxId}` });
  }

  // compact document meta, right of the company identity
  const documentMetaLine = (thaiLabel: string, englishLabel: string, value: string) => ({
    columns: [
      {
        width: '*',
        text: [
          { text: thaiLabel, color: GRAY_COLOR, fontSize: 8.5 },
          { text: `  ${englishLabel}`, color: MUTED_COLOR, fontSize: 6.5, characterSpacing: 0.5 },
        ],
        alignment: 'right',
      },
      {
        width: 62,
        text: userText(value),
        alignment: 'right',
        bold: true,
        color: INK_COLOR,
        fontSize: 8.5,
        noWrap: true,
      },
    ],
    columnGap: 10,
    margin: [0, 1.5, 0, 1.5] as [number, number, number, number],
  });

  const documentMeta: any[] = [];

  if (receipt.book) {
    documentMeta.push(documentMetaLine('เล่มที่', 'BOOK NO.', receipt.book));
  }

  if (receipt.number) {
    documentMeta.push(documentMetaLine('เลขที่', 'DOC NO.', receipt.number));
  }

  documentMeta.push(documentMetaLine('วันที่', 'DATE', formatDisplayDate(receipt.date)));

  const header = {
    columns: [
      {
        width: '*',
        stack: [
          ...(receipt.shop.logo ? [{ image: receipt.shop.logo, fit: [170, 34], margin: [0, 0, 0, 8] }] : []),
          ...(receipt.shop.name ?
            [{
              text: userText(receipt.shop.name),
              fontSize: 20,
              bold: true,
              color: ACCENT_COLOR,
            }] :
            []),
          {
            stack: contactLines,
            fontSize: 8.5,
            color: GRAY_COLOR,
            lineHeight: 1.15,
            margin: [0, receipt.shop.name || receipt.shop.logo ? 7 : 0, 0, 0],
          },
        ],
      },
      {
        width: 168,
        stack: [
          {
            text: 'ใบส่งสินค้า / ใบเสร็จรับเงิน',
            bold: true,
            fontSize: 12,
            color: ACCENT_COLOR,
            alignment: 'right',
          },
          {
            text: 'DELIVERY / RECEIPT',
            fontSize: 7,
            color: MUTED_COLOR,
            alignment: 'right',
            characterSpacing: 3,
            margin: [0, 3, 0, 8],
          },
          ...documentMeta,
        ],
        margin: [0, 3, 0, 0],
      },
    ],
  };

  // ----- bill to (two-column grid; the long address goes full-width below) -----
  const billToRows: any[] = [];

  if (receipt.customerCompany) {
    billToRows.push(labeledValueRow('บริษัท', 'COMPANY', receipt.customerCompany));
  }

  if (receipt.customer) {
    billToRows.push(labeledValueRow('นาม', 'CUSTOMER', receipt.customer));
  }

  if (receipt.customerTaxId) {
    billToRows.push(labeledValueRow('เลขผู้เสียภาษี', 'TAX ID', receipt.customerTaxId));
  }

  if (receipt.customerPhone) {
    billToRows.push(labeledValueRow('เบอร์โทร', 'PHONE', receipt.customerPhone));
  }

  if (receipt.customerEmail) {
    billToRows.push(labeledValueRow('อีเมล์', 'EMAIL', receipt.customerEmail));
  }

  // distribute rows across two columns like the web grid (row-wise: 1st left, 2nd right, …)
  const billToLeftColumn = billToRows.filter((_, index) => index % 2 === 0);
  const billToRightColumn = billToRows.filter((_, index) => index % 2 === 1);

  const billToSection = (billToRows.length || receipt.customerAddress) ?
    [{
      margin: [0, 16, 0, 0] as [number, number, number, number],
      stack: [
        {
          text: [
            { text: 'ลูกค้า', bold: true, fontSize: 10, color: ACCENT_COLOR },
            { text: '   BILL TO', fontSize: 7, characterSpacing: 1.5, color: MUTED_COLOR },
          ],
          margin: [0, 0, 0, 4],
        },
        {
          columns: [
            { width: '*', stack: billToLeftColumn },
            { width: 30, text: '' },
            { width: '*', stack: billToRightColumn },
          ],
        },
        ...(receipt.customerAddress ? [labeledValueRow('ที่อยู่', 'ADDRESS', receipt.customerAddress)] : []),
      ],
    }] :
    [];

  // ----- items -----
  const itemTableRows = receipt.rows.map((row, index) => [
    { text: row.description ? String(index + 1) : ' ', alignment: 'center', color: GRAY_COLOR },
    { text: userText(row.description) || ' ' },
    { text: userText(row.qty) || ' ', alignment: 'right' },
    { text: row.price || ' ', alignment: 'right', noWrap: true },
    { text: row.amount || ' ', alignment: 'right', noWrap: true },
  ]);

  const itemsSection = {
    margin: [0, 24, 0, 0] as [number, number, number, number],
    table: {
      widths: [28, '*', 60, 'auto', 'auto'],
      body: [
        [
          tableHeaderCell('ลำดับ', 'NO.', 'center'),
          tableHeaderCell('รายการ', 'DESCRIPTION', 'left'),
          tableHeaderCell('จำนวน', 'QTY', 'right'),
          tableHeaderCell('หน่วยละ', 'UNIT PRICE', 'right'),
          tableHeaderCell('จำนวนเงิน', 'AMOUNT', 'right'),
        ],
        ...itemTableRows,
      ],
      dontBreakRows: true,
    },
    layout: {
      hLineWidth: (lineIndex: number) => {
        if (lineIndex === 0) {
          return 0;
        }

        return lineIndex === 1 ? 1.5 : 0.5;
      },
      hLineColor: (lineIndex: number) => (lineIndex === 1 ? ACCENT_COLOR : FAINT_LINE_COLOR),
      vLineWidth: () => 0,
      paddingLeft: () => 7,
      paddingRight: () => 7,
      paddingTop: () => 7,
      paddingBottom: () => 7,
    },
  };

  // ----- totals -----
  const totalsLine = (thaiLabel: string, englishLabel: string, value: string) => ({
    columns: [
      {
        width: '*',
        text: [
          { text: thaiLabel, color: GRAY_COLOR },
          { text: `  ${englishLabel}`, fontSize: 7, color: MUTED_COLOR },
        ],
      },
      { width: 'auto', text: value, alignment: 'right', color: GRAY_COLOR, noWrap: true },
    ],
    margin: [0, 2.5, 0, 2.5] as [number, number, number, number],
  });

  const totalsColumn: any[] = [totalsLine('ยอดรวม', 'SUBTOTAL', formatAmount(receipt.subtotal))];

  if (receipt.discount > 0) {
    totalsColumn.push(totalsLine('ส่วนลด', 'DISCOUNT', `−${formatAmount(receipt.discount)}`));
  }

  const hasDeposit = receipt.deposit > 0;

  if (hasDeposit) {
    totalsColumn.push(totalsLine('รวมเงิน', 'TOTAL', formatAmount(receipt.total)));
    totalsColumn.push(totalsLine('มัดจำ', 'DEPOSIT', `−${formatAmount(receipt.deposit)}`));
  }

  totalsColumn.push({ ...horizontalRule(210, ACCENT_COLOR), margin: [0, 5, 0, 0] });

  totalsColumn.push({
    columns: [
      {
        width: '*',
        text: [
          { text: hasDeposit ? 'ยอดคงเหลือ' : 'รวมเงิน', bold: true, color: ACCENT_COLOR, fontSize: 11 },
          { text: hasDeposit ? '  BALANCE DUE' : '  TOTAL', fontSize: 7.5, characterSpacing: 1.5, color: MUTED_COLOR },
        ],
        margin: [0, 9, 0, 0],
      },
      {
        width: 'auto',
        text: formatBahtAmount(receipt.amountDue),
        alignment: 'right',
        bold: true,
        fontSize: 17,
        color: ACCENT_COLOR,
        noWrap: true,
        margin: [0, 4, 0, 0],
      },
    ],
  });

  if (receipt.totalWords) {
    totalsColumn.push({
      text: `(${receipt.totalWords})`,
      fontSize: 8,
      color: MUTED_COLOR,
      alignment: 'right',
      margin: [0, 6, 0, 0],
    });
  }

  // ----- payment card (sits left of the totals) -----
  const paymentColumns: any[] = [];

  if (receipt.shop.qr) {
    paymentColumns.push({ width: 86, image: receipt.shop.qr, fit: [72, 72], margin: [0, 2, 14, 0] });
  }

  if (receipt.shop.bankLines.length) {
    paymentColumns.push({
      width: '*',
      stack: receipt.shop.bankLines.map((bankLine) => ({
        columns: [
          { width: 8, text: '•', color: ACCENT_COLOR },
          { width: '*', text: userText(bankLine), color: INK_COLOR },
        ],
        margin: [0, 2.5, 0, 2.5],
      })),
      fontSize: 9,
    });
  }

  const paymentCard = (receipt.shop.bankLines.length || receipt.shop.qr) ?
    {
      table: {
        widths: ['*'],
        body: [
          [
            {
              fillColor: CARD_BACKGROUND,
              margin: [12, 10, 12, 10],
              stack: [
                {
                  text: [
                    { text: 'ช่องทางชำระเงิน', bold: true, fontSize: 10, color: ACCENT_COLOR },
                    { text: '   PAYMENT', fontSize: 7, characterSpacing: 1.5, color: MUTED_COLOR },
                  ],
                  margin: [0, 0, 0, 8],
                },
                { columns: paymentColumns },
              ],
            },
          ],
        ],
      },
      layout: 'noBorders',
    } :
    { text: ' ' };

  // payment (left) + totals (right) share one row
  const paymentAndTotalsSection = {
    margin: [0, 18, 0, 0] as [number, number, number, number],
    columns: [
      { width: '*', stack: [paymentCard] },
      { width: 34, text: '' },
      { width: 210, stack: totalsColumn },
    ],
  };

  // ----- signatures -----
  const signatureBlock = (thaiLabel: string, englishLabel: string, dateValue?: string) => ({
    width: 190,
    stack: [
      { ...horizontalRule(190, SIGNATURE_LINE_COLOR, 0.8), margin: [0, 42, 0, 0] },
      {
        text: [
          { text: thaiLabel, bold: true, fontSize: 9.5, color: INK_COLOR },
          { text: `  ${englishLabel}`, fontSize: 7.5, color: MUTED_COLOR },
        ],
        margin: [0, 6, 0, 0],
      },
      {
        text: [
          { text: 'วันที่', fontSize: 8.5, color: GRAY_COLOR },
          { text: ' Date  ', fontSize: 7, color: MUTED_COLOR },
          dateValue ?
            { text: dateValue, fontSize: 8.5, bold: true, color: INK_COLOR } :
            { text: '.'.repeat(40), color: SIGNATURE_LINE_COLOR },
        ],
        margin: [0, 8, 0, 0],
      },
    ],
  });

  const signaturesSection = {
    margin: [0, 34, 0, 0] as [number, number, number, number],
    columns: [
      signatureBlock('ผู้วางบิล', 'Prepared by', formatDisplayDate(receipt.date)),
      { width: '*', text: '' },
      signatureBlock('ผู้รับเงิน', 'Received by'),
    ],
  };

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 42, 40, 42] as [number, number, number, number],
    defaultStyle: { font: 'Sarabun', fontSize: 9.5, color: INK_COLOR },
    info: { title: filename.replace(/\.pdf$/, '') },
    content: [
      header,
      { ...horizontalRule(CONTENT_WIDTH, ACCENT_COLOR), margin: [0, 12, 0, 0] },
      ...billToSection,
      itemsSection,
      paymentAndTotalsSection,
      signaturesSection,
      ...(receipt.shop.note ?
        [{
          text: userText(receipt.shop.note),
          color: MUTED_COLOR,
          fontSize: 8,
          margin: [0, 24, 0, 0],
        }] :
        []),
    ],
  };

  const pdf = pdfMake.createPdf(docDefinition);

  if (mode === 'base64') {
    return pdf.getBase64();
  }

  await pdf.download(filename);
}
