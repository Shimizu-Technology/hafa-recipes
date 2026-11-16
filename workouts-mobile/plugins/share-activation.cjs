// Safari's preprocessing result is a property-list provider, including for PDFs.
// Keep the share-sheet limit at four images; the in-app class picker allows eight.
// Bound standalone sources to one item: up to four images or one other
// supported provider. The Safari PDF + URL pair below is the only exception.
module.exports = [
  'extensionItems.@count == 1 AND SUBQUERY(extensionItems, $item,',
  '$item.attachments.@count >= 1 AND $item.attachments.@count <= 4 AND',
  'SUBQUERY($item.attachments, $a,',
  'ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "public.image" OR',
  'ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "public.file-url" OR',
  'ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "com.adobe.pdf" OR',
  'ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "public.text" OR',
  'ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "public.url" OR',
  'ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "com.apple.property-list"',
  ').@count == $item.attachments.@count AND',
  '($item.attachments.@count == 1 OR SUBQUERY($item.attachments, $a,',
  'ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "public.image"',
  ').@count == $item.attachments.@count)).@count == 1',
].join(' ');

// Safari can deliver the PDF and its source URL as two separate extension items.
// Permit exactly that pair, not arbitrary two-item or five-photo payloads.
const singleItem = module.exports;
const pdf = 'ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "com.adobe.pdf"';
const sourceURL = 'ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "public.url" AND NOT (' + pdf + ') AND NOT (ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "public.image")';
const oneProvider = predicate => 'SUBQUERY(extensionItems, $item, $item.attachments.@count == 1 AND SUBQUERY($item.attachments, $a, ' + predicate + ').@count == 1).@count == 1';
module.exports = '(' + singleItem + ') OR (extensionItems.@count == 2 AND ' + oneProvider(pdf) + ' AND ' + oneProvider(sourceURL) + ')';
