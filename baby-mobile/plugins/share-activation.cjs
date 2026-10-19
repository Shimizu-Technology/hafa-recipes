// Safari's preprocessing result is a property-list provider, including for PDFs.
// The native loader consumes one extension item. Accept up to four images and
// or one other supported provider; alternative representations count once.
module.exports = [
  'extensionItems.@count == 1 AND SUBQUERY(extensionItems, $item,',
  '$item.attachments.@count >= 1 AND $item.attachments.@count <= 4 AND',
  'SUBQUERY($item.attachments, $a,',
  'ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "public.image" OR',
  'ANY $a.registeredTypeIdentifiers UTI-CONFORMS-TO "public.movie" OR',
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
