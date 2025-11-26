import { extendTheme, ThemeConfig } from "@chakra-ui/react";

const config: ThemeConfig = {
  initialColorMode: "light",
  useSystemColorMode: false,
};

const fonts = {
  heading: "'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  body: "'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const colors = {
  brand: {
    50: "#f0f8ff",
    100: "#c0e0ff",
    200: "#8fc7ff",
    300: "#5faefe",
    400: "#2f96f9",
    500: "#167dde",
    600: "#0f61ae",
    700: "#08467f",
    800: "#032b50",
    900: "#001222",
  },
};

export const theme = extendTheme({ config, fonts, colors, styles: {
  global: {
    body: {
      bg: "gray.50",
      color: "gray.800",
    },
  },
}});
