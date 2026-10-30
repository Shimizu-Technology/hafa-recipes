// Replace the width variants in public/images/home to refresh photography or 3.0.0 captures.
// All source/credit metadata is kept here; photos are home cooking, never named Guam dishes.
export const photos = {
  cilantro: {
    file: 'cilantro', alt: 'Hands chopping fresh cilantro on a kitchen counter',
    title: 'Person cutting vegetables with knife', creator: 'Alyson McPhee',
    source: 'https://unsplash.com/photos/person-cutting-vegetables-with-knife-yWG-ndhxvqY',
    original: 'https://images.unsplash.com/photo-1514986888952-8cd320577b68',
    license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license',
  },
  dough: {
    file: 'dough', alt: 'Hands kneading dough on a flour-dusted wooden counter',
    title: 'Person standing and making dough', creator: 'Theme Photos',
    source: 'https://unsplash.com/photos/person-standing-and-making-dough-Hx7xdwhj2AY',
    original: 'https://images.unsplash.com/flagged/photo-1561668038-2742fcef75d7',
    license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license',
  },
};
// Native audit captures, 2026-10-29. Crop coordinates follow a proportional resize to 942px.
// Status/development chrome and old tab bars are excluded. No screenshot text was replaced.
export const screens = [
  { name: 'Grocery', file: 'app-grocery', height: 1535, source: 'grocery-checked--light--default.png', crop: '878x1535+32+295', alt: 'Grocery List with pantry access and checked items', description: 'Turn saved recipes into a shopping list. Check off what you have, and keep shopping offline.' },
  { name: 'Import', file: 'app-import', height: 1530, source: 'import-root--light--default.png', crop: '878x1530+32+260', alt: 'Import a recipe from a link, text, photos or manual entry', description: 'Paste a cooking link or recipe text, scan a card, or write your own recipe. Review what was extracted before saving.' },
  { name: 'Discover', file: 'app-discover', height: 465, source: 'discover-root--light--default.png', crop: '878x465+32+275', alt: 'Discover search and recipe inspiration controls', description: 'Find community recipes and look for something to cook with ingredients you already have.' },
  { name: 'Cook Mode', file: 'app-cook', height: 430, source: 'cook-mode--light--default.png', crop: '878x430+32+1590', alt: 'Cook Mode timer, edit and finish controls', description: 'Follow the recipe one step at a time, with timers beside the instructions. Ask Håfa when you need a substitution or cooking help.' },
];
export const imagePath = (file: string, width: number) => `/images/home/${file}-${width}.webp`;
export const imageSet = (file: string, widths: number[]) => widths.map((width) => `${imagePath(file, width)} ${width}w`).join(', ');
