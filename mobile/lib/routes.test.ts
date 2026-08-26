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

  it('links cross-feature actions to the grocery tab', () => {
    expect(appRoutes.grocery).toBe('/(tabs)/grocery');
  });

  it('builds an exact-date planner route', () => {
    expect(appRoutes.plannerDate('2026-08-27')).toEqual({
      pathname: '/(tabs)/planner',
      params: { date: '2026-08-27' },
    });
  });

  it('builds a trusted recipe-to-planner handoff route', () => {
    expect(appRoutes.plannerRecipe('91e74f66-dba0-4fb0-b879-ae2f8c59626e')).toEqual({
      pathname: '/(tabs)/planner',
      params: { recipeId: '91e74f66-dba0-4fb0-b879-ae2f8c59626e' },
    });
  });
});
