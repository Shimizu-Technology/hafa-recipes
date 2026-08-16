import React from 'react';
import { Image, StyleSheet, View as RNView, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

import { radius } from '@/constants/Colors';
import { useColors } from '@/components/Themed';

interface BrandMarkProps {
  size?: number;
  variant?: 'icon' | 'mark';
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
}

const iconSource = require('../assets/images/icon.png');
const markSource = require('../assets/images/splash-icon.png');

export function BrandMark({ size = 64, variant = 'mark', style, imageStyle }: BrandMarkProps) {
  const colors = useColors();
  const source = variant === 'icon' ? iconSource : markSource;

  return (
    <RNView
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: variant === 'icon' ? Math.round(size * 0.24) : radius.xl,
          backgroundColor: variant === 'icon' ? 'transparent' : colors.backgroundSecondary,
        },
        style,
      ]}
    >
      <Image
        source={source}
        resizeMode="contain"
        style={[
          {
            width: variant === 'icon' ? size : Math.round(size * 0.82),
            height: variant === 'icon' ? size : Math.round(size * 0.82),
          },
          imageStyle,
        ]}
      />
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
