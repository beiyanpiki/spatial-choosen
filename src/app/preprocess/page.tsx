'use client';

import { Box, Heading } from '@chakra-ui/react';
import dynamic from 'next/dynamic';

const PreprocessPageClient = dynamic(() => import('./page.client'), {
  ssr: false,
  loading: () => (
    <Box p={10}>
      <Heading size='md'>Loading…</Heading>
    </Box>
  ),
});

export default function PreprocessPage() {
  return <PreprocessPageClient />;
}
