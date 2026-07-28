<script setup lang="ts">
import { bahtText, formatAmount, formatBaht, formatDisplayDate } from '~/utils/thai';


interface ReceiptItem {
  description: string
  qty: number | null
  unit: string
  price: number | null
}

const A4_WIDTH_PX = 794; // 210mm @ 96dpi
const A4_HEIGHT_PX = 1123; // 297mm @ 96dpi
const SHOP_STORAGE_KEY = 'receipt-shop';

const todayIsoDate = new Date().toISOString()
  .slice(0, 10);

const shop = reactive({
  name: '',
  address: '50/2 Moo 4, Bo Phut, Koh Samui 84320',
  phone: '+66-095-420-7665',
  email: '',
  website: 'www.supermansamui.com',
  taxId: '',
  banks: 'ตรงนี้เราจะใส่ข้อมูลบัญชีธนาคารครับ', // one account per line
  note: '',
  logo: '', // PNG dataURL
  qr: '', // PNG dataURL
});

const receiptDetails = reactive({
  book: '',
  number: '',
  date: todayIsoDate,
  discount: null as number | null,
  customerCompany: '',
  customer: '',
  customerAddress: '',
  customerPhone: '',
  customerEmail: '',
  customerTaxId: '',
});

const items = ref<ReceiptItem[]>([{ description: '', qty: null, unit: '', price: null }]);

function addItem() {
  items.value.push({ description: '', qty: null, unit: '', price: null });
}

function removeItem(index: number) {
  items.value.splice(index, 1);
}

onMounted(async () => {
  const savedJson = localStorage.getItem(SHOP_STORAGE_KEY);

  if (savedJson) {
    // keep new defaults for fields the user never filled in
    const savedShop = JSON.parse(savedJson);

    for (const key of Object.keys(savedShop)) {
      if (savedShop[key]) {
        (shop as Record<string, unknown>)[key] = savedShop[key];
      }
    }
  }

  watch(shop, () => localStorage.setItem(SHOP_STORAGE_KEY, JSON.stringify(shop)), { deep: true });

  // default images shipped with the app
  const loadDefaultImage = async (field: 'logo' | 'qr', url: string) => {
    if (shop[field]) {
      return;
    }

    try {
      const response = await fetch(url);

      if (response.ok && response.headers.get('content-type')?.startsWith('image/')) {
        const pngDataUrl = await toPngDataUrl(await response.blob());

        if (!shop[field]) {
          shop[field] = pngDataUrl;
        }
      }
    } catch {
      // no default image available
    }
  };

  await Promise.all([
    loadDefaultImage('qr', '/qr-default.png'),
    loadDefaultImage('logo', '/logo.png'),
  ]);
});

// normalize any image (incl. webp, which pdfmake can't embed) to a PNG dataURL
async function toPngDataUrl(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');

  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);

  return canvas.toDataURL('image/png');
}

async function onImagePick(event: Event, field: 'logo' | 'qr') {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  shop[field] = await toPngDataUrl(file);
  input.value = '';
}

function itemAmount(item: ReceiptItem): number {
  return (item.price || 0) * (item.qty || 0);
}

const subtotal = computed(() => items.value.reduce((sum, item) => sum + itemAmount(item), 0));
const discountAmount = computed(() => Math.min(Math.max(receiptDetails.discount || 0, 0), subtotal.value));
const total = computed(() => subtotal.value - discountAmount.value);
const totalWords = computed(() => (total.value > 0 ? bahtText(total.value) : ''));

const receiptDate = computed(() => new Date(`${receiptDetails.date}T00:00:00`));

const bankLines = computed(() => shop.banks.split('\n')
  .map((line) => line.trim())
  .filter(Boolean));

