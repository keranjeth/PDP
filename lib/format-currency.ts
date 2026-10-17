/** Format currency for display with Afghani symbol when applicable. */
export function formatCurrency(amount: number, currency: string = 'AFN'): string {
  if (currency === 'AFN') {
    return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ؋`;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
