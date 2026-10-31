// @ts-expect-error Node is available in Vitest but excluded from Expo app types.
import { readdirSync, readFileSync, statSync } from 'node:fs';
// @ts-expect-error Node is available in Vitest but excluded from Expo app types.
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Like jsx-text-nodes.test.ts in Workouts, scan every shipped screen/component.
// Literal white stays confined to these reviewed dark scrims/backgrounds.
// Theme-filled controls use onTint/onError, including their inactive styles.
const allowed: Record<string, string[]> = {
  'app/_layout.tsx': ["<Text style={{ color: '#FFFFFF', fontSize: 17, textAlign: 'center' }}>"], // fixed #101411 recovery screen
  'app/edit-recipe/[id].tsx': ['<Ionicons name="camera" size={24} color="#FFFFFF" />', "color: '#FFFFFF',"], // photo scrim
  'app/(tabs)/discover/index.tsx': ['<ActivityIndicator size="small" color="#FFFFFF" />', 'color="#FFFFFF"'], // photo save scrim
  'app/settings.tsx': [
    "themePreference === theme.key && { backgroundColor: colors.text === '#FFFFFF' ? '#636366' : '#FFFFFF' },",
    "textSize === size.key && { backgroundColor: colors.text === '#FFFFFF' ? '#636366' : '#FFFFFF' },",
  ], // neutral segment backgrounds, never foregrounds
  'components/EnvironmentBanner.tsx': ["color: '#FFFFFF',"], // fixed dark purple/brown
  'components/RecipeTrustBadge.tsx': ["const foreground = inverted ? '#FFFFFF' : colors.warning;"], // rgba(0,0,0,0.72)
};
const root = new URL('..', import.meta.url).pathname;
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /(?<!\.test)\.tsx$/.test(name) ? [path] : [];
  });
}
function whiteLines(source: string) {
  return source.split('\n').flatMap((line, index) => /(['"])(?:#fff(?:fff)?|white)\1/i.test(line)
    ? [{ line: line.trim(), number: index + 1 }] : []);
}
it('keeps literal white out of theme-filled foregrounds across Recipes', () => {
  const offenders = ['app', 'components'].flatMap(dir => sources(join(root, dir))).flatMap(file =>
    {
      const exceptions = [...(allowed[file.slice(root.length)] ?? [])];
      return whiteLines(readFileSync(file, 'utf8')).flatMap(({ line, number }) => {
        const index = exceptions.indexOf(line);
        if (index < 0) return [`${file.slice(root.length)}:${number}: ${line}`];
        exceptions.splice(index, 1);
        return [];
      });
    });
  expect(offenders).toEqual([]);
});
it.each(['#FFFFFF', '#fff', '#FFF', 'white'])('detects white style and icon/spinner foregrounds (%s)', color => {
  expect(whiteLines(`<Text style={{ color: '${color}' }} />\n<ActivityIndicator color="${color}" />`)).toHaveLength(2);
});
