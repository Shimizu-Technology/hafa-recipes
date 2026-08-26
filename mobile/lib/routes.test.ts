import { describe, expect, it } from 'vitest';

import { appRoutes } from './routes';

describe('related record routes', () => {
  it('builds the canonical collection detail route', () => {
    expect(appRoutes.collection('collection-123')).toEqual({
      pathname: '/collection/[id]',
      params: { id: 'collection-123' },
    });
  });

  it('builds the canonical recipe detail route without losing the stable recipe id', () => {
    expect(appRoutes.recipe('recipe-123')).toEqual({
      pathname: '/recipe/[id]',
      params: { id: 'recipe-123' },
    });
  });

  it('keeps grocery empty-state destinations stable', () => {
    expect(appRoutes.discover).toBe('/(tabs)/discover');
    expect(appRoutes.planner).toBe('/(tabs)/planner');
  });
});
