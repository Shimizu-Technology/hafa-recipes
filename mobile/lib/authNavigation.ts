type AuthRouter = {
  back: () => void;
  canGoBack: () => boolean;
  replace: (href: '/(tabs)') => void;
};

/** Leave auth safely even when a restored screen has no navigation history. */
export function leaveAuthScreen(router: AuthRouter) {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/(tabs)');
}
