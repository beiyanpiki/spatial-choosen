'use client';

import {
  Box,
  Card,
  CardBody,
  SimpleGrid,
  Stack,
  Text,
} from '@chakra-ui/react';

/**
 * Step 2 exclusion controls. Excluded rows/columns keep their array positions
 * everywhere (the capture box is never resized and the grid never compacts);
 * they are locked as inactive downstream (see src/lib/built-in-admin/exclusion.ts).
 * Rows are numbered from the bottom so the list matches the bottom-left
 * array_row numbering of the exported tissue_positions.csv.
 */

const toggle = (list: number[], value: number): number[] => {
  const next = new Set(list);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return [...next].sort((a, b) => a - b);
};

function ExclusionList({
  label,
  count,
  excluded,
  onChange,
  disabled,
  numberedFromBottom = false,
}: {
  label: string;
  count: number;
  excluded: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
  numberedFromBottom?: boolean;
}) {
  if (count <= 0) return null;
  const excludedSet = new Set(excluded);

  return (
    <Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
      <CardBody p={4}>
        <Stack spacing={3}>
          <Text fontSize="sm" fontWeight="semibold">{label}</Text>
          <Box maxHeight="200px" overflowY="auto" pr={1}>
            <SimpleGrid columns={6} spacing={2}>
              {Array.from({ length: count }, (_, index) => index + 1).map((value) => {
                const arrayPosition = numberedFromBottom ? count + 1 - value : value;
                return (
                  <label
                    key={value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      fontSize: 'sm',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={excludedSet.has(arrayPosition)}
                      onChange={() => onChange(toggle(excluded, arrayPosition))}
                    />
                    <span>{value}</span>
                  </label>
                );
              })}
            </SimpleGrid>
          </Box>
          <Text fontSize="xs" color="gray.500">{excluded.length} excluded</Text>
        </Stack>
      </CardBody>
    </Card>
  );
}

export function ExclusionControls({
  rows,
  columns,
  excludedRows,
  excludedColumns,
  onExcludeRowsChange,
  onExcludeColumnsChange,
  disabled = false,
}: {
  rows: number | null;
  columns: number | null;
  excludedRows: number[];
  excludedColumns: number[];
  onExcludeRowsChange: (next: number[]) => void;
  onExcludeColumnsChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  return (
    <Stack spacing={4}>
      <Card border="1px solid" borderColor="gray.200" borderRadius="2xl" boxShadow="sm" bg="white">
        <CardBody p={4}>
          <Stack spacing={2}>
            <Text fontSize="sm" fontWeight="semibold">Exclude rows / columns</Text>
            <Text fontSize="xs" color="gray.500">
              Excluded rows and columns are locked as inactive in tissue selection
              (kept at in_tissue=0 in the export) without changing the capture box
              or the grid layout.
            </Text>
          </Stack>
        </CardBody>
      </Card>
      {rows && columns ? (
        <>
          <ExclusionList
            label="Exclude rows"
            count={rows}
            excluded={excludedRows}
            onChange={onExcludeRowsChange}
            disabled={disabled}
            numberedFromBottom
          />
          <ExclusionList
            label="Exclude columns"
            count={columns}
            excluded={excludedColumns}
            onChange={onExcludeColumnsChange}
            disabled={disabled}
          />
        </>
      ) : null}
    </Stack>
  );
}
