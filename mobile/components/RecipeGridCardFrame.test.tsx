import React from 'react';
import { act } from 'react';
import { createRoot } from 'test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Text } from '@/components/Themed';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
  View: 'View',
}));
vi.mock('@/components/Animated', () => ({ ScalePressable: 'ScalePressable' }));
vi.mock('@/components/RecipeThumbnail', () => ({ RecipeThumbnail: 'RecipeThumbnail' }));
vi.mock('@/components/Themed', () => ({ Text: 'Text', useColors: () => colors }));
vi.mock('@/constants/Colors', () => ({
  fontFamily: { semibold: 'System' },
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
          (node) => node.type === 'View' && node.props.style?.[1]?.minHeight === 80,
        )[0];
        const footerNode = renderer.container.queryAll(
          (node) => node.type === 'View' && node.props.style?.[1]?.minHeight === 16,
        )[0];

        expect(titleNode.props.style[0]).toMatchObject({ lineHeight: 18 });
        expect(titleNode.props.style[1]).toMatchObject({ minHeight: 36 });
        expect(contentNode.props.style[0]).toMatchObject({ justifyContent: 'space-between' });
        expect(footerNode).toBeDefined();
      } finally {
        await act(async () => renderer.unmount());
      }
    },
  );
});
