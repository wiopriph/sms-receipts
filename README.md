# Receipt Generator — ใบส่งสินค้า / ใบเสร็จรับเงิน

A single-page Nuxt app (SPA, no SSR) that generates Thai delivery/receipt PDFs
(ใบส่งสินค้า / ใบเสร็จรับเงิน) entirely in the browser — no backend required.

## Features

- Live A4 preview that mirrors the generated PDF, scales down on mobile.
- Vector PDF via [pdfmake](https://pdfmake.github.io/docs/) with embedded Sarabun
  (Thai/Latin) and Noto Sans (Cyrillic fallback) fonts — text stays selectable.
- PNG export (A4 at 2x, ~150dpi) rasterized from the live preview via
  [modern-screenshot](https://github.com/qq15725/modern-screenshot), handy for messengers.
- Amount in Thai words (บาทถ้วน), Buddhist-era filename, ฿ currency on the total.
- Items with quantity/unit price, optional discount and deposit (prepayment),
  subtotal/total block; with a deposit the document shows the balance due.
- Shop details (name, address, phone, website, tax ID, bank accounts, logo,
  payment QR) persist in `localStorage`; empty fields are hidden on the document.
- Receipt fields and items also persist in `localStorage`, so a reload does not
  lose the draft; the "Clear receipt fields" button resets them.
- Long spaceless Thai text is wrapped at dictionary word boundaries
  (`Intl.Segmenter`), since pdfmake's UAX#14 line breaker cannot break Thai.
- Uploaded images are normalized to PNG (pdfmake cannot embed WEBP).

## Default assets

- `public/logo.png` — default logo (shown above the shop name).
- `public/qr-default.png` — default payment QR.

Replace these files to change the defaults; per-browser overrides can be
uploaded in the "Shop details" section of the form.

## Development

```bash
npm install
npm run dev
```

## Production build (static hosting)

```bash
npm run generate
```

Deploy the `.output/public` directory to any static hosting.

## Project structure

- `app.vue` — form, live preview and app state.
- `utils/pdf.ts` — pdfmake document definition and font loading.
- `utils/png.ts` — PNG export of the preview sheet.
- `utils/thai.ts` — Thai baht words, amount and date formatting.
- `assets/main.css` — form panel and receipt (preview) styles.
