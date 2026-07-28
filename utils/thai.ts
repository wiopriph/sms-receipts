const THAI_DIGIT_WORDS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_PLACE_WORDS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function integerToThaiWords(digits: string): string {
  // numbers above 999 999 are read in groups of 6 digits joined with ล้าน (million)
  if (digits.length > 6) {
    const millions = digits.slice(0, digits.length - 6);
    const remainder = digits.slice(digits.length - 6);

    return `${integerToThaiWords(millions)}ล้าน${Number(remainder) === 0 ? '' : integerToThaiWords(remainder)}`;
  }

  let words = '';

  const length = digits.length;

  for (let position = 0; position < length; position++) {
    const digit = Number(digits[position]);
    const place = length - position - 1;

    if (digit === 0) {
      continue;
    }

    if (place === 1 && digit === 1) {
      words += 'สิบ';
    } else if (place === 1 && digit === 2) {
      words += 'ยี่สิบ';
    } else if (place === 0 && digit === 1 && length > 1 && Number(digits[length - 2]) !== 0) {
      words += 'เอ็ด';
    } else {
      words += THAI_DIGIT_WORDS[digit] + THAI_PLACE_WORDS[place];
    }
  }

  return words;
}

/** Convert an amount to Thai baht words, e.g. 19500 -> หนึ่งหมื่นเก้าพันห้าร้อยบาทถ้วน */
export function bahtText(amount: number): string {
  if (!isFinite(amount)) {
    return '';
  }

  const isNegative = amount < 0;
  const absoluteAmount = Math.abs(Math.round(amount * 100) / 100);
  const wholeBaht = Math.floor(absoluteAmount);
  const satang = Math.round((absoluteAmount - wholeBaht) * 100);

  if (wholeBaht === 0 && satang === 0) {
    return 'ศูนย์บาทถ้วน';
  }

  let words = '';

  if (wholeBaht > 0) {
    words += `${integerToThaiWords(String(wholeBaht))}บาท`;
  }

  words += satang > 0 ? `${integerToThaiWords(String(satang))}สตางค์` : 'ถ้วน';

  return (isNegative ? 'ลบ' : '') + words;
}

/** "4,000.00", or "-" for zero */
export function formatAmount(value: number): string {
  if (!isFinite(value) || value === 0) {
    return '-';
  }

  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "฿4,000.00", or "-" for zero */
export function formatBaht(value: number): string {
  if (!isFinite(value) || value === 0) {
    return '-';
  }

  return `฿${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** e.g. 2026-07-28 -> "28 Jul 2026" */
export function formatDisplayDate(date: Date): string {
  return `${date.getDate()} ${MONTH_NAMES_EN[date.getMonth()]} ${date.getFullYear()}`;
}
