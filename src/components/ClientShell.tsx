'use client';

import { useState } from 'react';
import { SearchBox } from './SearchBox';
import { IngestOverlay } from './IngestOverlay';

export function ClientShell() {
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [completedAt, setCompletedAt] = useState<string | null>(null);

  function handleReady(ts: string) {
    setCompletedAt(ts);
    setOverlayVisible(false);
  }

  return (
    <>
      {overlayVisible && <IngestOverlay onReady={handleReady} />}
      <SearchBox
        refreshedAt={completedAt}
        onRefreshStart={() => setOverlayVisible(true)}
      />
    </>
  );
}
