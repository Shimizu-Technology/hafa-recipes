type AuthRouter = {
  back: () => void;
  canGoBack: () => boolean;
  replace: (href: '/(tabs)') => void;
};

/** Describe the destination that the shared auth Back action will use. */
export function authBackAccessibilityLabel(router: AuthRouter) {
  return router.canGoBack() ? 'Back to previous screen' : 'Back to Håfa Recipes';
}

/** Leave auth safely even when a restored screen has no navigation history. */
export function leaveAuthScreen(router: AuthRouter) {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/(tabs)');
}
