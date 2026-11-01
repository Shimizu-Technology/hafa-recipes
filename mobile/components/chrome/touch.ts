/**
 * Every chrome control is at least a 44pt touch target. Smaller visuals (34pt chips, 32pt
 * segments) sit inside a 44pt pressable rather than relying on hitSlop, which Android ignores
 * outside the parent's bounds; containers pull back by the extra space so layout is unchanged.
 */
export const MIN_TOUCH = 44;

/** Extra space above and below a visual of `height` to reach the minimum touch height. */
export const touchInset = (height: number) => Math.max(0, (MIN_TOUCH - height) / 2);
