'use client';

import { Box } from '@chakra-ui/react';

import { BatchWorkspace } from './components/BatchWorkspace';

export default function BatchPageClient() {
  return (
    <Box as='main' px={{ base: 4, lg: 8 }} py={{ base: 6, lg: 10 }}>
      <Box maxW='1480px' mx='auto'>
        <BatchWorkspace />
      </Box>
    </Box>
  );
}
