import React from 'react';

const host = (name: string) => (props: Record<string, unknown>) =>
  React.createElement(name, props, props.children as React.ReactNode);

export const Image = host('Image');
export const Modal = host('Modal');
export const ScrollView = host('RCTScrollView');
export const Switch = host('RCTSwitch');
export const Text = host('Text');
export const TextInput = host('TextInput');
export const TouchableOpacity = host('TouchableOpacity');
export const View = host('NativeView');

export const StyleSheet = {
  create: <T,>(styles: T) => styles,
  flatten: (style: unknown) => style,
};
