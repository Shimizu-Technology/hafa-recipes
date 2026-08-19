import { createContext, ReactNode, useContext } from 'react';

import { useAsyncExtractionController } from '@/hooks/useRecipes';

type ExtractionController = ReturnType<typeof useAsyncExtractionController>;

const ExtractionContext = createContext<ExtractionController | null>(null);

export function ExtractionProvider({ children }: { children: ReactNode }) {
  const extraction = useAsyncExtractionController();
  return (
    <ExtractionContext.Provider value={extraction}>
      {children}
    </ExtractionContext.Provider>
  );
}

export function useAsyncExtraction() {
  const extraction = useContext(ExtractionContext);
  if (!extraction) {
    throw new Error('useAsyncExtraction must be used inside ExtractionProvider');
  }
  return extraction;
}
