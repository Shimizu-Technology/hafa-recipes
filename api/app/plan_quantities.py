"""Exact scaling for explicitly opted-in meal entries; unknown amounts stay unknown."""

import re
from fractions import Fraction

FRACTIONS = {
    "¼": "1/4",
    "½": "1/2",
    "¾": "3/4",
    "⅓": "1/3",
    "⅔": "2/3",
    "⅛": "1/8",
    "⅜": "3/8",
    "⅝": "5/8",
    "⅞": "7/8",
}


def parse_plan_quantity(quantity):
    """Parse a stated numeric amount exactly, including source mixed numbers."""
    value = str(quantity).strip().replace("⁄", "/")
    for glyph, fraction in FRACTIONS.items():
        if value.endswith(glyph):
            value = f"{value[:-1].strip()} {fraction}".strip()
            break
    if not re.fullmatch(r"(?:\d+(?:\.\d+)?|\d+/\d+|\d+ \d+/\d+)", value):
        raise ValueError("Quantity is not a stated numeric amount")
    return sum(Fraction(part) for part in value.split())


def format_plan_quantity(amount):
    """Keep exact grocery amounts readable as wholes, proper or mixed fractions."""
    whole, remainder = divmod(amount.numerator, amount.denominator)
    if not remainder:
        return str(whole)
    fraction = f"{remainder}/{amount.denominator}"
    return f"{whole} {fraction}" if whole else fraction


def scaled_plan_quantity(quantity, target, original):
    if quantity is None or not target:
        return quantity, False
    try:
        base = Fraction(str(original))
        if base <= 0:
            raise ValueError
        amount = parse_plan_quantity(quantity) * Fraction(str(target)) / base
        if amount < 0:
            raise ValueError
        return format_plan_quantity(amount), False
    except (ValueError, ZeroDivisionError, TypeError):
        return quantity, True
