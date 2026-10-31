import { domToPng } from 'modern-screenshot';


// rasterizes the live A4 preview; scale 2 gives ~150dpi, enough for messengers and print
const PNG_SCALE = 2;

export async function generateReceiptPng(sheet: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await domToPng(sheet, {
    // layout size, not getBoundingClientRect: the preview is scaled down with
    // a CSS transform on narrow screens and the default measurement crops the image
    width: sheet.offsetWidth,
    height: sheet.offsetHeight,
    scale: PNG_SCALE,
    backgroundColor: '#ffffff',
    style: { boxShadow: 'none' },
  });

  const link = document.createElement('a');

  link.href = dataUrl;
  link.download = filename;
  link.click();
}
