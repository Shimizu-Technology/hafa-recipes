/** Keep the tab bar, Add and transient feedback clear as text and safe areas grow. */
export function floatingLayout(fontScale: number, bottomInset: number) {
  const barHeight = Math.max(64, Math.ceil(40 + 28 * fontScale));
  const addSize = 54;
  const addBottom = barHeight + bottomInset + 16;
  return { barHeight, addSize, addBottom, toastBottom: addBottom + addSize + 12 };
}
