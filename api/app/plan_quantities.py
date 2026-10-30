"""Exact scaling for explicitly opted-in meal entries; unknown amounts stay unknown."""
import re
from fractions import Fraction

FRACTIONS = {'¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'}


def scaled_plan_quantity(quantity, target, original):
    if quantity is None or not target:
        return quantity, False
    try:
        base = Fraction(str(original))
        if base <= 0:
            raise ValueError
        value = str(quantity).strip().replace('⁄', '/')
        for glyph, fraction in FRACTIONS.items():
            if value.endswith(glyph):
                value = f'{value[:-1].strip()} {fraction}'.strip()
                break
        if not re.fullmatch(r'(?:\d+(?:\.\d+)?|\d+/\d+|\d+ \d+/\d+)', value):
            raise ValueError
        amount = sum(Fraction(part) for part in value.split()) * Fraction(str(target)) / base
        if amount < 0:
            raise ValueError
        return (str(amount.numerator) if amount.denominator == 1 else str(amount)), False
    except (ValueError, ZeroDivisionError, TypeError):
        return quantity, True
