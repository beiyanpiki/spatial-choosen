declare module 'utif' {
  export type TiffIfd = {
    width?: number;
    height?: number;
    t256?: number[];
    t257?: number[];
    [key: string]: unknown;
  };

  export function decode(buffer: ArrayBuffer): TiffIfd[];
  export function decodeImage(buffer: ArrayBuffer, ifd: TiffIfd): void;
  export function toRGBA8(ifd: TiffIfd): Uint8Array;
}