// address is rendered separately full-width below the grid (it is usually long)
const billToRows = computed(() =>
  [
    { thai: 'บริษัท', en: 'Company', value: receiptDetails.customerCompany },
    { thai: 'นาม', en: 'Customer', value: receiptDetails.customer },
    { thai: 'เลขผู้เสียภาษี', en: 'Tax ID', value: receiptDetails.customerTaxId },
    { thai: 'เบอร์โทร', en: 'Phone', value: receiptDetails.customerPhone },
    { thai: 'อีเมล์', en: 'Email', value: receiptDetails.customerEmail },
  ].filter((row) => row.value),
);

const hasCustomerInfo = computed(() => billToRows.value.length > 0 || Boolean(receiptDetails.customerAddress));

const contactParts = computed(() => [
  shop.phone ? `โทร. ${shop.phone}` : '',
  shop.email,
  shop.website,
].filter(Boolean));

const tableRows = computed(() => {
  const rows = items.value
    .filter((item) => item.description || item.price || item.qty)
    .map((item) => ({
      description: item.description,
      qty: item.qty ? `${item.qty}${item.unit ? ` ${item.unit}` : ''}` : '',
      price: item.price ? formatAmount(item.price).replace('.00', '') : '',
      amount: itemAmount(item) > 0 ? formatAmount(itemAmount(item)) : '',
    }));

  if (!rows.length) {
    rows.push({ description: '', qty: '', price: '', amount: '' });
  }

  return rows;
});

const isGenerating = ref(false);

// scale the A4 preview down to fit narrow screens
const previewContainer = ref<HTMLElement | null>(null);
const sheetElement = ref<HTMLElement | null>(null);
const previewScale = ref(1);
const previewHeight = ref(0);

onMounted(() => {
  const updatePreviewScale = () => {
    const containerWidth = previewContainer.value?.clientWidth || A4_WIDTH_PX;

    previewScale.value = Math.min(1, containerWidth / A4_WIDTH_PX);
    previewHeight.value = (sheetElement.value?.offsetHeight || A4_HEIGHT_PX) * previewScale.value;
  };

  const resizeObserver = new ResizeObserver(updatePreviewScale);

  if (previewContainer.value) {
    resizeObserver.observe(previewContainer.value);
  }

  if (sheetElement.value) {
    resizeObserver.observe(sheetElement.value);
  }

  updatePreviewScale();
});

async function generatePdf() {
  isGenerating.value = true;

  try {
    const { generateReceiptPdf } = await import('~/utils/pdf');
    const date = receiptDate.value;
    const buddhistYear = date.getFullYear() + 543;
    const filename = `ใบเสร็จรับเงิน${receiptDetails.customer ? `_${receiptDetails.customer}` : ''}_${date.getDate()}-${date.getMonth() + 1}-${buddhistYear}.pdf`;

    await generateReceiptPdf(
      {
        shop: { ...shop, bankLines: bankLines.value },
        book: receiptDetails.book,
        number: receiptDetails.number,
        date,
        customerCompany: receiptDetails.customerCompany,
        customer: receiptDetails.customer,
        customerAddress: receiptDetails.customerAddress,
        customerPhone: receiptDetails.customerPhone,
        customerEmail: receiptDetails.customerEmail,
        customerTaxId: receiptDetails.customerTaxId,
        rows: tableRows.value,
        subtotal: subtotal.value,
        discount: discountAmount.value,
        total: total.value,
        totalWords: totalWords.value,
      },
      filename,
    );
  } finally {
    isGenerating.value = false;
  }
}
</script>

