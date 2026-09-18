'use client';

import { Box, Heading } from '@chakra-ui/react';
import dynamic from 'next/dynamic';

const BatchPageClient = dynamic(() => import('./page.client'), {
  ssr: false,
  loading: () => (
    <Box p={10}>
      <Heading size='md'>Loading…</Heading>
    </Box>
  ),
});

export default function BatchPage() {
  return <BatchPageClient />;
}
