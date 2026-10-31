import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Text } from '@/components/Themed';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const metrics = vi.hoisted(() => ({ width: 390, fontScale: 1 }));
beforeEach(() => { metrics.fontScale = 1; });
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => metrics,
  View: 'View',
}));
vi.mock('@/components/Animated', () => ({ ScalePressable: 'ScalePressable' }));
vi.mock('@/components/RecipeThumbnail', () => ({ RecipeThumbnail: 'RecipeThumbnail' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => colors }));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { displaySemibold: 'Fraunces' },
  fontSize: { sm: 14 },
  radius: { md: 12 },
  shadows: { card: {} },
  spacing: { sm: 8, lg: 24 },
}));

import { RecipeGridCardFrame } from './RecipeGridCardFrame';

const colors = { card: '#202820', cardBorder: '#394139', text: '#f2f3ef' } as any;

async function renderCard(title: string) {
  const renderer = createRoot({ textComponentTypes: ['Text'] });
  await act(async () => {
    renderer.render(
      <RecipeGridCardFrame
        title={title}
        thumbnailUrl={null}
        onPress={vi.fn()}
        colors={colors}
        footer={<Text>by Leon Shimizu</Text>}
      />,
    );
  });
  return renderer;
}

describe('recipe grid card alignment', () => {
  it.each(['KBBQ Beef Kabobs', 'Creamy Italian Sausage & Gnocchi Soup'])(
    'reserves the same title and footer slots for %s', async (title) => {
      const renderer = await renderCard(title);
      try {
        const titleNode = renderer.container.queryAll(
          (node) => node.type === 'Text' && node.props.numberOfLines === 2,
        )[0];
        const contentNode = renderer.container.queryAll(
          (node) => node.type === 'View' && node.props.style?.[1]?.minHeight === 88,
        )[0];
        const footerNode = renderer.container.queryAll(
          (node) => node.type === 'View' && node.props.style?.[1]?.minHeight === 18,
        )[0];

        expect(titleNode.props.style[0]).toMatchObject({ lineHeight: 21, fontSize: 16, fontFamily: 'Fraunces' });
        expect(titleNode.props.style[1]).toMatchObject({ minHeight: 42 });
        expect(contentNode.props.style[0]).toMatchObject({ justifyContent: 'space-between' });
        expect(footerNode).toBeDefined();
      } finally {
        await act(async () => renderer.unmount());
      }
    },
  );
});

describe('recipe grid card accessibility', () => {
  it('reads as one button labelled with the recipe, or a caller-provided label', async () => {
    const renderer = createRoot({ textComponentTypes: ['Text'] });
    await act(async () => {
      renderer.render(
        <>
          <RecipeGridCardFrame title="Red Rice" thumbnailUrl={null} onPress={vi.fn()} colors={colors} footer={null} />
          <RecipeGridCardFrame
            title="Kelaguen"
            accessibilityLabel="Kelaguen, 20 min"
            thumbnailUrl={null}
            onPress={vi.fn()}
            colors={colors}
            footer={null}
          />
        </>,
      );
    });
    try {
      const cards = renderer.container.queryAll((node) => node.type === 'ScalePressable');
      expect(cards.map((card) => card.props.accessibilityRole)).toEqual(['button', 'button']);
      expect(cards.map((card) => card.props.accessibilityLabel)).toEqual(['Red Rice', 'Kelaguen, 20 min']);
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});

it('gives large accessibility text the full content width and expands the title slot', async () => {
  metrics.fontScale = 2;
  const renderer = await renderCard('Creamy Italian Sausage & Gnocchi Soup');
  try {
    const card = renderer.container.queryAll(n => n.type === 'ScalePressable')[0];
    expect(card.props.style[1].width).toBe(342);
    const title = renderer.container.queryAll(n => n.type === 'Text' && n.props.numberOfLines === 2)[0];
    expect(title.props.style[1].minHeight).toBe(84);
  } finally { await act(async () => renderer.unmount()); }
});