<template>
  <div class="layout">
    <div class="panel">
      <h1>
        Receipt — ใบส่งสินค้า / ใบเสร็จรับเงิน
      </h1>

      <div class="form-row">
        <div class="field">
          <label>Book no. (เล่มที่)</label>

          <input v-model="receiptDetails.book">
        </div>

        <div class="field">
          <label>No. (เลขที่)</label>

          <input v-model="receiptDetails.number">
        </div>
      </div>

      <div class="field">
        <label>Date (วันที่)</label>

        <input
          v-model="receiptDetails.date"
          type="date"
        >
      </div>

      <div class="field">
        <label>Company (บริษัท)</label>

        <input v-model="receiptDetails.customerCompany">
      </div>

      <div class="field">
        <label>Customer (นาม)</label>

        <input v-model="receiptDetails.customer">
      </div>

      <div class="field">
        <label>Customer tax ID (เลขประจำตัวผู้เสียภาษี)</label>

        <input v-model="receiptDetails.customerTaxId">
      </div>

      <div class="form-row">
        <div class="field">
          <label>Phone (เบอร์โทร)</label>

          <input v-model="receiptDetails.customerPhone">
        </div>

        <div class="field">
          <label>E-mail (อีเมล์)</label>

          <input v-model="receiptDetails.customerEmail">
        </div>
      </div>

      <div class="field">
        <label>Address (ที่อยู่)</label>

        <input v-model="receiptDetails.customerAddress">
      </div>

      <h2>
        Items / Services (รายการ)
      </h2>

      <div
        v-for="(item, index) in items"
        :key="index"
        class="item-card"
      >
        <div class="item-head">
          <span>Item {{ index + 1 }}</span>

          <button
            v-if="items.length > 1"
            type="button"
            class="btn-small"
            @click="removeItem(index)"
          >
            remove
          </button>
        </div>

        <div class="field">
          <label>Description (รายการ)</label>

          <input
            v-model="item.description"
            placeholder="ขนย้าย"
          >
        </div>

        <div class="form-row">
          <div class="field">
            <label>Quantity (จำนวน)</label>

            <input
              v-model.number="item.qty"
              type="number"
              min="0"
              step="0.5"
              placeholder="1"
            >
          </div>

          <div class="field">
            <label>Unit (หน่วย)</label>

            <input
              v-model="item.unit"
              placeholder="งาน"
            >
          </div>
        </div>

        <div class="field">
          <label>Unit price, ฿ (หน่วยละ)</label>

          <input
            v-model.number="item.price"
            type="number"
            min="0"
            placeholder="4000"
          >
        </div>

        <div class="item-amount">
          Amount: <b>{{ formatAmount(itemAmount(item)) }}</b> ฿
        </div>
      </div>

      <button
        type="button"
        class="btn-add"
        @click="addItem"
      >
        + add item
      </button>

      <div class="field discount-field">
        <label>Discount, ฿ (ส่วนลด)</label>

        <input
          v-model.number="receiptDetails.discount"
          type="number"
          min="0"
          placeholder="0"
        >
      </div>

      <div class="totals-summary">
        <div>
          Subtotal: <b>{{ formatAmount(subtotal) }}</b> ฿
        </div>

        <div v-if="discountAmount > 0">
          Discount: −<b>{{ formatAmount(discountAmount) }}</b> ฿
        </div>

        <div class="totals-summary-total">
          Total: <b>{{ formatAmount(total) }}</b> ฿
        </div>

        <div
          v-if="totalWords"
          class="totals-summary-words"
        >
          {{ totalWords }}
        </div>
      </div>

      <details class="shop-details">
        <summary>
          Shop details (ข้อมูลร้าน) — saved in browser
        </summary>

        <div class="field">
          <label>Name (ชื่อร้าน)</label>

          <input
            v-model="shop.name"
            placeholder="ชื่อร้านของคุณ"
          >
        </div>

        <div class="field">
          <label>Address (ที่อยู่)</label>

          <textarea
            v-model="shop.address"
            rows="2"
          />
        </div>

        <div class="form-row">
          <div class="field">
            <label>Phone (เบอร์โทร)</label>

            <input v-model="shop.phone">
          </div>

          <div class="field">
            <label>Email (อีเมล์)</label>

            <input v-model="shop.email">
          </div>
        </div>

        <div class="field">
          <label>Website (เว็บไซต์)</label>

          <input
            v-model="shop.website"
            placeholder="www.example.com"
          >
        </div>

        <div class="field">
          <label>Tax ID (เลขประจำตัวผู้เสียภาษี)</label>

          <input v-model="shop.taxId">
        </div>

        <div class="field">
          <label>Bank accounts (บัญชีธนาคาร), one per line</label>

          <textarea
            v-model="shop.banks"
            rows="3"
            placeholder="ธ.กสิกรไทย 802-0-29874-8&#10;ธ.กรุงเทพ 129-X-XXXXX-X"
          />
        </div>

        <div class="field">
          <label>Footer note (หมายเหตุ)</label>

          <input v-model="shop.note">
        </div>

        <div class="form-row">
          <div class="field">
            <label>Logo (โลโก้) {{ shop.logo ? '✓' : '' }}</label>

            <input
              type="file"
              accept="image/*"
              @change="onImagePick($event, 'logo')"
            >

            <button
              v-if="shop.logo"
              type="button"
              class="btn-small"
              @click="shop.logo = ''"
            >
              remove
            </button>
          </div>

          <div class="field">
            <label>Payment QR (QR ชำระเงิน) {{ shop.qr ? '✓' : '' }}</label>

            <input
              type="file"
              accept="image/*"
              @change="onImagePick($event, 'qr')"
            >

            <button
              v-if="shop.qr"
              type="button"
              class="btn-small"
              @click="shop.qr = ''"
            >
              remove
            </button>
          </div>
        </div>
      </details>

      <button
        type="button"
        class="btn-generate"
        :disabled="isGenerating"
        @click="generatePdf"
      >
        {{ isGenerating ? 'Generating…' : 'Generate PDF' }}
      </button>
    </div>

    <div
      ref="previewContainer"
      class="preview-container"
      :style="{ height: previewHeight ? previewHeight + 'px' : undefined }"
    >
      <div
        class="sheet-scaler"
        :style="{ transform: `scale(${previewScale})` }"
      >
        <div
          ref="sheetElement"
          class="sheet receipt"
        >
          <!-- header -->
          <div class="rc-header">
            <div class="rc-identity">
              <div>
                <img
                  v-if="shop.logo"
                  class="rc-logo"
                  :src="shop.logo"
                  alt="logo"
                >

                <div
                  v-if="shop.name"
                  class="rc-shop-name"
                >
                  {{ shop.name }}
                </div>

                <div class="rc-contact">
                  <div v-if="shop.address">
                    {{ shop.address }}
                  </div>

                  <div v-if="contactParts.length">
                    <template
                      v-for="(part, index) in contactParts"
                      :key="index"
                    >
                      <template v-if="index > 0">
                        ·
                      </template>
                      {{ part }}
                    </template>
                  </div>

                  <div v-if="shop.taxId">
                    Tax ID: {{ shop.taxId }}
                  </div>
                </div>
              </div>
            </div>

            <div class="rc-doc-title">
              <div class="rc-title-th">
                ใบส่งสินค้า / ใบเสร็จรับเงิน
              </div>

              <div class="rc-title-en">
                DELIVERY / RECEIPT
              </div>

              <div class="rc-doc-meta">
                <div
                  v-if="receiptDetails.book"
                  class="rc-meta-line"
                >
                  <span class="label">เล่มที่ <i>BOOK NO.</i></span>

                  <span class="value">{{ receiptDetails.book }}</span>
                </div>

                <div
                  v-if="receiptDetails.number"
                  class="rc-meta-line"
                >
                  <span class="label">เลขที่ <i>DOC NO.</i></span>

                  <span class="value">{{ receiptDetails.number }}</span>
                </div>

                <div class="rc-meta-line">
                  <span class="label">วันที่ <i>DATE</i></span>

                  <span class="value">{{ formatDisplayDate(receiptDate) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="rc-rule" />

          <!-- bill to -->
          <div
            v-if="hasCustomerInfo"
            class="rc-bill-to"
          >
            <div class="rc-section-title">
              ลูกค้า <span>BILL TO</span>
            </div>

            <div class="rc-bill-to-grid">
              <div
                v-for="(row, index) in billToRows"
                :key="index"
                class="rc-field"
              >
                <span class="label">{{ row.thai }} <i>{{ row.en }}</i></span>

                <span class="value">{{ row.value }}</span>
              </div>
            </div>

            <div
              v-if="receiptDetails.customerAddress"
              class="rc-field"
            >
              <span class="label">ที่อยู่ <i>Address</i></span>

              <span class="value">{{ receiptDetails.customerAddress }}</span>
            </div>
          </div>

          <!-- items -->
          <table class="rc-items">
            <thead>
              <tr>
                <th class="align-center">
                  ลำดับ<span class="label-en">NO.</span>
                </th>

                <th class="description">
                  รายการ<span class="label-en">DESCRIPTION</span>
                </th>

                <th class="align-right">
                  จำนวน<span class="label-en">QTY</span>
                </th>

                <th class="align-right">
                  หน่วยละ<span class="label-en">UNIT PRICE</span>
                </th>

                <th class="align-right">
                  จำนวนเงิน<span class="label-en">AMOUNT</span>
                </th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="(row, index) in tableRows"
                :key="index"
              >
                <td class="align-center">
                  {{ row.description ? index + 1 : '' }}
                </td>

                <td class="description">
                  {{ row.description }}
                </td>

                <td class="align-right numeric">
                  {{ row.qty }}
                </td>

                <td class="align-right numeric">
                  {{ row.price }}
                </td>

                <td class="align-right numeric">
                  {{ row.amount }}
                </td>
              </tr>
            </tbody>
          </table>

          <!-- payment + totals side by side -->
          <div class="rc-totals-row">
            <div
              v-if="bankLines.length || shop.qr"
              class="rc-payment-card"
            >
              <div class="rc-section-title">
                ช่องทางชำระเงิน <span>PAYMENT</span>
              </div>

              <div class="rc-payment-body">
                <img
                  v-if="shop.qr"
                  class="rc-qr"
                  :src="shop.qr"
                  alt="QR"
                >

                <ul
                  v-if="bankLines.length"
                  class="rc-banks"
                >
                  <li
                    v-for="(bankLine, index) in bankLines"
                    :key="index"
                  >
                    {{ bankLine }}
                  </li>
                </ul>
              </div>
            </div>

            <div
              v-else
              class="rc-payment-spacer"
            />

            <div class="rc-totals">
              <div class="rc-totals-line">
                <span>ยอดรวม <i>Subtotal</i></span>

                <span class="numeric">{{ formatAmount(subtotal) }}</span>
              </div>

              <div
                v-if="discountAmount > 0"
                class="rc-totals-line"
              >
                <span>ส่วนลด <i>Discount</i></span>

                <span class="numeric">−{{ formatAmount(discountAmount) }}</span>
              </div>

              <div class="rc-totals-total">
                <span>รวมเงิน <i>TOTAL</i></span>

                <span class="rc-total-amount numeric">{{ formatBaht(total) }}</span>
              </div>

              <div
                v-if="totalWords"
                class="rc-words"
              >
                ({{ totalWords }})
              </div>
            </div>
          </div>

          <!-- signatures -->
          <div class="rc-signatures">
            <div class="rc-signature">
              <div class="rc-signature-line" />

              <div class="rc-signature-label">
                ผู้วางบิล <span>Prepared by</span>
              </div>

              <div class="rc-signature-date">
                วันที่ <span>Date</span>

                &nbsp;&nbsp;<b class="rc-signature-date-value">{{ formatDisplayDate(receiptDate) }}</b>
              </div>
            </div>

            <div class="rc-signature">
              <div class="rc-signature-line" />

              <div class="rc-signature-label">
                ผู้รับเงิน <span>Received by</span>
              </div>

              <div class="rc-signature-date">
                วันที่ <span>Date</span> ............................
              </div>
            </div>
          </div>

          <div
            v-if="shop.note"
            class="rc-note"
          >
            {{ shop.note }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
