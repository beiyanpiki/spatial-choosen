const palette = [
  "#E53E3E", // red-500
  "#3182CE", // blue-500
  "#38A169", // green-500
  "#D69E2E", // yellow-600
  "#805AD5", // purple-500
  "#DD6B20", // orange-500
  "#319795", // teal-500
  "#D53F8C", // pink-500
  "#4A5568", // gray-600
  "#2B6CB0", // blue-700
];

export const colorForLabel = (label: number) => {
  const index = Math.abs(label) % palette.length;
  return palette[index];
};
